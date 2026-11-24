import { expect } from 'chai'
import {
  BackendInvalidationStream,
  INVALIDATION_RECONNECT_BASE_MS,
  INVALIDATION_RECONNECT_MAX_MS,
} from './invalidationStream.js'
import { fakeEventSourceFactory, type FakeStream } from './tests/fakeStream.js'

const BASE_URL = 'https://backend.test/api'
const POOL_ID = '281474976710657'
const TOKEN_A = '0x0100000000000000000000000000000a'
const TOKEN_B = '0x0100000000000000000000000000000b'

/** A frame in the shape `SseConnectionRegistry` actually publishes. */
function invalidation(overrides: Record<string, unknown> = {}) {
  return {
    v: 1,
    table: 'chain_v1.epoch_invest_order',
    keys: { tokenId: TOKEN_A, assetId: '42', index: '3' },
    blockNumber: 4242,
    poolId: POOL_ID,
    ...overrides,
  }
}

/**
 * A harness with a CONTROLLED clock for the reconnect.
 *
 * `schedule` is captured rather than run, so the suite asserts the backoff
 * SEQUENCE exactly (1s, 2s, 4s, …) and fires each reconnect on demand. Waiting
 * for real time here would mean either a one-minute test or an assertion
 * weaker than the property.
 */
function harness(options: { reconnectMaxMs?: number } = {}) {
  const { eventSource, streams } = fakeEventSourceFactory()
  const delays: number[] = []
  let pending: (() => void) | undefined

  const stream = new BackendInvalidationStream({
    baseUrl: BASE_URL,
    eventSource,
    poolIds: [POOL_ID],
    reconnectBaseMs: INVALIDATION_RECONNECT_BASE_MS,
    ...(options.reconnectMaxMs === undefined ? {} : { reconnectMaxMs: options.reconnectMaxMs }),
    schedule: (callback, delayMs) => {
      delays.push(delayMs)
      pending = callback
      return () => {
        pending = undefined
      }
    },
  })

  return {
    stream,
    streams,
    delays,
    /** Run the pending reconnect, as the scheduler would have. */
    runReconnect() {
      const callback = pending
      if (!callback) {
        throw new Error('no reconnect was scheduled')
      }
      pending = undefined
      callback()
    },
    get reconnectPending() {
      return pending !== undefined
    },
    last(): FakeStream {
      const stream = streams.at(-1)
      if (!stream) {
        throw new Error('no stream was opened')
      }
      return stream
    },
  }
}

