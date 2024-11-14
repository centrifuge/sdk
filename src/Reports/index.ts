import { Entity } from '../Entity.js'
import { Centrifuge } from '../Centrifuge.js'
import { processors } from './processors/index.js'
import { ReportFilter } from './types.js'
import { ReportService } from './ReportService.js'
import { PoolSnapshotFilter, poolSnapshotsPostProcess, poolSnapshotsQuery } from '../queries/poolSnapshots.js'
import {
  TrancheSnapshotFilter,
  trancheSnapshotsPostProcess,
  trancheSnapshotsQuery,
} from '../queries/trancheSnapshots.js'

export class Reports extends Entity {
  constructor(
    centrifuge: Centrifuge,
    public poolId: string
  ) {
    super(centrifuge, ['reports', poolId])
  }

  // TODO: add direction parameter (horizontal or vertical)
  async balanceSheet(filter?: ReportFilter) {
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

    return ReportService.generate(processors.balanceSheet, this.poolId, { poolSnapshots, trancheSnapshots }, filter)
  }

  async poolSnapshots(filter?: PoolSnapshotFilter) {
    return this._root._queryIndexer(poolSnapshotsQuery, { filter }, poolSnapshotsPostProcess)
  }

  async trancheSnapshots(filter?: TrancheSnapshotFilter) {
    return this._root._queryIndexer(trancheSnapshotsQuery, { filter }, trancheSnapshotsPostProcess)
  }
}
