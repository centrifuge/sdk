import { combineLatest, map, switchMap } from 'rxjs'
import type { Centrifuge } from '../Centrifuge.js'
import type { HexString } from '../types/index.js'
import { AssetId, PoolId, ShareClassId } from '../utils/types.js'
import { Entity } from './Entity.js'

export class Investor extends Entity {
  address: HexString

  /** @internal */
  constructor(_root: Centrifuge, address: HexString) {
    const addr = address.toLowerCase() as HexString
    super(_root, ['investor', addr])
    this.address = addr
  }

  portfolio(chainId?: number) {
    return this._query(null, () =>
      this._root
        ._queryIndexer<{
          vaults: { items: { assetAddress: HexString; blockchain: { id: string } }[] }
          tokenInstances: { items: { address: HexString; blockchain: { id: number } }[] }
        }>(
          `{
            vaults {
              items {
                assetAddress
                blockchain {
                  id
                }
              }
            }
            tokenInstances {
              items {
                address
                blockchain {
                  id
                }
              }
            }
          }`
        )
        .pipe(
          switchMap(({ vaults, tokenInstances }) => {
            const seenTuples = new Set()
            function check(chainId: string, asset: string) {
              const key = `${chainId}|${asset}`
              if (seenTuples.has(key)) {
                return true
              }
              seenTuples.add(key)
              return false
            }
            const all = [
              ...vaults.items
                .map((item) => ({ ...item, address: item.assetAddress }))
                // Exclude duplicate chainId/asset combinations
                .filter((item) => !check(item.blockchain.id, item.assetAddress)),
              ...tokenInstances.items,
            ].filter((item) => !chainId || Number(item.blockchain.id) === chainId)
            return combineLatest(
              all.map((item) => this._root.balance(item.address, this.address, Number(item.blockchain.id)))
            )
          }),
          map((balances) => balances.filter((b) => b.balance.gt(0n)))
        )
    )
  }

  investment(poolId: PoolId, scId: ShareClassId, asset: HexString | AssetId, chainId: number) {
    return this._query(null, () =>
      this._root.pool(poolId).pipe(
        switchMap((pool) => pool.vault(chainId, scId, asset)),
        switchMap((vault) => vault.investment(this.address))
      )
    )
  }

  isMember(scId: ShareClassId, chainId: number) {
    return this._query(null, () =>
      this._root.pool(scId.poolId).pipe(
        switchMap((pool) => pool.shareClass(scId)),
        switchMap((shareClass) => shareClass.member(this.address, chainId)),
        map(({ isMember }) => isMember)
      )
    )
  }
}
