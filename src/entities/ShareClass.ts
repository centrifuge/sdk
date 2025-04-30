import { combineLatest, defer, map, switchMap } from 'rxjs'
import { encodeFunctionData, getContract, parseAbi } from 'viem'
import { ABI } from '../abi/index.js'
import type { Centrifuge } from '../Centrifuge.js'
import { AccountType } from '../types/holdings.js'
import { Balance, Price } from '../utils/BigInt.js'
import { addressToBytes32 } from '../utils/index.js'
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
    id: string
  ) {
    super(_root, ['shareclass', id])
    this.id = new ShareClassId(id)
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
            navPerShare: metrics.navPerShare,
          }
        })
      )
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

            const [valuation, amount, value, assetDecimals, ...accounts] = await Promise.all([
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
              // contract.read.isLiability((this.pool.id.raw), this.id.raw, assetId),
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
              // isLiability,
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
                eventName: ['UpdateDepositRequest', 'UpdateRedeemRequest', 'ClaimDeposit', 'ClaimRedeem'],
                filter: (events) => {
                  return events.some((event) => {
                    return (
                      event.args.scId === this.id &&
                      event.args.investor === addressToBytes32(investor) &&
                      (event.args.depositAssetId === assetId.raw || event.args.payoutAssetId === assetId.raw)
                    )
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

  notifyAssetPrice(assetId: AssetId) {
    const self = this
    return this._transactSequence(async function* ({ walletClient, publicClient }) {
      const { hub } = await self._root._protocolAddresses(self.pool.chainId)
      // const approveData = encodeFunctionData({
      //   abi: ABI.Hub,
      //   functionName: 'notifyAssetPrice',
      //   args: [self.pool.id.raw, self.id.raw, assetId.raw],
      // })
      yield* doTransaction('Approve deposits', publicClient, () =>
        walletClient.writeContract({
          address: hub,
          abi: ABI.Hub,
          functionName: 'notifyAssetPrice',
          args: [self.pool.id.raw, self.id.raw, assetId.raw],
        })
      )
    }, this.pool.chainId)
  }

  approveDeposits(assetId: AssetId, assetAmount: Balance, navPerShare: Price) {
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
        args: [self.pool.id.raw, self.id.raw, assetId.raw, epoch.issueEpoch, navPerShare.toBigInt()],
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
          value: estimate,
        })
      )
    }, this.pool.chainId)
  }

  approveRedeems(assetId: AssetId, shareAmount: Balance, navPerShare: Price) {
    const self = this
    return this._transactSequence(async function* ({ walletClient, publicClient }) {
      const [{ hub }, epoch] = await Promise.all([
        self._root._protocolAddresses(self.pool.chainId),
        self._epoch(assetId),
      ])

      // TODO: Get share decimals and throw if mismatch with shareAmount decimals
      const approveData = encodeFunctionData({
        abi: ABI.Hub,
        functionName: 'approveRedeems',
        args: [self.pool.id.raw, self.id.raw, assetId.raw, epoch.redeemEpoch, shareAmount.toBigInt()],
      })
      const issueData = encodeFunctionData({
        abi: ABI.Hub,
        functionName: 'revokeShares',
        args: [self.pool.id.raw, self.id.raw, assetId.raw, epoch.revokeEpoch, navPerShare.toBigInt()],
      })
      yield* doTransaction('Approve redeems', publicClient, () =>
        walletClient.writeContract({
          address: hub,
          abi: ABI.Hub,
          functionName: 'multicall',
          args: [[approveData, issueData]],
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
      yield* doTransaction('Claim deposit', publicClient, () =>
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
            const [totalIssuance, navPerShare] = await this._root.getClient(this.pool.chainId)!.readContract({
              address: shareClassManager,
              abi: ABI.ShareClassManager,
              functionName: 'metrics',
              args: [this.id.raw],
            })
            return {
              totalIssuance: new Balance(totalIssuance, 18),
              navPerShare: new Balance(navPerShare, 18),
            }
          }).pipe(
            repeatOnEvents(
              this._root,
              {
                address: shareClassManager,
                abi: ABI.ShareClassManager,
                eventName: ['RevokeShares', 'IssueShares', 'RemoteIssueShares', 'RemoteRevokeShares'],
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
                eventName: ['ApproveDeposits', 'ApproveRedeems', 'IssueShares', 'RevokeShares'],
                filter: (events) => {
                  return events.some((event) => {
                    return event.args.poolId === this.pool.id
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
}
