import { catchError, combineLatest, map, of, switchMap, timeout } from 'rxjs'
import type { Centrifuge } from './Centrifuge.js'
import { Entity } from './Entity.js'
import { Reports } from './Reports/index.js'
import { PoolNetwork } from './PoolNetwork.js'
import { PoolMetadata } from './types/poolMetadata.js'

export class Pool extends Entity {
  constructor(
    _root: Centrifuge,
    public id: string,
    public metadataHash?: string
  ) {
    super(_root, ['pool', id])
  }

  get reports() {
    return new Reports(this._root, this)
  }

  metadata() {
    return this.metadataHash ? this._root._queryIPFS<PoolMetadata>(this.metadataHash) : of(undefined)
  }

  trancheIds() {
    return this._root._queryIndexer(
      `query($poolId: String!) {
        pool(id: $poolId) {
          tranches {
            nodes {
              trancheId
            }
          }
        }
      }`,
      {
        poolId: this.id,
      },
      (data: { pool: { tranches: { nodes: { trancheId: string }[] } } }) => {
        return data.pool.tranches.nodes.map((node) => node.trancheId)
      }
    )
  }

  /**
   * Get all networks where a pool can potentially be deployed.
   */
  networks() {
    return this._query(null, () => {
      return of(
        this._root.chains.map((chainId) => {
          return new PoolNetwork(this._root, this, chainId)
        })
      )
    })
  }

  /**
   * Get the networks where a pool is active. It doesn't mean that any vaults are deployed there necessarily.
   */
  activeNetworks() {
    return this._query(null, () => {
      return this.networks().pipe(
        switchMap((networks) => {
          return combineLatest(
            networks.map((network) =>
              network.isActive().pipe(
                timeout(8000),
                catchError(() => {
                  return of(false)
                })
              )
            )
          ).pipe(map((isActive) => networks.filter((_, index) => isActive[index])))
        })
      )
    })
  }
}
