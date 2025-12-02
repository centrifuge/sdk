export declare function getDateYearsFromNow(years: number): Date;
export type GroupBy = 'day' | 'month' | 'quarter' | 'year';
export declare function getPeriod(date: Date, groupBy: GroupBy): string | undefined;
/**
 * Group data by period and return the latest item or all items in the period
 * @param data - Data to group
 * @param groupBy - Period to group by
 * @param strategy - 'latest' returns the latest item in the period, 'all' returns all items in the period
 * @returns Grouped data
 */
export declare function groupByPeriod<T extends {
    timestamp: string;
}>(data: T[], groupBy: GroupBy, strategy: 'all'): T[][];
export declare function groupByPeriod<T extends {
    timestamp: string;
}>(data: T[], groupBy: GroupBy, strategy?: 'latest'): T[];
//# sourceMappingURL=date.d.ts.map