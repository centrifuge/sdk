import {
  catchError,
  combineLatest,
  defer,
  EMPTY,
  expand,
  filter,
  firstValueFrom,
  map,
  of,
  switchMap,
  timer,
} from 'rxjs'
import { encodeFunctionData, encodePacked, getContract } from 'viem'
import { ABI } from '../abi/index.js'
import type { Centrifuge } from '../Centrifuge.js'
import { AccountType } from '../types/holdings.js'
import { HexString } from '../types/index.js'
import { MessageType } from '../types/transaction.js'
import { AddressMap } from '../utils/AddressMap.js'
import { Balance, Price } from '../utils/BigInt.js'
import { addressToBytes32, encode, randomUint } from '../utils/index.js'
import { repeatOnEvents } from '../utils/rx.js'
import { wrapTransaction } from '../utils/transaction.js'
import { AssetId, CentrifugeId, ShareClassId } from '../utils/types.js'
import { BalanceSheet } from './BalanceSheet.js'
import { Entity } from './Entity.js'
import type { Pool } from './Pool.js'
import { PoolNetwork, VaultManagerTrustedCall } from './PoolNetwork.js'
import { Vault } from './Vault.js'

const GAS_LIMIT = 30_000_000n

/**
 * Query and interact with a share class, which allows querying total issuance, NAV per share,
 * and allows interactions related to asynchronous deposits and redemptions.
 */
export class ShareClass extends Entity {
  id: ShareClassId

  /** @internal */
  constructor(
    _root: Centrifuge,
    public pool: Pool,
    id: string | ShareClassId
  ) {
    const _id = id instanceof ShareClassId ? id : new ShareClassId(id)
    super(_root, ['shareclass', _id.toString()])
    this.id = _id
  }

  /**
   * Query the details of the share class.
   * @returns The details of the share class, including name, symbol, total issuance, NAV per share and relavant metadata from the pool metadata.
   */
  details() {
    return this._query(['shareClassDetails'], () =>
      combineLatest([
        this._metrics(),
        this._metadata(),
        this.navPerNetwork(),
        this.pool.currency(),
        this.pool.metadata(),
      ]).pipe(
        map(([metrics, metadata, navPerNetwork, poolCurrency, poolMeta]) => {
          const totalIssuance = navPerNetwork.reduce(
            (acc, item) => acc.add(item.totalIssuance),
            new Balance(0n, poolCurrency.decimals)
          )

          const meta = poolMeta?.shareClasses?.[this.id.raw]

          return {
            id: this.id,
            name: metadata.name,
            symbol: metadata.symbol,
            totalIssuance,
            pricePerShare: metrics.pricePerShare,
            nav: totalIssuance.mul(metrics.pricePerShare),
            navPerNetwork,
            icon: meta?.icon || null,
            minInitialInvestment: meta?.minInitialInvestment || null,
            apyPercentage: meta?.apyPercentage || null,
            apy: meta?.apy || null,
            defaultAccounts: {
              asset: meta?.defaultAccounts?.asset || null,
              equity: meta?.defaultAccounts?.equity || null,
              gain: meta?.defaultAccounts?.gain || null,
              loss: meta?.defaultAccounts?.loss || null,
              expense: meta?.defaultAccounts?.expense || null,
              liability: meta?.defaultAccounts?.liability || null,
            },
          }
        })
      )
    )
  }

  balanceSheet(centrifugeId: CentrifugeId) {
    return this._query(['balanceSheet', centrifugeId], () =>
      this.pool.activeNetworks().pipe(
        map((networks) => {
          const network = networks.find((n) => n.centrifugeId === centrifugeId)
          if (!network) {
            throw new Error(`No active network found for centrifuge ID ${centrifugeId}`)
          }
          return new BalanceSheet(this._root, network, this)
        })
      )
    )
  }

  deploymentPerNetwork() {
    return this._query(['deploymentPerNetwork'], () =>
      this.pool.activeNetworks().pipe(
        switchMap((networks) => {
          if (networks.length === 0) return of([])

          return combineLatest(
            networks.map((network) =>
              combineLatest([
                this._share(network.centrifugeId),
                this._restrictionManager(network.centrifugeId).pipe(catchError(() => of(null))),
                this.valuation(network.centrifugeId),
                of(network),
              ])
            )
          )
        }),
        map((data) =>
          data
            .filter(([share, restrictionManager]) => share != null && restrictionManager != null)
            .map(([share, restrictionManager, valuation, network]) => ({
              centrifugeId: network.centrifugeId,
              shareTokenAddress: share!,
              restrictionManagerAddress: restrictionManager!,
              valuation,
            }))
        )
      )
    )
  }

  navPerNetwork() {
    return this._query(['navPerNetwork'], () =>
      this.pool.currency().pipe(
        switchMap((poolCurrency) =>
          this._root._queryIndexer(
            `query ($scId: String!) {
              tokenInstances(where: { tokenId: $scId }) {
                items {
                  totalIssuance
                  tokenPrice
                  address
                  blockchain {
                    centrifugeId
                  }
                }
              }
            }`,
            { scId: this.id.raw },
            (data: {
              tokenInstances: {
                items: {
                  totalIssuance: bigint
                  tokenPrice: bigint
                  blockchain: { centrifugeId: string }
                  address: HexString
                }[]
              }
            }) =>
              data.tokenInstances.items.map((item) => ({
                centrifugeId: Number(item.blockchain.centrifugeId),
                totalIssuance: new Balance(item.totalIssuance, poolCurrency.decimals),
                pricePerShare: new Price(item.tokenPrice),
                nav: new Balance(item.totalIssuance, poolCurrency.decimals).mul(new Price(item.tokenPrice)),
                address: item.address,
              }))
          )
        )
      )
    )
  }

  /**
   * Query the vaults of the share class.
   * @param centrifugeId The optional centrifuge ID to query the vaults on.
   * @param includeUnlinked Whether to include unlinked vaults.
   * @returns Vaults of the share class.
   */
  vaults(centrifugeId?: CentrifugeId, includeUnlinked = false) {
    return this._query(['vaults', centrifugeId, includeUnlinked.toString()], () =>
      this._allVaults().pipe(
        map((allVaults) => {
          return allVaults.filter((vault) => {
            if (centrifugeId !== undefined && vault.centrifugeId !== centrifugeId) return false
            if (!includeUnlinked && vault.status === 'Unlinked') return false
            return true
          })
        }),
        map((vaults) =>
          vaults.map(
            (vault) =>
              new Vault(
                this._root,
                new PoolNetwork(this._root, this.pool, vault.centrifugeId),
                this,
                vault.assetAddress,
                vault.address,
                vault.assetId
              )
          )
        )
      )
    )
  }

  /**
   * Query all the balances of the share class (from BalanceSheet and Holdings).
   */
  balances(centrifugeId?: CentrifugeId) {
    return this._query(['balances', centrifugeId], () =>
      combineLatest([this._balances(), this.pool.currency()]).pipe(
        switchMap(([res, poolCurrency]) => {
          if (res.length === 0) {
            return of([])
          }
          const items = res.filter((item) => Number(item.centrifugeId) === centrifugeId || !centrifugeId)

          if (items.length === 0) return of([])

          return combineLatest([
            combineLatest(
              items.map((holding) => {
                if (!holding.holding) return of(null)
                const assetId = new AssetId(holding.assetId)
                return this._holding(assetId).pipe(catchError(() => of(null)))
              })
            ),
            combineLatest(
              items.map((holding) => {
                const assetId = new AssetId(holding.assetId)
                return this._balance(Number(holding.centrifugeId), {
                  address: holding.asset.address,
                  assetTokenId: BigInt(holding.asset.assetTokenId),
                  id: assetId,
                  decimals: holding.asset.decimals,
                })
              })
            ),
          ]).pipe(
            map(([holdings, balances]) =>
              items.map((data, i) => {
                const holding = holdings[i]
                const balance = balances[i]!
                // If the holding hasn't been initialized yet, the price is 1
                const price = holding ? balance.price : Price.fromFloat(1)
                const value = Balance.fromFloat(
                  balance.amount.toDecimal().mul(price.toDecimal()),
                  poolCurrency.decimals
                )
                return {
                  assetId: new AssetId(data.assetId),
                  amount: balance.amount,
                  value,
                  price,
                  asset: {
                    decimals: data.asset.decimals,
                    address: data.asset.address,
                    tokenId: BigInt(data.asset.assetTokenId),
                    name: data.asset.name,
                    symbol: data.asset.symbol,
                    centrifugeId: Number(data.centrifugeId) as CentrifugeId,
                  },
                  holding: holding && {
                    valuation: holding.valuation,
                    amount: holding.amount,
                    value: holding.value,
                    isLiability: holding.isLiability,
                    accounts: holding.accounts,
                  },
                }
              })
            )
          )
        })
      )
    )
  }

  /**
   * Get the pending and approved amounts for deposits and redemptions for each asset.
   */
  pendingAmounts() {
    return this._query(['pendingAmounts'], () =>
      this._allVaults().pipe(
        map((vaults) => vaults.filter((v) => v.status === 'Linked')),
        switchMap((vaults) => {
          if (vaults.length === 0) return of([])

          return combineLatest([
            combineLatest(vaults.map((v) => this._epoch(v.assetId))),
            this._epochOutstandingInvests(),
            this._epochOutstandingRedeems(),
            this.balances(),
          ]).pipe(
            map(([epochs, outInv, outRed, balancesData]) => {
              const invByKey = new Map<string, Balance>()
              outInv.forEach((o) => invByKey.set(`${o.assetId.toString()}-${o.centrifugeId}`, o.amount))

              const redByKey = new Map<string, Balance>()
              outRed.forEach((o) => redByKey.set(`${o.assetId.toString()}-${o.centrifugeId}`, o.amount))

              const priceByAsset = new Map<string, Price>()
              balancesData.forEach((b) => priceByAsset.set(b.assetId.toString(), b.price))

              return epochs.map((epoch, i) => {
                const vault = vaults[i]!
                const key = `${vault.assetId.toString()}-${vault.centrifugeId}`

                const queuedInvest = invByKey.get(key) ?? new Balance(0n, 18)
                const queuedRedeem = redByKey.get(key) ?? new Balance(0n, 18)
                const assetPrice = priceByAsset.get(vault.assetId.toString()) ?? Price.fromFloat(1)

                return {
                  assetId: vault.assetId,
                  centrifugeId: vault.centrifugeId,
                  queuedInvest,
                  queuedRedeem,
                  assetPrice,
                  ...epoch,
                }
              })
            })
          )
        })
      )
    )
  }

  /**
   * Check if an address is a member of the share class.
   * @param address Address to check
   * @param centrifugeId Centrifuge ID of the network on which to check the member
   */
  member(address: HexString, centrifugeId: CentrifugeId) {
    const addr = address.toLowerCase() as HexString
    return this._query(['member', addr, centrifugeId], () =>
      combineLatest([
        this._share(centrifugeId),
        this._restrictionManager(centrifugeId),
        this._root.getClient(centrifugeId),
      ]).pipe(
        switchMap(([share, restrictionManager, client]) =>
          defer(async () => {
            const res = await client.readContract({
              address: restrictionManager,
              abi: ABI.RestrictionManager,
              functionName: 'isMember',
              args: [share, addr],
            })
            return {
              isMember: res[0],
              validUntil: new Date(Number(res[1]) * 1000),
            }
          }).pipe(
            repeatOnEvents(
              this._root,
              {
                address: restrictionManager,
                eventName: 'UpdateMember',
                filter: (events) =>
                  events.some(
                    (event) => event.args.user?.toLowerCase() === addr && event.args.token?.toLowerCase() === share
                  ),
              },
              centrifugeId
            ),
            catchError((e) => {
              console.warn('Error checking member status', e)
              // Freeze-only hook doesn't have isMember function
              return of({
                isMember: false,
                validUntil: new Date(0),
              })
            })
          )
        )
      )
    )
  }

