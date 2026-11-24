import { expect } from 'chai'
import { of } from 'rxjs'
import sinon from 'sinon'
import { DataSourceResponseError, type PoolMigrationRow, type PoolMigrationStepRow } from '@centrifuge/queries/core'
import { UnsupportedQueryError } from '@centrifuge/queries/graphql'
import { isActionAllowed, isAllowed, isBridgeAllowed, MIGRATION_ACTION, SPOKE_GATE_STATE } from '@centrifuge/protocol'
import { Centrifuge, type MigrationGateTarget } from './Centrifuge.js'
import * as exported from './index.js'
import { Pool } from './entities/Pool.js'
import { PoolNetwork } from './entities/PoolNetwork.js'
import { ShareClass } from './entities/ShareClass.js'
import { Vault } from './entities/Vault.js'
import { PoolMigratingError, WalletRequiredError } from './errors.js'
import type { PrepareOutcome, TxStrategy } from './tx/TxStrategy.js'
import type { Transaction } from './types/transaction.js'
import { wrapTransaction } from './utils/transaction.js'
import { Balance } from './utils/BigInt.js'
import { AssetId } from './utils/types.js'

const POOL_ID = '281474976710665'
const HUB = 1
const SPOKE = 2
const OTHER = 3
const SC_ID = '0x00010000000000090000000000000001'
const ADDRESS = '0x1111111111111111111111111111111111111111'

const HUB_PHASES = ['None', 'Armed', 'HubOnboarded', 'Activated'] as const
type HubPhase = (typeof HUB_PHASES)[number]
type SpokePhase = 'Armed' | 'Frozen' | 'Offboarded' | 'Onboarded'
type SpokeFixture = {
  centrifugeId: number
  phase: SpokePhase
  steps: number[]
  restored?: boolean
  facadeGeneration?: number
  facadeFails?: boolean
}

function stepRow(seq: number, step: number, centrifugeId: number): PoolMigrationStepRow {
  return {
    chainId: '1',
    transactionHash: `0x${seq.toString(16).padStart(64, '0')}` as `0x${string}`,
    logIndex: 0,
    migrationId: '3.2->3.3',
    poolId: POOL_ID,
    centrifugeId: String(centrifugeId),
    step,
    payloadHash: `0x${'ab'.repeat(32)}` as `0x${string}`,
    gatewayMessageHash: `0x${seq.toString(16).padStart(64, 'c')}` as `0x${string}`,
    hasGatewayPrepareMessage: false,
    isSameChainStep: true,
    createdAt: '2026-10-22T10:00:00.000Z',
    createdAtBlock: 1000 + seq,
  }
}

