import { describe, expect, it } from "vitest";
import { decodeFunctionData, encodePacked, toHex } from "viem";
import { ABIS_V3_2 } from "../abis/v3_2";
import { resolveProtocolContext } from "../context";
import { BuilderArgumentMismatchError } from "../errors";
import { MessageType, MessageTypeV3_3 } from "../messages";
import {
  PROTOCOL_VERSION_V3_2,
  PROTOCOL_VERSION_V3_3,
  type ProtocolContext,
} from "../types";
import { builders, repayBatch } from "./index";

/** Pool 1 on centrifugeId 1 (Ethereum mainnet in the bundled registry). */
const POOL_ID = "281474976710657";
const OTHER_POOL_ID = "281474976710658";
const REFUND = "0x6Bcb240d3e1f1C4321ECAFFDacB45691DC03bE5D";

function hubContext(): ProtocolContext {
  return resolveProtocolContext(POOL_ID, PROTOCOL_VERSION_V3_2, {
    environment: "mainnet",
  });
}

/**
 * A batch as the gateway records it: one or more messages concatenated, each
 * carrying its own type byte and, for a pool-dependent type, the `uint64` pool
 * id in bytes 1..9. Only the LEADING message's pool id is load-bearing here —
 * it is the field `MultiAdapter.estimate` resolves the adapter set from and the
 * one the builder's tenancy check reads.
 */
function batchFor(
  poolId: string,
  type: MessageType | MessageTypeV3_3 = MessageType.RequestCallback,
): string {
  return encodePacked(
    ["uint8", "uint64", "bytes"],
    [type, BigInt(poolId), toHex(0, { size: 16 })],
  );
}

