import { defer, map, type Observable } from 'rxjs'
import type { InvalidationTableMap, RestRouteTable } from '@centrifuge/queries/rest'
import { Centrifuge } from '../Centrifuge.js'
import type { DataSource, QueryName, QueryResult } from '../data/DataSource.js'
import { RestDataSource } from '../data/RestDataSource.js'
import { BackendPrepareStrategy } from '../tx/BackendPrepare.js'
import type { Query } from '../types/query.js'
import type { UserProvidedConfig } from '../types/index.js'
import type { PoolId } from '../utils/types.js'
import { BackendPool, DEFAULT_BACKEND_TX_POLL_INTERVAL } from './BackendPool.js'
import { BackendTxReads } from './BackendTxReads.js'
import { BackendInvalidationStream } from './invalidationStream.js'
import { assertBackendTransport, type BackendEventSourceFactory, type BackendTransport } from './transport.js'

/**
 * Configuration for {@link createBackendCentrifuge}: everything a public-mode
 * `Centrifuge` takes, plus where the backend is.
 *
 * `dataSource` and `txStrategy` are omitted rather than merely ignored. They
 * are the two seams this factory exists to fill, and a caller who passed one
 * would be silently overruled — which is exactly the "plausible wrong value"
 * shape. Anyone who wants to supply a seam by hand wants
 * `new Centrifuge({ dataSource, txStrategy })` and not this factory.
 */
export interface BackendCentrifugeConfig extends Omit<UserProvidedConfig, 'dataSource' | 'txStrategy'> {
  /**
   * Absolute base URL of the backend API — the prefix the pool and feature
   * routes hang off, e.g. `https://app.example.com/api`. A trailing slash is
   * optional.
   */
  baseUrl: string
  /**
   * Ask the backend for the wallet route even when the caller is Fordefi
   * eligible. Forwarded to `BackendPrepareStrategy`; the backend honours it
   * only for Fordefi-eligible users and audits its use.
   */
  useWalletConnect?: boolean
  /**
   * Per-entry REST route table. Defaults to the table the SDK ships
   * (`@centrifuge/queries`'s `REST_ROUTES`) — apps do not manage it.
   * Overridable so a vertical can stage a route before its endpoint ships.
   */
  restRoutes?: RestRouteTable
  /**
   * How often `pool.transactions()` and `pool.transaction(txId)` re-fetch while
   * subscribed, in milliseconds.
   *
   * @default 10_000 — see {@link DEFAULT_BACKEND_TX_POLL_INTERVAL}.
   */
  txPollingInterval?: number
  /**
   * Pools to receive invalidation pushes for. One shared stream is
   * opened for all of them, on the first catalogue read that can be pushed to.
   *
   * **Omitted or empty means no stream, and that is the default.** Reads then
   * behave as they do with no push seam at all: the poll timer is the only
   * mechanism and the data source declares no push seam at all. Nothing degrades
   * silently — a missing emitter, a backend with
   * `CHAIN_INVALIDATION_SOURCE=off`, or an app that simply has not opted in all
   * land on the same well-tested path.
   *
   * The app supplies the ids because the backend's stream endpoint is
   * pool-scoped and membership-resolved per connection: it is the app that knows
   * which pools the signed-in user is looking at, and a client cannot
   * self-discover a subscription the server would authorise.
   */
  streamPoolIds?: readonly string[]
  /**
   * Table-to-catalogue-entry mapping for the push seam. Defaults to the one the
   * SDK ships (`@centrifuge/queries/rest`'s `INVALIDATION_TABLES`) — apps do not
   * manage it, for the same reason they do not manage the route table.
   */
  invalidationTables?: InvalidationTableMap
}

/**
 * A `DataSource` that forwards to one constructed after the `Centrifuge` it
 * belongs to.
 *
 * There is a genuine construction cycle to break: `RestDataSource` needs the
 * root (it wires the per-entry graphql fallback through `root._executeGraphql`,
 * which is what keeps an unflipped catalogue entry working), while `Centrifuge`
 * takes its `dataSource` as constructor config. One of the two has to be
 * resolved late.
 *
 * It is resolved HERE, inside the one caller that has the cycle, rather than by
 * widening `Config.dataSource` to accept a factory function on the root's
 * public surface. The root's seam stays one plain object.
 *
 * `invalidations$` is NOT declared as a method, and that is load-bearing.
 * `_queryData` branches on the field's PRESENCE to decide whether
 * to merge a push stream into its poll timer and to stretch that timer, so a
 * forwarder that declared it unconditionally would move every catalogue read
 * onto the push path — waiting on a stream that, for an app which configured
 * none, never emits.
 *
 * So the property is conditional: {@link bind} installs the
 * forwarders as OWN PROPERTIES only when the delegate has them, which it does
 * only when the app configured a stream. So `'invalidations$' in dataSource`
 * still answers exactly "is anything pushing to this instance".
 */
