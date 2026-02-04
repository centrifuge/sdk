import { combineLatest, defer, EMPTY, firstValueFrom, map, of, switchMap } from 'rxjs'
import { encodeFunctionData, getContract, maxUint128 } from 'viem'
import { ABI } from '../abi/index.js'
import type { Centrifuge } from '../Centrifuge.js'
import { NULL_ADDRESS } from '../constants.js'
import { HexString } from '../types/index.js'
import { MessageType, MessageTypeWithSubType, VaultUpdateKind } from '../types/transaction.js'
import { addressToBytes32, encode } from '../utils/index.js'
import { repeatOnEvents } from '../utils/rx.js'
import { doTransaction, parseEventLogs, wrapTransaction } from '../utils/transaction.js'
import { AssetId, CentrifugeId, ShareClassId } from '../utils/types.js'
import { BalanceSheet } from './BalanceSheet.js'
import { Entity } from './Entity.js'
import { MerkleProofManager } from './MerkleProofManager.js'
import { OnOffRampManager } from './OnOffRampManager.js'
import type { Pool } from './Pool.js'
import { ShareClass } from './ShareClass.js'

export enum VaultManagerTrustedCall {
  Valuation,
  MaxReserve,
}

/**
 * Query and interact with a pool on a specific network.
 */
export class PoolNetwork extends Entity {
  /** @internal */
  constructor(
    _root: Centrifuge,
    public pool: Pool,
    public centrifugeId: CentrifugeId
  ) {
    super(_root, ['poolnetwork', pool.id.toString(), centrifugeId])
  }

  /**
   * Query the details of the pool on a network.
   * @returns The details, including whether the pool is active, whether any of the share classes have been deployed,
   * and any deployed vaults.
   */
  details() {
    return this._query(['poolNetworkDetails'], () =>
      this.pool.shareClasses().pipe(
        switchMap((shareClasses) => {
          return combineLatest([
            this.isActive(),
            this._vaultsByShareClass(),
            ...shareClasses.map((sc) => this._share(sc.id, false)),
          ]).pipe(
            map(([isActive, vaultsByShareClass, ...shareTokens]) => {
              return {
                isActive,
                activeShareClasses: shareClasses
                  .filter((_, i) => shareTokens[i] !== NULL_ADDRESS)
                  .map((sc, i) => {
                    return {
                      shareClass: sc,
                      id: sc.id,
                      shareToken: shareTokens[i]!,
                      vaults: vaultsByShareClass[sc.id.raw] ?? [],
                    }
                  }),
              }
            })
          )
        })
      )
    )
  }

  balanceSheet(scId: ShareClassId) {
    return this._query(['balanceSheet', scId.toString()], () =>
      of(new BalanceSheet(this._root, this, new ShareClass(this._root, this.pool, scId.raw)))
    )
  }

  /**
   * Get the details of the share token.
   * @param scId - The share class ID
   */
  shareCurrency(scId: ShareClassId) {
    return this._query(['shareCurrency', scId.toString()], () =>
      this._share(scId).pipe(switchMap((share) => this._root.currency(share, this.centrifugeId)))
    )
  }

  /**
   * Get the deployed Vaults for a given share class. There may exist one Vault for each allowed investment currency.
   * Vaults are used to submit/claim investments and redemptions.
   * @param scId - The share class ID
   * @param includeUnlinked - Whether to include unlinked vaults
   */
  vaults(scId: ShareClassId, includeUnlinked = false) {
    return this._query(['vaults', scId.toString(), includeUnlinked.toString()], () =>
      this._root.pool(this.pool.id).pipe(
        switchMap((pool) => pool.shareClass(scId)),
        switchMap((shareClass) => shareClass.vaults(this.centrifugeId, includeUnlinked))
      )
    )
  }

  /**
   * Get a specific Vault for a given share class and investment currency.
   * @param scId - The share class ID
   * @param asset - The investment currency address or asset ID
   */
  vault(scId: ShareClassId, asset: HexString | AssetId) {
    return this._query(['vault', scId.toString(), asset.toString()], () =>
      combineLatest([
        this.vaults(scId),
        typeof asset === 'string' ? of({ address: asset, tokenId: 0n }) : this._root.assetCurrency(asset),
      ]).pipe(
        map(([vaults, { address }]) => {
          const addr = address.toLowerCase()
          const vault = vaults.find((v) => v._asset === addr)
          if (!vault) throw new Error('Vault not found')
          return vault
        })
      )
    )
  }

