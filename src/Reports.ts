import { Centrifuge } from './Centrifuge.js'
import { Entity } from './Entity.js'
import {
  PoolSnapshot,
  PoolSnapshotFilter,
  poolSnapshotsPostProcess,
  poolSnapshotsQuery,
  SubqueryPoolSnapshot,
} from './queries/poolSnapshots.js'
import {
  TrancheSnapshot,
  TrancheSnapshotFilter,
  trancheSnapshotsPostProcess,
  trancheSnapshotsQuery,
  SubqueryTrancheSnapshot,
} from './queries/trancheSnapshots.js'
import { Currency, Price } from './utils/BigInt.js'
import { getDateYearsFromNow } from './utils/date.js'

type GroupBy = 'day' | 'month' | 'quarter' | 'year'
type BalanceSheetFilter = { to?: string; from?: string; groupBy?: GroupBy }

interface BalanceSheetItem {
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

const getCacheKey = (poolId: string, filter?: BalanceSheetFilter, options?: { type: string }): string => {
  return `reports:${options?.type ?? ''}:${poolId}:${filter?.from ?? ''}:${filter?.to ?? ''}:${filter?.groupBy ?? 'day'}`
}

export class Reports extends Entity {
  private static cache = new Map<
    string,
    {
      data: BalanceSheetItem[]
      timestamp: number
    }
  >()
  // Cache TTL in milliseconds (5 minutes)
  private static CACHE_TTL = 5 * 60 * 1000

  constructor(
    centrifuge: Centrifuge,
    public poolId: string
  ) {
    super(centrifuge, ['reports', poolId])
    setInterval(() => Reports.cleanCache(), Reports.CACHE_TTL)
  }

  async poolSnapshots(filter?: PoolSnapshotFilter) {
    const defaultFilter: PoolSnapshotFilter = {
      timestamp: {
        greaterThan: getDateYearsFromNow(-1).toISOString(),
        lessThan: new Date().toISOString(),
      },
      poolId: { equalTo: this.poolId },
    }

    return this._root._querySubquery<SubqueryPoolSnapshot, PoolSnapshot[]>(
      ['poolSnapshots'],
      poolSnapshotsQuery,
      { filter: { ...defaultFilter, ...filter } },
      poolSnapshotsPostProcess
    )
  }

  async trancheSnapshots(filter?: TrancheSnapshotFilter) {
    const defaultFilter: TrancheSnapshotFilter = {
      timestamp: {
        greaterThan: getDateYearsFromNow(-1).toISOString(),
        lessThan: new Date().toISOString(),
      },
      tranche: { poolId: { equalTo: this.poolId } },
    }

    return this._root._querySubquery<SubqueryTrancheSnapshot, TrancheSnapshot[]>(
      ['trancheSnapshots'],
      trancheSnapshotsQuery,
      { filter: { ...defaultFilter, ...filter } },
      trancheSnapshotsPostProcess
    )
  }

  async balanceSheet(filter?: BalanceSheetFilter): Promise<BalanceSheetItem[]> {
    const cacheKey = getCacheKey(this.poolId, filter, { type: 'balanceSheet' })
    const cached = Reports.cache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < Reports.CACHE_TTL) {
      return cached.data
    }

    const dateFilter = {
      timestamp: {
        greaterThan: filter?.from,
        lessThan: filter?.to,
      },
    }

    const [poolSnapshots, trancheSnapshots] = await Promise.all([
      this.poolSnapshots(dateFilter),
      this.trancheSnapshots(dateFilter),
    ])

    const trancheSnapshotsByDate = new Map<string, TrancheSnapshot[]>()
    trancheSnapshots.forEach((snapshot) => {
      const date = snapshot.timestamp.slice(0, 10)
      if (!trancheSnapshotsByDate.has(date)) {
        trancheSnapshotsByDate.set(date, [])
      }
      trancheSnapshotsByDate.get(date)!.push(snapshot)
    })

    const result = poolSnapshots.map((snapshot) => {
      const date = snapshot.timestamp.slice(0, 10)
      const tranches = trancheSnapshotsByDate.get(date)?.map((tranche) => ({
        name: tranche.pool.currency.symbol,
        timestamp: tranche.timestamp,
        tokenId: tranche.trancheId,
        tokenSupply: tranche.tokenSupply,
        tokenPrice: tranche.price,
        trancheValue: tranche.tokenSupply.mul(tranche?.price?.toBigInt() ?? 0n),
      }))

      const totalCapital = tranches?.reduce(
        (acc, curr) => acc.add(curr.tokenSupply.mul(curr?.tokenPrice?.toBigInt() ?? 0n).toBigInt()),
        new Currency(0, snapshot.poolCurrency.decimals)
      )

      return {
        date: snapshot.timestamp,
        assetValuation: snapshot.portfolioValuation,
        onchainReserve: snapshot.totalReserve,
        offchainCash: snapshot.offchainCashValue,
        accruedFees: snapshot.sumPoolFeesPendingAmount,
        netAssetValue: snapshot.netAssetValue,
        tranches,
        totalCapital,
      }
    })

    const groupedResult = filter?.groupBy ? this.groupByPeriod(result, filter.groupBy) : result

    Reports.cache.set(cacheKey, {
      data: groupedResult,
      timestamp: Date.now(),
    })

    return groupedResult
  }

  private groupByPeriod(data: BalanceSheetItem[], groupBy: GroupBy): BalanceSheetItem[] {
    const grouped = new Map<string, BalanceSheetItem>()

    data.forEach((item) => {
      const period = getGroupByPeriod(new Date(item.date), groupBy)
      if (!period) return

      // Keep the latest snapshot for each period
      if (!grouped.has(period) || new Date(item.date) > new Date(grouped.get(period)!.date)) {
        grouped.set(period, item)
      }
    })

    return Array.from(grouped.values())
  }

  static cleanCache(): void {
    const now = Date.now()
    for (const [key, value] of Reports.cache.entries()) {
      if (now - value.timestamp > Reports.CACHE_TTL) {
        Reports.cache.delete(key)
      }
    }
  }
}

function getGroupByPeriod(date: Date, groupBy: GroupBy): string | undefined {
  switch (groupBy) {
    case 'day':
      return date.toISOString().slice(0, 10)
    case 'month':
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    case 'quarter':
      const quarter = Math.floor(date.getMonth() / 3) + 1
      return `${date.getFullYear()}-Q${quarter}`
    case 'year':
      return date.getFullYear().toString()
    default:
      return undefined
  }
}
