import { map, switchMap } from 'rxjs'
import { Centrifuge } from '../../Centrifuge.js'
import { HexString } from '../../types/index.js'
import { TokenSnapshotFilter } from '../../types/indexer.js'
import { Dec, DecimalJsType } from '../../utils/decimal.js'
import { ShareClassId } from '../../utils/types.js'
import { Entity } from '../Entity.js'
import { Pool } from '../Pool.js'
import { PoolReports } from './PoolReports.js'
import { DataReportFilter } from './types.js'
import { applyGrouping } from './utils.js'

/**
 * Per-snapshot yield/return figures returned by the indexer.
 *
 * Naming matches the underlying indexer columns. Values are expressed as
 * percentages (e.g. `5.5` = 5.5%). Fields are optional because the indexer
 * may not have a value yet for the corresponding window (e.g. `yield90d`
 * before the share class has 90 days of price history).
 *
 * Window encoding:
 * - `yield{N}d`     — simple total return over the trailing N days.
 * - `yield{N}d360`  — same window, annualized using a 360-day basis.
 * - `yield{N}d365`  — same window, annualized using a 365-day basis.
 * - `yield30dComp*` — 30-day compounded variants (annualized).
 *
 * `yieldTtm` is the trailing ~365 day simple return, `yieldSinceInception`
 * is from the first usable price, and `yieldYtd` is year-to-date (UTC).
 */
export type ShareYields = {
  yield1d?: DecimalJsType
  yield1d360?: DecimalJsType
  yield1d365?: DecimalJsType
  yield7d?: DecimalJsType
  yield7d360?: DecimalJsType
  yield7d365?: DecimalJsType
  yield15d?: DecimalJsType
  yield15d360?: DecimalJsType
  yield15d365?: DecimalJsType
  yield30d?: DecimalJsType
  yield30d360?: DecimalJsType
  yield30d365?: DecimalJsType
  yield90d?: DecimalJsType
  yield90d360?: DecimalJsType
  yield90d365?: DecimalJsType
  yield180d?: DecimalJsType
  yield180d360?: DecimalJsType
  yield180d365?: DecimalJsType
  yield30dComp360?: DecimalJsType
  yield30dComp365?: DecimalJsType
  yieldTtm?: DecimalJsType
  yieldSinceInception?: DecimalJsType
  yieldYtd?: DecimalJsType
}

export type ShareYieldsReport = {
  timestamp: string
  shareClasses: Record<HexString, ShareYields>
}[]

export type ShareYieldsReportFilter = DataReportFilter & {
  shareClassId?: ShareClassId
}

const YIELD_FIELDS = [
  'yield1d',
  'yield1d360',
  'yield1d365',
  'yield7d',
  'yield7d360',
  'yield7d365',
  'yield15d',
  'yield15d360',
  'yield15d365',
  'yield30d',
  'yield30d360',
  'yield30d365',
  'yield90d',
  'yield90d360',
  'yield90d365',
  'yield180d',
  'yield180d360',
  'yield180d365',
  'yield30dComp360',
  'yield30dComp365',
  'yieldTtm',
  'yieldSinceInception',
  'yieldYtd',
] as const satisfies readonly (keyof ShareYields)[]

// Yields are stored as Ray (1e27 fixed point) on token_snapshot. Dividing by
// 1e25 gives the value expressed as a percentage (e.g. Ray * 0.055 -> 5.5).
const RAY_PER_PERCENT = Dec('1e25')

function rayPercent(value: string | null | undefined): DecimalJsType | undefined {
  if (value == null) return undefined
  try {
    return Dec(value).div(RAY_PER_PERCENT)
  } catch {
    return undefined
  }
}

type YieldRow = { id: HexString; timestamp: string } & {
  [K in (typeof YIELD_FIELDS)[number]]: string | null
}

type ShareYieldsData = {
  tokenSnapshots: {
    items: YieldRow[]
  }
}

export class PoolShareYieldsReport extends Entity {
  public pool: Pool
  constructor(
    centrifuge: Centrifuge,
    public poolReports: PoolReports
  ) {
    super(centrifuge, ['poolShareYieldsReport', poolReports.pool.id.toString()])
    this.pool = poolReports.pool
  }

  /**
   * Get the per-day share-class yields report for a pool.
   *
   * Yields live on the share-class-level `token_snapshot` entity (not the
   * per-network `token_instance_snapshot` consumed by `sharePrices`), and are
   * populated on price-update events (`UpdatePricePoolPerShare`,
   * `UpdateShareClass`) rather than on `NewPeriod` snapshots. The
   * `(date, shareClassId)` dedupe keeps the latest snapshot per day.
   */
  report(filter: ShareYieldsReportFilter = {}) {
    const { groupBy } = filter
    return this._query(['report', groupBy?.toString()], () =>
      this.pool._shareClassIds().pipe(
        switchMap((shareClassIds) =>
          this._root
            ._queryIndexer<ShareYieldsData>(
              `query ($filter: TokenSnapshotFilter) {
                  tokenSnapshots(
                    where: $filter
                    orderBy: "timestamp"
                    orderDirection: "desc"
                    limit: 1000
                  ) {
                    items {
                      id
                      timestamp
                      ${YIELD_FIELDS.join('\n                      ')}
                    }
                  }
                }`,
              {
                filter: {
                  id_in: shareClassIds
                    .filter((id) => !filter.shareClassId || filter.shareClassId.equals(id))
                    .map((id) => id.toString()),
                } satisfies TokenSnapshotFilter,
              },
              undefined,
              60 * 60 * 1000
            )
            .pipe(map((data) => this._process(data, filter)))
        )
      )
    )
  }

  /** @internal */
  _process(data: ShareYieldsData, filter: Pick<ShareYieldsReportFilter, 'groupBy'>): ShareYieldsReport {
    // Yields are keyed by (date, shareClassId). Results are ordered timestamp
    // DESC; the first row we see for a given (date, id) is the latest snapshot
    // for that date.
    const yieldsByDate: Record<string, Record<HexString, ShareYields>> = {}
    data.tokenSnapshots.items.forEach((row) => {
      const date = new Date(Number(row.timestamp)).toISOString().slice(0, 10)
      const byTokenId = (yieldsByDate[date] ??= {})
      if (byTokenId[row.id]) return
      const y: ShareYields = {}
      for (const field of YIELD_FIELDS) {
        const v = rayPercent(row[field])
        if (v !== undefined) y[field] = v
      }
      byTokenId[row.id] = y
    })

    const items = Object.entries(yieldsByDate).map(([date, shareClasses]) => ({
      timestamp: new Date(date).toISOString(),
      shareClasses,
    }))

    return applyGrouping(items, filter.groupBy ?? 'day', 'latest').sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )
  }
}
