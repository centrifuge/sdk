import { defer, switchMap } from 'rxjs'
import { getContract } from 'viem'
import { ABI } from './abi/index.js'
import type { Centrifuge } from './Centrifuge.js'
import { lpConfig } from './config/lp.js'
import { Entity } from './Entity.js'
import type { Pool } from './Pool.js'
import type { HexString } from './types/index.js'
import { repeatOnEvents } from './utils/rx.js'

/**
 * Query and interact with a pool on a specific network.
 */
export class PoolNetwork extends Entity {
  constructor(
    _root: Centrifuge,
    public pool: Pool,
    public chainId: number
  ) {
    super(_root, ['pool', pool.id, 'network', chainId])
  }

  /**
   * Get the routing contract that forwards incoming/outgoing messages.
   * @internal
   */
  _gateway() {
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

  /**
   * Get the main contract that vaults interact with for
   * incoming and outgoing investment transactions.
   * @internal
   */
  _investmentManager() {
    return this._root._query(['investmentManager', this.chainId], () =>
      this._gateway().pipe(
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

  /**
   * Get the contract manages which pools & tranches exist,
   * as well as managing allowed pool currencies, and incoming and outgoing transfers.
   * @internal
   */
  _poolManager() {
    return this._root._query(['poolManager', this.chainId], () =>
      this._gateway().pipe(
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

  /**
   * Get whether the pool is active on this network. It's a prerequisite for deploying vaults,
   * and doesn't indicate whether any vaults have been deployed.
   */
  isActive() {
    return this._query(['isActive'], () =>
      this._poolManager().pipe(
        switchMap((manager) => {
          return defer(
            () =>
              this._root.getClient(this.chainId)!.readContract({
                address: manager,
                abi: ABI.PoolManager,
                functionName: 'isPoolActive',
                args: [this.pool.id],
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
