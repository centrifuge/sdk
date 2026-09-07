import { expect } from 'chai'
import { of } from 'rxjs'
import { decodeAbiParameters } from 'viem'
import type { Centrifuge } from '../Centrifuge.js'
import type { PoolNetwork } from '../entities/PoolNetwork.js'
import type { MarketplaceWorkflow } from '../types/workflow.js'
import {
  applyWorkflowExclusions,
  buildPreparedWorkflowDefinition,
  computeWorkflowGroupScriptHashes,
  computeWorkflowScriptHash,
  encodeConfigurableValue,
  encodeWorkflowInputValue,
  isWorkflowInputOptional,
  resolveWorkflowPoolContext,
  resolveWorkflowShareClassId,
} from './workflowExecute.js'

const ADDRESS_A = '0x1111111111111111111111111111111111111111' as const
const ADDRESS_B = '0x2222222222222222222222222222222222222222' as const

/** Minimal workflow whose actions carry the given `optional` flags. */
function workflowWithActions(optionalFlags: boolean[]): MarketplaceWorkflow {
  return {
    workflowRef: 'wf',
    name: 'WF',
    template: 't',
    chainId: 1,
    variables: {},
    workflowId: `0x${'0'.repeat(64)}`,
    version: 1,
    actions: optionalFlags.map((optional, i) => ({
      target: '$spoke',
      selector: `function a${i}()`,
      inputs: [],
      optional,
    })),
  } as unknown as MarketplaceWorkflow
}

