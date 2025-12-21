import { Balance, Price } from '../../utils/BigInt.js';
import { groupByPeriod } from '../../utils/date.js';
/**
 * Apply grouping to a report.
 * @param items Report items
 * @param filter Optional filtering and grouping options
 * @param strategy Grouping strategy, sum aggregates data by period, latest returns the latest item in the period
 * @returns Grouped report
 *
 * Note: if strategy is 'sum', only Decimal values that are not nested are aggregated, all
 * other values are overwritten with the last value in the period
 */
export function applyGrouping(items, groupBy = 'day', strategy = 'latest') {
    if (strategy === 'latest') {
        return groupByPeriod(items, groupBy, 'latest');
    }
    const groups = groupByPeriod(items, groupBy, 'all');
    return groups.map((group) => {
        const base = { ...group[group.length - 1] };
        // Aggregate Decimal values
        for (const key in base) {
            const value = base[key];
            if (value instanceof Balance) {
                base[key] = group.reduce((sum, item) => sum.add(item[key]), new Balance(0n, value.decimals));
            }
            if (value instanceof Price) {
                base[key] = group.reduce((sum, item) => sum.add(item[key]), new Price(0n));
            }
        }
        return base;
    });
}
export function getDateKey(timestamp, groupBy) {
    switch (groupBy) {
        case 'month':
            return timestamp.slice(0, 7); // YYYY-MM
        case 'quarter':
            const date = new Date(timestamp);
            const quarter = Math.floor(date.getMonth() / 3) + 1;
            return `${date.getFullYear()}-Q${quarter}`; // YYYY-Q#
        case 'year':
            return timestamp.slice(0, 4); // YYYY
        default:
            return timestamp.slice(0, 10); // YYYY-MM-DD
    }
}
//# sourceMappingURL=utils.js.map