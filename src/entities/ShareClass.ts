import { catchError, combineLatest, defer, EMPTY, expand, filter, firstValueFrom, map, of, switchMap } from 'rxjs'
import { encodeFunctionData, encodePacked, getContract } from 'viem'
import { ABI } from '../abi/index.js'
import type { Centrifuge } from '../Centrifuge.js'
import { AccountType } from '../types/holdings.js'
import { CurrencyDetails, HexString } from '../types/index.js'
import { MessageType } from '../types/transaction.js'
import { Balance, Price } from '../utils/BigInt.js'
import { addressToBytes32, randomUint } from '../utils/index.js'
import { repeatOnEvents } from '../utils/rx.js'
import { wrapTransaction } from '../utils/transaction.js'
import { AssetId, ShareClassId } from '../utils/types.js'
import { BalanceSheet } from './BalanceSheet.js'
import { Entity } from './Entity.js'
import type { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'
import { Vault } from './Vault.js'
import { AddressMap } from '../utils/AddressMap.js'

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

  balanceSheet(chainId: number) {
    return this._query(['balanceSheet', chainId], () =>
      this.pool.activeNetworks().pipe(
        map((networks) => {
          const network = networks.find((n) => n.chainId === chainId)
          if (!network) {
            throw new Error(`No active network found for chain ID ${chainId}`)
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
                this._share(network.chainId).pipe(catchError(() => of(null))),
                this._restrictionManager(network.chainId).pipe(catchError(() => of(null))),
                of(network),
              ])
            )
          )
        }),
        map((data) =>
          data
            .filter(([, restrictionManager]) => restrictionManager != null)
            .map(([share, restrictionManager, network]) => ({
              chainId: network.chainId,
              shareTokenAddress: share!,
              restrictionManagerAddress: restrictionManager!,
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
                    id
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
                  blockchain: { id: string }
                  address: HexString
                }[]
              }
            }) =>
              data.tokenInstances.items.map((item) => ({
                chainId: Number(item.blockchain.id),
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
   * @param chainId The optional chain ID to query the vaults on.
   * @param includeUnlinked Whether to include unlinked vaults.
   * @returns Vaults of the share class.
   */
  vaults(chainId?: number, includeUnlinked = false) {
    return this._query(['vaults', chainId, includeUnlinked.toString()], () =>
      this._allVaults().pipe(
        map((allVaults) => {
          const vaults = allVaults.filter((vault) => {
            if (chainId && vault.chainId !== chainId) return false
            if (!includeUnlinked && vault.status === 'Unlinked') return false
            return true
          })
          return vaults.map(
            (vault) =>
              new Vault(
                this._root,
                new PoolNetwork(this._root, this.pool, vault.chainId),
                this,
                vault.assetAddress,
                vault.address,
                vault.assetId
              )
          )
        })
      )
    )
  }

  /**
   * Query all the balances of the share class (from BalanceSheet and Holdings).
   */
  balances(chainId?: number) {
    return this._query(['balances', chainId], () =>
      combineLatest([this._balances(), this.pool.currency()]).pipe(
        switchMap(([res, poolCurrency]) => {
          if (res.length === 0) {
            return of([])
          }
          const items = res.filter((item) => Number(item.asset.blockchain.id) === chainId || !chainId)

          if (items.length === 0) return of([])

          return combineLatest([
            combineLatest(
              items.map((holding) => {
                if (!holding.holding) return of(null)
                const assetId = new AssetId(holding.assetId)
                return this._holding(assetId)
              })
            ),
            combineLatest(
              items.map((holding) => {
                const assetId = new AssetId(holding.assetId)
                return this._balance(Number(holding.asset.blockchain.id), {
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
                    chainId: Number(data.asset.blockchain.id),
                  } satisfies Omit<CurrencyDetails, 'supportsPermit'>,
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
          ]).pipe(
            map(([epochs, outInv, outRed]) => {
              const invByKey = new Map<string, Balance>()
              outInv.forEach((o) => invByKey.set(`${o.assetId.toString()}-${o.chainId}`, o.amount))

              const redByKey = new Map<string, Balance>()
              outRed.forEach((o) => redByKey.set(`${o.assetId.toString()}-${o.chainId}`, o.amount))

              return epochs.map((epoch, i) => {
                const vault = vaults[i]!
                const key = `${vault.assetId.toString()}-${vault.chainId}`

                const queuedInvest = invByKey.get(key) ?? new Balance(0n, 18)
                const queuedRedeem = redByKey.get(key) ?? new Balance(0n, 18)

                return {
                  assetId: vault.assetId,
                  chainId: vault.chainId,
                  queuedInvest,
                  queuedRedeem,
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
   * @param chainId Chain ID of the network on which to check the member
   */
  member(address: HexString, chainId: number) {
    const addr = address.toLowerCase() as HexString
    return this._query(['member', addr, chainId], () =>
      combineLatest([this._share(chainId), this._restrictionManager(chainId)]).pipe(
        switchMap(([share, restrictionManager]) =>
          defer(async () => {
            const res = await this._root.getClient(chainId).readContract({
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
              chainId
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
        self._root._protocolAddresses(self.pool.chainId),
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
    }, this.pool.chainId)
  }

  updateSharePrice(pricePerShare: Price) {
    const self = this
    return this._transact(async function* (ctx) {
      const [{ hub }, activeNetworks] = await Promise.all([
        self._root._protocolAddresses(self.pool.chainId),
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
          args: [self.pool.id.raw, self.id.raw, pricePerShare.toBigInt()],
        })
      )

      await Promise.all(
        activeNetworks.map(async (activeNetwork) => {
          const networkDetails = await activeNetwork.details()
          const id = await self._root.id(activeNetwork.chainId)

          const isShareClassInNetwork = networkDetails.activeShareClasses.find((shareClass) =>
            shareClass.id.equals(self.id)
          )

          if (isShareClassInNetwork) {
            batch.push(
              encodeFunctionData({
                abi: ABI.Hub,
                functionName: 'notifySharePrice',
                args: [self.pool.id.raw, self.id.raw, id],
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
    }, this.pool.chainId)
  }

  setMaxAssetPriceAge(assetId: AssetId, maxPriceAge: number) {
    const self = this
    return this._transact(async function* (ctx) {
      const { hub } = await self._root._protocolAddresses(self.pool.chainId)
      yield* wrapTransaction('Set max asset price age', ctx, {
        contract: hub,
        data: encodeFunctionData({
          abi: ABI.Hub,
          functionName: 'setMaxAssetPriceAge',
          args: [self.pool.id.raw, self.id.raw, assetId.raw, BigInt(maxPriceAge)],
        }),
        messages: {
          [assetId.centrifugeId]: [MessageType.MaxAssetPriceAge],
        },
      })
    }, this.pool.chainId)
  }

  setMaxSharePriceAge(chainId: number, maxPriceAge: number) {
    const self = this
    return this._transact(async function* (ctx) {
      const [{ hub }, id] = await Promise.all([
        self._root._protocolAddresses(self.pool.chainId),
        self._root.id(chainId),
      ])
      yield* wrapTransaction('Set max share price age', ctx, {
        contract: hub,
        data: encodeFunctionData({
          abi: ABI.Hub,
          functionName: 'setMaxSharePriceAge',
          args: [id, self.pool.id.raw, self.id.raw, BigInt(maxPriceAge)],
        }),
        messages: {
          [id]: [MessageType.MaxSharePriceAge],
        },
      })
    }, this.pool.chainId)
  }

  notifyAssetPrice(assetId: AssetId) {
    const self = this
    return this._transact(async function* (ctx) {
      const { hub } = await self._root._protocolAddresses(self.pool.chainId)
      yield* wrapTransaction('Notify asset price', ctx, {
        contract: hub,
        data: encodeFunctionData({
          abi: ABI.Hub,
          functionName: 'notifyAssetPrice',
          args: [self.pool.id.raw, self.id.raw, assetId.raw],
        }),
        messages: {
          [assetId.centrifugeId]: [MessageType.NotifyPricePoolPerAsset],
        },
      })
    }, this.pool.chainId)
  }

  notifySharePrice(chainId: number) {
    const self = this
    return this._transact(async function* (ctx) {
      const [{ hub }, id] = await Promise.all([
        self._root._protocolAddresses(self.pool.chainId),
        self._root.id(chainId),
      ])
      yield* wrapTransaction('Notify share price', ctx, {
        contract: hub,
        data: encodeFunctionData({
          abi: ABI.Hub,
          functionName: 'notifySharePrice',
          args: [self.pool.id.raw, self.id.raw, id],
        }),
        messages: {
          [id]: [MessageType.NotifyPricePoolPerShare],
        },
      })
    }, this.pool.chainId)
  }

  /**
   * Approve deposits and issue shares for the given assets.
   * @param assets - Array of assets to approve deposits and/or issue shares for
   * `issuePricePerShare` can be a single price for all epochs or an array of prices for each epoch to be issued for.
   */
  approveDepositsAndIssueShares(
    assets: { assetId: AssetId; approveAssetAmount?: Balance; issuePricePerShare?: Price | Price[] }[]
  ) {
    const self = this
    return this._transact(async function* (ctx) {
      const [{ hub }, id, pendingAmounts, orders, maxBatchGasLimit] = await Promise.all([
        self._root._protocolAddresses(self.pool.chainId),
        self._root.id(self.pool.chainId),
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
        self._root._maxBatchGasLimit(self.pool.chainId),
      ])
      const assetsWithApprove = assets.filter((a) => a.approveAssetAmount).length
      const assetsWithIssue = assets.filter((a) => a.issuePricePerShare).length
      const gasLimitPerAsset = assetsWithIssue ? maxBatchGasLimit / BigInt(assetsWithIssue) : 0n
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
        const gasPerMessage = asset.assetId.centrifugeId === id ? estimatePerMessageIfLocal : estimatePerMessage
        let gasLeft = gasLimitPerAsset
        const pending = pendingAmounts.find((e) => e.assetId.equals(asset.assetId))
        if (!pending) {
          throw new Error(`No pending amount found for asset "${asset.assetId.toString()}"`)
        }

        let nowDepositEpoch = pending?.depositEpoch

        if (asset.approveAssetAmount) {
          if (asset.approveAssetAmount.gt(pending.pendingDeposit)) {
            throw new Error(`Approve amount exceeds pending amount for asset "${asset.assetId.toString()}"`)
          }
          if (asset.approveAssetAmount.lte(0n)) {
            throw new Error(`Approve amount must be greater than 0 for asset "${asset.assetId.toString()}"`)
          }
          batch.push(
            encodeFunctionData({
              abi: ABI.Hub,
              functionName: 'approveDeposits',
              args: [
                self.pool.id.raw,
                self.id.raw,
                asset.assetId.raw,
                nowDepositEpoch,
                asset.approveAssetAmount.toBigInt(),
              ],
            })
          )
          addMessage(asset.assetId.centrifugeId, MessageType.RequestCallback)
          gasLeft -= gasPerMessage
          nowDepositEpoch++
        }

        const nowIssueEpoch = pending.issueEpoch

        if (asset.issuePricePerShare) {
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
                abi: ABI.Hub,
                functionName: 'issueShares',
                args: [self.pool.id.raw, self.id.raw, asset.assetId.raw, nowIssueEpoch + i, price.toBigInt(), 0n],
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
                    abi: ABI.Hub,
                    functionName: 'notifyDeposit',
                    args: [
                      self.pool.id.raw,
                      self.id.raw,
                      asset.assetId.raw,
                      addressToBytes32(order.investor),
                      order.maxDepositClaims + i, // +i to ensure the additional epochs that are being issued are included
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
        contract: hub,
        data: batch,
        messages,
      })
    }, this.pool.chainId)
  }

  /**
   * Approve redeems and revoke shares for the given assets.
   * @param assets - Array of assets to approve redeems and/or revoke shares for
   * `approveShareAmount` can be a single amount for all epochs or an array of amounts for each epoch to be revoked.
   */
  approveRedeemsAndRevokeShares(
    assets: { assetId: AssetId; approveShareAmount?: Balance; revokePricePerShare?: Price | Price[] }[]
  ) {
    const self = this
    return this._transact(async function* (ctx) {
      const [{ hub }, id, pendingAmounts, orders, maxBatchGasLimit] = await Promise.all([
        self._root._protocolAddresses(self.pool.chainId),
        self._root.id(self.pool.chainId),
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
        self._root._maxBatchGasLimit(self.pool.chainId),
      ])

      const assetsWithApprove = assets.filter((a) => a.approveShareAmount).length
      const assetsWithRevoke = assets.filter((a) => a.revokePricePerShare).length
      const gasLimitPerAsset = assetsWithRevoke ? maxBatchGasLimit / BigInt(assetsWithRevoke) : 0n
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
        const gasPerMessage = asset.assetId.centrifugeId === id ? estimatePerMessageIfLocal : estimatePerMessage
        let gasLeft = gasLimitPerAsset
        const pending = pendingAmounts.find((e) => e.assetId.equals(asset.assetId))
        if (!pending) {
          throw new Error(`No pending amount found for asset "${asset.assetId.toString()}"`)
        }

        let nowRedeemEpoch = pending.redeemEpoch

        if (asset.approveShareAmount) {
          if (asset.approveShareAmount.gt(pending.pendingRedeem)) {
            throw new Error(`Share amount exceeds pending redeem for asset "${asset.assetId.toString()}"`)
          }
          if (asset.approveShareAmount.lte(0n)) {
            throw new Error(`Share amount must be greater than 0 for asset "${asset.assetId.toString()}"`)
          }
          batch.push(
            encodeFunctionData({
              abi: ABI.Hub,
              functionName: 'approveRedeems',
              args: [
                self.pool.id.raw,
                self.id.raw,
                asset.assetId.raw,
                nowRedeemEpoch,
                asset.approveShareAmount.toBigInt(),
              ],
            })
          )
          nowRedeemEpoch++
        }

        const nowRevokeEpoch = pending.revokeEpoch
        if (asset.revokePricePerShare) {
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
                abi: ABI.Hub,
                functionName: 'revokeShares',
                args: [self.pool.id.raw, self.id.raw, asset.assetId.raw, nowRevokeEpoch + i, price.toBigInt(), 0n],
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
                    abi: ABI.Hub,
                    functionName: 'notifyRedeem',
                    args: [
                      self.pool.id.raw,
                      self.id.raw,
                      asset.assetId.raw,
                      addressToBytes32(order.investor),
                      order.maxRedeemClaims + 1, // +1 to ensure the order that's being issued is included
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
        contract: hub,
        data: batch,
        messages,
      })
    }, this.pool.chainId)
  }

  /**
   * Claim a deposit on the Hub side for the given asset and investor after the shares have been issued.
   * This will send a message to the Spoke that will allow the investor to claim their shares.
   */
  claimDeposit(assetId: AssetId, investor: HexString) {
    const self = this
    return this._transact(async function* (ctx) {
      const [{ hub }, investorOrder] = await Promise.all([
        self._root._protocolAddresses(self.pool.chainId),
        self._investorOrder(assetId, investor),
      ])
      yield* wrapTransaction('Claim deposit', ctx, {
        contract: hub,
        data: encodeFunctionData({
          abi: ABI.Hub,
          functionName: 'notifyDeposit',
          args: [
            self.pool.id.raw,
            self.id.raw,
            assetId.raw,
            addressToBytes32(investor),
            investorOrder.maxDepositClaims,
          ],
        }),
        messages: { [assetId.centrifugeId]: [MessageType.RequestCallback] },
      })
    }, this.pool.chainId)
  }

  /**
   * Claim a redemption on the Hub side for the given asset and investor after the shares have been revoked.
   * This will send a message to the Spoke that will allow the investor to claim their redeemed currency.
   */
  claimRedeem(assetId: AssetId, investor: HexString) {
    const self = this
    return this._transact(async function* (ctx) {
      const [{ hub }, investorOrder] = await Promise.all([
        self._root._protocolAddresses(self.pool.chainId),
        self._investorOrder(assetId, investor),
      ])
      yield* wrapTransaction('Claim redeem', ctx, {
        contract: hub,
        data: encodeFunctionData({
          abi: ABI.Hub,
          functionName: 'notifyRedeem',
          args: [self.pool.id.raw, self.id.raw, assetId.raw, addressToBytes32(investor), investorOrder.maxRedeemClaims],
        }),
        messages: { [assetId.centrifugeId]: [MessageType.RequestCallback] },
      })
    }, this.pool.chainId)
  }

  /**
   * Update a member of the share class.
   * @param address Address of the investor
   * @param validUntil Time in seconds from Unix epoch until the investor is valid
   * @param chainId Chain ID of the network on which to update the member
   */
  updateMember(address: HexString, validUntil: number, chainId: number) {
    return this.updateMembers([{ address, validUntil, chainId }])
  }

  /**
   * Batch update a list of members of the share class.
   * @param members Array of members to update, each with address, validUntil and chainId
   * @param members.address Address of the investor
   * @param members.validUntil Time in seconds from Unix epoch until the investor is valid
   * @param members.chainId Chain ID of the network on which to update the member
   */
  updateMembers(members: { address: HexString; validUntil: number; chainId: number }[]) {
    const self = this

    return this._transact(async function* (ctx) {
      const [{ hub }, ...ids] = await Promise.all([
        self._root._protocolAddresses(self.pool.chainId),
        ...members.map((m) => self._root.id(m.chainId)),
      ])

      const batch: HexString[] = []
      const messages: Record<number, MessageType[]> = {}
      function addMessage(centId: number, message: MessageType) {
        if (!messages[centId]) messages[centId] = []
        messages[centId].push(message)
      }

      members.forEach((member, index) => {
        const id = ids[index]

        if (!id) {
          return
        }

        batch.push(
          encodeFunctionData({
            abi: ABI.Hub,
            functionName: 'updateRestriction',
            args: [
              self.pool.id.raw,
              self.id.raw,
              id,
              encodePacked(
                ['uint8', 'bytes32', 'uint64'],
                [/* UpdateRestrictionType.Member */ 1, addressToBytes32(member.address), BigInt(member.validUntil)]
              ),
              0n,
            ],
          })
        )
        addMessage(id, MessageType.UpdateRestriction)
      })

      if (batch.length === 0) {
        throw new Error('No data to update members')
      }

      yield* wrapTransaction(`Update member${batch.length > 1 ? 's' : ''}`, ctx, {
        contract: hub,
        data: batch,
        messages,
      })
    }, this.pool.chainId)
  }

  /**
   * Retrieve all holders of the share class.
   * @param options Optional pagination options object for whitelisted investors query
   * @param options.limit Number of results to return (default: 20)
   * @param options.offset Offset for pagination (default: 0)
   * @param options.balance_gt Ivestor minimum position amount filter (default: 0)
   */
  holders(options?: { limit: number; offset?: number; balance_gt?: bigint }) {
    const limit = options?.limit ?? 20
    const offset = options?.offset ?? 0
    const balance_gt = options?.balance_gt ?? 0n

    return this._query(['holders', this.id.raw, limit, offset, balance_gt.toString()], () =>
      combineLatest([
        this._root._deployments(),
        this.pool.currency(),
        this._investorOrders(),
        this._tokenInstancePositions({ limit, balance_gt, offset }),
      ]).pipe(
        switchMap(
          ([
            deployments,
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

            const chainsById = new Map(deployments.blockchains.items.map((chain) => [chain.centrifugeId, chain.id]))

            return combineLatest(whitelistedQueries).pipe(
              map((whitelistResults) => {
                const investors = tokenInstancePositions.map((position, i) => {
                  const whitelistData = whitelistResults[i]
                  const chainId = Number(chainsById.get(position.centrifugeId)!)
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
                    chainId,
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
      combineLatest([
        this._root._deployments(),
        this.pool.currency(),
        this._investorOrders(),
        this._whitelistedInvestors({ limit, offset }),
      ]).pipe(
        switchMap(
          ([
            deployments,
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

            const chainsById = new Map(deployments.blockchains.items.map((chain) => [chain.centrifugeId, chain.id]))

            return combineLatest(positionQueries).pipe(
              map((positionResults) => {
                const investors = whitelistedInvestors.map((investor, i) => {
                  const positionData = positionResults[i]
                  const chainId = Number(chainsById.get(investor.centrifugeId)!)
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
                    chainId,
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
   */
  freezeMember(address: HexString, chainId: number) {
    const self = this
    return this._transact(async function* (ctx) {
      const [share, restrictionManager] = await Promise.all([
        firstValueFrom(self._share(chainId)),
        firstValueFrom(self._restrictionManager(chainId)),
      ])

      yield* wrapTransaction('Freeze member', ctx, {
        contract: restrictionManager,
        data: encodeFunctionData({
          abi: ABI.RestrictionManager,
          functionName: 'freeze',
          args: [share, address],
        }),
      })
    }, chainId)
  }

  /**
   * Unfreeze a member of the share class.
   */
  unfreezeMember(address: HexString, chainId: number) {
    const self = this
    return this._transact(async function* (ctx) {
      const [share, restrictionManager] = await Promise.all([
        firstValueFrom(self._share(chainId)),
        firstValueFrom(self._restrictionManager(chainId)),
      ])

      yield* wrapTransaction('Unfreeze member', ctx, {
        contract: restrictionManager,
        data: encodeFunctionData({
          abi: ABI.RestrictionManager,
          functionName: 'unfreeze',
          args: [share, address],
        }),
      })
    }, chainId)
  }

  /**
   * Get the pending and claimable investment/redeem amounts for all investors
   * in a given share class (per vault/chain)
   */
  investmentsByVault(chainId: number) {
    return this._query(['investmentsByVault', chainId], () =>
      combineLatest([this._investorOrders(), this.vaults(chainId), this.pendingAmounts()]).pipe(
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
                (p) => p.assetId.equals(vault.assetId) && p.chainId === vault.chainId
              )

              const basePendingDeposit = pendingMatch?.pendingDeposit ?? new Balance(0n, 18)
              const basePendingRedeem = pendingMatch?.pendingRedeem ?? new Balance(0n, 18)
              const queuedInvest = pendingMatch?.queuedInvest ?? new Balance(0n, 18)
              const queuedRedeem = pendingMatch?.queuedRedeem ?? new Balance(0n, 18)

              const allPendingIssuances = pendingMatch?.pendingIssuances ?? []
              const allPendingRevocations = pendingMatch?.pendingRevocations ?? []

              return combineLatest(
                Array.from(vaultInvestors).map((investor) =>
                  vault.investment(investor).pipe(
                    map((investment) => {
                      const pendingIssuances = allPendingIssuances.map((epoch) => ({
                        ...epoch,
                        assetId: vault.assetId,
                        chainId: vault.chainId,
                      }))

                      const pendingRevocations = allPendingRevocations.map((epoch) => ({
                        ...epoch,
                        assetId: vault.assetId,
                        chainId: vault.chainId,
                      }))

                      return {
                        investor,
                        assetId: vault.assetId,
                        chainId: vault.chainId,
                        pendingInvestCurrency: investment.pendingInvestCurrency || basePendingDeposit,
                        pendingRedeemShares: basePendingRedeem,
                        claimableInvestShares: investment.claimableInvestShares,
                        claimableRedeemCurrency: investment.claimableRedeemCurrency,
                        queuedInvest,
                        queuedRedeem,
                        depositEpoch: pendingMatch?.depositEpoch,
                        redeemEpoch: pendingMatch?.redeemEpoch,
                        issueEpoch: pendingMatch?.issueEpoch,
                        revokeEpoch: pendingMatch?.revokeEpoch,
                        pendingIssuances,
                        pendingRevocations,
                      }
                    }),
                    catchError(() =>
                      of({
                        investor,
                        assetId: vault.assetId,
                        chainId: vault.chainId,
                        pendingInvestCurrency: new Balance(0n, 18),
                        pendingRedeemShares: new Balance(0n, 18),
                        claimableInvestShares: new Balance(0n, 18),
                        claimableRedeemCurrency: new Balance(0n, 18),
                        queuedInvest: new Balance(0n, 18),
                        queuedRedeem: new Balance(0n, 18),
                        pendingIssuances: [],
                        pendingRevocations: [],
                      })
                    )
                  )
                )
              )
            })
          ).pipe(map((results) => results.flat()))
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
      this._root._queryIndexer(
        `query ($scId: String!) {
        investOrders(where: { tokenId: $scId, issuedAt_not: null }, limit: 1000) {
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
            }
             token {
              decimals
              blockchain {
               chainId
              }
            }
          }
        }
      }`,
        { scId: this.id.raw },
        (data: {
          investOrders: {
            items: {
              account: HexString
              index: number
              assetId: string
              approvedAssetsAmount: string
              approvedAt: string | null
              issuedSharesAmount: string
              issuedAt: string | null
              issuedWithNavAssetPerShare: string
              issuedWithNavPoolPerShare: string
              claimedAt: string | null
              claimedAtBlock: string | null
              asset: {
                id: string
                decimals: number
                symbol: string
                name: string
              }
              token: {
                decimals: number
                blockchain: {
                  chainId: number
                }
              }
            }[]
          }
        }) => {
          return data.investOrders.items.map((order) => ({
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
            chainId: order.token.blockchain.chainId,
          }))
        }
      )
    )
  }

  /**
   * Get closed redemption orders
   * @returns Closed redemption orders where shares have been revoked
   */
  closedRedemptions() {
    return this._query(['closedRedemptions'], () =>
      this._root._queryIndexer(
        `query ($scId: String!) {
        redeemOrders(where: { tokenId: $scId, revokedAt_not: null }, limit: 1000) {
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
            }
            token {
              decimals
              blockchain {
               chainId
              }
            }
          }
        }
      }`,
        { scId: this.id.raw },
        (data: {
          redeemOrders: {
            items: {
              account: HexString
              index: number
              assetId: string
              approvedSharesAmount: string
              approvedAt: string | null
              revokedAssetsAmount: string
              revokedAt: string | null
              revokedWithNavAssetPerShare: string
              revokedWithNavPoolPerShare: string
              claimedAt: string | null
              claimedAtBlock: string | null
              asset: {
                id: string
                decimals: number
                symbol: string
                name: string
              }
              token: {
                decimals: number
                blockchain: {
                  chainId: number
                }
              }
            }[]
          }
        }) => {
          return data.redeemOrders.items.map((order) => ({
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
            chainId: order.token.blockchain.chainId,
          }))
        }
      )
    )
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
            asset {
              decimals
              assetTokenId
              address
              name
              symbol
              blockchain {
                id
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
              blockchain: { id: string }
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
        this._root._protocolAddresses(this.pool.chainId),
        this.pool.currency(),
        this._root._assetDecimals(assetId, this.pool.chainId),
      ]).pipe(
        switchMap(([{ holdings: holdingsAddr }, poolCurrency, assetDecimals]) =>
          defer(async () => {
            const holdings = getContract({
              address: holdingsAddr,
              abi: ABI.Holdings,
              client: this._root.getClient(this.pool.chainId),
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
              this.pool.chainId
            )
          )
        )
      )
    )
  }

  /** @internal */
  _balance(chainId: number, asset: { address: HexString; assetTokenId?: bigint; id: AssetId; decimals: number }) {
    return this._query(['balance', asset.id.toString()], () =>
      combineLatest([this._root._protocolAddresses(chainId), this.pool.currency()]).pipe(
        switchMap(([addresses, poolCurrency]) =>
          defer(async () => {
            const client = this._root.getClient(chainId)
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
              chainId
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
        outstandingInvests(where: {tokenId: $scId}) {
          items {
            investor: account
            assetId
            queuedAmount
            depositAmount
            pendingAmount
          }
        }
        outstandingRedeems(where: {tokenId: $scId}) {
          items {
            assetId
            investor: account
            queuedAmount
            depositAmount
            pendingAmount
          }
        }
        }`,
      { scId: this.id.raw },
      (data: {
        outstandingInvests: {
          items: {
            assetId: string
            investor: HexString
            queuedAmount: string
            depositAmount: string
            pendingAmount: string
          }[]
        }
        outstandingRedeems: {
          items: {
            assetId: string
            investor: HexString
            queuedAmount: string
            depositAmount: string
            pendingAmount: string
          }[]
        }
      }) => ({
        outstandingInvests: data.outstandingInvests.items.map((item) => ({
          ...item,
          assetId: new AssetId(item.assetId),
        })),
        outstandingRedeems: data.outstandingRedeems.items.map((item) => ({
          ...item,
          assetId: new AssetId(item.assetId),
        })),
      })
    )
  }

  /** @internal */
  _investorOrder(assetId: AssetId, investor: HexString) {
    return this._query(['investorOrder', assetId.toString(), investor.toLowerCase()], () =>
      this._root._protocolAddresses(this.pool.chainId).pipe(
        switchMap(({ shareClassManager }) =>
          defer(async () => {
            const contract = getContract({
              address: shareClassManager,
              abi: ABI.ShareClassManager,
              client: this._root.getClient(this.pool.chainId),
            })

            const [maxDepositClaims, maxRedeemClaims, [pendingDeposit], [pendingRedeem]] = await Promise.all([
              contract.read.maxDepositClaims([this.id.raw, addressToBytes32(investor), assetId.raw]),
              contract.read.maxRedeemClaims([this.id.raw, addressToBytes32(investor), assetId.raw]),
              contract.read.depositRequest([this.id.raw, assetId.raw, addressToBytes32(investor)]),
              contract.read.redeemRequest([this.id.raw, assetId.raw, addressToBytes32(investor)]),
            ])

            return {
              assetId,
              investor,
              maxDepositClaims,
              maxRedeemClaims,
              pendingDeposit,
              pendingRedeem,
            }
          }).pipe(
            repeatOnEvents(
              this._root,
              {
                address: shareClassManager,
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
              this.pool.chainId
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
                id
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
            blockchain: { id: string }
            asset: { id: string }
            status: 'Linked' | 'Unlinked'
          }[]
        }
      }) =>
        data.vaults.items.map(({ blockchain, asset, ...rest }) => ({
          ...rest,
          chainId: Number(blockchain.id),
          assetId: new AssetId(asset.id),
        }))
    )
  }

  /** @internal */
  _metadata() {
    return this._query(['metadata'], () =>
      this._root._protocolAddresses(this.pool.chainId).pipe(
        switchMap(({ shareClassManager }) =>
          defer(async () => {
            const [name, symbol] = await this._root.getClient(this.pool.chainId).readContract({
              address: shareClassManager,
              abi: ABI.ShareClassManager,
              functionName: 'metadata',
              args: [this.id.raw],
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
              this.pool.chainId
            )
          )
        )
      )
    )
  }

  /** @internal */
  _metrics() {
    return this._query(['metrics'], () =>
      this._root._protocolAddresses(this.pool.chainId).pipe(
        switchMap(({ shareClassManager }) =>
          defer(async () => {
            const [totalIssuance, pricePerShare] = await this._root.getClient(this.pool.chainId).readContract({
              address: shareClassManager,
              abi: ABI.ShareClassManager,
              functionName: 'metrics',
              args: [this.id.raw],
            })
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
              this.pool.chainId
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
        this._root._protocolAddresses(this.pool.chainId),
        this.pool.currency(),
        this._root._assetDecimals(assetId, this.pool.chainId),
        this._epochInvestOrders(),
        this._epochRedeemOrders(),
      ]).pipe(
        switchMap(([{ shareClassManager }, poolCurrency, assetDecimals, epochInvestOrders, epochRedeemOrders]) =>
          defer(async () => {
            const scm = getContract({
              address: shareClassManager,
              abi: ABI.ShareClassManager,
              client: this._root.getClient(this.pool.chainId),
            })

            const [epoch, pendingDeposit, pendingRedeem] = await Promise.all([
              scm.read.epochId([this.id.raw, assetId.raw]),
              scm.read.pendingDeposit([this.id.raw, assetId.raw]),
              scm.read.pendingRedeem([this.id.raw, assetId.raw]),
            ])

            const depositEpoch = epoch[0] + 1
            const redeemEpoch = epoch[1] + 1
            const issueEpoch = epoch[2] + 1
            const revokeEpoch = epoch[3] + 1

            const [depositEpochAmounts, redeemEpochAmount] = await Promise.all([
              Promise.all(
                Array.from({ length: depositEpoch - issueEpoch }).map((_, i) =>
                  scm.read.epochInvestAmounts([this.id.raw, assetId.raw, issueEpoch + i])
                )
              ),
              Promise.all(
                Array.from({ length: redeemEpoch - revokeEpoch }).map((_, i) =>
                  scm.read.epochRedeemAmounts([this.id.raw, assetId.raw, revokeEpoch + i])
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
                address: shareClassManager,
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
              this.pool.chainId
            )
          )
        )
      )
    )
  }

  /** @internal */
  _updateContract(chainId: number, target: HexString, payload: HexString) {
    const self = this
    return this._transact(async function* (ctx) {
      const [id, { hub }] = await Promise.all([
        self._root.id(chainId),
        self._root._protocolAddresses(self.pool.chainId),
      ])
      yield* wrapTransaction('Update contract', ctx, {
        contract: hub,
        data: encodeFunctionData({
          abi: ABI.Hub,
          functionName: 'updateContract',
          args: [self.pool.id.raw, self.id.raw, id, addressToBytes32(target), payload, 0n],
        }),
        messages: { [id]: [MessageType.UpdateContract] },
      })
    }, this.pool.chainId)
  }

  /** @internal */
  _epochOutstandingInvests() {
    return this._query(['epochOutstandingInvests'], () =>
      combineLatest([this._root._deployments()]).pipe(
        switchMap(([deployments]) =>
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
              const chainsById = new Map(deployments.blockchains.items.map((c) => [c.centrifugeId, c.id]))

              return data.epochOutstandingInvests.items.map((item) => ({
                assetId: new AssetId(item.assetId),
                chainId: Number(chainsById.get(item.asset.centrifugeId)),
                amount: new Balance(item.pendingAssetsAmount || 0, item.asset.decimals),
              }))
            }
          )
        )
      )
    )
  }

  /** @internal */
  _epochOutstandingRedeems() {
    return this._query(['epochOutstandingRedeems'], () =>
      combineLatest([this._root._deployments()]).pipe(
        switchMap(([deployments]) =>
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
              const chainsById = new Map(deployments.blockchains.items.map((c) => [c.centrifugeId, c.id]))

              return data.epochOutstandingRedeems.items.map((item) => ({
                assetId: new AssetId(item.assetId),
                chainId: Number(chainsById.get(item.asset.centrifugeId)),
                amount: new Balance(item.pendingSharesAmount || 0, 18),
              }))
            }
          )
        )
      )
    )
  }

  /** @internal */
  _share(chainId: number) {
    return this._query(['share', chainId], () =>
      this.pool.network(chainId).pipe(switchMap((network) => network._share(this.id)))
    )
  }

  /** @internal */
  _restrictionManager(chainId: number) {
    return this._query(['restrictionManager', chainId], () =>
      this._share(chainId).pipe(
        switchMap((share) =>
          defer(async () => {
            const address = await this._root.getClient(chainId).readContract({
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
      this._root._protocolAddresses(this.pool.chainId).pipe(
        map(({ accounting }) => ({ accounting, id: null, triesLeft: 10 })),
        expand(({ accounting, triesLeft }) => {
          const id = Number(randomUint(32))

          if (triesLeft <= 0) return EMPTY

          return defer(async () => {
            const exists = await this._root.getClient(this.pool.chainId).readContract({
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
  _tokenInstancePositions(options?: { limit: number; offset?: number; balance_gt?: bigint }) {
    const limit = options?.limit ?? 1000
    const offset = options?.offset ?? 0
    const balance_gt = options?.balance_gt
    const queryParams = `$scId: String!, $limit: Int!, $offset: Int!${balance_gt ? ', $balance_gt: BigInt' : ''}`

    return this._query(['tokenInstancePositions', this.id.raw, limit, offset, balance_gt?.toString()], () =>
      this._root
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
          `query (${queryParams}) {
          tokenInstancePositions(
            where: {
              tokenId: $scId
              ${balance_gt ? 'balance_gt: $balance_gt' : ''}
            }
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
          {
            scId: this.id.raw,
            limit,
            offset,
            ...(balance_gt && { balance_gt: balance_gt.toString() }),
          }
        )
        .pipe(
          map((data) => {
            return {
              items: data.tokenInstancePositions.items,
              assets: data.assets.items,
              pageInfo: data.tokenInstancePositions.pageInfo,
              totalCount: data.tokenInstancePositions.totalCount,
            }
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
}
