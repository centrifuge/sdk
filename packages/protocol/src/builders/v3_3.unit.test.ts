import { describe, expect, it } from "vitest";
import {
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  padHex,
} from "viem";
import { ABIS_V3_3 } from "../abis/v3_3";
import { resolveProtocolContext } from "../context";
import {
  BuilderArgumentMismatchError,
  UnknownProtocolVersionError,
  UnsupportedForProtocolVersionError,
} from "../errors";
import { PROTOCOL_VERSION_V3_2, type ProtocolContext } from "../types";
import fixtures from "./__fixtures__/v3_3-builders.fixtures.json";
import {
  resolveV3_3TestContext,
  V3_3_POOL_ID,
  V3_3_SPOKE_CENTRIFUGE_ID,
} from "./__fixtures__/v3_3-registry";
import {
  builders,
  decodeContractUpdates,
  decodeManagerCalls,
  encodeBatchCalldata,
  encodeAdapterFailoverStewardPayload,
  encodeBaseTransferHookPayload,
  encodeBatchRequestManagerPayload,
  encodeOnchainPMPolicyPayload,
  encodeOnOffRampPayload,
  encodeOracleValuationFeederPayload,
  encodeShareManagerPayload,
  encodeShareTokenRegistrarPayload,
  encodeSyncManagerPayload,
  hubManagerCall,
  notifyShareClass,
  shareManagerCall,
  updateManager,
  updateVault,
} from "./index";

const POOL_ID = V3_3_POOL_ID;
const SC_ID = "0x00010000000000010001000000000001";
const ASSET_ID = ((1n << 112n) + 1n).toString();
const SPOKE_ASSET_ID = ((2n << 112n) + 1n).toString();
const REFUND = "0x6Bcb240d3e1f1C4321ECAFFDacB45691DC03bE5D";
const WHO = "0x19f46D8130e610C6C0f0116EA40Fb781dEFaDE93";
const OTHER = "0xA4A7Bb3831958463b3FE3E27A6a160F764341953";
const PRICE = "1000000000000000000";

const hub = resolveV3_3TestContext();
const spoke = resolveV3_3TestContext(POOL_ID, V3_3_SPOKE_CENTRIFUGE_ID);

function hub32(): ProtocolContext {
  return resolveProtocolContext(POOL_ID, PROTOCOL_VERSION_V3_2, {
    environment: "testnet",
  });
}

function bytes32(address: string) {
  return padHex(address.toLowerCase() as `0x${string}`, {
    dir: "right",
    size: 32,
  });
}

/** Decode one inner call against the v3.3 Hub ABI. */
function decodeHub(data: `0x${string}`) {
  return decodeFunctionData({ abi: ABIS_V3_3.Hub, data });
}

/** The inner calls of a batch, or the single call verbatim. */
function innerCalls(data: `0x${string}`): readonly `0x${string}`[] {
  if (!data.startsWith("0xac9650d8")) {
    return [data];
  }
  const decoded = decodeFunctionData({ abi: ABIS_V3_3.Multicall, data });
  return decoded.args[0] as readonly `0x${string}`[];
}

