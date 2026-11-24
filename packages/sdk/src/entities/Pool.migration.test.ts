import { expect } from 'chai'
import { of } from 'rxjs'
import sinon from 'sinon'
import type { CrosschainMessageRow, PoolMigrationRow, PoolMigrationStepRow } from '@centrifuge/queries/core'
import { Centrifuge } from '../Centrifuge.js'
import { PoolMigratingError } from '../errors.js'
import { Balance } from '../utils/BigInt.js'
import { AssetId, PoolId } from '../utils/types.js'
import { Pool } from './Pool.js'
import {
  abortedGenerationOfRow,
  countSteps,
  drainItemsOf,
  groupMessagesById,
  landStepsOfSpoke,
} from './PoolMigration.js'
import type { MigrationSpokeCandidate } from './migrationSpokes.js'

// Pool 281474976710665 on the Protocol fork fixture parked-step-665.json
// (protocol-internal#504): hub ethereum (1), spoke base (2). Hashes and ids
// as `packages/protocol/src/migration/__fixtures__/parked-step-665-messages.json`
// records them, computed with `@centrifuge/protocol-events` from `centrifuge/api-v4`.
const POOL_ID = '281474976710665'
const HUB = '1'
const SPOKE = '2'
const PAIRS = [
  {
    seq: 1,
    step: 0,
    hash: '0x98e586baf7276c3187a8e2a7bdf0b2a459713813dbe6e6bf4ab78e8b4fbe075e',
    id: '0x0fdea16f31e0465d2129f0973d04052657724e46551b682e1ce01f099b560def',
    parked: false,
  },
  {
    seq: 5,
    step: 1,
    hash: '0xb11111ef6bdf2a3b6f492180e4e3eaf800170fcbf75334dc03cdc3acb332d725',
    id: '0xbd163f3e8edc89cd0a1198427affa3ef1bf0234b90475251ccb0fc7c7bddc8ac',
    parked: false,
  },
  {
    seq: 15,
    step: 3,
    hash: '0x569e6ae7ce2a1d83533ce526c035f955a7a5107d9ed9c1a90b7b58c14e6a7677',
    id: '0xf4acd20d1ab9d2c96d639d8523c814f92e18414cf702e3242b3f17016d747cc8',
    parked: true,
  },
  {
    seq: 29,
    step: 4,
    hash: '0x39d213bd8f3f8f291dc2c61754b982832a1b88d0e50d8c48ea5fb9ded75151ea',
    id: '0x81a2d7ce63b9d6a8a8eee89e5208049977555614e33c4c3f01c423c9f71f292f',
    parked: true,
  },
] as const

function stepRow(
  seq: number,
  step: number,
  hash: `0x${string}`,
  centrifugeId = SPOKE,
  isSameChainStep = false
): PoolMigrationStepRow {
  return {
    chainId: '1',
    transactionHash: `0x${seq.toString(16).padStart(64, '0')}` as `0x${string}`,
    logIndex: 0,
    migrationId: '3.2->3.3',
    poolId: POOL_ID,
    centrifugeId,
    step,
    payloadHash: `0x${'ab'.repeat(32)}` as `0x${string}`,
    gatewayMessageHash: hash,
    hasGatewayPrepareMessage: !isSameChainStep,
    isSameChainStep,
    createdAt: '2026-10-22T10:00:00.000Z',
    createdAtBlock: 1000 + seq,
  }
}

function messageRow(
  id: `0x${string}`,
  index: number,
  status: CrosschainMessageRow['status'],
  failed = false,
  payloadStatus: CrosschainMessageRow['payloadStatus'] = null
): CrosschainMessageRow {
  return {
    id,
    index,
    poolId: POOL_ID,
    fromCentrifugeId: HUB,
    toCentrifugeId: SPOKE,
    messageType: 'ManagerCallFromHub',
    status,
    payloadStatus,
    failReason: failed ? '0x1234' : null,
    executedAt: status === 'Executed' ? '2026-10-22T10:05:00.000Z' : null,
    executedAtTxHash: status === 'Executed' ? `0x${'ee'.repeat(32)}` : null,
    failedAt: failed ? '2026-10-22T10:01:00.000Z' : null,
    clearedAt: status === 'Cleared' ? '2026-10-22T10:06:00.000Z' : null,
  }
}

