import { defer, firstValueFrom, isObservable, mergeMap, of, type Observable } from 'rxjs'
import type { Centrifuge } from '../Centrifuge.js'
import {
  PolicyDeniedError,
  PoolMigratingError,
  TxConfirmationError,
  TxConfirmationTargetError,
  TxPreparationError,
  UnknownPoolError,
  WalletRequiredError,
  type TxConfirmationErrorCode,
} from '../errors.js'
import type { HexString } from '../types/index.js'
import type { OperationStatus, Transaction } from '../types/transaction.js'
import type { CentrifugeId } from '../utils/types.js'
import { makeThenable } from '../utils/rx.js'
import { doTransaction } from '../utils/transaction.js'
import type { PoolAction, PrepareOutcome, TxStrategy } from './TxStrategy.js'
import { parseCanonicalWei } from './wei.js'

/**
 * The write half of the SDK's transport contract: a `fetch` and nothing else.
 *
 * The strategy never reads or writes a cookie, never fetches or attaches a CSRF
 * token and has no retry policy — the app's `fetch` already does all of that
 * (the injected transport's contract). That is why this class can
 * be constructed and tested without any session machinery, and why grepping
 * `packages/sdk` for `credentials`/`X-CSRF-Token` finds nothing.
 */
export interface BackendTxTransport {
  fetch: typeof fetch
}

export interface BackendPrepareOptions {
  /**
   * Absolute base URL of the backend API — the prefix the pool routes hang off,
   * e.g. `https://app.example.com/api`. A trailing slash is optional.
   */
  baseUrl: string
  /** Injected transport (see {@link BackendTxTransport}). */
  transport: BackendTxTransport
  /**
   * Ask the backend for the wallet route even when the caller is Fordefi
   * eligible (the documented escape hatch; the backend honours it only for
   * Fordefi-eligible users and audits its use). Omitted from the request body
   * entirely when left undefined, so the backend applies its own default.
   */
  useWalletConnect?: boolean
}

/** `POST tx/prepare` 200 — the wallet route. */
interface PrepareWalletBody {
  txId: string
  signerType: 'wallet_connect'
  status: string
  unsignedTx: { to: string; data: string; value: string; chainId: number }
}

/** `POST tx/prepare` 202 — the custodial route. */
interface PrepareCustodialBody {
  txId: string
  signerType: 'fordefi'
  status: string
}

