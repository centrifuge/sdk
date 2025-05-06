import { combineLatest, map } from 'rxjs'
import { Centrifuge } from '../../Centrifuge.js'
import { Query } from '../../types/query.js'
import {
  AssetListReport,
  AssetListReportFilter,
  AssetTimeSeriesReport,
  AssetTimeSeriesReportFilter,
  AssetTransactionReport,
  AssetTransactionReportFilter,
  BalanceSheetReport,
  CashflowReport,
  DataReport,
  DataReportFilter,
  FeeTransactionReport,
  FeeTransactionReportFilter,
  InvestorListReport,
  InvestorListReportFilter,
  InvestorTransactionsReport,
  InvestorTransactionsReportFilter,
  OrdersListReport,
  OrdersListReportFilter,
  ProfitAndLossReport,
  Report,
  ReportFilter,
  TokenPriceReport,
  TokenPriceReportFilter,
} from '../../types/reports.js'
import { Entity } from '../Entity.js'
import { IndexerQueries } from '../IndexerQueries/index.js'
import { Pool } from '../Pool.js'
import { processor } from './Processor.js'

const DEFAULT_FILTER: ReportFilter = {
  from: '2024-01-01T00:00:00.000Z',
  to: new Date().toISOString(),
}
export class Reports extends Entity {
  private queries: IndexerQueries
  /** @internal */
  constructor(
    centrifuge: Centrifuge,
    public pool: Pool
  ) {
    super(centrifuge, ['reports', pool.id.toString()])
    this.queries = new IndexerQueries(centrifuge, pool)
  }

  balanceSheet(filter?: ReportFilter) {
    return this._generateReport<BalanceSheetReport>('balanceSheet', filter)
  }

  cashflow(filter?: ReportFilter) {
    return this._generateReport<CashflowReport>('cashflow', filter)
  }

  profitAndLoss(filter?: ReportFilter) {
    return this._generateReport<ProfitAndLossReport>('profitAndLoss', filter)
  }

  investorTransactions(filter?: InvestorTransactionsReportFilter) {
    return this._generateReport<InvestorTransactionsReport>('investorTransactions', filter)
  }

  assetTransactions(filter?: AssetTransactionReportFilter) {
    return this._generateReport<AssetTransactionReport>('assetTransactions', filter)
  }

  tokenPrice(filter?: TokenPriceReportFilter) {
    return this._generateReport<TokenPriceReport>('tokenPrice', filter)
  }

  feeTransactions(filter?: FeeTransactionReportFilter) {
    return this._generateReport<FeeTransactionReport>('feeTransactions', filter)
  }

  assetList(filter?: AssetListReportFilter) {
    return this._generateReport<AssetListReport>('assetList', filter)
  }

  investorList(filter?: InvestorListReportFilter) {
    return this._generateReport<InvestorListReport>('investorList', filter)
  }

  ordersList(filter?: OrdersListReportFilter) {
    return this._generateReport<OrdersListReport>('ordersList', filter)
  }

  assetTimeSeries(filter?: AssetTimeSeriesReportFilter) {
    return this._generateReport<AssetTimeSeriesReport>('assetTimeSeries', filter)
  }

