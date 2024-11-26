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
  chainId?: number
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

export class ExpiredCacheError extends Error {}

class ExpiringReplaySubject<T> extends ReplaySubject<T> {
  // Re-implementation of ReplaySubject._subscribe that throws when an existing buffer is expired
  // @ts-expect-error
  protected override _subscribe(subscriber: Subscriber<T>): Subscription {
    // @ts-expect-error
    const { _infiniteTimeWindow, _buffer } = this
    const length = _buffer.length
    // @ts-expect-error
    this._throwIfClosed()
    // @ts-expect-error
    this._trimBuffer()
    const copy = _buffer.slice()
    for (let i = 0; i < copy.length && !subscriber.closed; i += _infiniteTimeWindow ? 1 : 2) {
      subscriber.next(copy[i] as T)
    }
    if (length && _buffer.length === 0) {
      this.complete()
      throw new ExpiredCacheError()
    }
    // @ts-expect-error
    const subscription = this._innerSubscribe(subscriber)
    // @ts-expect-error
    this._checkFinalizedStatuses(subscriber)
    return subscription
  }
}
