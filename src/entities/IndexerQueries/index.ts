import { Centrifuge } from '../../Centrifuge.js'
import { Entity } from '../Entity.js'
import { Pool } from '../Pool.js'
import { AssetSnapshotFilter, assetSnapshotsPostProcess, assetSnapshotsQuery } from './assetSnapshots.js'
import { AssetTransactionFilter, assetTransactionsPostProcess, assetTransactionsQuery } from './assetTransactions.js'
import { EpochFilter, epochsPostProcess, epochsQuery } from './epochs.js'
import {
  InvestorTransactionFilter,
  investorTransactionsPostProcess,
  investorTransactionsQuery,
} from './investorTransactions.js'
import { PoolFeeSnapshotFilter, poolFeeSnapshotQuery, poolFeeSnapshotsPostProcess } from './poolFeeSnapshots.js'
import {
  PoolFeeTransactionFilter,
  poolFeeTransactionPostProcess,
  poolFeeTransactionQuery,
} from './poolFeeTransactions.js'
import { PoolSnapshotFilter, poolSnapshotsPostProcess, poolSnapshotsQuery } from './poolSnapshots.js'
import {
  CurrencyBalanceFilter,
  TrancheBalanceFilter,
  trancheCurrencyBalancePostProcessor,
  trancheCurrencyBalanceQuery,
} from './trancheCurrencyBalance.js'
import { TrancheSnapshotFilter, trancheSnapshotsPostProcess, trancheSnapshotsQuery } from './trancheSnapshots.js'

export class IndexerQueries extends Entity {
  constructor(
    centrifuge: Centrifuge,
    public pool: Pool
  ) {
    super(centrifuge, ['indexerQueries', pool.id.toString()])
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
