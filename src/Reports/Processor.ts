import { TrancheSnapshot } from '../queries/trancheSnapshots.js'
import { Currency } from '../utils/BigInt.js'
import { groupByPeriod } from '../utils/date.js'
import { BalanceSheetData, BalanceSheetReport, ReportFilter } from './types.js'

export class Processor {
  balanceSheet(data: BalanceSheetData, filter?: ReportFilter): BalanceSheetReport[] {
    const trancheSnapshotsByDate = this.groupTranchesByDate(data.trancheSnapshots)
    const items = data?.poolSnapshots?.map((snapshot) => {
      const tranches = trancheSnapshotsByDate.get(snapshot.timestamp.slice(0, 10)) ?? []
      return {
        timestamp: snapshot.timestamp,
        date: snapshot.timestamp,
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
    return filter?.groupBy ? groupByPeriod(items, filter.groupBy) : items
  }

  // TODO: Add other processors

  private groupTranchesByDate(trancheSnapshots: TrancheSnapshot[]): Map<string, TrancheSnapshot[]> {
    const grouped = new Map<string, TrancheSnapshot[]>()
    if (!trancheSnapshots) return grouped
    trancheSnapshots?.forEach((snapshot) => {
      const date = snapshot.timestamp.slice(0, 10)
      if (!grouped.has(date)) {
        grouped.set(date, [])
      }
      grouped.get(date)!.push(snapshot)
    })
    return grouped
  }
}

export const processor = new Processor()
