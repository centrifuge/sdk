import type { Observable } from 'rxjs'
import type { Centrifuge, MigrationGate } from '../Centrifuge.js'
import type { CentrifugeQueryOptions } from '../types/query.js'
import type { CentrifugeId } from '../utils/types.js'

export class Entity {
  #baseKeys: (string | number)[]
  /** @internal */
  _transact: Centrifuge['_transact']
  constructor(
    /** @internal */
    public _root: Centrifuge,
    queryKeys: (string | number)[]
  ) {
    this.#baseKeys = queryKeys
    this._transact = this._root._transact.bind(this._root)
  }

  /** @internal A `_transact` the migration gate judges before a signer is resolved. */
  protected _gatedTransact(
    gate: MigrationGate,
    centrifugeId: CentrifugeId,
    run: Parameters<Centrifuge['_transact']>[0]
  ) {
    return this._transact(run, centrifugeId, { gate })
  }

  /** @internal */
  protected _query<T>(
    keys: (string | number | boolean | undefined)[] | null,
    observableCallback: () => Observable<T>,
    options?: CentrifugeQueryOptions
  ) {
    return this._root._query<T>(keys ? [...this.#baseKeys, ...keys] : null, observableCallback, options)
  }
}
