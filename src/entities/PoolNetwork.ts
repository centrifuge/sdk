import { combineLatest, concat, defer, firstValueFrom, ignoreElements, map, of, switchMap } from 'rxjs'
import { encodeAbiParameters, encodeFunctionData, getContract, maxUint128 } from 'viem'
import { ABI } from '../abi/index.js'
import type { Centrifuge } from '../Centrifuge.js'
import { NULL_ADDRESS, SAFE_PROXY_BYTECODE } from '../constants.js'
import { HexString } from '../types/index.js'
import { MessageType, MessageTypeWithSubType, VaultUpdateKind } from '../types/transaction.js'
import type { OperationStatus, TransactionContext } from '../types/transaction.js'
import { addMessageForEnabledTarget, assertCrosschainMessagingEnabled } from '../utils/crosschainHotfix.js'
import { addressesEqual } from '../utils/addresses.js'
import { addressToBytes32, encode } from '../utils/index.js'
import { isPoolWired, waitForPoolAdapters, type PoolAdapterState } from '../utils/poolAdapters.js'
import { makeThenable, repeatOnEvents } from '../utils/rx.js'
import { doTransaction, parseEventLogs, wrapTransaction } from '../utils/transaction.js'
import type { Query } from '../types/query.js'
import { AssetId, CentrifugeId, ShareClassId } from '../utils/types.js'
import { BalanceSheet } from './BalanceSheet.js'
import { Entity } from './Entity.js'
import { MerkleProofManager } from './MerkleProofManager.js'
import { OnchainPM } from './OnchainPM.js'
import { OnOffRampManager } from './OnOffRampManager.js'
import type { OnOfframpManagerStatus, Pool } from './Pool.js'
import { ShareClass } from './ShareClass.js'

/**
 * Hub call that sets a pool-wide `AccountingToken` minter flag, routed through the spoke's `contractUpdater`.
 * `scId` only has to exist on the hub.
 */
function encodeAccountingTokenMinterGrant({
  poolId,
  scId,
  centrifugeId,
  accountingToken,
  who,
  refund,
}: {
  poolId: bigint
  scId: HexString
  centrifugeId: CentrifugeId
  accountingToken: HexString
  who: HexString
  refund: HexString
}) {
  return encodeFunctionData({
    abi: ABI.Hub,
    functionName: 'updateContract',
    args: [
      poolId,
      scId,
      centrifugeId,
      addressToBytes32(accountingToken),
      encodeAbiParameters([{ type: 'bytes32' }, { type: 'bool' }], [addressToBytes32(who), true]),
      0n,
      refund,
    ],
  })
}

function resolveOnOffRampFactory(
  {
    onOffRampFactory,
    onOfframpManagerFactory,
  }: { onOffRampFactory?: HexString | null; onOfframpManagerFactory?: HexString | null },
  centrifugeId: CentrifugeId
): HexString {
  const factory = onOffRampFactory ?? onOfframpManagerFactory
  if (!factory) {
    throw new Error(`No on/off-ramp manager factory is deployed for centrifugeId ${centrifugeId}`)
  }
  return factory
}

function missingAccountingTokenError(centrifugeId: CentrifugeId) {
  return new Error(
    `On/off-ramp minter grant needs an accountingToken, but the deployments for centrifugeId ${centrifugeId} list none`
  )
}

/**
 * Newest indexed on/off-ramp: highest `createdAtBlock`, ties broken by the highest lowercase address
 * so every caller picks the same row.
 */
function newestOnOffRamp<T extends { address: string; createdAtBlock: number }>(rows: T[]): T | undefined {
  return [...rows].sort((a, b) => {
    if (a.createdAtBlock !== b.createdAtBlock) return b.createdAtBlock - a.createdAtBlock
    const [addressA, addressB] = [a.address.toLowerCase(), b.address.toLowerCase()]
    if (addressA === addressB) return 0
    return addressA < addressB ? 1 : -1
  })[0]
}

export enum VaultManagerTrustedCall {
  Valuation,
  MaxReserve,
}

/** The indexer's name for the LayerZero adapter, the only one `deploy` wires a pool through today. */
const LAYER_ZERO_ADAPTER_NAME = 'layerZero'

/** The indexer rows behind a pool's adapter wiring in one direction. */
const POOL_ADAPTERS_QUERY = `query ($poolId: BigInt!, $local: String!, $remote: String!) {
  poolAdapters(where: { poolId: $poolId, localCentrifugeId: $local, remoteCentrifugeId: $remote }) {
    items {
      isEnabled
      crosschainInProgress
      adapter {
        name
      }
    }
  }
}`

/**
 * Query and interact with a pool on a specific network.
 */
export class PoolNetwork extends Entity {
  constructor(
    _root: Centrifuge,
    public pool: Pool,
    public centrifugeId: CentrifugeId
  ) {
    super(_root, ['poolnetwork', pool.id.toString(), centrifugeId])
  }

  /**
   * Query the details of the pool on a network.
   * @returns The details, including whether the pool is active, whether any of the share classes have been deployed,
   * and any deployed vaults.
   */
  details() {
    return this._query(['poolNetworkDetails'], () =>
      this.pool.shareClasses().pipe(
        switchMap((shareClasses) => {
          return combineLatest([
            this.isActive(),
            this._vaultsByShareClass(),
            ...shareClasses.map((sc) => this._share(sc.id, false)),
          ]).pipe(
            map(([isActive, vaultsByShareClass, ...shareTokens]) => {
              return {
                isActive,
                activeShareClasses: shareClasses
                  .filter((_, i) => shareTokens[i] !== NULL_ADDRESS)
                  .map((sc, i) => {
                    return {
                      shareClass: sc,
                      id: sc.id,
                      shareToken: shareTokens[i]!,
                      vaults: vaultsByShareClass[sc.id.raw] ?? [],
                    }
                  }),
              }
            })
          )
        })
      )
    )
  }

  balanceSheet(scId: ShareClassId) {
    return this._query(['balanceSheet', scId.toString()], () =>
      of(new BalanceSheet(this._root, this, new ShareClass(this._root, this.pool, scId.raw)))
    )
  }

  /**
   * Get the details of the share token.
   * @param scId - The share class ID
   */
  shareCurrency(scId: ShareClassId) {
    return this._query(['shareCurrency', scId.toString()], () =>
      this._share(scId).pipe(switchMap((share) => this._root.currency(share, this.centrifugeId)))
    )
  }

