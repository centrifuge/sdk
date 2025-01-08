import { AssetSnapshot } from '../../IndexerQueries/assetSnapshots.js'
import { Currency, Rate } from '../../utils/BigInt.js'

export const mockAssetSnapshots: AssetSnapshot[] = [
  {
    actualMaturityDate: '2030-01-01',
    actualOriginationDate: 1704067200, // 2024-01-01
    advanceRate: new Rate('800000000000000000'), // 0.8
    assetId: 'asset-1',
    collateralValue: Currency.fromFloat(125000, 6), // 125k
    currentPrice: Currency.fromFloat(1, 6),
    discountRate: new Rate('100000000000000000'), // 0.1
    faceValue: Currency.fromFloat(100000, 6), // 100k
    lossGivenDefault: new Rate('400000000000000000'), // 0.4
    name: 'Asset 1',
    outstandingDebt: Currency.fromFloat(80000, 6), // 80k
    outstandingInterest: Currency.fromFloat(2000, 6), // 2k
    outstandingPrincipal: Currency.fromFloat(78000, 6), // 78k
    outstandingQuantity: Currency.fromFloat(78000, 6), // 78k
    presentValue: Currency.fromFloat(77000, 6), // 77k
    probabilityOfDefault: new Rate('50000000000000000'), // 0.05
    status: 'ACTIVE',
    sumRealizedProfitFifo: Currency.fromFloat(1000, 6), // 1k
    timestamp: '2024-01-01T12:00:00Z',
    totalRepaidInterest: Currency.fromFloat(500, 6), // 500
    totalRepaidPrincipal: Currency.fromFloat(22000, 6), // 22k
    totalRepaidUnscheduled: Currency.fromFloat(0, 6),
    unrealizedProfitAtMarketPrice: Currency.fromFloat(-1000, 6), // -1k
    valuationMethod: 'DiscountedCashFlow',
  },
  {
    actualMaturityDate: '2030-01-01',
    actualOriginationDate: 1704067200, // 2024-01-01
    advanceRate: new Rate('800000000000000000'), // 0.8
    assetId: 'asset-1',
    collateralValue: Currency.fromFloat(125000, 6),
    currentPrice: Currency.fromFloat(1.02, 6), // Price increased
    discountRate: new Rate('100000000000000000'),
    faceValue: Currency.fromFloat(100000, 6),
    lossGivenDefault: new Rate('400000000000000000'),
    name: 'Asset 1',
    outstandingDebt: Currency.fromFloat(75000, 6), // Decreased by 5k
    outstandingInterest: Currency.fromFloat(1800, 6), // Decreased
    outstandingPrincipal: Currency.fromFloat(73200, 6), // Decreased
    outstandingQuantity: Currency.fromFloat(73200, 6),
    presentValue: Currency.fromFloat(74000, 6),
    probabilityOfDefault: new Rate('50000000000000000'),
    status: 'ACTIVE',
    sumRealizedProfitFifo: Currency.fromFloat(1200, 6), // Increased
    timestamp: '2024-01-02T12:00:00Z',
    totalRepaidInterest: Currency.fromFloat(700, 6), // Increased
    totalRepaidPrincipal: Currency.fromFloat(26800, 6), // Increased
    totalRepaidUnscheduled: Currency.fromFloat(0, 6),
    unrealizedProfitAtMarketPrice: Currency.fromFloat(1000, 6), // Changed to profit
    valuationMethod: 'DiscountedCashFlow',
  },
]
