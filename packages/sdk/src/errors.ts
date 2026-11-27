import type { GateVerdict, MigrationAction, SpokeGateState } from '@centrifuge/protocol'
import { DataSourceResponseError, displayUrl } from '@centrifuge/queries/core'
import type { HexString } from './types/index.js'
import type { BridgeLimit } from './utils/bridgeLimit.js'
import type { CentrifugeId } from './utils/types.js'

/**
 * Base class of the SDK's typed error hierarchy. Every error the SDK throws by
 * design extends this class, so consumers can distinguish SDK errors from
 * arbitrary runtime failures with a single `instanceof` check. The one
 * exception is {@link IndexerResponseError}, which descends from
 * `DataSourceResponseError` in `@centrifuge/queries` so that it and the REST
 * transport's `RestQueryError` share a single `instanceof` too.
 */
export class CentrifugeError extends Error {
  override name = 'CentrifugeError'
}

/** What a caller needs to resume a prepared backend transaction after connecting a wallet. */
export interface PreparedTransactionRef {
  /** The backend transaction id of the already-prepared, still-unsigned row. */
  txId: string
  /** The chain the prepared transaction must be signed on. */
  chainId: number
  /** The calldata the backend prepared, ready to sign as-is. */
  unsignedTx: { to: HexString; data: HexString; value: bigint; chainId: number }
}

/**
 * A transaction needs a signer and none is set (`Centrifuge.setSigner`). In
 * public mode this is thrown when a transaction is subscribed/awaited without
 * a signer; in backend mode it is thrown when a wallet-route prepare outcome
 * needs a signer at signing time.
 *
 * **Backend mode: the prepared transaction is resumable, and should be
 * resumed.** By the time this error is raised the backend has already built,
 * policy-checked and persisted a transaction row, and that row is still
 * awaiting a signature. `prepared` names it, so the caller's recovery is:
 * connect a wallet, then sign `prepared.unsignedTx` on `prepared.chainId` and
 * report the hash with `confirm(prepared.txId, { status: 'broadcast', txHash })`
 * — or `confirm(prepared.txId, { status: 'rejected' })` to close it out.
 * Calling the entity method again instead prepares a SECOND row and orphans
 * the first, which then sits in `prepared` forever.
 *
 * `prepared` is absent in public mode, where nothing was prepared and there is
 * nothing to resume.
 */
export class WalletRequiredError extends CentrifugeError {
  override name = 'WalletRequiredError'
  /** The prepared-but-unsigned backend transaction, when there is one to resume. */
  readonly prepared?: PreparedTransactionRef
  constructor(message = 'Signer not set', prepared?: PreparedTransactionRef) {
    super(message)
    this.prepared = prepared
  }
  /** Convenience: the resumable transaction's id, when this came off the wallet route. */
  get txId(): string | undefined {
    return this.prepared?.txId
  }
}

/**
 * Why the migration gate refused a write: the spoke the action keys on, its
 * phase, the gate table's verdict and the actions that phase still allows.
 */
export type MigrationGateRefusal = {
  /** The action name the gate judged. */
  action: string
  /** The spoke chain the action keys on. */
  centrifugeId: CentrifugeId
  /** The spoke's gate state, or null when it could not be derived. */
  phase: SpokeGateState | null
  verdict: GateVerdict | null
  reason: string
  /** The actions the phase still allows, or null when the phase is unknown. */
  allowedActions: readonly MigrationAction[] | null
}

/**
 * A write was refused with `POOL_MIGRATING`: the pool is mid protocol
 * migration and its phase does not allow the action on the spoke it targets.
 * The local build raises it from the migration gate with `gate` filled in;
 * the backend's 422 carries the pool id only.
 */
export class PoolMigratingError extends CentrifugeError {
  override name = 'PoolMigratingError'
  /** The pool that is mid protocol migration. */
  readonly poolId?: string
  /** Set when the local build's migration gate refused; the backend's 422 carries none. */
  readonly gate?: MigrationGateRefusal
  constructor(message: string, poolId?: string, gate?: MigrationGateRefusal) {
    super(message)
    this.poolId = poolId
    this.gate = gate
  }
}

