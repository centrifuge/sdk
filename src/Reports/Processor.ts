import { TrancheSnapshot } from '../queries/trancheSnapshots.js'
import { Currency } from '../utils/BigInt.js'
import { groupByPeriod } from '../utils/date.js'
import { BalanceSheetData, BalanceSheetReport, ReportFilter } from './types.js'

export class Processor {
  /**
   * Process raw data into a balance sheet report
   * @param data Pool and tranche snapshot data
   * @param filter Optional filtering and grouping options
   * @returns Processed balance sheet report
   */
  balanceSheet(data: BalanceSheetData, filter?: ReportFilter): BalanceSheetReport[] {
    const trancheSnapshotsByDate = this.groupTranchesByDate(data.trancheSnapshots)
    const items = data?.poolSnapshots?.map((snapshot) => {
      const tranches = trancheSnapshotsByDate.get(this.getDateKey(snapshot.timestamp)) ?? []
      if (tranches.length === 0) throw new Error('No tranches found for snapshot')
      return {
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
    return this.applyGrouping<BalanceSheetReport>(items, filter)
  }

  // TODO: Add other processors

  private getDateKey(timestamp: string): string {
    return timestamp.slice(0, 10)
  }

  private applyGrouping<T extends { timestamp: string }>(items: T[], filter?: ReportFilter): T[] {
    return filter?.groupBy ? groupByPeriod(items, filter.groupBy) : items
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
