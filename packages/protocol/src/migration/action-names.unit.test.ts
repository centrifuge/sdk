import { describe, expect, it } from "vitest";
import { builders } from "../builders";
import { BuilderArgumentMismatchError } from "../errors";
import { spokeOfAction } from "./action-spoke";
import {
  isActionAllowed,
  MIGRATION_ACTION_BY_NAME,
  migrationActionOf,
  UNMAPPED_BUILDER_ACTIONS,
} from "./action-names";
import { SPOKE_GATE_STATE } from "./gate-state";

describe("migration action names", () => {
  it("maps or deliberately leaves out every protocol builder", () => {
    for (const name of Object.keys(builders)) {
      const decided =
        MIGRATION_ACTION_BY_NAME.has(name) ||
        UNMAPPED_BUILDER_ACTIONS.includes(name);
      expect(decided, name).toBe(true);
    }
    for (const name of UNMAPPED_BUILDER_ACTIONS) {
      expect(MIGRATION_ACTION_BY_NAME.has(name), name).toBe(false);
    }
  });

  it("maps every request and callback name the SDK workflow executor sends", () => {
    for (const name of [
      "requestDeposit",
      "requestRedeem",
      "cancelDepositRequest",
      "cancelRedeemRequest",
      "enableLockDepositRequest",
      "executeLockedDepositRequest",
      "lockDepositRequest",
      "unlockDepositRequest",
      "approveDeposits",
      "approveRedeems",
      "claimDeposit",
      "claimRedeem",
      "forceCancelDepositRequest",
      "forceCancelRedeemRequest",
      "issueShares",
      "notifyDeposit",
      "notifyRedeem",
      "revokeShares",
      "erc7540_requestDeposit",
      "erc7540_claimDeposit",
      "erc7540_requestRedeem",
      "erc7540_claimRedeem",
    ]) {
      expect(migrationActionOf(name), name).not.toBeNull();
    }
  });

  it("does not resolve names inherited from Object.prototype", () => {
    for (const name of [
      "constructor",
      "toString",
      "__proto__",
      "hasOwnProperty",
    ]) {
      expect(migrationActionOf(name), name).toBeNull();
      expect(isActionAllowed(SPOKE_GATE_STATE.started, name)).toMatchObject({
        allowed: false,
        verdict: "?",
      });
    }
  });

  it("maps settlement, notifies, prices and restrictions to their rows", () => {
    expect(migrationActionOf("approveDeposits")).toBe("settlement");
    expect(migrationActionOf("issueSharesDirect")).toBe("settlement");
    expect(migrationActionOf("notifyShareClass")).toBe("spokeConfiguration");
    expect(migrationActionOf("notifyDeposit")).toBe("notify");
    for (const bare of ["deposit", "mint", "transfer", "transferShares"]) {
      expect(migrationActionOf(bare), bare).toBeNull();
    }
    expect(migrationActionOf("syncDeposit")).toBe("syncDeposit");
    expect(migrationActionOf("shareTransfer")).toBe("shareTransfer");
    expect(migrationActionOf("poolConfiguration")).toBe("poolConfiguration");
    expect(migrationActionOf("bridgerGrant")).toBe("bridgerGrant");
    expect(migrationActionOf("updateSharePrice")).toBe("hubPrice");
    expect(migrationActionOf("freezeMember")).toBe("investorRestriction");
    expect(migrationActionOf("deployVault")).toBe("spokeConfiguration");
    expect(migrationActionOf("crosschainTransferShares")).toBe("bridgeOut");
    expect(migrationActionOf("requestDeposit")).toBe("investorRequest");
    expect(migrationActionOf("repayBatch")).toBeNull();
  });

  it("refuses an unmapped action on a migrating pool and allows it on a pool with none", () => {
    expect(isActionAllowed(null, "repayBatch")).toEqual({ allowed: true });
    const answer = isActionAllowed(SPOKE_GATE_STATE.started, "repayBatch");
    expect(answer).toMatchObject({
      allowed: false,
      code: "POOL_MIGRATING",
      state: "P1",
      action: "repayBatch",
      verdict: "?",
    });
    expect(answer.allowed === false && answer.allowedActions).toContain(
      "settlement",
    );
    expect(isActionAllowed(SPOKE_GATE_STATE.live, "repayBatch")).toEqual({
      allowed: true,
    });
    expect(
      isActionAllowed(
        SPOKE_GATE_STATE.activatedNotRestored,
        "poolConfiguration",
      ),
    ).toEqual({ allowed: true });
    expect(
      isActionAllowed(SPOKE_GATE_STATE.activatedNotRestored, "bridgerGrant"),
    ).toMatchObject({ allowed: false, verdict: "R" });
    expect(
      isActionAllowed(SPOKE_GATE_STATE.started, "approveDeposits"),
    ).toEqual({ allowed: true });
    expect(
      isActionAllowed(SPOKE_GATE_STATE.offboardSent, "approveDeposits"),
    ).toMatchObject({ allowed: false, verdict: "R" });
  });

  it("gates a bridge by name at both ends and insists on the destination", () => {
    expect(() =>
      isActionAllowed(SPOKE_GATE_STATE.started, "crosschainTransferShares", {
        spokeIsHubChain: false,
      }),
    ).toThrow(BuilderArgumentMismatchError);
    expect(() => isActionAllowed(null, "crosschainTransferShares")).toThrow(
      BuilderArgumentMismatchError,
    );
    expect(() =>
      isActionAllowed(null, "crosschainTransferShares", {
        destinationState: SPOKE_GATE_STATE.started,
      }),
    ).toThrow(BuilderArgumentMismatchError);
    expect(
      isActionAllowed(null, "crosschainTransferShares", {
        spokeIsHubChain: true,
        destinationState: SPOKE_GATE_STATE.started,
      }),
    ).toEqual({ allowed: true });
    expect(
      isActionAllowed(SPOKE_GATE_STATE.started, "crosschainTransferShares", {
        spokeIsHubChain: false,
        destinationState: SPOKE_GATE_STATE.offboardSent,
      }),
    ).toMatchObject({ allowed: false, action: "bridgeToward", state: "P3" });
    expect(
      isActionAllowed(SPOKE_GATE_STATE.freezeSent, "crosschainTransferShares", {
        spokeIsHubChain: true,
        destinationState: SPOKE_GATE_STATE.started,
      }),
    ).toMatchObject({ allowed: false, action: "bridgeOut", state: "P2" });
    expect(
      isActionAllowed(SPOKE_GATE_STATE.freezeSent, "crosschainTransferShares", {
        spokeIsHubChain: false,
        destinationState: SPOKE_GATE_STATE.started,
      }),
    ).toEqual({ allowed: true });
    expect(
      isActionAllowed(SPOKE_GATE_STATE.live, "crosschainTransferShares", {
        spokeIsHubChain: false,
        destinationState: SPOKE_GATE_STATE.activatedNotRestored,
      }),
    ).toMatchObject({ allowed: false, action: "bridgeToward", state: "P5" });
  });
});

