import { Balance, Rate } from '../../utils/BigInt.js'

export type AssetSnapshotFilter = Partial<Record<keyof SubqueryAssetSnapshots['assetSnapshots']['nodes'][0], any>>

export type AssetSnapshot = {
  actualMaturityDate: string | undefined
  actualOriginationDate: number | undefined
  advanceRate: Rate | undefined
  assetId: string
  collateralValue: Balance | undefined
  currentPrice: Balance
  discountRate: Rate | undefined
  faceValue: Balance | undefined
  lossGivenDefault: Rate | undefined
  name: string
  outstandingDebt: Balance | undefined
  outstandingInterest: Balance | undefined
  outstandingPrincipal: Balance | undefined
  outstandingQuantity: Balance | undefined
  presentValue: Balance | undefined
  probabilityOfDefault: Rate | undefined
  status: string
  sumRealizedProfitFifo: Balance | undefined
  timestamp: string
  totalRepaidInterest: Balance | undefined
  totalRepaidPrincipal: Balance | undefined
  totalRepaidUnscheduled: Balance | undefined
  unrealizedProfitAtMarketPrice: Balance | undefined
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
      collateralValue: tx.asset?.collateralValue ? new Balance(tx.asset?.collateralValue, currencyDecimals) : undefined,
      currentPrice: tx.currentPrice
        ? new Balance(tx.currentPrice, currencyDecimals).mul(10n ** 18n)
        : new Balance(0n, currencyDecimals),
      discountRate: tx.asset.discountRate ? new Rate(tx.asset.discountRate) : undefined,
      faceValue:
        tx.asset.notional && tx.outstandingQuantity
          ? new Balance(tx.asset.notional, currencyDecimals).mul(BigInt(tx.outstandingQuantity))
          : undefined,
      lossGivenDefault: tx.asset.lossGivenDefault ? new Rate(tx.asset.lossGivenDefault) : undefined,
      name: tx.asset.name,
      outstandingDebt: tx.outstandingDebt ? new Balance(tx.outstandingDebt, currencyDecimals) : undefined,
      outstandingInterest: tx.outstandingInterest ? new Balance(tx.outstandingInterest, currencyDecimals) : undefined,
      outstandingPrincipal: tx.outstandingPrincipal
        ? new Balance(tx.outstandingPrincipal, currencyDecimals)
        : undefined,
      outstandingQuantity: tx.outstandingQuantity ? new Balance(tx.outstandingQuantity, 18) : undefined,
      presentValue: tx.presentValue ? new Balance(tx.presentValue, currencyDecimals) : undefined,
      probabilityOfDefault: tx.asset.probabilityOfDefault ? new Rate(tx.asset.probabilityOfDefault) : undefined,
      status: tx.asset.status,
      sumRealizedProfitFifo: tx.asset.sumRealizedProfitFifo
        ? new Balance(tx.asset.sumRealizedProfitFifo, currencyDecimals)
        : undefined,
      totalRepaidInterest: tx.totalRepaidInterest ? new Balance(tx.totalRepaidInterest, currencyDecimals) : undefined,
      totalRepaidPrincipal: tx.totalRepaidPrincipal
        ? new Balance(tx.totalRepaidPrincipal, currencyDecimals)
        : undefined,
      totalRepaidUnscheduled: tx.totalRepaidUnscheduled
        ? new Balance(tx.totalRepaidUnscheduled, currencyDecimals)
        : undefined,
      unrealizedProfitAtMarketPrice: tx.asset.unrealizedProfitAtMarketPrice
        ? new Balance(tx.asset.unrealizedProfitAtMarketPrice, currencyDecimals)
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
