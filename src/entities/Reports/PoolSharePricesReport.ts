import { combineLatest, map, switchMap } from 'rxjs'
import { Centrifuge } from '../../Centrifuge.js'
import { HexString } from '../../types/index.js'
import { TokenInstanceSnapshotFilter, TokenSnapshotFilter } from '../../types/indexer.js'
import { Balance, Price } from '../../utils/BigInt.js'
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

export type SharePricesReport = {
  timestamp: string
  shareClasses: Record<
    HexString,
    {
      price: Price
      totalIssuance: Balance
      yields: ShareYields
    }
  >
}[]

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

/**
 * Normalize a numeric timestamp to epoch milliseconds. Values smaller than
 * 1e12 are treated as seconds (any sensible ms timestamp from the last few
 * decades is well past that threshold).
 */
function toEpochMs(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined
  return value < 1e12 ? value * 1000 : value
}

export type SharePricesReportFilter = DataReportFilter & {
  shareClassId?: ShareClassId
}

type SharePriceData = {
  tokenInstanceSnapshots: {
    items: {
      tokenId: HexString
      timestamp: string
      totalIssuance: string
      tokenPrice: string
      triggerChainId: string
    }[]
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

export class PoolSharePricesReport extends Entity {
  public pool: Pool
  constructor(
    centrifuge: Centrifuge,
    public poolReports: PoolReports
  ) {
    super(centrifuge, ['poolSharePricesReport', poolReports.pool.id.toString()])
    this.pool = poolReports.pool
  }

  /**
   * Get the share prices report for a pool.
   * @param filter - The filter for the report.
   * @returns The share prices report.
   */
  report(filter: SharePricesReportFilter = {}) {
    const { from, to, groupBy } = filter
    return this._query(['report', from?.toString(), to?.toString(), groupBy?.toString()], () =>
      combineLatest([this.pool._shareClassIds(), this.pool.decimals()]).pipe(
        switchMap(([shareClassIds, poolDecimals]) => {
          const selectedShareClassIds = shareClassIds
            .filter((id) => !filter.shareClassId || filter.shareClassId.equals(id))
            .map((id) => id.toString())
          // Indexer snapshots store timestamps as epoch-millisecond strings.
          // Callers may pass `from`/`to` in either seconds or ms; normalize to ms.
          const fromMs = toEpochMs(from)
          const toMs = toEpochMs(to)
          const priceData$ = this._root._queryIndexer<SharePriceData>(
            `query ($filter: TokenInstanceSnapshotFilter) {
                tokenInstanceSnapshots(
                  where: $filter
                  orderBy: "timestamp"
                  orderDirection: "desc"
                  limit: 1000
                ) {
                  items {
                    tokenId
                    timestamp
                    totalIssuance
                    tokenPrice
                    triggerChainId
                  }
                }
              }`,
            {
              filter: {
                tokenId_in: selectedShareClassIds,
                trigger_ends_with: 'NewPeriod',
                ...(fromMs !== undefined ? { timestamp_gte: String(fromMs) } : {}),
                ...(toMs !== undefined ? { timestamp_lte: String(toMs) } : {}),
              } satisfies TokenInstanceSnapshotFilter,
            },
            undefined,
            60 * 60 * 1000
          )
          // Yields live on the share-class-level token_snapshot entity (not the
          // per-network token_instance_snapshot), so we fetch them in a second
          // query and merge by (date, shareClassId). No trigger filter: yields
          // are populated on price-update events (e.g. UpdatePricePoolPerShare,
          // UpdateShareClass), not on NewPeriod snapshots. The (date, id)
          // dedupe in _process keeps the latest snapshot per day.
          const yieldsData$ = this._root._queryIndexer<ShareYieldsData>(
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
                    ${YIELD_FIELDS.join('\n                    ')}
                  }
                }
              }`,
            {
              filter: {
                id_in: selectedShareClassIds,
                ...(fromMs !== undefined ? { timestamp_gte: String(fromMs) } : {}),
                ...(toMs !== undefined ? { timestamp_lte: String(toMs) } : {}),
              } satisfies TokenSnapshotFilter,
            },
            undefined,
            60 * 60 * 1000
          )
          return combineLatest([priceData$, yieldsData$]).pipe(
            map(([priceData, yieldsData]) => this._process(priceData, filter, poolDecimals, yieldsData))
          )
        })
      )
    )
  }

  /** @internal */
  _process(
    data: SharePriceData,
    filter: Pick<SharePricesReportFilter, 'groupBy'>,
    poolDecimals: number,
    yieldsData?: ShareYieldsData
  ): SharePricesReport {
    // Snapshots are emitted per (tokenId, triggerChainId, period). The indexer
    // sometimes returns multiple rows for the same (date, tokenId, chain) — e.g.
    // when the same period boundary triggers on more than one block. Dedupe to
    // one row per (date, tokenId, chain) by keeping the largest issuance, then
    // sum across chains for the (date, tokenId) total.
    const perChain: Record<string, Record<HexString, Record<string, { issuance: bigint; price: bigint }>>> = {}

    data.tokenInstanceSnapshots.items.forEach((item) => {
      const date = new Date(Number(item.timestamp)).toISOString().slice(0, 10)
      const issuance = BigInt(item.totalIssuance)
      const price = BigInt(item.tokenPrice)

      const byTokenId = (perChain[date] ??= {})
      const byChain = (byTokenId[item.tokenId] ??= {})
      const existing = byChain[item.triggerChainId]

      if (!existing || issuance > existing.issuance) {
        byChain[item.triggerChainId] = { issuance, price }
      }
    })

    // Yields are keyed by (date, shareClassId). Results are ordered
    // timestamp DESC; the first row we see for a given (date, id) is the
    // latest snapshot for that date.
    const yieldsByDate: Record<string, Record<HexString, ShareYields>> = {}
    yieldsData?.tokenSnapshots.items.forEach((row) => {
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

    const items = Object.entries(perChain).map(([date, byTokenId]) => {
      const shareClasses: SharePricesReport[number]['shareClasses'] = {}

      Object.entries(byTokenId).forEach(([tokenId, byChain]) => {
        let totalIssuance = 0n
        let priceSourceIssuance = -1n
        let price = 0n

        Object.values(byChain).forEach((row) => {
          totalIssuance += row.issuance
          // Prefer the price from the chain with the largest issuance — stale
          // chains may report 0 issuance with an outdated price.
          if (row.issuance > priceSourceIssuance) {
            priceSourceIssuance = row.issuance
            price = row.price
          }
        })

        shareClasses[tokenId as HexString] = {
          price: new Price(price),
          totalIssuance: new Balance(totalIssuance, poolDecimals),
          yields: yieldsByDate[date]?.[tokenId as HexString] ?? {},
        }
      })

      return {
        timestamp: new Date(date).toISOString(),
        shareClasses,
      }
    })

    return applyGrouping(items, filter.groupBy ?? 'day', 'latest').sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )
  }
}
