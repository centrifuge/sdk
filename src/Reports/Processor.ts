import { Currency } from '../utils/BigInt.js'
import { getPeriod, groupByPeriod } from '../utils/date.js'
import { BalanceSheetData, BalanceSheetReport, CashflowData, CashflowReport, ReportFilter } from './types.js'

export class Processor {
  /**
   * Process raw data into a balance sheet report
   * @param data Pool and tranche snapshot data
   * @param filter Optional filtering and grouping options
   * @returns Processed balance sheet report
   */
  balanceSheet(data: BalanceSheetData, filter?: ReportFilter): BalanceSheetReport[] {
    const items: BalanceSheetReport[] = data?.poolSnapshots?.map((snapshot) => {
      const tranches = data.trancheSnapshots[this.getDateKey(snapshot.timestamp)] ?? []
      if (tranches.length === 0) throw new Error('No tranches found for snapshot')
      return {
        type: 'balanceSheet',
        timestamp: snapshot.timestamp,
        assetValuation: snapshot.portfolioValuation,
        onchainReserve: snapshot.totalReserve,
        offchainCash: snapshot.offchainCashValue,
        accruedFees: snapshot.sumPoolFeesPendingAmount,
        netAssetValue: snapshot.netAssetValue,
        tranches: tranches?.map((tranche) => ({
          name: tranche.pool.currency.symbol,
          timestamp: tranche.timestamp,
          tokenId: tranche.trancheId,
          tokenSupply: tranche.tokenSupply,
          tokenPrice: tranche.price,
          trancheValue: tranche.tokenSupply.mul(tranche?.price?.toBigInt() ?? 0n),
        })),
        totalCapital: tranches.reduce(
          (acc, curr) => acc.add(curr.tokenSupply.mul(curr?.price?.toBigInt() ?? 0n).toBigInt()),
          new Currency(0, snapshot.poolCurrency.decimals)
        ),
      }
    })
    return this.applyGrouping<BalanceSheetReport>(items, filter?.groupBy, 'latest')
  }

  /**
   * Process raw data into an aggregated cashflow report, fees and endCashBalance are NOT aggregated by period
   * @param data Pool snapshot data
   * @param filter Optional filtering and grouping options
   * @returns Processed cashflow report
   */
  cashflow(data: CashflowData, filter?: ReportFilter): CashflowReport[] {
    const subtype = data.metadata?.pool.asset.class === 'Public credit' ? 'publicCredit' : 'privateCredit'
    const items: CashflowReport[] = data.poolSnapshots.map((day) => {
      const poolFees =
        data.poolFeeSnapshots[day.timestamp.slice(0, 10)]?.map((fee) => ({
          name: fee.poolFee.name,
          amount: fee.sumPaidAmountByPeriod,
          timestamp: fee.timestamp,
          feeId: fee.poolFeeId.split('-')[1] ?? '',
        })) ?? []
      const principalRepayments = day.sumPrincipalRepaidAmountByPeriod
      const interest = day.sumInterestRepaidAmountByPeriod.add(day.sumUnscheduledRepaidAmountByPeriod)
      const aquisistions = day.sumBorrowedAmountByPeriod
      const fees = day.sumPoolFeesPaidAmountByPeriod
      const netCashflowAsset = principalRepayments.sub(aquisistions).add(interest)
      const investments = day.sumInvestedAmountByPeriod
      const redemptions = day.sumRedeemedAmountByPeriod
      const activitiesCashflow = investments.sub(redemptions)
      const netCashflowAfterFees = netCashflowAsset.sub(fees)
      const totalCashflow = netCashflowAfterFees.add(activitiesCashflow)
      return {
        type: 'cashflow',
        subtype,
        timestamp: day.timestamp,
        principalPayments: principalRepayments,
        ...(subtype === 'publicCredit' && { realizedPL: day.sumRealizedProfitFifoByPeriod }),
        interestPayments: interest,
        assetAcquisitions: aquisistions,
        netCashflowAsset,
        fees: poolFees,
        netCashflowAfterFees,
        investments,
        redemptions,
        activitiesCashflow,
        totalCashflow,
        endCashBalance: { balance: day.totalReserve.add(day.offchainCashValue) },
      }
    })
    return this.applyGrouping<CashflowReport>(items, filter?.groupBy, 'sum')
  }

  /**
   * Apply grouping to a report
   * @param items Report items
   * @param filter Optional filtering and grouping options
   * @param strategy Grouping strategy, sum aggregates data by period, latest returns the latest item in the period
   * @returns Grouped report
   */
  private applyGrouping<T extends CashflowReport | BalanceSheetReport>(
    items: T[],
    groupBy: ReportFilter['groupBy'] = 'day',
    strategy: 'latest' | 'sum' = 'latest'
  ): T[] {
    const grouped = groupByPeriod<T>(items, groupBy ?? 'day')

    if (strategy === 'latest') {
      return grouped
    }

    // First aggregate by day
    const dailyAggregated = grouped.map((latest) => {
      const result = { ...latest } as T
      const itemsInGroup = items.filter(
        (item) => this.getDateKey(item.timestamp, groupBy) === this.getDateKey(latest.timestamp, groupBy)
      )

      for (const key in latest) {
        const value = latest[key as keyof T]
        if (value instanceof Currency) {
          result[key as keyof T] = itemsInGroup.reduce(
            (sum, item) => sum.add(item[key as keyof T] as Currency),
            new Currency(0n, value.decimals)
          ) as T[keyof T]
        }
      }

      return result
    })

    return dailyAggregated
  }

  private getDateKey(timestamp: string, groupBy?: ReportFilter['groupBy']): string {
    switch (groupBy) {
      case 'month':
        return timestamp.slice(0, 7) // YYYY-MM
      case 'quarter':
        const date = new Date(timestamp)
        const quarter = Math.floor(date.getMonth() / 3) + 1
        return `${date.getFullYear()}-Q${quarter}` // YYYY-Q#
      case 'year':
        return timestamp.slice(0, 4) // YYYY
      default:
        return timestamp.slice(0, 10) // YYYY-MM-DD
    }
  }
}

export const processor = new Processor()
