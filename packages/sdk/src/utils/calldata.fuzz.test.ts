import { expect } from 'chai'
import { encodeAbiParameters, encodeFunctionData, parseAbiParameter, toFunctionSelector } from 'viem'
import type { HexString } from '../types/index.js'
import type { CatalogTemplate, CatalogVariable, MarketplaceWorkflow } from '../types/workflow.js'
import { buildWorkflowDefinitionFromCatalog } from './catalog.js'
import { checkActionSelectorSchema, parseSelectorParameters } from './workflowRules.js'
import {
  buildScript,
  encodeVariableLengthValue,
  isDynamicAbiType,
  staticHeadWordCount,
  fillRuntimeSlots,
} from './weiroll.js'

/**
 * Randomised differential against viem, over generated ABI types.
 *
 * The hand-written table next door only covers shapes somebody thought of, which is the
 * failure mode that produced both bugs on this branch. This generates the shapes instead:
 * random nesting of tuples, arrays and elementary types, encoded through the SDK and
 * compared byte-for-byte with viem's encoding of the same call.
 *
 * **On the oracle.** viem, not weiroll.js. The reference planner would have been the
 * obvious choice, but measuring the two against each other (see the comparison in
 * calldata.test.ts) found it wrong on static tuples and fixed-size arrays: its
 * `isDynamicType` calls every tuple and array dynamic, so it strips 32 bytes from a value
 * that has no offset word and drops the first component. Fuzzing against it would mean an
 * exception list covering exactly the semantics in dispute, leaving only the parts already
 * known to agree — and it would add ethers v5 beside viem for the privilege. It has also
 * been untouched since 2022, its last commit titled "Fix tuple encoding bug".
 *
 * **What this does and does not prove.** `assembleLikeVm` is a model of the VM's
 * `CommandBuilder`, so a run holds the assembly rules fixed and varies the types. That is
 * the right split: the assembly rules are two lines that agree with the reference and with
 * the on-chain comments, while type classification is the part that has broken twice. A
 * failure here means the SDK and viem disagree about one type; it does not by itself prove
 * which is right, though viem is very much the likelier of the two.
 *
 * Deterministic by default so a CI failure reproduces: the seed is fixed, printed on
 * failure, and overridable with `FUZZ_SEED`.
 */

const SEED = Number(process.env.FUZZ_SEED ?? 0x5eed)
const ITERATIONS = Number(process.env.FUZZ_ITERATIONS ?? 400)

/** mulberry32 — small, seedable, good enough for shape generation. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const HELPERS = '0x9999999999999999999999999999999999999999' as const

/** Mirrors catalog.ts's grandfathered FLAG_RAW set. */
const LEGACY_RAW = new Set(['(address,uint256)[]', '(address,address)[]'])
const VARIABLE_LENGTH = 0x80
const INDEX_MASK = 0x7f

type Generated = { type: string; value: unknown }

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]!
}

function randomHex(rng: () => number, bytes: number): HexString {
  let out = '0x'
  for (let i = 0; i < bytes; i++) {
    out += Math.floor(rng() * 256)
      .toString(16)
      .padStart(2, '0')
  }
  return out as HexString
}

/** An elementary type plus a value that viem will accept for it. */
function randomElementary(rng: () => number): Generated {
  switch (pick(rng, ['uint', 'int', 'address', 'bool', 'bytesN', 'bytes', 'string'] as const)) {
    case 'uint': {
      const bits = pick(rng, [8, 16, 32, 64, 128, 256])
      const max = (1n << BigInt(bits)) - 1n
      const value = BigInt(Math.floor(rng() * 4096)) % (max + 1n)
      return { type: `uint${bits}`, value }
    }
    case 'int': {
      const bits = pick(rng, [8, 16, 64, 128, 256])
      const magnitude = BigInt(Math.floor(rng() * 1024))
      return { type: `int${bits}`, value: rng() < 0.5 ? magnitude : -magnitude }
    }
    case 'address':
      return { type: 'address', value: randomHex(rng, 20) }
    case 'bool':
      return { type: 'bool', value: rng() < 0.5 }
    case 'bytesN': {
      const size = 1 + Math.floor(rng() * 32)
      return { type: `bytes${size}`, value: randomHex(rng, size) }
    }
    case 'bytes': {
      // Include the boundaries that have bitten before: empty, and an exact word.
      const size = pick(rng, [0, 1, 31, 32, 33, 64])
      return { type: 'bytes', value: randomHex(rng, size) }
    }
    default: {
      const length = Math.floor(rng() * 40)
      return { type: 'string', value: 'x'.repeat(length) }
    }
  }
}

