import { PoolSnapshot } from '../../queries/poolSnapshots.js'
import { TrancheSnapshot } from '../../queries/trancheSnapshots.js'
import { Currency, Price } from '../../utils/BigInt.js'
import { groupByPeriod } from '../../utils/date.js'
import { ReportData, ReportFilter, ReportProcessor } from '../types.js'

export interface BalanceSheetItem extends ReportData {
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

export const balanceSheetProcessor: ReportProcessor<BalanceSheetData, BalanceSheetItem> = {
  process(data: BalanceSheetData, filter?: ReportFilter): BalanceSheetItem[] {
    return processBalanceSheetData(data, filter)
  },
  getCacheKey(poolId: string, filter?: ReportFilter): string {
    return ['balanceSheet', poolId, filter?.from, filter?.to, filter?.groupBy].filter(Boolean).join(':')
  },
}

function processBalanceSheetData(data: BalanceSheetData, filter?: ReportFilter): BalanceSheetItem[] {
  const trancheSnapshotsByDate = groupTranchesByDate(data.trancheSnapshots)
  const items = createBalanceSheetItems(data.poolSnapshots, trancheSnapshotsByDate)
  return filter?.groupBy ? groupByPeriod(items, filter.groupBy) : items
}

function groupTranchesByDate(trancheSnapshots: TrancheSnapshot[]): Map<string, TrancheSnapshot[]> {
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

function createTrancheItems(tranches: TrancheSnapshot[]): BalanceSheetItem['tranches'] {
  return tranches.map((tranche) => ({
    name: tranche.pool.currency.symbol,
    timestamp: tranche.timestamp,
    tokenId: tranche.trancheId,
    tokenSupply: tranche.tokenSupply,
    tokenPrice: tranche.price,
    trancheValue: tranche.tokenSupply.mul(tranche?.price?.toBigInt() ?? 0n),
  }))
}

function calculateTotalCapital(tranches: TrancheSnapshot[], decimals: number): Currency {
  return tranches.reduce(
    (acc, curr) => acc.add(curr.tokenSupply.mul(curr?.price?.toBigInt() ?? 0n).toBigInt()),
    new Currency(0, decimals)
  )
}

function createBalanceSheetItems(
  poolSnapshots: PoolSnapshot[],
  trancheSnapshotsByDate: Map<string, TrancheSnapshot[]>
): BalanceSheetItem[] {
  return poolSnapshots.map((snapshot) => ({
    timestamp: snapshot.timestamp,
    date: snapshot.timestamp,
    assetValuation: snapshot.portfolioValuation,
    onchainReserve: snapshot.totalReserve,
    offchainCash: snapshot.offchainCashValue,
    accruedFees: snapshot.sumPoolFeesPendingAmount,
    netAssetValue: snapshot.netAssetValue,
    tranches: createTrancheItems(trancheSnapshotsByDate.get(snapshot.timestamp.slice(0, 10)) ?? []),
    totalCapital: calculateTotalCapital(
      trancheSnapshotsByDate.get(snapshot.timestamp.slice(0, 10)) ?? [],
      snapshot.poolCurrency.decimals
    ),
  }))
}
