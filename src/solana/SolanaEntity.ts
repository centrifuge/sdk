import type { Observable } from 'rxjs'
import type { SolanaManager } from './SolanaManager.js'
import type { CentrifugeQueryOptions } from '../types/query.js'

/**
 * Base class for Solana entities
 * Similar to Entity.ts but for Solana-specific operations
 */
export class SolanaEntity {
  #baseKeys: (string | number)[]

  constructor(
    /** @internal */
    public _solanaManager: SolanaManager,
    queryKeys: (string | number)[]
  ) {
    this.#baseKeys = queryKeys
  }

  /** @internal */
  protected _query<T>(
    keys: (string | number | boolean | undefined)[] | null,
    observableCallback: () => Observable<T>,
    options?: CentrifugeQueryOptions
  ) {
    return this._solanaManager._query<T>(keys ? [...this.#baseKeys, ...keys] : null, observableCallback, options)
  }
}
