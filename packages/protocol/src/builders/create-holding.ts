import { encodeFunctionData, isAddress, type Address } from "viem";
import {
  BuilderArgumentMismatchError,
  UnsupportedForProtocolVersionError,
} from "../errors";
import {
  PROTOCOL_VERSION_V3_3,
  type BuiltProtocolCall,
  type ProtocolContext,
} from "../types";
import { parseUint128, parseUint256 } from "./money";

/**
 * The four ledger accounts an ASSET holding books to (double-entry: asset and
 * loss are debit-normal, equity and gain credit-normal). Ids are `uint256`
 * decimal strings.
 */
export interface AssetHoldingAccounts {
  readonly asset: string;
  readonly equity: string;
  readonly gain: string;
  readonly loss: string;
}

/** The two ledger accounts a LIABILITY holding books to. */
export interface LiabilityHoldingAccounts {
  readonly expense: string;
  readonly liability: string;
}

/** Arguments for {@link createHolding}. */
export type CreateHoldingArgs = {
  /** Raw pool id (uint64 decimal string). Must match `ctx.poolId`. */
  readonly poolId: string;
  /** Share-class id (bytes16 hex). */
  readonly scId: string;
  /** Asset id (uint128 decimal string). */
  readonly assetId: string;
  /**
   * Valuation contract that prices this holding. Required, never defaulted —
   * see the module docstring.
   */
  readonly valuationAddress: string;
} & (
  | { readonly isLiability: false; readonly accounts: AssetHoldingAccounts }
  | {
      readonly isLiability: true;
      readonly accounts: LiabilityHoldingAccounts;
    }
);

/**
 * `Hub.initializeHolding(...)` / `Hub.initializeLiability(...)` — pure builder,
 * no I/O.
 *
 * Hub-side: the holding is created where the pool lives, so the context is the
 * pool's home chain (no `centrifugeId` override).
 *
 * ## The valuation address (issue #38's open decision)
 *
 * `valuationAddress` is an explicit REQUIRED argument. There is no server-side
 * default and the hardcoded `0x6Bcb…` from `AddHoldingForm.tsx:28` is not
 * carried forward. A valuation contract decides how a holding is priced, and
 * therefore what the pool's NAV is; a default would mean the backend silently
 * choosing a pricing model for someone else's money, and — because the address
 * differs per chain and per protocol version — a default that is right on one
 * chain is a wrong contract or a dead address on another. `GET /valuations`
 * exists so a caller can discover the valid values, and the endpoint validates
 * against that same list, so an unknown address is a 422 `UNKNOWN_VALUATION`
 * rather than an unpriceable holding.
 *
 * ## The account ids
 *
 * Also required. The SDK resolves them from the pool's IPFS metadata and, when
 * absent, allocates fresh RANDOM ids after probing `Accounting.exists` over
 * RPC. Neither is available to this builder and neither may become available:
 * the builder is pure, and its calldata is re-derived at preview, at prepare and
 * again during Fordefi dual-channel verification — a random id would make those
 * three disagree and fail verification on every transaction. Resolving the ids
 * is therefore the caller's job (it is the caller who reads the metadata), and
 * they arrive as data. `initializeHolding` reverts `InvalidAccountCombination`
 * if any two of the four collide, which is exactly the check that must not be
 * guessed at here.
 */
