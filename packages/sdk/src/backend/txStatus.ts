import type { HexString } from '../types/index.js'
import type {
  OperationApprovedStatus,
  OperationAwaitingApprovalsStatus,
  OperationPendingStatus,
  OperationQueuedStatus,
  OperationRejectedStatus,
  OperationTrackedConfirmedStatus,
  OperationUnknownTxStateStatus,
} from '../types/transaction.js'
import { BACKEND_TX_STATUSES, type BackendTxStatus } from './txView.js'

/**
 * The custodial lifecycle mapping: one backend `pool_transactions`
 * row state, plus its approval counts and its hash, to one `OperationStatus`.
 *
 * This module is the SOFTENING LAYER. `decodeBackendTxView` refuses a row state
 * it does not recognise, and deliberately so: `status` is what every consumer
 * branches on, and a string handed through lands in a default branch that reads
 * as "nothing to do" — a stalled transaction rendered as an idle one. That
 * refusal is not relaxed here. What happens here instead is that a state which
 * reaches the MAPPING unrecognised — from a caller that built a row without the
 * decoder, from a plain-JS caller, or from the SSE tx-state payload, which
 * is not a tx view — comes back as a typed
 * {@link OperationUnknownTxStateStatus} value rather than as a throw, because
 * the thing consuming this mapping is a poll and an exception would end the
 * subscription that was watching the transaction.
 *
 * The one state that does throw is `failed`, and the asymmetry is the point:
 * `failed` is the backend telling us this transaction is dead, with a reason in
 * `lastError`. That is an error in the same sense the SDK's own transaction
 * observable errors on a reverted receipt, and it is terminal — a failed row
 * never becomes un-failed, so there is nothing for a further poll to observe.
 * An unknown state is the opposite: nothing is known to be wrong, the SDK is
 * merely behind the backend's vocabulary.
 */

/**
 * The coarse phase a backend row state belongs to.
 *
 * A layer of its own rather than a direct state-to-status map because two
 * phases are not decided by the state alone: `approved` becomes
 * `TransactionPending` once a hash exists, and `awaiting-approvals` needs the
 * `approvals` object to be there at all. Splitting "which phase" from "what to
 * emit" keeps {@link BACKEND_TX_STATUS_PHASES} a table anyone can read against
 * the spec.
 */
export type TxLifecyclePhase = 'queued' | 'awaiting-approvals' | 'approved' | 'confirmed' | 'rejected' | 'failed'

/**
 * The mapping table.
 *
 * | backend row state          | phase               | emitted status                                          |
 * | -------------------------- | ------------------- | ------------------------------------------------------- |
 * | `prepared`                 | `queued`            | `Queued`                                                |
 * | `submitted_for_signing`    | `queued`            | `Queued`                                                |
 * | `pending_approval`         | `awaiting-approvals`| `AwaitingApprovals {collected, required}`, else `Queued` |
 * | `signed_pending_broadcast` | `approved`          | `Approved`, or `TransactionPending` once a hash exists   |
 * | `broadcast`                | `approved`          | `Approved`, or `TransactionPending` once a hash exists   |
 * | `confirmed`                | `confirmed`         | `Confirmed` (with the hash)                             |
 * | `approval_rejected`        | `rejected`          | `Rejected`                                              |
 * | `failed`                   | `failed`            | throws {@link BackendTxFailedError}                     |
 *
 * **This is the compile-time exhaustiveness check.** It is typed as a total
 * `Record` over `BackendTxStatus`, which is derived from
 * {@link BACKEND_TX_STATUSES}, so a state added to the backend vocabulary and
 * not given a phase here is a type error on this object
 * (`Property '<state>' is missing in type ... but required in type
 * 'Record<BackendTxStatus, TxLifecyclePhase>'`) — not a runtime surprise, and
 * not something a reviewer has to notice. The second half of the check is in
 * {@link backendTxStatus}, where the switch over `TxLifecyclePhase` ends in a
 * `never` assignment, so a new PHASE with no emission fails to compile too.
 */
export const BACKEND_TX_STATUS_PHASES: Record<BackendTxStatus, TxLifecyclePhase> = {
  prepared: 'queued',
  submitted_for_signing: 'queued',
  pending_approval: 'awaiting-approvals',
  signed_pending_broadcast: 'approved',
  broadcast: 'approved',
  confirmed: 'confirmed',
  approval_rejected: 'rejected',
  failed: 'failed',
}

