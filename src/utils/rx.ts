import type { MonoTypeOperatorFunction } from 'rxjs'
import { filter, repeat, ReplaySubject, share, Subject, timer } from 'rxjs'
import type { Abi, Log } from 'viem'
import type { Centrifuge } from '../Centrifuge.js'

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
    resetOnRefCountZero: isFinite(resetDelay) ? () => timer(resetDelay) : false,
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
      centrifuge.filteredEvents(opts.address || [], opts.abi, opts.eventName, chainId).pipe(
        filter((events) => {
          return opts.filter ? opts.filter(events) : true
        })
      ),
  })
}
