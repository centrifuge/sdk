import type { QueriesFor } from "../core/entry";
import {
  sdkCatalogue,
  type SdkQueryCatalogue,
  type SdkQueryName,
} from "../core/sdk-catalogue";
import {
  DataSourceResponseError,
  readResponseBody,
  responseExcerpt,
} from "../core/response-error";
import { REST_ROUTES, type RestRoute, type RestRouteTable } from "./routes";

/**
 * A backend REST read failed. Carries the entry, the route it addressed, the
 * HTTP status and the backend's `code` when it sent one, so a broken route is
 * actionable instead of surfacing as an opaque parse failure.
 *
 * EVERY failure of a REST-served entry arrives as this type — a non-2xx, a
 * body that is not JSON, a body the entry's `decode` rejects, and a transport
 * that never got a response. A caller therefore handles "this route
 * misbehaved" in one `catch`, and across 30 entries the message always says
 * WHICH entry and WHICH url. The triggering error is attached as `cause`
 * rather than swallowed.
 *
 * Deliberately NOT a trigger for graphql fallback: fallback happens only when
 * an entry has no route at all. An entry whose route exists but answers 404,
 * 503 or garbage is a broken deployment and must fail loud rather than quietly
 * serving stale-shaped graphql data.
 */
export class RestQueryError extends DataSourceResponseError {
  override name = "RestQueryError";
  readonly entry: string;
  readonly code?: string;

  constructor(
    entry: string,
    url: string,
    status: number,
    detail: unknown,
    code?: string,
    cause?: unknown,
  ) {
    const body = summarize(detail);
    super(
      `Backend REST read for "${entry}" failed ` +
        `${status === 0 ? "before any response" : `with HTTP ${status}`} ` +
        `(GET ${url})${code ? ` code=${code}` : ""}: ${body}`,
      { status, url, body },
      { cause },
    );
    this.entry = entry;
    this.code = code;
  }
}

/**
 * An entry has no REST route and no graphql fallback was supplied.
 *
 * Names the vertical that owns the missing route, so the message says who
 * unblocks it rather than "not implemented".
 */
export class RestRouteMissingError extends Error {
  override name = "RestRouteMissingError";
  readonly entry: string;

  constructor(entry: string) {
    super(
      `Catalogue entry "${entry}" has no backend REST route and no graphql ` +
        `fallback was configured. Backend mode falls back per entry: supply ` +
        `\`fallback\` (the graphql adapter) when constructing the rest ` +
        `adapter, or add the route once its backend endpoint exists. See ` +
        `REST_ROUTE_OWNERS for which vertical owns this entry's endpoint.`,
    );
    this.entry = entry;
  }
}

/** The triggering error's message, for a wrapper that keeps it as `cause`. */
function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Trim an error body to something loggable without dumping a whole page. */
function summarize(body: unknown): string {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  if (!text) {
    return "<empty body>";
  }
  return text.length > 300 ? `${text.slice(0, 300)}...` : text;
}

/**
 * The read half of the SDK's transport contract: a `fetch` and nothing else.
 *
 * The adapter never sets cookies, CSRF headers, or a retry policy — the app
 * supplies a `fetch` that already does. This is what keeps auth mechanics out
 * of `packages/sdk` and `packages/queries` entirely.
 */
export interface RestTransport {
  fetch: typeof fetch;
}

export interface RestAdapterOptions {
  /**
   * Absolute base URL of the backend API, e.g. `https://app.example.com/api`.
   * A trailing slash is optional.
   */
  baseUrl: string;
  /** Injected transport (see {@link RestTransport}). */
  transport: RestTransport;
  /**
   * Per-entry route table. Defaults to the shipped {@link REST_ROUTES}; pass
   * a table to stage a route before it ships (or to test the mechanism).
   */
  routes?: RestRouteTable;
  /**
   * Where entries WITHOUT a route go. In backend mode the SDK wires this to
   * the graphql adapter, which is what makes per-entry migration invisible to
   * callers.
   *
   * It receives the caller's raw params, and this adapter skips its own
   * validation on that path. Nothing invalid reaches the network as a result:
   * the graphql adapter parses the same catalogue entry's schema before it
   * executes anything, so the params ARE validated — once, by the adapter that
   * actually runs the query. Validating here too would add a second gate that
   * could disagree with the first (both parse the same schema, but only one of
   * them owns the request), which is the drift the single-owner rule avoids.
   */
  fallback?: (
    name: SdkQueryName,
    params: Record<string, unknown>,
  ) => Promise<unknown>;
}

