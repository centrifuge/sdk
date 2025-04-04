import { Balance, Price } from '../../utils/BigInt.js'

export type EpochFilter = Partial<Record<keyof SubqueryEpochs['epoches']['nodes'][0], any>>

export type Epoch = {
  epochId: string
  closedAt: string
  paidFees: Balance
  tokenPrice: Price
  sumOutstandingInvestOrders: Balance
  sumFulfilledInvestOrders: Balance
  sumOutstandingRedeemOrders: Balance
  sumFulfilledRedeemOrders: Balance
  netAssetValue: Balance
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
      paidFees: new Balance(order.sumPoolFeesPaidAmount, currencyDecimals),
      tokenPrice: new Price(epochStates?.tokenPrice ?? '0'),
      sumOutstandingInvestOrders: new Balance(epochStates?.sumOutstandingInvestOrders ?? '0', currencyDecimals),
      sumFulfilledInvestOrders: new Balance(epochStates?.sumFulfilledInvestOrders ?? '0', currencyDecimals),
      sumOutstandingRedeemOrders: new Balance(epochStates?.sumOutstandingRedeemOrders ?? '0', currencyDecimals),
      sumFulfilledRedeemOrders: new Balance(epochStates?.sumFulfilledRedeemOrders ?? '0', currencyDecimals),
      netAssetValue: new Balance(order.poolSnapshots.nodes[index]?.netAssetValue ?? '0', currencyDecimals),
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