  /**
   * Create a holding for a registered asset in the share class.
   * @param assetId - Asset ID of the asset to create a holding for
   * @param valuation - Valuation of the asset
   * @param isLiability - Whether the holding is a liability or not
   * @param accounts - Accounts to use for the holding. An asset or expense account will be created if not provided.
   * Other accounts are expected to be provided or to exist in the pool metadata.
   */
  createHolding<Liability extends boolean>(
    assetId: AssetId,
    valuation: HexString,
    isLiability: Liability,
    accounts?: Liability extends true
      ? { [key in AccountType.Expense | AccountType.Liability]?: number }
      : { [key in AccountType.Asset | AccountType.Equity | AccountType.Loss | AccountType.Gain]?: number }
  ) {
    const self = this
    return this._transact(async function* (ctx) {
      const [{ hub }, metadata] = await Promise.all([
        self._root._protocolAddresses(self.pool.centrifugeId),
        self.pool.metadata(),
      ])

      let data: HexString | HexString[]
      if (isLiability) {
        const expenseAccount =
          (accounts as any)[AccountType.Expense] || metadata?.shareClasses?.[self.id.raw]?.defaultAccounts?.expense
        const liabilityAccount =
          (accounts as any)[AccountType.Liability] || metadata?.shareClasses?.[self.id.raw]?.defaultAccounts?.liability
        if (liabilityAccount === undefined) {
          throw new Error('Missing required accounts for liability creation')
        }
        if (expenseAccount) {
          data = encodeFunctionData({
            abi: ABI.Hub,
            functionName: 'initializeLiability',
            args: [self.pool.id.raw, self.id.raw, assetId.raw, valuation, expenseAccount, liabilityAccount],
          })
        } else {
          const newExpenseAccount = await self._getFreeAccountId()
          const createAccountData = encodeFunctionData({
            abi: ABI.Hub,
            functionName: 'createAccount',
            args: [self.pool.id.raw, newExpenseAccount, true],
          })
          const initHoldingData = encodeFunctionData({
            abi: ABI.Hub,
            functionName: 'initializeLiability',
            args: [self.pool.id.raw, self.id.raw, assetId.raw, valuation, newExpenseAccount, liabilityAccount],
          })
          data = [createAccountData, initHoldingData]
        }
      } else {
        const assetAccount =
          (accounts as any)[AccountType.Asset] || metadata?.shareClasses?.[self.id.raw]?.defaultAccounts?.asset
        const equityAccount =
          (accounts as any)[AccountType.Equity] || metadata?.shareClasses?.[self.id.raw]?.defaultAccounts?.equity
        const gainAccount =
          (accounts as any)[AccountType.Gain] || metadata?.shareClasses?.[self.id.raw]?.defaultAccounts?.gain
        const lossAccount =
          (accounts as any)[AccountType.Loss] || metadata?.shareClasses?.[self.id.raw]?.defaultAccounts?.loss
        if (equityAccount === undefined || gainAccount === undefined || lossAccount === undefined) {
          throw new Error('Missing required accounts for holding creation')
        }
        if (assetAccount) {
          data = encodeFunctionData({
            abi: ABI.Hub,
            functionName: 'initializeHolding',
            args: [
              self.pool.id.raw,
              self.id.raw,
              assetId.raw,
              valuation,
              assetAccount,
              equityAccount,
              gainAccount,
              lossAccount,
            ],
          })
        } else {
          const newAssetAccount = await self._getFreeAccountId()
          const createAccountData = encodeFunctionData({
            abi: ABI.Hub,
            functionName: 'createAccount',
            args: [self.pool.id.raw, newAssetAccount, false],
          })
          const initHoldingData = encodeFunctionData({
            abi: ABI.Hub,
            functionName: 'initializeHolding',
            args: [
              self.pool.id.raw,
              self.id.raw,
              assetId.raw,
              valuation,
              newAssetAccount,
              equityAccount,
              gainAccount,
              lossAccount,
            ],
          })
          data = [createAccountData, initHoldingData]
        }
      }
      yield* wrapTransaction('Create holding', ctx, {
        contract: hub,
        data,
      })
    }, this.pool.centrifugeId)
  }

  updateSharePrice(pricePerShare: Price, updatedAt = new Date()) {
    const self = this
    return this._transact(async function* (ctx) {
      const [{ hub }, activeNetworks] = await Promise.all([
        self._root._protocolAddresses(self.pool.centrifugeId),
        self.pool.activeNetworks(),
      ])
      const batch: HexString[] = []
      const messages: Record<number, MessageType[]> = {}
      function addMessage(centId: number, message: MessageType) {
        if (!messages[centId]) messages[centId] = []
        messages[centId].push(message)
      }

      batch.push(
        encodeFunctionData({
          abi: ABI.Hub,
          functionName: 'updateSharePrice',
          args: [
            self.pool.id.raw,
            self.id.raw,
            pricePerShare.toBigInt(),
            BigInt(Math.floor(updatedAt.getTime() / 1000)),
          ],
        })
      )

      await Promise.all(
        activeNetworks.map(async (activeNetwork) => {
          const networkDetails = await activeNetwork.details()
          const id = activeNetwork.centrifugeId

          const isShareClassInNetwork = networkDetails.activeShareClasses.find((shareClass) =>
            shareClass.id.equals(self.id)
          )

          if (isShareClassInNetwork) {
            batch.push(
              encodeFunctionData({
                abi: ABI.Hub,
                functionName: 'notifySharePrice',
                args: [self.pool.id.raw, self.id.raw, id, ctx.signingAddress],
              })
            )
            addMessage(id, MessageType.NotifyPricePoolPerShare)
          }
        })
      )

      yield* wrapTransaction('Update share price', ctx, {
        contract: hub,
        data: batch,
        messages,
      })
    }, this.pool.centrifugeId)
  }

  setMaxAssetPriceAge(assetId: AssetId, maxPriceAge: number) {
    const self = this
    return this._transact(async function* (ctx) {
      const { hub } = await self._root._protocolAddresses(self.pool.centrifugeId)
      yield* wrapTransaction('Set max asset price age', ctx, {
        contract: hub,
        data: encodeFunctionData({
          abi: ABI.Hub,
          functionName: 'setMaxAssetPriceAge',
          args: [self.pool.id.raw, self.id.raw, assetId.raw, BigInt(maxPriceAge), ctx.signingAddress],
        }),
        messages: {
          [assetId.centrifugeId]: [MessageType.SetMaxAssetPriceAge],
        },
      })
    }, this.pool.centrifugeId)
  }

  setMaxSharePriceAge(centrifugeId: CentrifugeId, maxPriceAge: number) {
    const self = this
    return this._transact(async function* (ctx) {
      const { hub } = await self._root._protocolAddresses(self.pool.centrifugeId)
      yield* wrapTransaction('Set max share price age', ctx, {
        contract: hub,
        data: encodeFunctionData({
          abi: ABI.Hub,
          functionName: 'setMaxSharePriceAge',
          args: [self.pool.id.raw, self.id.raw, centrifugeId, BigInt(maxPriceAge), ctx.signingAddress],
        }),
        messages: {
          [centrifugeId]: [MessageType.SetMaxSharePriceAge],
        },
      })
    }, this.pool.centrifugeId)
  }

  notifyAssetPrice(assetId: AssetId) {
    const self = this
    return this._transact(async function* (ctx) {
      const { hub } = await self._root._protocolAddresses(self.pool.centrifugeId)
      yield* wrapTransaction('Notify asset price', ctx, {
        contract: hub,
        data: encodeFunctionData({
          abi: ABI.Hub,
          functionName: 'notifyAssetPrice',
          args: [self.pool.id.raw, self.id.raw, assetId.raw, ctx.signingAddress],
        }),
        messages: {
          [assetId.centrifugeId]: [MessageType.NotifyPricePoolPerAsset],
        },
      })
    }, this.pool.centrifugeId)
  }

  notifySharePrice(centrifugeId: CentrifugeId) {
    const self = this
    return this._transact(async function* (ctx) {
      const { hub } = await self._root._protocolAddresses(self.pool.centrifugeId)
      yield* wrapTransaction('Notify share price', ctx, {
        contract: hub,
        data: encodeFunctionData({
          abi: ABI.Hub,
          functionName: 'notifySharePrice',
          args: [self.pool.id.raw, self.id.raw, centrifugeId, ctx.signingAddress],
        }),
        messages: {
          [centrifugeId]: [MessageType.NotifyPricePoolPerShare],
        },
      })
    }, this.pool.centrifugeId)
  }

  /**
   * Approve deposits and issue shares for the given assets.
   * @param assets - Array of assets to approve deposits and/or issue shares for
   * `issuePricePerShare` can be a single price for all epochs or an array of prices for each epoch to be issued for.
   */
  approveDepositsAndIssueShares(
    assets: ({ assetId: AssetId } & (
      | { approveAssetAmount: Balance; approvePricePerAsset: Balance }
      | { issuePricePerShare?: Price | Price[] }
    ))[]
  ) {
    const self = this
    return this._transact(async function* (ctx) {
      const [{ batchRequestManager }, pendingAmounts, orders] = await Promise.all([
        self._root._protocolAddresses(self.pool.centrifugeId),
        self.pendingAmounts(),
        firstValueFrom(
          self._investorOrders().pipe(
            switchMap((orders) => {
              if (orders.outstandingInvests.length === 0) return of([])

              return combineLatest(
                orders.outstandingInvests.map((order) => self._investorOrder(order.assetId, order.investor))
              )
            })
          )
        ),
      ])
      const assetsWithApprove = assets.filter((a) => 'approveAssetAmount' in a).length
      const assetsWithIssue = assets.filter((a) => 'issuePricePerShare' in a).length
      const gasLimitPerAsset = assetsWithIssue ? GAS_LIMIT / BigInt(assetsWithIssue) : 0n
      const estimatePerMessage = 700_000n
      const estimatePerMessageIfLocal = 360_000n

      const ordersByAssetId: Record<string, typeof orders> = {}
      orders.forEach((order) => {
        if (order.pendingDeposit === 0n) return
        const id = order.assetId.toString()
        if (!ordersByAssetId[id]) ordersByAssetId[id] = []
        ordersByAssetId[id].push(order)
      })

      const uniqueAssets = new Set(assets.map((a) => a.assetId.toString()))
      if (uniqueAssets.size !== assets.length) {
        throw new Error('Assets array contains multiple entries for the same asset ID')
      }

      const batch: HexString[] = []
      const messages: Record<number, MessageType[]> = {}
      function addMessage(centId: number, message: MessageType) {
        if (!messages[centId]) messages[centId] = []
        messages[centId].push(message)
      }

      for (const asset of assets) {
        const gasPerMessage =
          asset.assetId.centrifugeId === self.pool.centrifugeId ? estimatePerMessageIfLocal : estimatePerMessage
        let gasLeft = gasLimitPerAsset
        const pending = pendingAmounts.find((e) => e.assetId.equals(asset.assetId))
        if (!pending) {
          throw new Error(`No pending amount found for asset "${asset.assetId.toString()}"`)
        }

        let nowDepositEpoch = pending?.depositEpoch

        if ('approveAssetAmount' in asset) {
          if (asset.approveAssetAmount.gt(pending.pendingDeposit)) {
            throw new Error(`Approve amount exceeds pending amount for asset "${asset.assetId.toString()}"`)
          }
          if (asset.approveAssetAmount.lte(0n)) {
            throw new Error(`Approve amount must be greater than 0 for asset "${asset.assetId.toString()}"`)
          }
          batch.push(
            encodeFunctionData({
              abi: ABI.BatchRequestManager,
              functionName: 'approveDeposits',
              args: [
                self.pool.id.raw,
                self.id.raw,
                asset.assetId.raw,
                nowDepositEpoch,
                asset.approveAssetAmount.toBigInt(),
                asset.approvePricePerAsset.toBigInt(),
                ctx.signingAddress,
              ],
            })
          )
          addMessage(asset.assetId.centrifugeId, MessageType.RequestCallback)
          gasLeft -= gasPerMessage
          nowDepositEpoch++
        }

        const nowIssueEpoch = pending.issueEpoch

        if ('issuePricePerShare' in asset) {
          if (nowIssueEpoch >= nowDepositEpoch) throw new Error('Nothing to issue')

          let i
          for (i = 0; i < nowDepositEpoch - nowIssueEpoch; i++) {
            const price = Array.isArray(asset.issuePricePerShare)
              ? asset.issuePricePerShare[i]
              : asset.issuePricePerShare
            if (!price) break

            if (price.lte(0n)) {
              throw new Error(`Issue price per share must be greater than 0 for asset "${asset.assetId.toString()}"`)
            }

            batch.push(
              encodeFunctionData({
                abi: ABI.BatchRequestManager,
                functionName: 'issueShares',
                args: [
                  self.pool.id.raw,
                  self.id.raw,
                  asset.assetId.raw,
                  nowIssueEpoch + i,
                  price.toBigInt(),
                  0n,
                  ctx.signingAddress,
                ],
              })
            )
            addMessage(asset.assetId.centrifugeId, MessageType.RequestCallback)
            gasLeft -= gasPerMessage
          }
          // If we've issued shares, also notify a number of invest orders
          if (i) {
            const claims = gasLeft > 0n ? Number(gasLeft / gasPerMessage) : 0
            const assetOrders = ordersByAssetId[asset.assetId.toString()]
            assetOrders?.slice(0, claims).forEach((order) => {
              if (order.pendingDeposit > 0n) {
                batch.push(
                  encodeFunctionData({
                    abi: ABI.BatchRequestManager,
                    functionName: 'notifyDeposit',
                    args: [
                      self.pool.id.raw,
                      self.id.raw,
                      asset.assetId.raw,
                      addressToBytes32(order.investor),
                      order.maxDepositClaims + i, // +i to ensure the additional epochs that are being issued are included
                      ctx.signingAddress,
                    ],
                  })
                )
                addMessage(asset.assetId.centrifugeId, MessageType.RequestCallback)
              }
            })
          }
        }
      }

      if (batch.length === 0) {
        throw new Error('No approve or issue actions provided')
      }
      let title = 'Approve and issue'
      if (assetsWithApprove === 0) {
        title = 'Issue'
      } else if (assetsWithIssue === 0) {
        title = 'Approve'
      }

      yield* wrapTransaction(title, ctx, {
        contract: batchRequestManager,
        data: batch,
        messages,
      })
    }, this.pool.centrifugeId)
  }

