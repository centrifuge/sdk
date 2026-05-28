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
      triggerChainId: string
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
											triggerChainId
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
