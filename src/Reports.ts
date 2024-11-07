import { firstValueFrom } from 'rxjs'
import { Centrifuge } from './Centrifuge.js'

import { Entity } from './Entity.js'
import {
  PoolSnapshot,
  PoolSnapshotFilter,
  poolSnapshotsPostProcess,
  poolSnapshotsQuery,
  SubqueryPoolSnapshot,
} from './queries/poolSnapshots.js'
import { TrancheSnapshot, TrancheSnapshotFilter } from './queries/trancheSnapshots.js'
import { SubqueryTrancheSnapshot } from './queries/trancheSnapshots.js'
import { trancheSnapshotsQuery } from './queries/trancheSnapshots.js'
import { trancheSnapshotsPostProcess } from './queries/trancheSnapshots.js'
import { Currency } from './utils/BigInt.js'
import { getDateYearsFromNow } from './utils/date.js'

type GroupBy = 'day' | 'month' | 'quarter' | 'year'

type BalanceSheetFilter = { to?: string; from?: string; groupBy?: GroupBy }

export class Reports extends Entity {
  constructor(
    centrifuge: Centrifuge,
    public poolId: string
  ) {
    super(centrifuge, ['reports', poolId])
  }

  poolSnapshots(filter?: PoolSnapshotFilter) {
    const defaultPoolSnapshotFilter: PoolSnapshotFilter = {
      timestamp: {
        greaterThan: getDateYearsFromNow(-1).toISOString(),
        lessThan: new Date().toISOString(),
      },
      poolId: { equalTo: this.poolId },
    }
    return this._root._querySubquery<SubqueryPoolSnapshot, PoolSnapshot[]>(
      ['poolSnapshots'],
      poolSnapshotsQuery,
      { filter: { ...defaultPoolSnapshotFilter, ...filter } },
      poolSnapshotsPostProcess
    )
  }

  trancheSnapshots(filter?: TrancheSnapshotFilter) {
    const defaultTrancheSnapshotFilter: TrancheSnapshotFilter = {
      timestamp: {
        greaterThan: getDateYearsFromNow(-1).toISOString(),
        lessThan: new Date().toISOString(),
      },
      tranche: { poolId: { equalTo: this.poolId } },
    }
    return this._root._querySubquery<SubqueryTrancheSnapshot, TrancheSnapshot[]>(
      ['trancheSnapshots'],
      trancheSnapshotsQuery,
      { filter: { ...defaultTrancheSnapshotFilter, ...filter } },
      trancheSnapshotsPostProcess
    )
  }

  async poolSnapshotsWithTrancheSnapshots(filter?: PoolSnapshotFilter) {
    const poolSnapshots = await this.poolSnapshots(filter)
    const trancheSnapshots = await this.trancheSnapshots(filter)
    return poolSnapshots.map((poolSnapshot) => {
      return {
        ...poolSnapshot,
        trancheSnapshots: trancheSnapshots.filter((trancheSnapshot) => trancheSnapshot.poolId === poolSnapshot.poolId),
      }
    })
  }

  filterPoolSnapshotsByGroup(data: PoolSnapshot[], groupBy: GroupBy): PoolSnapshot[] {
    const filteredData: { [period: string]: PoolSnapshot } = {}
    data.forEach((item) => {
      const date = new Date(item.timestamp)
      const period = getGroupByPeriod(date, groupBy)
      if (!period) return
      if (!filteredData[period]) filteredData[period] = item
    })
    return Object.values(filteredData)
  }

  filterTrancheSnapshotsByGroup(data: TrancheSnapshot[], groupBy: GroupBy) {
    const filteredData: { [period: string]: TrancheSnapshot[] } = {}
    data.forEach((item) => {
      const date = new Date(item.timestamp)
      const period = getGroupByPeriod(date, groupBy)
      if (!period) return
      if (!filteredData[period]) filteredData[period] = []
      filteredData[period].push(item)
    })
    return filteredData
  }

  // TODO: cache results since compute intensive
  async balanceSheet(filter?: BalanceSheetFilter) {
    const poolFilter: PoolSnapshotFilter = {
      timestamp: {
        greaterThan: filter?.from,
        lessThan: filter?.to,
      },
      poolId: { equalTo: this.poolId },
    }
    const poolSnapshots = await this.poolSnapshots(poolFilter)
    const poolSnapshotsByGroup = this.filterPoolSnapshotsByGroup(poolSnapshots, filter?.groupBy ?? 'day')
    const trancheFilter: TrancheSnapshotFilter = {
      timestamp: {
        greaterThan: filter?.from,
        lessThan: filter?.to,
      },
      tranche: { poolId: { equalTo: this.poolId } },
    }
    const trancheSnapshots = await this.trancheSnapshots(trancheFilter)
    const trancheSnapshotsByGroup = this.filterTrancheSnapshotsByGroup(trancheSnapshots, filter?.groupBy ?? 'day')
    return poolSnapshotsByGroup.map((snapshot) => {
      const poolCurrency = snapshot.poolCurrency.decimals
      const tranches = trancheSnapshotsByGroup[snapshot.timestamp.slice(0, 10)]?.map((tranche) => {
        return {
          name: tranche.pool.currency.symbol,
          timestamp: tranche.timestamp,
          tokenId: tranche.trancheId,
          tokenSupply: tranche.tokenSupply,
          tokenPrice: tranche.price,
          trancheValue: tranche.tokenSupply.mul(tranche?.price?.toBigInt() ?? 0n),
        }
      })
      return {
        date: snapshot.timestamp,
        assetValuation: snapshot.portfolioValuation,
        onchainReserve: snapshot.totalReserve,
        offchainCash: snapshot.offchainCashValue,
        accruedFees: snapshot.sumPoolFeesPendingAmount,
        netAssetValue: snapshot.netAssetValue,
        tranches,
        totalCapital: tranches?.reduce(
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
