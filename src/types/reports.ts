import { AssetSnapshot } from '../IndexerQueries/assetSnapshots.js'
import { AssetTransaction, AssetTransactionType } from '../IndexerQueries/assetTransactions.js'
import { InvestorTransaction, SubqueryInvestorTransactionType } from '../IndexerQueries/investorTransactions.js'
import { PoolFeeSnapshotsByDate } from '../IndexerQueries/poolFeeSnapshots.js'
import { PoolFeeTransaction } from '../IndexerQueries/poolFeeTransactions.js'
import { PoolSnapshot } from '../IndexerQueries/poolSnapshots.js'
import { TrancheCurrencyBalance } from '../IndexerQueries/trancheCurrencyBalance.js'
import { TrancheSnapshotsByDate } from '../IndexerQueries/trancheSnapshots.js'
import { PoolMetadata } from '../types/poolMetadata.js'
import { Price, Rate, Token } from '../utils/BigInt.js'
import { Currency } from '../utils/BigInt.js'
import { GroupBy } from '../utils/date.js'

export interface ReportFilter {
  from?: string
  to?: string
  groupBy?: GroupBy
}

export type DataReportFilter = {
  to?: string
  from?: string
}

export type Report = 'balanceSheet' | 'cashflow' | 'profitAndLoss'
export type DataReport =
  | 'investorTransactions'
  | 'assetTransactions'
  | 'feeTransactions'
  | 'tokenPrice'
  | 'assetList'
  | 'investorList'

/**
 * Balance sheet type
 */
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

/**
 * Cashflow types
 */
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

/**
 * Profit and loss types
 */
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

/**
 * Investor transactions types
 */
export type InvestorTransactionsData = {
  investorTransactions: InvestorTransaction[]
}

export type InvestorTransactionsReport = {
  type: 'investorTransactions'
  timestamp: string
  chainId: number | 'centrifuge'
  account: string
  epoch: string
  transactionType: SubqueryInvestorTransactionType
  currencyAmount: Currency
  trancheTokenId: string
  trancheTokenAmount: Currency
  price: Price
  transactionHash: string
}

export type InvestorTransactionsReportFilter = {
  tokenId?: string
  transactionType?: 'orders' | 'executions' | 'transfers' | 'all'
  network?: number | 'centrifuge' | 'all'
  address?: string
  to?: string
  from?: string
}

/**
 * Asset transactions types
 */
export type AssetTransactionsData = {
  assetTransactions: AssetTransaction[]
}

export type AssetTransactionReport = {
  type: 'assetTransactions'
  timestamp: string
  assetId: string
  epoch: string
  transactionType: AssetTransactionType
  amount: Currency
  transactionHash: string
}

export type AssetTransactionReportFilter = {
  from?: string
  to?: string
  assetId?: string
  transactionType?: 'created' | 'financed' | 'repaid' | 'priced' | 'closed' | 'cashTransfer' | 'all'
}

/**
 * Fee transactions types
 */
export type FeeTransactionsData = {
  poolFeeTransactions: PoolFeeTransaction[]
}

export type FeeTransactionReport = {
  type: 'feeTransactions'
  timestamp: string
  feeId: string
  amount: Currency
}

export type FeeTransactionReportFilter = {
  from?: string
  to?: string
  transactionType?: 'directChargeMade' | 'directChargeCanceled' | 'accrued' | 'paid' | 'all'
}

/**
 * Token price types
 */
export type TokenPriceData = {
  trancheSnapshots: TrancheSnapshotsByDate
}

export type TokenPriceReport = {
  type: 'tokenPrice'
  timestamp: string
  tranches: { id: string; price: Price; supply: Token; timestamp: string }[]
}

export type TokenPriceReportFilter = {
  from?: string
  to?: string
  groupBy?: GroupBy
}

/**
 * Asset list types
 */
export type AssetListData = {
  assetSnapshots: AssetSnapshot[]
  metadata: PoolMetadata | undefined
}

export type AssetListReportBase = {
  type: 'assetList'
  timestamp: string
  assetId: string
  presentValue: Currency | undefined
}

export type AssetListReportPublicCredit = {
  subtype: 'publicCredit'
  faceValue: Currency | undefined
  outstandingQuantity: Currency | undefined
  currentPrice: Price | undefined
  maturityDate: string | undefined
  unrealizedProfit: Currency | undefined
  realizedProfit: Currency | undefined
}

export type AssetListReportPrivateCredit = {
  subtype: 'privateCredit'
  outstandingPrincipal: Currency | undefined
  outstandingInterest: Currency | undefined
  repaidPrincipal: Currency | undefined
  repaidInterest: Currency | undefined
  repaidUnscheduled: Currency | undefined
  originationDate: number | undefined
  maturityDate: string | undefined
  valuationMethod: string | undefined
  advanceRate: Rate | undefined
  collateralValue: Currency | undefined
  probabilityOfDefault: Rate | undefined
  lossGivenDefault: Rate | undefined
  discountRate: Rate | undefined
}

export type AssetListReport = AssetListReportBase & (AssetListReportPublicCredit | AssetListReportPrivateCredit)

export type AssetListReportFilter = {
  from?: string
  to?: string
  status?: 'ongoing' | 'repaid' | 'overdue' | 'all'
}

/**
 * Investor list types
 */
export type InvestorListData = {
  trancheCurrencyBalance: TrancheCurrencyBalance[]
}
export type InvestorListReport = {
  type: 'investorList'
  chainId: number | 'centrifuge' | 'all'
  accountId: string
  evmAddress?: string
  position: Currency
  poolPercentage: Rate
  pendingInvest: Currency
  pendingRedeem: Currency
}

export type InvestorListReportFilter = {
  from?: string
  to?: string
  trancheId?: string
  network?: number | 'centrifuge' | 'all'
  address?: string
}
