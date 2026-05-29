import { Centrifuge } from '../../Centrifuge.js'
import { Entity } from '../Entity.js'
import { Pool } from '../Pool.js'
import { PoolShareYieldsReport, ShareYieldsReportFilter } from './PoolShareYieldsReport.js'
import { PoolSharePricesReport, SharePricesReportFilter } from './PoolSharePricesReport.js'

export class PoolReports extends Entity {
  /** @internal */
  constructor(
    centrifuge: Centrifuge,
    public pool: Pool
  ) {
    super(centrifuge, ['poolReports', pool.id.toString()])
  }

  sharePrices(filter?: SharePricesReportFilter) {
    return new PoolSharePricesReport(this._root, this).report(filter)
  }

  shareYields(filter?: ShareYieldsReportFilter) {
    return new PoolShareYieldsReport(this._root, this).report(filter)
  }
}
