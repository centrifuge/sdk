import { catchError, combineLatest, defer, EMPTY, expand, filter, map, of, switchMap } from 'rxjs'
import { encodeFunctionData, encodePacked, getContract, parseAbi } from 'viem'
import { ABI } from '../abi/index.js'
import type { Centrifuge } from '../Centrifuge.js'
import { AccountType } from '../types/holdings.js'
import { CurrencyDetails, HexString } from '../types/index.js'
import { Balance, Price } from '../utils/BigInt.js'
import { addressToBytes32, randomUint } from '../utils/index.js'
import { repeatOnEvents } from '../utils/rx.js'
import { doTransaction } from '../utils/transaction.js'
import { AssetId, ShareClassId } from '../utils/types.js'
import { BalanceSheet } from './BalanceSheet.js'
import { Entity } from './Entity.js'
import type { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'

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
   * @returns The details of the share class, including name, symbol, total issuance, and NAV per share.
   */
  details() {
    return this._query(null, () =>
      combineLatest([this._metrics(), this._metadata(), this.navPerNetwork()]).pipe(
        map(([metrics, metadata, navPerNetwork]) => {
          const totalIssuance = navPerNetwork.reduce(
            (acc, item) => acc.add(item.totalIssuance),
            new Balance(0n, 18) // TODO: Replace with pool currency decimals
          )

          return {
            id: this.id,
            name: metadata.name,
            symbol: metadata.symbol,
            totalIssuance,
            pricePerShare: metrics.pricePerShare,
            nav: totalIssuance.mul(metrics.pricePerShare),
            navPerNetwork,
          }
        })
      )
    )
  }

  balanceSheet(chainId: number) {
    return this._query(null, () =>
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

  navPerNetwork() {
    return this._root._queryIndexer(
      `query ($scId: String!) {
        tokenInstances(where: { tokenId: $scId }) {
          items {
            totalIssuance
            tokenPrice
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
          }[]
        }
      }) =>
        data.tokenInstances.items.map((item) => ({
          chainId: Number(item.blockchain.id),
          totalIssuance: new Balance(item.totalIssuance, 18), // TODO: Replace with pool currency decimals
          pricePerShare: new Price(item.tokenPrice),
          nav: new Balance(item.totalIssuance, 18).mul(new Price(item.tokenPrice)),
        }))
    )
  }

  /**
   * Query the vaults of the share class.
   * @param chainId The chain ID to query the vaults on.
   * @returns The vaults of the share class on the given chain.
   */
  vaults(chainId: number) {
    return this._query(null, () => new PoolNetwork(this._root, this.pool, chainId).vaults(this.id))
  }

  /**
   * Query all the holdings of the share class.
   */
  holdings() {
    return this._query(null, () =>
      this._holdings().pipe(
        switchMap((res) => {
          if (res.holdings.items.length === 0) {
            return of([])
          }
          return combineLatest(
            res.holdings.items.map((holding) => {
              const assetId = new AssetId(holding.assetId)
              return this._holding(assetId)
            })
          ).pipe(
            map((holdings) =>
              holdings.map(({ assetDecimals: _, ...holding }, i) => {
                const data = res.holdings.items[i]!
                return {
                  ...holding,
                  asset: {
                    decimals: data.holdingEscrow.asset.decimals,
                    address: data.holdingEscrow.asset.address,
                    name: data.holdingEscrow.asset.name,
                    symbol: data.holdingEscrow.asset.symbol,
                    chainId: Number(data.holdingEscrow.asset.blockchain.id),
                  } satisfies Omit<CurrencyDetails, 'supportsPermit'>,
                }
              })
            )
          )
        })
      )
    )
  }

  /** @internal */
  _holding(assetId: AssetId) {
    return this._query(['holding', assetId.toString()], () =>
      this._root._protocolAddresses(this.pool.chainId).pipe(
        switchMap(({ holdings: holdingsAddr, hubRegistry }) =>
          defer(async () => {
            const holdings = getContract({
              address: holdingsAddr,
              abi: ABI.Holdings,
              client: this._root.getClient(this.pool.chainId)!,
            })

            const [valuation, amount, value, assetDecimals, isLiability, ...accounts] = await Promise.all([
              holdings.read.valuation([this.pool.id.raw, this.id.raw, assetId.raw]),
              holdings.read.amount([this.pool.id.raw, this.id.raw, assetId.raw]),
              holdings.read.value([this.pool.id.raw, this.id.raw, assetId.raw]),
              this._root.getClient(this.pool.chainId)!.readContract({
                address: hubRegistry,
                // Use inline ABI because of function overload
                abi: parseAbi(['function decimals(uint256) view returns (uint8)']),
                functionName: 'decimals',
                args: [assetId.raw],
              }),
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
              value: new Balance(value, 18), // TODO: Replace with pool currency decimals
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
                abi: ABI.Holdings,
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

  /**
   * Get the pending and approved amounts for deposits and redemptions for each asset.
   */
  pendingAmounts() {
    return this._query(null, () =>
      this._allVaults().pipe(
        switchMap((vaults) => {
          if (vaults.length === 0) {
            return of([])
          }
          return combineLatest(vaults.map((vault) => this._epoch(vault.assetId))).pipe(
            map((epochs) => {
              return epochs.map((epoch, i) => {
                const vault = vaults[i]!
                return {
                  assetId: vault.assetId,
                  chainId: vault.chainId,
                  ...epoch,
                }
              })
            })
          )
        })
      )
    )
  }

  investorOrder(assetId: AssetId, investor: HexString) {
    return this._query(['maxClaims', assetId.toString(), investor.toLowerCase()], () =>
      this._root._protocolAddresses(this.pool.chainId).pipe(
        switchMap(({ shareClassManager }) =>
          defer(async () => {
            const contract = getContract({
              address: shareClassManager,
              abi: ABI.ShareClassManager,
              client: this._root.getClient(this.pool.chainId)!,
            })

            const [maxDepositClaims, maxRedeemClaims] = await Promise.all([
              contract.read.maxDepositClaims([this.id.raw, addressToBytes32(investor), assetId.raw]),
              contract.read.maxRedeemClaims([this.id.raw, addressToBytes32(investor), assetId.raw]),
            ])
            return {
              maxDepositClaims,
              maxRedeemClaims,
            }
          }).pipe(
            repeatOnEvents(
              this._root,
              {
                address: shareClassManager,
                abi: ABI.ShareClassManager,
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
            const res = await this._root.getClient(this.pool.chainId)!.readContract({
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
                abi: ABI.RestrictionManager,
                eventName: 'UpdateMember',
                filter: (events) =>
                  events.some(
                    (event) => event.args.user?.toLowerCase() === addr && event.args.token?.toLowerCase() === share
                  ),
              },
              chainId
            ),
            catchError(() => {
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
    return this._transact(async function* ({ walletClient, publicClient }) {
      const [{ hub }, metadata] = await Promise.all([
        self._root._protocolAddresses(self.pool.chainId),
        self.pool.metadata(),
      ])

      let tx
      if (isLiability) {
        const expenseAccount =
          (accounts as any)[AccountType.Expense] || metadata?.shareClasses?.[self.id.raw]?.defaultAccounts?.expense
        const liabilityAccount =
          (accounts as any)[AccountType.Liability] || metadata?.shareClasses?.[self.id.raw]?.defaultAccounts?.liability
        if (liabilityAccount === undefined) {
          throw new Error('Missing required accounts for liability creation')
        }
        if (expenseAccount) {
          tx = walletClient.writeContract({
            address: hub,
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
          tx = walletClient.writeContract({
            address: hub,
            abi: ABI.Hub,
            functionName: 'multicall',
            args: [[createAccountData, initHoldingData]],
          })
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
          tx = walletClient.writeContract({
            address: hub,
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
          tx = walletClient.writeContract({
            address: hub,
            abi: ABI.Hub,
            functionName: 'multicall',
            args: [[createAccountData, initHoldingData]],
          })
        }
      }

      yield* doTransaction('Create holding', publicClient, () => tx)
    }, this.pool.chainId)
  }

  updateSharePrice(pricePerShare: Price) {
    const self = this
    return this._transact(async function* ({ walletClient, publicClient }) {
      const { hub } = await self._root._protocolAddresses(self.pool.chainId)
      yield* doTransaction('Update price', publicClient, () =>
        walletClient.writeContract({
          address: hub,
          abi: ABI.Hub,
          functionName: 'updateSharePrice',
          args: [self.pool.id.raw, self.id.raw, pricePerShare.toBigInt()],
        })
      )
    }, this.pool.chainId)
  }

  setMaxAssetPriceAge(assetId: AssetId, maxPriceAge: number) {
    const self = this
    return this._transact(async function* ({ walletClient, publicClient }) {
      const { hub } = await self._root._protocolAddresses(self.pool.chainId)
      yield* doTransaction('Set max asset price age', publicClient, () =>
        walletClient.writeContract({
          address: hub,
          abi: ABI.Hub,
          functionName: 'setMaxAssetPriceAge',
          args: [self.pool.id.raw, self.id.raw, assetId.raw, BigInt(maxPriceAge)],
        })
      )
    }, this.pool.chainId)
  }

  setMaxSharePriceAge(chainId: number, maxPriceAge: number) {
    const self = this
    return this._transact(async function* ({ walletClient, publicClient }) {
      const [{ hub }, id] = await Promise.all([
        self._root._protocolAddresses(self.pool.chainId),
        self._root.id(chainId),
      ])
      yield* doTransaction('Set max share price age', publicClient, () =>
        walletClient.writeContract({
          address: hub,
          abi: ABI.Hub,
          functionName: 'setMaxSharePriceAge',
          args: [id, self.pool.id.raw, self.id.raw, BigInt(maxPriceAge)],
        })
      )
    }, this.pool.chainId)
  }

  notifyAssetPrice(assetId: AssetId) {
    const self = this
    return this._transact(async function* ({ walletClient, publicClient }) {
      const { hub } = await self._root._protocolAddresses(self.pool.chainId)
      yield* doTransaction('Notify asset price', publicClient, () =>
        walletClient.writeContract({
          address: hub,
          abi: ABI.Hub,
          functionName: 'notifyAssetPrice',
          args: [self.pool.id.raw, self.id.raw, assetId.raw],
        })
      )
    }, this.pool.chainId)
  }

  notifySharePrice(chainId: number) {
    const self = this
    return this._transact(async function* ({ walletClient, publicClient }) {
      const [{ hub }, id] = await Promise.all([
        self._root._protocolAddresses(self.pool.chainId),
        self._root.id(chainId),
      ])
      yield* doTransaction('Notify share price', publicClient, () =>
        walletClient.writeContract({
          address: hub,
          abi: ABI.Hub,
          functionName: 'notifySharePrice',
          args: [self.pool.id.raw, self.id.raw, id],
        })
      )
    }, this.pool.chainId)
  }

  /**
   * Approve deposits and issue shares for the given assets.
   * @param assets - Array of assets to approve deposits and/or issue shares for
   */
  approveDepositsAndIssueShares(
    assets: { assetId: AssetId; approveAssetAmount?: Balance; issuePricePerShare?: Price }[]
  ) {
    // TODO: Also claim orders
    const self = this
    return this._transact(async function* ({ walletClient, publicClient }) {
      const centIds = [...new Set(assets.map((a) => a.assetId.centrifugeId))]
      const [
        { hub },
        pendingAmounts,
        // ...estimates
      ] = await Promise.all([
        self._root._protocolAddresses(self.pool.chainId),
        self.pendingAmounts(),
        ...centIds.map((centId) => self._root._estimate(self.pool.chainId, { centId })),
      ])
      // const estimateByCentId: Map<number, bigint> = new Map(centIds.map((centId, i) => [centId, estimates[i]!]))

      const batch: HexString[] = []
      const estimate = 0n

      for (const asset of assets) {
        const pending = pendingAmounts.find((e) => e.assetId.equals(asset.assetId))
        if (!pending) {
          throw new Error(`No pending amount found for asset "${asset.assetId.toString()}"`)
        }

        let nextDepositEpoch = pending?.depositEpoch + 1

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
                nextDepositEpoch,
                asset.approveAssetAmount.toBigInt(),
              ],
            })
          )
          nextDepositEpoch++
        }

        const nextIssueEpoch = pending.issueEpoch + 1
        if (asset.issuePricePerShare) {
          if (nextIssueEpoch >= nextDepositEpoch) throw new Error('Nothing to issue')

          batch.push(
            ...Array.from({ length: nextDepositEpoch - nextIssueEpoch }, (_, i) =>
              encodeFunctionData({
                abi: ABI.Hub,
                functionName: 'issueShares',
                args: [
                  self.pool.id.raw,
                  self.id.raw,
                  asset.assetId.raw,
                  nextIssueEpoch + i,
                  asset.issuePricePerShare!.toBigInt(),
                ],
              })
            )
          )
        }
      }

      if (batch.length === 0) {
        throw new Error('No approve or issue actions provided')
      }

      yield* doTransaction('Approve and issue', publicClient, () => {
        if (batch.length === 1) {
          return walletClient.sendTransaction({
            data: batch[0],
            to: hub,
            value: estimate,
          })
        }
        return walletClient.writeContract({
          address: hub,
          abi: ABI.Hub,
          functionName: 'multicall',
          args: [batch],
          value: estimate,
        })
      })
    }, this.pool.chainId)
  }

  /**
   * Approve redeems and revoke shares for the given assets.
   * @param assets - Array of assets to approve redeems and/or revoke shares for
   */
  approveRedeemsAndRevokeShares(
    assets: { assetId: AssetId; approveShareAmount?: Balance; revokePricePerShare?: Price }[]
  ) {
    // TODO: Also claim orders
    const self = this
    return this._transact(async function* ({ walletClient, publicClient }) {
      const centIds = [...new Set(assets.map((a) => a.assetId.centrifugeId))]
      const [
        { hub },
        pendingAmounts,
        // ...estimates
      ] = await Promise.all([
        self._root._protocolAddresses(self.pool.chainId),
        self.pendingAmounts(),
        ...centIds.map((centId) => self._root._estimate(self.pool.chainId, { centId })),
      ])
      // const estimateByCentId: Map<number, bigint> = new Map(centIds.map((centId, i) => [centId, estimates[i]!]))

      const batch: HexString[] = []
      const estimate = 0n

      for (const asset of assets) {
        const pending = pendingAmounts.find((e) => e.assetId.equals(asset.assetId))
        if (!pending) {
          throw new Error(`No pending amount found for asset "${asset.assetId.toString()}"`)
        }

        let nextRedeemEpoch = pending.redeemEpoch + 1

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
                nextRedeemEpoch,
                asset.approveShareAmount.toBigInt(),
              ],
            })
          )
          nextRedeemEpoch++
        }

        const nextRevokeEpoch = pending.revokeEpoch + 1
        if (nextRevokeEpoch >= nextRedeemEpoch) throw new Error('Nothing to revoke')

        if (asset.revokePricePerShare) {
          if (nextRevokeEpoch >= nextRedeemEpoch) throw new Error('Nothing to revoke')

          if (asset.revokePricePerShare.lte(0n)) {
            throw new Error(`Revoke price per share must be greater than 0 for asset "${asset.assetId.toString()}"`)
          }

          batch.push(
            ...Array.from({ length: nextRedeemEpoch - nextRevokeEpoch }, (_, i) =>
              encodeFunctionData({
                abi: ABI.Hub,
                functionName: 'revokeShares',
                args: [
                  self.pool.id.raw,
                  self.id.raw,
                  asset.assetId.raw,
                  nextRevokeEpoch + i,
                  asset.revokePricePerShare!.toBigInt(),
                ],
              })
            )
          )
        }
      }
      if (batch.length === 0) {
        throw new Error('No approve or revoke actions provided')
      }
      yield* doTransaction('Approve and revoke', publicClient, () => {
        if (batch.length === 1) {
          return walletClient.sendTransaction({
            data: batch[0],
            to: hub,
            value: estimate,
          })
        }
        return walletClient.writeContract({
          address: hub,
          abi: ABI.Hub,
          functionName: 'multicall',
          args: [batch],
          value: estimate,
        })
      })
    }, this.pool.chainId)
  }

  /**
   * Claim a deposit on the Hub side for the given asset and investor after the shares have been issued.
   * This will send a message to the Spoke that will allow the investor to claim their shares.
   */
  claimDeposit(assetId: AssetId, investor: HexString) {
    const self = this
    return this._transact(async function* ({ walletClient, publicClient }) {
      const [{ hub }, investorOrder, estimate] = await Promise.all([
        self._root._protocolAddresses(self.pool.chainId),
        self.investorOrder(assetId, investor),
        self._root._estimate(self.pool.chainId, { centId: assetId.centrifugeId }),
      ])
      yield* doTransaction('Claim deposit', publicClient, () =>
        walletClient.writeContract({
          address: hub,
          abi: ABI.Hub,
          functionName: 'notifyDeposit',
          args: [
            self.pool.id.raw,
            self.id.raw,
            assetId.raw,
            addressToBytes32(investor),
            investorOrder.maxDepositClaims,
          ],
          value: estimate,
        })
      )
    }, this.pool.chainId)
  }

  /**
   * Claim a redemption on the Hub side for the given asset and investor after the shares have been revoked.
   * This will send a message to the Spoke that will allow the investor to claim their redeemed currency.
   */
  claimRedeem(assetId: AssetId, investor: HexString) {
    const self = this
    return this._transact(async function* ({ walletClient, publicClient }) {
      const [{ hub }, investorOrder, estimate] = await Promise.all([
        self._root._protocolAddresses(self.pool.chainId),
        self.investorOrder(assetId, investor),
        self._root._estimate(self.pool.chainId, { centId: assetId.centrifugeId }),
      ])
      yield* doTransaction('Claim redeem', publicClient, () =>
        walletClient.writeContract({
          address: hub,
          abi: ABI.Hub,
          functionName: 'notifyRedeem',
          args: [self.pool.id.raw, self.id.raw, assetId.raw, addressToBytes32(investor), investorOrder.maxRedeemClaims],
          value: estimate,
        })
      )
    }, this.pool.chainId)
  }

  /**
   * Update a member of the share class.
   * @param address Address of the investor
   * @param validUntil Time in seconds from Unix epoch until the investor is valid
   * @param chainId Chain ID of the network on which to update the member
   */
  updateMember(address: HexString, validUntil: number, chainId: number) {
    const self = this
    return this._transact(async function* ({ walletClient, publicClient }) {
      const [{ hub }, id, estimate] = await Promise.all([
        self._root._protocolAddresses(self.pool.chainId),
        self._root.id(chainId),
        self._root._estimate(self.pool.chainId, { chainId }),
      ])

      const payload = encodePacked(
        ['uint8', 'bytes32', 'uint64'],
        [/* UpdateRestrictionType.Member */ 1, addressToBytes32(address), BigInt(validUntil)]
      )
      yield* doTransaction('Update restriction', publicClient, () =>
        walletClient.writeContract({
          address: hub,
          abi: ABI.Hub,
          functionName: 'updateRestriction',
          args: [self.pool.id.raw, self.id.raw, id, payload, 0n],
          value: estimate,
        })
      )
    }, this.pool.chainId)
  }

  /** @internal */
  _holdings() {
    return this._root._queryIndexer<{
      holdings: {
        items: {
          assetId: string
          holdingEscrow: {
            asset: {
              decimals: number
              assetTokenId: string
              address: HexString
              name: string
              symbol: string
              blockchain: { id: string }
            }
          }
        }[]
      }
    }>(
      `query ($scId: String!) {
        holdings(where: { tokenId: $scId }) {
          items {
            assetId
            holdingEscrow {
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
        }
      }`,
      {
        scId: this.id.raw,
      }
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
            const [name, symbol] = await this._root.getClient(this.pool.chainId)!.readContract({
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
                abi: ABI.ShareClassManager,
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
            const [totalIssuance, pricePerShare] = await this._root.getClient(this.pool.chainId)!.readContract({
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
                abi: ABI.ShareClassManager,
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
  _epoch(assetId: AssetId) {
    return this._query(['epoch', assetId.toString()], () =>
      this._root._protocolAddresses(this.pool.chainId).pipe(
        switchMap(({ shareClassManager, hubRegistry }) =>
          defer(async () => {
            const scm = getContract({
              address: shareClassManager,
              abi: ABI.ShareClassManager,
              client: this._root.getClient(this.pool.chainId)!,
            })

            const [epoch, pendingDeposit, pendingRedeem, assetDecimals] = await Promise.all([
              scm.read.epochId([this.id.raw, assetId.raw]),
              scm.read.pendingDeposit([this.id.raw, assetId.raw]),
              scm.read.pendingRedeem([this.id.raw, assetId.raw]),
              this._root.getClient(this.pool.chainId)!.readContract({
                address: hubRegistry,
                // Use inline ABI because of function overload
                abi: parseAbi(['function decimals(uint256) view returns (uint8)']),
                functionName: 'decimals',
                args: [assetId.raw],
              }),
            ])

            const depositEpoch = epoch[0]
            const redeemEpoch = epoch[1]
            const issueEpoch = epoch[2]
            const revokeEpoch = epoch[3]

            const [depositEpochAmounts, redeemEpochAmount] = await Promise.all([
              Promise.all(
                Array.from({ length: depositEpoch - issueEpoch }).map((_, i) =>
                  scm.read.epochInvestAmounts([this.id.raw, assetId.raw, issueEpoch + i + 1])
                )
              ),
              Promise.all(
                Array.from({ length: redeemEpoch - revokeEpoch }).map((_, i) =>
                  scm.read.epochRedeemAmounts([this.id.raw, assetId.raw, revokeEpoch + i + 1])
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
              // TODO: Replace with assetDecimals()
              pendingDeposit: new Balance(pendingDeposit, assetDecimals),
              // TODO: Replace with assetDecimals()
              pendingRedeem: new Balance(pendingRedeem, 18),
              approvedDeposit: new Balance(approvedDeposit, assetDecimals),
              approvedRedeem: new Balance(approvedRedeem, 18),
            }
          }).pipe(
            repeatOnEvents(
              this._root,
              {
                address: shareClassManager,
                abi: ABI.ShareClassManager,
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
    return this._transact(async function* ({ walletClient, publicClient }) {
      const id = await self._root.id(chainId)
      const [{ hub }, estimate] = await Promise.all([
        self._root._protocolAddresses(self.pool.chainId),
        self._root._estimate(self.pool.chainId, { centId: id }),
      ])

      yield* doTransaction('Update contract', publicClient, () =>
        walletClient.writeContract({
          address: hub,
          abi: ABI.Hub,
          functionName: 'updateContract',
          args: [self.pool.id.raw, self.id.raw, id, addressToBytes32(target), payload, 0n],
          value: estimate,
        })
      )
    }, this.pool.chainId)
  }

  /** @internal */
  _share(chainId: number) {
    return this._query(null, () => this.pool.network(chainId).pipe(switchMap((network) => network._share(this.id))))
  }

  /** @internal */
  _restrictionManager(chainId: number) {
    return this._query(['restrictionManager', chainId], () =>
      this._share(chainId).pipe(
        switchMap((share) =>
          defer(async () => {
            const address = await this._root.getClient(this.pool.chainId)!.readContract({
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
    return this._query(null, () =>
      this._root._protocolAddresses(this.pool.chainId).pipe(
        map(({ accounting }) => ({ accounting, id: null, triesLeft: 10 })),
        expand(({ accounting, triesLeft }) => {
          const id = Number(randomUint(32))

          if (triesLeft <= 0) return EMPTY

          return defer(async () => {
            const exists = await this._root.getClient(this.pool.chainId)!.readContract({
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
}
