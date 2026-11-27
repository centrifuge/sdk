import { createHolding } from "./create-holding";
import { depositHolding, withdrawHolding } from "./holding-transfer";
import {
  registerOnOffRamp,
  updateBalanceSheetManagers,
  updatePoolManagers,
} from "./managers";
import {
  crosschainTransferShares,
  freezeMember,
  unfreezeMember,
  updateMember,
} from "./members";
import {
  approveDeposits,
  approveRedeems,
  issueShares,
  issueSharesDirect,
  notifyOrderClaims,
  revokeShares,
  revokeSharesDirect,
} from "./orders";
import { repayBatch } from "./repay-batch";
import { setPoolMetadata } from "./set-pool-metadata";
import { updateSharePrice } from "./share-price";
import { hubManagerCall } from "./manager-call";
import { shareManagerCall } from "./share-manager";
import { updateManager } from "./update-manager";
import {
  deployVault,
  notifyShareClass,
  updateVault,
  updateVaults,
} from "./vaults";

export { encodeBatchCalldata } from "./batch";
export { decodeContractUpdates, decodeManagerCalls } from "./contract-updates";
export type {
  ContractUpdateDecodeFailure,
  ContractUpdateDecoding,
  DecodedContractUpdate,
  DecodedManagerCall,
  ManagerCallDecoding,
} from "./contract-updates";
export {
  ADAPTER_FAILOVER_HUB_CALL,
  BASE_TRANSFER_HOOK_TRUSTED_CALL,
  BATCH_REQUEST_MANAGER_ACTION,
  encodeAccountingTokenMinterPayload,
  encodeAdapterFailoverStewardPayload,
  encodeBaseTransferHookPayload,
  encodeBatchRequestManagerPayload,
  encodeOnchainPMPolicyPayload,
  encodeOnOffRampPayload,
  encodeOracleValuationFeederPayload,
  encodeQueueManagerPayload,
  encodeShareManagerPayload,
  encodeShareTokenRegistrarPayload,
  encodeSyncManagerPayload,
  encodeTokenBridgeGasLimitsPayload,
  hubManagerCall,
  ON_OFF_RAMP_TRUSTED_CALL,
  REGISTRAR_CALL,
  SHARE_MANAGER_CALL,
  SYNC_MANAGER_TRUSTED_CALL,
} from "./manager-call";
export type {
  BaseTransferHookPayload,
  BatchRequestManagerPayload,
  HubManagerCallArgs,
  OnOffRampPayload,
  ShareManagerPayload,
  ShareTokenRegistrarPayload,
  SyncManagerPayload,
} from "./manager-call";
export { SHARE_REVOKE_EXTRA_GAS, shareManagerCall } from "./share-manager";
export type { ShareManagerCallArgs } from "./share-manager";
export { MANAGER_KIND, updateManager } from "./update-manager";
export type { ManagerKindName, UpdateManagerArgs } from "./update-manager";
export {
  registerOnOffRamp,
  updateBalanceSheetManagers,
  updatePoolManagers,
} from "./managers";
export type {
  BalanceSheetManagerRef,
  PoolManagerRef,
  RegisterOnOffRampArgs,
  UpdateBalanceSheetManagersArgs,
  UpdatePoolManagersArgs,
} from "./managers";
export {
  crosschainTransferShares,
  freezeMember,
  unfreezeMember,
  updateMember,
} from "./members";
export type {
  CrosschainTransferSharesArgs,
  FreezeMemberArgs,
  UpdateMemberArgs,
} from "./members";
export {
  addressToBytes32,
  approveDeposits,
  approveRedeems,
  centrifugeIdFromAssetId,
  issueShares,
  issueSharesDirect,
  notifyOrderClaims,
  revokeShares,
  revokeSharesDirect,
} from "./orders";
export type {
  ApproveDepositsArgs,
  ApproveRedeemsArgs,
  DepositApproval,
  DirectShareArgs,
  IssueSharesArgs,
  NotifyOrderClaimsArgs,
  OrderNotification,
  OrderNotifyBatch,
  RedeemApproval,
  RevokeSharesArgs,
  RevokeSharesDirectArgs,
  ShareIssuance,
  ShareRevocation,
} from "./orders";
export { repayBatch } from "./repay-batch";
export type { RepayBatchArgs } from "./repay-batch";
export { updateSharePrice } from "./share-price";
export type { UpdateSharePriceArgs } from "./share-price";
export {
  deployVault,
  notifyShareClass,
  updateVault,
  updateVaults,
  VAULT_UPDATE_KIND,
} from "./vaults";
export type {
  DeployVaultArgs,
  NotifyShareClassArgs,
  UpdateVaultArgs,
  UpdateVaultsArgs,
  VaultDeployKind,
  VaultRef,
} from "./vaults";

