import { describe, expect, it } from "vitest";
import { decodeFunctionData } from "viem";
import { getInstanceAbi } from "../abis";
import { resolveProtocolContext } from "../context";
import {
  BuilderArgumentMismatchError,
  UnknownDeploymentError,
} from "../errors";
import { PROTOCOL_VERSION_V3_2 } from "../types";
import { builders, depositHolding, withdrawHolding } from "./index";
import type { HoldingTransferAsset } from "./holding-transfer";

/** Pool 1 on centrifugeId 1; its assets are held on centrifugeId 2 (Base). */
const POOL_ID = "281474976710657";
const HUB_CENTRIFUGE_ID = 1;
const SPOKE_CENTRIFUGE_ID = 2;
const SC_ID = "0x00010000000000010001000000000001";
const MANAGER = "0x6Bcb240d3e1f1C4321ECAFFDacB45691DC03bE5D";
const RECEIVER = "0xA4A7Bb3831958463b3FE3E27A6a160F764341953";
const ASSET_ADDRESS = "0x19f46D8130e610C6C0f0116EA40Fb781dEFaDE93";
const AMOUNT = "1000000";

const ERC20: HoldingTransferAsset = {
  assetId: "42",
  address: ASSET_ADDRESS,
  assetTokenId: null,
};
const ERC6909: HoldingTransferAsset = {
  assetId: "43",
  address: ASSET_ADDRESS,
  assetTokenId: "9",
};

/** The spoke-side context both builders require. */
function spokeContext() {
  return resolveProtocolContext(POOL_ID, PROTOCOL_VERSION_V3_2, {
    environment: "mainnet",
    centrifugeId: SPOKE_CENTRIFUGE_ID,
  });
}

describe("resolveProtocolContext with a spoke centrifugeId", () => {
  it("resolves the target chain's address set, not the pool's home chain", () => {
    const hub = resolveProtocolContext(POOL_ID, PROTOCOL_VERSION_V3_2, {
      environment: "mainnet",
    });
    const spoke = spokeContext();

    expect(hub.centrifugeId).toBe(HUB_CENTRIFUGE_ID);
    expect(spoke.centrifugeId).toBe(SPOKE_CENTRIFUGE_ID);
    // The chain id is what routes the transaction, and it differs — that is
    // the whole reason the override exists, since BalanceSheet lives on the
    // spoke. The ADDRESS may well coincide: v3.2 deploys deterministically, so
    // the same contract sits at the same address on every chain. Which is
    // precisely why the chain id must come from the resolved deployment rather
    // than being derived from the pool id: an address that looks right on both
    // chains gives no warning when the network is wrong.
    expect(spoke.chainId).not.toBe(hub.chainId);
    expect(spoke.addresses.balanceSheet).toBeDefined();
    // The pool id still travels, so builders can still cross-check it.
    expect(spoke.poolId).toBe(POOL_ID);
  });

  it("refuses a spoke the pool's protocol version is not deployed on", () => {
    // Not a silent fallback to the hub chain: an unregistered target is
    // UnknownDeploymentError, which the backend maps to 422 UNKNOWN_CHAIN.
    expect(() =>
      resolveProtocolContext(POOL_ID, PROTOCOL_VERSION_V3_2, {
        environment: "mainnet",
        centrifugeId: 9999,
      }),
    ).toThrow(UnknownDeploymentError);
  });
});

describe("builders.depositHolding", () => {
  it("wallet source: BalanceSheet.deposit with the SDK's argument order", () => {
    const ctx = spokeContext();

    const built = builders.depositHolding(ctx, {
      poolId: POOL_ID,
      scId: SC_ID,
      asset: ERC20,
      amount: AMOUNT,
      source: "wallet",
    });

    expect(built.to).toBe(ctx.addresses.balanceSheet);
    expect(built.value).toBe(0n);
    expect(
      decodeFunctionData({ abi: ctx.abis.balanceSheet, data: built.data }),
    ).toEqual({
      functionName: "deposit",
      // (poolId, scId, asset, tokenId, amount) — tokenId 0 for a plain ERC-20.
      args: [BigInt(POOL_ID), SC_ID, ASSET_ADDRESS, 0n, BigInt(AMOUNT)],
    });
    expect(built.calls?.[0].label).toBe("BalanceSheet.deposit");
  });

  it("manager source: OnOffRampManager.deposit at the manager address", () => {
    const ctx = spokeContext();

    const built = builders.depositHolding(ctx, {
      poolId: POOL_ID,
      scId: SC_ID,
      asset: ERC6909,
      amount: AMOUNT,
      source: "manager",
      managerAddress: MANAGER,
      receiverAddress: RECEIVER,
    });

    // Sent to the projected manager instance, NOT to a registry address.
    expect(built.to).toBe(MANAGER);
    expect(
      decodeFunctionData({
        abi: getInstanceAbi(ctx.protocolVersion, "onOffRampManager"),
        data: built.data,
      }),
    ).toEqual({
      functionName: "deposit",
      // (asset, tokenId, amount, receiver) — a different arity and order from
      // BalanceSheet's, which is exactly what this test exists to pin.
      args: [ASSET_ADDRESS, 9n, BigInt(AMOUNT), RECEIVER],
    });
    expect(built.calls?.[0].label).toBe("OnOffRampManager.deposit");
  });

  it("refuses a manager source without a manager address or receiver", () => {
    const ctx = spokeContext();
    const base = {
      poolId: POOL_ID,
      scId: SC_ID,
      asset: ERC20,
      amount: AMOUNT,
      source: "manager",
    } as const;

    expect(() =>
      depositHolding(ctx, { ...base, receiverAddress: RECEIVER }),
    ).toThrow(/managerAddress is required/);
    expect(() =>
      depositHolding(ctx, { ...base, managerAddress: MANAGER }),
    ).toThrow(/receiverAddress is required/);
  });
});

