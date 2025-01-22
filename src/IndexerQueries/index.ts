import { Entity } from '../Entity.js'
import { Centrifuge } from '../Centrifuge.js'
import {
  poolFeeTransactionPostProcess,
  poolFeeTransactionQuery,
  PoolFeeTransactionFilter,
} from './poolFeeTransactions.js'
import { poolSnapshotsPostProcess, poolSnapshotsQuery, PoolSnapshotFilter } from './poolSnapshots.js'
import { poolFeeSnapshotsPostProcess, PoolFeeSnapshotFilter, poolFeeSnapshotQuery } from './poolFeeSnapshots.js'
import { Pool } from '../Pool.js'
import { trancheSnapshotsPostProcess, trancheSnapshotsQuery, TrancheSnapshotFilter } from './trancheSnapshots.js'
import { assetTransactionsPostProcess, assetTransactionsQuery, AssetTransactionFilter } from './assetTransactions.js'
import {
  investorTransactionsPostProcess,
  investorTransactionsQuery,
  InvestorTransactionFilter,
} from './investorTransactions.js'
import { AssetSnapshotFilter, assetSnapshotsPostProcess, assetSnapshotsQuery } from './assetSnapshots.js'
import {
  trancheCurrencyBalancePostProcessor,
  trancheCurrencyBalanceQuery,
  TrancheCurrencyBalanceFilter,
  TrancheBalanceFilter,
  CurrencyBalanceFilter,
} from './trancheCurrencyBalance.js'
import { EpochFilter, epochsPostProcess, epochsQuery } from './epochs.js'

export class IndexerQueries extends Entity {
  constructor(
    centrifuge: Centrifuge,
    public pool: Pool
  ) {
    super(centrifuge, ['indexerQueries  ', pool.id])
  }

  poolFeeSnapshotsQuery(filter?: PoolFeeSnapshotFilter) {
    return this._root._queryIndexer(poolFeeSnapshotQuery, { filter }, poolFeeSnapshotsPostProcess)
  }

  poolSnapshotsQuery(filter?: PoolSnapshotFilter) {
    return this._root._queryIndexer(poolSnapshotsQuery, { filter }, poolSnapshotsPostProcess)
  }

  trancheSnapshotsQuery(filter?: TrancheSnapshotFilter) {
    return this._root._queryIndexer(trancheSnapshotsQuery, { filter }, trancheSnapshotsPostProcess)
  }

  poolEpochsQuery(filter?: EpochFilter) {
    return this._root._queryIndexer(epochsQuery, { filter }, epochsPostProcess)
  }

  investorTransactionsQuery(filter?: InvestorTransactionFilter) {
    return this._root._queryIndexer(investorTransactionsQuery, { filter }, investorTransactionsPostProcess)
  }

  assetTransactionsQuery(filter?: AssetTransactionFilter) {
    return this._root._queryIndexer(assetTransactionsQuery, { filter }, assetTransactionsPostProcess)
  }

  poolFeeTransactionsQuery(filter?: PoolFeeTransactionFilter) {
    return this._root._queryIndexer(poolFeeTransactionQuery, { filter }, poolFeeTransactionPostProcess)
  }

  assetSnapshotsQuery(filter?: AssetSnapshotFilter) {
    return this._root._queryIndexer(assetSnapshotsQuery, { filter }, assetSnapshotsPostProcess)
  }

  trancheCurrencyBalanceQuery(filterTranches?: TrancheBalanceFilter, filterCurrencies?: CurrencyBalanceFilter) {
    return this._root._queryIndexer(
      trancheCurrencyBalanceQuery,
      { filterTranches, filterCurrencies },
      trancheCurrencyBalancePostProcessor
    )
  }
}