describe("v3.3 builders replay the fixtures built against the testnet layer", () => {
  const replay: Record<string, () => ReturnType<typeof hubManagerCall>> = {
    "hubManagerCall.syncManagerMaxReserve": () =>
      hubManagerCall(hub, {
        poolId: POOL_ID,
        centrifugeId: "1",
        target: hub.addresses.syncManager!,
        payload: encodeSyncManagerPayload({
          kind: "maxReserve",
          scId: SC_ID,
          assetId: ASSET_ID,
          maxReserve: "5000000",
        }),
        label: "SyncManager.MaxReserve",
        refundAddress: REFUND,
      }),
    "updateManager.spokeGrant": () =>
      updateManager(hub, {
        poolId: POOL_ID,
        centrifugeId: "2",
        kind: "spoke",
        address: WHO,
        canManage: true,
        refundAddress: REFUND,
      }),
    "updateVault.deployAndLink": () =>
      updateVault(hub, {
        poolId: POOL_ID,
        scId: SC_ID,
        assetId: SPOKE_ASSET_ID,
        vaultOrFactory: spoke.addresses.asyncVaultFactory!,
        kind: "deployAndLink",
        refundAddress: REFUND,
        spoke,
        vaultAddress: WHO,
      }),
    notifyShareClass: () =>
      notifyShareClass(hub, {
        poolId: POOL_ID,
        scId: SC_ID,
        centrifugeId: "2",
        registrarAddress: spoke.addresses.shareTokenRegistrar!,
        refundAddress: REFUND,
      }),
    "deployVault.syncDepositLocal": () =>
      builders.deployVault(hub, {
        poolId: POOL_ID,
        scId: SC_ID,
        assetId: ASSET_ID,
        kind: "syncDeposit",
        refundAddress: REFUND,
        spoke: hub,
        vaultAddress: WHO,
      }),
    "depositHolding.wallet": () =>
      builders.depositHolding(spoke, {
        poolId: POOL_ID,
        scId: SC_ID,
        asset: { assetId: SPOKE_ASSET_ID, address: WHO, assetTokenId: null },
        amount: "1000000",
        source: "wallet",
      }),
    "createHolding.asset": () =>
      builders.createHolding(hub, {
        poolId: POOL_ID,
        scId: SC_ID,
        assetId: SPOKE_ASSET_ID,
        valuationAddress: hub.addresses.identityValuation!,
        isLiability: false,
        accounts: { asset: "1", equity: "2", gain: "3", loss: "4" },
      }),
    crosschainTransferShares: () =>
      builders.crosschainTransferShares(spoke, {
        poolId: POOL_ID,
        scId: SC_ID,
        destinationCentrifugeId: "1",
        receiver: OTHER,
        amount: "1000",
        refundAddress: REFUND,
        senderAddress: WHO,
      }),
    updateBalanceSheetManagers: () =>
      builders.updateBalanceSheetManagers(hub, {
        poolId: POOL_ID,
        refundAddress: REFUND,
        updates: [
          { centrifugeId: "2", address: WHO, canManage: true },
          { centrifugeId: "2", address: OTHER, canManage: false },
        ],
      }),
    "registerOnOffRamp.local": () =>
      builders.registerOnOffRamp(
        hub,
        {
          poolId: POOL_ID,
          scId: SC_ID,
          centrifugeId: "1",
          address: WHO,
          refundAddress: REFUND,
        },
        hub,
      ),
    approveDeposits: () =>
      builders.approveDeposits(hub, {
        poolId: POOL_ID,
        scId: SC_ID,
        refundAddress: REFUND,
        approvals: [
          {
            assetId: SPOKE_ASSET_ID,
            epochId: "1",
            approvedAssetAmount: "1000000",
            pricePoolPerAsset: PRICE,
          },
        ],
      }),
    issueShares: () =>
      builders.issueShares(hub, {
        poolId: POOL_ID,
        scId: SC_ID,
        refundAddress: REFUND,
        issuances: [
          {
            assetId: SPOKE_ASSET_ID,
            fromEpochId: "1",
            pricesPoolPerShare: [PRICE, PRICE],
          },
        ],
      }),
    "notifyOrderClaims.deposit": () =>
      builders.notifyOrderClaims(hub, {
        poolId: POOL_ID,
        scId: SC_ID,
        kind: "deposit",
        refundAddress: REFUND,
        notify: [
          {
            assetId: SPOKE_ASSET_ID,
            notifications: [{ investor: WHO, maxClaims: 2, requestId: "7" }],
          },
        ],
      }),
  };

  for (const fixture of fixtures.fixtures.filter((f) => f.name in replay)) {
    it(`${fixture.name} still encodes the committed bytes`, () => {
      const built = replay[fixture.name]!();
      expect(built.to).toBe(fixture.to);
      expect(built.data).toBe(fixture.data);
      expect((built.calls ?? []).map((call) => call.label)).toEqual(
        fixture.labels,
      );
      expect(built.messages !== undefined).toBe(fixture.hasMessages);
    });
  }

  it("covers every fixture with a replay", () => {
    const uncovered = fixtures.fixtures
      .map((f) => f.name)
      .filter((name) => !(name in replay));
    expect(uncovered).toEqual([
      "hubManagerCall.registrarSetHook",
      "hubManagerCall.registrarSetVault",
      "hubManagerCall.onOffRampOnramp",
      "hubManagerCall.onOffRampRelayer",
      "hubManagerCall.queueManager",
      "hubManagerCall.oracleFeeder",
      "hubManagerCall.accountingTokenMinter",
      "hubManagerCall.tokenBridgeGasLimits",
      "hubManagerCall.brmForceCancelDeposit",
      "hubManagerCall.remoteSyncManager",
      "updateManager.bridgerRevoke",
      "updateVault.link",
      "updateVault.unlink",
      "deployVault.async",
      "deployVault.syncDepositRemote",
      "updateVaults.linkAndUnlink",
      "withdrawHolding.wallet",
      "registerOnOffRamp.remote",
      "approveRedeems",
      "revokeShares",
    ]);
  });
});

describe("hubManagerCall", () => {
  it("encodes Hub.managerCall with the target as bytes32 and the payload verbatim", () => {
    const payload = encodeSyncManagerPayload({
      kind: "maxReserve",
      scId: SC_ID,
      assetId: ASSET_ID,
      maxReserve: "5000000",
    });
    const built = hubManagerCall(hub, {
      poolId: POOL_ID,
      centrifugeId: "1",
      target: hub.addresses.syncManager!,
      payload,
      label: "SyncManager.MaxReserve",
      refundAddress: REFUND,
    });
    const decoded = decodeHub(built.data);
    expect(decoded.functionName).toBe("managerCall");
    expect(decoded.args).toEqual([
      BigInt(POOL_ID),
      1,
      bytes32(hub.addresses.syncManager!),
      payload,
      0n,
      0n,
      REFUND,
    ]);
    expect(built.to).toBe(hub.addresses.hub);
    expect(built.value).toBe(0n);
    expect(built.messages).toBeUndefined();
  });

  it("forwards localValue as the call's own value", () => {
    const built = hubManagerCall(hub, {
      poolId: POOL_ID,
      centrifugeId: "1",
      target: WHO,
      payload: "0x",
      label: "x",
      refundAddress: REFUND,
      localValue: "12",
    });
    expect(built.value).toBe(12n);
    expect(decodeHub(built.data).args?.[5]).toBe(12n);
  });

  it("refuses a 3.2 context with the typed refusal", () => {
    expect(() =>
      hubManagerCall(hub32(), {
        poolId: POOL_ID,
        centrifugeId: "1",
        target: WHO,
        payload: "0x",
        label: "x",
        refundAddress: REFUND,
      }),
    ).toThrow(UnsupportedForProtocolVersionError);
  });

  it("raises the typed refusal as an UnknownProtocolVersionError subclass, so private-api denies instead of failing", () => {
    const error = (() => {
      try {
        hubManagerCall(hub32(), {
          poolId: POOL_ID,
          centrifugeId: "1",
          target: WHO,
          payload: "0x",
          label: "x",
          refundAddress: REFUND,
        });
      } catch (e) {
        return e as Error;
      }
    })()!;
    expect(error).toBeInstanceOf(UnsupportedForProtocolVersionError);
    expect(error).toBeInstanceOf(UnknownProtocolVersionError);
    expect(error.message).toContain(
      "hubManagerCall is not available on protocol version 3.2",
    );
  });

  it("refuses a pool id that is not the context's", () => {
    expect(() =>
      hubManagerCall(hub, {
        poolId: "281474976710658",
        centrifugeId: "1",
        target: WHO,
        payload: "0x",
        label: "x",
        refundAddress: REFUND,
      }),
    ).toThrow(BuilderArgumentMismatchError);
  });
});