export { setPoolMetadata } from "./set-pool-metadata";
export type { SetPoolMetadataArgs } from "./set-pool-metadata";
export { createHolding } from "./create-holding";
export type {
  AssetHoldingAccounts,
  CreateHoldingArgs,
  LiabilityHoldingAccounts,
} from "./create-holding";
export { depositHolding, withdrawHolding } from "./holding-transfer";
export type {
  DepositHoldingArgs,
  HoldingTransferAsset,
  HoldingTransferSource,
  WithdrawHoldingArgs,
} from "./holding-transfer";

/**
 * Pure protocol builders, `(ctx: ProtocolContext, args) -> BuiltProtocolCall`.
 * A builder takes a RESOLVED context, never a chain id alone, and version
 * routing happens inside it (via the context's addresses and ABIs), so builder
 * names stay protocol-neutral and consumers never change when a protocol
 * version is added.
 *
 * The holdings builders are named after the domain operation, never the
 * contract: `depositHolding` routes to `BalanceSheet.deposit` or to
 * `OnOffRampManager.deposit` depending on where the assets sit, and both are
 * v3.2 details.
 *
 * The vaults builders are the first batching builders here: `deployVault`
 * emits two or three `Hub` calls and `updateVaults` one per edited vault plus
 * an optional reserve change, wrapped by
 * {@link encodeBatchCalldata} exactly as the SDK's signing path wraps them.
 *
 * The pool-access builders batch the same way, one `Hub` call per manager
 * edit. `updatePoolManagers` is hub-local; `updateBalanceSheetManagers`
 * dispatches one cross-chain message per named network, which is why only the
 * latter carries a refund address.
 *
 * The NAV builder is the one that MIXES the two: `updateSharePrice` emits a
 * hub-local price write followed by one paid cross-chain notification per
 * network, in that order, because the notification reads the stored price back
 * rather than carrying it.
 *
 * The investors builders are the first that do NOT batch:
 * `updateMember`, `freezeMember` and `unfreezeMember` each emit exactly one
 * `Hub.updateRestriction`, differing only in the packed payload byte, because
 * the management app edits one investor at a time. `crosschainTransferShares`
 * is the only builder here whose target is the SPOKE rather than the hub — its
 * context is resolved for the SOURCE network and the destination travels as an
 * argument.
 *
 * The orders builders are the first that target `BatchRequestManager` —
 * `approveDeposits`, `issueShares`, `approveRedeems` and `revokeShares` live
 * there and not on `Hub` (`centrifuge-v3` commit `2add77913`). They are also the first with EXPLICIT
 * PAGINATION in their arguments: `issueShares` and `revokeShares` dispatch one
 * paid message per epoch, so the caller names the epoch page
 * (`fromEpochId` plus the length of `pricesPoolPerShare`) rather than letting a
 * gas constant decide — a measured live route carries six messages where the
 * SDK budgets 42. `approveRedeems` is the only builder here that dispatches
 * nothing at all and the only one with no refund address, because the contract
 * has none. `issueSharesDirect` / `revokeSharesDirect` are spoke-side
 * `BalanceSheet` multicalls whose empty manifest is likewise verified: both only
 * queue the share delta, and the `UpdateShares` message leaves later from a
 * separate `submitQueuedShares`.
 *
 * `repayBatch` is the odd one out in two ways: its target is the `Gateway`
 * rather than the hub or the spoke, and it is the only builder whose
 * `msg.value` is NOT priced from a `messages` manifest — the amount owed comes
 * from `Gateway.underpaid` over the real batch bytes, not from an estimate over
 * canonical empty payloads. Every other builder now declares which cross-chain
 * messages it dispatches (`BuiltProtocolCall.messages`) so the caller can price
 * them; an EMPTY manifest (`updatePoolManagers`, an un-notified
 * `updateSharePrice`) is the positive statement that there is nothing to pay
 * for.
 */
export const builders = {
  setPoolMetadata,
  createHolding,
  depositHolding,
  withdrawHolding,
  deployVault,
  updateVaults,
  updateVault,
  notifyShareClass,
  hubManagerCall,
  updateManager,
  updatePoolManagers,
  updateBalanceSheetManagers,
  registerOnOffRamp,
  updateSharePrice,
  updateMember,
  freezeMember,
  unfreezeMember,
  crosschainTransferShares,
  repayBatch,
  approveDeposits,
  issueShares,
  approveRedeems,
  revokeShares,
  issueSharesDirect,
  revokeSharesDirect,
  shareManagerCall,
  notifyOrderClaims,
} as const;
