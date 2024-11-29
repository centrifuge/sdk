import { combineLatest, defer, map, switchMap } from 'rxjs'
import { getContract, toHex } from 'viem'
import { ABI } from './abi/index.js'
import type { Centrifuge } from './Centrifuge.js'
import { lpConfig } from './config/lp.js'
import { Entity } from './Entity.js'
import type { Pool } from './Pool.js'
import type { HexString } from './types/index.js'
import { repeatOnEvents } from './utils/rx.js'
import { doTransaction } from './utils/transaction.js'
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
   * Estimates the gas cost needed to bridge the message that results from a transaction.
   * @internal
   */
  _estimate() {
    return this._root._query(['estimate', this.chainId], () =>
      defer(() => {
        const bytes = toHex(new Uint8Array([0x12]))
        const { centrifugeRouter } = lpConfig[this.chainId]!
        return this._root.getClient(this.chainId)!.readContract({
          address: centrifugeRouter,
          abi: ABI.CentrifugeRouter,
          functionName: 'estimate',
          args: [bytes],
        }) as Promise<bigint>
      })
    )
  }

  /**
   * Get the contract address of the share token.
   * @internal
   */
  _share(trancheId: string) {
    return this._query(['share'], () =>
      this._poolManager().pipe(
        switchMap((poolManager) =>
          defer(
            () =>
              this._root.getClient(this.chainId)!.readContract({
                address: poolManager,
                abi: ABI.PoolManager,
                functionName: 'getTranche',
                args: [this.pool.id, trancheId],
              }) as Promise<HexString>
          ).pipe(
            repeatOnEvents(
              this._root,
              {
                address: poolManager,
                abi: ABI.PoolManager,
                eventName: 'DeployTranche',
                filter: (events) => {
                  return events.some(
                    (event) => String(event.args.poolId) === this.pool.id && event.args.trancheId === trancheId
                  )
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
   * @param trancheId - The tranche ID
   */
  shareCurrency(trancheId: string) {
    return this._query(null, () =>
      this._share(trancheId).pipe(switchMap((share) => this._root.currency(share, this.chainId)))
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
                  return events.some(
                    (event) => String(event.args.poolId) === this.pool.id && event.args.trancheId === trancheId
                  )
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

  /**
   * Get whether a pool is active and the tranche token can be deployed.
   * @param trancheId - The tranche ID
   */
  canTrancheBeDeployed(trancheId: string) {
    return this._query(['canTrancheBeDeployed'], () =>
      this._poolManager().pipe(
        switchMap((manager) => {
          return defer(
            () =>
              this._root.getClient(this.chainId)!.readContract({
                address: manager,
                abi: ABI.PoolManager,
                functionName: 'canTrancheBeDeployed',
                args: [this.pool.id, trancheId],
              }) as Promise<boolean>
          ).pipe(
            repeatOnEvents(
              this._root,
              {
                address: manager,
                abi: ABI.PoolManager,
                eventName: 'DeployTranche',
                filter: (events) => {
                  return events.some(
                    (event) => String(event.args.poolId) === this.pool.id && event.args.trancheId === trancheId
                  )
                },
              },
              this.chainId
            )
          )
        })
      )
    )
  }

  /**
   * Deploy a tranche token for the pool.
   * @param trancheId - The tranche ID
   */
  deployTranche(trancheId: string) {
    const self = this
    return this._transactSequence(async function* ({ walletClient, publicClient }) {
      const [poolManager, canTrancheBeDeployed] = await Promise.all([
        self._poolManager(),
        self.canTrancheBeDeployed(trancheId),
      ])
      if (!canTrancheBeDeployed) throw new Error('Pool is not active on this network')
      yield* doTransaction('Deploy Tranche', publicClient, () =>
        walletClient.writeContract({
          address: poolManager,
          abi: ABI.PoolManager,
          functionName: 'deployTranche',
          args: [self.pool.id, trancheId],
        })
      )
    }, this.chainId)
  }

  /**
   * Deploy a vault for a specific tranche x currency combination.
   * @param trancheId - The tranche ID
   * @param currencyAddress - The investment currency address
   */
  deployVault(trancheId: string, currencyAddress: string) {
    const self = this
    return this._transactSequence(async function* ({ walletClient, publicClient }) {
      const [poolManager, trancheToken] = await Promise.all([self._poolManager(), self._share(trancheId)])
      if (!trancheToken) throw new Error('Pool is not active on this network')
      yield* doTransaction('Deploy Vault', publicClient, () =>
        walletClient.writeContract({
          address: poolManager,
          abi: ABI.PoolManager,
          functionName: 'deployVault',
          args: [self.pool.id, trancheId, currencyAddress],
        })
      )
    }, this.chainId)
  }
}
