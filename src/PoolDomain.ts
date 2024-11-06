import { defer, of, switchMap, tap } from 'rxjs'
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
    centrifuge: Centrifuge,
    public pool: Pool,
    public chainId: number
  ) {
    super(centrifuge, ['pool', pool.id, 'domain', chainId])
  }

  manager() {
    return this._root._query(['domainManager', this.chainId], () =>
      defer(async () => {
        const { router } = lpConfig[this.chainId]!
        const client = this._root.getClient(this.chainId)!
        const gatewayAddress = await getContract({ address: router, abi: ABI.Router, client }).read.gateway!()
        const managerAddress = await getContract({ address: gatewayAddress as any, abi: ABI.Gateway, client }).read
          .investmentManager!()
        console.log('managerAddress', managerAddress)
        return managerAddress as HexString
      })
    )
  }

  poolManager() {
    return this._root._query(['domainPoolManager', this.chainId], () =>
      this.manager().pipe(
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
          return of(
            getContract({
              address: manager,
              abi: ABI.PoolManager,
              client: this._root.getClient(this.chainId)!,
            }).read.isPoolActive!([this.pool.id]) as Promise<boolean>
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

// repeat({
//   delay: () =>
//     this._root.filteredEvents(manager, ABI.PoolManager, 'AddPool', this.chainId).pipe(
//       filter((events) => {
//         return events.some((event) => {
//           return event.args.poolId === this.pool.id
//         })
//       })
//     ),
// })

// repeatOnEvents(
//   this._root,
//   {
//     address: manager,
//     abi: ABI.PoolManager,
//     eventName: 'AddPool',
//     filter: (events) => {
//       return events.some((event) => {
//         return event.args.poolId === this.pool.id
//       })
//     },
//   },
//   this.chainId
// )

// type ClassDecorator = (
//   value: Function,
//   context: {
//     kind: 'class';
//     name: string | undefined;
//     addInitializer(initializer: () => void): void;
//   }
// ) => Function | void;