describe("builders.withdrawHolding", () => {
  it("wallet source: BalanceSheet.withdraw puts the receiver BEFORE the amount", () => {
    const ctx = spokeContext();

    const built = builders.withdrawHolding(ctx, {
      poolId: POOL_ID,
      scId: SC_ID,
      asset: ERC20,
      amount: AMOUNT,
      source: "wallet",
      receiverAddress: RECEIVER,
    });

    expect(built.to).toBe(ctx.addresses.balanceSheet);
    expect(
      decodeFunctionData({ abi: ctx.abis.balanceSheet, data: built.data }),
    ).toEqual({
      functionName: "withdraw",
      // (poolId, scId, asset, tokenId, receiver, amount) — receiver then
      // amount, the opposite of the manager ABI. Swapping them would encode
      // an address as an amount and still be valid calldata.
      args: [
        BigInt(POOL_ID),
        SC_ID,
        ASSET_ADDRESS,
        0n,
        RECEIVER,
        BigInt(AMOUNT),
      ],
    });
    expect(built.calls?.[0].label).toBe("BalanceSheet.withdraw");
  });

  it("manager source: OnOffRampManager.withdraw puts the receiver LAST", () => {
    const ctx = spokeContext();

    const built = builders.withdrawHolding(ctx, {
      poolId: POOL_ID,
      scId: SC_ID,
      asset: ERC6909,
      amount: AMOUNT,
      source: "manager",
      managerAddress: MANAGER,
      receiverAddress: RECEIVER,
    });

    expect(built.to).toBe(MANAGER);
    expect(
      decodeFunctionData({
        abi: getInstanceAbi(ctx.protocolVersion, "onOffRampManager"),
        data: built.data,
      }),
    ).toEqual({
      functionName: "withdraw",
      args: [ASSET_ADDRESS, 9n, BigInt(AMOUNT), RECEIVER],
    });
    expect(built.calls?.[0].label).toBe("OnOffRampManager.withdraw");
  });

  it("requires a receiver on the wallet path too", () => {
    const ctx = spokeContext();

    expect(() =>
      withdrawHolding(ctx, {
        poolId: POOL_ID,
        scId: SC_ID,
        asset: ERC20,
        amount: AMOUNT,
        source: "wallet",
        receiverAddress: "0x0",
      }),
    ).toThrow(BuilderArgumentMismatchError);
  });
});

describe("holding transfer amounts", () => {
  const cases = [
    { name: "deposit/wallet", source: "wallet" as const },
    { name: "deposit/manager", source: "manager" as const },
  ];

  it.each(cases)("refuses a zero amount ($name)", ({ source }) => {
    const ctx = spokeContext();

    // Zero moves nothing while costing a signature, a policy evaluation and
    // gas — and an approval quorum on the Fordefi path.
    expect(() =>
      depositHolding(ctx, {
        poolId: POOL_ID,
        scId: SC_ID,
        asset: ERC20,
        amount: "0",
        source,
        managerAddress: MANAGER,
        receiverAddress: RECEIVER,
      }),
    ).toThrow(/is zero/);
  });

  it("refuses a non-canonical, negative or oversized amount", () => {
    const ctx = spokeContext();
    const build = (amount: string) =>
      depositHolding(ctx, {
        poolId: POOL_ID,
        scId: SC_ID,
        asset: ERC20,
        amount,
        source: "wallet",
      });

    expect(() => build("1e6")).toThrow(/canonical/);
    expect(() => build("1.5")).toThrow(/canonical/);
    expect(() => build("0x64")).toThrow(/canonical/);
    expect(() => build("-1")).toThrow(/canonical/);
    expect(() => build("01")).toThrow(/canonical/);
    expect(() => build((1n << 128n).toString())).toThrow(/exceeds uint128/);
  });

  it("accepts the largest representable amount unchanged", () => {
    const ctx = spokeContext();
    const max = ((1n << 128n) - 1n).toString();

    const built = depositHolding(ctx, {
      poolId: POOL_ID,
      scId: SC_ID,
      asset: ERC20,
      amount: max,
      source: "wallet",
    });

    const decoded = decodeFunctionData({
      abi: ctx.abis.balanceSheet,
      data: built.data,
    });
    expect(decoded.args?.[4]).toBe(BigInt(max));
  });

  it("refuses a pool id that does not match the resolved context", () => {
    const ctx = spokeContext();

    expect(() =>
      withdrawHolding(ctx, {
        poolId: "562949953421319",
        scId: SC_ID,
        asset: ERC20,
        amount: AMOUNT,
        source: "wallet",
        receiverAddress: RECEIVER,
      }),
    ).toThrow(/pool id mismatch/);
  });
});
