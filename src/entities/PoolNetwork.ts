import { combineLatest, defer, map, of, switchMap, withLatestFrom } from 'rxjs'
import { encodeFunctionData, getContract } from 'viem'
import { ABI } from '../abi/index.js'
import type { Centrifuge } from '../Centrifuge.js'
import { NULL_ADDRESS } from '../constants.js'
import { HexString } from '../types/index.js'
import { MessageType } from '../types/transaction.js'
import { addressToBytes32 } from '../utils/index.js'
import { repeatOnEvents } from '../utils/rx.js'
import { wrapTransaction } from '../utils/transaction.js'
import { AssetId, ShareClassId } from '../utils/types.js'
import { BalanceSheet } from './BalanceSheet.js'
import { Entity } from './Entity.js'
import type { Pool } from './Pool.js'
import { ShareClass } from './ShareClass.js'

/**
 * Query and interact with a pool on a specific network.
 */
export class PoolNetwork extends Entity {
  /** @internal */
  constructor(
    _root: Centrifuge,
    public pool: Pool,
    public chainId: number
  ) {
    super(_root, ['poolnetwork', pool.id.toString(), chainId])
  }

  /**
   * Query the details of the pool on a network.
   * @returns The details, including whether the pool is active, whether any of the share classes have been deployed,
   * and any deployed vaults.
   */
  details() {
    return this._query(null, () =>
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
    return this._query(null, () =>
      of(new BalanceSheet(this._root, this, new ShareClass(this._root, this.pool, scId.raw)))
    )
  }

  /**
   * Get the details of the share token.
   * @param scId - The share class ID
   */
  shareCurrency(scId: ShareClassId) {
    return this._query(null, () =>
      this._share(scId).pipe(switchMap((share) => this._root.currency(share, this.chainId)))
    )
  }

  /**
   * Get the deployed Vaults for a given share class. There may exist one Vault for each allowed investment currency.
   * Vaults are used to submit/claim investments and redemptions.
   * @param scId - The share class ID
   */
  vaults(scId: ShareClassId) {
    return this._query(null, () =>
      this._root.pool(this.pool.id).pipe(
        switchMap((pool) => pool.shareClass(scId)),
        switchMap((shareClass) => shareClass.vaults(this.chainId))
      )
    )
  }

  /**
   * Get a specific Vault for a given share class and investment currency.
   * @param scId - The share class ID
   * @param asset - The investment currency address or asset ID
   */
  vault(scId: ShareClassId, asset: HexString | AssetId) {
    return this._query(null, () =>
      this.vaults(scId).pipe(
        withLatestFrom(
          typeof asset === 'string' ? of({ address: asset, tokenId: 0n }) : this._root._asset(asset, this.chainId)
        ),
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
      this._root._protocolAddresses(this.chainId).pipe(
        switchMap(({ spoke }) => {
          return defer(
            () =>
              this._root.getClient(this.chainId).readContract({
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
                abi: ABI.Spoke,
                eventName: 'AddPool',
                filter: (events) => {
                  return events.some((event) => {
                    return event.args.poolId === this.pool.id
                  })
                },
              },
              this.chainId
            )
          )
        })
      )
    )
  }

  /**
   * Enable and deploy share classes/vaults.
   * @param shareClasses - An array of share classes to enable
   * @param vaults - An array of vaults to deploy
   */
  deploy(
    shareClasses: { id: ShareClassId; hook: HexString }[] = [],
    vaults: { shareClassId: ShareClassId; assetId: AssetId; kind: 'async' | 'syncDeposit' }[] = []
  ) {
    const self = this
    return this._transact(async function* (ctx) {
      const [
        { hub },
        { balanceSheet, syncDepositVaultFactory, asyncVaultFactory, syncManager, asyncRequestManager },
        id,
        details,
      ] = await Promise.all([
        self._root._protocolAddresses(self.pool.chainId),
        self._root._protocolAddresses(self.chainId),
        self._root.id(self.chainId),
        self.details(),
      ])

      const balanceSheetContract = getContract({
        client: ctx.publicClient,
        address: balanceSheet,
        abi: ABI.BalanceSheet,
      })
      const [isAsyncManagerSet, isSyncManagerSet] = await Promise.all([
        balanceSheetContract.read.manager([self.pool.id.raw, asyncRequestManager]),
        balanceSheetContract.read.manager([self.pool.id.raw, syncManager]),
      ])

      const batch: HexString[] = []
      const messageTypes: MessageType[] = []

      // Set vault managers as balance sheet managers if not already set
      // Always set async manager, as it's used by both async and sync deposit vaults
      if (!isAsyncManagerSet) {
        batch.push(
          encodeFunctionData({
            abi: ABI.Hub,
            functionName: 'updateBalanceSheetManager',
            args: [id, self.pool.id.raw, addressToBytes32(asyncRequestManager), true],
          })
        )
        messageTypes.push(MessageType.UpdateBalanceSheetManager)
      }
      if (!isSyncManagerSet && vaults.some((v) => v.kind === 'syncDeposit')) {
        batch.push(
          encodeFunctionData({
            abi: ABI.Hub,
            functionName: 'updateBalanceSheetManager',
            args: [id, self.pool.id.raw, addressToBytes32(syncManager), true],
          })
        )
        messageTypes.push(MessageType.UpdateBalanceSheetManager)
      }

      if (!details.isActive) {
        batch.push(
          encodeFunctionData({
            abi: ABI.Hub,
            functionName: 'notifyPool',
            args: [self.pool.id.raw, id],
          })
        )
        messageTypes.push(MessageType.NotifyPool)
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
            args: [self.pool.id.raw, sc.id.raw, id, addressToBytes32(sc.hook)],
          })
        )
        messageTypes.push(MessageType.NotifyShareClass)
      }

      for (const vault of vaults) {
        if (!enabledShareClasses.has(vault.shareClassId.raw)) {
          throw new Error(`Share class "${vault.shareClassId.raw}" is not enabled in pool "${self.pool.id.raw}"`)
        }

        batch.push(
          // TODO: When we have fully sync vaults, we have to check if a vault for this share class and asset already exists
          // and if so, we shouldn't set the request manager again.
          // `setRequestManager` will revert if the share class / asset combination already has a vault.
          encodeFunctionData({
            abi: ABI.Hub,
            functionName: 'setRequestManager',
            args: [self.pool.id.raw, vault.shareClassId.raw, vault.assetId.raw, addressToBytes32(asyncRequestManager)],
          }),
          encodeFunctionData({
            abi: ABI.Hub,
            functionName: 'notifyAssetPrice',
            args: [self.pool.id.raw, vault.shareClassId.raw, vault.assetId.raw],
          }),
          encodeFunctionData({
            abi: ABI.Hub,
            functionName: 'updateVault',
            args: [
              self.pool.id.raw,
              vault.shareClassId.raw,
              vault.assetId.raw,
              addressToBytes32(vault.kind === 'syncDeposit' ? syncDepositVaultFactory : asyncVaultFactory),
              0, // VaultUpdateKind.DeployAndLink
              0n, // gas limit
            ],
          })
        )
        messageTypes.push(MessageType.SetRequestManager, MessageType.NotifyPricePoolPerAsset, MessageType.UpdateVault)
      }

      if (batch.length === 0) {
        throw new Error('No share classes / vaults to deploy')
      }

      yield* wrapTransaction('Deploy share classes and vaults', ctx, {
        data: batch,
        contract: hub,
        messages: { [id]: messageTypes },
      })
    }, this.pool.chainId)
  }

  /**
   * Get the contract address of the share token.
   * @internal
   */
  _share(scId: ShareClassId, throwOnNullAddress = true) {
    return this._query(['share', scId.toString()], () =>
      this._root._protocolAddresses(this.chainId).pipe(
        switchMap(({ spoke }) =>
          defer(async () => {
            try {
              const address = await this._root.getClient(this.chainId).readContract({
                address: spoke,
                abi: ABI.Spoke,
                functionName: 'shareToken',
                args: [this.pool.id.raw, scId.raw],
              })
              return address.toLowerCase() as HexString
            } catch {
              if (throwOnNullAddress) {
                throw new Error(`Share class ${scId} not found for pool ${this.pool.id} on chain ${this.chainId}`)
              }
              return NULL_ADDRESS
            }
          }).pipe(
            repeatOnEvents(
              this._root,
              {
                address: spoke,
                abi: ABI.Spoke,
                eventName: 'AddShareClass',
                filter: (events) => {
                  return events.some((event) => event.args.poolId === this.pool.id.raw && event.args.scId === scId.raw)
                },
              },
              this.chainId
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
    return this._query(null, () =>
      this.pool._shareClassIds().pipe(
        switchMap((scIds) => {
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
