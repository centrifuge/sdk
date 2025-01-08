import { Currency } from '../../utils/BigInt.js'
import { PoolSnapshot } from '../../IndexerQueries/poolSnapshots.js'

export const mockPoolSnapshots: PoolSnapshot[] = [
  {
    id: 'pool-10',
    poolId: 'pool-1',
    timestamp: '2024-01-01T12:00:00Z',
    netAssetValue: new Currency(0n, 6),
    totalReserve: new Currency(0n, 6),
    offchainCashValue: new Currency(0n, 6),
    portfolioValuation: new Currency(0n, 6),
    sumPoolFeesChargedAmountByPeriod: new Currency(0n, 6),
    sumPoolFeesAccruedAmountByPeriod: new Currency(0n, 6),
    sumPoolFeesPaidAmountByPeriod: new Currency(0n, 6),
    sumBorrowedAmountByPeriod: new Currency(0n, 6),
    sumPrincipalRepaidAmountByPeriod: new Currency(0n, 6),
    sumInterestRepaidAmountByPeriod: new Currency(0n, 6),
    sumUnscheduledRepaidAmountByPeriod: new Currency(0n, 6),
    sumRepaidAmountByPeriod: new Currency(0n, 6),
    sumInvestedAmountByPeriod: new Currency(0n, 6),
    sumRedeemedAmountByPeriod: new Currency(0n, 6),
    sumPoolFeesPendingAmount: new Currency(0n, 6),
    sumDebtWrittenOffByPeriod: new Currency(0n, 6),
    sumInterestAccruedByPeriod: new Currency(0n, 6),
    sumRealizedProfitFifoByPeriod: new Currency(0n, 6),
    sumUnrealizedProfitAtMarketPrice: new Currency(0n, 6),
    sumUnrealizedProfitAtNotional: new Currency(0n, 6),
    sumUnrealizedProfitByPeriod: new Currency(0n, 6),
    poolValue: new Currency(0n, 6),
    poolCurrency: {
      decimals: 6,
    },
  },
  {
    id: 'pool-11',
    poolId: 'pool-1',
    timestamp: '2024-01-02T12:00:00Z',
    netAssetValue: new Currency(0n, 6),
    totalReserve: new Currency(0n, 6),
    offchainCashValue: new Currency(0n, 6),
    portfolioValuation: new Currency(0n, 6),
    sumPoolFeesChargedAmountByPeriod: new Currency(0n, 6),
    sumPoolFeesAccruedAmountByPeriod: new Currency(0n, 6),
    sumPoolFeesPaidAmountByPeriod: new Currency(0n, 6),
    sumBorrowedAmountByPeriod: new Currency(0n, 6),
    sumPrincipalRepaidAmountByPeriod: new Currency(0n, 6),
    sumInterestRepaidAmountByPeriod: new Currency(0n, 6),
    sumUnscheduledRepaidAmountByPeriod: new Currency(0n, 6),
    sumRepaidAmountByPeriod: new Currency(0n, 6),
    sumInvestedAmountByPeriod: new Currency(0n, 6),
    sumRedeemedAmountByPeriod: new Currency(0n, 6),
    sumPoolFeesPendingAmount: new Currency(0n, 6),
    sumDebtWrittenOffByPeriod: new Currency(0n, 6),
    sumInterestAccruedByPeriod: new Currency(0n, 6),
    sumRealizedProfitFifoByPeriod: new Currency(0n, 6),
    sumUnrealizedProfitAtMarketPrice: new Currency(0n, 6),
    sumUnrealizedProfitAtNotional: new Currency(0n, 6),
    sumUnrealizedProfitByPeriod: new Currency(0n, 6),
    poolValue: new Currency(0n, 6),
    poolCurrency: {
      decimals: 6,
    },
  },
]
