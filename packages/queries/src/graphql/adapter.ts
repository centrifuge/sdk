import { sdkCatalogue, type SdkQueryName } from "../core/sdk-catalogue";
import {
  API_V3_PAGED,
  API_V3_UNWRAP,
  API_V3_VARIABLES,
  apiV3Document,
} from "./api-v3";
import { PUBLIC_API_CAPABILITIES, type EntryCapability } from "./capabilities";
import { MAX, PUBLIC_API_RESOLVERS, type GraphqlExecutor } from "./public-api";

/**
 * Thrown when a catalogue entry cannot be served by the configured backend.
 *
 * Carries the entry and the exact capability that would unblock it, so a gap
 * surfaces as an actionable error instead of a wrong or partial result.
 */
export class UnsupportedQueryError extends Error {
  override name = "UnsupportedQueryError";
  readonly entry: string;
  readonly missing: readonly string[];
  readonly blockedBy: readonly string[];

  constructor(entry: string, capability: EntryCapability) {
    super(
      `Query "${entry}" is not available on public-api, which is the default ` +
        `GraphQL target. Reason: ${capability.reason}. ` +
        `Missing public-api capability: ${(capability.missing ?? []).join(", ") || "unknown"}. ` +
        `Unsupported api-v3 constructs: ${(capability.blockedBy ?? []).join("; ") || "n/a"}. ` +
        `Interim workaround: construct Centrifuge with ` +
        `{ graphqlTarget: 'api-v3' } to serve this entry from the legacy ` +
        `indexer until the capability lands. See ` +
        `docs/parity/09-sdk-catalogue-public-api.md for the per-entry table.`,
    );
    this.entry = entry;
    this.missing = capability.missing ?? [];
    this.blockedBy = capability.blockedBy ?? [];
  }
}

/** Which GraphQL backend an adapter talks to. */
export type GraphqlTarget = "public-api" | "api-v3";

export interface GraphqlAdapterOptions {
  /** Executes one document; supplied by the SDK (its `fromFetch` transport). */
  execute: GraphqlExecutor;
  /**
   * Which backend `execute` points at.
   *
   * `'public-api'` is the v3.3 Phase 1 target: entries it can serve are
   * resolved against the PostGraphile schema, and entries it cannot are
   * refused with {@link UnsupportedQueryError}.
   *
   * `'api-v3'` replays the legacy Ponder documents unchanged. It exists so
   * public mode keeps working entry-for-entry while public-api closes the
   * gaps in `capabilities.ts`, and it is deleted when the last entry ports.
   */
  target: GraphqlTarget;
  /**
   * Cap for the whole-table dimension reads the public-api client joins need.
   * Exceeding it throws `DimensionOverflowError` rather than truncating, which
   * would yield wrong nulls. Injectable so the guard is testable without
   * seeding a thousand rows.
   *
   * @default 1000
   */
  dimensionCap?: number;
}

async function readEveryApiV3Page(
  execute: GraphqlExecutor,
  document: string,
  variables: Record<string, unknown>,
  collection: string,
): Promise<Record<string, { items: unknown[] }>> {
  const items: unknown[] = [];
  let after: string | undefined;
  for (;;) {
    const data = await execute(document, { ...variables, after });
    const page = data[collection];
    items.push(...page.items);
    const next: string | undefined = page.pageInfo?.hasNextPage
      ? page.pageInfo.endCursor
      : undefined;
    if (!next || next === after) {
      return { [collection]: { items } };
    }
    after = next;
  }
}

/**
 * Validate a call's params against the catalogue entry, then resolve it.
 *
 * Validation is the catalogue's job, not the adapter's: every entry's params
 * schema is `.strict()`, so a typo'd filter key is rejected here rather than
 * silently widening a read on whichever backend is configured.
 */
export function createGraphqlQueries(options: GraphqlAdapterOptions) {
  const { execute, target, dimensionCap = MAX } = options;

  return async function query(
    name: SdkQueryName,
    rawParams: Record<string, unknown> = {},
  ): Promise<unknown> {
    const entry = sdkCatalogue[name];
    if (!entry) {
      throw new Error(`Unknown query catalogue entry "${name}"`);
    }

    // Refuse a blocked entry BEFORE validating params: the call cannot
    // proceed either way, and a param error would send the caller off fixing
    // the wrong thing before they hit the capability gap anyway.
    const resolver = PUBLIC_API_RESOLVERS[name];
    if (target === "public-api" && !resolver) {
      throw new UnsupportedQueryError(name, PUBLIC_API_CAPABILITIES[name]);
    }

    const params = entry.params.parse(rawParams ?? {});

    if (target === "api-v3") {
      const document = apiV3Document(name, params as Record<string, any>);
      const variables = API_V3_VARIABLES[name](params);
      const paged = API_V3_PAGED[name];
      const data = paged
        ? await readEveryApiV3Page(execute, document, variables, paged)
        : await execute(document, variables);
      return API_V3_UNWRAP[name](data);
    }

    return resolver!(execute, params, { entry: name, dimensionCap });
  };
}

export type GraphqlQueryFn = ReturnType<typeof createGraphqlQueries>;
