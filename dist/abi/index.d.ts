export declare const ABI: {
    Hub: readonly [{
        readonly name: "accounting";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "address";
        }];
    }, {
        readonly name: "addShareClass";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "string";
            readonly name: "name";
        }, {
            readonly type: "string";
            readonly name: "symbol";
        }, {
            readonly type: "bytes32";
            readonly name: "salt";
        }];
        readonly outputs: readonly [{
            readonly type: "bytes16";
            readonly name: "scId";
        }];
    }, {
        readonly name: "approveDeposits";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "depositAssetId";
        }, {
            readonly type: "uint32";
            readonly name: "nowDepositEpochId";
        }, {
            readonly type: "uint128";
            readonly name: "approvedAssetAmount";
        }];
        readonly outputs: readonly [{
            readonly type: "uint128";
            readonly name: "pendingAssetAmount";
        }, {
            readonly type: "uint128";
            readonly name: "approvedPoolAmount";
        }];
    }, {
        readonly name: "approveRedeems";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "payoutAssetId";
        }, {
            readonly type: "uint32";
            readonly name: "nowRedeemEpochId";
        }, {
            readonly type: "uint128";
            readonly name: "approvedShareAmount";
        }];
        readonly outputs: readonly [{
            readonly type: "uint128";
            readonly name: "pendingShareAmount";
        }];
    }, {
        readonly name: "createAccount";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "uint32";
            readonly name: "account";
        }, {
            readonly type: "bool";
            readonly name: "isDebitNormal";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "createPool";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "address";
            readonly name: "admin";
        }, {
            readonly type: "uint128";
            readonly name: "currency";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "deny";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "user";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "file";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "bytes32";
            readonly name: "what";
        }, {
            readonly type: "address";
            readonly name: "data";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "forceCancelDepositRequest";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "bytes32";
            readonly name: "investor";
        }, {
            readonly type: "uint128";
            readonly name: "depositAssetId";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "forceCancelRedeemRequest";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "bytes32";
            readonly name: "investor";
        }, {
            readonly type: "uint128";
            readonly name: "payoutAssetId";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "gateway";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "address";
        }];
    }, {
        readonly name: "holdings";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "address";
        }];
    }, {
        readonly name: "hubHelpers";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "address";
        }];
    }, {
        readonly name: "hubRegistry";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "address";
        }];
    }, {
        readonly name: "initializeHolding";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }, {
            readonly type: "address";
            readonly name: "valuation";
        }, {
            readonly type: "uint32";
            readonly name: "assetAccount";
        }, {
            readonly type: "uint32";
            readonly name: "equityAccount";
        }, {
            readonly type: "uint32";
            readonly name: "gainAccount";
        }, {
            readonly type: "uint32";
            readonly name: "lossAccount";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "initializeLiability";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }, {
            readonly type: "address";
            readonly name: "valuation";
        }, {
            readonly type: "uint32";
            readonly name: "expenseAccount";
        }, {
            readonly type: "uint32";
            readonly name: "liabilityAccount";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "initiateTransferShares";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint16";
            readonly name: "centrifugeId";
        }, {
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "bytes32";
            readonly name: "receiver";
        }, {
            readonly type: "uint128";
            readonly name: "amount";
        }, {
            readonly type: "uint128";
            readonly name: "extraGasLimit";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "issueShares";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "depositAssetId";
        }, {
            readonly type: "uint32";
            readonly name: "nowIssueEpochId";
        }, {
            readonly type: "uint128";
            readonly name: "navPoolPerShare";
        }, {
            readonly type: "uint128";
            readonly name: "extraGasLimit";
        }];
        readonly outputs: readonly [{
            readonly type: "uint128";
            readonly name: "issuedShareAmount";
        }, {
            readonly type: "uint128";
            readonly name: "depositAssetAmount";
        }, {
            readonly type: "uint128";
            readonly name: "depositPoolAmount";
        }];
    }, {
        readonly name: "multicall";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "bytes[]";
            readonly name: "data";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "notifyAssetPrice";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "notifyDeposit";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }, {
            readonly type: "bytes32";
            readonly name: "investor";
        }, {
            readonly type: "uint32";
            readonly name: "maxClaims";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "notifyPool";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "uint16";
            readonly name: "centrifugeId";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "notifyRedeem";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }, {
            readonly type: "bytes32";
            readonly name: "investor";
        }, {
            readonly type: "uint32";
            readonly name: "maxClaims";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "notifyShareClass";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint16";
            readonly name: "centrifugeId";
        }, {
            readonly type: "bytes32";
            readonly name: "hook";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "notifyShareMetadata";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint16";
            readonly name: "centrifugeId";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "notifySharePrice";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint16";
            readonly name: "centrifugeId";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "poolEscrowFactory";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "address";
        }];
    }, {
        readonly name: "recoverTokens";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "token";
        }, {
            readonly type: "address";
            readonly name: "receiver";
        }, {
            readonly type: "uint256";
            readonly name: "amount";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "recoverTokens";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "token";
        }, {
            readonly type: "uint256";
            readonly name: "tokenId";
        }, {
            readonly type: "address";
            readonly name: "receiver";
        }, {
            readonly type: "uint256";
            readonly name: "amount";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "registerAsset";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint128";
            readonly name: "assetId";
        }, {
            readonly type: "uint8";
            readonly name: "decimals";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "rely";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "user";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "request";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }, {
            readonly type: "bytes";
            readonly name: "payload";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "revokeShares";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "payoutAssetId";
        }, {
            readonly type: "uint32";
            readonly name: "nowRevokeEpochId";
        }, {
            readonly type: "uint128";
            readonly name: "navPoolPerShare";
        }, {
            readonly type: "uint128";
            readonly name: "extraGasLimit";
        }];
        readonly outputs: readonly [{
            readonly type: "uint128";
            readonly name: "revokedShareAmount";
        }, {
            readonly type: "uint128";
            readonly name: "payoutAssetAmount";
        }, {
            readonly type: "uint128";
            readonly name: "payoutPoolAmount";
        }];
    }, {
        readonly name: "sender";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "address";
        }];
    }, {
        readonly name: "setAccountMetadata";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "uint32";
            readonly name: "account";
        }, {
            readonly type: "bytes";
            readonly name: "metadata";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "setHoldingAccountId";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }, {
            readonly type: "uint8";
            readonly name: "kind";
        }, {
            readonly type: "uint32";
            readonly name: "accountId";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "setMaxAssetPriceAge";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }, {
            readonly type: "uint64";
            readonly name: "maxPriceAge";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "setMaxSharePriceAge";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "uint16";
            readonly name: "centrifugeId";
        }, {
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint64";
            readonly name: "maxPriceAge";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "setPoolMetadata";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes";
            readonly name: "metadata";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "setRequestManager";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }, {
            readonly type: "bytes32";
            readonly name: "manager";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "setSnapshotHook";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "address";
            readonly name: "hook";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "shareClassManager";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "address";
        }];
    }, {
        readonly name: "updateBalanceSheetManager";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "uint16";
            readonly name: "centrifugeId";
        }, {
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes32";
            readonly name: "who";
        }, {
            readonly type: "bool";
            readonly name: "canManage";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "updateContract";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint16";
            readonly name: "centrifugeId";
        }, {
            readonly type: "bytes32";
            readonly name: "target";
        }, {
            readonly type: "bytes";
            readonly name: "payload";
        }, {
            readonly type: "uint128";
            readonly name: "extraGasLimit";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "updateHoldingAmount";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint16";
            readonly name: "centrifugeId";
        }, {
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }, {
            readonly type: "uint128";
            readonly name: "amount";
        }, {
            readonly type: "uint128";
            readonly name: "pricePoolPerAsset";
        }, {
            readonly type: "bool";
            readonly name: "isIncrease";
        }, {
            readonly type: "bool";
            readonly name: "isSnapshot";
        }, {
            readonly type: "uint64";
            readonly name: "nonce";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "updateHoldingIsLiability";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }, {
            readonly type: "bool";
            readonly name: "isLiability";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "updateHoldingValuation";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }, {
            readonly type: "address";
            readonly name: "valuation";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "updateHoldingValue";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "updateHubManager";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "address";
            readonly name: "who";
        }, {
            readonly type: "bool";
            readonly name: "canManage";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "updateJournal";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "tuple[]";
            readonly components: readonly [{
                readonly type: "uint128";
                readonly name: "value";
            }, {
                readonly type: "uint32";
                readonly name: "accountId";
            }];
            readonly name: "debits";
        }, {
            readonly type: "tuple[]";
            readonly components: readonly [{
                readonly type: "uint128";
                readonly name: "value";
            }, {
                readonly type: "uint32";
                readonly name: "accountId";
            }];
            readonly name: "credits";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "updateRestriction";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint16";
            readonly name: "centrifugeId";
        }, {
            readonly type: "bytes";
            readonly name: "payload";
        }, {
            readonly type: "uint128";
            readonly name: "extraGasLimit";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "updateShareClassMetadata";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "string";
            readonly name: "name";
        }, {
            readonly type: "string";
            readonly name: "symbol";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "updateShareHook";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint16";
            readonly name: "centrifugeId";
        }, {
            readonly type: "bytes32";
            readonly name: "hook";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "updateSharePrice";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "navPoolPerShare";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "updateShares";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint16";
            readonly name: "centrifugeId";
        }, {
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "amount";
        }, {
            readonly type: "bool";
            readonly name: "isIssuance";
        }, {
            readonly type: "bool";
            readonly name: "isSnapshot";
        }, {
            readonly type: "uint64";
            readonly name: "nonce";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "updateVault";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }, {
            readonly type: "bytes32";
            readonly name: "vaultOrFactory";
        }, {
            readonly type: "uint8";
            readonly name: "kind";
        }, {
            readonly type: "uint128";
            readonly name: "extraGasLimit";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "wards";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
        }];
    }, {
        readonly name: "Deny";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "user";
            readonly indexed: true;
        }];
    }, {
        readonly name: "File";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "bytes32";
            readonly name: "what";
        }, {
            readonly type: "address";
            readonly name: "addr";
        }];
    }, {
        readonly name: "ForwardTransferShares";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint16";
            readonly name: "centrifugeId";
            readonly indexed: true;
        }, {
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "bytes32";
            readonly name: "receiver";
        }, {
            readonly type: "uint128";
            readonly name: "amount";
        }];
    }, {
        readonly name: "NotifyAssetPrice";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint16";
            readonly name: "centrifugeId";
            readonly indexed: true;
        }, {
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }, {
            readonly type: "uint128";
            readonly name: "pricePoolPerAsset";
        }];
    }, {
        readonly name: "NotifyPool";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint16";
            readonly name: "centrifugeId";
            readonly indexed: true;
        }, {
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }];
    }, {
        readonly name: "NotifyShareClass";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint16";
            readonly name: "centrifugeId";
            readonly indexed: true;
        }, {
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }];
    }, {
        readonly name: "NotifyShareMetadata";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint16";
            readonly name: "centrifugeId";
            readonly indexed: true;
        }, {
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "string";
            readonly name: "name";
        }, {
            readonly type: "string";
            readonly name: "symbol";
        }];
    }, {
        readonly name: "NotifySharePrice";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint16";
            readonly name: "centrifugeId";
            readonly indexed: true;
        }, {
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "poolPerShare";
        }];
    }, {
        readonly name: "Rely";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "user";
            readonly indexed: true;
        }];
    }, {
        readonly name: "SetMaxAssetPriceAge";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }, {
            readonly type: "uint64";
            readonly name: "maxPriceAge";
        }];
    }, {
        readonly name: "SetMaxSharePriceAge";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint16";
            readonly name: "centrifugeId";
            readonly indexed: true;
        }, {
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint64";
            readonly name: "maxPriceAge";
        }];
    }, {
        readonly name: "UpdateContract";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint16";
            readonly name: "centrifugeId";
            readonly indexed: true;
        }, {
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "bytes32";
            readonly name: "target";
        }, {
            readonly type: "bytes";
            readonly name: "payload";
        }];
    }, {
        readonly name: "UpdateRestriction";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint16";
            readonly name: "centrifugeId";
            readonly indexed: true;
        }, {
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "bytes";
            readonly name: "payload";
        }];
    }, {
        readonly name: "UpdateShareHook";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint16";
            readonly name: "centrifugeId";
            readonly indexed: true;
        }, {
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "bytes32";
            readonly name: "hook";
        }];
    }, {
        readonly name: "UpdateVault";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }, {
            readonly type: "bytes32";
            readonly name: "vaultOrFactory";
        }, {
            readonly type: "uint8";
            readonly name: "kind";
        }];
    }, {
        readonly name: "AccountDoesNotExist";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "AssetNotFound";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "CallFailedWithEmptyRevert";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "FileUnrecognizedParam";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "InvalidAccountCombination";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "InvalidPoolId";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "NoCode";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "NotAuthorized";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "NotManager";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "PoolAlreadyUnlocked";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "SafeTransferEthFailed";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "ShareClassNotFound";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "UnauthorizedSender";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "WrappedError";
        readonly type: "error";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "target";
        }, {
            readonly type: "bytes4";
            readonly name: "selector";
        }, {
            readonly type: "bytes";
            readonly name: "reason";
        }, {
            readonly type: "bytes";
            readonly name: "details";
        }];
    }];
    ShareClassManager: readonly [{
        readonly name: "addShareClass";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "string";
            readonly name: "name";
        }, {
            readonly type: "string";
            readonly name: "symbol";
        }, {
            readonly type: "bytes32";
            readonly name: "salt";
        }];
        readonly outputs: readonly [{
            readonly type: "bytes16";
            readonly name: "scId_";
        }];
    }, {
        readonly name: "allowForceDepositCancel";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "depositAssetId";
        }, {
            readonly type: "bytes32";
            readonly name: "investor";
        }];
        readonly outputs: readonly [{
            readonly type: "bool";
            readonly name: "cancelled";
        }];
    }, {
        readonly name: "allowForceRedeemCancel";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "payoutAssetId";
        }, {
            readonly type: "bytes32";
            readonly name: "investor";
        }];
        readonly outputs: readonly [{
            readonly type: "bool";
            readonly name: "cancelled";
        }];
    }, {
        readonly name: "approveDeposits";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId_";
        }, {
            readonly type: "uint128";
            readonly name: "depositAssetId";
        }, {
            readonly type: "uint32";
            readonly name: "nowDepositEpochId";
        }, {
            readonly type: "uint128";
            readonly name: "approvedAssetAmount";
        }, {
            readonly type: "uint128";
            readonly name: "pricePoolPerAsset";
        }];
        readonly outputs: readonly [{
            readonly type: "uint128";
            readonly name: "pendingAssetAmount";
        }, {
            readonly type: "uint128";
            readonly name: "approvedPoolAmount";
        }];
    }, {
        readonly name: "approveRedeems";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId_";
        }, {
            readonly type: "uint128";
            readonly name: "payoutAssetId";
        }, {
            readonly type: "uint32";
            readonly name: "nowRedeemEpochId";
        }, {
            readonly type: "uint128";
            readonly name: "approvedShareAmount";
        }, {
            readonly type: "uint128";
            readonly name: "pricePoolPerAsset";
        }];
        readonly outputs: readonly [{
            readonly type: "uint128";
            readonly name: "pendingShareAmount";
        }];
    }, {
        readonly name: "cancelDepositRequest";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId_";
        }, {
            readonly type: "bytes32";
            readonly name: "investor";
        }, {
            readonly type: "uint128";
            readonly name: "depositAssetId";
        }];
        readonly outputs: readonly [{
            readonly type: "uint128";
            readonly name: "cancelledAssetAmount";
        }];
    }, {
        readonly name: "cancelRedeemRequest";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId_";
        }, {
            readonly type: "bytes32";
            readonly name: "investor";
        }, {
            readonly type: "uint128";
            readonly name: "payoutAssetId";
        }];
        readonly outputs: readonly [{
            readonly type: "uint128";
            readonly name: "cancelledShareAmount";
        }];
    }, {
        readonly name: "claimDeposit";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId_";
        }, {
            readonly type: "bytes32";
            readonly name: "investor";
        }, {
            readonly type: "uint128";
            readonly name: "depositAssetId";
        }];
        readonly outputs: readonly [{
            readonly type: "uint128";
            readonly name: "payoutShareAmount";
        }, {
            readonly type: "uint128";
            readonly name: "paymentAssetAmount";
        }, {
            readonly type: "uint128";
            readonly name: "cancelledAssetAmount";
        }, {
            readonly type: "bool";
            readonly name: "canClaimAgain";
        }];
    }, {
        readonly name: "claimRedeem";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId_";
        }, {
            readonly type: "bytes32";
            readonly name: "investor";
        }, {
            readonly type: "uint128";
            readonly name: "payoutAssetId";
        }];
        readonly outputs: readonly [{
            readonly type: "uint128";
            readonly name: "payoutAssetAmount";
        }, {
            readonly type: "uint128";
            readonly name: "paymentShareAmount";
        }, {
            readonly type: "uint128";
            readonly name: "cancelledShareAmount";
        }, {
            readonly type: "bool";
            readonly name: "canClaimAgain";
        }];
    }, {
        readonly name: "deny";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "user";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "depositRequest";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "depositAssetId";
        }, {
            readonly type: "bytes32";
            readonly name: "investor";
        }];
        readonly outputs: readonly [{
            readonly type: "uint128";
            readonly name: "pending";
        }, {
            readonly type: "uint32";
            readonly name: "lastUpdate";
        }];
    }, {
        readonly name: "epochId";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }];
        readonly outputs: readonly [{
            readonly type: "uint32";
            readonly name: "deposit";
        }, {
            readonly type: "uint32";
            readonly name: "redeem";
        }, {
            readonly type: "uint32";
            readonly name: "issue";
        }, {
            readonly type: "uint32";
            readonly name: "revoke";
        }];
    }, {
        readonly name: "epochInvestAmounts";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }, {
            readonly type: "uint32";
            readonly name: "epochId_";
        }];
        readonly outputs: readonly [{
            readonly type: "uint128";
            readonly name: "pendingAssetAmount";
        }, {
            readonly type: "uint128";
            readonly name: "approvedAssetAmount";
        }, {
            readonly type: "uint128";
            readonly name: "approvedPoolAmount";
        }, {
            readonly type: "uint128";
            readonly name: "pricePoolPerAsset";
        }, {
            readonly type: "uint128";
            readonly name: "navPoolPerShare";
        }, {
            readonly type: "uint64";
            readonly name: "issuedAt";
        }];
    }, {
        readonly name: "epochRedeemAmounts";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }, {
            readonly type: "uint32";
            readonly name: "epochId_";
        }];
        readonly outputs: readonly [{
            readonly type: "uint128";
            readonly name: "pendingShareAmount";
        }, {
            readonly type: "uint128";
            readonly name: "approvedShareAmount";
        }, {
            readonly type: "uint128";
            readonly name: "payoutAssetAmount";
        }, {
            readonly type: "uint128";
            readonly name: "pricePoolPerAsset";
        }, {
            readonly type: "uint128";
            readonly name: "navPoolPerShare";
        }, {
            readonly type: "uint64";
            readonly name: "revokedAt";
        }];
    }, {
        readonly name: "exists";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId_";
        }];
        readonly outputs: readonly [{
            readonly type: "bool";
        }];
    }, {
        readonly name: "forceCancelDepositRequest";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId_";
        }, {
            readonly type: "bytes32";
            readonly name: "investor";
        }, {
            readonly type: "uint128";
            readonly name: "depositAssetId";
        }];
        readonly outputs: readonly [{
            readonly type: "uint128";
            readonly name: "cancelledAssetAmount";
        }];
    }, {
        readonly name: "forceCancelRedeemRequest";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId_";
        }, {
            readonly type: "bytes32";
            readonly name: "investor";
        }, {
            readonly type: "uint128";
            readonly name: "payoutAssetId";
        }];
        readonly outputs: readonly [{
            readonly type: "uint128";
            readonly name: "cancelledShareAmount";
        }];
    }, {
        readonly name: "hubRegistry";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "address";
        }];
    }, {
        readonly name: "issuance";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint16";
            readonly name: "centrifugeId";
        }];
        readonly outputs: readonly [{
            readonly type: "uint128";
        }];
    }, {
        readonly name: "issueShares";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId_";
        }, {
            readonly type: "uint128";
            readonly name: "depositAssetId";
        }, {
            readonly type: "uint32";
            readonly name: "nowIssueEpochId";
        }, {
            readonly type: "uint128";
            readonly name: "navPoolPerShare";
        }];
        readonly outputs: readonly [{
            readonly type: "uint128";
            readonly name: "issuedShareAmount";
        }, {
            readonly type: "uint128";
            readonly name: "depositAssetAmount";
        }, {
            readonly type: "uint128";
            readonly name: "depositPoolAmount";
        }];
    }, {
        readonly name: "maxDepositClaims";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "bytes16";
            readonly name: "scId_";
        }, {
            readonly type: "bytes32";
            readonly name: "investor";
        }, {
            readonly type: "uint128";
            readonly name: "depositAssetId";
        }];
        readonly outputs: readonly [{
            readonly type: "uint32";
        }];
    }, {
        readonly name: "maxRedeemClaims";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "bytes16";
            readonly name: "scId_";
        }, {
            readonly type: "bytes32";
            readonly name: "investor";
        }, {
            readonly type: "uint128";
            readonly name: "payoutAssetId";
        }];
        readonly outputs: readonly [{
            readonly type: "uint32";
        }];
    }, {
        readonly name: "metadata";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "bytes16";
            readonly name: "scId";
        }];
        readonly outputs: readonly [{
            readonly type: "string";
            readonly name: "name";
        }, {
            readonly type: "string";
            readonly name: "symbol";
        }, {
            readonly type: "bytes32";
            readonly name: "salt";
        }];
    }, {
        readonly name: "metrics";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "bytes16";
            readonly name: "scId";
        }];
        readonly outputs: readonly [{
            readonly type: "uint128";
            readonly name: "totalIssuance";
        }, {
            readonly type: "uint128";
            readonly name: "navPerShare";
        }];
    }, {
        readonly name: "nowDepositEpoch";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "bytes16";
            readonly name: "scId_";
        }, {
            readonly type: "uint128";
            readonly name: "depositAssetId";
        }];
        readonly outputs: readonly [{
            readonly type: "uint32";
        }];
    }, {
        readonly name: "nowIssueEpoch";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "bytes16";
            readonly name: "scId_";
        }, {
            readonly type: "uint128";
            readonly name: "depositAssetId";
        }];
        readonly outputs: readonly [{
            readonly type: "uint32";
        }];
    }, {
        readonly name: "nowRedeemEpoch";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "bytes16";
            readonly name: "scId_";
        }, {
            readonly type: "uint128";
            readonly name: "depositAssetId";
        }];
        readonly outputs: readonly [{
            readonly type: "uint32";
        }];
    }, {
        readonly name: "nowRevokeEpoch";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "bytes16";
            readonly name: "scId_";
        }, {
            readonly type: "uint128";
            readonly name: "depositAssetId";
        }];
        readonly outputs: readonly [{
            readonly type: "uint32";
        }];
    }, {
        readonly name: "pendingDeposit";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "depositAssetId";
        }];
        readonly outputs: readonly [{
            readonly type: "uint128";
            readonly name: "pending";
        }];
    }, {
        readonly name: "pendingRedeem";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "payoutAssetId";
        }];
        readonly outputs: readonly [{
            readonly type: "uint128";
            readonly name: "pending";
        }];
    }, {
        readonly name: "previewNextShareClassId";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }];
        readonly outputs: readonly [{
            readonly type: "bytes16";
            readonly name: "scId";
        }];
    }, {
        readonly name: "previewShareClassId";
        readonly type: "function";
        readonly stateMutability: "pure";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "uint32";
            readonly name: "index";
        }];
        readonly outputs: readonly [{
            readonly type: "bytes16";
            readonly name: "scId";
        }];
    }, {
        readonly name: "queuedDepositRequest";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "depositAssetId";
        }, {
            readonly type: "bytes32";
            readonly name: "investor";
        }];
        readonly outputs: readonly [{
            readonly type: "bool";
            readonly name: "isCancelling";
        }, {
            readonly type: "uint128";
            readonly name: "amount";
        }];
    }, {
        readonly name: "queuedRedeemRequest";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "payoutAssetId";
        }, {
            readonly type: "bytes32";
            readonly name: "investor";
        }];
        readonly outputs: readonly [{
            readonly type: "bool";
            readonly name: "isCancelling";
        }, {
            readonly type: "uint128";
            readonly name: "amount";
        }];
    }, {
        readonly name: "redeemRequest";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "payoutAssetId";
        }, {
            readonly type: "bytes32";
            readonly name: "investor";
        }];
        readonly outputs: readonly [{
            readonly type: "uint128";
            readonly name: "pending";
        }, {
            readonly type: "uint32";
            readonly name: "lastUpdate";
        }];
    }, {
        readonly name: "rely";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "user";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "requestDeposit";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId_";
        }, {
            readonly type: "uint128";
            readonly name: "amount";
        }, {
            readonly type: "bytes32";
            readonly name: "investor";
        }, {
            readonly type: "uint128";
            readonly name: "depositAssetId";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "requestRedeem";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId_";
        }, {
            readonly type: "uint128";
            readonly name: "amount";
        }, {
            readonly type: "bytes32";
            readonly name: "investor";
        }, {
            readonly type: "uint128";
            readonly name: "payoutAssetId";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "revokeShares";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId_";
        }, {
            readonly type: "uint128";
            readonly name: "payoutAssetId";
        }, {
            readonly type: "uint32";
            readonly name: "nowRevokeEpochId";
        }, {
            readonly type: "uint128";
            readonly name: "navPoolPerShare";
        }];
        readonly outputs: readonly [{
            readonly type: "uint128";
            readonly name: "revokedShareAmount";
        }, {
            readonly type: "uint128";
            readonly name: "payoutAssetAmount";
        }, {
            readonly type: "uint128";
            readonly name: "payoutPoolAmount";
        }];
    }, {
        readonly name: "salts";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "bytes32";
            readonly name: "salt";
        }];
        readonly outputs: readonly [{
            readonly type: "bool";
        }];
    }, {
        readonly name: "shareClassCount";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }];
        readonly outputs: readonly [{
            readonly type: "uint32";
        }];
    }, {
        readonly name: "shareClassIds";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
        }];
        readonly outputs: readonly [{
            readonly type: "bool";
        }];
    }, {
        readonly name: "updateMetadata";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId_";
        }, {
            readonly type: "string";
            readonly name: "name";
        }, {
            readonly type: "string";
            readonly name: "symbol";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "updateSharePrice";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId_";
        }, {
            readonly type: "uint128";
            readonly name: "navPoolPerShare";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "updateShares";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint16";
            readonly name: "centrifugeId";
        }, {
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId_";
        }, {
            readonly type: "uint128";
            readonly name: "amount";
        }, {
            readonly type: "bool";
            readonly name: "isIssuance";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "wards";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
        }];
    }, {
        readonly name: "AddShareClass";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
            readonly indexed: true;
        }, {
            readonly type: "uint32";
            readonly name: "index";
            readonly indexed: true;
        }, {
            readonly type: "string";
            readonly name: "name";
        }, {
            readonly type: "string";
            readonly name: "symbol";
        }, {
            readonly type: "bytes32";
            readonly name: "salt";
        }];
    }, {
        readonly name: "AddShareClass";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
            readonly indexed: true;
        }, {
            readonly type: "uint32";
            readonly name: "index";
            readonly indexed: true;
        }];
    }, {
        readonly name: "ApproveDeposits";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
            readonly indexed: true;
        }, {
            readonly type: "uint128";
            readonly name: "depositAssetId";
            readonly indexed: true;
        }, {
            readonly type: "uint32";
            readonly name: "epoch";
        }, {
            readonly type: "uint128";
            readonly name: "approvedPoolAmount";
        }, {
            readonly type: "uint128";
            readonly name: "approvedAssetAmount";
        }, {
            readonly type: "uint128";
            readonly name: "pendingAssetAmount";
        }];
    }, {
        readonly name: "ApproveRedeems";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
            readonly indexed: true;
        }, {
            readonly type: "uint128";
            readonly name: "payoutAssetId";
            readonly indexed: true;
        }, {
            readonly type: "uint32";
            readonly name: "epoch";
        }, {
            readonly type: "uint128";
            readonly name: "approvedShareAmount";
        }, {
            readonly type: "uint128";
            readonly name: "pendingShareAmount";
        }];
    }, {
        readonly name: "ClaimDeposit";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
            readonly indexed: true;
        }, {
            readonly type: "uint32";
            readonly name: "epoch";
        }, {
            readonly type: "bytes32";
            readonly name: "investor";
        }, {
            readonly type: "uint128";
            readonly name: "depositAssetId";
            readonly indexed: true;
        }, {
            readonly type: "uint128";
            readonly name: "paymentAssetAmount";
        }, {
            readonly type: "uint128";
            readonly name: "pendingAssetAmount";
        }, {
            readonly type: "uint128";
            readonly name: "claimedShareAmount";
        }, {
            readonly type: "uint64";
            readonly name: "issuedAt";
        }];
    }, {
        readonly name: "ClaimRedeem";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
            readonly indexed: true;
        }, {
            readonly type: "uint32";
            readonly name: "epoch";
        }, {
            readonly type: "bytes32";
            readonly name: "investor";
        }, {
            readonly type: "uint128";
            readonly name: "payoutAssetId";
            readonly indexed: true;
        }, {
            readonly type: "uint128";
            readonly name: "paymentShareAmount";
        }, {
            readonly type: "uint128";
            readonly name: "pendingShareAmount";
        }, {
            readonly type: "uint128";
            readonly name: "claimedAssetAmount";
        }, {
            readonly type: "uint64";
            readonly name: "revokedAt";
        }];
    }, {
        readonly name: "Deny";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "user";
            readonly indexed: true;
        }];
    }, {
        readonly name: "IssueShares";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
            readonly indexed: true;
        }, {
            readonly type: "uint128";
            readonly name: "depositAssetId";
            readonly indexed: true;
        }, {
            readonly type: "uint32";
            readonly name: "epoch";
        }, {
            readonly type: "uint128";
            readonly name: "navPoolPerShare";
        }, {
            readonly type: "uint128";
            readonly name: "navAssetPerShare";
        }, {
            readonly type: "uint128";
            readonly name: "issuedShareAmount";
        }];
    }, {
        readonly name: "Rely";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "user";
            readonly indexed: true;
        }];
    }, {
        readonly name: "RemoteIssueShares";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint16";
            readonly name: "centrifugeId";
        }, {
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
            readonly indexed: true;
        }, {
            readonly type: "uint128";
            readonly name: "issuedShareAmount";
        }];
    }, {
        readonly name: "RemoteRevokeShares";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint16";
            readonly name: "centrifugeId";
        }, {
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
            readonly indexed: true;
        }, {
            readonly type: "uint128";
            readonly name: "revokedAssetAmount";
        }];
    }, {
        readonly name: "RevokeShares";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
            readonly indexed: true;
        }, {
            readonly type: "uint128";
            readonly name: "payoutAssetId";
            readonly indexed: true;
        }, {
            readonly type: "uint32";
            readonly name: "epoch";
        }, {
            readonly type: "uint128";
            readonly name: "navPoolPerShare";
        }, {
            readonly type: "uint128";
            readonly name: "navAssetPerShare";
        }, {
            readonly type: "uint128";
            readonly name: "revokedShareAmount";
        }, {
            readonly type: "uint128";
            readonly name: "revokedAssetAmount";
        }, {
            readonly type: "uint128";
            readonly name: "revokedPoolAmount";
        }];
    }, {
        readonly name: "UpdateDepositRequest";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
            readonly indexed: true;
        }, {
            readonly type: "uint128";
            readonly name: "depositAssetId";
            readonly indexed: true;
        }, {
            readonly type: "uint32";
            readonly name: "epoch";
        }, {
            readonly type: "bytes32";
            readonly name: "investor";
        }, {
            readonly type: "uint128";
            readonly name: "pendingUserAssetAmount";
        }, {
            readonly type: "uint128";
            readonly name: "pendingTotalAssetAmount";
        }, {
            readonly type: "uint128";
            readonly name: "queuedUserAssetAmount";
        }, {
            readonly type: "bool";
            readonly name: "pendingCancellation";
        }];
    }, {
        readonly name: "UpdateMetadata";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
            readonly indexed: true;
        }, {
            readonly type: "string";
            readonly name: "name";
        }, {
            readonly type: "string";
            readonly name: "symbol";
        }];
    }, {
        readonly name: "UpdateRedeemRequest";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
            readonly indexed: true;
        }, {
            readonly type: "uint128";
            readonly name: "payoutAssetId";
            readonly indexed: true;
        }, {
            readonly type: "uint32";
            readonly name: "epoch";
        }, {
            readonly type: "bytes32";
            readonly name: "investor";
        }, {
            readonly type: "uint128";
            readonly name: "pendingUserShareAmount";
        }, {
            readonly type: "uint128";
            readonly name: "pendingTotalShareAmount";
        }, {
            readonly type: "uint128";
            readonly name: "queuedUserShareAmount";
        }, {
            readonly type: "bool";
            readonly name: "pendingCancellation";
        }];
    }, {
        readonly name: "UpdateShareClass";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
            readonly indexed: true;
        }, {
            readonly type: "uint128";
            readonly name: "navPoolPerShare";
        }];
    }, {
        readonly name: "AlreadyIssued";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "AlreadyUsedSalt";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "ApprovalRequired";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "CancellationInitializationRequired";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "CancellationQueued";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "DecreaseMoreThanIssued";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "EpochNotFound";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "EpochNotInSequence";
        readonly type: "error";
        readonly inputs: readonly [{
            readonly type: "uint32";
            readonly name: "providedEpoch";
        }, {
            readonly type: "uint32";
            readonly name: "nowEpoch";
        }];
    }, {
        readonly name: "InsufficientPending";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "InvalidMetadataName";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "InvalidMetadataSize";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "InvalidMetadataSymbol";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "InvalidSalt";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "IssuanceRequired";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "MulDiv_Overflow";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "NoOrderFound";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "NotAuthorized";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "PoolMissing";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "RevocationRequired";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "RevokeMoreThanIssued";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "ShareClassNotFound";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "Uint128_Overflow";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "Uint64_Overflow";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "ZeroApprovalAmount";
        readonly type: "error";
        readonly inputs: readonly [];
    }];
    HubRegistry: readonly [{
        readonly name: "AssetAlreadyRegistered";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "AssetNotFound";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "EmptyAccount";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "EmptyCurrency";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "EmptyShareClassManager";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "NonExistingPool";
        readonly type: "error";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "id";
        }];
    }, {
        readonly name: "NotAuthorized";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "PoolAlreadyRegistered";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "Uint128_Overflow";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "Deny";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "user";
            readonly indexed: true;
        }];
    }, {
        readonly name: "NewAsset";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint128";
            readonly name: "assetId";
            readonly indexed: true;
        }, {
            readonly type: "uint8";
            readonly name: "decimals";
        }];
    }, {
        readonly name: "NewPool";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "address";
            readonly name: "manager";
            readonly indexed: true;
        }, {
            readonly type: "uint128";
            readonly name: "currency";
            readonly indexed: true;
        }];
    }, {
        readonly name: "Rely";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "user";
            readonly indexed: true;
        }];
    }, {
        readonly name: "SetMetadata";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes";
            readonly name: "metadata";
        }];
    }, {
        readonly name: "UpdateCurrency";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "uint128";
            readonly name: "currency";
        }];
    }, {
        readonly name: "UpdateDependency";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "bytes32";
            readonly name: "what";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "dependency";
        }];
    }, {
        readonly name: "UpdateManager";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "manager";
            readonly indexed: true;
        }, {
            readonly type: "bool";
            readonly name: "canManage";
        }];
    }, {
        readonly name: "currency";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint64";
        }];
        readonly outputs: readonly [{
            readonly type: "uint128";
        }];
    }, {
        readonly name: "decimals";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint128";
            readonly name: "assetId";
        }];
        readonly outputs: readonly [{
            readonly type: "uint8";
            readonly name: "decimals_";
        }];
    }, {
        readonly name: "decimals";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint256";
            readonly name: "asset_";
        }];
        readonly outputs: readonly [{
            readonly type: "uint8";
            readonly name: "decimals_";
        }];
    }, {
        readonly name: "decimals";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId_";
        }];
        readonly outputs: readonly [{
            readonly type: "uint8";
            readonly name: "decimals_";
        }];
    }, {
        readonly name: "deny";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "user";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "dependency";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly type: "address";
        }];
    }, {
        readonly name: "exists";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId_";
        }];
        readonly outputs: readonly [{
            readonly type: "bool";
        }];
    }, {
        readonly name: "isRegistered";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint128";
            readonly name: "assetId";
        }];
        readonly outputs: readonly [{
            readonly type: "bool";
        }];
    }, {
        readonly name: "manager";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint64";
        }, {
            readonly type: "address";
        }];
        readonly outputs: readonly [{
            readonly type: "bool";
        }];
    }, {
        readonly name: "metadata";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint64";
        }];
        readonly outputs: readonly [{
            readonly type: "bytes";
        }];
    }, {
        readonly name: "poolId";
        readonly type: "function";
        readonly stateMutability: "pure";
        readonly inputs: readonly [{
            readonly type: "uint16";
            readonly name: "centrifugeId";
        }, {
            readonly type: "uint48";
            readonly name: "postfix";
        }];
        readonly outputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId_";
        }];
    }, {
        readonly name: "registerAsset";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint128";
            readonly name: "assetId";
        }, {
            readonly type: "uint8";
            readonly name: "decimals_";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "registerPool";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId_";
        }, {
            readonly type: "address";
            readonly name: "manager_";
        }, {
            readonly type: "uint128";
            readonly name: "currency_";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "rely";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "user";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "setMetadata";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId_";
        }, {
            readonly type: "bytes";
            readonly name: "metadata_";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "updateCurrency";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId_";
        }, {
            readonly type: "uint128";
            readonly name: "currency_";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "updateDependency";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "bytes32";
            readonly name: "what";
        }, {
            readonly type: "address";
            readonly name: "dependency_";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "updateManager";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId_";
        }, {
            readonly type: "address";
            readonly name: "manager_";
        }, {
            readonly type: "bool";
            readonly name: "canManage";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "wards";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
        }];
    }];
    MessageDispatcher: readonly [{
        readonly name: "localCentrifugeId";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "uint16";
        }];
    }];
    Currency: readonly [{
        readonly name: "Approval";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "owner";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "spender";
            readonly indexed: true;
        }, {
            readonly type: "uint256";
            readonly name: "value";
        }];
    }, {
        readonly name: "Transfer";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "from";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "to";
            readonly indexed: true;
        }, {
            readonly type: "uint256";
            readonly name: "value";
        }];
    }, {
        readonly name: "PERMIT_TYPEHASH";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "bytes32";
        }];
    }, {
        readonly name: "nonces";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
        }];
    }, {
        readonly name: "approve";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
        }, {
            readonly type: "uint256";
        }];
        readonly outputs: readonly [{
            readonly type: "bool";
        }];
    }, {
        readonly name: "transfer";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
        }, {
            readonly type: "uint256";
        }];
        readonly outputs: readonly [{
            readonly type: "bool";
        }];
    }, {
        readonly name: "balanceOf";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
        }];
    }, {
        readonly name: "allowance";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "owner";
        }, {
            readonly type: "address";
            readonly name: "spender";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
        }];
    }, {
        readonly name: "decimals";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "uint8";
        }];
    }, {
        readonly name: "name";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "string";
        }];
    }, {
        readonly name: "symbol";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "string";
        }];
    }, {
        readonly name: "checkTransferRestriction";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
        }, {
            readonly type: "address";
        }, {
            readonly type: "uint256";
        }];
        readonly outputs: readonly [{
            readonly type: "bool";
        }];
    }, {
        readonly name: "hook";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "address";
        }];
    }];
    ERC6909: readonly [{
        readonly name: "allowance";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "owner";
        }, {
            readonly type: "address";
            readonly name: "spender";
        }, {
            readonly type: "uint256";
            readonly name: "tokenId";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
            readonly name: "amount";
        }];
    }, {
        readonly name: "approve";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "spender";
        }, {
            readonly type: "uint256";
            readonly name: "tokenId";
        }, {
            readonly type: "uint256";
            readonly name: "amount";
        }];
        readonly outputs: readonly [{
            readonly type: "bool";
        }];
    }, {
        readonly name: "balanceOf";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "owner";
        }, {
            readonly type: "uint256";
            readonly name: "tokenId";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
            readonly name: "amount";
        }];
    }, {
        readonly name: "name";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint256";
            readonly name: "tokenId";
        }];
        readonly outputs: readonly [{
            readonly type: "string";
        }];
    }, {
        readonly name: "symbol";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint256";
            readonly name: "tokenId";
        }];
        readonly outputs: readonly [{
            readonly type: "string";
        }];
    }, {
        readonly name: "decimals";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint256";
            readonly name: "tokenId";
        }];
        readonly outputs: readonly [{
            readonly type: "uint8";
        }];
    }, {
        readonly name: "Approval";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "owner";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "spender";
            readonly indexed: true;
        }, {
            readonly type: "uint256";
            readonly name: "tokenId";
            readonly indexed: true;
        }, {
            readonly type: "uint256";
            readonly name: "amount";
        }];
    }, {
        readonly name: "Transfer";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "caller";
        }, {
            readonly type: "address";
            readonly name: "from";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "to";
            readonly indexed: true;
        }, {
            readonly type: "uint256";
            readonly name: "tokenId";
            readonly indexed: true;
        }, {
            readonly type: "uint256";
            readonly name: "amount";
        }];
    }];
    RestrictionManager: readonly [{
        readonly name: "Freeze";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "token";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "user";
            readonly indexed: true;
        }];
    }, {
        readonly name: "Unfreeze";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "token";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "user";
            readonly indexed: true;
        }];
    }, {
        readonly name: "UpdateMember";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "token";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "user";
            readonly indexed: true;
        }, {
            readonly type: "uint64";
            readonly name: "validUntil";
        }];
    }, {
        readonly name: "freeze";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "token";
        }, {
            readonly type: "address";
            readonly name: "user";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "isFrozen";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "token";
        }, {
            readonly type: "address";
            readonly name: "user";
        }];
        readonly outputs: readonly [{
            readonly type: "bool";
        }];
    }, {
        readonly name: "isMember";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "token";
        }, {
            readonly type: "address";
            readonly name: "user";
        }];
        readonly outputs: readonly [{
            readonly type: "bool";
            readonly name: "isValid";
        }, {
            readonly type: "uint64";
            readonly name: "validUntil";
        }];
    }, {
        readonly name: "unfreeze";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "token";
        }, {
            readonly type: "address";
            readonly name: "user";
        }];
        readonly outputs: readonly [];
    }];
    MerkleProofManager: readonly [{
        readonly name: "execute";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "tuple[]";
            readonly components: readonly [{
                readonly type: "address";
                readonly name: "decoder";
            }, {
                readonly type: "address";
                readonly name: "target";
            }, {
                readonly type: "bytes";
                readonly name: "targetData";
            }, {
                readonly type: "uint256";
                readonly name: "value";
            }, {
                readonly type: "bytes32[]";
                readonly name: "proof";
            }];
            readonly name: "calls";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "policy";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "strategist";
        }];
        readonly outputs: readonly [{
            readonly type: "bytes32";
            readonly name: "root";
        }];
    }];
    AsyncVault: readonly [{
        readonly name: "AUTHORIZE_OPERATOR_TYPEHASH";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "bytes32";
        }];
    }, {
        readonly name: "DOMAIN_SEPARATOR";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "bytes32";
        }];
    }, {
        readonly name: "asset";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "address";
        }];
    }, {
        readonly name: "asyncManager";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "address";
        }];
    }, {
        readonly name: "asyncRedeemManager";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "address";
        }];
    }, {
        readonly name: "authorizations";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "controller";
        }, {
            readonly type: "bytes32";
            readonly name: "nonce";
        }];
        readonly outputs: readonly [{
            readonly type: "bool";
            readonly name: "used";
        }];
    }, {
        readonly name: "authorizeOperator";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "controller";
        }, {
            readonly type: "address";
            readonly name: "operator";
        }, {
            readonly type: "bool";
            readonly name: "approved";
        }, {
            readonly type: "bytes32";
            readonly name: "nonce";
        }, {
            readonly type: "uint256";
            readonly name: "deadline";
        }, {
            readonly type: "bytes";
            readonly name: "signature";
        }];
        readonly outputs: readonly [{
            readonly type: "bool";
            readonly name: "success";
        }];
    }, {
        readonly name: "baseManager";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "address";
        }];
    }, {
        readonly name: "cancelDepositRequest";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint256";
        }, {
            readonly type: "address";
            readonly name: "controller";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "cancelRedeemRequest";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint256";
        }, {
            readonly type: "address";
            readonly name: "controller";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "claimCancelDepositRequest";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint256";
        }, {
            readonly type: "address";
            readonly name: "receiver";
        }, {
            readonly type: "address";
            readonly name: "controller";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
            readonly name: "assets";
        }];
    }, {
        readonly name: "claimCancelRedeemRequest";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint256";
        }, {
            readonly type: "address";
            readonly name: "receiver";
        }, {
            readonly type: "address";
            readonly name: "controller";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
            readonly name: "shares";
        }];
    }, {
        readonly name: "claimableCancelDepositRequest";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint256";
        }, {
            readonly type: "address";
            readonly name: "controller";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
            readonly name: "claimableAssets";
        }];
    }, {
        readonly name: "claimableCancelRedeemRequest";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint256";
        }, {
            readonly type: "address";
            readonly name: "controller";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
            readonly name: "claimableShares";
        }];
    }, {
        readonly name: "claimableDepositRequest";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint256";
        }, {
            readonly type: "address";
            readonly name: "controller";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
            readonly name: "claimableAssets";
        }];
    }, {
        readonly name: "claimableRedeemRequest";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint256";
        }, {
            readonly type: "address";
            readonly name: "controller";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
            readonly name: "claimableShares";
        }];
    }, {
        readonly name: "convertToAssets";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint256";
            readonly name: "shares";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
            readonly name: "assets";
        }];
    }, {
        readonly name: "convertToShares";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint256";
            readonly name: "assets";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
            readonly name: "shares";
        }];
    }, {
        readonly name: "deny";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "user";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "deploymentChainId";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "uint256";
        }];
    }, {
        readonly name: "deposit";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint256";
            readonly name: "assets";
        }, {
            readonly type: "address";
            readonly name: "receiver";
        }, {
            readonly type: "address";
            readonly name: "controller";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
            readonly name: "shares";
        }];
    }, {
        readonly name: "deposit";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint256";
            readonly name: "assets";
        }, {
            readonly type: "address";
            readonly name: "receiver";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
            readonly name: "shares";
        }];
    }, {
        readonly name: "file";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "bytes32";
            readonly name: "what";
        }, {
            readonly type: "address";
            readonly name: "data";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "invalidateNonce";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "bytes32";
            readonly name: "nonce";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "isOperator";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
        }, {
            readonly type: "address";
        }];
        readonly outputs: readonly [{
            readonly type: "bool";
        }];
    }, {
        readonly name: "isPermissioned";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "controller";
        }];
        readonly outputs: readonly [{
            readonly type: "bool";
        }];
    }, {
        readonly name: "manager";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "address";
        }];
    }, {
        readonly name: "maxDeposit";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "controller";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
            readonly name: "maxAssets";
        }];
    }, {
        readonly name: "maxMint";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "controller";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
            readonly name: "maxShares";
        }];
    }, {
        readonly name: "maxRedeem";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "controller";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
            readonly name: "maxShares";
        }];
    }, {
        readonly name: "maxWithdraw";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "controller";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
            readonly name: "maxAssets";
        }];
    }, {
        readonly name: "mint";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint256";
            readonly name: "shares";
        }, {
            readonly type: "address";
            readonly name: "receiver";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
            readonly name: "assets";
        }];
    }, {
        readonly name: "mint";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint256";
            readonly name: "shares";
        }, {
            readonly type: "address";
            readonly name: "receiver";
        }, {
            readonly type: "address";
            readonly name: "controller";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
            readonly name: "assets";
        }];
    }, {
        readonly name: "onCancelDepositClaimable";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "controller";
        }, {
            readonly type: "uint256";
            readonly name: "assets";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "onCancelRedeemClaimable";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "controller";
        }, {
            readonly type: "uint256";
            readonly name: "shares";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "onDepositClaimable";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "controller";
        }, {
            readonly type: "uint256";
            readonly name: "assets";
        }, {
            readonly type: "uint256";
            readonly name: "shares";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "onRedeemClaimable";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "controller";
        }, {
            readonly type: "uint256";
            readonly name: "assets";
        }, {
            readonly type: "uint256";
            readonly name: "shares";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "onRedeemRequest";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "controller";
        }, {
            readonly type: "address";
            readonly name: "owner";
        }, {
            readonly type: "uint256";
            readonly name: "shares";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "pendingCancelDepositRequest";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint256";
        }, {
            readonly type: "address";
            readonly name: "controller";
        }];
        readonly outputs: readonly [{
            readonly type: "bool";
            readonly name: "isPending";
        }];
    }, {
        readonly name: "pendingCancelRedeemRequest";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint256";
        }, {
            readonly type: "address";
            readonly name: "controller";
        }];
        readonly outputs: readonly [{
            readonly type: "bool";
            readonly name: "isPending";
        }];
    }, {
        readonly name: "pendingDepositRequest";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint256";
        }, {
            readonly type: "address";
            readonly name: "controller";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
            readonly name: "pendingAssets";
        }];
    }, {
        readonly name: "pendingRedeemRequest";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint256";
        }, {
            readonly type: "address";
            readonly name: "controller";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
            readonly name: "pendingShares";
        }];
    }, {
        readonly name: "poolId";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "uint64";
        }];
    }, {
        readonly name: "previewDeposit";
        readonly type: "function";
        readonly stateMutability: "pure";
        readonly inputs: readonly [{
            readonly type: "uint256";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
        }];
    }, {
        readonly name: "previewMint";
        readonly type: "function";
        readonly stateMutability: "pure";
        readonly inputs: readonly [{
            readonly type: "uint256";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
        }];
    }, {
        readonly name: "previewRedeem";
        readonly type: "function";
        readonly stateMutability: "pure";
        readonly inputs: readonly [{
            readonly type: "uint256";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
        }];
    }, {
        readonly name: "previewWithdraw";
        readonly type: "function";
        readonly stateMutability: "pure";
        readonly inputs: readonly [{
            readonly type: "uint256";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
        }];
    }, {
        readonly name: "priceLastUpdated";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "uint64";
        }];
    }, {
        readonly name: "pricePerShare";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "uint256";
        }];
    }, {
        readonly name: "recoverTokens";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "token";
        }, {
            readonly type: "address";
            readonly name: "receiver";
        }, {
            readonly type: "uint256";
            readonly name: "amount";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "recoverTokens";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "token";
        }, {
            readonly type: "uint256";
            readonly name: "tokenId";
        }, {
            readonly type: "address";
            readonly name: "receiver";
        }, {
            readonly type: "uint256";
            readonly name: "amount";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "redeem";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint256";
            readonly name: "shares";
        }, {
            readonly type: "address";
            readonly name: "receiver";
        }, {
            readonly type: "address";
            readonly name: "controller";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
            readonly name: "assets";
        }];
    }, {
        readonly name: "rely";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "user";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "requestDeposit";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint256";
            readonly name: "assets";
        }, {
            readonly type: "address";
            readonly name: "controller";
        }, {
            readonly type: "address";
            readonly name: "owner";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
        }];
    }, {
        readonly name: "requestRedeem";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint256";
            readonly name: "shares";
        }, {
            readonly type: "address";
            readonly name: "controller";
        }, {
            readonly type: "address";
            readonly name: "owner";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
        }];
    }, {
        readonly name: "root";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "address";
        }];
    }, {
        readonly name: "scId";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "bytes16";
        }];
    }, {
        readonly name: "setEndorsedOperator";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "owner";
        }, {
            readonly type: "bool";
            readonly name: "approved";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "setOperator";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "operator";
        }, {
            readonly type: "bool";
            readonly name: "approved";
        }];
        readonly outputs: readonly [{
            readonly type: "bool";
            readonly name: "success";
        }];
    }, {
        readonly name: "share";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "address";
        }];
    }, {
        readonly name: "supportsInterface";
        readonly type: "function";
        readonly stateMutability: "pure";
        readonly inputs: readonly [{
            readonly type: "bytes4";
            readonly name: "interfaceId";
        }];
        readonly outputs: readonly [{
            readonly type: "bool";
        }];
    }, {
        readonly name: "totalAssets";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "uint256";
        }];
    }, {
        readonly name: "vaultKind";
        readonly type: "function";
        readonly stateMutability: "pure";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "uint8";
            readonly name: "vaultKind_";
        }];
    }, {
        readonly name: "wards";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
        }];
    }, {
        readonly name: "withdraw";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint256";
            readonly name: "assets";
        }, {
            readonly type: "address";
            readonly name: "receiver";
        }, {
            readonly type: "address";
            readonly name: "controller";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
            readonly name: "shares";
        }];
    }, {
        readonly name: "CancelDepositClaim";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "controller";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "receiver";
            readonly indexed: true;
        }, {
            readonly type: "uint256";
            readonly name: "requestId";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "sender";
        }, {
            readonly type: "uint256";
            readonly name: "assets";
        }];
    }, {
        readonly name: "CancelDepositClaimable";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "controller";
            readonly indexed: true;
        }, {
            readonly type: "uint256";
            readonly name: "requestId";
            readonly indexed: true;
        }, {
            readonly type: "uint256";
            readonly name: "assets";
        }];
    }, {
        readonly name: "CancelDepositRequest";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "controller";
            readonly indexed: true;
        }, {
            readonly type: "uint256";
            readonly name: "requestId";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "sender";
        }];
    }, {
        readonly name: "CancelRedeemClaim";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "controller";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "receiver";
            readonly indexed: true;
        }, {
            readonly type: "uint256";
            readonly name: "requestId";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "sender";
        }, {
            readonly type: "uint256";
            readonly name: "shares";
        }];
    }, {
        readonly name: "CancelRedeemClaimable";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "controller";
            readonly indexed: true;
        }, {
            readonly type: "uint256";
            readonly name: "requestId";
            readonly indexed: true;
        }, {
            readonly type: "uint256";
            readonly name: "shares";
        }];
    }, {
        readonly name: "CancelRedeemRequest";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "controller";
            readonly indexed: true;
        }, {
            readonly type: "uint256";
            readonly name: "requestId";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "sender";
        }];
    }, {
        readonly name: "Deny";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "user";
            readonly indexed: true;
        }];
    }, {
        readonly name: "Deposit";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "sender";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "owner";
            readonly indexed: true;
        }, {
            readonly type: "uint256";
            readonly name: "assets";
        }, {
            readonly type: "uint256";
            readonly name: "shares";
        }];
    }, {
        readonly name: "DepositClaimable";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "controller";
            readonly indexed: true;
        }, {
            readonly type: "uint256";
            readonly name: "requestId";
            readonly indexed: true;
        }, {
            readonly type: "uint256";
            readonly name: "assets";
        }, {
            readonly type: "uint256";
            readonly name: "shares";
        }];
    }, {
        readonly name: "DepositRequest";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "controller";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "owner";
            readonly indexed: true;
        }, {
            readonly type: "uint256";
            readonly name: "requestId";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "sender";
        }, {
            readonly type: "uint256";
            readonly name: "assets";
        }];
    }, {
        readonly name: "File";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "bytes32";
            readonly name: "what";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "data";
        }];
    }, {
        readonly name: "OperatorSet";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "controller";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "operator";
            readonly indexed: true;
        }, {
            readonly type: "bool";
            readonly name: "approved";
        }];
    }, {
        readonly name: "RedeemClaimable";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "controller";
            readonly indexed: true;
        }, {
            readonly type: "uint256";
            readonly name: "requestId";
            readonly indexed: true;
        }, {
            readonly type: "uint256";
            readonly name: "assets";
        }, {
            readonly type: "uint256";
            readonly name: "shares";
        }];
    }, {
        readonly name: "RedeemRequest";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "controller";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "owner";
            readonly indexed: true;
        }, {
            readonly type: "uint256";
            readonly name: "requestId";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "sender";
        }, {
            readonly type: "uint256";
            readonly name: "assets";
        }];
    }, {
        readonly name: "Rely";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "user";
            readonly indexed: true;
        }];
    }, {
        readonly name: "Withdraw";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "sender";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "receiver";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "owner";
            readonly indexed: true;
        }, {
            readonly type: "uint256";
            readonly name: "assets";
        }, {
            readonly type: "uint256";
            readonly name: "shares";
        }];
    }, {
        readonly name: "AlreadyUsedAuthorization";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "CannotSetSelfAsOperator";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "ExpiredAuthorization";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "FileUnrecognizedParam";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "InsufficientBalance";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "InvalidAuthorization";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "InvalidController";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "InvalidOwner";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "InvalidSigner";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "NoCode";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "NotAuthorized";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "NotEndorsed";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "RequestDepositFailed";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "RequestRedeemFailed";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "SafeTransferEthFailed";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "TransferFromFailed";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "WrappedError";
        readonly type: "error";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "target";
        }, {
            readonly type: "bytes4";
            readonly name: "selector";
        }, {
            readonly type: "bytes";
            readonly name: "reason";
        }, {
            readonly type: "bytes";
            readonly name: "details";
        }];
    }];
    Spoke: readonly [{
        readonly name: "addPool";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "addShareClass";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "string";
            readonly name: "name";
        }, {
            readonly type: "string";
            readonly name: "symbol";
        }, {
            readonly type: "uint8";
            readonly name: "decimals";
        }, {
            readonly type: "bytes32";
            readonly name: "salt";
        }, {
            readonly type: "address";
            readonly name: "hook";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "assetToId";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "asset";
        }, {
            readonly type: "uint256";
            readonly name: "tokenId";
        }];
        readonly outputs: readonly [{
            readonly type: "uint128";
            readonly name: "assetId";
        }];
    }, {
        readonly name: "deny";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "user";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "deployVault";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }, {
            readonly type: "address";
            readonly name: "factory";
        }];
        readonly outputs: readonly [{
            readonly type: "address";
        }];
    }, {
        readonly name: "executeTransferShares";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "bytes32";
            readonly name: "receiver";
        }, {
            readonly type: "uint128";
            readonly name: "amount";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "file";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "bytes32";
            readonly name: "what";
        }, {
            readonly type: "address";
            readonly name: "factory";
        }, {
            readonly type: "bool";
            readonly name: "status";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "file";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "bytes32";
            readonly name: "what";
        }, {
            readonly type: "address";
            readonly name: "data";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "gateway";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "address";
        }];
    }, {
        readonly name: "idToAsset";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint128";
            readonly name: "assetId";
        }];
        readonly outputs: readonly [{
            readonly type: "address";
            readonly name: "asset";
        }, {
            readonly type: "uint256";
            readonly name: "tokenId";
        }];
    }, {
        readonly name: "isLinked";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault";
        }];
        readonly outputs: readonly [{
            readonly type: "bool";
        }];
    }, {
        readonly name: "isPoolActive";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }];
        readonly outputs: readonly [{
            readonly type: "bool";
        }];
    }, {
        readonly name: "linkToken";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "address";
            readonly name: "shareToken_";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "linkVault";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }, {
            readonly type: "address";
            readonly name: "vault";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "markersPricePoolPerAsset";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }];
        readonly outputs: readonly [{
            readonly type: "uint64";
            readonly name: "computedAt";
        }, {
            readonly type: "uint64";
            readonly name: "maxAge";
        }, {
            readonly type: "uint64";
            readonly name: "validUntil";
        }];
    }, {
        readonly name: "markersPricePoolPerShare";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }];
        readonly outputs: readonly [{
            readonly type: "uint64";
            readonly name: "computedAt";
        }, {
            readonly type: "uint64";
            readonly name: "maxAge";
        }, {
            readonly type: "uint64";
            readonly name: "validUntil";
        }];
    }, {
        readonly name: "poolEscrowFactory";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "address";
        }];
    }, {
        readonly name: "pools";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
            readonly name: "createdAt";
        }];
    }, {
        readonly name: "pricePoolPerAsset";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }, {
            readonly type: "bool";
            readonly name: "checkValidity";
        }];
        readonly outputs: readonly [{
            readonly type: "uint128";
            readonly name: "price";
        }];
    }, {
        readonly name: "pricePoolPerShare";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "bool";
            readonly name: "checkValidity";
        }];
        readonly outputs: readonly [{
            readonly type: "uint128";
            readonly name: "price";
        }];
    }, {
        readonly name: "pricesPoolPer";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }, {
            readonly type: "bool";
            readonly name: "checkValidity";
        }];
        readonly outputs: readonly [{
            readonly type: "uint128";
            readonly name: "pricePoolPerAsset_";
        }, {
            readonly type: "uint128";
            readonly name: "pricePoolPerShare_";
        }];
    }, {
        readonly name: "recoverTokens";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "token";
        }, {
            readonly type: "address";
            readonly name: "receiver";
        }, {
            readonly type: "uint256";
            readonly name: "amount";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "recoverTokens";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "token";
        }, {
            readonly type: "uint256";
            readonly name: "tokenId";
        }, {
            readonly type: "address";
            readonly name: "receiver";
        }, {
            readonly type: "uint256";
            readonly name: "amount";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "registerAsset";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "uint16";
            readonly name: "centrifugeId";
        }, {
            readonly type: "address";
            readonly name: "asset";
        }, {
            readonly type: "uint256";
            readonly name: "tokenId";
        }];
        readonly outputs: readonly [{
            readonly type: "uint128";
            readonly name: "assetId";
        }];
    }, {
        readonly name: "registerVault";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }, {
            readonly type: "address";
            readonly name: "asset";
        }, {
            readonly type: "uint256";
            readonly name: "tokenId";
        }, {
            readonly type: "address";
            readonly name: "factory";
        }, {
            readonly type: "address";
            readonly name: "vault";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "rely";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "user";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "sender";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "address";
        }];
    }, {
        readonly name: "setMaxAssetPriceAge";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }, {
            readonly type: "uint64";
            readonly name: "maxPriceAge";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "setMaxSharePriceAge";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint64";
            readonly name: "maxPriceAge";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "shareToken";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }];
        readonly outputs: readonly [{
            readonly type: "address";
        }];
    }, {
        readonly name: "tokenFactory";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "address";
        }];
    }, {
        readonly name: "transferShares";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "uint16";
            readonly name: "centrifugeId";
        }, {
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "bytes32";
            readonly name: "receiver";
        }, {
            readonly type: "uint128";
            readonly name: "amount";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "unlinkVault";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }, {
            readonly type: "address";
            readonly name: "vault";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "updateContract";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "address";
            readonly name: "target";
        }, {
            readonly type: "bytes";
            readonly name: "update";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "updatePricePoolPerAsset";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }, {
            readonly type: "uint128";
            readonly name: "poolPerAsset_";
        }, {
            readonly type: "uint64";
            readonly name: "computedAt";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "updatePricePoolPerShare";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "price";
        }, {
            readonly type: "uint64";
            readonly name: "computedAt";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "updateRestriction";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "bytes";
            readonly name: "update";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "updateShareHook";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "address";
            readonly name: "hook";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "updateShareMetadata";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "string";
            readonly name: "name";
        }, {
            readonly type: "string";
            readonly name: "symbol";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "updateVault";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }, {
            readonly type: "address";
            readonly name: "vaultOrFactory";
        }, {
            readonly type: "uint8";
            readonly name: "kind";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "vaultDetails";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault";
        }];
        readonly outputs: readonly [{
            readonly type: "tuple";
            readonly components: readonly [{
                readonly type: "uint128";
                readonly name: "assetId";
            }, {
                readonly type: "address";
                readonly name: "asset";
            }, {
                readonly type: "uint256";
                readonly name: "tokenId";
            }, {
                readonly type: "bool";
                readonly name: "isLinked";
            }];
            readonly name: "details";
        }];
    }, {
        readonly name: "vaultFactory";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "factory";
        }];
        readonly outputs: readonly [{
            readonly type: "bool";
        }];
    }, {
        readonly name: "wards";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
        }];
    }, {
        readonly name: "AddPool";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }];
    }, {
        readonly name: "AddShareClass";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "token";
        }];
    }, {
        readonly name: "Deny";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "user";
            readonly indexed: true;
        }];
    }, {
        readonly name: "DeployVault";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "asset";
            readonly indexed: true;
        }, {
            readonly type: "uint256";
            readonly name: "tokenId";
        }, {
            readonly type: "address";
            readonly name: "factory";
        }, {
            readonly type: "address";
            readonly name: "vault";
        }, {
            readonly type: "uint8";
            readonly name: "kind";
        }];
    }, {
        readonly name: "ExecuteTransferShares";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "receiver";
            readonly indexed: true;
        }, {
            readonly type: "uint128";
            readonly name: "amount";
        }];
    }, {
        readonly name: "File";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "bytes32";
            readonly name: "what";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "data";
        }];
    }, {
        readonly name: "File";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "bytes32";
            readonly name: "what";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "factory";
        }, {
            readonly type: "bool";
            readonly name: "status";
        }];
    }, {
        readonly name: "LinkVault";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "asset";
            readonly indexed: true;
        }, {
            readonly type: "uint256";
            readonly name: "tokenId";
        }, {
            readonly type: "address";
            readonly name: "vault";
        }];
    }, {
        readonly name: "RegisterAsset";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint128";
            readonly name: "assetId";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "asset";
            readonly indexed: true;
        }, {
            readonly type: "uint256";
            readonly name: "tokenId";
            readonly indexed: true;
        }, {
            readonly type: "string";
            readonly name: "name";
        }, {
            readonly type: "string";
            readonly name: "symbol";
        }, {
            readonly type: "uint8";
            readonly name: "decimals";
        }, {
            readonly type: "bool";
            readonly name: "isInitialization";
        }];
    }, {
        readonly name: "Rely";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "user";
            readonly indexed: true;
        }];
    }, {
        readonly name: "TransferShares";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint16";
            readonly name: "centrifugeId";
        }, {
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "sender";
            readonly indexed: true;
        }, {
            readonly type: "bytes32";
            readonly name: "destinationAddress";
        }, {
            readonly type: "uint128";
            readonly name: "amount";
        }];
    }, {
        readonly name: "UnlinkVault";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "asset";
            readonly indexed: true;
        }, {
            readonly type: "uint256";
            readonly name: "tokenId";
        }, {
            readonly type: "address";
            readonly name: "vault";
        }];
    }, {
        readonly name: "UpdateAssetPrice";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "asset";
            readonly indexed: true;
        }, {
            readonly type: "uint256";
            readonly name: "tokenId";
        }, {
            readonly type: "uint256";
            readonly name: "price";
        }, {
            readonly type: "uint64";
            readonly name: "computedAt";
        }];
    }, {
        readonly name: "UpdateContract";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "target";
        }, {
            readonly type: "bytes";
            readonly name: "payload";
        }];
    }, {
        readonly name: "UpdateMaxAssetPriceAge";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "asset";
            readonly indexed: true;
        }, {
            readonly type: "uint256";
            readonly name: "tokenId";
        }, {
            readonly type: "uint64";
            readonly name: "maxPriceAge";
        }];
    }, {
        readonly name: "UpdateMaxSharePriceAge";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
            readonly indexed: true;
        }, {
            readonly type: "uint64";
            readonly name: "maxPriceAge";
        }];
    }, {
        readonly name: "UpdateSharePrice";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
            readonly indexed: true;
        }, {
            readonly type: "uint256";
            readonly name: "price";
        }, {
            readonly type: "uint64";
            readonly name: "computedAt";
        }];
    }, {
        readonly name: "AssetMissingDecimals";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "CannotSetOlderPrice";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "CrossChainTransferNotAllowed";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "FileUnrecognizedParam";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "InvalidFactory";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "InvalidHook";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "InvalidPool";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "InvalidPrice";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "LocalTransferNotAllowed";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "MalformedVaultUpdateMessage";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "NoCode";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "NotAuthorized";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "OldHook";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "OldMetadata";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "PoolAlreadyAdded";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "SafeTransferEthFailed";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "ShareClassAlreadyRegistered";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "ShareTokenDoesNotExist";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "ShareTokenTransferFailed";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "TooFewDecimals";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "TooManyDecimals";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "TransferFromFailed";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "UnauthorizedSender";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "UnknownAsset";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "UnknownToken";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "UnknownVault";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "WrappedError";
        readonly type: "error";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "target";
        }, {
            readonly type: "bytes4";
            readonly name: "selector";
        }, {
            readonly type: "bytes";
            readonly name: "reason";
        }, {
            readonly type: "bytes";
            readonly name: "details";
        }];
    }];
    Gateway: readonly [{
        readonly name: "repay";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "uint16";
            readonly name: "centrifugeId";
        }, {
            readonly type: "bytes";
            readonly name: "batch";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "retry";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint16";
            readonly name: "centrifugeId";
        }, {
            readonly type: "bytes";
            readonly name: "message";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "underpaid";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint16";
            readonly name: "centrifugeId";
        }, {
            readonly type: "bytes32";
            readonly name: "batchHash";
        }];
        readonly outputs: readonly [{
            readonly type: "uint128";
            readonly name: "counter";
        }, {
            readonly type: "uint128";
            readonly name: "gasLimit";
        }];
    }];
    VaultRouter: readonly [{
        readonly name: "cancelDepositRequest";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "cancelRedeemRequest";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "claimCancelDepositRequest";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault";
        }, {
            readonly type: "address";
            readonly name: "receiver";
        }, {
            readonly type: "address";
            readonly name: "controller";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "claimCancelRedeemRequest";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault";
        }, {
            readonly type: "address";
            readonly name: "receiver";
        }, {
            readonly type: "address";
            readonly name: "controller";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "claimDeposit";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault";
        }, {
            readonly type: "address";
            readonly name: "receiver";
        }, {
            readonly type: "address";
            readonly name: "controller";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "claimRedeem";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault";
        }, {
            readonly type: "address";
            readonly name: "receiver";
        }, {
            readonly type: "address";
            readonly name: "controller";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "deny";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "user";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "deposit";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault";
        }, {
            readonly type: "uint256";
            readonly name: "assets";
        }, {
            readonly type: "address";
            readonly name: "receiver";
        }, {
            readonly type: "address";
            readonly name: "owner";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "disable";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "enable";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "enableLockDepositRequest";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault";
        }, {
            readonly type: "uint256";
            readonly name: "amount";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "escrow";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "address";
        }];
    }, {
        readonly name: "executeLockedDepositRequest";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault";
        }, {
            readonly type: "address";
            readonly name: "controller";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "gateway";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "address";
        }];
    }, {
        readonly name: "getVault";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "address";
            readonly name: "asset";
        }];
        readonly outputs: readonly [{
            readonly type: "address";
        }];
    }, {
        readonly name: "hasPermissions";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault";
        }, {
            readonly type: "address";
            readonly name: "controller";
        }];
        readonly outputs: readonly [{
            readonly type: "bool";
        }];
    }, {
        readonly name: "isEnabled";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault";
        }, {
            readonly type: "address";
            readonly name: "controller";
        }];
        readonly outputs: readonly [{
            readonly type: "bool";
        }];
    }, {
        readonly name: "lockDepositRequest";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault";
        }, {
            readonly type: "uint256";
            readonly name: "amount";
        }, {
            readonly type: "address";
            readonly name: "controller";
        }, {
            readonly type: "address";
            readonly name: "owner";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "lockedRequests";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "controller";
        }, {
            readonly type: "address";
            readonly name: "vault";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
            readonly name: "amount";
        }];
    }, {
        readonly name: "multicall";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "bytes[]";
            readonly name: "data";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "permit";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "asset";
        }, {
            readonly type: "address";
            readonly name: "spender";
        }, {
            readonly type: "uint256";
            readonly name: "assets";
        }, {
            readonly type: "uint256";
            readonly name: "deadline";
        }, {
            readonly type: "uint8";
            readonly name: "v";
        }, {
            readonly type: "bytes32";
            readonly name: "r";
        }, {
            readonly type: "bytes32";
            readonly name: "s";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "recoverTokens";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "token";
        }, {
            readonly type: "address";
            readonly name: "receiver";
        }, {
            readonly type: "uint256";
            readonly name: "amount";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "recoverTokens";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "token";
        }, {
            readonly type: "uint256";
            readonly name: "tokenId";
        }, {
            readonly type: "address";
            readonly name: "receiver";
        }, {
            readonly type: "uint256";
            readonly name: "amount";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "rely";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "user";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "requestDeposit";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault";
        }, {
            readonly type: "uint256";
            readonly name: "amount";
        }, {
            readonly type: "address";
            readonly name: "controller";
        }, {
            readonly type: "address";
            readonly name: "owner";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "requestRedeem";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault";
        }, {
            readonly type: "uint256";
            readonly name: "amount";
        }, {
            readonly type: "address";
            readonly name: "controller";
        }, {
            readonly type: "address";
            readonly name: "owner";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "spoke";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "address";
        }];
    }, {
        readonly name: "unlockDepositRequest";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault";
        }, {
            readonly type: "address";
            readonly name: "receiver";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "wards";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
        }];
    }, {
        readonly name: "Deny";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "user";
            readonly indexed: true;
        }];
    }, {
        readonly name: "ExecuteLockedDepositRequest";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "controller";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "sender";
        }];
    }, {
        readonly name: "LockDepositRequest";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "controller";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "owner";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "sender";
        }, {
            readonly type: "uint256";
            readonly name: "amount";
        }];
    }, {
        readonly name: "Rely";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "user";
            readonly indexed: true;
        }];
    }, {
        readonly name: "UnlockDepositRequest";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "controller";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "receiver";
            readonly indexed: true;
        }];
    }, {
        readonly name: "CallFailedWithEmptyRevert";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "InvalidOwner";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "InvalidSender";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "NoCode";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "NoLockedBalance";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "NoLockedRequest";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "NonAsyncVault";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "NonSyncDepositVault";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "NotAuthorized";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "SafeTransferEthFailed";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "UnauthorizedSender";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "WrappedError";
        readonly type: "error";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "target";
        }, {
            readonly type: "bytes4";
            readonly name: "selector";
        }, {
            readonly type: "bytes";
            readonly name: "reason";
        }, {
            readonly type: "bytes";
            readonly name: "details";
        }];
    }, {
        readonly name: "ZeroBalance";
        readonly type: "error";
        readonly inputs: readonly [];
    }];
    Accounting: readonly [{
        readonly name: "accountValue";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "uint32";
            readonly name: "account";
        }];
        readonly outputs: readonly [{
            readonly type: "int128";
        }];
    }, {
        readonly name: "exists";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "uint32";
            readonly name: "account";
        }];
        readonly outputs: readonly [{
            readonly type: "bool";
        }];
    }, {
        readonly name: "accounts";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint64";
        }, {
            readonly type: "uint32";
        }];
        readonly outputs: readonly [{
            readonly type: "uint128";
            readonly name: "totalDebit";
        }, {
            readonly type: "uint128";
            readonly name: "totalCredit";
        }, {
            readonly type: "bool";
            readonly name: "isDebitNormal";
        }, {
            readonly type: "uint64";
            readonly name: "lastUpdated";
        }, {
            readonly type: "bytes";
            readonly name: "metadata";
        }];
    }];
    Holdings: readonly [{
        readonly name: "accountId";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint64";
        }, {
            readonly type: "bytes16";
        }, {
            readonly type: "uint128";
        }, {
            readonly type: "uint8";
            readonly name: "kind";
        }];
        readonly outputs: readonly [{
            readonly type: "uint32";
        }];
    }, {
        readonly name: "amount";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }];
        readonly outputs: readonly [{
            readonly type: "uint128";
            readonly name: "amount_";
        }];
    }, {
        readonly name: "decrease";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }, {
            readonly type: "uint128";
            readonly name: "pricePoolPerAsset";
        }, {
            readonly type: "uint128";
            readonly name: "amount_";
        }];
        readonly outputs: readonly [{
            readonly type: "uint128";
            readonly name: "amountValue";
        }];
    }, {
        readonly name: "deny";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "user";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "holding";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint64";
        }, {
            readonly type: "bytes16";
        }, {
            readonly type: "uint128";
        }];
        readonly outputs: readonly [{
            readonly type: "uint128";
            readonly name: "assetAmount";
        }, {
            readonly type: "uint128";
            readonly name: "assetAmountValue";
        }, {
            readonly type: "address";
            readonly name: "valuation";
        }, {
            readonly type: "bool";
            readonly name: "isLiability";
        }];
    }, {
        readonly name: "hubRegistry";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "address";
        }];
    }, {
        readonly name: "increase";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }, {
            readonly type: "uint128";
            readonly name: "pricePoolPerAsset";
        }, {
            readonly type: "uint128";
            readonly name: "amount_";
        }];
        readonly outputs: readonly [{
            readonly type: "uint128";
            readonly name: "amountValue";
        }];
    }, {
        readonly name: "initialize";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }, {
            readonly type: "address";
            readonly name: "valuation_";
        }, {
            readonly type: "bool";
            readonly name: "isLiability_";
        }, {
            readonly type: "tuple[]";
            readonly components: readonly [{
                readonly type: "uint32";
                readonly name: "accountId";
            }, {
                readonly type: "uint8";
                readonly name: "kind";
            }];
            readonly name: "accounts";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "isInitialized";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }];
        readonly outputs: readonly [{
            readonly type: "bool";
        }];
    }, {
        readonly name: "isLiability";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }];
        readonly outputs: readonly [{
            readonly type: "bool";
        }];
    }, {
        readonly name: "rely";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "user";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "setAccountId";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }, {
            readonly type: "uint8";
            readonly name: "kind";
        }, {
            readonly type: "uint32";
            readonly name: "accountId_";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "setSnapshot";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint16";
            readonly name: "centrifugeId";
        }, {
            readonly type: "bool";
            readonly name: "isSnapshot";
        }, {
            readonly type: "uint64";
            readonly name: "nonce";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "setSnapshotHook";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "address";
            readonly name: "hook";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "snapshot";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint64";
        }, {
            readonly type: "bytes16";
        }, {
            readonly type: "uint16";
            readonly name: "centrifugeId";
        }];
        readonly outputs: readonly [{
            readonly type: "bool";
            readonly name: "isSnapshot";
        }, {
            readonly type: "uint64";
            readonly name: "nonce";
        }];
    }, {
        readonly name: "snapshotHook";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint64";
        }];
        readonly outputs: readonly [{
            readonly type: "address";
        }];
    }, {
        readonly name: "update";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }];
        readonly outputs: readonly [{
            readonly type: "bool";
            readonly name: "isPositive";
        }, {
            readonly type: "uint128";
            readonly name: "diffValue";
        }];
    }, {
        readonly name: "updateValuation";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }, {
            readonly type: "address";
            readonly name: "valuation_";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "valuation";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }];
        readonly outputs: readonly [{
            readonly type: "address";
        }];
    }, {
        readonly name: "value";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }];
        readonly outputs: readonly [{
            readonly type: "uint128";
            readonly name: "value_";
        }];
    }, {
        readonly name: "wards";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
        }];
    }, {
        readonly name: "Decrease";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
            readonly indexed: true;
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
            readonly indexed: true;
        }, {
            readonly type: "uint128";
            readonly name: "pricePoolPerAsset";
        }, {
            readonly type: "uint128";
            readonly name: "amount";
        }, {
            readonly type: "uint128";
            readonly name: "decreasedValue";
        }];
    }, {
        readonly name: "Deny";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "user";
            readonly indexed: true;
        }];
    }, {
        readonly name: "Increase";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
            readonly indexed: true;
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
            readonly indexed: true;
        }, {
            readonly type: "uint128";
            readonly name: "pricePoolPerAsset";
        }, {
            readonly type: "uint128";
            readonly name: "amount";
        }, {
            readonly type: "uint128";
            readonly name: "increasedValue";
        }];
    }, {
        readonly name: "Initialize";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
            readonly indexed: true;
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "valuation";
        }, {
            readonly type: "bool";
            readonly name: "isLiability";
        }, {
            readonly type: "tuple[]";
            readonly components: readonly [{
                readonly type: "uint32";
                readonly name: "accountId";
            }, {
                readonly type: "uint8";
                readonly name: "kind";
            }];
            readonly name: "accounts";
        }];
    }, {
        readonly name: "Rely";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "user";
            readonly indexed: true;
        }];
    }, {
        readonly name: "SetAccountId";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
            readonly indexed: true;
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
            readonly indexed: true;
        }, {
            readonly type: "uint8";
            readonly name: "kind";
        }, {
            readonly type: "uint32";
            readonly name: "accountId";
        }];
    }, {
        readonly name: "SetSnapshot";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
            readonly indexed: true;
        }, {
            readonly type: "uint16";
            readonly name: "centrifugeId";
            readonly indexed: true;
        }, {
            readonly type: "bool";
            readonly name: "isSnapshot";
        }, {
            readonly type: "uint64";
            readonly name: "nonce";
        }];
    }, {
        readonly name: "SetSnapshotHook";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "hook";
        }];
    }, {
        readonly name: "Update";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
            readonly indexed: true;
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
            readonly indexed: true;
        }, {
            readonly type: "bool";
            readonly name: "isPositive";
        }, {
            readonly type: "uint128";
            readonly name: "diffValue";
        }];
    }, {
        readonly name: "UpdateValuation";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
            readonly indexed: true;
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "valuation";
        }];
    }, {
        readonly name: "AlreadyInitialized";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "HoldingNotFound";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "InvalidNonce";
        readonly type: "error";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "expected";
        }, {
            readonly type: "uint64";
            readonly name: "actual";
        }];
    }, {
        readonly name: "MulDiv_Overflow";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "NotAuthorized";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "Uint128_Overflow";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "WrongAssetId";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "WrongShareClassId";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "WrongValuation";
        readonly type: "error";
        readonly inputs: readonly [];
    }];
    Valuation: readonly [{
        readonly name: "getQuote";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint128";
        }, {
            readonly type: "uint128";
        }, {
            readonly type: "uint128";
        }];
        readonly outputs: readonly [{
            readonly type: "uint128";
        }];
    }];
    SyncRequests: readonly [{
        readonly name: "addVault";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }, {
            readonly type: "address";
            readonly name: "vault_";
        }, {
            readonly type: "address";
            readonly name: "asset_";
        }, {
            readonly type: "uint256";
            readonly name: "tokenId";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "balanceSheet";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "address";
        }];
    }, {
        readonly name: "convertToAssets";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault_";
        }, {
            readonly type: "uint256";
            readonly name: "shares";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
            readonly name: "assets";
        }];
    }, {
        readonly name: "convertToShares";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault_";
        }, {
            readonly type: "uint256";
            readonly name: "assets";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
            readonly name: "shares";
        }];
    }, {
        readonly name: "deny";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "user";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "deposit";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault_";
        }, {
            readonly type: "uint256";
            readonly name: "assets";
        }, {
            readonly type: "address";
            readonly name: "receiver";
        }, {
            readonly type: "address";
            readonly name: "owner";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
            readonly name: "shares";
        }];
    }, {
        readonly name: "file";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "bytes32";
            readonly name: "what";
        }, {
            readonly type: "address";
            readonly name: "data";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "globalEscrow";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "address";
        }];
    }, {
        readonly name: "maxDeposit";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault_";
        }, {
            readonly type: "address";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
        }];
    }, {
        readonly name: "maxMint";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault_";
        }, {
            readonly type: "address";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
        }];
    }, {
        readonly name: "maxReserve";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint64";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "address";
            readonly name: "asset";
        }, {
            readonly type: "uint256";
            readonly name: "tokenId";
        }];
        readonly outputs: readonly [{
            readonly type: "uint128";
        }];
    }, {
        readonly name: "mint";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault_";
        }, {
            readonly type: "uint256";
            readonly name: "shares";
        }, {
            readonly type: "address";
            readonly name: "receiver";
        }, {
            readonly type: "address";
            readonly name: "owner";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
            readonly name: "assets";
        }];
    }, {
        readonly name: "poolEscrow";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }];
        readonly outputs: readonly [{
            readonly type: "address";
        }];
    }, {
        readonly name: "previewDeposit";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault_";
        }, {
            readonly type: "address";
        }, {
            readonly type: "uint256";
            readonly name: "assets";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
            readonly name: "shares";
        }];
    }, {
        readonly name: "previewMint";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault_";
        }, {
            readonly type: "address";
        }, {
            readonly type: "uint256";
            readonly name: "shares";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
            readonly name: "assets";
        }];
    }, {
        readonly name: "priceLastUpdated";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault_";
        }];
        readonly outputs: readonly [{
            readonly type: "uint64";
            readonly name: "lastUpdated";
        }];
    }, {
        readonly name: "pricePoolPerShare";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }];
        readonly outputs: readonly [{
            readonly type: "uint128";
            readonly name: "price";
        }];
    }, {
        readonly name: "prices";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }];
        readonly outputs: readonly [{
            readonly type: "tuple";
            readonly components: readonly [{
                readonly type: "uint128";
                readonly name: "assetPerShare";
            }, {
                readonly type: "uint128";
                readonly name: "poolPerAsset";
            }, {
                readonly type: "uint128";
                readonly name: "poolPerShare";
            }];
            readonly name: "priceData";
        }];
    }, {
        readonly name: "recoverTokens";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "token";
        }, {
            readonly type: "address";
            readonly name: "receiver";
        }, {
            readonly type: "uint256";
            readonly name: "amount";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "recoverTokens";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "token";
        }, {
            readonly type: "uint256";
            readonly name: "tokenId";
        }, {
            readonly type: "address";
            readonly name: "receiver";
        }, {
            readonly type: "uint256";
            readonly name: "amount";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "rely";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "user";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "removeVault";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }, {
            readonly type: "address";
            readonly name: "vault_";
        }, {
            readonly type: "address";
            readonly name: "asset_";
        }, {
            readonly type: "uint256";
            readonly name: "tokenId";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "root";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "address";
        }];
    }, {
        readonly name: "setMaxReserve";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "address";
            readonly name: "asset";
        }, {
            readonly type: "uint256";
            readonly name: "tokenId";
        }, {
            readonly type: "uint128";
            readonly name: "maxReserve_";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "setValuation";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "address";
            readonly name: "valuation_";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "spoke";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "address";
        }];
    }, {
        readonly name: "update";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "bytes";
            readonly name: "payload";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "valuation";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint64";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }];
        readonly outputs: readonly [{
            readonly type: "address";
        }];
    }, {
        readonly name: "vault";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }];
        readonly outputs: readonly [{
            readonly type: "address";
            readonly name: "vault";
        }];
    }, {
        readonly name: "vaultByAssetId";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }];
        readonly outputs: readonly [{
            readonly type: "address";
        }];
    }, {
        readonly name: "wards";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
        }];
    }, {
        readonly name: "AddVault";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
            readonly indexed: true;
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "vault";
        }];
    }, {
        readonly name: "Deny";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "user";
            readonly indexed: true;
        }];
    }, {
        readonly name: "File";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "bytes32";
            readonly name: "what";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "data";
        }];
    }, {
        readonly name: "Rely";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "user";
            readonly indexed: true;
        }];
    }, {
        readonly name: "RemoveVault";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
            readonly indexed: true;
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "vault";
        }];
    }, {
        readonly name: "SetMaxReserve";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "asset";
        }, {
            readonly type: "uint256";
            readonly name: "tokenId";
        }, {
            readonly type: "uint128";
            readonly name: "maxReserve";
        }];
    }, {
        readonly name: "SetValuation";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "valuation";
        }];
    }, {
        readonly name: "AssetMismatch";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "AssetNotAllowed";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "ExceedsMaxDeposit";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "ExceedsMaxMint";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "FileUnrecognizedParam";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "MulDiv_Overflow";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "NoCode";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "NotAuthorized";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "SafeTransferEthFailed";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "SecondaryManagerDoesNotExist";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "SenderNotVault";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "ShareTokenDoesNotExist";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "SliceOutOfBounds";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "Uint128_Overflow";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "Uint64_Overflow";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "UnknownMessageType";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "UnknownUpdateContractType";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "VaultAlreadyExists";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "VaultDoesNotExist";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "WrappedError";
        readonly type: "error";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "target";
        }, {
            readonly type: "bytes4";
            readonly name: "selector";
        }, {
            readonly type: "bytes";
            readonly name: "reason";
        }, {
            readonly type: "bytes";
            readonly name: "details";
        }];
    }];
    AsyncRequests: readonly [{
        readonly name: "addVault";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }, {
            readonly type: "address";
            readonly name: "vault_";
        }, {
            readonly type: "address";
            readonly name: "asset_";
        }, {
            readonly type: "uint256";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "approvedDeposits";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }, {
            readonly type: "uint128";
            readonly name: "assetAmount";
        }, {
            readonly type: "uint128";
            readonly name: "pricePoolPerAsset";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "balanceSheet";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "address";
        }];
    }, {
        readonly name: "cancelDepositRequest";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault_";
        }, {
            readonly type: "address";
            readonly name: "controller";
        }, {
            readonly type: "address";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "cancelRedeemRequest";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault_";
        }, {
            readonly type: "address";
            readonly name: "controller";
        }, {
            readonly type: "address";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "claimCancelDepositRequest";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault_";
        }, {
            readonly type: "address";
            readonly name: "receiver";
        }, {
            readonly type: "address";
            readonly name: "controller";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
            readonly name: "assets";
        }];
    }, {
        readonly name: "claimCancelRedeemRequest";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault_";
        }, {
            readonly type: "address";
            readonly name: "receiver";
        }, {
            readonly type: "address";
            readonly name: "controller";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
            readonly name: "shares";
        }];
    }, {
        readonly name: "claimableCancelDepositRequest";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault_";
        }, {
            readonly type: "address";
            readonly name: "user";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
            readonly name: "assets";
        }];
    }, {
        readonly name: "claimableCancelRedeemRequest";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault_";
        }, {
            readonly type: "address";
            readonly name: "user";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
            readonly name: "shares";
        }];
    }, {
        readonly name: "convertToAssets";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault_";
        }, {
            readonly type: "uint256";
            readonly name: "shares";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
            readonly name: "assets";
        }];
    }, {
        readonly name: "convertToShares";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault_";
        }, {
            readonly type: "uint256";
            readonly name: "assets";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
            readonly name: "shares";
        }];
    }, {
        readonly name: "deny";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "user";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "deposit";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault_";
        }, {
            readonly type: "uint256";
            readonly name: "assets";
        }, {
            readonly type: "address";
            readonly name: "receiver";
        }, {
            readonly type: "address";
            readonly name: "controller";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
            readonly name: "shares";
        }];
    }, {
        readonly name: "file";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "bytes32";
            readonly name: "what";
        }, {
            readonly type: "address";
            readonly name: "data";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "fulfillDepositRequest";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "address";
            readonly name: "user";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }, {
            readonly type: "uint128";
            readonly name: "fulfilledAssets";
        }, {
            readonly type: "uint128";
            readonly name: "fulfilledShares";
        }, {
            readonly type: "uint128";
            readonly name: "cancelledAssets";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "fulfillRedeemRequest";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "address";
            readonly name: "user";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }, {
            readonly type: "uint128";
            readonly name: "fulfilledAssets";
        }, {
            readonly type: "uint128";
            readonly name: "fulfilledShares";
        }, {
            readonly type: "uint128";
            readonly name: "cancelledShares";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "globalEscrow";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "address";
        }];
    }, {
        readonly name: "investments";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault";
        }, {
            readonly type: "address";
            readonly name: "investor";
        }];
        readonly outputs: readonly [{
            readonly type: "uint128";
            readonly name: "maxMint";
        }, {
            readonly type: "uint128";
            readonly name: "maxWithdraw";
        }, {
            readonly type: "uint128";
            readonly name: "depositPrice";
        }, {
            readonly type: "uint128";
            readonly name: "redeemPrice";
        }, {
            readonly type: "uint128";
            readonly name: "pendingDepositRequest";
        }, {
            readonly type: "uint128";
            readonly name: "pendingRedeemRequest";
        }, {
            readonly type: "uint128";
            readonly name: "claimableCancelDepositRequest";
        }, {
            readonly type: "uint128";
            readonly name: "claimableCancelRedeemRequest";
        }, {
            readonly type: "bool";
            readonly name: "pendingCancelDepositRequest";
        }, {
            readonly type: "bool";
            readonly name: "pendingCancelRedeemRequest";
        }];
    }, {
        readonly name: "issuedShares";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "shareAmount";
        }, {
            readonly type: "uint128";
            readonly name: "pricePoolPerShare";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "maxDeposit";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault_";
        }, {
            readonly type: "address";
            readonly name: "user";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
            readonly name: "assets";
        }];
    }, {
        readonly name: "maxMint";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault_";
        }, {
            readonly type: "address";
            readonly name: "user";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
            readonly name: "shares";
        }];
    }, {
        readonly name: "maxRedeem";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault_";
        }, {
            readonly type: "address";
            readonly name: "user";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
            readonly name: "shares";
        }];
    }, {
        readonly name: "maxWithdraw";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault_";
        }, {
            readonly type: "address";
            readonly name: "user";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
            readonly name: "assets";
        }];
    }, {
        readonly name: "mint";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault_";
        }, {
            readonly type: "uint256";
            readonly name: "shares";
        }, {
            readonly type: "address";
            readonly name: "receiver";
        }, {
            readonly type: "address";
            readonly name: "controller";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
            readonly name: "assets";
        }];
    }, {
        readonly name: "pendingCancelDepositRequest";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault_";
        }, {
            readonly type: "address";
            readonly name: "user";
        }];
        readonly outputs: readonly [{
            readonly type: "bool";
            readonly name: "isPending";
        }];
    }, {
        readonly name: "pendingCancelRedeemRequest";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault_";
        }, {
            readonly type: "address";
            readonly name: "user";
        }];
        readonly outputs: readonly [{
            readonly type: "bool";
            readonly name: "isPending";
        }];
    }, {
        readonly name: "pendingDepositRequest";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault_";
        }, {
            readonly type: "address";
            readonly name: "user";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
            readonly name: "assets";
        }];
    }, {
        readonly name: "pendingRedeemRequest";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault_";
        }, {
            readonly type: "address";
            readonly name: "user";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
            readonly name: "shares";
        }];
    }, {
        readonly name: "poolEscrow";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }];
        readonly outputs: readonly [{
            readonly type: "address";
        }];
    }, {
        readonly name: "priceLastUpdated";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault_";
        }];
        readonly outputs: readonly [{
            readonly type: "uint64";
            readonly name: "lastUpdated";
        }];
    }, {
        readonly name: "recoverTokens";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "token";
        }, {
            readonly type: "address";
            readonly name: "receiver";
        }, {
            readonly type: "uint256";
            readonly name: "amount";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "recoverTokens";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "token";
        }, {
            readonly type: "uint256";
            readonly name: "tokenId";
        }, {
            readonly type: "address";
            readonly name: "receiver";
        }, {
            readonly type: "uint256";
            readonly name: "amount";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "redeem";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault_";
        }, {
            readonly type: "uint256";
            readonly name: "shares";
        }, {
            readonly type: "address";
            readonly name: "receiver";
        }, {
            readonly type: "address";
            readonly name: "controller";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
            readonly name: "assets";
        }];
    }, {
        readonly name: "rely";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "user";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "removeVault";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }, {
            readonly type: "address";
            readonly name: "vault_";
        }, {
            readonly type: "address";
            readonly name: "asset_";
        }, {
            readonly type: "uint256";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "requestDeposit";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault_";
        }, {
            readonly type: "uint256";
            readonly name: "assets";
        }, {
            readonly type: "address";
            readonly name: "controller";
        }, {
            readonly type: "address";
        }, {
            readonly type: "address";
        }];
        readonly outputs: readonly [{
            readonly type: "bool";
        }];
    }, {
        readonly name: "requestRedeem";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault_";
        }, {
            readonly type: "uint256";
            readonly name: "shares";
        }, {
            readonly type: "address";
            readonly name: "controller";
        }, {
            readonly type: "address";
            readonly name: "owner";
        }, {
            readonly type: "address";
        }];
        readonly outputs: readonly [{
            readonly type: "bool";
        }];
    }, {
        readonly name: "revokedShares";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }, {
            readonly type: "uint128";
            readonly name: "assetAmount";
        }, {
            readonly type: "uint128";
            readonly name: "shareAmount";
        }, {
            readonly type: "uint128";
            readonly name: "pricePoolPerShare";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "root";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "address";
        }];
    }, {
        readonly name: "sender";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "address";
        }];
    }, {
        readonly name: "spoke";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "address";
        }];
    }, {
        readonly name: "vault";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }];
        readonly outputs: readonly [{
            readonly type: "address";
            readonly name: "vault";
        }];
    }, {
        readonly name: "vaultByAssetId";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
        }];
        readonly outputs: readonly [{
            readonly type: "address";
        }];
    }, {
        readonly name: "wards";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
        }];
    }, {
        readonly name: "withdraw";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "vault_";
        }, {
            readonly type: "uint256";
            readonly name: "assets";
        }, {
            readonly type: "address";
            readonly name: "receiver";
        }, {
            readonly type: "address";
            readonly name: "controller";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
            readonly name: "shares";
        }];
    }, {
        readonly name: "AddVault";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
            readonly indexed: true;
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "vault";
        }];
    }, {
        readonly name: "Deny";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "user";
            readonly indexed: true;
        }];
    }, {
        readonly name: "File";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "bytes32";
            readonly name: "what";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "data";
        }];
    }, {
        readonly name: "Rely";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "user";
            readonly indexed: true;
        }];
    }, {
        readonly name: "RemoveVault";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
            readonly indexed: true;
        }, {
            readonly type: "uint128";
            readonly name: "assetId";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "vault";
        }];
    }, {
        readonly name: "TriggerRedeemRequest";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "user";
        }, {
            readonly type: "address";
            readonly name: "asset";
            readonly indexed: true;
        }, {
            readonly type: "uint256";
            readonly name: "tokenId";
        }, {
            readonly type: "uint128";
            readonly name: "shares";
        }];
    }, {
        readonly name: "AssetMismatch";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "AssetNotAllowed";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "CancellationIsPending";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "ExceedsDepositLimits";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "ExceedsMaxDeposit";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "ExceedsMaxRedeem";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "ExceedsRedeemLimits";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "FailedRedeemRequest";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "FileUnrecognizedParam";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "MulDiv_Overflow";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "NoCode";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "NoPendingRequest";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "NotAuthorized";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "SafeTransferEthFailed";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "SenderNotVault";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "ShareTokenAmountIsZero";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "ShareTokenTransferFailed";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "TransferNotAllowed";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "Uint128_Overflow";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "Uint64_Overflow";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "VaultAlreadyExists";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "VaultDoesNotExist";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "WrappedError";
        readonly type: "error";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "target";
        }, {
            readonly type: "bytes4";
            readonly name: "selector";
        }, {
            readonly type: "bytes";
            readonly name: "reason";
        }, {
            readonly type: "bytes";
            readonly name: "details";
        }];
    }, {
        readonly name: "ZeroAmountNotAllowed";
        readonly type: "error";
        readonly inputs: readonly [];
    }];
    MultiAdapter: readonly [{
        readonly name: "estimate";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint16";
            readonly name: "centrifugeId";
        }, {
            readonly type: "bytes";
            readonly name: "payload";
        }, {
            readonly type: "uint256";
            readonly name: "gasLimit";
        }];
        readonly outputs: readonly [{
            readonly type: "uint256";
            readonly name: "total";
        }];
    }];
    BalanceSheet: readonly [{
        readonly name: "availableBalanceOf";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "address";
            readonly name: "asset";
        }, {
            readonly type: "uint256";
            readonly name: "tokenId";
        }];
        readonly outputs: readonly [{
            readonly type: "uint128";
        }];
    }, {
        readonly name: "deposit";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "address";
            readonly name: "asset";
        }, {
            readonly type: "uint256";
            readonly name: "tokenId";
        }, {
            readonly type: "uint128";
            readonly name: "amount";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "issue";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "address";
            readonly name: "to";
        }, {
            readonly type: "uint128";
            readonly name: "shares";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "manager";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint64";
        }, {
            readonly type: "address";
        }];
        readonly outputs: readonly [{
            readonly type: "bool";
        }];
    }, {
        readonly name: "multicall";
        readonly type: "function";
        readonly stateMutability: "payable";
        readonly inputs: readonly [{
            readonly type: "bytes[]";
            readonly name: "data";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "overridePricePoolPerShare";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "value";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "revoke";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "shares";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "transferSharesFrom";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "address";
            readonly name: "sender_";
        }, {
            readonly type: "address";
            readonly name: "from";
        }, {
            readonly type: "address";
            readonly name: "to";
        }, {
            readonly type: "uint256";
            readonly name: "amount";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "withdraw";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "address";
            readonly name: "asset";
        }, {
            readonly type: "uint256";
            readonly name: "tokenId";
        }, {
            readonly type: "address";
            readonly name: "receiver";
        }, {
            readonly type: "uint128";
            readonly name: "amount";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "Deposit";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "asset";
        }, {
            readonly type: "uint256";
            readonly name: "tokenId";
        }, {
            readonly type: "uint128";
            readonly name: "amount";
        }];
    }, {
        readonly name: "Issue";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "to";
        }, {
            readonly type: "uint128";
            readonly name: "pricePoolPerShare";
        }, {
            readonly type: "uint128";
            readonly name: "shares";
        }];
    }, {
        readonly name: "NoteDeposit";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "asset";
        }, {
            readonly type: "uint256";
            readonly name: "tokenId";
        }, {
            readonly type: "uint128";
            readonly name: "amount";
        }, {
            readonly type: "uint128";
            readonly name: "pricePoolPerAsset";
        }];
    }, {
        readonly name: "Revoke";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "from";
        }, {
            readonly type: "uint128";
            readonly name: "pricePoolPerShare";
        }, {
            readonly type: "uint128";
            readonly name: "shares";
        }];
    }, {
        readonly name: "TransferSharesFrom";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "sender";
        }, {
            readonly type: "address";
            readonly name: "from";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "to";
        }, {
            readonly type: "uint256";
            readonly name: "amount";
        }];
    }, {
        readonly name: "Withdraw";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "asset";
        }, {
            readonly type: "uint256";
            readonly name: "tokenId";
        }, {
            readonly type: "address";
            readonly name: "receiver";
        }, {
            readonly type: "uint128";
            readonly name: "amount";
        }, {
            readonly type: "uint128";
            readonly name: "pricePoolPerAsset";
        }];
    }];
    GasService: readonly [{
        readonly name: "batchGasLimit";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint16";
        }];
        readonly outputs: readonly [{
            readonly type: "uint128";
        }];
    }, {
        readonly name: "maxBatchGasLimit";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint16";
        }];
        readonly outputs: readonly [{
            readonly type: "uint128";
        }];
    }, {
        readonly name: "messageGasLimit";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint16";
        }, {
            readonly type: "bytes";
            readonly name: "message";
        }];
        readonly outputs: readonly [{
            readonly type: "uint128";
        }];
    }];
    PoolEscrow: readonly [{
        readonly name: "holding";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "address";
            readonly name: "asset";
        }, {
            readonly type: "uint256";
            readonly name: "tokenId";
        }];
        readonly outputs: readonly [{
            readonly type: "uint128";
            readonly name: "total";
        }, {
            readonly type: "uint128";
            readonly name: "reserved";
        }];
    }, {
        readonly name: "DecreaseReserve";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "asset";
            readonly indexed: true;
        }, {
            readonly type: "uint256";
            readonly name: "tokenId";
            readonly indexed: true;
        }, {
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint256";
            readonly name: "delta";
        }, {
            readonly type: "uint128";
            readonly name: "value";
        }];
    }, {
        readonly name: "Deposit";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "asset";
            readonly indexed: true;
        }, {
            readonly type: "uint256";
            readonly name: "tokenId";
            readonly indexed: true;
        }, {
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "value";
        }];
    }, {
        readonly name: "IncreaseReserve";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "asset";
            readonly indexed: true;
        }, {
            readonly type: "uint256";
            readonly name: "tokenId";
            readonly indexed: true;
        }, {
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint256";
            readonly name: "delta";
        }, {
            readonly type: "uint128";
            readonly name: "value";
        }];
    }, {
        readonly name: "Withdraw";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "asset";
            readonly indexed: true;
        }, {
            readonly type: "uint256";
            readonly name: "tokenId";
            readonly indexed: true;
        }, {
            readonly type: "uint64";
            readonly name: "poolId";
            readonly indexed: true;
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }, {
            readonly type: "uint128";
            readonly name: "value";
        }];
    }];
    PoolEscrowFactory: readonly [{
        readonly name: "escrow";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }];
        readonly outputs: readonly [{
            readonly type: "address";
        }];
    }];
    OnOffRampManager: readonly [{
        readonly name: "balanceSheet";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "address";
        }];
    }, {
        readonly name: "contractUpdater";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "address";
        }];
    }, {
        readonly name: "deposit";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "asset";
        }, {
            readonly type: "uint256";
        }, {
            readonly type: "uint128";
            readonly name: "amount";
        }, {
            readonly type: "address";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "offramp";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "asset";
        }, {
            readonly type: "address";
            readonly name: "receiver";
        }];
        readonly outputs: readonly [{
            readonly type: "bool";
            readonly name: "isEnabled";
        }];
    }, {
        readonly name: "onramp";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "asset";
        }];
        readonly outputs: readonly [{
            readonly type: "bool";
        }];
    }, {
        readonly name: "poolId";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "uint64";
        }];
    }, {
        readonly name: "relayer";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "relayer";
        }];
        readonly outputs: readonly [{
            readonly type: "bool";
        }];
    }, {
        readonly name: "scId";
        readonly type: "function";
        readonly stateMutability: "view";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "bytes16";
        }];
    }, {
        readonly name: "supportsInterface";
        readonly type: "function";
        readonly stateMutability: "pure";
        readonly inputs: readonly [{
            readonly type: "bytes4";
            readonly name: "interfaceId";
        }];
        readonly outputs: readonly [{
            readonly type: "bool";
        }];
    }, {
        readonly name: "update";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId_";
        }, {
            readonly type: "bytes16";
            readonly name: "scId_";
        }, {
            readonly type: "bytes";
            readonly name: "payload";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "withdraw";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "asset";
        }, {
            readonly type: "uint256";
        }, {
            readonly type: "uint128";
            readonly name: "amount";
        }, {
            readonly type: "address";
            readonly name: "receiver";
        }];
        readonly outputs: readonly [];
    }, {
        readonly name: "UpdateOfframp";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "asset";
            readonly indexed: true;
        }, {
            readonly type: "address";
            readonly name: "receiver";
        }, {
            readonly type: "bool";
            readonly name: "isEnabled";
        }];
    }, {
        readonly name: "UpdateOnramp";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "asset";
            readonly indexed: true;
        }, {
            readonly type: "bool";
            readonly name: "isEnabled";
        }];
    }, {
        readonly name: "UpdateRelayer";
        readonly type: "event";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "relayer";
            readonly indexed: true;
        }, {
            readonly type: "bool";
            readonly name: "isEnabled";
        }];
    }, {
        readonly name: "ERC6909NotSupported";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "InvalidAmount";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "InvalidOfframpDestination";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "InvalidPoolId";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "InvalidShareClassId";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "NoCode";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "NotAllowedOnrampAsset";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "NotContractUpdater";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "NotRelayer";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "SliceOutOfBounds";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "UnknownMessageType";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "UnknownUpdateContractKind";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "UnknownUpdateContractType";
        readonly type: "error";
        readonly inputs: readonly [];
    }, {
        readonly name: "WrappedError";
        readonly type: "error";
        readonly inputs: readonly [{
            readonly type: "address";
            readonly name: "target";
        }, {
            readonly type: "bytes4";
            readonly name: "selector";
        }, {
            readonly type: "bytes";
            readonly name: "reason";
        }, {
            readonly type: "bytes";
            readonly name: "details";
        }];
    }];
    OnOffRampManagerFactory: readonly [{
        readonly name: "newManager";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }, {
            readonly type: "bytes16";
            readonly name: "scId";
        }];
        readonly outputs: readonly [{
            readonly type: "address";
        }];
    }];
    MerkleProofManagerFactory: readonly [{
        readonly name: "newManager";
        readonly type: "function";
        readonly stateMutability: "nonpayable";
        readonly inputs: readonly [{
            readonly type: "uint64";
            readonly name: "poolId";
        }];
        readonly outputs: readonly [{
            readonly type: "address";
        }];
    }];
};
//# sourceMappingURL=index.d.ts.map