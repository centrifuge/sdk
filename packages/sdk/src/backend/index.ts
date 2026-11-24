/**
 * `@centrifuge/sdk/backend` — the surface Centrifuge's own apps import.
 *
 * Internal and unstable. It is a SUBPATH of `@centrifuge/sdk` rather than a
 * second package: a factory and two reads do not justify their own version,
 * release pipeline and private-registry setup, and
 * `api-extractor` runs on the root export, so this surface deliberately sits
 * OUTSIDE the published external contract and offers external integrators no
 * compatibility guarantee. Integrators want `@centrifuge/sdk` with its
 * defaults.
 *
 * Two things live here and nowhere else:
 *
 * 1. **{@link createBackendCentrifuge}** — a `Centrifuge` with the rest
 *    `DataSource` and `BackendPrepareStrategy` bound to an injected
 *    `{ fetch, eventSource }` transport. The transport is the whole of what
 *    this package knows about the session: cookies, the double-submit
 *    `X-CSRF-Token`, its one retry, and credentialed SSE all stay in app land
 *    (see {@link BackendTransport}, and
 *    `docs/api/sdk-backend-transport.md` for a reference implementation).
 * 2. **The session-scoped tx reads** — `pool.transactions()` and
 *    `pool.transaction(txId)` on {@link BackendPool}, over the backend's own
 *    `pool_transactions` rows. They are not catalogue entries and have no
 *    public counterpart, so they exist only where a session does.
 * 3. **The custodial lifecycle mapping** — `backendTxStatus` and
 *    `pool.transactionStatus(txId)`, which turn a row state plus its approval
 *    counts into the `Queued`/`AwaitingApprovals`/`Approved`/`Rejected`
 *    statuses. The status TYPES are additive members of the root's
 *    `OperationStatus`; only the mapping is session-scoped, because only a
 *    session has rows to map.
 * 4. **The invalidation push seam** —
 *    {@link BackendInvalidationStream}, one shared SSE stream per instance over
 *    the injected `eventSource`, feeding the rest data source's
 *    `invalidations$`. Opt in with `streamPoolIds`; without it a backend-mode
 *    client polls, with no push seam at all.
 *
 * Import direction: this subpath imports the root; the root never imports it.
 * Enforced by `sdk-root-no-backend-subpath` in
 * `.dependency-cruiser.packages.cjs`, because a root import would pull the
 * session-scoped surface into the api-extractor report and make it public by
 * accident.
 */

export { BackendCentrifuge, createBackendCentrifuge } from './BackendCentrifuge.js'
export type { BackendCentrifugeConfig } from './BackendCentrifuge.js'
export { BackendPool, DEFAULT_BACKEND_TX_POLL_INTERVAL } from './BackendPool.js'
export {
  BackendInvalidationStream,
  INVALIDATION_RECONNECT_BASE_MS,
  INVALIDATION_RECONNECT_MAX_MS,
} from './invalidationStream.js'
export type { InvalidationStreamDiagnostics, InvalidationStreamOptions } from './invalidationStream.js'
export { assertBackendTransport, BackendTransportRequiredError } from './transport.js'
export type { BackendEventSourceFactory, BackendFetch, BackendTransport } from './transport.js'
export { backendTxListQuery, BackendTxReadError, BackendTxReads } from './BackendTxReads.js'
export {
  BACKEND_TX_STATUS_PHASES,
  BackendTxFailedError,
  backendTxStatus,
  isBackendTxStatus,
  trackedTxStatusKey,
} from './txStatus.js'
export type { BackendTxStatusInput, TrackedTxStatus, TxLifecyclePhase } from './txStatus.js'
export {
  BACKEND_SIGNER_TYPES,
  BACKEND_TX_STATUSES,
  BackendTxViewError,
  decodeBackendTxPage,
  decodeBackendTxView,
} from './txView.js'
export type {
  BackendSignerType,
  BackendTxApprovals,
  BackendTxApprover,
  BackendTxListOptions,
  BackendTxPage,
  BackendTxStatus,
  BackendTxView,
  BackendUnsignedTx,
} from './txView.js'
