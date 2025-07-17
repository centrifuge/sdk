import { catchError, combineLatest, defer, map, of, switchMap, timeout } from 'rxjs'
import { encodeFunctionData, fromHex, toHex } from 'viem'
import { ABI } from '../abi/index.js'
import type { Centrifuge } from '../Centrifuge.js'
import { HexString } from '../types/index.js'
import { PoolMetadata } from '../types/poolMetadata.js'
import { MessageType } from '../types/transaction.js'
import { NATIONAL_CURRENCY_METADATA } from '../utils/currencies.js'
import { addressToBytes32 } from '../utils/index.js'
import { repeatOnEvents } from '../utils/rx.js'
import { wrapTransaction } from '../utils/transaction.js'
import { AssetId, PoolId, ShareClassId } from '../utils/types.js'
import { Entity } from './Entity.js'
import { PoolNetwork } from './PoolNetwork.js'
import { Reports } from './Reports/index.js'
import { ShareClass } from './ShareClass.js'
export class Pool extends Entity {
  id: PoolId

  /** @internal */
  constructor(
    _root: Centrifuge,
    id: string | bigint | PoolId,
    public chainId: number
  ) {
    super(_root, ['pool', String(id)])
    this.id = id instanceof PoolId ? id : new PoolId(id)
  }

  get reports() {
    return new Reports(this._root, this)
  }

  /**
   * Query the details of the pool.
   * @returns The pool metadata, id, shareClasses and currency.
   */
  details() {
    return this._query(null, () =>
      combineLatest([this.metadata(), this.shareClasses(), this.shareClassesDetails(), this.currency()]).pipe(
        map(([metadata, shareClasses, shareClassesDetails, currency]) => {
          return {
            id: this.id,
            currency,
            metadata,
            shareClasses: shareClasses.map((sc) => ({
              shareClass: sc,
              details: shareClassesDetails.find((scDetails) => scDetails.id.equals(sc.id))!,
            })),
          }
        })
      )
    )
  }

  metadata() {
    return this._query(['metadata'], () =>
      this._root._protocolAddresses(this.chainId).pipe(
        switchMap(({ hubRegistry }) =>
          defer(() => {
            return this._root.getClient(this.chainId)!.readContract({
              address: hubRegistry,
              abi: ABI.HubRegistry,
              functionName: 'metadata',
              args: [this.id.raw],
            })
          }).pipe(
            switchMap((hash) => {
              return this._root._queryIPFS<PoolMetadata>(fromHex(hash, 'string'))
            }),
            catchError((error) => {
              console.error('Error fetching metadata', error)
              return of(null)
            }),
            repeatOnEvents(
              this._root,
              {
                address: hubRegistry,
                abi: ABI.HubRegistry,
                eventName: 'SetMetadata',
                filter: (events) => {
                  return events.some((event) => {
                    return event.args.poolId === this.id.raw
                  })
                },
              },
              this.chainId
            )
          )
        )
      )
    )
  }

  shareClasses() {
    return this._query(null, () =>
      this._shareClassIds().pipe(map((scIds) => scIds.map((scId) => new ShareClass(this._root, this, scId.raw))))
    )
  }

  shareClass(scId: ShareClassId) {
    return this._query(null, () =>
      this.shareClasses().pipe(
        map((shareClasses) => {
          const shareClass = shareClasses.find((sc) => sc.id.equals(scId))
          if (!shareClass) throw new Error(`Share class ${scId} not found`)
          return shareClass
        })
      )
    )
  }

  shareClassesDetails() {
    return this._query(null, () => {
      return this.shareClasses().pipe(
        switchMap((shareClasses) => {
          if (shareClasses.length === 0) return of([])
          return combineLatest(shareClasses.map((sc) => sc.details()))
        })
      )
    })
  }

  /**
   * Check if an address is a manager of the pool.
   * @param address - The address to check
   */
  isPoolManager(address: HexString) {
    return this._query(['isManager', address.toLowerCase()], () => {
      return this._root._protocolAddresses(this.chainId).pipe(
        switchMap(({ hubRegistry }) => {
          return this._root.getClient(this.chainId)!.readContract({
            address: hubRegistry,
            abi: ABI.HubRegistry,
            functionName: 'manager',
            args: [this.id.raw, address],
          })
        })
      )
    })
  }

  /**
   * Check if an address is a Balance Sheet manager of the pool.
   * @param chainId - The chain ID of the Spoke to check
   * @param address - The address to check
   */
  isBalanceSheetManager(chainId: number, address: HexString) {
    return this._query(['isBSManager', chainId, address.toLowerCase()], () => {
      return this._root._protocolAddresses(chainId).pipe(
        switchMap(({ balanceSheet }) => {
          return this._root.getClient(chainId)!.readContract({
            address: balanceSheet,
            abi: ABI.BalanceSheet,
            functionName: 'manager',
            args: [this.id.raw, address],
          })
        })
      )
    })
  }

  /**
   * Get all networks where a pool can potentially be deployed.
   */
  networks() {
    return this._query(null, () => {
      return of(
        this._root.chains.map((chainId) => {
          return new PoolNetwork(this._root, this, chainId)
        })
      )
    })
  }

  /**
   * Get a specific network where a pool can potentially be deployed.
   */
  network(chainId: number) {
    return this._query(null, () => {
      return this.networks().pipe(
        map((networks) => {
          const network = networks.find((network) => network.chainId === chainId)
          if (!network) throw new Error(`Network ${chainId} not found`)
          return network
        })
      )
    })
  }

