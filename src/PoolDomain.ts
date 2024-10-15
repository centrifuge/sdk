import { defer, switchMap, tap } from 'rxjs'
import { getContract } from 'viem'
import { ABI } from './abi/liquidityPools/index.js'
import type { Centrifuge } from './Centrifuge.js'
import { lpConfig } from './config/lp.js'
import type { Pool } from './Pool.js'
import type { HexString } from './types/index.js'
import type { QueryFn } from './types/query.js'

export class PoolDomain {
  private _query: QueryFn
  constructor(private _root: Centrifuge, public pool: Pool, public chainId: number) {
    this._query = this._root._makeQuery(['pool', this.pool.id, 'domain', this.chainId])
  }

  manager() {
    return this._root._query(
      ['domainManager', this.chainId],
      () =>
        defer(async () => {
          const { router } = lpConfig[this.chainId]!
          const client = this._root.getClient(this.chainId)!
          const gatewayAddress = await getContract({ address: router, abi: ABI.Router, client }).read.gateway!()
          const managerAddress = await getContract({ address: gatewayAddress as any, abi: ABI.Gateway, client }).read
            .investmentManager!()
          console.log('managerAddress', managerAddress)
          return managerAddress as HexString
        }),
      { cacheTime: Infinity }
    )
  }

  poolManager() {
    return this._root._query(
      ['domainPoolManager', this.chainId],
      () =>
        this.manager().pipe(
          switchMap((manager) => {
            return getContract({
              address: manager,
              abi: ABI.InvestmentManager,
              client: this._root.getClient(this.chainId)!,
            }).read.poolManager!() as Promise<HexString>
          }),
          tap((poolManager) => console.log('poolManager', poolManager))
        ),
      { cacheTime: Infinity }
    )
  }

  isActive() {
    return this._query(
      ['isActive'],
      () =>
        this.poolManager().pipe(
          switchMap((manager) => {
            return getContract({
              address: manager,
              abi: ABI.PoolManager,
              client: this._root.getClient(this.chainId)!,
            }).read.isPoolActive!([this.pool.id]) as Promise<boolean>
          })
        ),
      { cacheTime: Infinity }
    )
  }
}