class LateBoundDataSource implements DataSource {
  #delegate: DataSource | undefined

  /** Present only when the bound delegate pushes. See the class note. */
  invalidations$?: (name: QueryName, vars?: Record<string, any>) => Observable<void>
  /** Present under the same condition as {@link invalidations$}. */
  pushConnected$?: () => Observable<boolean>

  bind(delegate: DataSource): void {
    this.#delegate = delegate
    // Read once and captured, so the forwarder cannot be left pointing at a
    // method that a later `bind` removed.
    const invalidations$ = delegate.invalidations$?.bind(delegate)
    const pushConnected$ = delegate.pushConnected$?.bind(delegate)
    if (invalidations$) {
      this.invalidations$ = invalidations$
    } else {
      delete this.invalidations$
    }
    if (pushConnected$) {
      this.pushConnected$ = pushConnected$
    } else {
      delete this.pushConnected$
    }
  }

  query(name: QueryName, vars?: Record<string, any>): Observable<QueryResult> {
    return defer(() => {
      if (!this.#delegate) {
        // Unreachable through `createBackendCentrifuge`, which binds
        // synchronously in the constructor. Loud anyway: a refactor that moved
        // the bind after a first read would otherwise surface as an
        // undefined-property TypeError from inside an rxjs pipe.
        throw new Error(
          'The backend data source was queried before it was bound. This is an internal invariant of ' +
            'createBackendCentrifuge; please report it.'
        )
      }
      return this.#delegate.query(name, vars)
    })
  }
}

/**
 * A `Centrifuge` wired to a Centrifuge backend over an injected transport.
 *
 * Both seams are filled: catalogue reads go through the rest `DataSource`
 * (per-entry, falling back to graphql for entries with no REST route) and
 * writes through `BackendPrepareStrategy`. Everything else — entities, protocol
 * context resolution, the transaction observable's emission contract — is the
 * root SDK's, unchanged, which is the property that lets an app change modes
 * without touching a call site.
 *
 * The one addition is {@link pool}, which returns a {@link BackendPool}: a
 * `Pool` plus the session-scoped tx reads.
 */
export class BackendCentrifuge extends Centrifuge {
  readonly #reads: BackendTxReads
  readonly #txPollingInterval: number
  readonly #eventSource: BackendEventSourceFactory
  readonly #invalidations: BackendInvalidationStream | undefined