describe("spokeOfAction", () => {
  const POOL_ID = "281474976710665";

  it("keys an asset action on the asset's chain, also when the transaction runs on the hub", () => {
    expect(
      spokeOfAction({
        poolId: POOL_ID,
        assetId: ((2n << 112n) + 1n).toString(),
      }),
    ).toBe(2);
    expect(
      spokeOfAction({
        poolId: POOL_ID,
        assetId: ((3n << 112n) + 7n).toString(),
        centrifugeId: 1,
      }),
    ).toBe(3);
  });

  it("keys a vault or token action on the named chain and pool configuration on the hub", () => {
    expect(spokeOfAction({ poolId: POOL_ID, centrifugeId: 9 })).toBe(9);
    expect(spokeOfAction({ poolId: POOL_ID })).toBe(1);
  });

  it("refuses a malformed pool id, asset id or chain", () => {
    expect(() => spokeOfAction({ poolId: "x" })).toThrow(
      BuilderArgumentMismatchError,
    );
    expect(() => spokeOfAction({ poolId: POOL_ID, assetId: "0x1" })).toThrow(
      BuilderArgumentMismatchError,
    );
    expect(() => spokeOfAction({ poolId: POOL_ID, assetId: "7" })).toThrow(
      BuilderArgumentMismatchError,
    );
    expect(() => spokeOfAction({ poolId: POOL_ID, centrifugeId: 0 })).toThrow(
      BuilderArgumentMismatchError,
    );
    expect(() => spokeOfAction({ poolId: "5" })).toThrow(
      BuilderArgumentMismatchError,
    );
  });
});
