import { LocalAccount, Log, RpcLog, type Abi } from 'viem';
import type { HexString } from '../types/index.js';
import type { MessageTypeWithSubType, OperationStatus, Signer, TransactionContext } from '../types/transaction.js';
export type BatchTransactionData = {
    contract: HexString;
    data: HexString[];
    value?: bigint;
    messages?: Record<number, MessageTypeWithSubType[]>;
};
export declare function wrapTransaction(title: string, ctx: TransactionContext, { contract, data: data_, value: value_, messages, }: {
    contract: HexString;
    data: HexString | HexString[];
    value?: bigint;
    messages?: Record<number, MessageTypeWithSubType[]>;
}, options?: {
    simulate: boolean;
}): AsyncGenerator<OperationStatus | BatchTransactionData>;
export declare function doTransaction(title: string, ctx: TransactionContext, transactionCallback: () => Promise<HexString>): AsyncGenerator<OperationStatus>;
export declare function doSignMessage<T = any>(title: string, transactionCallback: () => Promise<T>): AsyncGenerator<OperationStatus, T>;
export declare function isLocalAccount(signer: Signer): signer is LocalAccount;
export declare function parseEventLogs(parameters: {
    logs: (Log | RpcLog)[];
    eventName: string | string[];
    address: HexString | HexString[];
}): Log<bigint, number, false, undefined, true, Abi, string>[];
//# sourceMappingURL=transaction.d.ts.map