import { HexString } from '../types/index.js';
import { AssetId, ShareClassId } from '../utils/types.js';
import { BalanceSheet } from './BalanceSheet.js';
import { Entity } from './Entity.js';
import { MerkleProofManager } from './MerkleProofManager.js';
import { OnOffRampManager } from './OnOffRampManager.js';
import type { Pool } from './Pool.js';
import { ShareClass } from './ShareClass.js';
/**
 * Query and interact with a pool on a specific network.
 */
export declare class PoolNetwork extends Entity {
    pool: Pool;
    chainId: number;
    /**
     * Query the details of the pool on a network.
     * @returns The details, including whether the pool is active, whether any of the share classes have been deployed,
     * and any deployed vaults.
     */
    details(): import("../index.js").Query<{
        isActive: boolean;
        activeShareClasses: {
            shareClass: ShareClass;
            id: ShareClassId;
            shareToken: `0x${string}`;
            vaults: import("./Vault.js").Vault[];
        }[];
    }>;
    balanceSheet(scId: ShareClassId): import("../index.js").Query<BalanceSheet>;
    /**
     * Get the details of the share token.
     * @param scId - The share class ID
     */
    shareCurrency(scId: ShareClassId): import("../index.js").Query<import("../types/index.js").CurrencyDetails>;
    /**
     * Get the deployed Vaults for a given share class. There may exist one Vault for each allowed investment currency.
     * Vaults are used to submit/claim investments and redemptions.
     * @param scId - The share class ID
     * @param includeUnlinked - Whether to include unlinked vaults
     */
    vaults(scId: ShareClassId, includeUnlinked?: boolean): import("../index.js").Query<import("./Vault.js").Vault[]>;
    /**
     * Get a specific Vault for a given share class and investment currency.
     * @param scId - The share class ID
     * @param asset - The investment currency address or asset ID
     */
    vault(scId: ShareClassId, asset: HexString | AssetId): import("../index.js").Query<import("./Vault.js").Vault>;
    /**
     * Get whether the pool is active on this network. It's a prerequisite for deploying vaults,
     * and doesn't indicate whether any vaults have been deployed.
     */
    isActive(): import("../index.js").Query<boolean>;
    merkleProofManager(): import("../index.js").Query<MerkleProofManager>;
    /**
     * Deploy a Merkle Proof Manager.
     */
    deployMerkleProofManager(): import("../types/transaction.js").Transaction;
    /**
     * Get the OnOffRampManager for a given share class.
     * @param scId - The share class ID
     * @returns The OnOffRampManager
     */
    onOfframpManager(scId: ShareClassId): import("../index.js").Query<OnOffRampManager>;
    /**
     * Get all OnOffRampManagers for a given share class and assign balance sheet manager permissions.
     * @param scId - The share class ID
     */
    assignOnOffRampManagerPermissions(scId: ShareClassId): import("../types/transaction.js").Transaction;
    deployOnOfframpManager(scId: ShareClassId): import("../types/transaction.js").Transaction;
    /**
     * Enable and deploy share classes/vaults.
     * @param shareClasses - An array of share classes to enable
     * @param vaults - An array of vaults to deploy
     */
    deploy(shareClasses?: {
        id: ShareClassId;
        hook: HexString;
    }[], vaults?: {
        shareClassId: ShareClassId;
        assetId: AssetId;
        kind: 'async' | 'syncDeposit';
    }[]): import("../types/transaction.js").Transaction;
    /**
     * Unlink vaults.
     * @param vaults - An array of vaults to unlink
     */
    unlinkVaults(vaults: {
        shareClassId: ShareClassId;
        assetId: AssetId;
    }[]): import("../types/transaction.js").Transaction;
    /**
     * Link vaults that are already deployed but currently unlinked.
     * @param vaults - An array of vaults to link
     */
    linkVaults(vaults: {
        shareClassId: ShareClassId;
        assetId: AssetId;
    }[]): import("../types/transaction.js").Transaction;
}
//# sourceMappingURL=PoolNetwork.d.ts.map