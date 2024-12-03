import { Currency, Price } from '../utils/BigInt.js'

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
  amount: Currency
  settlementPrice: Price | null
  quantity: string | null
  principalAmount: Currency | undefined
  interestAmount: Currency | undefined
  hash: string
  realizedProfitFifo: Currency | undefined
  unrealizedProfitAtMarketPrice: Currency | undefined
  asset: {
    id: string
    metadata: string
    type: AssetType
    currentPrice: string | null
  }
  fromAsset?: {
    id: string
    metadata: string
    type: AssetType
  }
  toAsset?: {
    id: string
    metadata: string
    type: AssetType
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
    data.assetTransactions.nodes.map((day) => {
      const decimals = day.pool.currency.decimals
      return {
        ...day,
        settlementPrice: day.settlementPrice ? new Price(day.settlementPrice) : null,
        amount: new Currency(day?.amount ?? 0n, decimals),
        principalAmount: day.principalAmount ? new Currency(day.principalAmount, decimals) : undefined,
        interestAmount: day.interestAmount ? new Currency(day.interestAmount, decimals) : undefined,
        realizedProfitFifo: day.realizedProfitFifo ? new Currency(day.realizedProfitFifo, decimals) : undefined,
        sumRealizedProfitFifo: day.asset.sumRealizedProfitFifo
          ? new Currency(day.asset.sumRealizedProfitFifo, decimals)
          : undefined,
        unrealizedProfitAtMarketPrice: day.asset.unrealizedProfitAtMarketPrice
          ? new Currency(day.asset.unrealizedProfitAtMarketPrice, decimals)
          : undefined,
        timestamp: new Date(`${day.timestamp}+00:00`),
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
