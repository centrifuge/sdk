/**
 * An indexer or backend answered a read with a response the adapter cannot
 * use: a non-2xx status, or a 2xx whose body is not the JSON the entry
 * expects. Both transports (`rest`, and the SDK's GraphQL fetch) throw a
 * subclass, so a caller handles "the data source misbehaved" with one
 * `instanceof`. `status` is `0` when no response arrived at all.
 */
export class DataSourceResponseError extends Error {
  override name = "DataSourceResponseError";
  readonly status: number;
  readonly url: string;
  /** A short, single-line excerpt of the response body. */
  readonly body: string;

  constructor(
    message: string,
    details: { status: number; url: string; body: string },
    options?: { cause?: unknown },
  ) {
    super(message, options?.cause === undefined ? undefined : options);
    this.status = details.status;
    this.url = details.url;
    this.body = details.body;
  }
}

export const RESPONSE_EXCERPT_LIMIT = 200;

/** Collapse a body to one line of at most `limit` code points. */
export function responseExcerpt(
  text: string,
  limit = RESPONSE_EXCERPT_LIMIT,
): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const chars = Array.from(flat);
  return chars.length > limit ? chars.slice(0, limit).join("") : flat;
}

/** A url safe to put in an error message: no credentials, no query string. */
export function displayUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

/**
 * Read a body once; `isJson` is false when it did not parse (or never
 * arrived), with the failure as `cause`.
 */
export async function readResponseBody(res: Response): Promise<{
  text: string;
  json: unknown;
  isJson: boolean;
  cause?: unknown;
}> {
  let text: string;
  try {
    text = await res.text();
  } catch (cause) {
    return { text: "", json: undefined, isJson: false, cause };
  }
  try {
    return { text, json: JSON.parse(text), isJson: true };
  } catch (cause) {
    return { text, json: undefined, isJson: false, cause };
  }
}
