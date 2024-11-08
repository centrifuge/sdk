import { ReportData, ReportFilter, ReportProcessor } from './types.js'

export class ReportService {
  private static cache = new Map<string, { data: any; timestamp: number }>()
  private static TTL = 5 * 60 * 1000 // 5 minutes

  static async generate<Data, Report extends ReportData>(
    processor: ReportProcessor<Data, Report>,
    poolId: string,
    data: Data,
    filter?: ReportFilter
  ): Promise<Report[]> {
    const cacheKey = processor.getCacheKey(poolId, filter)
    const cached = this.getFromCache<Report[]>(cacheKey)
    if (cached) return cached

    const result = processor.process(data, filter)
    this.setInCache(cacheKey, result)
    return result
  }

  private static getFromCache<T>(key: string): T | undefined {
    const entry = this.cache.get(key)
    if (!entry) return undefined

    if (Date.now() - entry.timestamp > this.TTL) {
      this.cache.delete(key)
      return undefined
    }

    return entry.data
  }

  private static setInCache(key: string, data: any): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    })
  }

  static cleanup(): void {
    const now = Date.now()
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.TTL) {
        this.cache.delete(key)
      }
    }
  }
}
