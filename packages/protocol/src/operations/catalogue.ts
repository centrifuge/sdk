import type { OperationCall, OperationEntry } from "./types";

const call = (contract: string, fn: string, kind?: string): OperationCall =>
  kind === undefined
    ? { contract, function: fn }
    : { contract, function: fn, kind };

const hubCall = (fn: string, kind?: string): OperationCall =>
  call("Hub", fn, kind);

function poolAction(
  id: string,
  name: string,
  calls: readonly OperationCall[],
): OperationEntry {
  return { id, name, calls, poolAction: id };
}

function hub(fn: string, name: string, kind?: string): OperationEntry {
  return {
    id: kind === undefined ? `hub.${fn}` : `hub.${fn}.${kind}`,
    name,
    calls: [hubCall(fn, kind)],
  };
}

function audit(action: string, name: string): OperationEntry {
  return { id: action, name, calls: [], auditActions: [action] };
}

// Calls are what `builders/` encode on any served version: v3.2 sends order actions to the
// BatchRequestManager and holdings through the BalanceSheet; v3.3 sends them as `Hub.managerCall`
// and through the Spoke.
const POOL_ACTIONS: readonly OperationEntry[] = [
  poolAction("updatePoolMetadata", "Pool metadata update", [
    hubCall("setPoolMetadata"),
  ]),
  poolAction("createHolding", "Holding creation", [
    hubCall("initializeHolding"),
    hubCall("initializeLiability"),
  ]),
  poolAction("depositHolding", "Holding deposit", [
    call("BalanceSheet", "deposit"),
    call("Spoke", "deposit"),
    call("OnOffRampManager", "deposit"),
  ]),
  poolAction("withdrawHolding", "Holding withdrawal", [
    call("BalanceSheet", "withdraw"),
    call("Spoke", "withdraw"),
    call("OnOffRampManager", "withdraw"),
  ]),
  poolAction("deployVault", "Vault deployment", [
    hubCall("notifyAssetPrice"),
    hubCall("updateVault", "DeployAndLink"),
    hubCall("updateContract"),
    hubCall("managerCall"),
  ]),
  poolAction("updateVaults", "Vault update", [
    hubCall("updateVault", "Link"),
    hubCall("updateVault", "Unlink"),
    hubCall("managerCall"),
  ]),
  poolAction("updatePoolManagers", "Hub manager update", [
    hubCall("updateHubManager"),
  ]),
  poolAction("updateBalanceSheetManagers", "Spoke manager update", [
    hubCall("updateBalanceSheetManager"),
    hubCall("updateManager"),
  ]),
  poolAction("registerOnOffRamp", "Ramp registration", [
    hubCall("updateBalanceSheetManager"),
    hubCall("updateContract"),
    hubCall("updateManager"),
    hubCall("managerCall"),
  ]),
  poolAction("updateSharePrice", "Share price update", [
    hubCall("updateSharePrice"),
    hubCall("notifySharePrice"),
  ]),
  poolAction("updateMember", "Member update", [
    hubCall("updateRestriction", "Member"),
  ]),
  poolAction("freezeMember", "Member freeze", [
    hubCall("updateRestriction", "Freeze"),
  ]),
  poolAction("unfreezeMember", "Member unfreeze", [
    hubCall("updateRestriction", "Unfreeze"),
  ]),
  poolAction("crosschainTransferShares", "Share transfer", [
    call("Spoke", "crosschainTransferShares"),
  ]),
  poolAction("repayBatch", "Batch repayment", [call("Gateway", "repay")]),
  poolAction("approveDeposits", "Deposit approval", [
    call("BatchRequestManager", "approveDeposits"),
    hubCall("managerCall"),
  ]),
  poolAction("issueShares", "Share issue", [
    call("BatchRequestManager", "issueShares"),
    call("BatchRequestManager", "notifyDeposit"),
    hubCall("managerCall"),
  ]),
  poolAction("approveRedeems", "Redemption approval", [
    call("BatchRequestManager", "approveRedeems"),
    hubCall("managerCall"),
  ]),
  poolAction("revokeShares", "Share revocation", [
    call("BatchRequestManager", "revokeShares"),
    call("BatchRequestManager", "notifyRedeem"),
    hubCall("managerCall"),
  ]),
  poolAction("issueSharesDirect", "Direct share issue", [
    call("BalanceSheet", "overridePricePoolPerShare"),
    call("BalanceSheet", "issue"),
    call("BalanceSheet", "resetPricePoolPerShare"),
  ]),
  poolAction("revokeSharesDirect", "Direct share revocation", [
    call("BalanceSheet", "transferSharesFrom"),
    call("BalanceSheet", "overridePricePoolPerShare"),
    call("BalanceSheet", "revoke"),
    call("BalanceSheet", "resetPricePoolPerShare"),
  ]),
];

