import {
  BuilderArgumentMismatchError,
  MessageTypeV3_3,
  ProtocolVersionResolutionError,
  type HubPhaseName,
  type OffboardSpokeInput,
  type OnboardSpokeInput,
  type SpokePhaseName,
} from '@centrifuge/protocol'
import { expect } from 'chai'
import { of, throwError } from 'rxjs'
import sinon from 'sinon'
import { zeroAddress } from 'viem'
import { Centrifuge } from '../Centrifuge.js'
import type { HexString } from '../types/index.js'
import { PoolId, ShareClassId, type CentrifugeId } from '../utils/types.js'
import {
  migratedPlan,
  BATCH_TOO_EXPENSIVE,
  MAX_TRANSACTION_GAS,
  batchCeiling,
  finalizeOffboardLength,
  freezeLength,
  GAS_LIMIT_PAD_PERCENT,
  migrationGasLimit,
  MigrationPlanner,
  nextActionOf,
  offboardSlice,
  onboardSlice,
  PAYLOAD_BUDGET,
  PRODUCTION_BUDGETS,
  type BatchCeiling,
  type MigrationPlanDriver,
  type PlanCall,
  type PlanSimulation,
  nothingToPlanReason,
} from './MigrationPlan.js'
import { deriveMigrationPlan } from './migrationPlanRead.js'
import type { MigrationPlan, UnreadableSpoke } from './MigrationPlan.js'
import { Pool } from './Pool.js'
import { migrationFacadeOf, migrationFingerprint, type PoolMigration } from './PoolMigration.js'

const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as HexString
const HUB = 1 as CentrifugeId
const SPOKE = 2 as CentrifugeId
const LOCAL = HUB
const POOL = PoolId.from(HUB, 7)
const MIGRATION = addr(0x33)
const OPERATOR = addr(0x0e)
const sc1 = ShareClassId.from(POOL, 1)

type World = {
  hubPhase: HubPhaseName
  spokePhase: Record<number, SpokePhaseName>
  armed: Record<number, boolean>
  installed: Record<string, boolean>
  freezeGeneration: Record<number, number>
  frozenGeneration: Record<number, number>
  parks: Record<number, string>
  inFlight?: Record<number, string>
  underpaid?: Record<number, string>
  unmatched?: Record<number, string>
  ignoreStepsInFlight?: boolean
  offboardStarted?: Record<number, boolean>
  simulate?: (call: PlanCall, after: readonly PlanCall[]) => PlanSimulation
  ceiling?: (cid: CentrifugeId) => BatchCeiling
  offboard?: OffboardSpokeInput
  rampIds?: bigint[]
  onboard?: OnboardSpokeInput
  hubTransactionGasLimit?: bigint
}

const emptyOffboard = (): OffboardSpokeInput => ({
  vaults: [],
  assets: [],
  balanceSheetManagers: [],
  gatewayManagers: [],
  scIds: [sc1.raw],
  assetIds: [],
  unlinkGas: '0',
  rotateGas: '0',
  managersGas: '0',
  finalizeGas: '0',
  finalize: true,
  totalVaults: '0',
  totalAssets: '0',
  totalManagers: '0',
})

const emptyOnboard = (): OnboardSpokeInput => ({
  scIds: [sc1.raw],
  seedQueueScIds: [sc1.raw],
  registerVaults: [],
  configureVaults: [],
  assetPrices: [],
  ramps: [],
  rampConfigs: [],
  hookManagers: [],
  linkGas: '0',
  registerGas: '0',
  configureGas: '0',
  hookManagersGas: '0',
  assetPriceGas: '0',
  spokeManagersGas: '0',
  seedGas: '0',
  seedQueueGas: '0',
  finalizeGas: '0',
  seedEscrow: true,
  finalize: true,
  totalTokens: '1',
  totalRegistered: '0',
  totalConfigured: '0',
  totalRamps: '0',
  totalHookGrants: '0',
  totalShareQueues: '1',
  totalAssetPrices: '0',
  totalRampConfigs: '0',
})

const okSim = (): PlanSimulation => ({ ok: true, revert: '0x', gasUsed: 100_000n, batches: [] })

function driver(world: World): MigrationPlanDriver & { simulated: PlanCall[]; quoted: MessageTypeV3_3[] } {
  const simulated: PlanCall[] = []
  const quoted: MessageTypeV3_3[] = []
  return {
    simulated,
    quoted,
    hubPhase: async () => world.hubPhase,
    spokePhase: async (cid) => world.spokePhase[cid] ?? 'none',
    spokeArmed: async (cid) => world.armed[cid] ?? false,
    armedSpokes: async () =>
      Object.entries(world.armed)
        .filter(([, v]) => v)
        .map(([k]) => Number(k) as CentrifugeId),
    poolAdaptersInstalled: async (on, toward) => world.installed[`${on}->${toward}`] ?? false,
    freezeGeneration: async (cid) => world.freezeGeneration[cid] ?? 0,
    frozenGeneration: async (cid) => world.frozenGeneration[cid] ?? 0,
    blockOf: async () => 100n,
    freezeInput: async () => ({ syncReserves: [{ scId: sc1.raw, asset: addr(0xa1) }] }),
    offboardInput: async () => world.offboard ?? emptyOffboard(),
    onboardSpokeInput: async () => world.onboard ?? emptyOnboard(),
    onboardHubInput: async () => ({ v32Admins: [], holdings: [], epochAssetIds: [], grants: [], noV32Spokes: false }),
    rampRegistrations: async () => ({ spoke: addr(0x55), accountingToken: addr(0x56), tokenIds: world.rampIds ?? [] }),
    spokeStepsBlock: async (cid) => ({
      stop: world.parks[cid] || world.underpaid?.[cid] || world.inFlight?.[cid] || '',
      warning: world.unmatched?.[cid] || '',
      parked: Boolean(world.parks[cid]),
      underpaid: !world.parks[cid] && Boolean(world.underpaid?.[cid]),
    }),
    offboardStarted: async (cid) => world.offboardStarted?.[cid] ?? false,
    vaultLinkMismatches: async () => [],
    epochIdMismatch: async () => '',
    simulate: async (call, after) => {
      simulated.push(call)
      return world.simulate ? world.simulate(call, after) : okSim()
    },
    ceiling: async (cid) => world.ceiling?.(cid) ?? batchCeiling(cid, 10_000_000n, 0n, 0n, 0n),
    quote: async (_on, destinations, message) => {
      quoted.push(message)
      return BigInt(destinations.length) * 1_000n
    },
    hubTransactionGasLimit: async () => world.hubTransactionGasLimit ?? 30_000_000n,
    build: (operation) => ({
      to: MIGRATION,
      data: `0x${operation.name.length.toString(16).padStart(8, '0')}` as HexString,
    }),
  }
}

function plan(world: World, spokes: CentrifugeId[] = [SPOKE], unreadableSpokes: UnreadableSpoke[] = []) {
  const d = driver(world)
  const planner = new MigrationPlanner(
    {
      poolId: POOL,
      migration: MIGRATION,
      operator: OPERATOR,
      hubCentrifugeId: HUB,
      spokeCentrifugeIds: spokes,
      unreadableSpokes,
      ignoreStepsInFlight: world.ignoreStepsInFlight,
    },
    d
  )
  return planner.run().then((result) => ({ result, d }))
}

