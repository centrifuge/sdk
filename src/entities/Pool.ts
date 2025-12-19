import { catchError, combineLatest, defer, map, of, switchMap, timeout } from 'rxjs'
import { encodeFunctionData, fromHex, toHex } from 'viem'
import { ABI } from '../abi/index.js'
import type { Centrifuge } from '../Centrifuge.js'
import { HexString } from '../types/index.js'
import { PoolMetadataInput, ShareClassInput } from '../types/poolInput.js'
import { PoolMetadata } from '../types/poolMetadata.js'
import { MessageType } from '../types/transaction.js'
import { NATIONAL_CURRENCY_METADATA } from '../utils/currencies.js'
import { addressToBytes32, randomUint } from '../utils/index.js'
import { repeatOnEvents } from '../utils/rx.js'
import { wrapTransaction } from '../utils/transaction.js'
import { AssetId, CentrifugeId, PoolId, ShareClassId } from '../utils/types.js'
import { Entity } from './Entity.js'
import { PoolNetwork } from './PoolNetwork.js'
import { PoolReports } from './Reports/PoolReports.js'
import { ShareClass } from './ShareClass.js'
export class Pool extends Entity {
  id: PoolId

  /** @internal */
  constructor(_root: Centrifuge, id: string | bigint | PoolId) {
    super(_root, ['pool', String(id)])
    this.id = id instanceof PoolId ? id : new PoolId(id)
  }

  get centrifugeId(): CentrifugeId {
    return this.id.centrifugeId
  }

  get reports() {
    return new PoolReports(this._root, this)
  }

