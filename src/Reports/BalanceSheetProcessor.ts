import { PoolSnapshot } from '../queries/poolSnapshots.js'
import { TrancheSnapshot } from '../queries/trancheSnapshots.js'
import { Currency, Price } from '../utils/BigInt.js'
import { GroupBy, groupByPeriod } from '../utils/date.js'

export type BalanceSheetFilter = { to?: string; from?: string; groupBy?: GroupBy }

export interface BalanceSheetItem {
  date: string
  assetValuation: Currency
  onchainReserve: Currency
  offchainCash: Currency
  accruedFees: Currency
  netAssetValue: Currency
  tranches?: {
    name: string
    timestamp: string
    tokenId: string
    tokenSupply: Currency
    tokenPrice: Price | null
    trancheValue: Currency
  }[]
  totalCapital?: Currency
}

export class BalanceSheetProcessor {
  static processSnapshots(
    poolSnapshots: PoolSnapshot[],
    trancheSnapshots: TrancheSnapshot[],
    groupBy?: GroupBy
  ): BalanceSheetItem[] {
    const trancheSnapshotsByDate = this.groupTranchesByDate(trancheSnapshots)
    const items = this.createBalanceSheetItems(poolSnapshots, trancheSnapshotsByDate)
    return groupBy ? groupByPeriod(items, groupBy) : items
  }

  private static groupTranchesByDate(trancheSnapshots: TrancheSnapshot[]): Map<string, TrancheSnapshot[]> {
    const grouped = new Map<string, TrancheSnapshot[]>()
    trancheSnapshots.forEach((snapshot) => {
      const date = snapshot.timestamp.slice(0, 10)
      if (!grouped.has(date)) {
        grouped.set(date, [])
      }
      grouped.get(date)!.push(snapshot)
    })
    return grouped
  }

  private static createBalanceSheetItems(
    poolSnapshots: PoolSnapshot[],
    trancheSnapshotsByDate: Map<string, TrancheSnapshot[]>
  ): BalanceSheetItem[] {
    return poolSnapshots.map((snapshot) => ({
      date: snapshot.timestamp,
      assetValuation: snapshot.portfolioValuation,
      onchainReserve: snapshot.totalReserve,
      offchainCash: snapshot.offchainCashValue,
      accruedFees: snapshot.sumPoolFeesPendingAmount,
      netAssetValue: snapshot.netAssetValue,
      tranches: this.createTrancheItems(trancheSnapshotsByDate.get(snapshot.timestamp.slice(0, 10)) ?? []),
      totalCapital: this.calculateTotalCapital(
        trancheSnapshotsByDate.get(snapshot.timestamp.slice(0, 10)) ?? [],
        snapshot.poolCurrency.decimals
      ),
    }))
  }

  private static createTrancheItems(tranches: TrancheSnapshot[]): BalanceSheetItem['tranches'] {
    return tranches.map((tranche) => ({
      name: tranche.pool.currency.symbol,
      timestamp: tranche.timestamp,
      tokenId: tranche.trancheId,
      tokenSupply: tranche.tokenSupply,
      tokenPrice: tranche.price,
      trancheValue: tranche.tokenSupply.mul(tranche?.price?.toBigInt() ?? 0n),
    }))
  }

  private static calculateTotalCapital(tranches: TrancheSnapshot[], decimals: number): Currency {
    return tranches.reduce(
      (acc, curr) => acc.add(curr.tokenSupply.mul(curr?.price?.toBigInt() ?? 0n).toBigInt()),
      new Currency(0, decimals)
    )
  }
}
