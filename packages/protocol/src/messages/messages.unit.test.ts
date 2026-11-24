import { describe, expect, it } from "vitest";
import { VAULT_UPDATE_KIND } from "../builders/vaults";
import fixture from "./__fixtures__/empty-message-bytes.json";
import {
  batchKeyOf,
  emptyMessage,
  emptyMessagePayload,
  emptyMessageV3_3,
  isPoolDependent,
  isPoolDependentV3_3,
  MessageArgumentError,
  MessageType,
  MessageTypeV3_3,
  toMessageTypeV3_3,
  VAULT_UPDATE_SUBTYPE,
} from "./index";

/**
 * The BYTE-PARITY suite for `emptyMessage`.
 *
 * This is deliberately a fixture comparison and not a behavioural test.
 * `MultiAdapter.estimate` takes the payload and its answer depends on the
 * payload's CONTENT — measured live, the same message padded with `0xff`
 * instead of zero cost 50,815,112,882 wei more — so the crosschain fee is
 * deterministic only as a convention of these bytes. A test that asserted
 * "encodes a type byte then a pool id" would pass for two implementations that
 * priced the same transaction differently; only the bytes themselves catch
 * that.
 *
 * The fixture was generated from the PRE-MOVE SDK implementation
 * (`packages/sdk/src/types/transaction.ts` at `fa32208`) by
 * `scripts/gen-empty-message-fixture.mjs`, so it records what shipped rather
 * than what this file happens to produce. `packages/sdk` asserts its own
 * descriptor wrapper against the same file. Regenerating it to make a test pass
 * would silently reprice every crosschain transaction on both sides.
 */
describe("emptyMessage byte parity", () => {
  it("reproduces every fixture vector exactly", () => {
    expect(fixture.vectors.length).toBeGreaterThan(0);

    for (const vector of fixture.vectors) {
      const actual = emptyMessage(
        vector.ordinal,
        vector.poolId ?? undefined,
        vector.subtype ?? undefined,
      );
      expect(actual, `${vector.type} poolId=${vector.poolId}`).toBe(vector.hex);
    }
  });

  it("agrees with the fixture on the enum ordinals", () => {
    // The ordinals ARE the wire values: the first payload byte is the type. A
    // member inserted in the middle of the enum would renumber everything after
    // it and silently reprice (and mis-dispatch) those messages.
    for (const [name, ordinal] of Object.entries(fixture.ordinals)) {
      expect(MessageType[name as keyof typeof MessageType]).toBe(ordinal);
    }
  });

  it("pads to 250 bytes, except UpdateVault which is its real 90", () => {
    // 250 bytes is the longest fixed-size message (`NotifyShareClass`), and
    // every padded empty message is padded to it so an estimate is an UPPER
    // bound for a real message of that type rather than an under-estimate.
    //
    // `UpdateVault` is the documented exception and it is NOT padded: it is
    // encoded field by field, which comes to 1 + 8 + 16 + 16 + 32 + 1 + 16 = 90
    // bytes — its own exact on-wire size, because unlike the others it has no
    // variable body. Pinned here because the asymmetry looks like a bug and is
    // not: `GasService` prices per byte, so padding it to 250 would over-charge
    // every vault deploy and link, and shortening the others would under-charge
    // any message with a real body.
    for (const vector of fixture.vectors) {
      const bytes = (vector.hex.length - 2) / 2;
      expect(bytes, vector.type).toBe(vector.type === "UpdateVault" ? 90 : 250);
    }
  });

  it("descriptor and positional forms produce the same bytes", () => {
    expect(
      emptyMessagePayload({
        type: MessageType.RequestCallback,
        poolId: "281474976710657",
      }),
    ).toBe(emptyMessage(MessageType.RequestCallback, "281474976710657"));
  });
});

describe("emptyMessage argument refusals", () => {
  it("refuses a pool-dependent message with no pool id", () => {
    // Defaulting to 0 would price the message against pool 0's adapter set.
    // Verified on mainnet: pool 0 has a configured quorum of 2 while five of
    // twelve live pools have quorum 0, so the substitution would produce a
    // plausible non-zero fee for a pool whose messages cannot be delivered.
    expect(() => emptyMessage(MessageType.UpdateRestriction)).toThrow(
      MessageArgumentError,
    );
  });

  it("refuses a pool-independent message that was given a pool id", () => {
    expect(() => emptyMessage(MessageType.RegisterAsset, "1")).toThrow(
      MessageArgumentError,
    );
  });

  it("refuses a subtype on a message that has no subtype byte", () => {
    expect(() => emptyMessage(MessageType.UpdateRestriction, "1", 1)).toThrow(
      MessageArgumentError,
    );
  });

  it("refuses a non-canonical or oversized pool id", () => {
    expect(() => emptyMessage(MessageType.NotifyPool, "01")).toThrow(
      MessageArgumentError,
    );
    expect(() => emptyMessage(MessageType.NotifyPool, "1e3")).toThrow(
      MessageArgumentError,
    );
    expect(() =>
      emptyMessage(MessageType.NotifyPool, "18446744073709551616"),
    ).toThrow(MessageArgumentError);
  });

  it("refuses an unknown message type", () => {
    expect(() => emptyMessage(999 as MessageType)).toThrow(
      MessageArgumentError,
    );
  });
});