function migrating(hubPhase: HubPhase, spokes: SpokeFixture[], txStrategy?: TxStrategy) {
  const centrifuge = new Centrifuge({ environment: 'testnet', ...(txStrategy ? { txStrategy } : {}) })
  const freezes = (spoke: SpokeFixture) => spoke.steps.filter((step) => step === 1).length
  const row: PoolMigrationRow = {
    migrationId: '3.2->3.3',
    poolId: POOL_ID,
    targetVersion: '3.3',
    hubPhase,
    operator: ADDRESS,
    startedAt: '2026-10-22T09:00:00.000Z',
    spokes: spokes.map((spoke) => ({
      centrifugeId: String(spoke.centrifugeId),
      phase: spoke.phase,
      freezeGeneration: String(freezes(spoke)),
    })),
  }
  let seq = 0
  const steps = spokes.flatMap((spoke) => spoke.steps.map((step) => stepRow(++seq, step, spoke.centrifugeId)))
  const reads: string[] = []
  sinon.stub(centrifuge as any, '_queryData').callsFake((...args: unknown[]) => {
    const name = String(args[0])
    reads.push(name)
    if (name === 'poolMigration') return of(row)
    if (name === 'poolMigrationSteps') return of(steps)
    if (name === 'crosschainMessageRows') return of([])
    throw new Error(`unexpected catalogue read ${name}`)
  })
  const spokeOf = (centrifugeId: number) => spokes.find((spoke) => spoke.centrifugeId === centrifugeId)
  const facade = (functionName: string, args: readonly unknown[]) => {
    if (functionName === 'freezeGeneration') {
      const spoke = spokeOf(Number(args[1]))
      return spoke ? (spoke.facadeGeneration ?? freezes(spoke)) : 0
    }
    return new Error(`unexpected read ${functionName}`)
  }
  sinon.stub(centrifuge, 'getClient').callsFake(
    (centrifugeId: number) =>
      of({
        readContract: async ({ functionName }: { functionName: string }) => {
          if (functionName === 'hubPhase') return HUB_PHASES.indexOf(hubPhase)
          if (functionName === 'armedSpokes') return spokes.map((spoke) => spoke.centrifugeId)
          if (functionName === 'maxReservesRestored') {
            if (spokeOf(centrifugeId)?.facadeFails) throw new Error('facade unreachable')
            return spokeOf(centrifugeId)?.restored ?? false
          }
          throw new Error(`unexpected read ${functionName}`)
        },
        getBlockNumber: async () => 5000n,
        getLogs: async () => [],
        multicall: async ({ contracts }: { contracts: { functionName: string; args: readonly unknown[] }[] }) =>
          contracts.map(({ functionName, args }) => {
            const value = facade(functionName, args)
            return value instanceof Error ? { status: 'failure', error: value } : { status: 'success', result: value }
          }),
      }) as any
  )
  sinon.stub(Pool.prototype, 'migrationSpokeCandidates').resolves({ spokes: [], hubRecordError: null })
  return { centrifuge, reads }
}

const PHASES: Record<'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6', () => ReturnType<typeof migrating>> = {
  P1: () =>
    migrating('Armed', [
      { centrifugeId: HUB, phase: 'Armed', steps: [0] },
      { centrifugeId: SPOKE, phase: 'Armed', steps: [0] },
    ]),
  P2: () =>
    migrating('Armed', [
      { centrifugeId: HUB, phase: 'Frozen', steps: [0, 1] },
      { centrifugeId: SPOKE, phase: 'Frozen', steps: [0, 1] },
    ]),
  P3: () =>
    migrating('Armed', [
      { centrifugeId: HUB, phase: 'Offboarded', steps: [0, 1, 3] },
      { centrifugeId: SPOKE, phase: 'Offboarded', steps: [0, 1, 3] },
    ]),
  P4: () =>
    migrating('HubOnboarded', [
      { centrifugeId: HUB, phase: 'Offboarded', steps: [0, 1, 3] },
      { centrifugeId: SPOKE, phase: 'Offboarded', steps: [0, 1, 3] },
    ]),
  P5: () =>
    migrating('Activated', [
      { centrifugeId: HUB, phase: 'Onboarded', steps: [0, 1, 3], restored: false },
      { centrifugeId: SPOKE, phase: 'Onboarded', steps: [0, 1, 3], restored: false },
    ]),
  P6: () =>
    migrating('Activated', [
      { centrifugeId: HUB, phase: 'Onboarded', steps: [0, 1, 3], restored: true },
      { centrifugeId: SPOKE, phase: 'Onboarded', steps: [0, 1, 3], restored: true },
    ]),
}

async function refusal(promise: Promise<unknown>): Promise<PoolMigratingError> {
  try {
    await promise
  } catch (error) {
    expect(error).to.be.instanceOf(PoolMigratingError)
    return error as PoolMigratingError
  }
  throw new Error('expected the gate to refuse')
}

const onSpoke = [{ centrifugeId: SPOKE }]

function facadeReads(centrifuge: Centrifuge, hubPhase: HubPhase) {
  sinon.stub(centrifuge, 'getClient').returns(
    of({
      readContract: async ({ functionName }: { functionName: string }) => {
        if (functionName === 'hubPhase') return HUB_PHASES.indexOf(hubPhase)
        throw new Error(`unexpected read ${functionName}`)
      },
      getBlockNumber: async () => 5000n,
      getLogs: async () => [],
    }) as any
  )
}

