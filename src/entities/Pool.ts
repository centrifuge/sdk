import { catchError, combineLatest, defer, map, of, switchMap, timeout } from 'rxjs'
import { fromHex, Hex } from 'viem'
import { ABI } from '../abi/index.js'
import type { Centrifuge } from '../Centrifuge.js'
import { PoolMetadata } from '../types/poolMetadata.js'
import { repeatOnEvents } from '../utils/rx.js'
import { PoolId, ShareClassId } from '../utils/types.js'
import { Entity } from './Entity.js'
import { PoolNetwork } from './PoolNetwork.js'
import { Reports } from './Reports/index.js'
import { ShareClass } from './ShareClass.js'
import { doTransaction } from '../utils/transaction.js'
import { HexString } from '../types/index.js'
import { Balance } from '../utils/BigInt.js'

export class Pool extends Entity {
  id: PoolId

  /** @internal */
  constructor(
    _root: Centrifuge,
    id: string | bigint,
    public chainId: number
  ) {
    super(_root, ['pool', String(id)])
    this.id = new PoolId(id)
  }

  get reports() {
    return new Reports(this._root, this)
  }

  metadata() {
    return this._query(['metadata'], () =>
      this._root._protocolAddresses(this.chainId).pipe(
        switchMap(({ hubRegistry }) =>
          defer(() => {
            return this._root.getClient(this.chainId)!.readContract({
              address: hubRegistry,
              abi: ABI.HubRegistry,
              functionName: 'metadata',
              args: [this.id.raw],
            })
          }).pipe(
            switchMap((hash) => {
              return this._root._queryIPFS<PoolMetadata>(fromHex(hash, 'string'))
            }),
            catchError((error) => {
              console.error('Error fetching metadata', error)
              return of(null)
            }),
            repeatOnEvents(
              this._root,
              {
                address: hubRegistry,
                abi: ABI.HubRegistry,
                eventName: 'SetMetadata',
                filter: (events) => {
                  return events.some((event) => {
                    return event.args.poolId === this.id.raw
                  })
                },
              },
              this.chainId
            )
          )
        )
      )
    )
  }

  updateMetadata(hash: HexString) {
    const self = this
    return this._transactSequence(async function* ({ walletClient, publicClient }) {
      const { hub } = await self._root._protocolAddresses(self.chainId)
      yield* doTransaction('Update metadata', publicClient, () =>
        walletClient.writeContract({
          address: hub,
          abi: ABI.Hub,
          functionName: 'setPoolMetadata',
          args: [self.id.raw, hash],
          value: BigInt(0),
        })
      )
    }, self.chainId)
  }

  shareClasses() {
    return this._query(null, () =>
      this._shareClassIds().pipe(map((scIds) => scIds.map((scId) => new ShareClass(this._root, this, scId.raw))))
    )
  }

  shareClassesDetails() {
    return this._query(null, () => {
      return this.shareClasses().pipe(
        switchMap((shareClasses) => {
          return combineLatest(shareClasses.map((sc) => sc.details()))
        })
      )
    })
  }

  /**
   * Get all networks where a pool can potentially be deployed.
   */
  networks() {
    return this._query(null, () => {
      return of(
        this._root.chains.map((chainId) => {
          return new PoolNetwork(this._root, this, chainId)
        })
      )
    })
  }

  /**
   * Get a specific network where a pool can potentially be deployed.
   */
  network(chainId: number) {
    return this._query(null, () => {
      return this.networks().pipe(
        map((networks) => {
          const network = networks.find((network) => network.chainId === chainId)
          if (!network) throw new Error(`Network ${chainId} not found`)
          return network
        })
      )
    })
  }

  /**
   * Get the networks where a pool is active. It doesn't mean that any vaults are deployed there necessarily.
   */
  activeNetworks() {
    return this._query(null, () => {
      return this.networks().pipe(
        switchMap((networks) => {
          return combineLatest(
            networks.map((network) =>
              network.isActive().pipe(
                // Because this is fetching from multiple networks and we're waiting on all of them before returning a value,
                // we want a timeout in case one of the endpoints is too slow
                timeout({ first: 5000 }),
                catchError(() => {
                  return of(false)
                })
              )
            )
          ).pipe(map((isActive) => networks.filter((_, index) => isActive[index])))
        })
      )
    })
  }

  vault(chainId: number, scId: ShareClassId, asset: string) {
    return this._query(null, () => this.network(chainId).pipe(switchMap((network) => network.vault(scId, asset))))
  }

  /**
   * Get the currency of the pool.
   */
  currency() {
    return this._query(['currency'], () => {
      return this._root._protocolAddresses(this.chainId).pipe(
        switchMap(({ hubRegistry }) => {
          return this._root.getClient(this.chainId)!.readContract({
            address: hubRegistry,
            abi: ABI.HubRegistry,
            functionName: 'currency',
            args: [this.id.raw],
          })
        })
      )
    })
  }

  /**
   * Get the decimals of the pool.
   */
  decimals() {
    return this._query(['decimals'], () => {
      return this._root._protocolAddresses(this.chainId).pipe(
        switchMap(({ hubRegistry }) => {
          return this._root.getClient(this.chainId)!.readContract({
            address: hubRegistry,
            abi: ABI.HubRegistry,
            functionName: 'decimals',
            args: [this.id.raw],
          })
        })
      )
    })
  }

  /**
   * Query the details of the pool.
   * @returns The pool metadata, id, shareClasses and currency.
   */
  details() {
    return this._query(null, () =>
      combineLatest([this.metadata(), this.shareClassesDetails(), this.currency(), this.decimals()]).pipe(
        map(([metadata, shareClasses, currency, decimals]) => {
          return {
            poolId: this.id,
            metadata: metadata ?? '',
            shareClasses,
            currency: new Balance(currency, decimals),
          }
        })
      )
    )
  }

  /**
   * @internal
   */
  _shareClassIds() {
    return this._query(['shareClasses'], () =>
      this._root._protocolAddresses(this.chainId).pipe(
        switchMap(({ shareClassManager }) =>
          defer(async () => {
            const count = await this._root.getClient(this.chainId)!.readContract({
              address: shareClassManager,
              abi: ABI.ShareClassManager,
              functionName: 'shareClassCount',
              args: [this.id.raw],
            })

            const scIds = await Promise.all(
              Array.from({ length: count }, (_, i) => {
                return this._root.getClient(this.chainId)!.readContract({
                  address: shareClassManager,
                  abi: ABI.ShareClassManager,
                  functionName: 'previewShareClassId',
                  args: [this.id.raw, i + 1],
                })
              })
            )
            return scIds.map((scId) => new ShareClassId(scId))
            // return Array.from({ length: count }, (_, i) => ShareClassId.from(this.id, i + 1))
          })
        )
      )
    )
  }
}
