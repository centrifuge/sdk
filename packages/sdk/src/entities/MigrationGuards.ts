import {
  HUB_PHASE,
  MIGRATION_STEP,
  SPOKE_PHASE,
  type HubPhaseName,
  type OffboardSpokeInput,
  type OnboardSpokeInput,
  type SpokePhaseName,
} from '@centrifuge/protocol'
import { encodeAbiParameters, isAddressEqual, keccak256 } from 'viem'
import type { HexString } from '../types/index.js'
import type { CentrifugeId } from '../utils/types.js'
import type { MigrationPlan, MigrationPlanEntry } from './MigrationPlan.js'
import type { MigrationOperationName, MigrationStep, MigrationStepLanding, PoolMigration } from './PoolMigration.js'
import {
  openSteps,
  openStepsReason,
  underpaidStepsReason,
  stepsOfSpoke,
  stepsSinceLastFreeze,
  unmatchedStepsReason,
} from './PoolMigration.js'

/**
 * The live guards `SendStep` runs before it signs a plan entry, as rows an App renders: each names what it read,
 * where, and whether the entry can go now. A failing row refuses the signature before anything is simulated.
 */

export type GuardName =
  'operator' | 'hubManager' | 'phases' | 'armedSpokes' | 'freeze' | 'abort' | 'lock' | 'owed' | 'manual' | 'previous'

export type GuardRow = {
  guard: GuardName
  ok: boolean
  /** A failing guard the pool moved past (the plan is stale) rather than one not reached yet (a wait). */
  stale: boolean
  centrifugeId: CentrifugeId
  source: 'chain' | 'record' | 'idx'
  block: bigint | null
  message: string
}

export type GuardSpokeSnapshot = {
  phase: SpokePhaseName
  frozenGeneration: number
  /** The hub's `freezeGeneration` toward this spoke. */
  hubFreezeGeneration: number
  locked: boolean
  /** The spoke half of the pool lane toward the hub, `poolAdaptersInstalled` read on the spoke. */
  installedTowardHub: boolean
  block: bigint
}

export type GuardSnapshot = {
  hubPhase: HubPhaseName
  hubLocked: boolean
  hubBlock: bigint
  operator: HexString
  armedSpokes: CentrifugeId[]
  /** The account that will sign, and whether the v3.2 hub registry names it a manager of the pool. */
  signer: HexString | null
  signerIsHubManager: boolean | null
  spokes: Partial<Record<CentrifugeId, GuardSpokeSnapshot>>
  /** Per spoke an earlier operation-less entry registers on: how many ramp accounting ids its v3.3 Spoke still lacks. */
  rampIdsPending: Partial<Record<CentrifugeId, number>>
  /** Per spoke the entry concerns: a hub `StepRelayed` toward it the indexer has not written yet, as a reason, else absent. */
  unindexedRelays: Partial<Record<CentrifugeId, string>>
}

export type GuardRowsOptions = {
  /** Pass a step the indexer still reads in flight, or a relay it has not written yet, as an informational row instead of a refusal. */
  ignoreStepsInFlight?: boolean
  sentWith?: readonly number[]
}

export type EntryLandingState =
  'pending' | 'inFlight' | 'underpaid' | 'landed' | 'parked' | 'dropped' | 'unmatched' | 'none'

export type EntryLanding = {
  /** The state of the whole entry: landed only when every step it relays landed, `none` for an entry that relays no step. */
  state: EntryLandingState
  steps: {
    step: number
    stepName: string
    landing: MigrationStepLanding | 'pending'
    failReason: string | null
    payloadHash: HexString | null
  }[]
}

const HUB_MANAGER_OPERATIONS: readonly MigrationOperationName[] = [
  'initiateMigration',
  'relayArm',
  'relayFreeze',
  'relayOffboard',
  'onboardHub',
]
const WAITS_ON_ARMED: readonly MigrationOperationName[] = ['relayFreeze', 'onboardHub', 'activate']