  /**
   * Reports are split into two types:
   * - A `Report` is a standard report: balanceSheet, cashflow, profitAndLoss
   * - A `DataReport` is a custom report: investorTransactions, assetTransactions, feeTransactions, tokenPrice, assetList, investorList, orderList, assetTimeSeries
   *
   * @internal
   */
  _generateReport<T>(type: Report, filter?: ReportFilter): Query<T[]>
  _generateReport<T>(type: DataReport, filter?: DataReportFilter): Query<T[]>
  _generateReport<T>(type: string, filter?: Record<string, any>) {
    return this._query(
      [
        type,
        filter?.from,
        filter?.to,
        filter?.groupBy,
        filter?.address,
        filter?.network,
        filter?.tokenId,
        filter?.transactionType,
        filter?.assetId,
        filter?.status,
        filter?.name,
      ],
      () => {
        const { from, to, ...restFilter } = filter ?? {}
        const dateFilter = {
          timestamp: {
            greaterThan: from ?? DEFAULT_FILTER.from,
            lessThanOrEqualTo: (to && `${to.split('T')[0]}T23:59:59.999Z`) ?? DEFAULT_FILTER.to,
          },
        }

        const metadata$ = this.pool.metadata()

        const poolSnapshots$ = this.queries.poolSnapshotsQuery({
          ...dateFilter,
          poolId: { equalTo: this.pool.id },
        })
        const trancheSnapshots$ = this.queries.trancheSnapshotsQuery({
          ...dateFilter,
          tranche: { poolId: { equalTo: this.pool.id } },
        })
        const poolFeeSnapshots$ = this.queries.poolFeeSnapshotsQuery({
          ...dateFilter,
          poolFeeId: { includes: this.pool.id },
        })
        const investorTransactions$ = this.queries.investorTransactionsQuery({
          ...dateFilter,
          poolId: { equalTo: this.pool.id },
        })
        const assetTransactions$ = this.queries.assetTransactionsQuery({
          ...dateFilter,
          poolId: { equalTo: this.pool.id },
        })
        const poolFeeTransactions$ = this.queries.poolFeeTransactionsQuery({
          ...dateFilter,
          poolFee: { poolId: { equalTo: this.pool.id } },
        })
        const assetSnapshots$ = this.queries.assetSnapshotsQuery({
          ...dateFilter,
          asset: { poolId: { equalTo: this.pool.id } },
        })
        const trancheCurrencyBalance$ = this.queries.trancheCurrencyBalanceQuery(
          {
            pool: { id: { equalTo: this.pool.id } },
          },
          {
            currency: { pool: { id: { equalTo: this.pool.id } } },
          }
        )
        const poolEpochs$ = this.queries.poolEpochsQuery({
          closedAt: {
            ...(from && { greaterThan: from }),
            lessThanOrEqualTo: (to && `${to.split('T')[0]}T23:59:59.999Z`) ?? DEFAULT_FILTER.to,
          },
          pool: { id: { equalTo: this.pool.id } },
        })

        switch (type) {
          case 'balanceSheet':
            return combineLatest([poolSnapshots$, trancheSnapshots$]).pipe(
              map(
                ([poolSnapshots, trancheSnapshots]) =>
                  processor.balanceSheet({ poolSnapshots, trancheSnapshots }, restFilter) as T[]
              )
            )
          case 'cashflow':
            return combineLatest([poolSnapshots$, poolFeeSnapshots$, metadata$]).pipe(
              map(
                ([poolSnapshots, poolFeeSnapshots, metadata]) =>
                  processor.cashflow({ poolSnapshots, poolFeeSnapshots, metadata }, restFilter) as T[]
              )
            )
          case 'profitAndLoss':
            return combineLatest([poolSnapshots$, poolFeeSnapshots$, metadata$]).pipe(
              map(
                ([poolSnapshots, poolFeeSnapshots, metadata]) =>
                  processor.profitAndLoss({ poolSnapshots, poolFeeSnapshots, metadata }, restFilter) as T[]
              )
            )
          case 'investorTransactions':
            return combineLatest([investorTransactions$]).pipe(
              map(
                ([investorTransactions]) => processor.investorTransactions({ investorTransactions }, restFilter) as T[]
              )
            )
          case 'assetTransactions':
            return combineLatest([assetTransactions$]).pipe(
              map(([assetTransactions]) => processor.assetTransactions({ assetTransactions }, restFilter) as T[])
            )
          case 'feeTransactions':
            return combineLatest([poolFeeTransactions$]).pipe(
              map(([poolFeeTransactions]) => processor.feeTransactions({ poolFeeTransactions }, restFilter) as T[])
            )
          case 'tokenPrice':
            return combineLatest([trancheSnapshots$]).pipe(
              map(([trancheSnapshots]) => processor.tokenPrice({ trancheSnapshots }, restFilter) as T[])
            )
          case 'assetList':
            return combineLatest([assetSnapshots$, metadata$]).pipe(
              map(([assetSnapshots, metadata]) => processor.assetList({ assetSnapshots, metadata }, restFilter) as T[])
            )
          case 'investorList':
            return combineLatest([trancheCurrencyBalance$]).pipe(
              map(([trancheCurrencyBalance]) => processor.investorList({ trancheCurrencyBalance }, restFilter) as T[])
            )
          case 'ordersList':
            return combineLatest([poolEpochs$]).pipe(map(([poolEpochs]) => processor.ordersList({ poolEpochs }) as T[]))
          case 'assetTimeSeries':
            return combineLatest([assetSnapshots$]).pipe(
              map(([assetSnapshots]) => processor.assetTimeSeries({ assetSnapshots }, restFilter) as T[])
            )
          default:
            throw new Error(`Unsupported report type: ${type}`)
        }
      },
      {
        valueCacheTime: 120_000,
      }
    )
  }
}
