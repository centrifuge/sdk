import { Currency } from '../../utils/BigInt.js'
import { PoolFeeTransaction } from '../../IndexerQueries/poolFeeTransactions.js'
export const mockFeeTransactions = [
  {
    feeId: 'fee-1',
    type: 'ACCRUED' as PoolFeeTransaction['type'],
    timestamp: '2024-01-01T00:00:00Z',
    blockNumber: '1',
    epochNumber: 1,
    amount: new Currency(1000000n, 6),
  },
  {
    feeId: 'fee-2',
    type: 'PAID' as PoolFeeTransaction['type'],
    timestamp: '2024-01-02T00:00:00Z',
    blockNumber: '2',
    epochNumber: 2,
    amount: new Currency(2000000n, 6),
  },
]