describe("fromHub payload encoders match the targets' decode layouts", () => {
  it("SyncManager: (bytes16 scId, uint8 kind, ...)", () => {
    const payload = encodeSyncManagerPayload({
      kind: "maxReserve",
      scId: SC_ID,
      assetId: ASSET_ID,
      maxReserve: "7",
    });
    expect(
      decodeAbiParameters(
        [
          { type: "bytes16" },
          { type: "uint8" },
          { type: "uint128" },
          { type: "uint128" },
        ],
        payload,
      ),
    ).toEqual([SC_ID, 1, BigInt(ASSET_ID), 7n]);
    const valuation = encodeSyncManagerPayload({
      kind: "valuation",
      scId: SC_ID,
      valuation: WHO,
    });
    expect(
      decodeAbiParameters(
        [{ type: "bytes16" }, { type: "uint8" }, { type: "bytes32" }],
        valuation,
      ),
    ).toEqual([SC_ID, 0, bytes32(WHO)]);
  });

  it("ShareTokenRegistrar: (uint8 kind, bytes16 scId, ...)", () => {
    expect(
      decodeAbiParameters(
        [{ type: "uint8" }, { type: "bytes16" }, { type: "address" }],
        encodeShareTokenRegistrarPayload({
          kind: "setHook",
          scId: SC_ID,
          hook: WHO,
        }),
      ),
    ).toEqual([0, SC_ID, WHO]);
    expect(
      decodeAbiParameters(
        [
          { type: "uint8" },
          { type: "bytes16" },
          { type: "uint128" },
          { type: "address" },
        ],
        encodeShareTokenRegistrarPayload({
          kind: "setVault",
          scId: SC_ID,
          assetId: ASSET_ID,
          vault: WHO,
        }),
      ),
    ).toEqual([1, SC_ID, BigInt(ASSET_ID), WHO]);
    expect(
      decodeAbiParameters(
        [
          { type: "uint8" },
          { type: "bytes16" },
          { type: "address" },
          { type: "bool" },
        ],
        encodeShareTokenRegistrarPayload({
          kind: "updateWard",
          scId: SC_ID,
          ward: WHO,
          authorized: false,
        }),
      ),
    ).toEqual([2, SC_ID, WHO, false]);
  });

  it("BaseTransferHook UpdateHookManager: (bytes16 scId, uint8 kind, bytes32 manager, bool canManage)", () => {
    const layout = [
      { type: "bytes16" },
      { type: "uint8" },
      { type: "bytes32" },
      { type: "bool" },
    ] as const;
    expect(
      decodeAbiParameters(
        layout,
        encodeBaseTransferHookPayload({
          kind: "updateHookManager",
          scId: SC_ID,
          manager: WHO,
          canManage: true,
        }),
      ),
    ).toEqual([SC_ID, 0, bytes32(WHO), true]);
    expect(
      decodeAbiParameters(
        layout,
        encodeBaseTransferHookPayload({
          kind: "updateHookManager",
          scId: SC_ID,
          manager: WHO,
          canManage: false,
        }),
      ),
    ).toEqual([SC_ID, 0, bytes32(WHO), false]);
  });

  it("BaseTransferHook UpdateHookManager refuses a manager that is not an address", () => {
    expect(() =>
      encodeBaseTransferHookPayload({
        kind: "updateHookManager",
        scId: SC_ID,
        manager: "0x1234",
        canManage: true,
      }),
    ).toThrow(BuilderArgumentMismatchError);
  });

  it("OnOffRamp: (uint8 kind, ...) with no share class", () => {
    expect(
      decodeAbiParameters(
        [{ type: "uint8" }, { type: "uint128" }, { type: "bool" }],
        encodeOnOffRampPayload({
          kind: "onramp",
          assetId: ASSET_ID,
          enabled: true,
        }),
      ),
    ).toEqual([0, BigInt(ASSET_ID), true]);
    expect(
      decodeAbiParameters(
        [{ type: "uint8" }, { type: "bytes32" }, { type: "bool" }],
        encodeOnOffRampPayload({
          kind: "relayer",
          relayer: WHO,
          enabled: true,
        }),
      ),
    ).toEqual([1, bytes32(WHO), true]);
    expect(
      decodeAbiParameters(
        [
          { type: "uint8" },
          { type: "uint128" },
          { type: "bytes32" },
          { type: "bool" },
        ],
        encodeOnOffRampPayload({
          kind: "offramp",
          assetId: ASSET_ID,
          receiver: WHO,
          enabled: false,
        }),
      ),
    ).toEqual([2, BigInt(ASSET_ID), bytes32(WHO), false]);
    expect(
      decodeAbiParameters(
        [
          { type: "uint8" },
          { type: "uint128" },
          { type: "uint128" },
          { type: "bytes32" },
        ],
        encodeOnOffRampPayload({
          kind: "withdraw",
          assetId: ASSET_ID,
          amount: "9",
          receiver: WHO,
        }),
      ),
    ).toEqual([3, BigInt(ASSET_ID), 9n, bytes32(WHO)]);
  });

  it("OnchainPM policy: (bytes32 strategist, bytes32 root)", () => {
    const root = `0x${"ab".repeat(32)}` as const;
    expect(
      decodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }],
        encodeOnchainPMPolicyPayload({ strategist: WHO, root }),
      ),
    ).toEqual([bytes32(WHO), root]);
    expect(() =>
      encodeOnchainPMPolicyPayload({ strategist: WHO, root: "0x1234" }),
    ).toThrow(BuilderArgumentMismatchError);
  });

  it("ShareManager: (uint8 kind, bytes16 scId, bytes32 account, uint128 shares)", () => {
    const layout = [
      { type: "uint8" },
      { type: "bytes16" },
      { type: "bytes32" },
      { type: "uint128" },
    ] as const;
    expect(
      decodeAbiParameters(
        layout,
        encodeShareManagerPayload({
          kind: "issue",
          scId: SC_ID,
          account: WHO,
          shares: "5",
        }),
      ),
    ).toEqual([0, SC_ID, bytes32(WHO), 5n]);
    expect(
      decodeAbiParameters(
        layout,
        encodeShareManagerPayload({
          kind: "revoke",
          scId: SC_ID,
          account: WHO,
          shares: "5",
        }),
      ),
    ).toEqual([1, SC_ID, bytes32(WHO), 5n]);
    expect(() =>
      encodeShareManagerPayload({
        kind: "issue",
        scId: SC_ID,
        account: WHO,
        shares: "0",
      }),
    ).toThrow(BuilderArgumentMismatchError);
  });

  it("OracleValuation feeder: (uint16 centrifugeId, bytes32 feeder, bool canFeed)", () => {
    expect(
      decodeAbiParameters(
        [{ type: "uint16" }, { type: "bytes32" }, { type: "bool" }],
        encodeOracleValuationFeederPayload({
          centrifugeId: "2",
          feeder: WHO,
          canFeed: true,
        }),
      ),
    ).toEqual([2, bytes32(WHO), true]);
  });

  it("AdapterFailover steward: (uint8 UpdateSteward = 1, address who, bool isSteward), sent to the spoke's AdapterFailover", () => {
    const layout = [
      { type: "uint8" },
      { type: "address" },
      { type: "bool" },
    ] as const;
    const payload = encodeAdapterFailoverStewardPayload({
      who: WHO,
      isSteward: true,
    });
    expect(decodeAbiParameters(layout, payload)).toEqual([1, WHO, true]);
    expect(
      decodeAbiParameters(
        layout,
        encodeAdapterFailoverStewardPayload({ who: WHO, isSteward: false }),
      ),
    ).toEqual([1, WHO, false]);
    expect(() =>
      encodeAdapterFailoverStewardPayload({ who: "0x1234", isSteward: true }),
    ).toThrow(BuilderArgumentMismatchError);

    const target = spoke.addresses.adapterFailover!;
    const built = hubManagerCall(hub, {
      poolId: POOL_ID,
      centrifugeId: String(V3_3_SPOKE_CENTRIFUGE_ID),
      target,
      payload,
      label: "AdapterFailover.UpdateSteward",
      refundAddress: REFUND,
    });
    expect(built.value).toBe(0n);
    expect(built.calls?.[0]?.label).toBe("AdapterFailover.UpdateSteward");
    const decoded = decodeManagerCalls("3.3", built.data);
    expect(decoded).toMatchObject({
      ok: true,
      calls: [{ target: bytes32(target), payload }],
    });
  });

  it("BatchRequestManager: (uint8 kind, bytes16 scId, ...) per action", () => {
    const approve = encodeBatchRequestManagerPayload({
      kind: "approveDeposits",
      scId: SC_ID,
      assetId: SPOKE_ASSET_ID,
      epochId: "3",
      approvedAssetAmount: "10",
      pricePoolPerAsset: PRICE,
      refundAddress: REFUND,
    });
    expect(
      decodeAbiParameters(
        [
          { type: "uint8" },
          { type: "bytes16" },
          { type: "uint128" },
          { type: "uint32" },
          { type: "uint128" },
          { type: "uint128" },
          { type: "address" },
        ],
        approve,
      ),
    ).toEqual([
      1,
      SC_ID,
      BigInt(SPOKE_ASSET_ID),
      3,
      10n,
      BigInt(PRICE),
      REFUND,
    ]);
    const redeems = encodeBatchRequestManagerPayload({
      kind: "approveRedeems",
      scId: SC_ID,
      assetId: SPOKE_ASSET_ID,
      epochId: "3",
      approvedShareAmount: "10",
      pricePoolPerAsset: PRICE,
    });
    expect(
      decodeAbiParameters(
        [
          { type: "uint8" },
          { type: "bytes16" },
          { type: "uint128" },
          { type: "uint32" },
          { type: "uint128" },
          { type: "uint128" },
        ],
        redeems,
      ),
    ).toEqual([2, SC_ID, BigInt(SPOKE_ASSET_ID), 3, 10n, BigInt(PRICE)]);
    const issue = encodeBatchRequestManagerPayload({
      kind: "issueShares",
      scId: SC_ID,
      assetId: SPOKE_ASSET_ID,
      epochId: "3",
      pricePoolPerShare: PRICE,
      refundAddress: REFUND,
    });
    expect(
      decodeAbiParameters(
        [
          { type: "uint8" },
          { type: "bytes16" },
          { type: "uint128" },
          { type: "uint32" },
          { type: "uint128" },
          { type: "uint128" },
          { type: "address" },
        ],
        issue,
      ),
    ).toEqual([3, SC_ID, BigInt(SPOKE_ASSET_ID), 3, BigInt(PRICE), 0n, REFUND]);
    const cancel = encodeBatchRequestManagerPayload({
      kind: "forceCancelRedeemRequest",
      scId: SC_ID,
      investor: WHO,
      assetId: SPOKE_ASSET_ID,
      refundAddress: REFUND,
    });
    expect(
      decodeAbiParameters(
        [
          { type: "uint8" },
          { type: "bytes16" },
          { type: "bytes32" },
          { type: "uint128" },
          { type: "address" },
        ],
        cancel,
      ),
    ).toEqual([6, SC_ID, bytes32(WHO), BigInt(SPOKE_ASSET_ID), REFUND]);
  });

  it("refuses an epoch of zero", () => {
    expect(() =>
      encodeBatchRequestManagerPayload({
        kind: "approveRedeems",
        scId: SC_ID,
        assetId: SPOKE_ASSET_ID,
        epochId: "0",
        approvedShareAmount: "1",
        pricePoolPerAsset: PRICE,
      }),
    ).toThrow(BuilderArgumentMismatchError);
  });
});