function randomType(rng: () => number, depth: number): Generated {
  if (depth <= 0 || rng() < 0.45) return randomElementary(rng)

  if (rng() < 0.5) {
    // Tuple: 1–4 components.
    const count = 1 + Math.floor(rng() * 4)
    const parts = Array.from({ length: count }, () => randomType(rng, depth - 1))
    return {
      type: `(${parts.map((p) => p.type).join(',')})`,
      value: parts.map((p) => p.value),
    }
  }

  // Array of a single element type, dynamic or fixed length. Fixed arrays start at 1:
  // Solidity rejects `T[0]` outright, so generating it only produces noise. The two
  // degenerate cases it did surface are pinned as explicit tests in calldata.test.ts.
  const element = randomType(rng, depth - 1)
  const length = 1 + Math.floor(rng() * 3)
  const values = Array.from({ length }, () => regenerate(rng, element.type, depth - 1))

  if (rng() < 0.5) {
    // A dynamic array's length is free, so let it be empty sometimes.
    const dynamicValues = rng() < 0.25 ? [] : values
    return { type: `${element.type}[]`, value: dynamicValues }
  }
  // A fixed-size array needs exactly `length` elements.
  return { type: `${element.type}[${length}]`, value: values }
}

/** A fresh value for an already-chosen type, so array elements differ from each other. */
function regenerate(rng: () => number, type: string, depth: number): unknown {
  for (let attempt = 0; attempt < 12; attempt++) {
    const candidate = randomType(rng, depth)
    if (candidate.type === type) return candidate.value
  }
  // Shapes are nested enough that an exact re-roll can miss; fall back to a zero value.
  return zeroValue(type)
}

function zeroValue(type: string): unknown {
  const fixed = /^(.*)\[(\d+)\]$/.exec(type)
  if (fixed) return Array.from({ length: Number(fixed[2]) }, () => zeroValue(fixed[1]!))
  if (type.endsWith('[]')) return []
  if (type.startsWith('(')) {
    // Split the top-level components of a tuple type string.
    const inner = type.slice(1, -1)
    const parts: string[] = []
    let depth = 0
    let current = ''
    for (const ch of inner) {
      if (ch === '(') depth++
      if (ch === ')') depth--
      if (ch === ',' && depth === 0) {
        parts.push(current)
        current = ''
        continue
      }
      current += ch
    }
    if (current) parts.push(current)
    return parts.map(zeroValue)
  }
  if (type === 'bool') return false
  if (type === 'string') return ''
  if (type === 'bytes') return '0x'
  if (type === 'address') return `0x${'00'.repeat(20)}`
  const bytesN = /^bytes(\d+)$/.exec(type)
  if (bytesN) return `0x${'00'.repeat(Number(bytesN[1]))}`
  return 0n
}

function assembleLikeVm(selector: HexString, specifiers: readonly number[], state: readonly HexString[]): HexString {
  let head = ''
  let tail = ''
  for (const specifier of specifiers) {
    const body = state[specifier & INDEX_MASK]!.slice(2)
    if ((specifier & VARIABLE_LENGTH) === VARIABLE_LENGTH) {
      head += (specifiers.length * 32 + tail.length / 2).toString(16).padStart(64, '0')
      tail += body
      continue
    }
    head += body
  }
  return `${selector}${head}${tail}` as HexString
}

function buildWorkflow(parameters: readonly string[]): MarketplaceWorkflow {
  const signature = `function f(${parameters.join(',')})`
  const variables: CatalogVariable[] = [
    { name: 'target', kind: 'pinned' },
    ...parameters.map((_, i) => ({ name: `arg${i}`, kind: 'runtime' as const })),
  ]
  const actions: CatalogTemplate['actions'] = [
    {
      target: '$target',
      selector: signature,
      inputs: parameters.map((parameter, i) => ({ parameter, label: `Arg ${i}`, input: [`$arg${i}`] })),
    },
  ]
  return {
    workflowRef: 'fuzz',
    name: 'fuzz',
    template: 'fuzz',
    chainId: 1,
    variables: { target: HELPERS },
    workflowId: '0x01',
    version: 1,
    templates: { fuzz: { actions, variables } },
    actions,
    runtimeVariables: parameters.map((_, i) => `arg${i}`),
  } as unknown as MarketplaceWorkflow
}

