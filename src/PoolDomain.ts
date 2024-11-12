import { defer, map, switchMap, tap } from 'rxjs'
import { getContract } from 'viem'
import { ABI } from './abi/index.js'
import type { Centrifuge } from './Centrifuge.js'
import { lpConfig } from './config/lp.js'
import { Entity } from './Entity.js'
import type { Pool } from './Pool.js'
import type { HexString } from './types/index.js'
import { repeatOnEvents } from './utils/rx.js'

export class PoolDomain extends Entity {
  constructor(
    _root: Centrifuge,
    public pool: Pool,
    public chainId: number
  ) {
    super(_root, ['pool', pool.id, 'domain', chainId])
  }

  investManager() {
    return this._root._query(['domainManager', this.chainId], () =>
      defer(async () => {
        const { router } = lpConfig[this.chainId]!
        const client = this._root.getClient(this.chainId)!
        const gatewayAddress = await getContract({ address: router, abi: ABI.Router, client }).read.gateway!()
        const managerAddress = await getContract({ address: gatewayAddress as any, abi: ABI.Gateway, client }).read
          .investmentManager!()
        return managerAddress as HexString
      })
    )
  }

  poolManager() {
    return this._root._query(['domainPoolManager', this.chainId], () =>
      this.investManager().pipe(
        switchMap((manager) => {
          return getContract({
            address: manager,
            abi: ABI.InvestmentManager,
            client: this._root.getClient(this.chainId)!,
          }).read.poolManager!() as Promise<HexString>
        }),
        tap((poolManager) => console.log('poolManager', poolManager))
      )
    )
  }

  isActive() {
    return this._query(['isActive'], () =>
      this.poolManager().pipe(
        switchMap((manager) => {
          return defer(
            () =>
              this._root.getClient(this.chainId)!.readContract({
                address: manager,
                abi: ABI.PoolManager,
                functionName: 'isPoolActive',
                args: [Number(this.pool.id)],
              }) as Promise<boolean>
          ).pipe(
            repeatOnEvents(
              this._root,
              {
                address: manager,
                abi: ABI.PoolManager,
                eventName: 'AddPool',
                filter: (events) => {
                  return events.some((event) => {
                    return event.args.poolId === this.pool.id
                  })
                },
              },
              this.chainId
            )
          )
        })
      )
    )
  }
}
