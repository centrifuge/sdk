import { AssetTransaction, AssetTransactionType, AssetType } from '../../entities/IndexerQueries/assetTransactions.js'
import { Balance, Price } from '../../utils/BigInt.js'

export const mockAssetTransactions: AssetTransaction[] = [
  {
    id: 'asset-tx-1',
    timestamp: new Date('2024-01-01T12:00:00Z'),
    poolId: 'pool-1',
    accountId: 'account-1',
    epochId: 'epoch-1',
    type: 'BORROWED' as AssetTransactionType,
    amount: Balance.fromFloat(100000, 6), // 100k
    settlementPrice: new Price(1000000000000000000n), // 1.0
    quantity: '100000',
    principalAmount: Balance.fromFloat(100000, 6),
    interestAmount: Balance.fromFloat(0, 6),
    hash: '0xabc123',
    realizedProfitFifo: Balance.fromFloat(0, 6),
    unrealizedProfitAtMarketPrice: Balance.fromFloat(0, 6),
    asset: {
      id: 'poolId-1',
      metadata: 'Asset 1 metadata',
      type: AssetType.OnchainCash,
      currentPrice: '1000000000000000000', // 1.0
      name: 'Asset 1',
    },
  },
  {
    id: 'asset-tx-2',
    timestamp: new Date('2024-01-02T12:00:00Z'),
    poolId: 'pool-1',
    accountId: 'account-1',
    epochId: 'epoch-1',
    type: 'REPAID' as AssetTransactionType,
    amount: Balance.fromFloat(20000, 6), // 20k
    settlementPrice: new Price(1000000000000000000n), // 1.0
    quantity: '20000',
    principalAmount: Balance.fromFloat(19000, 6),
    interestAmount: Balance.fromFloat(1000, 6),
    hash: '0xdef456',
    realizedProfitFifo: Balance.fromFloat(1000, 6),
    unrealizedProfitAtMarketPrice: undefined,
    asset: {
      id: 'poolId-1',
      metadata: 'Asset 1 metadata',
      type: AssetType.OnchainCash,
      currentPrice: '1000000000000000000', // 1.0
      name: 'Asset 1',
    },
    toAsset: {
      id: 'poolId-2',
      metadata: 'Asset 2 metadata',
      type: AssetType.OffchainCash,
      name: 'Asset 2',
    },
  },
  {
    id: 'asset-tx-3',
    timestamp: new Date('2024-01-03T12:00:00Z'),
    poolId: 'pool-1',
    accountId: 'account-1',
    epochId: 'epoch-1',
    type: 'CASH_TRANSFER' as AssetTransactionType,
    amount: Balance.fromFloat(5000, 6),
    settlementPrice: null,
    quantity: null,
    principalAmount: null,
    interestAmount: null,
    hash: '0xghi789',
    realizedProfitFifo: undefined,
    unrealizedProfitAtMarketPrice: undefined,
    asset: {
      id: 'poolId-2',
      metadata: 'Asset 2 metadata',
      type: AssetType.OffchainCash,
      currentPrice: null,
      name: 'Asset 2',
    },
    fromAsset: {
      id: 'poolId-1',
      metadata: 'Asset 1 metadata',
      type: AssetType.OnchainCash,
      name: 'Asset 1',
    },
  },
]
