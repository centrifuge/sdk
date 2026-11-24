import { Balance, Price } from '../../utils/BigInt.js'
import { groupByPeriod, snapshotInstant } from '../../utils/date.js'
import { DataReportFilter } from './types.js'

/**
 * The UTC day (`YYYY-MM-DD`) a snapshot row's `timestamp` falls on.
 *
 * Accepts BOTH spellings the two transports use for the same column, which is
 * what lets `sharePricesReport` and `shareYieldsReport` be served by either
 * one:
 *
 * - **Millisecond epoch**, a decimal string — api-v3's form, and what the
 *   graphql adapter has always returned. Parsed exactly as before
 *   (`new Date(Number(...))`), so public mode's output is unchanged.
 * - **ISO-8601 UTC** — the backend REST endpoint's form (`queries/sql` calls
 *   `Date.toISOString()`) and also what public-api's PostGraphile returns for
 *   the same `timestamptz` column, as `…000000+00:00` (six fraction digits and an offset).
 *
 * Before this widening the ISO form made `Number(...)` `NaN` and
 * `.toISOString()` threw `RangeError: Invalid time value`. That was the GOOD
 * failure mode — loud rather than misdated — and the rule this function keeps:
 * anything it cannot place on a specific UTC day throws with the value in the
 * message, and nothing is ever bucketed by guess.
 *
 * @param timestamp The row's `timestamp`, in either spelling.
 * @param entry The catalogue entry the row came from, for the error message.
 * @returns The UTC calendar day, `YYYY-MM-DD`.
 * @throws If the value is neither spelling, or names no real instant.
 */
export function snapshotDay(timestamp: string, entry: string): string {
  return snapshotInstant(timestamp, entry).toISOString().slice(0, 10)
}

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
export function applyGrouping<
  T extends {
    timestamp: string
    [key: string]: Balance | Price | string | number | undefined | any[] | { [key: string]: any }
  },
>(items: T[], groupBy: DataReportFilter['groupBy'] = 'day', strategy: 'latest' | 'sum' = 'latest'): T[] {
  if (strategy === 'latest') {
    return groupByPeriod<T>(items, groupBy, 'latest')
  }

  const groups = groupByPeriod<T>(items, groupBy, 'all')
  return groups.map((group) => {
    const base = { ...group[group.length - 1] } as T

    // Aggregate Decimal values
    for (const key in base) {
      const value = base[key as keyof T]
      if (value instanceof Balance) {
        base[key as keyof T] = group.reduce(
          (sum, item) => sum.add(item[key as keyof T] as Balance),
          new Balance(0n, value.decimals)
        ) as T[keyof T]
      }
      if (value instanceof Price) {
        base[key as keyof T] = group.reduce(
          (sum, item) => sum.add(item[key as keyof T] as Price),
          new Price(0n)
        ) as T[keyof T]
      }
    }

    return base
  })
}

export function getDateKey(timestamp: string, groupBy?: DataReportFilter['groupBy']): string {
  switch (groupBy) {
    case 'month':
      return timestamp.slice(0, 7) // YYYY-MM
    case 'quarter':
      const date = new Date(timestamp)
      const quarter = Math.floor(date.getMonth() / 3) + 1
      return `${date.getFullYear()}-Q${quarter}` // YYYY-Q#
    case 'year':
      return timestamp.slice(0, 4) // YYYY
    default:
      return timestamp.slice(0, 10) // YYYY-MM-DD
  }
}
