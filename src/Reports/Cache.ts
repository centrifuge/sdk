export interface CacheEntry<T> {
  data: T
  timestamp: number
}

export class Cache {
  private static cache = new Map<string, CacheEntry<any>>()
  private static TTL = 5 * 60 * 1000 // 5 minutes

  static get<T>(key: string): T | undefined {
    const entry = this.cache.get(key)
    if (!entry) return undefined

    if (Date.now() - entry.timestamp > this.TTL) {
      this.cache.delete(key)
      return undefined
    }

    return entry.data
  }

  static set<T>(key: string, data: T): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    })
  }

  static generateKey(parts: (string | undefined)[]): string {
    return parts.filter(Boolean).join(':')
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
