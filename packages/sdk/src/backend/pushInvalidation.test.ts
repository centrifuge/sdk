// Lives under `backend/` rather than beside the DataSource it exercises: the
// subject is push invalidation, which only exists in backend mode, and the test
// needs `BackendInvalidationStream` plus the fake EventSource. The
// `sdk-root-no-backend-subpath` rule allows the subpath to import the root but
// not the reverse, and tsup emits a JS copy of every source file into `dist`,
// so a root-side test file reaching into `backend/` is a real edge in the
// published package rather than a test-only one.
import { expect } from 'chai'
import { of, type Observable } from 'rxjs'
import sinon from 'sinon'
import { Centrifuge, PUSH_POLL_INTERVAL_FACTOR } from '../Centrifuge.js'
import { BackendInvalidationStream } from './invalidationStream.js'
import { fakeEventSourceFactory, type FakeStream } from './tests/fakeStream.js'
import type { DataSource, QueryName } from '../data/DataSource.js'
import type { PrepareOutcome, TxStrategy } from '../tx/TxStrategy.js'

const POOL_ID = '281474976710657'
const TOKEN_A = '0x0100000000000000000000000000000a'
const TOKEN_B = '0x0100000000000000000000000000000b'
const TOKEN_C = '0x0100000000000000000000000000000c'
const POLL = 1_000

const stubTxStrategy: TxStrategy = {
  prepare: () => of({ route: 'local', built: {} } as unknown as PrepareOutcome),
}

function invalidation(tokenId: string) {
  return {
    v: 1,
    table: 'chain_v1.epoch_invest_order',
    keys: { tokenId, assetId: '42', index: '3' },
    blockNumber: 4242,
    poolId: POOL_ID,
  }
}

/**
 * `_queryData`'s push behaviour, end to end over everything except the socket:
 * the real `Centrifuge` query cache, the real `BackendInvalidationStream`, the
 * real table-to-entry mapping, and a stream object shaped like the one an app's
 * `transport.eventSource` hands back.
 *
 * The clock is sinon's, so every interval claim below is an exact one. "Polls
 * more slowly while connected" measured by waiting is a claim about a machine's
 * load; measured on a controlled clock it is a claim about the code.
 */
