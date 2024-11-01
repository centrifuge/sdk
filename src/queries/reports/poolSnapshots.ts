import { Currency } from '../../utils/BigInt.js'

export const poolSnapshotsQuery = `
query($poolId: String!, $from: Datetime!, $to: Datetime!) {
  poolSnapshots(
    orderBy: BLOCK_NUMBER_ASC
    filter: {
      poolId: { equalTo: $poolId }
      timestamp: { greaterThan: $from, lessThan: $to }
    }
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

export type SubqueryPoolSnapshot = {
  poolSnapshots: {
    nodes: {
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

export type PoolSnapshot = {
  id: string
  poolId: string
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

export function poolSnapshotsPostProcess(data: SubqueryPoolSnapshot): PoolSnapshot[] {
  const snapshotByDay = new Map<string, any>()
  return (
    data?.poolSnapshots.nodes.flatMap((state) => {
      const timestamp = state.timestamp.slice(0, 10)
      const poolCurrency = state.pool.currency
      const snapshotToday = snapshotByDay.get(timestamp)
      const poolState = {
        id: state.id,
        poolId: state.pool.id,
        poolCurrency,
        netAssetValue: new Currency(state.netAssetValue, poolCurrency.decimals),
        totalReserve: new Currency(state.totalReserve, poolCurrency.decimals),
        offchainCashValue: new Currency(state.offchainCashValue, poolCurrency.decimals),
        portfolioValuation: new Currency(state.portfolioValuation, poolCurrency.decimals),
        sumPoolFeesChargedAmountByPeriod: new Currency(
          BigInt(state.sumPoolFeesChargedAmountByPeriod) + BigInt(snapshotToday?.sumPoolFeesChargedAmountByPeriod ?? 0),
          poolCurrency.decimals
        ),
        sumPoolFeesAccruedAmountByPeriod: new Currency(
          BigInt(state.sumPoolFeesAccruedAmountByPeriod) + BigInt(snapshotToday?.sumPoolFeesAccruedAmountByPeriod ?? 0),
          poolCurrency.decimals
        ),
        sumPoolFeesPaidAmountByPeriod: new Currency(
          BigInt(state.sumPoolFeesPaidAmountByPeriod) + BigInt(snapshotToday?.sumPoolFeesPaidAmountByPeriod ?? 0),
          poolCurrency.decimals
        ),
        sumBorrowedAmountByPeriod: new Currency(state.sumBorrowedAmountByPeriod, poolCurrency.decimals),
        sumPrincipalRepaidAmountByPeriod: new Currency(
          BigInt(state.sumPrincipalRepaidAmountByPeriod) + BigInt(snapshotToday?.sumPrincipalRepaidAmountByPeriod ?? 0),
          poolCurrency.decimals
        ),
        sumInterestRepaidAmountByPeriod: new Currency(
          BigInt(state.sumInterestRepaidAmountByPeriod) + BigInt(snapshotToday?.sumInterestRepaidAmountByPeriod ?? 0),
          poolCurrency.decimals
        ),
        sumUnscheduledRepaidAmountByPeriod: new Currency(
          BigInt(state.sumUnscheduledRepaidAmountByPeriod) +
            BigInt(snapshotToday?.sumUnscheduledRepaidAmountByPeriod ?? 0),
          poolCurrency.decimals
        ),
        sumRepaidAmountByPeriod: new Currency(
          BigInt(state.sumRepaidAmountByPeriod) + BigInt(snapshotToday?.sumRepaidAmountByPeriod ?? 0),
          poolCurrency.decimals
        ),
        sumInvestedAmountByPeriod: new Currency(
          BigInt(state.sumInvestedAmountByPeriod) + BigInt(snapshotToday?.sumInvestedAmountByPeriod ?? 0),
          poolCurrency.decimals
        ),
        sumRedeemedAmountByPeriod: new Currency(
          BigInt(state.sumRedeemedAmountByPeriod) + BigInt(snapshotToday?.sumRedeemedAmountByPeriod ?? 0),
          poolCurrency.decimals
        ),
        sumPoolFeesPendingAmount: new Currency(state.sumPoolFeesPendingAmount, poolCurrency.decimals),
        sumDebtWrittenOffByPeriod: new Currency(
          BigInt(state.sumDebtWrittenOffByPeriod) + BigInt(snapshotToday?.sumDebtWrittenOffByPeriod ?? 0),
          poolCurrency.decimals
        ),
        sumInterestAccruedByPeriod: new Currency(
          BigInt(state.sumInterestAccruedByPeriod) + BigInt(snapshotToday?.sumInterestAccruedByPeriod ?? 0),
          poolCurrency.decimals
        ),
        sumRealizedProfitFifoByPeriod: new Currency(
          BigInt(state.sumRealizedProfitFifoByPeriod) + BigInt(snapshotToday?.sumRealizedProfitFifoByPeriod ?? 0),
          poolCurrency.decimals
        ),
        sumUnrealizedProfitAtMarketPrice: new Currency(state.sumUnrealizedProfitAtMarketPrice, poolCurrency.decimals),
        sumUnrealizedProfitAtNotional: new Currency(state.sumUnrealizedProfitAtNotional, poolCurrency.decimals),
        sumUnrealizedProfitByPeriod: new Currency(
          BigInt(state.sumUnrealizedProfitByPeriod) + BigInt(snapshotToday?.sumUnrealizedProfitByPeriod ?? 0),
          poolCurrency.decimals
        ),
      }

      snapshotByDay.set(timestamp, poolState)
      if (snapshotToday) {
        Object.assign(snapshotToday, poolState)
        return []
      }

      const poolValue = new Currency(state?.netAssetValue || '0', poolCurrency.decimals)

      return { ...poolState, poolValue }
    }) || []
  )
}
