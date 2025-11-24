import type { TypedDataDomain } from 'viem';
import { HexString } from '../types/index.js';
import { TransactionContext } from '../types/transaction.js';
export type Permit = {
    r: HexString;
    s: HexString;
    v: number;
    deadline: bigint;
};
export type Domain = Required<Pick<TypedDataDomain, 'name' | 'version' | 'chainId' | 'verifyingContract'>>;
export declare function signPermit(ctx: TransactionContext, currencyAddress: HexString, spender: HexString, amount: bigint): Promise<Permit>;
export declare function signERC2612Permit(ctx: TransactionContext, currencyOrDomain: HexString | Domain, spender: HexString, value?: string | number | bigint, deadline?: number, nonce?: number): Promise<Permit>;
//# sourceMappingURL=permit.d.ts.map