import { createInvalidationHub, type InvalidationHub, type InvalidationTableMap } from '@centrifuge/queries/rest'
import { BehaviorSubject, Observable } from 'rxjs'
import type { QueryName } from '../data/DataSource.js'
import type { BackendEventSourceFactory } from './transport.js'

/**
 * How long to wait before the first reconnect, and the ceiling the delay
 * doubles up to. Same 1s -> 60s as the backend's own listener
 * (`chain-invalidation-listener.service.ts`), because both ends of this seam
 * reconnecting on the same curve is one fewer thing to reason about during an
 * outage.
 */
export const INVALIDATION_RECONNECT_BASE_MS = 1_000
export const INVALIDATION_RECONNECT_MAX_MS = 60_000

/** The SSE event type the backend publishes invalidations under. */
const INVALIDATION_EVENT = 'invalidation'

/** Path of the backend's stream endpoint, relative to the API base URL. */
const STREAM_PATH = 'events/stream'

/**
 * Counters for one stream, for diagnostics and for tests that need to see a
 * DROP rather than infer it from an absence.
 *
 * A push seam that quietly stops pushing looks exactly like a chain with
 * nothing happening on it — the same reason the backend listener logs every
 * rejection path under a greppable prefix. `packages/sdk` has no logger and is
 * not the place to introduce one, so it counts instead.
 */
export interface InvalidationStreamDiagnostics {
  /** `EventSource` instances opened. Must stay at 1 per connection attempt. */
  opened: number
  /** Frames that arrived on the stream. */
  received: number
  /** Frames dropped: bad version, bad shape, or an unmapped table. */
  ignored: number
  /** Why the last drop happened. */
  lastIgnoredReason?: string
  /** Distinct subscriptions notified, summed over all frames. */
  notified: number
}

export interface InvalidationStreamOptions {
  /** Absolute base URL of the backend API — the stream path hangs off it. */
  baseUrl: string
  /** The injected SSE factory. The SDK never constructs a stream itself. */
  eventSource: BackendEventSourceFactory
  /**
   * Pools to subscribe to. The endpoint is pool-scoped and a connection with
   * no pool subscription receives no invalidations at all (not even broadcast
   * ones), so this is REQUIRED to be non-empty by the caller — an empty list
   * means "no stream", and that decision is made in `BackendCentrifuge`.
   */
  poolIds: readonly string[]
  /** Table-to-entry mapping. Defaults to the shipped one. */
  tables?: InvalidationTableMap
  /** First reconnect delay. @default {@link INVALIDATION_RECONNECT_BASE_MS} */
  reconnectBaseMs?: number
  /** Reconnect delay ceiling. @default {@link INVALIDATION_RECONNECT_MAX_MS} */
  reconnectMaxMs?: number
  /**
   * How a delayed reconnect is scheduled. Defaults to `setTimeout`.
   *
   * Injectable so the unit suite can assert the backoff SEQUENCE exactly, by
   * running the pending reconnect on demand instead of sleeping through 1s,
   * 2s, 4s. A test that has to wait for real time either takes a minute or
   * asserts something weaker than the property.
   */
  schedule?: (callback: () => void, delayMs: number) => () => void
}

/**
 * The one SSE stream a backend-mode `Centrifuge` holds, and the `invalidations$`
 * seam over it.
 *
 * ## One stream, however many subscribers
 *
 * Every catalogue subscription that wants push updates registers with the same
 * hub and the same connection. Not an optimisation: the endpoint is
 * membership-resolved per connection and re-resolved periodically server-side,
 * so a stream per subscription would multiply that work by the number of
 * widgets on a screen, and the connection count against one BFF instance is
 * already the thing spec risk R6 asks ops to review.
 *
 * Opened LAZILY, on the first subscription, so constructing a client opens no
 * socket. Never closed on the last unsubscribe: subscriptions come and go with
 * every mount and cache expiry, and a stream that flapped with them would spend
 * its life reconnecting — each reconnect costing a membership resolve and, by
 * at-most-once delivery, a hole in the stream. {@link close} is the deliberate
 * teardown.
 *
 * ## Nothing here is load-bearing for correctness
 *
 * The frames are hints. A dropped frame, an unmapped table, a stream that never
 * connects at all: each costs latency and nothing else, because
 * `Centrifuge._queryData` keeps a poll timer running in every state (a long
 * interval while this stream is connected, the normal one when it is not). That
 * is what licenses dropping anything unreadable instead of throwing.
 */
