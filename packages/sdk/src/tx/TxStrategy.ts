import { defer, isObservable, type Observable } from 'rxjs'
import type { Centrifuge } from '../Centrifuge.js'
import type { HexString } from '../types/index.js'
import type { BuiltTransaction, Transaction } from '../types/transaction.js'

/**
 * The protocol-neutral name of a pool action (e.g. `updatePoolMetadata`).
 *
 * Provisional: a free string until the protocol builders introduce the closed
 * action catalogue.
 */
export type PoolActionName = string

/**
 * A protocol-neutral description of a mutating pool operation, handed to a
 * {@link TxStrategy} for preparation.
 */
export type PoolAction = {
  action: PoolActionName
  poolId: string
  /**
   * Action-specific payload.
   *
   * Provisional: until the protocol builders land,
   * {@link LocalBuildStrategy} expects the entity-produced {@link Transaction}
   * here; typed per-action payloads replace this.
   */
  payload: unknown
}

/** The result of preparing a {@link PoolAction}, discriminated by execution route. */
export type PrepareOutcome =
  /** The transaction was built locally and is signed and broadcast by the SDK. */
  | { route: 'local'; built: BuiltTransaction }
  /** The backend prepared an unsigned transaction for the configured signer to sign. */
  | {
      route: 'wallet'
      txId: string
      unsignedTx: { to: HexString; data: HexString; value: bigint; chainId: number }
    }
  /** The backend handed the transaction off to a custodial signer. */
  | { route: 'custodial'; txId: string; signerType: 'fordefi'; status: string }

/**
 * The write seam of the SDK. All transactions go through a `TxStrategy` that
 * turns a {@link PoolAction} into a {@link PrepareOutcome}.
 *
 * The public-mode strategy ({@link LocalBuildStrategy}) builds calldata locally
 * and has no `confirm`; a backend strategy later prepares via
 * `POST /pools/:poolId/tx/prepare` and reports wallet-signed hashes back via
 * `confirm`.
 */
export interface TxStrategy {
  /** Prepare a pool action for execution. */
  prepare(action: PoolAction, opts: { signingAddress?: HexString }): Observable<PrepareOutcome>
  /** Optional. Reports a frontend-signed hash (or rejection) back to the strategy. */
  confirm?(txId: string, report: { status: 'broadcast'; txHash: HexString } | { status: 'rejected' }): Promise<void>
}

/**
 * The public-mode `TxStrategy`: builds unsigned calldata locally through the
 * existing `wrapTransaction`/`buildOnly` machinery and always resolves to the
 * `'local'` route. It intentionally has no `confirm` — locally built
 * transactions are signed and broadcast by the SDK itself, so there is nothing
 * to report back.
 */
export class LocalBuildStrategy implements TxStrategy {
  #root: Centrifuge
  constructor(root: Centrifuge) {
    this.#root = root
  }

  /**
   * Builds the action's calldata locally. Provisional contract (until the
   * protocol builders land): `action.payload` must be a
   * {@link Transaction} produced by an entity method that routes through
   * `wrapTransaction` — the same constraint as `Centrifuge.buildOnly`.
   */
  prepare(action: PoolAction, opts: { signingAddress?: HexString } = {}): Observable<PrepareOutcome> {
    return defer(async (): Promise<PrepareOutcome> => {
      const tx = action.payload
      if (!isObservable(tx)) {
        throw new Error(
          `LocalBuildStrategy: cannot prepare action "${action.action}" — expected \`payload\` to be a Transaction ` +
            `(an entity method routed through wrapTransaction) until protocol builders land.`
        )
      }
      const built = await this.#root.buildOnly(
        tx as Transaction,
        opts.signingAddress ? { fromAddress: opts.signingAddress } : undefined
      )
      return { route: 'local', built }
    })
  }
}
