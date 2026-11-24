import { describe, expect, it } from "vitest";
import { decodeFunctionData } from "viem";
import { resolveProtocolContext } from "../context";
import { BuilderArgumentMismatchError } from "../errors";
import { PROTOCOL_VERSION_V3_2 } from "../types";
import type { AssetHoldingAccounts } from "./create-holding";
import { builders, createHolding } from "./index";

/** Pool 1 on centrifugeId 1 (Ethereum mainnet in the bundled registry). */
const POOL_ID = "281474976710657";
const SC_ID = "0x00010000000000010001000000000001";
const ASSET_ID = "340282366920938463463374607431768211455"; // uint128 max
const VALUATION = "0x6Bcb240d3e1f1C4321ECAFFDacB45691DC03bE5D";

function context() {
  return resolveProtocolContext(POOL_ID, PROTOCOL_VERSION_V3_2, {
    environment: "mainnet",
  });
}

const ASSET_ACCOUNTS = {
  asset: "1",
  equity: "2",
  gain: "3",
  loss: "4",
} as const;

/**
 * Decode-back assertions rather than a second encode: they pin the FUNCTION
 * selected and the ARGUMENT ORDER, which is where a builder bug lives, without
 * restating `encodeFunctionData` and calling that a check. The expected
 * argument tuples are the ones the SDK's `ShareClass.createHolding` passes.
 */
describe("builders.createHolding", () => {
  it("encodes Hub.initializeHolding with the SDK's argument order for an asset holding", () => {
    const ctx = context();

    const built = builders.createHolding(ctx, {
      poolId: POOL_ID,
      scId: SC_ID,
      assetId: ASSET_ID,
      valuationAddress: VALUATION,
      isLiability: false,
      accounts: ASSET_ACCOUNTS,
    });

    expect(built.to).toBe(ctx.addresses.hub);
    expect(built.value).toBe(0n);
    expect(decodeFunctionData({ abi: ctx.abis.hub, data: built.data })).toEqual(
      {
        functionName: "initializeHolding",
        args: [
          BigInt(POOL_ID),
          SC_ID,
          BigInt(ASSET_ID),
          VALUATION,
          1n,
          2n,
          3n,
          4n,
        ],
      },
    );
    expect(built.calls).toEqual([
      {
        to: ctx.addresses.hub,
        data: built.data,
        value: 0n,
        label: "Hub.initializeHolding",
      },
    ]);
  });

  it("encodes Hub.initializeLiability with only the two liability accounts", () => {
    const ctx = context();

    const built = builders.createHolding(ctx, {
      poolId: POOL_ID,
      scId: SC_ID,
      assetId: "42",
      valuationAddress: VALUATION,
      isLiability: true,
      accounts: { expense: "7", liability: "8" },
    });

    expect(decodeFunctionData({ abi: ctx.abis.hub, data: built.data })).toEqual(
      {
        functionName: "initializeLiability",
        args: [BigInt(POOL_ID), SC_ID, 42n, VALUATION, 7n, 8n],
      },
    );
    expect(built.calls?.[0].label).toBe("Hub.initializeLiability");
  });

  it("is hub-side: the context resolves to the pool's own chain", () => {
    const ctx = context();
    // centrifugeId 1 is encoded in the pool id's high 16 bits.
    expect(ctx.centrifugeId).toBe(1);
  });

  it("lowercases the share-class id so calldata is byte-stable", () => {
    const ctx = context();
    const upper = `0x${SC_ID.slice(2).toUpperCase()}`;

    const built = createHolding(ctx, {
      poolId: POOL_ID,
      scId: upper,
      assetId: "42",
      valuationAddress: VALUATION,
      isLiability: false,
      accounts: ASSET_ACCOUNTS,
    });
    const lower = createHolding(ctx, {
      poolId: POOL_ID,
      scId: SC_ID,
      assetId: "42",
      valuationAddress: VALUATION,
      isLiability: false,
      accounts: ASSET_ACCOUNTS,
    });

    expect(built.data).toBe(lower.data);
  });

  it("throws on a pool id that does not match the resolved context", () => {
    const ctx = context();

    expect(() =>
      createHolding(ctx, {
        poolId: "562949953421319",
        scId: SC_ID,
        assetId: "42",
        valuationAddress: VALUATION,
        isLiability: false,
        accounts: ASSET_ACCOUNTS,
      }),
    ).toThrow(/pool id mismatch/);
  });

  it("refuses a malformed valuation address rather than encoding it", () => {
    const ctx = context();

    // A valuation address decides how a holding is priced; a typo must not
    // reach the chain as a dead contract.
    for (const valuationAddress of [
      "0x0",
      "not-an-address",
      // Correct length, wrong checksum: a transposed character.
      "0x6Bcb240d3e1f1C4321ECAFFDacB45691DC03bE5E",
    ]) {
      expect(() =>
        createHolding(ctx, {
          poolId: POOL_ID,
          scId: SC_ID,
          assetId: "42",
          valuationAddress,
          isLiability: false,
          accounts: ASSET_ACCOUNTS,
        }),
      ).toThrow(BuilderArgumentMismatchError);
    }
  });

  it("refuses a non-canonical or oversized numeric argument", () => {
    const ctx = context();
    // Annotated rather than inferred from `ASSET_ACCOUNTS`: that constant is
    // `as const`, so an inferred default would type `gain` as the literal "3"
    // and reject the oversized override the last case passes.
    const build = (
      assetId: string,
      accounts: AssetHoldingAccounts = ASSET_ACCOUNTS,
    ) =>
      createHolding(ctx, {
        poolId: POOL_ID,
        scId: SC_ID,
        assetId,
        valuationAddress: VALUATION,
        isLiability: false,
        accounts,
      });

    // `BigInt()` would happily accept every one of these and mean something
    // other than what the caller wrote.
    expect(() => build("0x2a")).toThrow(/canonical/);
    expect(() => build("042")).toThrow(/canonical/);
    expect(() => build("1_000")).toThrow(/canonical/);
    expect(() => build(" 42 ")).toThrow(/canonical/);
    expect(() => build("-1")).toThrow(/canonical/);
    expect(() => build((1n << 128n).toString())).toThrow(/exceeds uint128/);
    expect(() =>
      build("42", { ...ASSET_ACCOUNTS, gain: (1n << 256n).toString() }),
    ).toThrow(/exceeds uint256/);
  });

  it("refuses a malformed share-class id", () => {
    const ctx = context();

    expect(() =>
      createHolding(ctx, {
        poolId: POOL_ID,
        scId: "0xabc",
        assetId: "42",
        valuationAddress: VALUATION,
        isLiability: false,
        accounts: ASSET_ACCOUNTS,
      }),
    ).toThrow(/bytes16/);
  });
});
