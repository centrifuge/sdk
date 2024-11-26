import { combineLatest, defer, map, switchMap } from 'rxjs'
import { getContract } from 'viem'
import { ABI } from './abi/index.js'
import type { Centrifuge } from './Centrifuge.js'
import { lpConfig } from './config/lp.js'
import { Entity } from './Entity.js'
import type { Pool } from './Pool.js'
import type { HexString } from './types/index.js'
import { repeatOnEvents } from './utils/rx.js'
import { Vault } from './Vault.js'

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

  /**
   * Get the deployed Vaults for a given tranche. There may exist one Vault for each allowed investment currency.
   * Vaults are used to submit/claim investments and redemptions.
   * @param trancheId - The tranche ID
   */
  vaults(trancheId: string) {
    return this._query(['vaults', trancheId], () =>
      this._poolManager().pipe(
        switchMap((poolManager) =>
          defer(async () => {
            const { currencies } = lpConfig[this.chainId]!
            if (!currencies.length) return []
            const contract = getContract({
              address: poolManager,
              abi: ABI.PoolManager,
              client: this._root.getClient(this.chainId)!,
            })
            const results = await Promise.allSettled(
              currencies.map(async (curAddr) => {
                const vaultAddr = (await contract.read.getVault!([this.pool.id, trancheId, curAddr])) as HexString
                return new Vault(this._root, this, trancheId, curAddr, vaultAddr)
              })
            )
            return results.filter((result) => result.status === 'fulfilled').map((result) => result.value)
          }).pipe(
            repeatOnEvents(
              this._root,
              {
                address: poolManager,
                abi: ABI.PoolManager,
                eventName: 'DeployVault',
                filter: (events) => {
                  return events.some((event) => {
                    return String(event.args.poolId) === this.pool.id || event.args.trancheId === trancheId
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

  /**
   * Get all Vaults for all tranches in the pool.
   */
  vaultsByTranche() {
    return this._query(null, () =>
      this.pool.trancheIds().pipe(
        switchMap((tranches) => {
          return combineLatest(tranches.map((trancheId) => this.vaults(trancheId))).pipe(
            map((vaults) => Object.fromEntries(vaults.flat().map((vault, index) => [tranches[index], vault])))
          )
        })
      )
    )
  }

  /**
   * Get a specific Vault for a given tranche and investment currency.
   * @param trancheId - The tranche ID
   * @param asset - The investment currency address
   */
  vault(trancheId: string, asset: string) {
    return this._query(null, () =>
      this.vaults(trancheId).pipe(
        map((vaults) => {
          const vault = vaults.find((v) => v._asset === asset)
          if (!vault) throw new Error('Vault not found')
          return vault
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
