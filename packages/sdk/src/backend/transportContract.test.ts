import { expect } from 'chai'
import { firstValueFrom } from 'rxjs'
import { BackendPrepareStrategy } from '../tx/BackendPrepare.js'
import type { PoolAction, PrepareOutcome } from '../tx/TxStrategy.js'
import { mockBackendTxView } from './tests/mockBackendTxView.js'
import { BackendTxReads } from './BackendTxReads.js'
import { assertBackendTransport, BackendTransportRequiredError, type BackendTransport } from './transport.js'

const BASE_URL = 'https://backend.test/api'
const POOL_ID = '281474976710657'

/**
 * The transport contract, exercised.
 *
 * The claim is a negative one — the SDK does not know how the session is
 * carried — and a negative claim needs two kinds of evidence. The
 * grep gate (`scripts/assert-transport-purity.mjs`, and
 * `transportPurity.test.ts` beside this file) proves the package contains no
 * such code. This file proves the corresponding positive: a transport that DOES
 * carry a session, refetches a stale CSRF token and replays the request once is
 * invisible to the SDK — the strategy sees one successful prepare and the reads
 * see one successful page, with no knowledge that anything was retried.
 *
 * ## Why the fake is shaped the way it is
 *
 * A fake must be built from the shape the real caller produces, not the shape
 * that is convenient, or it cannot fail. Both halves here are taken from
 * source in this repo, not invented:
 *
 * - The CSRF refusal is `403 { statusCode, message: 'Invalid CSRF token',
 *   error: 'Forbidden' }` — Nest's `ForbiddenException('Invalid CSRF token')`
 *   as `interfaces/http/guards/csrf.guard.ts` throws it. It matters that this
 *   is NOT the authorization refusal shape (`{ error: 'forbidden', code }`):
 *   a transport that retried on any 403 would replay a
 *   policy denial and write a second audit row, so distinguishing them is part
 *   of the contract the app implements.
 * - `GET /auth/csrf-token` answers `{ csrfToken }`, as
 *   `auth.controller.ts#getCsrfToken` does, and is `@Public()` and exempt from
 *   the guard, which is why the retry can obtain a token at all.
 * - The guard runs BEFORE `RolesGuard` (`docs/architecture/application-flows.md`),
 *   so a stale token is refused before any handler work happens. The fake
 *   therefore refuses before touching its "database", exactly as the real one
 *   does — otherwise a replay could look idempotent here and not be there.
 *
 * A live arm exists and is not replaced by this: `src/tx/BackendPrepare.contract.test.ts`
 * runs the same strategy against the real controller, guards included.
 */

interface FakeBackendOptions {
  /**
   * Refuse the first N mutating requests outright with the guard's stale-token
   * 403, counted across the whole fake. `2` therefore exhausts one request's
   * single retry, which is how the "does not retry forever" case is built.
   */
  staleTokenFailures?: number
  /**
   * Refuse the FIRST attempt of every distinct `METHOD path` with the guard's
   * 403 — a token that has genuinely expired, so each request needs its own
   * refresh and replay. This is the realistic case; `staleTokenFailures` is the
   * pathological one.
   */
  staleFirstAttemptPerRequest?: boolean
  /** Fail the first N GETs with the guard's 403, to prove GETs are not retried. */
  staleTokenFailuresOnGet?: number
}

interface FakeBackend {
  fetch: typeof fetch
  /** Every request the transport actually issued, in order. */
  log: { method: string; path: string; csrf: string | null }[]
  /** How many times a token was handed out. */
  tokensIssued: number
  /** Rows the fake accepted, so a double-apply would be visible. */
  prepared: string[]
}

/**
 * A fake backend plus the app-side transport the reference implementation
 * describes (`docs/api/sdk-backend-transport.md`): credentials on every
 * request, the double-submit header on mutating ones, and exactly one replay
 * when the guard says the token is stale.
 */
