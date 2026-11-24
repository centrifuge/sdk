/**
 * GraphQL adapters over the named query catalogue.
 *
 * Two targets implement the same catalogue contract:
 * - `public-api` — PostGraphile v5 over `chain_v1` (the v3.3 Phase 1 target);
 * - `api-v3` — the legacy Ponder documents, moved verbatim out of
 *   `packages/sdk` so the SDK holds no GraphQL strings while public-api
 *   closes the capability gaps.
 *
 * `capabilities.ts` records, per entry, which of the two can serve it and
 * exactly what public-api is missing when it cannot.
 */
export {
  createGraphqlQueries,
  UnsupportedQueryError,
  type GraphqlAdapterOptions,
  type GraphqlQueryFn,
  type GraphqlTarget,
} from "./adapter";
export {
  blockedEntries,
  isPublicApiSupported,
  PUBLIC_API_CAPABILITIES,
  type EntryCapability,
  type EntrySupport,
  type MissingCapability,
  type SdkGraphqlEntryName,
} from "./capabilities";
export {
  DimensionOverflowError,
  MAX as PUBLIC_API_DIMENSION_CAP,
  PUBLIC_API_RESOLVERS,
  type GraphqlExecutor,
  type ResolverContext,
} from "./public-api";
export {
  API_V3_DOCUMENTS,
  API_V3_UNWRAP,
  API_V3_VARIABLES,
  ApiV3UnsupportedError,
  apiV3Document,
} from "./api-v3";
