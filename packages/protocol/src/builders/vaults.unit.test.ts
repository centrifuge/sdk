import { describe, expect, it } from "vitest";
import {
  concatHex,
  decodeFunctionData,
  encodeFunctionData,
  maxUint128,
  padHex,
  toHex,
} from "viem";
import { ABIS_V3_2 } from "../abis/v3_2";
import { resolveProtocolContext } from "../context";
import { BuilderArgumentMismatchError } from "../errors";
import { MessageType } from "../messages";
import { PROTOCOL_VERSION_V3_2, type ProtocolContext } from "../types";
import { builders, deployVault, updateVaults, type VaultRef } from "./index";
import { VAULT_UPDATE_KIND } from "./vaults";

/** Pool 1 on centrifugeId 1 (Ethereum mainnet in the bundled registry). */
const POOL_ID = "281474976710657";
const SC_ID = "0x00010000000000010001000000000001";
/** Asset 42 on centrifugeId 2, the spoke the vault contexts resolve to. */
const ASSET_ID = ((2n << 112n) + 42n).toString();
const OTHER_ASSET_ID = ((2n << 112n) + 43n).toString();
const REFUND = "0x6Bcb240d3e1f1C4321ECAFFDacB45691DC03bE5D";
const VAULT_A = "0x19f46D8130e610C6C0f0116EA40Fb781dEFaDE93";
const VAULT_B = "0xA4A7Bb3831958463b3FE3E27A6a160F764341953";
/** centrifugeId 2 is Base in the bundled mainnet registry. */
const SPOKE_CENTRIFUGE_ID = 2;

function hubContext(): ProtocolContext {
  return resolveProtocolContext(POOL_ID, PROTOCOL_VERSION_V3_2, {
    environment: "mainnet",
  });
}

function spokeContext(): ProtocolContext {
  return resolveProtocolContext(POOL_ID, PROTOCOL_VERSION_V3_2, {
    environment: "mainnet",
    centrifugeId: SPOKE_CENTRIFUGE_ID,
  });
}

function ref(vaultAddress: string, assetId = ASSET_ID): VaultRef {
  return { scId: SC_ID, assetId, vaultAddress };
}

/**
 * The SDK's `addressToBytes32` (`packages/sdk/src/utils/index.ts`:
 * `address.padEnd(66, "0").toLowerCase()`) — the reference the builder must
 * match byte for byte.
 *
 * Derived from the SDK rather than restated from the builder ON PURPOSE: this
 * padding is RIGHT-padded, and writing the expectation from the implementation
 * is how a left-padded encoding passes its own test while reverting on the
 * spoke with `CastLib.PrefixNotZero`.
 */
function bytes32(address: string): string {
  return padHex(address.toLowerCase() as `0x${string}`, {
    dir: "right",
    size: 32,
  });
}

/**
 * The SDK's `encode([...])` (packages/sdk/src/utils/index.ts) — the reference
 * implementation the trusted-call payload must match byte for byte.
 */
function sdkEncode(values: (number | bigint)[]): string {
  return concatHex(values.map((v) => toHex(v, { size: 32 })));
}

/** Decode a `multicall(bytes[])` outer call back into its inner calldata. */
function innerCalldata(data: string): readonly string[] {
  const decoded = decodeFunctionData({
    abi: ABIS_V3_2.Multicall,
    data: data as `0x${string}`,
  });
  return decoded.args?.[0] as readonly string[];
}

function decodeHub(ctx: ProtocolContext, data: string) {
  return decodeFunctionData({ abi: ctx.abis.hub, data: data as `0x${string}` });
}

/**
 * Decode-back assertions rather than a second encode: they pin the function
 * selected and the argument ORDER, which is where a builder bug lives. The
 * expected tuples are the ones the SDK's `PoolNetwork.deploy()`,
 * `linkVaults()`, `unlinkVaults()` and `Vault.updateMaxReserve()` pass.
 */