describe("isPoolDependent", () => {
  it("splits the enum exactly where the SDK's union did", () => {
    // The SDK's `MessageTypeWithSubType` had six bare (pool-independent)
    // variants: _Invalid..SetPoolAdapters. `SetPoolAdapters` reads pool-shaped
    // by name and is NOT pool-dependent on the wire, which is the case worth
    // pinning.
    expect(isPoolDependent(MessageType._Invalid)).toBe(false);
    expect(isPoolDependent(MessageType.SetPoolAdapters)).toBe(false);
    expect(isPoolDependent(MessageType.NotifyPool)).toBe(true);
    expect(isPoolDependent(MessageType.UntrustedContractUpdate)).toBe(true);
  });
});

describe("VAULT_UPDATE_SUBTYPE", () => {
  it("equals the calldata kind the vault builder encodes", () => {
    // Two different things that must share values: one is `Hub.updateVault`'s
    // `kind` argument, the other the subtype byte inside the payload the fee is
    // estimated from. A divergence would pay for one kind of message while
    // dispatching another.
    expect(VAULT_UPDATE_SUBTYPE).toEqual(VAULT_UPDATE_KIND);
  });

  it("matches the fixture's recorded kinds", () => {
    expect(fixture.vaultUpdateKinds).toEqual({
      DeployAndLink: VAULT_UPDATE_SUBTYPE.deployAndLink,
      Link: VAULT_UPDATE_SUBTYPE.link,
      Unlink: VAULT_UPDATE_SUBTYPE.unlink,
    });
  });
});

describe("batchKeyOf", () => {
  it("reads the uint64 pool id out of bytes 1..9", () => {
    const payload = emptyMessage(
      MessageType.RequestCallback,
      "281474976710657",
    );
    expect(batchKeyOf(payload)).toBe("0001000000000001");
  });

  it("groups two messages of one pool under one key and two pools under two", () => {
    const poolA = emptyMessage(MessageType.RequestCallback, "281474976710657");
    const poolAOther = emptyMessage(MessageType.NotifyPool, "281474976710657");
    const poolB = emptyMessage(MessageType.RequestCallback, "281474976710658");

    expect(batchKeyOf(poolA)).toBe(batchKeyOf(poolAOther));
    expect(batchKeyOf(poolA)).not.toBe(batchKeyOf(poolB));
  });

  it("refuses a payload too short to contain a pool id", () => {
    // A truncated key would silently merge two pools' messages into one batch
    // and price them against one adapter set.
    expect(() => batchKeyOf("0x17")).toThrow(MessageArgumentError);
    expect(() => batchKeyOf("not hex")).toThrow(MessageArgumentError);
  });
});

