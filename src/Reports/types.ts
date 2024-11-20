import { PoolSnapshot } from '../queries/poolSnapshots.js'
import { TrancheSnapshot } from '../queries/trancheSnapshots.js'
import { Price } from '../utils/BigInt.js'
import { Currency } from '../utils/BigInt.js'
import { GroupBy } from '../utils/date.js'

export interface ReportFilter {
  from?: string
  to?: string
  groupBy?: GroupBy
}

export interface BalanceSheetReport {
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
  trancheSnapshots: TrancheSnapshot[]
}
