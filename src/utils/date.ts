export function getDateYearsFromNow(years: number) {
  return new Date(new Date().setFullYear(new Date().getFullYear() + years))
}

export type GroupBy = 'day' | 'month' | 'quarter' | 'year'
export function getPeriod(date: Date, groupBy: GroupBy): string | undefined {
  switch (groupBy) {
    case 'day':
      return date.toISOString().slice(0, 10)
    case 'month':
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    case 'quarter':
      const quarter = Math.floor(date.getMonth() / 3) + 1
      return `${date.getFullYear()}-Q${quarter}`
    case 'year':
      return date.getFullYear().toString()
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
