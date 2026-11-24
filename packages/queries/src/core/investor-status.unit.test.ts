import { describe, expect, it } from "vitest";
import { isWhitelistedAt } from "./investor-status";

/**
 * The predicate that decides whether a whitelist entry is live on the graphql
 * adapters.
 */
describe("isWhitelistedAt", () => {
  const NOW = Date.UTC(2026, 8, 3);

  it("is what `parseInt(validUntil) > Date.now()` was not", () => {
    // Both spellings of a live membership. The line this replaces answered
    // FALSE for each of them, for two different reasons: `parseInt` of an ISO
    // string is the year, and api-v3's seconds never exceed a millisecond
    // clock. Inverting this function back to `parseInt(...) > now` turns both
    // of these red, which is the whole point of the field.
    expect(isWhitelistedAt("2030-01-01T00:00:00+00:00", NOW)).toBe(true);
    expect(isWhitelistedAt("1893456000", NOW)).toBe(true);
    // The management app's "never expires" sentinel, `type(uint32).max`.
    expect(isWhitelistedAt("4294967295", NOW)).toBe(true);
  });

  it("is false for an expired membership in either spelling", () => {
    expect(isWhitelistedAt("2020-01-01T00:00:00+00:00", NOW)).toBe(false);
    expect(isWhitelistedAt("1577836800", NOW)).toBe(false);
  });

  it("is false for no row at all, matching Postgres", () => {
    // Postgres evaluates `valid_until is not null and valid_until > now()`,
    // and a NULL is not a live membership. `""` is the spelling the REST
    // adapter uses
    // for a projected NULL, because the frozen row shape types the field
    // non-null.
    expect(isWhitelistedAt(null, NOW)).toBe(false);
    expect(isWhitelistedAt(undefined, NOW)).toBe(false);
    expect(isWhitelistedAt("", NOW)).toBe(false);
  });

  it("throws on a spelling it cannot read rather than guessing", () => {
    // Returning `false` would report a live member as expired and `true` would
    // whitelist someone on the strength of a parse failure. Neither is a state
    // anybody wrote.
    expect(() => isWhitelistedAt("whenever", NOW)).toThrow(/validUntil/);
    expect(() => isWhitelistedAt("2030-13-45", NOW)).toThrow(/validUntil/);
  });
});
