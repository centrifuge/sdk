import { catchError, combineLatest, map, of, switchMap, timeout } from 'rxjs'
import type { Centrifuge } from './Centrifuge.js'
import { Entity } from './Entity.js'
import { PoolDomain } from './PoolDomain.js'

export class Pool extends Entity {
  constructor(_root: Centrifuge, public id: string) {
    super(_root, ['pool', id])
  }

  domains() {
    return this._query(null, () => {
      return of(
        this._root.chains.map((chainId) => {
          return new PoolDomain(this._root, this, chainId)
        })
      )
    })
  }

  // return this._query(['tranches'], () => {
  //   return this._root
  //     ._getSubqueryObservable<{ pool: { tranches: { nodes: { trancheId: string }[] } } }>(
  //       `query($poolId: String!) {
  //         pool(id: $poolId) {
  //           tranches {
  //             nodes {
  //               trancheId
  //             }
  //           }
  //         }
  //       }`,
  //       {
  //         poolId: this.id,
  //       }
  //     )
  //     .pipe(
  //       map((data) => {
  //         return data.pool.tranches.nodes.map((node) => node.trancheId)
  //       })
  //     )
  // })
  tranches() {
    return this._root._querySubquery(
      ['tranches', this.id],
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

  activeDomains() {
    return this._query(null, () => {
      return this.domains().pipe(
        switchMap((domains) => {
          return combineLatest(
            domains.map((domain) =>
              domain.isActive().pipe(
                timeout(8000),
                catchError(() => {
                  return of(false)
                })
              )
            )
          ).pipe(
            map((isActive) => {
              return domains.filter((_, index) => isActive[index])
            })
          )
        })
      )
    })
  }
}
