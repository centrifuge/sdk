import { AssetSnapshot } from '../entities/IndexerQueries/assetSnapshots.js'
import { AssetTransaction, AssetTransactionType } from '../entities/IndexerQueries/assetTransactions.js'
import { Epoch } from '../entities/IndexerQueries/epochs.js'
import {
  InvestorTransaction,
  SubqueryInvestorTransactionType,
} from '../entities/IndexerQueries/investorTransactions.js'
import { PoolFeeSnapshotsByDate } from '../entities/IndexerQueries/poolFeeSnapshots.js'
import { PoolFeeTransaction } from '../entities/IndexerQueries/poolFeeTransactions.js'
import { PoolSnapshot } from '../entities/IndexerQueries/poolSnapshots.js'
import { TrancheCurrencyBalance } from '../entities/IndexerQueries/trancheCurrencyBalance.js'
import { TrancheSnapshotsByDate } from '../entities/IndexerQueries/trancheSnapshots.js'
import { PoolMetadata } from '../types/poolMetadata.js'
import { Balance, Perquintill, Price, Rate } from '../utils/BigInt.js'
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
  assetValuation: Balance
  onchainReserve: Balance
  offchainCash: Balance
  accruedFees: Balance
  netAssetValue: Balance
  tranches?: {
    name: string
    timestamp: string
    tokenId: string
    tokenSupply: Balance
    tokenPrice: Price | null
    trancheValue: Balance
  }[]
  totalCapital?: Balance
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
  principalPayments: Balance
  interestPayments: Balance
  netCashflowAsset: Balance // sum of cashflow from assetAcquisitions, principalPayments, interestPayments, realizedPL
  fees: { name: string; amount: Balance; timestamp: string; feeId: string }[]
  netCashflowAfterFees: Balance
  investments: Balance
  redemptions: Balance
  activitiesCashflow: Balance // sum of cashflow from investments and redemptions
  totalCashflow: Balance // sum of netCashflowAsset, netCashflowAfterFees and activitiesCashflow
  endCashBalance: { balance: Balance }
}

export type CashflowReportPublicCredit = CashflowReportBase & {
  subtype: 'publicCredit'
  realizedPL?: Balance
  assetPurchases?: Balance
}

export type CashflowReportPrivateCredit = CashflowReportBase & {
  subtype: 'privateCredit'
  assetFinancing?: Balance
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
  profitAndLossFromAsset: Balance
  interestPayments: Balance
  otherPayments: Balance
  totalExpenses: Balance
  totalProfitAndLoss: Balance
  fees: { name: string; amount: Balance; timestamp: string; feeId: string }[]
}

export type ProfitAndLossReportPublicCredit = ProfitAndLossReportBase & {
  subtype: 'publicCredit'
  totalIncome: Balance
}

export type ProfitAndLossReportPrivateCredit = ProfitAndLossReportBase & {
  subtype: 'privateCredit'
  interestAccrued: Balance
  assetWriteOffs: Balance
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
  currencyAmount: Balance
  trancheTokenId: string
  trancheTokenAmount: Balance
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
  amount: Balance
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
  amount: Balance
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
    supply: Balance
    timestamp: string
    yieldMTD: Perquintill | null
    yieldQTD: Perquintill | null
    yieldYTD: Perquintill | null
    yield7daysAnnualized: Perquintill | null
    yield30daysAnnualized: Perquintill | null
    yield90daysAnnualized: Perquintill | null
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
  presentValue: Balance | undefined
  name: string
}

export type AssetListReportPublicCredit = {
  subtype: 'publicCredit'
  faceValue: Balance | undefined
  outstandingQuantity: Balance | undefined
  currentPrice: Price | undefined
  maturityDate: string | undefined
  unrealizedProfit: Balance | undefined
  realizedProfit: Balance | undefined
}

export type AssetListReportPrivateCredit = {
  subtype: 'privateCredit'
  outstandingPrincipal: Balance | undefined
  outstandingInterest: Balance | undefined
  repaidPrincipal: Balance | undefined
  repaidInterest: Balance | undefined
  repaidUnscheduled: Balance | undefined
  originationDate: number | undefined
  maturityDate: string | undefined
  valuationMethod: string | undefined
  advanceRate: Rate | undefined
  collateralValue: Balance | undefined
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
  position: Balance
  poolPercentage: Rate
  pendingInvest: Balance
  pendingRedeem: Balance
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
  netAssetValue: Balance
  navPerShare: Price
  lockedInvestments: Balance
  lockedRedemptions: Balance
  executedInvestments: Balance
  executedRedemptions: Balance
  paidFees: Balance
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
  currentPrice: Balance
  assetId: string
  name: string
}

export type AssetTimeSeriesReportFilter = {
  from?: string
  to?: string
  assetId?: string
  name?: string
}