describe('utils/calldata — randomised differential vs viem', () => {
  it(`matches viem over ${ITERATIONS} generated signatures (seed ${SEED})`, () => {
    const rng = makeRng(SEED)
    let compared = 0
    let refusedWideStatic = 0
    let refusedLegacyRaw = 0
    let schemaChecked = 0

    for (let iteration = 0; iteration < ITERATIONS; iteration++) {
      const arity = 1 + Math.floor(rng() * 3)
      const generated = Array.from({ length: arity }, () => randomType(rng, 3))
      const parameters = generated.map((g) => g.type)
      const values = generated.map((g) => g.value)

      // viem has to accept the shape before it can be an oracle for it; a generated type
      // it rejects tells us nothing about the SDK.
      let expected: HexString
      try {
        expected = encodeFunctionData({
          abi: [{ type: 'function', name: 'f', inputs: parameters.map((p) => parseAbiParameter(p)), outputs: [] }],
          functionName: 'f',
          args: values,
        })
      } catch {
        continue
      }

      // A static type that is not exactly one word cannot ride in one slot; the compiler
      // refuses it rather than emitting a head of the wrong length. Assert the refusal
      // instead of the bytes. (This branch is how the fuzz found `T[0]`: zero words, so a
      // slot for it inserts a head word the ABI does not have.)
      const wrongWidthStatic = parameters.some((p) => !isDynamicAbiType(p) && staticHeadWordCount(p) !== 1)
      if (wrongWidthStatic) {
        expect(
          () => buildWorkflowDefinitionFromCatalog(buildWorkflow(parameters)),
          `seed ${SEED} iteration ${iteration}: ${parameters.join(',')}`
        ).to.throw(/cannot be one input|cannot be an input at all/)
        refusedWideStatic++
        continue
      }

      // The two grandfathered types still compile to FLAG_RAW, where a runtime source is
      // refused outright: that slot carries its own selector, so leaving it unpinned would
      // hand the strategist an arbitrary function against a pinned target. Every fuzz
      // argument is runtime, so assert the refusal — free coverage of the security rule.
      const legacyRaw = parameters.some((p) => LEGACY_RAW.has(p))
      if (legacyRaw) {
        expect(
          () => buildWorkflowDefinitionFromCatalog(buildWorkflow(parameters)),
          `seed ${SEED} iteration ${iteration}: ${parameters.join(',')}`
        ).to.throw(/runtime source for raw calldata assembly/)
        refusedLegacyRaw++
        continue
      }

      const context = `seed ${SEED} iteration ${iteration}: function f(${parameters.join(',')})`

      const definition = buildWorkflowDefinitionFromCatalog(buildWorkflow(parameters))

      // The two halves have to agree on how many inputs a signature declares. They did not:
      // `flattenParameter` split every tuple while `encodeInputSpecifier` gave a dynamic one
      // a single slot, so a template could pass validation or emit the right calldata but
      // never both (centrifuge/workflows#105). Assert the loop is closed on every generated
      // shape, not just the ones anyone wrote a case for.
      const signature = `function f(${parameters.join(',')})`
      const declared = parseSelectorParameters(signature)
      expect(declared, `${context}: selector did not parse`).to.not.equal(null)
      expect(declared!.length, `${context}: authoring rule and encoder disagree on arity`).to.equal(
        definition.actions[0]!.inputs.length
      )
      // Where the two agree on the spelling too — the common case — the declaration the
      // encoder accepts must also pass the schema check outright. They can differ without
      // being in conflict: a static tuple wrapping a single leaf, `((int64))`, is one word
      // either way, and the rule asks for the canonical leaf spelling while the encoder is
      // indifferent. That is a naming convention, not the arity contradiction this guards.
      if (declared!.join(',') === parameters.join(',')) {
        expect(
          checkActionSelectorSchema(
            { name: 'f', selector: signature, inputs: parameters.map((parameter) => ({ parameter })) },
            'action "f"'
          ),
          `${context}: the declaration the encoder accepts must also validate`
        ).to.deep.equal([])
        schemaChecked++
      }

      const { state } = buildScript(definition, { poolContext: {}, configurableValues: {} })

      const runtimeValues: Record<string, HexString> = {}
      parameters.forEach((parameter, i) => {
        runtimeValues[`arg${i}`] = isDynamicAbiType(parameter)
          ? encodeVariableLengthValue(parameter, values[i])
          : (encodeAbiParameters([parseAbiParameter(parameter)], [values[i]]) as HexString)
      })

      const filled = fillRuntimeSlots(state, definition, runtimeValues)
      const actual = assembleLikeVm(
        toFunctionSelector(`function f(${parameters.join(',')})`),
        definition.actions[0]!.inputs,
        filled
      )

      expect(actual, context).to.equal(expected)
      compared++
    }

    // A generator that silently stopped producing interesting shapes would pass forever.
    expect(compared, 'fuzz compared almost nothing — the generator or the viem filter regressed').to.be.greaterThan(
      ITERATIONS / 4
    )
    expect(refusedWideStatic, 'fuzz never produced a wide static type — that branch went uncovered').to.be.greaterThan(
      0
    )
    expect(schemaChecked, 'fuzz never ran the schema check — the spelling filter is too tight').to.be.greaterThan(
      ITERATIONS / 8
    )
    void refusedLegacyRaw
  })
})
