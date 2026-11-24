#!/usr/bin/env node
/**
 * Regenerates src/builders/__fixtures__/v3_3-builders.fixtures.json: one entry
 * per v3.3 builder, with the arguments and the calldata the builder produces
 * against the v3.3 testnet address set of the address book (Sepolia hub, Base
 * Sepolia spoke).
 * The unit test replays the arguments and compares the bytes, and decodes
 * them independently with viem, so a silent change to a v3.3 call shape fails
 * the suite.
 *
 * Usage (after `pnpm build`):
 *   node scripts/gen-v3_3-fixtures.mjs
 *   pnpm exec prettier --write src/builders/__fixtures__/v3_3-builders.fixtures.json
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveProtocolContext } from "../dist/context.js";
import {
  createDeploymentRegistry,
  DEFAULT_DEPLOYMENT_DATA,
} from "../dist/registry/index.js";
import {
  builders,
  hubManagerCall,
  updateManager,
  updateVault,
  notifyShareClass,
  encodeSyncManagerPayload,
  encodeShareTokenRegistrarPayload,
  encodeBatchRequestManagerPayload,
  encodeOnOffRampPayload,
  encodeQueueManagerPayload,
  encodeOracleValuationFeederPayload,
  encodeAccountingTokenMinterPayload,
  encodeTokenBridgeGasLimitsPayload,
} from "../dist/builders/index.js";

const POOL_ID = "281474976710657";
const SC_ID = "0x00010000000000010001000000000001";
const ASSET_ID = ((1n << 112n) + 1n).toString();
const SPOKE_ASSET_ID = ((2n << 112n) + 1n).toString();
const REFUND = "0x6Bcb240d3e1f1C4321ECAFFDacB45691DC03bE5D";
const WHO = "0x19f46D8130e610C6C0f0116EA40Fb781dEFaDE93";
const OTHER = "0xA4A7Bb3831958463b3FE3E27A6a160F764341953";
const PRICE = "1000000000000000000";

const registry = createDeploymentRegistry(DEFAULT_DEPLOYMENT_DATA);
const hub = resolveProtocolContext(POOL_ID, "3.3", {
  environment: "testnet",
  registry,
});
const spoke = resolveProtocolContext(POOL_ID, "3.3", {
  environment: "testnet",
  registry,
  centrifugeId: 2,
});

const cases = [
  [
    "hubManagerCall.syncManagerMaxReserve",
    () =>
      hubManagerCall(hub, {
        poolId: POOL_ID,
        centrifugeId: "1",
        target: hub.addresses.syncManager,
        payload: encodeSyncManagerPayload({
          kind: "maxReserve",
          scId: SC_ID,
          assetId: ASSET_ID,
          maxReserve: "5000000",
        }),
        label: "SyncManager.MaxReserve",
        refundAddress: REFUND,
      }),
  ],
  [
    "hubManagerCall.registrarSetHook",
    () =>
      hubManagerCall(hub, {
        poolId: POOL_ID,
        centrifugeId: "1",
        target: hub.addresses.shareTokenRegistrar,
        payload: encodeShareTokenRegistrarPayload({
          kind: "setHook",
          scId: SC_ID,
          hook: hub.addresses.freezeOnlyHook,
        }),
        label: "ShareTokenRegistrar.SetHook",
        refundAddress: REFUND,
      }),
  ],
  [
    "hubManagerCall.registrarSetVault",
    () =>
      hubManagerCall(hub, {
        poolId: POOL_ID,
        centrifugeId: "1",
        target: hub.addresses.shareTokenRegistrar,
        payload: encodeShareTokenRegistrarPayload({
          kind: "setVault",
          scId: SC_ID,
          assetId: ASSET_ID,
          vault: WHO,
        }),
        label: "ShareTokenRegistrar.SetVault",
        refundAddress: REFUND,
      }),
  ],
  [
    "hubManagerCall.onOffRampOnramp",
    () =>
      hubManagerCall(hub, {
        poolId: POOL_ID,
        centrifugeId: "1",
        target: WHO,
        payload: encodeOnOffRampPayload({
          kind: "onramp",
          assetId: ASSET_ID,
          enabled: true,
        }),
        label: "OnOffRamp.Onramp",
        refundAddress: REFUND,
      }),
  ],
  [
    "hubManagerCall.onOffRampRelayer",
    () =>
      hubManagerCall(hub, {
        poolId: POOL_ID,
        centrifugeId: "1",
        target: WHO,
        payload: encodeOnOffRampPayload({
          kind: "relayer",
          relayer: OTHER,
          enabled: false,
        }),
        label: "OnOffRamp.Relayer",
        refundAddress: REFUND,
      }),
  ],
  [
    "hubManagerCall.queueManager",
    () =>
      hubManagerCall(hub, {
        poolId: POOL_ID,
        centrifugeId: "1",
        target: hub.addresses.queueManager,
        payload: encodeQueueManagerPayload({
          scId: SC_ID,
          minDelay: "3600",
          extraGasLimit: "250000",
        }),
        label: "QueueManager",
        refundAddress: REFUND,
      }),
  ],
  [
    "hubManagerCall.oracleFeeder",
    () =>
      hubManagerCall(hub, {
        poolId: POOL_ID,
        centrifugeId: "1",
        target: hub.addresses.oracleValuation,
        payload: encodeOracleValuationFeederPayload({
          centrifugeId: "2",
          feeder: WHO,
          canFeed: true,
        }),
        label: "OracleValuation.UpdateFeeder",
        refundAddress: REFUND,
      }),
  ],
  [
    "hubManagerCall.accountingTokenMinter",
    () =>
      hubManagerCall(hub, {
        poolId: POOL_ID,
        centrifugeId: "1",
        target: hub.addresses.accountingToken,
        payload: encodeAccountingTokenMinterPayload({
          minter: WHO,
          canMint: true,
        }),
        label: "AccountingToken.UpdateMinter",
        refundAddress: REFUND,
      }),
  ],
  [
    "hubManagerCall.tokenBridgeGasLimits",
    () =>
      hubManagerCall(hub, {
        poolId: POOL_ID,
        centrifugeId: "1",
        target: hub.addresses.tokenBridge,
        payload: encodeTokenBridgeGasLimitsPayload({
          scId: SC_ID,
          extraGasLimit: "100000",
          remoteExtraGasLimit: "200000",
        }),
        label: "TokenBridge.UpdateGasLimits",
        refundAddress: REFUND,
      }),
  ],
  [
    "hubManagerCall.brmForceCancelDeposit",
    () =>
      hubManagerCall(hub, {
        poolId: POOL_ID,
        centrifugeId: "1",
        target: hub.addresses.batchRequestManager,
        payload: encodeBatchRequestManagerPayload({
          kind: "forceCancelDepositRequest",
          scId: SC_ID,
          investor: WHO,
          assetId: SPOKE_ASSET_ID,
          refundAddress: REFUND,
        }),
        label: "BatchRequestManager.ForceCancelDepositRequest",
        refundAddress: REFUND,
      }),
  ],
  [
    "hubManagerCall.remoteSyncManager",
    () =>
      hubManagerCall(hub, {
        poolId: POOL_ID,
        centrifugeId: "2",
        target: spoke.addresses.syncManager,
        payload: encodeSyncManagerPayload({
          kind: "valuation",
          scId: SC_ID,
          valuation: spoke.addresses.identityValuation,
        }),
        label: "SyncManager.Valuation",
        refundAddress: REFUND,
        extraGasLimit: "150000",
      }),
  ],
  [
    "updateManager.spokeGrant",
    () =>
      updateManager(hub, {
        poolId: POOL_ID,
        centrifugeId: "2",
        kind: "spoke",
        address: WHO,
        canManage: true,
        refundAddress: REFUND,
      }),
  ],
  [
    "updateManager.bridgerRevoke",
    () =>
      updateManager(hub, {
        poolId: POOL_ID,
        centrifugeId: "2",
        kind: "bridger",
        address: WHO,
        canManage: false,
        refundAddress: REFUND,
      }),
  ],
  [
    "updateVault.deployAndLink",
    () =>
      updateVault(hub, {
        poolId: POOL_ID,
        scId: SC_ID,
        assetId: SPOKE_ASSET_ID,
        vaultOrFactory: spoke.addresses.asyncVaultFactory,
        kind: "deployAndLink",
        refundAddress: REFUND,
        spoke,
        vaultAddress: WHO,
      }),
  ],
  [
    "updateVault.link",
    () =>
      updateVault(hub, {
        poolId: POOL_ID,
        scId: SC_ID,
        assetId: SPOKE_ASSET_ID,
        vaultOrFactory: WHO,
        kind: "link",
        refundAddress: REFUND,
        spoke,
      }),
  ],
  [
    "updateVault.unlink",
    () =>
      updateVault(hub, {
        poolId: POOL_ID,
        scId: SC_ID,
        assetId: SPOKE_ASSET_ID,
        vaultOrFactory: WHO,
        kind: "unlink",
        refundAddress: REFUND,
        spoke,
      }),
  ],
  [
    "notifyShareClass",
    () =>
      notifyShareClass(hub, {
        poolId: POOL_ID,
        scId: SC_ID,
        centrifugeId: "2",
        registrarAddress: spoke.addresses.shareTokenRegistrar,
        refundAddress: REFUND,
      }),
  ],
  [
    "deployVault.async",
    () =>
      builders.deployVault(hub, {
        poolId: POOL_ID,
        scId: SC_ID,
        assetId: SPOKE_ASSET_ID,
        kind: "async",
        refundAddress: REFUND,
        spoke,
        vaultAddress: WHO,
      }),
  ],
  [
    "deployVault.syncDepositLocal",
    () =>
      builders.deployVault(hub, {
        poolId: POOL_ID,
        scId: SC_ID,
        assetId: ASSET_ID,
        kind: "syncDeposit",
        refundAddress: REFUND,
        spoke: hub,
        vaultAddress: WHO,
      }),
  ],
  [
    "deployVault.syncDepositRemote",
    () =>
      builders.deployVault(hub, {
        poolId: POOL_ID,
        scId: SC_ID,
        assetId: SPOKE_ASSET_ID,
        kind: "syncDeposit",
        refundAddress: REFUND,
        spoke,
        vaultAddress: WHO,
      }),
  ],
  [
    "updateVaults.linkAndUnlink",
    () =>
      builders.updateVaults(hub, {
        poolId: POOL_ID,
        refundAddress: REFUND,
        spoke,
        unlink: [{ scId: SC_ID, assetId: SPOKE_ASSET_ID, vaultAddress: WHO }],
        link: [{ scId: SC_ID, assetId: SPOKE_ASSET_ID, vaultAddress: OTHER }],
      }),
  ],
  [
    "depositHolding.wallet",
    () =>
      builders.depositHolding(spoke, {
        poolId: POOL_ID,
        scId: SC_ID,
        asset: { assetId: SPOKE_ASSET_ID, address: WHO, assetTokenId: null },
        amount: "1000000",
        source: "wallet",
      }),
  ],
  [
    "withdrawHolding.wallet",
    () =>
      builders.withdrawHolding(spoke, {
        poolId: POOL_ID,
        scId: SC_ID,
        asset: { assetId: SPOKE_ASSET_ID, address: WHO, assetTokenId: null },
        amount: "1000000",
        source: "wallet",
        receiverAddress: OTHER,
      }),
  ],
  [
    "createHolding.asset",
    () =>
      builders.createHolding(hub, {
        poolId: POOL_ID,
        scId: SC_ID,
        assetId: SPOKE_ASSET_ID,
        valuationAddress: hub.addresses.identityValuation,
        isLiability: false,
        accounts: { asset: "1", equity: "2", gain: "3", loss: "4" },
      }),
  ],
  [
    "crosschainTransferShares",
    () =>
      builders.crosschainTransferShares(spoke, {
        poolId: POOL_ID,
        scId: SC_ID,
        destinationCentrifugeId: "1",
        receiver: OTHER,
        amount: "1000",
        refundAddress: REFUND,
        senderAddress: WHO,
      }),
  ],
  [
    "updateBalanceSheetManagers",
    () =>
      builders.updateBalanceSheetManagers(hub, {
        poolId: POOL_ID,
        refundAddress: REFUND,
        updates: [
          { centrifugeId: "2", address: WHO, canManage: true },
          { centrifugeId: "2", address: OTHER, canManage: false },
        ],
      }),
  ],
  [
    "registerOnOffRamp.local",
    () =>
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
  ],
  [
    "registerOnOffRamp.remote",
    () =>
      builders.registerOnOffRamp(
        hub,
        {
          poolId: POOL_ID,
          scId: SC_ID,
          centrifugeId: "2",
          address: WHO,
          refundAddress: REFUND,
        },
        spoke,
      ),
  ],
  [
    "approveDeposits",
    () =>
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
  ],
  [
    "approveRedeems",
    () =>
      builders.approveRedeems(hub, {
        poolId: POOL_ID,
        scId: SC_ID,
        approvals: [
          {
            assetId: SPOKE_ASSET_ID,
            epochId: "1",
            approvedShareAmount: "500",
            pricePoolPerAsset: PRICE,
          },
        ],
      }),
  ],
  [
    "issueShares",
    () =>
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
  ],
  [
    "notifyOrderClaims.deposit",
    () =>
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
  ],
  [
    "revokeShares",
    () =>
      builders.revokeShares(hub, {
        poolId: POOL_ID,
        scId: SC_ID,
        refundAddress: REFUND,
        revocations: [
          {
            assetId: SPOKE_ASSET_ID,
            fromEpochId: "3",
            pricesPoolPerShare: [PRICE],
          },
        ],
      }),
  ],
];

const fixtures = cases.map(([name, build]) => {
  const built = build();
  return {
    name,
    to: built.to,
    data: built.data,
    value: built.value.toString(),
    labels: (built.calls ?? []).map((call) => call.label),
    hasMessages: built.messages !== undefined,
  };
});
const out = resolve(
  import.meta.dirname,
  "../src/builders/__fixtures__/v3_3-builders.fixtures.json",
);
writeFileSync(
  out,
  `${JSON.stringify({ provenance: "Addresses from the address book's testnet v3.3.0 stack (pin in the pnpm-workspace.yaml catalog), ABIs from the address book package's v3.3 set (GENERATED_ABIS_V3_3, folded from the book's mainnet head); regenerate with scripts/gen-v3_3-fixtures.mjs after pnpm build.", hub: { centrifugeId: 1, hub: hub.addresses.hub }, spoke: { centrifugeId: 2, spoke: spoke.addresses.spoke }, fixtures }, null, 2)}\n`,
);
console.log(`wrote ${fixtures.length} fixtures to ${out}`);
