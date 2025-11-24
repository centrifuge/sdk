import { Log, type Account, type Chain, type LocalAccount, type PublicClient, type TransactionReceipt, type WalletClient } from 'viem';
import type { Centrifuge } from '../Centrifuge.js';
import type { HexString } from './index.js';
import type { Query } from './query.js';
export type SafeMultisigTransactionResponse = {
    readonly safe: string;
    readonly to: string;
    readonly value: string;
    readonly data?: string;
    readonly operation: number;
    readonly gasToken: string;
    readonly safeTxGas: string;
    readonly baseGas: string;
    readonly gasPrice: string;
    readonly refundReceiver?: string;
    readonly nonce: string;
    readonly executionDate: string | null;
    readonly submissionDate: string;
    readonly modified: string;
    readonly blockNumber: number | null;
    readonly transactionHash: string | null;
    readonly safeTxHash: string;
    readonly executor: string | null;
    readonly proposer: string | null;
    readonly proposedByDelegate: string | null;
    readonly isExecuted: boolean;
    readonly isSuccessful: boolean | null;
    readonly ethGasPrice: string | null;
    readonly maxFeePerGas: string | null;
    readonly maxPriorityFeePerGas: string | null;
    readonly gasUsed: number | null;
    readonly fee: string | null;
    readonly origin: string;
    readonly dataDecoded?: any;
    readonly confirmationsRequired: number;
    readonly confirmations?: {
        readonly owner: string;
        readonly submissionDate: string;
        readonly transactionHash?: string;
        readonly confirmationType?: string;
        readonly signature: string;
        readonly signatureType: 'CONTRACT_SIGNATURE' | 'EOA' | 'APPROVED_HASH' | 'ETH_SIGN';
    }[];
    readonly trusted: boolean;
    readonly signatures: string | null;
};
export type OperationStatusType = 'SwitchingChain' | 'SigningTransaction' | 'SigningMessage' | 'SignedMessage' | 'TransactionPending' | 'TransactionConfirmed';
export type OperationSigningStatus = {
    id: string;
    type: 'SigningTransaction';
    title: string;
};
export type OperationSigningMessageStatus = {
    id: string;
    type: 'SigningMessage';
    title: string;
};
export type OperationSignedMessageStatus = {
    id: string;
    type: 'SignedMessage';
    title: string;
    signed: any;
};
export type OperationPendingStatus = {
    id: string;
    type: 'TransactionPending';
    title: string;
    hash: HexString;
};
export type OperationConfirmedStatus = {
    id: string;
    type: 'TransactionConfirmed';
    title: string;
    hash: HexString;
    receipt: TransactionReceipt;
};
export type OperationSwitchChainStatus = {
    type: 'SwitchingChain';
    chainId: number;
};
type SimulationResult = {
    data: HexString;
    gasUsed: bigint;
    status: string;
    logs?: Log[];
};
export type SimulationStatus = {
    type: 'TransactionSimulation';
    title: string;
    result: SimulationResult[];
};
export type OperationStatus = OperationSigningStatus | OperationSigningMessageStatus | OperationSignedMessageStatus | OperationPendingStatus | OperationConfirmedStatus | OperationSwitchChainStatus | SimulationStatus;
export type EIP1193ProviderLike = {
    request(...args: any): Promise<any>;
};
export type Signer = EIP1193ProviderLike | LocalAccount;
export type Transaction = Query<OperationStatus> & {
    chainId: number;
};
export type TransactionContext = {
    isBatching?: boolean;
    signingAddress: HexString;
    chain: Chain;
    chainId: number;
    publicClient: PublicClient;
    walletClient: WalletClient<any, Chain, Account>;
    signer: Signer;
    root: Centrifuge;
};
export declare enum MessageType {
    _Invalid = 0,
    ScheduleUpgrade = 1,
    CancelUpgrade = 2,
    RecoverTokens = 3,
    RegisterAsset = 4,
    _Placeholder5 = 5,
    _Placeholder6 = 6,
    _Placeholder7 = 7,
    _Placeholder8 = 8,
    _Placeholder9 = 9,
    _Placeholder10 = 10,
    _Placeholder11 = 11,
    _Placeholder12 = 12,
    _Placeholder13 = 13,
    _Placeholder14 = 14,
    _Placeholder15 = 15,
    NotifyPool = 16,
    NotifyShareClass = 17,
    NotifyPricePoolPerShare = 18,
    NotifyPricePoolPerAsset = 19,
    NotifyShareMetadata = 20,
    UpdateShareHook = 21,
    InitiateTransferShares = 22,
    ExecuteTransferShares = 23,
    UpdateRestriction = 24,
    UpdateContract = 25,
    UpdateVault = 26,
    UpdateBalanceSheetManager = 27,
    UpdateHoldingAmount = 28,
    UpdateShares = 29,
    MaxAssetPriceAge = 30,
    MaxSharePriceAge = 31,
    Request = 32,
    RequestCallback = 33,
    SetRequestManager = 34
}
export declare enum VaultUpdateKind {
    DeployAndLink = 0,
    Link = 1,
    Unlink = 2
}
export type MessageTypeWithSubType = MessageType | {
    type: MessageType;
    subtype: VaultUpdateKind;
};
export declare function emptyMessage(type: MessageType, subtype?: VaultUpdateKind): HexString;
export {};
//# sourceMappingURL=transaction.d.ts.map