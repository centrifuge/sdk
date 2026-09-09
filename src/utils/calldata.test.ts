import { expect } from 'chai'
import {
  decodeAbiParameters,
  encodeAbiParameters,
  encodeFunctionData,
  parseAbiParameter,
  toFunctionSelector,
} from 'viem'
import type { HexString } from '../types/index.js'
import type { CatalogTemplate, CatalogVariable, MarketplaceWorkflow } from '../types/workflow.js'
import { buildWorkflowDefinitionFromCatalog } from './catalog.js'
import { buildScript, encodeVariableLengthValue, fillRuntimeSlots, isDynamicAbiType } from './weiroll.js'

/**
 * Differential test: the calldata the VM will assemble, against viem's encoding of the
 * same call.
 *
 * The classification tests next door assert which specifier a parameter gets. That only
 * catches a shape somebody thought to list — and the bugs this file exists for were
 * precisely the shapes nobody listed. `(address,bytes)` was classified static and emitted
 * one word where an offset and tail belong; Midnight's `Offer` was classified
 * inconsistently by two modules. Both produced calldata for a different call than the one
 * reviewed, and every existing test passed.
 *
 * So assert the property instead of the enumeration: for any parameter list, splice the
 * state slots the way weiroll's `CommandBuilder` does and require the result to equal what
 * viem produces. Any misclassification shows up as a byte difference, whether or not the
 * shape was foreseen.
 *
 * The model below is the part to be sceptical of — it is this file's understanding of the
 * VM, not the VM. It is kept to the two rules the SDK documents (a 0x80 slot is copied
 * verbatim into the tail behind a head offset; any other slot is one head word) and is
 * anchored by the shapes already known to execute correctly on-chain: `bytes`, and the
 * tuple arrays the published catalog has been running through FLAG_RAW and 0x80.
 */

const ADDRESS_A = '0x1111111111111111111111111111111111111111' as const
const ADDRESS_B = '0x2222222222222222222222222222222222222222' as const
const BYTES32_A = `0x${'ab'.repeat(32)}` as const

const HELPERS = '0x9999999999999999999999999999999999999999' as const

/** One weiroll input specifier: the high bit marks a variable-length slot. */
const VARIABLE_LENGTH = 0x80
const INDEX_MASK = 0x7f

/**
 * Reproduces `CommandBuilder.buildInputs` for a single action.
 *
 * Head is one word per input specifier. A variable-length specifier contributes an offset
 * word pointing into the tail, measured from the start of the argument block, and its slot
 * is appended to the tail byte-for-byte. Every other specifier contributes its slot's
 * single word inline.
 */
function assembleLikeVm(selector: HexString, specifiers: readonly number[], state: readonly HexString[]): HexString {
  const headWords = specifiers.length
  let head = ''
  let tail = ''

  for (const specifier of specifiers) {
    const slot = state[specifier & INDEX_MASK]
    if (slot === undefined) throw new Error(`assembleLikeVm: no state for slot ${specifier & INDEX_MASK}`)
    const body = slot.slice(2)

    if ((specifier & VARIABLE_LENGTH) === VARIABLE_LENGTH) {
      const offset = headWords * 32 + tail.length / 2
      head += offset.toString(16).padStart(64, '0')
      tail += body
      continue
    }

    if (body.length !== 64) {
      throw new Error(`assembleLikeVm: static slot is ${body.length / 2} bytes, expected 32`)
    }
    head += body
  }

  return `${selector}${head}${tail}` as HexString
}

function tagged(
  parameters: readonly string[],
  actionName = 'f'
): { workflow: MarketplaceWorkflow; selector: HexString; signature: string } {
  const signature = `function ${actionName}(${parameters.join(',')})`
  const variables: CatalogVariable[] = [
    { name: 'target', kind: 'pinned' },
    ...parameters.map((_, i) => ({ name: `arg${i}`, kind: 'runtime' as const })),
  ]
  const actions: CatalogTemplate['actions'] = [
    {
      target: '$target',
      selector: signature,
      inputs: parameters.map((parameter, i) => ({
        parameter,
        label: `Arg ${i}`,
        input: [`$arg${i}`],
      })),
    },
  ]

  return {
    signature,
    selector: toFunctionSelector(signature),
    workflow: {
      workflowRef: 'diff',
      name: 'diff',
      template: 'diff',
      chainId: 1,
      variables: { target: HELPERS },
      workflowId: '0x01',
      version: 1,
      templates: { diff: { actions, variables } },
      actions,
      runtimeVariables: parameters.map((_, i) => `arg${i}`),
    } as unknown as MarketplaceWorkflow,
  }
}

