// Generates the cross-package byte-parity fixture for `emptyMessage` from an
// independent implementation, pinned at
// packages/sdk/src/types/transaction.ts@fa32208 and copied verbatim below, so
// the fixture records bytes no current implementation can influence.
import { encodePacked, toHex } from "viem";
import { writeFileSync } from "node:fs";

// --- verbatim from the pinned implementation -----------------------------
const MessageType = {
  _Invalid: 0,
  ScheduleUpgrade: 1,
  CancelUpgrade: 2,
  RecoverTokens: 3,
  RegisterAsset: 4,
  SetPoolAdapters: 5,
  NotifyPool: 6,
  NotifyShareClass: 7,
  NotifyPricePoolPerShare: 8,
  NotifyPricePoolPerAsset: 9,
  NotifyShareMetadata: 10,
  UpdateShareHook: 11,
  InitiateTransferShares: 12,
  ExecuteTransferShares: 13,
  UpdateRestriction: 14,
  UpdateVault: 15,
  UpdateBalanceSheetManager: 16,
  UpdateGatewayManager: 17,
  UpdateHoldingAmount: 18,
  UpdateShares: 19,
  SetMaxAssetPriceAge: 20,
  SetMaxSharePriceAge: 21,
  Request: 22,
  RequestCallback: 23,
  SetRequestManager: 24,
  TrustedContractUpdate: 25,
  UntrustedContractUpdate: 26,
};
const VaultUpdateKind = { DeployAndLink: 0, Link: 1, Unlink: 2 };

function emptyMessage(type) {
  if (typeof type === "object" && type.type === MessageType.UpdateVault) {
    return encodePacked(
      ["uint8", "uint64", "bytes16", "uint128", "bytes32", "uint8", "uint128"],
      [
        type.type,
        type.poolId.raw,
        toHex(0, { size: 16 }),
        0n,
        toHex(0, { size: 32 }),
        type.subtype ?? VaultUpdateKind.DeployAndLink,
        0n,
      ],
    );
  }
  if (typeof type === "object") {
    return encodePacked(
      ["uint8", "uint64", "bytes"],
      [type.type, type.poolId.raw, toHex(0, { size: 241 })],
    );
  }

  return encodePacked(["uint8", "bytes"], [type, toHex(0, { size: 249 })]);
}
// --- end verbatim ---------------------------------------------------------

const POOL_IDS = ["0", "281474976710657", "18446744073709551615"];
const POOL_INDEPENDENT = [
  "_Invalid",
  "ScheduleUpgrade",
  "CancelUpgrade",
  "RecoverTokens",
  "RegisterAsset",
  "SetPoolAdapters",
];
const POOL_DEPENDENT = Object.keys(MessageType).filter(
  (name) =>
    MessageType[name] >= MessageType.NotifyPool && name !== "UpdateVault",
);

const vectors = [];
for (const name of POOL_INDEPENDENT) {
  vectors.push({
    type: name,
    ordinal: MessageType[name],
    poolId: null,
    subtype: null,
    hex: emptyMessage(MessageType[name]),
  });
}
for (const name of POOL_DEPENDENT) {
  for (const poolId of POOL_IDS) {
    vectors.push({
      type: name,
      ordinal: MessageType[name],
      poolId,
      subtype: null,
      hex: emptyMessage({
        type: MessageType[name],
        poolId: { raw: BigInt(poolId) },
      }),
    });
  }
}
for (const poolId of POOL_IDS) {
  for (const [kindName, kind] of Object.entries(VaultUpdateKind)) {
    vectors.push({
      type: "UpdateVault",
      ordinal: MessageType.UpdateVault,
      poolId,
      subtype: kind,
      subtypeName: kindName,
      hex: emptyMessage({
        type: MessageType.UpdateVault,
        poolId: { raw: BigInt(poolId) },
        subtype: kind,
      }),
    });
  }
  // subtype omitted -> DeployAndLink, pinned separately because the `??`
  // default is what makes an omitted subtype byte-stable across packages.
  vectors.push({
    type: "UpdateVault",
    ordinal: MessageType.UpdateVault,
    poolId,
    subtype: null,
    subtypeName: "omitted",
    hex: emptyMessage({
      type: MessageType.UpdateVault,
      poolId: { raw: BigInt(poolId) },
    }),
  });
}

const out = {
  $comment:
    "Byte-parity fixture for emptyMessage(). Generated from the pre-move SDK " +
    "implementation (packages/sdk/src/types/transaction.ts at fa32208) by " +
    "packages/protocol/scripts/gen-empty-message-fixture.mjs. MultiAdapter.estimate is " +
    "payload-content-sensitive, so these bytes ARE the fee convention: both " +
    "@centrifuge/protocol and @centrifuge/sdk must reproduce them exactly. " +
    "Do not regenerate to make a test pass.",
  ordinals: MessageType,
  vaultUpdateKinds: VaultUpdateKind,
  vectors,
};

const target = process.argv[2];
writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`);
console.log(`wrote ${vectors.length} vectors to ${target}`);
