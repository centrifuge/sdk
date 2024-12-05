import { AssetTransaction } from '../queries/assetTransactions.js'
import { InvestorTransaction } from '../queries/investorTransactions.js'
import { Currency, Price, Token } from '../utils/BigInt.js'
import { groupByPeriod } from '../utils/date.js'
import {
  BalanceSheetData,
  BalanceSheetReport,
  CashflowData,
  CashflowReport,
  ProfitAndLossReport,
  ProfitAndLossData,
  ReportFilter,
  InvestorTransactionsData,
  InvestorTransactionsReport,
  InvestorTransactionsReportFilter,
  AssetTransactionReport,
  AssetTransactionsData,
  AssetTransactionReportFilter,
  FeeTransactionsData,
  FeeTransactionReportFilter,
  FeeTransactionReport,
  TokenPriceReport,
  TokenPriceReportFilter,
  TokenPriceData,
} from '../types/reports.js'

export class Processor {
  /**
   * Process raw data into a balance sheet report
   * @param data Pool and tranche snapshot data
   * @param filter Optional filtering and grouping options
   * @returns Processed balance sheet report at the end of each period
   */
  balanceSheet(data: BalanceSheetData, filter?: Omit<ReportFilter, 'to' | 'from'>): BalanceSheetReport[] {
    const items: BalanceSheetReport[] = data?.poolSnapshots?.map((snapshot) => {
      const tranches = data.trancheSnapshots[this.getDateKey(snapshot.timestamp)] ?? []
      if (tranches.length === 0) throw new Error('No tranches found for snapshot')
      return {
        type: 'balanceSheet',
        timestamp: snapshot.timestamp,
        assetValuation: snapshot.portfolioValuation,
        onchainReserve: snapshot.totalReserve,
        offchainCash: snapshot.offchainCashValue,
        accruedFees: snapshot.sumPoolFeesPendingAmount,
        netAssetValue: snapshot.netAssetValue,
        tranches: tranches?.map((tranche) => ({
          name: tranche.pool.currency.symbol,
          timestamp: tranche.timestamp,
          tokenId: tranche.trancheId,
          tokenSupply: tranche.tokenSupply,
          tokenPrice: tranche.price,
          trancheValue: tranche.tokenSupply.mul(tranche?.price?.toBigInt() ?? 0n),
        })),
        totalCapital: tranches.reduce(
          (acc, curr) => acc.add(curr.tokenSupply.mul(curr?.price?.toBigInt() ?? 0n).toBigInt()),
          new Currency(0, snapshot.poolCurrency.decimals)
        ),
      }
    })
    return this.applyGrouping<BalanceSheetReport>(items, filter?.groupBy, 'latest')
  }

  /**
   * Process raw data into an aggregated cashflow report, fees and endCashBalance are NOT aggregated by period
   * @param data Pool snapshot data
   * @param filter Optional filtering and grouping options
   * @returns Processed cashflow report at the end of each period
   */
  cashflow(data: CashflowData, filter?: Omit<ReportFilter, 'to' | 'from'>): CashflowReport[] {
    const subtype = data.metadata?.pool.asset.class === 'Public credit' ? 'publicCredit' : 'privateCredit'
    const items: CashflowReport[] = data.poolSnapshots.map((day) => {
      const poolFees =
        data.poolFeeSnapshots[this.getDateKey(day.timestamp)]?.map((fee) => ({
          name: fee.poolFee.name,
          amount: fee.sumPaidAmountByPeriod,
          timestamp: fee.timestamp,
          feeId: fee.poolFeeId.split('-')[1] ?? '',
        })) ?? []
      const principalRepayments = day.sumPrincipalRepaidAmountByPeriod
      const interest = day.sumInterestRepaidAmountByPeriod.add(day.sumUnscheduledRepaidAmountByPeriod)
      const acquisistions = day.sumBorrowedAmountByPeriod
      const fees = day.sumPoolFeesPaidAmountByPeriod
      const netCashflowAsset = principalRepayments.sub(acquisistions).add(interest)
      const investments = day.sumInvestedAmountByPeriod
      const redemptions = day.sumRedeemedAmountByPeriod
      const activitiesCashflow = investments.sub(redemptions)
      const netCashflowAfterFees = netCashflowAsset.sub(fees)
      const totalCashflow = netCashflowAfterFees.add(activitiesCashflow)
      return {
        type: 'cashflow',
        subtype,
        timestamp: day.timestamp,
        principalPayments: principalRepayments,
        ...(subtype === 'publicCredit' && { realizedPL: day.sumRealizedProfitFifoByPeriod }),
        interestPayments: interest,
        ...(subtype === 'privateCredit' ? { assetFinancing: acquisistions } : { assetPurchases: acquisistions }),
        netCashflowAsset,
        fees: poolFees,
        netCashflowAfterFees,
        investments,
        redemptions,
        activitiesCashflow,
        totalCashflow,
        endCashBalance: { balance: day.totalReserve.add(day.offchainCashValue) },
      }
    })
    return this.applyGrouping<CashflowReport>(items, filter?.groupBy, 'sum')
  }