function fakeBackend(options: FakeBackendOptions = {}): FakeBackend {
  const state: FakeBackend = {
    fetch: null as unknown as typeof fetch,
    log: [],
    tokensIssued: 0,
    prepared: [],
  }
  let staleMutating = options.staleTokenFailures ?? 0
  let staleGet = options.staleTokenFailuresOnGet ?? 0
  let issued = 0
  const firstAttemptSeen = new Set<string>()

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

  // Nest's ForbiddenException('Invalid CSRF token'), verbatim.
  const staleToken = () => json({ message: 'Invalid CSRF token', error: 'Forbidden', statusCode: 403 }, 403)

  const server = async (path: string, method: string, presented: string | null): Promise<Response> => {
    if (path === '/auth/csrf-token') {
      state.tokensIssued++
      issued++
      return json({ csrfToken: `token-${issued}` })
    }

    const mutating = method !== 'GET' && method !== 'HEAD'
    if (mutating && staleMutating > 0) {
      staleMutating--
      return staleToken()
    }
    if (mutating && options.staleFirstAttemptPerRequest && !firstAttemptSeen.has(`${method} ${path}`)) {
      firstAttemptSeen.add(`${method} ${path}`)
      return staleToken()
    }
    if (!mutating && staleGet > 0) {
      staleGet--
      return staleToken()
    }

    state.log.push({ method, path, csrf: presented })

    if (method === 'POST' && path === `/pools/${POOL_ID}/tx/prepare`) {
      const txId = `tx-${state.prepared.length + 1}`
      state.prepared.push(txId)
      return json({
        txId,
        signerType: 'wallet_connect',
        status: 'prepared',
        unsignedTx: { to: `0x${'11'.repeat(20)}`, data: '0xdeadbeef', value: '1000000000000000', chainId: 11155111 },
      })
    }
    if (method === 'POST' && /\/tx\/[^/]+\/confirm$/.test(path)) {
      return json(mockBackendTxView({ txId: 'tx-1', status: 'broadcast', txHash: `0x${'ab'.repeat(32)}` }))
    }
    if (method === 'GET' && path === `/pools/${POOL_ID}/tx`) {
      return json({ items: [mockBackendTxView({ txId: 'tx-1' })], total: 1, nextCursor: null })
    }
    return json({ error: 'not_found', code: 'NO_FAKE_ROUTE' }, 404)
  }

  // The app-side transport. Everything session-shaped happens HERE, above the
  // SDK, which is the whole point of the contract.
  let token: string | undefined

  const refreshToken = async (): Promise<string> => {
    const res = await server('/auth/csrf-token', 'GET', null)
    const body = (await res.json()) as { csrfToken: string }
    token = body.csrfToken
    return token
  }

  const isStaleToken = async (res: Response): Promise<boolean> => {
    if (res.status !== 403) {
      return false
    }
    // The body distinguishes a stale token from a policy denial. Cloned so the
    // caller still gets an unread body when this says "no".
    try {
      const body = (await res.clone().json()) as { message?: unknown; code?: unknown }
      return body.message === 'Invalid CSRF token'
    } catch {
      return false
    }
  }

  state.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const path = String(input).replace(BASE_URL, '')
    const method = (init.method ?? 'GET').toUpperCase()
    const mutating = method !== 'GET' && method !== 'HEAD'

    const send = async (presented: string | null) => await server(path, method, presented)

    let presented = mutating ? (token ?? (await refreshToken())) : null
    let res = await send(presented)

    if (mutating && (await isStaleToken(res))) {
      // Exactly one replay, with a fresh token. A second failure is a real
      // refusal and reaches the caller.
      presented = await refreshToken()
      res = await send(presented)
    }
    return res
  }) as typeof fetch

  return state
}

function action(): PoolAction {
  return { action: 'updatePoolMetadata', poolId: POOL_ID, payload: { poolId: POOL_ID, cid: 'Qm123' } }
}

