import type { Centrifuge } from './Centrifuge.js'
import type { QueryFn } from './types/query.js'

export class Entity {
  protected _query: QueryFn
  constructor(protected _root: Centrifuge, queryKeys: (string | number)[]) {
    this._query = this._root._makeQuery(queryKeys)
  }
}
