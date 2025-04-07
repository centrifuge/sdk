import { Balance, Price } from '../../utils/BigInt.js'

export type AssetTransactionFilter = Partial<
  Record<keyof SubqueryAssetTransactions['assetTransactions']['nodes'][0], any>
>

export type AssetTransaction = {
  id: string
  timestamp: Date
  poolId: string
  accountId: string
  epochId: string
  type: AssetTransactionType
  amount: Balance
  settlementPrice: Price | null
  quantity: string | null
  principalAmount: Balance | null
  interestAmount: Balance | null
  hash: string
  realizedProfitFifo: Balance | undefined
  unrealizedProfitAtMarketPrice: Balance | undefined
  asset: {
    id: string
    metadata: string
    type: AssetType
    currentPrice: string | null
    name: string
  }
  fromAsset?: {
    id: string
    metadata: string
    type: AssetType
    name: string
  }
  toAsset?: {
    id: string
    metadata: string
    type: AssetType
    name: string
  }
}

export enum AssetType {
  OnchainCash = 'OnchainCash',
  OffchainCash = 'OffchainCash',
  Other = 'Other',
}

export type AssetTransactionType =
  | 'CREATED'
  | 'PRICED'
  | 'BORROWED'
  | 'REPAID'
  | 'CLOSED'
  | 'CASH_TRANSFER'
  | 'DEPOSIT_FROM_INVESTMENTS'
  | 'WITHDRAWAL_FOR_REDEMPTIONS'
  | 'WITHDRAWAL_FOR_FEES'
  | 'INCREASE_DEBT'
  | 'DECREASE_DEBT'

type SubqueryAssetTransactions = {
  assetTransactions: {
    nodes: {
      __typename?: 'AssetTransaction'
      id: string
      timestamp: string
      poolId: string
      accountId: string
      hash: string
      epochId: string
      type: AssetTransactionType
      amount: string | undefined
      principalAmount: string | undefined
      interestAmount: string | undefined
      settlementPrice: string | null
      quantity: string | null
      realizedProfitFifo: string | undefined
      pool: {
        currency: {
          decimals: number
        }
      }
      asset: {
        id: string
        metadata: string
        name: string
        type: AssetType
        sumRealizedProfitFifo: string
        unrealizedProfitAtMarketPrice: string
        currentPrice: string
      }
      fromAsset?: {
        id: string
        metadata: string
        name: string
        type: AssetType
      }
      toAsset?: {
        id: string
        metadata: string
        name: string
        type: AssetType
      }
    }[]
  }
}

export const assetTransactionsPostProcess = (data: SubqueryAssetTransactions): AssetTransaction[] => {
  return (
    data.assetTransactions.nodes.map((tx) => {
      const decimals = tx.pool.currency.decimals
      return {
        ...tx,
        name: tx.asset.name,
        settlementPrice: tx.settlementPrice ? new Price(tx.settlementPrice) : null,
        amount: new Balance(tx?.amount ?? 0n, decimals),
        principalAmount: tx.principalAmount ? new Balance(tx.principalAmount, decimals) : null,
        interestAmount: tx.interestAmount ? new Balance(tx.interestAmount, decimals) : null,
        realizedProfitFifo: tx.realizedProfitFifo ? new Balance(tx.realizedProfitFifo, decimals) : undefined,
        sumRealizedProfitFifo: tx.asset.sumRealizedProfitFifo
          ? new Balance(tx.asset.sumRealizedProfitFifo, decimals)
          : undefined,
        unrealizedProfitAtMarketPrice: tx.asset.unrealizedProfitAtMarketPrice
          ? new Balance(tx.asset.unrealizedProfitAtMarketPrice, decimals)
          : undefined,
        timestamp: new Date(`${tx.timestamp}+00:00`),
      }
    }) || ([] satisfies AssetTransaction[])
  )
}

export const assetTransactionsQuery = `
query($filter: AssetTransactionFilter) {
  assetTransactions(
    orderBy: TIMESTAMP_ASC,
    filter: $filter
  ) {
    nodes {
      principalAmount
      interestAmount
      epochId
      type
      timestamp
      amount
      settlementPrice
      quantity
      hash
      realizedProfitFifo
      pool {
        currency {
          decimals
        }
      }
      asset {
        id
        metadata
        name
        type
        sumRealizedProfitFifo
        unrealizedProfitAtMarketPrice
      }
      fromAsset {
        id
        metadata
        name
        type
      }
      toAsset {
        id
        metadata
        name
        type
      }
    }
  }
}
`