const FIXTURE_STEPS = PAIRS.map((p) => stepRow(p.seq, p.step, p.hash))
const FIXTURE_MESSAGES = PAIRS.map((p) => messageRow(p.id, 0, 'Executed'))

type FacadeAnswers = {
  freezeGeneration?: number | Error
  maxReservesRestored?: boolean | Error
  hubPhase?: number | Error
  relays?: { step: number; transactionHash: `0x${string}`; logIndex: number; blockNumber: number }[]
  blockNumber?: bigint | Error
  liveSpokes?: MigrationSpokeCandidate[]
}
const HUB_PHASE_ORDINAL: Record<string, number> = { None: 0, Armed: 1, HubOnboarded: 2, Activated: 3 }

function withReads(
  centrifuge: Centrifuge,
  reads: {
    migration: PoolMigrationRow | null
    steps: PoolMigrationStepRow[]
    messages: CrosschainMessageRow[]
    indexerDown?: Error
  },
  facade: FacadeAnswers = {}
) {
  const seen: Record<string, unknown[]> = {}
  sinon.stub(centrifuge as any, '_queryData').callsFake((...args: unknown[]) => {
    const name = String(args[0])
    seen[name] = [...(seen[name] ?? []), args[1]]
    if (reads.indexerDown) throw reads.indexerDown
    if (name === 'poolMigration') return of(reads.migration)
    if (name === 'poolMigrationSteps') return of(reads.steps)
    if (name === 'crosschainMessageRows') return of(reads.messages)
    throw new Error(`unexpected catalogue read ${name}`)
  })
  const freezes = reads.steps.filter((step) => step.step === 1).length
  const answer = (functionName: string) =>
    functionName === 'freezeGeneration'
      ? (facade.freezeGeneration ?? freezes)
      : functionName === 'maxReservesRestored'
        ? (facade.maxReservesRestored ?? false)
        : functionName === 'hubPhase'
          ? (facade.hubPhase ?? HUB_PHASE_ORDINAL[reads.migration?.hubPhase ?? 'None'] ?? 0)
          : functionName === 'armedSpokes'
            ? (reads.migration?.spokes ?? []).map((spoke) => Number(spoke.centrifugeId))
            : new Error(`unexpected read ${functionName}`)
  const readContract = sinon.stub().callsFake(async ({ functionName }: { functionName: string }) => {
    const value = answer(functionName)
    if (value instanceof Error) throw value
    return value
  })
  const multicall = sinon.stub().callsFake(async ({ contracts }: { contracts: { functionName: string }[] }) =>
    contracts.map(({ functionName }) => {
      const value = answer(functionName)
      return value instanceof Error ? { status: 'failure', error: value } : { status: 'success', result: value }
    })
  )
  const getLogs = sinon.stub().callsFake(async () =>
    (facade.relays ?? []).map((relay) => ({
      args: { step: BigInt(relay.step) },
      transactionHash: relay.transactionHash,
      logIndex: relay.logIndex,
      blockNumber: BigInt(relay.blockNumber),
    }))
  )
  sinon.stub(centrifuge, 'getClient').returns(
    of({
      readContract,
      multicall,
      getLogs,
      getBlockNumber: async () => {
        if (facade.blockNumber instanceof Error) throw facade.blockNumber
        return facade.blockNumber ?? 5000n
      },
    }) as any
  )
  const candidates = sinon
    .stub(Pool.prototype, 'migrationSpokeCandidates')
    .resolves({ spokes: facade.liveSpokes ?? [], hubRecordError: null })
  return { seen, readContract, multicall, getLogs, candidates }
}

function migrationRow(hubPhase: string, spokes: PoolMigrationRow['spokes']): PoolMigrationRow {
  return {
    migrationId: '3.2->3.3',
    poolId: POOL_ID,
    targetVersion: '3.3',
    hubPhase,
    operator: '0xD5d2B48A4FDD2ca814c0d6c9d3BBc43D9265679D',
    startedAt: '2026-10-22T09:00:00.000Z',
    spokes,
  }
}

