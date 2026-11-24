import { describe, expect, it } from "vitest";
import { decodeFunctionData, encodePacked, padHex, toHex } from "viem";
import { resolveProtocolContext } from "../context";
import { BuilderArgumentMismatchError } from "../errors";
import { MessageType } from "../messages";
import { PROTOCOL_VERSION_V3_2, type ProtocolContext } from "../types";
import {
  builders,
  crosschainTransferShares,
  freezeMember,
  unfreezeMember,
  updateMember,
} from "./index";

/** Pool 1 on centrifugeId 1 (Ethereum mainnet in the bundled registry). */
const POOL_ID = "281474976710657";
const OTHER_POOL_ID = "281474976710658";
const SC_ID = "0x00010000000000010001000000000001";
const REFUND = "0x6Bcb240d3e1f1C4321ECAFFDacB45691DC03bE5D";

const INVESTOR = "0x19f46D8130e610C6C0f0116EA40Fb781dEFaDE93";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** Membership that never expires, as the management app spells it. */
const MAX_UINT32 = "4294967295";

function hubContext(): ProtocolContext {
  return resolveProtocolContext(POOL_ID, PROTOCOL_VERSION_V3_2, {
    environment: "mainnet",
  });
}

/** A context resolved for a SPOKE network, as the transfer builder needs. */
function spokeContext(centrifugeId: number): ProtocolContext {
  return resolveProtocolContext(POOL_ID, PROTOCOL_VERSION_V3_2, {
    environment: "mainnet",
    centrifugeId,
  });
}

/**
 * The SDK's `addressToBytes32` (`address.padEnd(66, "0").toLowerCase()`) — the
 * reference the builder must match byte for byte.
 *
 * Derived from the SDK rather than restated from the builder ON PURPOSE: the
 * padding is RIGHT-padded, and writing the expectation from the implementation
 * is exactly how a left-padded encoding passes its own test and then reverts on
 * the spoke with `CastLib.PrefixNotZero` — after the cross-chain message has
 * been paid for.
 */
function bytes32(address: string): `0x${string}` {
  return padHex(address.toLowerCase() as `0x${string}`, {
    dir: "right",
    size: 32,
  });
}

function decodeHub(ctx: ProtocolContext, data: string) {
  return decodeFunctionData({ abi: ctx.abis.hub, data: data as `0x${string}` });
}

