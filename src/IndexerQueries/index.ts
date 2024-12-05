import { poolFeeTransactionPostProcess } from './poolFeeTransactions.js'

import { poolSnapshotsPostProcess, poolSnapshotsQuery } from './poolSnapshots.js'

import { poolFeeSnapshotsPostProcess } from './poolFeeSnapshots.js'

import { poolFeeSnapshotQuery } from './poolFeeSnapshots.js'

import { Entity } from '../Entity.js'

import { Centrifuge } from '../Centrifuge.js'
import { Pool } from '../Pool.js'
import { PoolFeeSnapshotFilter } from './poolFeeSnapshots.js'
import { PoolSnapshotFilter } from './poolSnapshots.js'
import { trancheSnapshotsPostProcess, trancheSnapshotsQuery } from './trancheSnapshots.js'
import { TrancheSnapshotFilter } from './trancheSnapshots.js'
import { assetTransactionsPostProcess, assetTransactionsQuery } from './assetTransactions.js'
import { poolFeeTransactionQuery } from './poolFeeTransactions.js'
import { investorTransactionsPostProcess, investorTransactionsQuery } from './investorTransactions.js'
import { InvestorTransactionFilter } from './investorTransactions.js'
import { AssetTransactionFilter } from './assetTransactions.js'
import { PoolFeeTransactionFilter } from './poolFeeTransactions.js'
import { AssetSnapshotFilter, assetSnapshotsPostProcess, assetSnapshotsQuery } from './assetSnapshots.js'

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
}