describe("builders.deployVault", () => {
  it("encodes notifyAssetPrice + updateVault(DeployAndLink) for an async vault", () => {
    const ctx = hubContext();
    const spoke = spokeContext();

    const built = builders.deployVault(ctx, {
      poolId: POOL_ID,
      scId: SC_ID,
      assetId: ASSET_ID,
      kind: "async",
      refundAddress: REFUND,
      spoke,
    });

    // Hub-side: sent to the Hub on the POOL's chain, not the spoke's.
    expect(built.to).toBe(ctx.addresses.hub);
    expect(built.value).toBe(0n);

    const inner = innerCalldata(built.data);
    expect(inner).toHaveLength(2);
    expect(decodeHub(ctx, inner[0]!)).toEqual({
      functionName: "notifyAssetPrice",
      args: [BigInt(POOL_ID), SC_ID, BigInt(ASSET_ID), REFUND],
    });
    expect(decodeHub(ctx, inner[1]!)).toEqual({
      functionName: "updateVault",
      args: [
        BigInt(POOL_ID),
        SC_ID,
        BigInt(ASSET_ID),
        // The FACTORY is the spoke's, resolved from the spoke context. Taking
        // it from the hub context would send the spoke an address that does not
        // exist there.
        bytes32(spoke.addresses.asyncVaultFactory!),
        0, // VaultUpdateKind.DeployAndLink
        0n, // extraGasLimit
        REFUND,
      ],
    });
  });

  it("prepends the sync manager max-reserve trusted call for a syncDeposit vault", () => {
    const ctx = hubContext();
    const spoke = spokeContext();

    const built = builders.deployVault(ctx, {
      poolId: POOL_ID,
      scId: SC_ID,
      assetId: ASSET_ID,
      kind: "syncDeposit",
      refundAddress: REFUND,
      spoke,
    });

    const inner = innerCalldata(built.data);
    expect(inner).toHaveLength(3);
    expect(decodeHub(ctx, inner[0]!)).toEqual({
      functionName: "updateContract",
      args: [
        BigInt(POOL_ID),
        SC_ID,
        SPOKE_CENTRIFUGE_ID,
        bytes32(spoke.addresses.syncManager!),
        // Byte-for-byte the SDK's
        // `encode([VaultManagerTrustedCall.MaxReserve, assetId, maxUint128])`.
        sdkEncode([1, BigInt(ASSET_ID), maxUint128]),
        0n,
        REFUND,
      ],
    });
    // A sync-deposit vault uses the sync factory, an async one the async
    // factory — the whole difference the `kind` argument makes.
    expect(decodeHub(ctx, inner[2]!).args?.[3]).toBe(
      bytes32(spoke.addresses.syncDepositVaultFactory!),
    );
  });

  it("right-pads every bytes32 contract argument, as CastLib requires", () => {
    // The protocol decodes `vaultOrFactory` and `updateContract`'s `target`
    // with `CastLib.toAddress` = `address(bytes20(addr))`, guarded by
    // `require(uint96(uint256(addr)) == 0, PrefixNotZero())`. So the address
    // must sit in the HIGH 20 bytes and the LOW 12 must be zero. A left-padded
    // value reverts on the SPOKE, after the cross-chain message has already
    // been paid for and dispatched — which is why this is pinned against the
    // contract's requirement and not against the builder's own output.
    const spoke = spokeContext();
    const built = builders.deployVault(hubContext(), {
      poolId: POOL_ID,
      scId: SC_ID,
      assetId: ASSET_ID,
      kind: "syncDeposit",
      refundAddress: REFUND,
      spoke,
    });
    const inner = innerCalldata(built.data);

    const targets = [
      decodeHub(hubContext(), inner[0]!).args?.[3] as string,
      decodeHub(hubContext(), inner[2]!).args?.[3] as string,
    ];
    for (const target of targets) {
      const hex = target.slice(2);
      expect(hex).toHaveLength(64);
      // Low 12 bytes (24 hex chars) zero — the `PrefixNotZero` guard.
      expect(hex.slice(40)).toBe("0".repeat(24));
      // High 20 bytes are the address itself.
      expect(hex.slice(0, 40)).not.toBe("0".repeat(40));
    }
    expect(targets[0]).toBe(bytes32(spoke.addresses.syncManager!));
    expect(targets[1]).toBe(bytes32(spoke.addresses.syncDepositVaultFactory!));
  });

  it("labels every inner call for the decoder", () => {
    const built = builders.deployVault(hubContext(), {
      poolId: POOL_ID,
      scId: SC_ID,
      assetId: ASSET_ID,
      kind: "syncDeposit",
      refundAddress: REFUND,
      spoke: spokeContext(),
    });

    expect(built.calls?.map((call) => call.label)).toEqual([
      "Hub.updateContract (sync manager max reserve)",
      "Hub.notifyAssetPrice",
      "Hub.updateVault (deploy and link)",
    ]);
    // Zero on every inner call: the crosschain fee is attached to the OUTER
    // transaction from the manifest below, which is where `msg.value` is read.
    expect(built.calls?.every((call) => call.value === 0n)).toBe(true);
    // THREE messages, one per call — including the sync manager's
    // `TrustedContractUpdate`, which the SDK's own `deploy()` omits from its
    // `messages` even though the call dispatches one. Listed here because
    // under-payment stalls a message after the transaction has confirmed,
    // while over-payment is refunded to `refundAddress`.
    expect(built.messages).toEqual({
      2: [
        { type: MessageType.TrustedContractUpdate, poolId: POOL_ID },
        { type: MessageType.NotifyPricePoolPerAsset, poolId: POOL_ID },
        {
          type: MessageType.UpdateVault,
          poolId: POOL_ID,
          subtype: VAULT_UPDATE_KIND.deployAndLink,
        },
      ],
    });
  });

  it("refuses a pool id that disagrees with the resolved context", () => {
    expect(() =>
      deployVault(hubContext(), {
        poolId: "281474976710658",
        scId: SC_ID,
        assetId: ASSET_ID,
        kind: "async",
        refundAddress: REFUND,
        spoke: spokeContext(),
      }),
    ).toThrow(BuilderArgumentMismatchError);
  });

  it("refuses a missing refund address rather than burning to address(0)", () => {
    expect(() =>
      deployVault(hubContext(), {
        poolId: POOL_ID,
        scId: SC_ID,
        assetId: ASSET_ID,
        kind: "async",
        refundAddress: "not-an-address",
        spoke: spokeContext(),
      }),
    ).toThrow(/refundAddress/);
  });

  it("refuses a non-canonical asset id", () => {
    const build = (assetId: string) =>
      deployVault(hubContext(), {
        poolId: POOL_ID,
        scId: SC_ID,
        assetId,
        kind: "async",
        refundAddress: REFUND,
        spoke: spokeContext(),
      });

    expect(() => build("0x2a")).toThrow(/canonical/);
    expect(() => build("042")).toThrow(/canonical/);
    expect(() => build((1n << 128n).toString())).toThrow(/exceeds uint128/);
  });

  it("names the missing contract when the spoke registry lacks a factory", () => {
    const spoke = spokeContext();
    const stripped: ProtocolContext = {
      ...spoke,
      addresses: Object.fromEntries(
        Object.entries(spoke.addresses).filter(
          ([name]) => name !== "asyncVaultFactory",
        ),
      ),
    };

    expect(() =>
      deployVault(hubContext(), {
        poolId: POOL_ID,
        scId: SC_ID,
        assetId: ASSET_ID,
        kind: "async",
        refundAddress: REFUND,
        spoke: stripped,
      }),
    ).toThrow(/asyncVaultFactory/);
  });
});