describe("updateMember", () => {
  it("encodes one Hub.updateRestriction with the packed Member payload", () => {
    const ctx = hubContext();

    const built = updateMember(ctx, {
      poolId: POOL_ID,
      scId: SC_ID,
      centrifugeId: "2",
      address: INVESTOR,
      validUntil: MAX_UINT32,
      refundAddress: REFUND,
    });

    // Hub-side transaction, spoke-side effect: the target is the hub on the
    // pool's home chain and the network travels as an argument.
    expect(built.to).toBe(ctx.addresses.hub);
    expect(built.calls).toHaveLength(1);

    const decoded = decodeHub(ctx, built.data);
    expect(decoded.functionName).toBe("updateRestriction");
    expect(decoded.args).toEqual([
      BigInt(POOL_ID),
      SC_ID,
      2,
      // The SDK's payload, byte for byte:
      // encodePacked(['uint8','bytes32','uint64'], [1, addressToBytes32(a), v])
      encodePacked(
        ["uint8", "bytes32", "uint64"],
        [1, bytes32(INVESTOR), BigInt(MAX_UINT32)],
      ),
      0n,
      REFUND,
    ]);
  });

  it("right-pads the investor address, as CastLib.toAddress requires", () => {
    const ctx = hubContext();

    const built = updateMember(ctx, {
      poolId: POOL_ID,
      scId: SC_ID,
      centrifugeId: "2",
      address: INVESTOR,
      validUntil: MAX_UINT32,
      refundAddress: REFUND,
    });

    const payload = decodeHub(ctx, built.data).args?.[3] as string;
    // Byte 0 is the discriminator; bytes 1..32 are the user. Right-padded means
    // the address is in the LEADING 20 of those and the trailing 12 are zero.
    const user = `0x${payload.slice(4, 4 + 64)}`;
    expect(user).toBe(bytes32(INVESTOR));
    expect(user.endsWith("0".repeat(24))).toBe(true);
    // The failure mode this test exists for: a left-padded value reverts
    // `PrefixNotZero` on the spoke, after the message has been paid for.
    expect(user).not.toBe(
      padHex(INVESTOR.toLowerCase() as `0x${string}`, {
        dir: "left",
        size: 32,
      }),
    );
  });

  it("attaches zero value and labels the call for the decoder", () => {
    const ctx = hubContext();

    const built = updateMember(ctx, {
      poolId: POOL_ID,
      scId: SC_ID,
      centrifugeId: "2",
      address: INVESTOR,
      validUntil: MAX_UINT32,
      refundAddress: REFUND,
    });

    // Zero on the builder's own `value` and on every inner call, with the real
    // crosschain fee declared as a MANIFEST for the caller to price:
    // this package is pure and `MultiAdapter.estimate` is a chain read. The
    // manifest is what makes this zero different from `updatePoolManagers`'s.
    expect(built.value).toBe(0n);
    expect(built.calls?.[0]?.value).toBe(0n);
    expect(built.messages).toEqual({
      2: [{ type: MessageType.UpdateRestriction, poolId: POOL_ID }],
    });
    expect(built.calls?.[0]?.label).toContain("Hub.updateRestriction");
    expect(built.calls?.[0]?.label).toContain("member");
    expect(built.calls?.[0]?.label).toContain(INVESTOR);
  });

  it("refuses a foreign pool, a malformed share class and the zero address", () => {
    const ctx = hubContext();
    const base = {
      poolId: POOL_ID,
      scId: SC_ID,
      centrifugeId: "2",
      address: INVESTOR,
      validUntil: MAX_UINT32,
      refundAddress: REFUND,
    };

    expect(() => updateMember(ctx, { ...base, poolId: OTHER_POOL_ID })).toThrow(
      BuilderArgumentMismatchError,
    );
    expect(() => updateMember(ctx, { ...base, scId: "0xabc" })).toThrow(
      BuilderArgumentMismatchError,
    );
    // Not a formatting objection: the hook stores membership per account, and
    // 0x0 is nobody.
    expect(() => updateMember(ctx, { ...base, address: ZERO_ADDRESS })).toThrow(
      /zero address/,
    );
    expect(() =>
      updateMember(ctx, { ...base, refundAddress: "0xnope" }),
    ).toThrow(BuilderArgumentMismatchError);
  });

  it("refuses a non-canonical centrifugeId rather than coercing it", () => {
    const ctx = hubContext();
    const base = {
      poolId: POOL_ID,
      scId: SC_ID,
      address: INVESTOR,
      validUntil: MAX_UINT32,
      refundAddress: REFUND,
    };

    // `Number("1e3")` is 1000 and `Number(" 2")` is 2: either would send a paid
    // cross-chain message to a network the caller did not name.
    for (const centrifugeId of ["1e3", " 2", "0x2", "02", "0", "-1"]) {
      expect(() => updateMember(ctx, { ...base, centrifugeId })).toThrow(
        BuilderArgumentMismatchError,
      );
    }
  });

  it("refuses a validUntil that is not a canonical uint64", () => {
    const ctx = hubContext();
    const base = {
      poolId: POOL_ID,
      scId: SC_ID,
      centrifugeId: "2",
      address: INVESTOR,
      refundAddress: REFUND,
    };

    expect(() =>
      updateMember(ctx, { ...base, validUntil: (1n << 64n).toString() }),
    ).toThrow(BuilderArgumentMismatchError);
    expect(() => updateMember(ctx, { ...base, validUntil: "-1" })).toThrow(
      BuilderArgumentMismatchError,
    );
    expect(() => updateMember(ctx, { ...base, validUntil: "1e9" })).toThrow(
      BuilderArgumentMismatchError,
    );
  });

  it("does not consult a clock: the same input builds the same bytes", () => {
    // The `op: "add"` sugar is resolved to a constant before it gets here, and
    // an explicit expiry is caller-supplied, so this builder is a pure function
    // of its arguments — which is what makes preview, prepare and Fordefi's
    // re-derivation agree.
    const ctx = hubContext();
    const args = {
      poolId: POOL_ID,
      scId: SC_ID,
      centrifugeId: "2",
      address: INVESTOR,
      validUntil: MAX_UINT32,
      refundAddress: REFUND,
    };

    expect(updateMember(ctx, args).data).toBe(updateMember(ctx, args).data);
  });
});

