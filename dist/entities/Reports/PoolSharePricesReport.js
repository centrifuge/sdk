import { combineLatest, map, switchMap } from 'rxjs';
import { Balance, Price } from '../../utils/BigInt.js';
import { Entity } from '../Entity.js';
import { applyGrouping } from './utils.js';
export class PoolSharePricesReport extends Entity {
    poolReports;
    pool;
    constructor(centrifuge, poolReports) {
        super(centrifuge, ['poolSharePricesReport', poolReports.pool.id.toString()]);
        this.poolReports = poolReports;
        this.pool = poolReports.pool;
    }
    /**
     * Get the share prices report for a pool.
     * @param filter - The filter for the report.
     * @returns The share prices report.
     */
    report(filter = {}) {
        const { from, to, groupBy } = filter;
        return this._query(['report', from?.toString(), to?.toString(), groupBy?.toString()], () => combineLatest([this.pool._shareClassIds(), this.pool.currency(), this.pool.activeNetworks()]).pipe(switchMap(([shareClassIds, poolCurrency, activeNetworks]) => this._root
            ._queryIndexer(`query ($filter: TokenInstanceSnapshotFilter) {
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
							}`, {
            filter: {
                tokenId_in: shareClassIds
                    .filter((id) => !filter.shareClassId || filter.shareClassId.equals(id))
                    .map((id) => id.toString()),
                trigger_ends_with: 'NewPeriod',
                triggerChainId: String(activeNetworks[0]?.chainId ?? this.pool.chainId),
                // TODO from/to
            },
        }, undefined, 60 * 60 * 1000)
            .pipe(map((data) => this._process(data, filter, poolCurrency))))));
    }
    /** @internal */
    _process(data, filter, poolCurrency) {
        const sharePricesByDate = {};
        data.tokenInstanceSnapshots.items.forEach((item) => {
            const date = new Date(Number(item.timestamp)).toISOString().slice(0, 10);
            if (!sharePricesByDate[date]) {
                sharePricesByDate[date] = {};
            }
            sharePricesByDate[date][item.tokenId] = {
                price: new Price(item.tokenPrice),
                totalIssuance: new Balance(item.totalIssuance, poolCurrency.decimals),
            };
        });
        const items = Object.entries(sharePricesByDate).map(([timestamp, shareClasses]) => {
            const date = new Date(timestamp);
            return {
                timestamp: date.toISOString(),
                shareClasses,
            };
        });
        return applyGrouping(items, filter.groupBy ?? 'day', 'latest');
    }
}
//# sourceMappingURL=PoolSharePricesReport.js.map