describe('Pool.migration', () => {
  afterEach(() => sinon.restore())

  it('is null for a pool that never armed and reads nothing else', async () => {
    const centrifuge = new Centrifuge({ environment: 'testnet' })
    const { seen, readContract } = withReads(centrifuge, { migration: null, steps: [], messages: [] })
    expect(await new Pool(centrifuge, POOL_ID).migration()).to.equal(null)
    expect(Object.keys(seen).sort()).to.deep.equal(['poolMigration', 'poolMigrationSteps'])
    expect(readContract.called).to.equal(false)
  })

  it('lands the fork fixture pairs, reads the facade generation on the hub and no restore before activation', async () => {
    const centrifuge = new Centrifuge({ environment: 'testnet' })
    const { seen, readContract, multicall } = withReads(centrifuge, {
      migration: migrationRow('Armed', [{ centrifugeId: SPOKE, phase: 'Frozen', freezeGeneration: '1' }]),
      steps: FIXTURE_STEPS,
      messages: FIXTURE_MESSAGES,
    })
    const migration = (await new Pool(centrifuge, POOL_ID).migration())!
    expect(migration.hubPhase).to.equal('armed')
    expect(migration.hubCentrifugeId).to.equal(1)
    expect(migration.poolId.equals(new PoolId(POOL_ID))).to.equal(true)
    expect(seen.crosschainMessageRows).to.deep.equal([{ ids: PAIRS.map((p) => p.id) }])

    const spoke = migration.spokes.find((s) => s.centrifugeId === 2)!
    expect(spoke.isHubChain).to.equal(false)
    expect(spoke.phase).to.equal('frozen')
    expect(spoke.state).to.equal('P3')
    expect(spoke.facadeFreezeGeneration).to.equal(1)
    expect(spoke.maxReservesRestored).to.equal(null)
    expect(spoke.steps.map((s) => [s.stepName, s.landing, s.messageId])).to.deep.equal([
      ['arm', 'landed', PAIRS[0].id],
      ['freeze', 'landed', PAIRS[1].id],
      ['unlinkVaults', 'landed', PAIRS[2].id],
      ['rotateAssets', 'landed', PAIRS[3].id],
    ])
    expect(spoke.counts).to.deep.equal({
      relayed: 4,
      landed: 4,
      parked: 0,
      inFlight: 0,
      underpaid: 0,
      dropped: 0,
      unmatched: 0,
    })
    expect(readContract.called).to.equal(false)
    expect(multicall.getCalls().map((c) => c.args[0].contracts.map((r: any) => r.functionName))).to.deep.equal([
      ['freezeGeneration'],
    ])
  })

  it('pairs a payload relayed twice with its rows by index, in hub log order', () => {
    const hash = PAIRS[0].hash
    const steps = [stepRow(1, 0, hash), stepRow(2, 0, hash), stepRow(3, 0, hash)]
    const landed = landStepsOfSpoke(
      1,
      2,
      steps,
      groupMessagesById([messageRow(PAIRS[0].id, 1, 'Executed'), messageRow(PAIRS[0].id, 0, 'Failed', true)])
    )
    expect(landed.map((s) => [s.landing, s.messageIndex])).to.deep.equal([
      ['parked', 0],
      ['landed', 1],
      ['inFlight', null],
    ])
  })

  it('reads a message that waits in an underpaid batch as underpaid, and one in a batch in transit as in flight', () => {
    const steps = [stepRow(1, 1, PAIRS[0].hash), stepRow(2, 1, PAIRS[1].hash)]
    const landed = landStepsOfSpoke(
      1,
      2,
      steps,
      groupMessagesById([
        messageRow(PAIRS[0].id, 0, 'AwaitingBatchDelivery', false, 'Underpaid'),
        messageRow(PAIRS[1].id, 0, 'AwaitingBatchDelivery', false, 'InTransit'),
      ])
    )
    expect(landed.map((s) => s.landing)).to.deep.equal(['underpaid', 'inFlight'])
    expect(countSteps(landed)).to.include({ relayed: 2, underpaid: 1, inFlight: 1, landed: 0 })
    const executed = landStepsOfSpoke(
      1,
      2,
      steps,
      groupMessagesById([
        messageRow(PAIRS[0].id, 0, 'Executed', false, 'Underpaid'),
        messageRow(PAIRS[1].id, 0, 'Failed', true, 'Underpaid'),
      ])
    )
    expect(executed.map((s) => s.landing)).to.deep.equal(['landed', 'parked'])
  })

  it('reports a cleared message as dropped, a same-chain step as landed, and no prepare as unmatched', () => {
    const steps = [stepRow(1, 1, PAIRS[0].hash), stepRow(2, 1, PAIRS[1].hash, '1', true), stepRow(3, 1, PAIRS[2].hash)]
    steps[2] = { ...steps[2]!, hasGatewayPrepareMessage: false }
    const landed = landStepsOfSpoke(1, 2, steps, groupMessagesById([messageRow(PAIRS[0].id, 0, 'Cleared', true)]))
    expect(landed.map((s) => s.landing)).to.deep.equal(['dropped', 'landed', 'unmatched'])
    expect(landed[1]!.messageId).to.equal(null)
  })

  it('derives the aborted generation from the spoke row', () => {
    expect(abortedGenerationOfRow(null, 0)).to.equal(null)
    expect(abortedGenerationOfRow('armed', 0)).to.equal(null)
    expect(abortedGenerationOfRow('armed', 2)).to.equal(2)
    expect(abortedGenerationOfRow('frozen', 1)).to.equal(null)
    expect(abortedGenerationOfRow('frozen', 3)).to.equal(2)
    expect(abortedGenerationOfRow('offboarded', 2)).to.equal(1)
  })

  it('walks a spoke through P1, P2, back to P1 on abort, P4, P5 and P6', async () => {
    const freeze = stepRow(1, 1, PAIRS[1].hash)
    const abort = stepRow(2, 2, PAIRS[2].hash)
    async function spokeOf(
      hubPhase: string,
      phase: string,
      generation: string,
      steps: PoolMigrationStepRow[],
      facade: FacadeAnswers = {}
    ) {
      const centrifuge = new Centrifuge({ environment: 'testnet' })
      withReads(
        centrifuge,
        {
          migration: migrationRow(hubPhase, [{ centrifugeId: SPOKE, phase, freezeGeneration: generation }]),
          steps,
          messages: [],
        },
        facade
      )
      const migration = (await new Pool(centrifuge, POOL_ID).migration())!
      sinon.restore()
      return migration.spokes.find((s) => s.centrifugeId === 2)!
    }
    expect((await spokeOf('Armed', 'Armed', '0', [stepRow(0, 0, PAIRS[0].hash)])).state).to.equal('P1')
    expect((await spokeOf('Armed', 'Frozen', '1', [freeze])).state).to.equal('P2')
    expect((await spokeOf('Armed', 'Armed', '1', [freeze, abort])).state).to.equal('P1')
    expect((await spokeOf('HubOnboarded', 'Offboarded', '1', [freeze])).state).to.equal('P4')
    const notRestored = await spokeOf('Activated', 'Onboarded', '1', [freeze], { maxReservesRestored: false })
    expect(notRestored.state).to.equal('P5')
    expect(notRestored.maxReservesRestored).to.equal(false)
    const restored = await spokeOf('Activated', 'Onboarded', '1', [freeze], { maxReservesRestored: true })
    expect(restored.state).to.equal('P6')
    expect(restored.maxReservesRestored).to.equal(true)
  })

  it('keeps the read when a facade call fails, and reports no state while the restore flag is unread', async () => {
    const centrifuge = new Centrifuge({ environment: 'testnet' })
    withReads(
      centrifuge,
      {
        migration: migrationRow('Activated', [{ centrifugeId: SPOKE, phase: 'Onboarded', freezeGeneration: '1' }]),
        steps: [stepRow(1, 1, PAIRS[1].hash)],
        messages: [],
      },
      { freezeGeneration: new Error('rpc down'), maxReservesRestored: new Error('rpc down') }
    )
    const spoke = (await new Pool(centrifuge, POOL_ID).migration())!.spokes.find((s) => s.centrifugeId === 2)!
    expect(spoke.maxReservesRestored).to.equal(null)
    expect(spoke.facadeFreezeGeneration).to.equal(null)
    expect(spoke.facadeReadError).to.equal('Error: rpc down')
    expect(spoke.state).to.equal(null)
    expect(spoke.steps).to.have.length(1)
  })

  it('names a missing facade deployment on the spoke instead of failing or hiding it', async () => {
    const centrifuge = new Centrifuge({ environment: 'mainnet' })
    withReads(centrifuge, {
      migration: migrationRow('Armed', [{ centrifugeId: SPOKE, phase: 'Armed', freezeGeneration: '0' }]),
      steps: [],
      messages: [],
    })
    const spoke = (await new Pool(centrifuge, POOL_ID).migration())!.spokes.find((s) => s.centrifugeId === 2)!
    expect(spoke.facadeFreezeGeneration).to.equal(null)
    expect(spoke.facadeReadError).to.match(/^UnknownDeploymentError: /)
    expect(spoke.state).to.equal('P1')
  })

  it('reports no state for a spoke while the facade and the step history disagree on the freeze generation', async () => {
    const centrifuge = new Centrifuge({ environment: 'testnet' })
    withReads(
      centrifuge,
      {
        migration: migrationRow('Armed', [
          { centrifugeId: SPOKE, phase: 'Frozen', freezeGeneration: '2' },
          { centrifugeId: '3', phase: 'Armed', freezeGeneration: '0' },
        ]),
        steps: [stepRow(1, 1, PAIRS[1].hash)],
        messages: [],
      },
      { freezeGeneration: 2 }
    )
    const migration = (await new Pool(centrifuge, POOL_ID).migration())!
    const lagging = migration.spokes.find((s) => s.centrifugeId === 2)!
    expect(lagging.state).to.equal(null)
    expect(lagging.facadeFreezeGeneration).to.equal(2)
    expect(lagging.steps).to.have.length(1)
    expect(migration.spokes.find((s) => s.centrifugeId === 3)!.state).to.equal(null)
    expect(migration.hubPhase).to.equal('armed')
  })

  it('carries an unknown step ordinal with no name and keeps it out of the gate', async () => {
    const centrifuge = new Centrifuge({ environment: 'testnet' })
    withReads(centrifuge, {
      migration: migrationRow('Armed', [{ centrifugeId: SPOKE, phase: 'Armed', freezeGeneration: '0' }]),
      steps: [stepRow(0, 0, PAIRS[0].hash), stepRow(1, 19, PAIRS[1].hash)],
      messages: [],
    })
    const spoke = (await new Pool(centrifuge, POOL_ID).migration())!.spokes.find((s) => s.centrifugeId === 2)!
    expect(spoke.steps.map((s) => s.stepName)).to.deep.equal(['arm', null])
    expect(spoke.state).to.equal('P1')
  })

  it('surfaces a spoke that has steps but no row yet', async () => {
    const centrifuge = new Centrifuge({ environment: 'testnet' })
    withReads(centrifuge, {
      migration: migrationRow('Armed', []),
      steps: [stepRow(0, 0, PAIRS[0].hash, '3')],
      messages: [],
    })
    const migration = (await new Pool(centrifuge, POOL_ID).migration())!
    expect(migration.spokes.map((s) => [s.centrifugeId, s.phase, s.state])).to.deep.equal([[3, null, 'P1']])
  })
})