describe('injected transport contract', () => {
  it('requires both members and names what is missing', () => {
    expect(() => assertBackendTransport(undefined)).to.throw(BackendTransportRequiredError, /none was passed/)
    expect(() => assertBackendTransport({} as BackendTransport)).to.throw(
      BackendTransportRequiredError,
      /`transport.fetch` is not a function/
    )
    expect(() => assertBackendTransport({ fetch: (() => {}) as any } as BackendTransport)).to.throw(
      BackendTransportRequiredError,
      /`transport.eventSource` is not a function/
    )
  })

  it('never falls back to the global fetch, and says why', () => {
    // The tempting default is the worst one: it works against a same-origin dev
    // server that forwards the cookie and fails as 401s in the first
    // cross-origin deployment.
    let message = ''
    try {
      assertBackendTransport(undefined)
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).to.contain('no default')
    expect(message).to.contain('same-origin dev server')
    expect(message).to.contain('docs/api/sdk-backend-transport.md')
  })

  it('prepares through a transport whose CSRF token is stale, retrying once, invisibly to the SDK', async () => {
    const backend = fakeBackend({ staleTokenFailures: 1 })
    const strategy = new BackendPrepareStrategy({ baseUrl: BASE_URL, transport: { fetch: backend.fetch } })

    const outcome = (await firstValueFrom(strategy.prepare(action(), {}))) as Extract<
      PrepareOutcome,
      { route: 'wallet' }
    >

    // The SDK's view: one clean prepare. No retry, no token, no 403.
    expect(outcome.route).to.equal('wallet')
    expect(outcome.txId).to.equal('tx-1')
    expect(outcome.unsignedTx.value).to.equal(1000000000000000n)

    // The transport's view: two tokens fetched (initial + refresh) and the
    // request replayed once with the fresh one.
    expect(backend.tokensIssued).to.equal(2)
    expect(backend.log.map((r) => `${r.method} ${r.path}`)).to.deep.equal([`POST /pools/${POOL_ID}/tx/prepare`])
    expect(backend.log[0]!.csrf).to.equal('token-2')

    // And the row was prepared ONCE. A retry that reached the handler twice
    // would leave two rows here, which is the failure mode a "retry any 403"
    // transport has and this one must not.
    expect(backend.prepared).to.deep.equal(['tx-1'])
  })

  it('confirms through the same stale-token path', async () => {
    // Both mutating requests get their own stale-token refusal and their own
    // replay. Confirm matters as much as prepare: it is what moves the row out
    // of `prepared`, so a transport that recovered on prepare but not on
    // confirm would leave rows mid-flight while looking healthy.
    const backend = fakeBackend({ staleFirstAttemptPerRequest: true })
    const strategy = new BackendPrepareStrategy({ baseUrl: BASE_URL, transport: { fetch: backend.fetch } })

    const outcome = (await firstValueFrom(strategy.prepare(action(), {}))) as Extract<
      PrepareOutcome,
      { route: 'wallet' }
    >
    // Resolves, so the confirm was accepted after its own replay.
    await strategy.confirm(outcome.txId, { status: 'broadcast', txHash: `0x${'ab'.repeat(32)}` })

    expect(backend.log.map((r) => `${r.method} ${r.path}`)).to.deep.equal([
      `POST /pools/${POOL_ID}/tx/prepare`,
      `POST /pools/${POOL_ID}/tx/tx-1/confirm`,
    ])
    // Three tokens, not four: the transport CACHES the token it fetched, so
    // confirm reuses prepare's and only refreshes when the guard rejects it.
    // That is the behaviour the double-submit pattern wants — one token per
    // session, refetched on refusal — rather than one round trip per mutation.
    expect(backend.tokensIssued).to.equal(3)
    expect(backend.prepared).to.deep.equal(['tx-1'])
  })

  it('surfaces a second stale-token refusal instead of retrying forever', async () => {
    // "One retry", not "until it works". A second failure means something other
    // than a stale token, and the caller has to see it.
    const backend = fakeBackend({ staleTokenFailures: 2 })
    const strategy = new BackendPrepareStrategy({ baseUrl: BASE_URL, transport: { fetch: backend.fetch } })

    let error: any
    try {
      await firstValueFrom(strategy.prepare(action(), {}))
    } catch (e) {
      error = e
    }

    expect(error, 'the second 403 must reach the SDK').to.be.an('error')
    // The SDK maps a 403 to a policy denial — which is correct for what it can
    // see. That is the reason the app, not the SDK, owns CSRF recovery: only
    // the transport can tell the two 403s apart.
    expect(error.name).to.equal('PolicyDeniedError')
    expect(backend.prepared).to.deep.equal([])
  })

  it('does not send the header, or retry, on a read', async () => {
    // Safe methods are exempt server-side, so a read carries no token and a 403
    // on a read is never a stale token. The fake refuses one GET to prove the
    // transport does NOT replay it.
    const backend = fakeBackend({ staleTokenFailuresOnGet: 1 })
    const reads = new BackendTxReads({ baseUrl: BASE_URL, fetch: backend.fetch })

    let error: any
    try {
      await reads.list(POOL_ID)
    } catch (e) {
      error = e
    }
    expect(error?.name).to.equal('BackendTxReadError')
    expect(error.status).to.equal(403)
    expect(backend.tokensIssued).to.equal(0)

    // The next read succeeds and carries no header.
    const page = await reads.list(POOL_ID)
    expect(page.items).to.have.length(1)
    expect(backend.log.every((r) => r.csrf === null)).to.equal(true)
    expect(backend.tokensIssued).to.equal(0)
  })

  it('adds no credentials flag and no session header of its own to a request', async () => {
    // The observable half of the purity claim: whatever the SDK hands the
    // transport must be free of session decisions, so that the transport's own
    // are the only ones. `credentials` absent (not `'omit'` — absent, so the
    // app's `fetch` wrapper decides) and no header beyond content negotiation.
    const seen: RequestInit[] = []
    const spy = (async (_input: RequestInfo | URL, init: RequestInit = {}) => {
      seen.push(init)
      return new Response(
        JSON.stringify({
          txId: 'tx-1',
          signerType: 'wallet_connect',
          status: 'prepared',
          unsignedTx: { to: `0x${'11'.repeat(20)}`, data: '0x00', value: '0', chainId: 11155111 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }) as unknown as typeof fetch

    const strategy = new BackendPrepareStrategy({ baseUrl: BASE_URL, transport: { fetch: spy } })
    await firstValueFrom(strategy.prepare(action(), {}))
    const reads = new BackendTxReads({ baseUrl: BASE_URL, fetch: spy })
    await reads.list(POOL_ID).catch(() => undefined)

    expect(seen).to.have.length(2)
    for (const init of seen) {
      expect(init, 'the SDK must not decide whether credentials are sent').to.not.have.property('credentials')
      const headerNames = [...new Headers(init.headers as HeadersInit).keys()].sort()
      expect(headerNames.every((name) => name === 'accept' || name === 'content-type')).to.equal(
        true,
        `unexpected header(s): ${headerNames.join(', ')}`
      )
    }
  })
})