describe('BackendInvalidationStream', () => {
  it('opens no stream until something subscribes', () => {
    const h = harness()
    expect(h.streams).to.have.length(0)
    expect(h.stream.connected).to.equal(false)

    h.stream.invalidations$('epochInvestOrders', { tokenId: TOKEN_A }).subscribe()

    expect(h.streams).to.have.length(1)
  })

  it('opens ONE stream for ten subscribers across three keys', () => {
    // The acceptance criterion: one EventSource per instance regardless of
    // subscriber count. Not an optimisation — the endpoint resolves pool
    // membership per connection and re-resolves it periodically, so a stream
    // per subscription multiplies that by the number of widgets on a screen.
    const h = harness()
    const tokens = [TOKEN_A, TOKEN_B, '0x0100000000000000000000000000000c']
    const subs = []
    for (let i = 0; i < 10; i++) {
      subs.push(h.stream.invalidations$('epochInvestOrders', { tokenId: tokens[i % 3]!, limit: 1000 }).subscribe())
    }

    expect(h.streams).to.have.length(1)
    expect(h.stream.diagnostics.opened).to.equal(1)
    expect(h.stream.subscriberCount).to.equal(10)

    for (const sub of subs) {
      sub.unsubscribe()
    }
    expect(h.stream.subscriberCount).to.equal(0)
    // Deliberately still open: subscriptions churn with every mount and cache
    // expiry, and a stream that flapped with them would spend its life
    // reconnecting, each reconnect being a hole in an at-most-once stream.
    expect(h.streams).to.have.length(1)
    expect(h.last().closeCount).to.equal(0)
  })

  it('builds the pool-scoped stream URL with one param per pool', () => {
    const { eventSource, streams } = fakeEventSourceFactory()
    const stream = new BackendInvalidationStream({
      baseUrl: `${BASE_URL}/`,
      eventSource,
      poolIds: [POOL_ID, '999'],
    })
    stream.invalidations$('epochInvestOrders', { tokenId: TOKEN_A }).subscribe()

    expect(stream.url).to.equal(`${BASE_URL}/events/stream?poolId=${POOL_ID}&poolId=999`)
    expect(streams[0]!.url).to.equal(stream.url)
  })

  it('refuses to exist without a pool id, rather than connecting to nothing', () => {
    // A connection with no pool subscription receives no invalidation at all —
    // not even a broadcast one, since the registry fans those out over the
    // pool maps. Such a stream would connect, report itself CONNECTED, move
    // every read onto the long poll interval, and deliver nothing.
    const { eventSource } = fakeEventSourceFactory()
    expect(() => new BackendInvalidationStream({ baseUrl: BASE_URL, eventSource, poolIds: [] })).to.throw(
      /at least one pool id/
    )
  })

  it('emits for the subscription the frame names, and only that one', () => {
    const h = harness()
    const hits: string[] = []
    h.stream.invalidations$('epochInvestOrders', { tokenId: TOKEN_A, limit: 1000 }).subscribe(() => hits.push('A'))
    h.stream.invalidations$('epochInvestOrders', { tokenId: TOKEN_B, limit: 1000 }).subscribe(() => hits.push('B'))
    h.stream.invalidations$('epochRedeemOrders', { tokenId: TOKEN_A, limit: 1000 }).subscribe(() => hits.push('R'))
    h.last().open()

    h.last().send(invalidation())

    expect(hits).to.deep.equal(['A'])
    expect(h.stream.diagnostics.received).to.equal(1)
    expect(h.stream.diagnostics.notified).to.equal(1)
    expect(h.stream.diagnostics.ignored).to.equal(0)
  })

  it('ignores an unmapped table instead of throwing at the subscriber', () => {
    // A new projection table appearing on the stream is a backend-only change
    // (the emitter rolls out one trigger per table). It must cost a client
    // nothing.
    const h = harness()
    let emissions = 0
    let failed: unknown
    h.stream.invalidations$('epochInvestOrders', { tokenId: TOKEN_A }).subscribe({
      next: () => emissions++,
      error: (e) => (failed = e),
    })
    h.last().open()

    h.last().send(invalidation({ table: 'chain_v1.table_from_the_future' }))
    h.last().send(invalidation({ table: 'chain_v1.holding', keys: { tokenId: TOKEN_A, assetId: '42' } }))

    expect(emissions).to.equal(0)
    expect(failed).to.equal(undefined)
    expect(h.stream.diagnostics.ignored).to.equal(2)
    expect(h.stream.diagnostics.lastIgnoredReason).to.contain('no catalogue entry is mapped')
    // Still delivering: a dropped frame is not a broken stream.
    h.last().send(invalidation())
    expect(emissions).to.equal(1)
  })

  it('validates the payload at the seam: v:1, string keys, real JSON', () => {
    const h = harness()
    let emissions = 0
    h.stream.invalidations$('epochInvestOrders', { tokenId: TOKEN_A }).subscribe(() => emissions++)
    h.last().open()

    h.last().send(invalidation({ v: 2 }))
    expect(h.stream.diagnostics.lastIgnoredReason).to.contain('unsupported payload version')

    h.last().send(invalidation({ keys: { tokenId: TOKEN_A, assetId: 18446744073709551616 } }))
    expect(h.stream.diagnostics.lastIgnoredReason).to.contain('is not a string')

    h.last().sendRaw('{ not json')
    expect(h.stream.diagnostics.lastIgnoredReason).to.contain('not JSON')

    expect(emissions).to.equal(0)
    expect(h.stream.diagnostics.ignored).to.equal(3)

    h.last().send(invalidation())
    expect(emissions).to.equal(1)
  })

  it('tracks connectivity for the poll-interval fallback', async () => {
    const h = harness()
    const seen: boolean[] = []
    h.stream.connected$.subscribe((connected) => seen.push(connected))
    // Reading connectivity must NOT open a stream: every read of an entry with
    // no push coverage would otherwise open one.
    expect(h.streams).to.have.length(0)

    h.stream.invalidations$('epochInvestOrders', { tokenId: TOKEN_A }).subscribe()
    h.last().open()
    expect(h.stream.connected).to.equal(true)

    h.last().failTerminally()
    expect(h.stream.connected).to.equal(false)
    expect(seen).to.deep.equal([false, true, false])
  })

  it('reconnects with a doubling backoff, capped, and resets it on connect', () => {
    const h = harness({ reconnectMaxMs: 4_000 })
    h.stream.invalidations$('epochInvestOrders', { tokenId: TOKEN_A }).subscribe()
    expect(h.streams).to.have.length(1)

    for (let attempt = 0; attempt < 4; attempt++) {
      h.last().failTerminally()
      h.runReconnect()
    }
    // 1s, 2s, 4s, then capped at 4s.
    expect(h.delays).to.deep.equal([1_000, 2_000, 4_000, 4_000])
    expect(h.streams).to.have.length(5)

    // A successful connect resets the curve, so the next blip waits 1s again
    // rather than starting from the ceiling.
    h.last().open()
    h.last().failTerminally()
    expect(h.delays.at(-1)).to.equal(1_000)
  })

  it('uses the same 1s->60s curve as the backend listener by default', () => {
    expect(INVALIDATION_RECONNECT_BASE_MS).to.equal(1_000)
    expect(INVALIDATION_RECONNECT_MAX_MS).to.equal(60_000)
  })

  it('opens ONE stream when an error is followed by the close it caused', () => {
    // Two signals for one drop: pg emits both `error` and `end`, and handling
    // both means two clients, two LISTENs, every notification delivered twice
    // and a connection count that doubles per blip. A stream has the same shape
    // available — the error handler's own `close()` dispatching a second
    // signal — so exactly one reconnect must come out of it.
    const h = harness()
    h.stream.invalidations$('epochInvestOrders', { tokenId: TOKEN_A }).subscribe()
    const first = h.last()
    first.errorOnClose = true

    first.failTerminally()

    expect(h.delays).to.deep.equal([1_000], 'one reconnect scheduled, not two')
    h.runReconnect()
    expect(h.streams).to.have.length(2)
    expect(h.reconnectPending).to.equal(false)
    // Detached before closing, which is why the close's own error reached
    // nobody. The latch in `onFailure` is the second, independent guard.
    expect(first.listenerCount('error')).to.equal(0)
    expect(first.closeCount).to.equal(1)
  })

  it('opens ONE stream when the same failure reports twice', () => {
    const h = harness()
    h.stream.invalidations$('epochInvestOrders', { tokenId: TOKEN_A }).subscribe()
    const first = h.last()

    first.failTerminally()
    first.failTerminally()
    first.failTerminally()

    expect(h.delays).to.deep.equal([1_000])
    h.runReconnect()
    expect(h.streams).to.have.length(2)
  })

  it('does not reopen while the stream is retrying on its own', () => {
    // `readyState === CONNECTING` after an error means the platform owns the
    // retry. Opening our own stream there is precisely the double connection.
    const h = harness()
    h.stream.invalidations$('epochInvestOrders', { tokenId: TOKEN_A }).subscribe()
    const first = h.last()
    first.open()

    first.failTransiently()

    expect(h.stream.connected).to.equal(false, 'stops claiming to be connected, so polling speeds back up')
    expect(h.delays).to.deep.equal([], 'no reconnect of ours is scheduled')
    expect(h.streams).to.have.length(1)
    expect(first.closeCount).to.equal(0)

    // And when the platform's own retry succeeds, it is the SAME stream.
    first.open()
    expect(h.stream.connected).to.equal(true)
    expect(h.streams).to.have.length(1)
  })

  it('does not open a second stream while a reconnect is pending', () => {
    const h = harness()
    h.stream.invalidations$('epochInvestOrders', { tokenId: TOKEN_A }).subscribe()
    h.last().failTerminally()
    expect(h.reconnectPending).to.equal(true)

    // A new subscription arriving inside the backoff window must join the
    // pending reconnect, not race it.
    h.stream.invalidations$('epochRedeemOrders', { tokenId: TOKEN_B }).subscribe()
    expect(h.streams).to.have.length(1)

    h.runReconnect()
    expect(h.streams).to.have.length(2)
  })

  it('keeps delivering to every subscription across a reconnect', () => {
    const h = harness()
    let emissions = 0
    h.stream.invalidations$('epochInvestOrders', { tokenId: TOKEN_A }).subscribe(() => emissions++)
    h.last().open()
    h.last().send(invalidation())
    expect(emissions).to.equal(1)

    h.last().failTerminally()
    h.runReconnect()
    h.last().open()
    h.last().send(invalidation())

    expect(emissions).to.equal(2, 'the hub outlives the connection')
  })

  it('stops reconnecting after close, and closes the live stream', () => {
    const h = harness()
    let emissions = 0
    h.stream.invalidations$('epochInvestOrders', { tokenId: TOKEN_A }).subscribe(() => emissions++)
    const first = h.last()
    first.open()

    h.stream.close()

    expect(first.closeCount).to.equal(1)
    expect(h.stream.connected).to.equal(false)
    expect(h.reconnectPending).to.equal(false)
    // Idempotent, and a later failure signal cannot revive it.
    h.stream.close()
    first.failTerminally()
    expect(h.delays).to.deep.equal([])
    expect(h.streams).to.have.length(1)

    // A subscription after close does not open one either.
    h.stream.invalidations$('epochInvestOrders', { tokenId: TOKEN_A }).subscribe()
    expect(h.streams).to.have.length(1)
    expect(emissions).to.equal(0)
  })

  it('survives a transport whose factory throws, and retries it', () => {
    const delays: number[] = []
    let pending: (() => void) | undefined
    let attempts = 0
    const stream = new BackendInvalidationStream({
      baseUrl: BASE_URL,
      eventSource: () => {
        attempts++
        throw new Error('no session')
      },
      poolIds: [POOL_ID],
      schedule: (callback, delayMs) => {
        delays.push(delayMs)
        pending = callback
        return () => (pending = undefined)
      },
    })

    // The reads are unaffected: they go over `fetch` and keep polling.
    expect(() => stream.invalidations$('epochInvestOrders', { tokenId: TOKEN_A }).subscribe()).to.not.throw()
    expect(attempts).to.equal(1)
    expect(delays).to.deep.equal([1_000])

    pending?.()
    expect(attempts).to.equal(2)
    expect(delays).to.deep.equal([1_000, 2_000])
    expect(stream.connected).to.equal(false)
  })
})
