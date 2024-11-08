import { Centrifuge } from '../Centrifuge.js'
import { Entity } from '../Entity.js'
import {
  PoolSnapshot,
  PoolSnapshotFilter,
  poolSnapshotsPostProcess,
  poolSnapshotsQuery,
  SubqueryPoolSnapshot,
} from '../queries/poolSnapshots.js'
import {
  TrancheSnapshot,
  TrancheSnapshotFilter,
  trancheSnapshotsPostProcess,
  trancheSnapshotsQuery,
  SubqueryTrancheSnapshot,
} from '../queries/trancheSnapshots.js'
import { getDateYearsFromNow } from '../utils/date.js'
import { BalanceSheetFilter, BalanceSheetProcessor, BalanceSheetItem } from './BalanceSheetProcessor.js'
import { Cache } from './Cache.js'

export class Reports extends Entity {
  constructor(
    centrifuge: Centrifuge,
    public poolId: string
  ) {
    super(centrifuge, ['reports', poolId])
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
    const cacheKey = Cache.generateKey(['balanceSheet', this.poolId, ...Object.values(filter ?? {})])
    const cached = Cache.get<BalanceSheetItem[]>(cacheKey)
    if (cached) return cached

    const dateFilter = {
      timestamp: {
        greaterThan: filter?.from,
        lessThan: filter?.to,
      },
    }

    const [poolSnapshots, trancheSnapshots] = await Promise.all([
      this.poolSnapshots({
        ...dateFilter,
        poolId: { equalTo: this.poolId },
      }),
      this.trancheSnapshots({
        ...dateFilter,
        tranche: { poolId: { equalTo: this.poolId } },
      }),
    ])

    const result = BalanceSheetProcessor.processSnapshots(poolSnapshots, trancheSnapshots, filter?.groupBy)
    Cache.set(cacheKey, result)
    return result
  }
}
