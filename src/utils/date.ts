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

export function groupByPeriod<T extends { timestamp: string }>(data: T[], groupBy: GroupBy): T[] {
  const grouped = new Map<string, T>()

  data.forEach((item) => {
    const period = getPeriod(new Date(item.timestamp), groupBy)
    if (!period) return

    if (!grouped.has(period) || new Date(item.timestamp) > new Date(grouped.get(period)!.timestamp)) {
      grouped.set(period, item)
    }
  })

  return Array.from(grouped.values())
}
