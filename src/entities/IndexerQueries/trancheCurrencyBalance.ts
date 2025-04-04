import { Balance } from '../../utils/BigInt.js'

export type TrancheCurrencyBalanceFilter =
  | Partial<Record<keyof SubqueryTrancheBalances['trancheBalances']['nodes'][0], any>>
  | Partial<Record<keyof SubqueryCurrencyBalances['currencyBalances']['nodes'][0], any>>

export type TrancheBalanceFilter = Partial<Record<keyof SubqueryTrancheBalances['trancheBalances']['nodes'][0], any>>
export type CurrencyBalanceFilter = Partial<Record<keyof SubqueryCurrencyBalances['currencyBalances']['nodes'][0], any>>

export function trancheCurrencyBalancePostProcessor(data: SubqueryTrancheBalances & SubqueryCurrencyBalances) {
  const currencyBalancesByAccountId: Record<string, SubqueryCurrencyBalances['currencyBalances']['nodes'][0]> = {}
  data!.currencyBalances.nodes.forEach((balance) => {
    const trancheId = balance.currency.trancheId?.split('-')[1] ?? ''
    currencyBalancesByAccountId[`${balance.accountId}-${trancheId}`] = balance
  })

  return data!.trancheBalances.nodes.map((balance) => {
    const currencyDecimals = balance.pool.currency.decimals
    return {
      accountId: balance.accountId,
      chainId: balance.account?.chainId !== '0' ? Number(balance.account?.chainId) : 'centrifuge',
      trancheId: balance.trancheId.split('-')[1] ?? '',
      evmAddress: balance.account?.evmAddress,
      balance: new Balance(
        currencyBalancesByAccountId[`${balance.accountId}-${balance.trancheId.split('-')[1]}`]?.amount ?? 0,
        currencyDecimals
      ),
      pendingInvestCurrency: new Balance(balance.pendingInvestCurrency, currencyDecimals),
      claimableTrancheTokens: new Balance(balance.claimableTrancheTokens, currencyDecimals),
      sumClaimedTrancheTokens: new Balance(balance.sumClaimedTrancheTokens, currencyDecimals),
      pendingRedeemTrancheTokens: new Balance(balance.pendingRedeemTrancheTokens, currencyDecimals),
      claimableCurrency: new Balance(balance.claimableCurrency, currencyDecimals),
      sumClaimedCurrency: new Balance(balance.sumClaimedCurrency, currencyDecimals),
    } satisfies TrancheCurrencyBalance
  })
}

export type TrancheCurrencyBalance = {
  accountId: string
  chainId: number | 'centrifuge'
  trancheId: string
  evmAddress?: string
  balance: Balance
  pendingInvestCurrency: Balance
  claimableTrancheTokens: Balance
  sumClaimedTrancheTokens: Balance
  pendingRedeemTrancheTokens: Balance
  claimableCurrency: Balance
  sumClaimedCurrency: Balance
}

export type SubqueryTrancheBalances = {
  trancheBalances: {
    nodes: {
      __typename?: 'TrancheBalances'
      id: string
      timestamp: string
      accountId: string
      account: {
        chainId: string
        evmAddress?: string
      }
      pool: {
        currency: {
          decimals: number
        }
      }
      poolId: string
      trancheId: string
      pendingInvestCurrency: string
      claimableTrancheTokens: string
      sumClaimedTrancheTokens: string
      pendingRedeemTrancheTokens: string
      claimableCurrency: string
      sumClaimedCurrency: string
    }[]
  }
}

export type SubqueryCurrencyBalances = {
  currencyBalances: {
    nodes: {
      __typename?: 'CurrencyBalances'
      id: string
      accountId: string
      currency: {
        trancheId: string | null
      }
      account: {
        chainId: string
        evmAddress?: string
      }
      amount: string
    }[]
  }
}

export const trancheCurrencyBalanceQuery = `
query($filterTranches: TrancheBalanceFilter, $filterCurrencies: CurrencyBalanceFilter) {
  trancheBalances(filter: $filterTranches) {
    nodes {
      accountId
      trancheId
      account {
        chainId
        evmAddress
      }
      pool {
        currency {
          decimals
        }
      }
      pendingInvestCurrency
      claimableTrancheTokens
      sumClaimedTrancheTokens
      pendingRedeemTrancheTokens
      claimableCurrency
      sumClaimedCurrency
    }
  }
  currencyBalances(filter: $filterCurrencies) {
    nodes {
      accountId
      account {
        chainId
        evmAddress
      }
      currency {
        trancheId
      }
      amount
    }
  }
}
`
