import { Currency } from '../../utils/BigInt.js'
import { PoolFeeSnapshotsByDate } from '../../IndexerQueries/poolFeeSnapshots.js'

export const mockPoolFeeSnapshots: PoolFeeSnapshotsByDate = {
  '2024-01-01': [
    {
      pendingAmount: new Currency(0n, 6),
      poolFee: { name: 'poolFee 1' },
      poolFeeId: 'poolFee-1',
      sumAccruedAmount: new Currency(0n, 6),
      sumChargedAmount: new Currency(0n, 6),
      sumPaidAmount: new Currency(0n, 6),
      sumAccruedAmountByPeriod: new Currency(0n, 6),
      sumChargedAmountByPeriod: new Currency(0n, 6),
      sumPaidAmountByPeriod: new Currency(0n, 6),
      timestamp: '2024-01-01T12:00:00Z',
      poolCurrency: {
        decimals: 6,
      },
    },
    {
      pendingAmount: new Currency(0n, 6),
      poolFee: { name: 'poolFee 2' },
      poolFeeId: 'poolFee-2',
      sumAccruedAmount: new Currency(0n, 6),
      sumChargedAmount: new Currency(0n, 6),
      sumPaidAmount: new Currency(0n, 6),
      sumAccruedAmountByPeriod: new Currency(0n, 6),
      sumChargedAmountByPeriod: new Currency(0n, 6),
      sumPaidAmountByPeriod: new Currency(0n, 6),
      timestamp: '2024-01-01T12:00:00Z',
      poolCurrency: {
        decimals: 6,
      },
    },
  ],
  '2024-01-02': [
    {
      pendingAmount: new Currency(0n, 6),
      poolFee: { name: 'poolFee 1' },
      poolFeeId: 'poolFee-1',
      sumAccruedAmount: new Currency(0n, 6),
      sumChargedAmount: new Currency(0n, 6),
      sumPaidAmount: new Currency(0n, 6),
      sumAccruedAmountByPeriod: new Currency(0n, 6),
      sumChargedAmountByPeriod: new Currency(0n, 6),
      sumPaidAmountByPeriod: new Currency(0n, 6),
      timestamp: '2024-01-02T12:00:00Z',
      poolCurrency: {
        decimals: 6,
      },
    },
    {
      pendingAmount: new Currency(0n, 6),
      poolFee: { name: 'poolFee 2' },
      poolFeeId: 'poolFee-2',
      sumAccruedAmount: new Currency(0n, 6),
      sumChargedAmount: new Currency(0n, 6),
      sumPaidAmount: new Currency(0n, 6),
      sumAccruedAmountByPeriod: new Currency(0n, 6),
      sumChargedAmountByPeriod: new Currency(0n, 6),
      sumPaidAmountByPeriod: new Currency(0n, 6),
      timestamp: '2024-01-02T12:00:00Z',
      poolCurrency: {
        decimals: 6,
      },
    },
  ],
}
