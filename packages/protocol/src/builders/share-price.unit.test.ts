import { describe, expect, it } from "vitest";
import { decodeFunctionData, encodeFunctionData } from "viem";
import { ABIS_V3_2 } from "../abis/v3_2";
import { resolveProtocolContext } from "../context";
import { BuilderArgumentMismatchError } from "../errors";
import { MessageType } from "../messages";
import { PROTOCOL_VERSION_V3_2, type ProtocolContext } from "../types";
import { builders, updateSharePrice } from "./index";

/** Pool 1 on centrifugeId 1 (Ethereum mainnet in the bundled registry). */
const POOL_ID = "281474976710657";
const OTHER_POOL_ID = "281474976710658";
const SC_ID = "0x00010000000000010001000000000001";
const REFUND = "0x6Bcb240d3e1f1C4321ECAFFDacB45691DC03bE5D";

/** 1.045513765272640000 as a D18 integer — a real mainnet share price. */
const PRICE = "1045513765272640000";
/** 2026-08-30T00:00:00Z in unix seconds. */
const COMPUTED_AT = "1788048000";

function hubContext(): ProtocolContext {
  return resolveProtocolContext(POOL_ID, PROTOCOL_VERSION_V3_2, {
    environment: "mainnet",
  });
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

describe("updateSharePrice", () => {
  it("encodes the price write then one notification per network, in that order", () => {
    const ctx = hubContext();

    const built = updateSharePrice(ctx, {
      poolId: POOL_ID,
      scId: SC_ID,
      pricePerShare: PRICE,
      computedAt: COMPUTED_AT,
      notifyNetworks: ["2", "3"],
      refundAddress: REFUND,
    });

    expect(built.to).toBe(ctx.addresses.hub);
    const inner = innerCalldata(built.data);
    expect(inner).toHaveLength(3);

    const write = decodeHub(ctx, inner[0]!);
    expect(write.functionName).toBe("updateSharePrice");
    expect(write.args).toEqual([
      BigInt(POOL_ID),
      SC_ID,
      BigInt(PRICE),
      BigInt(COMPUTED_AT),
    ]);

    // The notifications MUST follow the write: `Hub.notifySharePrice` carries
    // no price argument, it reads the stored one back — so a notification
    // encoded first would broadcast the OLD price and nothing would report it.
    const [first, second] = [
      decodeHub(ctx, inner[1]!),
      decodeHub(ctx, inner[2]!),
    ];
    expect(first.functionName).toBe("notifySharePrice");
    expect(first.args).toEqual([BigInt(POOL_ID), SC_ID, 2, REFUND]);
    expect(second.args).toEqual([BigInt(POOL_ID), SC_ID, 3, REFUND]);
  });

  it("preserves the caller's network order", () => {
    const ctx = hubContext();

    const built = updateSharePrice(ctx, {
      poolId: POOL_ID,
      scId: SC_ID,
      pricePerShare: PRICE,
      computedAt: COMPUTED_AT,
      notifyNetworks: ["6", "2", "11"],
      refundAddress: REFUND,
    });

    const networks = innerCalldata(built.data)
      .slice(1)
      .map((data) => decodeHub(ctx, data).args?.[2]);
    expect(networks).toEqual([6, 2, 11]);
  });

  it("sends the bare price write when no network is notified", () => {
    const ctx = hubContext();

    const built = updateSharePrice(ctx, {
      poolId: POOL_ID,
      scId: SC_ID,
      pricePerShare: PRICE,
      computedAt: COMPUTED_AT,
      notifyNetworks: [],
    });

    // One call is sent verbatim — no multicall wrapper (see encodeBatchCalldata).
    expect(built.calls).toHaveLength(1);
    expect(built.data).toBe(
      encodeFunctionData({
        abi: ctx.abis.hub,
        functionName: "updateSharePrice",
        args: [BigInt(POOL_ID), SC_ID, BigInt(PRICE), BigInt(COMPUTED_AT)],
      }),
    );
  });

  it("attaches zero value to every call, and labels which zeros are placeholders", () => {
    const ctx = hubContext();

    const built = updateSharePrice(ctx, {
      poolId: POOL_ID,
      scId: SC_ID,
      pricePerShare: PRICE,
      computedAt: COMPUTED_AT,
      notifyNetworks: ["2"],
      refundAddress: REFUND,
    });

    expect(built.value).toBe(0n);
    expect(built.calls?.map((call) => call.value)).toEqual([0n, 0n]);
    expect(built.calls?.map((call) => call.label)).toEqual([
      "Hub.updateSharePrice",
      "Hub.notifySharePrice (network 2)",
    ]);
    // Two calls, ONE message. `Hub.updateSharePrice` is payable but
    // dispatches nothing; only the notification does, and it is keyed by the
    // network it goes to because the fee is charged per route.
    expect(built.messages).toEqual({
      2: [{ type: MessageType.NotifyPricePoolPerShare, poolId: POOL_ID }],
    });
  });

  it("refuses a zero price rather than marking the share class worthless", () => {
    const ctx = hubContext();

    expect(() =>
      updateSharePrice(ctx, {
        poolId: POOL_ID,
        scId: SC_ID,
        pricePerShare: "0",
        computedAt: COMPUTED_AT,
        notifyNetworks: [],
      }),
    ).toThrow(BuilderArgumentMismatchError);
  });

  it("refuses a non-canonical price string instead of coercing it", () => {
    const ctx = hubContext();

    for (const price of ["1e18", " 1", "0x10", "1_000", "01"]) {
      expect(() =>
        updateSharePrice(ctx, {
          poolId: POOL_ID,
          scId: SC_ID,
          pricePerShare: price,
          computedAt: COMPUTED_AT,
          notifyNetworks: [],
        }),
      ).toThrow(BuilderArgumentMismatchError);
    }
  });

  it("refuses a computedAt that does not fit a uint64", () => {
    const ctx = hubContext();

    expect(() =>
      updateSharePrice(ctx, {
        poolId: POOL_ID,
        scId: SC_ID,
        pricePerShare: PRICE,
        computedAt: (1n << 64n).toString(),
        notifyNetworks: [],
      }),
    ).toThrow(BuilderArgumentMismatchError);
  });

  it("refuses a repeated network, which would pay twice for one message", () => {
    const ctx = hubContext();

    expect(() =>
      updateSharePrice(ctx, {
        poolId: POOL_ID,
        scId: SC_ID,
        pricePerShare: PRICE,
        computedAt: COMPUTED_AT,
        notifyNetworks: ["2", "2"],
        refundAddress: REFUND,
      }),
    ).toThrow(/names network 2 twice/);
  });

  it('refuses a non-canonical network id, so "02" cannot smuggle a duplicate', () => {
    const ctx = hubContext();

    expect(() =>
      updateSharePrice(ctx, {
        poolId: POOL_ID,
        scId: SC_ID,
        pricePerShare: PRICE,
        computedAt: COMPUTED_AT,
        notifyNetworks: ["2", "02"],
        refundAddress: REFUND,
      }),
    ).toThrow(/not a canonical decimal centrifugeId/);
  });

  it("refuses a network id outside uint16 rather than truncating it", () => {
    const ctx = hubContext();

    expect(() =>
      updateSharePrice(ctx, {
        poolId: POOL_ID,
        scId: SC_ID,
        pricePerShare: PRICE,
        computedAt: COMPUTED_AT,
        notifyNetworks: ["65536"],
        refundAddress: REFUND,
      }),
    ).toThrow(BuilderArgumentMismatchError);
  });

  it("requires a refund address when a network is notified", () => {
    const ctx = hubContext();

    expect(() =>
      updateSharePrice(ctx, {
        poolId: POOL_ID,
        scId: SC_ID,
        pricePerShare: PRICE,
        computedAt: COMPUTED_AT,
        notifyNetworks: ["2"],
      }),
    ).toThrow(/refundAddress is required when notifyNetworks is non-empty/);
  });

  it("refuses a refund address when nothing is notified", () => {
    const ctx = hubContext();

    expect(() =>
      updateSharePrice(ctx, {
        poolId: POOL_ID,
        scId: SC_ID,
        pricePerShare: PRICE,
        computedAt: COMPUTED_AT,
        notifyNetworks: [],
        refundAddress: REFUND,
      }),
    ).toThrow(/no network is being notified/);
  });

  it("refuses a pool id that disagrees with the resolved context", () => {
    const ctx = hubContext();

    expect(() =>
      updateSharePrice(ctx, {
        poolId: OTHER_POOL_ID,
        scId: SC_ID,
        pricePerShare: PRICE,
        computedAt: COMPUTED_AT,
        notifyNetworks: [],
      }),
    ).toThrow(BuilderArgumentMismatchError);
  });

  it("refuses a malformed share class id", () => {
    const ctx = hubContext();

    expect(() =>
      updateSharePrice(ctx, {
        poolId: POOL_ID,
        scId: "0xdeadbeef",
        pricePerShare: PRICE,
        computedAt: COMPUTED_AT,
        notifyNetworks: [],
      }),
    ).toThrow(BuilderArgumentMismatchError);
  });

  it("is reachable through the builders map", () => {
    expect(builders.updateSharePrice).toBe(updateSharePrice);
  });

  it("is deterministic: the same args produce byte-identical calldata", () => {
    const ctx = hubContext();
    const args = {
      poolId: POOL_ID,
      scId: SC_ID,
      pricePerShare: PRICE,
      computedAt: COMPUTED_AT,
      notifyNetworks: ["2", "3"],
      refundAddress: REFUND,
    };

    // The calldata is built at preview and again at prepare. Nothing in this
    // builder reads a clock or a registry ordering, so the two must agree.
    expect(updateSharePrice(ctx, args).data).toBe(
      updateSharePrice(ctx, args).data,
    );
  });
});
