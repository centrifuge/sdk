import { describe, expect, it } from "vitest";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  padHex,
} from "viem";
import { ABIS_V3_2 } from "../abis/v3_2";
import { resolveProtocolContext } from "../context";
import { BuilderArgumentMismatchError } from "../errors";
import { MessageType } from "../messages";
import rampFixtures from "./__fixtures__/register-on-off-ramp.json";
import { PROTOCOL_VERSION_V3_2, type ProtocolContext } from "../types";
import {
  builders,
  registerOnOffRamp,
  updateBalanceSheetManagers,
  updatePoolManagers,
} from "./index";

/** Pool 1 on centrifugeId 1 (Ethereum mainnet in the bundled registry). */
const POOL_ID = "281474976710657";
const OTHER_POOL_ID = "281474976710658";
const REFUND = "0x6Bcb240d3e1f1C4321ECAFFDacB45691DC03bE5D";

const ALICE = "0x19f46D8130e610C6C0f0116EA40Fb781dEFaDE93";
const BOB = "0xA4A7Bb3831958463b3FE3E27A6a160F764341953";
const CAROL = "0x000000000000000000000000000000000000dEaD";

function hubContext(): ProtocolContext {
  return resolveProtocolContext(POOL_ID, PROTOCOL_VERSION_V3_2, {
    environment: "mainnet",
  });
}

/**
 * The SDK's `addressToBytes32` (`packages/sdk/src/utils/index.ts`:
 * `address.padEnd(66, "0").toLowerCase()`) — the reference the builder must
 * match byte for byte.
 *
 * Derived from the SDK rather than restated from the builder ON PURPOSE: the
 * padding is RIGHT-padded, and writing the expectation from the implementation
 * is exactly how a left-padded encoding passes its own test and then reverts on
 * the spoke with `CastLib.PrefixNotZero` — after the cross-chain message has
 * been paid for.
 */
