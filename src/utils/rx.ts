import type { MonoTypeOperatorFunction, Observable } from 'rxjs'
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
  return share<T>({
    connector: () => (bufferSize === 0 ? new Subject() : new ReplaySubject(bufferSize, windowTime)),
    resetOnError: true,
    resetOnComplete: false,
    resetOnRefCountZero: resetDelay === 0 ? true : isFinite(resetDelay) ? () => timer(resetDelay) : false,
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