describe('utils/workflowExecute', () => {
  describe('encodeWorkflowInputValue', () => {
    it('encodes integer types', () => {
      const encoded = encodeWorkflowInputValue('uint256', '100')
      expect(encoded).to.match(/^0x[0-9a-f]{64}$/)
      expect(decodeAbiParameters([{ type: 'uint256' }], encoded)[0]).to.equal(100n)
      // uint128 (and other widths) go through the same path
      expect(decodeAbiParameters([{ type: 'uint128' }], encodeWorkflowInputValue('uint128', '42'))[0]).to.equal(42n)
    })

    it('encodes addresses (case-insensitive)', () => {
      const encoded = encodeWorkflowInputValue('address', ADDRESS_A)
      expect((decodeAbiParameters([{ type: 'address' }], encoded)[0] as string).toLowerCase()).to.equal(ADDRESS_A)
    })

    it('rejects a non-address for an address parameter', () => {
      expect(() => encodeWorkflowInputValue('address', 'not-an-address')).to.throw()
    })

    it('encodes booleans', () => {
      expect(decodeAbiParameters([{ type: 'bool' }], encodeWorkflowInputValue('bool', 'true'))[0]).to.equal(true)
      expect(decodeAbiParameters([{ type: 'bool' }], encodeWorkflowInputValue('bool', 'false'))[0]).to.equal(false)
      expect(() => encodeWorkflowInputValue('bool', 'yes')).to.throw()
    })

    it('encodes fixed bytes and rejects the wrong length', () => {
      const value = `0x${'ab'.repeat(32)}`
      expect(decodeAbiParameters([{ type: 'bytes32' }], encodeWorkflowInputValue('bytes32', value))[0]).to.equal(value)
      expect(() => encodeWorkflowInputValue('bytes32', '0xabcd')).to.throw()
    })

    it('encodes an (address,uint256)[] from newline-separated lines', () => {
      const encoded = encodeWorkflowInputValue('(address,uint256)[]', `${ADDRESS_A}, 1\n${ADDRESS_B}, 2`)
      const [tuples] = decodeAbiParameters(
        [{ type: 'tuple[]', components: [{ type: 'address' }, { type: 'uint256' }] }],
        encoded
      ) as unknown as [Array<{ 0: string; 1: bigint }>]
      expect(tuples).to.have.length(2)
      expect((tuples[0]![0] as string).toLowerCase()).to.equal(ADDRESS_A)
      expect(tuples[1]![1]).to.equal(2n)
    })

    it('encodes an (address,address)[]', () => {
      const encoded = encodeWorkflowInputValue('(address,address)[]', `${ADDRESS_A}, ${ADDRESS_B}`)
      const [tuples] = decodeAbiParameters(
        [{ type: 'tuple[]', components: [{ type: 'address' }, { type: 'address' }] }],
        encoded
      ) as unknown as [Array<{ 0: string; 1: string }>]
      expect(tuples).to.have.length(1)
      expect((tuples[0]![1] as string).toLowerCase()).to.equal(ADDRESS_B)
    })

    it('treats array types as optional (empty value encodes an empty array)', () => {
      const encoded = encodeWorkflowInputValue('(address,uint256)[]', '')
      const [tuples] = decodeAbiParameters(
        [{ type: 'tuple[]', components: [{ type: 'address' }, { type: 'uint256' }] }],
        encoded
      ) as unknown as [unknown[]]
      expect(tuples).to.have.length(0)
    })

    it('throws on a missing value for a required (non-array) parameter', () => {
      expect(() => encodeWorkflowInputValue('uint256', '')).to.throw(/Missing value/)
    })

    it('throws on an unsupported parameter type', () => {
      expect(() => encodeWorkflowInputValue('string', 'hello')).to.throw(/Unsupported/)
    })

    it('exposes encodeConfigurableValue as an alias', () => {
      expect(encodeConfigurableValue).to.equal(encodeWorkflowInputValue)
    })
  })

  describe('isWorkflowInputOptional', () => {
    it('is true only for the array tuple types', () => {
      expect(isWorkflowInputOptional('(address,uint256)[]')).to.equal(true)
      expect(isWorkflowInputOptional('(address,address)[]')).to.equal(true)
      expect(isWorkflowInputOptional('uint256')).to.equal(false)
      expect(isWorkflowInputOptional('address')).to.equal(false)
    })
  })

  describe('applyWorkflowExclusions', () => {
    it('returns the same workflow when nothing is excluded', () => {
      const wf = workflowWithActions([true, false, true])
      expect(applyWorkflowExclusions(wf, [])).to.equal(wf)
      expect(applyWorkflowExclusions(wf).actions).to.have.length(3)
    })

    it('drops an excluded optional action', () => {
      const wf = workflowWithActions([true, false, true])
      const result = applyWorkflowExclusions(wf, [0])
      expect(result.actions).to.have.length(2)
      expect(result.actions.map((a) => a.selector)).to.deep.equal(['function a1()', 'function a2()'])
      // does not mutate the input
      expect(wf.actions).to.have.length(3)
    })

    it('drops multiple optional actions regardless of input order', () => {
      const wf = workflowWithActions([true, false, true])
      const result = applyWorkflowExclusions(wf, [2, 0])
      expect(result.actions.map((a) => a.selector)).to.deep.equal(['function a1()'])
    })

    it('throws when excluding a non-optional action', () => {
      expect(() => applyWorkflowExclusions(workflowWithActions([true, false]), [1])).to.throw(/not optional/)
    })

    it('throws on an out-of-range or negative index', () => {
      expect(() => applyWorkflowExclusions(workflowWithActions([true]), [5])).to.throw(/invalid action index/)
      expect(() => applyWorkflowExclusions(workflowWithActions([true]), [-1])).to.throw(/invalid action index/)
    })

    it('throws when the same action is excluded twice', () => {
      expect(() => applyWorkflowExclusions(workflowWithActions([true, true]), [0, 0])).to.throw(/more than once/)
    })
  })

  // ── The orchestration layer ───────────────────────────────────────────────
  //
  // These build the leaves of a strategist's Merkle policy: `computeScriptHash` over the compiled
  // script is exactly what `OnchainPM.execute` checks its proof against. They're exercised here
  // against fakes rather than a fork, because what needs locking down is the compilation and the
  // failure behaviour, not the RPC plumbing.

  /** A workflow needing no magic variables, so the pool context resolves without any chain access. */
  function selfContainedWorkflow(overrides: Partial<MarketplaceWorkflow> = {}): MarketplaceWorkflow {
    return {
      workflowRef: 'self_contained',
      name: 'Self contained',
      template: 't',
      chainId: 1,
      variables: { target: ADDRESS_A },
      workflowId: `0x${'0'.repeat(64)}`,
      version: 1,
      actions: [
        {
          target: '$target',
          selector: 'function poke(uint256 amount)',
          inputs: [{ parameter: 'amount', label: 'Amount', input: ['$slippageAmount'] }],
        },
      ],
      templates: {
        t: {
          variables: [{ name: 'slippageAmount', kind: 'configurable' }],
          actions: [],
        },
      },
      ...overrides,
    } as unknown as MarketplaceWorkflow
  }

  const CONFIGURABLE = { slippageAmount: `0x${'0'.repeat(63)}1` as const }

  /** `chai-as-promised` isn't wired into this runner, so assert rejections directly. */
  async function rejects(promise: Promise<unknown>, pattern?: RegExp) {
    try {
      await promise
    } catch (error) {
      if (pattern) expect((error as Error).message).to.match(pattern)
      return
    }
    expect.fail('expected the promise to reject')
  }

  /** Throws if touched: proves the self-contained path needs no chain access at all. */
  const unreachableCentrifuge = new Proxy(
    {},
    {
      get(_target, key) {
        throw new Error(`centrifuge.${String(key)} must not be reached for a magic-free workflow`)
      },
    }
  ) as Centrifuge

  const fakeNetwork = (shareClassIds: string[]): PoolNetwork =>
    ({
      centrifugeId: 1,
      pool: { id: { raw: 1n, toString: () => '1' }, centrifugeId: 1 },
      details: () => of({ activeShareClasses: shareClassIds.map((raw) => ({ id: { raw } })) }),
    }) as unknown as PoolNetwork

  describe('buildPreparedWorkflowDefinition', () => {
    /** Like `workflowWithActions`, but with a declared target so the definition actually compiles. */
    const compilable = (optionalFlags: boolean[]) =>
      selfContainedWorkflow({
        actions: optionalFlags.map((optional, i) => ({
          target: '$target',
          selector: `function a${i}()`,
          inputs: [],
          optional,
        })),
      } as Partial<MarketplaceWorkflow>)

    it('compiles a workflow into a definition and reports the normalized exclusions', () => {
      const { workflow, workflowDef, excludedActions } = buildPreparedWorkflowDefinition(
        compilable([true, false, true]),
        [2, 0]
      )
      expect(excludedActions).to.deep.equal([0, 2])
      expect(workflow.actions).to.have.length(1)
      expect(workflowDef.actions).to.have.length(1)
    })

    it('leaves the workflow untouched when nothing is excluded', () => {
      const wf = compilable([true, true])
      const { workflow, excludedActions } = buildPreparedWorkflowDefinition(wf)
      expect(excludedActions).to.deep.equal([])
      expect(workflow).to.equal(wf)
    })
  })

  describe('resolveWorkflowShareClassId', () => {
    it('returns an explicitly supplied share class without touching the network', async () => {
      const network = {
        details: () => {
          throw new Error('must not query')
        },
      } as unknown as PoolNetwork
      expect(await resolveWorkflowShareClassId(network, '0xabc')).to.equal('0xabc')
    })

    it("resolves the pool's single active share class", async () => {
      expect(await resolveWorkflowShareClassId(fakeNetwork(['0xsc1']))).to.equal('0xsc1')
    })

    it('throws when the pool has no active share class', async () => {
      await rejects(resolveWorkflowShareClassId(fakeNetwork([])), /No active share classes/)
    })

    it('refuses to guess between several share classes', async () => {
      // Guessing would silently build the policy against the wrong share class.
      await rejects(resolveWorkflowShareClassId(fakeNetwork(['0xsc1', '0xsc2'])), /share class/)
    })
  })

  describe('resolveWorkflowPoolContext', () => {
    it('returns an empty context, with no chain access, when no magic variables are needed', async () => {
      const workflow = selfContainedWorkflow()
      const { workflowDef } = buildPreparedWorkflowDefinition(workflow)
      const { poolContext, resolvedScId } = await resolveWorkflowPoolContext({
        centrifuge: unreachableCentrifuge,
        network: fakeNetwork(['0xsc1']),
        workflowDef,
        workflow,
        strategist: ADDRESS_B,
      })
      expect(poolContext).to.deep.equal({})
      expect(resolvedScId).to.equal(undefined)
    })
  })

  describe('computeWorkflowScriptHash', () => {
    it('computes a deterministic 32-byte leaf', async () => {
      const args = {
        centrifuge: unreachableCentrifuge,
        network: fakeNetwork(['0xsc1']),
        workflow: selfContainedWorkflow(),
        strategist: ADDRESS_B,
        configurableValues: CONFIGURABLE,
      }
      const first = await computeWorkflowScriptHash(args)
      const second = await computeWorkflowScriptHash(args)
      expect(first.scriptHash).to.match(/^0x[0-9a-f]{64}$/)
      // The leaf must be a pure function of the script: the same inputs cannot produce two roots.
      expect(second.scriptHash).to.equal(first.scriptHash)
    })

    it('changes the leaf when a pinned configurable value changes', async () => {
      const base = {
        centrifuge: unreachableCentrifuge,
        network: fakeNetwork(['0xsc1']),
        workflow: selfContainedWorkflow(),
        strategist: ADDRESS_B,
      }
      const a = await computeWorkflowScriptHash({ ...base, configurableValues: CONFIGURABLE })
      const b = await computeWorkflowScriptHash({
        ...base,
        configurableValues: { slippageAmount: `0x${'0'.repeat(62)}99` },
      })
      // A manager-pinned value that did not move the leaf would be a value outside the proof.
      expect(b.scriptHash).to.not.equal(a.scriptHash)
    })
  })

  describe('computeWorkflowGroupScriptHashes', () => {
    it('returns one leaf per policy entry, in order', async () => {
      const hashes = await computeWorkflowGroupScriptHashes({
        centrifuge: unreachableCentrifuge,
        network: fakeNetwork(['0xsc1']),
        strategist: ADDRESS_B,
        policy: [
          { workflow: selfContainedWorkflow(), configurableValues: CONFIGURABLE },
          { workflow: selfContainedWorkflow({ variables: { target: ADDRESS_B } }), configurableValues: CONFIGURABLE },
        ],
      })
      expect(hashes).to.have.length(2)
      hashes.forEach((hash) => expect(hash).to.match(/^0x[0-9a-f]{64}$/))
      expect(hashes[0]).to.not.equal(hashes[1])
    })

    it('propagates a build failure instead of substituting the catalog workflowId', async () => {
      // The removed fallback put an unverified 64-hex value from catalog JSON into the leaf that
      // `OnchainPM.execute` proves against, so any build failure authorized whatever calldata the
      // catalog author chose. A build failure has to stay fatal.
      const broken = selfContainedWorkflow({
        actions: [{ target: '$missingTarget', selector: 'function poke(uint256)', inputs: [] }],
      } as Partial<MarketplaceWorkflow>)
      await rejects(
        computeWorkflowGroupScriptHashes({
          centrifuge: unreachableCentrifuge,
          network: fakeNetwork(['0xsc1']),
          strategist: ADDRESS_B,
          policy: [{ workflow: broken, configurableValues: {} }],
        })
      )
    })
  })
})