const hubPhaseValue = (name: HubPhaseName) => HUB_PHASE[name]
const spokePhaseValue = (name: SpokePhaseName) => SPOKE_PHASE[name]

/** The facade steps an operation relays toward the spoke it concerns, in the order the contract emits them. */
export function stepsOfOperation(entry: MigrationPlanEntry): number[] {
  const operation = entry.operation
  if (!operation) return []
  switch (operation.name) {
    case 'relayArm':
      return [MIGRATION_STEP.arm]
    case 'relayFreeze':
      return [MIGRATION_STEP.freeze]
    case 'relayAbort':
      return [MIGRATION_STEP.abort]
    case 'relayOffboard': {
      const input: OffboardSpokeInput = operation.args.input
      const steps: number[] = []
      if (input.vaults.length) steps.push(MIGRATION_STEP.unlinkVaults)
      if (input.assets.length) steps.push(MIGRATION_STEP.rotateAssets)
      if (input.balanceSheetManagers.length || input.gatewayManagers.length) steps.push(MIGRATION_STEP.removeManagers)
      if (input.finalize) steps.push(MIGRATION_STEP.finalizeOffboard)
      return steps
    }
    case 'relayOnboardSpoke': {
      const input: OnboardSpokeInput = operation.args.input
      const steps: number[] = []
      if (input.scIds.length) steps.push(MIGRATION_STEP.linkTokens)
      if (input.seedQueueScIds.length) steps.push(MIGRATION_STEP.seedShareQueue)
      if (input.assetPrices.length) steps.push(MIGRATION_STEP.copyAssetPrice)
      if (input.registerVaults.length) steps.push(MIGRATION_STEP.registerVaults)
      if (input.configureVaults.length) steps.push(MIGRATION_STEP.configureVaults)
      if (input.ramps.length) steps.push(MIGRATION_STEP.setupRamps)
      if (input.rampConfigs.length) steps.push(MIGRATION_STEP.assertRampConfig)
      if (input.hookManagers.length) steps.push(MIGRATION_STEP.assertHookManagers)
      if (input.seedEscrow) steps.push(MIGRATION_STEP.seedEscrow)
      steps.push(MIGRATION_STEP.assertSpokeManagers)
      if (input.finalize) steps.push(MIGRATION_STEP.finalizeOnboard)
      return steps
    }
    case 'activate':
      return [MIGRATION_STEP.restoreMaxReserves]
    default:
      return []
  }
}

/**
 * Where a plan entry's relayed steps landed, off `pool.migration()`: the latest relay of each step toward the
 * spoke the entry concerns, among the relays from `sinceBlock` on (the hub block the plan was derived at, so an
 * earlier generation's Freeze or an earlier slice never reads as this entry). An entry that relays no step
 * (`initiateMigration`, a lane install, `onboardHub`, a ramp-asset registration) answers `none`; a same-chain
 * entry never reads in flight.
 * @internal
 */
export function entryLanding(
  entry: MigrationPlanEntry,
  migration: PoolMigration | null,
  sinceBlock: number | null = null
): EntryLanding {
  const steps = stepsOfOperation(entry)
  if (steps.length === 0) return { state: 'none', steps: [] }
  const relays = stepsOfSpoke(migration, entry.concerns).filter(
    (row) => sinceBlock === null || row.createdAtBlock >= sinceBlock
  )
  const rows = steps.map((step) => {
    const latest = latestStep(relays, step)
    return {
      step,
      stepName: Object.entries(MIGRATION_STEP).find(([, v]) => v === step)?.[0] ?? `step ${step}`,
      landing: latest?.landing ?? ('pending' as const),
      failReason: latest?.failReason ?? null,
      payloadHash: latest?.payloadHash ?? null,
    }
  })
  const landings = rows.map((row) => row.landing)
  const state: EntryLandingState = landings.includes('parked')
    ? 'parked'
    : landings.includes('dropped')
      ? 'dropped'
      : landings.includes('underpaid')
        ? 'underpaid'
        : landings.includes('pending')
          ? 'pending'
          : landings.includes('inFlight')
            ? 'inFlight'
            : landings.includes('unmatched')
              ? 'unmatched'
              : 'landed'
  return { state, steps: rows }
}

