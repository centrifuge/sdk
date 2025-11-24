import type { MonoTypeOperatorFunction, Observable } from 'rxjs';
import type { Abi, Log } from 'viem';
import type { Centrifuge } from '../Centrifuge.js';
import { HexString } from '../types/index.js';
import type { Query } from '../types/query.js';
export declare function shareReplayWithDelayedReset<T>(config?: {
    bufferSize?: number;
    windowTime?: number;
    resetDelay?: number;
}): MonoTypeOperatorFunction<T>;
export declare function repeatOnEvents<T>(centrifuge: Centrifuge, opts: {
    address: HexString | HexString[];
    eventName: string | string[];
    filter?: (events: (Log<bigint, number, false, undefined, true, Abi, string> & {
        args: any;
    })[]) => boolean;
}, chainId: number): MonoTypeOperatorFunction<T>;
export declare function makeThenable<T>($query: Observable<T>, exhaust?: boolean): Query<T>;
//# sourceMappingURL=rx.d.ts.map