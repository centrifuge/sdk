import { GroupBy } from '../utils/date.js'

export interface ReportFilter {
  from?: string
  to?: string
  groupBy?: GroupBy
}

export interface ReportData {
  timestamp: string
  [key: string]: unknown
}

export interface ReportProcessor<Data, Report extends ReportData> {
  process(data: Data, filter?: ReportFilter): Report[]
  getCacheKey(poolId: string, filter?: ReportFilter): string
}
