import { Currency, Perquintill, Price, Token } from '../utils/BigInt.js'

export type TrancheSnapshotFilter = {
  filter: {
    poolId?: { equalTo: string }
  }
}

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
  price: Price | null
  timestamp: string
  trancheId: string // poolId-trancheId
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
  yield7DaysAnnualized: Perquintill
  yield30DaysAnnualized: Perquintill
  yield90DaysAnnualized: Perquintill
  yieldSinceInception: Perquintill
  yieldMTD: Perquintill
  yieldQTD: Perquintill
  yieldYTD: Perquintill
  yieldSinceLastPeriod: Perquintill
}

export function trancheSnapshotsPostProcess(data: SubqueryTrancheSnapshot): TrancheSnapshot[] {
  // const trancheSnapshotsToday = data?.trancheSnapshots.nodes.filter((t) => t.timestamp.slice(0, 10) === timestamp)
  // if (!trancheSnapshotsToday?.length) return []
  const tranches: { [trancheId: string]: TrancheSnapshot } = {}
  data.trancheSnapshots.nodes.forEach((tranche) => {
    const tid = tranche.tranche.trancheId
    const poolCurrency = tranche.tranche.pool.currency
    tranches[tid] = {
      id: tranche.trancheId,
      timestamp: tranche.timestamp,
      trancheId: tid,
      pool: {
        currency: {
          decimals: poolCurrency.decimals,
          symbol: poolCurrency.symbol,
        },
      },
      price: tranche.tokenPrice ? new Price(tranche.tokenPrice) : null,
      tokenSupply: new Token(tranche.tokenSupply, poolCurrency.decimals),
      fulfilledInvestOrders: new Currency(tranche.sumFulfilledInvestOrdersByPeriod, poolCurrency.decimals),
      fulfilledRedeemOrders: new Currency(tranche.sumFulfilledRedeemOrdersByPeriod, poolCurrency.decimals),
      outstandingInvestOrders: new Currency(tranche.sumOutstandingInvestOrdersByPeriod, poolCurrency.decimals),
      outstandingRedeemOrders: new Currency(tranche.sumOutstandingRedeemOrdersByPeriod, poolCurrency.decimals),
      yield7DaysAnnualized: tranche.yield7DaysAnnualized
        ? new Perquintill(tranche.yield7DaysAnnualized)
        : new Perquintill(0),
      yield30DaysAnnualized: tranche.yield30DaysAnnualized
        ? new Perquintill(tranche.yield30DaysAnnualized)
        : new Perquintill(0),
      yield90DaysAnnualized: tranche.yield90DaysAnnualized
        ? new Perquintill(tranche.yield90DaysAnnualized)
        : new Perquintill(0),
      yieldSinceInception: tranche.yieldSinceInception
        ? new Perquintill(tranche.yieldSinceInception)
        : new Perquintill(0),
      yieldMTD: tranche.yieldMTD ? new Perquintill(tranche.yieldMTD) : new Perquintill(0),
      yieldQTD: tranche.yieldQTD ? new Perquintill(tranche.yieldQTD) : new Perquintill(0),
      yieldYTD: tranche.yieldYTD ? new Perquintill(tranche.yieldYTD) : new Perquintill(0),
      yieldSinceLastPeriod: tranche.yieldSinceLastPeriod
        ? new Perquintill(tranche.yieldSinceLastPeriod)
        : new Perquintill(0),
    }
  })
  return Object.values(tranches)
}
