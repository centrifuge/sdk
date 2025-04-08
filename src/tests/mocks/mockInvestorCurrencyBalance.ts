import { TrancheCurrencyBalance } from '../../entities/IndexerQueries/trancheCurrencyBalance.js'
import { Balance } from '../../utils/BigInt.js'

export const mockInvestorCurrencyBalances: TrancheCurrencyBalance[] = [
  {
    accountId: 'account-1',
    chainId: 1,
    trancheId: 'tranche-1',
    evmAddress: '0x123',
    balance: Balance.fromFloat(1000, 6),
    pendingInvestCurrency: Balance.fromFloat(100, 6),
    claimableTrancheTokens: Balance.fromFloat(50, 6),
    sumClaimedTrancheTokens: Balance.fromFloat(200, 6),
    pendingRedeemTrancheTokens: Balance.fromFloat(75, 6),
    claimableCurrency: Balance.fromFloat(25, 6),
    sumClaimedCurrency: Balance.fromFloat(300, 6),
  },
  {
    accountId: 'account-2',
    chainId: 'centrifuge',
    trancheId: 'tranche-1',
    balance: Balance.fromFloat(2000, 6),
    pendingInvestCurrency: Balance.fromFloat(200, 6),
    claimableTrancheTokens: Balance.fromFloat(100, 6),
    sumClaimedTrancheTokens: Balance.fromFloat(400, 6),
    pendingRedeemTrancheTokens: Balance.fromFloat(150, 6),
    claimableCurrency: Balance.fromFloat(50, 6),
    sumClaimedCurrency: Balance.fromFloat(600, 6),
  },
]
