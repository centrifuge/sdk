import { Balance, Price } from '../../utils/BigInt.js';
import { DataReportFilter } from './types.js';
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
export declare function applyGrouping<T extends {
    timestamp: string;
    [key: string]: Balance | Price | string | number | undefined | any[] | {
        [key: string]: any;
    };
}>(items: T[], groupBy?: DataReportFilter['groupBy'], strategy?: 'latest' | 'sum'): T[];
export declare function getDateKey(timestamp: string, groupBy?: DataReportFilter['groupBy']): string;
//# sourceMappingURL=utils.d.ts.map