function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const body = await res.json()
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : { body }
  } catch {
    return {}
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/**
 * The backend-mode `TxStrategy`: transactions are built, policy-checked and
 * recorded by the backend, and either handed to the connected wallet to sign
 * (200, "wallet route") or to a Fordefi vault to sign asynchronously (202,
 * "custodial route").
 *
 * Protocol version resolution is the backend's, not ours: `prepare` sends a
 * protocol-neutral `PoolAction` and the backend resolves the pool's
 * `protocolVersion` before building, as both strategies must. The visible
 * mechanism is the refusal — a pool mid-migration answers 422 `POOL_MIGRATING`, which
 * this class turns into {@link PoolMigratingError}. The SDK deliberately does
 * NOT resolve the version itself on this path: doing so would put a second,
 * possibly disagreeing, opinion on the write path.
 *
 * A signer is optional. The custodial route needs no wallet at all; the wallet
 * route needs one only at the moment it is known to be the wallet route, which
 * is why `WalletRequiredError` is raised there and not at subscribe time.
 */
export class BackendPrepareStrategy implements TxStrategy {
  readonly #baseUrl: string
  readonly #fetch: typeof fetch
  readonly #useWalletConnect?: boolean

  /**
   * `txId -> poolId`, remembered from this strategy's own prepare responses.
   *
   * The `TxStrategy.confirm(txId, report)` seam is pool-less while the backend
   * route is pool-scoped (`POST pools/:poolId/tx/:txId/confirm`), and the only
   * transactions a strategy can be asked to confirm are the ones it prepared.
   * Callers that know the pool can pass it explicitly instead.
   */
  readonly #poolIdByTxId = new Map<string, string>()

  constructor(options: BackendPrepareOptions) {
    this.#baseUrl = trimBase(options.baseUrl)
    this.#fetch = options.transport.fetch
    this.#useWalletConnect = options.useWalletConnect
  }

  /**
   * `POST pools/:poolId/tx/prepare`.
   *
   * `opts.signingAddress` is intentionally not forwarded: the backend accepts a
   * `callerAddress` on `preview` only (it drives the pre-flight simulation) and
   * ignores it on `prepare`, whose gate is policy, not simulation.
   */
  prepare(action: PoolAction, _opts: { signingAddress?: HexString } = {}): Observable<PrepareOutcome> {
    return defer(async (): Promise<PrepareOutcome> => {
      const url = `${this.#baseUrl}/pools/${encodeURIComponent(action.poolId)}/tx/prepare`
      const res = await this.#fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          action: action.action,
          payload: action.payload,
          ...(this.#useWalletConnect === undefined ? {} : { useWalletConnect: this.#useWalletConnect }),
        }),
      })

      if (res.status === 200) return this.#walletOutcome(await readJson(res), action)
      if (res.status === 202) return this.#custodialOutcome(await readJson(res), action)
      throw await this.#prepareError(res, action)
    })
  }

  /**
   * `POST pools/:poolId/tx/:txId/confirm` — report the wallet's outcome.
   *
   * `poolId` is resolved from the prepare response this strategy recorded; pass
   * it explicitly when confirming a transaction this instance did not prepare.
   */
  async confirm(
    txId: string,
    report: { status: 'broadcast'; txHash: HexString } | { status: 'rejected' },
    opts: { poolId?: string } = {}
  ): Promise<void> {
    const poolId = opts.poolId ?? this.#poolIdByTxId.get(txId)
    if (!poolId) {
      // A client-side condition, so NOT a TxConfirmationError: that class's
      // `code` union is the backend's, and inventing a value in it would add a
      // branch to consumer switches that the backend never sends.
      throw new TxConfirmationTargetError(
        `Cannot confirm transaction "${txId}": no pool is known for it. The confirm route is ` +
          `pool-scoped, so either confirm a transaction this strategy prepared or pass { poolId }.`,
        txId
      )
    }

    const url = `${this.#baseUrl}/pools/${encodeURIComponent(poolId)}/tx/${encodeURIComponent(txId)}/confirm`
    const res = await this.#fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(report),
    })

    if (!res.ok) throw await this.#confirmError(res, txId)
    // Terminal for this strategy either way: a broadcast hash is recorded, a
    // rejection closes the row. Nothing else will be reported about it.
    this.#poolIdByTxId.delete(txId)
  }

  #walletOutcome(body: Record<string, unknown>, action: PoolAction): PrepareOutcome {
    const { txId, signerType, unsignedTx } = body as unknown as PrepareWalletBody
    if (typeof txId !== 'string' || !txId) {
      throw this.#malformed(action, `200 response has no \`txId\`: ${JSON.stringify(body)}`)
    }
    if (signerType !== 'wallet_connect') {
      throw this.#malformed(
        action,
        `200 is the wallet route, but the response says signerType="${String(signerType)}". ` +
          `The custodial route is answered with 202.`
      )
    }
    if (!unsignedTx || typeof unsignedTx !== 'object') {
      throw this.#malformed(action, `200 wallet-route response carries no \`unsignedTx\`: ${JSON.stringify(body)}`)
    }
    const { to, data, value, chainId } = unsignedTx
    if (typeof to !== 'string' || typeof data !== 'string' || typeof chainId !== 'number') {
      throw this.#malformed(action, `\`unsignedTx\` is missing to/data/chainId: ${JSON.stringify(unsignedTx)}`)
    }
    // `value` arrives as a canonical decimal wei STRING (the backend's `Wei`
    // type) and is parsed here, before signing. Validated rather than trusted:
    // `BigInt('')` is 0n and `BigInt('0x10')` is 16, so a wrong-format value
    // would silently sign for the wrong amount. The check lives in
    // `tx/wei.ts`, shared with the backend subpath's tx view, so a value this
    // path refuses cannot read back as a number over there.
    const parsedValue = parseCanonicalWei(value, (quoted) =>
      this.#malformed(action, `\`unsignedTx.value\` must be a canonical non-negative decimal wei string, got ${quoted}`)
    )

    this.#poolIdByTxId.set(txId, action.poolId)
    return {
      route: 'wallet',
      txId,
      unsignedTx: { to: to as HexString, data: data as HexString, value: parsedValue, chainId },
    }
  }

  #custodialOutcome(body: Record<string, unknown>, action: PoolAction): PrepareOutcome {
    const { txId, signerType, status } = body as unknown as PrepareCustodialBody
    if (typeof txId !== 'string' || !txId) {
      throw this.#malformed(action, `202 response has no \`txId\`: ${JSON.stringify(body)}`)
    }
    if (signerType !== 'fordefi') {
      throw this.#malformed(
        action,
        `202 is the custodial route, but the response says signerType="${String(signerType)}".`
      )
    }
    this.#poolIdByTxId.set(txId, action.poolId)
    return { route: 'custodial', txId, signerType: 'fordefi', status: String(status ?? '') }
  }

  #malformed(action: PoolAction, detail: string): TxPreparationError {
    return new TxPreparationError(
      `Backend prepare response for action "${action.action}" is malformed. ${detail}`,
      'MALFORMED_PREPARE_RESPONSE',
      { poolId: action.poolId }
    )
  }

  /**
   * Map a non-2xx from prepare/preview onto the typed error hierarchy.
   * Unknown codes still produce a typed
   * {@link TxPreparationError} carrying whatever code the backend sent, so a
   * vocabulary the SDK has not seen yet is never an untyped throw.
   *
   * Two response fields can identify a refusal, and their precedence is
   * explicit rather than incidental:
   *
   * 1. `code` — the backend's own identity for the refusal. When present it
   *    always wins, whatever else the body carries.
   * 2. `issues` — the validation pipe's per-field detail. It only *names* the
   *    error (as `VALIDATION_FAILED`) when there is no `code`; otherwise it
   *    rides along on `error.issues`. Either way it is never dropped.
   */
  async #prepareError(res: Response, action: PoolAction): Promise<Error> {
    const body = await readJson(res)
    const error = asString(body.error)
    const code = asString(body.code)
    const issues = Array.isArray(body.issues) ? (body.issues as readonly unknown[]) : undefined
    const detail = `${res.status} ${error ?? 'error'}${code ? ` (${code})` : ''}${
      issues ? ` issues=${JSON.stringify(issues)}` : ''
    }`

    // The two version-source refusals. Both come back as a 422
    // with a `code`, and both are states of the pool rather than faults in the
    // request — which is why neither folds into TxPreparationError.
    if (res.status === 422 && code === 'POOL_MIGRATING') {
      return new PoolMigratingError(
        `Pool ${action.poolId} is migrating between protocol versions; the backend refused to prepare ` +
          `"${action.action}" until the migration lands.`,
        action.poolId
      )
    }
    if (res.status === 422 && code === 'UNKNOWN_POOL') {
      return new UnknownPoolError(
        `Pool ${action.poolId} is unknown to the chain projection, so the backend could not resolve a ` +
          `protocol version to build "${action.action}" against. The pool id is well-formed and the ` +
          `request authorised — the pool has either not been indexed into the projection yet, or does ` +
          `not exist on chain. Retrying the same request unchanged will fail identically until it is ` +
          `indexed.`,
        action.poolId
      )
    }
    // The structured policy-limit refusal: `{ error: 'PolicyDeniedError', violations: [...] }`.
    // `code` is extracted here exactly as on the 403 path: the two denial
    // shapes differ in what else they carry, not in whether a code is
    // meaningful, and a consumer branching on `code` must not have to know
    // which status it arrived on.
    if (res.status === 422 && error === 'PolicyDeniedError') {
      const violations = Array.isArray(body.violations) ? (body.violations as unknown[]) : []
      return new PolicyDeniedError(
        `Backend policy denied "${action.action}" on pool ${action.poolId}: ${violations.length} violation(s)` +
          `${code ? ` (${code})` : ''}.`,
        violations,
        code
      )
    }
    // A 403 is the authorization denial (a missing `tx:prepare` grant), whose
    // reason travels as `code`.
    if (res.status === 403) {
      return new PolicyDeniedError(`Backend denied "${action.action}" on pool ${action.poolId}: ${detail}.`, [], code)
    }
    // Throttled. The body is `{ error: 'rate_limit_exceeded' }` with no `code`,
    // so it needs one of its own — a caller must be able to tell "try again
    // later" apart from "this request will never be accepted". A `code`, if the
    // backend ever starts sending one, still wins (see the precedence above).
    if (res.status === 429 && !code) {
      return new TxPreparationError(
        `Backend throttled the prepare request for "${action.action}" on pool ${action.poolId}. ` +
          `Retry after the throttle window.`,
        'RATE_LIMITED',
        { status: res.status, poolId: action.poolId, issues }
      )
    }
    // The DTO-level refusal, found by round-tripping the real controller: an
    // action name the `PrepareTransactionDtoSchema` union does not know is
    // rejected by the validation pipe as `{ error: 'validation_failed',
    // issues: [...] }` — a 422 with NO `code`, unlike every documented case.
    // It is the shape an SDK that sends an action the backend has not
    // implemented yet actually gets, so it needs a code of its own rather than
    // a bare `HTTP_422`.
    if (issues && !code) {
      return new TxPreparationError(
        `Backend rejected the prepare request for "${action.action}" on pool ${action.poolId} as invalid: ` +
          `${JSON.stringify(issues)}. If the action name is correct, the backend does not implement it ` +
          `yet — its per-action DTO union grows as the backend adds actions.`,
        'VALIDATION_FAILED',
        { status: res.status, poolId: action.poolId, issues }
      )
    }
    return new TxPreparationError(
      `Backend refused to prepare "${action.action}" on pool ${action.poolId}: ${detail}.`,
      code ?? `HTTP_${res.status}`,
      { status: res.status, poolId: action.poolId, issues }
    )
  }

  /** Map a non-2xx from the confirm route (409 x5, 404, 403). */
  async #confirmError(res: Response, txId: string): Promise<Error> {
    const body = await readJson(res)
    const error = asString(body.error)
    const code = asString(body.code)

    if (res.status === 403) {
      return new PolicyDeniedError(
        `Backend denied confirming transaction "${txId}": ${res.status} ${error ?? 'forbidden'}.`,
        [],
        code
      )
    }
    return new TxConfirmationError(
      `Backend refused the report for transaction "${txId}": ${res.status} ${error ?? 'error'}` +
        `${code ? ` (${code})` : ''}.`,
      (code ?? `HTTP_${res.status}`) as TxConfirmationErrorCode,
      txId,
      res.status
    )
  }
}

