import { catchError, combineLatest, defer, EMPTY, expand, filter, map, of, switchMap } from 'rxjs'
import { encodeFunctionData, encodePacked, getContract, parseAbi } from 'viem'
import { ABI } from '../abi/index.js'
import type { Centrifuge } from '../Centrifuge.js'
import { AccountType } from '../types/holdings.js'
import { HexString } from '../types/index.js'
import { Balance, Price } from '../utils/BigInt.js'
import { addressToBytes32, randomUint } from '../utils/index.js'
import { repeatOnEvents } from '../utils/rx.js'
import { doTransaction } from '../utils/transaction.js'
import { AssetId, ShareClassId } from '../utils/types.js'
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
      combineLatest([this._metrics(), this._metadata()]).pipe(
        map(([metrics, metadata]) => {
          return {
            id: this.id,
            name: metadata.name,
            symbol: metadata.symbol,
            totalIssuance: metrics.totalIssuance,
            pricePerShare: metrics.pricePerShare,
            nav: metrics.totalIssuance.mul(metrics.pricePerShare),
          }
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
            blockchain: { id: number }
          }[]
        }
      }) =>
        data.tokenInstances.items.map((item) => ({
          chainId: item.blockchain.id,
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

  holdings() {
    return this._query(null, () =>
      this._root
        ._queryIndexer<{
          holdings: {
            items: {
              assetRegistrationId: string
            }[]
          }
        }>(
          `query ($scId: String!) {
            holdings(where: { tokenId: $scId }) {
              items {
                assetRegistrationId
              }
            }
          }`,
          {
            scId: this.id.raw,
          }
        )
        .pipe(
          switchMap((res) =>
            combineLatest(
              res.holdings.items.map((holding) => {
                const assetId = new AssetId(holding.assetRegistrationId)
                return this.holding(assetId)
              })
            )
          )
        )
    )
  }

  /**
   * Query a holding of the share class.
   * @param assetId The asset ID
   * @returns The details of the holding
   */
  holding(assetId: AssetId) {
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

  investorOrder(assetId: AssetId, investor: string) {
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
  member(address: string, chainId: number) {
    const addr = address.toLowerCase()
    return this._query(['member', addr, chainId], () =>
      combineLatest([this._share(chainId), this._restrictionManager(chainId)]).pipe(
        switchMap(([share, restrictionManager]) =>
          defer(async () => {
            const res = await this._root.getClient(this.pool.chainId)!.readContract({
              address: restrictionManager,
              abi: ABI.RestrictionManager,
              functionName: 'isMember',
              args: [share, addr as HexString],
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
    accounts: Liability extends true
      ? { [key in AccountType.Expense | AccountType.Liability]?: number }
      : { [key in AccountType.Asset | AccountType.Equity | AccountType.Loss | AccountType.Gain]?: number }
  ) {
    const self = this
    return this._transactSequence(async function* ({ walletClient, publicClient }) {
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
    return this._transactSequence(async function* ({ walletClient, publicClient }) {
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
    return this._transactSequence(async function* ({ walletClient, publicClient }) {
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
    return this._transactSequence(async function* ({ walletClient, publicClient }) {
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
    return this._transactSequence(async function* ({ walletClient, publicClient }) {
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
    return this._transactSequence(async function* ({ walletClient, publicClient }) {
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

  approveDeposits(assetId: AssetId, assetAmount: Balance, pricePerShare: Price) {
    const self = this
    return this._transactSequence(async function* ({ walletClient, publicClient }) {
      const [{ hub }, epoch, estimate] = await Promise.all([
        self._root._protocolAddresses(self.pool.chainId),
        self._epoch(assetId),
        self._root._estimate(self.pool.chainId, { centId: assetId.centrifugeId }),
      ])

      // TODO: Get asset decimals and throw if mismatch with assetAmount decimals

      // const updateAssetData = encodeFunctionData({
      //   abi: ABI.Hub,
      //   functionName: 'notifyAssetPrice',
      //   args: [self.pool.id.raw, self.id.raw, assetId.raw],
      // })
      // TODO: Remove when BalanceSheet bug is fixed
      const updateShareData = encodeFunctionData({
        abi: ABI.Hub,
        functionName: 'notifySharePrice',
        args: [self.pool.id.raw, self.id.raw, 1],
      })
      const approveData = encodeFunctionData({
        abi: ABI.Hub,
        functionName: 'approveDeposits',
        args: [self.pool.id.raw, self.id.raw, assetId.raw, epoch.depositEpoch, assetAmount.toBigInt()],
      })
      const issueData = encodeFunctionData({
        abi: ABI.Hub,
        functionName: 'issueShares',
        args: [self.pool.id.raw, self.id.raw, assetId.raw, epoch.issueEpoch, pricePerShare.toBigInt()],
      })
      yield* doTransaction('Approve deposits', publicClient, () =>
        walletClient.writeContract({
          address: hub,
          abi: ABI.Hub,
          functionName: 'multicall',
          args: [
            [
              //updateAssetData,
              updateShareData,
              approveData,
              issueData,
            ],
          ],
          value: estimate * 3n, // for 3 messages
        })
      )
    }, this.pool.chainId)
  }

  approveRedeems(assetId: AssetId, shareAmount: Balance, pricePerShare: Price) {
    const self = this
    return this._transactSequence(async function* ({ walletClient, publicClient }) {
      const [{ hub }, epoch, estimate] = await Promise.all([
        self._root._protocolAddresses(self.pool.chainId),
        self._epoch(assetId),
        self._root._estimate(self.pool.chainId, { centId: assetId.centrifugeId }),
      ])

      // TODO: Get share decimals and throw if mismatch with shareAmount decimals

      // TODO: Remove when BalanceSheet bug is fixed
      const updateShareData = encodeFunctionData({
        abi: ABI.Hub,
        functionName: 'notifySharePrice',
        args: [self.pool.id.raw, self.id.raw, 1],
      })
      const approveData = encodeFunctionData({
        abi: ABI.Hub,
        functionName: 'approveRedeems',
        args: [self.pool.id.raw, self.id.raw, assetId.raw, epoch.redeemEpoch, shareAmount.toBigInt()],
      })
      const issueData = encodeFunctionData({
        abi: ABI.Hub,
        functionName: 'revokeShares',
        args: [self.pool.id.raw, self.id.raw, assetId.raw, epoch.revokeEpoch, pricePerShare.toBigInt()],
      })
      yield* doTransaction('Approve redeems', publicClient, () =>
        walletClient.writeContract({
          address: hub,
          abi: ABI.Hub,
          functionName: 'multicall',
          args: [[updateShareData, approveData, issueData]],
          value: estimate * 3n, // for 3 messages
        })
      )
    }, this.pool.chainId)
  }

  claimDeposit(assetId: AssetId, investor: string) {
    const self = this
    return this._transactSequence(async function* ({ walletClient, publicClient }) {
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

  claimRedeem(assetId: AssetId, investor: string) {
    const self = this
    return this._transactSequence(async function* ({ walletClient, publicClient }) {
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
  updateMember(address: string, validUntil: number, chainId: number) {
    const self = this
    return this._transactSequence(async function* ({ walletClient, publicClient }) {
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
          args: [self.pool.id.raw, self.id.raw, id, payload, 15_000_000n],
          value: estimate,
        })
      )
    }, this.pool.chainId)
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

            return {
              depositEpoch: epoch[0] + 1,
              redeemEpoch: epoch[1] + 1,
              issueEpoch: epoch[2] + 1,
              revokeEpoch: epoch[3] + 1,
              // TODO: Replace with assetDecimals()
              pendingDeposit: new Balance(pendingDeposit, assetDecimals),
              // TODO: Replace with assetDecimals()
              pendingRedeem: new Balance(pendingRedeem, 18),
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
  _updateContract(chainId: number, target: string, payload: HexString) {
    const self = this
    return this._transactSequence(async function* ({ walletClient, publicClient }) {
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
          args: [self.pool.id.raw, self.id.raw, id, addressToBytes32(target), payload, 15_000_000n],
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
