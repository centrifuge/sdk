import { MIGRATION_STEP, type OffboardSpokeInput, type OnboardSpokeInput } from '@centrifuge/protocol'
import { expect } from 'chai'
import type { HexString } from '../types/index.js'
import { PoolId, ShareClassId, type CentrifugeId } from '../utils/types.js'
import {
  abortPayloadHash,
  entryLanding,
  guardRows,
  guardsHold,
  stepsOfOperation,
  type GuardSnapshot,
  type GuardSpokeSnapshot,
} from './MigrationGuards.js'
import type { MigrationPlan, MigrationPlanEntry } from './MigrationPlan.js'
import type { MigrationStep, PoolMigration } from './PoolMigration.js'

const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as HexString
const HUB = 1 as CentrifugeId
const SPOKE = 2 as CentrifugeId
const POOL = PoolId.from(HUB, 7)
const sc1 = ShareClassId.from(POOL, 1)
const MIGRATION = addr(0x33)
const OPERATOR = addr(0x0e)
const OTHER = addr(0x0f)

const offboard = (over: Partial<OffboardSpokeInput> = {}): OffboardSpokeInput => ({
  vaults: [{ scId: sc1.raw, assetId: '1', vault: addr(0xd1) }],
  assets: [],
  balanceSheetManagers: [addr(0xb1)],
  gatewayManagers: [],
  scIds: [sc1.raw],
  assetIds: [],
  unlinkGas: '0',
  rotateGas: '0',
  managersGas: '0',
  finalizeGas: '0',
  finalize: true,
  totalVaults: '1',
  totalAssets: '0',
  totalManagers: '1',
  ...over,
})

const onboard = (over: Partial<OnboardSpokeInput> = {}): OnboardSpokeInput => ({
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
  ...over,
})

function entry(over: Partial<MigrationPlanEntry>): MigrationPlanEntry {
  return {
    label: 'entry',
    phase: 'offboard',
    operation: null,
    executeOn: HUB,
    concerns: SPOKE,
    destinations: [SPOKE],
    to: MIGRATION,
    data: '0x01',
    value: 0n,
    requiredHubPhase: 'armed',
    requiredSpokePhase: 'frozen',
    slice: null,
    gasUsed: 0n,
    batchGas: 0n,
    ceiling: 0n,
    binds: '',
    manualDelivery: false,
    widestPayload: null,
    signer: 'operator',
    ...over,
  }
}

function plan(entries: MigrationPlanEntry[]): MigrationPlan {
  return {
    poolId: POOL,
    migration: MIGRATION,
    operator: OPERATOR,
    hubCentrifugeId: HUB,
    hubPhase: 'armed',
    spokes: [SPOKE],
    unreadableSpokes: [],
    chains: [],
    complete: true,
    bridgeCircuitBreaker: true,
    entries,
    bundles: [],
    stops: [],
    skips: [],
    warnings: [],
  }
}

const spoke = (over: Partial<GuardSpokeSnapshot> = {}): GuardSpokeSnapshot => ({
  phase: 'frozen',
  frozenGeneration: 1,
  hubFreezeGeneration: 1,
  locked: false,
  installedTowardHub: true,
  block: 200n,
  ...over,
})

function snapshot(over: Partial<GuardSnapshot> = {}): GuardSnapshot {
  return {
    hubPhase: 'armed',
    hubLocked: false,
    hubBlock: 100n,
    operator: OPERATOR,
    armedSpokes: [SPOKE],
    signer: OPERATOR,
    signerIsHubManager: true,
    spokes: { [HUB]: spoke({ phase: 'none' }), [SPOKE]: spoke() },
    rampIdsPending: {},
    unindexedRelays: {},
    ...over,
  }
}

const row = (
  step: number,
  landing: MigrationStep['landing'],
  block: number,
  payloadHash: HexString = addr(step)
): MigrationStep => ({
  step,
  stepName: null,
  centrifugeId: SPOKE,
  transactionHash: addr(0x1),
  logIndex: 0,
  createdAtBlock: block,
  createdAt: new Date(0),
  payloadHash,
  gatewayMessageHash: addr(0x2),
  isSameChainStep: false,
  landing,
  messageId: null,
  messageIndex: null,
  failReason: landing === 'parked' ? 'WrongSpokePhase' : null,
  executedAtTxHash: null,
})

