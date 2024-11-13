import { defer, switchMap } from 'rxjs'
import { getContract } from 'viem'
import { ABI } from './abi/index.js'
import type { Centrifuge } from './Centrifuge.js'
import { lpConfig } from './config/lp.js'
import { Entity } from './Entity.js'
import type { Pool } from './Pool.js'
import type { HexString } from './types/index.js'
import { repeatOnEvents } from './utils/rx.js'

export class PoolNetwork extends Entity {
  constructor(
    _root: Centrifuge,
    public pool: Pool,
    public chainId: number
  ) {
    super(_root, ['pool', pool.id, 'network', chainId])
  }

  gateway() {
    return this._root._query(['gateway', this.chainId], () =>
      defer(() => {
        const { router } = lpConfig[this.chainId]!
        return this._root.getClient(this.chainId)!.readContract({
          address: router,
          abi: ABI.Router,
          functionName: 'gateway',
        }) as Promise<HexString>
      })
    )
  }

  investmentManager() {
    return this._root._query(['investmentManager', this.chainId], () =>
      this.gateway().pipe(
        switchMap(
          (gateway) =>
            this._root.getClient(this.chainId)!.readContract({
              address: gateway,
              abi: ABI.Gateway,
              functionName: 'investmentManager',
            }) as Promise<HexString>
        )
      )
    )
  }

  poolManager() {
    return this._root._query(['poolManager', this.chainId], () =>
      this.gateway().pipe(
        switchMap(
          (gateway) =>
            this._root.getClient(this.chainId)!.readContract({
              address: gateway,
              abi: ABI.Gateway,
              functionName: 'poolManager',
            }) as Promise<HexString>
        )
      )
    )
  }
        })
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
