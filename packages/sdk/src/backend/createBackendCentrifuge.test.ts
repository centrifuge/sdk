import { expect } from 'chai'
import { firstValueFrom } from 'rxjs'
import sinon from 'sinon'
import { RestDataSource } from '../data/RestDataSource.js'
import { Pool } from '../entities/Pool.js'
import { FakeStream } from './tests/fakeStream.js'
import { mockBackendTxView } from './tests/mockBackendTxView.js'
import { BackendPrepareStrategy } from '../tx/BackendPrepare.js'
import { PoolId } from '../utils/types.js'
import { BackendCentrifuge, createBackendCentrifuge } from './BackendCentrifuge.js'
import { BackendPool, DEFAULT_BACKEND_TX_POLL_INTERVAL } from './BackendPool.js'
import { BackendTransportRequiredError, type BackendTransport } from './transport.js'

const BASE_URL = 'https://backend.test/api'
const POOL_ID = new PoolId(281474976710657n)

/**
 * The factory, end to end over a fake backend.
 *
 * The acceptance criterion asks for a login-less fake session, a
 * prepare/confirm round trip and one rest read, all through the injected
 * transport. That is what this file does. It is a FAKE backend and says so:
 * the live arm against the real controller, guards and database is
 * `src/tx/BackendPrepare.contract.test.ts` (`pnpm test:contract`), which skips
 * as pending without its fixture handle. Both exist because a fake proves the
 * wiring and only a socket proves the contract.
 *
 * "Login-less" is meant literally, and it is the property under test: there is
 * no login call anywhere below, because the SDK has no concept of one. The
 * session is whatever `transport.fetch` already carries.
 */
interface Fake {
  transport: BackendTransport
  requests: { method: string; url: string }[]
  eventSourceCalls: string[]
  streams: FakeStream[]
}

function fakeSession(routes: Record<string, unknown> = {}): Fake {
  const requests: { method: string; url: string }[] = []
  const eventSourceCalls: string[] = []
  const streams: FakeStream[] = []

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

  const transport: BackendTransport = {
    fetch: (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input)
      const method = (init.method ?? 'GET').toUpperCase()
      requests.push({ method, url })
      const path = url.replace(BASE_URL, '')

      if (method === 'POST' && path === `/pools/${POOL_ID.raw}/tx/prepare`) {
        return json({
          txId: 'tx-1',
          signerType: 'wallet_connect',
          status: 'prepared',
          unsignedTx: { to: `0x${'11'.repeat(20)}`, data: '0xabcd', value: '250000000000000', chainId: 11155111 },
        })
      }
      if (method === 'POST' && path === `/pools/${POOL_ID.raw}/tx/tx-1/confirm`) {
        return json(mockBackendTxView({ status: 'broadcast', txHash: `0x${'ab'.repeat(32)}` }))
      }
      // Keyed on the path without its query string, so a route table entry
      // does not have to reproduce the catalogue's page ceiling.
      const pathname = path.split('?')[0]!
      if (path in routes) {
        return json(routes[path])
      }
      if (pathname in routes) {
        return json(routes[pathname])
      }
      return json({ error: 'not_found', code: 'NO_FAKE_ROUTE', path }, 404)
    }) as unknown as typeof fetch,
    // A stream object shaped like the one a real transport hands back — an
    // `EventSource` with listeners and a `readyState`, not `{}`: the
    // invalidation stream listens to what the factory returns, and a fake that
    // could not be listened to would fail in a way the real thing never does.
    eventSource: (url: string) => {
      eventSourceCalls.push(url)
      const stream = new FakeStream(url)
      streams.push(stream)
      return stream as unknown as EventSource
    },
  }

  return { transport, requests, eventSourceCalls, streams }
}

const POOLS_ROUTE = '/pools'
const poolsBody = [
  {
    id: POOL_ID.raw.toString(),
    protocolVersion: '3.2',
    migrationStatus: 'live',
  },
]