  /**
   * Get whether the pool is active on this network. It's a prerequisite for deploying vaults,
   * and doesn't indicate whether any vaults have been deployed.
   */
  isActive() {
    return this._query(['isActive'], () =>
      combineLatest([this._root._protocolAddresses(this.centrifugeId), this._root.getClient(this.centrifugeId)]).pipe(
        switchMap(([{ spoke }, client]) => {
          return defer(
            () =>
              client.readContract({
                address: spoke,
                abi: ABI.Spoke,
                functionName: 'isPoolActive',
                args: [this.pool.id.raw],
              }) as Promise<boolean>
          ).pipe(
            repeatOnEvents(
              this._root,
              {
                address: spoke,
                eventName: 'AddPool',
                filter: (events) => {
                  return events.some((event) => {
                    return event.args.poolId === this.pool.id
                  })
                },
              },
              this.centrifugeId
            )
          )
        })
      )
    )
  }

  merkleProofManager() {
    return this._query(['merkleProofManager'], () =>
      this._root._queryIndexer(
        `query ($poolId: BigInt!, $centrifugeId: String!) {
          merkleProofManagers(where: {poolId: $poolId, centrifugeId: $centrifugeId}) {
            items {
              address
            }
          }
        }`,
        { poolId: this.pool.id.toString(), centrifugeId: this.centrifugeId.toString() },
        (data: {
          merkleProofManagers: {
            items: {
              address: HexString
            }[]
          }
        }) => {
          const manager = data.merkleProofManagers.items[0]

          if (!manager) {
            throw new Error('MerkleProofManager not found')
          }

          return new MerkleProofManager(this._root, this, manager.address)
        }
      )
    )
  }

  /**
   * Deploy a Merkle Proof Manager.
   */
  deployMerkleProofManager() {
    const self = this

    return this._transact(async function* (ctx) {
      const { merkleProofManagerFactory } = await self._root._protocolAddresses(self.centrifugeId)

      yield* doTransaction('AddMerkleProofManager', ctx, () =>
        ctx.walletClient.writeContract({
          address: merkleProofManagerFactory,
          abi: ABI.MerkleProofManagerFactory,
          functionName: 'newManager',
          args: [self.pool.id.raw],
        })
      )
    }, self.centrifugeId)
  }

  /**
   * Get the OnOffRampManager for a given share class.
   * @param scId - The share class ID
   * @returns The OnOffRampManager
   */
  onOfframpManager(scId: ShareClassId) {
    return this._query(null, () =>
      combineLatest([
        this._root._queryIndexer(
          `query ($scId: String!, $centrifugeId: String!) {
            onOffRampManagers(where: {tokenId: $scId, centrifugeId: $centrifugeId}) {
              items {
                address
              }
            }
          }`,
          {
            scId: scId.toString(),
            centrifugeId: this.centrifugeId.toString(),
          },
          (data: {
            onOffRampManagers: {
              items: {
                address: HexString
              }[]
            }
          }) => data.onOffRampManagers.items
        ),
        this.pool.balanceSheetManagers(),
      ]).pipe(
        map(([deployedOnOffRampManagers, balanceSheetManagers]) => {
          if (!deployedOnOffRampManagers.length) {
            throw new Error('OnOffRampManager not found')
          }

          const bsManagerAddresses = new Set(balanceSheetManagers.map((m) => m.address.toLowerCase()))
          const verifiedManagers = deployedOnOffRampManagers.filter((deployed) =>
            bsManagerAddresses.has(deployed.address.toLowerCase())
          )

          if (!verifiedManagers.length) {
            throw new Error('OnOffRampManager not found in balance sheet managers')
          }

          // Use the last verified manager (most recent deployment)
          const verifiedManager = verifiedManagers[verifiedManagers.length - 1]!

          return new OnOffRampManager(
            this._root,
            this,
            new ShareClass(this._root, this.pool, scId.raw),
            verifiedManager.address
          )
        })
      )
    )
  }