function latestStep(steps: readonly MigrationStep[], step: number): MigrationStep | null {
  let latest: MigrationStep | null = null
  for (const row of steps) {
    if (row.step !== step) continue
    if (
      !latest ||
      row.createdAtBlock > latest.createdAtBlock ||
      (row.createdAtBlock === latest.createdAtBlock && row.logIndex > latest.logIndex)
    ) {
      latest = row
    }
  }
  return latest
}

/** `keccak256(abi.encode(uint8 Abort, uint32 generation))`: the payload hash of an Abort at one generation. */
export function abortPayloadHash(generation: number): HexString {
  return keccak256(
    encodeAbiParameters([{ type: 'uint8' }, { type: 'uint32' }], [MIGRATION_STEP.abort, generation])
  ) as HexString
}

/** The Freezes the hub relayed toward a spoke, and whether an Abort at `generation` is among its relays. */
export function relayedToward(
  migration: PoolMigration | null,
  centrifugeId: CentrifugeId,
  generation: number
): { freezes: number; aborted: boolean } {
  const steps = stepsOfSpoke(migration, centrifugeId)
  const freezes = steps.filter((row) => row.step === MIGRATION_STEP.freeze).length
  const hash = abortPayloadHash(generation).toLowerCase()
  const aborted = steps.some((row) => row.step === MIGRATION_STEP.abort && row.payloadHash.toLowerCase() === hash)
  return { freezes, aborted }
}

type Landed = (index: number) => EntryLandingState

/**
 * The guard rows of plan entry `index`: the operator and hub-manager requirements, the entry's recorded phases
 * against the chains now, every armed spoke's phase for the hub steps that wait on them, the hub's current freeze
 * of the spoke, no Abort relayed at that generation before an offboard, no lock on the chains the entry touches,
 * no earlier entry still to be signed on a chain it sends toward, and the entry before it landed (a manual one
 * delivered). Pure: every read comes in `snapshot`, every relay record in `migration`.
 * @internal
 */