describe('createBackendCentrifuge', () => {
  afterEach(() => {
    sinon.restore()
  })

  it('fills both seams and leaves nothing to the caller', () => {
    const { transport } = fakeSession()
    const centrifuge = createBackendCentrifuge({ environment: 'testnet', baseUrl: BASE_URL }, transport)

    expect(centrifuge).to.be.instanceOf(BackendCentrifuge)
    expect(centrifuge._txStrategy).to.be.instanceOf(BackendPrepareStrategy)
    // The read seam forwards to a RestDataSource; the forwarder exists only
    // because RestDataSource needs the root that is being constructed.
    expect(centrifuge._dataSource).to.not.be.instanceOf(RestDataSource)
    expect((centrifuge._dataSource as any).bind, 'the late-bound forwarder').to.be.a('function')
  })

  it('declares no `invalidations$` when no stream is configured', () => {
    // Permanent for a client with no `streamPoolIds`, which is the default, and
    // load-bearing: `_queryData` branches on the field's PRESENCE to decide
    // whether to merge a push stream into its poll timer and to stretch that
    // timer, so a forwarder declaring the field while nothing pushed would move
    // every catalogue read onto the long interval to wait on a stream that
    // never emits. "`invalidations$` absent changes nothing", expressed at the seam
    // where the branch is taken.
    const { transport } = fakeSession()
    const centrifuge = createBackendCentrifuge({ environment: 'testnet', baseUrl: BASE_URL }, transport)
    expect('invalidations$' in (centrifuge._dataSource as object)).to.equal(false)
    expect(centrifuge._dataSource.invalidations$).to.equal(undefined)
    expect(centrifuge._dataSource.pushConnected$).to.equal(undefined)
    expect(centrifuge._invalidationStream).to.equal(undefined)
    // And an empty list is the same as no list: it cannot mean "subscribe to
    // nothing", because a stream with no pool subscription receives no
    // invalidation at all while reporting itself connected.
    const empty = createBackendCentrifuge(
      { environment: 'testnet', baseUrl: BASE_URL, streamPoolIds: [] },
      fakeSession().transport
    )
    expect('invalidations$' in (empty._dataSource as object)).to.equal(false)
  })

  it('declares `invalidations$` exactly when a stream is configured', () => {
    const { transport } = fakeSession()
    const centrifuge = createBackendCentrifuge(
      { environment: 'testnet', baseUrl: BASE_URL, streamPoolIds: [POOL_ID.raw.toString()] },
      transport
    )
    expect('invalidations$' in (centrifuge._dataSource as object)).to.equal(true)
    expect(centrifuge._dataSource.invalidations$).to.be.a('function')
    expect(centrifuge._dataSource.pushConnected$).to.be.a('function')
    expect(centrifuge._invalidationStream?.url).to.equal(`${BASE_URL}/events/stream?poolId=${POOL_ID.raw.toString()}`)
  })

  it('refuses to build without a transport, and without a baseUrl', () => {
    expect(() => createBackendCentrifuge({ baseUrl: BASE_URL }, undefined as unknown as BackendTransport)).to.throw(
      BackendTransportRequiredError
    )
    expect(() => createBackendCentrifuge({ baseUrl: '' } as any, fakeSession().transport)).to.throw(
      /needs `config.baseUrl`/
    )
  })

  it('opens no stream at construction, even when one is configured', () => {
    // The stream is opened LAZILY, on the first subscription that can be
    // pushed to, so constructing a client opens no socket in either
    // configuration.
    const fake = fakeSession()
    const centrifuge = createBackendCentrifuge({ environment: 'testnet', baseUrl: BASE_URL }, fake.transport)
    expect(fake.eventSourceCalls).to.deep.equal([])
    expect(centrifuge._eventSource).to.equal(fake.transport.eventSource)

    const pushing = fakeSession()
    createBackendCentrifuge(
      { environment: 'testnet', baseUrl: BASE_URL, streamPoolIds: [POOL_ID.raw.toString()] },
      pushing.transport
    )
    expect(pushing.eventSourceCalls).to.deep.equal([])
  })

  it('opens ONE stream through the injected factory on the first pushed read', () => {
    // The injected factory is called once, with the pool-scoped stream URL —
    // and it is the app's factory, so `withCredentials` was decided before the
    // SDK was in the room.
    const fake = fakeSession()
    const centrifuge = createBackendCentrifuge(
      { environment: 'testnet', baseUrl: BASE_URL, streamPoolIds: [POOL_ID.raw.toString(), '999'] },
      fake.transport
    )
    const subs = [1, 2, 3].map(() =>
      centrifuge._dataSource.invalidations$!('epochInvestOrders', { tokenId: `0x${'01'.repeat(16)}` }).subscribe()
    )

    expect(fake.eventSourceCalls).to.deep.equal([
      `${BASE_URL}/events/stream?poolId=${POOL_ID.raw.toString()}&poolId=999`,
    ])
    expect(centrifuge._invalidationStream?.diagnostics.opened).to.equal(1)

    for (const sub of subs) {
      sub.unsubscribe()
    }
    centrifuge.closeInvalidationStream()
    expect(centrifuge._invalidationStream?.connected).to.equal(false)
  })

  it('re-reads over REST when the stream says an Orders entry is stale', async () => {
    // The whole push path, with nothing stubbed but the socket and the
    // backend: the shipped route table decides the URL, the shipped
    // table-to-entry mapping turns `chain_v1.epoch_invest_order` into
    // `epochInvestOrders`, and the re-fetch is visible as a second HTTP GET.
    //
    // `tokenId`'s high 8 bytes ARE the pool id (a share class id is
    // `(poolId << 64) + counter`), which is what lets the pool-scoped orders
    // route be addressed from an entry keyed by share class alone.
    const tokenId = `0x${((POOL_ID.raw << 64n) + 1n).toString(16).padStart(32, '0')}`
    const ordersPath = `/pools/${POOL_ID.raw}/share-classes/${tokenId}/orders`
    const fake = fakeSession({
      [ordersPath]: { items: [], protocolVersion: '3.2', migrationStatus: 'live' },
    })
    const centrifuge = createBackendCentrifuge(
      { environment: 'testnet', baseUrl: BASE_URL, streamPoolIds: [POOL_ID.raw.toString()] },
      fake.transport
    )

    const rows: unknown[] = []
    const sub = centrifuge._queryData('epochInvestOrders', { tokenId, limit: 1000 }).subscribe((r) => rows.push(r))
    await new Promise((resolve) => setTimeout(resolve, 0))
    const ordersRequests = () => fake.requests.filter((r) => r.url.includes('/orders'))
    expect(ordersRequests()).to.have.length(1)

    const stream = fake.streams[0]!
    stream.open()
    await new Promise((resolve) => setTimeout(resolve, 0))
    const beforePush = ordersRequests().length
    stream.send({
      v: 1,
      table: 'chain_v1.epoch_invest_order',
      keys: { tokenId, assetId: '42', index: '3' },
      blockNumber: 4242,
      poolId: POOL_ID.raw.toString(),
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(ordersRequests().length - beforePush).to.equal(1)
    expect(rows.length).to.be.greaterThan(1)
    // A frame for another share class is not this subscription's business.
    const beforeOther = ordersRequests().length
    stream.send({
      v: 1,
      table: 'chain_v1.epoch_invest_order',
      keys: { tokenId: `0x${'02'.repeat(16)}`, assetId: '42', index: '3' },
      blockNumber: 4243,
      poolId: POOL_ID.raw.toString(),
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(ordersRequests()).to.have.length(beforeOther)

    sub.unsubscribe()
    centrifuge.closeInvalidationStream()
  })

  it('serves a rest read through the injected transport', async () => {
    // `blockchains` is a routed catalogue entry, so it must go to REST
    // and never to graphql. One read is all the criterion asks for; the whole
    // per-entry table is `data/restRoutes.test.ts`'s job.
    const fake = fakeSession({
      '/blockchains': [{ id: '11155111', centrifugeId: '1', name: 'Sepolia', network: 'testnet', icon: null }],
    })
    const centrifuge = createBackendCentrifuge(
      { environment: 'testnet', baseUrl: BASE_URL, graphqlTarget: 'api-v3' },
      fake.transport
    )
    const graphql = sinon.stub(centrifuge as any, '_executeGraphql').rejects(new Error('graphql must not be used'))

    const blockchains = await firstValueFrom(centrifuge._dataSource.query('blockchains', {}))

    expect(blockchains).to.have.length(1)
    expect(graphql.called).to.equal(false)
    expect(fake.requests).to.deep.equal([{ method: 'GET', url: `${BASE_URL}/blockchains` }])
  })

  it('prepares and confirms a write through the injected transport, with no login anywhere', async () => {
    const fake = fakeSession()
    const centrifuge = createBackendCentrifuge({ environment: 'testnet', baseUrl: BASE_URL }, fake.transport)
    const strategy = centrifuge._txStrategy as BackendPrepareStrategy

    const outcome: any = await firstValueFrom(
      strategy.prepare({ action: 'updatePoolMetadata', poolId: POOL_ID.raw.toString(), payload: { cid: 'Qm1' } }, {})
    )
    expect(outcome.route).to.equal('wallet')
    // Parsed, not cast: the wire form is a decimal string.
    expect(outcome.unsignedTx.value).to.equal(250000000000000n)

    // No poolId passed — the strategy remembers it from its own prepare.
    await strategy.confirm(outcome.txId, { status: 'broadcast', txHash: `0x${'ab'.repeat(32)}` })

    expect(fake.requests.map((r) => `${r.method} ${r.url.replace(BASE_URL, '')}`)).to.deep.equal([
      `POST /pools/${POOL_ID.raw}/tx/prepare`,
      `POST /pools/${POOL_ID.raw}/tx/tx-1/confirm`,
    ])
  })

  it('returns a BackendPool that is still a Pool', async () => {
    const fake = fakeSession({ [POOLS_ROUTE]: poolsBody })
    const centrifuge = createBackendCentrifuge({ environment: 'testnet', baseUrl: BASE_URL }, fake.transport)

    const pool = await centrifuge.pool(POOL_ID)

    expect(pool).to.be.instanceOf(BackendPool)
    // The whole point of the wrap: every mode-independent method is still
    // there, so an app changing modes changes one construction call.
    expect(pool).to.be.instanceOf(Pool)
    expect(pool.id.equals(POOL_ID)).to.equal(true)
    expect(pool.transactions).to.be.a('function')
    expect(pool.transaction).to.be.a('function')
  })

  it('refuses a pool the catalogue does not return, exactly as public mode does', async () => {
    const fake = fakeSession({ [POOLS_ROUTE]: [] })
    const centrifuge = createBackendCentrifuge({ environment: 'testnet', baseUrl: BASE_URL }, fake.transport)

    let error: any
    try {
      await centrifuge.pool(POOL_ID)
    } catch (e) {
      error = e
    }
    // The wrap adds methods, never existence.
    expect(error?.message).to.contain(`Pool with id ${POOL_ID} not found`)
  })

  it('reads the pool tx list and one tx row off the BackendPool', async () => {
    const fake = fakeSession({
      [POOLS_ROUTE]: poolsBody,
      [`/pools/${POOL_ID.raw}/tx`]: { items: [mockBackendTxView({ txId: 'tx-1' })], total: 1, nextCursor: null },
      [`/pools/${POOL_ID.raw}/tx/tx-1`]: mockBackendTxView({ txId: 'tx-1', status: 'confirmed' }),
    })
    const centrifuge = createBackendCentrifuge({ environment: 'testnet', baseUrl: BASE_URL }, fake.transport)
    const pool = await centrifuge.pool(POOL_ID)

    const page = await pool.transactions()
    expect(page.items.map((t) => t.txId)).to.deep.equal(['tx-1'])
    expect(page.nextCursor).to.equal(null)

    const tx = await pool.transaction('tx-1')
    expect(tx.status).to.equal('confirmed')

    expect(fake.requests.map((r) => r.url.replace(BASE_URL, ''))).to.include(`/pools/${POOL_ID.raw}/tx`)
    expect(fake.requests.map((r) => r.url.replace(BASE_URL, ''))).to.include(`/pools/${POOL_ID.raw}/tx/tx-1`)
  })

  it('caches per filter, so two filters are two requests and the same filter is one', async () => {
    const fake = fakeSession({
      [POOLS_ROUTE]: poolsBody,
      [`/pools/${POOL_ID.raw}/tx`]: { items: [], total: 0, nextCursor: null },
    })
    const centrifuge = createBackendCentrifuge({ environment: 'testnet', baseUrl: BASE_URL }, fake.transport)
    const pool = await centrifuge.pool(POOL_ID)

    await pool.transactions({ status: 'prepared' })
    await pool.transactions({ status: 'prepared' })
    await pool.transactions({ status: 'confirmed' })

    const listCalls = fake.requests.filter((r) => r.url.includes('/tx?'))
    expect(listCalls.map((r) => new URL(r.url).search)).to.deep.equal(['?status=prepared', '?status=confirmed'])
  })

  it('polls the tx reads faster than the catalogue, and honours an override', async () => {
    // 10s rather than the catalogue's 120s: between a custodial hand-off and
    // confirmation this poll is the only thing that moves, and two minutes of
    // silence there reads as a stuck transaction.
    expect(DEFAULT_BACKEND_TX_POLL_INTERVAL).to.equal(10_000)
    const fake = fakeSession({
      [POOLS_ROUTE]: poolsBody,
      [`/pools/${POOL_ID.raw}/tx/tx-1`]: mockBackendTxView({ txId: 'tx-1' }),
    })
    const centrifuge = createBackendCentrifuge(
      { environment: 'testnet', baseUrl: BASE_URL, txPollingInterval: 20, cache: false },
      fake.transport
    )
    const pool = await centrifuge.pool(POOL_ID)

    const seen: string[] = []
    const sub = pool.transaction('tx-1').subscribe((tx) => seen.push(tx.status))
    await new Promise((resolve) => setTimeout(resolve, 70))
    sub.unsubscribe()

    // Re-fetched rather than emitted once. The exact count is timing-dependent,
    // so the assertion is "more than one", which is the property that matters.
    expect(seen.length).to.be.greaterThan(1)
  })

  it('does not put a backend-only option on the root config', () => {
    // `baseUrl`, `useWalletConnect`, `restRoutes` and `txPollingInterval` are
    // this factory's, not `Config`'s. Passing them through would freeze them
    // onto `centrifuge.config`, where a consumer reading the public config
    // would find fields the published type does not have.
    const { transport } = fakeSession()
    const centrifuge = createBackendCentrifuge(
      { environment: 'testnet', baseUrl: BASE_URL, useWalletConnect: true, txPollingInterval: 5000 },
      transport
    )
    const keys = Object.keys(centrifuge.config)
    expect(keys).to.not.include('baseUrl')
    expect(keys).to.not.include('useWalletConnect')
    expect(keys).to.not.include('restRoutes')
    expect(keys).to.not.include('txPollingInterval')
    expect(keys).to.include('dataSource')
    expect(keys).to.include('txStrategy')
  })
})