describe("updateManager", () => {
  it("encodes the ManagerKind ordinal and the right-padded address", () => {
    const built = updateManager(hub, {
      poolId: POOL_ID,
      centrifugeId: "2",
      kind: "bridger",
      address: WHO,
      canManage: false,
      refundAddress: REFUND,
    });
    expect(decodeHub(built.data)).toEqual({
      functionName: "updateManager",
      args: [BigInt(POOL_ID), 2, 3, bytes32(WHO), false, REFUND],
    });
  });

  it("refuses a 3.2 context", () => {
    expect(() =>
      updateManager(hub32(), {
        poolId: POOL_ID,
        centrifugeId: "2",
        kind: "spoke",
        address: WHO,
        canManage: true,
        refundAddress: REFUND,
      }),
    ).toThrow(UnsupportedForProtocolVersionError);
  });
});

describe("version-shaped Hub calls", () => {
  it("updateVault takes the payload argument on 3.3 and refuses it on 3.2", () => {
    const built = updateVault(hub, {
      poolId: POOL_ID,
      scId: SC_ID,
      assetId: SPOKE_ASSET_ID,
      vaultOrFactory: WHO,
      kind: "link",
      refundAddress: REFUND,
      payload: "0x1234",
      spoke,
    });
    const [first] = innerCalls(built.data);
    expect(decodeHub(first!).args).toEqual([
      BigInt(POOL_ID),
      SC_ID,
      BigInt(SPOKE_ASSET_ID),
      bytes32(WHO),
      1,
      "0x1234",
      0n,
      REFUND,
    ]);
    const legacy = updateVault(hub32(), {
      poolId: POOL_ID,
      scId: SC_ID,
      assetId: SPOKE_ASSET_ID,
      vaultOrFactory: WHO,
      kind: "link",
      refundAddress: REFUND,
    });
    expect(
      decodeFunctionData({ abi: hub32().abis.hub!, data: legacy.data }).args,
    ).toHaveLength(7);
    expect(() =>
      updateVault(hub32(), {
        poolId: POOL_ID,
        scId: SC_ID,
        assetId: SPOKE_ASSET_ID,
        vaultOrFactory: WHO,
        kind: "link",
        refundAddress: REFUND,
        payload: "0x",
      }),
    ).toThrow(BuilderArgumentMismatchError);
  });

  it("notifyShareClass carries the registrar, payload and gas limit on 3.3", () => {
    const built = notifyShareClass(hub, {
      poolId: POOL_ID,
      scId: SC_ID,
      centrifugeId: "2",
      registrarAddress: WHO,
      refundAddress: REFUND,
    });
    expect(decodeHub(built.data).args).toEqual([
      BigInt(POOL_ID),
      SC_ID,
      2,
      bytes32(WHO),
      "0x",
      0n,
      REFUND,
    ]);
    const legacy = notifyShareClass(hub32(), {
      poolId: POOL_ID,
      scId: SC_ID,
      centrifugeId: "2",
      registrarAddress: WHO,
      refundAddress: REFUND,
    });
    expect(
      decodeFunctionData({ abi: hub32().abis.hub!, data: legacy.data }).args,
    ).toHaveLength(5);
  });

  it("deployVault routes the max reserve through managerCall, sets the vault pointer last, and reaches a remote spoke", () => {
    const built = builders.deployVault(hub, {
      poolId: POOL_ID,
      scId: SC_ID,
      assetId: SPOKE_ASSET_ID,
      kind: "syncDeposit",
      refundAddress: REFUND,
      spoke,
      vaultAddress: WHO,
    });
    const decoded = innerCalls(built.data).map((call) => decodeHub(call));
    expect(decoded.map((call) => call.functionName)).toEqual([
      "managerCall",
      "notifyAssetPrice",
      "updateVault",
      "managerCall",
    ]);
    expect(decoded[0]!.args?.[1]).toBe(V3_3_SPOKE_CENTRIFUGE_ID);
    expect(decoded[0]!.args?.[2]).toBe(bytes32(spoke.addresses.syncManager!));
    const setVault = decoded[3]!;
    expect(setVault.args?.[1]).toBe(V3_3_SPOKE_CENTRIFUGE_ID);
    expect(setVault.args?.[2]).toBe(
      bytes32(spoke.addresses.shareTokenRegistrar!),
    );
    expect(
      decodeAbiParameters(
        [
          { type: "uint8" },
          { type: "bytes16" },
          { type: "uint128" },
          { type: "address" },
        ],
        setVault.args?.[3] as `0x${string}`,
      ),
    ).toEqual([1, SC_ID, BigInt(SPOKE_ASSET_ID), WHO]);
    expect(built.messages).toBeUndefined();
    expect(() =>
      builders.deployVault(hub, {
        poolId: POOL_ID,
        scId: SC_ID,
        assetId: SPOKE_ASSET_ID,
        kind: "async",
        refundAddress: REFUND,
        spoke,
      }),
    ).toThrow(/vaultAddress is required/);
    expect(() =>
      builders.deployVault(hub32(), {
        poolId: POOL_ID,
        scId: SC_ID,
        assetId: SPOKE_ASSET_ID,
        kind: "async",
        refundAddress: REFUND,
        spoke: hub32(),
        vaultAddress: WHO,
      }),
    ).toThrow(BuilderArgumentMismatchError);
  });

  it("refuses a spoke whose chain is not the asset's: updateVault is dispatched to the asset's chain", () => {
    expect(() =>
      builders.deployVault(hub, {
        poolId: POOL_ID,
        scId: SC_ID,
        assetId: ASSET_ID,
        kind: "async",
        refundAddress: REFUND,
        spoke,
        vaultAddress: WHO,
      }),
    ).toThrow(
      /asset on centrifugeId 1 but the spoke context was resolved for centrifugeId 2/,
    );
    expect(() =>
      builders.updateVaults(hub, {
        poolId: POOL_ID,
        refundAddress: REFUND,
        spoke,
        link: [{ scId: SC_ID, assetId: ASSET_ID, vaultAddress: WHO }],
      }),
    ).toThrow(BuilderArgumentMismatchError);
    expect(() =>
      builders.updateVaults(hub32(), {
        poolId: POOL_ID,
        refundAddress: REFUND,
        spoke: hub32(),
        maxReserve: { scId: SC_ID, assetId: SPOKE_ASSET_ID, amount: "1" },
      }),
    ).toThrow(BuilderArgumentMismatchError);
    expect(() =>
      updateVault(hub, {
        poolId: POOL_ID,
        scId: SC_ID,
        assetId: ASSET_ID,
        vaultOrFactory: WHO,
        kind: "link",
        refundAddress: REFUND,
        spoke,
      }),
    ).toThrow(BuilderArgumentMismatchError);
    expect(
      builders.updateVaults(hub, {
        poolId: POOL_ID,
        refundAddress: REFUND,
        spoke,
        link: [{ scId: SC_ID, assetId: "42", vaultAddress: WHO }],
      }).calls,
    ).toHaveLength(2);
  });

  it("updateVaults and updateVault follow every link and unlink with the pointer update, cleared with address(0)", () => {
    const built = builders.updateVaults(hub, {
      poolId: POOL_ID,
      refundAddress: REFUND,
      spoke,
      unlink: [{ scId: SC_ID, assetId: SPOKE_ASSET_ID, vaultAddress: WHO }],
      link: [{ scId: SC_ID, assetId: SPOKE_ASSET_ID, vaultAddress: OTHER }],
    });
    const decoded = innerCalls(built.data).map((call) => decodeHub(call));
    expect(decoded.map((call) => call.functionName)).toEqual([
      "updateVault",
      "managerCall",
      "updateVault",
      "managerCall",
    ]);
    const pointer = (index: number) =>
      decodeAbiParameters(
        [
          { type: "uint8" },
          { type: "bytes16" },
          { type: "uint128" },
          { type: "address" },
        ],
        decoded[index]!.args?.[3] as `0x${string}`,
      )[3];
    expect(pointer(1)).toBe("0x0000000000000000000000000000000000000000");
    expect(pointer(3)).toBe(OTHER);
    const single = updateVault(hub, {
      poolId: POOL_ID,
      scId: SC_ID,
      assetId: SPOKE_ASSET_ID,
      vaultOrFactory: WHO,
      kind: "link",
      refundAddress: REFUND,
      spoke,
    });
    expect(innerCalls(single.data)).toHaveLength(2);
    expect(() =>
      updateVault(hub, {
        poolId: POOL_ID,
        scId: SC_ID,
        assetId: SPOKE_ASSET_ID,
        vaultOrFactory: WHO,
        kind: "link",
        refundAddress: REFUND,
      }),
    ).toThrow(/spoke is required/);
    expect(() =>
      updateVault(hub, {
        poolId: POOL_ID,
        scId: SC_ID,
        assetId: SPOKE_ASSET_ID,
        vaultOrFactory: WHO,
        kind: "deployAndLink",
        refundAddress: REFUND,
        spoke,
      }),
    ).toThrow(/vaultAddress is required/);
  });

  it("createHolding maps the four accounts onto the AccountKind slots and refuses a liability", () => {
    const built = builders.createHolding(hub, {
      poolId: POOL_ID,
      scId: SC_ID,
      assetId: SPOKE_ASSET_ID,
      valuationAddress: WHO,
      isLiability: false,
      accounts: { asset: "1", equity: "2", gain: "3", loss: "4" },
    });
    expect(decodeHub(built.data).args?.[4]).toEqual([1n, 2n, 3n, 4n]);
    expect(() =>
      builders.createHolding(hub, {
        poolId: POOL_ID,
        scId: SC_ID,
        assetId: SPOKE_ASSET_ID,
        valuationAddress: WHO,
        isLiability: true,
        accounts: { expense: "1", liability: "2" },
      }),
    ).toThrow(UnsupportedForProtocolVersionError);
  });

  it("holding transfers move to Spoke with the same signature", () => {
    const built = builders.withdrawHolding(spoke, {
      poolId: POOL_ID,
      scId: SC_ID,
      asset: { assetId: SPOKE_ASSET_ID, address: WHO, assetTokenId: null },
      amount: "5",
      source: "wallet",
      receiverAddress: OTHER,
    });
    expect(built.to).toBe(spoke.addresses.spoke);
    expect(
      decodeFunctionData({ abi: ABIS_V3_3.Spoke, data: built.data })
        .functionName,
    ).toBe("withdraw");
  });

  it("crosschainTransferShares names sender and owner on 3.3 and requires the sender", () => {
    const built = builders.crosschainTransferShares(spoke, {
      poolId: POOL_ID,
      scId: SC_ID,
      destinationCentrifugeId: "1",
      receiver: OTHER,
      amount: "1000",
      refundAddress: REFUND,
      senderAddress: WHO,
    });
    const decoded = decodeFunctionData({
      abi: ABIS_V3_3.Spoke,
      data: built.data,
    });
    expect(decoded.args).toEqual([
      1,
      BigInt(POOL_ID),
      SC_ID,
      bytes32(OTHER),
      WHO,
      WHO,
      1000n,
      0n,
      0n,
      REFUND,
    ]);
    expect(() =>
      builders.crosschainTransferShares(spoke, {
        poolId: POOL_ID,
        scId: SC_ID,
        destinationCentrifugeId: "1",
        receiver: OTHER,
        amount: "1000",
        refundAddress: REFUND,
      }),
    ).toThrow(BuilderArgumentMismatchError);
    expect(() =>
      builders.crosschainTransferShares(hub32(), {
        poolId: POOL_ID,
        scId: SC_ID,
        destinationCentrifugeId: "2",
        receiver: OTHER,
        amount: "1000",
        refundAddress: REFUND,
        senderAddress: WHO,
      }),
    ).toThrow(BuilderArgumentMismatchError);
  });
});