/** Encodes one argument the way a caller must fill its runtime slot. */
function encodeSlot(parameter: string, value: unknown): HexString {
  if (isDynamicAbiType(parameter)) return encodeVariableLengthValue(parameter, value)
  return encodeAbiParameters([parseAbiParameter(parameter)], [value]) as HexString
}

describe('utils/calldata — VM assembly vs viem', () => {
  const cases: Array<{ name: string; parameters: string[]; values: unknown[] }> = [
    { name: 'a single static word', parameters: ['uint256'], values: [123n] },
    { name: 'several static words', parameters: ['address', 'uint256', 'bool'], values: [ADDRESS_A, 7n, true] },
    { name: 'bytes', parameters: ['bytes'], values: ['0xdeadbeef'] },
    { name: 'empty bytes', parameters: ['bytes'], values: ['0x'] },
    { name: 'bytes that exactly fills a word', parameters: ['bytes'], values: [`0x${'cd'.repeat(32)}`] },
    { name: 'string', parameters: ['string'], values: ['hello weiroll'] },
    { name: 'a dynamic array', parameters: ['uint256[]'], values: [[1n, 2n, 3n]] },
    { name: 'an empty dynamic array', parameters: ['uint256[]'], values: [[]] },
    {
      name: 'a tuple array',
      parameters: ['(address,uint256,uint256,address)[]'],
      values: [
        [
          [ADDRESS_A, 1n, 2n, ADDRESS_B],
          [ADDRESS_B, 3n, 4n, ADDRESS_A],
        ],
      ],
    },
    // The bug: dynamic tuple with no array member. Classified static before the fix.
    { name: 'a dynamic tuple with no array member', parameters: ['(address,bytes)'], values: [[ADDRESS_A, '0xbeef']] },
    { name: 'a dynamic tuple ending in string', parameters: ['(uint256,string)'], values: [[9n, 'hi']] },
    // The other bug: contains "[]" but ends in ")", which split the two old predicates.
    {
      name: "Midnight's Offer",
      parameters: [
        '((uint256,address,address,(address,uint256,uint256,address)[],uint256,uint256,address,address),bool,address,uint256,uint256,uint256,bytes32,address,bytes,address,address,bool,uint128,uint128,uint256)',
      ],
      values: [
        [
          [1n, ADDRESS_A, ADDRESS_B, [[ADDRESS_A, 8n, 9n, ADDRESS_B]], 10n, 11n, ADDRESS_A, ADDRESS_B],
          true,
          ADDRESS_A,
          12n,
          13n,
          14n,
          BYTES32_A,
          ADDRESS_B,
          '0x',
          ADDRESS_A,
          ADDRESS_B,
          false,
          15n,
          16n,
          17n,
        ],
      ],
    },
    // Mixing matters: a static argument after a dynamic one is where a wrong head word
    // shifts everything, and where a single-word assumption shows up as a bad offset.
    {
      name: 'static before and after a dynamic',
      parameters: ['address', 'bytes', 'uint256'],
      values: [ADDRESS_A, '0xbeefbeef', 42n],
    },
    {
      name: 'two dynamics in a row',
      parameters: ['bytes', 'uint256[]'],
      values: ['0xbe', [5n, 6n]],
    },
    {
      name: 'a dynamic tuple between statics',
      parameters: ['uint256', '(address,bytes)', 'address'],
      values: [1n, [ADDRESS_B, '0xcafe'], ADDRESS_A],
    },
  ]

  for (const { name, parameters, values } of cases) {
    it(`matches viem for ${name}`, () => {
      const { workflow, selector, signature } = tagged(parameters)
      const definition = buildWorkflowDefinitionFromCatalog(workflow)
      const { state } = buildScript(definition, { poolContext: {}, configurableValues: {} })

      const runtimeValues: Record<string, HexString> = {}
      parameters.forEach((parameter, i) => {
        runtimeValues[`arg${i}`] = encodeSlot(parameter, values[i])
      })
      const filled = fillRuntimeSlots(state, definition, runtimeValues)

      const actual = assembleLikeVm(selector, definition.actions[0]!.inputs, filled)

      const expected = encodeFunctionData({
        abi: [
          {
            type: 'function',
            name: 'f',
            inputs: parameters.map((p) => parseAbiParameter(p)),
            outputs: [],
          },
        ],
        functionName: 'f',
        args: values,
      })

      expect(actual, signature).to.equal(expected)
    })
  }

  it('refuses a static parameter too wide for one slot instead of emitting a short head', () => {
    // `(address,uint256)` inlines two words. One slot holds one, so the head would be a
    // word short and every argument after it would shift — the same silent corruption,
    // reached from the static side. The catalog convention flattens these; enforce it.
    const { workflow } = tagged(['(address,uint256)'])
    expect(() => buildWorkflowDefinitionFromCatalog(workflow)).to.throw(
      /occupies 2 words and cannot be one input — flatten it/
    )

    const fixedArray = tagged(['bytes32[3]'])
    expect(() => buildWorkflowDefinitionFromCatalog(fixedArray.workflow)).to.throw(/occupies 3 words/)
  })

  it('flattening a static tuple is ABI-identical, which is why the convention is sound', () => {
    // The control for the rule above: a static tuple is inlined with no offset, so one
    // input per leaf encodes to the same bytes as the nested form. This is what makes
    // flattening a fix rather than a workaround — and it is exactly what does NOT hold
    // for a dynamic tuple, which is why those must stay atomic behind a 0x80 slot.
    const flat = tagged(['address', 'uint256'])
    const definition = buildWorkflowDefinitionFromCatalog(flat.workflow)
    const { state } = buildScript(definition, { poolContext: {}, configurableValues: {} })
    const filled = fillRuntimeSlots(state, definition, {
      arg0: encodeSlot('address', ADDRESS_A),
      arg1: encodeSlot('uint256', 5n),
    })

    const assembled = assembleLikeVm(flat.selector, definition.actions[0]!.inputs, filled)
    const nested = encodeAbiParameters([parseAbiParameter('(address,uint256)')], [[ADDRESS_A, 5n]])

    expect(assembled).to.equal(`${flat.selector}${nested.slice(2)}`)
  })
})