export class BackendInvalidationStream {
  readonly #eventSource: BackendEventSourceFactory
  readonly #url: string
  readonly #hub: InvalidationHub
  readonly #reconnectBaseMs: number
  readonly #reconnectMaxMs: number
  readonly #schedule: (callback: () => void, delayMs: number) => () => void
  readonly #connected = new BehaviorSubject(false)
  readonly #diagnostics: InvalidationStreamDiagnostics = { opened: 0, received: 0, ignored: 0, notified: 0 }

  #source: EventSource | undefined
  #detach: (() => void) | undefined
  #cancelReconnect: (() => void) | undefined
  #backoffMs = 0
  #closed = false

  constructor(options: InvalidationStreamOptions) {
    if (options.poolIds.length === 0) {
      // The endpoint scopes every invalidation to a pool, and a connection
      // with no pool subscription receives none of them. A stream opened
      // without pool ids would connect, stay open, deliver nothing but
      // heartbeats, and report itself as CONNECTED — which would then move
      // every read onto the long poll interval. That is the plausible-wrong-
      // value shape; the caller must decide not to have a stream instead.
      throw new Error(
        'BackendInvalidationStream needs at least one pool id: the backend scopes every invalidation to a ' +
          'pool, so a stream with no pool subscription delivers nothing while reporting itself connected. ' +
          'Omit `streamPoolIds` to run on polling alone.'
      )
    }
    this.#eventSource = options.eventSource
    this.#url = streamUrl(options.baseUrl, options.poolIds)
    this.#hub = createInvalidationHub(options.tables)
    this.#reconnectBaseMs = options.reconnectBaseMs ?? INVALIDATION_RECONNECT_BASE_MS
    this.#reconnectMaxMs = options.reconnectMaxMs ?? INVALIDATION_RECONNECT_MAX_MS
    this.#schedule =
      options.schedule ??
      ((callback, delayMs) => {
        const handle = setTimeout(callback, delayMs)
        return () => clearTimeout(handle)
      })
  }

  /** The URL the stream is (or would be) opened on. */
  get url(): string {
    return this.#url
  }

  /** Whether the stream is currently connected. */
  get connected(): boolean {
    return this.#connected.value
  }

  /**
   * The stream's connectivity, current value first.
   *
   * Read by `Centrifuge._queryData` to pick a poll interval: a connected stream
   * makes the timer a backstop, a disconnected one makes it the only mechanism.
   * Subscribing to this does NOT open the stream — otherwise every read of an
   * entry with no push coverage would.
   */
  get connected$(): Observable<boolean> {
    return this.#connected.asObservable()
  }

  /** See {@link InvalidationStreamDiagnostics}. */
  get diagnostics(): Readonly<InvalidationStreamDiagnostics> {
    return this.#diagnostics
  }

  /** Live subscription count across all catalogue entries. */
  get subscriberCount(): number {
    return this.#hub.size
  }

  /**
   * Emit whenever `(name, vars)` is known stale.
   *
   * The `DataSource.invalidations$` seam. The first subscription opens the
   * shared stream; the rest join it.
   */
  invalidations$(name: QueryName, vars?: Record<string, any>): Observable<void> {
    return new Observable<void>((subscriber) => {
      const unsubscribe = this.#hub.subscribe(name, vars, () => subscriber.next())
      this.#open()
      return unsubscribe
    })
  }

  /**
   * Close the stream and stop reconnecting. Idempotent.
   *
   * Existing `invalidations$` subscriptions stay subscribed and simply stop
   * receiving — they are hints, and their poll timer is unaffected.
   */
  close(): void {
    this.#closed = true
    this.#cancelReconnect?.()
    this.#cancelReconnect = undefined
    this.#teardown()
    this.#connected.next(false)
  }

  /** Open the shared stream, unless one is open, connecting, or scheduled. */
  #open(): void {
    if (this.#closed || this.#source || this.#cancelReconnect) {
      return
    }