  /**
   * Get all OnOffRampManagers for a given share class and assign balance sheet manager permissions.
   * @param scId - The share class ID
   */
  assignOnOffRampManagerPermissions(scId: ShareClassId) {
    const self = this
    return this._transact(() => {
      return combineLatest([
        this._root._queryIndexer(
          `query ($scId: String!, $centrifugeId: String!) {
            onOffRampManagers(where: {tokenId: $scId, centrifugeId: $centrifugeId}) {
              items {
                address
              }
            }
          }`,
          {
            scId: scId.toString(),
            centrifugeId: this.centrifugeId.toString(),
          },
          (data: {
            onOffRampManagers: {
              items: {
                address: HexString
              }[]
            }
          }) => data.onOffRampManagers.items
        ),
        this.pool.balanceSheetManagers(),
      ]).pipe(
        switchMap(([deployedOnOffRampManager, balanceSheetManagers]) => {
          const bsManagers = new Map<string, { address: `0x${string}`; centrifugeId: number; type: string }>()
          balanceSheetManagers.forEach((manager) => {
            bsManagers.set(manager.address.toLowerCase(), manager)
          })

          const onOffRampManagers = deployedOnOffRampManager
            .filter((onOffRampManager) => {
              return bsManagers.has(onOffRampManager.address.toLowerCase()) === false
            })
            .map((onOffRampManager) => ({
              centrifugeId: self.centrifugeId,
              address: onOffRampManager.address,
              canManage: true,
            }))

          if (onOffRampManagers.length === 0) {
            return EMPTY
          }

          return this.pool.updateBalanceSheetManagers(onOffRampManagers)
        })
      )
    }, this.centrifugeId)
  }

  /**
   * Deploy an On/Off Ramp Manager for a share class.
   * Yields the deployed manager address as a custom 'DeployedOnOfframpManager' status.
   * @param scId - The share class ID
   */
  deployOnOfframpManager(scId: ShareClassId) {
    const self = this

    return this._transact(async function* (ctx) {
      const { onOfframpManagerFactory } = await self._root._protocolAddresses(self.centrifugeId)

      const result = yield* doTransaction('DeployOnOfframpManager', ctx, () =>
        ctx.walletClient.writeContract({
          address: onOfframpManagerFactory,
          abi: ABI.OnOffRampManagerFactory,
          functionName: 'newManager',
          args: [self.pool.id.raw, scId.raw],
        })
      )

      const events = parseEventLogs({
        logs: result.receipt.logs,
        eventName: 'DeployOnOfframpManager',
        address: onOfframpManagerFactory,
      })

      const deployEvent = events[0]
      const args = deployEvent?.args as { manager?: HexString } | undefined
      if (!args?.manager) {
        throw new Error('DeployOnOfframpManager event not found')
      }

      const managerAddress = args.manager

      yield {
        type: 'DeployedOnOfframpManager',
        address: managerAddress,
      } as const
    }, self.centrifugeId)
  }

  /**
   * Register an On/Off Ramp Manager as a Balance Sheet Manager.
   * Use this with the address obtained from deployOnOfframpManager().
   * @param managerAddress - The deployed manager's contract address
   */
  registerOnOffRampManagerAsBSManager(managerAddress: HexString) {
    return this.pool.updateBalanceSheetManagers([
      {
        centrifugeId: this.centrifugeId,
        address: managerAddress,
        canManage: true,
      },
    ])
  }

  /**
   * Enable share classes on this network.
   * @param shareClasses - An array of share classes to enable
   */
  deployShareClasses(shareClasses: { id: ShareClassId; hook: HexString }[]) {
    return this.deploy(shareClasses, [])
  }

  /**
   * Deploy vaults for share classes that are already enabled on this network.
   * @param vaults - An array of vaults to deploy
   */
  deployVaults(
    vaults: {
      shareClassId: ShareClassId
      assetId: AssetId
      kind: 'async' | 'syncDeposit'
      factory?: HexString
    }[]
  ) {
    return this.deploy([], vaults)
  }