  /**
   * Get the deployed Vaults for a given share class. There may exist one Vault for each allowed investment currency.
   * Vaults are used to submit/claim investments and redemptions.
   * @param scId - The share class ID
   * @param includeUnlinked - Whether to include unlinked vaults
   */
  vaults(scId: ShareClassId, includeUnlinked = false) {
    return this._query(['vaults', scId.toString(), includeUnlinked.toString()], () =>
      this._root.pool(this.pool.id).pipe(
        switchMap((pool) => pool.shareClass(scId)),
        switchMap((shareClass) => shareClass.vaults(this.centrifugeId, includeUnlinked))
      )
    )
  }

  /**
   * Get a specific Vault for a given share class and investment currency.
   * @param scId - The share class ID
   * @param asset - The investment currency address or asset ID
   */
  vault(scId: ShareClassId, asset: HexString | AssetId) {
    return this._query(['vault', scId.toString(), asset.toString()], () =>
      combineLatest([
        this.vaults(scId),
        typeof asset === 'string' ? of({ address: asset, tokenId: 0n }) : this._root.assetCurrency(asset),
      ]).pipe(
        map(([vaults, { address }]) => {
          const addr = address.toLowerCase()
          const vault = vaults.find((v) => v._asset === addr)
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
      combineLatest([this._root._protocolAddresses(this.centrifugeId), this._root.getClient(this.centrifugeId)]).pipe(
        switchMap(([{ spoke }, client]) => {
          return defer(
            () =>
              client.readContract({
                address: spoke,
                abi: ABI.Spoke,
                functionName: 'isPoolActive',
                args: [this.pool.id.raw],
              }) as Promise<boolean>
          ).pipe(
            repeatOnEvents(
              this._root,
              {
                address: spoke,
                eventName: 'AddPool',
                filter: (events) => {
                  return events.some((event) => {
                    return event.args.poolId === this.pool.id
                  })
                },
              },
              this.centrifugeId
            )
          )
        })
      )
    )
  }

  merkleProofManager() {
    return this._query(['merkleProofManager'], () =>
      this._deployedMerkleProofManagerAddress().pipe(
        map((address) => {
          if (!address) {
            throw new Error('MerkleProofManager not found')
          }

          return new MerkleProofManager(this._root, this, address)
        })
      )
    )
  }

  /**
   * Returns the OnchainPM entity for this pool on this chain,
   * or null if one has not been deployed yet.
   *
   * `OnchainPMFactory.getAddress(poolId)` is a pure CREATE2 calculation that
   * always returns the predicted address regardless of deployment. We must
   * additionally check that there's actually bytecode at that address before
   * returning an entity — otherwise downstream calls revert with empty data.
   */
  onchainPM() {
    return this._query(['onchainPM'], () =>
      combineLatest([this._root._protocolAddresses(this.centrifugeId), this._root.getClient(this.centrifugeId)]).pipe(
        switchMap(([{ onchainPMFactory }, client]) =>
          defer(async () => {
            // Chains without an OnchainPM deployment return no factory from the indexer.
            // Bail out early — a readContract without address is sent as an eth_call
            // without `to` and fails with an opaque EVM StackUnderflow.
            if (!onchainPMFactory) return null
            const address = await client.readContract({
              address: onchainPMFactory,
              abi: ABI.OnchainPMFactory,
              functionName: 'getAddress',
              args: [this.pool.id.raw],
            })
            if (!address || address === NULL_ADDRESS) return null
            const code = await client.getCode({ address })
            if (!code || code === '0x') return null
            return new OnchainPM(this._root, this, address)
          })
        )
      )
    )
  }

  /**
   * Deploy an OnchainPM for this pool on this chain via OnchainPMFactory.
   *
   * Permissionless — anyone can call this. Idempotent: if one is already deployed
   * the transaction is skipped and the existing address is yielded immediately.
   *
   * Emits `{ type: 'DeployedOnchainPM', address }` on completion.
   */
  deployOnchainPM() {
    const self = this

    return this._transact(async function* (ctx) {
      const { onchainPMFactory } = await self._root._protocolAddresses(self.centrifugeId)
      if (!onchainPMFactory) {
        throw new Error(
          `OnchainPM is not available on centrifugeId ${self.centrifugeId} — no OnchainPMFactory is deployed on this network`
        )
      }

      // factory.getAddress() is a pure CREATE2 calculation — it returns the predicted
      // address whether or not the contract was actually deployed. We must also check
      // there's code at that address before treating it as already-deployed.
      const predictedAddress = (await ctx.publicClient.readContract({
        address: onchainPMFactory,
        abi: ABI.OnchainPMFactory,
        functionName: 'getAddress',
        args: [self.pool.id.raw],
      })) as HexString

      if (predictedAddress && predictedAddress !== NULL_ADDRESS) {
        const code = await ctx.publicClient.getCode({ address: predictedAddress })
        if (code && code !== '0x') {
          yield { type: 'DeployedOnchainPM', address: predictedAddress } as const
          return
        }
      }

      const result = yield* doTransaction('Deploy onchain PM', ctx, () =>
        ctx.walletClient.writeContract({
          address: onchainPMFactory,
          abi: ABI.OnchainPMFactory,
          functionName: 'newOnchainPM',
          args: [self.pool.id.raw],
        })
      )

      const events = parseEventLogs({
        logs: result.receipt.logs,
        eventName: 'DeployOnchainPM',
        address: onchainPMFactory,
      })

      const deployEvent = events[0]
      const args = deployEvent?.args as { manager?: HexString } | undefined
      if (!args?.manager) {
        throw new Error('DeployOnchainPM event not found in transaction receipt')
      }

      yield { type: 'DeployedOnchainPM', address: args.manager } as const
    }, self.centrifugeId)
  }

  /**
   * Authorize a deployed OnchainPM for this pool. Registers it as a Balance
   * Sheet Manager on the hub chain and, in the same batched transaction, grants
   * it minter rights on the pool's accounting token (workflows that mint/burn
   * accounting tokens need this).
   *
   * Both calls are batched into a single `Hub` transaction signed on the hub
   * chain. The minter grant is routed `Hub.updateContract` → Spoke
   * `contractUpdater` → `AccountingToken.trustedCall`, which decodes
   * `abi.encode(bytes32 who, bool canMint)`.
   *
   * @param managerAddress - The deployed OnchainPM contract address
   * @param scId - Share class used for the accounting-token `updateContract`
   *   routing. The minter mapping is pool-wide, so any of the pool's share
   *   classes works; defaults to the pool's first share class.
   */
  authorizeOnchainPM(managerAddress: HexString, scId?: HexString) {
    const self = this
    return this._transact(async function* (ctx) {
      assertCrosschainMessagingEnabled(self.centrifugeId)

      const { hub } = await self._root._protocolAddresses(self.pool.centrifugeId)
      const { accountingToken } = await self._root._protocolAddresses(self.centrifugeId)
      if (!accountingToken) {
        throw new Error(
          `OnchainPM cannot be authorized on centrifugeId ${self.centrifugeId} — no AccountingToken is deployed on this network`
        )
      }

      const resolvedScId = scId ?? (await firstValueFrom(self.pool.shareClasses()))[0]?.id.raw
      if (!resolvedScId) {
        throw new Error('No share class found for pool to route the accounting-token minter update')
      }

      // 1. Register the OnchainPM as a balance sheet manager.
      const registerManagerCall = encodeFunctionData({
        abi: ABI.Hub,
        functionName: 'updateBalanceSheetManager',
        args: [self.pool.id.raw, self.centrifugeId, addressToBytes32(managerAddress), true, ctx.signingAddress],
      })

      // 2. Grant the OnchainPM minter rights on the accounting token.
      const grantMinterCall = encodeAccountingTokenMinterGrant({
        poolId: self.pool.id.raw,
        scId: resolvedScId,
        centrifugeId: self.centrifugeId,
        accountingToken,
        who: managerAddress,
        refund: ctx.signingAddress,
      })

      yield* wrapTransaction('Authorize onchain PM', ctx, {
        contract: hub,
        data: [registerManagerCall, grantMinterCall],
        messages: {
          [self.centrifugeId]: [
            { type: MessageType.UpdateBalanceSheetManager, poolId: self.pool.id },
            { type: MessageType.TrustedContractUpdate, poolId: self.pool.id },
          ],
        },
      })
    }, this.pool.centrifugeId)
  }

  /**
   * Compute the deterministic address for a Merkle Proof Manager before deployment.
   * @returns The predicted contract address
   */
  async computeMerkleProofManagerAddress(): Promise<HexString> {
    const { merkleProofManagerFactory } = await this._root._protocolAddresses(this.centrifugeId)
    const client = await this._root.getClient(this.centrifugeId)

    try {
      const { result } = await client.simulateContract({
        address: merkleProofManagerFactory,
        abi: ABI.MerkleProofManagerFactory,
        functionName: 'newManager',
        args: [this.pool.id.raw],
      })

      return result as HexString
    } catch (error) {
      throw new Error(
        `Failed to compute MerkleProofManager address: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  /**
   * Register a Merkle Proof Manager as a Balance Sheet Manager.
   * @param managerAddress - The manager's contract address
   */
  registerMerkleProofManagerAsBSManager(managerAddress: HexString) {
    return this.pool.updateBalanceSheetManagers([
      {
        centrifugeId: this.centrifugeId,
        address: managerAddress,
        canManage: true,
      },
    ])
  }

  /**
   * Deploy a Merkle Proof Manager, or reuse an already deployed one, and register it as a Balance Sheet Manager.
   */
  deployMerkleProofManager() {
    const self = this
    let managerAddress: HexString | null = null

    const deployTransaction = this._transact(async function* (ctx) {
      managerAddress = await self._findDeployedMerkleProofManagerAddress()
      if (managerAddress) return

      const isSafeWallet = (await ctx.publicClient.getCode({ address: ctx.signingAddress })) === SAFE_PROXY_BYTECODE
      const { merkleProofManagerFactory } = await self._root._protocolAddresses(self.centrifugeId)
      const precomputedAddress = isSafeWallet ? await self.computeMerkleProofManagerAddress() : null

      const result = yield* doTransaction('AddMerkleProofManager', ctx, () =>
        ctx.walletClient.writeContract({
          address: merkleProofManagerFactory,
          abi: ABI.MerkleProofManagerFactory,
          functionName: 'newManager',
          args: [self.pool.id.raw],
        })
      )

      if (precomputedAddress) {
        managerAddress = precomputedAddress
        return
      }

      const events = parseEventLogs({
        logs: result.receipt.logs,
        eventName: 'DeployMerkleProofManager',
        address: merkleProofManagerFactory,
      })

      const deployEvent = events[0]
      const args = deployEvent?.args as { manager?: HexString } | undefined
      if (!args?.manager) {
        throw new Error('DeployMerkleProofManager event not found')
      }

      managerAddress = args.manager
    }, self.centrifugeId)

    const registerTransaction = defer(() => {
      if (!managerAddress) {
        throw new Error('MerkleProofManager not found')
      }

      return self.registerMerkleProofManagerAsBSManager(managerAddress)
    })

    const transaction = makeThenable(concat(deployTransaction, registerTransaction), true)
    return Object.assign(transaction, { centrifugeId: self.centrifugeId })
  }

  /**
   * Get the OnOffRampManager for a given share class.
   * @param scId - The share class ID
   * @returns The OnOffRampManager
   */
  onOfframpManager(scId: ShareClassId) {
    return this._query(['onOfframpManager', scId.toString()], () =>
      combineLatest([this._deployedOnOffRampManagers(scId), this.pool.balanceSheetManagers()]).pipe(
        map(([deployedOnOffRampManagers, balanceSheetManagers]) => {
          if (!deployedOnOffRampManagers.length) {
            throw new Error('OnOffRampManager not found')
          }

          const bsManagerAddresses = new Set(
            balanceSheetManagers.filter((m) => m.centrifugeId === this.centrifugeId).map((m) => m.address.toLowerCase())
          )
          const verifiedManagers = deployedOnOffRampManagers.filter((deployed) =>
            bsManagerAddresses.has(deployed.address.toLowerCase())
          )

          if (!verifiedManagers.length) {
            throw new Error('OnOffRampManager not found in balance sheet managers')
          }

          const verifiedManager = newestOnOffRamp(verifiedManagers)!

          return new OnOffRampManager(
            this._root,
            this,
            new ShareClass(this._root, this.pool, scId.raw),
            verifiedManager.address
          )
        })
      )
    )
  }

  /**
   * Per-deployed-address live + in-flight balance sheet manager state for
   * OnOffRampManagers on this network, from the indexer. Unlike
   * `onOfframpManager()` — which only resolves once a manager is confirmed live,
   * for use in transactions — this also surfaces a manager whose grant/revoke is
   * still in transit, for display purposes. Returns `[]` if none are deployed.
   * Rows come in indexer order and are not reduced to the newest.
   * @param scId - The share class ID
   */
  onOfframpManagerStatus(scId: ShareClassId): Query<OnOfframpManagerStatus[]> {
    return this._query(['onOfframpManagerStatus', scId.toString()], () =>
      combineLatest([this._deployedOnOffRampManagers(scId), this.pool.balanceSheetManagerStatus()]).pipe(
        map(([deployedOnOffRampManagers, managerStatus]) => {
          const statusByAddress = new Map(
            managerStatus
              .filter((manager) => manager.centrifugeId === this.centrifugeId)
              .map((manager) => [manager.address.toLowerCase(), manager])
          )

          return deployedOnOffRampManagers.map((deployed) => {
            const status = statusByAddress.get(deployed.address.toLowerCase())
            return {
              address: deployed.address,
              centrifugeId: this.centrifugeId,
              isBalancesheetManager: status?.isBalancesheetManager ?? false,
              crosschainInProgress: status?.crosschainInProgress ?? null,
            }
          })
        })
      )
    )
  }

  /**
   * Register the newest indexed OnOffRampManager of a share class as a Balance Sheet Manager.
   * Fails with a descriptive error, before anything is signed, when none is indexed or the newest is already
   * registered; use `registerOnOffRampManagerAsBSManager` to re-send the grant for a registered ramp.
   *
   * On a network whose deployments list `onOffRampFactory`, the same hub transaction also grants the
   * manager minter rights on the accounting token (see {@link registerOnOffRampManagerAsBSManager}).
   * @param scId - The share class ID
   * @throws If no ramp is indexed, the newest is already registered, the network lists `onOffRampFactory` but no
   *   `accountingToken`, or cross-chain messaging is disabled for the network; nothing is signed.
   */
  assignOnOffRampManagerPermissions(scId: ShareClassId) {
    const self = this
    return this._transact(async function* (ctx) {
      const [ramps, balanceSheetManagers] = await Promise.all([
        firstValueFrom(self._deployedOnOffRampManagers(scId)),
        firstValueFrom(self.pool.balanceSheetManagers()),
      ])
      const newest = newestOnOffRamp(ramps)
      if (!newest) {
        throw new Error(
          `No on/off-ramp is indexed for share class ${scId.toString()} on centrifugeId ${self.centrifugeId}`
        )
      }

      const isRegistered = balanceSheetManagers.some(
        (manager) => manager.centrifugeId === self.centrifugeId && addressesEqual(manager.address, newest.address)
      )
      if (isRegistered) {
        throw new Error(
          `The newest on/off-ramp ${newest.address} is already a balance sheet manager on centrifugeId ${self.centrifugeId}; use registerOnOffRampManagerAsBSManager to re-send the grant`
        )
      }

      yield* self._registerOnOffRamp(ctx, newest.address, scId)
    }, this.pool.centrifugeId)
  }

  /**
   * Resolves the on/off-ramp factory address for this network, preferring the current
   * protocol factory over the legacy one some chains still run. Throws before any
   * simulate/write when neither is deployed.
   */
  private async _resolveOnOffRampFactory(): Promise<HexString> {
    return resolveOnOffRampFactory(await this._root._protocolAddresses(this.centrifugeId), this.centrifugeId)
  }

  /** Simulates `newManager` against an already-resolved factory address. */
  private async _computeOnOffRampManagerAddress(factory: HexString, scId: ShareClassId): Promise<HexString> {
    const client = await this._root.getClient(this.centrifugeId)

    try {
      const { result } = await client.simulateContract({
        address: factory,
        abi: ABI.OnOffRampManagerFactory,
        functionName: 'newManager',
        args: [this.pool.id.raw, scId.raw],
      })

      return result as HexString
    } catch (error) {
      throw new Error(
        `Failed to compute OnOffRampManager address: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  /**
   * Compute the deterministic address for an OnOffRampManager before deployment.
   * @param scId - The share class ID
   * @returns The predicted contract address
   * @throws If no on/off-ramp manager factory is deployed on this network.
   */
  async computeOnOffRampManagerAddress(scId: ShareClassId): Promise<HexString> {
    const factory = await this._resolveOnOffRampFactory()
    return this._computeOnOffRampManagerAddress(factory, scId)
  }

  /**
   * Deploy an On/Off Ramp Manager for a share class.
   * Yields the deployed manager address as a custom 'DeployedOnOfframpManager' status.
   * @param scId - The share class ID
   * @throws If no on/off-ramp manager factory is deployed on this network.
   */
  deployOnOfframpManager(scId: ShareClassId) {
    const self = this

    return this._transact(async function* (ctx) {
      const factory = await self._resolveOnOffRampFactory()

      const result = yield* doTransaction('DeployOnOfframpManager', ctx, () =>
        ctx.walletClient.writeContract({
          address: factory,
          abi: ABI.OnOffRampManagerFactory,
          functionName: 'newManager',
          args: [self.pool.id.raw, scId.raw],
        })
      )

      const events = parseEventLogs({
        logs: result.receipt.logs,
        eventName: ['DeployOnOffRamp', 'DeployOnOfframpManager'],
        address: factory,
      })

      const deployEvent = events[0]
      const args = deployEvent?.args as { manager?: HexString } | undefined
      if (!args?.manager) {
        throw new Error('DeployOnOfframpManager event not found')
      }

      const managerAddress = args.manager

      yield {
        type: 'DeployedOnOfframpManager',
        address: managerAddress,
      } as const
    }, self.centrifugeId)
  }

  /**
   * Register an On/Off Ramp Manager as a Balance Sheet Manager.
   * Use this with the address obtained from deployOnOfframpManager().
   *
   * On a network whose deployments list `onOffRampFactory`, the manager mints and burns the pool's
   * accounting token, so one hub transaction both registers it and grants it minter rights. Networks
   * with only the legacy factory get the plain balance sheet manager update.
   * @param managerAddress - The deployed manager's contract address
   * @param scId - The manager's share class. Required when the network lists `onOffRampFactory`; it routes
   *   the minter grant.
   * @throws If the network lists `onOffRampFactory` but no `accountingToken`, `scId` is missing, or cross-chain
   *   messaging is disabled for the network; nothing is signed.
   */
  registerOnOffRampManagerAsBSManager(managerAddress: HexString, scId?: ShareClassId) {
    const self = this
    return this._transact((ctx) => self._registerOnOffRamp(ctx, managerAddress, scId), this.pool.centrifugeId)
  }

  /** Shared body of register and assign; runs in the caller's hub-chain context so it stays buildable. */
  private async *_registerOnOffRamp(ctx: TransactionContext, managerAddress: HexString, scId?: ShareClassId) {
    const [{ onOffRampFactory, accountingToken }, { hub }] = await Promise.all([
      this._root._protocolAddresses(this.centrifugeId),
      this._root._protocolAddresses(this.pool.centrifugeId),
    ])
    const update = [{ centrifugeId: this.centrifugeId, address: managerAddress, canManage: true }]

    if (!onOffRampFactory) {
      const { data, messages } = this.pool._balanceSheetManagerUpdates(update, ctx.signingAddress)
      yield* wrapTransaction('Update balance sheet managers', ctx, { contract: hub, data, messages })
      return
    }

    const token = this._minterGrantToken(accountingToken)
    if (!scId) {
      throw new Error(
        `A share class id is required to register an on/off-ramp on centrifugeId ${this.centrifugeId}: it routes the accounting-token minter grant`
      )
    }
    const { data, messages } = this.pool._balanceSheetManagerUpdates(update, ctx.signingAddress)
    const grantMinterCall = encodeAccountingTokenMinterGrant({
      poolId: this.pool.id.raw,
      scId: scId.raw,
      centrifugeId: this.centrifugeId,
      accountingToken: token,
      who: managerAddress,
      refund: ctx.signingAddress,
    })
    addMessageForEnabledTarget(messages, this.centrifugeId, {
      type: MessageType.TrustedContractUpdate,
      poolId: this.pool.id,
    })
    yield* wrapTransaction('Register on/off-ramp manager', ctx, {
      contract: hub,
      data: [...data, grantMinterCall],
      messages,
    })
  }

  /** The one guard for registering a ramp with a minter grant; deploy runs it too, before anything is signed. */
  private _minterGrantToken(accountingToken: HexString | null | undefined): HexString {
    assertCrosschainMessagingEnabled(this.centrifugeId)
    if (!accountingToken) throw missingAccountingTokenError(this.centrifugeId)
    return accountingToken
  }

  /**
   * Deploy an On/Off Ramp Manager and register it as a Balance Sheet Manager. On a network whose
   * deployments list `onOffRampFactory`, the registration also grants it accounting-token minter
   * rights in the same hub transaction (see {@link registerOnOffRampManagerAsBSManager}).
   * @param scId
   * @throws If no on/off-ramp manager factory is deployed on this network, the network lists
   *   `onOffRampFactory` but no `accountingToken`, or cross-chain messaging is disabled for the network.
   *   On chains that list `onOffRampFactory` the latter two are raised before `newManager` is signed.
   */
  deployAndRegisterOnOffRampManager(scId: ShareClassId) {
    const self = this
    let managerAddress: HexString | null = null

    const deployTransaction = this._transact(async function* (ctx) {
      const addresses = await self._root._protocolAddresses(self.centrifugeId)
      managerAddress = await self._findDeployedOnOffRampManagerAddress(scId)
      if (managerAddress) return

      const code = await ctx.publicClient.getCode({ address: ctx.signingAddress })
      const isSafeWallet = code === SAFE_PROXY_BYTECODE
      const factory = resolveOnOffRampFactory(addresses, self.centrifugeId)
      const precomputedAddress = isSafeWallet ? await self._computeOnOffRampManagerAddress(factory, scId) : null

      const result = yield* doTransaction('DeployOnOfframpManager', ctx, () =>
        ctx.walletClient.writeContract({
          address: factory,
          abi: ABI.OnOffRampManagerFactory,
          functionName: 'newManager',
          args: [self.pool.id.raw, scId.raw],
        })
      )

      let finalManagerAddress: HexString
      if (isSafeWallet && precomputedAddress) {
        finalManagerAddress = precomputedAddress
      } else {
        const events = parseEventLogs({
          logs: result.receipt.logs,
          eventName: ['DeployOnOffRamp', 'DeployOnOfframpManager'],
          address: factory,
        })

        const deployEvent = events[0]
        const args = deployEvent?.args as { manager?: HexString } | undefined
        if (!args?.manager) {
          throw new Error('DeployOnOfframpManager event not found')
        }
        finalManagerAddress = args.manager
      }

      managerAddress = finalManagerAddress

      yield {
        type: 'DeployedOnOfframpManager',
        address: finalManagerAddress,
      } as const
    }, self.centrifugeId)

    const registerTransaction = defer(() => {
      if (!managerAddress) {
        throw new Error('DeployOnOfframpManager event not found')
      }
      return self.registerOnOffRampManagerAsBSManager(managerAddress, scId)
    })

    // Runs before the deploy transaction resolves the wallet, so a doomed registration prompts nothing.
    const preCheck = defer(async () => {
      const { onOffRampFactory, accountingToken } = await self._root._protocolAddresses(self.centrifugeId)
      if (onOffRampFactory) self._minterGrantToken(accountingToken)
    }).pipe(ignoreElements())

    const transaction = makeThenable(concat(preCheck, deployTransaction, registerTransaction), true)
    return Object.assign(transaction, { centrifugeId: self.centrifugeId })
  }

  private _deployedMerkleProofManagerAddress() {
    return this._root._queryIndexer(
      `query ($poolId: BigInt!, $centrifugeId: String!) {
        merkleProofManagers(where: {poolId: $poolId, centrifugeId: $centrifugeId}) {
          items {
            address
          }
        }
      }`,
      { poolId: this.pool.id.toString(), centrifugeId: this.centrifugeId.toString() },
      (data: {
        merkleProofManagers: {
          items: {
            address: HexString
          }[]
        }
      }) => (data.merkleProofManagers.items[0]?.address?.toLowerCase() as HexString | undefined) ?? null
    )
  }

  private _findDeployedMerkleProofManagerAddress() {
    return firstValueFrom(this._deployedMerkleProofManagerAddress())
  }

  private _deployedOnOffRampManagers(scId: ShareClassId) {
    return this._root._queryIndexer(
      `query ($scId: String!, $centrifugeId: String!) {
        onOffRampManagers(where: {tokenId: $scId, centrifugeId: $centrifugeId}) {
          items {
            address
            createdAtBlock
          }
        }
      }`,
      {
        scId: scId.toString(),
        centrifugeId: this.centrifugeId.toString(),
      },
      (data: {
        onOffRampManagers: {
          items: {
            address: HexString
            createdAtBlock: number
          }[]
        }
      }) =>
        data.onOffRampManagers.items.map((manager) => ({
          ...manager,
          address: manager.address.toLowerCase() as HexString,
        }))
    )
  }

  private async _findDeployedOnOffRampManagerAddress(scId: ShareClassId) {
    const managers = await firstValueFrom(this._deployedOnOffRampManagers(scId))
    return newestOnOffRamp(managers)?.address ?? null
  }

  /** The pool's adapter rows the indexer holds for one direction, fetched once, outside the memoised polling query. */
  async #readPoolAdapters(
    localCentrifugeId: CentrifugeId,
    remoteCentrifugeId: CentrifugeId
  ): Promise<PoolAdapterState[]> {
    const vars = {
      poolId: this.pool.id.toString(),
      local: String(localCentrifugeId),
      remote: String(remoteCentrifugeId),
    }
    const { poolAdapters } = await firstValueFrom(
      this._root._getIndexerObservable<{
        poolAdapters: {
          items: { isEnabled: boolean | null; crosschainInProgress: string | null; adapter: { name: string } | null }[]
        }
      }>(POOL_ADAPTERS_QUERY, vars)
    )
    return poolAdapters.items.map((row) => ({
      name: row.adapter?.name ?? 'unknown',
      isEnabled: !!row.isEnabled,
      crosschainInProgress: row.crosschainInProgress ?? null,
    }))
  }

  /** See {@link isPoolWired}; same-chain messages never go through adapters. */
  async #hasPoolAdapters(): Promise<boolean> {
    if (this.pool.centrifugeId === this.centrifugeId) return true
    const [onHub, onSpoke] = await Promise.all([
      this.#readPoolAdapters(this.pool.centrifugeId, this.centrifugeId),
      this.#readPoolAdapters(this.centrifugeId, this.pool.centrifugeId),
    ])
    return isPoolWired(onHub, onSpoke)
  }

  /**
   * Enable share classes on this network.
   * @param shareClasses - An array of share classes to enable
   */
  deployShareClasses(shareClasses: { id: ShareClassId; hook: HexString }[]) {
    return this.deploy(shareClasses, [])
  }

  /**
   * Deploy vaults for share classes that are already enabled on this network.
   * @param vaults - An array of vaults to deploy
   */
  deployVaults(
    vaults: {
      shareClassId: ShareClassId
      assetId: AssetId
      kind: 'async' | 'syncDeposit'
      factory?: HexString
    }[]
  ) {
    return this.deploy([], vaults)
  }

  /**
   * Enable and deploy share classes/vaults.
   * @param shareClasses - An array of share classes to enable
   * @param vaults - An array of vaults to deploy
   *
   * ## First activation on a network
   *
   * While the indexer shows no adapter wiring between the hub and this network
   * (both directions live, nothing in flight), the signing path sends TWO transactions:
   * `setAdapters` alone, then, once the indexer shows the destination holding exactly that set (an
   * `AwaitingCrosschainDelivery` status is emitted while it waits, typically some
   * minutes), the pool messages. Batching them in one transaction made the pool
   * messages reach the destination before its adapter configuration and fail with
   * `InvalidAdapter()`. Build mode refuses the first step instead of racing it.
   */
  deploy(
    shareClasses: { id: ShareClassId; hook: HexString }[],
    vaults: {
      shareClassId: ShareClassId
      assetId: AssetId
      kind: 'async' | 'syncDeposit'
      factory?: HexString
    }[]
  ) {
    const self = this
    return this._transact(async function* (ctx) {
      assertCrosschainMessagingEnabled(self.centrifugeId)

      const [hubContext, spokeContext, details, spokeClient] = await Promise.all([
        self._root._protocolAddresses(self.pool.centrifugeId),
        self._root._protocolAddresses(self.centrifugeId),
        self.details(),
        self._root.getClient(self.centrifugeId),
      ])
      const {
        hub,
        layerZeroAdapter: localLzAdapter,
        // axelarAdapter: localAxelarAdapter, // TODO: hotfix - always use LayerZero 1/1
        // wormholeAdapter: localWhAdapter,
      } = hubContext
      const {
        spoke,
        balanceSheet,
        syncDepositVaultFactory,
        asyncVaultFactory,
        syncManager,
        asyncRequestManager,
        batchRequestManager,
        layerZeroAdapter: remoteLzAdapter,
        // axelarAdapter: remoteAxelarAdapter, // TODO: hotfix - always use LayerZero 1/1
        // wormholeAdapter: remoteWhAdapter,
      } = spokeContext
      const balanceSheetContract = getContract({
        client: spokeClient,
        address: balanceSheet,
        abi: ABI.BalanceSheet,
      })
      const [isAsyncManagerSetOnBalanceSheet, isSyncManagerSetOnBalanceSheet, existingRequestManager, hasPoolAdapters] =
        await Promise.all([
          balanceSheetContract.read.manager([self.pool.id.raw, asyncRequestManager]),
          balanceSheetContract.read.manager([self.pool.id.raw, syncManager]),
          spokeClient.readContract({
            address: spoke,
            abi: ABI.Spoke,
            functionName: 'requestManager',
            args: [self.pool.id.raw],
          }),
          self.#hasPoolAdapters(),
        ])

      const batch: HexString[] = []
      const messageTypes: MessageTypeWithSubType[] = []

      // The destination's MultiAdapter rejects every message of a pool it has no adapters for.
      // `setAdapters` travels through the global adapters and the pool messages through the
      // pool's own, so sending both in one transaction races and the pool messages lose.
      // Send `setAdapters` alone and wait for the indexer to show the destination holding exactly that set.
      if (!hasPoolAdapters) {
        if (!localLzAdapter || !remoteLzAdapter) {
          throw new Error(
            `No LayerZero adapter is deployed on both centrifugeId ${self.pool.centrifugeId} and ` +
              `${self.centrifugeId}, so pool "${self.pool.id}" cannot be connected to this network`
          )
        }
        if (ctx.isBatching) {
          throw new Error(
            `Pool "${self.pool.id}" has no adapters on centrifugeId ${self.centrifugeId} yet. Setting them and ` +
              `deploying cannot be built as one transaction: the pool messages would reach the destination ` +
              `before the adapter configuration and be rejected. Run this deployment with a signer first, ` +
              `or build it again once the adapters are set on the destination.`
          )
        }
        // TODO: hotfix - always use LayerZero 1/1; re-enable Axelar when multi-adapter support is restored
        const setAdaptersMessages: MessageTypeWithSubType[] = [MessageType.SetPoolAdapters]
        const confirmed = yield* wrapTransaction('Set pool adapters', ctx, {
          data: encodeFunctionData({
            abi: ABI.Hub,
            functionName: 'setAdapters',
            args: [
              self.pool.id.raw,
              self.centrifugeId,
              [localLzAdapter],
              [addressToBytes32(remoteLzAdapter)],
              1, // threshold: always 1/1 with LayerZero
              1, // recovery index: always 1/1 with LayerZero
              ctx.signingAddress,
            ],
          }),
          contract: hub,
          messages: { [self.centrifugeId]: setAdaptersMessages },
        })
        if (!confirmed) throw new Error('Set pool adapters did not confirm')
        yield {
          id: confirmed.id,
          type: 'AwaitingCrosschainDelivery',
          title: 'Set pool adapters',
          hash: confirmed.receipt.transactionHash,
          fromCentrifugeId: self.pool.centrifugeId,
          toCentrifugeId: self.centrifugeId,
          messageTypes: setAdaptersMessages,
        } satisfies OperationStatus
        await waitForPoolAdapters(
          () => self.#readPoolAdapters(self.centrifugeId, self.pool.centrifugeId),
          [LAYER_ZERO_ADAPTER_NAME]
        )
      }

      // notifyPool must come before the other pool-related messages, because they depend on the pool
      // being active. Only do it on the first deployment to this chain: once any share class is
      // active here the pool is already registered, and re-notifying it (e.g. when deploying a second
      // share class to the same chain) reverts. `activeShareClasses` is treated as authoritative since
      // an active share class implies an active pool even if `isActive` lags.
      if (!details.isActive && details.activeShareClasses.length === 0) {
        batch.push(
          encodeFunctionData({
            abi: ABI.Hub,
            functionName: 'notifyPool',
            args: [self.pool.id.raw, self.centrifugeId, ctx.signingAddress],
          })
        )
        messageTypes.push({ type: MessageType.NotifyPool, poolId: self.pool.id })
      }

      // Set vault managers as balance sheet managers if not already set
      // Async manager is used by both async and sync deposit vaults, so set it when deploying any vault
      if (!isAsyncManagerSetOnBalanceSheet && vaults.length > 0) {
        batch.push(
          encodeFunctionData({
            abi: ABI.Hub,
            functionName: 'updateBalanceSheetManager',
            args: [
              self.pool.id.raw,
              self.centrifugeId,
              addressToBytes32(asyncRequestManager),
              true,
              ctx.signingAddress,
            ],
          })
        )
        messageTypes.push({ type: MessageType.UpdateBalanceSheetManager, poolId: self.pool.id })
      }
      if (!isSyncManagerSetOnBalanceSheet && vaults.some((v) => v.kind === 'syncDeposit')) {
        batch.push(
          encodeFunctionData({
            abi: ABI.Hub,
            functionName: 'updateBalanceSheetManager',
            args: [self.pool.id.raw, self.centrifugeId, addressToBytes32(syncManager), true, ctx.signingAddress],
          })
        )
        messageTypes.push({ type: MessageType.UpdateBalanceSheetManager, poolId: self.pool.id })
      }

      if (existingRequestManager === NULL_ADDRESS) {
        batch.push(
          encodeFunctionData({
            abi: ABI.Hub,
            functionName: 'setRequestManager',
            args: [
              self.pool.id.raw,
              self.centrifugeId,
              batchRequestManager,
              addressToBytes32(asyncRequestManager),
              ctx.signingAddress,
            ],
          })
        )
        messageTypes.push({ type: MessageType.SetRequestManager, poolId: self.pool.id })
      }

      const enabledShareClasses = new Set(details.activeShareClasses.map((sc) => sc.id.raw))

      for (const sc of shareClasses) {
        if (details.activeShareClasses.some((activeSc) => activeSc.id.equals(sc.id.raw))) {
          console.warn(`Share class "${sc.id}" is already active in pool "${self.pool.id}"`)
          continue
        }

        enabledShareClasses.add(sc.id.raw)
        batch.push(
          encodeFunctionData({
            abi: ABI.Hub,
            functionName: 'notifyShareClass',
            args: [self.pool.id.raw, sc.id.raw, self.centrifugeId, addressToBytes32(sc.hook), ctx.signingAddress],
          })
        )
        messageTypes.push({ type: MessageType.NotifyShareClass, poolId: self.pool.id })
      }

      for (const vault of vaults) {
        if (!enabledShareClasses.has(vault.shareClassId.raw)) {
          throw new Error(`Share class "${vault.shareClassId.raw}" is not enabled in pool "${self.pool.id.raw}"`)
        }

        const factoryAddress = vault.factory
          ? vault.factory
          : vault.kind === 'syncDeposit'
            ? syncDepositVaultFactory
            : asyncVaultFactory

        if (vault.kind === 'syncDeposit') {
          batch.push(
            encodeFunctionData({
              abi: ABI.Hub,
              functionName: 'updateContract',
              args: [
                self.pool.id.raw,
                vault.shareClassId.raw,
                self.centrifugeId,
                addressToBytes32(syncManager),
                encode([VaultManagerTrustedCall.MaxReserve, vault.assetId.raw, maxUint128]),
                0n,
                ctx.signingAddress,
              ],
            })
          )
        }

        batch.push(
          encodeFunctionData({
            abi: ABI.Hub,
            functionName: 'notifyAssetPrice',
            args: [self.pool.id.raw, vault.shareClassId.raw, vault.assetId.raw, ctx.signingAddress],
          }),
          encodeFunctionData({
            abi: ABI.Hub,
            functionName: 'updateVault',
            args: [
              self.pool.id.raw,
              vault.shareClassId.raw,
              vault.assetId.raw,
              addressToBytes32(factoryAddress),
              VaultUpdateKind.DeployAndLink,
              0n, // gas limit
              ctx.signingAddress,
            ],
          })
        )
        messageTypes.push(
          { type: MessageType.NotifyPricePoolPerAsset, poolId: self.pool.id },
          { type: MessageType.UpdateVault, subtype: VaultUpdateKind.DeployAndLink, poolId: self.pool.id }
        )
      }

      if (batch.length === 0) {
        throw new Error('No share classes / vaults to deploy')
      }

      yield* wrapTransaction('Deploy share classes and vaults', ctx, {
        data: batch,
        contract: hub,
        messages: { [self.centrifugeId]: messageTypes },
      })
    }, this.pool.centrifugeId)
  }

  /**
   * Unlink vaults.
   * @param vaults - An array of vaults to unlink
   */
  unlinkVaults(vaults: { shareClassId: ShareClassId; assetId: AssetId; address: HexString }[]) {
    const self = this
    return this._transact(async function* (ctx) {
      assertCrosschainMessagingEnabled(self.centrifugeId)

      if (vaults.length === 0) {
        throw new Error('No vaults to unlink')
      }

      const [{ hub }, details] = await Promise.all([
        self._root._protocolAddresses(self.pool.centrifugeId),
        self.details(),
      ])

      const batch: HexString[] = []
      const messageTypes: MessageTypeWithSubType[] = []

      for (const vault of vaults) {
        const shareClass = details.activeShareClasses.find((sc) => sc.id.equals(vault.shareClassId))

        if (!shareClass) {
          throw new Error(`Share class "${vault.shareClassId.raw}" not found`)
        }

        const existingVault = shareClass.vaults.find((v) => v.address.toLowerCase() === vault.address.toLowerCase())

        if (!existingVault) {
          throw new Error(`Vault with address "${vault.address}" not found for share class "${vault.shareClassId.raw}"`)
        }

        batch.push(
          encodeFunctionData({
            abi: ABI.Hub,
            functionName: 'updateVault',
            args: [
              self.pool.id.raw,
              vault.shareClassId.raw,
              vault.assetId.raw,
              addressToBytes32(vault.address),
              VaultUpdateKind.Unlink,
              0n, // gas limit
              ctx.signingAddress,
            ],
          })
        )
        messageTypes.push({ type: MessageType.UpdateVault, subtype: VaultUpdateKind.Unlink, poolId: self.pool.id })
      }

      yield* wrapTransaction('Unlink vaults', ctx, {
        data: batch,
        contract: hub,
        messages: { [self.centrifugeId]: messageTypes },
      })
    }, this.pool.centrifugeId)
  }

  /**
   * Link vaults that are already deployed but currently unlinked.
   * @param vaults - An array of vaults to link.
   */
  linkVaults(vaults: { shareClassId: ShareClassId; assetId: AssetId; address: HexString }[]) {
    const self = this
    return this._transact(async function* (ctx) {
      assertCrosschainMessagingEnabled(self.centrifugeId)

      if (vaults.length === 0) {
        throw new Error('No vaults to link')
      }

      const [{ hub }, details] = await Promise.all([
        self._root._protocolAddresses(self.pool.centrifugeId),
        self.details(),
      ])

      const shareClassIds = [...new Set(vaults.map((v) => v.shareClassId.raw))]
      const vaultsWithUnlinked = await Promise.all(
        shareClassIds.map((scId) => {
          const shareClass = vaults.find((v) => v.shareClassId.raw === scId)
          const shareClassId = shareClass ? shareClass.shareClassId : null
          return shareClassId ? firstValueFrom(self.vaults(shareClassId, true)) : null
        })
      )
      const vaultsByShareClass = Object.fromEntries(shareClassIds.map((scId, i) => [scId, vaultsWithUnlinked[i] ?? []]))

      const batch: HexString[] = []
      const messageTypes: MessageTypeWithSubType[] = []

      for (const vault of vaults) {
        const shareClass = details.activeShareClasses.find((sc) => sc.id.equals(vault.shareClassId))

        if (!shareClass) {
          throw new Error(`Share class "${vault.shareClassId.raw}" not found`)
        }

        const allVaultsForShareClass = vaultsByShareClass[vault.shareClassId.raw] ?? []
        const existingVault = allVaultsForShareClass.find(
          (v) => v.address.toLowerCase() === vault.address.toLowerCase()
        )

        if (!existingVault) {
          throw new Error(
            `Vault with address "${vault.address}" not found for share class "${vault.shareClassId.raw}". The vault must be deployed before it can be linked.`
          )
        }

        batch.push(
          encodeFunctionData({
            abi: ABI.Hub,
            functionName: 'updateVault',
            args: [
              self.pool.id.raw,
              vault.shareClassId.raw,
              vault.assetId.raw,
              addressToBytes32(existingVault.address),
              VaultUpdateKind.Link,
              0n, // gas limit
              ctx.signingAddress,
            ],
          })
        )
        messageTypes.push({ type: MessageType.UpdateVault, subtype: VaultUpdateKind.Link, poolId: self.pool.id })
      }

      yield* wrapTransaction('Link vaults', ctx, {
        data: batch,
        contract: hub,
        messages: { [self.centrifugeId]: messageTypes },
      })
    }, this.pool.centrifugeId)
  }

  /**
   * Get the contract address of the share token.
   * @internal
   */
  _share(scId: ShareClassId, throwOnNullAddress = true) {
    return this._query(['share', scId.toString(), throwOnNullAddress], () =>
      combineLatest([this._root._protocolAddresses(this.centrifugeId), this._root.getClient(this.centrifugeId)]).pipe(
        switchMap(([{ spoke }, client]) =>
          defer(async () => {
            try {
              const address = await client.readContract({
                address: spoke,
                abi: ABI.Spoke,
                functionName: 'shareToken',
                args: [this.pool.id.raw, scId.raw],
              })
              return address.toLowerCase() as HexString
            } catch {
              if (throwOnNullAddress) {
                throw new Error(
                  `Share class ${scId} not found for pool ${this.pool.id} on centrifuge network ${this.centrifugeId}`
                )
              }
              return NULL_ADDRESS
            }
          }).pipe(
            repeatOnEvents(
              this._root,
              {
                address: spoke,
                eventName: 'AddShareClass',
                filter: (events) => {
                  return events.some((event) => event.args.poolId === this.pool.id.raw && event.args.scId === scId.raw)
                },
              },
              this.centrifugeId
            )
          )
        )
      )
    )
  }

  /**
   * Get all Vaults for all share classes in the pool.
   * @returns An object of share class ID to Vault.
   * @internal
   */
  _vaultsByShareClass() {
    return this._query(['vaultsByShareClass'], () =>
      this.pool._shareClassIds().pipe(
        switchMap((scIds) => {
          if (scIds.length === 0) throw new Error('No share classes found')

          return combineLatest(scIds.map((scId) => this.vaults(scId))).pipe(
            map((vaultsShareClassArr) =>
              Object.fromEntries(vaultsShareClassArr.map((vaults, index) => [scIds[index]!.raw, vaults]))
            )
          )
        })
      )
    )
  }
}
