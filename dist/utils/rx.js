import { filter, firstValueFrom, lastValueFrom, repeat, ReplaySubject, share, Subject, timer } from 'rxjs';
export function shareReplayWithDelayedReset(config) {
    const { bufferSize = Infinity, windowTime = Infinity, resetDelay = 1000 } = config ?? {};
    const reset = resetDelay === 0 ? true : isFinite(resetDelay) ? () => timer(resetDelay) : false;
    return share({
        connector: () => (bufferSize === 0 ? new Subject() : new ExpiringReplaySubject(bufferSize, windowTime)),
        resetOnError: true,
        resetOnComplete: false,
        resetOnRefCountZero: reset,
    });
}
export function repeatOnEvents(centrifuge, opts, chainId) {
    return repeat({
        delay: () => centrifuge._filteredEvents(opts.address, opts.eventName, chainId).pipe(filter((events) => {
            return opts.filter ? opts.filter(events) : true;
        })),
    });
}
export function makeThenable($query, exhaust = false) {
    const thenableQuery = Object.assign($query, {
        then(onfulfilled, onrejected) {
            return (exhaust ? lastValueFrom : firstValueFrom)($query).then(onfulfilled, onrejected);
        },
        toPromise() {
            return (exhaust ? lastValueFrom : firstValueFrom)($query);
        },
    });
    return thenableQuery;
}
// A ReplaySubject that completes when an existing buffer is expired
class ExpiringReplaySubject extends ReplaySubject {
    // @ts-expect-error
    _subscribe(subscriber) {
        // Get the initial buffer length
        // @ts-expect-error
        const { _buffer } = this;
        const length = _buffer.length;
        // The ReplaySubject will remove expired items from the buffer
        // @ts-expect-error
        const subscription = super._subscribe(subscriber);
        // If the buffer is now empty, complete the subject.
        // Necessary for `createShared()` to be called again in Centrifuge._query()
        if (length && _buffer.length === 0) {
            this.complete();
        }
        return subscription;
    }
}
//# sourceMappingURL=rx.js.map