  /**
   * Approve redeems and revoke shares for the given assets.
   * @param assets - Array of assets to approve redeems and/or revoke shares for
   * `approveShareAmount` can be a single amount for all epochs or an array of amounts for each epoch to be revoked.
   */

  approveRedeemsAndRevokeShares(
    assets: ({ assetId: AssetId } & (
      | { approveShareAmount: Balance; approvePricePerAsset: Balance }
      | { revokePricePerShare: Price | Price[] }
    ))[]
  ) {
    const self = this
    return this._transact(async function* (ctx) {
      const [{ batchRequestManager }, pendingAmounts, orders] = await Promise.all([
        self._root._protocolAddresses(self.pool.centrifugeId),
        self.pendingAmounts(),
        firstValueFrom(
          self._investorOrders().pipe(
            switchMap((orders) => {
              if (orders.outstandingRedeems.length === 0) return of([])

              return combineLatest(
                orders.outstandingRedeems.map((order) => self._investorOrder(order.assetId, order.investor))
              )
            })
          )
        ),
      ])

      const assetsWithApprove = assets.filter((a) => 'approveShareAmount' in a).length
      const assetsWithRevoke = assets.filter((a) => 'revokePricePerShare' in a).length
      const gasLimitPerAsset = assetsWithRevoke ? GAS_LIMIT / BigInt(assetsWithRevoke) : 0n
      const estimatePerMessage = 700_000n
      const estimatePerMessageIfLocal = 360_000n

      const ordersByAssetId: Record<string, typeof orders> = {}
      orders.forEach((order) => {
        if (order.pendingRedeem === 0n) return
        const id = order.assetId.toString()
        if (!ordersByAssetId[id]) ordersByAssetId[id] = []
        ordersByAssetId[id].push(order)
      })

      const uniqueAssets = new Set(assets.map((a) => a.assetId.toString()))
      if (uniqueAssets.size !== assets.length) {
        throw new Error('Assets array contains multiple entries for the same asset ID')
      }

      const batch: HexString[] = []
      const messages: Record<number, MessageType[]> = {}
      function addMessage(centId: number, message: MessageType) {
        if (!messages[centId]) messages[centId] = []
        messages[centId].push(message)
      }

      for (const asset of assets) {
        const gasPerMessage =
          asset.assetId.centrifugeId === self.pool.centrifugeId ? estimatePerMessageIfLocal : estimatePerMessage
        let gasLeft = gasLimitPerAsset
        const pending = pendingAmounts.find((e) => e.assetId.equals(asset.assetId))
        if (!pending) {
          throw new Error(`No pending amount found for asset "${asset.assetId.toString()}"`)
        }

        let nowRedeemEpoch = pending.redeemEpoch

        if ('approveShareAmount' in asset) {
          if (asset.approveShareAmount.gt(pending.pendingRedeem)) {
            throw new Error(`Share amount exceeds pending redeem for asset "${asset.assetId.toString()}"`)
          }
          if (asset.approveShareAmount.lte(0n)) {
            throw new Error(`Share amount must be greater than 0 for asset "${asset.assetId.toString()}"`)
          }
          batch.push(
            encodeFunctionData({
              abi: ABI.BatchRequestManager,
              functionName: 'approveRedeems',
              args: [
                self.pool.id.raw,
                self.id.raw,
                asset.assetId.raw,
                nowRedeemEpoch,
                asset.approveShareAmount.toBigInt(),
                asset.approvePricePerAsset.toBigInt(),
              ],
            })
          )
          nowRedeemEpoch++
        }

        const nowRevokeEpoch = pending.revokeEpoch
        if ('revokePricePerShare' in asset) {
          if (nowRevokeEpoch >= nowRedeemEpoch) throw new Error('Nothing to revoke')

          let i
          for (i = 0; i < nowRedeemEpoch - nowRevokeEpoch; i++) {
            const price = Array.isArray(asset.revokePricePerShare)
              ? asset.revokePricePerShare[i]
              : asset.revokePricePerShare
            if (!price) break

            if (price.lte(0n)) {
              throw new Error(`Revoke price per share must be greater than 0 for asset "${asset.assetId.toString()}"`)
            }

            batch.push(
              encodeFunctionData({
                abi: ABI.BatchRequestManager,
                functionName: 'revokeShares',
                args: [
                  self.pool.id.raw,
                  self.id.raw,
                  asset.assetId.raw,
                  nowRevokeEpoch + i,
                  price.toBigInt(),
                  0n,
                  ctx.signingAddress,
                ],
              })
            )
            addMessage(asset.assetId.centrifugeId, MessageType.RequestCallback)
            gasLeft -= gasPerMessage
          }

          // If we've revoked shares, also notify a number of redeem orders
          if (i) {
            const claims = gasLeft > 0n ? Number(gasLeft / gasPerMessage) : 0
            const assetOrders = ordersByAssetId[asset.assetId.toString()]
            assetOrders?.slice(0, claims).forEach((order) => {
              if (order.pendingRedeem > 0n) {
                batch.push(
                  encodeFunctionData({
                    abi: ABI.BatchRequestManager,
                    functionName: 'notifyRedeem',
                    args: [
                      self.pool.id.raw,
                      self.id.raw,
                      asset.assetId.raw,
                      addressToBytes32(order.investor),
                      order.maxRedeemClaims + 1, // +1 to ensure the order that's being issued is included
                      ctx.signingAddress,
                    ],
                  })
                )
                addMessage(asset.assetId.centrifugeId, MessageType.RequestCallback)
              }
            })
          }
        }
      }
      if (batch.length === 0) {
        throw new Error('No approve or revoke actions provided')
      }

      let title = 'Approve and revoke'
      if (assetsWithApprove === 0) {
        title = 'Revoke'
      } else if (assetsWithRevoke === 0) {
        title = 'Approve'
      }

      yield* wrapTransaction(title, ctx, {
        contract: batchRequestManager,
        data: batch,
        messages,
      })
    }, this.pool.centrifugeId)
  }

  /**
   * Claim a deposit on the Hub side for the given asset and investor after the shares have been issued.
   * This will send a message to the Spoke that will allow the investor to claim their shares.
   */
  claimDeposit(assetId: AssetId, investor: HexString) {
    const self = this
    return this._transact(async function* (ctx) {
      const [{ batchRequestManager }, investorOrder] = await Promise.all([
        self._root._protocolAddresses(self.pool.centrifugeId),
        self._investorOrder(assetId, investor),
      ])
      yield* wrapTransaction('Claim deposit', ctx, {
        contract: batchRequestManager,
        data: encodeFunctionData({
          abi: ABI.BatchRequestManager,
          functionName: 'notifyDeposit',
          args: [
            self.pool.id.raw,
            self.id.raw,
            assetId.raw,
            addressToBytes32(investor),
            investorOrder.maxDepositClaims,
            ctx.signingAddress,
          ],
        }),
        messages: { [assetId.centrifugeId]: [MessageType.RequestCallback] },
      })
    }, this.pool.centrifugeId)
  }

  /**
   * Claim a redemption on the Hub side for the given asset and investor after the shares have been revoked.
   * This will send a message to the Spoke that will allow the investor to claim their redeemed currency.
   */
  claimRedeem(assetId: AssetId, investor: HexString) {
    const self = this
    return this._transact(async function* (ctx) {
      const [{ batchRequestManager }, investorOrder] = await Promise.all([
        self._root._protocolAddresses(self.pool.centrifugeId),
        self._investorOrder(assetId, investor),
      ])
      yield* wrapTransaction('Claim redeem', ctx, {
        contract: batchRequestManager,
        data: encodeFunctionData({
          abi: ABI.BatchRequestManager,
          functionName: 'notifyRedeem',
          args: [
            self.pool.id.raw,
            self.id.raw,
            assetId.raw,
            addressToBytes32(investor),
            investorOrder.maxRedeemClaims,
            ctx.signingAddress,
          ],
        }),
        messages: { [assetId.centrifugeId]: [MessageType.RequestCallback] },
      })
    }, this.pool.centrifugeId)
  }

  /**
   * Update a member of the share class.
   * @param address Address of the investor
   * @param validUntil Time in seconds from Unix epoch until the investor is valid
   * @param centrifugeId Centrifuge ID of the network on which to update the member
   */
  updateMember(address: HexString, validUntil: number, centrifugeId: CentrifugeId) {
    return this.updateMembers([{ address, validUntil, centrifugeId }])
  }

