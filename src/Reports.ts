import { Centrifuge } from './Centrifuge.js'

import { Entity } from './Entity.js'
import {
  PoolSnapshot,
  poolSnapshotsPostProcess,
  poolSnapshotsQuery,
  SubqueryPoolSnapshot,
} from './queries/reports/poolSnapshots.js'
import { getDateYearsFromNow } from './utils/date.js'

type ReportFilter = {
  from?: string
  to?: string
}

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
      {
        poolId: this.poolId,
        ...defaultFilter,
        ...filter,
      },
      poolSnapshotsPostProcess
    )
  }

  async balanceSheet(filter?: ReportFilter) {
    const snapshots = await this.poolSnapshots(filter)
    // parse the snapshots into a balance sheet data
    return snapshots
  }
}
