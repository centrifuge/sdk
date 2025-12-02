import { AccountType } from '../types/holdings.js';
import { HexString } from '../types/index.js';
import { Balance, Price } from '../utils/BigInt.js';
import { AssetId, ShareClassId } from '../utils/types.js';
import { BalanceSheet } from './BalanceSheet.js';
import { Entity } from './Entity.js';
import type { Pool } from './Pool.js';
import { Vault } from './Vault.js';
import { AddressMap } from '../utils/AddressMap.js';
/**
 * Query and interact with a share class, which allows querying total issuance, NAV per share,
 * and allows interactions related to asynchronous deposits and redemptions.
 */
export declare class ShareClass extends Entity {
    pool: Pool;
    id: ShareClassId;
    /**
     * Query the details of the share class.
     * @returns The details of the share class, including name, symbol, total issuance, NAV per share and relavant metadata from the pool metadata.
     */
    details(): import("../index.js").Query<{
        id: ShareClassId;
        name: string;
        symbol: string;
        totalIssuance: Balance;
        pricePerShare: Price;
        nav: Balance;
        navPerNetwork: {
            chainId: number;
            totalIssuance: Balance;
            pricePerShare: Price;
            nav: Balance;
            address: `0x${string}`;
        }[];
        icon: import("../index.js").FileType | null;
        minInitialInvestment: number | null;
        apyPercentage: number | null;
        apy: "target" | "7day" | "30day" | "90day" | "ytd" | "sinceInception" | "automatic" | null;
        defaultAccounts: {
            asset: number | null;
            equity: number | null;
            gain: number | null;
            loss: number | null;
            expense: number | null;
            liability: number | null;
        };
    }>;
    balanceSheet(chainId: number): import("../index.js").Query<BalanceSheet>;
    deploymentPerNetwork(): import("../index.js").Query<{
        chainId: number;
        shareTokenAddress: `0x${string}`;
        restrictionManagerAddress: `0x${string}`;
    }[]>;
    navPerNetwork(): import("../index.js").Query<{
        chainId: number;
        totalIssuance: Balance;
        pricePerShare: Price;
        nav: Balance;
        address: `0x${string}`;
    }[]>;
    /**
     * Query the vaults of the share class.
     * @param chainId The optional chain ID to query the vaults on.
     * @param includeUnlinked Whether to include unlinked vaults.
     * @returns Vaults of the share class.
     */
    vaults(chainId?: number, includeUnlinked?: boolean): import("../index.js").Query<Vault[]>;
    /**
     * Query all the balances of the share class (from BalanceSheet and Holdings).
     */
    balances(chainId?: number): import("../index.js").Query<{
        assetId: AssetId;
        amount: Balance;
        value: Balance;
        price: Price;
        asset: {
            decimals: number;
            address: `0x${string}`;
            tokenId: bigint;
            name: string;
            symbol: string;
            chainId: number;
        };
        holding: {
            valuation: `0x${string}`;
            amount: Balance;
            value: Balance;
            isLiability: boolean;
            accounts: {
                0: number | null;
                1: number | null;
                2: number | null;
                3: number | null;
                4: number | null;
                5: number | null;
            };
        } | null | undefined;
    }[]>;
    /**
     * Get the pending and approved amounts for deposits and redemptions for each asset.
     */
    pendingAmounts(): import("../index.js").Query<{
        depositEpoch: number;
        redeemEpoch: number;
        issueEpoch: number;
        revokeEpoch: number;
        pendingDeposit: Balance;
        pendingRedeem: Balance;
        pendingIssuancesTotal: Balance;
        pendingIssuances: {
            amount: Balance;
            approvedAt: Date | undefined;
            epoch: number;
        }[];
        pendingRevocationsTotal: Balance;
        pendingRevocations: {
            amount: Balance;
            approvedAt: Date | undefined;
            epoch: number;
        }[];
        assetId: AssetId;
        chainId: number;
        queuedInvest: Balance;
        queuedRedeem: Balance;
        assetPrice: Price;
    }[]>;
    /**
     * Check if an address is a member of the share class.
     * @param address Address to check
     * @param chainId Chain ID of the network on which to check the member
     */
    member(address: HexString, chainId: number): import("../index.js").Query<{
        isMember: boolean;
        validUntil: Date;
    } | {
        isMember: boolean;
        validUntil: Date;
    }>;
    /**
     * Create a holding for a registered asset in the share class.
     * @param assetId - Asset ID of the asset to create a holding for
     * @param valuation - Valuation of the asset
     * @param isLiability - Whether the holding is a liability or not
     * @param accounts - Accounts to use for the holding. An asset or expense account will be created if not provided.
     * Other accounts are expected to be provided or to exist in the pool metadata.
     */
    createHolding<Liability extends boolean>(assetId: AssetId, valuation: HexString, isLiability: Liability, accounts?: Liability extends true ? {
        [key in AccountType.Expense | AccountType.Liability]?: number;
    } : {
        [key in AccountType.Asset | AccountType.Equity | AccountType.Loss | AccountType.Gain]?: number;
    }): import("../types/transaction.js").Transaction;
    updateSharePrice(pricePerShare: Price): import("../types/transaction.js").Transaction;
    setMaxAssetPriceAge(assetId: AssetId, maxPriceAge: number): import("../types/transaction.js").Transaction;
    setMaxSharePriceAge(chainId: number, maxPriceAge: number): import("../types/transaction.js").Transaction;
    notifyAssetPrice(assetId: AssetId): import("../types/transaction.js").Transaction;
    notifySharePrice(chainId: number): import("../types/transaction.js").Transaction;
    /**
     * Approve deposits and issue shares for the given assets.
     * @param assets - Array of assets to approve deposits and/or issue shares for
     * `issuePricePerShare` can be a single price for all epochs or an array of prices for each epoch to be issued for.
     */
    approveDepositsAndIssueShares(assets: {
        assetId: AssetId;
        approveAssetAmount?: Balance;
        issuePricePerShare?: Price | Price[];
    }[]): import("../types/transaction.js").Transaction;
    /**
     * Approve redeems and revoke shares for the given assets.
     * @param assets - Array of assets to approve redeems and/or revoke shares for
     * `approveShareAmount` can be a single amount for all epochs or an array of amounts for each epoch to be revoked.
     */
    approveRedeemsAndRevokeShares(assets: {
        assetId: AssetId;
        approveShareAmount?: Balance;
        revokePricePerShare?: Price | Price[];
    }[]): import("../types/transaction.js").Transaction;
    /**
     * Claim a deposit on the Hub side for the given asset and investor after the shares have been issued.
     * This will send a message to the Spoke that will allow the investor to claim their shares.
     */
    claimDeposit(assetId: AssetId, investor: HexString): import("../types/transaction.js").Transaction;
    /**
     * Claim a redemption on the Hub side for the given asset and investor after the shares have been revoked.
     * This will send a message to the Spoke that will allow the investor to claim their redeemed currency.
     */
    claimRedeem(assetId: AssetId, investor: HexString): import("../types/transaction.js").Transaction;
    /**
     * Update a member of the share class.
     * @param address Address of the investor
     * @param validUntil Time in seconds from Unix epoch until the investor is valid
     * @param chainId Chain ID of the network on which to update the member
     */
    updateMember(address: HexString, validUntil: number, chainId: number): import("../types/transaction.js").Transaction;
    /**
     * Batch update a list of members of the share class.
     * @param members Array of members to update, each with address, validUntil and chainId
     * @param members.address Address of the investor
     * @param members.validUntil Time in seconds from Unix epoch until the investor is valid
     * @param members.chainId Chain ID of the network on which to update the member
     */
    updateMembers(members: {
        address: HexString;
        validUntil: number;
        chainId: number;
    }[]): import("../types/transaction.js").Transaction;
    /**
     * Retrieve all holders of the share class.
     * @param options Optional pagination and filter options object
     * @param options.limit Number of results to return (default: 20)
     * @param options.offset Offset for pagination (default: 0)
     * @param options.orderBy Order by field (default: "balance")
     * @param options.orderDirection Order direction (default: "desc")
     * @param options.filter Optional filter criteria
     * @param options.filter.balance_gt Investor minimum position amount filter
     * @param options.filter.holderAddress Filter by holder address (partial text match)
     * @param options.filter.centrifugeIds Filter by centrifuge IDs (array of centrifuge IDs)
     */
    holders(options?: {
        limit?: number;
        offset?: number;
        orderBy?: string;
        orderDirection?: string;
        filter?: {
            balance_gt?: bigint;
            holderAddress?: string;
            centrifugeIds?: string[];
        };
    }): import("../index.js").Query<{
        investors: {
            address: `0x${string}`;
            amount: Balance;
            chainId: number;
            createdAt: string;
            holdings: Balance;
            isFrozen: boolean;
            outstandingInvest: Balance;
            outstandingRedeem: Balance;
            queuedInvest: Balance;
            queuedRedeem: Balance;
            isWhitelisted: boolean;
        }[];
        pageInfo: {
            hasNextPage: boolean;
            hasPreviousPage: boolean;
            startCursor: string;
            endCursor: string;
        };
        totalCount: number;
    }>;
    /**
     * Retrieve only whitelisted holders of the share class.
     * @param options Optional pagination options object for whitelisted investors query
     * @param options.limit Number of results to return (default: 20)
     * @param options.offset Offset for pagination (default: 0)
     */
    whitelistedHolders(options?: {
        limit: number;
        offset?: number;
    }): import("../index.js").Query<{
        investors: {
            address: `0x${string}`;
            amount: Balance;
            chainId: number;
            createdAt: string;
            holdings: Balance;
            isFrozen: boolean;
            outstandingInvest: Balance;
            outstandingRedeem: Balance;
            queuedInvest: Balance;
            queuedRedeem: Balance;
            isWhitelisted: boolean;
        }[];
        pageInfo: {
            hasNextPage: boolean;
            hasPreviousPage: boolean;
            startCursor: string;
            endCursor: string;
        };
        totalCount: number;
    }>;
    /**
     * Retrieve investor orders of the share class.
     * @returns Investor orders
     */
    investorOrders(): import("../index.js").Query<AddressMap<{
        investor: HexString;
        assetId: AssetId;
        maxRedeemClaims: number;
        maxDepositClaims: number;
        pendingRedeem: bigint;
        pendingDeposit: bigint;
    }[]>>;
    /**
     * Freeze a member of the share class.
     */
    freezeMember(address: HexString, chainId: number): import("../types/transaction.js").Transaction;
    /**
     * Unfreeze a member of the share class
     */
    unfreezeMember(address: HexString, chainId: number): import("../types/transaction.js").Transaction;
    /**
     * Get the pending and claimable investment/redeem amounts for all investors
     * in a given share class (per vault/chain)
     */
    investmentsByVault(chainId: number): import("../index.js").Query<({
        investor: `0x${string}`;
        assetId: AssetId;
        chainId: number;
        pendingDepositAssets: Balance;
        pendingRedeemShares: Balance;
        claimableDepositShares: Balance;
        claimableRedeemAssets: Balance;
        queuedInvest: Balance;
        queuedRedeem: Balance;
        depositEpoch: number | undefined;
        redeemEpoch: number | undefined;
        issueEpoch: number | undefined;
        revokeEpoch: number | undefined;
        pendingIssuances: {
            assetId: AssetId;
            chainId: number;
            amount: Balance;
            approvedAt: Date | undefined;
            epoch: number;
        }[];
        pendingRevocations: {
            assetId: AssetId;
            chainId: number;
            amount: Balance;
            approvedAt: Date | undefined;
            epoch: number;
        }[];
    } | {
        investor: `0x${string}`;
        assetId: AssetId;
        chainId: number;
        pendingDepositAssets: Balance;
        pendingRedeemShares: Balance;
        claimableDepositShares: Balance;
        claimableRedeemAssets: Balance;
        queuedInvest: Balance;
        queuedRedeem: Balance;
        pendingIssuances: never[];
        pendingRevocations: never[];
    })[]>;
    /**
     * Get closed investment orders
     * @returns Closed investment orders where shares have been issued
     */
    closedInvestments(): import("../index.js").Query<{
        investor: HexString;
        index: number;
        assetId: AssetId;
        approvedAmount: Balance;
        approvedAt: string | null;
        issuedAmount: Balance;
        issuedAt: string | null;
        priceAsset: Price;
        pricePerShare: Price;
        claimedAt: string | null;
        isClaimed: boolean;
        asset: {
            symbol: string;
            name: string;
            decimals: number;
        };
        chainId: number;
        token: {
            decimals: number;
        };
    }[]>;
    /**
     * Get closed redemption orders
     * @returns Closed redemption orders where shares have been revoked
     */
    closedRedemptions(): import("../index.js").Query<{
        investor: HexString;
        index: number;
        assetId: AssetId;
        approvedAmount: Balance;
        approvedAt: string | null;
        payoutAmount: Balance;
        revokedAt: string | null;
        priceAsset: Price;
        pricePerShare: Price;
        claimedAt: string | null;
        isClaimed: boolean;
        asset: {
            symbol: string;
            name: string;
            decimals: number;
        };
        chainId: number;
        token: {
            decimals: number;
        };
    }[]>;
}
//# sourceMappingURL=ShareClass.d.ts.map