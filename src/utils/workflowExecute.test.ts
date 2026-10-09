import { SimpleMerkleTree } from '@openzeppelin/merkle-tree'
import { expect } from 'chai'
import sinon from 'sinon'
import { of } from 'rxjs'
import { ContractFunctionRevertedError, decodeAbiParameters, encodeErrorResult, toFunctionSelector } from 'viem'
import { ABI } from '../abi/index.js'
import type { Centrifuge } from '../Centrifuge.js'
import type { PoolNetwork } from '../entities/PoolNetwork.js'
import type { MarketplaceWorkflow } from '../types/workflow.js'
import { toAccountingTokenId } from './accountingToken.js'
import { MessageType } from '../types/transaction.js'
import { computeScriptHash } from './scriptHash.js'
import { AssetId, PoolId, ShareClassId } from './types.js'
import {
  applyWorkflowExclusions,
  buildPreparedWorkflowDefinition,
  buildWorkflowScriptBase,
  buildWorkflowExecuteParams,
  estimateWorkflowExecutionValue,
  computeWorkflowGroupScriptDetails,
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

  describe('buildWorkflowScriptBase', () => {
    it('builds the prepared workflow, commands and pinned state with the resolved pool context', async () => {
      const poolId = PoolId.from(1, 15)
      const scId = ShareClassId.from(poolId, 1)
      const network = {
        centrifugeId: 13,
        pool: { id: poolId, centrifugeId: 1 },
        onchainPM: () => of(null),
        details: () => of({ activeShareClasses: [{ id: scId }] }),
      } as unknown as PoolNetwork
      const readContract = sinon.stub().resolves(ADDRESS_B)
      const getClient = sinon.stub().returns(of({ readContract }))
      const protocolContext = sinon.stub().returns(of({ onchainPMFactory: ADDRESS_A }))
      const centrifuge = { getClient, _protocolAddresses: protocolContext } as unknown as Centrifuge
      const workflow = selfContainedWorkflow({
        actions: [
          {
            target: '$target',
            selector: 'function poke(bytes16 scId, address executor, uint256 amount)',
            inputs: [
              { parameter: 'scId', label: 'Share class', input: ['$scId'] },
              { parameter: 'executor', label: 'Executor', input: ['$onchainPM'] },
              { parameter: 'amount', label: 'Amount', input: ['$slippageAmount'] },
            ],
          },
          { target: '$target', selector: 'function optionalAction()', inputs: [], optional: true },
        ],
      } as Partial<MarketplaceWorkflow>)

      const result = await buildWorkflowScriptBase({
        centrifuge,
        network,
        workflow,
        strategist: ADDRESS_B,
        configurableValues: CONFIGURABLE,
        excludedActions: [1],
      })

      expect(result).to.have.all.keys(
        'workflow',
        'workflowDef',
        'commands',
        'state',
        'stateBitmap',
        'poolContext',
        'resolvedScId'
      )
      expect(result.workflow).to.deep.equal({ ...workflow, actions: [workflow.actions[0]] })
      expect(workflow.actions).to.have.length(2)
      expect(result.workflowDef.workflowRef).to.equal(workflow.workflowRef)
      expect(result.workflowDef.actions).to.have.length(1)
      expect(result.commands).to.deep.equal([
        `${toFunctionSelector('poke(bytes16,address,uint256)')}01000102ffffffff${ADDRESS_A.slice(2)}`,
      ])
      const encodedScId = encodeWorkflowInputValue('bytes16', scId.raw)
      const encodedExecutor = encodeWorkflowInputValue('address', ADDRESS_B)
      expect(result.state).to.deep.equal([encodedScId, encodedExecutor, CONFIGURABLE.slippageAmount])
      expect(result.stateBitmap).to.equal(0b111n)
      expect(result.poolContext).to.deep.equal({ $scId: encodedScId, $onchainPM: encodedExecutor })
      expect(result.resolvedScId).to.equal(scId.raw)
      expect(protocolContext.calledOnceWithExactly(network.centrifugeId)).to.equal(true)
      expect(getClient.calledOnceWithExactly(network.centrifugeId)).to.equal(true)
      expect(
        readContract.calledOnceWithExactly({
          address: ADDRESS_A,
          abi: ABI.OnchainPMFactory,
          functionName: 'getAddress',
          args: [poolId.raw],
        })
      ).to.equal(true)
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

  describe('workflow execution parameters and fees', () => {
    const poolId = PoolId.from(1, 15)
    const network = { centrifugeId: 13, pool: { id: poolId, centrifugeId: 1 } } as PoolNetwork
    const cases = [
      ['updateContract', MessageType.UntrustedContractUpdate, 1],
      ['submitQueuedAssets', MessageType.UpdateHoldingAmount, 1],
      ['crosschainTransferShares', MessageType.InitiateTransferShares, 14],
      ['requestDeposit', MessageType.Request, 1],
      ['claimDeposit', MessageType.RequestCallback, 5],
    ] as const
    const payableWorkflow = (names: readonly string[]) =>
      selfContainedWorkflow({
        variables: { target: ADDRESS_A, destinationCentrifugeId: '14', cfgAssetId: AssetId.from(5, 1).toString() },
        actions: names.map((name) => ({
          target: '$target',
          selector: `function ${name}()`,
          inputs: [],
          valueNonZero: true,
        })),
      } as Partial<MarketplaceWorkflow>)

    for (const [name, type, destination] of cases) {
      it(`estimates ${name} with the correct destination and message type`, async () => {
        const workflow = payableWorkflow([name])
        const workflowDef = buildPreparedWorkflowDefinition(workflow).workflowDef
        const estimate = sinon.stub().returns(of(123n))
        const result = await estimateWorkflowExecutionValue({
          centrifuge: { _estimate: estimate } as unknown as Centrifuge,
          network,
          workflow,
          workflowDef,
        })
        expect(estimate.calledOnceWithExactly(13, destination, { type, poolId })).to.equal(true)
        expect(result.totalValue).to.equal(123n)
        expect(result.runtimeValues).to.deep.equal({
          '__sdk_payable_value:0': encodeWorkflowInputValue('uint256', '123'),
        })
      })
    }

    it('sums multiple fees and assigns each to its own runtime slot', async () => {
      const workflow = payableWorkflow(cases.map(([name]) => name))
      const workflowDef = buildPreparedWorkflowDefinition(workflow).workflowDef
      const estimate = sinon.stub()
      cases.forEach((_, index) => estimate.onCall(index).returns(of(BigInt(index + 1))))
      const result = await estimateWorkflowExecutionValue({
        centrifuge: { _estimate: estimate } as unknown as Centrifuge,
        network,
        workflow,
        workflowDef,
      })
      expect(result.totalValue).to.equal(15n)
      expect(result.runtimeValues).to.deep.equal(
        Object.fromEntries(
          cases.map((_, index) => [
            `__sdk_payable_value:${index}`,
            encodeWorkflowInputValue('uint256', String(index + 1)),
          ])
        )
      )
    })

    it('needs no chain access for a nonpayable workflow', async () => {
      const workflow = selfContainedWorkflow()
      const result = await estimateWorkflowExecutionValue({
        centrifuge: unreachableCentrifuge,
        network,
        workflow,
        workflowDef: buildPreparedWorkflowDefinition(workflow).workflowDef,
      })
      expect(result).to.deep.equal({ runtimeValues: {}, totalValue: 0n })
    })

    for (const [name, variable, pattern] of [
      ['crosschainTransferShares', 'destinationCentrifugeId', /destinationCentrifugeId/],
      ['claimDeposit', 'cfgAssetId', /cfgAssetId/],
      ['unsupported', 'unused', /fee estimation is not implemented/],
    ] as const) {
      it(`rejects invalid fee context for ${name}`, async () => {
        const workflow = payableWorkflow([name])
        delete workflow.variables[variable]
        await rejects(
          estimateWorkflowExecutionValue({
            centrifuge: unreachableCentrifuge,
            network,
            workflow,
            workflowDef: buildPreparedWorkflowDefinition(workflow).workflowDef,
          }),
          pattern
        )
      })
    }

    it('builds the executable script, fills estimated fees and proves membership in the policy', async () => {
      const workflow = payableWorkflow(['submitQueuedAssets'])
      const entry = { workflow, configurableValues: {} }
      const other = { workflow: selfContainedWorkflow(), configurableValues: CONFIGURABLE }
      const centrifuge = { _estimate: () => of(123n) } as unknown as Centrifuge
      const policy = [entry, other]
      const result = await buildWorkflowExecuteParams({
        centrifuge,
        network,
        entry,
        policy,
        strategist: ADDRESS_B,
        runtimeValues: { '__sdk_payable_value:0': encodeWorkflowInputValue('uint256', '999') },
      })
      expect(result.commands).to.have.length(1)
      expect(result.state).to.include(encodeWorkflowInputValue('uint256', '123'))
      expect(result.state).to.not.include(encodeWorkflowInputValue('uint256', '999'))
      expect(result.value).to.equal(123n)
      expect(result.callbacks).to.deep.equal([])
      const hashes = await computeWorkflowGroupScriptHashes({ centrifuge, network, policy, strategist: ADDRESS_B })
      const leaf = computeScriptHash(result.commands, result.state, result.stateBitmap, result.callbacks)
      expect(SimpleMerkleTree.of(hashes).verify(leaf, result.proof)).to.equal(true)
    })

    it('rejects execution of an entry outside the whitelisted policy', async () => {
      await rejects(
        buildWorkflowExecuteParams({
          centrifuge: unreachableCentrifuge,
          network,
          entry: { workflow: selfContainedWorkflow(), configurableValues: CONFIGURABLE },
          policy: [
            { workflow: selfContainedWorkflow({ variables: { target: ADDRESS_B } }), configurableValues: CONFIGURABLE },
          ],
          strategist: ADDRESS_B,
        }),
        /not found in allScriptHashes/
      )
    })
  })

  describe('pool magic variables', () => {
    const poolId = PoolId.from(1, 15)
    const scId = ShareClassId.from(poolId, 1)
    const ramp = '0x3333333333333333333333333333333333333333' as const
    const network = {
      centrifugeId: 13,
      pool: { id: poolId, centrifugeId: 1 },
      details: () => of({ activeShareClasses: [{ id: scId }] }),
      onOfframpManager: (id: ShareClassId) => {
        expect(id.raw).to.equal(scId.raw)
        return of({ onrampAddress: ramp })
      },
    } as unknown as PoolNetwork
    function workflowFor(key: string, type: string) {
      return selfContainedWorkflow({
        actions: [
          {
            target: '$target',
            selector: `function poke(${type} value)`,
            inputs: [{ parameter: 'value', label: 'Value', input: [key] }],
          },
        ],
      } as Partial<MarketplaceWorkflow>)
    }
    for (const [key, type, expected] of [
      ['$poolId', 'uint64', encodeWorkflowInputValue('uint64', poolId.raw.toString())],
      ['$poolEscrow', 'address', encodeWorkflowInputValue('address', ADDRESS_B)],
      ['$scId', 'bytes16', encodeWorkflowInputValue('bytes16', scId.raw)],
      ['$onOffRamp', 'address', encodeWorkflowInputValue('address', ramp)],
    ] as const) {
      it(`resolves ${key} from the pool context`, async () => {
        const workflow = workflowFor(key, type)
        const result = await resolveWorkflowPoolContext({
          centrifuge: unreachableCentrifuge,
          network,
          workflow,
          workflowDef: buildPreparedWorkflowDefinition(workflow).workflowDef,
          strategist: ADDRESS_A,
          poolEscrowAddress: ADDRESS_B,
          recordedPoolContext: key === '$poolId' ? { $poolId: encodeWorkflowInputValue('uint64', '99') } : undefined,
        })
        expect(result.poolContext[key]).to.equal(expected)
        expect(result.resolvedScId).to.equal(key === '$scId' || key === '$onOffRamp' ? scId.raw : undefined)
      })
    }

    it('requires a pool escrow when the workflow references it', async () => {
      const workflow = workflowFor('$poolEscrow', 'address')
      await rejects(
        resolveWorkflowPoolContext({
          centrifuge: unreachableCentrifuge,
          network,
          workflow,
          workflowDef: buildPreparedWorkflowDefinition(workflow).workflowDef,
          strategist: ADDRESS_A,
        }),
        /Pool escrow address is required/
      )
    })

    it('rejects a share class that is not active on the network', async () => {
      const workflow = workflowFor('$scId', 'bytes16')
      await rejects(
        resolveWorkflowPoolContext({
          centrifuge: unreachableCentrifuge,
          network,
          workflow,
          workflowDef: buildPreparedWorkflowDefinition(workflow).workflowDef,
          strategist: ADDRESS_A,
          scId: ShareClassId.from(poolId, 2).raw,
        }),
        /is not active/
      )
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

  describe('computeWorkflowGroupScriptDetails', () => {
    it('returns each script hash with its resolved pool context in policy order', async () => {
      const plainWorkflow = selfContainedWorkflow()
      const escrowWorkflow = selfContainedWorkflow({
        actions: [
          {
            target: '$target',
            selector: 'function poke(address account)',
            inputs: [{ parameter: 'account', label: 'Account', input: ['$poolEscrow'] }],
          },
        ],
      } as Partial<MarketplaceWorkflow>)
      const options = {
        centrifuge: unreachableCentrifuge,
        network: fakeNetwork(['0xsc1']),
        strategist: ADDRESS_B,
        poolEscrowAddress: ADDRESS_A,
      }

      const details = await computeWorkflowGroupScriptDetails({
        ...options,
        policy: [
          { workflow: plainWorkflow, configurableValues: CONFIGURABLE },
          { workflow: escrowWorkflow, configurableValues: {} },
        ],
      })
      const plain = await computeWorkflowScriptHash({
        ...options,
        workflow: plainWorkflow,
        configurableValues: CONFIGURABLE,
      })
      const escrow = await computeWorkflowScriptHash({
        ...options,
        workflow: escrowWorkflow,
        configurableValues: {},
      })

      expect(details).to.deep.equal([
        { scriptHash: plain.scriptHash, poolContext: {} },
        {
          scriptHash: escrow.scriptHash,
          poolContext: { $poolEscrow: encodeWorkflowInputValue('address', ADDRESS_A) },
        },
      ])
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

  describe('recorded pool context', () => {
    /** Needs `$onchainPM`, which can only be resolved from a chain — the mainnet failure case. */
    const magicWorkflow = () =>
      ({
        workflowRef: 'needs_magic',
        name: 'Needs magic',
        template: 't',
        chainId: 1,
        variables: { target: ADDRESS_A },
        workflowId: `0x${'0'.repeat(64)}`,
        version: 1,
        actions: [
          {
            target: '$target',
            selector: 'function poke(address account)',
            inputs: [{ parameter: 'account', label: 'Account', input: ['$onchainPM'] }],
          },
        ],
        templates: { t: { variables: [], actions: [] } },
      }) as unknown as MarketplaceWorkflow

    const RECORDED_PM = `0x${'0'.repeat(24)}${'7'.repeat(40)}` as const

    it('resolves nothing when every required magic value was recorded', async () => {
      // The proxy throws on any access, so a passing test proves no chain resolution happened —
      // which is the point: on mainnet `$onchainPM` cannot be resolved at all.
      const { poolContext } = await resolveWorkflowPoolContext({
        centrifuge: unreachableCentrifuge,
        network: fakeNetwork(['0xsc1']),
        workflow: magicWorkflow(),
        workflowDef: buildPreparedWorkflowDefinition(magicWorkflow()).workflowDef,
        strategist: ADDRESS_B,
        recordedPoolContext: { $onchainPM: RECORDED_PM },
      })
      expect(poolContext.$onchainPM).to.equal(RECORDED_PM)
    })

    it('reproduces the same leaf from a recorded context as from a live one', async () => {
      // Recording is only worth anything if the hash comes out identical.
      const args = {
        centrifuge: unreachableCentrifuge,
        network: fakeNetwork(['0xsc1']),
        strategist: ADDRESS_B,
        policy: [{ workflow: magicWorkflow(), configurableValues: {}, poolContext: { $onchainPM: RECORDED_PM } }],
        allowRecordedContext: true,
      }
      const [first] = await computeWorkflowGroupScriptDetails(args)
      const [second] = await computeWorkflowGroupScriptDetails(args)
      expect(first!.scriptHash).to.match(/^0x[0-9a-f]{64}$/)
      expect(second!.scriptHash).to.equal(first!.scriptHash)
      expect(first!.poolContext.$onchainPM).to.equal(RECORDED_PM)
    })

    it('ignores a recorded context unless the caller opts in', async () => {
      // Root construction leaves the flag off, so a metadata-supplied address cannot reach a leaf a
      // signature would authorize — it falls back to resolving, and here that fails loudly.
      await rejects(
        computeWorkflowGroupScriptDetails({
          centrifuge: unreachableCentrifuge,
          network: fakeNetwork(['0xsc1']),
          strategist: ADDRESS_B,
          policy: [{ workflow: magicWorkflow(), configurableValues: {}, poolContext: { $onchainPM: RECORDED_PM } }],
        })
      )
    })

    it('changes the leaf when the recorded context differs', async () => {
      const base = {
        centrifuge: unreachableCentrifuge,
        network: fakeNetwork(['0xsc1']),
        strategist: ADDRESS_B,
        allowRecordedContext: true,
      }
      const [a] = await computeWorkflowGroupScriptDetails({
        ...base,
        policy: [{ workflow: magicWorkflow(), configurableValues: {}, poolContext: { $onchainPM: RECORDED_PM } }],
      })
      const [b] = await computeWorkflowGroupScriptDetails({
        ...base,
        policy: [
          {
            workflow: magicWorkflow(),
            configurableValues: {},
            poolContext: { $onchainPM: `0x${'0'.repeat(24)}${'8'.repeat(40)}` },
          },
        ],
      })
      // A context that didn't move the leaf would mean the address never entered the hashed script.
      expect(b!.scriptHash).to.not.equal(a!.scriptHash)
    })
  })
})

describe('resolveWorkflowPoolContext: $accountingTokenAssetId', () => {
  const SPOKE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
  const REGISTRY = '0xffffffffffffffffffffffffffffffffffffffff'
  const ACCOUNTING_TOKEN = '0xdddddddddddddddddddddddddddddddddddddddd'
  const ASSET = '0x4444444444444444444444444444444444444444'
  const SC = '0x00010000000000010000000000000001'
  const POOL_ID_RAW = 281474976710657n
  const ACCOUNTING_ASSET_ID = 67499859160952759170896452279861254n
  // erc7540_requestDeposit moves the liability accounting token.
  const TOKEN_ID = toAccountingTokenId(POOL_ID_RAW, ASSET, true)

  type Read = { address: string; functionName: string; args?: readonly unknown[] }

  const workflow = (omit?: 'spoke' | 'accountingToken') => {
    const variables: Record<string, string> = {
      target: ADDRESS_A,
      asset: ASSET,
      spoke: SPOKE,
      accountingToken: ACCOUNTING_TOKEN,
    }
    if (omit) delete variables[omit]
    return {
      workflowRef: 'needs_accounting_asset',
      name: 'Needs accounting asset',
      template: 'erc7540_requestDeposit',
      chainId: 1,
      variables,
      workflowId: `0x${'0'.repeat(64)}`,
      version: 1,
      actions: [
        {
          target: '$target',
          selector: 'function poke(uint256 id)',
          inputs: [{ parameter: 'id', label: 'Id', input: ['$accountingTokenAssetId'] }],
        },
      ],
      templates: { erc7540_requestDeposit: { variables: [], actions: [] } },
    } as unknown as MarketplaceWorkflow
  }

  const network = {
    centrifugeId: 1,
    pool: { id: { raw: POOL_ID_RAW, toString: () => POOL_ID_RAW.toString() }, centrifugeId: 1 },
    details: () => of({ activeShareClasses: [{ id: new ShareClassId(SC) }] }),
  } as unknown as PoolNetwork

  function spoke(version: 'v3.2' | 'v3.3', registered: boolean) {
    const reads: Read[] = []
    const client = {
      readContract: async (call: Read) => {
        reads.push(call)
        if (call.functionName === 'spokeRegistry') {
          if (version === 'v3.3') return REGISTRY
          throw new ContractFunctionRevertedError({
            abi: ABI.Spoke,
            functionName: 'spokeRegistry',
            message: 'execution reverted',
          })
        }
        if (call.functionName === 'assetToId') {
          if (registered) return ACCOUNTING_ASSET_ID
          if (version === 'v3.3') return 0n
          throw new ContractFunctionRevertedError({
            abi: ABI.Spoke,
            functionName: 'assetToId',
            data: encodeErrorResult({ abi: ABI.Spoke, errorName: 'UnknownAsset' }),
            message: 'execution reverted',
          })
        }
        throw new Error(`unexpected eth_call ${call.functionName}`)
      },
    }
    return { centrifuge: { getClient: () => of(client) } as unknown as Centrifuge, reads }
  }

  function resolve(wf: MarketplaceWorkflow, centrifuge: Centrifuge) {
    return resolveWorkflowPoolContext({
      centrifuge,
      network,
      workflow: wf,
      workflowDef: buildPreparedWorkflowDefinition(wf).workflowDef,
      strategist: ADDRESS_B,
      scId: SC,
    })
  }

  for (const version of ['v3.2', 'v3.3'] as const) {
    it(`resolves the accounting token's asset id on a ${version} spoke`, async () => {
      const { centrifuge, reads } = spoke(version, true)

      const { poolContext } = await resolve(workflow(), centrifuge)

      expect(poolContext.$accountingTokenAssetId).to.equal(`0x${ACCOUNTING_ASSET_ID.toString(16).padStart(64, '0')}`)
      const lookup = reads.find((read) => read.functionName === 'assetToId')!
      expect(lookup.address).to.equal(version === 'v3.3' ? REGISTRY : SPOKE)
      expect(lookup.args).to.deep.equal([ACCOUNTING_TOKEN, TOKEN_ID])
    })

    it(`rejects an accounting token that is not registered on a ${version} spoke`, async () => {
      const { centrifuge } = spoke(version, false)

      const error = await resolve(workflow(), centrifuge).catch((e: Error) => e)

      expect((error as Error).message).to.contain(`but that asset is not registered on spoke ${SPOKE}`)
    })
  }

  for (const variable of ['spoke', 'accountingToken'] as const) {
    it(`rejects a workflow without a "${variable}" variable before reading the chain`, async () => {
      const { centrifuge, reads } = spoke('v3.2', true)

      const error = await resolve(workflow(variable), centrifuge).catch((e: Error) => e)

      expect((error as Error).message).to.contain(`is missing a valid "${variable}" variable`)
      expect(reads).to.deep.equal([])
    })
  }
})