describe("freezeMember / unfreezeMember", () => {
  it("differ only in the payload discriminator byte", () => {
    const ctx = hubContext();
    const args = {
      poolId: POOL_ID,
      scId: SC_ID,
      centrifugeId: "2",
      address: INVESTOR,
      refundAddress: REFUND,
    };

    const frozen = decodeHub(ctx, freezeMember(ctx, args).data);
    const thawed = decodeHub(ctx, unfreezeMember(ctx, args).data);

    expect(frozen.functionName).toBe("updateRestriction");
    expect(thawed.functionName).toBe("updateRestriction");
    expect(frozen.args?.[3]).toBe(
      encodePacked(["uint8", "bytes32"], [2, bytes32(INVESTOR)]),
    );
    expect(thawed.args?.[3]).toBe(
      encodePacked(["uint8", "bytes32"], [3, bytes32(INVESTOR)]),
    );
    // Everything else is identical — the two are the same envelope.
    expect(frozen.args?.slice(0, 3)).toEqual(thawed.args?.slice(0, 3));
    expect(frozen.args?.slice(4)).toEqual(thawed.args?.slice(4));
  });

  it("carries no validUntil: freezing does not touch membership", () => {
    // The hook keeps the frozen bit and the expiry in different parts of one
    // `hookData` word. A freeze payload that carried an expiry would reset a
    // membership nobody asked to change.
    const ctx = hubContext();
    const payload = decodeHub(
      ctx,
      freezeMember(ctx, {
        poolId: POOL_ID,
        scId: SC_ID,
        centrifugeId: "2",
        address: INVESTOR,
        refundAddress: REFUND,
      }).data,
    ).args?.[3] as string;

    // 1 discriminator byte + 32 address bytes = 33 bytes = 66 hex chars.
    expect(payload).toHaveLength(2 + 66);
  });

  it("refuses the zero address, which the hook rejects on chain", () => {
    const ctx = hubContext();

    expect(() =>
      freezeMember(ctx, {
        poolId: POOL_ID,
        scId: SC_ID,
        centrifugeId: "2",
        address: ZERO_ADDRESS,
        refundAddress: REFUND,
      }),
    ).toThrow(/zero address/);
  });

  it("labels freeze and unfreeze distinguishably for the decoder", () => {
    const ctx = hubContext();
    const args = {
      poolId: POOL_ID,
      scId: SC_ID,
      centrifugeId: "2",
      address: INVESTOR,
      refundAddress: REFUND,
    };

    expect(freezeMember(ctx, args).calls?.[0]?.label).toContain("freeze");
    expect(unfreezeMember(ctx, args).calls?.[0]?.label).toContain("unfreeze");
  });
});