describe("managers on 3.3", () => {
  it("updateBalanceSheetManagers becomes one Hub.updateManager(spoke) per entry", () => {
    const built = builders.updateBalanceSheetManagers(hub, {
      poolId: POOL_ID,
      refundAddress: REFUND,
      updates: [{ centrifugeId: "2", address: WHO, canManage: true }],
    });
    const [call] = innerCalls(built.data);
    expect(decodeHub(call!)).toEqual({
      functionName: "updateManager",
      args: [BigInt(POOL_ID), 2, 2, bytes32(WHO), true, REFUND],
    });
  });

  it("registerOnOffRamp grants mint rights through managerCall on the ramp's own network, local or remote", () => {
    const local = builders.registerOnOffRamp(
      hub,
      {
        poolId: POOL_ID,
        scId: SC_ID,
        centrifugeId: "1",
        address: WHO,
        refundAddress: REFUND,
      },
      hub,
    );
    expect(
      innerCalls(local.data).map((call) => decodeHub(call).functionName),
    ).toEqual(["updateManager", "managerCall"]);
    const remote = builders.registerOnOffRamp(
      hub,
      {
        poolId: POOL_ID,
        scId: SC_ID,
        centrifugeId: "2",
        address: WHO,
        refundAddress: REFUND,
      },
      spoke,
    );
    const [, grant] = innerCalls(remote.data).map((call) => decodeHub(call));
    expect(grant!.args?.[1]).toBe(V3_3_SPOKE_CENTRIFUGE_ID);
    expect(grant!.args?.[2]).toBe(bytes32(spoke.addresses.accountingToken!));
  });
});