  /**
   * Enable and deploy share classes/vaults.
   * @param shareClasses - An array of share classes to enable
   * @param vaults - An array of vaults to deploy
   */
  deploy(
    shareClasses: { id: ShareClassId; hook: HexString }[],
    vaults: {
      shareClassId: ShareClassId
      assetId: AssetId
      kind: 'async' | 'syncDeposit'
      factory?: HexString
    }[]
  ) {
    const self = this
    return this._transact(async function* (ctx) {
      const [
        {
          hub,
          layerZeroAdapter: localLzAdapter,
          axelarAdapter: localAxelarAdapter,
          // wormholeAdapter: localWhAdapter
        },
        {
          spoke,
          balanceSheet,
          syncDepositVaultFactory,
          asyncVaultFactory,
          syncManager,
          asyncRequestManager,
          batchRequestManager,
          layerZeroAdapter: remoteLzAdapter,
          axelarAdapter: remoteAxelarAdapter,
          // wormholeAdapter: remoteWhAdapter,
        },
        details,
        spokeClient,
      ] = await Promise.all([
        self._root._protocolAddresses(self.pool.centrifugeId),
        self._root._protocolAddresses(self.centrifugeId),
        self.details(),
        self._root.getClient(self.centrifugeId),
      ])
      const balanceSheetContract = getContract({
        client: spokeClient,
        address: balanceSheet,
        abi: ABI.BalanceSheet,
      })
      const [isAsyncManagerSetOnBalanceSheet, isSyncManagerSetOnBalanceSheet, existingRequestManager] =
        await Promise.all([
          balanceSheetContract.read.manager([self.pool.id.raw, asyncRequestManager]),
          balanceSheetContract.read.manager([self.pool.id.raw, syncManager]),
          spokeClient.readContract({
            address: spoke,
            abi: ABI.Spoke,
            functionName: 'requestManager',
            args: [self.pool.id.raw],
          }),
        ])

      const batch: HexString[] = []
      const messageTypes: (MessageType | MessageTypeWithSubType)[] = []

      // setAdapters must be called first, because all other messages are pool-dependent
      // and require the pool to have adapters set
      if (details.activeShareClasses.length === 0 && self.pool.centrifugeId !== self.centrifugeId) {
        const localAdapters: HexString[] = []
        const remoteAdapters: HexString[] = []

        // Default adapters: LayerZero and Axelar (2/2 required)
        if (localLzAdapter && remoteLzAdapter) {
          localAdapters.push(localLzAdapter)
          remoteAdapters.push(remoteLzAdapter)
        }
        if (localAxelarAdapter && remoteAxelarAdapter) {
          localAdapters.push(localAxelarAdapter)
          remoteAdapters.push(remoteAxelarAdapter)
        }
        // TODO: Temporarily disabled Wormhole adapter for testing - Wormhole costs much more than LayerZero
        // and the SDK estimate uses GLOBAL_POOL which may only have LayerZero configured
        // if (localWhAdapter && remoteWhAdapter) {
        //   localAdapters.push(localWhAdapter)
        //   remoteAdapters.push(remoteWhAdapter)
        // }
        if (localAdapters.length > 0) {
          batch.push(
            encodeFunctionData({
              abi: ABI.Hub,
              functionName: 'setAdapters',
              args: [
                self.pool.id.raw,
                self.centrifugeId,
                localAdapters,
                remoteAdapters.map(addressToBytes32),
                localAdapters.length, // threshold
                localAdapters.length, // recovery index
                ctx.signingAddress,
              ],
            })
          )
          messageTypes.push(MessageType.SetPoolAdapters)
        }
      }

      // notifyPool must come before the other pool-related messages, because they depend on the pool being active
      if (!details.isActive) {
        batch.push(
          encodeFunctionData({
            abi: ABI.Hub,
            functionName: 'notifyPool',
            args: [self.pool.id.raw, self.centrifugeId, ctx.signingAddress],
          })
        )
        messageTypes.push(MessageType.NotifyPool)
      }

      // Set vault managers as balance sheet managers if not already set
      // Async manager is used by both async and sync deposit vaults, so set it when deploying any vault
      if (!isAsyncManagerSetOnBalanceSheet && vaults.length > 0) {
        batch.push(
          encodeFunctionData({
            abi: ABI.Hub,
            functionName: 'updateBalanceSheetManager',
            args: [
              self.pool.id.raw,
              self.centrifugeId,
              addressToBytes32(asyncRequestManager),
              true,
              ctx.signingAddress,
            ],
          })
        )
        messageTypes.push(MessageType.UpdateBalanceSheetManager)
      }
      if (!isSyncManagerSetOnBalanceSheet && vaults.some((v) => v.kind === 'syncDeposit')) {
        batch.push(
          encodeFunctionData({
            abi: ABI.Hub,
            functionName: 'updateBalanceSheetManager',
            args: [self.pool.id.raw, self.centrifugeId, addressToBytes32(syncManager), true, ctx.signingAddress],
          })
        )
        messageTypes.push(MessageType.UpdateBalanceSheetManager)
      }

      if (existingRequestManager === NULL_ADDRESS) {
        batch.push(
          encodeFunctionData({
            abi: ABI.Hub,
            functionName: 'setRequestManager',
            args: [
              self.pool.id.raw,
              self.centrifugeId,
              batchRequestManager,
              addressToBytes32(asyncRequestManager),
              ctx.signingAddress,
            ],
          })
        )
        messageTypes.push(MessageType.SetRequestManager)
      }

      const enabledShareClasses = new Set(details.activeShareClasses.map((sc) => sc.id.raw))

      for (const sc of shareClasses) {
        if (details.activeShareClasses.some((activeSc) => activeSc.id.equals(sc.id.raw))) {
          console.warn(`Share class "${sc.id}" is already active in pool "${self.pool.id}"`)
          continue
        }

        enabledShareClasses.add(sc.id.raw)
        batch.push(
          encodeFunctionData({
            abi: ABI.Hub,
            functionName: 'notifyShareClass',
            args: [self.pool.id.raw, sc.id.raw, self.centrifugeId, addressToBytes32(sc.hook), ctx.signingAddress],
          })
        )
        messageTypes.push(MessageType.NotifyShareClass)
      }

      for (const vault of vaults) {
        if (!enabledShareClasses.has(vault.shareClassId.raw)) {
          throw new Error(`Share class "${vault.shareClassId.raw}" is not enabled in pool "${self.pool.id.raw}"`)
        }

        const factoryAddress = vault.factory
          ? vault.factory
          : vault.kind === 'syncDeposit'
            ? syncDepositVaultFactory
            : asyncVaultFactory

        if (vault.kind === 'syncDeposit') {
          batch.push(
            encodeFunctionData({
              abi: ABI.Hub,
              functionName: 'updateContract',
              args: [
                self.pool.id.raw,
                vault.shareClassId.raw,
                self.centrifugeId,
                addressToBytes32(syncManager),
                encode([VaultManagerTrustedCall.MaxReserve, vault.assetId.raw, maxUint128]),
                0n,
                ctx.signingAddress,
              ],
            })
          )
        }

        batch.push(
          encodeFunctionData({
            abi: ABI.Hub,
            functionName: 'notifyAssetPrice',
            args: [self.pool.id.raw, vault.shareClassId.raw, vault.assetId.raw, ctx.signingAddress],
          }),
          encodeFunctionData({
            abi: ABI.Hub,
            functionName: 'updateVault',
            args: [
              self.pool.id.raw,
              vault.shareClassId.raw,
              vault.assetId.raw,
              addressToBytes32(factoryAddress),
              VaultUpdateKind.DeployAndLink,
              0n, // gas limit
              ctx.signingAddress,
            ],
          })
        )
        messageTypes.push(MessageType.NotifyPricePoolPerAsset, {
          type: MessageType.UpdateVault,
          subtype: VaultUpdateKind.DeployAndLink,
        })
      }

      if (batch.length === 0) {
        throw new Error('No share classes / vaults to deploy')
      }

      yield* wrapTransaction('Deploy share classes and vaults', ctx, {
        data: batch,
        contract: hub,
        messages: { [self.centrifugeId]: messageTypes },
      })
    }, this.pool.centrifugeId)
  }

