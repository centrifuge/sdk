import { PoolFeeTransaction } from '../../entities/IndexerQueries/poolFeeTransactions.js'
import { Balance } from '../../utils/BigInt.js'
export const mockFeeTransactions = [
  {
    feeId: 'fee-1',
    type: 'ACCRUED' as PoolFeeTransaction['type'],
    timestamp: '2024-01-01T00:00:00Z',
    blockNumber: '1',
    epochNumber: 1,
    amount: new Balance(1000000n, 6),
  },
  {
    feeId: 'fee-2',
    type: 'PAID' as PoolFeeTransaction['type'],
    timestamp: '2024-01-02T00:00:00Z',
    blockNumber: '2',
    epochNumber: 2,
    amount: new Balance(2000000n, 6),
  },
]
