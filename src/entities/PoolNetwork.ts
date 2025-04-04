import { combineLatest, defer, map, switchMap } from 'rxjs'
import { getContract, toHex } from 'viem'
import { ABI } from '../abi/index.js'
import type { Centrifuge } from '../Centrifuge.js'
import { lpConfig } from '../config/lp.js'
import type { HexString } from '../types/index.js'
import { repeatOnEvents } from '../utils/rx.js'
import { Entity } from './Entity.js'
import type { Pool } from './Pool.js'
import { Vault } from './Vault.js'

/**
 * Query and interact with a pool on a specific network.
 */
export class PoolNetwork extends Entity {
  /** @internal */
  constructor(
    _root: Centrifuge,
    public pool: Pool,
    public chainId: number
  ) {
    super(_root, ['pool', pool.id, 'network', chainId])
  }

  /**
   * Estimates the gas cost needed to bridge the message from the Vaults side to the Pool side,
   * that results from a transaction
   * @internal
   */
  _estimate() {
    return this._root._query(['estimate', this.chainId, this.pool.chainId], () =>
      defer(() => {
        const bytes = toHex(new Uint8Array([0x12]))
        const { centrifugeRouter } = lpConfig[this.chainId]!
        return this._root.getClient(this.chainId)!.readContract({
          address: centrifugeRouter,
          abi: ABI.VaultRouter,
          functionName: 'estimate',
          args: [this.pool.chainId, bytes],
        }) as Promise<bigint>
      })
    )
  }

  /**
   * Get the contract address of the share token.
   * @internal
   */
  _share(scId: string) {
    return this._query(['share'], () =>
      this._root._protocolAddresses(this.chainId).pipe(
        switchMap(({ vaultRouter }) =>
          defer(
            () =>
              this._root.getClient(this.chainId)!.readContract({
                address: vaultRouter,
                abi: ABI.PoolManager,
                functionName: 'getTranche',
                args: [this.pool.id as any, scId as any],
              }) as Promise<HexString>
          ).pipe(
            repeatOnEvents(
              this._root,
              {
                address: vaultRouter,
                abi: ABI.PoolManager,
                eventName: 'DeployTranche',
                filter: (events) => {
                  return events.some((event) => String(event.args.poolId) === this.pool.id && event.args.scId === scId)
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
   * Get the details of the share token.
   * @param scId - The share class ID
   */
  shareCurrency(scId: string) {
    return this._query(null, () =>
      this._share(scId).pipe(switchMap((share) => this._root.currency(share, this.chainId)))
    )
  }

  /**
   * Get the deployed Vaults for a given tranche. There may exist one Vault for each allowed investment currency.
   * Vaults are used to submit/claim investments and redemptions.
   * @param scId - The share class ID
   */
  vaults(scId: string) {
    return this._query(['vaults', scId], () =>
      this._root._protocolAddresses(this.chainId).pipe(
        switchMap(({ poolManager, vaultRouter }) =>
          defer(async () => {
            const { currencies } = lpConfig[this.chainId]!
            if (!currencies.length) return []
            const contract = getContract({
              address: vaultRouter,
              abi: ABI.VaultRouter,
              client: this._root.getClient(this.chainId)!,
            })
            const results = await Promise.allSettled(
              currencies.map(async (curAddr) => {
                const vaultAddr = await contract.read.getVault!([this.pool.id as any, scId as any, curAddr])
                return new Vault(this._root, this, scId, curAddr, vaultAddr)
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
                  return events.some((event) => String(event.args.poolId) === this.pool.id && event.args.scId === scId)
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
   * @returns An object of share class ID to Vault.
   */
  vaultsByShareClass() {
    return this._query<Record<string, Vault>>(null, () =>
      this.pool.shareClassIds().pipe(
        switchMap((scId) => {
          return combineLatest(scId.map((scId) => this.vaults(scId))).pipe(
            map((vaults) => Object.fromEntries(vaults.flat().map((vault, index) => [scId[index], vault])))
          )
        })
      )
    )
  }

  /**
   * Get a specific Vault for a given tranche and investment currency.
   * @param scId - The share class ID
   * @param asset - The investment currency address
   */
  vault(scId: string, asset: string) {
    const assetAddress = asset.toLowerCase()
    return this._query(null, () =>
      this.vaults(scId).pipe(
        map((vaults) => {
          const vault = vaults.find((v) => v._asset === assetAddress)
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
      this._root._protocolAddresses(this.chainId).pipe(
        switchMap(({ poolManager }) => {
          return defer(
            () =>
              this._root.getClient(this.chainId)!.readContract({
                address: poolManager,
                abi: ABI.PoolManager,
                functionName: 'isPoolActive',
                args: [this.pool.id as any],
              }) as Promise<boolean>
          ).pipe(
            repeatOnEvents(
              this._root,
              {
                address: poolManager,
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

  // /**
  //  * Get whether a pool is active and the tranche token can be deployed.
  //  * @param scId - The share class ID
  //  */
  // canTrancheBeDeployed(scId: string) {
  //   return this._query(['canTrancheBeDeployed'], () =>
  //     this._poolManager().pipe(
  //       switchMap((manager) => {
  //         return defer(
  //           () =>
  //             this._root.getClient(this.chainId)!.readContract({
  //               address: manager,
  //               abi: ABI.PoolManager,
  //               functionName: 'canTrancheBeDeployed',
  //               args: [this.pool.id as any, scId as any],
  //             }) as Promise<boolean>
  //         ).pipe(
  //           repeatOnEvents(
  //             this._root,
  //             {
  //               address: manager,
  //               abi: ABI.PoolManager,
  //               eventName: 'DeployTranche',
  //               filter: (events) => {
  //                 return events.some((event) => String(event.args.poolId) === this.pool.id && event.args.scId === scId)
  //               },
  //             },
  //             this.chainId
  //           )
  //         )
  //       })
  //     )
  //   )
  // }

  // /**
  //  * Deploy a tranche token for the pool.
  //  * @param scId - The share class ID
  //  */
  // deployTranche(scId: string) {
  //   const self = this
  //   return this._transactSequence(async function* ({ walletClient, publicClient }) {
  //     const [poolManager, canTrancheBeDeployed] = await Promise.all([
  //       self._poolManager(),
  //       self.canShareClassBeDeployed(scId),
  //     ])
  //     if (!canTrancheBeDeployed) throw new Error('Pool is not active on this network')
  //     yield* doTransaction('Deploy tranche', publicClient, () =>
  //       walletClient.writeContract({
  //         address: poolManager,
  //         abi: ABI.PoolManager,
  //         functionName: 'deployTranche',
  //         args: [self.pool.id as any, scId as any, trancheFactory],
  //       })
  //     )
  //   }, this.chainId)
  // }

  // /**
  //  * Deploy a vault for a specific tranche x currency combination.
  //  * @param scId - The share class ID
  //  * @param currencyAddress - The investment currency address
  //  */
  // deployVault(scId: string, currencyAddress: string) {
  //   const self = this
  //   return this._transactSequence(async function* ({ walletClient, publicClient }) {
  //     const [poolManager, trancheToken] = await Promise.all([self._poolManager(), self._share(scId)])
  //     if (!trancheToken) throw new Error('Pool is not active on this network')
  //     yield* doTransaction('Deploy vault', publicClient, () =>
  //       walletClient.writeContract({
  //         address: poolManager,
  //         abi: ABI.PoolManager,
  //         functionName: 'deployVault',
  //         args: [self.pool.id as any, scId as any, currencyAddress as any],
  //       })
  //     )
  //   }, this.chainId)
  // }
}