  /**
   * Unlink vaults.
   * @param vaults - An array of vaults to unlink
   */
  unlinkVaults(vaults: { shareClassId: ShareClassId; assetId: AssetId; address: HexString }[]) {
    const self = this
    return this._transact(async function* (ctx) {
      if (vaults.length === 0) {
        throw new Error('No vaults to unlink')
      }

      const [{ hub }, details] = await Promise.all([
        self._root._protocolAddresses(self.pool.centrifugeId),
        self.details(),
      ])

      const batch: HexString[] = []
      const messageTypes: MessageTypeWithSubType[] = []

      for (const vault of vaults) {
        const shareClass = details.activeShareClasses.find((sc) => sc.id.equals(vault.shareClassId))

        if (!shareClass) {
          throw new Error(`Share class "${vault.shareClassId.raw}" not found`)
        }

        const existingVault = shareClass.vaults.find((v) => v.address.toLowerCase() === vault.address.toLowerCase())

        if (!existingVault) {
          throw new Error(`Vault with address "${vault.address}" not found for share class "${vault.shareClassId.raw}"`)
        }

        batch.push(
          encodeFunctionData({
            abi: ABI.Hub,
            functionName: 'updateVault',
            args: [
              self.pool.id.raw,
              vault.shareClassId.raw,
              vault.assetId.raw,
              addressToBytes32(vault.address),
              VaultUpdateKind.Unlink,
              0n, // gas limit
              ctx.signingAddress,
            ],
          })
        )
        messageTypes.push({ type: MessageType.UpdateVault, subtype: VaultUpdateKind.Unlink })
      }

      yield* wrapTransaction('Unlink vaults', ctx, {
        data: batch,
        contract: hub,
        messages: { [self.centrifugeId]: messageTypes },
      })
    }, this.pool.centrifugeId)
  }

