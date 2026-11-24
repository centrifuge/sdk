/**
 * The backend's `Wei` wire type, parsed rather than trusted.
 *
 * Every `unsignedTx.value` the backend sends arrives as a canonical
 * non-negative decimal wei STRING, and two of the three shapes `BigInt` accepts
 * for such a string are silently wrong for money: `BigInt('')` is `0n` and
 * `BigInt('0x10')` is `16`. A wrong-format value would therefore not fail — it
 * would produce a plausible amount and be signed. So the format is checked
 * before the conversion, on every path that reads the field.
 *
 * Shared by `BackendPrepare` (the value about to be signed) and the backend
 * subpath's tx view (the same field, read back off a recorded row). One
 * definition, because the two must agree on what a valid amount looks like:
 * a value the prepare path refuses must not read back as a number.
 */

/** A canonical non-negative decimal integer — the backend's `Wei` type. */
const CANONICAL_WEI = /^(0|[1-9][0-9]*)$/

/** Whether `value` is a canonical non-negative decimal wei string. */
export function isCanonicalWei(value: unknown): value is string {
  return typeof value === 'string' && CANONICAL_WEI.test(value)
}

/**
 * Parse a canonical decimal wei string to a bigint.
 *
 * @param value - The raw field as it arrived on the wire.
 * @param describe - Builds the message for a rejected value; receives the
 *   JSON-quoted raw value so the caller can name the field and its context.
 * @throws Whatever `describe` produces, when `value` is not canonical wei.
 *   Never returns a fallback: there is no safe default for an amount.
 */
export function parseCanonicalWei(value: unknown, describe: (quoted: string) => Error): bigint {
  if (!isCanonicalWei(value)) {
    throw describe(JSON.stringify(value))
  }
  return BigInt(value)
}