const HUB_FUNCTIONS: readonly OperationEntry[] = [
  hub("addShareClass", "Share class creation"),
  hub("updateShareClassMetadata", "Token metadata update"),
  hub("notifyShareMetadata", "Token metadata notification"),
  hub("updateSharePrice", "Share price update"),
  hub("notifySharePrice", "Share price notification"),
  hub("updateHubManager", "Hub manager update"),
  hub("updateManager", "Spoke manager update"),
  hub("updateBalanceSheetManager", "Balance sheet manager update"),
  hub("updateContract", "Contract update"),
  hub("setAdapters", "Adapter update"),
  hub("notifyAssetPrice", "Asset price notification"),
  hub("initializeHolding", "Holding creation"),
  hub("initializeLiability", "Liability creation"),
  hub("updateHoldingValue", "Holding value update"),
  hub("updateHoldingValuation", "Holding valuation update"),
  hub("updateRestriction", "Restriction update"),
  hub("managerCall", "Manager call"),
  hub("setPoolMetadata", "Pool metadata update"),
  hub("createAccount", "Account creation"),
  hub("notifyPool", "Pool notification"),
  hub("notifyShareClass", "Token deployment"),
  hub("setRequestManager", "Request manager update"),
  hub("createPool", "Pool creation"),
  hub("cancelAuthorization", "Authorization cancellation"),
  hub("setPolicy", "Policy replacement"),
  hub("updateVault", "Vault update"),
  hub("updateVault", "Vault deployment", "DeployAndLink"),
  hub("updateVault", "Vault enabling", "Link"),
  hub("updateVault", "Vault disabling", "Unlink"),
];

