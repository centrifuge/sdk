import { Currency } from '../utils/BigInt.js'

export type PoolSnapshotFilter = Partial<Record<keyof SubqueryPoolSnapshot['poolSnapshots']['nodes'][0], any>>

export type PoolSnapshot = {
  id: string
  poolId: string
  timestamp: string
  netAssetValue: Currency
  totalReserve: Currency
  offchainCashValue: Currency
  portfolioValuation: Currency
  sumPoolFeesChargedAmountByPeriod: Currency
  sumPoolFeesAccruedAmountByPeriod: Currency
  sumPoolFeesPaidAmountByPeriod: Currency
  sumBorrowedAmountByPeriod: Currency
  sumPrincipalRepaidAmountByPeriod: Currency
  sumInterestRepaidAmountByPeriod: Currency
  sumUnscheduledRepaidAmountByPeriod: Currency
  sumRepaidAmountByPeriod: Currency
  sumInvestedAmountByPeriod: Currency
  sumRedeemedAmountByPeriod: Currency
  sumPoolFeesPendingAmount: Currency
  sumDebtWrittenOffByPeriod: Currency
  sumInterestAccruedByPeriod: Currency
  sumRealizedProfitFifoByPeriod: Currency
  sumUnrealizedProfitAtMarketPrice: Currency
  sumUnrealizedProfitAtNotional: Currency
  sumUnrealizedProfitByPeriod: Currency
  poolValue: Currency
  poolCurrency: {
    decimals: number
  }
}

export type SubqueryPoolSnapshot = {
  poolSnapshots: {
    nodes: {
      poolId: string
      id: string
      timestamp: string
      value: string
      netAssetValue: number
      totalReserve: number
      offchainCashValue: number
      portfolioValuation: number
      sumPoolFeesChargedAmountByPeriod: string
      sumPoolFeesAccruedAmountByPeriod: string
      sumPoolFeesPaidAmountByPeriod: string
      sumBorrowedAmountByPeriod: string
      sumPrincipalRepaidAmountByPeriod: string
      sumInterestRepaidAmountByPeriod: string
      sumUnscheduledRepaidAmountByPeriod: string
      sumRepaidAmountByPeriod: string
      sumInvestedAmountByPeriod: string
      sumRedeemedAmountByPeriod: string
      blockNumber: number
      sumPoolFeesPendingAmount: string
      sumDebtWrittenOffByPeriod: string
      sumInterestAccruedByPeriod: string
      sumRealizedProfitFifoByPeriod: string
      sumUnrealizedProfitAtMarketPrice: string
      sumUnrealizedProfitAtNotional: string
      sumUnrealizedProfitByPeriod: string
      pool: {
        id: string
        currency: {
          decimals: number
        }
      }
    }[]
  }
}

export const poolSnapshotsQuery = `
query($filter: PoolSnapshotFilter) {
  poolSnapshots(
    orderBy: BLOCK_NUMBER_ASC
    filter: $filter 
  ) {
    nodes {
      id
      timestamp
      netAssetValue
      totalReserve
      offchainCashValue
      portfolioValuation
      blockNumber
      sumPoolFeesChargedAmountByPeriod
      sumPoolFeesAccruedAmountByPeriod
      sumPoolFeesPaidAmountByPeriod
      sumPoolFeesPendingAmount
      sumBorrowedAmountByPeriod
      sumRepaidAmountByPeriod
      sumInvestedAmountByPeriod
      sumRedeemedAmountByPeriod
      sumPrincipalRepaidAmountByPeriod
      sumInterestRepaidAmountByPeriod
      sumUnscheduledRepaidAmountByPeriod
      sumInterestAccruedByPeriod
      sumDebtWrittenOffByPeriod
      sumRealizedProfitFifoByPeriod
      sumUnrealizedProfitAtMarketPrice
      sumUnrealizedProfitAtNotional
      sumUnrealizedProfitByPeriod
      pool {
        id
        currency {
          decimals
        }
      }
    }
  }
}`

