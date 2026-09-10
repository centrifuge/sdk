import { expect } from 'chai'
import type { CatalogAction, CatalogTemplate } from '../types/workflow.js'
import { checkRawCalldataTaint } from './workflowRules.js'

/**
 * Randomised property test for the §11 raw-calldata taint rule.
 *
 * **Why this file exists.** The rule tested `input.parameter === 'bytes'`, so it only ever
 * looked at the top level of a type, and a dynamic tuple embedding `bytes` was never
 * inspected — a fully strategist-controlled Midnight `Offer` validated with zero errors
 * (centrifuge/workflows#107). Every test the rule had used `parameter: 'bytes'` literally;
 * not one used a tuple or an array. So the tests encoded the same assumption as the code
 * and would have passed however shallow the check was. Example-based tests written from
 * the implementation's mental model cannot find a case the implementation never imagined,
 * and for a *security* rule that is the wrong way to be wrong.
 *
 * **The oracle, and why it is independent.** The generator builds the type tree and records
 * at construction time whether it emitted a `bytes` node anywhere. The rule under test
 * parses the rendered type string back and walks it. Construction versus parsing are
 * genuinely different code paths, so a predicate that fails to recurse disagrees with the
 * generator's own bookkeeping — which is exactly the class of bug that shipped. A test that
 * re-derived the expectation with the same walker would be tautological.
 *
 * `string` is excluded from generation here. It is variable-length but deliberately outside
 * the rule (a `string` is not re-entered as a nested call), so including it would make
 * `hasBytes` no longer answer the question the rule asks.
 */

const SEED = Number(process.env.FUZZ_SEED ?? 0x7a147)
const ITERATIONS = Number(process.env.FUZZ_ITERATIONS ?? 400)

function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]!
}

/** A generated type, plus whether a `bytes` node was emitted anywhere inside it. */
type GeneratedType = { type: string; hasBytes: boolean }

function randomElementary(rng: () => number): GeneratedType {
  switch (pick(rng, ['uint', 'int', 'address', 'bool', 'bytesN', 'bytes'] as const)) {
    case 'uint':
      return { type: `uint${pick(rng, [8, 32, 128, 256])}`, hasBytes: false }
    case 'int':
      return { type: `int${pick(rng, [8, 64, 256])}`, hasBytes: false }
    case 'address':
      return { type: 'address', hasBytes: false }
    case 'bool':
      return { type: 'bool', hasBytes: false }
    case 'bytesN':
      // Deliberately adjacent to the real thing: `bytes32` is static and must NOT count,
      // and a substring check on the type string would get it wrong.
      return { type: `bytes${1 + Math.floor(rng() * 32)}`, hasBytes: false }
    default:
      return { type: 'bytes', hasBytes: true }
  }
}

function randomType(rng: () => number, depth: number): GeneratedType {
  if (depth <= 0 || rng() < 0.4) return randomElementary(rng)

  if (rng() < 0.55) {
    const parts = Array.from({ length: 1 + Math.floor(rng() * 4) }, () => randomType(rng, depth - 1))
    return {
      type: `(${parts.map((p) => p.type).join(',')})`,
      hasBytes: parts.some((p) => p.hasBytes),
    }
  }

  const element = randomType(rng, depth - 1)
  const suffix = rng() < 0.5 ? '[]' : `[${1 + Math.floor(rng() * 3)}]`
  return { type: `${element.type}${suffix}`, hasBytes: element.hasBytes }
}

function templateWith(parameter: string, kind: 'runtime' | 'configurable'): CatalogTemplate {
  return {
    id: 'p',
    variables: [
      { name: 'target', kind: 'pinned' },
      { name: 'payload', kind },
    ],
    actions: [
      {
        target: '$target',
        name: 'act',
        selector: `function act(${parameter})`,
        inputs: [{ parameter, label: 'Payload', input: ['$payload'] }],
      },
    ] as CatalogAction[],
  } as CatalogTemplate
}

const taint = (parameter: string, kind: 'runtime' | 'configurable') =>
  checkRawCalldataTaint(templateWith(parameter, kind), {
    describe: (action) => `action "${action.name}"`,
  })

describe('utils/workflowRules — randomised taint coverage', () => {
  it(`flags a runtime source iff the type carries bytes, over ${ITERATIONS} generated types (seed ${SEED})`, () => {
    const rng = makeRng(SEED)
    let withBytes = 0
    let withoutBytes = 0

    for (let iteration = 0; iteration < ITERATIONS; iteration++) {
      const { type, hasBytes } = randomType(rng, 3)
      const context = `seed ${SEED} iteration ${iteration}: ${type}`

      const violations = taint(type, 'runtime')
      expect(
        violations.length > 0,
        hasBytes
          ? `${context}: carries bytes but taint did not flag a runtime source`
          : `${context}: carries no bytes but taint flagged it`
      ).to.equal(hasBytes)

      if (hasBytes) withBytes++
      else withoutBytes++
    }

    // Both arms have to be exercised, or a predicate stuck on one answer would pass.
    expect(withBytes, 'generator produced no bytes-carrying types').to.be.greaterThan(ITERATIONS / 10)
    expect(withoutBytes, 'generator produced only bytes-carrying types').to.be.greaterThan(ITERATIONS / 10)
  })

  it(`never flags a hub-manager-set value, whatever its shape (seed ${SEED})`, () => {
    // Taint is about the strategist. A configurable value is trusted at any depth, so a
    // predicate that started keying off shape alone rather than origin would show up here.
    const rng = makeRng(SEED ^ 0xffff)
    for (let iteration = 0; iteration < ITERATIONS; iteration++) {
      const { type } = randomType(rng, 3)
      expect(taint(type, 'configurable'), `seed ${SEED} iteration ${iteration}: ${type}`).to.deep.equal([])
    }
  })
})
