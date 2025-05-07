import type { Observable } from 'rxjs'

export type CentrifugeQueryOptions = {
  // How long (in milliseconds) the observable and it's cached value remains cached after the last subscriber has unsubscribed
  // Default `4000`
  observableCacheTime?: number
  // How long (in milliseconds) the cached value remains cached
  // Default `Infinity`
  valueCacheTime?: number
  // Whether to keep and re-emit the last emitted value for new subscribers
  // Default `true`
  cache?: boolean
}

export type Query<T> = PromiseLike<T> & Observable<T> & { toPromise: () => Promise<T> }
export type QueryFn = <T>(
  keys: (string | number)[] | null,
  cb: () => Observable<T>,
  options?: CentrifugeQueryOptions
) => Query<T>
