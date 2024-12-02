import { Currency } from '../utils/BigInt.js'
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
} from './types.js'

export class Processor {
  /**
   * Process raw data into a balance sheet report
   * @param data Pool and tranche snapshot data
   * @param filter Optional filtering and grouping options
   * @returns Processed balance sheet report at the end of each period
   */
  balanceSheet(data: BalanceSheetData, filter?: ReportFilter): BalanceSheetReport[] {
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
  cashflow(data: CashflowData, filter?: ReportFilter): CashflowReport[] {
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
  profitAndLoss(data: ProfitAndLossData, filter?: ReportFilter): ProfitAndLossReport[] {
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

  investorTransactions(data: InvestorTransactionsData, filter?: ReportFilter): InvestorTransactionsReport[] {
    return data.investorTransactions
      .filter((day) => {
        if (
          day.type === 'INVEST_ORDER_UPDATE' ||
          day.type === 'REDEEM_ORDER_UPDATE' ||
          day.type === 'INVEST_ORDER_CANCEL' ||
          day.type === 'REDEEM_ORDER_CANCEL'
        ) {
          return true
        }

        if (day.type === 'INVEST_EXECUTION' || day.type === 'REDEEM_EXECUTION') {
          return true
        }
        if (
          day.type === 'INVEST_COLLECT' ||
          day.type === 'REDEEM_COLLECT' ||
          day.type === 'INVEST_LP_COLLECT' ||
          day.type === 'REDEEM_LP_COLLECT' ||
          day.type === 'TRANSFER_IN' ||
          day.type === 'TRANSFER_OUT'
        ) {
          return true
        }

        return false
      })
      .map((day) => {
        return {
          type: 'investorTransactions',
          timestamp: day.timestamp.toISOString(),
          chainId: day.chainId,
          account: day.evmAddress ?? day.accountId,
          epoch: day.epochNumber ? day.epochNumber.toString() : '',
          transactionType: day.type,
          currencyAmount: day.currencyAmount,
          trancheTokenAmount: day.tokenAmount,
          trancheTokenName: '', // TODO: add tranche name
          price: day.tokenPrice ?? '',
          transactionHash: day.hash,
        } as InvestorTransactionsReport
      })
  }

  /**
   * Apply grouping to a report.
   * @param items Report items
   * @param filter Optional filtering and grouping options
   * @param strategy Grouping strategy, sum aggregates data by period, latest returns the latest item in the period
   * @returns Grouped report
   *
   * Note: if strategy is 'sum', only Currency values that are not nested are aggregated, all
   * other values are overwritten with the last value in the period
   */
  private applyGrouping<
    T extends {
      timestamp: string
      [key: string]: Currency | string | { [key: string]: any } | undefined
    },
  >(items: T[], groupBy: ReportFilter['groupBy'] = 'day', strategy: 'latest' | 'sum' = 'latest'): T[] {
    if (strategy === 'latest') {
      return groupByPeriod<T>(items, groupBy, 'latest')
    }

    const groups = groupByPeriod<T>(items, groupBy, 'all')
    return groups.map((group) => {
      const base = { ...group[group.length - 1] } as T

      // Aggregate Currency values
      for (const key in base) {
        const value = base[key as keyof T]
        if (value instanceof Currency) {
          base[key as keyof T] = group.reduce(
            (sum, item) => sum.add(item[key as keyof T] as Currency),
            new Currency(0n, value.decimals)
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
