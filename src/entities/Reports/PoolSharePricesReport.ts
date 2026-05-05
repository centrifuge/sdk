import { combineLatest, map, switchMap } from 'rxjs'
import { Centrifuge } from '../../Centrifuge.js'
import { HexString } from '../../types/index.js'
import { TokenInstanceSnapshotFilter } from '../../types/indexer.js'
import { Balance, Price } from '../../utils/BigInt.js'
import { ShareClassId } from '../../utils/types.js'
import { Entity } from '../Entity.js'
import { Pool } from '../Pool.js'
import { PoolReports } from './PoolReports.js'
import { DataReportFilter } from './types.js'
import { applyGrouping } from './utils.js'

type ShareClassAggregate = {
  totalIssuance: bigint
  priceSourceIssuance: bigint
  price: bigint
}

export type SharePricesReport = {
  timestamp: string
  shareClasses: Record<
    HexString,
    {
      price: Price
      totalIssuance: Balance
    }
  >
}[]

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
    }[]
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
        switchMap(([shareClassIds, poolDecimals]) =>
          this._root
            ._queryIndexer<SharePriceData>(
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
										}
									}
								}`,
              {
                filter: {
                  tokenId_in: shareClassIds
                    .filter((id) => !filter.shareClassId || filter.shareClassId.equals(id))
                    .map((id) => id.toString()),
                  trigger_ends_with: 'NewPeriod',
                  // TODO from/to
                } satisfies TokenInstanceSnapshotFilter,
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
    data: SharePriceData,
    filter: Pick<SharePricesReportFilter, 'groupBy'>,
    poolDecimals: number
  ): SharePricesReport {
    // Snapshots are emitted per (tokenId, triggerChainId). For multi-network share
    // classes there are several rows per (date, tokenId) — sum issuance across them.
    const aggregates: Record<string, Record<HexString, ShareClassAggregate>> = {}

    data.tokenInstanceSnapshots.items.forEach((item) => {
      const date = new Date(Number(item.timestamp)).toISOString().slice(0, 10)
      if (!aggregates[date]) {
        aggregates[date] = {}
      }

      const issuance = BigInt(item.totalIssuance)
      const price = BigInt(item.tokenPrice)
      const existing = aggregates[date][item.tokenId]

      if (!existing) {
        aggregates[date][item.tokenId] = {
          totalIssuance: issuance,
          priceSourceIssuance: issuance,
          price,
        }
      } else {
        existing.totalIssuance += issuance
        // Prefer the price from the snapshot with the largest issuance — stale
        // chains may report 0 issuance with an outdated price.
        if (issuance > existing.priceSourceIssuance) {
          existing.priceSourceIssuance = issuance
          existing.price = price
        }
      }
    })

    const items = Object.entries(aggregates).map(([timestamp, byTokenId]) => {
      const shareClasses: SharePricesReport[number]['shareClasses'] = {}
      Object.entries(byTokenId).forEach(([tokenId, agg]) => {
        shareClasses[tokenId as HexString] = {
          price: new Price(agg.price),
          totalIssuance: new Balance(agg.totalIssuance, poolDecimals),
        }
      })
      return {
        timestamp: new Date(timestamp).toISOString(),
        shareClasses,
      }
    })

    return applyGrouping(items, filter.groupBy ?? 'day', 'latest').sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )
  }
}
