export class SolanaTransactionError extends Error {
    code;
    originalError;
    constructor(message, code, originalError) {
        super(message);
        this.code = code;
        this.originalError = originalError;
        this.name = 'SolanaTransactionError';
    }
}
export var SolanaErrorCode;
(function (SolanaErrorCode) {
    SolanaErrorCode["WALLET_NOT_CONNECTED"] = "WALLET_NOT_CONNECTED";
    SolanaErrorCode["INVALID_AMOUNT"] = "INVALID_AMOUNT";
    SolanaErrorCode["POOL_NOT_CONFIGURED"] = "POOL_NOT_CONFIGURED";
    SolanaErrorCode["INSUFFICIENT_BALANCE"] = "INSUFFICIENT_BALANCE";
    SolanaErrorCode["TRANSACTION_FAILED"] = "TRANSACTION_FAILED";
    SolanaErrorCode["SIGNATURE_REJECTED"] = "SIGNATURE_REJECTED";
    SolanaErrorCode["NETWORK_ERROR"] = "NETWORK_ERROR";
    SolanaErrorCode["INVALID_DECIMALS"] = "INVALID_DECIMALS";
})(SolanaErrorCode || (SolanaErrorCode = {}));
//# sourceMappingURL=wallet.js.map