const labels = (entries: { label: string }[]) => entries.map((entry) => entry.label)

describe('MigrationPlanner', () => {
  it('plans only initiateMigration on a fresh pool: lanes and the arm follow once it landed', async () => {
    const { result } = await plan({
      hubPhase: 'none',
      spokePhase: {},
      armed: {},
      installed: {},
      freezeGeneration: {},
      frozenGeneration: {},
      parks: {},
    })
    expect(labels(result.entries)).to.deep.equal(['initiateMigration'])
    expect(result.skips.find((skip) => skip.label === 'relayArm')!.reason).to.match(/not armed yet/)
    expect(result.complete).to.equal(true)
  })

  it('plans both lane sides once the hub is armed and holds the arm until both halves read installed', async () => {
    const missing = await plan({
      hubPhase: 'armed',
      spokePhase: {},
      armed: {},
      installed: {},
      freezeGeneration: {},
      frozenGeneration: {},
      parks: {},
    })
    expect(labels(missing.result.entries)).to.deep.equal([
      'installPoolAdapters (hub side)',
      'installPoolAdapters (spoke side)',
    ])
    expect(missing.result.entries[0]!.signer).to.equal('anyone')
    expect(missing.result.entries[1]!.executeOn).to.equal(SPOKE)
    expect(missing.result.skips.find((skip) => skip.label === 'relayArm')!.reason).to.match(/cid 2: hub and spoke side/)
    const halfway = await plan({
      hubPhase: 'armed',
      spokePhase: {},
      armed: {},
      installed: { '1->2': true },
      freezeGeneration: {},
      frozenGeneration: {},
      parks: {},
    })
    expect(halfway.result.skips.find((skip) => skip.label === 'relayArm')!.reason).to.match(/cid 2: spoke side/)
    const ready = await plan({
      hubPhase: 'armed',
      spokePhase: {},
      armed: {},
      installed: { '1->2': true, '2->1': true },
      freezeGeneration: {},
      frozenGeneration: {},
      parks: {},
    })
    expect(labels(ready.result.entries)).to.deep.equal(['relayArm'])
    expect(ready.result.entries[0]!.destinations).to.deep.equal([SPOKE])
    expect(ready.result.entries[0]!.value).to.equal(1_000n)
    expect((ready.result.entries[0]!.operation as any).args.value).to.equal(undefined)
  })

  it('skips what is already done and records why', async () => {
    const { result } = await plan({
      hubPhase: 'armed',
      spokePhase: { [SPOKE]: 'armed' },
      armed: { [SPOKE]: true },
      installed: { '1->2': true, '2->1': true },
      freezeGeneration: {},
      frozenGeneration: {},
      parks: {},
    })
    expect(labels(result.entries)).to.deep.equal(['relayFreeze'])
    expect(result.skips.map((skip) => skip.label)).to.include.members([
      'initiateMigration',
      'installPoolAdapters (hub side)',
      'relayArm',
      'onboardHub',
      'activate',
    ])
    expect(result.entries[0]).to.include({ requiredHubPhase: 'armed', requiredSpokePhase: 'armed', phase: 'freeze' })
  })

  it('stops a freeze while the hub generation is ahead of the spoke, and carries on with the others', async () => {
    const other = 3 as CentrifugeId
    const { result } = await plan(
      {
        hubPhase: 'armed',
        spokePhase: { [SPOKE]: 'armed', [other]: 'armed' },
        armed: { [SPOKE]: true, [other]: true },
        installed: { '1->2': true, '2->1': true, '1->3': true, '3->1': true },
        freezeGeneration: { [SPOKE]: 1 },
        frozenGeneration: { [SPOKE]: 0 },
        parks: {},
      },
      [SPOKE, other]
    )
    expect(result.stops).to.have.length(1)
    expect(result.stops[0]).to.include({ label: 'relayFreeze', centrifugeId: SPOKE, hub: false })
    expect(result.stops[0]!.reason).to.match(/in flight or parked/)
    expect(labels(result.entries)).to.deep.equal(['relayFreeze'])
    expect(result.entries[0]!.concerns).to.equal(other)
    expect(result.complete).to.equal(false)
  })

  it('plans no freeze while an armed spoke still reads None', async () => {
    const other = 3 as CentrifugeId
    const { result } = await plan(
      {
        hubPhase: 'armed',
        spokePhase: { [SPOKE]: 'armed', [other]: 'none' },
        armed: { [SPOKE]: true, [other]: true },
        installed: { '1->2': true, '2->1': true, '1->3': true, '3->1': true },
        freezeGeneration: {},
        frozenGeneration: {},
        parks: {},
      },
      [SPOKE, other]
    )
    expect(result.stops[0]!.reason).to.match(/its Arm is in flight or parked/)
  })

  describe('the first offboard waits until every armed spoke is frozen', () => {
    const OTHER = 3 as CentrifugeId
    const twoSpokes = (over: Partial<World>): World => ({
      hubPhase: 'armed',
      spokePhase: { [SPOKE]: 'frozen', [OTHER]: 'frozen' },
      armed: { [SPOKE]: true, [OTHER]: true },
      installed: { '1->2': true, '2->1': true, '1->3': true, '3->1': true },
      freezeGeneration: { [SPOKE]: 1, [OTHER]: 1 },
      frozenGeneration: { [SPOKE]: 1, [OTHER]: 1 },
      parks: {},
      ...over,
    })
    const offboardStop = (result: MigrationPlan, cid: CentrifugeId) =>
      result.stops.find((stop) => stop.label === 'relayOffboard' && stop.centrifugeId === cid)

    it('offers the offboard toward each spoke once both are frozen at the current generation', async () => {
      const { result } = await plan(twoSpokes({}), [SPOKE, OTHER])
      expect(labels(result.entries)).to.deep.equal(['relayOffboard', 'relayOffboard'])
    })

    it('holds it while the Freeze toward the other spoke is in flight, naming that spoke', async () => {
      const { result } = await plan(
        twoSpokes({
          spokePhase: { [SPOKE]: 'frozen', [OTHER]: 'armed' },
          frozenGeneration: { [SPOKE]: 1, [OTHER]: 0 },
        }),
        [SPOKE, OTHER]
      )
      expect(labels(result.entries)).to.deep.equal([])
      expect(offboardStop(result, SPOKE)!.reason).to.match(
        /^spoke cid 3 reads Armed while the hub sent Freeze generation 1: its Freeze is in flight/
      )
    })

    it('holds it while the other spoke was never frozen, and still offers that Freeze', async () => {
      const { result } = await plan(
        twoSpokes({
          spokePhase: { [SPOKE]: 'frozen', [OTHER]: 'armed' },
          freezeGeneration: { [SPOKE]: 1, [OTHER]: 0 },
          frozenGeneration: { [SPOKE]: 1, [OTHER]: 0 },
        }),
        [SPOKE, OTHER]
      )
      expect(labels(result.entries)).to.deep.equal(['relayFreeze'])
      expect(offboardStop(result, SPOKE)!.reason).to.match(/^spoke cid 3 reads Armed and was never frozen/)
    })

    it('holds it while the other spoke reads Armed again after an Abort, which equal generations would miss', async () => {
      const { result } = await plan(
        twoSpokes({
          spokePhase: { [SPOKE]: 'frozen', [OTHER]: 'armed' },
          freezeGeneration: { [SPOKE]: 1, [OTHER]: 2 },
          frozenGeneration: { [SPOKE]: 1, [OTHER]: 2 },
        }),
        [SPOKE, OTHER]
      )
      expect(offboardStop(result, SPOKE)!.reason).to.match(/^spoke cid 3 reads Armed again after an Abort/)
    })

    it('holds it while an Abort or re-freeze toward the other spoke is in flight', async () => {
      const { result } = await plan(
        twoSpokes({ freezeGeneration: { [SPOKE]: 1, [OTHER]: 2 }, frozenGeneration: { [SPOKE]: 1, [OTHER]: 1 } }),
        [SPOKE, OTHER]
      )
      expect(offboardStop(result, SPOKE)!.reason).to.match(
        /^spoke cid 3 is frozen at generation 1 while the hub's current freeze is generation 2/
      )
    })

    it('does not hold the rest of an offboard that has started, nor wait on a spoke already offboarded', async () => {
      const started = await plan(
        twoSpokes({
          spokePhase: { [SPOKE]: 'frozen', [OTHER]: 'armed' },
          frozenGeneration: { [SPOKE]: 1, [OTHER]: 0 },
          offboardStarted: { [SPOKE]: true },
        }),
        [SPOKE, OTHER]
      )
      expect(offboardStop(started.result, SPOKE)).to.equal(undefined)
      expect(labels(started.result.entries)).to.deep.equal(['relayOffboard'])
      const past = await plan(twoSpokes({ spokePhase: { [SPOKE]: 'frozen', [OTHER]: 'offboarded' } }), [SPOKE, OTHER])
      expect(offboardStop(past.result, SPOKE)).to.equal(undefined)
    })
  })

  it('refuses to derive an offboard for a spoke with a parked message', async () => {
    const { result } = await plan({
      hubPhase: 'armed',
      spokePhase: { [SPOKE]: 'frozen' },
      armed: { [SPOKE]: true },
      installed: { '1->2': true, '2->1': true },
      freezeGeneration: {},
      frozenGeneration: {},
      parks: { [SPOKE]: 'step unlinkVaults parked: VaultNotWardedOnV32' },
    })
    expect(result.entries).to.have.length(0)
    expect(result.stops[0]).to.include({ label: 'relayOffboard', centrifugeId: SPOKE })
  })

  it('refuses to derive an offboard while a step toward the spoke is still in flight', async () => {
    const { result } = await plan({
      hubPhase: 'armed',
      spokePhase: { [SPOKE]: 'frozen' },
      armed: { [SPOKE]: true },
      installed: { '1->2': true, '2->1': true },
      freezeGeneration: {},
      frozenGeneration: {},
      parks: {},
      inFlight: { [SPOKE]: 'step unlinkVaults relayed in 0xabc is still in flight' },
    })
    expect(result.entries).to.have.length(0)
    expect(result.stops).to.have.length(1)
    expect(result.stops[0]).to.include({ label: 'relayOffboard', centrifugeId: SPOKE, hub: false })
    expect(result.stops[0]!.reason).to.match(/still in flight/)
    expect(result.complete).to.equal(false)
  })

  it('plans past an unmatched step with a warning, and past a step in flight when told to ignore it', async () => {
    const world: World = {
      hubPhase: 'armed',
      spokePhase: { [SPOKE]: 'frozen' },
      armed: { [SPOKE]: true },
      installed: { '1->2': true, '2->1': true },
      freezeGeneration: {},
      frozenGeneration: {},
      parks: {},
      unmatched: { [SPOKE]: 'unlinkVaults relayed in 0xabc has no gateway message matched to it' },
    }
    const warned = await plan(world)
    expect(labels(warned.result.entries)).to.deep.equal(['relayOffboard'])
    expect(warned.result.stops).to.have.length(0)
    expect(warned.result.warnings).to.deep.equal([
      `relayOffboard cid ${SPOKE} - unlinkVaults relayed in 0xabc has no gateway message matched to it`,
    ])
    const ignored = await plan({
      ...world,
      unmatched: {},
      inFlight: { [SPOKE]: 'unlinkVaults relayed in 0xabc is still in flight' },
      ignoreStepsInFlight: true,
    })
    expect(labels(ignored.result.entries)).to.deep.equal(['relayOffboard'])
    expect(ignored.result.stops).to.have.length(0)
    expect(ignored.result.warnings[0]).to.match(/still in flight \(ignoreStepsInFlight: planned anyway\)$/)
    const parked = await plan({
      ...world,
      unmatched: {},
      parks: { [SPOKE]: 'unlinkVaults parked: WrongSpokePhase' },
      ignoreStepsInFlight: true,
    })
    expect(parked.result.entries).to.have.length(0)
    expect(parked.result.stops).to.deep.equal([
      { label: 'relayOffboard', centrifugeId: SPOKE, reason: 'unlinkVaults parked: WrongSpokePhase', hub: false },
    ])
    const underpaid = await plan({
      ...world,
      unmatched: {},
      underpaid: { [SPOKE]: 'unlinkVaults relayed in 0xabc sits in a batch the hub Gateway holds underpaid' },
      ignoreStepsInFlight: true,
    })
    expect(underpaid.result.entries).to.have.length(0)
    expect(underpaid.result.stops).to.deep.equal([
      {
        label: 'relayOffboard',
        centrifugeId: SPOKE,
        reason: 'unlinkVaults relayed in 0xabc sits in a batch the hub Gateway holds underpaid',
        hub: false,
      },
    ])
    expect(underpaid.result.warnings).to.have.length(0)
  })

  it('refuses to derive a spoke onboard while a step toward the spoke is still in flight', async () => {
    const { result } = await plan({
      hubPhase: 'hubOnboarded',
      spokePhase: { [SPOKE]: 'offboarded' },
      armed: { [SPOKE]: true },
      installed: { '1->2': true, '2->1': true },
      freezeGeneration: {},
      frozenGeneration: {},
      parks: {},
      inFlight: { [SPOKE]: 'step linkTokens relayed in 0xabc is still in flight' },
    })
    expect(result.entries).to.have.length(0)
    expect(result.stops).to.have.length(1)
    expect(result.stops[0]).to.include({ label: 'relayOnboardSpoke', centrifugeId: SPOKE, hub: false })
    expect(result.stops[0]!.reason).to.match(/still in flight/)
    expect(result.complete).to.equal(false)
  })

  it('slices an offboard where the gateway refuses the whole, numbers the slices and keeps the finalize apart', async () => {
    const offboard: OffboardSpokeInput = {
      ...emptyOffboard(),
      vaults: [1, 2, 3, 4].map((i) => ({ scId: sc1.raw, assetId: String(i), vault: addr(0xd0 + i) })),
      balanceSheetManagers: [addr(0xb1), addr(0xb2)],
      totalVaults: '4',
      totalManagers: '2',
    }
    const { result, d } = await plan({
      hubPhase: 'armed',
      spokePhase: { [SPOKE]: 'frozen' },
      armed: { [SPOKE]: true },
      installed: { '1->2': true, '2->1': true },
      freezeGeneration: {},
      frozenGeneration: {},
      parks: {},
      offboard,
      simulate: (call) => {
        const input = (call.operation as any)?.args?.input as OffboardSpokeInput | undefined
        const items = input ? input.vaults.length + input.balanceSheetManagers.length : 0
        return items > 3 ? { ok: false, revert: BATCH_TOO_EXPENSIVE as HexString, gasUsed: 0n, batches: [] } : okSim()
      },
    })
    expect(labels(result.entries)).to.deep.equal([
      'relayOffboard slice 1',
      'relayOffboard slice 2',
      'relayOffboard slice 3',
    ])
    expect(result.entries.map((entry) => entry.slice)).to.deep.equal([
      { index: 1, count: 3 },
      { index: 2, count: 3 },
      { index: 3, count: 3 },
    ])
    const sliced = d.simulated
      .filter((call) => call.label.startsWith('relayOffboard'))
      .map((call) => {
        const input = (call.operation as any).args.input as OffboardSpokeInput
        return [input.vaults.length, input.balanceSheetManagers.length, input.finalize]
      })
    expect(sliced[0]).to.deep.equal([4, 2, false])
    expect(sliced[1]).to.deep.equal([3, 0, false])
    expect(sliced.at(-1)).to.deep.equal([0, 0, true])
    const last = (result.entries.at(-1)!.operation as any).args.input as OffboardSpokeInput
    expect(last).to.include({ finalize: true, totalVaults: '4', totalManagers: '2' })
    expect(result.bundles.map((bundle) => bundle.entries)).to.deep.equal([[0], [1], [2]])
  })

  it('simulates each slice after the slices before it, so a finalize that needs them does not revert', async () => {
    const offboard: OffboardSpokeInput = {
      ...emptyOffboard(),
      vaults: [1, 2].map((i) => ({ scId: sc1.raw, assetId: String(i), vault: addr(0xd0 + i) })),
      totalVaults: '2',
    }
    const { result } = await plan({
      hubPhase: 'armed',
      spokePhase: { [SPOKE]: 'frozen' },
      armed: { [SPOKE]: true },
      installed: { '1->2': true, '2->1': true },
      freezeGeneration: {},
      frozenGeneration: {},
      parks: {},
      offboard,
      simulate: (call, after) => {
        const input = (call.operation as any)?.args?.input as OffboardSpokeInput | undefined
        if (input?.finalize) {
          const sent = after.reduce(
            (n, c) => n + ((c.operation as any).args.input as OffboardSpokeInput).vaults.length,
            0
          )
          return sent === 2 ? okSim() : { ok: false, revert: '0xdeadbeef', gasUsed: 0n, batches: [] }
        }
        return input && input.vaults.length > 1
          ? { ok: false, revert: BATCH_TOO_EXPENSIVE as HexString, gasUsed: 0n, batches: [] }
          : okSim()
      },
    })
    expect(labels(result.entries)).to.deep.equal([
      'relayOffboard slice 1',
      'relayOffboard slice 2',
      'relayOffboard slice 3',
    ])
    expect(result.stops).to.have.length(0)
  })

  it('never slices a same-chain spoke', async () => {
    const offboard: OffboardSpokeInput = {
      ...emptyOffboard(),
      vaults: [1, 2, 3].map((i) => ({ scId: sc1.raw, assetId: String(i), vault: addr(0xd0 + i) })),
      totalVaults: '3',
    }
    const { result } = await plan(
      {
        hubPhase: 'armed',
        spokePhase: { [LOCAL]: 'frozen' },
        armed: { [LOCAL]: true },
        installed: {},
        freezeGeneration: {},
        frozenGeneration: {},
        parks: {},
        offboard,
        simulate: () => ({ ok: false, revert: BATCH_TOO_EXPENSIVE as HexString, gasUsed: 0n, batches: [] }),
      },
      [LOCAL]
    )
    expect(result.entries).to.have.length(0)
    expect(result.stops[0]!.reason).to.match(/BatchTooExpensive/)
    expect(result.skips.find((skip) => skip.label === 'installPoolAdapters')!.reason).to.match(/same-chain/)
  })

  it('marks a batch over the small block of a dual-block destination as a manual delivery and bundles it alone', async () => {
    const { result } = await plan({
      hubPhase: 'armed',
      spokePhase: { [SPOKE]: 'armed' },
      armed: { [SPOKE]: true },
      installed: { '1->2': true, '2->1': true },
      freezeGeneration: {},
      frozenGeneration: {},
      parks: {},
      simulate: () => ({
        ok: true,
        revert: '0x',
        gasUsed: 1n,
        batches: [{ centrifugeId: SPOKE, gasLimit: 4_000_000n }],
      }),
      ceiling: (cid) => batchCeiling(cid, 10_000_000n, 30_000_000n, 3_000_000n, 0n),
    })
    expect(result.entries[0]).to.include({ manualDelivery: true, batchGas: 4_000_000n, binds: 'maxBatchGasLimit' })
    expect(result.bundles).to.deep.equal([{ phase: 'freeze', executeOn: HUB, entries: [0], gas: 1n, value: 1_000n }])
  })

  it('onboards the hub only once every armed spoke is offboarded, and activates only once every one is onboarded', async () => {
    const waiting = await plan({
      hubPhase: 'armed',
      spokePhase: { [SPOKE]: 'frozen' },
      armed: { [SPOKE]: true },
      installed: { '1->2': true, '2->1': true },
      freezeGeneration: {},
      frozenGeneration: {},
      parks: {},
    })
    expect(waiting.result.skips.find((skip) => skip.label === 'onboardHub')!.reason).to.match(/not every armed spoke/)
    const ready = await plan({
      hubPhase: 'armed',
      spokePhase: { [SPOKE]: 'offboarded' },
      armed: { [SPOKE]: true },
      installed: { '1->2': true, '2->1': true },
      freezeGeneration: {},
      frozenGeneration: {},
      parks: {},
    })
    expect(labels(ready.result.entries)).to.deep.equal(['onboardHub'])
    expect(ready.result.entries[0]!.destinations).to.deep.equal([SPOKE])
    const activate = await plan({
      hubPhase: 'hubOnboarded',
      spokePhase: { [SPOKE]: 'onboarded' },
      armed: { [SPOKE]: true },
      installed: { '1->2': true, '2->1': true },
      freezeGeneration: {},
      frozenGeneration: {},
      parks: {},
    })
    expect(labels(activate.result.entries)).to.deep.equal(['activate'])
    expect((activate.result.entries[0]!.operation as any).args.spokeCentrifugeIds).to.deep.equal([SPOKE])
  })

  it('onboards a remote spoke in two windows, classes first, then the finalize', async () => {
    const onboard: OnboardSpokeInput = {
      ...emptyOnboard(),
      registerVaults: [{ scId: sc1.raw, assetId: '1', factory: addr(0xf0), vault: addr(0xd1), link: true }],
      configureVaults: [{ scId: sc1.raw, assetId: '1', factory: addr(0xf0), vault: addr(0xd1), link: true }],
      totalRegistered: '1',
      totalConfigured: '1',
    }
    const { result, d } = await plan({
      hubPhase: 'hubOnboarded',
      spokePhase: { [SPOKE]: 'offboarded' },
      armed: { [SPOKE]: true },
      installed: { '1->2': true, '2->1': true },
      freezeGeneration: {},
      frozenGeneration: {},
      parks: {},
      onboard,
    })
    expect(labels(result.entries)).to.deep.equal([
      'relayOnboardSpoke slice 1',
      'relayOnboardSpoke slice 2',
      'relayOnboardSpoke slice 3',
    ])
    const parts = d.simulated.map((call) => (call.operation as any).args.input as OnboardSpokeInput)
    expect(parts[0]!.scIds).to.deep.equal([sc1.raw])
    expect(parts[0]!.registerVaults).to.have.length(0)
    expect(parts[1]!.registerVaults).to.have.length(1)
    expect(parts[2]).to.include({ finalize: true, seedEscrow: true, totalRegistered: '1' })
    expect(result.bundles.map((bundle) => bundle.entries)).to.deep.equal([[0, 1], [2]])
  })

  it('flags a manual delivery on any destination over its own small block, not only the largest batch', async () => {
    const hyper = 9 as CentrifugeId
    const { result } = await plan(
      {
        hubPhase: 'armed',
        spokePhase: {},
        armed: {},
        installed: { '1->2': true, '2->1': true, '1->9': true, '9->1': true },
        freezeGeneration: {},
        frozenGeneration: {},
        parks: {},
        simulate: () => ({
          ok: true,
          revert: '0x',
          gasUsed: 1n,
          batches: [
            { centrifugeId: SPOKE, gasLimit: 8_000_000n },
            { centrifugeId: hyper, gasLimit: 3_500_000n },
          ],
        }),
        ceiling: (cid) =>
          cid === hyper
            ? batchCeiling(cid, 10_000_000n, 30_000_000n, 3_000_000n, 0n)
            : batchCeiling(cid, 10_000_000n, 0n, 0n, 0n),
      },
      [SPOKE, hyper]
    )
    expect(labels(result.entries)).to.deep.equal(['relayArm'])
    expect(result.entries[0]).to.include({ manualDelivery: true, batchGas: 8_000_000n })
  })

  it('plans a registerAsset entry per missing ramp accounting id, priced as a RegisterAsset message', async () => {
    const { result, d } = await plan({
      hubPhase: 'armed',
      spokePhase: { [SPOKE]: 'offboarded' },
      armed: { [SPOKE]: true },
      installed: { '1->2': true, '2->1': true },
      freezeGeneration: { [SPOKE]: 1 },
      frozenGeneration: { [SPOKE]: 1 },
      parks: {},
      rampIds: [7n, 8n],
    })
    const registrations = result.entries.filter((entry) => entry.label.startsWith('registerAsset'))
    expect(registrations).to.have.length(2)
    expect(registrations[0]).to.include({
      executeOn: SPOKE,
      signer: 'anyone',
      operation: null,
      to: addr(0x55),
      value: 1_000n,
    })
    expect(d.quoted).to.include(MessageTypeV3_3.RegisterAsset)
  })

  it('stops a spoke whose simulation could not run, with the reason, instead of failing the plan', async () => {
    const { result } = await plan({
      hubPhase: 'armed',
      spokePhase: { [SPOKE]: 'armed' },
      armed: { [SPOKE]: true },
      installed: { '1->2': true, '2->1': true },
      freezeGeneration: {},
      frozenGeneration: {},
      parks: {},
      simulate: () => ({
        ok: false,
        revert: '0x',
        error: 'the simulation of relayFreeze after 0 earlier call(s) could not run: block gas limit reached',
        gasUsed: 0n,
        batches: [],
      }),
    })
    expect(result.entries).to.deep.equal([])
    expect(result.stops[0]!.reason).to.match(/could not run: block gas limit reached/)
    expect(result.complete).to.equal(false)
  })

  describe('bundle gas limit', () => {
    // Two relayFreeze entries on the hub, one per spoke, each simulating at the gas given for its spoke.
    const freezes = async (gas: [bigint, bigint], hubTransactionGasLimit?: bigint) => {
      const gasOf: Record<number, bigint> = { [SPOKE]: gas[0], 3: gas[1] }
      const { result } = await plan(
        {
          hubPhase: 'armed',
          spokePhase: { [SPOKE]: 'armed', 3: 'armed' },
          armed: { [SPOKE]: true, 3: true },
          installed: { '1->2': true, '2->1': true, '1->3': true, '3->1': true },
          freezeGeneration: {},
          frozenGeneration: {},
          parks: {},
          hubTransactionGasLimit,
          simulate: (call): PlanSimulation => ({
            ok: true,
            revert: '0x',
            gasUsed: gasOf[call.centrifugeId]!,
            batches: [],
          }),
        },
        [SPOKE, 3 as CentrifugeId]
      )
      expect(labels(result.entries)).to.deep.equal(['relayFreeze', 'relayFreeze'])
      return result.bundles.map((bundle) => bundle.entries)
    }

    it('keeps 90% of the per-transaction cap after the 1.3x gas pad: 11,614,995 on a 2^24 block', async () => {
      expect(await freezes([5_807_497n, 5_807_497n])).to.deep.equal([[0, 1]])
      expect(await freezes([5_807_497n, 5_807_498n])).to.deep.equal([[0, 1]])
      expect(await freezes([5_807_498n, 5_807_498n])).to.deep.equal([[0], [1]])
    })

    it('lowers the limit in the same ratio on a hub block under the per-transaction cap', async () => {
      expect(await freezes([4_500_000n, 4_500_000n], 13_000_000n)).to.deep.equal([[0, 1]])
      expect(await freezes([4_500_000n, 4_500_001n], 13_000_000n)).to.deep.equal([[0], [1]])
    })
  })

  it('reads a zero configured limit as not tightening and caps bundles at the per-transaction gas', () => {
    expect(MAX_TRANSACTION_GAS).to.equal(16_777_216n)
    expect(GAS_LIMIT_PAD_PERCENT).to.equal(130n)
    expect(batchCeiling(SPOKE, 0n, 30_000_000n, 0n, 0n)).to.include({
      ceiling: 30_000_000n,
      binds: 'destination block',
    })
    expect(batchCeiling(SPOKE, 0n, 0n, 0n, 0n).ceiling).to.equal(0n)
  })

  describe('migrationGasLimit', () => {
    it('declares the padded gas while it fits under the per-transaction cap', () => {
      expect(migrationGasLimit(10_000_000n)).to.equal(13_000_000n)
    })

    it('holds the limit at the cap when only the pad would cross it, since the whole call fits there on any chain', () => {
      expect(migrationGasLimit(14_000_000n)).to.equal(MAX_TRANSACTION_GAS)
      expect(migrationGasLimit(MAX_TRANSACTION_GAS)).to.equal(MAX_TRANSACTION_GAS)
    })

    it('declares the padded gas above the cap for a call that needs more, as an EIP-8037 chain draws state gas above it', () => {
      expect(migrationGasLimit(18_017_536n)).to.equal(23_422_796n)
      expect(migrationGasLimit(MAX_TRANSACTION_GAS + 1n)).to.equal(((MAX_TRANSACTION_GAS + 1n) * 130n) / 100n)
    })
  })

  it('names the next action from the plan, else the wait, else nothing', async () => {
    const { result } = await plan({
      hubPhase: 'none',
      spokePhase: {},
      armed: {},
      installed: {},
      freezeGeneration: {},
      frozenGeneration: {},
      parks: {},
    })
    expect(nextActionOf(result, [])).to.deep.equal({
      step: 'arm',
      on: 'hub',
      chain: HUB,
      label: 'initiateMigration',
      signer: 'operator',
      entry: 0,
    })
    const lanes = await plan({
      hubPhase: 'armed',
      spokePhase: {},
      armed: {},
      installed: {},
      freezeGeneration: {},
      frozenGeneration: {},
      parks: {},
    })
    expect(nextActionOf(lanes.result, [])).to.include({ step: 'lanes', on: SPOKE, chain: HUB })
    expect(nextActionOf({ ...lanes.result, entries: lanes.result.entries.slice(1) }, [])).to.include({
      step: 'lanes',
      on: SPOKE,
      chain: SPOKE,
      label: 'installPoolAdapters (spoke side)',
    })
    expect(lanes.result.entries.map((entry) => entry.concerns)).to.deep.equal([SPOKE, SPOKE])
    const blockedLane = await plan({
      hubPhase: 'armed',
      spokePhase: {},
      armed: {},
      installed: { '1->2': true },
      freezeGeneration: {},
      frozenGeneration: {},
      parks: {},
      simulate: (call) =>
        call.label === 'installPoolAdapters (spoke side)'
          ? { ok: false, revert: '0x' as HexString, gasUsed: 0n, batches: [], error: 'NoPoolAdapters' }
          : okSim(),
    })
    expect(blockedLane.result.entries).to.have.length(0)
    expect(blockedLane.result.stops).to.deep.equal([
      { label: 'installPoolAdapters (spoke side)', centrifugeId: SPOKE, reason: 'NoPoolAdapters', hub: false },
    ])
    expect(blockedLane.result.skips.find((skip) => skip.label === 'installPoolAdapters (hub side)')).to.include({
      centrifugeId: SPOKE,
      reason: 'lane already installed',
    })
    expect(
      blockedLane.result.skips.find((skip) => skip.label === 'relayArm' && skip.centrifugeId === SPOKE)!.reason
    ).to.match(/stopped on its lane/)
    expect(nextActionOf(blockedLane.result, [])).to.include({ step: 'blocked', on: SPOKE, chain: SPOKE })
    const empty = { ...result, entries: [] }
    expect(nextActionOf(empty, [{ centrifugeId: SPOKE, stepName: 'unlinkVaults' }])).to.include({
      step: 'offboard',
      nothingToSign: true,
      waitingFor: 'unlinkVaults',
    })
    expect(nextActionOf(empty, [{ centrifugeId: SPOKE, stepName: 'linkTokens' }])).to.include({ step: 'onboardSpokes' })
    expect(nextActionOf(empty, [])).to.equal(null)
    const blocked = {
      ...empty,
      complete: false,
      stops: [{ label: 'relayFreeze', centrifugeId: SPOKE, reason: 'rpc said no', hub: false }],
    }
    expect(nextActionOf(blocked, [])).to.include({
      step: 'blocked',
      on: SPOKE,
      reason: 'rpc said no',
      nothingToSign: true,
    })
  })

  it('arms the other spokes when one lane install stops, and skips the spoke half once the hub half stopped', async () => {
    const other = 3 as CentrifugeId
    const failing = (label: string) => (call: PlanCall) =>
      call.label === label && call.centrifugeId === SPOKE
        ? { ok: false, revert: '0x' as HexString, gasUsed: 0n, batches: [], error: 'NoPoolAdapters' }
        : okSim()
    const world: World = {
      hubPhase: 'armed',
      spokePhase: {},
      armed: {},
      installed: { '1->2': true, '1->3': true, '3->1': true },
      freezeGeneration: {},
      frozenGeneration: {},
      parks: {},
      simulate: failing('installPoolAdapters (spoke side)'),
    }
    const { result } = await plan(world, [SPOKE, other])
    expect(result.stops).to.deep.equal([
      { label: 'installPoolAdapters (spoke side)', centrifugeId: SPOKE, reason: 'NoPoolAdapters', hub: false },
    ])
    expect(labels(result.entries)).to.deep.equal(['relayArm'])
    expect(result.entries[0]!.operation).to.deep.equal({ name: 'relayArm', args: { spokeCentrifugeIds: [other] } })
    expect(result.skips.find((skip) => skip.label === 'relayArm' && skip.centrifugeId === SPOKE)!.reason).to.match(
      /left out of this arm/
    )
    expect(result.complete).to.equal(false)

    const hubHalf = await plan(
      { ...world, installed: { '1->3': true, '3->1': true }, simulate: failing('installPoolAdapters (hub side)') },
      [SPOKE, other]
    )
    expect(hubHalf.result.stops).to.deep.equal([
      { label: 'installPoolAdapters (hub side)', centrifugeId: SPOKE, reason: 'NoPoolAdapters', hub: false },
    ])
    expect(hubHalf.d.simulated.map((call) => call.label)).to.not.include('installPoolAdapters (spoke side)')
    expect(hubHalf.result.skips.find((skip) => skip.label === 'installPoolAdapters (spoke side)')).to.include({
      centrifugeId: SPOKE,
      reason: 'this spoke stopped on an earlier step',
    })
    expect(labels(hubHalf.result.entries)).to.deep.equal(['relayArm'])
  })

  it('names an unreadable chain, holds the arm while the hub is Armed and stops the hub onboard on it', async () => {
    const unreadable: UnreadableSpoke[] = [
      { centrifugeId: 3 as CentrifugeId, reason: 'the activity read timed out after 5000 ms' },
    ]
    const armedHub = (spokePhase: SpokePhaseName | null): World => ({
      hubPhase: 'armed',
      spokePhase: spokePhase ? { [SPOKE]: spokePhase } : {},
      armed: spokePhase ? { [SPOKE]: true } : {},
      installed: { '1->2': true, '2->1': true },
      freezeGeneration: {},
      frozenGeneration: {},
      parks: {},
    })

    const arming = await plan(armedHub(null), [SPOKE], unreadable)
    expect(labels(arming.result.entries)).to.not.include('relayArm')
    expect(arming.result.skips.find((skip) => skip.label === 'relayArm')!.reason).to.contain(
      'cid 3 (the activity read timed out after 5000 ms)'
    )
    expect(arming.result.stops.map((stop) => stop.label)).to.deep.equal(['onboardHub'])
    expect(arming.result.unreadableSpokes).to.deep.equal(unreadable)
    expect(arming.result.complete).to.equal(false)

    const onboarding = await plan(armedHub('offboarded'), [SPOKE], unreadable)
    expect(labels(onboarding.result.entries)).to.not.include('onboardHub')
    expect(onboarding.result.stops.map((stop) => stop.label)).to.deep.equal(['onboardHub'])
    expect(onboarding.result.stops[0]!.reason).to.contain('cid 3').and.contain('no way to arm it after')

    const past = await plan(
      {
        hubPhase: 'hubOnboarded',
        spokePhase: { [SPOKE]: 'offboarded' },
        armed: { [SPOKE]: true },
        installed: { '1->2': true, '2->1': true },
        freezeGeneration: {},
        frozenGeneration: {},
        parks: {},
      },
      [SPOKE],
      unreadable
    )
    expect(labels(past.result.entries).some((label) => label.startsWith('relayOnboardSpoke'))).to.equal(true)
    expect(past.result.stops).to.deep.equal([])
    expect(past.result.unreadableSpokes).to.deep.equal(unreadable)

    const recordLost = await plan(
      armedHub('offboarded'),
      [SPOKE],
      [{ centrifugeId: null, reason: "the v3.2 hub's spoke record could not be read: rpc down" }]
    )
    expect(recordLost.result.stops[0]!.reason).to.contain("hub's spoke record could not be read: rpc down")
  })

  it('holds the hub onboard and stops the activate while a configured spoke is not armed', async () => {
    const other = 3 as CentrifugeId
    const base: World = {
      hubPhase: 'armed',
      spokePhase: { [other]: 'offboarded' },
      armed: { [other]: true },
      installed: { '1->2': true, '1->3': true, '3->1': true },
      freezeGeneration: {},
      frozenGeneration: {},
      parks: {},
      simulate: (call) =>
        call.label === 'installPoolAdapters (spoke side)'
          ? { ok: false, revert: '0x' as HexString, gasUsed: 0n, batches: [], error: 'NoPoolAdapters' }
          : okSim(),
    }
    const held = await plan(base, [SPOKE, other])
    expect(labels(held.result.entries)).to.not.include('onboardHub')
    expect(held.result.skips.find((skip) => skip.label === 'onboardHub')!.reason).to.match(/arm has not reached cid 2/)
    expect(held.result.stops.map((stop) => stop.label)).to.deep.equal(['installPoolAdapters (spoke side)'])
    const past = await plan(
      {
        ...base,
        hubPhase: 'hubOnboarded',
        spokePhase: { [other]: 'onboarded' },
        installed: { '1->3': true, '3->1': true },
      },
      [SPOKE, other]
    )
    expect(labels(past.result.entries)).to.not.include('activate')
    expect(past.result.stops.find((stop) => stop.label === 'activate')).to.include({ centrifugeId: HUB, hub: true })
    expect(past.result.stops.find((stop) => stop.label === 'activate')!.reason).to.match(/cid 2 was never armed/)
    expect(past.result.complete).to.equal(false)
  })

  it('measures payloads against the relay budget', () => {
    expect(PAYLOAD_BUDGET).to.equal(941)
    expect(freezeLength({ syncReserves: [] })).to.equal(160)
    expect(freezeLength({ syncReserves: [{ scId: sc1.raw, asset: addr(1) }] })).to.equal(224)
    expect(finalizeOffboardLength(emptyOffboard())).to.equal(256)
  })

  it('cuts offboard and onboard windows at their item boundaries', () => {
    const input: OffboardSpokeInput = {
      ...emptyOffboard(),
      vaults: [1, 2].map((i) => ({ scId: sc1.raw, assetId: String(i), vault: addr(i) })),
      assets: [{ asset: addr(9), assetId: '9', scIds: [sc1.raw] }],
      balanceSheetManagers: [addr(0xb1)],
    }
    const middle = offboardSlice(input, 1, 2, false)
    expect(middle.vaults).to.have.length(1)
    expect(middle.assets).to.have.length(1)
    expect(middle.balanceSheetManagers).to.have.length(0)
    expect(middle.scIds).to.deep.equal([])
    const tail = onboardSlice({ ...emptyOnboard(), assetPrices: [{ scId: sc1.raw, assetId: '1' }] }, false, 0, 1, false)
    expect(tail.assetPrices).to.have.length(1)
    expect(tail.scIds).to.deep.equal([])
  })
})

