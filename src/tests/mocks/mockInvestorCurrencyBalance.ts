import { Currency } from '../../utils/BigInt.js'
import { TrancheCurrencyBalance } from '../../IndexerQueries/trancheCurrencyBalance.js'

export const mockInvestorCurrencyBalances: TrancheCurrencyBalance[] = [
  {
    accountId: 'account-1',
    chainId: 1,
    trancheId: 'tranche-1',
    evmAddress: '0x123',
    balance: Currency.fromFloat(1000, 6),
    pendingInvestCurrency: Currency.fromFloat(100, 6),
    claimableTrancheTokens: Currency.fromFloat(50, 6),
    sumClaimedTrancheTokens: Currency.fromFloat(200, 6),
    pendingRedeemTrancheTokens: Currency.fromFloat(75, 6),
    claimableCurrency: Currency.fromFloat(25, 6),
    sumClaimedCurrency: Currency.fromFloat(300, 6),
  },
  {
    accountId: 'account-2',
    chainId: 'centrifuge',
    trancheId: 'tranche-1',
    balance: Currency.fromFloat(2000, 6),
    pendingInvestCurrency: Currency.fromFloat(200, 6),
    claimableTrancheTokens: Currency.fromFloat(100, 6),
    sumClaimedTrancheTokens: Currency.fromFloat(400, 6),
    pendingRedeemTrancheTokens: Currency.fromFloat(150, 6),
    claimableCurrency: Currency.fromFloat(50, 6),
    sumClaimedCurrency: Currency.fromFloat(600, 6),
  },
]
