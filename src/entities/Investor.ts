import { combineLatest, map, of, switchMap } from 'rxjs'
import { Centrifuge } from '../Centrifuge.js'
import type { HexString } from '../types/index.js'
import { Balance, Price } from '../utils/BigInt.js'
import { AssetId, CentrifugeId, PoolId, ShareClassId } from '../utils/types.js'
import { Entity } from './Entity.js'

export class Investor extends Entity {
  address: HexString

  /** @internal */
  constructor(_root: Centrifuge, address: HexString) {
    const addr = address.toLowerCase() as HexString
    super(_root, ['investor', addr])
    this.address = addr
  }

  /**
   * Retrieve the portfolio of an investor
   * @param centrifugeId - The centrifuge ID
   */
  portfolio(centrifugeId?: CentrifugeId) {
    return this._query(['portfolio', centrifugeId], () =>
      this._root
        ._queryIndexer<{
          vaults: { items: { assetAddress: HexString; centrifugeId: string }[] }
          tokenInstances: { items: { address: HexString; centrifugeId: string }[] }
        }>(
          `{
            vaults {
              items {
                assetAddress
                centrifugeId
              }
            }
            tokenInstances {
              items {
                address
                centrifugeId
              }
            }
          }`
        )
        .pipe(
          switchMap(({ vaults, tokenInstances }) => {
            const seenTuples = new Set()
            function check(centrifugeId: string, asset: string) {
              const key = `${centrifugeId}|${asset}`
              if (seenTuples.has(key)) {
                return true
              }
              seenTuples.add(key)
              return false
            }
            const all = [
              ...vaults.items
                .map((item) => ({ ...item, address: item.assetAddress }))
                // Exclude duplicate centrifugeId/asset combinations
                .filter((item) => !check(item.centrifugeId, item.assetAddress)),
              ...tokenInstances.items,
            ].filter((item) => !centrifugeId || Number(item.centrifugeId) === centrifugeId)

            if (all.length === 0) return of([])

            return combineLatest(
              all.map((item) => this._root.balance(item.address, this.address, Number(item.centrifugeId)))
            )
          }),
          map((balances) => balances.filter((b) => b.balance.gt(0n)))
        )
    )
  }

  /**
   * Retrieve the investment of an investor.
   * @param poolId - The pool ID
   * @param scId - The share class ID
   * @param asset - The asset ID
   * @param centrifugeId - The centrifuge ID of the network
   */
  investment(poolId: PoolId, scId: ShareClassId, asset: HexString | AssetId, centrifugeId: CentrifugeId) {
    return this._query(
      ['investment', poolId.toString(), scId.toString(), asset.toString().toLowerCase(), centrifugeId],
      () =>
        this._root.pool(poolId).pipe(
          switchMap((pool) => pool.vault(centrifugeId, scId, asset)),
          switchMap((vault) => vault.investment(this.address))
        )
    )
  }

  /**
   * Retrieve if an account is a member of a share class.
   * @param scId - The share class ID
   * @param centrifugeId - The centrifuge ID of the network
   */
  isMember(scId: ShareClassId, centrifugeId: CentrifugeId) {
    return this._query(['isMember', scId.toString(), centrifugeId], () =>
      this._root.pool(scId.poolId).pipe(
        switchMap((pool) => pool.shareClass(scId)),
        switchMap((shareClass) => shareClass.member(this.address, centrifugeId)),
        map(({ isMember }) => isMember)
      )
    )
  }
  /**
   * Retrieve the transactions of an investor.
   * @param poolId
   * @param page
   * @param pageSize
   */
  transactions(poolId: PoolId, page: number = 1, pageSize: number = 10) {
    const offset = (page - 1) * pageSize

    return this._query(['transactions', poolId.toString(), page, pageSize], () =>
      this._root
        ._queryIndexer<{
          investorTransactions: {
            items: {
              account: HexString
              createdAt: string
              type: string
              txHash: HexString
              currencyAmount: string
              currencyAsset: {
                decimals: number
                symbol: string
                id: string
                address: string
              } | null
              token: { name: string; symbol: string; decimals: string } | null
              tokenAmount: string | null
              tokenPrice: string | null
              centrifugeId: string
              poolId: string
            }[]
            totalCount: number
          }
        }>(
          `query ($address: String!, $poolId: BigInt!, $limit: Int!, $offset: Int!) {
            investorTransactions(
              where: {
                account: $address,
                poolId: $poolId
              }
              limit: $limit
              offset: $offset
            ) {
              items {
                account
                createdAt
                type
                txHash
                currencyAmount
                currencyAsset {
                  decimals
                  symbol
                  id
                  address
                }
                token { name symbol decimals }
                tokenAmount
                tokenPrice
                centrifugeId
                poolId
              }
              totalCount
            }
          }`,
          {
            address: this.address.toLowerCase(),
            poolId: poolId.toString(),
            limit: pageSize,
            offset,
          }
        )
        .pipe(
          map(({ investorTransactions }) => {
            return {
              transactions: investorTransactions.items
                .filter((item) => item.poolId === poolId.toString())
                .map((item) => {
                  return {
                    type: item.type,
                    txHash: item.txHash,
                    createdAt: item.createdAt,
                    currency: item.currencyAsset
                      ? {
                          amount: new Balance(item.currencyAmount, item.currencyAsset.decimals),
                          symbol: item.currencyAsset.symbol,
                          decimals: item.currencyAsset.decimals,
                          id: item.currencyAsset.id,
                          address: item.currencyAsset.address,
                        }
                      : undefined,
                    token:
                      item.token && item.tokenAmount
                        ? {
                            name: item.token.name,
                            symbol: item.token.symbol,
                            decimals: Number(item.token.decimals),
                            amount: new Balance(item.tokenAmount, Number(item.token.decimals)),
                          }
                        : undefined,
                    tokenPrice: item.tokenPrice ? new Price(item.tokenPrice) : undefined,
                    centrifugeId: item.centrifugeId,
                    poolId: item.poolId,
                  }
                })
                .filter((item): item is NonNullable<typeof item> => item !== null),
              totalCount: investorTransactions.totalCount || investorTransactions.items.length,
              page,
              pageSize,
            }
          })
        )
    )
  }

  allTransactions(poolId: PoolId) {
    return this.transactions(poolId, 1, 1000)
  }
}
