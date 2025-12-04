import { combineLatest, defer, EMPTY, firstValueFrom, map, of, switchMap } from 'rxjs';
import { encodeFunctionData, encodePacked, getContract, maxUint128 } from 'viem';
import { ABI } from '../abi/index.js';
import { NULL_ADDRESS } from '../constants.js';
import { MessageType, VaultUpdateKind } from '../types/transaction.js';
import { addressToBytes32 } from '../utils/index.js';
import { repeatOnEvents } from '../utils/rx.js';
import { doTransaction, wrapTransaction } from '../utils/transaction.js';
import { BalanceSheet } from './BalanceSheet.js';
import { Entity } from './Entity.js';
import { MerkleProofManager } from './MerkleProofManager.js';
import { OnOffRampManager } from './OnOffRampManager.js';
import { ShareClass } from './ShareClass.js';
/**
 * Query and interact with a pool on a specific network.
 */
export class PoolNetwork extends Entity {
    pool;
    chainId;
    /** @internal */
    constructor(_root, pool, chainId) {
        super(_root, ['poolnetwork', pool.id.toString(), chainId]);
        this.pool = pool;
        this.chainId = chainId;
    }
    /**
     * Query the details of the pool on a network.
     * @returns The details, including whether the pool is active, whether any of the share classes have been deployed,
     * and any deployed vaults.
     */
    details() {
        return this._query(['poolNetworkDetails'], () => this.pool.shareClasses().pipe(switchMap((shareClasses) => {
            return combineLatest([
                this.isActive(),
                this._vaultsByShareClass(),
                ...shareClasses.map((sc) => this._share(sc.id, false)),
            ]).pipe(map(([isActive, vaultsByShareClass, ...shareTokens]) => {
                return {
                    isActive,
                    activeShareClasses: shareClasses
                        .filter((_, i) => shareTokens[i] !== NULL_ADDRESS)
                        .map((sc, i) => {
                        return {
                            shareClass: sc,
                            id: sc.id,
                            shareToken: shareTokens[i],
                            vaults: vaultsByShareClass[sc.id.raw] ?? [],
                        };
                    }),
                };
            }));
        })));
    }
    balanceSheet(scId) {
        return this._query(['balanceSheet', scId.toString()], () => of(new BalanceSheet(this._root, this, new ShareClass(this._root, this.pool, scId.raw))));
    }
    /**
     * Get the details of the share token.
     * @param scId - The share class ID
     */
    shareCurrency(scId) {
        return this._query(['shareCurrency', scId.toString()], () => this._share(scId).pipe(switchMap((share) => this._root.currency(share, this.chainId))));
    }
    /**
     * Get the deployed Vaults for a given share class. There may exist one Vault for each allowed investment currency.
     * Vaults are used to submit/claim investments and redemptions.
     * @param scId - The share class ID
     * @param includeUnlinked - Whether to include unlinked vaults
     */
    vaults(scId, includeUnlinked = false) {
        return this._query(['vaults', scId.toString(), includeUnlinked.toString()], () => this._root.pool(this.pool.id).pipe(switchMap((pool) => pool.shareClass(scId)), switchMap((shareClass) => shareClass.vaults(this.chainId, includeUnlinked))));
    }
    /**
     * Get a specific Vault for a given share class and investment currency.
     * @param scId - The share class ID
     * @param asset - The investment currency address or asset ID
     */
    vault(scId, asset) {
        return this._query(['vault', scId.toString(), asset.toString()], () => combineLatest([
            this.vaults(scId),
            typeof asset === 'string' ? of({ address: asset, tokenId: 0n }) : this._root.assetCurrency(asset),
        ]).pipe(map(([vaults, { address }]) => {
            const addr = address.toLowerCase();
            const vault = vaults.find((v) => v._asset === addr);
            if (!vault)
                throw new Error('Vault not found');
            return vault;
        })));
    }
    /**
     * Get whether the pool is active on this network. It's a prerequisite for deploying vaults,
     * and doesn't indicate whether any vaults have been deployed.
     */
    isActive() {
        return this._query(['isActive'], () => this._root._protocolAddresses(this.chainId).pipe(switchMap(({ spoke }) => {
            return defer(() => this._root.getClient(this.chainId).readContract({
                address: spoke,
                abi: ABI.Spoke,
                functionName: 'isPoolActive',
                args: [this.pool.id.raw],
            })).pipe(repeatOnEvents(this._root, {
                address: spoke,
                eventName: 'AddPool',
                filter: (events) => {
                    return events.some((event) => {
                        return event.args.poolId === this.pool.id;
                    });
                },
            }, this.chainId));
        })));
    }
    merkleProofManager() {
        return this._query(['merkleProofManager'], () => this._root.id(this.chainId).pipe(switchMap((centrifugeId) => this._root._queryIndexer(`query ($poolId: BigInt!, $centrifugeId: String!) {
              merkleProofManagers(where: {poolId: $poolId, centrifugeId: $centrifugeId}) {
                items {
                  address
                }
              }
            }`, { poolId: this.pool.id.toString(), centrifugeId: centrifugeId.toString() }, (data) => {
            const manager = data.merkleProofManagers.items[0];
            if (!manager) {
                throw new Error('MerkleProofManager not found');
            }
            return new MerkleProofManager(this._root, this, manager.address);
        }))));
    }
    /**
     * Deploy a Merkle Proof Manager.
     */
    deployMerkleProofManager() {
        const self = this;
        return this._transact(async function* (ctx) {
            const { merkleProofManagerFactory } = await self._root._protocolAddresses(self.chainId);
            yield* doTransaction('AddMerkleProofManager', ctx, () => ctx.walletClient.writeContract({
                address: merkleProofManagerFactory,
                abi: ABI.MerkleProofManagerFactory,
                functionName: 'newManager',
                args: [self.pool.id.raw],
            }));
        }, self.chainId);
    }
    /**
     * Get the OnOffRampManager for a given share class.
     * @param scId - The share class ID
     * @returns The OnOffRampManager
     */
    onOfframpManager(scId) {
        return this._query(null, () => combineLatest([
            this._root.id(this.chainId).pipe(switchMap((centrifugeId) => this._root._queryIndexer(`query ($scId: String!, $centrifugeId: String!) {
                onOffRampManagers(where: {tokenId: $scId, centrifugeId: $centrifugeId}) {
                  items {
                    address
                  }
                }
              }`, {
                scId: scId.toString(),
                centrifugeId: centrifugeId.toString(),
            }, (data) => data.onOffRampManagers.items))),
            this.pool.balanceSheetManagers(),
        ]).pipe(map(([deployedOnOffRampManager, balanceSheetManagers]) => {
            const onoffRampManager = deployedOnOffRampManager[0];
            if (!onoffRampManager) {
                throw new Error('OnOffRampManager not found');
            }
            const verifiedManager = balanceSheetManagers.find((manager) => manager.address.toLowerCase() === onoffRampManager.address.toLowerCase());
            if (!verifiedManager) {
                throw new Error('OnOffRampManager not found in balance sheet managers');
            }
            return new OnOffRampManager(this._root, this, new ShareClass(this._root, this.pool, scId.raw), verifiedManager.address);
        })));
    }
    /**
     * Get all OnOffRampManagers for a given share class and assign balance sheet manager permissions.
     * @param scId - The share class ID
     */
    assignOnOffRampManagerPermissions(scId) {
        const self = this;
        return this._transact(() => {
            return combineLatest([
                this._root.id(this.chainId).pipe(switchMap((centrifugeId) => this._root._queryIndexer(`query ($scId: String!, $centrifugeId: String!) {
                onOffRampManagers(where: {tokenId: $scId, centrifugeId: $centrifugeId}) {
                  items {
                    address
                  }
                }
              }`, {
                    scId: scId.toString(),
                    centrifugeId: centrifugeId.toString(),
                }, (data) => data.onOffRampManagers.items))),
                this.pool.balanceSheetManagers(),
            ]).pipe(switchMap(([deployedOnOffRampManager, balanceSheetManagers]) => {
                const bsManagers = new Map();
                balanceSheetManagers.forEach((manager) => {
                    bsManagers.set(manager.address.toLowerCase(), manager);
                });
                const onOffRampManagers = deployedOnOffRampManager
                    .filter((onOffRampManager) => {
                    return bsManagers.has(onOffRampManager.address.toLowerCase()) === false;
                })
                    .map((onOffRampManager) => ({
                    chainId: self.chainId,
                    address: onOffRampManager.address,
                    canManage: true,
                }));
                if (onOffRampManagers.length === 0) {
                    return EMPTY;
                }
                return this.pool.updateBalanceSheetManagers(onOffRampManagers);
            }));
        }, this.pool.chainId);
    }
    deployOnOfframpManager(scId) {
        const self = this;
        return this._transact(async function* (ctx) {
            const { onOfframpManagerFactory } = await self._root._protocolAddresses(self.chainId);
            yield* doTransaction('DeployOnOfframpManager', ctx, () => ctx.walletClient.writeContract({
                address: onOfframpManagerFactory,
                abi: ABI.OnOffRampManagerFactory,
                functionName: 'newManager',
                args: [self.pool.id.raw, scId.raw],
            }));
        }, self.chainId);
    }
    /**
     * Enable and deploy share classes/vaults.
     * @param shareClasses - An array of share classes to enable
     * @param vaults - An array of vaults to deploy
     */
    deploy(shareClasses = [], vaults = []) {
        const self = this;
        return this._transact(async function* (ctx) {
            const [{ hub }, { balanceSheet, syncDepositVaultFactory, asyncVaultFactory, syncManager, asyncRequestManager }, id, details,] = await Promise.all([
                self._root._protocolAddresses(self.pool.chainId),
                self._root._protocolAddresses(self.chainId),
                self._root.id(self.chainId),
                self.details(),
            ]);
            const balanceSheetContract = getContract({
                client: ctx.publicClient,
                address: balanceSheet,
                abi: ABI.BalanceSheet,
            });
            const [isAsyncManagerSet, isSyncManagerSet] = await Promise.all([
                balanceSheetContract.read.manager([self.pool.id.raw, asyncRequestManager]),
                balanceSheetContract.read.manager([self.pool.id.raw, syncManager]),
            ]);
            const batch = [];
            const messageTypes = [];
            // Set vault managers as balance sheet managers if not already set
            // Always set async manager, as it's used by both async and sync deposit vaults
            if (!isAsyncManagerSet) {
                batch.push(encodeFunctionData({
                    abi: ABI.Hub,
                    functionName: 'updateBalanceSheetManager',
                    args: [id, self.pool.id.raw, addressToBytes32(asyncRequestManager), true],
                }));
                messageTypes.push(MessageType.UpdateBalanceSheetManager);
            }
            if (!isSyncManagerSet && vaults.some((v) => v.kind === 'syncDeposit')) {
                batch.push(encodeFunctionData({
                    abi: ABI.Hub,
                    functionName: 'updateBalanceSheetManager',
                    args: [id, self.pool.id.raw, addressToBytes32(syncManager), true],
                }));
                messageTypes.push(MessageType.UpdateBalanceSheetManager);
            }
            if (!details.isActive) {
                batch.push(encodeFunctionData({
                    abi: ABI.Hub,
                    functionName: 'notifyPool',
                    args: [self.pool.id.raw, id],
                }));
                messageTypes.push(MessageType.NotifyPool);
            }
            const enabledShareClasses = new Set(details.activeShareClasses.map((sc) => sc.id.raw));
            for (const sc of shareClasses) {
                if (details.activeShareClasses.some((activeSc) => activeSc.id.equals(sc.id.raw))) {
                    console.warn(`Share class "${sc.id}" is already active in pool "${self.pool.id}"`);
                    continue;
                }
                enabledShareClasses.add(sc.id.raw);
                batch.push(encodeFunctionData({
                    abi: ABI.Hub,
                    functionName: 'notifyShareClass',
                    args: [self.pool.id.raw, sc.id.raw, id, addressToBytes32(sc.hook)],
                }));
                messageTypes.push(MessageType.NotifyShareClass);
            }
            const shareClassesNeedingNotification = new Map();
            for (const vault of vaults) {
                if (!enabledShareClasses.has(vault.shareClassId.raw)) {
                    const hook = vault.hook ?? NULL_ADDRESS;
                    shareClassesNeedingNotification.set(vault.shareClassId.raw, hook);
                }
            }
            for (const [shareClassIdRaw, hook] of shareClassesNeedingNotification) {
                enabledShareClasses.add(shareClassIdRaw);
                batch.push(encodeFunctionData({
                    abi: ABI.Hub,
                    functionName: 'notifyShareClass',
                    args: [self.pool.id.raw, shareClassIdRaw, id, addressToBytes32(hook)],
                }));
                messageTypes.push(MessageType.NotifyShareClass);
            }
            for (const vault of vaults) {
                if (!enabledShareClasses.has(vault.shareClassId.raw)) {
                    throw new Error(`Share class "${vault.shareClassId.raw}" is not enabled in pool "${self.pool.id.raw}"`);
                }
                const existingShareClass = details.activeShareClasses.find((sc) => sc.id.equals(vault.shareClassId));
                const existingVault = existingShareClass?.vaults.find((v) => v.assetId.equals(vault.assetId));
                const factoryAddress = vault.factory
                    ? vault.factory
                    : vault.kind === 'syncDeposit'
                        ? syncDepositVaultFactory
                        : asyncVaultFactory;
                if (vault.kind === 'syncDeposit') {
                    batch.push(encodeFunctionData({
                        abi: ABI.Hub,
                        functionName: 'updateContract',
                        args: [
                            self.pool.id.raw,
                            vault.shareClassId.raw,
                            id,
                            addressToBytes32(syncManager),
                            encodePacked(['uint8', 'uint128', 'uint128'], [/* UpdateContractType.SyncDepositMaxReserve */ 2, vault.assetId.raw, maxUint128]),
                            0n,
                        ],
                    }));
                }
                // Only set request manager if vault doesn't already exist
                // `setRequestManager` will revert if the share class / asset combination already has a vault
                if (!existingVault) {
                    batch.push(encodeFunctionData({
                        abi: ABI.Hub,
                        functionName: 'setRequestManager',
                        args: [
                            self.pool.id.raw,
                            vault.shareClassId.raw,
                            vault.assetId.raw,
                            addressToBytes32(asyncRequestManager),
                        ],
                    }));
                    messageTypes.push(MessageType.SetRequestManager);
                }
                batch.push(encodeFunctionData({
                    abi: ABI.Hub,
                    functionName: 'notifyAssetPrice',
                    args: [self.pool.id.raw, vault.shareClassId.raw, vault.assetId.raw],
                }), encodeFunctionData({
                    abi: ABI.Hub,
                    functionName: 'updateVault',
                    args: [
                        self.pool.id.raw,
                        vault.shareClassId.raw,
                        vault.assetId.raw,
                        addressToBytes32(factoryAddress),
                        VaultUpdateKind.DeployAndLink,
                        0n, // gas limit
                    ],
                }));
                messageTypes.push(MessageType.NotifyPricePoolPerAsset, {
                    type: MessageType.UpdateVault,
                    subtype: VaultUpdateKind.DeployAndLink,
                });
            }
            if (batch.length === 0) {
                throw new Error('No share classes / vaults to deploy');
            }
            yield* wrapTransaction('Deploy share classes and vaults', ctx, {
                data: batch,
                contract: hub,
                messages: { [id]: messageTypes },
            });
        }, this.pool.chainId);
    }
    /**
     * Unlink vaults.
     * @param vaults - An array of vaults to unlink
     */
    unlinkVaults(vaults) {
        const self = this;
        return this._transact(async function* (ctx) {
            if (vaults.length === 0) {
                throw new Error('No vaults to unlink');
            }
            const [{ hub }, id, details] = await Promise.all([
                self._root._protocolAddresses(self.pool.chainId),
                self._root.id(self.chainId),
                self.details(),
            ]);
            const batch = [];
            const messageTypes = [];
            for (const vault of vaults) {
                const shareClass = details.activeShareClasses.find((sc) => sc.id.equals(vault.shareClassId));
                if (!shareClass) {
                    throw new Error(`Share class "${vault.shareClassId.raw}" not found`);
                }
                const existingVault = shareClass.vaults.find((v) => v.address.toLowerCase() === vault.address.toLowerCase());
                if (!existingVault) {
                    throw new Error(`Vault with address "${vault.address}" not found for share class "${vault.shareClassId.raw}"`);
                }
                batch.push(encodeFunctionData({
                    abi: ABI.Hub,
                    functionName: 'updateVault',
                    args: [
                        self.pool.id.raw,
                        vault.shareClassId.raw,
                        vault.assetId.raw,
                        addressToBytes32(vault.address),
                        VaultUpdateKind.Unlink,
                        0n, // gas limit
                    ],
                }));
                messageTypes.push({ type: MessageType.UpdateVault, subtype: VaultUpdateKind.Unlink });
            }
            yield* wrapTransaction('Unlink vaults', ctx, {
                data: batch,
                contract: hub,
                messages: { [id]: messageTypes },
            });
        }, this.pool.chainId);
    }
    /**
     * Link vaults that are already deployed but currently unlinked.
     * @param vaults - An array of vaults to link.
     */
    linkVaults(vaults) {
        const self = this;
        return this._transact(async function* (ctx) {
            if (vaults.length === 0) {
                throw new Error('No vaults to link');
            }
            const [{ hub }, id, details] = await Promise.all([
                self._root._protocolAddresses(self.pool.chainId),
                self._root.id(self.chainId),
                self.details(),
            ]);
            const shareClassIds = [...new Set(vaults.map((v) => v.shareClassId.raw))];
            const vaultsWithUnlinked = await Promise.all(shareClassIds.map((scId) => {
                const shareClass = vaults.find((v) => v.shareClassId.raw === scId);
                const shareClassId = shareClass ? shareClass.shareClassId : null;
                return shareClassId ? firstValueFrom(self.vaults(shareClassId, true)) : null;
            }));
            const vaultsByShareClass = Object.fromEntries(shareClassIds.map((scId, i) => [scId, vaultsWithUnlinked[i] ?? []]));
            const batch = [];
            const messageTypes = [];
            for (const vault of vaults) {
                const shareClass = details.activeShareClasses.find((sc) => sc.id.equals(vault.shareClassId));
                if (!shareClass) {
                    throw new Error(`Share class "${vault.shareClassId.raw}" not found`);
                }
                const allVaultsForShareClass = vaultsByShareClass[vault.shareClassId.raw] ?? [];
                const existingVault = allVaultsForShareClass.find((v) => v.address.toLowerCase() === vault.address.toLowerCase());
                if (!existingVault) {
                    throw new Error(`Vault with address "${vault.address}" not found for share class "${vault.shareClassId.raw}". The vault must be deployed before it can be linked.`);
                }
                batch.push(encodeFunctionData({
                    abi: ABI.Hub,
                    functionName: 'updateVault',
                    args: [
                        self.pool.id.raw,
                        vault.shareClassId.raw,
                        vault.assetId.raw,
                        addressToBytes32(vault.address),
                        VaultUpdateKind.Link,
                        0n,
                    ],
                }));
                messageTypes.push({ type: MessageType.UpdateVault, subtype: VaultUpdateKind.Link });
            }
            yield* wrapTransaction('Link vaults', ctx, {
                data: batch,
                contract: hub,
                messages: { [id]: messageTypes },
            });
        }, this.pool.chainId);
    }
    /**
     * Get the contract address of the share token.
     * @internal
     */
    _share(scId, throwOnNullAddress = true) {
        return this._query(['share', scId.toString(), throwOnNullAddress], () => this._root._protocolAddresses(this.chainId).pipe(switchMap(({ spoke }) => defer(async () => {
            try {
                const address = await this._root.getClient(this.chainId).readContract({
                    address: spoke,
                    abi: ABI.Spoke,
                    functionName: 'shareToken',
                    args: [this.pool.id.raw, scId.raw],
                });
                return address.toLowerCase();
            }
            catch {
                if (throwOnNullAddress) {
                    throw new Error(`Share class ${scId} not found for pool ${this.pool.id} on chain ${this.chainId}`);
                }
                return NULL_ADDRESS;
            }
        }).pipe(repeatOnEvents(this._root, {
            address: spoke,
            eventName: 'AddShareClass',
            filter: (events) => {
                return events.some((event) => event.args.poolId === this.pool.id.raw && event.args.scId === scId.raw);
            },
        }, this.chainId)))));
    }
    /**
     * Get all Vaults for all share classes in the pool.
     * @returns An object of share class ID to Vault.
     * @internal
     */
    _vaultsByShareClass() {
        return this._query(['vaultsByShareClass'], () => this.pool._shareClassIds().pipe(switchMap((scIds) => {
            if (scIds.length === 0)
                throw new Error('No share classes found');
            return combineLatest(scIds.map((scId) => this.vaults(scId))).pipe(map((vaultsShareClassArr) => Object.fromEntries(vaultsShareClassArr.map((vaults, index) => [scIds[index].raw, vaults]))));
        })));
    }
}
//# sourceMappingURL=PoolNetwork.js.map