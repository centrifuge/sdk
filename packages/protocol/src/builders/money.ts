import { BuilderArgumentMismatchError } from "../errors";

const UINT32_MAX = (1n << 32n) - 1n;

/** Inclusive upper bound of a Solidity `uint64`. */
const UINT64_MAX = (1n << 64n) - 1n;

/** Inclusive upper bound of a Solidity `uint128`. */
const UINT128_MAX = (1n << 128n) - 1n;

/** Inclusive upper bound of a Solidity `uint256`. */
const UINT256_MAX = (1n << 256n) - 1n;

/** A canonical non-negative integer decimal string: no sign, no leading zeros. */
const CANONICAL_INTEGER = /^(0|[1-9][0-9]*)$/;

/**
 * Parse an on-chain integer argument from its decimal-string wire form.
 *
 * Money and money-adjacent arguments cross this package's boundary as decimal
 * strings of the on-chain integer, never as JS numbers — `Number("1e21")`
 * parses, `2 ** 53 + 1` does not round-trip, and either one silently changes an
 * amount. `BigInt()` alone is not enough: it accepts `"0x10"`, `"0b1"`, `" 1 "`
 * and `"1_000"`, all of which mean something other than what the caller wrote,
 * so the canonical form is enforced first.
 *
 * @throws BuilderArgumentMismatchError when the string is not canonical or the
 * value does not fit the declared width. Refusing beats truncating: a silently
 * wrapped uint128 is a wrong amount that the calldata cannot be told apart
 * from a correct one.
 */
function parseUint(
  value: string,
  max: bigint,
  width: string,
  field: string,
): bigint {
  if (!CANONICAL_INTEGER.test(value)) {
    throw new BuilderArgumentMismatchError(
      `${field} ${JSON.stringify(value)} is not a canonical non-negative ` +
        "integer decimal string (no sign, no leading zeros, no hex, no " +
        "separators, no whitespace).",
    );
  }
  const parsed = BigInt(value);
  if (parsed > max) {
    throw new BuilderArgumentMismatchError(
      `${field} ${value} exceeds ${width}. Refusing to encode a value that ` +
        "would wrap on chain.",
    );
  }

  return parsed;
}

/**
 * Parse a `uint128` token amount, refusing zero.
 *
 * A zero-amount deposit or withdrawal moves nothing while still costing a
 * signing ceremony, a policy evaluation and gas — and on the Fordefi path an
 * approval quorum. It is always a client bug (an empty form field, a
 * mis-scaled `Balance`), so it is refused at the builder rather than encoded.
 */
export function parseAmount(value: string, field: string): bigint {
  const amount = parseUint(value, UINT128_MAX, "uint128", field);
  if (amount === 0n) {
    throw new BuilderArgumentMismatchError(
      `${field} is zero. Refusing to encode a transfer of nothing — it costs ` +
        "a signature and gas and moves no value.",
    );
  }

  return amount;
}

/**
 * Parse a `uint64` on-chain scalar (a unix-seconds timestamp).
 *
 * Same canonical-decimal-string rule as every other on-chain integer here, and
 * for the same reason: a share price's `computedAt` decides whether the chain
 * accepts the update at all (`require(computedAt <= block.timestamp)`), so a
 * value that silently became something else in transit is a failed transaction
 * at best and a price stamped with the wrong date at worst.
 */
export function parseUint64(value: string, field: string): bigint {
  return parseUint(value, UINT64_MAX, "uint64", field);
}

export function parseUint32(value: string, field: string): number {
  return Number(parseUint(value, UINT32_MAX, "uint32", field));
}

/** Parse a `uint128` on-chain identifier (asset id). Zero is a valid id. */
export function parseUint128(value: string, field: string): bigint {
  return parseUint(value, UINT128_MAX, "uint128", field);
}

/** Parse a `uint256` on-chain identifier (ledger account id, ERC-6909 token id). */
export function parseUint256(value: string, field: string): bigint {
  return parseUint(value, UINT256_MAX, "uint256", field);
}