/**
 * Why the hub's `BridgeCircuitBreaker` would refuse a cross-chain share transfer:
 * - `paused`: bridging of the share class is paused (`Paused`);
 * - `limitUnset`: the origin chain has no rate limit (`rateMax` 0), so only a
 *   transfer a hub manager authorized one by one passes (`TransferNotAuthorized`);
 * - `exceedsRateMax`: the amount alone is above the origin chain's `rateMax`
 *   (`TransferNotAuthorized`);
 * - `exceedsWindow`: the amount is above what is left of the current window
 *   (`ExceedsCumulativeLimit`).
 */
export type BridgeLimitReason = 'paused' | 'limitUnset' | 'exceedsRateMax' | 'exceedsWindow'

/**
 * A cross-chain share transfer was refused before signing because the pool's
 * bridging hook on the hub would revert it. The hub runs the hook when the
 * transfer's message arrives, after the shares have burned on a source that is
 * not the hub chain, so the SDK reads it first. `limit` is the
 * `shareClass.bridgeLimit(originCentrifugeId)` answer the refusal was read from.
 */
export class BridgeLimitError extends CentrifugeError {
  override name = 'BridgeLimitError'
  readonly reason: BridgeLimitReason
  readonly poolId: string
  readonly scId: HexString
  /** The chain the shares leave from; the limit is kept per origin chain. */
  readonly originCentrifugeId: CentrifugeId
  readonly destinationCentrifugeId: CentrifugeId
  /** The amount refused, in the share token's smallest unit. */
  readonly amount: bigint
  /** What the hub answered, as `shareClass.bridgeLimit` returns it. */
  readonly limit: BridgeLimit
  constructor(
    message: string,
    details: {
      reason: BridgeLimitReason
      poolId: string
      scId: HexString
      originCentrifugeId: CentrifugeId
      destinationCentrifugeId: CentrifugeId
      amount: bigint
      limit: BridgeLimit
    }
  ) {
    super(message)
    this.reason = details.reason
    this.poolId = details.poolId
    this.scId = details.scId
    this.originCentrifugeId = details.originCentrifugeId
    this.destinationCentrifugeId = details.destinationCentrifugeId
    this.amount = details.amount
    this.limit = details.limit
  }
}

/**
 * The source chain's `TokenBridge` does not map the destination's EVM chain
 * id to its Centrifuge id, so `TokenBridge.send` would revert `InvalidChainId`.
 * Raised before anything is approved or signed.
 */
export class InvalidBridgeChainError extends CentrifugeError {
  override name = 'InvalidBridgeChainError'
  readonly sourceCentrifugeId: CentrifugeId
  readonly destinationCentrifugeId: CentrifugeId
  /** The destination's EVM chain id, as `TokenBridge.send` takes it. */
  readonly destinationChainId: number
  /** What the source's `TokenBridge.chainIdToCentrifugeId` answered; 0 when unmapped. */
  readonly mappedCentrifugeId: number
  constructor(
    message: string,
    details: {
      sourceCentrifugeId: CentrifugeId
      destinationCentrifugeId: CentrifugeId
      destinationChainId: number
      mappedCentrifugeId: number
    }
  ) {
    super(message)
    this.sourceCentrifugeId = details.sourceCentrifugeId
    this.destinationCentrifugeId = details.destinationCentrifugeId
    this.destinationChainId = details.destinationChainId
    this.mappedCentrifugeId = details.mappedCentrifugeId
  }
}

/**
 * The pool has not made the source chain's `TokenBridge` a bridger, so
 * `TokenBridge.send` would revert `NotBridger` and nobody but the pool's own
 * bridgers can move shares off that chain. A hub manager enables it with a
 * Bridger grant toward the chain (`Hub.updateManager`, kind `Bridger`).
 * Raised before anything is approved or signed.
 */
export class BridgeNotEnabledError extends CentrifugeError {
  override name = 'BridgeNotEnabledError'
  readonly poolId: string
  readonly sourceCentrifugeId: CentrifugeId
  /** The source chain's `TokenBridge`, which the pool has to grant. */
  readonly tokenBridge: HexString
  constructor(message: string, details: { poolId: string; sourceCentrifugeId: CentrifugeId; tokenBridge: HexString }) {
    super(message)
    this.poolId = details.poolId
    this.sourceCentrifugeId = details.sourceCentrifugeId
    this.tokenBridge = details.tokenBridge
  }
}