describe('PRODUCTION_BUDGETS', () => {
  // Source: `MigrationBudgets.production()` in `script/migration/MigrationBudgets.sol` on `poc/v33-migration`
  // of centrifuge/protocol-internal. That repo is outside this CI, so a change there is not caught here.
  it('equals every budget of Protocol MigrationBudgets.production()', () => {
    expect(PRODUCTION_BUDGETS).to.deep.equal({
      freezeGas: 180_000n,
      unlinkGas: 0n,
      rotateGas: 525_000n,
      managersGas: 310_000n,
      offboardFinalizeGas: 790_000n,
      linkGas: 1_415_000n,
      registerGas: 0n,
      configureGas: 55_000n,
      hookManagersGas: 100_000n,
      assetPriceGas: 0n,
      spokeManagersGas: 0n,
      seedGas: 640_000n,
      seedQueueGas: 0n,
      onboardFinalizeGas: 0n,
      rampGas: 1_470_000n,
      restoreGas: 270_000n,
    })
  })
})

describe('migrationFingerprint', () => {
  const spoke = (landing: string, phase = 'armed') =>
    ({
      centrifugeId: SPOKE,
      phase,
      freezeGeneration: 1,
      facadeFreezeGeneration: 1,
      maxReservesRestored: null,
      steps: [{ step: 0, landing }],
    }) as any
  const migration = (landing: string, phase?: string) =>
    ({ hubPhase: 'armed', operator: OPERATOR, spokes: [spoke(landing, phase)] }) as any

  it('is the same for two reads that changed nothing and differs once a step lands or a phase moves', () => {
    expect(migrationFingerprint(migration('inFlight'))).to.equal(migrationFingerprint(migration('inFlight')))
    expect(migrationFingerprint(migration('inFlight'))).to.not.equal(migrationFingerprint(migration('landed')))
    expect(migrationFingerprint(migration('landed', 'armed'))).to.not.equal(
      migrationFingerprint(migration('landed', 'frozen'))
    )
    expect(migrationFingerprint(null)).to.equal('none')
  })
})

