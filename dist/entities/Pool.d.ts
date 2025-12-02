import { HexString } from '../types/index.js';
import { PoolMetadataInput, ShareClassInput } from '../types/poolInput.js';
import { PoolMetadata } from '../types/poolMetadata.js';
import { AssetId, PoolId, ShareClassId } from '../utils/types.js';
import { Entity } from './Entity.js';
import { PoolNetwork } from './PoolNetwork.js';
import { PoolReports } from './Reports/PoolReports.js';
import { ShareClass } from './ShareClass.js';
export declare class Pool extends Entity {
    chainId: number;
    id: PoolId;
    get reports(): PoolReports;
    /**
     * Query the details of the pool.
     * @returns The pool metadata, id, shareClasses and currency.
     */
    details(): import("../index.js").Query<{
        id: PoolId;
        currency: {
            name: string;
            symbol: string;
            decimals: number;
        };
        metadata: PoolMetadata | null;
        shareClasses: {
            shareClass: ShareClass;
            details: {
                id: ShareClassId;
                name: string;
                symbol: string;
                totalIssuance: import("../index.js").Balance;
                pricePerShare: import("../index.js").Price;
                nav: import("../index.js").Balance;
                navPerNetwork: {
                    chainId: number;
                    totalIssuance: import("../index.js").Balance;
                    pricePerShare: import("../index.js").Price;
                    nav: import("../index.js").Balance;
                    address: `0x${string}`;
                }[];
                icon: import("../types/poolMetadata.js").FileType | null;
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
            };
        }[];
    }>;
    metadata(): import("../index.js").Query<PoolMetadata | null>;
    shareClasses(): import("../index.js").Query<ShareClass[]>;
    shareClass(scId: ShareClassId): import("../index.js").Query<ShareClass>;
    shareClassesDetails(): import("../index.js").Query<{
        id: ShareClassId;
        name: string;
        symbol: string;
        totalIssuance: import("../index.js").Balance;
        pricePerShare: import("../index.js").Price;
        nav: import("../index.js").Balance;
        navPerNetwork: {
            chainId: number;
            totalIssuance: import("../index.js").Balance;
            pricePerShare: import("../index.js").Price;
            nav: import("../index.js").Balance;
            address: `0x${string}`;
        }[];
        icon: import("../types/poolMetadata.js").FileType | null;
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
    }[]>;
    /**
     * Get the managers on the Hub.
     * These managers that can manage the pool, approve deposits, update prices, etc.
     */
    poolManagers(): import("../index.js").Query<{
        address: `0x${string}`;
    }[]>;
    /**
     * Get the managers on the Balance Sheet.
     * These managers can transfer funds to and from the balance sheet.
     */
    balanceSheetManagers(): import("../index.js").Query<{
        address: `0x${string}`;
        chainId: number;
        type: string;
    }[]>;
    /**
     * Check if an address is a manager of the pool.
     * @param address - The address to check
     */
    isPoolManager(address: HexString): import("../index.js").Query<boolean>;
    /**
     * Check if an address is a Balance Sheet manager of the pool.
     * @param chainId - The chain ID of the Spoke to check
     * @param address - The address to check
     */
    isBalanceSheetManager(chainId: number, address: HexString): import("../index.js").Query<boolean>;
    /**
     * Get all networks where a pool can potentially be deployed.
     */
    networks(): import("../index.js").Query<PoolNetwork[]>;
    /**
     * Get a specific network where a pool can potentially be deployed.
     */
    network(chainId: number): import("../index.js").Query<PoolNetwork>;
    /**
     * Get the networks where a pool is active. It doesn't mean that any vaults are deployed there necessarily.
     */
    activeNetworks(): import("../index.js").Query<PoolNetwork[]>;
    vault(chainId: number, scId: ShareClassId, asset: HexString | AssetId): import("../index.js").Query<import("./Vault.js").Vault>;
    /**
     * Get the currency of the pool.
     */
    currency(): import("../index.js").Query<{
        name: string;
        symbol: string;
        decimals: number;
    }>;
    /**
     * Update pool metadata.
     */
    updateMetadata(metadata: PoolMetadata): import("../types/transaction.js").Transaction;
    update(metadataInput: Partial<PoolMetadataInput>, updatedShareClasses: ({
        id: ShareClassId;
    } & ShareClassInput)[], addedShareClasses?: ShareClassInput[]): import("../types/transaction.js").Transaction;
    /**
     * Update pool managers.
     */
    updatePoolManagers(updates: {
        address: HexString;
        canManage: boolean;
    }[]): import("../types/transaction.js").Transaction;
    /**
     * Update balance sheet managers.
     */
    updateBalanceSheetManagers(updates: {
        chainId: number;
        address: HexString;
        canManage: boolean;
    }[]): import("../types/transaction.js").Transaction;
    createAccounts(accounts: {
        accountId: number;
        isDebitNormal: boolean;
    }[]): import("../types/transaction.js").Transaction;
}
//# sourceMappingURL=Pool.d.ts.map