/**
 * Why an adapter of a `pool.setAdapters` call cannot carry the pool's messages,
 * as the RPC of the chain it is on answers:
 * - `noCode`: no contract at the address;
 * - `noEntrypoint`: a contract whose `entrypoint()` reverts or returns nothing,
 *   so not an adapter;
 * - `otherVersion`: an adapter of another protocol version, bound to that
 *   version's MultiAdapter;
 * - `unknownEntrypoint`: an adapter bound to a MultiAdapter no protocol version
 *   in the address book deploys on that chain.
 */
export type AdapterMismatchReason = 'noCode' | 'noEntrypoint' | 'otherVersion' | 'unknownEntrypoint'

/** One adapter of one route that `pool.setAdapters` refused. */
export type AdapterMismatch = {
  /** The network the refused update configures. */
  targetCentrifugeId: CentrifugeId
  /** The chain the adapter is on: the hub for a local adapter, the target for a remote one. */
  centrifugeId: CentrifugeId
  side: 'local' | 'remote'
  adapter: HexString
  reason: AdapterMismatchReason
  /** The pool's version's MultiAdapter on `centrifugeId`, which the adapter's entrypoint must be. */
  multiAdapter: HexString
  /** The adapter's `entrypoint()`, or null for `noCode` and `noEntrypoint`. */
  entrypoint: HexString | null
  /** The version whose MultiAdapter `entrypoint` is on `centrifugeId`; null unless `otherVersion`. */
  adapterProtocolVersion: string | null
}

/**
 * `pool.setAdapters` was given an adapter that does not belong to the pool's
 * protocol version. Every adapter is bound at deployment to one MultiAdapter,
 * its `entrypoint()`, and only that MultiAdapter may send through it; a v3.3
 * adapter in a v3.2 pool's set reverts every message of the pool with
 * `NotEntrypoint`. Raised before anything is signed. `mismatches` lists every
 * refused adapter of the call, one entry per route and side; the top-level
 * fields repeat the first.
 */
export class AdapterVersionMismatchError extends CentrifugeError {
  override name = 'AdapterVersionMismatchError'
  readonly poolId: string
  /** The pool's protocol version. */
  readonly protocolVersion: string
  readonly mismatches: readonly AdapterMismatch[]
  readonly targetCentrifugeId: CentrifugeId
  /** The chain the first refused adapter is on: the hub for a local adapter, the target for a remote one. */
  readonly centrifugeId: CentrifugeId
  readonly side: 'local' | 'remote'
  readonly adapter: HexString
  readonly reason: AdapterMismatchReason
  /** The pool's version's MultiAdapter on `centrifugeId`, which the adapter's entrypoint must be. */
  readonly multiAdapter: HexString
  /** The adapter's `entrypoint()`, or null for `noCode` and `noEntrypoint`. */
  readonly entrypoint: HexString | null
  /** The version whose MultiAdapter `entrypoint` is on `centrifugeId`; null unless `otherVersion`. */
  readonly adapterProtocolVersion: string | null
  constructor(
    message: string,
    details: { poolId: string; protocolVersion: string; mismatches: readonly [AdapterMismatch, ...AdapterMismatch[]] }
  ) {
    super(message)
    const [first] = details.mismatches
    this.poolId = details.poolId
    this.protocolVersion = details.protocolVersion
    this.mismatches = details.mismatches
    this.targetCentrifugeId = first.targetCentrifugeId
    this.centrifugeId = first.centrifugeId
    this.side = first.side
    this.adapter = first.adapter
    this.reason = first.reason
    this.multiAdapter = first.multiAdapter
    this.entrypoint = first.entrypoint
    this.adapterProtocolVersion = first.adapterProtocolVersion
  }
}

export type RetryMessageRefusal = 'not-parked' | 'ambiguous'