describe('migratedPlan', () => {
  const activated = {
    migrationId: 'm1',
    poolId: POOL,
    hubCentrifugeId: HUB,
    targetVersion: '3.3',
    hubPhase: 'activated',
    operator: OPERATOR,
    startedAt: new Date('2026-10-17T07:33:00Z'),
    spokes: [],
  } as PoolMigration
  const armed = { ...activated, hubPhase: 'armed' } as PoolMigration

  it('says why there is nothing to plan, or null while the walk applies', () => {
    expect(nothingToPlanReason(true, activated, null)).to.match(/on v3.3 and its migration is activated/)
    expect(nothingToPlanReason(true, null, null)).to.match(/no migration row/)
    expect(nothingToPlanReason(true, armed, null)).to.match(/reads v3.3 while its migration row reads armed/)
    expect(nothingToPlanReason(false, activated, null)).to.match(/still reads v3.2/)
    expect(nothingToPlanReason(null, activated, null)).to.match(/still reads v3.2/)
    expect(nothingToPlanReason(false, armed, 'none')).to.match(/no longer holds this pool/)
    expect(nothingToPlanReason(false, armed, 'armed')).to.equal(null)
    expect(nothingToPlanReason(false, armed, null)).to.equal(null)
    expect(nothingToPlanReason(false, null, 'none')).to.equal(null)
    expect(nothingToPlanReason(null, null, null)).to.equal(null)
  })

  it('plans nothing, keeps the row as it reads, and answers no next action', () => {
    const result = migratedPlan(POOL, activated, MIGRATION, [HUB, SPOKE], 'why')
    expect(result).to.include({ complete: true, operator: OPERATOR, hubPhase: 'activated', migration: MIGRATION })
    expect(result.entries).to.deep.equal([])
    expect(result.stops).to.deep.equal([])
    expect(result.skips).to.deep.equal([{ label: 'initiateMigration', centrifugeId: HUB, reason: 'why' }])
    expect(nextActionOf(result, [])).to.equal(null)
    const native = migratedPlan(POOL, null, MIGRATION, [HUB], 'why')
    expect(native).to.include({ hubPhase: 'none', operator: zeroAddress })
  })

  describe('deriveMigrationPlan', () => {
    afterEach(() => sinon.restore())

    const unresolved = throwError(() => new ProtocolVersionResolutionError('pool', 'no version on this transport'))
    const derive = (
      version: string | null | Error,
      migration: PoolMigration | null,
      chainAnswer: (fn: string) => unknown,
      poolId: PoolId = POOL
    ) => {
      const centrifuge = new Centrifuge({ environment: 'testnet' })
      sinon.stub(Pool.prototype, 'migration').returns(of(migration) as any)
      sinon
        .stub(Pool.prototype, 'protocolVersion')
        .returns(
          (version === null ? unresolved : version instanceof Error ? throwError(() => version) : of(version)) as any
        )
      sinon.stub(Pool.prototype, 'migrationSpokeCandidates').resolves({ spokes: [], hubRecordError: null })
      sinon.stub(centrifuge, 'protocolContext').returns(of({ hubRegistry: addr(0x33) }) as any)
      const readContract = sinon
        .stub()
        .callsFake(async ({ functionName }: { functionName: string }) => chainAnswer(functionName))
      sinon.stub(centrifuge, 'getClient').returns(of({ readContract }) as any)
      return { run: () => deriveMigrationPlan(centrifuge, new Pool(centrifuge, poolId.toString())), readContract }
    }

    it('plans nothing on a v3.3 pool without reading the facade', async () => {
      const { run, readContract } = derive('3.3', activated, () => 0)
      const result = await run()
      expect(result.complete).to.equal(true)
      expect(result.skips[0]!.reason).to.match(/on v3.3 and its migration is activated/)
      expect(readContract.called).to.equal(false)
    })

    it('plans nothing on an activated row while the version still reads v3.2, without reading the facade', async () => {
      const { run, readContract } = derive('3.2', activated, () => 0)
      const result = await run()
      expect(result.complete).to.equal(true)
      expect(result.skips[0]!.reason).to.match(/still reads v3.2/)
      expect(readContract.called).to.equal(false)
    })

    it('answers the zero address as the facade where none is deployed', async () => {
      const { run } = derive('3.3', null, () => 0, PoolId.from(99 as CentrifugeId, 7))
      const result = await run()
      expect(result.complete).to.equal(true)
      expect(result.migration).to.equal(zeroAddress)
      expect(result.skips[0]!.reason).to.match(/no migration row/)
    })

    it('plans nothing once the facade no longer holds a pool whose row is past none', async () => {
      const { run, readContract } = derive('3.2', armed, (fn) => (fn === 'hubPhase' ? 0 : OPERATOR))
      const result = await run()
      expect(result.complete).to.equal(true)
      expect(result.hubPhase).to.equal('armed')
      expect(result.skips[0]!.reason).to.match(/no longer holds this pool/)
      expect(readContract.callCount).to.equal(1)
      expect(readContract.firstCall.args[0]).to.include({ functionName: 'hubPhase' })
    })

    it('refuses an unknown facade phase instead of reading it as done', async () => {
      const { run } = derive('3.2', armed, (fn) => (fn === 'hubPhase' ? 7 : OPERATOR))
      await run().then(
        () => expect.fail('expected the unknown ordinal to refuse'),
        (error: Error) => expect(error).to.be.instanceOf(BuilderArgumentMismatchError)
      )
    })

    it('asks the v3.3 hub registry when the version cannot be resolved and the row says nothing', async () => {
      const { run, readContract } = derive(null, null, (fn) =>
        fn === 'exists' ? true : fn === 'manager' ? false : zeroAddress
      )
      const result = await run()
      expect(result.complete).to.equal(true)
      expect(result.skips[0]!.reason).to.match(/no migration row/)
      expect(readContract.getCalls().map((call) => call.args[0].functionName)).to.deep.equal(['exists', 'manager'])
      expect(readContract.firstCall.args[0]).to.include({ functionName: 'exists', address: addr(0x33) })
      expect(readContract.secondCall.args[0].args).to.deep.equal([POOL.raw, migrationFacadeOf(HUB, 'testnet')!.address])
    })

    it('walks a pool the migration contract reserved on the v3.3 registry', async () => {
      const { run, readContract } = derive(null, null, (fn) =>
        fn === 'exists' || fn === 'manager' ? true : zeroAddress
      )
      await run().then(
        () => expect.fail('expected the walk to refuse without an operator'),
        (error: Error) => expect(error.message).to.match(/no migration operator recorded/)
      )
      expect(readContract.getCalls().map((call) => call.args[0].functionName)).to.deep.equal([
        'exists',
        'manager',
        'operator',
      ])
    })

    it('falls through to the walk when the version cannot be resolved and the v3.3 registry does not know the pool', async () => {
      const { run, readContract } = derive(null, null, (fn) =>
        fn === 'exists' ? false : fn === 'operator' ? zeroAddress : 0
      )
      await run().then(
        () => expect.fail('expected the walk to refuse without an operator'),
        (error: Error) => expect(error.message).to.match(/no migration operator recorded/)
      )
      expect(readContract.getCalls().map((call) => call.args[0].functionName)).to.deep.equal(['exists', 'operator'])
    })

    it('walks from the row when the version cannot be resolved and the row is past none', async () => {
      const { run, readContract } = derive(null, armed, (fn) => (fn === 'hubPhase' ? 0 : OPERATOR))
      const result = await run()
      expect(result.skips[0]!.reason).to.match(/no longer holds this pool/)
      expect(readContract.getCalls().map((call) => call.args[0].functionName)).to.deep.equal(['hubPhase'])
    })

    it('fails the plan on a version read that failed for another reason', async () => {
      const { run } = derive(new Error('transport down'), null, () => 0)
      await run().then(
        () => expect.fail('expected the transport failure to surface'),
        (error: Error) => expect(error.message).to.equal('transport down')
      )
    })
  })
})