// Sentence case of the value; the technical ones (AUTH_*, INGESTION_*, OUTBOX_*, SSE_*, *_DENIED and the two
// detections) keep the value, since only engineers read them. The backend's `AuditAction` is built from these keys.
export const AUDIT_ACTION_NAMES = {
  AUTH_LOGIN: "AUTH_LOGIN",
  AUTH_LOGIN_OIDC: "AUTH_LOGIN_OIDC",
  AUTH_LOGOUT: "AUTH_LOGOUT",
  AUTH_REFRESH: "AUTH_REFRESH",
  AUTH_REGISTER: "AUTH_REGISTER",
  AUTH_REVOKE_ALL: "AUTH_REVOKE_ALL",
  AUTH_PASSWORD_CHANGED: "AUTH_PASSWORD_CHANGED",
  AUTH_SESSION_REVOKED: "AUTH_SESSION_REVOKED",
  AUTH_DEVICE_REVOKED: "AUTH_DEVICE_REVOKED",
  AUTH_RECOVERY_CODES_REGENERATED: "AUTH_RECOVERY_CODES_REGENERATED",
  USER_DEACTIVATED: "User deactivated",
  USER_REACTIVATED: "User reactivated",
  USER_ACTIVATED: "User activated",
  USER_ACTIVATION_RESENT: "User activation resent",
  POOL_ROLE_ASSIGNED: "Pool role assigned",
  POOL_ROLE_REVOKED: "Pool role revoked",
  POOL_ROLE_CHANGED: "Pool role changed",
  POOL_ROLE_INVITED: "Pool role invited",
  POOL_INVITE_REVOKED: "Pool invite revoked",
  TRANSFER_AGENT_ROLE_ASSIGNED: "Transfer agent role assigned",
  TRANSFER_AGENT_ROLE_REVOKED: "Transfer agent role revoked",
  POOL_PERMISSION_OVERRIDE_SET: "Pool permission override set",
  POOL_PERMISSION_OVERRIDE_REMOVED: "Pool permission override removed",
  USER_PERMISSION_GRANT_SET: "User permission grant set",
  USER_PERMISSION_GRANT_REMOVED: "User permission grant removed",
  WALLET_LINKED: "Wallet linked",
  WALLET_UNLINKED: "Wallet unlinked",
  INGESTION_EVENT_RECEIVED: "INGESTION_EVENT_RECEIVED",
  INGESTION_EVENT_DUPLICATE: "INGESTION_EVENT_DUPLICATE",
  OUTBOX_JOB_PROCESSED: "OUTBOX_JOB_PROCESSED",
  OUTBOX_JOB_FAILED: "OUTBOX_JOB_FAILED",
  OUTBOX_JOB_DLQ: "OUTBOX_JOB_DLQ",
  OUTBOX_JOB_REPLAYED: "OUTBOX_JOB_REPLAYED",
  CSRF_DENIED: "CSRF_DENIED",
  RBAC_DENIED: "RBAC_DENIED",
  POOL_RBAC_DENIED: "POOL_RBAC_DENIED",
  ABAC_DENIED: "ABAC_DENIED",
  SESSION_REPLAY_DETECTED: "SESSION_REPLAY_DETECTED",
  SSE_CONNECTED: "SSE_CONNECTED",
  SSE_PUBLISHED: "SSE_PUBLISHED",
  NOTIFICATION_ROUTE_CREATED: "Notification route created",
  NOTIFICATION_ROUTE_UPDATED: "Notification route updated",
  NOTIFICATION_ROUTE_DELETED: "Notification route deleted",
  NOTIFICATION_SUBSCRIPTION_UPSERTED: "Notification subscription upserted",
  NOTIFICATION_SUBSCRIPTION_DELETED: "Notification subscription deleted",
  NOTIFICATION_RULE_CREATED: "Notification rule created",
  NOTIFICATION_RULE_UPDATED: "Notification rule updated",
  NOTIFICATION_RULE_DELETED: "Notification rule deleted",
  NOTIFICATION_TEMPLATE_CREATED: "Notification template created",
  NOTIFICATION_TEMPLATE_UPDATED: "Notification template updated",
  NOTIFICATION_TEMPLATE_DELETED: "Notification template deleted",
  NOTIFICATION_CHANNEL_PREFERENCE_UPSERTED:
    "Notification channel preference upserted",
  NOTIFICATION_CHANNEL_PREFERENCE_DELETED:
    "Notification channel preference deleted",
  SIGNING_CONFIG_CHANGE_SCHEDULED: "Signing config change scheduled",
  SIGNING_CONFIG_CHANGE_APPLIED: "Signing config change applied",
  FORDEFI_SIGNER_ADDED: "Fordefi signer added",
  FORDEFI_SIGNER_REMOVED: "Fordefi signer removed",
  FORDEFI_SIGNER_AUTO_LINKED: "Fordefi signer auto linked",
  POLICY_LIMIT_SCHEDULED: "Policy limit scheduled",
  POLICY_LIMIT_APPLIED: "Policy limit applied",
  TX_PREPARED: "Tx prepared",
  TX_FORDEFI_BYPASSED: "Tx Fordefi bypassed",
  TX_SUBMITTED_TO_FORDEFI: "Tx submitted to Fordefi",
  TX_BROADCAST: "Tx broadcast",
  TX_CONFIRMED: "Tx confirmed",
  TX_FAILED: "Tx failed",
  TX_APPROVAL_REJECTED: "Tx approval rejected",
  TX_FORDEFI_LINKED: "Tx Fordefi linked",
  TX_APPROVAL_STATE_OBSERVED: "Tx approval state observed",
  TX_VERIFICATION_FAILED: "Tx verification failed",
  TX_APPROVER_DIVERGENCE: "Tx approver divergence",
  TX_BACKEND_BROADCAST: "Tx backend broadcast",
  TX_BROADCAST_REJECTED: "Tx broadcast rejected",
  WEBHOOK_SIGNATURE_REJECTED: "WEBHOOK_SIGNATURE_REJECTED",
} as const satisfies Record<string, string>;

/** An audit action id, as written to `audit_log.action`. */
export type AuditActionId = keyof typeof AUDIT_ACTION_NAMES;

/** Every audit action id, in catalogue order. */
export const AUDIT_ACTION_IDS = Object.keys(
  AUDIT_ACTION_NAMES,
) as readonly AuditActionId[];

const AUDIT_ACTIONS: readonly OperationEntry[] = AUDIT_ACTION_IDS.map((id) =>
  audit(id, AUDIT_ACTION_NAMES[id]),
);

/** Every operation, once: the backend's pool actions, the Hub functions and the audit actions. */
export const OPERATION_CATALOGUE: readonly OperationEntry[] = [
  ...POOL_ACTIONS,
  ...HUB_FUNCTIONS,
  ...AUDIT_ACTIONS,
];