export class RetryMessageError extends CentrifugeError {
  override name = 'RetryMessageError'
  readonly reason: RetryMessageRefusal
  readonly fromCentrifugeId: CentrifugeId
  readonly toCentrifugeId: CentrifugeId
  readonly messageHash: HexString
  readonly gateways: readonly { protocolVersion: string; gateway: HexString }[]
  constructor(
    message: string,
    details: {
      reason: RetryMessageRefusal
      fromCentrifugeId: CentrifugeId
      toCentrifugeId: CentrifugeId
      messageHash: HexString
      gateways: readonly { protocolVersion: string; gateway: HexString }[]
    }
  ) {
    super(message)
    this.reason = details.reason
    this.fromCentrifugeId = details.fromCentrifugeId
    this.toCentrifugeId = details.toCentrifugeId
    this.messageHash = details.messageHash
    this.gateways = details.gateways
  }
}

export type RepayBatchRefusal = 'not-underpaid' | 'ambiguous' | 'no-refund-address'

/**
 * `repayBatch` found no Gateway on the source chain holding the batch as underpaid, more than one, or one shared by
 * versions with different MultiAdapters; or it was built without a `fromAddress` to refund to. Raised before signing.
 */
export class RepayBatchError extends CentrifugeError {
  override name = 'RepayBatchError'
  readonly reason: RepayBatchRefusal
  readonly fromCentrifugeId: CentrifugeId
  readonly toCentrifugeId: CentrifugeId
  readonly batchHash: HexString
  /** The Gateways checked; for `ambiguous`, the ones holding the batch or the versions sharing it; empty for `no-refund-address`. */
  readonly gateways: readonly { protocolVersion: string; gateway: HexString }[]
  constructor(
    message: string,
    details: {
      reason: RepayBatchRefusal
      fromCentrifugeId: CentrifugeId
      toCentrifugeId: CentrifugeId
      batchHash: HexString
      gateways: readonly { protocolVersion: string; gateway: HexString }[]
    }
  ) {
    super(message)
    this.reason = details.reason
    this.fromCentrifugeId = details.fromCentrifugeId
    this.toCentrifugeId = details.toCentrifugeId
    this.batchHash = details.batchHash
    this.gateways = details.gateways
  }
}

/**
 * A hub policy was asked for on a chain whose address book lists no `StdHubPolicyFactory`, so there is no address to
 * preview or deploy it at. Raised before anything is signed. A policy that already exists can still be installed.
 */
export class StdHubPolicyFactoryMissingError extends CentrifugeError {
  override name = 'StdHubPolicyFactoryMissingError'
  /** The pool the policy was asked for. */
  readonly poolId: string
  /** The pool's hub chain, where the factory would be. */
  readonly centrifugeId: CentrifugeId
  constructor(message: string, details: { poolId: string; centrifugeId: CentrifugeId }) {
    super(message)
    this.poolId = details.poolId
    this.centrifugeId = details.centrifugeId
  }
}

/**
 * `deploy()` would make `AdapterFailover` the pool's adapter manager on a spoke
 * on another chain than its hub, and that chain's `ProtocolGuardian.safe()` is
 * the zero address, so the manager would have no steward to act through.
 * Raised before anything is signed.
 */
export class AdapterFailoverStewardMissingError extends CentrifugeError {
  override name = 'AdapterFailoverStewardMissingError'
  readonly poolId: string
  /** The spoke the pool is being deployed to. */
  readonly centrifugeId: CentrifugeId
  /** The spoke's ProtocolGuardian, whose `safe()` answered the zero address. */
  readonly protocolGuardian: HexString
  constructor(message: string, details: { poolId: string; centrifugeId: CentrifugeId; protocolGuardian: HexString }) {
    super(message)
    this.poolId = details.poolId
    this.centrifugeId = details.centrifugeId
    this.protocolGuardian = details.protocolGuardian
  }
}

/**
 * The backend refused a write with 422 `UNKNOWN_POOL`: the pool id is
 * well-formed and the caller is authorised for it, but the chain projection has
 * no row for it.
 *
 * A typed error of its own rather than a {@link TxPreparationError} because it
 * is not a caller-input error: there is nothing in the request to correct, and
 * an immediate retry will fail identically. Either the pool has not been
 * indexed into the projection yet — in which case the same request succeeds
 * once it is — or it does not exist on chain at all. Callers should treat it as
 * "not ready or not there", not as "bad request".
 */
export class UnknownPoolError extends CentrifugeError {
  override name = 'UnknownPoolError'
  /** The pool the chain projection has no row for. */
  readonly poolId?: string
  constructor(message: string, poolId?: string) {
    super(message)
    this.poolId = poolId
  }
}

