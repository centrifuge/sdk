import type {
  BasinDebtChangeRow,
  BasinDebtRow,
  BasinFeeRow,
  BasinRedeemRequestRow,
  BasinSwapRow,
} from '@centrifuge/queries/core'
import { Centrifuge } from '../Centrifuge.js'
import { HexString } from '../types/index.js'
import { Entity } from './Entity.js'
import { Pool } from './Pool.js'

/**
 * A Grove/Basin deployment: the credit facility a pool's share class draws
 * against, projected into `chain_v1` from Basin protocol events.
 *
 * Reached through {@link Pool.basin} because that is how a caller navigates to
 * one — the management app resolves a basin from the pool in its route. The
 * READS, though, are keyed `(chainId, basinAddress, tokenId)` and carry no
 * pool or share-class id, which is why this is its own entity rather than
 * methods on {@link Pool} or `PoolNetwork`: `chainId` here is an EVM chain id,
 * not a `centrifugeId`, so a basin does not sit on a `PoolNetwork`.
 *
 * `basinAddress` and `tokenId` are the caller's to supply. They are static
 * deployment constants, not values the projection can be asked for — see
 * `src/config/basin.ts` in `centrifuge/api-v4`, which
 * holds the canonical table.
 *
 * Every read here is served by public-api (`@centrifuge/queries`'s graphql
 * adapter), including the hub redeem order joined onto each redeem request.
 */
export class Basin extends Entity {
  constructor(
    _root: Centrifuge,
    public pool: Pool,
    /** EVM chain id the basin is deployed on — NOT a `centrifugeId`. */
    public chainId: number,
    /** The Basin contract address. */
    public basinAddress: HexString,
    /** ERC-6909 hex id of the credit token — NOT a bytes16 share-class id. */
    public tokenId: string
  ) {
    super(_root, ['basin', String(chainId), basinAddress.toLowerCase(), tokenId.toLowerCase()])
  }

  private get _key() {
    return {
      poolId: this.pool.id.toString(),
      chainId: this.chainId,
      basinAddress: this.basinAddress,
      tokenId: this.tokenId,
    }
  }

  /**
   * The basin's current debt position, or `null` when nothing has touched it
   * yet — a real state, not an error.
   *
   * `ssrSeeded` is worth reading before `ratePerSecondRay`: while it is false
   * the rate is a placeholder and interest is not accruing, so rendering the
   * rate as fact would show a number the projection does not stand behind.
   */
  debt() {
    return this._query(['debt'], () => this._root._queryData<BasinDebtRow | null>('basinDebt', this._key))
  }

  /**
   * The basin's debt-change ledger, newest first.
   *
   * Returned UNFILTERED by `type`, including `RATE_UPDATE` (pure interest
   * accrual) and `CREDIT_TOKEN_TRANSFER`. `debtAfter` is a running balance, so
   * the rows only reconcile as a whole — a read that dropped the accrual rows
   * would return a series that appears to jump. Narrowing for display is the
   * caller's to do.
   */
  debtChanges(limit?: number) {
    return this._query(['debtChanges', limit], () =>
      this._root._queryData<BasinDebtChangeRow[]>('basinDebtChanges', {
        ...this._key,
        ...(limit === undefined ? {} : { limit }),
      })
    )
  }

  /** The basin's fee configuration and collected totals, or `null`. */
  fees() {
    return this._query(['fees'], () => this._root._queryData<BasinFeeRow | null>('basinFees', this._key))
  }

  /**
   * The basin's OTC swaps, newest first.
   *
   * `OTHER`-direction swaps are included for the same reason the ledger is
   * unfiltered: the projection recorded them, and which directions a screen
   * shows is a display choice.
   */
  swaps(limit?: number) {
    return this._query(['swaps', limit], () =>
      this._root._queryData<BasinSwapRow[]>('basinSwaps', {
        ...this._key,
        ...(limit === undefined ? {} : { limit }),
      })
    )
  }

  /**
   * The basin's redeem requests, newest first, optionally narrowed to one
   * redeemer or one request.
   *
   * The linked hub redeem order is joined. It is `null` when the order does
   * not exist yet, and `null` when `redeemOrderLinkAmbiguous` is true — the
   * projection could not tell which order is the linked one, and a
   * plausible-looking wrong order is worse than none for the close-modal gate
   * this feeds. Read the flag to tell "we cannot tell" from "no order yet".
   */
  redeemRequests(options: { redeemer?: HexString; requestId?: string; limit?: number } = {}) {
    const { redeemer, requestId, limit } = options
    return this._query(['redeemRequests', redeemer, requestId, limit], () =>
      this._root._queryData<BasinRedeemRequestRow[]>('basinRedeemRequests', {
        ...this._key,
        ...(redeemer === undefined ? {} : { redeemer }),
        ...(requestId === undefined ? {} : { requestId }),
        ...(limit === undefined ? {} : { limit }),
      })
    )
  }
}