/** Join `baseUrl` and a route path without doubling or dropping the slash. */
function join(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

/**
 * Build the backend REST implementation of the SDK catalogue.
 *
 * Same contract as the graphql adapter: `(name, params) -> Promise<result>`,
 * with the catalogue doing param validation. Two behaviours are specific to
 * this adapter:
 *
 * 1. **Per-entry fallback.** An entry with no row in the route table is
 *    delegated to `fallback` (the graphql adapter). Backend mode is therefore
 *    complete from day one and a vertical adds one row at a time.
 * 2. **No silent fallback on failure.** Once an entry HAS a route, a failing
 *    request throws {@link RestQueryError}. Falling back there would hide a
 *    broken route behind results that look fine.
 */
export function createRestQueries(options: RestAdapterOptions) {
  const { baseUrl, transport, fallback } = options;
  const routes = options.routes ?? REST_ROUTES;

  return async function query(
    name: SdkQueryName,
    rawParams: Record<string, unknown> = {},
  ): Promise<unknown> {
    const entry = sdkCatalogue[name];
    if (!entry) {
      throw new Error(`Unknown query catalogue entry "${name}"`);
    }

    const route = routes[name];
    if (!route) {
      if (!fallback) {
        throw new RestRouteMissingError(name);
      }
      // Raw params on purpose. Not "unvalidated": the graphql adapter parses
      // this same entry's schema before it issues anything, so validation
      // happens exactly once, in the adapter that owns the request.
      return await fallback(name, rawParams ?? {});
    }

    const params = entry.params.parse(rawParams ?? {});
    const url = join(baseUrl, (route.path as (p: unknown) => string)(params));

    // A transport that never produced a response is still a failure of THIS
    // route, and the caller must not have to catch raw fetch errors alongside
    // RestQueryError to notice it. Status 0: there was no HTTP status.
    let res: Response;
    try {
      res = await transport.fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
    } catch (cause) {
      throw new RestQueryError(
        name,
        url,
        0,
        `the transport failed before a response arrived (${messageOf(cause)})`,
        undefined,
        cause,
      );
    }

    if (!res.ok) {
      const body = await readBody(res);
      const code = refusalCode(body);
      // A 404 the ENTRY's contract calls an empty answer, not a failure (see
      // `RestRoute.absent`). Both the status and the code must match: a
      // blanket "404 means empty" would hide a broken route, and a code match
      // alone would swallow the same code on a 5xx.
      const absent = (route as RestRoute<unknown>).absent;
      if (absent !== undefined && res.status === 404 && code === absent.code) {
        return absent.value;
      }
      throw new RestQueryError(name, url, res.status, body, code);
    }

    // A 2xx with a body the entry cannot use is as broken as a 500, so it is
    // wrapped: unwrapped it reaches the caller as a bare SyntaxError (bad
    // JSON) or as whatever `decode` threw, neither catchable as "this route
    // misbehaved".
    const read = await readResponseBody(res);
    if (!read.isJson) {
      throw new RestQueryError(
        name,
        url,
        res.status,
        `the response body is not JSON (${messageOf(read.cause)}): ` +
          (responseExcerpt(read.text) || "<empty body>"),
        undefined,
        read.cause,
      );
    }
    const body: unknown = read.json;

    const decode = route.decode as
      ((b: unknown, p: unknown) => unknown) | undefined;
    if (!decode) {
      return body;
    }
    try {
      return decode(body, params);
    } catch (cause) {
      throw new RestQueryError(
        name,
        url,
        res.status,
        `the response body does not match the entry's result type ` +
          `(${messageOf(cause)})`,
        undefined,
        cause,
      );
    }
  };
}

/**
 * The refusal's identity, from the two body fields that can carry it.
 *
 * Precedence matches `BackendPrepare`'s, so both halves of backend mode name a
 * refusal the same way:
 *
 * 1. `code` — the backend's own identity for the refusal (`POOL_NOT_FOUND`,
 *    `SHARE_CLASS_NOT_FOUND`, ...). When present it always wins.
 * 2. `issues` — the shared `ZodValidationPipe`'s per-field detail, which comes
 *    with `{ error: "validation_failed" }` and NO `code`. It only *names* the
 *    refusal when there is no code.
 *
 * Note the status that carries it: this backend's validation pipe answers
 * **422**, not 400 (`UnprocessableEntityException` in
 * `interfaces/http/pipes/zod-validation.pipe.ts`). A caller switching on the
 * status of a malformed request must expect 422. On pool-scoped routes the role
 * guard runs ahead of the pipe, so an unauthorised caller gets 403 even for a
 * malformed id and never reaches this shape at all.
 */
function refusalCode(body: unknown): string | undefined {
  if (!body || typeof body !== "object") {
    return undefined;
  }
  const fields = body as { code?: unknown; issues?: unknown };
  if (typeof fields.code === "string" && fields.code) {
    return fields.code;
  }
  if (Array.isArray(fields.issues)) {
    return "VALIDATION_FAILED";
  }
  return undefined;
}

async function readBody(res: Response): Promise<unknown> {
  const { text, json, isJson } = await readResponseBody(res);
  return isJson ? json : text || undefined;
}

export type RestQueryFn = ReturnType<typeof createRestQueries>;

/**
 * Adapt the `(name, params)` function form to the object form the catalogue
 * induces — `QueriesFor<SdkQueryCatalogue>`, one async method per entry, which
 * is exactly the interface the sql adapter implements over `chain_v1`.
 *
 * The function form is what the SDK's `DataSource` consumes (one generic
 * method, one cache key); this exists so the rest adapter is substitutable in
 * the same cross-adapter parity tests as sql.
 */
export function toSdkQueries(
  query: RestQueryFn,
): QueriesFor<SdkQueryCatalogue> {
  const queries = {} as Record<string, (params: unknown) => Promise<unknown>>;
  for (const name of Object.keys(sdkCatalogue) as SdkQueryName[]) {
    queries[name] = (params: unknown) =>
      query(name, (params ?? {}) as Record<string, unknown>);
  }
  return queries as QueriesFor<SdkQueryCatalogue>;
}
