import { balanceSheetProcessor } from './balanceSheet.js'

export const processors = {
  balanceSheet: balanceSheetProcessor,
} as const

export type ReportProcessorType = keyof typeof processors