describe('migration gate', () => {
  afterEach(() => sinon.restore())

  it('passes every action of a pool whose facade reads None without reading the indexer', async () => {
    const { centrifuge, reads } = migrating('None', [])
    await centrifuge._migrationGate(POOL_ID, 'requestDeposit', onSpoke)
    await centrifuge._migrationGate(POOL_ID, 'setPoolMetadata', onSpoke)
    await centrifuge._migrationGate(POOL_ID, 'crosschainTransferShares', [
      { centrifugeId: SPOKE, destinationCentrifugeId: OTHER },
    ])
    expect(reads).to.deep.equal([])
  })

  it('passes an activated pool whose spokes are all restored without reading the indexer', async () => {
    const { centrifuge, reads } = PHASES.P6()
    await centrifuge._migrationGate(POOL_ID, 'requestDeposit', onSpoke)
    await centrifuge._migrationGate(POOL_ID, 'setPoolMetadata', onSpoke)
    expect(reads).to.deep.equal([])
  })

  it('refuses a name the gate table does not map once the facade reports the pool migrating', async () => {
    const { centrifuge } = PHASES.P2()
    for (const action of ['setPoolMetadata', 'createHolding', 'submitQueued']) {
      const error = await refusal(centrifuge._migrationGate(POOL_ID, action, onSpoke))
      expect(error.gate).to.include({ action, centrifugeId: SPOKE, phase: null, verdict: '?' })
      expect(error.gate!.reason).to.contain('no row in the migration gate table')
    }
  })

  it('passes every action on an api-v3 target before reading the facade or the indexer', async () => {
    const legacy = new Centrifuge({ environment: 'testnet', graphqlTarget: 'api-v3' })
    sinon.stub(globalThis, 'fetch').rejects(new Error('must not be fetched'))
    sinon.stub(legacy, 'getClient').throws(new Error('must not read the chain'))
    for (const action of ['requestDeposit', 'setPoolMetadata', 'createHolding', 'submitQueued']) {
      await legacy._migrationGate(POOL_ID, action, onSpoke)
    }
    expect(await new Pool(legacy, POOL_ID).isAllowed('setPoolMetadata', SPOKE)).to.deep.equal({ allowed: true })
  })

  it('passes when a public-api source cannot serve the migration rows', async () => {
    const blocked = new Centrifuge({ environment: 'testnet' })
    sinon
      .stub(blocked as any, '_queryData')
      .throws(
        new UnsupportedQueryError('poolMigration', { support: 'blocked', reason: 'test', missing: [], blockedBy: [] })
      )
    facadeReads(blocked, 'Armed')
    await blocked._migrationGate(POOL_ID, 'requestDeposit', onSpoke)
  })

  it('refuses when the facade reports the pool migrating and the indexer does not answer, naming the read', async () => {
    const failures = [
      new DataSourceResponseError('indexer down', { status: 503, url: 'https://indexer.test', body: 'down' }),
      [{ message: 'Cannot query field poolMigration' }],
      new TypeError('fetch failed'),
    ]
    for (const failure of failures) {
      const centrifuge = new Centrifuge({ environment: 'testnet' })
      sinon.stub(centrifuge as any, '_queryData').throws(failure)
      facadeReads(centrifuge, 'Armed')
      const error = await refusal(centrifuge._migrationGate(POOL_ID, 'requestDeposit', onSpoke))
      expect(error.gate).to.include({ action: 'requestDeposit', centrifugeId: SPOKE, phase: null, verdict: null })
      expect(error.gate!.reason).to.contain('could not be read from the indexer')
      expect(error.message).to.contain(POOL_ID)
      sinon.restore()
    }
  })

  it('refuses when the hub facade itself cannot be read', async () => {
    const centrifuge = new Centrifuge({ environment: 'testnet' })
    sinon.stub(centrifuge as any, '_queryData').throws(new Error('must not read'))
    sinon.stub(centrifuge, 'getClient').returns(
      of({
        readContract: async () => {
          throw new Error('rpc down')
        },
      }) as any
    )
    const error = await refusal(centrifuge._migrationGate(POOL_ID, 'requestDeposit', onSpoke))
    expect(error.gate!.reason).to.contain('facade on the hub chain could not be read').and.contain('rpc down')
  })

  const table: [keyof typeof PHASES, string, 'allowed' | 'refused', string?][] = [
    ['P1', 'requestDeposit', 'allowed'],
    ['P1', 'claimDeposit', 'allowed'],
    ['P1', 'approveDeposits', 'allowed'],
    ['P1', 'deployVault', 'refused', 'R'],
    ['P2', 'requestDeposit', 'refused', 'R'],
    ['P2', 'cancelRedeemRequest', 'refused', 'R'],
    ['P2', 'claimDeposit', 'allowed'],
    ['P2', 'approveDeposits', 'allowed'],
    ['P2', 'notifyDeposit', 'allowed'],
    ['P2', 'updateMember', 'allowed'],
    ['P3', 'claimDeposit', 'refused', 'R'],
    ['P3', 'approveDeposits', 'refused', 'R'],
    ['P3', 'notifyDeposit', 'refused', 'R'],
    ['P3', 'updateMember', 'allowed'],
    ['P3', 'updateSharePrice', 'allowed'],
    ['P4', 'requestDeposit', 'refused', 'C'],
    ['P4', 'updateMember', 'refused', 'C'],
    ['P4', 'updateSharePrice', 'refused', 'C'],
    ['P4', 'deployVault', 'refused', 'C'],
    ['P5', 'requestDeposit', 'refused', 'R'],
    ['P5', 'claimDeposit', 'refused', 'C'],
    ['P5', 'updateSharePrice', 'allowed'],
    ['P5', 'updatePoolManagers', 'refused', 'R'],
    ['P6', 'requestDeposit', 'allowed'],
    ['P6', 'deployVault', 'allowed'],
    ['P6', 'updatePoolManagers', 'allowed'],
  ]
  for (const [phase, action, outcome, verdict] of table) {
    it(`${phase}: ${action} is ${outcome}`, async () => {
      const { centrifuge } = PHASES[phase]()
      const gate = centrifuge._migrationGate(POOL_ID, action, onSpoke)
      if (outcome === 'allowed') {
        await gate
        return
      }
      const error = await refusal(gate)
      expect(error.poolId).to.equal(POOL_ID)
      expect(error.gate).to.include({ action, centrifugeId: SPOKE, phase, verdict })
      expect(error.gate!.allowedActions).to.be.an('array')
      expect(error.message).to.contain(phase).and.contain(action).and.contain(`centrifugeId ${SPOKE}`)
    })
  }

  it('keys an asset action on the asset chain and a hub action on the hub', async () => {
    const { centrifuge } = migrating('Armed', [
      { centrifugeId: HUB, phase: 'Frozen', steps: [0, 1] },
      { centrifugeId: SPOKE, phase: 'Armed', steps: [0] },
      { centrifugeId: OTHER, phase: 'Offboarded', steps: [0, 1, 3] },
    ])
    await centrifuge._migrationGate(POOL_ID, 'approveDeposits', [{ assetId: AssetId.from(SPOKE, 1).toString() }])
    const error = await refusal(
      centrifuge._migrationGate(POOL_ID, 'approveDeposits', [{ assetId: AssetId.from(OTHER, 1).toString() }])
    )
    expect(error.gate).to.include({ centrifugeId: OTHER, phase: 'P3' })
    await centrifuge._migrationGate(POOL_ID, 'updateSharePrice', [])
    const hub = await refusal(centrifuge._migrationGate(POOL_ID, 'deployVault', [{}]))
    expect(hub.gate).to.include({ centrifugeId: HUB, phase: 'P2' })
  })

  it('gates a bridge at both ends, with the hub chain row for a hub chain source', async () => {
    const { centrifuge } = migrating('Armed', [
      { centrifugeId: HUB, phase: 'Frozen', steps: [0, 1] },
      { centrifugeId: SPOKE, phase: 'Frozen', steps: [0, 1] },
      { centrifugeId: OTHER, phase: 'Offboarded', steps: [0, 1, 3] },
    ])
    await centrifuge._migrationGate(POOL_ID, 'crosschainTransferShares', [
      { centrifugeId: SPOKE, destinationCentrifugeId: HUB },
    ])
    const toward = await refusal(
      centrifuge._migrationGate(POOL_ID, 'crosschainTransferShares', [
        { centrifugeId: SPOKE, destinationCentrifugeId: OTHER },
      ])
    )
    expect(toward.gate).to.include({ centrifugeId: OTHER, phase: 'P3', verdict: 'R' })
    const out = await refusal(
      centrifuge._migrationGate(POOL_ID, 'crosschainTransferShares', [
        { centrifugeId: HUB, destinationCentrifugeId: SPOKE },
      ])
    )
    expect(out.gate).to.include({ centrifugeId: HUB, phase: 'P2', verdict: 'R' })
  })

  it('refuses a spoke whose facade could not be read, and one whose history disagrees', async () => {
    const unread = migrating('Activated', [
      { centrifugeId: SPOKE, phase: 'Onboarded', steps: [0, 1, 3], facadeFails: true },
    ])
    const unreadable = await refusal(unread.centrifuge._migrationGate(POOL_ID, 'requestDeposit', onSpoke))
    expect(unreadable.gate).to.include({ centrifugeId: SPOKE, phase: null, verdict: null, allowedActions: null })
    expect(unreadable.gate!.reason).to.contain('facade unreachable')
    sinon.restore()

    const disagree = migrating('Armed', [{ centrifugeId: SPOKE, phase: 'Frozen', steps: [0, 1], facadeGeneration: 2 }])
    const mismatch = await refusal(disagree.centrifuge._migrationGate(POOL_ID, 'claimDeposit', onSpoke))
    expect(mismatch.gate).to.include({ centrifugeId: SPOKE, phase: null, verdict: null, allowedActions: null })
    expect(mismatch.gate!.reason).to.contain('disagree')
    expect(mismatch.message).to.not.contain('Allowed')
  })

  it('judges the hub chain from the hub phase when it has no row of its own', async () => {
    const armed = migrating('Armed', [{ centrifugeId: SPOKE, phase: 'Frozen', steps: [0, 1] }])
    await armed.centrifuge._migrationGate(POOL_ID, 'updateSharePrice', [{}])
    const p1 = await refusal(armed.centrifuge._migrationGate(POOL_ID, 'deployVault', [{}]))
    expect(p1.gate).to.include({ centrifugeId: HUB, phase: 'P1', verdict: 'R' })
    sinon.restore()

    const onboarded = migrating('HubOnboarded', [{ centrifugeId: SPOKE, phase: 'Offboarded', steps: [0, 1, 3] }])
    const p4 = await refusal(onboarded.centrifuge._migrationGate(POOL_ID, 'updateSharePrice', []))
    expect(p4.gate).to.include({ centrifugeId: HUB, phase: 'P4', verdict: 'C' })
    sinon.restore()

    const activated = migrating('Activated', [
      { centrifugeId: SPOKE, phase: 'Onboarded', steps: [0, 1, 3], restored: false },
    ])
    await activated.centrifuge._migrationGate(POOL_ID, 'updatePoolManagers', [])
    await activated.centrifuge._migrationGate(POOL_ID, 'deployVault', [{ centrifugeId: HUB }])
  })

  it('passes a network that is not part of the migration', async () => {
    const { centrifuge } = migrating('Armed', [{ centrifugeId: SPOKE, phase: 'Frozen', steps: [0, 1] }])
    await centrifuge._migrationGate(POOL_ID, 'requestDeposit', [{ centrifugeId: OTHER }])
    await centrifuge._migrationGate(POOL_ID, 'crosschainTransferShares', [
      { centrifugeId: OTHER, destinationCentrifugeId: OTHER + 1 },
    ])
  })

  it('judges every spoke a write names', async () => {
    const { centrifuge } = migrating('Armed', [
      { centrifugeId: SPOKE, phase: 'Armed', steps: [0] },
      { centrifugeId: OTHER, phase: 'Frozen', steps: [0, 1] },
    ])
    await centrifuge._migrationGate(POOL_ID, 'updateMember', [{ centrifugeId: SPOKE }, { centrifugeId: OTHER }])
    const error = await refusal(
      centrifuge._migrationGate(POOL_ID, 'requestDeposit', [{ centrifugeId: SPOKE }, { centrifugeId: OTHER }])
    )
    expect(error.gate).to.include({ centrifugeId: OTHER, phase: 'P2' })
  })

  describe('pool.isAllowed', () => {
    /** What `_migrationGate` decides, as the answer `pool.isAllowed` gives. */
    const gateAnswer = async (centrifuge: Centrifuge, action: string, targets: MigrationGateTarget[]) => {
      try {
        await centrifuge._migrationGate(POOL_ID, action, targets)
        return { allowed: true }
      } catch (error) {
        expect(error).to.be.instanceOf(PoolMigratingError)
        return { allowed: false, code: 'POOL_MIGRATING', ...(error as PoolMigratingError).gate }
      }
    }
    const actions = [
      'requestDeposit',
      'cancelRedeemRequest',
      'claimDeposit',
      'approveDeposits',
      'notifyDeposit',
      'updateSharePrice',
      'updateMember',
      'deployVault',
      'updatePoolManagers',
      'setPoolMetadata',
      MIGRATION_ACTION.syncDeposit,
      MIGRATION_ACTION.bridgeToward,
      MIGRATION_ACTION.shareTransfer,
    ]
    const hubWithoutRow: Record<'P1' | 'P4' | 'P6', () => ReturnType<typeof migrating>> = {
      P1: () => migrating('Armed', [{ centrifugeId: SPOKE, phase: 'Frozen', steps: [0, 1] }]),
      P4: () => migrating('HubOnboarded', [{ centrifugeId: SPOKE, phase: 'Offboarded', steps: [0, 1, 3] }]),
      P6: () => migrating('Activated', [{ centrifugeId: SPOKE, phase: 'Onboarded', steps: [0, 1, 3], restored: true }]),
    }
    const cases: [string, () => ReturnType<typeof migrating>][] = [
      ...Object.entries(PHASES),
      ...Object.entries(hubWithoutRow).map(([phase, run]): [string, typeof run] => [
        `${phase}, hub without a row`,
        run,
      ]),
    ]
    for (const [name, run] of cases) {
      it(`agrees with the gate in ${name} on the hub, a spoke and a bridge`, async () => {
        const { centrifuge } = run()
        const pool = new Pool(centrifuge, POOL_ID)
        for (const centrifugeId of [HUB, SPOKE]) {
          for (const action of actions) {
            const answer = await pool.isAllowed(action, centrifugeId)
            expect(answer, `${action} on ${centrifugeId}`).to.deep.equal(
              await gateAnswer(centrifuge, action, [{ centrifugeId }])
            )
          }
        }
        for (const [source, destination] of [
          [HUB, SPOKE],
          [SPOKE, HUB],
        ] as const) {
          for (const action of ['crosschainTransferShares', MIGRATION_ACTION.bridgeOut]) {
            const answer = await pool.isAllowed(action, source, { destinationCentrifugeId: destination })
            expect(answer, `${action} ${source} -> ${destination}`).to.deep.equal(
              await gateAnswer(centrifuge, action, [{ centrifugeId: source, destinationCentrifugeId: destination }])
            )
          }
        }
      })
    }

    it('answers the refusal the gate throws, phase and allowed actions included', async () => {
      const { centrifuge } = hubWithoutRow.P1()
      const answer = await new Pool(centrifuge, POOL_ID).isAllowed('deployVault', HUB)
      expect(answer).to.deep.include({ allowed: false, code: 'POOL_MIGRATING', centrifugeId: HUB, phase: 'P1' })
      const error = await refusal(centrifuge._migrationGate(POOL_ID, 'deployVault', [{ centrifugeId: HUB }]))
      expect(answer).to.deep.equal({ allowed: false, code: 'POOL_MIGRATING', ...error.gate })
    })

    it('answers a disagreeing history as a refusal without a phase, and a pool that never armed as allowed', async () => {
      const disagree = migrating('Armed', [
        { centrifugeId: SPOKE, phase: 'Frozen', steps: [0, 1], facadeGeneration: 2 },
      ])
      expect(await new Pool(disagree.centrifuge, POOL_ID).isAllowed('claimDeposit', SPOKE)).to.deep.include({
        allowed: false,
        phase: null,
        verdict: null,
        allowedActions: null,
      })
      sinon.restore()

      const never = new Centrifuge({ environment: 'testnet' })
      sinon.stub(never as any, '_queryData').throws(new Error('must not read'))
      facadeReads(never, 'None')
      expect(await new Pool(never, POOL_ID).isAllowed('requestDeposit', SPOKE)).to.deep.equal({ allowed: true })
    })

    it('exports the gate from the package root', () => {
      expect(exported.isAllowed).to.equal(isAllowed)
      expect(exported.isBridgeAllowed).to.equal(isBridgeAllowed)
      expect(exported.isActionAllowed).to.equal(isActionAllowed)
      expect(exported.MIGRATION_ACTION).to.equal(MIGRATION_ACTION)
      expect(exported.SPOKE_GATE_STATE).to.equal(SPOKE_GATE_STATE)
      const state: exported.SpokeGateState = exported.SPOKE_GATE_STATE.live
      const answer: exported.GateAnswer = exported.isAllowed(state, exported.MIGRATION_ACTION.bridgeToward)
      expect(answer).to.deep.equal({ allowed: true })
    })
  })

  describe('the routed local build', () => {
    const local = () => {
      const calls = { built: 0 }
      const tx = { calls, build: () => of({ type: 'TransactionConfirmed' } as any) }
      return { calls, transaction: () => ((calls.built += 1), tx.build() as unknown as Transaction) }
    }

    it('refuses an unmapped action on a migrating pool before building, and builds it on one that is not', async () => {
      const blocked = PHASES.P4()
      const never = local()
      const error = await refusal(
        blocked.centrifuge._routeDeferredTransaction('createHolding', POOL_ID, async () => ({}), {
          title: 'Create holding',
          centrifugeId: HUB,
          gate: [],
          local: never.transaction,
        }) as unknown as Promise<unknown>
      )
      expect(error.gate).to.include({ action: 'createHolding', verdict: '?' })
      expect(never.calls.built).to.equal(0)
      sinon.restore()

      const { centrifuge } = migrating('None', [])
      const ok = local()
      await centrifuge._routeDeferredTransaction('createHolding', POOL_ID, async () => ({}), {
        title: 'Create holding',
        centrifugeId: HUB,
        gate: [],
        local: ok.transaction,
      })
      expect(ok.calls.built).to.equal(1)
    })

    it('builds an allowed action and refuses a blocked one before building', async () => {
      const allowed = PHASES.P2()
      const ok = local()
      await allowed.centrifuge._routeDeferredTransaction('updateMember', POOL_ID, async () => ({}), {
        title: 'Update member',
        centrifugeId: HUB,
        gate: onSpoke,
        local: ok.transaction,
      })
      expect(ok.calls.built).to.equal(1)
      sinon.restore()

      const blocked = PHASES.P4()
      const never = local()
      const error = await refusal(
        blocked.centrifuge._routeDeferredTransaction('updateMember', POOL_ID, async () => ({}), {
          title: 'Update member',
          centrifugeId: HUB,
          gate: onSpoke,
          local: never.transaction,
        }) as unknown as Promise<unknown>
      )
      expect(error.gate).to.include({ phase: 'P4', verdict: 'C' })
      expect(never.calls.built).to.equal(0)
    })

    it('keeps build-only through a candidate that resolves to the local path', async () => {
      const strategy: TxStrategy = { prepare: () => of({ route: 'custodial' } as unknown as PrepareOutcome) }
      const { centrifuge } = migrating(
        'Activated',
        [{ centrifugeId: SPOKE, phase: 'Onboarded', steps: [0, 1, 3], restored: true }],
        strategy
      )
      const routed = centrifuge._routeDeferredTransaction(
        {
          resolve: async () => 'updateBalanceSheetManagers',
          candidates: ['registerOnOffRamp', 'updateBalanceSheetManagers'],
        },
        POOL_ID,
        async () => ({}),
        {
          title: 'Register',
          centrifugeId: HUB,
          gate: onSpoke,
          routes: { registerOnOffRamp: 'backend', updateBalanceSheetManagers: 'local' },
          local: () =>
            centrifuge._transact(async function* (ctx) {
              yield* wrapTransaction('Register', ctx, { contract: ADDRESS, data: '0x1234' })
            }, HUB),
        }
      )
      const built = await centrifuge.buildOnly(routed)
      expect(built.data).to.equal('0x1234')
      expect(built.centrifugeId).to.equal(HUB)
    })

    it('judges candidates that share a gate row without resolving them', async () => {
      const { centrifuge } = PHASES.P5()
      const never = local()
      const error = await refusal(
        centrifuge._routeDeferredTransaction(
          {
            resolve: async () => {
              throw new Error('must not resolve')
            },
            candidates: ['registerOnOffRamp', 'updateBalanceSheetManagers'],
          },
          POOL_ID,
          async () => ({}),
          { title: 'Register', centrifugeId: HUB, gate: onSpoke, local: never.transaction }
        ) as unknown as Promise<unknown>
      )
      expect(error.gate).to.include({ action: 'spokeConfiguration', phase: 'P5', verdict: 'R' })
      expect(never.calls.built).to.equal(0)
    })
  })

  describe('a frozen spoke', () => {
    const vaultOn = (centrifuge: Centrifuge) => {
      const pool = new Pool(centrifuge, POOL_ID)
      return new Vault(
        centrifuge,
        new PoolNetwork(centrifuge, pool, SPOKE),
        new ShareClass(centrifuge, pool, SC_ID),
        ADDRESS,
        ADDRESS,
        AssetId.from(SPOKE, 1)
      )
    }

    it('refuses a deposit with the phase before anything is read for the build', async () => {
      const { centrifuge, reads } = PHASES.P2()
      const error = await refusal(centrifuge.buildOnly(vaultOn(centrifuge).asyncDeposit(Balance.fromFloat(1, 6))))
      expect(error.gate).to.include({ action: 'requestDeposit', phase: 'P2', centrifugeId: SPOKE })
      expect(reads).to.not.include('pools')
    })

    it('refuses a deposit before a signer is needed', async () => {
      const { centrifuge } = PHASES.P2()
      const error = await refusal(
        vaultOn(centrifuge).asyncDeposit(Balance.fromFloat(1, 6)) as unknown as Promise<unknown>
      )
      expect(error).to.not.be.instanceOf(WalletRequiredError)
      expect(error.gate).to.include({ action: 'requestDeposit', phase: 'P2' })
    })

    it('gates a share-class-only deploy and the hub-side claims', async () => {
      const { centrifuge } = PHASES.P2()
      const pool = new Pool(centrifuge, POOL_ID)
      const network = new PoolNetwork(centrifuge, pool, SPOKE)
      const deploy = await refusal(centrifuge.buildOnly(network.deploy([], [])))
      expect(deploy.gate).to.include({ action: 'notifyShareClass', phase: 'P2', centrifugeId: SPOKE })
      sinon.restore()

      const { centrifuge: offboarded } = PHASES.P3()
      const shareClass = new ShareClass(offboarded, new Pool(offboarded, POOL_ID), SC_ID)
      const claim = await refusal(
        shareClass.claimDeposit(AssetId.from(SPOKE, 1), ADDRESS) as unknown as Promise<unknown>
      )
      expect(claim.gate).to.include({ action: 'claimDeposit', phase: 'P3', centrifugeId: SPOKE })
      const redeem = await refusal(
        shareClass.claimRedeem(AssetId.from(SPOKE, 1), ADDRESS) as unknown as Promise<unknown>
      )
      expect(redeem.gate).to.include({ action: 'claimRedeem', phase: 'P3' })
    })

    it('lets a claim through to the build', async () => {
      const { centrifuge } = PHASES.P2()
      try {
        await centrifuge.buildOnly(vaultOn(centrifuge).claim())
      } catch (error) {
        expect(error).to.not.be.instanceOf(PoolMigratingError)
        expect((error as Error).message).to.match(/unexpected (catalogue )?read/)
        return
      }
      throw new Error('expected the build to reach a read')
    })
  })
})