describe("v3.3 message types", () => {
  it("pins the ordinals of MessageLib.MessageType at v3.3.0", () => {
    expect(MessageTypeV3_3.SetPoolAdapters).toBe(4);
    expect(MessageTypeV3_3.NotifyPool).toBe(5);
    expect(MessageTypeV3_3.UpdateVault).toBe(13);
    expect(MessageTypeV3_3.Request).toBe(16);
    expect(MessageTypeV3_3.ManagerCallFromHub).toBe(20);
    expect(MessageTypeV3_3.UpdateManager).toBe(21);
    expect(MessageTypeV3_3.UnauthorizeSpokeCall).toBe(24);
  });

  it("maps a surviving v3.2 type to its renumbered v3.3 ordinal", () => {
    expect(toMessageTypeV3_3(MessageType.NotifyPool)).toBe(
      MessageTypeV3_3.NotifyPool,
    );
    expect(toMessageTypeV3_3(MessageType.Request)).toBe(
      MessageTypeV3_3.Request,
    );
    expect(toMessageTypeV3_3(MessageType.UpdateHoldingAmount)).toBe(
      MessageTypeV3_3.UpdateAssets,
    );
  });

  it("refuses a v3.2 type v3.3 removed", () => {
    for (const type of [
      MessageType.TrustedContractUpdate,
      MessageType.UpdateBalanceSheetManager,
      MessageType.RecoverTokens,
      MessageType.SetMaxSharePriceAge,
    ]) {
      expect(() => toMessageTypeV3_3(type)).toThrow(MessageArgumentError);
    }
  });

  it("splits pool dependency at NotifyPool", () => {
    expect(isPoolDependentV3_3(MessageTypeV3_3.SetPoolAdapters)).toBe(false);
    expect(isPoolDependentV3_3(MessageTypeV3_3.NotifyPool)).toBe(true);
  });

  it("pads to 250 bytes, and UpdateVault to 92 with its empty payload length", () => {
    const length = (hex: string) => (hex.length - 2) / 2;
    expect(length(emptyMessageV3_3(MessageTypeV3_3.RegisterAsset))).toBe(250);
    const managerCall = emptyMessageV3_3(
      MessageTypeV3_3.ManagerCallFromHub,
      "281474976710657",
    );
    expect(length(managerCall)).toBe(250);
    expect(managerCall.slice(0, 4)).toBe("0x14");
    expect(batchKeyOf(managerCall)).toBe("0001000000000001");
    const vault = emptyMessageV3_3(
      MessageTypeV3_3.UpdateVault,
      "281474976710657",
      VAULT_UPDATE_SUBTYPE.link,
    );
    expect(length(vault)).toBe(92);
    expect(vault.slice(0, 4)).toBe("0x0d");
  });

  it("pads NotifyShareClass past the extra gas limit GasService reads at byte 250", () => {
    const message = emptyMessageV3_3(
      MessageTypeV3_3.NotifyShareClass,
      "281474976710657",
    );
    expect((message.length - 2) / 2).toBe(268);
  });

  it("carries the configured pool at offset 1 of SetPoolAdapters, which MultiAdapter routes on", () => {
    const message = emptyMessageV3_3(
      MessageTypeV3_3.SetPoolAdapters,
      "281474976710657",
    );
    expect((message.length - 2) / 2).toBe(250);
    expect(batchKeyOf(message)).toBe("0001000000000001");
    expect(batchKeyOf(emptyMessageV3_3(MessageTypeV3_3.SetPoolAdapters))).toBe(
      "0000000000000000",
    );
  });

  it("refuses the wrong pool id or subtype combination", () => {
    expect(() => emptyMessageV3_3(MessageTypeV3_3.RegisterAsset, "1")).toThrow(
      MessageArgumentError,
    );
    expect(() => emptyMessageV3_3(MessageTypeV3_3.NotifyPool)).toThrow(
      MessageArgumentError,
    );
    expect(() => emptyMessageV3_3(MessageTypeV3_3.NotifyPool, "1", 1)).toThrow(
      MessageArgumentError,
    );
    expect(() => emptyMessageV3_3(MessageTypeV3_3._Invalid)).toThrow(
      MessageArgumentError,
    );
  });
});

describe("emptyMessageV3_3 extraGasLimit", () => {
  const poolId = "281474976710689";
  const read = (hex: string, offset: number) =>
    BigInt(`0x${hex.slice(2 + offset * 2, 2 + offset * 2 + 32)}`);

  it("writes the extra gas where MessageLib reads it, and changes nothing else", () => {
    for (const [type, offset] of [
      [MessageTypeV3_3.InitiateTransferShares, 91],
      [MessageTypeV3_3.ExecuteTransferShares, 73],
      [MessageTypeV3_3.ManagerCallFromHub, 41],
    ] as const) {
      const empty = emptyMessageV3_3(type, poolId);
      const priced = emptyMessageV3_3(type, poolId, undefined, 123_456n);
      expect(priced.length).toBe(empty.length);
      expect(read(priced, offset)).toBe(123_456n);
      const without = `${priced.slice(0, 2 + offset * 2)}${"0".repeat(32)}${priced.slice(2 + offset * 2 + 32)}`;
      expect(without).toBe(empty);
      expect(emptyMessageV3_3(type, poolId, undefined, 0n)).toBe(empty);
    }
  });

  it("refuses an extra gas limit on any other message, and one above uint128", () => {
    expect(() =>
      emptyMessageV3_3(MessageTypeV3_3.NotifyPool, poolId, undefined, 1n),
    ).toThrow(MessageArgumentError);
    expect(() =>
      emptyMessageV3_3(
        MessageTypeV3_3.ExecuteTransferShares,
        poolId,
        undefined,
        1n << 128n,
      ),
    ).toThrow(MessageArgumentError);
  });
});