    // The whole open is guarded, not just the factory call. A transport that
    // cannot open a stream — or hands back something that is not one — is a
    // transport problem and must not surface as a READ failure: the reads go
    // over `fetch` and keep polling regardless. This is the one path where a
    // subscription could otherwise throw synchronously into a caller who only
    // asked for a query.
    try {
      const source = this.#eventSource(this.#url)
      this.#diagnostics.opened++
      this.#source = source
      this.#attach(source)
    } catch (cause) {
      this.#teardown()
      this.#scheduleReconnect(`the stream could not be opened (${cause instanceof Error ? cause.message : cause})`)
    }
  }

  /** Wire the three handlers, and remember how to unwire them. */
  #attach(source: EventSource): void {
    // ONE reconnect per connection, whatever the stream reports.
    //
    // The failure mode this prevents: a dropped connection can signal twice
    // (pg emits both `error` and `end`), and
    // handling both meant two clients, two subscriptions and every
    // notification delivered twice. A stream has the same shape available to
    // it — an `error` followed by the close it causes, or two `error` events
    // from one failure — and the consequence here is worse than duplication:
    // a second `EventSource` is a second server-side connection and a second
    // membership resolve, per blip, compounding.
    //
    // Two mechanisms, because either alone can be defeated. The latch collapses
    // repeat signals from THIS connection, and detaching the listeners before
    // `close()` means our own close cannot re-enter the handler that called it.
    let failureHandled = false
    const onFailure = (reason: string): void => {
      if (failureHandled) {
        return
      }
      failureHandled = true
      this.#connected.next(false)
      this.#teardown()
      if (!this.#closed) {
        this.#scheduleReconnect(reason)
      }
    }

    const onOpen = (): void => {
      this.#backoffMs = 0
      this.#connected.next(true)
    }

    const onError = (): void => {
      // A stream may report an error and keep trying on its own — that is what
      // `CONNECTING` means, and the platform's retry uses its own delay plus
      // the server's `retry:` hint. Opening a second stream in that state is
      // exactly the double-connection this guards against, so the only thing
      // to do is stop claiming to be connected and let the poll interval fall
      // back. A CLOSED stream, by contrast, will never come back by itself and
      // is ours to reopen.
      if (source.readyState === /* CLOSED */ 2) {
        onFailure('the stream closed')
        return
      }
      this.#connected.next(false)
    }

    const onMessage = (event: MessageEvent): void => {
      this.#handleFrame(event.data)
    }

    source.addEventListener('open', onOpen)
    source.addEventListener('error', onError)
    source.addEventListener(INVALIDATION_EVENT, onMessage as EventListener)
    this.#detach = () => {
      source.removeEventListener('open', onOpen)
      source.removeEventListener('error', onError)
      source.removeEventListener(INVALIDATION_EVENT, onMessage as EventListener)
    }
  }

  /**
   * Parse and fan out one frame. Never throws: this runs in a stream event
   * handler, where an exception is an unhandled error with no caller to see it.
   */
  #handleFrame(data: unknown): void {
    this.#diagnostics.received++
    let raw: unknown
    try {
      raw = typeof data === 'string' ? JSON.parse(data) : data
    } catch (cause) {
      this.#diagnostics.ignored++
      this.#diagnostics.lastIgnoredReason = `frame is not JSON (${cause instanceof Error ? cause.message : cause})`
      return
    }

    const result = this.#hub.dispatch(raw)
    if (result.ignored) {
      this.#diagnostics.ignored++
      this.#diagnostics.lastIgnoredReason = result.ignored
      return
    }
    this.#diagnostics.notified += result.notified
  }

  #teardown(): void {
    this.#detach?.()
    this.#detach = undefined
    const source = this.#source
    this.#source = undefined
    try {
      source?.close()
    } catch {
      // Nothing to do about a stream that will not close; the reference is
      // already dropped and a throw here would replace a reconnect with a
      // dead client.
    }
  }

  #scheduleReconnect(reason?: string): void {
    if (this.#closed || this.#cancelReconnect) {
      return
    }
    this.#backoffMs =
      this.#backoffMs === 0 ? this.#reconnectBaseMs : Math.min(this.#backoffMs * 2, this.#reconnectMaxMs)
    if (reason) {
      this.#diagnostics.lastIgnoredReason = `${reason}; reconnecting in ${this.#backoffMs}ms`
    }
    this.#cancelReconnect = this.#schedule(() => {
      this.#cancelReconnect = undefined
      this.#open()
    }, this.#backoffMs)
  }
}

/**
 * `<baseUrl>/events/stream?poolId=…`, one repeated param per pool.
 *
 * Repeated rather than comma-joined: the controller accepts both, and repeated
 * params need no escaping decision about a pool id that contained a comma.
 */
function streamUrl(baseUrl: string, poolIds: readonly string[]): string {
  const params = new URLSearchParams()
  for (const poolId of poolIds) {
    params.append('poolId', poolId)
  }
  return `${baseUrl.replace(/\/+$/, '')}/${STREAM_PATH}?${params.toString()}`
}
