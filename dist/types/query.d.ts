import type { Observable } from 'rxjs';
export type CentrifugeQueryOptions = {
    observableCacheTime?: number;
    valueCacheTime?: number;
    cache?: boolean;
};
export type Query<T> = PromiseLike<T> & Observable<T> & {
    toPromise: () => Promise<T>;
};
export type QueryFn = <T>(keys: (string | number)[] | null, cb: () => Observable<T>, options?: CentrifugeQueryOptions) => Query<T>;
//# sourceMappingURL=query.d.ts.map