describe('the migration gate reads the facade before the indexer', () => {
  afterEach(() => sinon.restore())
  const onSpoke = [{ centrifugeId: Number(SPOKE) }]
  const refusal = async (promise: Promise<unknown>) => {
    try {
      await promise
    } catch (error) {
      expect(error).to.be.instanceOf(PoolMigratingError)
      return error as PoolMigratingError
    }
    throw new Error('expected the gate to refuse')
  }

  it('refuses a write when the indexer read fails and the facade reads Armed, naming the read', async () => {
    const centrifuge = new Centrifuge({ environment: 'testnet' })
    withReads(
      centrifuge,
      { migration: null, steps: [], messages: [], indexerDown: new Error('indexer down') },
      { hubPhase: 1 }
    )
    const error = await refusal(centrifuge._migrationGate(POOL_ID, 'requestDeposit', onSpoke))
    expect(error.gate).to.include({ action: 'requestDeposit', centrifugeId: Number(SPOKE), phase: null })
    expect(error.gate!.reason).to.contain('could not be read from the indexer').and.contain('indexer down')
  })

  it('passes a write without an indexer read when the facade reads None', async () => {
    const centrifuge = new Centrifuge({ environment: 'testnet' })
    const { seen, readContract } = withReads(
      centrifuge,
      { migration: null, steps: [], messages: [], indexerDown: new Error('must not read') },
      { hubPhase: 0 }
    )
    await centrifuge._migrationGate(POOL_ID, 'requestDeposit', onSpoke)
    await centrifuge._migrationGate(POOL_ID, 'setPoolMetadata', onSpoke)
    expect(Object.keys(seen)).to.deep.equal([])
    expect(readContract.getCalls().map((call) => call.args[0].functionName)).to.deep.equal(['hubPhase', 'hubPhase'])
  })

  it('closes settlement toward a frozen spoke when a relayed step is on chain and not in the indexer', async () => {
    const frozen = () => {
      const centrifuge = new Centrifuge({ environment: 'testnet' })
      return {
        centrifuge,
        with: (relays: FacadeAnswers['relays']) =>
          withReads(
            centrifuge,
            {
              migration: migrationRow('Armed', [{ centrifugeId: SPOKE, phase: 'Frozen', freezeGeneration: '1' }]),
              steps: FIXTURE_STEPS.slice(0, 2),
              messages: FIXTURE_MESSAGES.slice(0, 2),
            },
            { relays }
          ),
      }
    }
    const clean = frozen()
    clean.with([])
    await clean.centrifuge._migrationGate(POOL_ID, 'approveDeposits', onSpoke)
    sinon.restore()

    const relayed = frozen()
    const { getLogs } = relayed.with([
      { step: 3, transactionHash: `0x${'77'.repeat(32)}`, logIndex: 0, blockNumber: 4990 },
    ])
    const error = await refusal(relayed.centrifuge._migrationGate(POOL_ID, 'approveDeposits', onSpoke))
    expect(error.gate).to.include({ action: 'approveDeposits', centrifugeId: Number(SPOKE), phase: null })
    expect(error.gate!.reason).to.contain('unlinkVaults').and.contain('is not in the indexer yet')
    expect(getLogs.calledOnce).to.equal(true)
    sinon.restore()

    const open = frozen()
    const reads = open.with([{ step: 3, transactionHash: `0x${'77'.repeat(32)}`, logIndex: 0, blockNumber: 4990 }])
    await open.centrifuge._migrationGate(POOL_ID, 'updateMember', onSpoke)
    expect(reads.getLogs.called).to.equal(false)
  })

  it('sweeps the destination of a bridge too, and closes it on a relay the indexer has not written', async () => {
    const frozenSpoke = (relays: FacadeAnswers['relays'], blockNumber?: Error) => {
      const centrifuge = new Centrifuge({ environment: 'testnet' })
      const reads = withReads(
        centrifuge,
        {
          migration: migrationRow('Armed', [{ centrifugeId: SPOKE, phase: 'Frozen', freezeGeneration: '1' }]),
          steps: FIXTURE_STEPS.slice(0, 2),
          messages: FIXTURE_MESSAGES.slice(0, 2),
        },
        { relays, ...(blockNumber ? { blockNumber } : {}) }
      )
      return { centrifuge, ...reads }
    }
    const bridge = [{ centrifugeId: 3, destinationCentrifugeId: Number(SPOKE) }]
    const relay = { step: 3, transactionHash: `0x${'77'.repeat(32)}` as const, logIndex: 0, blockNumber: 4990 }

    const clean = frozenSpoke([])
    await clean.centrifuge._migrationGate(POOL_ID, 'crosschainTransferShares', bridge)
    sinon.restore()

    const relayed = frozenSpoke([relay])
    const error = await refusal(relayed.centrifuge._migrationGate(POOL_ID, 'crosschainTransferShares', bridge))
    expect(error.gate).to.include({ action: 'crosschainTransferShares', centrifugeId: Number(SPOKE), phase: null })
    expect(error.gate!.reason).to.contain('unlinkVaults').and.contain('is not in the indexer yet')
  })

  it('refuses with the reason, not a raw error, when the hub block number cannot be read for the sweep', async () => {
    const centrifuge = new Centrifuge({ environment: 'testnet' })
    withReads(
      centrifuge,
      {
        migration: migrationRow('Armed', [{ centrifugeId: SPOKE, phase: 'Frozen', freezeGeneration: '1' }]),
        steps: FIXTURE_STEPS.slice(0, 2),
        messages: FIXTURE_MESSAGES.slice(0, 2),
      },
      { blockNumber: new Error('hub rpc down') }
    )
    const error = await refusal(centrifuge._migrationGate(POOL_ID, 'approveDeposits', onSpoke))
    expect(error.gate).to.include({ action: 'approveDeposits', centrifugeId: Number(SPOKE), phase: null })
    expect(error.gate!.reason).to.contain('refused the StepRelayed sweep').and.contain('hub rpc down')
    expect(error.gate!.reason).to.contain('Retry once the hub RPC answers')
    expect(error.gate!.reason).to.not.contain('ignoreStepsInFlight')
  })

  it('passes an activated pool whose spokes are restored without an indexer read', async () => {
    const centrifuge = new Centrifuge({ environment: 'testnet' })
    const { seen } = withReads(
      centrifuge,
      {
        migration: migrationRow('Activated', [{ centrifugeId: SPOKE, phase: 'Onboarded', freezeGeneration: '1' }]),
        steps: [],
        messages: [],
        indexerDown: new Error('must not read'),
      },
      { maxReservesRestored: true }
    )
    await centrifuge._migrationGate(POOL_ID, 'requestDeposit', onSpoke)
    expect(Object.keys(seen)).to.deep.equal([])
  })
})