describe("crosschainTransferShares", () => {
  it("targets the SOURCE network's Spoke and names the destination as an argument", () => {
    const ctx = spokeContext(2);

    const built = crosschainTransferShares(ctx, {
      poolId: POOL_ID,
      scId: SC_ID,
      destinationCentrifugeId: "1",
      receiver: INVESTOR,
      amount: "1000000",
      refundAddress: REFUND,
    });

    // Getting this the wrong way round would burn the shares on the chain they
    // were meant to arrive on.
    expect(built.to).toBe(ctx.addresses.spoke);
    expect(built.to).not.toBe(ctx.addresses.hub);

    const decoded = decodeFunctionData({
      abi: ctx.abis.spoke,
      data: built.data,
    });
    expect(decoded.functionName).toBe("crosschainTransferShares");
    expect(decoded.args).toEqual([
      1,
      BigInt(POOL_ID),
      SC_ID,
      bytes32(INVESTOR),
      1000000n,
      0n,
      0n,
      REFUND,
    ]);
  });

  it("uses the eight-argument overload so unspent gas is refundable", () => {
    // The six-argument overload takes no `refund`, so leftover cross-chain gas
    // would be stranded in the gateway. The SDK calls the same one.
    const ctx = spokeContext(2);

    const decoded = decodeFunctionData({
      abi: ctx.abis.spoke,
      data: crosschainTransferShares(ctx, {
        poolId: POOL_ID,
        scId: SC_ID,
        destinationCentrifugeId: "1",
        receiver: INVESTOR,
        amount: "1",
        refundAddress: REFUND,
      }).data,
    });

    expect(decoded.args).toHaveLength(8);
  });

  it("declares ExecuteTransferShares to the DESTINATION when sent from the hub", () => {
    // The other branch, and the reason the manifest cannot be a constant: sent
    // from the pool's own hub chain the transfer needs no spoke->hub leg, so
    // the message goes straight to the destination. Paying the hub route from
    // the hub would pay for a message to itself.
    const ctx = hubContext();

    const built = crosschainTransferShares(ctx, {
      poolId: POOL_ID,
      scId: SC_ID,
      destinationCentrifugeId: "2",
      receiver: INVESTOR,
      amount: "1",
      refundAddress: REFUND,
    });

    expect(built.messages).toEqual({
      2: [{ type: MessageType.ExecuteTransferShares, poolId: POOL_ID }],
    });
  });

  it("declares InitiateTransferShares to the HUB when sent from a spoke", () => {
    // Not "one message to the destination": from a spoke the transfer routes
    // via the hub, so the message this transaction pays for is the
    // spoke->hub leg. Paying the destination route instead would pay for a
    // message this transaction never sends and under-pay the one it does.
    const ctx = spokeContext(2);

    const built = crosschainTransferShares(ctx, {
      poolId: POOL_ID,
      scId: SC_ID,
      destinationCentrifugeId: "1",
      receiver: INVESTOR,
      amount: "1",
      refundAddress: REFUND,
    });

    // POOL_ID is pool 1 on centrifugeId 1, so the hub is network 1.
    expect(built.messages).toEqual({
      1: [{ type: MessageType.InitiateTransferShares, poolId: POOL_ID }],
    });
    expect(built.value).toBe(0n);
    expect(built.calls?.[0]?.value).toBe(0n);
  });

  it("refuses a transfer to the source network", () => {
    const ctx = spokeContext(2);

    expect(() =>
      crosschainTransferShares(ctx, {
        poolId: POOL_ID,
        scId: SC_ID,
        destinationCentrifugeId: "2",
        receiver: INVESTOR,
        amount: "1",
        refundAddress: REFUND,
      }),
    ).toThrow(/same chain/);
  });

  it("refuses a zero amount and a zero receiver", () => {
    const ctx = spokeContext(2);
    const base = {
      poolId: POOL_ID,
      scId: SC_ID,
      destinationCentrifugeId: "1",
      receiver: INVESTOR,
      amount: "1",
      refundAddress: REFUND,
    };

    expect(() =>
      crosschainTransferShares(ctx, { ...base, amount: "0" }),
    ).toThrow(/zero/);
    expect(() =>
      crosschainTransferShares(ctx, { ...base, receiver: ZERO_ADDRESS }),
    ).toThrow(/zero address/);
    // Money-shaped: a non-canonical amount is refused, never coerced.
    expect(() =>
      crosschainTransferShares(ctx, { ...base, amount: "1e6" }),
    ).toThrow(BuilderArgumentMismatchError);
    expect(() =>
      crosschainTransferShares(ctx, {
        ...base,
        amount: (1n << 128n).toString(),
      }),
    ).toThrow(BuilderArgumentMismatchError);
  });

  it("refuses a pool the context was not resolved for", () => {
    const ctx = spokeContext(2);

    expect(() =>
      crosschainTransferShares(ctx, {
        poolId: OTHER_POOL_ID,
        scId: SC_ID,
        destinationCentrifugeId: "1",
        receiver: INVESTOR,
        amount: "1",
        refundAddress: REFUND,
      }),
    ).toThrow(BuilderArgumentMismatchError);
  });
});

describe("builders barrel", () => {
  it("exposes the four Investors builders under protocol-neutral names", () => {
    // The dispatch in `ProtocolTxBuilder` reaches them through this object, so
    // a builder missing from it is unreachable over HTTP.
    expect(typeof builders.updateMember).toBe("function");
    expect(typeof builders.freezeMember).toBe("function");
    expect(typeof builders.unfreezeMember).toBe("function");
    expect(typeof builders.crosschainTransferShares).toBe("function");
    // No contract name leaks into a builder name — they stay protocol-neutral:
    // `updateRestriction` is the v3.2 function, `updateMember` the operation.
    expect(Object.keys(builders)).not.toContain("updateRestriction");
  });

  it("keeps the packed discriminators the hook reads", () => {
    // A bare assertion on the wire bytes, so a refactor of the payload helper
    // cannot silently renumber Member / Freeze / Unfreeze.
    expect(toHex(1, { size: 1 })).toBe("0x01");
    const ctx = hubContext();
    const args = {
      poolId: POOL_ID,
      scId: SC_ID,
      centrifugeId: "2",
      address: INVESTOR,
      refundAddress: REFUND,
    };
    const payloadByte = (data: `0x${string}`) =>
      (decodeHub(ctx, data).args?.[3] as string).slice(0, 4);

    expect(
      payloadByte(updateMember(ctx, { ...args, validUntil: MAX_UINT32 }).data),
    ).toBe("0x01");
    expect(payloadByte(freezeMember(ctx, args).data)).toBe("0x02");
    expect(payloadByte(unfreezeMember(ctx, args).data)).toBe("0x03");
  });
});
