import { encodePacked, toHex, } from 'viem';
export var MessageType;
(function (MessageType) {
    MessageType[MessageType["_Invalid"] = 0] = "_Invalid";
    // -- Pool independent messages
    MessageType[MessageType["ScheduleUpgrade"] = 1] = "ScheduleUpgrade";
    MessageType[MessageType["CancelUpgrade"] = 2] = "CancelUpgrade";
    MessageType[MessageType["RecoverTokens"] = 3] = "RecoverTokens";
    MessageType[MessageType["RegisterAsset"] = 4] = "RegisterAsset";
    MessageType[MessageType["_Placeholder5"] = 5] = "_Placeholder5";
    MessageType[MessageType["_Placeholder6"] = 6] = "_Placeholder6";
    MessageType[MessageType["_Placeholder7"] = 7] = "_Placeholder7";
    MessageType[MessageType["_Placeholder8"] = 8] = "_Placeholder8";
    MessageType[MessageType["_Placeholder9"] = 9] = "_Placeholder9";
    MessageType[MessageType["_Placeholder10"] = 10] = "_Placeholder10";
    MessageType[MessageType["_Placeholder11"] = 11] = "_Placeholder11";
    MessageType[MessageType["_Placeholder12"] = 12] = "_Placeholder12";
    MessageType[MessageType["_Placeholder13"] = 13] = "_Placeholder13";
    MessageType[MessageType["_Placeholder14"] = 14] = "_Placeholder14";
    MessageType[MessageType["_Placeholder15"] = 15] = "_Placeholder15";
    // -- Pool dependent messages
    MessageType[MessageType["NotifyPool"] = 16] = "NotifyPool";
    MessageType[MessageType["NotifyShareClass"] = 17] = "NotifyShareClass";
    MessageType[MessageType["NotifyPricePoolPerShare"] = 18] = "NotifyPricePoolPerShare";
    MessageType[MessageType["NotifyPricePoolPerAsset"] = 19] = "NotifyPricePoolPerAsset";
    MessageType[MessageType["NotifyShareMetadata"] = 20] = "NotifyShareMetadata";
    MessageType[MessageType["UpdateShareHook"] = 21] = "UpdateShareHook";
    MessageType[MessageType["InitiateTransferShares"] = 22] = "InitiateTransferShares";
    MessageType[MessageType["ExecuteTransferShares"] = 23] = "ExecuteTransferShares";
    MessageType[MessageType["UpdateRestriction"] = 24] = "UpdateRestriction";
    MessageType[MessageType["UpdateContract"] = 25] = "UpdateContract";
    MessageType[MessageType["UpdateVault"] = 26] = "UpdateVault";
    MessageType[MessageType["UpdateBalanceSheetManager"] = 27] = "UpdateBalanceSheetManager";
    MessageType[MessageType["UpdateHoldingAmount"] = 28] = "UpdateHoldingAmount";
    MessageType[MessageType["UpdateShares"] = 29] = "UpdateShares";
    MessageType[MessageType["MaxAssetPriceAge"] = 30] = "MaxAssetPriceAge";
    MessageType[MessageType["MaxSharePriceAge"] = 31] = "MaxSharePriceAge";
    MessageType[MessageType["Request"] = 32] = "Request";
    MessageType[MessageType["RequestCallback"] = 33] = "RequestCallback";
    MessageType[MessageType["SetRequestManager"] = 34] = "SetRequestManager";
})(MessageType || (MessageType = {}));
export var VaultUpdateKind;
(function (VaultUpdateKind) {
    VaultUpdateKind[VaultUpdateKind["DeployAndLink"] = 0] = "DeployAndLink";
    VaultUpdateKind[VaultUpdateKind["Link"] = 1] = "Link";
    VaultUpdateKind[VaultUpdateKind["Unlink"] = 2] = "Unlink";
})(VaultUpdateKind || (VaultUpdateKind = {}));
export function emptyMessage(type, subtype) {
    switch (type) {
        case MessageType.UpdateVault:
            return encodePacked(['uint8', 'uint64', 'bytes16', 'uint128', 'bytes32', 'uint8'], [type, 0n, toHex(0, { size: 16 }), 0n, toHex(0, { size: 32 }), subtype ?? VaultUpdateKind.DeployAndLink]);
        default:
            return toHex(type, { size: 1 });
    }
}
//# sourceMappingURL=transaction.js.map