describe('Pool.migration spoke set', () => {
  afterEach(() => sinon.restore())

  it('surfaces a live spoke that was never armed while the hub is Armed, with no phase and no steps', async () => {
    const centrifuge = new Centrifuge({ environment: 'testnet' })
    const { candidates } = withReads(
      centrifuge,
      {
        migration: migrationRow('Armed', [{ centrifugeId: SPOKE, phase: 'Armed', freezeGeneration: '0' }]),
        steps: [],
        messages: [],
      },
      {
        liveSpokes: [
          { centrifugeId: 2, activity: 'active', reason: null, sources: ['chain', 'migration'] },
          { centrifugeId: 3, activity: 'active', reason: null, sources: ['chain', 'hubRecord'] },
          { centrifugeId: 4, activity: 'unreadable', reason: 'timed out', sources: ['chain'] },
          { centrifugeId: 5, activity: 'inactive', reason: null, sources: ['chain'] },
        ],
      }
    )
    const migration = (await new Pool(centrifuge, POOL_ID).migration())!
    expect(candidates.firstCall.args[0]).to.deep.equal([2])
    expect(migration.spokes.map((spoke) => spoke.centrifugeId)).to.deep.equal([2, 3])
    const live = migration.spokes.find((spoke) => spoke.centrifugeId === 3)!
    expect(live.phase).to.equal(null)
    expect(live.steps).to.deep.equal([])
    expect(live.state).to.equal('P1')
  })

  it('judges a live spoke that was never armed as P1 in the gate while the hub is Armed', async () => {
    const centrifuge = new Centrifuge({ environment: 'testnet' })
    withReads(
      centrifuge,
      {
        migration: migrationRow('Armed', [{ centrifugeId: SPOKE, phase: 'Armed', freezeGeneration: '0' }]),
        steps: [],
        messages: [],
      },
      { liveSpokes: [{ centrifugeId: 3, activity: 'active', reason: null, sources: ['chain', 'hubRecord'] }] }
    )
    const onLive = [{ centrifugeId: 3 }]
    await centrifuge._migrationGate(POOL_ID, 'requestDeposit', onLive)
    let refused: PoolMigratingError | null = null
    try {
      await centrifuge._migrationGate(POOL_ID, 'deployVault', onLive)
    } catch (error) {
      refused = error as PoolMigratingError
    }
    expect(refused).to.be.instanceOf(PoolMigratingError)
    expect(refused!.gate).to.include({ action: 'deployVault', centrifugeId: 3, phase: 'P1', verdict: 'R' })
  })

  it('adds no spoke once the hub is activated', async () => {
    const centrifuge = new Centrifuge({ environment: 'testnet' })
    const { candidates } = withReads(
      centrifuge,
      {
        migration: migrationRow('Activated', [{ centrifugeId: SPOKE, phase: 'Onboarded', freezeGeneration: '1' }]),
        steps: [],
        messages: [],
      },
      {
        liveSpokes: [{ centrifugeId: 3, activity: 'active', reason: null, sources: ['chain'] }],
        maxReservesRestored: true,
      }
    )
    const migration = (await new Pool(centrifuge, POOL_ID).migration())!
    expect(candidates.called).to.equal(false)
    expect(migration.spokes.map((spoke) => spoke.centrifugeId)).to.deep.equal([2])
  })
})

