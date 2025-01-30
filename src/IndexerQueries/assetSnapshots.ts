import { Currency, Price, Rate } from '../utils/BigInt.js'

export type AssetSnapshotFilter = Partial<Record<keyof SubqueryAssetSnapshots['assetSnapshots']['nodes'][0], any>>

export type AssetSnapshot = {
  actualMaturityDate: string | undefined
  actualOriginationDate: number | undefined
  advanceRate: Rate | undefined
  assetId: string
  collateralValue: Currency | undefined
  currentPrice: Currency
  discountRate: Rate | undefined
  faceValue: Currency | undefined
  lossGivenDefault: Rate | undefined
  name: string
  outstandingDebt: Currency | undefined
  outstandingInterest: Currency | undefined
  outstandingPrincipal: Currency | undefined
  outstandingQuantity: Currency | undefined
  presentValue: Currency | undefined
  probabilityOfDefault: Rate | undefined
  status: string
  sumRealizedProfitFifo: Currency | undefined
  timestamp: string
  totalRepaidInterest: Currency | undefined
  totalRepaidPrincipal: Currency | undefined
  totalRepaidUnscheduled: Currency | undefined
  unrealizedProfitAtMarketPrice: Currency | undefined
  valuationMethod: string | undefined
}

export type SubqueryAssetSnapshots = {
  assetSnapshots: {
    nodes: {
      asset: {
        pool: {
          currency: {
            decimals: number
          }
        }
        actualOriginationDate: number
        advanceRate: string | undefined
        collateralValue: string | undefined
        discountRate: string | undefined
        id: string
        lossGivenDefault: string | undefined
        actualMaturityDate: string | undefined
        name: string
        probabilityOfDefault: string | undefined
        status: string
        sumRealizedProfitFifo: string | undefined
        unrealizedProfitAtMarketPrice: string | undefined
        valuationMethod: string
        notional: string | undefined
      }
      timestamp: string
      assetId: string
      presentValue: string | undefined
      currentPrice: string | undefined
      outstandingPrincipal: string | undefined
      outstandingInterest: string | undefined
      outstandingDebt: string | undefined
      outstandingQuantity: string | undefined
      totalRepaidPrincipal: string | undefined
      totalRepaidInterest: string | undefined
      totalRepaidUnscheduled: string | undefined
    }[]
  }
}

export const assetSnapshotsPostProcess = (data: SubqueryAssetSnapshots): AssetSnapshot[] => {
  return data!.assetSnapshots.nodes.map((tx) => {
    const currencyDecimals = tx.asset.pool.currency.decimals
    return {
      ...tx,
      timestamp: tx.timestamp,
      assetId: tx.assetId,
      actualMaturityDate: tx.asset.actualMaturityDate || undefined,
      actualOriginationDate: tx.asset.actualOriginationDate || undefined,
      advanceRate: new Rate(tx.asset.advanceRate || '0'),
      collateralValue: tx.asset?.collateralValue
        ? new Currency(tx.asset?.collateralValue, currencyDecimals)
        : undefined,
      currentPrice: tx.currentPrice
        ? new Currency(tx.currentPrice, currencyDecimals)
        : new Currency(0n, currencyDecimals),
      discountRate: tx.asset.discountRate ? new Rate(tx.asset.discountRate) : undefined,
      faceValue:
        tx.asset.notional && tx.outstandingQuantity
          ? new Currency(tx.asset.notional, currencyDecimals).mul(new Price(tx.outstandingQuantity).toDecimal())
          : undefined,
      lossGivenDefault: tx.asset.lossGivenDefault ? new Rate(tx.asset.lossGivenDefault) : undefined,
      name: tx.asset.name,
      outstandingDebt: tx.outstandingDebt ? new Currency(tx.outstandingDebt, currencyDecimals) : undefined,
      outstandingInterest: tx.outstandingInterest ? new Currency(tx.outstandingInterest, currencyDecimals) : undefined,
      outstandingPrincipal: tx.outstandingPrincipal
        ? new Currency(tx.outstandingPrincipal, currencyDecimals)
        : undefined,
      outstandingQuantity: tx.outstandingQuantity ? new Currency(tx.outstandingQuantity, 18) : undefined,
      presentValue: tx.presentValue ? new Currency(tx.presentValue, currencyDecimals) : undefined,
      probabilityOfDefault: tx.asset.probabilityOfDefault ? new Rate(tx.asset.probabilityOfDefault) : undefined,
      status: tx.asset.status,
      sumRealizedProfitFifo: tx.asset.sumRealizedProfitFifo
        ? new Currency(tx.asset.sumRealizedProfitFifo, currencyDecimals)
        : undefined,
      totalRepaidInterest: tx.totalRepaidInterest ? new Currency(tx.totalRepaidInterest, currencyDecimals) : undefined,
      totalRepaidPrincipal: tx.totalRepaidPrincipal
        ? new Currency(tx.totalRepaidPrincipal, currencyDecimals)
        : undefined,
      totalRepaidUnscheduled: tx.totalRepaidUnscheduled
        ? new Currency(tx.totalRepaidUnscheduled, currencyDecimals)
        : undefined,
      unrealizedProfitAtMarketPrice: tx.asset.unrealizedProfitAtMarketPrice
        ? new Currency(tx.asset.unrealizedProfitAtMarketPrice, currencyDecimals)
        : undefined,
      valuationMethod: tx.asset.valuationMethod,
    }
  }) satisfies AssetSnapshot[]
}

export const assetSnapshotsQuery = `
query($filter: AssetSnapshotFilter) {
        assetSnapshots(
          first: 1000,
          orderBy: TIMESTAMP_ASC,
          filter: $filter
        ) {
          nodes {
            assetId
            timestamp
            totalRepaidUnscheduled
            outstandingInterest
            totalRepaidInterest
            currentPrice
            outstandingPrincipal
            totalRepaidPrincipal
            outstandingQuantity
            presentValue
            outstandingDebt
            asset {
               pool {
                currency {
                  decimals
                }
              }
              actualMaturityDate
              actualOriginationDate
              advanceRate
              collateralValue
              discountRate
              lossGivenDefault
              name
              notional
              probabilityOfDefault
              status
              sumRealizedProfitFifo
              unrealizedProfitAtMarketPrice
              valuationMethod
            }
          }
        }
      }
`
