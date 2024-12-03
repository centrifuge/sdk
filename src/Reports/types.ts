import { PoolFeeSnapshotsByDate } from '../queries/poolFeeSnapshots.js'
import { PoolSnapshot } from '../queries/poolSnapshots.js'
import { TrancheSnapshotsByDate } from '../queries/trancheSnapshots.js'
import { PoolMetadata } from '../types/poolMetadata.js'
import { Price } from '../utils/BigInt.js'
import { Currency } from '../utils/BigInt.js'
import { GroupBy } from '../utils/date.js'

export interface ReportFilter {
  from?: string
  to?: string
  groupBy?: GroupBy
}

export type BalanceSheetReport = {
  type: 'balanceSheet'
  timestamp: string
  assetValuation: Currency
  onchainReserve: Currency
  offchainCash: Currency
  accruedFees: Currency
  netAssetValue: Currency
  tranches?: {
    name: string
    timestamp: string
    tokenId: string
    tokenSupply: Currency
    tokenPrice: Price | null
    trancheValue: Currency
  }[]
  totalCapital?: Currency
}

export type BalanceSheetData = {
  poolSnapshots: PoolSnapshot[]
  trancheSnapshots: TrancheSnapshotsByDate
}

type CashflowReportBase = {
  type: 'cashflow'
  timestamp: string
  principalPayments: Currency
  interestPayments: Currency
  netCashflowAsset: Currency // sum of cashflow from assetAcquisitions, principalPayments, interestPayments, realizedPL
  fees: { name: string; amount: Currency; timestamp: string; feeId: string }[]
  netCashflowAfterFees: Currency
  investments: Currency
  redemptions: Currency
  activitiesCashflow: Currency // sum of cashflow from investments and redemptions
  totalCashflow: Currency // sum of netCashflowAsset, netCashflowAfterFees and activitiesCashflow
  endCashBalance: { balance: Currency }
}

type CashflowReportPublicCredit = CashflowReportBase & {
  subtype: 'publicCredit'
  realizedPL?: Currency
  assetPurchases?: Currency
}

type CashflowReportPrivateCredit = CashflowReportBase & {
  subtype: 'privateCredit'
  assetFinancing?: Currency
}

export type CashflowReport = CashflowReportPublicCredit | CashflowReportPrivateCredit

export type CashflowData = {
  poolSnapshots: PoolSnapshot[]
  poolFeeSnapshots: PoolFeeSnapshotsByDate
  metadata: PoolMetadata | undefined
}

export type ProfitAndLossReportBase = {
  type: 'profitAndLoss'
  timestamp: string
  profitAndLossFromAsset: Currency
  interestPayments: Currency
  otherPayments: Currency
  totalExpenses: Currency
  totalProfitAndLoss: Currency
  fees: { name: string; amount: Currency; timestamp: string; feeId: string }[]
}

export type ProfitAndLossReportPublicCredit = ProfitAndLossReportBase & {
  subtype: 'publicCredit'
  totalIncome: Currency
}

export type ProfitAndLossReportPrivateCredit = ProfitAndLossReportBase & {
  subtype: 'privateCredit'
  interestAccrued: Currency
  assetWriteOffs: Currency
}

export type ProfitAndLossReport = ProfitAndLossReportPublicCredit | ProfitAndLossReportPrivateCredit

export type ProfitAndLossData = {
  poolSnapshots: PoolSnapshot[]
  poolFeeSnapshots: PoolFeeSnapshotsByDate
  metadata: PoolMetadata | undefined
}