  /**
   * Link vaults that are already deployed but currently unlinked.
   * @param vaults - An array of vaults to link.
   */
  linkVaults(vaults: { shareClassId: ShareClassId; assetId: AssetId; address: HexString }[]) {
    const self = this
    return this._transact(async function* (ctx) {
      if (vaults.length === 0) {
        throw new Error('No vaults to link')
      }

      const [{ hub }, details] = await Promise.all([
        self._root._protocolAddresses(self.pool.centrifugeId),
        self.details(),
      ])

      const shareClassIds = [...new Set(vaults.map((v) => v.shareClassId.raw))]
      const vaultsWithUnlinked = await Promise.all(
        shareClassIds.map((scId) => {
          const shareClass = vaults.find((v) => v.shareClassId.raw === scId)
          const shareClassId = shareClass ? shareClass.shareClassId : null
          return shareClassId ? firstValueFrom(self.vaults(shareClassId, true)) : null
        })
      )
      const vaultsByShareClass = Object.fromEntries(shareClassIds.map((scId, i) => [scId, vaultsWithUnlinked[i] ?? []]))

      const batch: HexString[] = []
      const messageTypes: MessageTypeWithSubType[] = []

      for (const vault of vaults) {
        const shareClass = details.activeShareClasses.find((sc) => sc.id.equals(vault.shareClassId))

        if (!shareClass) {
          throw new Error(`Share class "${vault.shareClassId.raw}" not found`)
        }

        const allVaultsForShareClass = vaultsByShareClass[vault.shareClassId.raw] ?? []
        const existingVault = allVaultsForShareClass.find(
          (v) => v.address.toLowerCase() === vault.address.toLowerCase()
        )

        if (!existingVault) {
          throw new Error(
            `Vault with address "${vault.address}" not found for share class "${vault.shareClassId.raw}". The vault must be deployed before it can be linked.`
          )
        }

        batch.push(
          encodeFunctionData({
            abi: ABI.Hub,
            functionName: 'updateVault',
            args: [
              self.pool.id.raw,
              vault.shareClassId.raw,
              vault.assetId.raw,
              addressToBytes32(existingVault.address),
              VaultUpdateKind.Link,
              0n, // gas limit
              ctx.signingAddress,
            ],
          })
        )
        messageTypes.push({ type: MessageType.UpdateVault, subtype: VaultUpdateKind.Link })
      }

      yield* wrapTransaction('Link vaults', ctx, {
        data: batch,
        contract: hub,
        messages: { [self.centrifugeId]: messageTypes },
      })
    }, this.pool.centrifugeId)
  }

  /**
   * Get the contract address of the share token.
   * @internal
   */
  _share(scId: ShareClassId, throwOnNullAddress = true) {
    return this._query(['share', scId.toString(), throwOnNullAddress], () =>
      combineLatest([this._root._protocolAddresses(this.centrifugeId), this._root.getClient(this.centrifugeId)]).pipe(
        switchMap(([{ spoke }, client]) =>
          defer(async () => {
            try {
              const address = await client.readContract({
                address: spoke,
                abi: ABI.Spoke,
                functionName: 'shareToken',
                args: [this.pool.id.raw, scId.raw],
              })
              return address.toLowerCase() as HexString
            } catch {
              if (throwOnNullAddress) {
                throw new Error(
                  `Share class ${scId} not found for pool ${this.pool.id} on centrifuge network ${this.centrifugeId}`
                )
              }
              return NULL_ADDRESS
            }
          }).pipe(
            repeatOnEvents(
              this._root,
              {
                address: spoke,
                eventName: 'AddShareClass',
                filter: (events) => {
                  return events.some((event) => event.args.poolId === this.pool.id.raw && event.args.scId === scId.raw)
                },
              },
              this.centrifugeId
            )
          )
        )
      )
    )
  }

  /**
   * Get all Vaults for all share classes in the pool.
   * @returns An object of share class ID to Vault.
   * @internal
   */
  _vaultsByShareClass() {
    return this._query(['vaultsByShareClass'], () =>
      this.pool._shareClassIds().pipe(
        switchMap((scIds) => {
          if (scIds.length === 0) throw new Error('No share classes found')

          return combineLatest(scIds.map((scId) => this.vaults(scId))).pipe(
            map((vaultsShareClassArr) =>
              Object.fromEntries(vaultsShareClassArr.map((vaults, index) => [scIds[index]!.raw, vaults]))
            )
          )
        })
      )
    )
  }
}