/**
 * Is this string one of the row states this SDK version knows?
 *
 * Derived from {@link BACKEND_TX_STATUSES} rather than re-listed, so it cannot
 * disagree with {@link BACKEND_TX_STATUS_PHASES} about what is recognised.
 */
export function isBackendTxStatus(value: string): value is BackendTxStatus {
  return (BACKEND_TX_STATUSES as readonly string[]).includes(value)
}

/**
 * What {@link backendTxStatus} reads off a transaction.
 *
 * A `BackendTxView` satisfies it, which is the ordinary case. It is stated
 * structurally, and narrower than the view, for two reasons: `status` is
 * widened to accept a string this SDK does not recognise, so the unknown-state
 * path is reachable WITHOUT a cast (a mapping whose defensive branch can only
 * be entered by lying to the compiler is a branch nobody can test honestly);
 * and `approvals` needs only the two counts, which is the compact shape the
 * backend puts on the SSE tx-state event, so a push payload can be mapped
 * with no tx view in hand.
 */
export interface BackendTxStatusInput {
  txId: string
  /** The `PoolActionName` the row was prepared for; used as the status title. */
  actionType: string
  /**
   * The backend row state. `string` is accepted on purpose — see the note on
   * this type, and {@link OperationUnknownTxStateStatus}.
   */
  status: BackendTxStatus | (string & {})
  txHash: HexString | null
  approvals: { collected: number; required: number } | null
  lastError: string | null
}

/**
 * The statuses the backend tracking surface can emit.
 *
 * A subset of `OperationStatus`, so these values flow into whatever renders a
 * wallet-route transaction; narrow, so a consumer of `transactionStatus()` gets
 * a switch over exactly what can arrive instead of over every status the SDK
 * has.
 */
export type TrackedTxStatus =
  | OperationQueuedStatus
  | OperationAwaitingApprovalsStatus
  | OperationApprovedStatus
  | OperationRejectedStatus
  | OperationPendingStatus
  | OperationTrackedConfirmedStatus
  | OperationUnknownTxStateStatus

/** Stand-in when `lastError` is null, so a failure message still names the transaction. */
const NO_REASON_GIVEN = 'the backend recorded no reason'

/**
 * A tracked transaction reached `failed`.
 *
 * Terminal: the backend has recorded that this transaction will not sign or
 * will not execute, and `lastError` is its reason. Carries the row's identity
 * so a handler can name the transaction without having kept the row.
 */
export class BackendTxFailedError extends Error {
  override name = 'BackendTxFailedError'
  readonly txId: string
  readonly actionType: string
  /** The backend's own reason, or null when it recorded none. */
  readonly lastError: string | null

  constructor(row: Pick<BackendTxStatusInput, 'txId' | 'actionType' | 'lastError'>) {
    super(`Backend transaction ${row.txId} (${row.actionType}) failed: ${row.lastError ?? NO_REASON_GIVEN}`)
    this.txId = row.txId
    this.actionType = row.actionType
    this.lastError = row.lastError
  }
}

/**
 * The title every mapped status carries.
 *
 * The action name, verbatim. It is the only label the row has, and inventing
 * prose from it here would put SDK-side copy in front of a user for a
 * transaction whose own method already chose a title on the wallet route.
 */
function titleOf(row: BackendTxStatusInput): string {
  return row.actionType
}

function unknownState(row: BackendTxStatusInput, reason: string): OperationUnknownTxStateStatus {
  return {
    id: row.txId,
    type: 'UnknownTxState',
    title: titleOf(row),
    txId: row.txId,
    backendStatus: row.status,
    reason,
  }
}

/**
 * Map one backend transaction row onto the status a consumer renders.
 *
 * @param row - A `BackendTxView`, or anything carrying the fields in
 *   {@link BackendTxStatusInput}.
 * @returns The lifecycle status, including {@link OperationUnknownTxStateStatus}
 *   for a row this SDK cannot place. Never returns undefined and never returns
 *   a bare string.
 * @throws {BackendTxFailedError} And only for the `failed` row state — see the
 *   module note on why that one state is an error and an unknown state is not.
 *   A caller mapping a LIST of rows (where one dead row must not take out the
 *   page) can check for it first: `BACKEND_TX_STATUS_PHASES[row.status] ===
 *   'failed'`.
 *
 * @example
 * ```ts
 * const status = backendTxStatus(await pool.transaction(txId))
 * if (status.type === 'AwaitingApprovals') {
 *   console.log(`${status.collected} of ${status.required}`)
 * }
 * ```
 */
