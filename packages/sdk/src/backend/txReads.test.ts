import { expect } from 'chai'
import { mockBackendFordefiTxView, mockBackendTxView } from './tests/mockBackendTxView.js'
import { backendTxListQuery, BackendTxReadError, BackendTxReads } from './BackendTxReads.js'
import { BACKEND_TX_STATUSES, BackendTxViewError, decodeBackendTxPage, decodeBackendTxView } from './txView.js'

const BASE_URL = 'https://backend.test/api'
const POOL_ID = '281474976710657'

function jsonFetch(handler: (url: string) => { status?: number; body: unknown }): {
  fetch: typeof fetch
  urls: string[]
} {
  const urls: string[] = []
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input)
    urls.push(url)
    const { status = 200, body } = handler(url)
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }) as unknown as typeof fetch
  return { fetch: fetchImpl, urls }
}

describe('backend tx reads: keyset paging', () => {
  it('sends no `offset`, ever', () => {
    // The correctness claim, at the one place it is decidable: the query
    // string. The backend serves BOTH `?offset=` and `?cursor=`, so nothing on the
    // backend side would object to the wrong one — this is the only gate.
    expect(backendTxListQuery()).to.equal('')
    expect(backendTxListQuery({ limit: 20 })).to.equal('?limit=20')
    expect(backendTxListQuery({ status: 'pending_approval', limit: 20 })).to.equal('?status=pending_approval&limit=20')
    expect(backendTxListQuery({ limit: 20, cursor: 'abc' })).to.equal('?limit=20&cursor=abc')
    // Not "we happen not to pass it": the option does not exist, so a caller
    // reaching for the familiar name gets a compile error rather than the
    // unsafe path. This asserts the runtime half, for a plain-JS caller.
    const smuggled = { limit: 20, offset: 40 } as unknown as Parameters<typeof backendTxListQuery>[0]
    expect(backendTxListQuery(smuggled)).to.equal('?limit=20')
  })

  it('walks two pages by following nextCursor, not by counting rows', async () => {
    // What makes this the safe walk: page 2's boundary is a VALUE carried by a
    // row page 1 returned, so rows inserted at the front of the list (prepare
    // inserts newest-first) or leaving a `?status=` filtered set (the Fordefi
    // poller does that on every transition) cannot move it. An `?offset=20`
    // walk over the same two writes repeats the last row of page 1 and skips
    // the first row of page 2 — the backend's suite carries the control arm.
    const CURSOR = 'MjAyNi0wOS0wMVQxMDowMDowMC4wMDAwMDBafGFiYw'
    const { fetch: fetchImpl, urls } = jsonFetch((url) =>
      url.includes('cursor=')
        ? { body: { items: [mockBackendTxView({ txId: 'tx-2' })], total: 2, nextCursor: null } }
        : { body: { items: [mockBackendTxView({ txId: 'tx-1' })], total: 2, nextCursor: CURSOR } }
    )
    const reads = new BackendTxReads({ baseUrl: BASE_URL, fetch: fetchImpl })

    const first = await reads.list(POOL_ID, { limit: 1 })
    expect(first.items.map((t) => t.txId)).to.deep.equal(['tx-1'])
    expect(first.total).to.equal(2)
    expect(first.nextCursor).to.equal(CURSOR)

    const second = await reads.list(POOL_ID, { limit: 1, cursor: first.nextCursor! })
    expect(second.items.map((t) => t.txId)).to.deep.equal(['tx-2'])
    expect(second.nextCursor).to.equal(null)

    expect(urls).to.deep.equal([
      `${BASE_URL}/pools/${POOL_ID}/tx?limit=1`,
      `${BASE_URL}/pools/${POOL_ID}/tx?limit=1&cursor=${encodeURIComponent(CURSOR)}`,
    ])
    // The regression this guards: a walk that incremented an offset would issue
    // `?limit=1&offset=1` here, and `total` would be the only clue anything was
    // wrong (and it would not be, since `total` is the filtered-set size either
    // way).
    expect(urls.some((url) => url.includes('offset'))).to.equal(false)
  })

  it('refuses a page body with no nextCursor field at all', async () => {
    // Absent is not null. Treating a missing field as "last page" would end a
    // caller's walk at page one and look like a short list rather than a broken
    // contract — the exact "loud failure becomes a plausible value" shape.
    const { fetch: fetchImpl } = jsonFetch(() => ({ body: { items: [], total: 0 } }))
    const reads = new BackendTxReads({ baseUrl: BASE_URL, fetch: fetchImpl })

    let error: any
    try {
      await reads.list(POOL_ID)
    } catch (e) {
      error = e
    }
    expect(error).to.be.instanceOf(BackendTxViewError)
    expect(error.message).to.contain('no `nextCursor` field')
  })

  it('passes an opaque cursor through url-encoded and unmodified', async () => {
    // Cursors are base64url of `microsecond-timestamp|uuid`. A cursor the SDK
    // reshaped would decode to a different row, and the backend refuses a
    // mangled one as 422 — visible, but only after a round trip.
    const CURSOR = 'MjAyNi0wOS0wMVQxMDowMDowMC4xMjM0NTZafDAxOTk='
    const { fetch: fetchImpl, urls } = jsonFetch(() => ({ body: { items: [], total: 0, nextCursor: null } }))
    const reads = new BackendTxReads({ baseUrl: BASE_URL, fetch: fetchImpl })

    await reads.list(POOL_ID, { cursor: CURSOR })
    const sent = new URL(urls[0]!).searchParams.get('cursor')
    expect(sent).to.equal(CURSOR)
  })
})

