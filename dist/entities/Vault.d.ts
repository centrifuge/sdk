import type { HexString } from '../types/index.js';
import { Balance } from '../utils/BigInt.js';
import { AssetId } from '../utils/types.js';
import { Entity } from './Entity.js';
import type { Pool } from './Pool.js';
import { PoolNetwork } from './PoolNetwork.js';
import { ShareClass } from './ShareClass.js';
/**
 * Query and interact with a vault, which is the main entry point for investing and redeeming funds.
 * A vault is the combination of a network, a pool, a share class and an investment currency.
 */
export declare class Vault extends Entity {
    network: PoolNetwork;
    shareClass: ShareClass;
    assetId: AssetId;
    pool: Pool;
    chainId: number;
    /**
     * The contract address of the vault.
     */
    address: HexString;
    /**
     * Get the details of the vault.
     */
    details(): import("../index.js").Query<{
        pool: Pool;
        shareClass: ShareClass;
        network: PoolNetwork;
        address: `0x${string}`;
        asset: `0x${string}`;
        isLinked: boolean;
        isSyncInvest: boolean;
        isSyncRedeem: boolean;
        investmentCurrency: import("../types/index.js").CurrencyDetails;
        shareCurrency: import("../types/index.js").CurrencyDetails;
    }>;
    /**
     * @returns Whether the vault is linked and can be used for investments.
     */
    isLinked(): import("../index.js").Query<boolean>;
    /**
     * Get the details of the investment of an investor in the vault and any pending investments or redemptions.
     * @param investor - The address of the investor
     */
    investment(investor: HexString): import("../index.js").Query<{
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
     * Place an order to invest funds in the vault. If an order exists, it will increase the amount.
     * @param amount - The amount to invest in the vault
     */
    increaseInvestOrder(amount: Balance): import("../types/transaction.js").Transaction;
    /**
     * Cancel an open investment order.
     */
    cancelInvestOrder(): import("../types/transaction.js").Transaction;
    /**
     * Place an order to redeem funds from the vault. If an order exists, it will increase the amount.
     * @param sharesAmount - The amount of shares to redeem
     */
    increaseRedeemOrder(sharesAmount: Balance): import("../types/transaction.js").Transaction;
    /**
     * Cancel an open redemption order.
     */
    cancelRedeemOrder(): import("../types/transaction.js").Transaction;
    /**
     * Claim any outstanding fund shares after an investment has gone through, or funds after an redemption has gone through.
     * @param receiver - The address that should receive the funds. If not provided, the investor's address is used.
     * @param controller - The address of the user that has invested. Allows someone else to claim on behalf of the user
     *  if the user has set the VaultRouter as an operator on the vault. If not provided, the investor's address is used.
     */
    claim(receiver?: HexString, controller?: HexString): import("../types/transaction.js").Transaction;
}
//# sourceMappingURL=Vault.d.ts.map