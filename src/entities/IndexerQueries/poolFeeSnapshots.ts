import { Balance } from '../../utils/BigInt.js'

export type PoolFeeSnapshotFilter = Partial<Record<keyof SubqueryPoolFeeSnapshot['poolFeeSnapshots']['nodes'][0], any>>

export type PoolFeeSnapshot = {
  pendingAmount: Balance
  poolFee: { name: string }
  poolFeeId: string
  sumAccruedAmount: Balance
  sumChargedAmount: Balance
  sumPaidAmount: Balance
  sumAccruedAmountByPeriod: Balance
  sumChargedAmountByPeriod: Balance
  sumPaidAmountByPeriod: Balance
  timestamp: string
  poolCurrency: {
    decimals: number
  }
}

export type PoolFeeSnapshotsByDate = { [timestamp: string]: PoolFeeSnapshot[] }

export type SubqueryPoolFeeSnapshot = {
  poolFeeSnapshots: {
    nodes: {
      poolFeeId: string // poolId-feeId
      timestamp: string
      sumPaidAmount: string
      sumChargedAmount: string
      sumAccruedAmount: string
      pendingAmount: string
      sumPaidAmountByPeriod: string
      sumChargedAmountByPeriod: string
      sumAccruedAmountByPeriod: string
      poolFee: {
        name: string
        pool: {
          currency: {
            decimals: number
          }
        }
      }
    }[]
  }
}

export function poolFeeSnapshotsPostProcess(data: SubqueryPoolFeeSnapshot): PoolFeeSnapshotsByDate {
  const poolFeeSnapshots = data.poolFeeSnapshots
  const poolFeesGroupedByDate = poolFeeSnapshots?.nodes.reduce((acc, snapshot) => {
    const date = snapshot.timestamp.slice(0, 10)
    if (!acc[date]) {
      acc[date] = []
    }

    const poolCurrencyDecimals = snapshot.poolFee.pool.currency.decimals
    const poolFeeSnapshot: PoolFeeSnapshot = {
      timestamp: snapshot.timestamp,
      pendingAmount: new Balance(snapshot.pendingAmount, poolCurrencyDecimals),
      poolFee: {
        name: snapshot.poolFee.name,
      },
      poolFeeId: snapshot.poolFeeId,
      poolCurrency: {
        decimals: poolCurrencyDecimals,
      },
      sumAccruedAmount: new Balance(snapshot.sumAccruedAmount, poolCurrencyDecimals),
      sumChargedAmount: new Balance(snapshot.sumChargedAmount, poolCurrencyDecimals),
      sumPaidAmount: new Balance(snapshot.sumPaidAmount, poolCurrencyDecimals),
      sumAccruedAmountByPeriod: new Balance(snapshot.sumAccruedAmountByPeriod, poolCurrencyDecimals),
      sumChargedAmountByPeriod: new Balance(snapshot.sumChargedAmountByPeriod, poolCurrencyDecimals),
      sumPaidAmountByPeriod: new Balance(snapshot.sumPaidAmountByPeriod, poolCurrencyDecimals),
    }

    acc[date].push(poolFeeSnapshot)
    return acc
  }, {} as PoolFeeSnapshotsByDate)
  return poolFeesGroupedByDate
}

export const poolFeeSnapshotQuery = `
query($filter: PoolFeeSnapshotFilter) {
  poolFeeSnapshots(
    orderBy: BLOCK_NUMBER_ASC, 
    filter: $filter
  ) {
    nodes {
        id
        poolFeeId
        timestamp
        sumPaidAmount
        sumChargedAmount
        sumAccruedAmount
        sumPaidAmount
        pendingAmount
        sumAccruedAmountByPeriod
        sumPaidAmountByPeriod
        sumChargedAmountByPeriod
        poolFee {
          name
          pool {
            currency {
              decimals
            }
          }
        }
    }
  }
}
`
