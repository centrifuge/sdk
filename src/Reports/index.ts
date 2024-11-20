import { Entity } from '../Entity.js'
import { Centrifuge } from '../Centrifuge.js'
import { PoolSnapshotFilter, poolSnapshotsPostProcess, poolSnapshotsQuery } from '../queries/poolSnapshots.js'
import {
  TrancheSnapshotFilter,
  trancheSnapshotsPostProcess,
  trancheSnapshotsQuery,
} from '../queries/trancheSnapshots.js'
import { processBalanceSheetData } from './processors/balanceSheet.js'
import { combineLatest, of } from 'rxjs'
import { ReportProcessorType } from './processors/index.js'

import { map } from 'rxjs'
import { GroupBy } from '../utils/date.js'
export interface ReportFilter {
  from?: string
  to?: string
  groupBy?: GroupBy
}

export interface ReportData {
  timestamp: string
  [key: string]: unknown
}

export class Reports extends Entity {
  constructor(
    centrifuge: Centrifuge,
    public poolId: string
  ) {
    super(centrifuge, ['reports', poolId])
  }

  balanceSheet(filter?: ReportFilter) {
    return this.generateReport('balanceSheet', filter)
  }

  generateReport(type: ReportProcessorType, filter?: ReportFilter) {
    return this._root._query(
      [type, ...(filter ? [filter] : [])],
      () => {
        const dateFilter = {
          timestamp: {
            greaterThan: filter?.from,
            lessThan: filter?.to,
          },
        }

        return combineLatest([
          this.poolSnapshots({
            ...dateFilter,
            poolId: { equalTo: this.poolId },
          }),
          this.trancheSnapshots({
            ...dateFilter,
            tranche: { poolId: { equalTo: this.poolId } },
          }),
        ]).pipe(
          map(([poolSnapshots, trancheSnapshots]) => {
            switch (type) {
              case 'balanceSheet':
                return processBalanceSheetData({ poolSnapshots, trancheSnapshots }, filter)
              default:
                throw new Error(`Unsupported report type: ${type}`)
            }
          })
        )
      },
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

  _processBalanceSheet(data: any, filter?: ReportFilter) {
    return processBalanceSheetData(data, filter)
  }
}
