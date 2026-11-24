import type { BackendFetch } from './transport.js'
import {
  decodeBackendTxPage,
  decodeBackendTxView,
  type BackendTxListOptions,
  type BackendTxPage,
  type BackendTxView,
} from './txView.js'

/**
 * The session-scoped tx reads: `GET pools/:poolId/tx` and
 * `GET pools/:poolId/tx/:txId`.
 *
 * Deliberately NOT catalogue entries. The catalogue (`@centrifuge/queries`) is
 * the chain projection — the same data in public and backend mode, with a
 * graphql fallback per entry. These two are neither: a `pool_transactions` row
 * exists only in this backend's private database, only for the signed-in
 * session's pool, and there is no public counterpart to fall back to. Putting
 * them in the catalogue would create entries whose fallback can never exist,
 * and would offer them to public mode, where they are always a 401.
 *
 * That is also why they live on the subpath rather than on `Pool`: a bare
 * `new Centrifuge({...})` has no session, so it must not carry a method whose
 * only possible answer is "log in first".
 */

/**
 * A backend tx read did not answer with a usable body.
 *
 * Every failure of these two endpoints arrives as this type — a non-2xx, a body
 * that is not JSON, and a transport that never got a response — so a caller
 * handles "the tx read misbehaved" in one `catch` and the message always names
 * the url. `status` and `code` are carried rather than folded into the message
 * because the two a caller acts on differently are both routine: 404
 * `TX_NOT_FOUND` for a transaction that has been reaped, 403 for a session that
 * lost pool membership mid-poll. The triggering error rides along as `cause`.
 *
 * Not folded into `RestQueryError` (`@centrifuge/queries`): that type names a
 * CATALOGUE ENTRY and is the failure of a read that has a graphql fallback.
 * These endpoints have no entry and no fallback, so an `entry` field would have
 * to be invented for it.
 */
export class BackendTxReadError extends Error {
  override name = 'BackendTxReadError'
  /** HTTP status, or `0` when the transport failed before any response. */
  readonly status: number
  /** The backend's `code`, when it sent one (`TX_NOT_FOUND`, `forbidden` reasons). */
  readonly code?: string
  readonly url: string

  constructor(url: string, status: number, detail: string, code?: string, cause?: unknown) {
    super(
      `Backend transaction read failed ${status === 0 ? 'before any response' : `with HTTP ${status}`} ` +
        `(GET ${url})${code ? ` code=${code}` : ''}: ${detail}`,
      cause === undefined ? undefined : { cause }
    )
    this.url = url
    this.status = status
    this.code = code
  }
}

function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

async function readBody(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    try {
      return await res.text()
    } catch {
      return undefined
    }
  }
}

/** The refusal's identity, with the same precedence `BackendPrepare` uses. */
function refusalCode(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') {
    return undefined
  }
  const fields = body as { code?: unknown; issues?: unknown }
  if (typeof fields.code === 'string' && fields.code) {
    return fields.code
  }
  if (Array.isArray(fields.issues)) {
    return 'VALIDATION_FAILED'
  }
  return undefined
}

function summarize(body: unknown): string {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  if (!text) {
    return '<empty body>'
  }
  return text.length > 300 ? `${text.slice(0, 300)}...` : text
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * Build the pool tx list query string.
 *
 * Exported for the test that pins it, because "which page parameter goes on the
 * wire" is the one thing about this surface that a refactor could change
 * without changing any type. `offset` never appears: see
 * {@link BackendTxListOptions} for why paging here is keyset-only.
 */
export function backendTxListQuery(options: BackendTxListOptions = {}): string {
  const params = new URLSearchParams()
  if (options.status !== undefined) {
    params.set('status', options.status)
  }
  if (options.limit !== undefined) {
    params.set('limit', String(options.limit))
  }
  if (options.cursor !== undefined) {
    params.set('cursor', options.cursor)
  }
  const query = params.toString()
  return query ? `?${query}` : ''
}

/**
 * A `fetch`-only client for the two pool tx endpoints.
 *
 * Holds no state beyond the base url and the transport's `fetch`; polling,
 * caching and observable lifetime belong to `Centrifuge._query`, which
 * {@link BackendPool} wires.
 */
export class BackendTxReads {
  readonly #baseUrl: string
  readonly #fetch: BackendFetch

  constructor(options: { baseUrl: string; fetch: BackendFetch }) {
    this.#baseUrl = trimBase(options.baseUrl)
    this.#fetch = options.fetch
  }

  /** `GET pools/:poolId/tx` — one keyset page. */
  async list(poolId: string, options: BackendTxListOptions = {}): Promise<BackendTxPage> {
    const url = `${this.#baseUrl}/pools/${encodeURIComponent(poolId)}/tx${backendTxListQuery(options)}`
    return decodeBackendTxPage(await this.#getJson(url), url)
  }

  /** `GET pools/:poolId/tx/:txId` — one row. */
  async get(poolId: string, txId: string): Promise<BackendTxView> {
    const url = `${this.#baseUrl}/pools/${encodeURIComponent(poolId)}/tx/${encodeURIComponent(txId)}`
    return decodeBackendTxView(await this.#getJson(url), url)
  }

  async #getJson(url: string): Promise<unknown> {
    // A transport that never produced a response is still a failure of THIS
    // read, and a caller must not have to catch raw fetch errors alongside
    // BackendTxReadError to notice it. Status 0: there was no HTTP status.
    let res: Response
    try {
      res = await this.#fetch(url, { method: 'GET', headers: { Accept: 'application/json' } })
    } catch (cause) {
      throw new BackendTxReadError(
        url,
        0,
        `the transport failed before a response arrived (${messageOf(cause)})`,
        undefined,
        cause
      )
    }

    if (!res.ok) {
      const body = await readBody(res)
      throw new BackendTxReadError(url, res.status, summarize(body), refusalCode(body))
    }

    try {
      return await res.json()
    } catch (cause) {
      throw new BackendTxReadError(
        url,
        res.status,
        `the response body is not JSON (${messageOf(cause)})`,
        undefined,
        cause
      )
    }
  }
}