  /**
   * Get the networks where a pool is active. It doesn't mean that any vaults are deployed there necessarily.
   */
  activeNetworks() {
    return this._query(null, () => {
      return this.networks().pipe(
        switchMap((networks) => {
          return combineLatest(
            networks.map((network) =>
              network.isActive().pipe(
                // Because this is fetching from multiple networks and we're waiting on all of them before returning a value,
                // we want a timeout in case one of the endpoints is too slow
                timeout({ first: 5000 }),
                catchError(() => {
                  return of(false)
                })
              )
            )
          ).pipe(map((isActive) => networks.filter((_, index) => isActive[index])))
        })
      )
    })
  }

  vault(chainId: number, scId: ShareClassId, asset: HexString) {
    return this._query(null, () => this.network(chainId).pipe(switchMap((network) => network.vault(scId, asset))))
  }

  /**
   * Get the currency of the pool.
   */
  currency() {
    return this._query(['currency'], () => {
      return this._root._protocolAddresses(this.chainId).pipe(
        switchMap(({ hubRegistry }) => {
          return this._root.getClient(this.chainId)!.readContract({
            address: hubRegistry,
            abi: ABI.HubRegistry,
            functionName: 'currency',
            args: [this.id.raw],
          })
        }),
        map((rawCurrency: bigint) => {
          const assetId = new AssetId(rawCurrency)
          const countryCode = assetId.nationalCurrencyCode

          if (!countryCode) {
            throw new Error(`No currency found`)
          }

          const currency = NATIONAL_CURRENCY_METADATA[countryCode]

          if (!currency) {
            throw new Error(`No currency found for country code ${countryCode}`)
          }

          return {
            name: currency.name,
            symbol: currency.symbol,
            decimals: 18,
            id: assetId,
          }
        })
      )
    })
  }

  updateMetadata(metadata: PoolMetadata) {
    const self = this
    return this._transact(async function* (ctx) {
      const cid = await self._root.config.pinJson(metadata)

      const { hub } = await self._root._protocolAddresses(self.chainId)
      yield* wrapTransaction('Update metadata', ctx, {
        contract: hub,
        data: encodeFunctionData({
          abi: ABI.Hub,
          functionName: 'setPoolMetadata',
          args: [self.id.raw, toHex(cid)],
        }),
      })
    }, this.chainId)
  }

  /**
   * Update pool managers.
   */
  updatePoolManagers(updates: { address: HexString; canManage: boolean }[]) {
    const self = this
    return this._transact(async function* (ctx) {
      const { hub } = await self._root._protocolAddresses(self.chainId)

      // Ensure that updating the signer's address is always last in the batch,
      // to prevent removing the signer from the list of managers, before having added others,
      // which would cause the other updates to fail.
      const selfUpdateIndex = updates.findIndex((u) => u.address.toLowerCase() === ctx.signingAddress.toLowerCase())
      const selfUpdate = updates.splice(selfUpdateIndex >>> 0, 1)
      updates.push(...selfUpdate)

      const batch = updates.map(({ address, canManage }) =>
        encodeFunctionData({
          abi: ABI.Hub,
          functionName: 'updateHubManager',
          args: [self.id.raw, address, canManage],
        })
      )

      yield* wrapTransaction('Update pool managers', ctx, {
        contract: hub,
        data: batch,
      })
    }, this.chainId)
  }

  /**
   * Update balance sheet managers.
   */
  updateBalanceSheetManagers(updates: { chainId: number; address: HexString; canManage: boolean }[]) {
    const self = this
    return this._transact(async function* (ctx) {
      const [{ hub }, centIds] = await Promise.all([
        self._root._protocolAddresses(self.chainId),
        Promise.all(updates.map(({ chainId }) => self._root.id(chainId))),
      ])
      const batch = updates.map(({ address, canManage }, i) =>
        encodeFunctionData({
          abi: ABI.Hub,
          functionName: 'updateBalanceSheetManager',
          args: [centIds[i]!, self.id.raw, addressToBytes32(address), canManage],
        })
      )
      const messages: Record<number, MessageType[]> = {}
      updates.forEach((_, i) => {
        const centId = centIds[i]!
        if (!messages[centId]) messages[centId] = []
        messages[centId].push(MessageType.UpdateBalanceSheetManager)
      })

      yield* wrapTransaction('Update balance sheet managers', ctx, {
        contract: hub,
        data: batch,
        messages,
      })
    }, this.chainId)
  }

  createAccounts(accounts: { accountId: number; isDebitNormal: boolean }[]) {
    const self = this
    return this._transact(async function* (ctx) {
      const { hub } = await self._root._protocolAddresses(self.chainId)
      const txBatch = accounts.map(({ accountId, isDebitNormal }) =>
        encodeFunctionData({
          abi: ABI.Hub,
          functionName: 'createAccount',
          args: [self.id.raw, accountId, isDebitNormal],
        })
      )

      yield* wrapTransaction('Create accounts', ctx, {
        contract: hub,
        data: txBatch,
      })
    }, this.chainId)
  }

  /**
   * @internal
   */
  _shareClassIds() {
    return this._query(['shareClasses'], () =>
      this._root._protocolAddresses(this.chainId).pipe(
        switchMap(({ shareClassManager }) =>
          defer(async () => {
            const count = await this._root.getClient(this.chainId)!.readContract({
              address: shareClassManager,
              abi: ABI.ShareClassManager,
              functionName: 'shareClassCount',
              args: [this.id.raw],
            })
            return Array.from({ length: count }, (_, i) => ShareClassId.from(this.id, i + 1))
          })
        )
      )
    )
  }
}