describe('backend tx reads: the view', () => {
  it('reads one transaction and parses the wei value as a bigint', async () => {
    const { fetch: fetchImpl, urls } = jsonFetch(() => ({ body: mockBackendTxView({ txId: 'tx-9' }) }))
    const reads = new BackendTxReads({ baseUrl: BASE_URL, fetch: fetchImpl })

    const tx = await reads.get(POOL_ID, 'tx-9')

    expect(urls).to.deep.equal([`${BASE_URL}/pools/${POOL_ID}/tx/tx-9`])
    expect(tx.txId).to.equal('tx-9')
    expect(tx.status).to.equal('prepared')
    expect(tx.unsignedTx?.value).to.equal(1000000000000000n)
    expect(tx.approvals).to.equal(null)
  })

  it('carries the Fordefi approvals through unchanged', async () => {
    const { fetch: fetchImpl } = jsonFetch(() => ({ body: mockBackendFordefiTxView(1, 2) }))
    const reads = new BackendTxReads({ baseUrl: BASE_URL, fetch: fetchImpl })

    const tx = await reads.get(POOL_ID, 'tx-fordefi')

    expect(tx.signerType).to.equal('fordefi')
    expect(tx.unsignedTx).to.equal(null)
    expect(tx.approvals).to.deep.equal({
      collected: 1,
      required: 2,
      approvers: [{ userId: 'user-1', name: 'Ada Lovelace', decidedAt: '2026-09-01T10:05:00.000Z' }],
    })
  })

  it('accepts every status in the backend vocabulary', () => {
    // Derived from the exported list rather than re-typed, so a status added to
    // one and not the other cannot pass.
    for (const status of BACKEND_TX_STATUSES) {
      expect(decodeBackendTxView(mockBackendTxView({ status }), 'test').status).to.equal(status)
    }
  })

  it('refuses an unknown status rather than passing the string through', () => {
    // `status` is what every consumer branches on. Handed on as a string, an
    // unrecognised value lands in a default branch that reads as "nothing to
    // do" — a stalled transaction rendered as an idle one.
    let error: any
    try {
      decodeBackendTxView({ ...mockBackendTxView(), status: 'awaiting_moon_phase' }, 'test')
    } catch (e) {
      error = e
    }
    expect(error).to.be.instanceOf(BackendTxViewError)
    expect(error.message).to.contain('`status` must be one of')
    expect(error.message).to.contain('frozen by the backend contract')
  })

  it('refuses a non-canonical wei value instead of signing a plausible amount', () => {
    // `BigInt('')` is 0n and `BigInt('0x10')` is 16, so an unvalidated field
    // does not fail — it produces a different amount. Same rule and the same
    // helper as the prepare path, which is the point: a value one refuses must
    // not read back as a number in the other.
    for (const value of ['', '0x10', '1e18', ' 1', '-1', '01', 1000, null]) {
      let error: any
      try {
        decodeBackendTxView(
          { ...mockBackendTxView(), unsignedTx: { to: '0x00', data: '0x00', value, chainId: 1 } },
          'u'
        )
      } catch (e) {
        error = e
      }
      expect(error, `value ${JSON.stringify(value)} must be refused`).to.be.instanceOf(BackendTxViewError)
      expect(error.message).to.contain('canonical non-negative decimal wei string')
    }
    // And the canonical forms are accepted.
    for (const value of ['0', '1', '1000000000000000000']) {
      const tx = decodeBackendTxView(
        { ...mockBackendTxView(), unsignedTx: { to: '0x00', data: '0x00', value, chainId: 1 } },
        'u'
      )
      expect(tx.unsignedTx?.value).to.equal(BigInt(value))
    }
  })

  it('names the field and the url when the shape is wrong', () => {
    let error: any
    try {
      decodeBackendTxPage(
        { items: [{ ...mockBackendTxView(), confirmationCode: 42 }], total: 1, nextCursor: null },
        'U'
      )
    } catch (e) {
      error = e
    }
    expect(error).to.be.instanceOf(BackendTxViewError)
    expect(error.message).to.contain('`confirmationCode` must be a string')
    expect(error.url).to.equal('U')
  })

  it('wraps a non-2xx, a non-JSON body and a dead transport in one error type', async () => {
    const refused = new BackendTxReads({
      baseUrl: BASE_URL,
      fetch: (async () =>
        new Response(JSON.stringify({ error: 'not_found', code: 'TX_NOT_FOUND' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })) as unknown as typeof fetch,
    })
    let notFound: any
    try {
      await refused.get(POOL_ID, 'gone')
    } catch (e) {
      notFound = e
    }
    expect(notFound).to.be.instanceOf(BackendTxReadError)
    expect(notFound.status).to.equal(404)
    expect(notFound.code).to.equal('TX_NOT_FOUND')

    const garbage = new BackendTxReads({
      baseUrl: BASE_URL,
      fetch: (async () => new Response('<html>502</html>', { status: 200 })) as unknown as typeof fetch,
    })
    let notJson: any
    try {
      await garbage.get(POOL_ID, 'x')
    } catch (e) {
      notJson = e
    }
    expect(notJson).to.be.instanceOf(BackendTxReadError)
    expect(notJson.message).to.contain('not JSON')

    const dead = new BackendTxReads({
      baseUrl: BASE_URL,
      fetch: (async () => {
        throw new TypeError('fetch failed')
      }) as unknown as typeof fetch,
    })
    let offline: any
    try {
      await dead.get(POOL_ID, 'x')
    } catch (e) {
      offline = e
    }
    // Status 0: there was no HTTP status. A caller must not have to catch raw
    // fetch errors alongside this type to notice a dead backend.
    expect(offline).to.be.instanceOf(BackendTxReadError)
    expect(offline.status).to.equal(0)
    expect(offline.cause).to.be.instanceOf(TypeError)
  })

  it('url-encodes the pool id and tx id it is given', async () => {
    const { fetch: fetchImpl, urls } = jsonFetch(() => ({ body: mockBackendTxView() }))
    const reads = new BackendTxReads({ baseUrl: `${BASE_URL}///`, fetch: fetchImpl })
    await reads.get('1/../2', 'a b')
    expect(urls).to.deep.equal([`${BASE_URL}/pools/1%2F..%2F2/tx/a%20b`])
  })
})