describe('_queryData with a push seam', () => {
  let clock: sinon.SinonFakeTimers

  beforeEach(() => {
    clock = sinon.useFakeTimers()
  })

  afterEach(() => {
    clock.restore()
    sinon.restore()
  })

  interface Harness {
    centrifuge: Centrifuge
    stream: BackendInvalidationStream
    streams: FakeStream[]
    /** Timestamps of every `query` call, in fake-clock milliseconds. */
    fetchesAt: number[]
    fetchedVars: (Record<string, any> | undefined)[]
    connectedReads: number
    lastStream(): FakeStream
  }

  /**
   * @param push - `false` builds a data source with NO push seam at all, which
   *   is the control arm for "absent changes nothing".
   */
  function harness({ push = true }: { push?: boolean } = {}): Harness {
    const { eventSource, streams } = fakeEventSourceFactory()
    const stream = new BackendInvalidationStream({
      baseUrl: 'https://backend.test/api',
      eventSource,
      poolIds: [POOL_ID],
      // The reconnect scheduler is left out of the fake clock deliberately:
      // this file is about the POLL timer, and a reconnect firing inside a
      // `clock.tick` would blur which timer moved.
      schedule: () => () => undefined,
    })

    const state = {
      fetchesAt: [] as number[],
      fetchedVars: [] as (Record<string, any> | undefined)[],
      connectedReads: 0,
    }

    const dataSource: DataSource = {
      query: (name: QueryName, vars?: Record<string, any>) => {
        state.fetchesAt.push(Date.now())
        state.fetchedVars.push(vars)
        return of({ name, vars })
      },
      ...(push
        ? {
            invalidations$: (name: QueryName, vars?: Record<string, any>) => stream.invalidations$(name, vars),
            pushConnected$: (): Observable<boolean> => {
              state.connectedReads++
              return stream.connected$
            },
          }
        : {}),
    }

    const centrifuge = new Centrifuge({
      environment: 'testnet',
      dataSource,
      txStrategy: stubTxStrategy,
      indexerPollingInterval: POLL,
    })

    return {
      centrifuge,
      stream,
      streams,
      get fetchesAt() {
        return state.fetchesAt
      },
      get fetchedVars() {
        return state.fetchedVars
      },
      get connectedReads() {
        return state.connectedReads
      },
      lastStream() {
        const last = streams.at(-1)
        if (!last) {
          throw new Error('no stream was opened')
        }
        return last
      },
    } as Harness
  }

  it('polls exactly as it always did when the source has no push seam', () => {
    // The third acceptance criterion, as a control arm. No `invalidations$`
    // means the one-timer path, byte for byte: first fetch on subscribe, then
    // one per interval, and nothing ever asks about connectivity.
    const h = harness({ push: false })
    const sub = h.centrifuge._queryData('epochInvestOrders', { tokenId: TOKEN_A, limit: 1000 }).subscribe()

    clock.tick(2_500)

    expect(h.fetchesAt).to.deep.equal([0, 1_000, 2_000])
    expect(h.connectedReads).to.equal(0)
    expect(h.streams, 'no stream is opened for a source without the seam').to.have.length(0)
    sub.unsubscribe()
  })

  it('leaves the graphql adapter with no push seam at all', () => {
    // The other half of the same criterion: public mode is one of the two ways
    // `invalidations$` is absent, and it must stay that way — the SDK holds no
    // stream in public mode and public-api publishes no invalidations.
    const publicMode = new Centrifuge({ environment: 'testnet' })
    expect('invalidations$' in (publicMode._dataSource as object)).to.equal(false)
    expect(publicMode._dataSource.invalidations$).to.equal(undefined)
    expect(publicMode._dataSource.pushConnected$).to.equal(undefined)
  })

  it('polls at the normal interval while the stream is not connected', () => {
    const h = harness()
    const sub = h.centrifuge._queryData('epochInvestOrders', { tokenId: TOKEN_A, limit: 1000 }).subscribe()

    clock.tick(2_500)

    expect(h.fetchesAt).to.deep.equal([0, 1_000, 2_000])
    sub.unsubscribe()
  })

  it('stretches the poll interval once the stream connects, and still polls', () => {
    const h = harness()
    const sub = h.centrifuge._queryData('epochInvestOrders', { tokenId: TOKEN_A, limit: 1000 }).subscribe()
    // rxjs's `timer(0, …)` schedules its first emission as a macrotask, so a
    // zero tick is what "immediately" means on this clock — including for the
    // very first fetch.
    clock.tick(0)
    expect(h.fetchesAt).to.deep.equal([0])

    clock.tick(500)
    h.lastStream().open()
    clock.tick(0)
    // Connecting restarts the timer, which refetches: a stream that just came
    // up may already have missed something, so the baseline is re-established.
    expect(h.fetchesAt).to.deep.equal([0, 500])

    clock.tick(POLL * PUSH_POLL_INTERVAL_FACTOR - 1)
    expect(h.fetchesAt, 'no normal-interval polls while connected').to.deep.equal([0, 500])

    clock.tick(1)
    expect(h.fetchesAt).to.deep.equal([0, 500, 5_500])
    expect(PUSH_POLL_INTERVAL_FACTOR).to.equal(5)
    sub.unsubscribe()
  })

  it('falls back to the normal interval when the stream is killed', () => {
    // The acceptance criterion asks for the fallback to be verified by KILLING
    // the stream, not by reasoning about it. So: connect, watch the long
    // interval, kill it, watch the normal one resume.
    const h = harness()
    const sub = h.centrifuge._queryData('epochInvestOrders', { tokenId: TOKEN_A, limit: 1000 }).subscribe()
    clock.tick(0)
    h.lastStream().open()
    clock.tick(5_000)
    expect(h.fetchesAt).to.deep.equal([0, 0, 5_000], 'long interval while connected')

    h.lastStream().failTerminally()
    clock.tick(0)

    // Losing the stream refetches immediately (it covers whatever was missed
    // while it was failing) and then resumes the normal cadence.
    expect(h.fetchesAt).to.deep.equal([0, 0, 5_000, 5_000])
    clock.tick(3_000)
    expect(h.fetchesAt).to.deep.equal([0, 0, 5_000, 5_000, 6_000, 7_000, 8_000])
    sub.unsubscribe()
  })

  it('refetches on an invalidation for the subscription the frame names', () => {
    const h = harness()
    const sub = h.centrifuge._queryData('epochInvestOrders', { tokenId: TOKEN_A, limit: 1000 }).subscribe()
    h.lastStream().open()
    const before = h.fetchesAt.length

    h.lastStream().send(invalidation(TOKEN_A))
    expect(h.fetchesAt).to.have.length(before + 1)

    h.lastStream().send(invalidation(TOKEN_B))
    expect(h.fetchesAt, 'another share class is another subscription').to.have.length(before + 1)
    sub.unsubscribe()
  })

  it('triggers exactly one re-fetch per distinct (name, vars) for 10 subscribers on 3 keys', () => {
    // The acceptance criterion's own case. Ten subscribers, three distinct
    // `(name, vars)` keys: the shared `_query` cache means three underlying
    // subscriptions, so one frame per key must produce exactly three re-fetches
    // in total — not ten, and not thirty.
    const h = harness()
    const tokens = [TOKEN_A, TOKEN_B, TOKEN_C]
    const emissions = new Array(10).fill(0)
    const subs = []
    for (let i = 0; i < 10; i++) {
      subs.push(
        h.centrifuge
          ._queryData('epochInvestOrders', { tokenId: tokens[i % 3]!, limit: 1000 })
          .subscribe(() => emissions[i]++)
      )
    }
    clock.tick(0)
    h.lastStream().open()
    clock.tick(0)
    // Three initial fetches, one per distinct key, plus three more from the
    // timer restart when the stream connected.
    expect(h.fetchesAt).to.have.length(6)
    expect(h.streams, 'one stream for ten subscribers').to.have.length(1)
    const before = h.fetchesAt.length

    for (const tokenId of tokens) {
      h.lastStream().send(invalidation(tokenId))
    }

    expect(h.fetchesAt.length - before).to.equal(3)
    // And each re-fetch went out for the key that was invalidated.
    expect(h.fetchedVars.slice(before).map((vars) => vars?.tokenId)).to.deep.equal(tokens)
    // Every subscriber saw its own key's refetch: 10 subscribers each got the
    // initial value, the connect refetch and one invalidation refetch.
    expect(emissions).to.deep.equal(new Array(10).fill(3))
    for (const sub of subs) {
      sub.unsubscribe()
    }
  })

  it('refetches once for a frame that maps to two entries a caller subscribes to', () => {
    // `chain_v1.epoch_invest_order` maps to both `epochInvestOrders` and
    // `investOrderState`. Two subscriptions, two refetches — one each, not one
    // subscription refetching twice.
    const h = harness()
    const a = h.centrifuge._queryData('epochInvestOrders', { tokenId: TOKEN_A, limit: 1000 }).subscribe()
    const b = h.centrifuge._queryData('investOrderState', { tokenId: TOKEN_A, limit: 1000 }).subscribe()
    h.lastStream().open()
    const before = h.fetchesAt.length

    h.lastStream().send(invalidation(TOKEN_A))

    expect(h.fetchesAt.length - before).to.equal(2)
    a.unsubscribe()
    b.unsubscribe()
  })

  it('stops refetching once the subscription is gone and the cache has reset', () => {
    const h = harness()
    const sub = h.centrifuge._queryData('epochInvestOrders', { tokenId: TOKEN_A, limit: 1000 }).subscribe()
    h.lastStream().open()
    clock.tick(0)
    sub.unsubscribe()

    // The shared observable stays warm for `pollingInterval` after its last
    // subscriber (4s by default) and keeps refetching on an invalidation while
    // it does — which is the query cache working, not the seam leaking. Past
    // the reset, the hub subscription is gone with it.
    clock.tick(30_000)
    const before = h.fetchesAt.length

    h.lastStream().send(invalidation(TOKEN_A))

    expect(h.fetchesAt).to.have.length(before)
    expect(h.stream.subscriberCount).to.equal(0)
  })

  it('signals queryInvalidations$ with the (name, vars) entry a push refetched', () => {
    const h = harness()
    const vars = { tokenId: TOKEN_A, limit: 1000 }
    const signals: unknown[] = []
    h.centrifuge.queryInvalidations$.subscribe((s) => signals.push(s))
    const sub = h.centrifuge._queryData('epochInvestOrders', vars).subscribe()
    h.lastStream().open()

    h.lastStream().send(invalidation(TOKEN_A))
    expect(signals).to.deep.equal([{ keys: ['epochInvestOrders', vars] }])

    h.lastStream().send(invalidation(TOKEN_B))
    expect(signals, 'a frame for an unsubscribed entry signals nothing').to.have.length(1)
    sub.unsubscribe()
  })
})