function bytes32(address: string): string {
  return padHex(address.toLowerCase() as `0x${string}`, {
    dir: "right",
    size: 32,
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

describe("updatePoolManagers", () => {
  it("encodes one Hub.updateHubManager per entry, sent to the hub", () => {
    const ctx = hubContext();

    const built = updatePoolManagers(ctx, {
      poolId: POOL_ID,
      updates: [
        { address: ALICE, canManage: true },
        { address: BOB, canManage: false },
      ],
    });

    expect(built.to).toBe(ctx.addresses.hub);
    expect(built.calls).toHaveLength(2);
    const inner = innerCalldata(built.data);
    expect(inner).toHaveLength(2);

    const first = decodeHub(ctx, inner[0]!);
    expect(first.functionName).toBe("updateHubManager");
    expect(first.args).toEqual([BigInt(POOL_ID), ALICE, true]);

    const second = decodeHub(ctx, inner[1]!);
    expect(second.functionName).toBe("updateHubManager");
    expect(second.args).toEqual([BigInt(POOL_ID), BOB, false]);
  });

  it("sends a single edit verbatim rather than through multicall", () => {
    const ctx = hubContext();

    const built = updatePoolManagers(ctx, {
      poolId: POOL_ID,
      updates: [{ address: ALICE, canManage: true }],
    });

    expect(built.data).toBe(
      encodeFunctionData({
        abi: ctx.abis.hub,
        functionName: "updateHubManager",
        args: [BigInt(POOL_ID), ALICE, true],
      }),
    );
  });

  it("emits every grant before every revocation, caller order within each", () => {
    // The reordering exists so that a manager revoking their OWN authority
    // cannot land before the grants that were meant to precede it — the same
    // hazard the SDK handles by moving the signer's entry last, which the
    // backend cannot do because the signer is unknown at preview time. See the
    // builder's ordering note.
    const ctx = hubContext();

    const built = updatePoolManagers(ctx, {
      poolId: POOL_ID,
      updates: [
        { address: ALICE, canManage: false },
        { address: BOB, canManage: true },
        { address: CAROL, canManage: true },
      ],
    });

    const args = innerCalldata(built.data).map(
      (data) => decodeHub(ctx, data).args,
    );
    expect(args).toEqual([
      [BigInt(POOL_ID), BOB, true],
      [BigInt(POOL_ID), CAROL, true],
      [BigInt(POOL_ID), ALICE, false],
    ]);
  });

  it("is deterministic: the same input encodes byte-identically", () => {
    // Dual-channel verification re-derives the calldata at preview, at prepare
    // and again during Fordefi's check. Any dependence on iteration order or on
    // the signer would make those three disagree.
    const ctx = hubContext();
    const args = {
      poolId: POOL_ID,
      updates: [
        { address: ALICE, canManage: false },
        { address: BOB, canManage: true },
      ],
    };

    expect(updatePoolManagers(ctx, args).data).toBe(
      updatePoolManagers(ctx, args).data,
    );
  });

  it("attaches zero value: the call dispatches no cross-chain message", () => {
    const ctx = hubContext();

    const built = updatePoolManagers(ctx, {
      poolId: POOL_ID,
      updates: [{ address: ALICE, canManage: true }],
    });

    expect(built.value).toBe(0n);
    expect(built.calls?.every((call) => call.value === 0n)).toBe(true);
  });

  it("labels each call with the direction and the target", () => {
    const ctx = hubContext();

    const built = updatePoolManagers(ctx, {
      poolId: POOL_ID,
      updates: [
        { address: ALICE, canManage: true },
        { address: BOB, canManage: false },
      ],
    });

    expect(built.calls?.map((call) => call.label)).toEqual([
      `Hub.updateHubManager (grant ${ALICE})`,
      `Hub.updateHubManager (revoke ${BOB})`,
    ]);
  });

  it("refuses an empty edit", () => {
    expect(() =>
      updatePoolManagers(hubContext(), { poolId: POOL_ID, updates: [] }),
    ).toThrow(BuilderArgumentMismatchError);
  });

  it("refuses the same address twice, case-insensitively", () => {
    expect(() =>
      updatePoolManagers(hubContext(), {
        poolId: POOL_ID,
        updates: [
          { address: ALICE.toLowerCase(), canManage: true },
          {
            address: ALICE.toUpperCase().replace("0X", "0x"),
            canManage: false,
          },
        ],
      }),
    ).toThrow(BuilderArgumentMismatchError);
  });

  it("refuses a malformed address", () => {
    expect(() =>
      updatePoolManagers(hubContext(), {
        poolId: POOL_ID,
        updates: [{ address: "0xnope", canManage: true }],
      }),
    ).toThrow(BuilderArgumentMismatchError);
  });

  it("refuses a pool id the context was not resolved for", () => {
    expect(() =>
      updatePoolManagers(hubContext(), {
        poolId: OTHER_POOL_ID,
        updates: [{ address: ALICE, canManage: true }],
      }),
    ).toThrow(BuilderArgumentMismatchError);
  });

  it("is reachable through the builders map", () => {
    expect(builders.updatePoolManagers).toBe(updatePoolManagers);
  });
});

describe("updateBalanceSheetManagers", () => {
  it("encodes one Hub.updateBalanceSheetManager per entry, sent to the hub", () => {
    const ctx = hubContext();

    const built = updateBalanceSheetManagers(ctx, {
      poolId: POOL_ID,
      refundAddress: REFUND,
      updates: [
        { centrifugeId: "2", address: ALICE, canManage: true },
        { centrifugeId: "3", address: BOB, canManage: false },
      ],
    });

    // Hub-side transaction, spoke-side effect: the call goes to the pool's home
    // chain Hub and the network travels as an argument.
    expect(built.to).toBe(ctx.addresses.hub);
    const inner = innerCalldata(built.data);
    expect(inner).toHaveLength(2);

    const first = decodeHub(ctx, inner[0]!);
    expect(first.functionName).toBe("updateBalanceSheetManager");
    expect(first.args).toEqual([
      BigInt(POOL_ID),
      2,
      bytes32(ALICE),
      true,
      REFUND,
    ]);

    const second = decodeHub(ctx, inner[1]!);
    expect(second.args).toEqual([
      BigInt(POOL_ID),
      3,
      bytes32(BOB),
      false,
      REFUND,
    ]);
  });

  it("right-pads the bytes32 manager address, matching the SDK", () => {
    // `who` is decoded on the spoke with `CastLib.toAddress`, which requires
    // the low 12 bytes to be zero. A left-padded value reverts there —
    // `PrefixNotZero` — only after the message has been paid for and
    // dispatched, which is why the direction is pinned here rather than trusted.
    const ctx = hubContext();

    const built = updateBalanceSheetManagers(ctx, {
      poolId: POOL_ID,
      refundAddress: REFUND,
      updates: [{ centrifugeId: "2", address: ALICE, canManage: true }],
    });

    const who = decodeHub(ctx, built.data).args?.[2] as string;
    expect(who).toBe(bytes32(ALICE));
    expect(who.startsWith(ALICE.toLowerCase())).toBe(true);
    expect(who.endsWith("0".repeat(24))).toBe(true);
  });

  it("preserves the caller's order exactly", () => {
    // Unlike the hub-manager builder, this one does NOT repartition: revoking
    // one's own BALANCE-SHEET authority cannot remove the hub authority the
    // transaction executes under, so the self-lockout the reordering exists to
    // prevent does not apply, and the SDK does not reorder here either.
    const ctx = hubContext();

    const built = updateBalanceSheetManagers(ctx, {
      poolId: POOL_ID,
      refundAddress: REFUND,
      updates: [
        { centrifugeId: "2", address: ALICE, canManage: false },
        { centrifugeId: "2", address: BOB, canManage: true },
      ],
    });

    const args = innerCalldata(built.data).map(
      (data) => decodeHub(ctx, data).args,
    );
    expect(args).toEqual([
      [BigInt(POOL_ID), 2, bytes32(ALICE), false, REFUND],
      [BigInt(POOL_ID), 2, bytes32(BOB), true, REFUND],
    ]);
  });

  it("allows one address on two networks", () => {
    // The uniqueness rule is on the PAIR: the same manager on two spokes is two
    // distinct grants, and refusing them would make a legitimate multi-network
    // edit impossible in one transaction.
    const ctx = hubContext();

    const built = updateBalanceSheetManagers(ctx, {
      poolId: POOL_ID,
      refundAddress: REFUND,
      updates: [
        { centrifugeId: "2", address: ALICE, canManage: true },
        { centrifugeId: "3", address: ALICE, canManage: true },
      ],
    });

    expect(innerCalldata(built.data)).toHaveLength(2);
  });

  it("declares one UpdateBalanceSheetManager message per NETWORK", () => {
    // A payable cross-chain send. The builder attaches zero itself and declares
    // a manifest for the caller to price, keyed per network rather
    // than per transaction: `MultiAdapter.estimate` charges per route, so a
    // batch touching two networks is two estimates, and two edits on one
    // network are two messages inside ONE estimate.
    const ctx = hubContext();

    const built = updateBalanceSheetManagers(ctx, {
      poolId: POOL_ID,
      refundAddress: REFUND,
      updates: [
        { centrifugeId: "2", address: ALICE, canManage: true },
        { centrifugeId: "2", address: BOB, canManage: false },
        { centrifugeId: "3", address: ALICE, canManage: true },
      ],
    });

    expect(built.value).toBe(0n);
    expect(built.calls?.every((call) => call.value === 0n)).toBe(true);
    expect(built.messages).toEqual({
      2: [
        { type: MessageType.UpdateBalanceSheetManager, poolId: POOL_ID },
        { type: MessageType.UpdateBalanceSheetManager, poolId: POOL_ID },
      ],
      3: [{ type: MessageType.UpdateBalanceSheetManager, poolId: POOL_ID }],
    });
  });

  it("declares an EMPTY manifest for updatePoolManagers, which is correct", () => {
    // The distinction the type makes explicit rather than only a comment:
    // `Hub.updateHubManager` is payable in the ABI and dispatches no
    // message, so zero is the right answer here and there is nothing to
    // estimate. An empty manifest says that; an ABSENT manifest on a
    // message-dispatching builder would mean "we forgot", and the two must not
    // be confusable.
    const built = updatePoolManagers(hubContext(), {
      poolId: POOL_ID,
      updates: [{ address: ALICE, canManage: true }],
    });

    expect(built.value).toBe(0n);
    expect(built.messages).toEqual({});
  });

  it("labels each call with the direction, the target and the network", () => {
    const ctx = hubContext();

    const built = updateBalanceSheetManagers(ctx, {
      poolId: POOL_ID,
      refundAddress: REFUND,
      updates: [
        { centrifugeId: "2", address: ALICE, canManage: true },
        { centrifugeId: "3", address: BOB, canManage: false },
      ],
    });

    expect(built.calls?.map((call) => call.label)).toEqual([
      `Hub.updateBalanceSheetManager (grant ${ALICE} on network 2)`,
      `Hub.updateBalanceSheetManager (revoke ${BOB} on network 3)`,
    ]);
  });

  it("refuses an empty edit", () => {
    expect(() =>
      updateBalanceSheetManagers(hubContext(), {
        poolId: POOL_ID,
        refundAddress: REFUND,
        updates: [],
      }),
    ).toThrow(BuilderArgumentMismatchError);
  });

  it("refuses the same (network, address) pair twice", () => {
    expect(() =>
      updateBalanceSheetManagers(hubContext(), {
        poolId: POOL_ID,
        refundAddress: REFUND,
        updates: [
          { centrifugeId: "2", address: ALICE.toLowerCase(), canManage: true },
          { centrifugeId: "2", address: ALICE, canManage: false },
        ],
      }),
    ).toThrow(BuilderArgumentMismatchError);
  });

  it("refuses a missing or malformed refund address", () => {
    expect(() =>
      updateBalanceSheetManagers(hubContext(), {
        poolId: POOL_ID,
        refundAddress: "0x0",
        updates: [{ centrifugeId: "2", address: ALICE, canManage: true }],
      }),
    ).toThrow(BuilderArgumentMismatchError);
  });

  it("refuses two entries naming the same network in different spellings", () => {
    // The duplicate rule is on the pair as the CHAIN understands it. `"2"` and
    // `"02"` are one network; a textual key would let this batch through and
    // emit two contradicting calls whose outcome depends on encoding order —
    // exactly what the rule exists to refuse. Refused here twice over: the
    // canonical-form check rejects `"02"` outright.
    expect(() =>
      updateBalanceSheetManagers(hubContext(), {
        poolId: POOL_ID,
        refundAddress: REFUND,
        updates: [
          { centrifugeId: "2", address: ALICE, canManage: true },
          { centrifugeId: "02", address: ALICE, canManage: false },
        ],
      }),
    ).toThrow(BuilderArgumentMismatchError);
  });

  it.each(["0", "00", "02", "010", "65536", "1e3", " 2", "0x2", "2.0", ""])(
    "refuses centrifugeId %j rather than coercing it",
    (centrifugeId) => {
      // `Number("1e3")` is 1000 and `Number(" 2")` is 2: either would dispatch a
      // paid cross-chain message to a network the caller never named. Refused,
      // never truncated or coerced.
      expect(() =>
        updateBalanceSheetManagers(hubContext(), {
          poolId: POOL_ID,
          refundAddress: REFUND,
          updates: [{ centrifugeId, address: ALICE, canManage: true }],
        }),
      ).toThrow(BuilderArgumentMismatchError);
    },
  );

  it("refuses a pool id the context was not resolved for", () => {
    expect(() =>
      updateBalanceSheetManagers(hubContext(), {
        poolId: OTHER_POOL_ID,
        refundAddress: REFUND,
        updates: [{ centrifugeId: "2", address: ALICE, canManage: true }],
      }),
    ).toThrow(BuilderArgumentMismatchError);
  });

  it("is reachable through the builders map", () => {
    expect(builders.updateBalanceSheetManagers).toBe(
      updateBalanceSheetManagers,
    );
  });
});

function updateContractTarget(ctx: ProtocolContext, data: string): string {
  const decoded = decodeHub(ctx, data);
  return ((decoded.args as readonly unknown[])[3] as string)
    .slice(0, 42)
    .toLowerCase();
}

describe("registerOnOffRamp", () => {
  const SC_ID = "0x00010000000000060000000000000001";
  const XLAYER = 13;
  const ARC = 14;
  const ETHEREUM = 1;
  const PLUME = 4;

  function spokeContext(centrifugeId: number): ProtocolContext {
    return resolveProtocolContext(POOL_ID, PROTOCOL_VERSION_V3_2, {
      environment: "mainnet",
      centrifugeId,
    });
  }

  function args(centrifugeId: number) {
    return {
      poolId: POOL_ID,
      scId: SC_ID,
      centrifugeId: String(centrifugeId),
      address: ALICE,
      refundAddress: REFUND,
    };
  }

  it("registers, then grants minter rights on the accounting token, where the factory is listed", () => {
    const ctx = hubContext();
    const spoke = spokeContext(XLAYER);

    const built = registerOnOffRamp(ctx, args(XLAYER), spoke);

    const expectedRegister = encodeFunctionData({
      abi: ctx.abis.hub,
      functionName: "updateBalanceSheetManager",
      args: [
        BigInt(POOL_ID),
        XLAYER,
        bytes32(ALICE) as `0x${string}`,
        true,
        REFUND,
      ],
    });
    const expectedGrant = encodeFunctionData({
      abi: ctx.abis.hub,
      functionName: "updateContract",
      args: [
        BigInt(POOL_ID),
        SC_ID,
        XLAYER,
        bytes32(spoke.addresses.accountingToken!) as `0x${string}`,
        encodeAbiParameters(
          [{ type: "bytes32" }, { type: "bool" }],
          [bytes32(ALICE) as `0x${string}`, true],
        ),
        0n,
        REFUND,
      ],
    });
    expect(built.to).toBe(ctx.addresses.hub);
    expect(innerCalldata(built.data)).toEqual([
      expectedRegister,
      expectedGrant,
    ]);
    expect(built.calls).toHaveLength(2);
  });

  it("declares one message of each type, both for the target network", () => {
    const built = registerOnOffRamp(
      hubContext(),
      args(XLAYER),
      spokeContext(XLAYER),
    );

    expect(built.messages).toEqual({
      [XLAYER]: [
        { type: MessageType.UpdateBalanceSheetManager, poolId: POOL_ID },
        { type: MessageType.TrustedContractUpdate, poolId: POOL_ID },
      ],
    });
  });

  it.each([
    ["X Layer", rampFixtures.xLayer],
    ["a legacy chain", rampFixtures.legacy],
  ])("matches the shared fixture on %s", (_name, fixture) => {
    const built = registerOnOffRamp(
      hubContext(),
      fixture.args,
      spokeContext(Number(fixture.args.centrifugeId)),
    );

    expect(built.to).toBe(fixture.hub);
    expect(built.data).toBe(fixture.data);
    expect(built.calls?.map((call) => call.data)).toEqual(
      fixture.calls.map((call) => call.data),
    );
    expect(built.calls?.map((call) => call.label)).toEqual(
      fixture.calls.map((call) => call.label),
    );
    expect(built.messages).toEqual(
      Object.fromEntries(
        Object.entries(fixture.messages).map(([network, messages]) => [
          network,
          messages.map(({ type, poolId }) => ({
            type: MessageType[type as keyof typeof MessageType],
            poolId,
          })),
        ]),
      ),
    );
  });

  it("is byte-identical to a one-entry updateBalanceSheetManagers grant on a legacy chain", () => {
    const ctx = hubContext();

    const built = registerOnOffRamp(ctx, args(PLUME), spokeContext(PLUME));
    const legacy = updateBalanceSheetManagers(ctx, {
      poolId: POOL_ID,
      refundAddress: REFUND,
      updates: [
        { centrifugeId: String(PLUME), address: ALICE, canManage: true },
      ],
    });

    expect(built.data).toBe(legacy.data);
    expect(built.messages).toEqual(legacy.messages);
    expect(built.calls).toHaveLength(1);
  });

  it("emits no updateContract when the factory is not listed", () => {
    // Ethereum lists an accountingToken; with its factory removed only the
    // factory check can keep the grant out.
    const { onOffRampFactory: _omitted, ...addresses } =
      spokeContext(ETHEREUM).addresses;
    const spoke: ProtocolContext = { ...spokeContext(ETHEREUM), addresses };
    expect(spoke.addresses.accountingToken).toBeDefined();

    const built = registerOnOffRamp(hubContext(), args(ETHEREUM), spoke);

    expect(built.calls?.map((call) => call.label)).toEqual([
      expect.stringContaining("Hub.updateBalanceSheetManager"),
    ]);
  });

  it("grants the minter on a chain that lists both ramp factories, whichever deployed the ramp", () => {
    const spoke = spokeContext(ETHEREUM);
    expect(spoke.addresses.onOffRampFactory).toBeDefined();
    expect(spoke.addresses.onOfframpManagerFactory).toBeDefined();

    const built = registerOnOffRamp(hubContext(), args(ETHEREUM), spoke);

    expect(built.calls).toHaveLength(2);
    expect(updateContractTarget(hubContext(), built.calls![1]!.data)).toBe(
      spoke.addresses.accountingToken!.toLowerCase(),
    );
  });

  it("grants the minter on Arc, which lists a factory and an accountingToken", () => {
    const spoke = spokeContext(ARC);

    const built = registerOnOffRamp(hubContext(), args(ARC), spoke);

    expect(built.calls).toHaveLength(2);
    expect(updateContractTarget(hubContext(), built.calls![1]!.data)).toBe(
      spoke.addresses.accountingToken!.toLowerCase(),
    );
  });

  it("refuses a factory chain whose context lists no accountingToken", () => {
    const { accountingToken: _omitted, ...addresses } =
      spokeContext(ARC).addresses;
    const spoke: ProtocolContext = { ...spokeContext(ARC), addresses };
    expect(spoke.addresses.onOffRampFactory).toBeDefined();

    expect(() => registerOnOffRamp(hubContext(), args(ARC), spoke)).toThrow(
      /lists an onOffRampFactory but no accountingToken/,
    );
  });

  it("targets the registry accountingToken whatever the address argument is", () => {
    const ctx = hubContext();
    const spoke = spokeContext(XLAYER);

    const built = registerOnOffRamp(
      ctx,
      { ...args(XLAYER), address: BOB },
      spoke,
    );

    const grant = decodeHub(ctx, innerCalldata(built.data)[1]!);
    expect(grant.functionName).toBe("updateContract");
    expect((grant.args as readonly unknown[])[3]).toBe(
      bytes32(spoke.addresses.accountingToken!),
    );
    expect((grant.args as readonly unknown[])[4]).toBe(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bool" }],
        [bytes32(BOB) as `0x${string}`, true],
      ),
    );
  });

  it("refuses a spoke context resolved for another network", () => {
    // Lists a factory and an accounting token, so only the network check can refuse it.
    const other: ProtocolContext = {
      ...spokeContext(XLAYER),
      centrifugeId: 99,
    };

    const attempt = () => registerOnOffRamp(hubContext(), args(XLAYER), other);

    expect(attempt).toThrow(BuilderArgumentMismatchError);
    expect(attempt).toThrow(/centrifugeId mismatch/);
  });

  it("refuses a context for another pool", () => {
    expect(() =>
      registerOnOffRamp(
        hubContext(),
        { ...args(XLAYER), poolId: OTHER_POOL_ID },
        spokeContext(XLAYER),
      ),
    ).toThrow(BuilderArgumentMismatchError);
  });

  it("refuses a malformed share class id on a factory chain", () => {
    expect(() =>
      registerOnOffRamp(
        hubContext(),
        { ...args(XLAYER), scId: "0x01" },
        spokeContext(XLAYER),
      ),
    ).toThrow(BuilderArgumentMismatchError);
  });

  it("is reachable through the builders map", () => {
    expect(builders.registerOnOffRamp).toBe(registerOnOffRamp);
  });
});
