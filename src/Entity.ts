import type { Observable } from 'rxjs'
import type { Centrifuge } from './Centrifuge.js'
import type { CentrifugeQueryOptions } from './types/query.js'

export class Entity {
  #baseKeys: (string | number)[]
  _transact: Centrifuge['_transact']
  constructor(
    protected _root: Centrifuge,
    queryKeys: (string | number)[]
  ) {
    this.#baseKeys = queryKeys
    this._transact = this._root._transact.bind(this._root)
  }

  protected _query<T>(
    keys: (string | number)[] | null,
    observableCallback: () => Observable<T>,
    options?: CentrifugeQueryOptions
  ) {
    return this._root._query<T>(keys ? [...this.#baseKeys, ...keys] : null, observableCallback, options)
  }
}
