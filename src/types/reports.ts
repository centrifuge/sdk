import { AssetSnapshot } from '../IndexerQueries/assetSnapshots.js'
import { AssetTransaction, AssetTransactionType } from '../IndexerQueries/assetTransactions.js'
import { Epoch } from '../IndexerQueries/epochs.js'
import { InvestorTransaction, SubqueryInvestorTransactionType } from '../IndexerQueries/investorTransactions.js'
import { PoolFeeSnapshotsByDate } from '../IndexerQueries/poolFeeSnapshots.js'
import { PoolFeeTransaction } from '../IndexerQueries/poolFeeTransactions.js'
import { PoolSnapshot } from '../IndexerQueries/poolSnapshots.js'
import { TrancheCurrencyBalance } from '../IndexerQueries/trancheCurrencyBalance.js'
import { TrancheSnapshotsByDate } from '../IndexerQueries/trancheSnapshots.js'
import { PoolMetadata } from '../types/poolMetadata.js'
import { Currency, Perquintill, Price, Rate, Token } from '../utils/BigInt.js'
import { GroupBy } from '../utils/date.js'

export type ReportFilter = {
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
  | 'ordersList'
  | 'assetTimeSeries'
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
export type CashflowReportBase = {
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

export type CashflowReportPublicCredit = CashflowReportBase & {
  subtype: 'publicCredit'
  realizedPL?: Currency
  assetPurchases?: Currency
}

export type CashflowReportPrivateCredit = CashflowReportBase & {
  subtype: 'privateCredit'
  assetFinancing?: Currency
}

export type CashflowReport = CashflowReportPublicCredit | CashflowReportPrivateCredit

export type CashflowData = {
  poolSnapshots: PoolSnapshot[]
  poolFeeSnapshots: PoolFeeSnapshotsByDate
  metadata: PoolMetadata | undefined | null
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
  metadata: PoolMetadata | undefined | null
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
  name: string
  principalAmount: Currency | null
  interestAmount: Currency | null
  transactionHash: string
  fromAsset?: {
    id: string
    name: string
  }
  toAsset?: {
    id: string
    name: string
  }
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
  amount: Currency | null
  transactionType: PoolFeeTransaction['type']
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
  tranches: {
    id: string
    price: Price
    supply: Token
    timestamp: string
    yieldMTD: Perquintill | null
    yieldQTD: Perquintill | null
    yieldYTD: Perquintill | null
    yield7daysAnnualized: Perquintill | null
    yield30daysAnnualized: Perquintill | null
    yield90daysAnnualized: Perquintill | null
    yieldSinceInception: Perquintill | null
  }[]
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
  metadata: PoolMetadata | undefined | null
}

export type AssetListReportBase = {
  type: 'assetList'
  timestamp: string
  assetId: string
  presentValue: Currency | undefined
  name: string
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
  trancheId: string
}

export type InvestorListReportFilter = {
  from?: string
  to?: string
  trancheId?: string
  network?: number | 'centrifuge' | 'all'
  address?: string
}

/**
 * Orders list types
 */
export type OrdersListData = {
  poolEpochs: Epoch[]
}
export type OrdersListReport = {
  type: 'ordersList'
  epoch: string
  timestamp: string
  netAssetValue: Currency
  navPerShare: Price
  lockedInvestments: Currency
  lockedRedemptions: Currency
  executedInvestments: Currency
  executedRedemptions: Currency
  paidFees: Currency
}

export type OrdersListReportFilter = {
  from?: string
  to?: string
}

/**
 * Asset time series types
 */
export type AssetTimeSeriesData = {
  assetSnapshots: AssetSnapshot[]
}
export type AssetTimeSeriesReport = {
  type: 'assetTimeSeries'
  timestamp: string
  currentPrice: Currency
  assetId: string
  name: string
}

export type AssetTimeSeriesReportFilter = {
  from?: string
  to?: string
  assetId?: string
  name?: string
}
