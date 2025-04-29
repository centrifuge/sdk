import type { MonoTypeOperatorFunction, Observable, Subscriber, Subscription } from 'rxjs'
import { filter, firstValueFrom, lastValueFrom, repeat, ReplaySubject, share, Subject, timer } from 'rxjs'
import type { Abi, Log } from 'viem'
import type { Centrifuge } from '../Centrifuge.js'
import type { Query } from '../types/query.js'

export function shareReplayWithDelayedReset<T>(config?: {
  bufferSize?: number
  windowTime?: number
  resetDelay?: number
}): MonoTypeOperatorFunction<T> {
  const { bufferSize = Infinity, windowTime = Infinity, resetDelay = 1000 } = config ?? {}
  const reset = resetDelay === 0 ? true : isFinite(resetDelay) ? () => timer(resetDelay) : false
  return share<T>({
    connector: () => (bufferSize === 0 ? new Subject() : new ExpiringReplaySubject(bufferSize, windowTime)),
    resetOnError: true,
    resetOnComplete: false,
    resetOnRefCountZero: reset,
  })
}

export function repeatOnEvents<T>(
  centrifuge: Centrifuge,
  opts: {
    address?: string | string[]
    abi: Abi | Abi[]
    eventName: string | string[]
    filter?: (events: (Log<bigint, number, false, undefined, true, Abi, string> & { args: any })[]) => boolean
  },
  chainId: number
): MonoTypeOperatorFunction<T> {
  return repeat({
    delay: () =>
      centrifuge._filteredEvents(opts.address || [], opts.abi, opts.eventName, chainId).pipe(
        filter((events) => {
          return opts.filter ? opts.filter(events) : true
        })
      ),
  })
}

export function makeThenable<T>($query: Observable<T>, exhaust = false) {
  const thenableQuery: Query<T> = Object.assign($query, {
    then(onfulfilled: (value: T) => any, onrejected: (reason: any) => any) {
      return (exhaust ? lastValueFrom : firstValueFrom)($query).then(onfulfilled, onrejected)
    },
    toPromise() {
      return (exhaust ? lastValueFrom : firstValueFrom)($query)
    },
  })
  return thenableQuery
}

// A ReplaySubject that completes when an existing buffer is expired
class ExpiringReplaySubject<T> extends ReplaySubject<T> {
  // @ts-expect-error
  protected override _subscribe(subscriber: Subscriber<T>): Subscription {
    // Get the initial buffer length
    // @ts-expect-error
    const { _buffer } = this
    const length = _buffer.length

    // The ReplaySubject will remove expired items from the buffer
    // @ts-expect-error
    const subscription = super._subscribe(subscriber)

    // If the buffer is now empty, complete the subject.
    // Necessary for `createShared()` to be called again in Centrifuge._query()
    if (length && _buffer.length === 0) {
      this.complete()
    }
    return subscription
  }
}
