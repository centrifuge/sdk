import { Epoch } from '../../entities/IndexerQueries/epochs.js'
import { Balance, Price } from '../../utils/BigInt.js'

export const mockEpochs: Epoch[] = [
  {
    epochId: 'epoch-1',
    closedAt: '2024-01-01T00:00:00Z',
    paidFees: Balance.fromFloat(100, 6),
    tokenPrice: new Price(1000000000000000000n),
    sumOutstandingInvestOrders: Balance.fromFloat(1000, 6),
    sumFulfilledInvestOrders: Balance.fromFloat(900, 6),
    sumOutstandingRedeemOrders: Balance.fromFloat(100, 6),
    sumFulfilledRedeemOrders: Balance.fromFloat(90, 6),
    netAssetValue: Balance.fromFloat(1000, 6),
  },
  {
    epochId: 'epoch-2',
    closedAt: '2024-01-02T00:00:00Z',
    paidFees: Balance.fromFloat(100, 6),
    tokenPrice: new Price(1000000000000000000n),
    sumOutstandingInvestOrders: Balance.fromFloat(1000, 6),
    sumFulfilledInvestOrders: Balance.fromFloat(900, 6),
    sumOutstandingRedeemOrders: Balance.fromFloat(100, 6),
    sumFulfilledRedeemOrders: Balance.fromFloat(90, 6),
    netAssetValue: Balance.fromFloat(2000, 6),
  },
]
