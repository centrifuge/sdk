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
      combineLatest([this.pool._shareClassIds(), this.pool.currency(), this.pool.activeNetworks()]).pipe(
        switchMap(([shareClassIds, poolCurrency, activeNetworks]) =>
          this._root._idToChain(activeNetworks[0]?.centrifugeId ?? this.pool.centrifugeId).pipe(
            switchMap((chainId) =>
              this._root
                ._queryIndexer<SharePriceData>(
                  `query ($filter: TokenInstanceSnapshotFilter) {
								tokenInstanceSnapshots(
									where: $filter
									orderBy: "timestamp"
									orderDirection: "asc"
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
                      triggerChainId: String(chainId),
                      // TODO from/to
                    } satisfies TokenInstanceSnapshotFilter,
                  },
                  undefined,
                  60 * 60 * 1000
                )
                .pipe(map((data) => this._process(data, filter, poolCurrency)))
            )
          )
        )
      )
    )
  }

  /** @internal */
  _process(
    data: SharePriceData,
    filter: Pick<SharePricesReportFilter, 'groupBy'>,
    poolCurrency: { decimals: number }
  ): SharePricesReport {
    const sharePricesByDate: Record<string, SharePricesReport[number]['shareClasses']> = {}

    data.tokenInstanceSnapshots.items.forEach((item) => {
      const date = new Date(Number(item.timestamp)).toISOString().slice(0, 10)
      if (!sharePricesByDate[date]) {
        sharePricesByDate[date] = {}
      }

      sharePricesByDate[date][item.tokenId] = {
        price: new Price(item.tokenPrice),
        totalIssuance: new Balance(item.totalIssuance, poolCurrency.decimals),
      }
    })
    const items = Object.entries(sharePricesByDate).map(([timestamp, shareClasses]) => {
      const date = new Date(timestamp)
      return {
        timestamp: date.toISOString(),
        shareClasses,
      }
    })

    return applyGrouping(items, filter.groupBy ?? 'day', 'latest')
  }
}
