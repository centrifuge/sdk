import { PoolFeeSnapshotsByDate } from '../queries/poolFeeSnapshots.js'
import { PoolSnapshot } from '../queries/poolSnapshots.js'
import { TrancheSnapshotsByDate } from '../queries/trancheSnapshots.js'
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

export type CashflowReport = {
  type: 'cashflow'
  timestamp: string
  principalPayments: Currency
  realizedPL: Currency
  interestPayments: Currency
  assetPurchases: Currency
  netCashflowAsset: Currency // sum of cashflow from assetPurchases, principalPayments, interestPayments, realizedPL
  fees: { name: string; amount: Currency; timestamp: string; feeId: string }[]
  netCashflowAfterFees: Currency
  investments: Currency
  redemptions: Currency
  activitiesCashflow: Currency // sum of cashflow from investments and redemptions
  totalCashflow: Currency // sum of netCashflowAsset, netCashflowAfterFees and activitiesCashflow
  endCashBalance: Currency
}

export type CashflowData = {
  poolSnapshots: PoolSnapshot[]
  poolFeeSnapshots: PoolFeeSnapshotsByDate
}
