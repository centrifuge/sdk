import { createGraphqlQueries, type GraphqlTarget } from '@centrifuge/queries/graphql'
import { createRestQueries, type RestRouteTable, type RestTransport } from '@centrifuge/queries/rest'
import { defer, type Observable } from 'rxjs'
import type { Centrifuge } from '../Centrifuge.js'
import type { DataSource, InvalidationSource, QueryName, QueryResult } from './DataSource.js'

export interface RestDataSourceOptions {
  /**
   * Absolute base URL of the backend API — the prefix the feature routes hang
   * off, e.g. `https://app.example.com/api`.
   */
  baseUrl: string
  /** Injected transport: a `fetch` that already carries the session. */
  transport: RestTransport
  /**
   * Per-entry route table. Defaults to the table the SDK ships
   * (`@centrifuge/queries/rest`'s `REST_ROUTES`), which is what "apps do not
   * manage the table" means. Overridable so a vertical can stage a route and
   * so the fallback mechanism is testable.
   */
  routes?: RestRouteTable
  /**
   * Which GraphQL schema the fallback path talks to. Same default as public
   * mode (`'public-api'`).
   */
  graphqlTarget?: GraphqlTarget
  /**
   * The push seam, when the app configured one.
   *
   * Omitted is the default and means pure polling: the source then declares no
   * `invalidations$` AT ALL, so `_queryData` takes exactly the no-push-seam
   * code path. That is what makes "the stream is off" and "this adapter has no push
   * seam" the same thing to every caller, rather than a silent stream nobody
   * can tell from a working one.
   */
  invalidations?: InvalidationSource
}

/**
 * The backend-mode `DataSource`: catalogue entries served by the backend's
 * feature REST endpoints, with per-entry fallback to GraphQL.
 *
 * An entry with no REST route is answered by the graphql adapter — the same
 * adapter, same documents, same results public mode uses. That is what makes
 * backend mode usable whatever the route table covers, and lets a route be
 * added one entry at a time without app changes. An entry that HAS a route
 * never falls back: a failing route is a broken route and fails loud.
 *
 * Polling and caching stay in `Centrifuge._queryData`, so this source
 * implements `query` plus — only when the app configured a push transport —
 * the `invalidations$` seam over the backend's SSE stream.
 */
export class RestDataSource implements DataSource {
  #query: ReturnType<typeof createRestQueries>

  /** The base URL every REST read is issued against. */
  readonly baseUrl: string
  /** Which GraphQL schema unrouted entries fall back to. */
  readonly graphqlTarget: GraphqlTarget
  /**
   * The push seam, present ONLY when a push transport was supplied.
   *
   * Assigned in the constructor rather than declared as a method, and that is
   * the load-bearing detail: a method would make `'invalidations$' in source`
   * true for every rest source, including one with no stream behind it, and
   * `_queryData` branches on exactly that. With no stream, this source is
   * indistinguishable from one with no push seam.
   */
  readonly invalidations$?: (name: QueryName, vars?: Record<string, any>) => Observable<void>
  /** The push seam's connectivity. Present under the same condition. */
  readonly pushConnected$?: () => Observable<boolean>

  constructor(root: Centrifuge, options: RestDataSourceOptions) {
    this.baseUrl = options.baseUrl
    this.graphqlTarget = options.graphqlTarget ?? 'public-api'
    const push = options.invalidations
    if (push) {
      this.invalidations$ = (name, vars) => push.invalidations$(name, vars)
      this.pushConnected$ = () => push.connected$
    }
    const fallback = createGraphqlQueries({
      target: this.graphqlTarget,
      execute: (document, variables) => root._executeGraphql(document, variables),
    })
    this.#query = createRestQueries({
      baseUrl: options.baseUrl,
      transport: options.transport,
      routes: options.routes,
      fallback,
    })
  }

  query(name: QueryName, vars?: Record<string, any>): Observable<QueryResult> {
    return defer(() => this.#query(name, vars ?? {}))
  }
}
