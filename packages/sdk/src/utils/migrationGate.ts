import {
  deriveSpokeGateState,
  gateVerdict,
  HUB_PHASE,
  isAllowed,
  MIGRATION_ACTION,
  MIGRATION_ACTIONS,
  POOL_MIGRATING,
  SPOKE_GATE_STATE,
  spokeOfAction,
  type MigrationAction,
  type SpokeGateState,
} from '@centrifuge/protocol'
import type { MigrationGateTarget } from '../Centrifuge.js'
import type { PoolMigration } from '../entities/PoolMigration.js'
import type { MigrationGateRefusal } from '../errors.js'
import type { CentrifugeId } from './types.js'

/**
 * The migration gate's answer for one write: allowed, or refused with what
 * `PoolMigratingError.gate` carries for the same refusal.
 */
export type MigrationGateAnswer =
  { allowed: true } | ({ allowed: false; code: typeof POOL_MIGRATING } & MigrationGateRefusal)

type Undecided = { reason: string }

const HISTORY_DISAGREES: Undecided = {
  reason: 'the relayed step history and the facade disagree on its freeze generation',
}

/** The actions the first offboard closes: allowed while a spoke is only frozen, not once its offboard was sent. */
export const CLOSED_BY_FIRST_OFFBOARD: readonly MigrationAction[] = MIGRATION_ACTIONS.filter(
  (action) =>
    gateVerdict(SPOKE_GATE_STATE.freezeSent, action, { spokeIsHubChain: false }) === 'A' &&
    gateVerdict(SPOKE_GATE_STATE.offboardSent, action, { spokeIsHubChain: false }) !== 'A'
)

const UNMAPPED_REASON =
  'this action has no row in the migration gate table; a migrating pool refuses it until one is decided'

/** The refusal of an action the gate table does not map, on a pool the facade reports as migrating. */
export function unmappedActionRefusal(actionName: string, centrifugeId: CentrifugeId): MigrationGateAnswer {
  return {
    allowed: false,
    code: POOL_MIGRATING,
    action: actionName,
    centrifugeId,
    phase: null,
    verdict: '?',
    reason: UNMAPPED_REASON,
    allowedActions: null,
  }
}

/** The refusal of an action whose migration state could not be read, naming the read that failed. */
export function unreadableStateRefusal(
  actionName: string,
  centrifugeId: CentrifugeId,
  reason: string
): MigrationGateAnswer {
  return {
    allowed: false,
    code: POOL_MIGRATING,
    action: actionName,
    centrifugeId,
    phase: null,
    verdict: null,
    reason,
    allowedActions: null,
  }
}

/** The spokes a write's targets resolve to, each once, with the destination of a bridge. */
export function judgedSpokesOf(
  poolId: string,
  targets: readonly MigrationGateTarget[]
): { spokeId: CentrifugeId; destinationId?: CentrifugeId }[] {
  const judged = new Map<string, { spokeId: CentrifugeId; destinationId?: CentrifugeId }>()
  for (const target of targets.length ? targets : [{}]) {
    const spokeId = spokeOfAction({
      poolId,
      ...(target.assetId !== undefined ? { assetId: target.assetId } : {}),
      ...(target.centrifugeId !== undefined ? { centrifugeId: target.centrifugeId } : {}),
    })
    const destinationId = target.destinationCentrifugeId
    judged.set(`${spokeId}:${destinationId ?? ''}`, { spokeId, destinationId })
  }
  return [...judged.values()]
}

/**
 * The gate state of one network in a pool's migration. The hub chain without
 * a row of its own is judged from the hub phase (P1, P4, P6); any other
 * network without a row is not part of the migration and is not gated (null).
 * A spoke whose facade could not be read, or whose step history disagrees
 * with the facade, answers the reason the state cannot be known.
 */
export function spokeGateStateOf(
  migration: PoolMigration,
  centrifugeId: CentrifugeId
): SpokeGateState | null | Undecided {
  const spoke = migration.spokes.find((s) => s.centrifugeId === centrifugeId)
  if (!spoke) {
    if (centrifugeId !== migration.hubCentrifugeId) return null
    return deriveSpokeGateState({
      hubPhase: HUB_PHASE[migration.hubPhase],
      relayedSteps: [],
      maxReservesRestored: true,
    })
  }
  if (spoke.state !== null) return spoke.state
  if (spoke.facadeReadError !== null) {
    return {
      reason: `its migration facade on centrifugeId ${centrifugeId} could not be read: ${spoke.facadeReadError}`,
    }
  }
  return HISTORY_DISAGREES
}

/**
 * Judge one gate action against a pool's migration: each target resolves to
 * its spoke with `spokeOfAction` and is judged once, a `bridgeOut` with a
 * destination also as `bridgeToward` there. Answers the first refusal.
 * `actionName` is the action's original name, carried into the refusal.
 */
export function judgeMigrationGate(
  migration: PoolMigration,
  poolId: string,
  action: MigrationAction,
  actionName: string,
  targets: readonly MigrationGateTarget[]
): MigrationGateAnswer {
  const judged = judgedSpokesOf(poolId, targets)
  // The destination of a bridge is judged without `spokeIsHubChain`, so its
  // `allowedActions` leave out `bridgeOut`, whose row depends on it.
  const judge = (centrifugeId: CentrifugeId, gateAction: MigrationAction, source: boolean): MigrationGateAnswer => {
    const state = spokeGateStateOf(migration, centrifugeId)
    if (state !== null && typeof state === 'object') {
      return unreadableStateRefusal(actionName, centrifugeId, state.reason)
    }
    const answer = isAllowed(
      state,
      gateAction,
      source ? { spokeIsHubChain: centrifugeId === migration.hubCentrifugeId } : {}
    )
    if (answer.allowed) return answer
    return {
      allowed: false,
      code: POOL_MIGRATING,
      action: actionName,
      centrifugeId,
      phase: answer.state,
      verdict: answer.verdict,
      reason: answer.reason,
      allowedActions: answer.allowedActions,
    }
  }
  for (const { spokeId, destinationId } of judged) {
    const out = judge(spokeId, action, true)
    if (!out.allowed) return out
    if (action !== MIGRATION_ACTION.bridgeOut || destinationId === undefined) continue
    const toward = judge(destinationId, MIGRATION_ACTION.bridgeToward, false)
    if (!toward.allowed) return toward
  }
  return { allowed: true }
}