describe("repayBatch", () => {
  it("encodes Gateway.repay on the SENDING chain with the batch verbatim", () => {
    const ctx = hubContext();
    const batch = batchFor(POOL_ID);

    const built = repayBatch(ctx, {
      poolId: POOL_ID,
      toCentrifugeId: "2",
      batch,
      refundAddress: REFUND,
    });

    // The Gateway, not the Hub: the shortfall is recorded on the chain the
    // batch was sent FROM, which is the chain this transaction targets.
    expect(built.to).toBe(ctx.addresses.gateway);

    const decoded = decodeFunctionData({
      abi: ABIS_V3_2.Gateway,
      data: built.data,
    });
    expect(decoded.functionName).toBe("repay");
    expect(decoded.args).toEqual([2, batch, REFUND]);
  });

  it("declares NO message manifest, so the caller cannot price it from empty payloads", () => {
    // The one builder whose value is not an estimate over canonical empty
    // messages: the amount owed is `MultiAdapter.estimate` over the REAL batch
    // bytes at the gas limit `Gateway.underpaid` recorded. A manifest here
    // would produce a plausible number for the wrong bytes.
    const built = repayBatch(hubContext(), {
      poolId: POOL_ID,
      toCentrifugeId: "2",
      batch: batchFor(POOL_ID),
      refundAddress: REFUND,
    });

    expect(built.messages).toBeUndefined();
    expect(built.value).toBe(0n);
  });

  it("labels the single call for the decoder", () => {
    const built = repayBatch(hubContext(), {
      poolId: POOL_ID,
      toCentrifugeId: "2",
      batch: batchFor(POOL_ID),
      refundAddress: REFUND,
    });

    expect(built.calls).toHaveLength(1);
    expect(built.calls?.[0]?.label).toContain("Gateway.repay");
    expect(built.calls?.[0]?.label).toContain("network 2");
  });

  it("is reachable through the builders map", () => {
    expect(builders.repayBatch).toBe(repayBatch);
  });

  describe("tenancy", () => {
    it("refuses a batch belonging to another pool", () => {
      // The security check this builder exists for: `Gateway.repay` carries no
      // pool id, so without it a caller holding tx:prepare on pool A could have
      // the backend's own Fordefi vault pay pool B's debt.
      expect(() =>
        repayBatch(hubContext(), {
          poolId: POOL_ID,
          toCentrifugeId: "2",
          batch: batchFor(OTHER_POOL_ID),
          refundAddress: REFUND,
        }),
      ).toThrow(BuilderArgumentMismatchError);
    });

    it("refuses a GLOBAL batch (pool id 0)", () => {
      // Not an oversight: a global batch is not a pool operation, so no
      // pool-scoped grant can authorize paying for it.
      expect(() =>
        repayBatch(hubContext(), {
          poolId: POOL_ID,
          toCentrifugeId: "2",
          batch: batchFor("0"),
          refundAddress: REFUND,
        }),
      ).toThrow(/GLOBAL batch/);
    });

    it("refuses a pool-independent message whose bytes 1..9 happen to spell the pool id", () => {
      expect(() =>
        repayBatch(hubContext(), {
          poolId: POOL_ID,
          toCentrifugeId: "2",
          batch: batchFor(POOL_ID, MessageType.RegisterAsset),
          refundAddress: REFUND,
        }),
      ).toThrow(/carries no pool id/);
    });

    it("reads the type byte with the pool's own protocol version's numbering", () => {
      const v3_3 = { ...hubContext(), protocolVersion: PROTOCOL_VERSION_V3_3 };
      const args = {
        poolId: POOL_ID,
        toCentrifugeId: "2",
        refundAddress: REFUND,
      };

      expect(() =>
        repayBatch(v3_3, {
          ...args,
          batch: batchFor(POOL_ID, MessageTypeV3_3.NotifyPool),
        }),
      ).not.toThrow();
      expect(() =>
        repayBatch(hubContext(), {
          ...args,
          batch: batchFor(POOL_ID, MessageType.SetPoolAdapters),
        }),
      ).toThrow(/carries no pool id/);
      expect(MessageTypeV3_3.NotifyPool).toBe(MessageType.SetPoolAdapters);
    });

    it("refuses a type byte past the last message type, which no gateway batch can hold", () => {
      const args = {
        poolId: POOL_ID,
        toCentrifugeId: "2",
        refundAddress: REFUND,
      };
      const v3_3 = { ...hubContext(), protocolVersion: PROTOCOL_VERSION_V3_3 };

      for (const ctx of [hubContext(), v3_3]) {
        expect(() =>
          repayBatch(ctx, {
            ...args,
            batch: batchFor(POOL_ID, 0xff as MessageType),
          }),
        ).toThrow(/carries no pool id/);
      }
    });

    it("refuses a pool id that disagrees with the resolved context", () => {
      expect(() =>
        repayBatch(hubContext(), {
          poolId: OTHER_POOL_ID,
          toCentrifugeId: "2",
          batch: batchFor(OTHER_POOL_ID),
          refundAddress: REFUND,
        }),
      ).toThrow(BuilderArgumentMismatchError);
    });
  });

  describe("argument refusals", () => {
    it("refuses batch bytes too short to be a batch", () => {
      // `Gateway.repay` would revert `MalformedBatch`, but only after the
      // transaction had been signed, approved and broadcast.
      for (const batch of ["0x", "0x17", "not hex"]) {
        expect(() =>
          repayBatch(hubContext(), {
            poolId: POOL_ID,
            toCentrifugeId: "2",
            batch,
            refundAddress: REFUND,
          }),
        ).toThrow(BuilderArgumentMismatchError);
      }
    });

    it("refuses a destination equal to the sending network", () => {
      // A batch is only ever underpaid on a route to ANOTHER network.
      expect(() =>
        repayBatch(hubContext(), {
          poolId: POOL_ID,
          toCentrifugeId: "1",
          batch: batchFor(POOL_ID),
          refundAddress: REFUND,
        }),
      ).toThrow(/equals the sending network/);
    });

    it("refuses a non-canonical centrifugeId rather than coercing it", () => {
      for (const toCentrifugeId of ["02", "1e3", " 2", "0", ""]) {
        expect(() =>
          repayBatch(hubContext(), {
            poolId: POOL_ID,
            toCentrifugeId,
            batch: batchFor(POOL_ID),
            refundAddress: REFUND,
          }),
        ).toThrow(BuilderArgumentMismatchError);
      }
    });

    it("refuses a malformed refund address", () => {
      expect(() =>
        repayBatch(hubContext(), {
          poolId: POOL_ID,
          toCentrifugeId: "2",
          batch: batchFor(POOL_ID),
          refundAddress: "0xnope",
        }),
      ).toThrow(BuilderArgumentMismatchError);
    });
  });
});