/**
 * The error codes the backend returns on a non-migration 4xx/5xx from
 * prepare/preview.
 *
 * The union is open (`(string & {})`) on purpose: the backend's code vocabulary
 * grows as the backend adds actions, and an unrecognized code must
 * surface as a typed error carrying that code — never as an untyped throw the
 * caller cannot branch on. Known codes still autocomplete.
 */
export type TxPreparationErrorCode =
  | 'UNSUPPORTED_ACTION'
  | 'UNKNOWN_CHAIN'
  | 'POOL_ID_MISMATCH'
  | 'UNKNOWN_VALUATION'
  | 'FORDEFI_VAULT_MISSING'
  | 'FORDEFI_REQUEST_REJECTED'
  | 'FORDEFI_UNAVAILABLE'
  | 'SIGNING_CONFIG_NOT_FOUND'
  /** The request body itself was rejected (a 422 carrying `issues`, no `code`). */
  | 'VALIDATION_FAILED'
  /** The prepare response did not match the frozen wire contract. */
  | 'MALFORMED_PREPARE_RESPONSE'
  /** Throttled (429). Retryable, unlike every other code here. */
  | 'RATE_LIMITED'
  | (string & {})

/**
 * The backend answered a non-migration 4xx/5xx from transaction
 * prepare/preview, carrying the backend's error `code`.
 */
export class TxPreparationError extends CentrifugeError {
  override name = 'TxPreparationError'
  readonly code: TxPreparationErrorCode
  /** HTTP status the backend answered with, when the error came off the wire. */
  readonly status?: number
  /** The pool the refused action targeted. */
  readonly poolId?: string
  /**
   * Per-field validation detail, when the backend sent an `issues` array.
   *
   * Independent of `code`: a `code` always wins as the error's identity, and
   * `issues` ride along as detail rather than replacing it — so a 422 that
   * carries both is fully reported. Shape is the backend's validation-pipe
   * output (`{ path, message }` entries today).
   */
  readonly issues?: readonly unknown[]
  constructor(
    message: string,
    code: TxPreparationErrorCode,
    details: { status?: number; poolId?: string; issues?: readonly unknown[] } = {}
  ) {
    super(message)
    this.code = code
    this.status = details.status
    this.poolId = details.poolId
    this.issues = details.issues
  }
}

/**
 * The codes the confirm endpoint answers a refusal with: the five 409
 * `TransactionNotConfirmableError` codes, or 404 `TX_NOT_FOUND`.
 *
 * **Backend-owned vocabulary.** Every value here comes off the wire; the SDK
 * never invents one. The union is open (`(string & {})`) only so a code the
 * backend adds later still arrives typed — not as an extension point for
 * client-side conditions. Those get their own error class
 * ({@link TxConfirmationTargetError}) so they can never turn up in a consumer's
 * `switch` over these codes.
 */
export type TxConfirmationErrorCode =
  | 'NOT_WALLET_CONNECT'
  | 'CONCURRENT_MODIFICATION'
  | 'NOT_BROADCASTABLE'
  | 'NOT_PENDABLE'
  | 'NOT_REJECTABLE'
  | 'TX_NOT_FOUND'
  | (string & {})

/**
 * The backend refused a report about a wallet-route transaction.
 *
 * The transaction itself may well have been broadcast — this error is about the
 * backend's record of it, so a caller that already has a hash should surface it
 * rather than treat the transaction as failed.
 *
 * `origin` is `'backend'` on every instance: this class is raised only from a
 * response, so `code` is always a backend code and `status` is always the
 * status that carried it.
 */
export class TxConfirmationError extends CentrifugeError {
  override name = 'TxConfirmationError'
  /** Where `code` came from. Always `'backend'`; see {@link TxConfirmationTargetError}. */
  readonly origin = 'backend' as const
  readonly code: TxConfirmationErrorCode
  /** The backend transaction id the report was about. */
  readonly txId: string
  /** HTTP status the backend answered with. */
  readonly status: number
  constructor(message: string, code: TxConfirmationErrorCode, txId: string, status: number) {
    super(message)
    this.code = code
    this.txId = txId
    this.status = status
  }
}

