import { PoolFeeSnapshotsByDate } from '../../entities/IndexerQueries/poolFeeSnapshots.js'
import { Balance } from '../../utils/BigInt.js'

export const mockPoolFeeSnapshots: PoolFeeSnapshotsByDate = {
  '2024-01-01': [
    {
      pendingAmount: new Balance(0n, 6),
      poolFee: { name: 'poolFee 1' },
      poolFeeId: 'poolFee-1',
      sumAccruedAmount: new Balance(0n, 6),
      sumChargedAmount: new Balance(0n, 6),
      sumPaidAmount: new Balance(0n, 6),
      sumAccruedAmountByPeriod: new Balance(0n, 6),
      sumChargedAmountByPeriod: new Balance(0n, 6),
      sumPaidAmountByPeriod: new Balance(0n, 6),
      timestamp: '2024-01-01T12:00:00Z',
      poolCurrency: {
        decimals: 6,
      },
    },
    {
      pendingAmount: new Balance(0n, 6),
      poolFee: { name: 'poolFee 2' },
      poolFeeId: 'poolFee-2',
      sumAccruedAmount: new Balance(0n, 6),
      sumChargedAmount: new Balance(0n, 6),
      sumPaidAmount: new Balance(0n, 6),
      sumAccruedAmountByPeriod: new Balance(0n, 6),
      sumChargedAmountByPeriod: new Balance(0n, 6),
      sumPaidAmountByPeriod: new Balance(0n, 6),
      timestamp: '2024-01-01T12:00:00Z',
      poolCurrency: {
        decimals: 6,
      },
    },
  ],
  '2024-01-02': [
    {
      pendingAmount: new Balance(0n, 6),
      poolFee: { name: 'poolFee 1' },
      poolFeeId: 'poolFee-1',
      sumAccruedAmount: new Balance(0n, 6),
      sumChargedAmount: new Balance(0n, 6),
      sumPaidAmount: new Balance(0n, 6),
      sumAccruedAmountByPeriod: new Balance(0n, 6),
      sumChargedAmountByPeriod: new Balance(0n, 6),
      sumPaidAmountByPeriod: new Balance(0n, 6),
      timestamp: '2024-01-02T12:00:00Z',
      poolCurrency: {
        decimals: 6,
      },
    },
    {
      pendingAmount: new Balance(0n, 6),
      poolFee: { name: 'poolFee 2' },
      poolFeeId: 'poolFee-2',
      sumAccruedAmount: new Balance(0n, 6),
      sumChargedAmount: new Balance(0n, 6),
      sumPaidAmount: new Balance(0n, 6),
      sumAccruedAmountByPeriod: new Balance(0n, 6),
      sumChargedAmountByPeriod: new Balance(0n, 6),
      sumPaidAmountByPeriod: new Balance(0n, 6),
      timestamp: '2024-01-02T12:00:00Z',
      poolCurrency: {
        decimals: 6,
      },
    },
  ],
}
