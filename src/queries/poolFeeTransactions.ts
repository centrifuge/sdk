import { Currency } from '../utils/BigInt.js'

export type PoolFeeTransactionFilter = Partial<
  Record<keyof SubqueryPoolFeeTransaction['poolFeeTransactions']['nodes'][0], any>
>

export type PoolFeeTransaction = {
  feeId: string
  type: string
  timestamp: string
  blockNumber: string
  epochNumber: number
  amount: Currency
}

export type SubqueryPoolFeeTransaction = {
  poolFeeTransactions: {
    nodes: {
      id: string
      type: string
      timestamp: string
      blockNumber: string
      epochNumber: number
      amount: string
      poolFee: {
        feeId: string
        pool: {
          currency: {
            decimals: number
          }
        }
      }
    }[]
  }
}

export function poolFeeTransactionPostProcess(data: SubqueryPoolFeeTransaction): PoolFeeTransaction[] {
  return data.poolFeeTransactions.nodes.map((tx) => ({
    feeId: tx.id,
    type: tx.type,
    timestamp: tx.timestamp,
    blockNumber: tx.blockNumber,
    epochNumber: tx.epochNumber,
    amount: new Currency(tx.amount, tx.poolFee.pool.currency.decimals),
  }))
}

export const poolFeeTransactionQuery = `
query($filter: PoolFeeTransactionFilter) {
  poolFeeTransactions(
    orderBy: TIMESTAMP_ASC,
    filter: $filter
    ) {
    nodes {
      id
      type
      timestamp
      blockNumber
      epochNumber
      amount
      poolFee {
        feeId
        pool {
          currency {
            decimals
          }
        }
      }
    }
  }
}
`
