import { Currency, Price } from '../utils/BigInt.js'

export type InvestorTransactionFilter = Partial<
  Record<keyof SubqueryInvestorTransactions['investorTransactions']['nodes'][0], any>
>

export type InvestorTransaction = {
  id: string
  poolId: string
  timestamp: Date
  accountId: string
  trancheId: string
  epochNumber: number
  type: SubqueryInvestorTransactionType
  currencyAmount: Currency
  tokenAmount: Currency
  tokenPrice: Price
  transactionFee: Currency
  chainId: number
  evmAddress?: string
  hash: string
}

export type SubqueryInvestorTransactionType =
  | 'INVEST_ORDER_UPDATE'
  | 'REDEEM_ORDER_UPDATE'
  | 'INVEST_ORDER_CANCEL'
  | 'REDEEM_ORDER_CANCEL'
  | 'INVEST_EXECUTION'
  | 'REDEEM_EXECUTION'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'INVEST_COLLECT'
  | 'REDEEM_COLLECT'
  | 'INVEST_LP_COLLECT'
  | 'REDEEM_LP_COLLECT'

type SubqueryInvestorTransactions = {
  investorTransactions: {
    nodes: {
      id: string
      poolId: string
      timestamp: string
      accountId: string
      account: {
        chainId: string
        evmAddress?: string
      }
      trancheId: string // poolId-trancheId
      pool: {
        currency: {
          decimals: number
        }
      }
      epochNumber: number
      type: SubqueryInvestorTransactionType
      hash: string
      currencyAmount?: string | null
      tokenAmount?: string | null
      tokenPrice?: string | null
      transactionFee?: string | null
    }[]
  }
}

export const investorTransactionsPostProcess = (data: SubqueryInvestorTransactions): InvestorTransaction[] => {
  return data.investorTransactions.nodes.map((tx) => {
    const currencyDecimals = tx.pool.currency.decimals
    return {
      id: tx.id,
      poolId: tx.poolId,
      timestamp: new Date(tx.timestamp),
      accountId: tx.accountId,
      chainId: Number(tx.account.chainId),
      evmAddress: tx.account.evmAddress,
      trancheId: tx.trancheId.split('-')[1] ?? '',
      epochNumber: tx.epochNumber,
      type: tx.type as SubqueryInvestorTransactionType,
      currencyAmount: new Currency(tx?.currencyAmount || 0n, currencyDecimals),
      tokenAmount: new Currency(tx?.tokenAmount || 0n, currencyDecimals),
      tokenPrice: new Price(tx?.tokenPrice ?? 0n),
      transactionFee: new Currency(tx?.transactionFee ?? 0n, currencyDecimals),
      hash: tx.hash,
    } satisfies InvestorTransaction
  })
}

export const investorTransactionsQuery = `
query($filter: InvestorTransactionFilter) {
    investorTransactions(
        orderBy: TIMESTAMP_ASC,
        filter: $filter
    ) {
        nodes {
            id
            timestamp
            accountId
            account {
                chainId
                evmAddress
            }
            pool {
                currency {
                    decimals
                }
            }
            hash
            poolId
            trancheId
            epochNumber
            type
            tokenAmount
            currencyAmount
            tokenPrice
            transactionFee
        }
    }
}
`