  /**
   * Process raw data into an aggregated profit and loss report, fees and endCashBalance are NOT aggregated by period
   * @param data Pool snapshot data
   * @param filter Optional filtering and grouping options
   * @returns Processed profit and loss report at the end of each period
   */
  profitAndLoss(data: ProfitAndLossData, filter?: Omit<ReportFilter, 'to' | 'from'>): ProfitAndLossReport[] {
    const items: ProfitAndLossReport[] = data.poolSnapshots.map((day) => {
      const subtype = data.metadata?.pool.asset.class === 'Public credit' ? 'publicCredit' : 'privateCredit'
      const profitAndLossFromAsset =
        subtype === 'publicCredit'
          ? day.sumUnrealizedProfitByPeriod
          : day.sumInterestRepaidAmountByPeriod
              .add(day.sumInterestAccruedByPeriod)
              .add(day.sumDebtWrittenOffByPeriod)
              .sub(day.sumUnscheduledRepaidAmountByPeriod)
      const interestPayments = day.sumInterestRepaidAmountByPeriod
      const otherPayments = day.sumUnscheduledRepaidAmountByPeriod
      const totalIncome = profitAndLossFromAsset.add(interestPayments).add(otherPayments)
      const fees =
        data.poolFeeSnapshots[this.getDateKey(day.timestamp)]?.map((fee) => ({
          name: fee.poolFee.name,
          amount: fee.sumAccruedAmountByPeriod.add(fee.sumChargedAmountByPeriod),
          timestamp: fee.timestamp,
          feeId: fee.poolFeeId.split('-')[1] ?? '',
        })) ?? []
      const totalExpenses = day.sumPoolFeesChargedAmountByPeriod.sub(day.sumPoolFeesAccruedAmountByPeriod)
      const totalProfitAndLoss = totalIncome.sub(totalExpenses)
      return {
        type: 'profitAndLoss',
        subtype,
        timestamp: day.timestamp,
        profitAndLossFromAsset,
        interestPayments,
        ...(subtype === 'privateCredit' && { interestAccrued: day.sumInterestAccruedByPeriod }),
        ...(subtype === 'privateCredit' && { assetWriteOffs: day.sumDebtWrittenOffByPeriod }),
        otherPayments,
        ...(subtype === 'publicCredit' && { totalIncome }),
        fees,
        totalExpenses,
        totalProfitAndLoss,
      } as ProfitAndLossReport
    })
    return this.applyGrouping<ProfitAndLossReport>(items, filter?.groupBy, 'sum')
  }

  investorTransactions(
    data: InvestorTransactionsData,
    filter?: Omit<InvestorTransactionsReportFilter, 'to' | 'from'>
  ): InvestorTransactionsReport[] {
    if (!data.investorTransactions?.length) return []

    const validTypes: Set<InvestorTransaction['type']> = new Set([
      'INVEST_ORDER_UPDATE',
      'REDEEM_ORDER_UPDATE',
      'INVEST_ORDER_CANCEL',
      'REDEEM_ORDER_CANCEL',
      'INVEST_EXECUTION',
      'REDEEM_EXECUTION',
      'INVEST_COLLECT',
      'REDEEM_COLLECT',
      'INVEST_LP_COLLECT',
      'REDEEM_LP_COLLECT',
      'TRANSFER_IN',
      'TRANSFER_OUT',
    ])

    const filterAddress = filter?.address?.toLowerCase()
    const filterNetwork = filter?.network === 'all' ? null : filter?.network

    return data.investorTransactions.reduce<InvestorTransactionsReport[]>((acc, day) => {
      const typeMatches =
        (filter?.transactionType === 'orders' && day.type.includes('ORDER')) ||
        (filter?.transactionType === 'executions' && day.type.includes('EXECUTION')) ||
        (filter?.transactionType === 'transfers' && (day.type.includes('COLLECT') || day.type.includes('TRANSFER'))) ||
        ((!filter?.transactionType || filter?.transactionType === 'all') && validTypes.has(day.type))

      const filterMatches =
        (!filterNetwork || filterNetwork === (day.chainId || 'centrifuge')) &&
        (!filter?.tokenId || filter.tokenId === day.trancheId) &&
        (!filterAddress ||
          day.accountId.toLowerCase() === filterAddress ||
          day.evmAddress?.toLowerCase() === filterAddress)

      if (typeMatches && filterMatches) {
        acc.push({
          type: 'investorTransactions',
          timestamp: day.timestamp.toISOString(),
          chainId: day.chainId,
          account: day.evmAddress ?? day.accountId,
          epoch: day.epochNumber?.toString() ?? '',
          transactionType: day.type,
          currencyAmount: day.currencyAmount,
          trancheTokenAmount: day.tokenAmount,
          trancheTokenId: day.trancheId,
          price: day.tokenPrice ?? '',
          transactionHash: day.hash,
        })
      }

      return acc
    }, [])
  }

