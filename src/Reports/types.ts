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