export function backendTxStatus(row: BackendTxStatusInput): TrackedTxStatus {
  // Reachable despite `status` being a union that includes the literal states:
  // this is the seam where a row that did not come through
  // `decodeBackendTxView` arrives, and refusing it here would move the failure
  // into whatever was polling.
  if (!isBackendTxStatus(row.status)) {
    return unknownState(
      row,
      `\`${row.status}\` is not a transaction state this SDK version knows. The SDK is behind the backend; ` +
        'the transaction itself is not necessarily in trouble.'
    )
  }

  const phase = BACKEND_TX_STATUS_PHASES[row.status]
  const base = { id: row.txId, title: titleOf(row), txId: row.txId, backendStatus: row.status }

  switch (phase) {
    case 'queued':
      return { ...base, type: 'Queued' }

    case 'awaiting-approvals':
      // No `approvals` object means no quorum has been observed yet (the
      // backend sends null before the first Fordefi transition). `Queued` rather than
      // `AwaitingApprovals` with zeroed counts: "0 of 2" would be wrong and
      // "0 of 0" would be a quorum nobody stated. Both are numbers a UI would
      // show, and neither came from the backend.
      return row.approvals
        ? {
            ...base,
            type: 'AwaitingApprovals',
            collected: row.approvals.collected,
            required: row.approvals.required,
          }
        : { ...base, type: 'Queued' }

    case 'approved':
      // "then `TransactionPending` once a hash exists" — and `TransactionPending`
      // is reused rather than given a new discriminant so that an app's existing
      // pending branch lights up for a custodial transaction unchanged.
      return row.txHash
        ? { id: row.txId, type: 'TransactionPending', title: titleOf(row), hash: row.txHash }
        : { ...base, type: 'Approved' }

    case 'confirmed':
      // A `confirmed` row without a hash is a contract violation, not a phase.
      // Reporting it as unknown says so; reporting it as `Approved` would be a
      // silent downgrade of the terminal state, and throwing would end the poll.
      return row.txHash
        ? { ...base, type: 'Confirmed', hash: row.txHash }
        : unknownState(row, 'the row is `confirmed` but carries no `txHash`, so there is no transaction to point at.')

    case 'rejected':
      return { ...base, type: 'Rejected' }

    case 'failed':
      throw new BackendTxFailedError(row)

    default: {
      // The second half of the exhaustiveness check. A phase added to
      // `TxLifecyclePhase` with no case above fails to compile here
      // (TS2322, "is not assignable to type 'never'"). Unreachable at
      // runtime — `phase` came from our own table — and it returns rather than
      // throws anyway, so a future refactor cannot turn this into the exception
      // the surface must not raise.
      const unhandled: never = phase
      return unknownState(row, `the SDK has a lifecycle phase \`${String(unhandled)}\` it does not emit.`)
    }
  }
}

/**
 * The identity a tracked status is de-duplicated on.
 *
 * The tracking surface re-fetches on a timer, so most polls return a row that
 * has not moved. Emitting those would turn "the sequence of states this
 * transaction passed through" into "one entry per poll", which is unusable for
 * anything that reacts to a change. Every field a consumer can render
 * participates — the approval counts above all, so 1-of-2 to 2-of-2 is a
 * change and not a repeat.
 */
export function trackedTxStatusKey(status: TrackedTxStatus): string {
  switch (status.type) {
    case 'Queued':
    case 'Approved':
    case 'Rejected':
      return `${status.type}:${status.backendStatus}`
    case 'AwaitingApprovals':
      return `${status.type}:${status.backendStatus}:${status.collected}/${status.required}`
    case 'TransactionPending':
      return `${status.type}:${status.hash}`
    case 'Confirmed':
      return `${status.type}:${status.backendStatus}:${status.hash}`
    case 'UnknownTxState':
      return `${status.type}:${status.backendStatus}:${status.reason}`
    default: {
      // Same check again, for the union rather than the phase: a status added
      // to `TrackedTxStatus` with no key here would silently de-duplicate
      // against everything.
      const unhandled: never = status
      return JSON.stringify(unhandled)
    }
  }
}