const migration = (steps: MigrationStep[]): PoolMigration =>
  ({ spokes: [{ centrifugeId: SPOKE, steps }] }) as unknown as PoolMigration

const relayOffboard = (over: Partial<MigrationPlanEntry> = {}) =>
  entry({
    label: 'relayOffboard',
    operation: { name: 'relayOffboard', args: { centrifugeId: SPOKE, input: offboard() } },
    ...over,
  })

const find = (rows: ReturnType<typeof guardRows>, guard: string) => rows.filter((r) => r.guard === guard)

describe('stepsOfOperation and entryLanding', () => {
  it('lists the steps an operation relays from its input', () => {
    expect(stepsOfOperation(relayOffboard())).to.deep.equal([
      MIGRATION_STEP.unlinkVaults,
      MIGRATION_STEP.removeManagers,
      MIGRATION_STEP.finalizeOffboard,
    ])
    expect(
      stepsOfOperation(
        entry({ operation: { name: 'relayOnboardSpoke', args: { centrifugeId: SPOKE, input: onboard() } } })
      )
    ).to.deep.equal([
      MIGRATION_STEP.linkTokens,
      MIGRATION_STEP.seedShareQueue,
      MIGRATION_STEP.seedEscrow,
      MIGRATION_STEP.assertSpokeManagers,
      MIGRATION_STEP.finalizeOnboard,
    ])
    expect(
      stepsOfOperation(
        entry({ operation: { name: 'installPoolAdapters', args: { centrifugeId: SPOKE, signOn: 'spoke' } } })
      )
    ).to.deep.equal([])
    expect(
      stepsOfOperation(
        entry({
          operation: { name: 'activate', args: { restoreGas: '0', spokeCentrifugeIds: [SPOKE] } },
        })
      )
    ).to.deep.equal([MIGRATION_STEP.restoreMaxReserves])
  })

  it('reads the latest relay of each step and folds the states, none for an entry without steps', () => {
    const landed = entryLanding(
      relayOffboard(),
      migration([
        row(MIGRATION_STEP.unlinkVaults, 'landed', 10),
        row(MIGRATION_STEP.removeManagers, 'landed', 11),
        row(MIGRATION_STEP.finalizeOffboard, 'landed', 12),
      ])
    )
    expect(landed.state).to.equal('landed')
    const parked = entryLanding(
      relayOffboard(),
      migration([
        row(MIGRATION_STEP.unlinkVaults, 'parked', 10),
        row(MIGRATION_STEP.unlinkVaults, 'landed', 9),
        row(MIGRATION_STEP.removeManagers, 'landed', 11),
        row(MIGRATION_STEP.finalizeOffboard, 'inFlight', 12),
      ])
    )
    expect(parked.state).to.equal('parked')
    expect(parked.steps[0]!.failReason).to.equal('WrongSpokePhase')
    const underpaid = entryLanding(
      relayOffboard(),
      migration([row(MIGRATION_STEP.unlinkVaults, 'underpaid', 10), row(MIGRATION_STEP.removeManagers, 'inFlight', 11)])
    )
    expect(underpaid.state).to.equal('underpaid')
    expect(underpaid.steps.map((s) => s.landing)).to.deep.equal(['underpaid', 'inFlight', 'pending'])
    const pending = entryLanding(relayOffboard(), migration([row(MIGRATION_STEP.unlinkVaults, 'landed', 10)]))
    expect(pending.state).to.equal('pending')
    expect(pending.steps.map((s) => s.landing)).to.deep.equal(['landed', 'pending', 'pending'])
    const earlier = entryLanding(
      relayOffboard(),
      migration([
        row(MIGRATION_STEP.unlinkVaults, 'landed', 10),
        row(MIGRATION_STEP.removeManagers, 'landed', 11),
        row(MIGRATION_STEP.finalizeOffboard, 'landed', 12),
      ]),
      20
    )
    expect(earlier.state).to.equal('pending')
    expect(earlier.steps.every((s) => s.landing === 'pending')).to.equal(true)
    expect(entryLanding(entry({ operation: { name: 'initiateMigration' } }), null).state).to.equal('none')
    expect(entryLanding(relayOffboard(), null).state).to.equal('pending')
  })
})

