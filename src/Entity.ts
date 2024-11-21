import type { Observable } from 'rxjs'
import type { Centrifuge } from './Centrifuge.js'
import type { CentrifugeQueryOptions } from './types/query.js'

export class Entity {
  #baseKeys: (string | number)[]
  _transact: Centrifuge['_transact']
  _transactSequence: Centrifuge['_transactSequence']
  constructor(
    protected _root: Centrifuge,
    queryKeys: (string | number)[]
  ) {
    this.#baseKeys = queryKeys
    this._transact = this._root._transact.bind(this._root)
    this._transactSequence = this._root._transactSequence.bind(this._root)
  }

  protected _query<T>(
    keys: (string | number | undefined)[] | null,
    observableCallback: () => Observable<T>,
    options?: CentrifugeQueryOptions
  ) {
    return this._root._query<T>(keys ? [...this.#baseKeys, ...keys.filter(Boolean)] : null, observableCallback, options)
  }
}
