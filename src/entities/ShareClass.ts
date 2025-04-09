import { combineLatest, defer, map, switchMap } from 'rxjs'
import { ABI } from '../abi/index.js'
import type { Centrifuge } from '../Centrifuge.js'
import { Balance } from '../utils/BigInt.js'
import { repeatOnEvents } from '../utils/rx.js'
import { Entity } from './Entity.js'
import type { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'

/**
 * Query and interact with a share class, which allows querying total issuance, NAV per share,
 * and allows interactions related to asynchronous deposits and redemptions.
 */
export class ShareClass extends Entity {
  /** @internal */
  constructor(
    _root: Centrifuge,
    public pool: Pool,
    public id: string
  ) {
    super(_root, ['shareclass', id])
  }

  /**
   * Query the details of the share class.
   * @returns The details of the share class, including name, symbol, total issuance, and NAV per share.
   */
  details() {
    return this._query(null, () =>
      combineLatest([this._metrics(), this._metadata()]).pipe(
        map(([metrics, metadata]) => {
          return {
            id: this.id,
            name: metadata.name,
            symbol: metadata.symbol,
            totalIssuance: metrics.totalIssuance,
            navPerShare: metrics.navPerShare,
          }
        })
      )
    )
  }

  /**
   * Query the vaults of the share class.
   * @param chainId The chain ID to query the vaults on.
   * @returns The vaults of the share class on the given chain.
   */
  vaults(chainId: number) {
    return this._query(null, () => new PoolNetwork(this._root, this.pool, chainId).vaults(this.id))
  }

  /** @internal */
  _metadata() {
    return this._query(['metadata'], () =>
      this.pool._shareClassManager().pipe(
        switchMap((scm) =>
          defer(async () => {
            const [name, symbol] = await this._root.getClient(this.pool.chainId)!.readContract({
              address: scm,
              abi: ABI.ShareClassManager,
              functionName: 'metadata',
              args: [this.id as any],
            })
            return {
              name,
              symbol,
            }
          }).pipe(
            repeatOnEvents(
              this._root,
              {
                address: scm,
                abi: ABI.ShareClassManager,
                eventName: 'UpdateMetadata',
                filter: (events) => {
                  return events.some((event) => {
                    return event.args.scId === this.id
                  })
                },
              },
              this.pool.chainId
            )
          )
        )
      )
    )
  }

  /** @internal */
  _metrics() {
    return this._query(['metrics'], () =>
      this.pool._shareClassManager().pipe(
        switchMap((scm) =>
          defer(async () => {
            const [totalIssuance, navPerShare] = await this._root.getClient(this.pool.chainId)!.readContract({
              address: scm,
              abi: ABI.ShareClassManager,
              functionName: 'metrics',
              args: [this.id as any],
            })
            return {
              totalIssuance: new Balance(totalIssuance, 18),
              navPerShare: new Balance(navPerShare, 18),
            }
          }).pipe(
            repeatOnEvents(
              this._root,
              {
                address: scm,
                abi: ABI.ShareClassManager,
                eventName: ['RevokeShares', 'IssueShares'],
                filter: (events) => {
                  return events.some((event) => {
                    return event.args.scId === this.id
                  })
                },
              },
              this.pool.chainId
            )
          )
        )
      )
    )
  }
}