describe("builders.updateVaults", () => {
  it("encodes unlinks before links, preserving caller order", () => {
    const ctx = hubContext();

    const built = builders.updateVaults(ctx, {
      poolId: POOL_ID,
      refundAddress: REFUND,
      spoke: spokeContext(),
      link: [ref(VAULT_B)],
      unlink: [ref(VAULT_A, OTHER_ASSET_ID)],
    });

    const inner = innerCalldata(built.data);
    expect(inner).toHaveLength(2);
    // Unlink first: replacing a vault for the same asset must remove the old
    // link before adding the new one.
    expect(decodeHub(ctx, inner[0]!)).toEqual({
      functionName: "updateVault",
      args: [
        BigInt(POOL_ID),
        SC_ID,
        BigInt(OTHER_ASSET_ID),
        bytes32(VAULT_A),
        2,
        0n,
        REFUND,
      ],
    });
    expect(decodeHub(ctx, inner[1]!)).toEqual({
      functionName: "updateVault",
      args: [
        BigInt(POOL_ID),
        SC_ID,
        BigInt(ASSET_ID),
        bytes32(VAULT_B),
        1,
        0n,
        REFUND,
      ],
    });
    expect(built.calls?.map((call) => call.label)).toEqual([
      "Hub.updateVault (unlink)",
      "Hub.updateVault (link)",
    ]);
  });

  it("encodes a link-only edit as a bare call, with no multicall wrapper", () => {
    const ctx = hubContext();

    const built = builders.updateVaults(ctx, {
      poolId: POOL_ID,
      refundAddress: REFUND,
      spoke: spokeContext(),
      link: [ref(VAULT_A)],
    });

    // A single call is sent verbatim — byte-identical to the SDK's
    // `encodeBatchCalldata`, which only wraps two or more.
    expect(built.data).toBe(
      encodeFunctionData({
        abi: ctx.abis.hub,
        functionName: "updateVault",
        args: [
          BigInt(POOL_ID),
          SC_ID,
          BigInt(ASSET_ID),
          bytes32(VAULT_A),
          1,
          0n,
          REFUND,
        ],
      }),
    );
    expect(built.calls).toHaveLength(1);
  });

  it("encodes an unlink-only edit", () => {
    const ctx = hubContext();

    const built = builders.updateVaults(ctx, {
      poolId: POOL_ID,
      refundAddress: REFUND,
      spoke: spokeContext(),
      unlink: [ref(VAULT_A), ref(VAULT_B)],
    });

    const inner = innerCalldata(built.data);
    expect(inner).toHaveLength(2);
    expect(inner.map((data) => decodeHub(ctx, data).args?.[4])).toEqual([2, 2]);
  });

  it("encodes a reserve-only edit against the spoke's sync manager", () => {
    const ctx = hubContext();
    const spoke = spokeContext();

    const built = builders.updateVaults(ctx, {
      poolId: POOL_ID,
      refundAddress: REFUND,
      spoke,
      maxReserve: { scId: SC_ID, assetId: ASSET_ID, amount: "1000000" },
    });

    expect(decodeHub(ctx, built.data)).toEqual({
      functionName: "updateContract",
      args: [
        BigInt(POOL_ID),
        SC_ID,
        SPOKE_CENTRIFUGE_ID,
        bytes32(spoke.addresses.syncManager!),
        sdkEncode([1, BigInt(ASSET_ID), 1000000n]),
        0n,
        REFUND,
      ],
    });
    expect(built.calls?.[0]?.label).toBe(
      "Hub.updateContract (sync manager max reserve)",
    );
  });

  it("puts the reserve change last in a combined edit", () => {
    const ctx = hubContext();

    const built = builders.updateVaults(ctx, {
      poolId: POOL_ID,
      refundAddress: REFUND,
      spoke: spokeContext(),
      unlink: [ref(VAULT_A)],
      link: [ref(VAULT_B)],
      maxReserve: { scId: SC_ID, assetId: ASSET_ID, amount: "5" },
    });

    expect(built.calls?.map((call) => call.label)).toEqual([
      "Hub.updateVault (unlink)",
      "Hub.updateVault (link)",
      "Hub.updateContract (sync manager max reserve)",
    ]);
  });

  it("is deterministic: the same arguments always produce the same bytes", () => {
    // Re-derived at preview, at prepare and again during Fordefi's
    // dual-channel verification; an order that drifted would fail every
    // verification.
    const args = {
      poolId: POOL_ID,
      refundAddress: REFUND,
      spoke: spokeContext(),
      unlink: [ref(VAULT_A), ref(VAULT_B, OTHER_ASSET_ID)],
      link: [ref(VAULT_B)],
      maxReserve: { scId: SC_ID, assetId: ASSET_ID, amount: "7" },
    } as const;

    expect(builders.updateVaults(hubContext(), args).data).toBe(
      builders.updateVaults(hubContext(), args).data,
    );
  });

  it("refuses an edit that does nothing", () => {
    expect(() =>
      updateVaults(hubContext(), {
        poolId: POOL_ID,
        refundAddress: REFUND,
        spoke: spokeContext(),
      }),
    ).toThrow(/nothing to do/);
    expect(() =>
      updateVaults(hubContext(), {
        poolId: POOL_ID,
        refundAddress: REFUND,
        spoke: spokeContext(),
        link: [],
        unlink: [],
      }),
    ).toThrow(/nothing to do/);
  });

  it("accepts a zero max reserve: a ceiling, not a transfer", () => {
    // Zero pauses new deposits into a LINKED sync-deposit vault while leaving
    // it linked — what the app's edit form does, and a different operation from
    // `unlink`, which removes the entry point entirely. `updateMaxReserve` has
    // no zero guard either, so refusing it would make backend mode strictly
    // less capable than the local build path.
    const ctx = hubContext();
    const spoke = spokeContext();

    const built = updateVaults(ctx, {
      poolId: POOL_ID,
      refundAddress: REFUND,
      spoke,
      maxReserve: { scId: SC_ID, assetId: ASSET_ID, amount: "0" },
    });

    expect(decodeHub(ctx, built.data)).toEqual({
      functionName: "updateContract",
      args: [
        BigInt(POOL_ID),
        SC_ID,
        SPOKE_CENTRIFUGE_ID,
        bytes32(spoke.addresses.syncManager!),
        sdkEncode([1, BigInt(ASSET_ID), 0n]),
        0n,
        REFUND,
      ],
    });
  });

  it("still refuses a non-canonical or oversized reserve", () => {
    const build = (amount: string) =>
      updateVaults(hubContext(), {
        poolId: POOL_ID,
        refundAddress: REFUND,
        spoke: spokeContext(),
        maxReserve: { scId: SC_ID, assetId: ASSET_ID, amount },
      });

    expect(() => build("0x0")).toThrow(/canonical/);
    expect(() => build("007")).toThrow(/canonical/);
    expect(() => build((1n << 128n).toString())).toThrow(/exceeds uint128/);
  });

  it("refuses a malformed vault address rather than encoding it", () => {
    expect(() =>
      updateVaults(hubContext(), {
        poolId: POOL_ID,
        refundAddress: REFUND,
        spoke: spokeContext(),
        link: [ref("0xdeadbeef")],
      }),
    ).toThrow(/link\[0\]\.vaultAddress/);
  });

  it("refuses a spoke centrifugeId outside uint16", () => {
    const spoke = spokeContext();

    expect(() =>
      updateVaults(hubContext(), {
        poolId: POOL_ID,
        refundAddress: REFUND,
        spoke: { ...spoke, centrifugeId: 70000 },
        maxReserve: { scId: SC_ID, assetId: ASSET_ID, amount: "1" },
      }),
    ).toThrow(/uint16 centrifugeId/);
  });
});
