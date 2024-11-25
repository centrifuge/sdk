import { Entity } from '../Entity.js'
import { Centrifuge } from '../Centrifuge.js'
import { PoolSnapshotFilter, poolSnapshotsPostProcess, poolSnapshotsQuery } from '../queries/poolSnapshots.js'
import {
  TrancheSnapshotFilter,
  trancheSnapshotsPostProcess,
  trancheSnapshotsQuery,
} from '../queries/trancheSnapshots.js'
import { combineLatest, of } from 'rxjs'
import { processor } from './Processor.js'

import { map } from 'rxjs'
import { BalanceSheetReport, CashflowReport, ReportFilter } from './types.js'
import { Query } from '../types/query.js'
import {
  PoolFeeSnapshotFilter,
  poolFeeSnapshotQuery,
  poolFeeSnapshotsPostProcess,
} from '../queries/poolFeeSnapshots.js'
import { PoolMetadata } from '../types/poolMetadata.js'

type ReportType = 'balanceSheet' | 'cashflow'

export class Reports extends Entity {
  constructor(
    centrifuge: Centrifuge,
    public poolId: string,
    public metadataHash?: string
  ) {
    super(centrifuge, ['reports', poolId])
  }

  // TODO: think about a horizontal formatting option
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
            lessThan: filter?.to,
          },
        }

        const metadata$ = this.metadataHash ? this._root._queryIPFS<PoolMetadata>(this.metadataHash) : of(undefined)

        const poolSnapshots$ = this.poolSnapshots({
          ...dateFilter,
          poolId: { equalTo: this.poolId },
        })
        const trancheSnapshots$ = this.trancheSnapshots({
          ...dateFilter,
          tranche: { poolId: { equalTo: this.poolId } },
        })
        const poolFeeSnapshots$ = this.poolFeeSnapshots({
          ...dateFilter,
          poolFeeId: { includes: this.poolId },
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
