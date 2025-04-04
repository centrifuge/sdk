import { Balance } from '../../utils/BigInt.js'

export type PoolFeeTransactionFilter = Partial<
  Record<keyof SubqueryPoolFeeTransaction['poolFeeTransactions']['nodes'][0], any>
>

export type PoolFeeTransaction = {
  feeId: string
  type: SubqueryPoolFeeTransactionType
  timestamp: string
  blockNumber: string
  epochNumber: number
  amount: Balance
}

export type SubqueryPoolFeeTransactionType =
  | 'PROPOSED'
  | 'ADDED'
  | 'REMOVED'
  | 'CHARGED'
  | 'UNCHARGED'
  | 'ACCRUED'
  | 'PAID'

export type SubqueryPoolFeeTransaction = {
  poolFeeTransactions: {
    nodes: {
      id: string
      type: SubqueryPoolFeeTransactionType
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
    type: tx.type as PoolFeeTransaction['type'],
    timestamp: tx.timestamp,
    blockNumber: tx.blockNumber,
    epochNumber: tx.epochNumber,
    amount: new Balance(tx.amount, tx.poolFee.pool.currency.decimals),
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
