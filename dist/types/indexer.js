export var VaultKind;
(function (VaultKind) {
    VaultKind["Async"] = "Async";
    VaultKind["Sync"] = "Sync";
    VaultKind["SyncDepositAsyncRedeem"] = "SyncDepositAsyncRedeem";
})(VaultKind || (VaultKind = {}));
export var VaultStatus;
(function (VaultStatus) {
    VaultStatus["LinkInProgress"] = "LinkInProgress";
    VaultStatus["UnlinkInProgress"] = "UnlinkInProgress";
    VaultStatus["Linked"] = "Linked";
    VaultStatus["Unlinked"] = "Unlinked";
})(VaultStatus || (VaultStatus = {}));
export var AssetRegistrationStatus;
(function (AssetRegistrationStatus) {
    AssetRegistrationStatus["InProgress"] = "IN_PROGRESS";
    AssetRegistrationStatus["Registered"] = "REGISTERED";
})(AssetRegistrationStatus || (AssetRegistrationStatus = {}));
export var InvestorTransactionType;
(function (InvestorTransactionType) {
    InvestorTransactionType["DepositRequestUpdated"] = "DEPOSIT_REQUEST_UPDATED";
    InvestorTransactionType["RedeemRequestUpdated"] = "REDEEM_REQUEST_UPDATED";
    InvestorTransactionType["DepositRequestCancelled"] = "DEPOSIT_REQUEST_CANCELLED";
    InvestorTransactionType["RedeemRequestCancelled"] = "REDEEM_REQUEST_CANCELLED";
    InvestorTransactionType["DepositRequestExecuted"] = "DEPOSIT_REQUEST_EXECUTED";
    InvestorTransactionType["RedeemRequestExecuted"] = "REDEEM_REQUEST_EXECUTED";
    InvestorTransactionType["DepositClaimable"] = "DEPOSIT_CLAIMABLE";
    InvestorTransactionType["RedeemClaimable"] = "REDEEM_CLAIMABLE";
    InvestorTransactionType["DepositClaimed"] = "DEPOSIT_CLAIMED";
    InvestorTransactionType["RedeemClaimed"] = "REDEEM_CLAIMED";
    InvestorTransactionType["SyncDeposit"] = "SYNC_DEPOSIT";
    InvestorTransactionType["SyncRedeem"] = "SYNC_REDEEM";
})(InvestorTransactionType || (InvestorTransactionType = {}));
export var HoldingAccountType;
(function (HoldingAccountType) {
    HoldingAccountType["Asset"] = "Asset";
    HoldingAccountType["Equity"] = "Equity";
    HoldingAccountType["Loss"] = "Loss";
    HoldingAccountType["Gain"] = "Gain";
    HoldingAccountType["Expense"] = "Expense";
    HoldingAccountType["Liability"] = "Liability";
})(HoldingAccountType || (HoldingAccountType = {}));
export var CrosschainPayloadStatus;
(function (CrosschainPayloadStatus) {
    CrosschainPayloadStatus["Underpaid"] = "Underpaid";
    CrosschainPayloadStatus["InProgress"] = "InProgress";
    CrosschainPayloadStatus["Delivered"] = "Delivered";
    CrosschainPayloadStatus["PartiallyFailed"] = "PartiallyFailed";
})(CrosschainPayloadStatus || (CrosschainPayloadStatus = {}));
export var CrosschainMessageStatus;
(function (CrosschainMessageStatus) {
    CrosschainMessageStatus["AwaitingBatchDelivery"] = "AwaitingBatchDelivery";
    CrosschainMessageStatus["Failed"] = "Failed";
    CrosschainMessageStatus["Executed"] = "Executed";
})(CrosschainMessageStatus || (CrosschainMessageStatus = {}));
//# sourceMappingURL=indexer.js.map