import { combineLatest, map, of, switchMap } from 'rxjs'
import { getAddress } from 'viem'
import type { Centrifuge } from '../Centrifuge.js'
import { currencies } from '../config/protocol.js'
import type { HexString } from '../types/index.js'
import { PoolId, ShareClassId } from '../utils/types.js'
import { Entity } from './Entity.js'

export class Investor extends Entity {
  address: HexString

  /** @internal */
  constructor(_root: Centrifuge, address: HexString) {
    const addr = address.toLowerCase()
    super(_root, ['investor', addr])
    this.address = getAddress(addr)
  }

  portfolio() {
    // TODO: fetch from indexer
    return this._query(null, () =>
      combineLatest(this._root.chains.map((chainId) => this.currencyBalances(chainId))).pipe(
        map((balances) => balances.flat())
      )
    )
  }

  investment(poolId: PoolId, scId: ShareClassId, asset: string, chainId: number) {
    return this._query(null, () =>
      this._root.pool(poolId).pipe(
        switchMap((pool) => pool.vault(chainId, scId, asset)),
        switchMap((vault) => vault.investment(this.address))
      )
    )
  }

  currencyBalances(chainId: number) {
    return this._query(null, () =>
      currencies[chainId]
        ? combineLatest(currencies[chainId].map((currency) => this._root.balance(currency, this.address, chainId)))
        : of([])
    )
  }
}