describe("orders on 3.3", () => {
  it("approveDeposits is a Hub.managerCall wrapped in multicall even when alone, so the callback is paid from the batch", () => {
    const built = builders.approveDeposits(hub, {
      poolId: POOL_ID,
      scId: SC_ID,
      refundAddress: REFUND,
      approvals: [
        {
          assetId: SPOKE_ASSET_ID,
          epochId: "1",
          approvedAssetAmount: "1000000",
          pricePoolPerAsset: PRICE,
        },
      ],
    });
    expect(built.to).toBe(hub.addresses.hub);
    expect(built.data.startsWith("0xac9650d8")).toBe(true);
    const [call] = innerCalls(built.data);
    const decoded = decodeHub(call!);
    expect(decoded.functionName).toBe("managerCall");
    expect(decoded.args?.[2]).toBe(bytes32(hub.addresses.batchRequestManager!));
    expect(decoded.args?.[5]).toBe(0n);
    expect(
      decodeAbiParameters(
        [
          { type: "uint8" },
          { type: "bytes16" },
          { type: "uint128" },
          { type: "uint32" },
          { type: "uint128" },
          { type: "uint128" },
          { type: "address" },
        ],
        decoded.args?.[3] as `0x${string}`,
      ),
    ).toEqual([
      1,
      SC_ID,
      BigInt(SPOKE_ASSET_ID),
      1,
      1000000n,
      BigInt(PRICE),
      REFUND,
    ]);
    expect(built.messages).toBeUndefined();
  });

  it("issueShares refuses an inline notify and notifyOrderClaims keys by request id", () => {
    expect(() =>
      builders.issueShares(hub, {
        poolId: POOL_ID,
        scId: SC_ID,
        refundAddress: REFUND,
        issuances: [
          {
            assetId: SPOKE_ASSET_ID,
            fromEpochId: "1",
            pricesPoolPerShare: [PRICE],
          },
        ],
        notify: [
          {
            assetId: SPOKE_ASSET_ID,
            notifications: [{ investor: WHO, maxClaims: 1, requestId: "7" }],
          },
        ],
      }),
    ).toThrow(UnsupportedForProtocolVersionError);
    const built = builders.notifyOrderClaims(hub, {
      poolId: POOL_ID,
      scId: SC_ID,
      kind: "deposit",
      refundAddress: REFUND,
      notify: [
        {
          assetId: SPOKE_ASSET_ID,
          notifications: [{ investor: WHO, maxClaims: 2, requestId: "7" }],
        },
      ],
    });
    expect(built.to).toBe(hub.addresses.batchRequestManager);
    expect(
      decodeFunctionData({
        abi: ABIS_V3_3.BatchRequestManager,
        data: built.data,
      }).args,
    ).toEqual([BigInt(POOL_ID), SC_ID, BigInt(SPOKE_ASSET_ID), 7n, 2, REFUND]);
    expect(() =>
      builders.notifyOrderClaims(hub, {
        poolId: POOL_ID,
        scId: SC_ID,
        kind: "deposit",
        refundAddress: REFUND,
        notify: [
          {
            assetId: SPOKE_ASSET_ID,
            notifications: [{ investor: WHO, maxClaims: 2 }],
          },
        ],
      }),
    ).toThrow(/requestId is required/);
  });

  it("refuses a request id on 3.2, where notifications key by investor", () => {
    expect(() =>
      builders.notifyOrderClaims(hub32(), {
        poolId: POOL_ID,
        scId: SC_ID,
        kind: "redeem",
        refundAddress: REFUND,
        notify: [
          {
            assetId: SPOKE_ASSET_ID,
            notifications: [{ investor: WHO, maxClaims: 2, requestId: "7" }],
          },
        ],
      }),
    ).toThrow(/keys notifications by investor/);
  });

  it("direct issue and revoke refuse with the typed error", () => {
    expect(() =>
      builders.issueSharesDirect(spoke, {
        poolId: POOL_ID,
        scId: SC_ID,
        address: WHO,
        shares: "1",
        pricePoolPerShare: PRICE,
      }),
    ).toThrow(UnsupportedForProtocolVersionError);
    expect(() =>
      builders.revokeSharesDirect(spoke, {
        poolId: POOL_ID,
        scId: SC_ID,
        address: WHO,
        custodianAddress: OTHER,
        shares: "1",
        pricePoolPerShare: PRICE,
      }),
    ).toThrow(UnsupportedForProtocolVersionError);
  });

  it("shareManagerCall issues and revokes through Hub.managerCall to the spoke's ShareManager", () => {
    const built = shareManagerCall(hub, spoke, {
      poolId: POOL_ID,
      scId: SC_ID,
      kind: "revoke",
      account: WHO,
      shares: "7",
      refundAddress: REFUND,
    });
    expect(built.to).toBe(hub.addresses.hub);
    const decoded = decodeHub(built.data);
    expect(decoded.functionName).toBe("managerCall");
    const [poolId, centrifugeId, target, payload] = decoded.args as readonly [
      bigint,
      number,
      `0x${string}`,
      `0x${string}`,
    ];
    expect(poolId).toBe(BigInt(POOL_ID));
    expect(centrifugeId).toBe(V3_3_SPOKE_CENTRIFUGE_ID);
    expect(target).toBe(bytes32(spoke.addresses.shareManager!));
    expect(payload).toBe(
      encodeShareManagerPayload({
        kind: "revoke",
        scId: SC_ID,
        account: WHO,
        shares: "7",
      }),
    );
  });

  it("shareManagerCall refuses a 3.2 context", () => {
    expect(() =>
      shareManagerCall(hub32(), spoke, {
        poolId: POOL_ID,
        scId: SC_ID,
        kind: "issue",
        account: WHO,
        shares: "1",
        refundAddress: REFUND,
      }),
    ).toThrow(UnsupportedForProtocolVersionError);
  });
});

