import { combineLatest, map, switchMap } from 'rxjs'
import { Centrifuge } from '../../Centrifuge.js'
import { HexString } from '../../types/index.js'
import { Balance, Price } from '../../utils/BigInt.js'
import { snapshotInstant } from '../../utils/date.js'
import { Entity } from '../Entity.js'
import { Pool } from '../Pool.js'
import { PoolReports } from './PoolReports.js'
import { SharePricesReport, SharePricesReportFilter } from './PoolSharePricesReport.js'
import { applyGrouping, snapshotDay } from './utils.js'

type HubSharePriceData = {
  tokenSnapshots: {
    items: {
      id: HexString
      timestamp: string
      tokenPrice: string | null
      totalIssuance: string | null
      trigger: string
    }[]
  }
}

export class PoolHubSharePricesReport extends Entity {
  public pool: Pool
  constructor(
    centrifuge: Centrifuge,
    public poolReports: PoolReports
  ) {
    super(centrifuge, ['poolHubSharePricesReport', poolReports.pool.id.toString()])
    this.pool = poolReports.pool
  }

  report(filter: SharePricesReportFilter = {}) {
    const { from, to, groupBy, limit } = filter
    return this._query(['report', from?.toString(), to?.toString(), groupBy?.toString(), limit?.toString()], () =>
      combineLatest([this.pool._shareClassIds(), this.pool.decimals()]).pipe(
        switchMap(([shareClassIds, poolDecimals]) =>
          this._root
            ._queryData<HubSharePriceData>(
              'hubSharePricesReport',
              {
                tokenIds: shareClassIds
                  .filter((id) => !filter.shareClassId || filter.shareClassId.equals(id))
                  .map((id) => id.toString()),
                ...(limit !== undefined ? { limit } : {}),
                ...(from !== undefined ? { from: new Date(from).toISOString() } : {}),
                ...(to !== undefined ? { to: new Date(to).toISOString() } : {}),
              },
              undefined,
              60 * 60 * 1000
            )
            .pipe(map((data) => this._process(data, filter, poolDecimals)))
        )
      )
    )
  }

  /** @internal */
  _process(
    data: HubSharePriceData,
    filter: Pick<SharePricesReportFilter, 'groupBy'>,
    poolDecimals: number
  ): SharePricesReport {
    const byDate: Record<string, SharePricesReport[number]['shareClasses']> = {}
    const seen = new Set<string>()
    const rows = [...data.tokenSnapshots.items].sort(
      (a, b) =>
        snapshotInstant(b.timestamp, 'hubSharePricesReport').getTime() -
        snapshotInstant(a.timestamp, 'hubSharePricesReport').getTime()
    )

    rows.forEach((row) => {
      const date = snapshotDay(row.timestamp, 'hubSharePricesReport')
      const key = `${date}:${row.id}`
      if (seen.has(key)) return
      seen.add(key)
      if (row.tokenPrice == null || row.totalIssuance == null) return
      const shareClasses = (byDate[date] ??= {})
      shareClasses[row.id] = {
        price: new Price(BigInt(row.tokenPrice)),
        totalIssuance: new Balance(BigInt(row.totalIssuance), poolDecimals),
      }
    })

    const items = Object.entries(byDate).map(([date, shareClasses]) => ({
      timestamp: new Date(date).toISOString(),
      shareClasses,
    }))

    return applyGrouping(items, filter.groupBy ?? 'day', 'latest').sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )
  }
}