/**
 * The other live encoding path.
 *
 * The two grandfathered tuple arrays still compile to FLAG_RAW, where the whole call —
 * selector included — is assembled off-chain into one state slot instead of being spliced
 * by the VM. It is a completely separate code path from the head/tail assembly above, it
 * is what every guarded workflow in the published catalog runs on, and it was covered only
 * by shape assertions. Compare its bytes to viem too.
 */
describe('utils/calldata — FLAG_RAW assembly vs viem', () => {
  const rawCases: Array<{ name: string; parameter: string; value: unknown }> = [
    {
      name: '(address,uint256)[] — the slippage guard shape',
      parameter: '(address,uint256)[]',
      value: [
        [ADDRESS_A, 1000n],
        [ADDRESS_B, 2500n],
      ],
    },
    {
      name: '(address,address)[] — the approval guard shape',
      parameter: '(address,address)[]',
      value: [[ADDRESS_A, ADDRESS_B]],
    },
    {
      name: 'an empty pair list',
      parameter: '(address,uint256)[]',
      value: [],
    },
  ]

  for (const { name, parameter, value } of rawCases) {
    it(`matches viem for ${name}`, () => {
      const signature = `function g(${parameter})`
      const actions: CatalogTemplate['actions'] = [
        {
          target: '$target',
          selector: signature,
          inputs: [{ parameter, label: 'Pairs', input: ['$pairs'] }],
        },
      ]
      // Configurable, not pinned: that is how the guards' `allowancePairs` and
      // `slippageAssets` actually reach a script — the hub manager sets them at
      // policy-creation time and they arrive already ABI-encoded.
      const workflow = {
        workflowRef: 'raw',
        name: 'raw',
        template: 'raw',
        chainId: 1,
        variables: { target: HELPERS },
        workflowId: '0x01',
        version: 1,
        templates: {
          raw: {
            actions,
            variables: [
              { name: 'target', kind: 'pinned' },
              { name: 'pairs', kind: 'configurable' },
            ] as CatalogVariable[],
          },
        },
        actions,
        runtimeVariables: [],
      } as unknown as MarketplaceWorkflow

      const definition = buildWorkflowDefinitionFromCatalog(workflow)
      expect(definition.actions[0]!.rawMode, 'expected the FLAG_RAW path').to.equal(true)

      const { state } = buildScript(definition, {
        poolContext: {},
        configurableValues: {
          pairs: encodeAbiParameters([parseAbiParameter(parameter)], [value]) as HexString,
        },
      })

      const rawIndex = definition.state.findIndex((slot) => slot.type === 'rawcalldata')
      expect(rawIndex, 'no rawcalldata slot was allocated').to.be.greaterThan(-1)

      // FLAG_RAW hands the target the slot verbatim, so the slot IS the calldata.
      const expected = encodeFunctionData({
        abi: [{ type: 'function', name: 'g', inputs: [parseAbiParameter(parameter)], outputs: [] }],
        functionName: 'g',
        args: [value],
      })
      expect(state[rawIndex]).to.equal(expected)
    })
  }
})

