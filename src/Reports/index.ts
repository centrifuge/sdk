import { Entity } from '../Entity.js'
import { Centrifuge } from '../Centrifuge.js'
import { PoolSnapshotFilter, poolSnapshotsPostProcess, poolSnapshotsQuery } from '../queries/poolSnapshots.js'
import {
  TrancheSnapshotFilter,
  trancheSnapshotsPostProcess,
  trancheSnapshotsQuery,
} from '../queries/trancheSnapshots.js'
import { combineLatest } from 'rxjs'
import { processor } from './Processor.js'

import { map } from 'rxjs'
import { BalanceSheetReport, CashflowReport, ReportFilter } from './types.js'
import { Query } from '../types/query.js'
import {
  PoolFeeSnapshotFilter,
  poolFeeSnapshotQuery,
  poolFeeSnapshotsPostProcess,
} from '../queries/poolFeeSnapshots.js'
import { Pool } from '../Pool.js'

type ReportType = 'balanceSheet' | 'cashflow'

export class Reports extends Entity {
  constructor(
    centrifuge: Centrifuge,
    public pool: Pool
  ) {
    super(centrifuge, ['reports', pool.id])
  }

  balanceSheet(filter?: ReportFilter) {
    return this._generateReport<BalanceSheetReport>('balanceSheet', filter)
  }

  cashflow(filter?: ReportFilter) {
    return this._generateReport<CashflowReport>('cashflow', filter)
  }

  _generateReport<T>(type: ReportType, filter?: ReportFilter): Query<T[]> {
    return this._query(
      [type, filter?.from, filter?.to, filter?.groupBy],
      () => {
        const dateFilter = {
          timestamp: {
            greaterThan: filter?.from,
            lessThanOrEqualTo: filter?.to && `${filter.to.split('T')[0]}T23:59:59.999Z`,
          },
        }

        const metadata$ = this.pool.metadata()

        const poolSnapshots$ = this.poolSnapshots({
          ...dateFilter,
          poolId: { equalTo: this.pool.id },
        })
        const trancheSnapshots$ = this.trancheSnapshots({
          ...dateFilter,
          tranche: { poolId: { equalTo: this.pool.id } },
        })
        const poolFeeSnapshots$ = this.poolFeeSnapshots({
          ...dateFilter,
          poolFeeId: { includes: this.pool.id },
        })

        switch (type) {
          case 'balanceSheet':
            return combineLatest([poolSnapshots$, trancheSnapshots$]).pipe(
              map(
                ([poolSnapshots, trancheSnapshots]) =>
                  processor.balanceSheet({ poolSnapshots, trancheSnapshots }, filter) as T[]
              )
            )
          case 'cashflow':
            return combineLatest([poolSnapshots$, poolFeeSnapshots$, metadata$]).pipe(
              map(
                ([poolSnapshots, poolFeeSnapshots, metadata]) =>
                  processor.cashflow({ poolSnapshots, poolFeeSnapshots, metadata }, filter) as T[]
              )
            )
          default:
            throw new Error(`Unsupported report type: ${type}`)
        }
      },
      {
        valueCacheTime: 120,
      }
    )
  }

  poolFeeSnapshots(filter?: PoolFeeSnapshotFilter) {
    return this._root._queryIndexer(poolFeeSnapshotQuery, { filter }, poolFeeSnapshotsPostProcess)
  }

  poolSnapshots(filter?: PoolSnapshotFilter) {
    return this._root._queryIndexer(poolSnapshotsQuery, { filter }, poolSnapshotsPostProcess)
  }

  trancheSnapshots(filter?: TrancheSnapshotFilter) {
    return this._root._queryIndexer(trancheSnapshotsQuery, { filter }, trancheSnapshotsPostProcess)
  }
}