export function poolSnapshotsPostProcess(data: SubqueryPoolSnapshot): PoolSnapshot[] {
  const snapshotByDay = new Map<string, Omit<PoolSnapshot, 'poolValue'>>()
  return (
    data?.poolSnapshots?.nodes.flatMap((state) => {
      const timestamp = state.timestamp.slice(0, 10)
      const poolCurrencyDecimals = state.pool.currency.decimals
      // point in time snapshot used to aggregate snapshots by day (there can be multiple snapshots per day)
      const snapshotToday = snapshotByDay.get(timestamp)

      const poolState = {
        id: state.id,
        timestamp,
        poolId: state.pool.id,
        poolCurrency: state.pool.currency,
        netAssetValue: new Currency(state.netAssetValue, poolCurrencyDecimals),
        totalReserve: new Currency(state.totalReserve, poolCurrencyDecimals),
        offchainCashValue: new Currency(state.offchainCashValue, poolCurrencyDecimals),
        portfolioValuation: new Currency(state.portfolioValuation, poolCurrencyDecimals),
        sumPoolFeesPendingAmount: new Currency(state.sumPoolFeesPendingAmount, poolCurrencyDecimals),
        sumUnrealizedProfitAtMarketPrice: new Currency(state.sumUnrealizedProfitAtMarketPrice, poolCurrencyDecimals),
        sumUnrealizedProfitAtNotional: new Currency(state.sumUnrealizedProfitAtNotional, poolCurrencyDecimals),

        sumPoolFeesChargedAmountByPeriod: new Currency(state.sumPoolFeesChargedAmountByPeriod, poolCurrencyDecimals),
        sumPoolFeesAccruedAmountByPeriod: new Currency(state.sumPoolFeesAccruedAmountByPeriod, poolCurrencyDecimals),
        sumPoolFeesPaidAmountByPeriod: new Currency(state.sumPoolFeesPaidAmountByPeriod, poolCurrencyDecimals),
        sumBorrowedAmountByPeriod: new Currency(state.sumBorrowedAmountByPeriod, poolCurrencyDecimals),
        sumPrincipalRepaidAmountByPeriod: new Currency(state.sumPrincipalRepaidAmountByPeriod, poolCurrencyDecimals),
        sumInterestRepaidAmountByPeriod: new Currency(state.sumInterestRepaidAmountByPeriod, poolCurrencyDecimals),
        sumUnscheduledRepaidAmountByPeriod: new Currency(
          state.sumUnscheduledRepaidAmountByPeriod,
          poolCurrencyDecimals
        ),
        sumRepaidAmountByPeriod: new Currency(state.sumRepaidAmountByPeriod, poolCurrencyDecimals),
        sumInvestedAmountByPeriod: new Currency(state.sumInvestedAmountByPeriod, poolCurrencyDecimals),
        sumRedeemedAmountByPeriod: new Currency(state.sumRedeemedAmountByPeriod, poolCurrencyDecimals),
        sumDebtWrittenOffByPeriod: new Currency(state.sumDebtWrittenOffByPeriod, poolCurrencyDecimals),
        sumInterestAccruedByPeriod: new Currency(state.sumInterestAccruedByPeriod, poolCurrencyDecimals),
        sumRealizedProfitFifoByPeriod: new Currency(state.sumRealizedProfitFifoByPeriod, poolCurrencyDecimals),
        sumUnrealizedProfitByPeriod: new Currency(state.sumUnrealizedProfitByPeriod, poolCurrencyDecimals),
      }

      if (snapshotToday) {
        snapshotToday.sumPoolFeesChargedAmountByPeriod = snapshotToday.sumPoolFeesChargedAmountByPeriod.add(
          poolState.sumPoolFeesChargedAmountByPeriod
        )
        snapshotToday.sumPoolFeesAccruedAmountByPeriod = snapshotToday.sumPoolFeesAccruedAmountByPeriod.add(
          poolState.sumPoolFeesAccruedAmountByPeriod
        )
        snapshotToday.sumPoolFeesPaidAmountByPeriod = snapshotToday.sumPoolFeesPaidAmountByPeriod.add(
          poolState.sumPoolFeesPaidAmountByPeriod
        )
        snapshotToday.sumBorrowedAmountByPeriod = snapshotToday.sumBorrowedAmountByPeriod.add(
          poolState.sumBorrowedAmountByPeriod
        )
        snapshotToday.sumPrincipalRepaidAmountByPeriod = snapshotToday.sumPrincipalRepaidAmountByPeriod.add(
          poolState.sumPrincipalRepaidAmountByPeriod
        )
        snapshotToday.sumInterestRepaidAmountByPeriod = snapshotToday.sumInterestRepaidAmountByPeriod.add(
          poolState.sumInterestRepaidAmountByPeriod
        )
        snapshotToday.sumUnscheduledRepaidAmountByPeriod = snapshotToday.sumUnscheduledRepaidAmountByPeriod.add(
          poolState.sumUnscheduledRepaidAmountByPeriod
        )
        snapshotToday.sumRepaidAmountByPeriod = snapshotToday.sumRepaidAmountByPeriod.add(
          poolState.sumRepaidAmountByPeriod
        )
        snapshotToday.sumInvestedAmountByPeriod = snapshotToday.sumInvestedAmountByPeriod.add(
          poolState.sumInvestedAmountByPeriod
        )
        snapshotToday.sumRedeemedAmountByPeriod = snapshotToday.sumRedeemedAmountByPeriod.add(
          poolState.sumRedeemedAmountByPeriod
        )
        snapshotToday.sumDebtWrittenOffByPeriod = snapshotToday.sumDebtWrittenOffByPeriod.add(
          poolState.sumDebtWrittenOffByPeriod
        )
        snapshotToday.sumInterestAccruedByPeriod = snapshotToday.sumInterestAccruedByPeriod.add(
          poolState.sumInterestAccruedByPeriod
        )

        snapshotToday.sumRealizedProfitFifoByPeriod = snapshotToday.sumRealizedProfitFifoByPeriod.add(
          poolState.sumRealizedProfitFifoByPeriod
        )
        snapshotToday.sumUnrealizedProfitByPeriod = snapshotToday.sumUnrealizedProfitByPeriod.add(
          poolState.sumUnrealizedProfitByPeriod
        )

        // Update point-in-time values with latest
        snapshotToday.netAssetValue = poolState.netAssetValue
        snapshotToday.totalReserve = poolState.totalReserve
        snapshotToday.offchainCashValue = poolState.offchainCashValue
        snapshotToday.portfolioValuation = poolState.portfolioValuation
        snapshotToday.sumPoolFeesPendingAmount = poolState.sumPoolFeesPendingAmount
        snapshotToday.sumUnrealizedProfitAtMarketPrice = poolState.sumUnrealizedProfitAtMarketPrice
        snapshotToday.sumUnrealizedProfitAtNotional = poolState.sumUnrealizedProfitAtNotional

        return []
      }

      snapshotByDay.set(timestamp, poolState)
      const poolValue = new Currency(state?.netAssetValue || '0', poolCurrencyDecimals)
      return { ...poolState, poolValue }
    }) || []
  )
}
