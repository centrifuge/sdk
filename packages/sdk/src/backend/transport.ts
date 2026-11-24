/**
 * The injected transport — the whole of what `@centrifuge/sdk/backend` knows
 * about the app's session.
 *
 * ## The contract
 *
 * The SDK is handed two functions and nothing else: a `fetch` and an
 * `eventSource`. It never reads or writes a cookie, never fetches or attaches a
 * CSRF token, and has no retry policy of its own. Everything session-shaped is
 * ALREADY DONE by the time a request reaches these functions, which is why the
 * whole backend surface can be constructed, unit-tested and reasoned about with
 * no session machinery anywhere in the package.
 *
 * The app therefore keeps, and must keep, all four of these (see
 * `docs/security.md`):
 *
 * 1. **Credentials on every request.** The session is the httpOnly
 *    `access_token` cookie, `sameSite: 'strict'`. In a browser that means the
 *    request has to opt in to sending it; `fetch` does not by default.
 * 2. **The double-submit CSRF header on mutating requests.** `GET
 *    /auth/csrf-token` returns a token and sets a readable companion cookie;
 *    the token goes back on `POST`/`PUT`/`PATCH`/`DELETE` as `X-CSRF-Token`.
 *    Safe methods are exempt server-side and need none.
 * 3. **Exactly one retry when that header is stale.** A stale token yields one
 *    403; the documented recovery is to refetch the token and replay the
 *    request once. Once, not "until it works" — a second failure is a real
 *    refusal and must reach the caller.
 * 4. **A credentialed `EventSource`.** SSE is opened with credentials so the
 *    same cookie authorises the stream (the invalidation stream consumes it;
 *    the contract is fixed here so the app implements the transport once).
 *
 * ## Why it is the app's job and not ours
 *
 * Not layering, but blast radius. A cookie name, a header name, a token
 * endpoint and a retry budget are properties of one deployment's auth
 * mechanics; a published SDK that encoded them would make every one of them a
 * breaking change to a package external integrators also depend on, and would
 * put a second, possibly disagreeing, opinion on the session next to the app's
 * own. Passing `fetch` in costs the app four lines and costs the SDK nothing.
 *
 * A consequence worth stating because it is the useful one: `packages/sdk` has
 * no runtime code that mentions cookies, CSRF or `EventSource` construction at
 * all, and CI asserts that at grep level
 * (`packages/sdk/scripts/assert-transport-purity.mjs`). Nothing here is a
 * convention that could quietly erode.
 *
 * ## Reference implementation
 *
 * `docs/api/sdk-backend-transport.md` carries a complete, copy-pasteable
 * implementation satisfying all four points, with the exact response shapes it
 * branches on. It is documentation on purpose: it is not exported from this
 * package and no app is required to use it, because an app with its own
 * interceptor stack should wrap that instead of adopting ours.
 */

/**
 * The read/write half: a `fetch` that already carries the session.
 *
 * Typed as `typeof fetch` deliberately — the standard signature, so a
 * conforming implementation is a wrapper around the platform function and not
 * an SDK-specific interface the app has to adapt to.
 */
export type BackendFetch = typeof fetch

/**
 * The push half: opens a server-sent-events stream that already carries the
 * session.
 *
 * The signature mirrors the platform `EventSource` constructor so that an
 * implementation is a one-liner — but `window.EventSource` itself is NOT a
 * valid value here, because it sends no credentials unless told to. That
 * asymmetry is the point: the app has to write the wrapper, and writing it is
 * where `withCredentials` gets set.
 *
 * `init` exists to mirror the constructor, not because this package populates
 * it: the SDK calls `eventSource(url)` with one argument. An implementation
 * must therefore not depend on receiving anything, and must force credentials
 * on rather than reading them out of `init`.
 */
export type BackendEventSourceFactory = (url: string, init?: EventSourceInit) => EventSource

/**
 * Everything `createBackendCentrifuge` needs in order to talk to a Centrifuge
 * backend as the signed-in user.
 *
 * See the module documentation for the contract each member carries, and
 * `docs/api/sdk-backend-transport.md` for a reference implementation.
 */
export interface BackendTransport {
  /** A `fetch` that sends the session and handles CSRF and its one retry. */
  fetch: BackendFetch
  /** Opens an SSE stream that sends the session. */
  eventSource: BackendEventSourceFactory
}

/**
 * A transport is REQUIRED, and this is the refusal when one is missing at
 * runtime — from plain JS, or from a `config` object assembled dynamically,
 * where the type system is not in the room.
 *
 * Loud rather than defaulted. The tempting default is `globalThis.fetch`, and
 * it is the worst possible one: every read and write would succeed in
 * development against a same-origin dev server that happens to forward the
 * cookie, and then fail as 401s in the first deployment that is cross-origin.
 * Section 5b — a plausible wrong value beats no value only until it ships.
 */
export class BackendTransportRequiredError extends Error {
  override name = 'BackendTransportRequiredError'

  constructor(detail: string) {
    super(
      `createBackendCentrifuge needs a transport: ${detail}. The backend surface is session-scoped and the ` +
        `session lives in the app — pass { fetch, eventSource } where \`fetch\` sends the session, presents ` +
        `the double-submit token header on mutating requests and replays once on a stale-token 403, and ` +
        `\`eventSource\` opens the stream so the session travels with it. There is deliberately no default: ` +
        `falling back to the global fetch would work against a same-origin dev server and then fail as 401s ` +
        `once deployed. docs/api/sdk-backend-transport.md carries a reference implementation with the exact ` +
        `header, endpoint and response shapes.`
      // Naming the header here would be more helpful by one word and would also
      // be the one place `packages/sdk` knew it, which the CI gate refuses on
      // purpose (scripts/assert-transport-purity.mjs). The doc owns the names.
    )
  }
}

/**
 * Check a transport at the boundary, so a missing or half-built one is named
 * here rather than surfacing as `undefined is not a function` from inside a
 * query three layers down.
 *
 * @throws {BackendTransportRequiredError} When either member is absent or not
 *   callable.
 */
export function assertBackendTransport(transport: BackendTransport | undefined): BackendTransport {
  if (!transport) {
    throw new BackendTransportRequiredError('none was passed')
  }
  if (typeof transport.fetch !== 'function') {
    throw new BackendTransportRequiredError('`transport.fetch` is not a function')
  }
  if (typeof transport.eventSource !== 'function') {
    throw new BackendTransportRequiredError('`transport.eventSource` is not a function')
  }
  return transport
}
