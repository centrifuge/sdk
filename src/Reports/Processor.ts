import { TrancheSnapshot } from '../queries/trancheSnapshots.js'
import { Currency } from '../utils/BigInt.js'
import { groupByPeriod } from '../utils/date.js'
import { BalanceSheetData, BalanceSheetReport, CashflowData, CashflowReport, ReportFilter } from './types.js'

export class Processor {
  /**
   * Process raw data into a balance sheet report
   * @param data Pool and tranche snapshot data
   * @param filter Optional filtering and grouping options
   * @returns Processed balance sheet report
   */
  balanceSheet(data: BalanceSheetData, filter?: ReportFilter): BalanceSheetReport[] {
    const trancheSnapshotsByDate = this.groupTranchesByDate(data.trancheSnapshots)
    const items: BalanceSheetReport[] = data?.poolSnapshots?.map((snapshot) => {
      const tranches = trancheSnapshotsByDate.get(this.getDateKey(snapshot.timestamp)) ?? []
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
    return this.applyGrouping<BalanceSheetReport>(items, filter, 'latest')
  }

  cashflow(data: CashflowData, filter?: ReportFilter): CashflowReport[] {
    // TODO: requires pool metadata which requires querying the pool on chain?
    // check if metadata is available in the snapshot
    const items: CashflowReport[] = data.poolSnapshots.map((day) => {
      const principalRepayments = day.sumPrincipalRepaidAmountByPeriod
      const interest = day.sumInterestRepaidAmountByPeriod.add(day.sumUnscheduledRepaidAmountByPeriod)
      const purchases = day.sumBorrowedAmountByPeriod
      const fees = day.sumPoolFeesPaidAmountByPeriod
      const netCashflowAsset = principalRepayments.sub(purchases).add(interest)
      const investments = day.sumInvestedAmountByPeriod
      const redemptions = day.sumRedeemedAmountByPeriod
      const activitiesCashflow = investments.sub(redemptions)
      const netCashflowAfterFees = netCashflowAsset.sub(fees)
      const totalCashflow = netCashflowAfterFees.add(activitiesCashflow)
      return {
        type: 'cashflow',
        timestamp: day.timestamp,
        principalPayments: principalRepayments,
        realizedPL: day.sumRealizedProfitFifoByPeriod, // show only for pools that are public credit pools
        interestPayments: interest,
        assetPurchases: purchases,
        netCashflowAsset,
        fees: [{ name: 'Management Fee', amount: fees }],
        netCashflowAfterFees,
        investments,
        redemptions,
        activitiesCashflow,
        totalCashflow,
        endCashBalance: day.totalReserve.add(day.offchainCashValue),
      }
    })
    return this.applyGrouping<CashflowReport>(items, filter, 'sum')
  }

  private applyGrouping<T extends CashflowReport | BalanceSheetReport>(
    items: T[],
    filter?: ReportFilter,
    strategy: 'latest' | 'sum' = 'latest'
  ): T[] {
    if (!filter?.groupBy) return items

    const grouped = groupByPeriod<T>(items, filter.groupBy)

    if (strategy === 'latest') {
      return grouped
    }

    return grouped.map((latest) => {
      const result = { ...latest } as T
      const itemsInGroup = items.filter(
        (item) =>
          this.getDateKey(item.timestamp, filter?.groupBy) === this.getDateKey(latest.timestamp, filter?.groupBy)
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
        return timestamp.slice(0, 10) // YYYY-MM-DD (daily is default)
    }
  }

  private groupTranchesByDate(trancheSnapshots: TrancheSnapshot[]): Map<string, TrancheSnapshot[]> {
    const grouped = new Map<string, TrancheSnapshot[]>()
    if (!trancheSnapshots) return grouped
    trancheSnapshots?.forEach((snapshot) => {
      const date = this.getDateKey(snapshot.timestamp)
      if (!grouped.has(date)) {
        grouped.set(date, [])
      }
      grouped.get(date)!.push(snapshot)
    })
    return grouped
  }
}

export const processor = new Processor()