/** Options for {@link backendTransaction}. */
export interface BackendTransactionOptions {
  /** Status title, identical to the one the LocalBuild path uses for the action. */
  title: string
  /** The network the action executes on; the prepared `chainId` must agree. */
  centrifugeId: CentrifugeId
  /** Forwarded to `prepare`; the backend ignores it, entities may still pass it. */
  signingAddress?: HexString
}

/**
 * Run a `PoolAction` through a backend `TxStrategy` and expose it as the same
 * {@link Transaction} observable every entity method already returns.
 *
 * Emission contract, unchanged from `LocalBuildStrategy` for the wallet route:
 * `SwitchingChain?` -> `SigningTransaction` -> `TransactionPending` ->
 * `TransactionConfirmed`. The chain switch, the Safe handling and the receipt
 * wait all come from `Centrifuge._transact`/`doTransaction` — this function
 * adds only the prepare call before signing and the confirm call after, so app
 * code cannot tell the two strategies apart.
 *
 * On the custodial route it emits one `CustodialHandoff` status and completes:
 * the vault signs asynchronously and the long-lived lifecycle is observed
 * through the backend's tx rows, not through this observable.
 */
export function backendTransaction(
  root: Centrifuge,
  strategy: TxStrategy,
  action: PoolAction,
  options: BackendTransactionOptions
): Transaction {
  const { title, centrifugeId } = options

  async function* run(): AsyncGenerator<OperationStatus | Transaction> {
    const outcome = await firstValueFrom(
      strategy.prepare(action, options.signingAddress ? { signingAddress: options.signingAddress } : {})
    )

    if (outcome.route === 'custodial') {
      // Hand-off is the end of this observable's job. No signer was needed and
      // none was touched.
      yield {
        id: outcome.txId,
        type: 'CustodialHandoff',
        title,
        txId: outcome.txId,
        signerType: outcome.signerType,
        status: outcome.status,
      }
      return
    }

    if (outcome.route !== 'wallet') {
      throw new Error(
        `backendTransaction: strategy returned the "${outcome.route}" route for "${action.action}". ` +
          `A backend strategy must answer 'wallet' or 'custodial'; locally built actions must not be ` +
          `routed through here (see resolveActionRoute).`
      )
    }

    const { txId, unsignedTx } = outcome
    const chainId = await root._idToChain(centrifugeId)
    if (unsignedTx.chainId !== chainId) {
      throw new Error(
        `backendTransaction: the backend prepared "${action.action}" for chain ${unsignedTx.chainId}, but ` +
          `Centrifuge ID ${centrifugeId} is chain ${chainId}. Refusing to sign a transaction for a ` +
          `different chain than the caller asked for.`
      )
    }

    // The signer check happens HERE rather than being left to `_transact`, for
    // one reason: at this point the prepared transaction is in scope, and the
    // caller needs it. A bare "Signer not set" makes the natural recovery
    // (connect a wallet, call the method again) prepare a SECOND row and orphan
    // this one — which then sits in `prepared` forever. Naming the row makes
    // the transaction resumable instead.
    if (!root.signer) {
      throw new WalletRequiredError(
        `Signer not set: the backend prepared transaction "${txId}" for "${action.action}" on pool ` +
          `${action.poolId} and it is waiting for a signature. Connect a wallet and resume THIS ` +
          `transaction (see WalletRequiredError.prepared) — preparing the action again would leave ` +
          `"${txId}" orphaned.`,
        { txId, chainId, unsignedTx }
      )
    }

    // `_transact` supplies the signer (it raises its own WalletRequiredError if
    // one is unset between the check above and here), the chain switch and the
    // wallet client.
    yield root._transact(async function* (ctx) {
      const statuses = doTransaction(title, ctx, () =>
        ctx.walletClient.sendTransaction({
          to: unsignedTx.to,
          data: unsignedTx.data,
          value: unsignedTx.value,
        })
      )
      let reportedBroadcast = false
      try {
        // Driven by hand rather than `yield*` so the broadcast report goes out
        // immediately after `TransactionPending` is emitted: a subscriber then
        // already holds the hash even if the report itself fails.
        for await (const status of statuses) {
          yield status
          if (!reportedBroadcast && status.type === 'TransactionPending') {
            reportedBroadcast = true
            await confirmBroadcast(strategy, txId, action.poolId, status.hash)
          }
        }
      } catch (error) {
        // No hash yet means the wallet never broadcast — a decline, or a
        // failure while signing. Tell the backend so the row reaches its
        // terminal state instead of sitting in `prepared` forever.
        if (!reportedBroadcast) await reportRejection(strategy, txId, action.poolId, error)
        throw error
      }
    }, centrifugeId)
  }

  const $tx = defer(run).pipe(mergeMap((value) => (isObservable(value) ? value : of(value)))) as Transaction
  makeThenable($tx, true)
  Object.assign($tx, { centrifugeId })
  return $tx
}

async function confirmBroadcast(strategy: TxStrategy, txId: string, poolId: string, txHash: HexString): Promise<void> {
  await (strategy.confirm as BackendPrepareStrategy['confirm'] | undefined)?.call(
    strategy,
    txId,
    { status: 'broadcast', txHash },
    { poolId }
  )
}

async function reportRejection(strategy: TxStrategy, txId: string, poolId: string, cause: unknown): Promise<void> {
  try {
    await (strategy.confirm as BackendPrepareStrategy['confirm'] | undefined)?.call(
      strategy,
      txId,
      { status: 'rejected' },
      { poolId }
    )
  } catch (reportError) {
    // The signing failure is what the caller must see, so it is the error that
    // propagates. This one is logged rather than swallowed: it means the
    // backend row is left mid-flight and an operator may need to look.
    console.error(
      `Failed to report the rejection of backend transaction "${txId}" (pool ${poolId}). ` +
        `The transaction was not broadcast; its backend row may stay in "prepared".`,
      reportError,
      { cause }
    )
  }
}