  /** Prefer {@link createBackendCentrifuge}; this is its constructor. */
  constructor(config: BackendCentrifugeConfig, transport: BackendTransport) {
    const {
      baseUrl,
      useWalletConnect,
      restRoutes,
      txPollingInterval,
      streamPoolIds,
      invalidationTables,
      ...centrifugeConfig
    } = config ?? {}
    const checked = assertBackendTransport(transport)
    if (typeof baseUrl !== 'string' || !baseUrl) {
      throw new Error(
        'createBackendCentrifuge needs `config.baseUrl`: the absolute base URL of the backend API, ' +
          "e.g. 'https://app.example.com/api'."
      )
    }

    // Only `fetch` is handed to the read and write seams. Not tidiness: it is
    // the mechanical guarantee behind the transport contract. Neither seam can
    // open a stream, and neither has any object to read a cookie or a token
    // off, because neither was given one.
    const restTransport = { fetch: checked.fetch }
    const dataSource = new LateBoundDataSource()
    // One stream per instance, and only when the app asked for one. Built
    // before `super` because it needs no root — it is the only thing in this
    // constructor handed `eventSource`, which is what keeps the read and write
    // seams unable to open a stream at all.
    const invalidations =
      streamPoolIds && streamPoolIds.length > 0
        ? new BackendInvalidationStream({
            baseUrl,
            eventSource: checked.eventSource,
            poolIds: streamPoolIds,
            ...(invalidationTables === undefined ? {} : { tables: invalidationTables }),
          })
        : undefined
    super({
      ...centrifugeConfig,
      dataSource,
      txStrategy: new BackendPrepareStrategy({
        baseUrl,
        transport: restTransport,
        ...(useWalletConnect === undefined ? {} : { useWalletConnect }),
      }),
    })
    dataSource.bind(
      new RestDataSource(this, {
        baseUrl,
        transport: restTransport,
        ...(restRoutes === undefined ? {} : { routes: restRoutes }),
        ...(centrifugeConfig.graphqlTarget === undefined ? {} : { graphqlTarget: centrifugeConfig.graphqlTarget }),
        ...(invalidations === undefined ? {} : { invalidations }),
      })
    )

    this.#reads = new BackendTxReads({ baseUrl, fetch: checked.fetch })
    this.#txPollingInterval = txPollingInterval ?? DEFAULT_BACKEND_TX_POLL_INTERVAL
    // The push half of the transport, so that an app implements the transport
    // once. It is called through `BackendInvalidationStream` above, and only
    // when `streamPoolIds` named a pool. It stays reachable as `_eventSource`
    // because the stream is opened lazily and a caller may want the factory
    // before then.
    this.#eventSource = checked.eventSource
    this.#invalidations = invalidations
  }

  /**
   * The injected SSE factory, for the invalidation stream.
   * @internal
   */
  get _eventSource(): BackendEventSourceFactory {
    return this.#eventSource
  }

  /**
   * The shared invalidation stream, or `undefined` when the app configured no
   * `streamPoolIds` and this instance runs on polling alone.
   * @internal
   */
  get _invalidationStream(): BackendInvalidationStream | undefined {
    return this.#invalidations
  }

  /**
   * Close the invalidation stream, if one is open, and stop reconnecting.
   * No-op otherwise.
   *
   * The stream is deliberately NOT closed when the last subscription goes away
   * (subscriptions churn with every mount and cache expiry, and a stream that
   * flapped with them would spend its life reconnecting), so a long-lived app
   * that tears a session down calls this. Reads keep working afterwards: they
   * go over `fetch` and their poll timer returns to the normal interval.
   */
  closeInvalidationStream(): void {
    this.#invalidations?.close()
  }

  /**
   * The pool, with the backend's session-scoped transaction reads attached.
   *
   * Resolved through `Centrifuge.pool` first, so a pool the catalogue does not
   * return still fails exactly as it does in public mode — the wrap adds
   * methods, never existence.
   */
  override pool(id: PoolId): Query<BackendPool> {
    return this._query(['backendPool', id.toString()], () =>
      super.pool(id).pipe(map((pool) => new BackendPool(this, pool.id, this.#reads, this.#txPollingInterval)))
    )
  }
}

/**
 * Build a `Centrifuge` that talks to a Centrifuge backend as the signed-in
 * user.
 *
 * This is the entry point of `@centrifuge/sdk/backend`. The session lives in
 * the app and reaches the SDK as two functions — see {@link BackendTransport}
 * for the contract they carry, and `docs/api/sdk-backend-transport.md` for a
 * reference implementation.
 *
 * @example
 * ```ts
 * import { createBackendCentrifuge } from '@centrifuge/sdk/backend'
 *
 * const centrifuge = createBackendCentrifuge(
 *   { environment: 'mainnet', baseUrl: '/api', rpcUrls: { 1: RPC_URL } },
 *   { fetch: sessionFetch, eventSource: sessionEventSource }
 * )
 *
 * const pool = await centrifuge.pool(poolId)
 * await pool.updateMetadata(metadata)    // prepared and policy-checked by the backend
 * const page = await pool.transactions() // the backend's own tx rows
 * ```
 *
 * @param config - Public-mode `Centrifuge` config plus `baseUrl`.
 * @param transport - `{ fetch, eventSource }`, both already carrying the
 *   session.
 * @throws {BackendTransportRequiredError} When either transport member is
 *   missing or not callable.
 */
export function createBackendCentrifuge(
  config: BackendCentrifugeConfig,
  transport: BackendTransport
): BackendCentrifuge {
  return new BackendCentrifuge(config, transport)
}
