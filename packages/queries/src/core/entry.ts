import type { z } from "zod";

/**
 * One named catalogue entry: `{ name, params (zod), result type }`.
 *
 * The result type is a phantom — it exists only at the type level so every
 * adapter (sql here, rest/graphql on the SDK side) implements the same
 * `(params) -> Promise<result>` signature for the same entry, which is what
 * makes cross-adapter parity tests mechanical.
 */
export interface QueryDefinition<
  Name extends string = string,
  Params extends z.ZodTypeAny = z.ZodTypeAny,
  Result = unknown,
> {
  readonly name: Name;
  /** Runtime validator for the entry's parameters. */
  readonly params: Params;
  /**
   * Phantom result carrier — never assigned at runtime. Read it only through
   * {@link QueryResult}.
   */
  readonly __result?: Result;
}

/**
 * Define a catalogue entry. Double-call so the result type is given
 * explicitly while name/params stay inferred:
 *
 * ```ts
 * const pool = defineQuery<Pool | null>()("pool", PoolParamsSchema);
 * ```
 */
export function defineQuery<Result>() {
  return <Name extends string, Params extends z.ZodTypeAny>(
    name: Name,
    params: Params,
  ): QueryDefinition<Name, Params, Result> => ({ name, params });
}

/** The (already-validated) parameter type of an entry. */
export type QueryParams<E> =
  E extends QueryDefinition<string, infer P, unknown> ? z.output<P> : never;

/** The accepted (pre-validation) input type of an entry's parameters. */
export type QueryParamsInput<E> =
  E extends QueryDefinition<string, infer P, unknown> ? z.input<P> : never;

/** The result type of an entry. */
export type QueryResult<E> =
  E extends QueryDefinition<string, z.ZodTypeAny, infer R> ? R : never;

/**
 * The adapter interface a catalogue induces: one async method per entry,
 * `(params) -> Promise<result>`. `sql` implements it over `chain_v1`
 * (backend-only); the SDK-side `rest` and `graphql` adapters implement the
 * same interface against the backend REST endpoints and public-api
 * respectively.
 */
export type QueriesFor<C extends Record<string, QueryDefinition>> = {
  [K in keyof C]: (
    params: QueryParamsInput<C[K]>,
  ) => Promise<QueryResult<C[K]>>;
};