describe('guardRows', () => {
  it('passes a clean offboard and names every read with its chain and block', () => {
    const rows = guardRows(
      plan([relayOffboard()]),
      0,
      snapshot(),
      migration([row(MIGRATION_STEP.freeze, 'landed', 5)]),
      () => 'none'
    )
    expect(guardsHold(rows)).to.equal(true)
    expect(rows.map((r) => r.guard)).to.deep.equal([
      'operator',
      'hubManager',
      'freeze',
      'abort',
      'phases',
      'lock',
      'lock',
    ])
    expect(find(rows, 'freeze')[0]).to.include({ centrifugeId: SPOKE, source: 'chain', block: 200n })
    expect(find(rows, 'abort')[0]).to.include({ source: 'idx' })
  })

  it('refuses a relay whose step toward the spoke is still in flight since the last freeze, and notes an unmatched one', () => {
    const since = (steps: MigrationStep[]) =>
      guardRows(plan([relayOffboard()]), 0, snapshot(), migration(steps), () => 'none')
    const inFlight = since([row(MIGRATION_STEP.freeze, 'landed', 5), row(MIGRATION_STEP.unlinkVaults, 'inFlight', 7)])
    expect(guardsHold(inFlight)).to.equal(false)
    expect(find(inFlight, 'previous')[0]).to.include({ ok: false, centrifugeId: SPOKE, source: 'idx' })
    expect(find(inFlight, 'previous')[0]!.message).to.match(/still in flight/)
    const unmatched = since([row(MIGRATION_STEP.freeze, 'landed', 5), row(MIGRATION_STEP.unlinkVaults, 'unmatched', 7)])
    expect(guardsHold(unmatched)).to.equal(true)
    expect(find(unmatched, 'previous')[0]).to.include({ ok: true, centrifugeId: SPOKE, source: 'idx' })
    expect(find(unmatched, 'previous')[0]!.message).to.match(/no gateway message matched/)
    const olderGeneration = since([
      row(MIGRATION_STEP.unlinkVaults, 'inFlight', 3),
      row(MIGRATION_STEP.freeze, 'landed', 5),
    ])
    expect(guardsHold(olderGeneration)).to.equal(true)
    const landed = since([row(MIGRATION_STEP.freeze, 'landed', 5), row(MIGRATION_STEP.unlinkVaults, 'landed', 7)])
    expect(guardsHold(landed)).to.equal(true)
    const otherStep = since([row(MIGRATION_STEP.freeze, 'landed', 5), row(MIGRATION_STEP.linkTokens, 'inFlight', 7)])
    expect(guardsHold(otherStep)).to.equal(true)
  })

  it('refuses a relay whose step waits in an underpaid batch, even when told to ignore steps in flight', () => {
    const steps = [row(MIGRATION_STEP.freeze, 'landed', 5), row(MIGRATION_STEP.unlinkVaults, 'underpaid', 7)]
    const held = guardRows(plan([relayOffboard()]), 0, snapshot(), migration(steps), () => 'none')
    expect(guardsHold(held)).to.equal(false)
    expect(find(held, 'previous')[0]).to.include({ ok: false, centrifugeId: SPOKE, source: 'idx' })
    expect(find(held, 'previous')[0]!.message).to.match(/holds underpaid.*repayBatch/)
    const ignored = guardRows(plan([relayOffboard()]), 0, snapshot(), migration(steps), () => 'none', {
      ignoreStepsInFlight: true,
    })
    expect(guardsHold(ignored)).to.equal(false)
    expect(find(ignored, 'previous')[0]!.message).to.not.match(/ignoreStepsInFlight/)
    const previous = guardRows(
      plan([relayOffboard(), relayOffboard()]),
      1,
      snapshot(),
      migration(steps),
      () => 'underpaid'
    )
    expect(guardsHold(previous)).to.equal(false)
    expect(
      find(previous, 'previous').some((r) =>
        /reads underpaid: repay its batch \(centrifuge\.repayBatch\), then wait for it to land/.test(r.message)
      )
    ).to.equal(true)
  })

  it('passes a slice whose earlier slice goes first in the same send, and still waits for one sent on its own', () => {
    const slices = plan([
      relayOffboard({ label: 'relayOffboard slice 1' }),
      relayOffboard({ label: 'relayOffboard slice 2' }),
    ])
    const alone = guardRows(slices, 1, snapshot(), migration([]), () => 'pending')
    expect(find(alone, 'previous')[0]).to.include({ ok: false })
    expect(find(alone, 'previous')[0]!.message).to.match(
      /entry #0 relayOffboard slice 1 reads pending: wait for it to land/
    )
    const together = guardRows(slices, 1, snapshot(), migration([]), () => 'pending', { sentWith: [0] })
    expect(find(together, 'previous')).to.have.length(1)
    expect(find(together, 'previous')[0]).to.include({ ok: true })
    expect(find(together, 'previous')[0]!.message).to.equal(
      'entry #0 relayOffboard slice 1 goes first in the same send'
    )
    const elsewhere = guardRows(slices, 1, snapshot(), migration([]), () => 'pending', { sentWith: [5] })
    expect(find(elsewhere, 'previous')[0]).to.include({ ok: false })
  })

  it('refuses a relay the indexer has not written yet, and passes it as information when told to ignore steps in flight', () => {
    const reason = 'unlinkVaults relayed in 0xabc at hub block 90 is not in the indexer yet'
    const fresh = guardRows(
      plan([relayOffboard()]),
      0,
      snapshot({ unindexedRelays: { [SPOKE]: reason } }),
      migration([row(MIGRATION_STEP.freeze, 'landed', 5)]),
      () => 'none'
    )
    expect(guardsHold(fresh)).to.equal(false)
    expect(find(fresh, 'previous')[0]).to.include({ ok: false, centrifugeId: SPOKE, source: 'chain', block: 100n })
    expect(find(fresh, 'previous')[0]!.message).to.match(/not in the indexer yet/)
    const ignored = guardRows(
      plan([relayOffboard()]),
      0,
      snapshot({ unindexedRelays: { [SPOKE]: reason } }),
      migration([row(MIGRATION_STEP.freeze, 'landed', 5), row(MIGRATION_STEP.unlinkVaults, 'inFlight', 7)]),
      () => 'none',
      { ignoreStepsInFlight: true }
    )
    expect(guardsHold(ignored)).to.equal(true)
    expect(find(ignored, 'previous').map((r) => r.ok)).to.deep.equal([true, true])
    expect(find(ignored, 'previous')[0]!.message).to.match(/still in flight.*\(ignoreStepsInFlight\)$/)
    expect(find(ignored, 'previous')[1]!.message).to.match(/not in the indexer yet \(ignoreStepsInFlight\)$/)
  })

  it('refuses another signer than the operator, and a signer without the v3.2 hub manager role', () => {
    const rows = guardRows(
      plan([relayOffboard()]),
      0,
      snapshot({ signer: OTHER, signerIsHubManager: false }),
      null,
      () => 'none'
    )
    expect(find(rows, 'operator')[0]!.ok).to.equal(false)
    expect(find(rows, 'operator')[0]!.message).to.match(/is not the recorded operator/)
    expect(find(rows, 'hubManager')[0]!.ok).to.equal(false)
    const initiate = guardRows(
      plan([
        entry({
          operation: { name: 'initiateMigration' },
          concerns: HUB,
          destinations: [],
          requiredHubPhase: 'none',
          requiredSpokePhase: 'none',
        }),
      ]),
      0,
      snapshot({
        hubPhase: 'none',
        signer: OTHER,
        signerIsHubManager: true,
        spokes: { [HUB]: spoke({ phase: 'none' }) },
      }),
      null,
      () => 'none'
    )
    expect(find(initiate, 'operator')[0]!.ok).to.equal(true)
    expect(find(initiate, 'operator')[0]!.message).to.match(/becomes the operator/)
    const lanes = guardRows(
      plan([
        entry({
          operation: { name: 'installPoolAdapters', args: { centrifugeId: SPOKE, signOn: 'spoke' } },
          executeOn: SPOKE,
          destinations: [],
          requiredSpokePhase: 'none',
        }),
      ]),
      0,
      snapshot({ signer: OTHER, spokes: { [HUB]: spoke({ phase: 'none' }), [SPOKE]: spoke({ phase: 'none' }) } }),
      null,
      () => 'none'
    )
    expect(find(lanes, 'operator')).to.deep.equal([])
    expect(find(lanes, 'hubManager')).to.deep.equal([])
  })

  it('tells a guard not reached yet from one the pool moved past', () => {
    const notYet = guardRows(
      plan([relayOffboard()]),
      0,
      snapshot({ hubPhase: 'none', spokes: { [HUB]: spoke({ phase: 'none' }), [SPOKE]: spoke({ phase: 'armed' }) } }),
      null,
      () => 'none'
    )
    const phases = find(notYet, 'phases')[0]!
    expect(phases.ok).to.equal(false)
    expect(phases.stale).to.equal(false)
    expect(phases.message).to.match(/does not hold yet/)
    const moved = guardRows(
      plan([relayOffboard()]),
      0,
      snapshot({
        hubPhase: 'hubOnboarded',
        spokes: { [HUB]: spoke({ phase: 'none' }), [SPOKE]: spoke({ phase: 'offboarded' }) },
      }),
      null,
      () => 'none'
    )
    const stale = find(moved, 'phases')[0]!
    expect(stale.stale).to.equal(true)
    expect(stale.message).to.match(/no longer holds.*Plan again/)
    const back = guardRows(
      plan([relayOffboard()]),
      0,
      snapshot({ spokes: { [HUB]: spoke({ phase: 'none' }), [SPOKE]: spoke({ phase: 'armed' }) } }),
      null,
      () => 'none'
    )
    const aborted = find(back, 'phases')[0]!
    expect(aborted.stale).to.equal(true)
    expect(aborted.message).to.match(/moved back \(an Abort landed\)/)
  })

  it('holds a hub step on every armed spoke reading the phase it waits on', () => {
    const onboardHub = entry({
      label: 'onboardHub',
      operation: { name: 'onboardHub', args: { input: {} as any } },
      concerns: HUB,
      destinations: [SPOKE],
      requiredHubPhase: 'armed',
      requiredSpokePhase: 'none',
    })
    const waiting = guardRows(
      plan([onboardHub]),
      0,
      snapshot({
        armedSpokes: [SPOKE, 3 as CentrifugeId],
        spokes: {
          [HUB]: spoke({ phase: 'none' }),
          [SPOKE]: spoke({ phase: 'offboarded' }),
          3: spoke({ phase: 'frozen' }),
        },
      }),
      null,
      () => 'none'
    )
    const armed = find(waiting, 'armedSpokes')
    expect(armed).to.have.length(1)
    expect(armed[0]!.ok).to.equal(false)
    expect(armed[0]!.message).to.match(/cid 3 reads frozen/)
    const ready = guardRows(
      plan([onboardHub]),
      0,
      snapshot({ spokes: { [HUB]: spoke({ phase: 'none' }), [SPOKE]: spoke({ phase: 'offboarded' }) } }),
      null,
      () => 'none'
    )
    expect(find(ready, 'armedSpokes')[0]!.ok).to.equal(true)
    expect(find(ready, 'freeze')[0]!.ok).to.equal(true)
    const freezing = entry({
      label: 'relayFreeze',
      operation: { name: 'relayFreeze', args: { centrifugeId: SPOKE, syncReserves: [], extraGasLimit: '0' } },
      requiredSpokePhase: 'armed',
    })
    const past = guardRows(
      plan([freezing]),
      0,
      snapshot({ spokes: { [HUB]: spoke({ phase: 'none' }), [SPOKE]: spoke({ phase: 'frozen' }) } }),
      null,
      () => 'none'
    )
    expect(find(past, 'armedSpokes')[0]!.ok).to.equal(true)
  })

  it('stands an offboard on the current freeze and refuses one after an Abort at that generation', () => {
    const older = guardRows(
      plan([relayOffboard()]),
      0,
      snapshot({
        spokes: { [HUB]: spoke({ phase: 'none' }), [SPOKE]: spoke({ frozenGeneration: 1, hubFreezeGeneration: 2 }) },
      }),
      null,
      () => 'none'
    )
    expect(find(older, 'freeze')[0]!.ok).to.equal(false)
    expect(find(older, 'freeze')[0]!.message).to.match(
      /is frozen at generation 1 while the hub's current freeze is generation 2/
    )
    const aborted = guardRows(
      plan([relayOffboard()]),
      0,
      snapshot(),
      migration([
        row(MIGRATION_STEP.freeze, 'landed', 5),
        row(MIGRATION_STEP.abort, 'inFlight', 6, abortPayloadHash(1)),
      ]),
      () => 'none'
    )
    expect(find(aborted, 'abort')[0]!.ok).to.equal(false)
    expect(find(aborted, 'abort')[0]!.message).to.match(/relayed an Abort toward it at the current freeze generation 1/)
    const short = guardRows(plan([relayOffboard()]), 0, snapshot(), migration([]), () => 'none')
    expect(find(short, 'abort')[0]!.message).to.match(/\[GAP\].*hold 0 Freeze\(s\) for freeze generation 1/)
    const armedSpoke = guardRows(
      plan([
        entry({
          label: 'relayFreeze',
          operation: { name: 'relayFreeze', args: { centrifugeId: SPOKE, syncReserves: [], extraGasLimit: '0' } },
          requiredSpokePhase: 'armed',
        }),
      ]),
      0,
      snapshot({
        spokes: {
          [HUB]: spoke({ phase: 'none' }),
          [SPOKE]: spoke({ phase: 'armed', frozenGeneration: 0, hubFreezeGeneration: 1 }),
        },
      }),
      null,
      () => 'none'
    )
    expect(find(armedSpoke, 'freeze')[0]!.message).to.match(/a Freeze toward it is in flight or parked/)
  })

  it('refuses a lock on a chain the entry touches and an earlier entry still to be signed on a destination', () => {
    const locked = guardRows(
      plan([relayOffboard()]),
      0,
      snapshot({ spokes: { [HUB]: spoke({ phase: 'none' }), [SPOKE]: spoke({ locked: true }) } }),
      null,
      () => 'none'
    )
    const locks = find(locked, 'lock')
    expect(locks.find((r) => r.centrifugeId === SPOKE)!.ok).to.equal(false)
    expect(locks.find((r) => r.centrifugeId === HUB)!.ok).to.equal(true)
    const install = entry({
      label: 'installPoolAdapters (spoke side)',
      operation: { name: 'installPoolAdapters', args: { centrifugeId: SPOKE, signOn: 'spoke' } },
      executeOn: SPOKE,
      destinations: [],
      phase: 'arm',
      requiredSpokePhase: 'none',
    })
    const arm = entry({
      label: 'relayArm',
      operation: { name: 'relayArm', args: { spokeCentrifugeIds: [SPOKE] } },
      phase: 'arm',
      concerns: HUB,
      requiredSpokePhase: 'none',
    })
    const owed = guardRows(
      plan([install, arm]),
      1,
      snapshot({
        spokes: { [HUB]: spoke({ phase: 'none' }), [SPOKE]: spoke({ phase: 'none', installedTowardHub: false }) },
      }),
      null,
      () => 'none'
    )
    expect(find(owed, 'owed')[0]!.message).to.match(/sends toward cid 2, where entry #0 .* is still to be signed/)
    const installed = guardRows(
      plan([install, arm]),
      1,
      snapshot({
        spokes: { [HUB]: spoke({ phase: 'none' }), [SPOKE]: spoke({ phase: 'none', installedTowardHub: true }) },
      }),
      null,
      () => 'none'
    )
    expect(find(installed, 'owed')).to.deep.equal([])
    const register = entry({
      label: 'registerAsset (ramp accounting id, backend precondition)',
      operation: null,
      executeOn: SPOKE,
      destinations: [HUB],
      phase: 'offboard',
      requiredSpokePhase: 'offboarded',
    })
    const onboardHub = entry({
      label: 'onboardHub',
      operation: { name: 'onboardHub', args: { input: {} as any } },
      concerns: HUB,
      destinations: [SPOKE],
      requiredSpokePhase: 'none',
    })
    const registered = guardRows(
      plan([register, onboardHub]),
      1,
      snapshot({
        spokes: { [HUB]: spoke({ phase: 'none' }), [SPOKE]: spoke({ phase: 'offboarded' }) },
        rampIdsPending: { [SPOKE]: 0 },
      }),
      null,
      () => 'none'
    )
    expect(find(registered, 'owed')).to.deep.equal([])
    const pending = guardRows(
      plan([register, onboardHub]),
      1,
      snapshot({
        spokes: { [HUB]: spoke({ phase: 'none' }), [SPOKE]: spoke({ phase: 'offboarded' }) },
        rampIdsPending: { [SPOKE]: 2 },
      }),
      null,
      () => 'none'
    )
    expect(find(pending, 'owed')[0]!.message).to.match(/still lacks 2 ramp accounting id\(s\)/)
    const unread = guardRows(
      plan([register, onboardHub]),
      1,
      snapshot({ spokes: { [HUB]: spoke({ phase: 'none' }), [SPOKE]: spoke({ phase: 'offboarded' }) } }),
      null,
      () => 'none'
    )
    expect(find(unread, 'owed')[0]!.message).to.match(/were not read/)
  })

  it('does not make entries toward different spokes wait on each other', () => {
    const toA = entry({
      label: 'relayFreeze A',
      operation: { name: 'relayFreeze', args: { centrifugeId: SPOKE, syncReserves: [], extraGasLimit: '0' } },
      requiredSpokePhase: 'armed',
    })
    const toB = entry({
      label: 'relayFreeze B',
      operation: {
        name: 'relayFreeze',
        args: { centrifugeId: 3 as CentrifugeId, syncReserves: [], extraGasLimit: '0' },
      },
      concerns: 3 as CentrifugeId,
      destinations: [3 as CentrifugeId],
      requiredSpokePhase: 'armed',
    })
    const rows = guardRows(
      plan([toA, toB]),
      1,
      snapshot({
        armedSpokes: [SPOKE, 3 as CentrifugeId],
        spokes: { [HUB]: spoke({ phase: 'none' }), [SPOKE]: spoke({ phase: 'armed' }), 3: spoke({ phase: 'armed' }) },
      }),
      null,
      (k) => (k === 0 ? 'inFlight' : 'none')
    )
    expect(find(rows, 'previous')).to.deep.equal([])
  })

  it('waits on the entry before, and holds behind a manual one until it is delivered', () => {
    const first = relayOffboard({ label: 'relayOffboard (slice 1/2)', manualDelivery: true })
    const second = relayOffboard({ label: 'relayOffboard (slice 2/2)' })
    const waiting = guardRows(
      plan([first, second]),
      1,
      snapshot(),
      migration([row(MIGRATION_STEP.freeze, 'landed', 5)]),
      (k) => (k === 0 ? 'inFlight' : 'none')
    )
    expect(find(waiting, 'previous')[0]!.ok).to.equal(false)
    expect(find(waiting, 'manual')[0]!.message).to.match(/is \[MANUAL\] toward cid 2: deliver it by hand/)
    const landed = guardRows(
      plan([first, second]),
      1,
      snapshot(),
      migration([row(MIGRATION_STEP.freeze, 'landed', 5)]),
      () => 'landed'
    )
    expect(find(landed, 'previous')[0]!.ok).to.equal(true)
    expect(find(landed, 'manual')).to.deep.equal([])
    const parked = guardRows(
      plan([first, second]),
      1,
      snapshot(),
      migration([row(MIGRATION_STEP.freeze, 'landed', 5)]),
      (k) => (k === 0 ? 'parked' : 'none'),
      { ignoreStepsInFlight: true }
    )
    expect(find(parked, 'previous')[0]!.ok).to.equal(false)
    expect(find(parked, 'previous')[0]!.message).to.match(/reads parked.*settle its parked messages/)
  })
})
