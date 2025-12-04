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
        asset: import("../types/index.js").CurrencyDetails;
        isLinked: boolean;
        isSyncDeposit: boolean;
        isSyncRedeem: boolean;
        share: import("../types/index.js").CurrencyDetails;
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
        assetBalance: Balance;
        assetAllowance: Balance;
        isAllowedToDeposit: boolean;
        isAllowedToRedeem: boolean;
        isSyncDeposit: boolean;
        isOperatorEnabled: boolean;
        maxDeposit: Balance;
        claimableDepositShares: Balance;
        claimableDepositAssetEquivalent: Balance;
        claimableRedeemAssets: Balance;
        claimableRedeemSharesEquivalent: Balance;
        pendingDepositAssets: Balance;
        pendingRedeemShares: Balance;
        claimableCancelDepositAssets: Balance;
        claimableCancelRedeemShares: Balance;
        hasPendingCancelDepositRequest: boolean;
        hasPendingCancelRedeemRequest: boolean;
        asset: import("../types/index.js").CurrencyDetails;
        share: import("../types/index.js").CurrencyDetails;
    }>;
    /**
     * Place a synchronous deposit (ERC-4626 style) in the vault.
     * @param amount - The amount to deposit in the vault
     * @throws Error if the vault does not support synchronous deposits
     */
    syncDeposit(amount: Balance): import("../types/transaction.js").Transaction;
    /**
     * Place an asynchronous deposit request (ERC-7540 style) in the vault. If an order exists, it will increase the amount.
     * @param amount - The amount to deposit in the vault
     * @throws Error if the vault does not support asynchronous deposits
     */
    asyncDeposit(amount: Balance): import("../types/transaction.js").Transaction;
    /**
     * Cancel an open deposit request.
     */
    cancelDepositRequest(): import("../types/transaction.js").Transaction;
    /**
     * Place an asynchronous redeem request (ERC-7540 style) in the vault. If an order exists, it will increase the amount.
     * @param sharesAmount - The amount of shares to redeem
     */
    asyncRedeem(sharesAmount: Balance): import("../types/transaction.js").Transaction;
    /**
     * Cancel an open redemption request.
     */
    cancelRedeemRequest(): import("../types/transaction.js").Transaction;
    /**
     * Claim any outstanding fund shares after an investment has gone through, or funds after an redemption has gone through.
     * @param receiver - The address that should receive the funds. If not provided, the investor's address is used.
     * @param controller - The address of the user that has invested. Allows someone else to claim on behalf of the user
     *  if the user has set the VaultRouter as an operator on the vault. If not provided, the investor's address is used.
     */
    claim(receiver?: HexString, controller?: HexString): import("../types/transaction.js").Transaction;
    /**
     * Update the pricing oracle valuation for this vault.
     * @param valuation - The valuation
     */
    updateValuation(valuation: HexString): import("../types/transaction.js").Transaction;
    /**
     * Update the maximum deposit reserve for this vault.
     * @param maxReserve - The maximum reserve amount
     */
    updateMaxReserve(maxReserve: Balance): import("../types/transaction.js").Transaction;
}
//# sourceMappingURL=Vault.d.ts.map