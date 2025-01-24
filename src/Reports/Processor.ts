import { AssetTransaction } from '../IndexerQueries/assetTransactions.js'
import { InvestorTransaction } from '../IndexerQueries/investorTransactions.js'
import { Currency, Price, Rate, Token } from '../utils/BigInt.js'
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
  OrdersListData,
  OrdersListReport,
  TokenPriceData,
  TokenPriceReport,
  TokenPriceReportFilter,
  AssetListReport,
  AssetListReportFilter,
  AssetListData,
  AssetListReportPublicCredit,
  AssetListReportPrivateCredit,
  InvestorListData,
  InvestorListReportFilter,
  InvestorListReport,
  FeeTransactionsData,
  FeeTransactionReportFilter,
  FeeTransactionReport,
  AssetTransactionReportFilter,
  AssetTransactionsData,
  AssetTransactionReport,
  AssetTimeSeriesReport,
  AssetTimeSeriesReportFilter,
  AssetTimeSeriesData,
} from '../types/reports.js'
import { PoolFeeTransaction } from '../IndexerQueries/poolFeeTransactions.js'

export class Processor {
  /**
   * Process raw data into a balance sheet report
   * @param data Pool and tranche snapshot data
   * @param filter Optional filtering and grouping options
   * @returns Processed balance sheet report at the end of each period
   */
  balanceSheet(data: BalanceSheetData, filter?: Omit<ReportFilter, 'to' | 'from'>): BalanceSheetReport[] {
    if (!data.poolSnapshots?.length) return []
    const items: BalanceSheetReport[] = data?.poolSnapshots?.map((snapshot) => {
      const tranches = data.trancheSnapshots[this.getDateKey(snapshot.timestamp)] ?? []
      if (tranches.length === 0) console.warn('No tranche snapshots found for pool snapshot', snapshot.timestamp)
      return {
        type: 'balanceSheet',
        timestamp: snapshot.timestamp,
        assetValuation: snapshot.portfolioValuation,
        onchainReserve: snapshot.totalReserve,
        offchainCash: snapshot.offchainCashValue,
        accruedFees: snapshot.sumPoolFeesPendingAmount,
        netAssetValue: snapshot.netAssetValue,
        tranches: tranches.length
          ? tranches?.map((tranche) => ({
              name: tranche.pool.currency.symbol,
              timestamp: tranche.timestamp,
              tokenId: tranche.trancheId,
              tokenSupply: tranche.tokenSupply,
              tokenPrice: tranche.price,
              trancheValue: tranche.tokenSupply.mul(tranche?.price?.toBigInt() ?? 0n),
            }))
          : [
              {
                name: '',
                timestamp: '',
                tokenId: '',
                tokenSupply: new Token(0n, snapshot.poolCurrency.decimals),
                tokenPrice: new Price(0n),
                trancheValue: new Currency(0n, snapshot.poolCurrency.decimals),
              },
            ],
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
    if (!data.poolSnapshots?.length) return []
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
    if (!data.poolSnapshots?.length) return []
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
        (!filterNetwork || filterNetwork === day.chainId) &&
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
    if (!data.assetTransactions?.length) return []
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
    if (!data.poolFeeTransactions?.length) return []
    const feeTransactionTypes: {
      [key in PoolFeeTransaction['type']]: string
    } = {
      PROPOSED: 'proposed',
      ADDED: 'added',
      REMOVED: 'removed',
      CHARGED: 'directChargeMade',
      UNCHARGED: 'directChargeCancelled',
      ACCRUED: 'accrued',
      PAID: 'paid',
    }
    return data.poolFeeTransactions.reduce<FeeTransactionReport[]>((acc, tx) => {
      if (
        !filter?.transactionType ||
        filter.transactionType === 'all' ||
        filter.transactionType === feeTransactionTypes[tx.type]
      ) {
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
    if (Object.values(data.trancheSnapshots).length === 0) return []
    const items = Object.entries(data.trancheSnapshots).map(([timestamp, snapshots]) => ({
      type: 'tokenPrice' as const,
      timestamp: timestamp,
      tranches: snapshots.map((snapshot) => ({
        timestamp: snapshot.timestamp,
        id: snapshot.trancheId,
        price: snapshot.price,
        supply: snapshot.tokenSupply,
        yieldMTD: snapshot.yieldMTD,
        yieldQTD: snapshot.yieldQTD,
        yieldYTD: snapshot.yieldYTD,
        yield7daysAnnualized: snapshot.yield7DaysAnnualized,
        yield30daysAnnualized: snapshot.yield30DaysAnnualized,
        yield90daysAnnualized: snapshot.yield90DaysAnnualized,
      })),
    }))

    return this.applyGrouping<TokenPriceReport>(items, filter?.groupBy ?? 'day', 'latest')
  }

  assetList(data: AssetListData, filter?: Omit<AssetListReportFilter, 'to' | 'from'>): AssetListReport[] {
    if (!data.assetSnapshots?.length) return []
    return data.assetSnapshots
      .filter((snapshot) => {
        if (snapshot.valuationMethod?.toLowerCase() === 'cash') return false
        const isMaturityDatePassed = snapshot?.actualMaturityDate
          ? new Date() > new Date(snapshot.actualMaturityDate)
          : false
        const isDebtZero = snapshot?.outstandingDebt?.isZero()

        if (filter?.status === 'ongoing') {
          return snapshot.status === 'ACTIVE' && !isMaturityDatePassed && !isDebtZero
        } else if (filter?.status === 'repaid') {
          return isMaturityDatePassed && isDebtZero
        } else if (filter?.status === 'overdue') {
          return isMaturityDatePassed && !isDebtZero
        } else return true
      })
      .sort((a, b) => {
        // Sort by actualMaturityDate in descending order
        const dateA = new Date(a.actualMaturityDate || 0).getTime()
        const dateB = new Date(b.actualMaturityDate || 0).getTime()
        return dateB - dateA
      })
      .map((snapshot) => {
        const subtype = data.metadata?.pool.asset.class === 'Public credit' ? 'publicCredit' : 'privateCredit'
        const items =
          subtype === 'publicCredit'
            ? ({
                subtype,
                faceValue: snapshot.faceValue,
                outstandingQuantity: snapshot.outstandingQuantity,
                currentPrice: snapshot.currentPrice,
                maturityDate: snapshot.actualMaturityDate,
                unrealizedProfit: snapshot.unrealizedProfitAtMarketPrice,
                realizedProfit: snapshot.sumRealizedProfitFifo,
              } satisfies AssetListReportPublicCredit)
            : ({
                subtype,
                outstandingPrincipal: snapshot.outstandingPrincipal,
                outstandingInterest: snapshot.outstandingInterest,
                repaidPrincipal: snapshot.totalRepaidPrincipal,
                repaidInterest: snapshot.totalRepaidInterest,
                repaidUnscheduled: snapshot.totalRepaidUnscheduled,
                originationDate: snapshot.actualOriginationDate,
                maturityDate: snapshot.actualMaturityDate,
                valuationMethod: snapshot.valuationMethod,
                advanceRate: snapshot.advanceRate,
                collateralValue: snapshot.collateralValue,
                probabilityOfDefault: snapshot.probabilityOfDefault,
                lossGivenDefault: snapshot.lossGivenDefault,
                discountRate: snapshot.discountRate,
              } satisfies AssetListReportPrivateCredit)
        return {
          type: 'assetList',
          transactionType: snapshot.status,
          timestamp: snapshot.timestamp,
          assetId: snapshot.assetId,
          presentValue: snapshot.presentValue,
          ...items,
        }
      })
  }

  investorList(data: InvestorListData, filter?: Omit<InvestorListReportFilter, 'to' | 'from'>): InvestorListReport[] {
    if (!data.trancheCurrencyBalance?.length) return []

    const filterNetwork = filter?.network === 'all' ? null : filter?.network
    const filterAddress = filter?.address?.toLowerCase()

    return data.trancheCurrencyBalance
      .filter((investor) => {
        const networkMatches = !filterNetwork || filterNetwork === investor.chainId
        const addressMatches =
          !filterAddress ||
          investor.accountId.toLowerCase() === filterAddress ||
          investor.evmAddress?.toLowerCase() === filterAddress
        const trancheMatches = !filter?.trancheId || filter.trancheId === investor.trancheId
        const hasPosition =
          !filter?.address && (!investor.balance.isZero() || !investor.claimableTrancheTokens.isZero())

        return networkMatches && addressMatches && trancheMatches && (hasPosition || filter?.address)
      })
      .map((balance) => {
        const totalPositions = data.trancheCurrencyBalance.reduce((sum, investor) => {
          return sum.add(investor.balance).add(investor.claimableTrancheTokens)
        }, new Currency(0))
        return {
          type: 'investorList',
          chainId: balance.chainId,
          accountId: balance.accountId,
          evmAddress: balance.evmAddress,
          position: balance.balance.add(balance.claimableTrancheTokens),
          poolPercentage: new Rate(balance.balance.add(balance.claimableTrancheTokens.div(totalPositions)).toBigInt()),
          pendingInvest: balance.pendingInvestCurrency,
          pendingRedeem: balance.pendingRedeemTrancheTokens,
        }
      })
  }

  ordersList(data: OrdersListData): OrdersListReport[] {
    if (!data.poolEpochs?.length) return []
    const items = data.poolEpochs.map(
      (epoch) =>
        ({
          type: 'ordersList',
          epoch: epoch.epochId.split('-')[1] as string,
          timestamp: epoch.closedAt,
          netAssetValue: epoch.netAssetValue,
          navPerShare: epoch.tokenPrice,
          lockedInvestments: epoch.sumOutstandingInvestOrders,
          lockedRedemptions: epoch.sumOutstandingRedeemOrders,
          executedInvestments: epoch.sumFulfilledInvestOrders,
          executedRedemptions: epoch.sumFulfilledRedeemOrders,
          paidFees: epoch.paidFees,
        }) satisfies OrdersListReport
    )
    return items
  }

  assetTimeSeries(
    data: AssetTimeSeriesData,
    filter?: Omit<AssetTimeSeriesReportFilter, 'to' | 'from'>
  ): AssetTimeSeriesReport[] {
    if (!data.assetSnapshots?.length) return []
    const items = data.assetSnapshots
      .filter((snapshot) => {
        return (
          (!filter?.assetId || snapshot.assetId.split('-')[1] === filter.assetId) &&
          (!filter?.name || snapshot.name === filter.name)
        )
      })
      .map(
        (snapshot) =>
          ({
            type: 'assetTimeSeries',
            timestamp: snapshot.timestamp,
            currentPrice: snapshot.currentPrice,
            assetId: snapshot.assetId.split('-')[1]!,
            name: snapshot.name,
          }) satisfies AssetTimeSeriesReport
      )
    return items
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
