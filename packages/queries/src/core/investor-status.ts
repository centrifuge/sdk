/**
 * The one predicate behind `WhitelistedInvestorRow.isWhitelisted` on the
 * graphql adapters.
 *
 * The backend evaluates it in Postgres — `valid_until is not null and
 * valid_until > now()` — and serves the boolean, so the REST adapter reads it
 * and never calls this. The graphql adapters have only the timestamp, so they
 * derive it here, once, rather than each spelling the comparison.
 *
 * ## Why this is not `parseInt(validUntil, 10) > Date.now()`
 *
 * That is what `ShareClass.whitelistedHolders()` did, and it was false for every
 * investor on both graphql targets:
 *
 * - public-api serves `chain_v1.whitelisted_investor.valid_until`, a
 *   `timestamptz`, as ISO-8601. `parseInt("2027-01-01T00:00:00+00:00", 10)` is
 *   `2027` — the YEAR — which is never greater than a millisecond clock.
 * - api-v3 serves the on-chain uint64, which is UNIX SECONDS (the hook stores
 *   `block.timestamp <= validUntil`, and the management app's "never expires"
 *   sentinel is `4294967295`, i.e. the year 2106). `4294967295 > Date.now()` is
 *   false too, because `Date.now()` is milliseconds.
 *
 * So both spellings have to be accepted, and the unit has to come from the
 * SHAPE rather than from a magnitude heuristic. A digits-only string is the
 * on-chain uint64 and is always seconds; anything else must parse as a date.
 * A value that is neither THROWS: passing an unparseable timestamp through as
 * `false` would report a live member as expired, and reporting it as `true`
 * would whitelist someone on the strength of a parse failure. This is the same
 * closed-mapping rule `fromGraphqlEnum` applies to enum labels.
 */
export function isWhitelistedAt(
  validUntil: string | null | undefined,
  now: number = Date.now(),
): boolean {
  // No whitelist row, or a row whose expiry was never projected. Postgres
  // answers `false` for both (`valid_until is not null and …`); so do we.
  if (validUntil === null || validUntil === undefined || validUntil === "") {
    return false;
  }

  if (/^\d+$/.test(validUntil)) {
    // The on-chain uint64, in seconds. `Number` is exact for every value a
    // uint64 timestamp can hold below 2^53 seconds (year 285 million).
    return Number(validUntil) * 1000 > now;
  }

  const parsed = Date.parse(validUntil);
  if (Number.isNaN(parsed)) {
    throw new Error(
      `Cannot decide whether a whitelist entry is live: validUntil ` +
        `${JSON.stringify(validUntil)} is neither a UNIX-seconds integer (the ` +
        `on-chain uint64, as api-v3 serves it) nor a parseable date (as ` +
        `public-api serves chain_v1.whitelisted_investor.valid_until). ` +
        `Guessing either way would report a membership state nobody wrote.`,
    );
  }
  return parsed > now;
}
