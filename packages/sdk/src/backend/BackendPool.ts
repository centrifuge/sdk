import { distinctUntilChanged, map, switchMap, timer } from 'rxjs'
import type { Centrifuge } from '../Centrifuge.js'
import { Pool } from '../entities/Pool.js'
import type { Query } from '../types/query.js'
import type { PoolId } from '../utils/types.js'
import type { BackendTxReads } from './BackendTxReads.js'
import { backendTxStatus, trackedTxStatusKey, type TrackedTxStatus } from './txStatus.js'
import type { BackendTxListOptions, BackendTxPage, BackendTxView } from './txView.js'

/**
 * How often the tx reads re-fetch while something is subscribed.
 *
 * 10s, not the catalogue's 120s. These reads exist to watch a custodial
 * transaction cross a human approval quorum: the transaction observable
 * COMPLETES at hand-off (202), so between hand-off and confirmation this poll
 * is the only thing that moves, and two minutes of silence there reads as a
 * stuck transaction. Not lower than 10s either — the route is throttled, and
 * the backend's SSE stream is the real answer to latency, not a tighter
 * timer.
 */
export const DEFAULT_BACKEND_TX_POLL_INTERVAL = 10_000

/**
 * A `Pool` with the backend's session-scoped transaction reads attached.
 *
 * Everything `Pool` does is unchanged and mode-independent; the two methods
 * added here are the ones that only exist when there IS a session, which is why
 * they arrive by way of `@centrifuge/sdk/backend` rather than on the root
 * `Pool` class. A consumer holding a `Pool` from a public-mode `Centrifuge`
 * therefore cannot call them at all — it is a compile error, not a runtime 401.
 *
 * Obtained from {@link BackendCentrifuge.pool}, which resolves the pool the
 * ordinary way (so a pool the session cannot see still fails as it always did)
 * and then wraps it.
 */
export class BackendPool extends Pool {
  readonly #reads: BackendTxReads
  readonly #pollInterval: number

  /** @internal */
  constructor(root: Centrifuge, id: PoolId, reads: BackendTxReads, pollInterval: number) {
    super(root, id)
    this.#reads = reads
    this.#pollInterval = pollInterval
  }

  /**
   * `GET pools/:poolId/tx` — one page of this pool's transactions, polled.
   *
   * The long-lived tracking surface. On the custodial route the transaction
   * observable completes at hand-off to Fordefi, so this list plus
   * {@link transaction} are how a transaction awaiting a human quorum stays
   * visible; {@link backendTxStatus} maps the rows onto the
   * `Queued`/`AwaitingApprovals`/`Approved` statuses.
   *
   * **Paging is keyset-only.** Pass the previous page's `nextCursor` as
   * `options.cursor` to go forward. There is no `offset`, and the reason is a
   * correctness one rather than a preference — see {@link BackendTxListOptions}.
   *
   * @example
   * ```ts
   * const first = await pool.transactions({ status: 'pending_approval', limit: 20 })
   * const next = first.nextCursor ? await pool.transactions({ status: 'pending_approval', limit: 20, cursor: first.nextCursor }) : null
   * ```
   */
  transactions(options: BackendTxListOptions = {}): Query<BackendTxPage> {
    // Keyed on every option, so two subscriptions with different filters or
    // cursors do not share one cached page. `undefined` members are keyed as
    // `undefined` rather than omitted, which is what `_query`'s hashKey already
    // does for `_queryData`'s vars object.
    return this._query(['transactions', options.status, options.limit, options.cursor], () =>
      timer(0, this.#pollInterval).pipe(switchMap(() => this.#reads.list(this.id.raw.toString(), options)))
    )
  }

  /**
   * `GET pools/:poolId/tx/:txId` — one transaction, polled.
   *
   * Same row shape as a {@link transactions} item, `approvals` included: the
   * backend builds both from one projection, so following a single transaction
   * and watching the list cannot disagree about it.
   */
  transaction(txId: string): Query<BackendTxView> {
    return this._query(['transaction', txId], () =>
      timer(0, this.#pollInterval).pipe(switchMap(() => this.#reads.get(this.id.raw.toString(), txId)))
    )
  }

  /**
   * The same transaction as {@link transaction}, as the lifecycle status a
   * consumer renders.
   *
   * Built ON `transaction(txId)` — same poll, same cache — so the two cannot
   * disagree about a transaction, and the mapping is the only thing added.
   * Emits `Queued`, `AwaitingApprovals`, `Approved`, `TransactionPending`,
   * `Confirmed`, `Rejected`, or `UnknownTxState`; the table is
   * `BACKEND_TX_STATUS_PHASES`.
   *
   * Emits on CHANGE, not on poll. A ten-second timer against a transaction
   * waiting on a human approver returns the same row many times over, and a
   * subscriber wants the sequence of states the transaction passed through, not
   * one entry per fetch.
   *
   * The observable ERRORS with `BackendTxFailedError` if the row reaches
   * `failed` — terminal by nature, since a failed row never becomes un-failed,
   * and the same thing the SDK's own transaction observable does for a
   * transaction that will not execute. An unrecognised row state does NOT
   * error: it arrives as `UnknownTxState` and the subscription lives on.
   *
   * @example
   * ```ts
   * pool.transactionStatus(txId).subscribe((status) => {
   *   if (status.type === 'AwaitingApprovals') show(`${status.collected} of ${status.required}`)
   * })
   * ```
   */
  transactionStatus(txId: string): Query<TrackedTxStatus> {
    return this._query(['transactionStatus', txId], () =>
      this.transaction(txId).pipe(
        map((view) => backendTxStatus(view)),
        distinctUntilChanged((a, b) => trackedTxStatusKey(a) === trackedTxStatusKey(b))
      )
    )
  }
}
