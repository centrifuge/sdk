import { describe, expect, it } from "vitest";
import type { Abi } from "viem";
import { ABIS_V3_2, ABIS_V3_3 } from "../abis";
import {
  OPERATION_CATALOGUE,
  operationByAuditAction,
  operationByCall,
  operationByEventKind,
  operationByHookCall,
  operationById,
  operationByPoolAction,
} from "./index";

const ABI_SETS: readonly Record<string, Abi>[] = [
  ABIS_V3_2 as unknown as Record<string, Abi>,
  ABIS_V3_3 as unknown as Record<string, Abi>,
];

function functionExists(contract: string, fn: string): boolean {
  return ABI_SETS.some((set) =>
    (set[contract] ?? []).some(
      (item) => item.type === "function" && item.name === fn,
    ),
  );
}

describe("operation catalogue", () => {
  it("gives every entry a unique id and a name", () => {
    const ids = OPERATION_CATALOGUE.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of OPERATION_CATALOGUE) {
      expect(entry.name.trim()).not.toBe("");
    }
  });

  it("names only calls that exist in some ABI version of their contract", () => {
    const missing = OPERATION_CATALOGUE.flatMap((entry) =>
      entry.calls
        .filter((c) => !functionExists(c.contract, c.function))
        .map((c) => `${entry.id}: ${c.contract}.${c.function}`),
    );
    expect(missing).toEqual([]);
  });

  it("seeds the 21 pool actions with the names of the table", () => {
    const names = Object.fromEntries(
      OPERATION_CATALOGUE.filter((entry) => entry.poolAction).map((entry) => [
        entry.poolAction,
        entry.name,
      ]),
    );
    expect(names).toEqual({
      updatePoolMetadata: "Pool metadata update",
      createHolding: "Holding creation",
      depositHolding: "Holding deposit",
      withdrawHolding: "Holding withdrawal",
      deployVault: "Vault deployment",
      updateVaults: "Vault update",
      updatePoolManagers: "Hub manager update",
      updateBalanceSheetManagers: "Spoke manager update",
      registerOnOffRamp: "Ramp registration",
      updateSharePrice: "Share price update",
      updateMember: "Member update",
      freezeMember: "Member freeze",
      unfreezeMember: "Member unfreeze",
      crosschainTransferShares: "Share transfer",
      repayBatch: "Batch repayment",
      approveDeposits: "Deposit approval",
      issueShares: "Share issue",
      approveRedeems: "Redemption approval",
      revokeShares: "Share revocation",
      issueSharesDirect: "Direct share issue",
      revokeSharesDirect: "Direct share revocation",
    });
  });
});

describe("operationByCall", () => {
  it("names updateRestriction of any kind Restriction update, never a member action", () => {
    for (const kind of ["Member", "Freeze", "Unfreeze", undefined]) {
      expect(operationByCall("Hub", "updateRestriction", kind)?.name).toBe(
        "Restriction update",
      );
    }
  });

  it("names managerCall Manager call", () => {
    expect(operationByCall("Hub", "managerCall")?.id).toBe("hub.managerCall");
    expect(operationByCall("Hub", "managerCall")?.name).toBe("Manager call");
  });

  it("names each vault update kind, and an unknown or missing kind Vault update", () => {
    expect(operationByCall("Hub", "updateVault", "DeployAndLink")?.name).toBe(
      "Vault deployment",
    );
    expect(operationByCall("Hub", "updateVault", "Link")?.name).toBe(
      "Vault enabling",
    );
    expect(operationByCall("Hub", "updateVault", "Unlink")?.name).toBe(
      "Vault disabling",
    );
    expect(operationByCall("Hub", "updateVault", "Other")?.name).toBe(
      "Vault update",
    );
    expect(operationByCall("Hub", "updateVault")?.id).toBe("hub.updateVault");
  });

  it("names every Hub function a pool action encodes", () => {
    const hubCalls = OPERATION_CATALOGUE.filter(
      (entry) => entry.poolAction !== undefined,
    ).flatMap((entry) => entry.calls.filter((c) => c.contract === "Hub"));
    for (const c of hubCalls) {
      expect(
        operationByCall(c.contract, c.function, c.kind),
        `${c.function}${c.kind ? `.${c.kind}` : ""}`,
      ).not.toBeNull();
    }
  });

  it("returns null for a function or contract with no Hub function entry", () => {
    expect(operationByCall("Hub", "noSuchFunction")).toBeNull();
    expect(
      operationByCall("BatchRequestManager", "approveDeposits"),
    ).toBeNull();
  });
});

describe("lookups", () => {
  it("finds a pool action, an audit action and an id", () => {
    expect(operationByPoolAction("freezeMember")?.name).toBe("Member freeze");
    expect(operationByAuditAction("POOL_ROLE_ASSIGNED")?.name).toBe(
      "Pool role assigned",
    );
    expect(operationById("hub.updateVault.Link")?.name).toBe("Vault enabling");
    expect(operationById("updateMember")?.poolAction).toBe("updateMember");
  });

  it("keeps the technical audit actions as their value", () => {
    for (const action of [
      "AUTH_LOGIN",
      "INGESTION_EVENT_RECEIVED",
      "OUTBOX_JOB_DLQ",
      "SSE_CONNECTED",
      "RBAC_DENIED",
      "SESSION_REPLAY_DETECTED",
      "WEBHOOK_SIGNATURE_REJECTED",
    ]) {
      expect(operationByAuditAction(action)?.name).toBe(action);
    }
  });

  it("returns null for anything unknown, and for hook calls and event kinds no entry carries yet", () => {
    expect(operationById("nope")).toBeNull();
    expect(operationByPoolAction("nope")).toBeNull();
    expect(operationByAuditAction("NOPE")).toBeNull();
    expect(operationByHookCall("freeze")).toBeNull();
    expect(operationByEventKind("frozen")).toBeNull();
  });
});
