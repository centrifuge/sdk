/**
 * A hand-built stand-in for the object an app's `transport.eventSource` returns.
 *
 * Built from the shape the REAL caller produces, which for a stream means the
 * state machine and not just the methods:
 *
 * - `readyState` is 0 (CONNECTING) on creation, 1 (OPEN) after the `open`
 *   event, 2 (CLOSED) after `close()`. `BackendInvalidationStream` reads it to
 *   tell a stream that will retry BY ITSELF from one that will never come back,
 *   and a fake that left it at 0 forever would make the reconnect path
 *   untestable while looking fine.
 * - `error` and `open` are events, not callbacks, and a failure can be followed
 *   by a close — which is the double-reconnect shape this fake
 *   exists to reproduce ({@link failAndClose}).
 * - Invalidations arrive as a named `invalidation` event whose `data` is a JSON
 *   STRING, because that is what SSE carries. Handing the object over directly
 *   would skip the parse, which is where a malformed frame is caught.
 *
 * The SDK never constructs one of these in production — `packages/sdk` cannot
 * open a stream at all, and CI asserts it
 * (`scripts/assert-transport-purity.mjs`). The app's transport does, and this is
 * what it hands back.
 */
export class FakeStream {
  readonly url: string
  readyState = 0
  closeCount = 0

  /**
   * Whether `close()` dispatches an `error`, which is the exact shape pg
   * produced twice in the backend's listeners (`error` and `end` on one drop,
   * then the error handler's own `end()` call triggering a second signal).
   */
  errorOnClose = false

  readonly #listeners = new Map<string, Set<(event: any) => void>>()

  constructor(url: string) {
    this.url = url
  }

  addEventListener(type: string, listener: (event: any) => void): void {
    let listeners = this.#listeners.get(type)
    if (!listeners) {
      listeners = new Set()
      this.#listeners.set(type, listeners)
    }
    listeners.add(listener)
  }

  removeEventListener(type: string, listener: (event: any) => void): void {
    this.#listeners.get(type)?.delete(listener)
  }

  close(): void {
    this.closeCount++
    this.readyState = 2
    if (this.errorOnClose) {
      this.#dispatch('error', {})
    }
  }

  /** Live listeners of one type — proof that teardown actually detached. */
  listenerCount(type: string): number {
    return this.#listeners.get(type)?.size ?? 0
  }

  /** The stream connected. */
  open(): void {
    this.readyState = 1
    this.#dispatch('open', {})
  }

  /**
   * The stream failed and will retry on its own (`CONNECTING`) — a transient
   * network blip, where the platform owns the retry and opening a second stream
   * would be the double connection.
   */
  failTransiently(): void {
    this.readyState = 0
    this.#dispatch('error', {})
  }

  /** The stream failed terminally: closed, and ours to reopen. */
  failTerminally(): void {
    this.readyState = 2
    this.#dispatch('error', {})
  }

  /**
   * The double-signal shape: an `error` whose own handling closes the stream, and
   * the close dispatches a SECOND signal.
   */
  failAndClose(): void {
    this.errorOnClose = true
    this.failTerminally()
  }

  /** One `invalidation` frame, as a JSON string. */
  send(payload: unknown): void {
    this.#dispatch('invalidation', { data: JSON.stringify(payload) })
  }

  /** A frame whose data is not JSON at all. */
  sendRaw(data: string): void {
    this.#dispatch('invalidation', { data })
  }

  #dispatch(type: string, event: any): void {
    // A snapshot, like DOM dispatch: a listener removed during this dispatch
    // still receives THIS event, and one added during it does not.
    for (const listener of [...(this.#listeners.get(type) ?? [])]) {
      listener(event)
    }
  }
}

/** A `transport.eventSource` that hands back {@link FakeStream}s. */
export function fakeEventSourceFactory(): {
  eventSource: (url: string) => EventSource
  streams: FakeStream[]
} {
  const streams: FakeStream[] = []
  return {
    eventSource: (url: string) => {
      const stream = new FakeStream(url)
      streams.push(stream)
      return stream as unknown as EventSource
    },
    streams,
  }
}
