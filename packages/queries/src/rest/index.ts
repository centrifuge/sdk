/**
 * REST adapter over the backend's feature endpoints.
 *
 * Implements the same catalogue contract as `sql` and `graphql`: one call per
 * named entry, params validated by the catalogue, results isomorphic to the
 * entry's result type. What is specific to this adapter is the *per-entry
 * route table* and the transparent fallback: an entry the backend does not
 * serve is answered by the graphql adapter instead, so backend mode is
 * complete from day one and each vertical adds exactly one row at a time.
 *
 * Auth is absent by construction — the adapter is handed a `fetch` and never
 * touches cookies, CSRF tokens, or retries; that is the transport contract
 * `@centrifuge/sdk/backend` satisfies.
 *
 * The push half lives in `./invalidations`: the table-to-entry mapping
 * and the fan-out hub that turn the backend's raw `invalidation` frames into
 * `(name, vars)` refetch hints. It names no transport either — the stream
 * itself is opened by `@centrifuge/sdk/backend` over the injected
 * `transport.eventSource`.
 */
export {
  createInvalidationHub,
  INVALIDATION_PAYLOAD_VERSION,
  INVALIDATION_TABLES,
  invalidationTargets,
  matchesVars,
  parseInvalidationFrame,
  type InvalidationDispatchResult,
  type InvalidationFrame,
  type InvalidationHub,
  type InvalidationKeys,
  type InvalidationRow,
  type InvalidationTableMap,
  type InvalidationTarget,
  type ParsedInvalidation,
} from "./invalidations";
export {
  createRestQueries,
  RestQueryError,
  RestRouteMissingError,
  toSdkQueries,
  type RestAdapterOptions,
  type RestQueryFn,
  type RestTransport,
} from "./adapter";
export {
  poolIdFromShareClassId,
  REST_ROUTE_OWNERS,
  REST_ROUTES,
  type RestRoute,
  type RestRouteOwner,
  type RestRouteTable,
} from "./routes";
