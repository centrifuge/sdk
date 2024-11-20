import { Entity } from '../Entity.js'
import { Centrifuge } from '../Centrifuge.js'
import { PoolSnapshotFilter, poolSnapshotsPostProcess, poolSnapshotsQuery } from '../queries/poolSnapshots.js'
import {
  TrancheSnapshotFilter,
  trancheSnapshotsPostProcess,
  trancheSnapshotsQuery,
} from '../queries/trancheSnapshots.js'
import { combineLatest, defer } from 'rxjs'
import { processor } from './Processor.js'

import { map } from 'rxjs'
import { ReportFilter } from './types.js'

export class Reports extends Entity {
  constructor(
    centrifuge: Centrifuge,
    public poolId: string
  ) {
    super(centrifuge, ['reports', poolId])
  }

  balanceSheet(filter?: ReportFilter) {
    return this._generateReport('balanceSheet', filter)
  }

  _generateReport(type: 'balanceSheet', filter?: ReportFilter) {
    return this._root._query(
      [type, filter?.from, filter?.to, filter?.groupBy],
      () =>
        defer(() => {
          const dateFilter = {
            timestamp: {
              greaterThan: filter?.from,
              lessThan: filter?.to,
            },
          }

          const poolSnapshots$ = this.poolSnapshots({
            ...dateFilter,
            poolId: { equalTo: this.poolId },
          })
          const trancheSnapshots$ = this.trancheSnapshots({
            ...dateFilter,
            tranche: { poolId: { equalTo: this.poolId } },
          })

          return combineLatest([poolSnapshots$, trancheSnapshots$]).pipe(
            map(([poolSnapshots, trancheSnapshots]) => {
              switch (type) {
                case 'balanceSheet':
                  return processor.balanceSheet({ poolSnapshots, trancheSnapshots }, filter)
                default:
                  throw new Error(`Unsupported report type: ${type}`)
              }
            })
          )
        }),
      {
        valueCacheTime: 120,
      }
    )
  }

  poolSnapshots(filter?: PoolSnapshotFilter) {
    return this._root._queryIndexer(poolSnapshotsQuery, { filter }, poolSnapshotsPostProcess)
  }

  trancheSnapshots(filter?: TrancheSnapshotFilter) {
    return this._root._queryIndexer(trancheSnapshotsQuery, { filter }, trancheSnapshotsPostProcess)
  }
}