  /**
   * Batch update a list of members of the share class.
   * @param members Array of members to update, each with address, validUntil and centrifugeId
   * @param members.address Address of the investor
   * @param members.validUntil Time in seconds from Unix epoch until the investor is valid
   * @param members.centrifugeId Centrifuge ID of the network on which to update the member
   */
  updateMembers(members: { address: HexString; validUntil: number; centrifugeId: CentrifugeId }[]) {
    const self = this

    return this._transact(async function* (ctx) {
      const { hub } = await self._root._protocolAddresses(self.pool.centrifugeId)

      const batch: HexString[] = []
      const messages: Record<number, MessageType[]> = {}
      function addMessage(centId: number, message: MessageType) {
        if (!messages[centId]) messages[centId] = []
        messages[centId].push(message)
      }

      members.forEach((member) => {
        batch.push(
          encodeFunctionData({
            abi: ABI.Hub,
            functionName: 'updateRestriction',
            args: [
              self.pool.id.raw,
              self.id.raw,
              member.centrifugeId,
              encodePacked(
                ['uint8', 'bytes32', 'uint64'],
                [/* UpdateRestrictionType.Member */ 1, addressToBytes32(member.address), BigInt(member.validUntil)]
              ),
              0n,
              ctx.signingAddress,
            ],
          })
        )
        addMessage(member.centrifugeId, MessageType.UpdateRestriction)
      })

      if (batch.length === 0) {
        throw new Error('No data to update members')
      }

      yield* wrapTransaction(`Update member${batch.length > 1 ? 's' : ''}`, ctx, {
        contract: hub,
        data: batch,
        messages,
      })
    }, this.pool.centrifugeId)
  }

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
    limit?: number
    offset?: number
    orderBy?: string
    orderDirection?: string
    filter?: {
      balance_gt?: bigint
      holderAddress?: string
      centrifugeIds?: string[]
    }
  }) {
    const limit = options?.limit ?? 20
    const offset = options?.offset ?? 0
    const orderBy = options?.orderBy ?? 'balance'
    const orderDirection = options?.orderDirection ?? 'desc'
    const filter = options?.filter

    return this._query(
      [
        'holders',
        this.id.raw,
        limit,
        offset,
        filter?.balance_gt?.toString(),
        filter?.holderAddress,
        filter?.centrifugeIds?.join(','),
        orderBy,
        orderDirection,
      ],
      () =>
        combineLatest([
          this.pool.currency(),
          this._investorOrders(),
          this._tokenInstancePositions({ limit, offset, orderBy, orderDirection, filter }),
        ]).pipe(
          switchMap(
            ([
              poolCurrency,
              { outstandingInvests, outstandingRedeems },
              { items: tokenInstancePositions, assets, pageInfo, totalCount },
            ]) => {
              // Handle empty positions case or else combineLatest([]) can hang indefinitely
              if (tokenInstancePositions.length === 0) {
                return of({
                  investors: [],
                  pageInfo,
                  totalCount,
                })
              }

              const whitelistedQueries = tokenInstancePositions.map((position) =>
                this._whitelistedInvestor({
                  accountAddress: position.accountAddress,
                  centrifugeId: position.centrifugeId,
                  tokenId: this.id.raw,
                }).pipe(catchError(() => of(null)))
              )

              return combineLatest(whitelistedQueries).pipe(
                map((whitelistResults) => {
                  const investors = tokenInstancePositions.map((position, i) => {
                    const whitelistData = whitelistResults[i]
                    const centrifugeId = Number(position.centrifugeId) as CentrifugeId
                    const outstandingInvest = outstandingInvests.find(
                      (order) => order.investor === position.accountAddress
                    )
                    const outstandingRedeem = outstandingRedeems.find(
                      (order) => order.investor === position.accountAddress
                    )
                    const assetId = outstandingInvest?.assetId.toString()
                    const assetDecimals =
                      assets.find((asset: { id: string; decimals: number }) => asset.id === assetId)?.decimals ?? 18
                    const isWhitelistedStatus = whitelistData
                      ? parseInt(whitelistData.validUntil, 10) > Date.now()
                      : false

                    return {
                      address: position.accountAddress,
                      amount: new Balance(outstandingInvest?.pendingAmount ?? 0n, assetDecimals),
                      centrifugeId,
                      createdAt: whitelistData?.createdAt ?? '',
                      holdings: new Balance(position.balance, poolCurrency.decimals),
                      isFrozen: whitelistData?.isFrozen ?? position.isFrozen,
                      outstandingInvest: outstandingInvest
                        ? new Balance(outstandingInvest.pendingAmount, assetDecimals).scale(poolCurrency.decimals)
                        : new Balance(0n, poolCurrency.decimals),
                      outstandingRedeem: outstandingRedeem
                        ? new Balance(outstandingRedeem.pendingAmount, poolCurrency.decimals)
                        : new Balance(0n, poolCurrency.decimals),
                      queuedInvest: outstandingInvest
                        ? new Balance(outstandingInvest.queuedAmount, assetDecimals).scale(poolCurrency.decimals)
                        : new Balance(0n, poolCurrency.decimals),
                      queuedRedeem: outstandingRedeem
                        ? new Balance(outstandingRedeem.queuedAmount, poolCurrency.decimals)
                        : new Balance(0n, poolCurrency.decimals),
                      isWhitelisted: isWhitelistedStatus,
                    }
                  })

                  investors.sort((a, b) => {
                    const aValue = BigInt(a.holdings.toBigInt())
                    const bValue = BigInt(b.holdings.toBigInt())
                    return aValue > bValue ? -1 : aValue < bValue ? 1 : 0
                  })

                  return {
                    investors,
                    pageInfo,
                    totalCount,
                  }
                })
              )
            }
          )
        )
    )
  }

  /**
   * Retrieve only whitelisted holders of the share class.
   * @param options Optional pagination options object for whitelisted investors query
   * @param options.limit Number of results to return (default: 20)
   * @param options.offset Offset for pagination (default: 0)
   */
  whitelistedHolders(options?: { limit: number; offset?: number }) {
    const limit = options?.limit ?? 20
    const offset = options?.offset ?? 0

    return this._query(['whitelistedHolders', this.id.raw, limit, offset], () =>
      combineLatest([this.pool.currency(), this._investorOrders(), this._whitelistedInvestors({ limit, offset })]).pipe(
        switchMap(
          ([
            poolCurrency,
            { outstandingInvests, outstandingRedeems },
            { items: whitelistedInvestors, assets, pageInfo, totalCount },
          ]) => {
            if (whitelistedInvestors.length === 0) {
              return of({
                investors: [],
                pageInfo,
                totalCount,
              })
            }

            const positionQueries = whitelistedInvestors.map((investor) =>
              this._tokenInstancePosition({
                accountAddress: investor.address,
                centrifugeId: investor.centrifugeId,
                tokenId: this.id.raw,
              }).pipe(catchError(() => of(null)))
            )

            return combineLatest(positionQueries).pipe(
              map((positionResults) => {
                const investors = whitelistedInvestors.map((investor, i) => {
                  const positionData = positionResults[i]
                  const outstandingInvest = outstandingInvests.find((order) => order.investor === investor.address)
                  const outstandingRedeem = outstandingRedeems.find((order) => order.investor === investor.address)
                  const assetId = outstandingInvest?.assetId.toString()
                  const positionBalance = positionData?.balance ?? 0n
                  const assetDecimals =
                    assets.find((asset: { id: string; decimals: number }) => asset.id === assetId)?.decimals ?? 18
                  const isWhitelisted = parseInt(investor.validUntil, 10) > Date.now()

                  return {
                    address: investor.address,
                    amount: new Balance(outstandingInvest?.pendingAmount ?? 0n, assetDecimals),
                    centrifugeId: Number(investor.centrifugeId),
                    createdAt: investor.createdAt,
                    holdings: new Balance(positionBalance, poolCurrency.decimals),
                    isFrozen: investor.isFrozen ?? positionData?.isFrozen,
                    outstandingInvest: outstandingInvest
                      ? new Balance(outstandingInvest.pendingAmount, assetDecimals).scale(poolCurrency.decimals)
                      : new Balance(0n, poolCurrency.decimals),
                    outstandingRedeem: outstandingRedeem
                      ? new Balance(outstandingRedeem.pendingAmount, poolCurrency.decimals)
                      : new Balance(0n, poolCurrency.decimals),
                    queuedInvest: outstandingInvest
                      ? new Balance(outstandingInvest.queuedAmount, assetDecimals).scale(poolCurrency.decimals)
                      : new Balance(0n, poolCurrency.decimals),
                    queuedRedeem: outstandingRedeem
                      ? new Balance(outstandingRedeem.queuedAmount, poolCurrency.decimals)
                      : new Balance(0n, poolCurrency.decimals),
                    isWhitelisted,
                  }
                })

                investors.sort((a, b) => {
                  const aValue = BigInt(a.holdings.toBigInt())
                  const bValue = BigInt(b.holdings.toBigInt())
                  return aValue > bValue ? -1 : aValue < bValue ? 1 : 0
                })

                return {
                  investors,
                  pageInfo,
                  totalCount,
                }
              })
            )
          }
        )
      )
    )
  }

  /**
   * Retrieve investor orders of the share class.
   * @returns Investor orders
   */
  investorOrders() {
    const self = this

    return this._query(['investorOrders'], () =>
      self._investorOrders().pipe(
        switchMap((orders) =>
          combineLatest([
            ...orders.outstandingInvests.map((order) => self._investorOrder(order.assetId, order.investor)),
            ...orders.outstandingRedeems.map((order) => self._investorOrder(order.assetId, order.investor)),
          ]).pipe(
            map((investorOrders) => {
              const ordersByInvestor = new AddressMap<
                {
                  investor: HexString
                  assetId: AssetId
                  maxRedeemClaims: number
                  maxDepositClaims: number
                  pendingRedeem: bigint
                  pendingDeposit: bigint
                  queuedInvest: bigint
                  queuedRedeem: bigint
                }[]
              >()

              investorOrders.forEach((order) => {
                const key = order.investor

                if (ordersByInvestor.has(key)) {
                  const existing = ordersByInvestor.get(key)!
                  const existingForAsset = existing.find((e) => e.assetId.equals(order.assetId))

                  if (!existingForAsset) {
                    existing.push(order)
                  }
                } else {
                  ordersByInvestor.set(key, [order])
                }
              })

              return ordersByInvestor
            })
          )
        )
      )
    )
  }

  /**
   * Freeze a member of the share class.
   * @param address Address to freeze
   * @param centrifugeId Centrifuge ID of the network on which to freeze the member
   */
  freezeMember(address: HexString, centrifugeId: CentrifugeId) {
    const self = this

    return this._transact(async function* (ctx) {
      const [share, restrictionManager] = await Promise.all([
        firstValueFrom(self._share(centrifugeId)),
        firstValueFrom(self._restrictionManager(centrifugeId)),
      ])

      yield* wrapTransaction('Freeze member', ctx, {
        contract: restrictionManager,
        data: encodeFunctionData({
          abi: ABI.RestrictionManager,
          functionName: 'freeze',
          args: [share, address],
        }),
      })
    }, centrifugeId)
  }

  /**
   * Unfreeze a member of the share class
   * @param address Address to unfreeze
   * @param centrifugeId Centrifuge ID of the network on which to unfreeze the member
   */
  unfreezeMember(address: HexString, centrifugeId: CentrifugeId) {
    const self = this

    return this._transact(async function* (ctx) {
      const [share, restrictionManager] = await Promise.all([
        firstValueFrom(self._share(centrifugeId)),
        firstValueFrom(self._restrictionManager(centrifugeId)),
      ])

      yield* wrapTransaction('Unfreeze member', ctx, {
        contract: restrictionManager,
        data: encodeFunctionData({
          abi: ABI.RestrictionManager,
          functionName: 'unfreeze',
          args: [share, address],
        }),
      })
    }, centrifugeId)
  }

  /**
   * Get the pending and claimable investment/redeem amounts for all investors
   * in a given share class (per vault/chain)
   */
  investmentsByVault(centrifugeId: CentrifugeId) {
    return this._query(['investmentsByVault', centrifugeId], () =>
      combineLatest([this._investorOrders(), this.vaults(centrifugeId), this.pendingAmounts()]).pipe(
        switchMap(([orders, vaults, pendingAmounts]) => {
          if (!vaults.length) return of([])

          const allInvestors = new Set<HexString>()
          orders.outstandingInvests.forEach((o) => allInvestors.add(o.investor))
          orders.outstandingRedeems.forEach((o) => allInvestors.add(o.investor))

          if (allInvestors.size === 0) return of([])

          return combineLatest(
            vaults.map((vault) => {
              const vaultInvestors = new Set<HexString>()
              orders.outstandingInvests
                .filter((o) => o.assetId.equals(vault.assetId))
                .forEach((o) => vaultInvestors.add(o.investor))
              orders.outstandingRedeems
                .filter((o) => o.assetId.equals(vault.assetId))
                .forEach((o) => vaultInvestors.add(o.investor))

              if (vaultInvestors.size === 0) return of([])

              const pendingMatch = pendingAmounts.find(
                (p) => p.assetId.equals(vault.assetId) && p.centrifugeId === vault.centrifugeId
              )

              const allPendingIssuances = pendingMatch?.pendingIssuances ?? []
              const allPendingRevocations = pendingMatch?.pendingRevocations ?? []

              return combineLatest(
                Array.from(vaultInvestors).map((investor) =>
                  vault.investment(investor).pipe(
                    map((investment) => {
                      const pendingIssuances = allPendingIssuances.map((epoch) => ({
                        ...epoch,
                        assetId: vault.assetId,
                        centrifugeId: vault.centrifugeId,
                      }))

                      const pendingRevocations = allPendingRevocations.map((epoch) => ({
                        ...epoch,
                        assetId: vault.assetId,
                        centrifugeId: vault.centrifugeId,
                      }))

                      return {
                        investor,
                        investment,
                        assetId: vault.assetId,
                        centrifugeId: vault.centrifugeId,
                        pendingIssuances,
                        pendingRevocations,
                        pendingMatch,
                      }
                    }),
                    catchError(() =>
                      of({
                        investor,
                        investment: null,
                        assetId: vault.assetId,
                        centrifugeId: vault.centrifugeId,
                        pendingIssuances: [],
                        pendingRevocations: [],
                        pendingMatch: null,
                      })
                    )
                  )
                )
              )
            })
          ).pipe(
            map((vaultResults) => {
              const expandedRecords: Array<{
                investor: HexString
                assetId: AssetId
                centrifugeId: number
                epoch: number
                epochType: 'deposit' | 'issue' | 'redeem' | 'revoke'
                investorAmount: Balance
                totalEpochAmount: Balance
                claimableDepositShares?: Balance
                claimableRedeemAssets?: Balance
                pendingIssuances: any[]
                pendingRevocations: any[]
              }> = []

              vaultResults.forEach((vaultInvestments) => {
                // Group by asset to calculate totals
                const investmentsByAsset = new Map<string, typeof vaultInvestments>()
                vaultInvestments.forEach((inv) => {
                  const key = inv.assetId.toString()
                  if (!investmentsByAsset.has(key)) {
                    investmentsByAsset.set(key, [])
                  }
                  investmentsByAsset.get(key)!.push(inv)
                })

                investmentsByAsset.forEach((assetInvestments) => {
                  if (assetInvestments.length === 0) return

                  const totalPendingDeposits = assetInvestments.reduce(
                    (sum, inv) => {
                      if (!inv.investment) return sum
                      return sum.add(inv.investment.pendingDepositAssets)
                    },
                    new Balance(0n, assetInvestments[0]?.investment?.pendingDepositAssets?.decimals ?? 18)
                  )

                  const totalPendingRedeems = assetInvestments.reduce(
                    (sum, inv) => {
                      if (!inv.investment) return sum
                      return sum.add(inv.investment.pendingRedeemShares)
                    },
                    new Balance(0n, assetInvestments[0]?.investment?.pendingRedeemShares?.decimals ?? 18)
                  )

                  assetInvestments.forEach((inv) => {
                    if (!inv.investment || !inv.pendingMatch) return

                    if (inv.pendingMatch.depositEpoch !== undefined && !inv.investment.pendingDepositAssets.isZero()) {
                      const investorRatio = totalPendingDeposits.isZero()
                        ? 0
                        : inv.investment.pendingDepositAssets.toDecimal().div(totalPendingDeposits.toDecimal())
                      const investorAmount = Balance.fromFloat(
                        inv.pendingMatch.pendingDeposit.toDecimal().mul(investorRatio),
                        inv.pendingMatch.pendingDeposit.decimals
                      )

                      expandedRecords.push({
                        investor: inv.investor,
                        assetId: inv.assetId,
                        centrifugeId: inv.centrifugeId,
                        epoch: inv.pendingMatch.depositEpoch,
                        epochType: 'deposit',
                        investorAmount,
                        totalEpochAmount: inv.pendingMatch.pendingDeposit,
                        claimableDepositShares: inv.investment.claimableDepositShares,
                        pendingIssuances: inv.pendingIssuances,
                        pendingRevocations: inv.pendingRevocations,
                      })
                    }

                    inv.pendingIssuances.forEach((issuance) => {
                      if (!inv.investment.pendingDepositAssets.isZero()) {
                        const investorRatio = totalPendingDeposits.isZero()
                          ? 0
                          : inv.investment.pendingDepositAssets.toDecimal().div(totalPendingDeposits.toDecimal())
                        const investorAmount = Balance.fromFloat(
                          issuance.amount.toDecimal().mul(investorRatio),
                          issuance.amount.decimals
                        )

                        expandedRecords.push({
                          investor: inv.investor,
                          assetId: inv.assetId,
                          centrifugeId: inv.centrifugeId,
                          epoch: issuance.epoch,
                          epochType: 'issue',
                          investorAmount,
                          totalEpochAmount: issuance.amount,
                          claimableDepositShares: inv.investment.claimableDepositShares,
                          pendingIssuances: inv.pendingIssuances,
                          pendingRevocations: inv.pendingRevocations,
                        })
                      }
                    })

                    if (inv.pendingMatch.redeemEpoch !== undefined && !inv.investment.pendingRedeemShares.isZero()) {
                      const investorRatio = totalPendingRedeems.isZero()
                        ? 0
                        : inv.investment.pendingRedeemShares.toDecimal().div(totalPendingRedeems.toDecimal())
                      const investorAmount = Balance.fromFloat(
                        inv.pendingMatch.pendingRedeem.toDecimal().mul(investorRatio),
                        inv.pendingMatch.pendingRedeem.decimals
                      )

                      expandedRecords.push({
                        investor: inv.investor,
                        assetId: inv.assetId,
                        centrifugeId: inv.centrifugeId,
                        epoch: inv.pendingMatch.redeemEpoch,
                        epochType: 'redeem',
                        investorAmount,
                        totalEpochAmount: inv.pendingMatch.pendingRedeem,
                        claimableRedeemAssets: inv.investment.claimableRedeemAssets,
                        pendingIssuances: inv.pendingIssuances,
                        pendingRevocations: inv.pendingRevocations,
                      })
                    }

                    inv.pendingRevocations.forEach((revocation) => {
                      if (!inv.investment.pendingRedeemShares.isZero()) {
                        const investorRatio = totalPendingRedeems.isZero()
                          ? 0
                          : inv.investment.pendingRedeemShares.toDecimal().div(totalPendingRedeems.toDecimal())
                        const investorAmount = Balance.fromFloat(
                          revocation.amount.toDecimal().mul(investorRatio),
                          revocation.amount.decimals
                        )

                        expandedRecords.push({
                          investor: inv.investor,
                          assetId: inv.assetId,
                          centrifugeId: inv.centrifugeId,
                          epoch: revocation.epoch,
                          epochType: 'revoke',
                          investorAmount,
                          totalEpochAmount: revocation.amount,
                          claimableRedeemAssets: inv.investment.claimableRedeemAssets,
                          pendingIssuances: inv.pendingIssuances,
                          pendingRevocations: inv.pendingRevocations,
                        })
                      }
                    })
                  })
                })
              })

              return expandedRecords
            })
          )
        })
      )
    )
  }

  /**
   * Get closed investment orders
   * @returns Closed investment orders where shares have been issued
   */
  closedInvestments() {
    return this._query(['closedInvestments'], () =>
      this._root
        ._queryIndexer(
          `query ($scId: String!) {
            epochInvestOrders(where: {tokenId: $scId}, limit: 1000) {
              items {
                assetId
                index
                issuedAt
                approvedAt
                issuedSharesAmount
                approvedAssetsAmount
                issuedWithNavPoolPerShare
                issuedWithNavAssetPerShare
                asset {
                  decimals
                  symbol
                  name
                  centrifugeId
                }
                token {
                  decimals
                }
              }
            }
          }`,
          { scId: this.id.raw },
          (data: any) => data.epochInvestOrders.items
        )
        .pipe(
          switchMap((epochs: any[]) => {
            if (epochs.length === 0) return of([])

            return combineLatest(
              epochs.map((epochData: any) =>
                this._root._queryIndexer(
                  `query ($scId: String!, $assetId: BigInt!, $index: Int!) {
                    investOrders(where: {
                      tokenId: $scId,
                      assetId: $assetId,
                      index: $index,
                      issuedAt_not: null
                    }, limit: 1000) {
                      items {
                        account
                        index
                        assetId
                        approvedAssetsAmount
                        approvedAt
                        issuedSharesAmount
                        issuedAt
                        issuedWithNavAssetPerShare
                        issuedWithNavPoolPerShare
                        claimedAt
                        claimedAtBlock
                        asset {
                          id
                          decimals
                          symbol
                          name
                          centrifugeId
                        }
                        token {
                          decimals
                          }
                        }
                      }
                    }
                  }`,
                  { scId: this.id.raw, assetId: epochData.assetId, index: epochData.index },
                  (orderData: any) => ({ epochData, orders: orderData.investOrders.items })
                )
              )
            )
          }),
          map((results: any[]) => {
            const allOrders: any[] = []

            results.forEach((result: any) => {
              const { epochData, orders } = result

              if (orders.length === 0 && epochData.issuedAt) {
                allOrders.push({
                  investor: null,
                  index: epochData.index,
                  assetId: new AssetId(epochData.assetId),
                  approvedAmount: new Balance(epochData.approvedAssetsAmount || 0n, epochData.asset.decimals),
                  approvedAt: epochData.approvedAt ? epochData.approvedAt : null,
                  issuedAmount: new Balance(epochData.issuedSharesAmount || 0n, epochData.token.decimals),
                  issuedAt: epochData.issuedAt,
                  priceAsset: new Price(epochData.issuedWithNavAssetPerShare || 0n),
                  pricePerShare: new Price(epochData.issuedWithNavPoolPerShare || 0n),
                  claimedAt: null,
                  isClaimed: false,
                  asset: {
                    symbol: epochData.asset.symbol,
                    name: epochData.asset.name,
                    decimals: epochData.asset.decimals,
                  },
                  chainId: epochData.asset.blockchain.chainId,
                  token: {
                    decimals: epochData.token.decimals,
                  },
                })
              } else {
                orders.forEach((order: any) => {
                  allOrders.push({
                    investor: order.account.toLowerCase() as HexString,
                    index: order.index,
                    assetId: new AssetId(order.assetId),
                    approvedAmount: new Balance(order.approvedAssetsAmount || 0n, order.asset.decimals),
                    approvedAt: order.approvedAt ? order.approvedAt : null,
                    issuedAmount: new Balance(order.issuedSharesAmount || 0n, order.token.decimals),
                    issuedAt: order.issuedAt ? order.issuedAt : null,
                    priceAsset: new Price(order.issuedWithNavAssetPerShare || 0n),
                    pricePerShare: new Price(order.issuedWithNavPoolPerShare || 0n),
                    claimedAt: order.claimedAt ? order.claimedAt : null,
                    isClaimed: !!order.claimedAtBlock,
                    asset: {
                      symbol: order.asset.symbol,
                      name: order.asset.name,
                      decimals: order.asset.decimals,
                    },
                    chainId: order.asset.blockchain.chainId,
                    token: {
                      decimals: order.token.decimals,
                    },
                  })
                })
              }
            })

            return allOrders
          })
        )
    )
  }

  /**
   * Get closed redemption orders
   * @returns Closed redemption orders where shares have been revoked
   */
  closedRedemptions() {
    return this._query(['closedRedemptions'], () =>
      this._root
        ._queryIndexer(
          `query ($scId: String!) {
            epochRedeemOrders(where: {tokenId: $scId}, limit: 1000) {
              items {
                assetId
                index
                revokedAt
                approvedAt
                approvedSharesAmount
                revokedSharesAmount
                revokedAssetsAmount
                revokedWithNavPoolPerShare
                revokedWithNavAssetPerShare
                asset {
                  decimals
                  symbol
                  name
                  centrifugeId
                }
                token {
                  decimals
                }
              }
            }
          }`,
          { scId: this.id.raw },
          (data: any) => data.epochRedeemOrders.items
        )
        .pipe(
          switchMap((epochs: any[]) => {
            if (epochs.length === 0) return of([])

            return combineLatest(
              epochs.map((epochData: any) =>
                this._root._queryIndexer(
                  `query ($scId: String!, $assetId: BigInt!, $index: Int!) {
                    redeemOrders(where: {
                      tokenId: $scId,
                      assetId: $assetId,
                      index: $index,
                      revokedAt_not: null
                    }, limit: 1000) {
                      items {
                        account
                        index
                        assetId
                        approvedSharesAmount
                        approvedAt
                        revokedAssetsAmount
                        revokedAt
                        revokedWithNavAssetPerShare
                        revokedWithNavPoolPerShare
                        claimedAt
                        claimedAtBlock
                        asset {
                          id
                          decimals
                          symbol
                          name
                          centrifugeId
                        }
                        token {
                          decimals
                        }
                      }
                    }
                  }`,
                  { scId: this.id.raw, assetId: epochData.assetId, index: epochData.index },
                  (orderData: any) => ({ epochData, orders: orderData.redeemOrders.items })
                )
              )
            )
          }),
          map((results: any[]) => {
            const allOrders: any[] = []

            results.forEach((result: any) => {
              const { epochData, orders } = result

              if (orders.length === 0 && epochData.revokedAt) {
                allOrders.push({
                  investor: null,
                  index: epochData.index,
                  assetId: new AssetId(epochData.assetId),
                  approvedAmount: new Balance(epochData.approvedSharesAmount || 0n, epochData.token.decimals),
                  approvedAt: epochData.approvedAt ? epochData.approvedAt : null,
                  payoutAmount: new Balance(epochData.revokedAssetsAmount || 0n, epochData.asset.decimals),
                  revokedAt: epochData.revokedAt,
                  priceAsset: new Price(epochData.revokedWithNavAssetPerShare || 0n),
                  pricePerShare: new Price(epochData.revokedWithNavPoolPerShare || 0n),
                  claimedAt: null,
                  isClaimed: false,
                  asset: {
                    symbol: epochData.asset.symbol,
                    name: epochData.asset.name,
                    decimals: epochData.asset.decimals,
                  },
                  chainId: epochData.asset.blockchain.chainId,
                  token: {
                    decimals: epochData.token.decimals,
                  },
                })
              } else {
                orders.forEach((order: any) => {
                  allOrders.push({
                    investor: order.account.toLowerCase() as HexString,
                    index: order.index,
                    assetId: new AssetId(order.assetId),
                    approvedAmount: new Balance(order.approvedSharesAmount || 0n, order.token.decimals),
                    approvedAt: order.approvedAt ? order.approvedAt : null,
                    payoutAmount: new Balance(order.revokedAssetsAmount || 0n, order.asset.decimals),
                    revokedAt: order.revokedAt ? order.revokedAt : null,
                    priceAsset: new Price(order.revokedWithNavAssetPerShare || 0n),
                    pricePerShare: new Price(order.revokedWithNavPoolPerShare || 0n),
                    claimedAt: order.claimedAt ? order.claimedAt : null,
                    isClaimed: !!order.claimedAtBlock,
                    asset: {
                      symbol: order.asset.symbol,
                      name: order.asset.name,
                      decimals: order.asset.decimals,
                    },
                    chainId: order.asset.blockchain.chainId,
                    token: {
                      decimals: order.token.decimals,
                    },
                  })
                })
              }
            })

            return allOrders
          })
        )
    )
  }

  /**
   * Get the valuation contract address for this share class on a specific chain.
   * @param centrifugeId
   */
  valuation(centrifugeId: CentrifugeId) {
    return this._query(['valuation', centrifugeId], () =>
      combineLatest([this._root._protocolAddresses(centrifugeId), this._root.getClient(centrifugeId)]).pipe(
        switchMap(([{ syncManager }, client]) =>
          defer(async () => {
            const valuation = await client.readContract({
              address: syncManager,
              abi: ABI.SyncManager,
              functionName: 'valuation',
              args: [this.pool.id.raw, this.id.raw],
            })
            return valuation as HexString
          }).pipe(
            repeatOnEvents(
              this._root,
              {
                address: syncManager,
                eventName: ['SetValuation'],
                filter: (events) =>
                  events.some((event) => event.args.poolId === this.pool.id.raw && event.args.scId === this.id.raw),
              },
              centrifugeId
            )
          )
        )
      )
    )
  }

  /**
   * Set the default valuation contract for this share class on a specific chain.
   * @param centrifugeId - The centrifuge ID where the valuation should be updated
   * @param valuation - The address of the valuation contract
   */
  updateValuation(centrifugeId: CentrifugeId, valuation: HexString) {
    const self = this
    return this._transact(async function* (ctx) {
      const [{ hub }, spokeAddresses] = await Promise.all([
        self._root._protocolAddresses(self.pool.centrifugeId),
        self._root._protocolAddresses(centrifugeId),
      ])

      yield* wrapTransaction('Update valuation', ctx, {
        contract: hub,
        data: encodeFunctionData({
          abi: ABI.Hub,
          functionName: 'updateContract',
          args: [
            self.pool.id.raw,
            self.id.raw,
            centrifugeId,
            addressToBytes32(spokeAddresses.syncManager),
            encode([VaultManagerTrustedCall.Valuation, addressToBytes32(valuation)]),
            0n,
            ctx.signingAddress,
          ],
        }),
        messages: { [centrifugeId]: [MessageType.TrustedContractUpdate] },
      })
    }, this.pool.centrifugeId)
  }

  /**
   * Update the hook for this share class on a specific chain.
   * @param centrifugeId - The centrifuge ID where the hook should be updated
   * @param hook - The address of the new hook contract
   */
  updateHook(centrifugeId: CentrifugeId, hook: HexString) {
    const self = this
    return this._transact(async function* (ctx) {
      const { hub } = await self._root._protocolAddresses(self.pool.centrifugeId)

      yield* wrapTransaction('Update hook', ctx, {
        contract: hub,
        data: encodeFunctionData({
          abi: ABI.Hub,
          functionName: 'updateShareHook',
          args: [self.pool.id.raw, self.id.raw, centrifugeId, addressToBytes32(hook), ctx.signingAddress],
        }),
        messages: { [centrifugeId]: [MessageType.UpdateShareHook] },
      })
    }, this.pool.centrifugeId)
  }

  /**
   * Update both (or one of) the hook and valuation for this share class on a specific chain in a single transaction.
   * @param centrifugeId - The centrifuge ID where the updates should be applied
   * @param hook - The address of the new hook contract (optional)
   * @param valuation - The address of the new valuation contract (optional)
   */
  updateHookAndValuation(centrifugeId: CentrifugeId, hook?: HexString, valuation?: HexString) {
    if (!hook && !valuation) {
      throw new Error('At least one of hook or valuation must be provided')
    }

    const self = this
    return this._transact(async function* (ctx) {
      const [{ hub }, spokeAddresses] = await Promise.all([
        self._root._protocolAddresses(self.pool.centrifugeId),
        self._root._protocolAddresses(centrifugeId),
      ])

      const calls: HexString[] = []
      const messages: MessageType[] = []

      if (hook) {
        calls.push(
          encodeFunctionData({
            abi: ABI.Hub,
            functionName: 'updateShareHook',
            args: [self.pool.id.raw, self.id.raw, centrifugeId, addressToBytes32(hook), ctx.signingAddress],
          })
        )
        messages.push(MessageType.UpdateShareHook)
      }

      if (valuation) {
        calls.push(
          encodeFunctionData({
            abi: ABI.Hub,
            functionName: 'updateContract',
            args: [
              self.pool.id.raw,
              self.id.raw,
              centrifugeId,
              addressToBytes32(spokeAddresses.syncManager),
              encodePacked(['uint8', 'bytes32'], [/* UpdateContractType.Valuation */ 1, addressToBytes32(valuation)]),
              0n,
              ctx.signingAddress,
            ],
          })
        )
        messages.push(MessageType.TrustedContractUpdate)
      }

      const title = hook && valuation ? 'Update hook and valuation' : hook ? 'Update hook' : 'Update valuation'

      yield* wrapTransaction(title, ctx, {
        contract: hub,
        data: calls,
        messages: { [centrifugeId]: messages },
      })
    }, this.pool.centrifugeId)
  }

  /** @internal */
  _balances() {
    return this._root._queryIndexer(
      `query ($scId: String!) {
        holdingEscrows(where: { tokenId: $scId }) {
          items {
            holding {
              createdAt
            }
            assetAmount
            assetPrice
            assetId
            centrifugeId
            asset {
              decimals
              assetTokenId
              address
              name
              symbol
              blockchain {
                id
                centrifugeId
              }
            }
          }
        }
      }`,
      {
        scId: this.id.raw,
      },
      (data: {
        holdingEscrows: {
          items: {
            centrifugeId: string
            holding: {
              createdAt: string | null
            }
            assetId: string
            assetAmount: string
            assetPrice: string
            asset: {
              decimals: number
              assetTokenId: string
              address: HexString
              name: string
              symbol: string
              blockchain: { id: string; centrifugeId: string }
            }
          }[]
        }
      }) => data.holdingEscrows.items
    )
  }

  /** @internal */
  _holding(assetId: AssetId) {
    return this._query(['holding', assetId.toString()], () =>
      combineLatest([
        this._root._protocolAddresses(this.pool.centrifugeId),
        this.pool.currency(),
        this._root._assetDecimals(assetId, this.pool.centrifugeId),
      ]).pipe(
        switchMap(([{ holdings: holdingsAddr }, poolCurrency, assetDecimals]) =>
          defer(async () => {
            const client = await firstValueFrom(this._root.getClient(this.pool.centrifugeId))
            const holdings = getContract({
              address: holdingsAddr,
              abi: ABI.Holdings,
              client,
            })

            const [valuation, amount, value, isLiability, ...accounts] = await Promise.all([
              holdings.read.valuation([this.pool.id.raw, this.id.raw, assetId.raw]),
              holdings.read.amount([this.pool.id.raw, this.id.raw, assetId.raw]),
              holdings.read.value([this.pool.id.raw, this.id.raw, assetId.raw]),
              holdings.read.isLiability([this.pool.id.raw, this.id.raw, assetId.raw]),
              ...[
                AccountType.Asset,
                AccountType.Equity,
                AccountType.Loss,
                AccountType.Gain,
                AccountType.Expense,
                AccountType.Liability,
              ].map((kind) => holdings.read.accountId([this.pool.id.raw, this.id.raw, assetId.raw, kind])),
            ])
            return {
              assetId,
              assetDecimals,
              valuation,
              amount: new Balance(amount, assetDecimals),
              value: new Balance(value, poolCurrency.decimals),
              isLiability,
              accounts: {
                [AccountType.Asset]: accounts[0] || null,
                [AccountType.Equity]: accounts[1] || null,
                [AccountType.Loss]: accounts[2] || null,
                [AccountType.Gain]: accounts[3] || null,
                [AccountType.Expense]: accounts[4] || null,
                [AccountType.Liability]: accounts[5] || null,
              },
            }
          }).pipe(
            repeatOnEvents(
              this._root,
              {
                address: holdingsAddr,
                eventName: ['Increase', 'Decrease', 'Update', 'UpdateValuation'],
                filter: (events) => {
                  return events.some((event) => {
                    return event.args.scId === this.id && event.args.assetId === assetId.raw
                  })
                },
              },
              this.pool.centrifugeId
            )
          )
        )
      )
    )
  }

  /** @internal */
  _balance(
    centrifugeId: CentrifugeId,
    asset: { address: HexString; assetTokenId?: bigint; id: AssetId; decimals: number }
  ) {
    return this._query(['balance', asset.id.toString()], () =>
      combineLatest([
        this._root._protocolAddresses(centrifugeId),
        this.pool.currency(),
        this._root.getClient(centrifugeId),
      ]).pipe(
        switchMap(([addresses, poolCurrency, client]) =>
          defer(async () => {
            const [amountBn, priceBn] = await Promise.all([
              client.readContract({
                address: addresses.balanceSheet,
                abi: ABI.BalanceSheet,
                functionName: 'availableBalanceOf',
                args: [this.pool.id.raw, this.id.raw, asset.address, BigInt(asset.assetTokenId ?? 0n)],
              }),
              client.readContract({
                address: addresses.spoke,
                abi: ABI.Spoke,
                functionName: 'pricePoolPerAsset',
                args: [this.pool.id.raw, this.id.raw, asset.id.raw, false],
              }),
            ])

            const amount = new Balance(amountBn, asset.decimals)
            const price = new Price(priceBn)
            const value = Balance.fromFloat(amount.toDecimal().mul(price.toDecimal()), poolCurrency.decimals)

            return {
              amount,
              value,
              price,
            }
          }).pipe(
            repeatOnEvents(
              this._root,
              {
                address: [addresses.balanceSheet, addresses.spoke],
                eventName: ['NoteDeposit', 'Deposit', 'Withdraw', 'UpdateAssetPrice'],
                filter: (events) => {
                  return events.some(
                    (event) =>
                      event.args.scId === this.id.raw &&
                      // UpdateAssetPrice event
                      (event.args.assetId === asset.id.raw ||
                        // NoteDeposit, Deposit, Withdraw events
                        event.args.asset?.toLowerCase() === asset.address?.toLowerCase())
                  )
                },
              },
              centrifugeId
            )
          )
        )
      )
    )
  }

  /** @internal */
  _investorOrders() {
    return this._root._queryIndexer(
      `query ($scId: String!) {
        investOrders(where: {tokenId: $scId}) {
          items {
            account
            approvedAssetsAmount
            approvedAt
            assetId
            claimedSharesAmount
            claimedAt
            issuedSharesAmount
            issuedAt
            postedAssetsAmount
            postedAt
            vaultDeposit {
              assetsAmount
            }
          }
        }
        redeemOrders(where: {tokenId: $scId}) {
          items {
            account
            assetId
            tokenId
            approvedSharesAmount
            approvedAt
            claimedAssetsAmount
            claimedAt
            postedSharesAmount
            postedAt
            revokedSharesAmount
            revokedAssetsAmount
            revokedPoolAmount
            revokedAt
            vaultRedeem {
              sharesAmount
            }
          }
        }
        }`,
      { scId: this.id.raw },
      (data: {
        investOrders: {
          items: {
            account: HexString
            approvedAssetsAmount: string
            approvedAt: string | null
            assetId: string
            claimedSharesAmount: string
            claimedAt: string | null
            issuedSharesAmount: string
            issuedAt: string | null
            postedAssetsAmount: string
            postedAt: string | null
            vaultDeposit?: {
              assetsAmount: string
            }
          }[]
        }
        redeemOrders: {
          items: {
            account: HexString
            assetId: string
            tokenId: HexString
            approvedSharesAmount: string
            approvedAt: string | null
            claimedAssetsAmount: string
            claimedAt: string | null
            postedSharesAmount: string
            postedAt: string | null
            revokedSharesAmount: string
            revokedAssetsAmount: string
            revokedPoolAmount: string
            revokedAt: string | null
            vaultRedeem?: {
              sharesAmount: string
            }
          }[]
        }
      }) => ({
        investOrders: data.investOrders.items.map((item) => ({
          ...item,
          assetId: new AssetId(item.assetId),
          account: item.account.toLowerCase() as HexString,
          investor: item.account.toLowerCase() as HexString,
        })),
        outstandingInvests: data.investOrders.items.map((item) => ({
          assetId: new AssetId(item.assetId),
          account: item.account.toLowerCase() as HexString,
          investor: item.account.toLowerCase() as HexString,
          pendingAmount: item.approvedAt === null ? item.postedAssetsAmount : '',
          queuedAmount: !item.vaultDeposit?.assetsAmount
            ? ''
            : String(BigInt(item.vaultDeposit?.assetsAmount) - BigInt(item.postedAssetsAmount)),
        })),
        redeemOrders: data.redeemOrders.items.map((item) => ({
          ...item,
          assetId: new AssetId(item.assetId),
          account: item.account.toLowerCase() as HexString,
          investor: item.account.toLowerCase() as HexString,
        })),
        outstandingRedeems: data.redeemOrders.items.map((item) => ({
          assetId: new AssetId(item.assetId),
          account: item.account.toLowerCase() as HexString,
          investor: item.account.toLowerCase() as HexString,
          pendingAmount: item.approvedAt === null ? item.postedSharesAmount : '',
          queuedAmount: !item.vaultRedeem?.sharesAmount
            ? ''
            : String(BigInt(item.vaultRedeem?.sharesAmount) - BigInt(item.postedSharesAmount)),
        })),
      })
    )
  }

  /** @internal */
  _investorOrder(assetId: AssetId, investor: HexString) {
    return this._query(['investorOrder', assetId.toString(), investor.toLowerCase()], () =>
      combineLatest([
        this._root._protocolAddresses(this.pool.centrifugeId),
        this._root.getClient(this.pool.centrifugeId),
      ]).pipe(
        switchMap(([{ batchRequestManager }, client]) =>
          defer(async () => {
            const contract = getContract({
              address: batchRequestManager,
              abi: ABI.BatchRequestManager,
              client,
            })

            const [
              maxDepositClaims,
              maxRedeemClaims,
              [pendingDeposit],
              [pendingRedeem],
              [, queuedInvest],
              [, queuedRedeem],
            ] = await Promise.all([
              contract.read.maxDepositClaims([this.pool.id.raw, this.id.raw, addressToBytes32(investor), assetId.raw]),
              contract.read.maxRedeemClaims([this.pool.id.raw, this.id.raw, addressToBytes32(investor), assetId.raw]),
              contract.read.depositRequest([this.pool.id.raw, this.id.raw, assetId.raw, addressToBytes32(investor)]),
              contract.read.redeemRequest([this.pool.id.raw, this.id.raw, assetId.raw, addressToBytes32(investor)]),
              contract.read.queuedDepositRequest([
                this.pool.id.raw,
                this.id.raw,
                assetId.raw,
                addressToBytes32(investor),
              ]),
              contract.read.queuedRedeemRequest([
                this.pool.id.raw,
                this.id.raw,
                assetId.raw,
                addressToBytes32(investor),
              ]),
            ])

            return {
              assetId,
              investor,
              maxDepositClaims,
              maxRedeemClaims,
              pendingDeposit,
              pendingRedeem,
              queuedInvest,
              queuedRedeem,
            }
          }).pipe(
            repeatOnEvents(
              this._root,
              {
                address: batchRequestManager,
                eventName: [
                  'UpdateDepositRequest',
                  'UpdateRedeemRequest',
                  'ClaimDeposit',
                  'ClaimRedeem',
                  'ApproveDeposits',
                  'ApproveRedeems',
                ],
                filter: (events) => {
                  return events.some(
                    (event) =>
                      event.args.scId === this.id.raw &&
                      (event.args.depositAssetId === assetId.raw || event.args.payoutAssetId === assetId.raw)
                  )
                },
              },
              this.pool.centrifugeId
            )
          )
        )
      )
    )
  }

  /** @internal */
  _allVaults() {
    return this._root._queryIndexer(
      `query ($scId: String!) {
          vaults(where: { tokenId: $scId }) {
            items {
              asset {
                id
              }
              address: id
              poolId
              assetAddress
              status
              blockchain {
                centrifugeId
              }
            }
          }
        }`,
      { scId: this.id.raw },
      (data: {
        vaults: {
          items: {
            address: HexString
            poolId: string
            assetAddress: HexString
            blockchain: { centrifugeId: string }
            asset: { id: string }
            status: 'Linked' | 'Unlinked'
          }[]
        }
      }) =>
        data.vaults.items.map(({ blockchain, asset, ...rest }) => ({
          ...rest,
          centrifugeId: Number(blockchain.centrifugeId),
          assetId: new AssetId(asset.id),
        }))
    )
  }

  /** @internal */
  _metadata() {
    return this._query(['metadata'], () =>
      this._root._protocolAddresses(this.pool.centrifugeId).pipe(
        switchMap(({ shareClassManager }) =>
          defer(async () => {
            const client = await firstValueFrom(this._root.getClient(this.pool.centrifugeId))
            const [name, symbol] = await client.readContract({
              address: shareClassManager,
              abi: ABI.ShareClassManager,
              functionName: 'metadata',
              args: [this.pool.id.raw, this.id.raw],
            })
            return {
              name,
              symbol,
            }
          }).pipe(
            repeatOnEvents(
              this._root,
              {
                address: shareClassManager,
                eventName: 'UpdateMetadata',
                filter: (events) => {
                  return events.some((event) => {
                    return event.args.scId === this.id
                  })
                },
              },
              this.pool.centrifugeId
            )
          )
        )
      )
    )
  }

  /** @internal */
  _metrics() {
    return this._query(['metrics'], () =>
      combineLatest([
        this._root._protocolAddresses(this.pool.centrifugeId),
        this._root.getClient(this.pool.centrifugeId),
      ]).pipe(
        switchMap(([{ shareClassManager }, client]) =>
          defer(async () => {
            const contract = getContract({
              address: shareClassManager,
              abi: ABI.ShareClassManager,
              client,
            })

            const [totalIssuance, [pricePerShare]] = await Promise.all([
              contract.read.totalIssuance([this.pool.id.raw, this.id.raw]),
              contract.read.pricePoolPerShare([this.pool.id.raw, this.id.raw]),
            ])

            return {
              totalIssuance: new Balance(totalIssuance, 18),
              pricePerShare: new Price(pricePerShare),
            }
          }).pipe(
            repeatOnEvents(
              this._root,
              {
                address: shareClassManager,
                eventName: [
                  'RevokeShares',
                  'IssueShares',
                  'RemoteIssueShares',
                  'RemoteRevokeShares',
                  'UpdateShareClass',
                ],
                filter: (events) => {
                  return events.some((event) => {
                    return event.args.scId === this.id.raw
                  })
                },
              },
              this.pool.centrifugeId
            )
          )
        )
      )
    )
  }

  /** @internal */
  _epochInvestOrders() {
    return this._query(['epochInvestOrders'], () =>
      this._root._queryIndexer(
        `query ($scId: String!) {
          epochInvestOrders(where: {tokenId: $scId, issuedAt: null, approvedAt_not: null}, limit: 1000) {
            items {
              approvedAt
              assetId
              index
            }
          }
        }`,
        { scId: this.id.raw },
        (data: {
          epochInvestOrders: {
            items: {
              approvedAt: Date
              assetId: AssetId
              index: number
            }[]
          }
        }) => {
          const ordersMap = new Map<string, { approvedAt: Date; assetId: AssetId; index: number }[]>()

          data.epochInvestOrders.items.forEach((item) => {
            const key = item.assetId.toString()
            if (!ordersMap.has(key)) {
              ordersMap.set(key, [])
            }

            ordersMap.get(key)![item.index] = {
              approvedAt: item.approvedAt,
              assetId: item.assetId,
              index: item.index,
            }
          })

          return ordersMap
        }
      )
    )
  }

  /** @internal */
  _epochRedeemOrders() {
    return this._query(['epochRedeemOrders'], () =>
      this._root._queryIndexer(
        `query ($scId: String!) {
          epochRedeemOrders(where: {tokenId: $scId, revokedAt: null, approvedAt_not: null}, limit: 1000) {
            items {
              approvedAt
              assetId
              index
            }
          }
        }`,
        { scId: this.id.raw },
        (data: {
          epochRedeemOrders: {
            items: {
              approvedAt: Date
              assetId: AssetId
              index: number
            }[]
          }
        }) => {
          const ordersMap = new Map<string, { approvedAt: Date; assetId: AssetId; index: number }[]>()

          data.epochRedeemOrders.items.forEach((item) => {
            const key = item.assetId.toString()
            if (!ordersMap.has(key)) {
              ordersMap.set(key, [])
            }

            ordersMap.get(key)![item.index] = {
              approvedAt: item.approvedAt,
              assetId: item.assetId,
              index: item.index,
            }
          })

          return ordersMap
        }
      )
    )
  }

  /** @internal */
  _epoch(assetId: AssetId) {
    return this._query(['epoch', assetId.toString()], () =>
      combineLatest([
        this._root._protocolAddresses(this.pool.centrifugeId),
        this.pool.currency(),
        this._root._assetDecimals(assetId, this.pool.centrifugeId),
        this._epochInvestOrders(),
        this._epochRedeemOrders(),
        this._root.getClient(this.pool.centrifugeId),
      ]).pipe(
        switchMap(
          ([{ batchRequestManager }, poolCurrency, assetDecimals, epochInvestOrders, epochRedeemOrders, client]) =>
            defer(async () => {
              const scm = getContract({
                address: batchRequestManager,
                abi: ABI.BatchRequestManager,
                client,
              })

              const [epoch, pendingDeposit, pendingRedeem] = await Promise.all([
                scm.read.epochId([this.pool.id.raw, this.id.raw, assetId.raw]),
                scm.read.pendingDeposit([this.pool.id.raw, this.id.raw, assetId.raw]),
                scm.read.pendingRedeem([this.pool.id.raw, this.id.raw, assetId.raw]),
              ])

              const depositEpoch = epoch[0] + 1
              const redeemEpoch = epoch[1] + 1
              const issueEpoch = epoch[2] + 1
              const revokeEpoch = epoch[3] + 1

              const [depositEpochAmounts, redeemEpochAmount] = await Promise.all([
                Promise.all(
                  Array.from({ length: depositEpoch - issueEpoch }).map((_, i) =>
                    scm.read.epochInvestAmounts([this.pool.id.raw, this.id.raw, assetId.raw, issueEpoch + i])
                  )
                ),
                Promise.all(
                  Array.from({ length: redeemEpoch - revokeEpoch }).map((_, i) =>
                    scm.read.epochRedeemAmounts([this.pool.id.raw, this.id.raw, assetId.raw, revokeEpoch + i])
                  )
                ),
              ])

              const approvedDeposit = depositEpochAmounts.reduce((acc, amount) => acc + amount[1], 0n)
              const approvedRedeem = redeemEpochAmount.reduce((acc, amount) => acc + amount[1], 0n)

              return {
                depositEpoch,
                redeemEpoch,
                issueEpoch,
                revokeEpoch,
                pendingDeposit: new Balance(pendingDeposit, assetDecimals),
                pendingRedeem: new Balance(pendingRedeem, poolCurrency.decimals),
                pendingIssuancesTotal: new Balance(approvedDeposit, assetDecimals),
                pendingIssuances: depositEpochAmounts.map(([, amount], i) => ({
                  amount: new Balance(amount, assetDecimals),
                  approvedAt: epochInvestOrders.get(assetId.toString())?.[issueEpoch + i]?.approvedAt,
                  epoch: issueEpoch + i,
                })),
                pendingRevocationsTotal: new Balance(approvedRedeem, poolCurrency.decimals),
                pendingRevocations: redeemEpochAmount.map(([, amount], i) => ({
                  amount: new Balance(amount, poolCurrency.decimals),
                  approvedAt: epochRedeemOrders.get(assetId.toString())?.[revokeEpoch + i]?.approvedAt,
                  epoch: revokeEpoch + i,
                })),
              }
            }).pipe(
              repeatOnEvents(
                this._root,
                {
                  address: batchRequestManager,
                  eventName: [
                    'ApproveDeposits',
                    'ApproveRedeems',
                    'IssueShares',
                    'RevokeShares',
                    'RemoteIssueShares',
                    'RemoteRevokeShares',
                    'UpdateDepositRequest',
                    'UpdateRedeemRequest',
                  ],
                  filter: (events) => {
                    return events.some((event) => {
                      return event.args.scId === this.id.raw
                    })
                  },
                },
                this.pool.centrifugeId
              )
            )
        )
      )
    )
  }

  /** @internal */
  _updateContract(centrifugeId: CentrifugeId, target: HexString, payload: HexString) {
    const self = this
    return this._transact(async function* (ctx) {
      const { hub } = await self._root._protocolAddresses(self.pool.centrifugeId)
      yield* wrapTransaction('Update contract', ctx, {
        contract: hub,
        data: encodeFunctionData({
          abi: ABI.Hub,
          functionName: 'updateContract',
          args: [
            self.pool.id.raw,
            self.id.raw,
            centrifugeId,
            addressToBytes32(target),
            payload,
            0n,
            ctx.signingAddress,
          ],
        }),
        messages: { [centrifugeId]: [MessageType.TrustedContractUpdate] },
      })
    }, this.pool.centrifugeId)
  }

  /** @internal */
  _epochOutstandingInvests() {
    return this._query(['epochOutstandingInvests'], () =>
      this._root._queryIndexer(
        `query ($scId: String!) {
            epochOutstandingInvests(where: { tokenId: $scId }, limit: 1000) {
              items {
                assetId
                pendingAssetsAmount
                asset { decimals centrifugeId }
              }
            }
          }`,
        { scId: this.id.raw },
        (data: {
          epochOutstandingInvests: {
            items: {
              assetId: string
              pendingAssetsAmount: string
              asset: { decimals: number; centrifugeId: string }
            }[]
          }
        }) => {
          return data.epochOutstandingInvests.items.map((item) => ({
            assetId: new AssetId(item.assetId),
            centrifugeId: item.asset.centrifugeId,
            amount: new Balance(item.pendingAssetsAmount || 0, item.asset.decimals),
          }))
        }
      )
    )
  }

  /** @internal */
  _epochOutstandingRedeems() {
    return this._query(['epochOutstandingRedeems'], () =>
      this._root._queryIndexer(
        `query ($scId: String!) {
            epochOutstandingRedeems(where: { tokenId: $scId }, limit: 1000) {
              items {
                assetId
                pendingSharesAmount
                asset { decimals centrifugeId }
              }
            }
          }`,
        { scId: this.id.raw },
        (data: {
          epochOutstandingRedeems: {
            items: {
              assetId: string
              pendingSharesAmount: string
              asset: { decimals: number; centrifugeId: string }
            }[]
          }
        }) => {
          return data.epochOutstandingRedeems.items.map((item) => ({
            assetId: new AssetId(item.assetId),
            centrifugeId: item.asset.centrifugeId,
            amount: new Balance(item.pendingSharesAmount || 0, 18),
          }))
        }
      )
    )
  }

  /** @internal */
  _share(centrifugeId: CentrifugeId) {
    return this._query(['share', centrifugeId], () =>
      this.pool.network(centrifugeId).pipe(switchMap((network) => network._share(this.id)))
    )
  }

  /** @internal */
  _restrictionManager(centrifugeId: CentrifugeId) {
    return this._query(['restrictionManager', centrifugeId], () =>
      combineLatest([this._share(centrifugeId), this._root.getClient(centrifugeId)]).pipe(
        switchMap(([share, client]) =>
          defer(async () => {
            const address = await client.readContract({
              address: share,
              abi: ABI.Currency,
              functionName: 'hook',
            })
            return address.toLowerCase() as HexString
          })
        )
      )
    )
  }

  /** @internal */
  _getFreeAccountId() {
    return this._query(['getFreeAccountId'], () =>
      this._root._protocolAddresses(this.pool.centrifugeId).pipe(
        map(({ accounting }) => ({ accounting, id: null, triesLeft: 10 })),
        expand(({ accounting, triesLeft }) => {
          const id = randomUint(256)

          if (triesLeft <= 0) return EMPTY

          return defer(async () => {
            const client = await firstValueFrom(this._root.getClient(this.pool.centrifugeId))
            const exists = await client.readContract({
              address: accounting,
              abi: ABI.Accounting,
              functionName: 'exists',
              args: [this.pool.id.raw, id],
            })
            return { accounting, id: exists ? null : id, triesLeft: triesLeft - 1 }
          })
        }),
        filter(({ id }) => !!id),
        map(({ id }) => id!)
      )
    )
  }

  /** @internal */
  _tokenInstancePositions(options?: {
    limit?: number
    offset?: number
    orderBy?: string
    orderDirection?: string
    filter?: {
      balance_gt?: bigint
      holderAddress?: string
      centrifugeIds?: string[]
    }
  }) {
    const limit = options?.limit ?? 1000
    const offset = options?.offset ?? 0
    const orderBy = options?.orderBy ?? 'balance'
    const orderDirection = options?.orderDirection ?? 'desc'
    const balance_gt = options?.filter?.balance_gt
    const holderAddress = options?.filter?.holderAddress?.toLowerCase()
    const centrifugeIds = options?.filter?.centrifugeIds

    return this._query(
      [
        'tokenInstancePositions',
        this.id.raw,
        limit,
        offset,
        balance_gt?.toString(),
        holderAddress,
        centrifugeIds?.join(','),
        orderBy,
        orderDirection,
      ],
      () =>
        this._root._protocolAddresses(this.pool.centrifugeId).pipe(
          switchMap((protocolAddresses) => {
            // Build where clause dynamically based on which filters are provided
            const whereConditions = ['tokenId: $scId', 'accountAddress_not_in: $excludedAddresses']
            if (balance_gt !== undefined) whereConditions.push('balance_gt: $balance_gt')
            if (holderAddress) whereConditions.push('accountAddress_contains: $holderAddress')
            if (centrifugeIds) whereConditions.push('centrifugeId_in: $centrifugeIds')

            // Build query parameters dynamically
            const queryParams = [
              '$scId: String!',
              '$limit: Int!',
              '$offset: Int!',
              '$orderBy: String!',
              '$orderDirection: String!',
              '$excludedAddresses: [String!]!',
            ]
            if (balance_gt !== undefined) queryParams.push('$balance_gt: BigInt')
            if (holderAddress) queryParams.push('$holderAddress: String')
            if (centrifugeIds) queryParams.push('$centrifugeIds: [String!]')

            // Build variables object
            const variables: Record<string, any> = {
              scId: this.id.raw,
              limit,
              offset,
              orderBy,
              orderDirection,
              excludedAddresses: [
                protocolAddresses.globalEscrow.toLowerCase(),
                protocolAddresses.balanceSheet.toLowerCase(),
                protocolAddresses.asyncRequestManager.toLowerCase(),
                protocolAddresses.syncManager.toLowerCase(),
              ],
            }
            if (balance_gt !== undefined) variables.balance_gt = balance_gt.toString()
            if (holderAddress) variables.holderAddress = holderAddress
            if (centrifugeIds) variables.centrifugeIds = centrifugeIds

            return this._root
              ._queryIndexer<{
                tokenInstancePositions: {
                  items: {
                    accountAddress: HexString
                    centrifugeId: string
                    balance: bigint
                    isFrozen: boolean
                  }[]
                  pageInfo: {
                    hasNextPage: boolean
                    hasPreviousPage: boolean
                    startCursor: string
                    endCursor: string
                  }
                  totalCount: number
                }
                assets: {
                  items: {
                    decimals: number
                    id: string
                  }[]
                }
              }>(
                `query (${queryParams.join(', ')}) {
                tokenInstancePositions(
                  where: { ${whereConditions.join(', ')} }
                  orderBy: $orderBy
                  orderDirection: $orderDirection
                  limit: $limit
                  offset: $offset
                ) {
                  items {
                    accountAddress
                    centrifugeId
                    balance
                    isFrozen
                  }
                  pageInfo {
                    hasNextPage
                    hasPreviousPage
                    startCursor
                    endCursor
                  }
                  totalCount
                }
                assets {
                  items {
                    decimals
                    id
                  }
                }
              }`,
                variables
              )
              .pipe(
                map((data) => ({
                  items: data.tokenInstancePositions.items,
                  assets: data.assets.items,
                  pageInfo: data.tokenInstancePositions.pageInfo,
                  totalCount: data.tokenInstancePositions.totalCount,
                }))
              )
          })
        )
    )
  }

  /** @internal */
  _whitelistedInvestors(options?: { limit: number; offset?: number }) {
    const limit = options?.limit ?? 1000
    const offset = options?.offset ?? 0
    const MAX_CENTRIFUGE_ID = 100n

    return this._query(['whitelistedInvestors', this.id.raw, limit, offset], () =>
      this._root
        ._queryIndexer<{
          whitelistedInvestors: {
            items: {
              accountAddress: HexString
              centrifugeId: string
              createdAt: string
              isFrozen: boolean
              validUntil: string
            }[]
            pageInfo: {
              hasNextPage: boolean
              hasPreviousPage: boolean
              startCursor: string
              endCursor: string
            }
            totalCount: number
          }
          assets: {
            items: {
              decimals: number
              id: string
            }[]
          }
        }>(
          `query ($tokenId: String!, $limit: Int!, $offset: Int!) {
            whitelistedInvestors(
            where: { tokenId: $tokenId }
              limit: $limit
              offset: $offset
            ) {
              items {
                accountAddress
                centrifugeId
                createdAt
                isFrozen
                validUntil
              }
              pageInfo {
                hasNextPage
                hasPreviousPage
                startCursor
                endCursor
              }
              totalCount
            }
            assets {
              items {
                id
                decimals
              }
            }
          }`,
          {
            tokenId: this.id.raw,
            limit,
            offset,
          }
        )
        .pipe(
          map((data) => {
            return {
              items: data.whitelistedInvestors.items
                .map(({ accountAddress, ...rest }) => ({
                  address: accountAddress.toLowerCase() as HexString,
                  ...rest,
                }))
                .filter((investor) => BigInt(investor.address) > MAX_CENTRIFUGE_ID),
              pageInfo: data.whitelistedInvestors.pageInfo,
              totalCount: data.whitelistedInvestors.totalCount,
              assets: data.assets.items,
            }
          })
        )
    )
  }

  /** @internal */
  _whitelistedInvestor(params: { accountAddress: string; centrifugeId: string; tokenId: string }) {
    return this._query(
      ['whitelistedInvestor', this.id.raw, params.accountAddress, params.centrifugeId, params.tokenId],
      () =>
        this._root
          ._queryIndexer<{
            whitelistedInvestor: {
              accountAddress: HexString
              centrifugeId: string
              createdAt: string
              isFrozen: boolean
              validUntil: string
            } | null
          }>(
            `query ($accountAddress: String!, $centrifugeId: String!, $tokenId: String!) {
          whitelistedInvestor(
            accountAddress: $accountAddress
            centrifugeId: $centrifugeId
            tokenId: $tokenId
          ) {
            accountAddress
            centrifugeId
            createdAt
            isFrozen
            validUntil
          }
        }`,
            params
          )
          .pipe(
            map((data) => {
              if (!data.whitelistedInvestor) return null
              const { accountAddress, ...rest } = data.whitelistedInvestor
              return {
                address: accountAddress.toLowerCase() as HexString,
                ...rest,
              }
            })
          )
    )
  }

  /** @internal */
  _tokenInstancePosition(params: { accountAddress: string; centrifugeId: string; tokenId: string }) {
    return this._query(
      ['tokenInstancePosition', this.id.raw, params.accountAddress, params.centrifugeId, params.tokenId],
      () =>
        this._root
          ._queryIndexer<{
            tokenInstancePosition: {
              accountAddress: HexString
              balance: string
              centrifugeId: string
              createdAt: string
              isFrozen: boolean
              tokenId: string
              updatedAt: string
            } | null
          }>(
            `query ($accountAddress: String!, $centrifugeId: String!, $tokenId: String!) {
            tokenInstancePosition(
              accountAddress: $accountAddress
              centrifugeId: $centrifugeId
              tokenId: $tokenId
            ) {
              accountAddress
              balance
              centrifugeId
              createdAt
              isFrozen
              tokenId
              updatedAt
            }
          }`,
            params
          )
          .pipe(
            map((data) => {
              if (!data.tokenInstancePosition) return null
              const { accountAddress, balance, ...rest } = data.tokenInstancePosition
              return {
                accountAddress: accountAddress.toLowerCase() as HexString,
                balance: BigInt(balance),
                ...rest,
              }
            })
          )
    )
  }

  /** @internal */
  _getQuote(valuationAddress: HexString, assetId: AssetId, baseAmount: Balance) {
    return this._query(['getQuote', valuationAddress, baseAmount.toString(), assetId.toString()], () =>
      timer(0, 120_000).pipe(
        switchMap(() => this._root.getClient(this.pool.centrifugeId)),
        switchMap((client) =>
          combineLatest([
            this.pool.currency(),
            defer(() => {
              return client.readContract({
                address: valuationAddress,
                abi: ABI.Valuation,
                functionName: 'getQuote',
                args: [this.pool.id.raw, this.id.raw, assetId.raw, baseAmount.toBigInt()],
              })
            }),
          ])
        ),
        map(([poolCurrency, quote]) => {
          return new Balance(quote, poolCurrency.decimals)
        })
      )
    )
  }
}