/**
 * A `confirm` call could not be addressed, so no request was made.
 *
 * The confirm route is pool-scoped (`POST pools/:poolId/tx/:txId/confirm`)
 * while the `TxStrategy.confirm` seam is pool-less, so the strategy resolves
 * the pool from the prepare response it recorded. Confirming a transaction it
 * never prepared leaves it with nothing to address, and the fix is caller-side:
 * pass `{ poolId }` explicitly.
 *
 * A deliberately separate class from {@link TxConfirmationError}, whose `code`
 * union the backend owns: a client-side condition must not be representable as
 * a backend code, or a consumer's `switch` over those codes silently gains a
 * branch the backend never sends. `origin: 'client'` discriminates the two even
 * when both are caught as `CentrifugeError`.
 */
export class TxConfirmationTargetError extends CentrifugeError {
  override name = 'TxConfirmationTargetError'
  /** Where this error was raised. Always `'client'`: nothing went over the wire. */
  readonly origin = 'client' as const
  /** The transaction id the caller asked to confirm. */
  readonly txId: string
  constructor(message: string, txId: string) {
    super(message)
    this.txId = txId
  }
}

/**
 * The backend denied a write on policy grounds: a 403, or the structured 422
 * `PolicyDeniedError` carrying the policy `violations`.
 */
export class PolicyDeniedError extends CentrifugeError {
  override name = 'PolicyDeniedError'
  /** The policy violations reported by the backend. Shape is defined by the backend's policy engine. */
  readonly violations: unknown[]
  /** The backend's denial reason `code` on a 403; absent on the structured 422. */
  readonly code?: string
  constructor(message: string, violations: unknown[] = [], code?: string) {
    super(message)
    this.violations = violations
    this.code = code
  }
}

/**
 * Deployment verification found a mismatch between an indexer-reported contract
 * address and the known deployment set. Names the chain, protocol version, and
 * field that mismatched; nothing is dropped silently.
 */
export class DeploymentVerificationError extends CentrifugeError {
  override name = 'DeploymentVerificationError'
  readonly chainId: number
  readonly protocolVersion: string
  readonly field: string
  constructor(message: string, details: { chainId: number; protocolVersion: string; field: string }) {
    super(message)
    this.chainId = details.chainId
    this.protocolVersion = details.protocolVersion
    this.field = details.field
  }
}

// There is deliberately no "unsupported in this mode" error here: there are no
// modes to be unsupported in, transport injection is always legal, and a
// never-thrown export would be a promise the package cannot keep.
// `UnsupportedQueryError` (`@centrifuge/queries/graphql`), which the
// `graphqlTarget` blocked-entry path throws, is a different class.

/**
 * The indexer answered a GraphQL request with a non-2xx status, or with a 2xx
 * whose body is not JSON (a gateway's "Bad Gateway", a proxy's HTML page, a
 * truncated body). The body is carried as a short excerpt. The message names
 * the indexer by origin and path only; `url` keeps the configured value.
 */
export class IndexerResponseError extends DataSourceResponseError {
  override name = 'IndexerResponseError'
  constructor(status: number, url: string, body: string) {
    const ok = status >= 200 && status < 300
    super(
      `Indexer at ${displayUrl(url)} answered ${status}${ok ? ' with a body that is not JSON' : ''}${body ? `: ${body}` : ''}`,
      { status, url, body }
    )
  }
}

/**
 * The policy and authorization rows a read was given are broken rather than incomplete: rows of two pools, a hub row
 * of another chain than the pool's hub chain, a hub row without a column it needs, or a malformed number. The message
 * names what is missing or inconsistent.
 */
export class AuthorizationFoldError extends CentrifugeError {
  override name = 'AuthorizationFoldError'
}

/**
 * A read of the pre-send policy check failed: the pool's protocol context or hub client, the installed policy, its
 * expiry, the hub chain's block time, a call's delay or authorization, or who may update the share price. The check
 * never lets a call through on a failed read. This hub transaction was not signed or sent, and a send the method made
 * before it stays done (`docs/sdk/hub-policies.md`, "What stops a method"). The message names the pool and the read
 * that failed, and `cause` holds the underlying error.
 */
export class HubPolicyPreflightError extends CentrifugeError {
  override name = 'HubPolicyPreflightError'
}