describe('drainItemsOf', () => {
  const usdc = new AssetId('281474976710657')
  const dai = new AssetId('281474976710658')
  const account = '0xD5d2B48A4FDD2ca814c0d6c9d3BBc43D9265679D' as const
  const tx = { createdAtTxHash: null, updatedAtTxHash: null }
  const invest = {
    epochOutstandingInvests: [
      { assetId: usdc, centrifugeId: 2 as const, pendingAmount: new Balance(5_000_000n, 6), ...tx },
      { assetId: usdc, centrifugeId: 3 as const, pendingAmount: new Balance(9_000_000n, 6), ...tx },
    ],
    epochInvestOrders: [],
    pendingInvestOrders: [
      {
        assetId: usdc,
        centrifugeId: 2 as const,
        account,
        investor: account,
        pendingAmount: '0',
        queuedAmount: '1000000',
      },
      {
        assetId: dai,
        centrifugeId: 2 as const,
        account,
        investor: account,
        pendingAmount: '0',
        queuedAmount: '2000000',
      },
      {
        assetId: dai,
        centrifugeId: 2 as const,
        account,
        investor: account,
        pendingAmount: '0',
        queuedAmount: '3000000',
      },
    ],
  }
  const redeem = {
    epochOutstandingRedeems: [
      { assetId: dai, centrifugeId: 2 as const, pendingAmount: new Balance(7n * 10n ** 18n, 18), ...tx },
    ],
    pendingRedeemOrders: [
      {
        assetId: usdc,
        centrifugeId: 2 as const,
        account,
        investor: account,
        pendingAmount: new Balance(0n, 18),
        queuedAmount: new Balance(0n, 18),
        tokenId: '0x01',
        ...tx,
      },
    ],
  }

  it('sums the orders of one spoke per asset in the asset decimals from the holdings', () => {
    const items = drainItemsOf(2, '0x01', invest, redeem, new Map([[dai.toString(), 6]]))
    expect(items.map((item) => item.assetId.toString())).to.deep.equal([usdc.toString(), dai.toString()])
    const [u, d] = items
    expect(u!.pendingDeposit.toString()).to.equal('5000000')
    expect(u!.pendingDeposit.decimals).to.equal(6)
    expect(u!.queuedInvest.toString()).to.equal('1000000')
    expect(u!.queuedRedeem.isZero()).to.equal(true)
    expect(d!.queuedInvest.toString()).to.equal('5000000')
    expect(d!.queuedInvest.decimals).to.equal(6)
    expect(d!.pendingRedeem.toString()).to.equal((7n * 10n ** 18n).toString())
    expect(items.every((item) => item.centrifugeId === 2 && item.shareClassId === '0x01')).to.equal(true)
  })

  it('leaves out an asset with nothing to drain', () => {
    const items = drainItemsOf(3, '0x01', invest, { epochOutstandingRedeems: [], pendingRedeemOrders: [] })
    expect(items).to.have.length(1)
    expect(items[0]!.pendingDeposit.toString()).to.equal('9000000')
    expect(drainItemsOf(9, '0x01', invest, redeem)).to.deep.equal([])
  })
})
