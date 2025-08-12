import { Centrifuge } from '../../Centrifuge.js'
import { Entity } from '../Entity.js'
import { Pool } from '../Pool.js'
import { PoolSharePricesReport, SharePriceReportFilter } from './PoolSharePricesReport.js'

export class PoolReports extends Entity {
  /** @internal */
  constructor(
    centrifuge: Centrifuge,
    public pool: Pool
  ) {
    super(centrifuge, ['poolReports', pool.id.toString()])
  }

  sharePrices(filter?: SharePriceReportFilter) {
    return new PoolSharePricesReport(this._root, this).report(filter)
  }
}
