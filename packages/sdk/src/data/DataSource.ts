import type { QueryParamsInput, SdkQueryCatalogue, SdkQueryName } from '@centrifuge/queries/core'
import { createGraphqlQueries, type GraphqlTarget } from '@centrifuge/queries/graphql'
import { defer, type Observable } from 'rxjs'
import type { Centrifuge } from '../Centrifuge.js'

/**
 * The name of a query catalogue entry.
 *
 * The closed union of `@centrifuge/queries` entry names —
 * the SDK holds no GraphQL documents of its own, and an unknown entry name is
 * a compile error rather than a malformed document at runtime.
 */
export type QueryName = SdkQueryName

/** The (pre-validation) variables of a catalogue entry. */
export type QueryVars<N extends QueryName = QueryName> = QueryParamsInput<SdkQueryCatalogue[N]>

/**
 * The result of a query catalogue entry.
 *
 * Kept loose at the seam so `_queryData` stays a single generic method; the
 * per-entry result type lives on the catalogue entry itself.
 */
export type QueryResult = any

/**
 * The read seam of the SDK. All indexer/backend reads go through a `DataSource`.
 *
 * Implementations only fetch: caching, polling, and re-subscription are layered
 * on by `Centrifuge._queryData`. The graphql adapter ({@link GraphqlDataSource})
 * implements only `query`; a backend rest adapter later adds `invalidations$`
 * backed by server-sent events.
 */
export interface DataSource {
  /**
   * Fetch the result for a catalogue entry. Emits the result once per
   * subscription (one fetch); it is re-subscribed by the polling/invalidation
   * machinery in `Centrifuge._queryData`.
   */
  query(name: QueryName, vars?: Record<string, any>): Observable<QueryResult>
  /**
   * Optional push seam. Emits when the result for `(name, vars)` is known stale.
   *
   * Its PRESENCE is what `_queryData` branches on, so a source must declare it
   * only when something actually pushes — a declared-but-silent seam would move
   * every read onto the push path's longer poll interval to wait on nothing.
   */
  invalidations$?(name: QueryName, vars?: Record<string, any>): Observable<void>
  /**
   * Optional. Whether the push seam is currently connected, current value
   * first.
   *
   * Only read when {@link invalidations$} exists, and only to pick a poll
   * interval: an invalidation stream is at-most-once and best-effort, so the
   * timer never stops — it becomes a long backstop while the stream is up and
   * returns to the normal interval when it is down. A source with a push seam
   * and no connectivity signal is treated as permanently disconnected, which
   * is the safe default (it polls at the normal interval and still refetches on
   * every invalidation).
   */
  pushConnected$?(): Observable<boolean>
}

/**
 * What a `DataSource` needs from a push transport in order to offer
 * {@link DataSource.invalidations$}.
 *
 * Deliberately transport-free: no stream vocabulary, no URL, no session. The
 * implementation lives in `@centrifuge/sdk/backend`, which is the only place
 * that knows a stream exists at all (the transport contract, enforced by
 * `scripts/assert-transport-purity.mjs`).
 */
export interface InvalidationSource {
  /** Emits when the result for `(name, vars)` is known stale. */
  invalidations$(name: QueryName, vars?: Record<string, any>): Observable<void>
  /** The push transport's connectivity, current value first. */
  readonly connected$: Observable<boolean>
}

/**
 * The public-mode `DataSource`: the named query catalogue executed over
 * GraphQL.
 *
 * `target` selects which schema the documents are built for. `'public-api'`
 * is the default and the v3.3 Phase 1 target; it refuses, with a typed
 * `UnsupportedQueryError`, any entry PostGraphile cannot yet express.
 * `'api-v3'` replays the legacy Ponder documents and is the interim escape
 * hatch for those entries — see `@centrifuge/queries` `capabilities.ts` for
 * the per-entry table.
 *
 * Polling stays in `Centrifuge._queryData`, so this adapter has no
 * `invalidations$`.
 */
export class GraphqlDataSource implements DataSource {
  #query: ReturnType<typeof createGraphqlQueries>

  /** Which GraphQL schema this source's documents are built for. */
  readonly target: GraphqlTarget

  constructor(root: Centrifuge, target: GraphqlTarget = 'public-api') {
    this.target = target
    this.#query = createGraphqlQueries({
      target,
      execute: (document, variables) => root._executeGraphql(document, variables),
    })
  }

  query(name: QueryName, vars?: Record<string, any>): Observable<QueryResult> {
    return defer(() => this.#query(name, vars ?? {}))
  }
}