  assetTransactions(
    data: AssetTransactionsData,
    filter?: Omit<AssetTransactionReportFilter, 'to' | 'from'>
  ): AssetTransactionReport[] {
    const typeMap: Record<
      NonNullable<Exclude<AssetTransactionReportFilter['transactionType'], 'all'>>,
      AssetTransaction['type']
    > = {
      created: 'CREATED',
      financed: 'BORROWED',
      repaid: 'REPAID',
      priced: 'PRICED',
      closed: 'CLOSED',
      cashTransfer: 'CASH_TRANSFER',
    } as const

    return data.assetTransactions.reduce<AssetTransactionReport[]>((acc, tx) => {
      const typeMatches =
        !filter?.transactionType || filter.transactionType === 'all' || tx.type === typeMap[filter.transactionType]

      const assetMatches = !filter?.assetId || filter.assetId === tx.asset.id.split('-')[1]

      if (typeMatches && assetMatches) {
        acc.push({
          type: 'assetTransactions',
          timestamp: tx.timestamp.toISOString(),
          assetId: tx.asset.id,
          epoch: tx.epochId,
          transactionType: tx.type,
          amount: tx.amount,
          transactionHash: tx.hash,
        })
      }

      return acc
    }, [])
  }

  feeTransactions(
    data: FeeTransactionsData,
    filter?: Omit<FeeTransactionReportFilter, 'to' | 'from'>
  ): FeeTransactionReport[] {
    return data.poolFeeTransactions.reduce<FeeTransactionReport[]>((acc, tx) => {
      if (!filter?.transactionType || filter.transactionType === 'all' || filter.transactionType === tx.type) {
        acc.push({
          type: 'feeTransactions',
          timestamp: tx.timestamp,
          feeId: tx.feeId,
          amount: tx.amount,
        })
      }
      return acc
    }, [])
  }

  tokenPrice(data: TokenPriceData, filter?: Omit<TokenPriceReportFilter, 'to' | 'from'>): TokenPriceReport[] {
    const items = Object.entries(data.trancheSnapshots).map(([timestamp, snapshots]) => ({
      type: 'tokenPrice' as const,
      timestamp: timestamp,
      tranches: snapshots.map((snapshot) => ({
        timestamp: snapshot.timestamp,
        name: snapshot.pool.currency.symbol,
        price: snapshot.price ?? new Price(0n),
        supply: snapshot.tokenSupply,
      })),
    }))

    return groupByPeriod<TokenPriceReport>(items, filter?.groupBy ?? 'day', 'latest')
  }

  /**
   * Apply grouping to a report.
   * @param items Report items
   * @param filter Optional filtering and grouping options
   * @param strategy Grouping strategy, sum aggregates data by period, latest returns the latest item in the period
   * @returns Grouped report
   *
   * Note: if strategy is 'sum', only Decimal values that are not nested are aggregated, all
   * other values are overwritten with the last value in the period
   */
  private applyGrouping<
    T extends {
      timestamp: string
      [key: string]: Currency | Price | Token | string | number | undefined | any[] | { [key: string]: any }
    },
  >(items: T[], groupBy: ReportFilter['groupBy'] = 'day', strategy: 'latest' | 'sum' = 'latest'): T[] {
    if (strategy === 'latest') {
      return groupByPeriod<T>(items, groupBy, 'latest')
    }

    const groups = groupByPeriod<T>(items, groupBy, 'all')
    return groups.map((group) => {
      const base = { ...group[group.length - 1] } as T

      // Aggregate Decimal values
      for (const key in base) {
        const value = base[key as keyof T]
        if (value instanceof Currency) {
          base[key as keyof T] = group.reduce(
            (sum, item) => sum.add(item[key as keyof T] as Currency),
            new Currency(0n, value.decimals)
          ) as T[keyof T]
        }
        if (value instanceof Token) {
          base[key as keyof T] = group.reduce(
            (sum, item) => sum.add(item[key as keyof T] as Token),
            new Token(0n, value.decimals)
          ) as T[keyof T]
        }
        if (value instanceof Price) {
          base[key as keyof T] = group.reduce(
            (sum, item) => sum.add(item[key as keyof T] as Price),
            new Price(0n)
          ) as T[keyof T]
        }
      }
      return base
    })
  }

  private getDateKey(timestamp: string, groupBy?: ReportFilter['groupBy']): string {
    switch (groupBy) {
      case 'month':
        return timestamp.slice(0, 7) // YYYY-MM
      case 'quarter':
        const date = new Date(timestamp)
        const quarter = Math.floor(date.getMonth() / 3) + 1
        return `${date.getFullYear()}-Q${quarter}` // YYYY-Q#
      case 'year':
        return timestamp.slice(0, 4) // YYYY
      default:
        return timestamp.slice(0, 10) // YYYY-MM-DD
    }
  }
}

export const processor = new Processor()
