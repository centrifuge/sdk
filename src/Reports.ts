import { firstValueFrom, map } from 'rxjs'
import { Centrifuge } from './Centrifuge.js'

import { Entity } from './Entity.js'
import {
  PoolSnapshot,
  poolSnapshotsPostProcess,
  poolSnapshotsQuery,
  SubqueryPoolSnapshot,
} from './queries/poolSnapshots.js'
import { getDateYearsFromNow } from './utils/date.js'
import { TrancheSnapshot } from './queries/trancheSnapshots.js'
import { SubqueryTrancheSnapshot } from './queries/trancheSnapshots.js'
import { trancheSnapshotsQuery } from './queries/trancheSnapshots.js'
import { trancheSnapshotsPostProcess } from './queries/trancheSnapshots.js'
import { Currency } from './utils/BigInt.js'

type ReportFilter = {
  from?: string
  to?: string
}

type GroupBy = 'day' | 'month' | 'quarter' | 'year'

const defaultFilter: ReportFilter = {
  from: getDateYearsFromNow(-10).toISOString(),
  to: getDateYearsFromNow(10).toISOString(),
}

export class Reports extends Entity {
  constructor(
    centrifuge: Centrifuge,
    public poolId: string
  ) {
    super(centrifuge, ['reports', poolId])
  }

  poolSnapshots(filter?: ReportFilter) {
    return this._root._querySubquery<SubqueryPoolSnapshot, PoolSnapshot[]>(
      ['poolSnapshots'],
      poolSnapshotsQuery,
      { poolId: this.poolId, ...defaultFilter, ...filter },
      poolSnapshotsPostProcess
    )
  }

  trancheSnapshots(filter?: ReportFilter) {
    return this._root._querySubquery<SubqueryTrancheSnapshot, TrancheSnapshot[]>(
      ['trancheSnapshots'],
      trancheSnapshotsQuery,
      { tranche: { poolId: { equalTo: this.poolId } }, ...defaultFilter, ...filter },
      trancheSnapshotsPostProcess
    )
  }

  filterByGroup<T extends TrancheSnapshot | PoolSnapshot>(data: T[], groupBy: GroupBy): T[] {
    const filteredData: { [period: string]: T } = {}
    data.forEach((item) => {
      const date = new Date(item.timestamp)
      const period = getGroupByPeriod(date, groupBy)
      if (!period) return
      if (!filteredData[period]) filteredData[period] = item
    })
    return Object.values(filteredData)
  }

  async trancheSnapshotsByGroup(groupBy: GroupBy, filter?: ReportFilter) {
    const trancheSnapshots = await firstValueFrom(this.trancheSnapshots(filter))
    return this.filterByGroup<TrancheSnapshot>(trancheSnapshots, groupBy)
  }

  async poolSnapshotsByGroup(groupBy: GroupBy, filter?: ReportFilter) {
    const poolSnapshots = await firstValueFrom(this.poolSnapshots(filter))
    return this.filterByGroup<PoolSnapshot>(poolSnapshots, groupBy)
  }

  /**
   * Assets
   * Asset valuation: portfolioValuation
   * Onchain reserve: totalReserve
   * Offchain cash: offchainCashValue
   * Accrued fees: sumPoolFeesPendingAmount
   * Net Asset Value: netAssetValue
   *
   * Capital
   * --> per tranche
   * token supply: tranches[token.id].tokenSupply
   * token price: tranches[token.id].price
   * tranche value: tranches[token.id].tokenSupply * tranches[token.id].price
   * total capital: sum of all tranche values
   */
  async balanceSheet(filter?: ReportFilter, groupBy: GroupBy = 'day') {
    const poolSnapshotsByGroup = await this.poolSnapshotsByGroup(groupBy, filter)
    const trancheSnapshotsByGroup = await this.trancheSnapshotsByGroup(groupBy, filter)
    return poolSnapshotsByGroup.map((snapshot) => {
      const poolCurrency = snapshot.poolCurrency.decimals
      const tranches = trancheSnapshotsByGroup
        .filter((tranche) => tranche.timestamp.slice(0, 10) === snapshot.timestamp.slice(0, 10))
        .map((tranche) => ({
          name: tranche.pool.currency.symbol,
          tokenId: tranche.trancheId,
          tokenSupply: tranche.tokenSupply,
          tokenPrice: tranche.price,
          trancheValue: tranche.tokenSupply.mul(tranche?.price?.toBigInt() ?? 0n),
        }))
      return {
        date: snapshot.timestamp,
        assetValuation: snapshot.portfolioValuation,
        onchainReserve: snapshot.totalReserve,
        offchainCash: snapshot.offchainCashValue,
        accruedFees: snapshot.sumPoolFeesPendingAmount,
        netAssetValue: snapshot.netAssetValue,
        tranches, // TODO: why is tranches empty?
        totalCapital: tranches.reduce(
          (acc, curr) => acc.add(curr.tokenSupply.mul(curr?.tokenPrice?.toBigInt() ?? 0n).toBigInt()),
          new Currency(0, poolCurrency)
        ),
      }
    })
  }
}

function getGroupByPeriod(date: Date, groupBy: GroupBy) {
  if (groupBy === 'day') {
    return date.toISOString().split('T')[0]
  } else if (groupBy === 'month') {
    return `${date.getMonth() + 1}-${date.getFullYear()}`
  } else if (groupBy === 'quarter') {
    const quarter = Math.ceil((date.getMonth() + 1) / 3)
    return `Q${quarter}-${date.getFullYear()}`
  } else if (groupBy === 'year') {
    return `${date.getFullYear()}`
  }
  throw new Error(`Unsupported groupBy: ${groupBy}`)
}
