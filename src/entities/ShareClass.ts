import { combineLatest, defer, map, switchMap } from 'rxjs'
import { encodeFunctionData, getContract, toHex } from 'viem'
import { ABI } from '../abi/index.js'
import type { Centrifuge } from '../Centrifuge.js'
import { AccountType } from '../types/holdings.js'
import { Balance, Price } from '../utils/BigInt.js'
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
        switchMap(({ holdings }) =>
          defer(async () => {
            const contract = getContract({
              address: holdings,
              abi: ABI.Holdings,
              client: this._root.getClient(this.pool.chainId)!,
            })

            const [valuation, amount, value, ...accounts] = await Promise.all([
              contract.read.valuation([this.pool.id.raw, this.id.raw, assetId.raw]),
              contract.read.amount([this.pool.id.raw, this.id.raw, assetId.raw]),
              contract.read.value([this.pool.id.raw, this.id.raw, assetId.raw]),
              // contract.read.isLiability((this.pool.id.raw), this.id.raw, assetId),
              ...[
                AccountType.Asset,
                AccountType.Equity,
                AccountType.Loss,
                AccountType.Gain,
                AccountType.Expense,
                AccountType.Liability,
              ].map((kind) => contract.read.accountId([this.pool.id.raw, this.id.raw, assetId.raw, kind])),
            ])
            return {
              assetId,
              valuation,
              amount: new Balance(amount, 18),
              value: new Balance(value, 18),
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
                address: holdings,
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

  approveDeposits(assetId: AssetId, investAmount: Balance, navPerShare: Price) {
    const self = this
    return this._transactSequence(async function* ({ walletClient, publicClient }) {
      const [{ poolRouter }, holding] = await Promise.all([
        self._root._protocolAddresses(self.pool.chainId),
        self.holding(assetId),
      ])
      const approveData = encodeFunctionData({
        abi: ABI.PoolRouter,
        functionName: 'approveDeposits',
        args: [self.id.raw, assetId.raw, investAmount.toBigInt(), holding.valuation],
      })
      const issueData = encodeFunctionData({
        abi: ABI.PoolRouter,
        functionName: 'issueShares',
        args: [self.id.raw, assetId.raw, navPerShare.toBigInt()],
      })
      yield* doTransaction('Approve deposits', publicClient, () =>
        walletClient.writeContract({
          address: poolRouter,
          abi: ABI.PoolRouter,
          functionName: 'multicall',
          args: [[approveData, issueData]],
        })
      )
    }, this.pool.chainId)
  }

  approveRedeems(assetId: AssetId, shareAmount: Balance, navPerShare: Price) {
    const self = this
    return this._transactSequence(async function* ({ walletClient, publicClient }) {
      const [{ poolRouter }, holding] = await Promise.all([
        self._root._protocolAddresses(self.pool.chainId),
        self.holding(assetId),
      ])
      const approveData = encodeFunctionData({
        abi: ABI.PoolRouter,
        functionName: 'approveRedeems',
        args: [self.id.raw, assetId.raw, shareAmount.toBigInt()],
      })
      const issueData = encodeFunctionData({
        abi: ABI.PoolRouter,
        functionName: 'revokeShares',
        args: [self.id.raw, assetId.raw, navPerShare.toBigInt(), holding.valuation],
      })
      yield* doTransaction('Approve redeems', publicClient, () =>
        walletClient.writeContract({
          address: poolRouter,
          abi: ABI.PoolRouter,
          functionName: 'multicall',
          args: [[approveData, issueData]],
        })
      )
    }, this.pool.chainId)
  }

  claimDeposit(assetId: AssetId, investor: string) {
    const self = this
    return this._transactSequence(async function* ({ walletClient, publicClient }) {
      const [{ poolRouter }, estimate] = await Promise.all([
        self._root._protocolAddresses(self.pool.chainId),
        self._root._estimate(self.pool.chainId, { centId: assetId.centrifugeId }),
      ])
      yield* doTransaction('Claim deposit', publicClient, () =>
        walletClient.writeContract({
          address: poolRouter,
          abi: ABI.PoolRouter,
          functionName: 'claimDeposit',
          args: [self.pool.id.raw, self.id.raw, assetId.raw, toHex(investor, { size: 32 })],
          value: estimate,
        })
      )
    })
  }

  claimRedeem(assetId: AssetId, investor: string) {
    const self = this
    return this._transactSequence(async function* ({ walletClient, publicClient }) {
      const [{ poolRouter }, estimate] = await Promise.all([
        self._root._protocolAddresses(self.pool.chainId),
        self._root._estimate(self.pool.chainId, { centId: assetId.centrifugeId }),
      ])
      yield* doTransaction('Claim deposit', publicClient, () =>
        walletClient.writeContract({
          address: poolRouter,
          abi: ABI.PoolRouter,
          functionName: 'claimRedeem',
          args: [self.pool.id.raw, self.id.raw, assetId.raw, toHex(investor, { size: 32 })],
          value: estimate,
        })
      )
    })
  }

  /** @internal */
  _metadata() {
    return this._query(['metadata'], () =>
      this.pool._shareClassManager().pipe(
        switchMap((scm) =>
          defer(async () => {
            const [name, symbol] = await this._root.getClient(this.pool.chainId)!.readContract({
              address: scm,
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
                address: scm,
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
      this.pool._shareClassManager().pipe(
        switchMap((scm) =>
          defer(async () => {
            const [totalIssuance, navPerShare] = await this._root.getClient(this.pool.chainId)!.readContract({
              address: scm,
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
                address: scm,
                abi: ABI.ShareClassManager,
                eventName: ['RevokeShares', 'IssueShares'],
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
}