  /**
   * Query the details of the pool.
   * @returns The pool metadata, id, shareClasses and currency.
   */
  details() {
    return this._query(['poolDetails', this.id.toString()], () =>
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
    return this._query(['metadata', this.id.toString()], () =>
      combineLatest([this._root._protocolAddresses(this.centrifugeId), this._root.getClient(this.centrifugeId)]).pipe(
        switchMap(([{ hubRegistry }, client]) =>
          defer(() => {
            return client.readContract({
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
                eventName: 'SetMetadata',
                filter: (events) => {
                  return events.some((event) => {
                    return event.args.poolId === this.id.raw
                  })
                },
              },
              this.centrifugeId
            )
          )
        )
      )
    )
  }

  shareClasses() {
    return this._query(['shareClasses'], () =>
      this._shareClassIds().pipe(map((scIds) => scIds.map((scId) => new ShareClass(this._root, this, scId.raw))))
    )
  }

  shareClass(scId: ShareClassId) {
    return this._query(['shareClass', scId.toString()], () =>
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
    return this._query(['shareClassesDetails', this.id.toString()], () => {
      return this.shareClasses().pipe(
        switchMap((shareClasses) => {
          if (shareClasses.length === 0) return of([])
          return combineLatest(shareClasses.map((sc) => sc.details()))
        })
      )
    })
  }

  /**
   * Get the managers on the Hub.
   * These managers that can manage the pool, approve deposits, update prices, etc.
   */
  poolManagers() {
    return this._query(['poolManagers', this.id.toString()], () => {
      return this._managers().pipe(
        map((managers) => {
          return managers
            .filter((manager) => manager.isHubManager)
            .map((manager) => {
              return {
                address: manager.address,
              }
            })
        })
      )
    })
  }

  /**
   * Get the managers on the Balance Sheet.
   * These managers can transfer funds to and from the balance sheet.
   */
  balanceSheetManagers() {
    return this._query(null, () => {
      return combineLatest([this._managers(), this._root._protocolAddresses(this.centrifugeId)]).pipe(
        map(([managers, { asyncRequestManager, syncManager }]) => {
          return managers
            .filter((manager) => manager.isBalancesheetManager)
            .map((manager) => {
              let type = 'Custom'
              if (manager.address.toLowerCase() === asyncRequestManager.toLowerCase()) {
                type = 'AsyncRequestManager'
              } else if (manager.address.toLowerCase() === syncManager.toLowerCase()) {
                type = 'SyncManager'
              }

              return {
                address: manager.address,
                centrifugeId: manager.centrifugeId,
                type,
              }
            })
        })
      )
    })
  }

  /**
   * Check if an address is a manager of the pool.
   * @param address - The address to check
   */
  isPoolManager(address: HexString) {
    const addr = address.toLowerCase()
    return this._query(['isPoolManager', this.id.toString(), addr], () => {
      return this.poolManagers().pipe(
        map((managers) => {
          return managers.some((manager) => manager.address === addr)
        })
      )
    })
  }

  /**
   * Check if an address is a Balance Sheet manager of the pool.
   * @param centrifugeId - The centrifuge ID of the network to check
   * @param address - The address to check
   */
  isBalanceSheetManager(centrifugeId: CentrifugeId, address: HexString) {
    const addr = address.toLowerCase()
    return this._query(['isBalanceSheetManager', centrifugeId, this.id.toString(), addr], () => {
      return this.balanceSheetManagers().pipe(
        map((managers) => {
          return managers.some((manager) => manager.centrifugeId === centrifugeId && manager.address === addr)
        })
      )
    })
  }

  /**
   * Get all networks where a pool can potentially be deployed.
   */
  networks() {
    return this._query(['poolNetworks', this.id.toString()], () => {
      return this._root._deployments().pipe(
        map((deployments) => {
          return deployments.blockchains.items.map(
            (chain) => new PoolNetwork(this._root, this, Number(chain.centrifugeId))
          )
        })
      )
    })
  }

  /**
   * Get a specific network where a pool can potentially be deployed.
   * @param centrifugeId - The centrifuge ID of the network
   */
  network(centrifugeId: CentrifugeId) {
    return this._query(['poolNetwork', centrifugeId, this.id.toString()], () => {
      return this.networks().pipe(
        map((networks) => {
          const network = networks.find((network) => network.centrifugeId === centrifugeId)
          if (!network) throw new Error(`Network with centrifuge ID ${centrifugeId} not found`)
          return network
        })
      )
    })
  }

  /**
   * Get the networks where a pool is active. It doesn't mean that any vaults are deployed there necessarily.
   */
  activeNetworks() {
    return this._query(['poolActiveNetworks', this.id.toString()], () => {
      return this.networks().pipe(
        switchMap((networks) => {
          if (networks.length === 0) return of([])

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

  /**
   * Get a specific vault for a given network, share class, and asset.
   * @param centrifugeId - The centrifuge ID of the network
   * @param scId - The share class ID
   * @param asset - The asset address or ID
   */
  vault(centrifugeId: CentrifugeId, scId: ShareClassId, asset: HexString | AssetId) {
    return this._query(['vault', centrifugeId, scId.toString(), asset.toString().toLowerCase()], () =>
      this.network(centrifugeId).pipe(switchMap((network) => network.vault(scId, asset)))
    )
  }

  /**
   * Get the currency of the pool.
   */
  currency() {
    return this._query(['currency', this.id.toString()], () => {
      return combineLatest([
        this._root._protocolAddresses(this.centrifugeId),
        this._root.getClient(this.centrifugeId),
      ]).pipe(
        switchMap(([{ hubRegistry }, client]) => {
          return client.readContract({
            address: hubRegistry,
            abi: ABI.HubRegistry,
            functionName: 'currency',
            args: [this.id.raw],
          })
        }),
        switchMap((rawCurrency: bigint) => {
          const assetId = new AssetId(rawCurrency)
          const countryCode = assetId.nationalCurrencyCode

          if (!countryCode) {
            return this._root.assetCurrency(assetId)
          }

          const currency = NATIONAL_CURRENCY_METADATA[countryCode]

          if (!currency) {
            throw new Error(`No currency found for country code ${countryCode}`)
          }

          return of({
            name: currency.name,
            symbol: currency.symbol,
            decimals: 18,
          })
        })
      )
    })
  }

  /**
   * Update pool metadata.
   */
  updateMetadata(metadata: PoolMetadata) {
    const self = this
    return this._transact(async function* (ctx) {
      const cid = await self._root.config.pinJson(metadata)

      const { hub } = await self._root._protocolAddresses(self.centrifugeId)
      yield* wrapTransaction('Update metadata', ctx, {
        contract: hub,
        data: encodeFunctionData({
          abi: ABI.Hub,
          functionName: 'setPoolMetadata',
          args: [self.id.raw, toHex(cid)],
        }),
      })
    }, this.centrifugeId)
  }

  update(
    metadataInput: Partial<PoolMetadataInput> | null = null,
    updatedShareClasses: ({ id: ShareClassId } & ShareClassInput)[],
    addedShareClasses: ShareClassInput[] = []
  ) {
    const self = this

    return this._transact(async function* (ctx) {
      const [{ hub }] = await Promise.all([self._root._protocolAddresses(self.centrifugeId)])

      const existingPool = await self._root.pool(self.id)

      const [poolDetails, poolMetadata, activeNetworks] = await Promise.all([
        existingPool.details(),
        existingPool.metadata(),
        existingPool.activeNetworks(),
      ])
      const networksDetails = await Promise.all(
        activeNetworks.map((network) => {
          return network.details()
        })
      )

      if (!poolDetails) {
        throw new Error('Pool details not found')
      }

      const existingShareClassesCount = poolDetails.shareClasses.length
      const scIds = Array.from({ length: addedShareClasses.length }, (_, index) =>
        ShareClassId.from(poolDetails.id, existingShareClassesCount + index + 1)
      )

      // Determine if we need to update metadata
      const hasMetadataInput = metadataInput !== null && Object.keys(metadataInput).length > 0
      const hasNewShareClasses = addedShareClasses.length > 0
      const hasUpdatedShareClasses = updatedShareClasses.length > 0
      const shouldUpdateMetadata = hasMetadataInput || hasNewShareClasses || hasUpdatedShareClasses

      let cid: string | null = null

      if (shouldUpdateMetadata) {
        const baseMetadata: PoolMetadata =
          poolMetadata && poolMetadata.pool
            ? poolMetadata
            : ({
                version: 1,
                pool: {
                  name: '',
                  icon: null,
                  asset: { class: 'Private credit', subClass: '' },
                  issuer: {
                    name: '',
                    repName: '',
                    description: '',
                    email: '',
                    logo: null,
                    shortDescription: '',
                    categories: [],
                  },
                  poolStructure: '',
                  investorType: '',
                  links: {
                    executiveSummary: null,
                    forum: undefined,
                    website: undefined,
                  },
                  details: [],
                  status: 'upcoming',
                  listed: false,
                  poolRatings: [],
                  reports: [],
                },
                shareClasses: {},
                holdings: { headers: [], data: [] },
              } as PoolMetadata)

        const newShareClassesById: PoolMetadata['shareClasses'] = {}
        addedShareClasses.forEach((sc, index) => {
          newShareClassesById[scIds[index]!.raw] = {
            minInitialInvestment: sc.minInvestment,
            apyPercentage: sc.apyPercentage,
            apy: sc.apy,
            defaultAccounts: sc.defaultAccounts,
          }
        })

        const poolStatus =
          metadataInput?.poolType === undefined
            ? baseMetadata.pool.status
            : metadataInput.poolType === 'open'
              ? 'open'
              : 'upcoming'

        const formattedMetadata: PoolMetadata = {
          ...baseMetadata,
          version: 1,
          pool: {
            ...baseMetadata.pool,
            name: metadataInput?.poolName ?? baseMetadata.pool.name,
            icon: metadataInput?.poolIcon ?? baseMetadata.pool.icon,
            asset: {
              ...baseMetadata.pool.asset,
              class: metadataInput?.assetClass ?? baseMetadata.pool.asset.class,
              subClass: metadataInput?.subAssetClass ?? baseMetadata.pool.asset.subClass,
            },
            issuer: {
              ...baseMetadata.pool.issuer,
              name: metadataInput?.issuerName ?? baseMetadata.pool.issuer.name,
              repName: metadataInput?.issuerRepName ?? baseMetadata.pool.issuer.repName,
              description: metadataInput?.issuerDescription ?? baseMetadata.pool.issuer.description,
              email: metadataInput?.email ?? baseMetadata.pool.issuer.email,
              logo: metadataInput?.issuerLogo ?? baseMetadata.pool.issuer.logo,
              shortDescription: metadataInput?.issuerShortDescription ?? baseMetadata.pool.issuer.shortDescription,
              categories: metadataInput?.issuerCategories ?? baseMetadata.pool.issuer.categories,
            },
            poolStructure: metadataInput?.poolStructure ?? baseMetadata.pool.poolStructure,
            investorType: metadataInput?.investorType ?? baseMetadata.pool.investorType,
            links: {
              ...baseMetadata.pool.links,
              executiveSummary: metadataInput?.executiveSummary ?? baseMetadata.pool.links?.executiveSummary,
              forum: metadataInput?.forum ?? baseMetadata.pool.links?.forum,
              website: metadataInput?.website ?? baseMetadata.pool.links?.website,
            },
            details: metadataInput?.details ?? baseMetadata.pool.details,
            status: poolStatus,
            listed: metadataInput?.listed ?? baseMetadata.pool.listed,
            poolRatings: metadataInput?.poolRatings ?? baseMetadata.pool.poolRatings,
            reports: metadataInput?.report ? [metadataInput.report] : baseMetadata.pool.reports,
          },
          shareClasses: { ...baseMetadata.shareClasses, ...newShareClassesById },
          holdings: {
            headers: Array.from(
              new Set([...(baseMetadata.holdings?.headers ?? []), ...(metadataInput?.holdings?.headers ?? [])])
            ),
            data: metadataInput?.holdings?.data ?? baseMetadata.holdings?.data ?? [],
          },
        }

        updatedShareClasses.forEach((sc) => {
          const id = sc.id.toString()

          formattedMetadata.shareClasses[id] = {
            ...formattedMetadata.shareClasses[id],
            minInitialInvestment: sc.minInvestment,
            apyPercentage: sc.apyPercentage,
            apy: sc.apy,
            defaultAccounts: sc.defaultAccounts,
          }
        })

        cid = await self._root.config.pinJson(formattedMetadata)
      }

      const shareClassesToBeUpdated = updatedShareClasses.filter((sc) => {
        const shareClass = poolDetails.shareClasses.find((scDetails) => scDetails.details.id.equals(sc.id))

        if (!shareClass) {
          throw new Error(`Share class ${sc.id} not found in pool details`)
        }

        if (sc.symbolName !== shareClass.details.symbol || sc.tokenName !== shareClass.details.name) {
          return true
        }
      })

      const shareClassesToBeUpdatedIds = new Set(shareClassesToBeUpdated.map((sc) => sc.id.toString()))

      const shareClassesToBeUpdatedPerNetwork = new Map<number, ShareClass[]>()
      networksDetails.forEach((details, index) => {
        const activeShareClasses = details.activeShareClasses || []
        const shareClassesToUpdate = activeShareClasses.filter((asc) =>
          shareClassesToBeUpdatedIds.has(asc.id.toString())
        )
        if (shareClassesToUpdate.length > 0) {
          const poolNetwork = activeNetworks[index]
          if (!poolNetwork) {
            return
          }
          shareClassesToBeUpdatedPerNetwork.set(
            poolNetwork.centrifugeId,
            shareClassesToUpdate.map((sc) => sc.shareClass)
          )
        }
      })

      const existingShareClassesMetadata = poolMetadata?.shareClasses ?? {}
      const accountIsDebitNormal = new Map<number, boolean>()
      const exsitingAccounts = new Set(
        poolDetails.shareClasses.flatMap((sc) =>
          Object.entries(existingShareClassesMetadata[sc.details.id.toString()]?.defaultAccounts ?? {})
            .filter(([k, v]) => {
              if (!v) return false

              if (['asset', 'expense'].includes(k)) {
                if (accountIsDebitNormal.get(v) === false)
                  throw new Error(`Account "${v}" is set as both credit normal and debit normal.`)
                accountIsDebitNormal.set(v, true)
              } else {
                if (accountIsDebitNormal.get(v) === true)
                  throw new Error(`Account "${v}" is set as both credit normal and debit normal.`)
                accountIsDebitNormal.set(v, false)
              }

              return true
            })
            .map(([, v]) => v)
        )
      )

      const updatedShareClassesMetadata = [
        ...updatedShareClasses.map((sc) => sc.defaultAccounts),
        ...addedShareClasses.map((sc) => sc.defaultAccounts),
      ].filter(Boolean)

      const updatedAccounts = new Set(
        updatedShareClassesMetadata.flatMap((defaultAccounts) =>
          Object.entries(defaultAccounts ?? {})
            .filter(([k, v]) => {
              if (!v) return false

              if (['asset', 'expense'].includes(k)) {
                if (accountIsDebitNormal.get(v) === false)
                  throw new Error(`Account "${v}" is set as both credit normal and debit normal.`)
                accountIsDebitNormal.set(v, true)
              } else {
                if (accountIsDebitNormal.get(v) === true)
                  throw new Error(`Account "${v}" is set as both credit normal and debit normal.`)
                accountIsDebitNormal.set(v, false)
              }

              return true
            })
            .map(([, v]) => v)
        )
      )

      const newAccounts = [...updatedAccounts].filter((account) => !exsitingAccounts.has(account))

      const batch: HexString[] = []
      const messages: Record<number, MessageType[]> = {}
      function addMessage(centId: number, message: MessageType) {
        if (!messages[centId]) messages[centId] = []
        messages[centId].push(message)
      }

      // Only add metadata update if we have a CID
      if (cid) {
        batch.push(
          encodeFunctionData({
            abi: ABI.Hub,
            functionName: 'setPoolMetadata',
            args: [self.id.raw, toHex(cid)],
          })
        )
      }

      addedShareClasses.forEach((sc) => {
        batch.push(
          encodeFunctionData({
            abi: ABI.Hub,
            functionName: 'addShareClass',
            args: [
              self.id.raw,
              sc.tokenName,
              sc.symbolName,
              sc.salt?.startsWith('0x') ? (sc.salt as HexString) : toHex(sc.salt ?? randomUint(256), { size: 32 }),
            ],
          })
        )
      })

      shareClassesToBeUpdated.forEach((sc) => {
        batch.push(
          encodeFunctionData({
            abi: ABI.Hub,
            functionName: 'updateShareClassMetadata',
            args: [self.id.raw, sc.id.raw, sc.tokenName, sc.symbolName],
          })
        )
      })

      for (const [centId, shareClasses] of shareClassesToBeUpdatedPerNetwork) {
        if (shareClasses.length > 0) {
          await Promise.all(
            shareClasses.map(async (sc: ShareClass) => {
              batch.push(
                encodeFunctionData({
                  abi: ABI.Hub,
                  functionName: 'notifyShareMetadata',
                  args: [self.id.raw, sc.id.raw, centId],
                })
              )

              addMessage(centId, MessageType.NotifyShareClass)
            })
          )
        }
      }

      newAccounts.map((accountId) => {
        const isDebitNormal = accountIsDebitNormal.get(accountId)

        if (isDebitNormal === undefined) {
          return
        }

        batch.push(
          encodeFunctionData({
            abi: ABI.Hub,
            functionName: 'createAccount',
            args: [self.id.raw, accountId, isDebitNormal],
          })
        )
      })

      if (batch.length === 0) {
        throw new Error('No changes to update')
      }

      yield* wrapTransaction('Update pool details', ctx, {
        contract: hub,
        data: batch,
        messages,
      })
    }, this.centrifugeId)
  }

  /**
   * Update pool managers.
   */
  updatePoolManagers(updates: { address: HexString; canManage: boolean }[]) {
    const self = this
    return this._transact(async function* (ctx) {
      const { hub } = await self._root._protocolAddresses(self.centrifugeId)

      const existingManagers = await self.poolManagers()
      const leftManagers = new Map<string, boolean>()

      existingManagers.forEach((manager) => {
        leftManagers.set(manager.address.toLowerCase(), true)
      })

      updates.forEach(({ address, canManage }) => {
        const addr = address.toLowerCase()
        const managerExists = leftManagers.get(addr)

        if (!managerExists && canManage) {
          leftManagers.set(addr, true)
        }

        if (managerExists && !canManage) {
          leftManagers.delete(addr)
        }
      })

      if (leftManagers.size === 0) {
        throw new Error('Cannot remove all pool managers')
      }

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
    }, this.centrifugeId)
  }

  /**
   * Update balance sheet managers.
   */
  updateBalanceSheetManagers(updates: { centrifugeId: CentrifugeId; address: HexString; canManage: boolean }[]) {
    const self = this
    return this._transact(async function* (ctx) {
      const [{ hub }] = await Promise.all([self._root._protocolAddresses(self.centrifugeId)])
      const batch = updates.map(({ centrifugeId, address, canManage }) =>
        encodeFunctionData({
          abi: ABI.Hub,
          functionName: 'updateBalanceSheetManager',
          args: [centrifugeId, self.id.raw, addressToBytes32(address), canManage],
        })
      )
      const messages: Record<number, MessageType[]> = {}
      updates.forEach(({ centrifugeId }) => {
        if (!messages[centrifugeId]) messages[centrifugeId] = []
        messages[centrifugeId].push(MessageType.UpdateBalanceSheetManager)
      })

      yield* wrapTransaction('Update balance sheet managers', ctx, {
        contract: hub,
        data: batch,
        messages,
      })
    }, this.centrifugeId)
  }

  createAccounts(accounts: { accountId: number; isDebitNormal: boolean }[]) {
    const self = this
    return this._transact(async function* (ctx) {
      const { hub } = await self._root._protocolAddresses(self.centrifugeId)
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
    }, this.centrifugeId)
  }

  getEscrowAddress() {
    return this._escrow()
  }

  /**
   * @internal
   */
  _shareClassIds() {
    return this._query(['shareClasses', this.id.toString()], () =>
      combineLatest([this._root._protocolAddresses(this.centrifugeId), this._root.getClient(this.centrifugeId)]).pipe(
        switchMap(([{ shareClassManager }, client]) =>
          defer(async () => {
            const count = await client.readContract({
              address: shareClassManager,
              abi: ABI.ShareClassManager,
              functionName: 'shareClassCount',
              args: [this.id.raw],
            })
            return Array.from({ length: count }, (_, i) => ShareClassId.from(this.id, i + 1))
          }).pipe(
            repeatOnEvents(
              this._root,
              {
                address: shareClassManager,
                eventName: 'AddShareClass',
                filter: (events) => {
                  return events.some((event) => event.args.poolId === this.id.raw)
                },
              },
              this.centrifugeId
            )
          )
        )
      )
    )
  }

  /** @internal */
  _escrow() {
    return this._query(['escrow', this.id.toString()], () =>
      combineLatest([this._root._protocolAddresses(this.centrifugeId), this._root.getClient(this.centrifugeId)]).pipe(
        switchMap(([{ poolEscrowFactory }, client]) => {
          return client.readContract({
            address: poolEscrowFactory,
            abi: ABI.PoolEscrowFactory,
            functionName: 'escrow',
            args: [this.id.raw],
          })
        }),
        map((address) => address.toLowerCase() as HexString)
      )
    )
  }

  /** @internal */
  _managers() {
    return this._query(null, () =>
      this._root
        ._queryIndexer<{
          poolManagers: {
            items: {
              isHubManager: boolean
              isBalancesheetManager: boolean
              address: HexString
              centrifugeId: string
              poolId: string
            }[]
          }
        }>(
          `query ($poolId: BigInt!) {
            poolManagers(where: { poolId: $poolId }) {
              items {
                isHubManager
                isBalancesheetManager
                address
                centrifugeId
                poolId
              }
            }
          }`,
          {
            poolId: this.id.toString(),
          }
        )
        .pipe(
          map(({ poolManagers }) => {
            return poolManagers.items.map((manager) => {
              return {
                address: manager.address.toLowerCase() as HexString,
                isHubManager: manager.isHubManager,
                isBalancesheetManager: manager.isBalancesheetManager,
                centrifugeId: Number(manager.centrifugeId),
              }
            })
          })
        )
    )
  }
}
