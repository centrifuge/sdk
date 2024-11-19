import { PoolSnapshot } from '../../queries/poolSnapshots.js'
import { TrancheSnapshot } from '../../queries/trancheSnapshots.js'
import { Currency, Price } from '../../utils/BigInt.js'
import { groupByPeriod } from '../../utils/date.js'
import { ReportData, ReportFilter } from '../types.js'

export interface BalanceSheetReport extends ReportData {
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

type BalanceSheetData = {
  poolSnapshots: PoolSnapshot[]
  trancheSnapshots: TrancheSnapshot[]
}

export function processBalanceSheetData(data: BalanceSheetData, filter?: ReportFilter): BalanceSheetReport[] {
  const trancheSnapshotsByDate = groupTranchesByDate(data.trancheSnapshots)
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

function groupTranchesByDate(trancheSnapshots: TrancheSnapshot[]): Map<string, TrancheSnapshot[]> {
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
