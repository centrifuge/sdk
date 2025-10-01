import { combineLatest, map, of, switchMap } from 'rxjs'
import { Centrifuge } from '../Centrifuge.js'
import type { HexString } from '../types/index.js'
import { AssetId, PoolId, ShareClassId } from '../utils/types.js'
import { Entity } from './Entity.js'
import { Balance } from '../utils/BigInt.js'

export class Investor extends Entity {
  address: HexString

  /** @internal */
  constructor(_root: Centrifuge, address: HexString) {
    const addr = address.toLowerCase() as HexString
    super(_root, ['investor', addr])
    this.address = addr
  }

  /**
   * Retrieve the portfolio of an investor.
   * @param chainId - The chain ID
   */
  portfolio(chainId?: number) {
    return this._query(['portfolio', chainId], () =>
      this._root
        ._queryIndexer<{
          vaults: { items: { assetAddress: HexString; blockchain: { id: string } }[] }
          tokenInstances: { items: { address: HexString; blockchain: { id: number } }[] }
        }>(
          `{
            vaults {
              items {
                assetAddress
                blockchain {
                  id
                }
              }
            }
            tokenInstances {
              items {
                address
                blockchain {
                  id
                }
              }
            }
          }`
        )
        .pipe(
          switchMap(({ vaults, tokenInstances }) => {
            const seenTuples = new Set()
            function check(chainId: string, asset: string) {
              const key = `${chainId}|${asset}`
              if (seenTuples.has(key)) {
                return true
              }
              seenTuples.add(key)
              return false
            }
            const all = [
              ...vaults.items
                .map((item) => ({ ...item, address: item.assetAddress }))
                // Exclude duplicate chainId/asset combinations
                .filter((item) => !check(item.blockchain.id, item.assetAddress)),
              ...tokenInstances.items,
            ].filter((item) => !chainId || Number(item.blockchain.id) === chainId)

            if (all.length === 0) return of([])

            return combineLatest(
              all.map((item) => this._root.balance(item.address, this.address, Number(item.blockchain.id)))
            )
          }),
          map((balances) => balances.filter((b) => b.balance.gt(0n)))
        )
    )
  }

  investment(poolId: PoolId, scId: ShareClassId, asset: HexString | AssetId, chainId: number) {
    return this._query(
      ['investment', poolId.toString(), scId.toString(), asset.toString().toLowerCase(), chainId],
      () =>
        this._root.pool(poolId).pipe(
          switchMap((pool) => pool.vault(chainId, scId, asset)),
          switchMap((vault) => vault.investment(this.address))
        )
    )
  }

  /**
   * Retrieve if an account is a member of a share class.
   */
  isMember(scId: ShareClassId, chainId: number) {
    return this._query(['isMember', scId.toString(), chainId], () =>
      this._root.pool(scId.poolId).pipe(
        switchMap((pool) => pool.shareClass(scId)),
        switchMap((shareClass) => shareClass.member(this.address, chainId)),
        map(({ isMember }) => isMember)
      )
    )
  }

  /**
   * Retrieve transactions given an address.
   */
  transactions(address: HexString, poolId: PoolId) {
    return this._query(['transactions', address.toString().toLowerCase(), poolId.toString()], () =>
      combineLatest([
        this._root.pool(poolId).pipe(switchMap((pool) => pool.currency())),
        this._root._queryIndexer<{
          investorTransactions: {
            items: {
              account: HexString
              createdAt: string
              type: string
              txHash: HexString
              // TODO: return with asset decimal once indexer is providing assetId
              currencyAmount: bigint
              token: {
                name: string
                symbol: string
              }
              tokenAmount: bigint
              fromCentrifugeId: string
              poolId: string
            }[]
          }
        }>(
          `query ($address: String!) {
            investorTransactions(where: { account: $address } limit: 1000) {
              items {
               account
               createdAt
               type
               txHash
               currencyAmount
               token {
                 name
                 symbol
               }
               tokenAmount
               fromCentrifugeId
               poolId
              }
            }
          }`,
          { address: address.toLowerCase() }
        ),
      ]).pipe(
        map(([currency, { investorTransactions }]) =>
          investorTransactions.items.map((item) => ({
            type: item.type,
            txHash: item.txHash,
            createdAt: item.createdAt,
            token: item.token.name,
            tokenAmount: new Balance(item.tokenAmount, currency.decimals),
            tokenSymbol: item.token.symbol,
            // TODO: For now let's assume is the same as pool - fix when indexer provides assetId
            currencyAmount: new Balance(item.currencyAmount, currency.decimals),
            chainId: this._root._idToChain(Number(item.fromCentrifugeId)),
            poolId: item.poolId,
          }))
        )
      )
    )
  }
}
