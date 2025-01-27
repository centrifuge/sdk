import { Epoch } from '../../IndexerQueries/epochs.js'
import { Currency, Price } from '../../utils/BigInt.js'

export const mockEpochs: Epoch[] = [
  {
    epochId: 'epoch-1',
    closedAt: '2024-01-01T00:00:00Z',
    paidFees: Currency.fromFloat(100, 6),
    tokenPrice: new Price(1000000000000000000n),
    sumOutstandingInvestOrders: Currency.fromFloat(1000, 6),
    sumFulfilledInvestOrders: Currency.fromFloat(900, 6),
    sumOutstandingRedeemOrders: Currency.fromFloat(100, 6),
    sumFulfilledRedeemOrders: Currency.fromFloat(90, 6),
    netAssetValue: Currency.fromFloat(1000, 6),
  },
  {
    epochId: 'epoch-2',
    closedAt: '2024-01-02T00:00:00Z',
    paidFees: Currency.fromFloat(100, 6),
    tokenPrice: new Price(1000000000000000000n),
    sumOutstandingInvestOrders: Currency.fromFloat(1000, 6),
    sumFulfilledInvestOrders: Currency.fromFloat(900, 6),
    sumOutstandingRedeemOrders: Currency.fromFloat(100, 6),
    sumFulfilledRedeemOrders: Currency.fromFloat(90, 6),
    netAssetValue: Currency.fromFloat(2000, 6),
  },
]