/**
 * Round-trip: a catalog literal, through the slot encoding, back to the value.
 *
 * `encodeLiteralValue` writes the form a slot must hold and `decodeWorkflowValue` reads it
 * back for FLAG_RAW assembly, and the two have to agree for every type a catalog can
 * spell. The pairing is easy to break one side at a time — the `bytes` inner form already
 * needs a special case in the decoder — so assert the pair, not each half.
 */
describe('utils/calldata — literal round-trip', () => {
  const literals: Array<{ parameter: string; literal: string; value: unknown }> = [
    { parameter: 'uint256', literal: '1000000000000000000', value: 1000000000000000000n },
    { parameter: 'uint256', literal: '0', value: 0n },
    // Past 2^53: the reason catalog integers are decimal strings rather than JSON numbers.
    {
      parameter: 'uint256',
      literal: '115792089237316195423570985008687907853269984665640564039457584007913129639935',
      value: 2n ** 256n - 1n,
    },
    { parameter: 'address', literal: ADDRESS_A, value: ADDRESS_A },
    { parameter: 'bool', literal: 'true', value: true },
    { parameter: 'bool', literal: 'false', value: false },
    { parameter: 'bytes32', literal: BYTES32_A, value: BYTES32_A },
    { parameter: 'bytes', literal: '0xdeadbeef', value: '0xdeadbeef' },
    { parameter: 'bytes', literal: '0x', value: '0x' },
    { parameter: 'string', literal: 'a plain string', value: 'a plain string' },
    { parameter: 'uint256[]', literal: '["1","2","3"]', value: [1n, 2n, 3n] },
    {
      parameter: '(address,uint256,uint256,address)[]',
      literal: `[["${ADDRESS_A}", "1", "2", "${ADDRESS_B}"]]`,
      value: [[ADDRESS_A, 1n, 2n, ADDRESS_B]],
    },
    {
      parameter: '(address,bytes)',
      literal: `["${ADDRESS_A}", "0xc0ffee"]`,
      value: [ADDRESS_A, '0xc0ffee'],
    },
  ]

  for (const { parameter, literal, value } of literals) {
    it(`${parameter} survives encode → decode`, () => {
      const signature = `function h(${parameter})`
      const actions: CatalogTemplate['actions'] = [
        { target: '$target', selector: signature, inputs: [{ parameter, label: 'V', input: ['$v'] }] },
      ]
      const workflow = {
        workflowRef: 'lit',
        name: 'lit',
        template: 'lit',
        chainId: 1,
        variables: { target: HELPERS, v: literal },
        workflowId: '0x01',
        version: 1,
        templates: {
          lit: {
            actions,
            variables: [
              { name: 'target', kind: 'pinned' },
              { name: 'v', kind: 'pinned' },
            ] as CatalogVariable[],
          },
        },
        actions,
        runtimeVariables: [],
      } as unknown as MarketplaceWorkflow

      const definition = buildWorkflowDefinitionFromCatalog(workflow)
      const slot = definition.state.find((s) => s.type === 'literal') as { value: HexString } | undefined
      expect(slot, 'expected a pinned literal slot').to.not.equal(undefined)

      // A dynamic slot holds the inner encoding, so restore the offset word viem expects;
      // a static slot is already the standalone encoding of one word.
      const standalone = isDynamicAbiType(parameter)
        ? (`0x${(32).toString(16).padStart(64, '0')}${slot!.value.slice(2)}` as HexString)
        : slot!.value

      const [decoded] = decodeAbiParameters([parseAbiParameter(parameter)], standalone)
      expect(decoded).to.deep.equal(value)
    })
  }
})