export function guardRows(
  plan: MigrationPlan,
  index: number,
  snapshot: GuardSnapshot,
  migration: PoolMigration | null,
  landed: Landed,
  options: GuardRowsOptions = {}
): GuardRow[] {
  const entry = plan.entries[index]
  if (!entry) throw new Error(`plan has no entry #${index}`)
  const rows: GuardRow[] = []
  const hub = plan.hubCentrifugeId
  const name = entry.operation?.name ?? null
  const at = `entry #${index} ${entry.label}`
  const spokeOf = (cid: CentrifugeId) => snapshot.spokes[cid]
  const spokeName = (phase: SpokePhaseName | undefined) => phase ?? 'unread'
  const row = (
    guard: GuardName,
    ok: boolean,
    centrifugeId: CentrifugeId,
    source: GuardRow['source'],
    block: bigint | null,
    message: string,
    stale = false
  ) => rows.push({ guard, ok, stale, centrifugeId, source, block, message })

  // Operator and hub manager
  if (name && name !== 'installPoolAdapters' && name !== 'lock') {
    const signer = snapshot.signer
    if (name === 'initiateMigration' && snapshot.hubPhase === 'none') {
      row(
        'operator',
        true,
        hub,
        'chain',
        snapshot.hubBlock,
        `${at}: the sender of initiateMigration becomes the operator`
      )
    } else if (!signer) {
      row(
        'operator',
        false,
        hub,
        'chain',
        snapshot.hubBlock,
        `${at}: no signer to check against the recorded operator ${snapshot.operator}`
      )
    } else {
      const ok = isAddressEqual(signer, snapshot.operator)
      row(
        'operator',
        ok,
        hub,
        'chain',
        snapshot.hubBlock,
        ok
          ? `${at}: ${signer} is the recorded operator`
          : `${at}: ${signer} is not the recorded operator ${snapshot.operator}. Sign as the operator`
      )
    }
    if (HUB_MANAGER_OPERATIONS.includes(name)) {
      const ok = snapshot.signerIsHubManager === true
      row(
        'hubManager',
        ok,
        hub,
        'chain',
        snapshot.hubBlock,
        ok
          ? `${at}: the signer is a live v3.2 hub manager`
          : `${at}: the signer is not a live v3.2 hub manager of the pool, which ${name} requires (NotV32HubManager)${snapshot.signerIsHubManager === null ? ' (unread)' : ''}`
      )
    }
  }

  // Lanes owed on a destination
  for (const destination of entry.destinations) {
    for (let k = 0; k < index; k++) {
      const earlier = plan.entries[k]!
      if (earlier.executeOn !== destination || earlier.executeOn === entry.executeOn) continue
      const state = landed(k)
      let satisfied: boolean | null
      let why = `${at} sends toward cid ${destination}, where entry #${k} ${earlier.label} is still to be signed: sign it there first`
      if (earlier.operation?.name === 'installPoolAdapters') {
        satisfied = spokeOf(destination)?.installedTowardHub ?? null
      } else if (earlier.operation === null) {
        const pending = snapshot.rampIdsPending[destination]
        satisfied = pending === undefined ? null : pending === 0
        if (pending === undefined)
          why = `${at} sends toward cid ${destination}, whose ramp accounting-id registrations (entry #${k} ${earlier.label}) were not read`
        else if (pending !== 0)
          why = `${at} sends toward cid ${destination}, whose v3.3 Spoke still lacks ${pending} ramp accounting id(s) (entry #${k} ${earlier.label}): send the registration there first, or SetupRamps parks`
      } else {
        satisfied = state === 'landed'
      }
      if (satisfied === true) continue
      row('owed', false, destination, 'chain', spokeOf(destination)?.block ?? null, why)
    }
  }

  // A relay of the same step toward the spoke that has not landed yet: a second copy would be the same step again
  if (entry.concerns !== hub) {
    const open = openSteps(stepsSinceLastFreeze(stepsOfSpoke(migration, entry.concerns)), stepsOfOperation(entry))
    const ignored = options.ignoreStepsInFlight === true
    const suffix = ignored ? ' (ignoreStepsInFlight)' : ''
    const inFlight = openStepsReason(open)
    const underpaid = underpaidStepsReason(open)
    const unmatched = unmatchedStepsReason(open)
    const unindexed = snapshot.unindexedRelays[entry.concerns]
    if (inFlight) row('previous', ignored, entry.concerns, 'idx', null, `${at}: ${inFlight}${suffix}`)
    if (underpaid) row('previous', false, entry.concerns, 'idx', null, `${at}: ${underpaid}`)
    if (unmatched) row('previous', true, entry.concerns, 'idx', null, `${at}: ${unmatched}`)
    if (unindexed) row('previous', ignored, entry.concerns, 'chain', snapshot.hubBlock, `${at}: ${unindexed}${suffix}`)
  }

  // The entry before it toward the same spoke: a slice follows its predecessor, a bundle's entries toward other
  // spokes do not wait on each other
  for (let k = index - 1; k >= 0; k--) {
    const previous = plan.entries[k]!
    if (previous.concerns !== entry.concerns) continue
    if (options.sentWith?.includes(k)) {
      row('previous', true, previous.concerns, 'idx', null, `entry #${k} ${previous.label} goes first in the same send`)
      break
    }
    const state = landed(k)
    if (state === 'none') break
    const ok = state === 'landed'
    row(
      'previous',
      ok,
      previous.concerns,
      'idx',
      null,
      ok
        ? `entry #${k} ${previous.label} landed`
        : `entry #${k} ${previous.label} reads ${state}: ${state === 'underpaid' ? 'repay its batch (centrifuge.repayBatch), then wait for it to land' : `wait for it to land${state === 'parked' ? ', or settle its parked messages and retry the originals' : ''}`}`
    )
    if (previous.manualDelivery && !ok) {
      row(
        'manual',
        false,
        previous.concerns,
        'idx',
        null,
        `entry #${k} ${previous.label} is [MANUAL] toward cid ${previous.concerns}: deliver it by hand once its source transaction has landed, wait for it to execute, then sign this one`
      )
    }
    break
  }

  // Armed spokes
  if (name && WAITS_ON_ARMED.includes(name)) {
    const expected: SpokePhaseName =
      name === 'relayFreeze' ? 'armed' : name === 'onboardHub' ? 'offboarded' : 'onboarded'
    for (const cid of snapshot.armedSpokes) {
      const spoke = spokeOf(cid)
      const actual = spoke?.phase
      const ok =
        actual !== undefined &&
        (actual === expected || (name === 'relayFreeze' && spokePhaseValue(actual) > spokePhaseValue(expected)))
      if (ok) continue
      row(
        'armedSpokes',
        false,
        cid,
        'chain',
        spoke?.block ?? null,
        `${at} needs every armed spoke ${expected}, but cid ${cid} reads ${spokeName(actual)}: wait for it to land, or settle its parked messages and retry the originals`
      )
    }
    if (rows.every((r) => r.guard !== 'armedSpokes')) {
      row(
        'armedSpokes',
        true,
        hub,
        'chain',
        snapshot.hubBlock,
        `${at}: every armed spoke reads ${expected}${name === 'relayFreeze' ? ' or past it' : ''}`
      )
    }
  }

  // The hub's current freeze
  const freezeMiss = (cid: CentrifugeId, expected: SpokePhaseName): string | null => {
    const spoke = spokeOf(cid)
    if (!spoke) return `${at}: cid ${cid} was not read`
    if (spoke.phase !== expected)
      return `${at}: cid ${cid} reads ${spoke.phase} and needs ${expected}: wait for it to land, or settle its parked messages and retry the originals`
    if (spoke.frozenGeneration === spoke.hubFreezeGeneration) return null
    const generations = ` at generation ${spoke.frozenGeneration} while the hub's current freeze is generation ${spoke.hubFreezeGeneration}`
    if (expected === 'armed')
      return `${at}: cid ${cid} reads Armed${generations}, so a Freeze toward it is in flight or parked and another would be a second one. Wait for it to land, or settle its parked messages and retry the original`
    if (expected === 'frozen')
      return `${at}: cid ${cid} is frozen${generations}, so an offboard step would run, or ran, under the older freeze: an Abort or re-freeze toward it has not landed in order. Wait for it to land, or re-freeze`
    return `${at}: cid ${cid} offboarded${generations}, so its offboard ran under an older freeze because an Abort or re-freeze did not land in order. Stop: do not onboard the hub, compare the two freezes' inputs`
  }
  if (name === 'relayFreeze' && spokeOf(entry.concerns)?.phase === 'armed') {
    const miss = freezeMiss(entry.concerns, 'armed')
    row(
      'freeze',
      miss === null,
      entry.concerns,
      'chain',
      spokeOf(entry.concerns)?.block ?? null,
      miss ?? `${at}: cid ${entry.concerns} reads Armed at the hub's current freeze generation`
    )
  } else if (name === 'relayOffboard') {
    const miss = freezeMiss(entry.concerns, 'frozen')
    row(
      'freeze',
      miss === null,
      entry.concerns,
      'chain',
      spokeOf(entry.concerns)?.block ?? null,
      miss ?? `${at}: cid ${entry.concerns} is frozen at the hub's current freeze generation`
    )
    if (miss === null && entry.concerns !== hub) {
      const generation = spokeOf(entry.concerns)!.hubFreezeGeneration
      const { freezes, aborted } = relayedToward(migration, entry.concerns, generation)
      if (freezes < generation) {
        row(
          'abort',
          false,
          entry.concerns,
          'idx',
          null,
          `${at}: cid ${entry.concerns}: [GAP] the hub's StepRelayed records toward it hold ${freezes} Freeze(s) for freeze generation ${generation}, so an Abort relayed since cannot be ruled out`
        )
      } else if (aborted) {
        row(
          'abort',
          false,
          entry.concerns,
          'idx',
          null,
          `${at}: cid ${entry.concerns} reads Frozen, but the hub relayed an Abort toward it at the current freeze generation ${generation}: in flight or parked, it would return the spoke to Armed under the offboard. Never offboard after an Abort without a re-freeze: wait for it to land, then plan again, which sends the re-freeze first`
        )
      } else {
        row(
          'abort',
          true,
          entry.concerns,
          'idx',
          null,
          `${at}: no Abort relayed toward cid ${entry.concerns} at freeze generation ${generation}`
        )
      }
    }
  } else if (name === 'onboardHub') {
    for (const cid of snapshot.armedSpokes) {
      const miss = freezeMiss(cid, 'offboarded')
      if (miss !== null) row('freeze', false, cid, 'chain', spokeOf(cid)?.block ?? null, miss)
    }
    if (rows.every((r) => r.guard !== 'freeze'))
      row(
        'freeze',
        true,
        hub,
        'chain',
        snapshot.hubBlock,
        `${at}: every armed spoke offboarded at the hub's current freeze generation`
      )
  }

  // The entry's own guard
  const hubNow = snapshot.hubPhase
  const spokeNow = spokeOf(entry.concerns)?.phase
  const holds = hubNow === entry.requiredHubPhase && spokeNow === entry.requiredSpokePhase
  if (holds) {
    row(
      'phases',
      true,
      entry.concerns,
      'chain',
      spokeOf(entry.concerns)?.block ?? snapshot.hubBlock,
      `${at}: its guard (hub ${entry.requiredHubPhase}, spoke ${entry.requiredSpokePhase}) holds`
    )
  } else {
    const hubAhead = hubPhaseValue(hubNow) > hubPhaseValue(entry.requiredHubPhase)
    const spokeAhead = spokeNow !== undefined && spokePhaseValue(spokeNow) > spokePhaseValue(entry.requiredSpokePhase)
    const spokeBack =
      spokeNow !== undefined &&
      spokePhaseValue(spokeNow) < spokePhaseValue(entry.requiredSpokePhase) &&
      hubPhaseValue(hubNow) >= hubPhaseValue(entry.requiredHubPhase)
    const stale = hubAhead || spokeAhead || spokeBack
    const reads = `, the contract reads (hub ${hubNow}, spoke ${spokeName(spokeNow)})`
    row(
      'phases',
      false,
      entry.concerns,
      'chain',
      spokeOf(entry.concerns)?.block ?? snapshot.hubBlock,
      stale
        ? `${at}: its guard (hub ${entry.requiredHubPhase}, spoke ${entry.requiredSpokePhase}) no longer holds${reads}: the pool moved ${spokeBack ? 'back (an Abort landed)' : 'on'} since the plan was derived. Plan again`
        : `${at}: its guard (hub ${entry.requiredHubPhase}, spoke ${entry.requiredSpokePhase}) does not hold yet${reads}: what it follows has not landed. Wait for it, or settle its parked messages, then plan again`,
      stale
    )
  }

  // Locks
  const lockedChains = new Set<CentrifugeId>([entry.executeOn, ...entry.destinations])
  for (const cid of lockedChains) {
    const locked = cid === hub ? snapshot.hubLocked : (spokeOf(cid)?.locked ?? null)
    const block = cid === hub ? snapshot.hubBlock : (spokeOf(cid)?.block ?? null)
    if (locked === null)
      row('lock', false, cid, 'chain', block, `${at}: the migration contract's lock on cid ${cid} was not read`)
    else
      row(
        'lock',
        !locked,
        cid,
        'chain',
        block,
        locked
          ? `${at}: the migration contract on cid ${cid} is locked: nothing lands there until the lock admin releases it`
          : `${at}: the migration contract on cid ${cid} is not locked`
      )
  }

  return rows
}

export function guardsHold(rows: readonly GuardRow[]): boolean {
  return rows.every((row) => row.ok)
}
