import type { Observable } from 'rxjs'

export type CentrifugeQueryOptions = {
  cacheTime?: number
}

export type Query<T> = PromiseLike<T> & Observable<T>
export type QueryFn = <T>(
  keys: (string | number)[] | null,
  cb: () => Observable<T>,
  options?: CentrifugeQueryOptions
) => Query<T>
