import { processBalanceSheetData } from './balanceSheet.js'

export const processors = {
  balanceSheet: processBalanceSheetData,
} as const

export type ReportProcessorType = keyof typeof processors
