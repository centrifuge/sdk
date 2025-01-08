import { Currency, Perquintill, Price, Token } from '../utils/BigInt.js'
import {} from '../utils/date.js'

export type TrancheSnapshotFilter = Partial<Record<keyof SubqueryTrancheSnapshot['trancheSnapshots']['nodes'][0], any>>

export const trancheSnapshotsQuery = `
query($filter: TrancheSnapshotFilter) {
  trancheSnapshots(
    orderBy: BLOCK_NUMBER_ASC,
    filter: $filter
) {
    nodes {
      tranche {
        poolId
        trancheId
        pool {
          currency {
            decimals
            symbol
          }
        }
      }
      timestamp
      tokenSupply
      tokenPrice
      sumOutstandingInvestOrdersByPeriod
      sumOutstandingRedeemOrdersByPeriod
      sumFulfilledInvestOrdersByPeriod
      sumFulfilledRedeemOrdersByPeriod
      yield7DaysAnnualized
      yield30DaysAnnualized
      yield90DaysAnnualized
      yieldSinceInception
      yieldMTD
      yieldQTD
      yieldYTD
      yieldSinceLastPeriod
    }
  }
}
`
export type SubqueryTrancheSnapshot = {
  trancheSnapshots: {
    nodes: {
      id: string
      tokenPrice: string
      blockNumber: number
      timestamp: string
      trancheId: string // poolId-trancheId
      tranche: {
        poolId: string
        trancheId: string
        pool: {
          currency: {
            decimals: number
            symbol: string
          }
        }
      }
      tokenSupply: string
      sumOutstandingInvestOrdersByPeriod: string
      sumOutstandingRedeemOrdersByPeriod: string
      sumFulfilledInvestOrdersByPeriod: string
      sumFulfilledRedeemOrdersByPeriod: string
      yield7DaysAnnualized: string
      yield30DaysAnnualized: string
      yield90DaysAnnualized: string
      yieldSinceInception: string
      yieldMTD: string
      yieldQTD: string
      yieldYTD: string
      yieldSinceLastPeriod: string
    }[]
  }
}

export type TrancheSnapshot = {
  id: string
  price: Price
  timestamp: string
  trancheId: string
  poolId: string
  tokenSupply: Token
  pool: {
    currency: {
      decimals: number
      symbol: string
    }
  }
  outstandingInvestOrders: Currency
  outstandingRedeemOrders: Currency
  fulfilledInvestOrders: Currency
  fulfilledRedeemOrders: Currency
  yield7DaysAnnualized: Perquintill | null
  yield30DaysAnnualized: Perquintill | null
  yield90DaysAnnualized: Perquintill | null
  yieldSinceInception: Perquintill
  yieldMTD: Perquintill | null
  yieldQTD: Perquintill | null
  yieldYTD: Perquintill | null
  yieldSinceLastPeriod: Perquintill | null
}

export type TrancheSnapshotsByDate = {
  [timestamp: string]: TrancheSnapshot[]
}

export function trancheSnapshotsPostProcess(data: SubqueryTrancheSnapshot): { [date: string]: TrancheSnapshot[] } {
  const tranchesByDate: TrancheSnapshotsByDate = {}

  data?.trancheSnapshots?.nodes?.forEach((tranche) => {
    const date = tranche.timestamp.slice(0, 10)
    if (!tranchesByDate[date]) {
      tranchesByDate[date] = []
    }

    const poolCurrency = tranche.tranche.pool.currency
    const trancheSnapshot: TrancheSnapshot = {
      id: tranche.trancheId,
      timestamp: tranche.timestamp,
      poolId: tranche.tranche.poolId,
      trancheId: tranche.tranche.trancheId,
      pool: {
        currency: {
          decimals: poolCurrency.decimals,
          symbol: poolCurrency.symbol,
        },
      },
      price: new Price(tranche.tokenPrice ?? 0),
      tokenSupply: new Token(tranche.tokenSupply, poolCurrency.decimals),
      fulfilledInvestOrders: new Currency(tranche.sumFulfilledInvestOrdersByPeriod, poolCurrency.decimals),
      fulfilledRedeemOrders: new Currency(tranche.sumFulfilledRedeemOrdersByPeriod, poolCurrency.decimals),
      outstandingInvestOrders: new Currency(tranche.sumOutstandingInvestOrdersByPeriod, poolCurrency.decimals),
      outstandingRedeemOrders: new Currency(tranche.sumOutstandingRedeemOrdersByPeriod, poolCurrency.decimals),
      yield7DaysAnnualized: new Perquintill(tranche.yield7DaysAnnualized ?? 0),
      yield30DaysAnnualized: new Perquintill(tranche.yield30DaysAnnualized ?? 0),
      yield90DaysAnnualized: new Perquintill(tranche.yield90DaysAnnualized ?? 0),
      yieldSinceInception: new Perquintill(tranche.yieldSinceInception ?? 0),
      yieldMTD: new Perquintill(tranche.yieldMTD ?? 0),
      yieldQTD: new Perquintill(tranche.yieldQTD ?? 0),
      yieldYTD: new Perquintill(tranche.yieldYTD ?? 0),
      yieldSinceLastPeriod: new Perquintill(tranche.yieldSinceLastPeriod ?? 0),
    }

    tranchesByDate[date].push(trancheSnapshot)
  })

  return tranchesByDate
}
