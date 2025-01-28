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
  tranches: string[]
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
        tranches: {
          nodes: {
            id: string
          }[]
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
        tranches {
          nodes {
            id
          }
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
      const currentSnapshot = snapshotByDay.get(timestamp)

      const poolState = {
        id: state.id,
        timestamp: state.timestamp,
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
        tranches: state.pool.tranches.nodes.map((tranche) => tranche.id),
      }

      if (currentSnapshot) {
        currentSnapshot.sumPoolFeesChargedAmountByPeriod = currentSnapshot.sumPoolFeesChargedAmountByPeriod.add(
          poolState.sumPoolFeesChargedAmountByPeriod
        )
        currentSnapshot.sumPoolFeesAccruedAmountByPeriod = currentSnapshot.sumPoolFeesAccruedAmountByPeriod.add(
          poolState.sumPoolFeesAccruedAmountByPeriod
        )
        currentSnapshot.sumPoolFeesPaidAmountByPeriod = currentSnapshot.sumPoolFeesPaidAmountByPeriod.add(
          poolState.sumPoolFeesPaidAmountByPeriod
        )
        currentSnapshot.sumBorrowedAmountByPeriod = currentSnapshot.sumBorrowedAmountByPeriod.add(
          poolState.sumBorrowedAmountByPeriod
        )
        currentSnapshot.sumPrincipalRepaidAmountByPeriod = currentSnapshot.sumPrincipalRepaidAmountByPeriod.add(
          poolState.sumPrincipalRepaidAmountByPeriod
        )
        currentSnapshot.sumInterestRepaidAmountByPeriod = currentSnapshot.sumInterestRepaidAmountByPeriod.add(
          poolState.sumInterestRepaidAmountByPeriod
        )
        currentSnapshot.sumUnscheduledRepaidAmountByPeriod = currentSnapshot.sumUnscheduledRepaidAmountByPeriod.add(
          poolState.sumUnscheduledRepaidAmountByPeriod
        )
        currentSnapshot.sumRepaidAmountByPeriod = currentSnapshot.sumRepaidAmountByPeriod.add(
          poolState.sumRepaidAmountByPeriod
        )
        currentSnapshot.sumInvestedAmountByPeriod = currentSnapshot.sumInvestedAmountByPeriod.add(
          poolState.sumInvestedAmountByPeriod
        )
        currentSnapshot.sumRedeemedAmountByPeriod = currentSnapshot.sumRedeemedAmountByPeriod.add(
          poolState.sumRedeemedAmountByPeriod
        )
        currentSnapshot.sumDebtWrittenOffByPeriod = currentSnapshot.sumDebtWrittenOffByPeriod.add(
          poolState.sumDebtWrittenOffByPeriod
        )
        currentSnapshot.sumInterestAccruedByPeriod = currentSnapshot.sumInterestAccruedByPeriod.add(
          poolState.sumInterestAccruedByPeriod
        )

        currentSnapshot.sumRealizedProfitFifoByPeriod = currentSnapshot.sumRealizedProfitFifoByPeriod.add(
          poolState.sumRealizedProfitFifoByPeriod
        )
        currentSnapshot.sumUnrealizedProfitByPeriod = currentSnapshot.sumUnrealizedProfitByPeriod.add(
          poolState.sumUnrealizedProfitByPeriod
        )

        // Update point-in-time values with latest
        currentSnapshot.netAssetValue = poolState.netAssetValue
        currentSnapshot.totalReserve = poolState.totalReserve
        currentSnapshot.offchainCashValue = poolState.offchainCashValue
        currentSnapshot.portfolioValuation = poolState.portfolioValuation
        currentSnapshot.sumPoolFeesPendingAmount = poolState.sumPoolFeesPendingAmount
        currentSnapshot.sumUnrealizedProfitAtMarketPrice = poolState.sumUnrealizedProfitAtMarketPrice
        currentSnapshot.sumUnrealizedProfitAtNotional = poolState.sumUnrealizedProfitAtNotional

        return []
      }

      snapshotByDay.set(timestamp, poolState)
      const poolValue = new Currency(state?.netAssetValue || '0', poolCurrencyDecimals)
      return { ...poolState, poolValue }
    }) || []
  )
}