export function createHolding(
  ctx: ProtocolContext,
  args: CreateHoldingArgs,
): BuiltProtocolCall {
  if (args.poolId !== ctx.poolId) {
    throw new BuilderArgumentMismatchError(
      `createHolding pool id mismatch: context resolved for pool ` +
        `${ctx.poolId}, args carry pool ${args.poolId}`,
    );
  }

  const poolId = BigInt(args.poolId);
  const scId = requireBytes16(args.scId, "createHolding.scId");
  const assetId = parseUint128(args.assetId, "createHolding.assetId");
  const valuation = requireAddress(
    args.valuationAddress,
    "createHolding.valuationAddress",
  );

  if (ctx.protocolVersion === PROTOCOL_VERSION_V3_3) {
    return createHoldingV3_3(ctx, args, poolId, scId, assetId, valuation);
  }
  const data = args.isLiability
    ? encodeFunctionData({
        abi: ctx.abis.hub,
        functionName: "initializeLiability",
        args: [
          poolId,
          scId,
          assetId,
          valuation,
          parseUint256(args.accounts.expense, "createHolding.accounts.expense"),
          parseUint256(
            args.accounts.liability,
            "createHolding.accounts.liability",
          ),
        ],
      })
    : encodeFunctionData({
        abi: ctx.abis.hub,
        functionName: "initializeHolding",
        args: [
          poolId,
          scId,
          assetId,
          valuation,
          parseUint256(args.accounts.asset, "createHolding.accounts.asset"),
          parseUint256(args.accounts.equity, "createHolding.accounts.equity"),
          parseUint256(args.accounts.gain, "createHolding.accounts.gain"),
          parseUint256(args.accounts.loss, "createHolding.accounts.loss"),
        ],
      });

  const to = ctx.addresses.hub;
  // `initializeHolding` / `initializeLiability` are payable (they may pay a
  // cross-chain message fee) but the SDK sends nothing, and this builder does
  // not either: a value the caller did not ask for is value moved without
  // consent. So no message manifest either — deliberately matching
  // the SDK rather than pricing a message the local build path does not pay
  // for, which would make the two routes cost different amounts for the same
  // operation.
  const value = 0n;
  const label = args.isLiability
    ? "Hub.initializeLiability"
    : "Hub.initializeHolding";

  return { to, data, value, calls: [{ to, data, value, label }] };
}

/** A bytes16 hex argument, lowercased for byte-stable calldata. */
/**
 * v3.3 registers one account per settlement slot (`AccountKind`: AmountDebit,
 * AmountCredit, ValueIncrease, ValueDecrease), which an asset holding's
 * asset, equity, gain and loss accounts map onto in that order. A liability
 * has no v3.3 entry point of its own and is refused until the protocol team
 * states which slots its two accounts fill.
 */
function createHoldingV3_3(
  ctx: ProtocolContext,
  args: CreateHoldingArgs,
  poolId: bigint,
  scId: `0x${string}`,
  assetId: bigint,
  valuation: Address,
): BuiltProtocolCall {
  if (args.isLiability) {
    throw new UnsupportedForProtocolVersionError(
      "createHolding",
      ctx.protocolVersion,
      "initializeLiability was removed and the liability slot mapping is undecided",
    );
  }
  const accounts = [
    parseUint256(args.accounts.asset, "createHolding.accounts.asset"),
    parseUint256(args.accounts.equity, "createHolding.accounts.equity"),
    parseUint256(args.accounts.gain, "createHolding.accounts.gain"),
    parseUint256(args.accounts.loss, "createHolding.accounts.loss"),
  ] as const;
  const to = ctx.addresses.hub;
  const data = encodeFunctionData({
    abi: ctx.abis.hub,
    functionName: "initializeHolding",
    args: [poolId, scId, assetId, valuation, accounts],
  });
  const value = 0n;
  return {
    to,
    data,
    value,
    calls: [{ to, data, value, label: "Hub.initializeHolding" }],
  };
}

export function requireBytes32(value: string, field: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new BuilderArgumentMismatchError(
      `${field} ${JSON.stringify(value)} is not a bytes32 hex string`,
    );
  }
  return value.toLowerCase() as `0x${string}`;
}

export function requireHex(value: string, field: string): `0x${string}` {
  if (!/^0x([0-9a-fA-F]{2})*$/.test(value)) {
    throw new BuilderArgumentMismatchError(
      `${field} ${JSON.stringify(value)} is not a hex byte string`,
    );
  }
  return value.toLowerCase() as `0x${string}`;
}

export function requireBytes16(value: string, field: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{32}$/.test(value)) {
    throw new BuilderArgumentMismatchError(
      `${field} ${JSON.stringify(value)} is not a bytes16 hex string`,
    );
  }
  return value.toLowerCase() as `0x${string}`;
}

/**
 * A 20-byte address argument.
 *
 * `isAddress` with the default strict checksum rejects a mixed-case address
 * whose checksum does not verify, which is the one cheap defence against a
 * transposed character in an address a human pasted. An all-lowercase or
 * all-uppercase address has no checksum to verify and is accepted, as
 * everywhere else in viem.
 */
export function requireAddress(value: string, field: string): Address {
  if (!isAddress(value)) {
    throw new BuilderArgumentMismatchError(
      `${field} ${JSON.stringify(value)} is not a valid (checksummed) EVM ` +
        "address",
    );
  }
  return value;
}
