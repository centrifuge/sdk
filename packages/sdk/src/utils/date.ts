export function getDateYearsFromNow(years: number) {
  return new Date(new Date().setFullYear(new Date().getFullYear() + years))
}

export type GroupBy = 'day' | 'month' | 'quarter' | 'year'
export function getPeriod(date: Date, groupBy: GroupBy): string | undefined {
  switch (groupBy) {
    case 'day':
      return date.toISOString().slice(0, 10)
    case 'month':
      const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
      return `${utcDate.getUTCFullYear()}-${String(utcDate.getUTCMonth() + 1).padStart(2, '0')}`
    case 'quarter':
      const quarter = Math.floor(date.getUTCMonth() / 3) + 1
      return `${date.getUTCFullYear()}-Q${quarter}`
    case 'year':
      return date.getUTCFullYear().toString()
    default:
      return undefined
  }
}

/**
 * Group data by period and return the latest item or all items in the period
 * @param data - Data to group
 * @param groupBy - Period to group by
 * @param strategy - 'latest' returns the latest item in the period, 'all' returns all items in the period
 * @returns Grouped data
 */
export function groupByPeriod<T extends { timestamp: string }>(data: T[], groupBy: GroupBy, strategy: 'all'): T[][]
export function groupByPeriod<T extends { timestamp: string }>(data: T[], groupBy: GroupBy, strategy?: 'latest'): T[]
export function groupByPeriod<T extends { timestamp: string }>(
  data: T[],
  groupBy: GroupBy,
  strategy: 'latest' | 'all' = 'latest'
): T[] | T[][] {
  const grouped = new Map<string, T[]>()

  data.forEach((item) => {
    const period = getPeriod(new Date(item.timestamp), groupBy)
    if (!period) return

    if (!grouped.has(period)) {
      grouped.set(period, [])
    }
    grouped.get(period)!.push(item)

    // Sort by timestamp within each group
    grouped.get(period)!.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
  })

  return strategy === 'latest'
    ? Array.from(grouped.values()).map((group) => group[group.length - 1] as T)
    : Array.from(grouped.values())
}

/** A whole number of milliseconds since the unix epoch, as api-v3 spells it. */
const MS_EPOCH = /^-?\d+$/

/**
 * ISO-8601 with an EXPLICIT UTC designator or numeric offset, or the date-only
 * form.
 *
 * The offset is REQUIRED for a datetime, and that is the point of the pattern
 * rather than an incidental strictness: `new Date('2026-01-02T00:30:00')` is
 * parsed in the runtime's LOCAL zone, so the same row would land on 2026-01-01
 * in Berlin and on 2026-01-02 in London. A date bucket that depends on where
 * the process runs is the plausible-wrong-value this whole widening exists to
 * avoid, so an offset-less datetime is refused instead of guessed at. The
 * date-only form is safe: ECMA-262 defines it as UTC.
 */
const ISO_UTC = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2}))?$/

/**
 * The instant an ISO-8601 timestamp names, or null for anything else: a datetime without an offset, a number, text.
 * The public API writes a `timestamptz` as `2026-01-30T12:27:00.000000+00:00`, six fraction digits and an offset.
 */
export function isoInstant(timestamp: string): Date | null {
  if (!ISO_UTC.test(timestamp)) return null
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * The instant a snapshot row's `timestamp` names, accepting the two spellings the transports use for the same column
 * (a millisecond epoch, or ISO-8601 with an offset, see {@link isoInstant}) and refusing anything else.
 *
 * @param timestamp The row's `timestamp`, in either spelling.
 * @param entry The catalogue entry the row came from, for the error message.
 * @throws If the value is neither spelling, or names no real instant.
 */
export function snapshotInstant(timestamp: string, entry: string): Date {
  const date = MS_EPOCH.test(timestamp) ? new Date(Number(timestamp)) : isoInstant(timestamp)
  if (date === null || Number.isNaN(date.getTime())) {
    throw new Error(
      `The "${entry}" entry returned a row whose timestamp ${JSON.stringify(timestamp)} is neither a ` +
        `millisecond-epoch decimal string (api-v3's spelling) nor an ISO-8601 instant with an explicit ` +
        `UTC offset (the backend's and public-api's). Refusing to guess a day for it: a snapshot bucketed ` +
        `on the wrong date reports the wrong NAV for both days.`
    )
  }
  return date
}
