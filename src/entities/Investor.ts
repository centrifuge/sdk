import { of, switchMap } from 'rxjs'
import { getAddress } from 'viem'
import type { Centrifuge } from '../Centrifuge.js'
import type { HexString } from '../types/index.js'
import { PoolId, ShareClassId } from '../utils/types.js'
import { Entity } from './Entity.js'

export class Investor extends Entity {
  address: HexString

  /** @internal */
  constructor(_root: Centrifuge, address: HexString) {
    const addr = address.toLowerCase() as HexString
    super(_root, ['investor', addr])
    this.address = getAddress(addr)
  }

  portfolio() {
    return this._query(['portfolio'], () => of([]))
  }

  investment(poolId: PoolId, scId: ShareClassId, asset: string, chainId: number) {
    return this._query(null, () =>
      this._root.pool(poolId).pipe(
        switchMap((pool) => pool.vault(chainId, scId, asset)),
        switchMap((vault) => vault.investment(this.address))
      )
    )
  }
}