describe("decoding 3.3 transactions", () => {
  it("decodeManagerCalls reads every managerCall out of a batch and decodeContractUpdates refuses the version", () => {
    const built = builders.approveDeposits(hub, {
      poolId: POOL_ID,
      scId: SC_ID,
      refundAddress: REFUND,
      approvals: [
        {
          assetId: SPOKE_ASSET_ID,
          epochId: "1",
          approvedAssetAmount: "1",
          pricePoolPerAsset: PRICE,
        },
        {
          assetId: ASSET_ID,
          epochId: "2",
          approvedAssetAmount: "2",
          pricePoolPerAsset: PRICE,
        },
      ],
    });
    const decoded = decodeManagerCalls("3.3", built.data);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) {
      return;
    }
    expect(decoded.calls).toHaveLength(2);
    expect(decoded.calls[0]).toMatchObject({
      callIndex: 0,
      poolId: POOL_ID,
      centrifugeId: 1,
      target: bytes32(hub.addresses.batchRequestManager!),
      localValue: "0",
      refundAddress: REFUND,
    });
    expect(() => decodeContractUpdates("3.3", built.data)).toThrow(
      UnsupportedForProtocolVersionError,
    );
    expect(() => decodeManagerCalls("3.2", built.data)).toThrow(
      UnsupportedForProtocolVersionError,
    );
  });

  it("encodeBatchCalldata wraps 3.3 calls with the shared multicall fragment", () => {
    const data = encodeBatchCalldata("3.3", ["0x01", "0x02"]);
    expect(data.startsWith("0xac9650d8")).toBe(true);
    expect(encodeAbiParameters([{ type: "bytes[]" }], [["0x01", "0x02"]])).toBe(
      `0x${data.slice(10)}`,
    );
  });
});
