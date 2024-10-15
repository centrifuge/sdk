import { catchError, combineLatest, map, of, switchMap, timeout } from 'rxjs'
import type { Centrifuge } from './Centrifuge.js'
import { PoolDomain } from './PoolDomain.js'
import type { QueryFn } from './types/query.js'

export class Pool {
  private _query: QueryFn
  constructor(private _root: Centrifuge, public id: string) {
    this._query = this._root._makeQuery(['pool', this.id])
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
