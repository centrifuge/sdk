import type { HexString } from '../types/index.js';
import { AssetId, PoolId, ShareClassId } from '../utils/types.js';
import { Entity } from './Entity.js';
import { Balance } from '../utils/BigInt.js';
export declare class Investor extends Entity {
    address: HexString;
    /**
     * Retrieve the portfolio of an investor.
     * @param chainId - The chain ID
     */
    portfolio(chainId?: number): import("../index.js").Query<{
        balance: Balance;
        currency: import("../types/index.js").CurrencyDetails;
    }[]>;
    /**
     * Retrieve the investment of an investor.
     * @param poolId - The pool ID
     * @param scId - The share class ID
     * @param asset - The asset ID
     * @param chainId - The chain ID
     */
    investment(poolId: PoolId, scId: ShareClassId, asset: HexString | AssetId, chainId: number): import("../index.js").Query<{
        shareBalance: Balance;
        investmentCurrencyBalance: Balance;
        investmentCurrencyAllowance: Balance;
        isAllowedToInvest: boolean;
        isAllowedToRedeem: boolean;
        isSyncInvest: boolean;
        isOperatorEnabled: boolean;
        maxInvest: Balance;
        claimableInvestShares: Balance;
        claimableInvestCurrencyEquivalent: Balance;
        claimableRedeemCurrency: Balance;
        claimableRedeemSharesEquivalent: Balance;
        pendingInvestCurrency: Balance;
        pendingRedeemShares: Balance;
        claimableCancelInvestCurrency: Balance;
        claimableCancelRedeemShares: Balance;
        hasPendingCancelInvestRequest: boolean;
        hasPendingCancelRedeemRequest: boolean;
        investmentCurrency: import("../types/index.js").CurrencyDetails;
        shareCurrency: import("../types/index.js").CurrencyDetails;
    }>;
    /**
     * Retrieve if an account is a member of a share class.
     */
    isMember(scId: ShareClassId, chainId: number): import("../index.js").Query<boolean>;
    /**
     * Retrieve the transactions of an investor.
     * @param poolId - The pool ID
     * @param page
     * @param pageSize
     */
    transactions(poolId: PoolId, page?: number, pageSize?: number): import("../index.js").Query<{
        transactions: {
            type: string;
            txHash: `0x${string}`;
            createdAt: string;
            token: string;
            tokenSymbol: string;
            tokenAmount: Balance;
            currencyAmount: Balance;
            chainId: number;
            poolId: string;
        }[];
        totalCount: number;
        page: number;
        pageSize: number;
    }>;
    allTransactions(poolId: PoolId): import("../index.js").Query<{
        transactions: {
            type: string;
            txHash: `0x${string}`;
            createdAt: string;
            token: string;
            tokenSymbol: string;
            tokenAmount: Balance;
            currencyAmount: Balance;
            chainId: number;
            poolId: string;
        }[];
        totalCount: number;
        page: number;
        pageSize: number;
    }>;
}
//# sourceMappingURL=Investor.d.ts.map