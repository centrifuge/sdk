import { Currency, Price } from '../utils/BigInt.js'

export type EpochFilter = Partial<Record<keyof SubqueryEpochs['epoches']['nodes'][0], any>>

export type Epoch = {
  epochId: string
  closedAt: string
  paidFees: Currency
  tokenPrice: Price
  sumOutstandingInvestOrders: Currency
  sumFulfilledInvestOrders: Currency
  sumOutstandingRedeemOrders: Currency
  sumFulfilledRedeemOrders: Currency
  netAssetValue: Currency
}

type SubqueryEpochs = {
  epoches: {
    nodes: {
      id: string
      sumPoolFeesPaidAmount: string
      closedAt: string
      epochStates: {
        nodes: {
          tokenPrice: string
          sumOutstandingInvestOrders: string
          sumFulfilledInvestOrders: string
          sumOutstandingRedeemOrders: string
          sumFulfilledRedeemOrders: string
        }[]
      }
      pool: {
        currency: {
          decimals: number
        }
      }
      poolSnapshots: {
        nodes: {
          netAssetValue: string
        }[]
      }
    }[]
  }
}

export const epochsPostProcess = (data: SubqueryEpochs): Epoch[] => {
  return data.epoches.nodes.map((order) => {
    const index = order.epochStates.nodes.length > 1 ? order.epochStates.nodes.length - 1 : 0
    const epochStates = order.epochStates.nodes[index]
    const currencyDecimals = order.pool.currency.decimals
    return {
      epochId: order.id,
      closedAt: order.closedAt,
      paidFees: new Currency(order.sumPoolFeesPaidAmount, currencyDecimals),
      tokenPrice: new Price(epochStates?.tokenPrice ?? '0'),
      sumOutstandingInvestOrders: new Currency(epochStates?.sumOutstandingInvestOrders ?? '0', currencyDecimals),
      sumFulfilledInvestOrders: new Currency(epochStates?.sumFulfilledInvestOrders ?? '0', currencyDecimals),
      sumOutstandingRedeemOrders: new Currency(epochStates?.sumOutstandingRedeemOrders ?? '0', currencyDecimals),
      sumFulfilledRedeemOrders: new Currency(epochStates?.sumFulfilledRedeemOrders ?? '0', currencyDecimals),
      netAssetValue: new Currency(order.poolSnapshots.nodes[index]?.netAssetValue ?? '0', currencyDecimals),
    } satisfies Epoch
  })
}

export const epochsQuery = `
query($filter: EpochFilter) {
  epoches(filter: $filter) {
    nodes {
      poolId
      id
      sumPoolFeesPaidAmount
      closedAt
      epochStates {
        nodes {
          tokenPrice
          sumOutstandingInvestOrders
          sumFulfilledInvestOrders
          sumOutstandingRedeemOrders
          sumFulfilledRedeemOrders
        }
      }
      pool {
        currency {
          decimals
        }
      }
      poolSnapshots {
        nodes {
          netAssetValue
        }
      }
    }
  }
}
`
