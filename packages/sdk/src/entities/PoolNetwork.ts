import { combineLatest, concat, defer, firstValueFrom, ignoreElements, map, of, switchMap } from 'rxjs'
import { encodeAbiParameters, encodeFunctionData, maxUint128, parseAbi } from 'viem'
import {
  ABIS_V3_2,
  ABIS_V3_3,
  builders,
  encodeAccountingTokenMinterPayload,
  encodeAdapterFailoverStewardPayload,
  encodeShareTokenRegistrarPayload,
  encodeSyncManagerPayload,
  UnsupportedForProtocolVersionError,
  VAULT_FACTORY_ABI_V3_3,
  type ContractAbis,
  type ProtocolVersion,
} from '@centrifuge/protocol'
import type { MerkleProofManagerRow, OnOffRampManagerRow, PoolAdapterRow } from '@centrifuge/queries/core'
import type { Centrifuge, SdkProtocolContext } from '../Centrifuge.js'
import { NULL_ADDRESS, SAFE_PROXY_BYTECODE } from '../constants.js'
import { AdapterFailoverStewardMissingError } from '../errors.js'
import { HexString } from '../types/index.js'
import {
  MessageType,
  MessageTypeV3_3,
  MessageTypeWithSubType,
  messageV3_3,
  VaultUpdateKind,
} from '../types/transaction.js'
import type { TransactionContext } from '../types/transaction.js'
import { addMessageForEnabledTarget, assertCrosschainMessagingEnabled } from '../utils/crosschainHotfix.js'
import { adapterIndexerNames, requireCopyableGlobalSet, type GlobalAdapterSet } from '../utils/adapters.js'
import { addressesEqual } from '../utils/addresses.js'
import { addressToBytes32, encode } from '../utils/index.js'
import {
  isPoolWired,
  planPoolAdapters,
  UNKNOWN_ADAPTER_NAME,
  type PoolAdapterPlan,
  type PoolAdapterState,
} from '../utils/poolAdapters.js'
import {
  builderContext,
  encodeHubManagerCall,
  isV3_3,
  MERKLE_PROOF_MANAGER_REMOVED,
  refuseOnV3_3,
  requireContract,
  spokeReadTarget,
} from '../utils/protocolVersion.js'
import { makeThenable, repeatOnEvents } from '../utils/rx.js'
import { spokeAssets } from '../utils/spokeAssets.js'
import {
  doTransaction,
  parseEventLogs,
  sendCallsInOrder,
  wrapTransaction,
  type PendingPoolAdaptersByChain,
} from '../utils/transaction.js'
import type { Query } from '../types/query.js'
import type { Transaction } from '../types/transaction.js'
import { AssetId, CentrifugeId, PoolId, ShareClassId } from '../utils/types.js'
import { BalanceSheet } from './BalanceSheet.js'
import { Entity } from './Entity.js'
import { MerkleProofManager } from './MerkleProofManager.js'
import { OnchainPM } from './OnchainPM.js'
import { OnOffRampManager } from './OnOffRampManager.js'
import type { OnOfframpManagerStatus, Pool, ShareManagerStatus } from './Pool.js'
import { ShareClass } from './ShareClass.js'

/** `OnOffRampFactory` emits the first, the legacy `OnOfframpManagerFactory` the second. */
const ON_OFF_RAMP_DEPLOY_EVENTS = ['DeployOnOffRamp', 'DeployOnOfframpManager'] as const

/** The one ProtocolGuardian read `deploy()` makes; kept out of the generated set so a book's guardian ABI is not held to it. */
const PROTOCOL_GUARDIAN_SAFE_ABI = parseAbi(['function safe() view returns (address)'])

export enum VaultManagerTrustedCall {
  Valuation,
  MaxReserve,
}

/**
 * Refuse a merkle-proof manager selection with more than one candidate: the rows carry no block to
 * order by, so none can be picked without a guess, and the address drives a balance-sheet registration
 * and every policy write. Resolve it by revoking the stale manager.
 */
function requireSingleManager<T>(
  rows: readonly T[],
  address: (row: T) => string,
  what: string,
  scope: string
): T | undefined {
  if (rows.length > 1) {
    throw new Error(
      `Found ${rows.length} deployed ${what}s for ${scope} (${rows.map(address).join(', ')}). ` +
        `The rows carry no block to order by, so the SDK cannot tell which one is current; ` +
        `resolve it by revoking the stale manager.`
    )
  }
  return rows[0]
}

type RegistrationAction = 'registerOnOffRamp' | 'updateBalanceSheetManagers'
const REGISTRATION_ACTIONS: readonly RegistrationAction[] = ['registerOnOffRamp', 'updateBalanceSheetManagers']

/** `registerOnOffRamp` where the registry lists `onOffRampFactory` (register plus grant), else the plain update. */
function registrationAction(onOffRampFactory: HexString | null | undefined): RegistrationAction {
  return onOffRampFactory ? 'registerOnOffRamp' : 'updateBalanceSheetManagers'
}

/**
 * The newest of a share class's deployed ramps: highest `createdAtBlock`, then
 * highest lowercase address, so a tie resolves the same way whatever order the rows arrive in.
 */
function newestOnOffRamp<T extends { address: string; createdAtBlock: number }>(rows: readonly T[]): T | undefined {
  // A source that omits the block (an older backend) cannot order two rows; refuse rather than pick by address.
  if (rows.length > 1 && rows.some((row) => row.createdAtBlock == null)) {
    throw new Error(
      `Cannot tell which of ${rows.length} deployed OnOffRampManagers is newest (${rows.map((row) => row.address).join(', ')}): the data source returned no createdAtBlock`
    )
  }
  return [...rows].sort((a, b) => {
    const byBlock = BigInt(b.createdAtBlock) - BigInt(a.createdAtBlock)
    if (byBlock !== 0n) return byBlock > 0n ? 1 : -1
    const [left, right] = [a.address.toLowerCase(), b.address.toLowerCase()]
    return left < right ? 1 : left > right ? -1 : 0
  })[0]
}

/**
 * Whether the pool still has to be notified to a network: it is not active there and no share class is, since an
 * active share class implies an active pool even while `isActive` lags, and notifying a registered pool again reverts.
 * @internal
 */
export function poolNeedsNotify(details: { isActive: boolean; activeShareClasses: readonly unknown[] }): boolean {
  return !details.isActive && details.activeShareClasses.length === 0
}

/**
 * `Hub.notifyPool` to a network, with the message it sends.
 * @internal
 */
export function notifyPoolCall(
  hubCtx: SdkProtocolContext,
  poolId: PoolId,
  centrifugeId: CentrifugeId,
  refundAddress: HexString
): { data: HexString; message: MessageTypeWithSubType } {
  return {
    data: encodeFunctionData({
      abi: hubCtx.contractAbis.Hub,
      functionName: 'notifyPool',
      args: [poolId.raw, centrifugeId, refundAddress],
    }),
    message: { type: MessageType.NotifyPool, poolId },
  }
}

/**
 * `Hub.notifyAssetPrice`, which pushes the committed price of an asset to the asset's chain, with the message it sends.
 * @internal
 */
export function notifyAssetPriceCall(
  hubCtx: SdkProtocolContext,
  poolId: PoolId,
  scId: HexString,
  assetId: AssetId,
  refundAddress: HexString
): { data: HexString; message: MessageTypeWithSubType } {
  return {
    data: encodeFunctionData({
      abi: hubCtx.contractAbis.Hub,
      functionName: 'notifyAssetPrice',
      args: [poolId.raw, scId, assetId.raw, refundAddress],
    }),
    message: { type: MessageType.NotifyPricePoolPerAsset, poolId },
  }
}

/**
 * Grants a minter on the spoke's AccountingToken: `Hub.updateContract` to its
 * `trustedCall` on v3.2, `Hub.managerCall` to its `fromHub` on v3.3. Both
 * decode `abi.encode(bytes32 who, bool canMint)`. The minter mapping is
 * pool-wide, so any share class of the pool routes it on v3.2; v3.3 carries
 * no share class.
 */
function encodeAccountingTokenMinterGrant(args: {
  hubCtx: SdkProtocolContext
  poolId: PoolId
  scId: HexString
  centrifugeId: CentrifugeId
  accountingToken: HexString
  minter: HexString
  refundAddress: HexString
}): { data: HexString; message: MessageTypeWithSubType } {
  if (isV3_3(args.hubCtx)) {
    return {
      data: encodeHubManagerCall(args.hubCtx, {
        centrifugeId: args.centrifugeId,
        target: args.accountingToken,
        payload: encodeAccountingTokenMinterPayload({ minter: args.minter, canMint: true }),
        label: 'AccountingToken.UpdateMinter',
        refund: args.refundAddress,
      }),
      message: messageV3_3(MessageTypeV3_3.ManagerCallFromHub, args.poolId),
    }
  }
  const payload = encodeAbiParameters([{ type: 'bytes32' }, { type: 'bool' }], [addressToBytes32(args.minter), true])
  return {
    data: encodeFunctionData({
      abi: args.hubCtx.contractAbis.Hub,
      functionName: 'updateContract',
      args: [
        args.poolId.raw,
        args.scId,
        args.centrifugeId,
        addressToBytes32(args.accountingToken),
        payload,
        0n,
        args.refundAddress,
      ],
    }),
    message: { type: MessageType.TrustedContractUpdate, poolId: args.poolId },
  }
}

/** A vault a batched edit links or unlinks, as the caller names it. */
interface VaultEditTarget {
  shareClassId: ShareClassId
  assetId: AssetId
  address: HexString
}

/**
 * The options every vault write takes.
 *
 * One shape rather than a bare parameter on each method, so the field means the
 * same thing everywhere and a later addition (a `gasLimit` override, say) does
 * not change four signatures.
 */
export interface VaultWriteOptions {
  /**
   * Where unspent cross-chain gas payment is returned.
   *
   * Optional on the local path, where it defaults to the signing address —
   * which is exactly what these methods have always encoded, so a caller who
   * never passes one is unaffected. REQUIRED in backend mode: the signer is
   * resolved AFTER the calldata is built, and the bytes must be identical at
   * preview, at prepare and again during Fordefi's dual-channel verification.
   * Defaulting to the connected wallet there would send a pool's refunds to an
   * address the custodial signer does not control.
   */
  refundAddress?: HexString
}

/** The backend's `VaultRef`: the triple `Hub.updateVault` keys a message by. */
function toVaultRef(vault: VaultEditTarget) {
  return {
    scId: vault.shareClassId.raw,
    assetId: vault.assetId.toString(),
    vaultAddress: vault.address,
  }
}

/**
 * The refund address, refused rather than defaulted on the backend route.
 *
 * See {@link VaultWriteOptions.refundAddress}. Refused at payload-build time so
 * nothing is prepared: an orphaned backend row is worse than an early throw.
 *
 * Exported for `Vault.updateMaxReserve`, which fills the third part of the same
 * batched action, and `@internal` because it is not API surface — `index.ts`
 * re-exports this module wholesale.
 * @internal
 */
export function requireRefundAddress(options: VaultWriteOptions, method: string): HexString {
  if (!options.refundAddress) {
    throw new Error(
      `${method} needs an explicit { refundAddress } in backend mode: every vault write dispatches a ` +
        `cross-chain message, and unspent gas is refunded to the address baked into the calldata. The ` +
        `backend builds that calldata before any signer is resolved, so it cannot use "the connected ` +
        `wallet" — on the custodial route that is a Fordefi vault the refund would not reach. Pass the ` +
        `address the refund should go to; the local build path still defaults it to the signing address.`
    )
  }
  return options.refundAddress
}

/**
 * The one vault the backend's `deployVault` action can carry, or a refusal
 * naming which of the three shapes it cannot.
 *
 * See `ACTION_ROUTES` in `data/routing.ts` for why each of these is a refusal
 * rather than a silent fallback to `LocalBuild`.
 */
function requireSingleDeployableVault(
  shareClasses: { id: ShareClassId; hook: HexString }[],
  vaults: { shareClassId: ShareClassId; assetId: AssetId; kind: 'async' | 'syncDeposit'; factory?: HexString }[]
) {
  if (shareClasses.length > 0) {
    throw new Error(
      `poolNetwork.deploy() cannot enable share classes on the backend route: \`deployVault\` deploys a ` +
        `vault into a network the share class is ALREADY enabled on, and there is no backend action for ` +
        `\`Hub.notifyShareClass\` yet. Call ` +
        `deployShareClasses() first — it still builds locally — and then deployVaults().`
    )
  }
  if (vaults.length !== 1) {
    throw new Error(
      `poolNetwork.deployVaults() can deploy one vault per transaction on the backend route, and was ` +
        `given ${vaults.length}. The backend's \`deployVault\` action carries a single vault; fanning ` +
        `this call out would silently turn one signing ceremony into ${vaults.length} — and on the ` +
        `custodial route ${vaults.length} Fordefi approval quorums. Call it once per vault so each ` +
        `transaction is one the caller asked for.`
    )
  }
  const vault = vaults[0]!
  if (vault.factory) {
    throw new Error(
      `poolNetwork.deployVaults() cannot take a \`factory\` override on the backend route: the action ` +
        `takes a \`kind\` and reads the factory address from the verified @centrifuge/protocol registry ` +
        `for the target network and protocol version. Accepting a caller-supplied address would let an ` +
        `arbitrary contract become a share class's investment entry point. Drop the override to use the ` +
        `registered ${vault.kind} factory.`
    )
  }
  return vault
}

function refuseMismatchedDeploy(contract: string, simulated: HexString | null, deployed: HexString) {
  if (simulated && !addressesEqual(simulated, deployed)) {
    throw new Error(
      `${contract} deploy confirmed ${deployed}, but the simulation before it answered ${simulated}; no roles were granted`
    )
  }
}

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

  /** @internal */
  _protocolContext() {
    return this._root.protocolContext({ poolId: this.pool.id, centrifugeId: this.centrifugeId })
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
      combineLatest([this._protocolContext(), this._root.getClient(this.centrifugeId)]).pipe(
        switchMap(([ctx, client]) => {
          const { protocolVersion } = ctx
          const registry = spokeReadTarget(ctx)
          return defer(
            () =>
              client.readContract({
                address: registry.address,
                abi: registry.abi,
                functionName: 'isPoolActive',
                args: [this.pool.id.raw],
              }) as Promise<boolean>
          ).pipe(
            repeatOnEvents(
              this._root,
              {
                address: registry.address,
                eventName: 'AddPool',
                filter: (events) => {
                  return events.some((event) => {
                    return event.args.poolId === this.pool.id
                  })
                },
              },
              this.centrifugeId,
              protocolVersion
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
      combineLatest([this._protocolContext(), this._root.getClient(this.centrifugeId)]).pipe(
        switchMap(([{ onchainPMFactory, contractAbis: ABI }, client]) =>
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
      const { onchainPMFactory, contractAbis: ABI, protocolVersion } = await self._protocolContext()
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
        protocolVersion,
      })

      const deployEvent = events[0]
      // v3.3 renamed the event's address argument from `manager` to `onchainPM`.
      const args = deployEvent?.args as { manager?: HexString; onchainPM?: HexString } | undefined
      const deployed = args?.manager ?? args?.onchainPM
      if (!deployed) {
        throw new Error('DeployOnchainPM event not found in transaction receipt')
      }

      yield { type: 'DeployedOnchainPM', address: deployed } as const
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

      const hubCtx = await self._root.protocolContext(self.pool.id)
      const { hub } = hubCtx
      const { accountingToken } = await self._protocolContext()
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
      const registerManager = self.pool._balanceSheetManagerUpdates(
        [{ centrifugeId: self.centrifugeId, address: managerAddress, canManage: true }],
        ctx.signingAddress,
        hubCtx
      )

      // 2. Grant the OnchainPM minter rights on the accounting token.
      const grantMinter = encodeAccountingTokenMinterGrant({
        hubCtx,
        poolId: self.pool.id,
        scId: resolvedScId,
        centrifugeId: self.centrifugeId,
        accountingToken,
        minter: managerAddress,
        refundAddress: ctx.signingAddress,
      })

      yield* wrapTransaction('Authorize onchain PM', ctx, {
        contract: hub,
        policy: { poolId: self.pool.id },
        data: [...registerManager.data, grantMinter.data],
        messages: {
          [self.centrifugeId]: [...(registerManager.messages[self.centrifugeId] ?? []), grantMinter.message],
        },
      })
    }, this.pool.centrifugeId)
  }

  /**
   * Compute the deterministic address for a Merkle Proof Manager before deployment.
   * @returns The predicted contract address
   */
  async computeMerkleProofManagerAddress(): Promise<HexString> {
    const spokeCtx = await this._protocolContext()
    refuseOnV3_3(spokeCtx, 'computeMerkleProofManagerAddress', MERKLE_PROOF_MANAGER_REMOVED)
    const { merkleProofManagerFactory, contractAbis: ABI } = spokeCtx
    if (!merkleProofManagerFactory) {
      throw new Error(
        `Merkle proof managers are not available on centrifugeId ${this.centrifugeId} — no MerkleProofManagerFactory is deployed on this network`
      )
    }
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
      const spokeCtx = await self._protocolContext()
      refuseOnV3_3(spokeCtx, 'deployMerkleProofManager', MERKLE_PROOF_MANAGER_REMOVED)
      const { merkleProofManagerFactory, contractAbis: ABI, protocolVersion } = spokeCtx
      if (!merkleProofManagerFactory) {
        throw new Error(
          `Merkle proof managers are not available on centrifugeId ${self.centrifugeId} — no MerkleProofManagerFactory is deployed on this network`
        )
      }
      const precomputedAddress = isSafeWallet ? await self.computeMerkleProofManagerAddress() : null

      const result = yield* doTransaction('AddMerkleProofManager', ctx, () =>
        ctx.walletClient.writeContract({
          address: merkleProofManagerFactory,
          abi: ABI.MerkleProofManagerFactory,
          functionName: 'newManager',
          args: [self.pool.id.raw],
        })
      )

      const events = parseEventLogs({
        logs: result.receipt.logs,
        eventName: 'DeployMerkleProofManager',
        address: merkleProofManagerFactory,
        protocolVersion,
      })

      const deployEvent = events[0]
      const args = deployEvent?.args as { manager?: HexString } | undefined
      if (!args?.manager) {
        throw new Error('DeployMerkleProofManager event not found')
      }
      refuseMismatchedDeploy('MerkleProofManager', precomputedAddress, args.manager)

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
   * Get the OnOffRampManager for a given share class: the newest deployed ramp that is a
   * balance sheet manager on this network.
   * @param scId - The share class ID
   * @returns The OnOffRampManager
   * @throws If none is deployed, or none of them is a balance sheet manager.
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
          const verifiedManager = newestOnOffRamp(
            deployedOnOffRampManagers.filter((deployed) => bsManagerAddresses.has(deployed.address.toLowerCase()))
          )
          if (!verifiedManager) {
            throw new Error('OnOffRampManager not found in balance sheet managers')
          }

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
   * This network's `ShareManager` and whether its balance sheet grant is live or
   * in transit, so the app can offer to enable it. `null` where the network has
   * no `ShareManager`. Without the grant `isBalancesheetManager` is `false` and
   * `crosschainInProgress` is `null`; a grant (`CanManage`) or revoke
   * (`CanNotManage`) sent from the hub and not yet confirmed on the spoke shows
   * in `crosschainInProgress`, with `isBalancesheetManager` still the live state.
   */
  shareManagerStatus(): Query<ShareManagerStatus | null> {
    return this._query(['shareManagerStatus'], () =>
      this._protocolContext().pipe(
        switchMap(({ shareManager }) => {
          if (!shareManager) return of(null)
          return this.pool.balanceSheetManagerStatus().pipe(
            map((managers) => {
              const status = managers.find(
                (manager) => manager.centrifugeId === this.centrifugeId && addressesEqual(manager.address, shareManager)
              )
              return {
                address: shareManager,
                isBalancesheetManager: status?.isBalancesheetManager ?? false,
                crosschainInProgress: status?.crosschainInProgress ?? null,
              }
            })
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
   * Rows are not reduced to the newest.
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
   * Register the share class's newest deployed OnOffRampManager as a balance sheet manager, with the
   * minter grant where the network needs it (see {@link registerOnOffRampManagerAsBSManager}).
   * Everything is built inside one hub-chain transaction, so it also builds without a signer.
   * @param scId - The share class ID
   * @throws
   *   - If no ramp is indexed.
   *   - If the newest ramp is already a balance sheet manager on this network.
   *   - As {@link registerOnOffRampManagerAsBSManager} does (missing `accountingToken`, messaging disabled).
   *   - Always in backend mode.
   */
  assignOnOffRampManagerPermissions(scId: ShareClassId) {
    const self = this
    return this._root._routeDeferredTransaction(
      { resolve: () => self._registrationAction(), candidates: REGISTRATION_ACTIONS },
      this.pool.id.toString(),
      async () => {
        await self._newestUnregisteredOnOffRamp(scId)
        throw new Error(
          'poolNetwork.assignOnOffRampManagerPermissions() cannot run in backend mode: it passes no refundAddress. ' +
            'Call registerOnOffRampManagerAsBSManager(address, scId, { refundAddress }) with the newest ramp instead.'
        )
      },
      {
        title: 'Register on/off-ramp manager',
        centrifugeId: this.pool.centrifugeId,
        gate: [{ centrifugeId: this.centrifugeId }],
        local: () =>
          self._transact(async function* (ctx) {
            const newest = await self._newestUnregisteredOnOffRamp(scId)
            yield* self._registerOnOffRamp(ctx, newest.address, scId)
          }, self.pool.centrifugeId),
      }
    )
  }

  /** The newest indexed ramp of the share class, which must not yet be a balance sheet manager here. */
  private async _newestUnregisteredOnOffRamp(scId: ShareClassId) {
    const [ramps, balanceSheetManagers] = await Promise.all([
      firstValueFrom(this._deployedOnOffRampManagers(scId)),
      firstValueFrom(this.pool.balanceSheetManagers()),
    ])
    const newest = newestOnOffRamp(ramps)
    if (!newest) {
      throw new Error(
        `No on/off-ramp is indexed for share class ${scId.toString()} on centrifugeId ${this.centrifugeId}`
      )
    }
    const isRegistered = balanceSheetManagers.some(
      (manager) => manager.centrifugeId === this.centrifugeId && addressesEqual(manager.address, newest.address)
    )
    if (isRegistered) {
      throw new Error(
        `The newest on/off-ramp ${newest.address} is already a balance sheet manager on centrifugeId ${this.centrifugeId}; use registerOnOffRampManagerAsBSManager to re-send the grant`
      )
    }
    return newest
  }

  /**
   * The on/off-ramp manager factory the registry lists for this network: the
   * current `OnOffRampFactory`, else the legacy `OnOfframpManagerFactory`.
   * @throws If the registry lists neither for this network.
   */
  private async _resolveOnOffRampFactory(): Promise<{
    factory: HexString
    abis: ContractAbis
    protocolVersion: ProtocolVersion
  }> {
    const {
      onOffRampFactory,
      onOfframpManagerFactory,
      contractAbis: abis,
      protocolVersion,
    } = await this._protocolContext()
    const factory = onOffRampFactory ?? onOfframpManagerFactory
    if (!factory) {
      throw new Error(
        `On/off ramp managers are not available on centrifugeId ${this.centrifugeId} — neither onOffRampFactory nor onOfframpManagerFactory is deployed on this network`
      )
    }
    return { factory, abis, protocolVersion }
  }

  /** The manager address `factory.newManager` would deploy, read by simulating the call. */
  private async _simulateNewOnOffRampManager(
    factory: HexString,
    ABI: ContractAbis,
    scId: ShareClassId
  ): Promise<HexString> {
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
    const { factory, abis } = await this._resolveOnOffRampFactory()
    return this._simulateNewOnOffRampManager(factory, abis, scId)
  }

  /**
   * Deploy an On/Off Ramp Manager for a share class.
   * Yields the deployed manager address as a custom 'DeployedOnOfframpManager' status.
   * Registers nothing: follow with {@link registerOnOffRampManagerAsBSManager}, which also grants
   * the minter rights a manager from `onOffRampFactory` needs.
   * @param scId - The share class ID
   * @throws If no on/off-ramp manager factory is deployed on this network.
   */
  deployOnOfframpManager(scId: ShareClassId) {
    const self = this

    return this._transact(async function* (ctx) {
      const { factory, abis: ABI, protocolVersion } = await self._resolveOnOffRampFactory()

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
        eventName: ON_OFF_RAMP_DEPLOY_EVENTS,
        address: factory,
        protocolVersion,
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
   * Register an On/Off Ramp Manager as a Balance Sheet Manager. On a network whose registry lists
   * `onOffRampFactory` the manager mints and burns the pool's accounting token, so the same hub
   * transaction also grants it minter rights. Networks with only the legacy factory get the plain
   * balance sheet manager update.
   * @param managerAddress - The deployed manager's contract address
   * @param scId - The manager's share class. Required when the network lists `onOffRampFactory`; it
   *   routes the minter grant.
   * @param options.refundAddress - Where unspent cross-chain gas payment is returned. Defaults to the
   *   signing address on the local path; required in backend mode.
   * @throws If the network lists `onOffRampFactory` but no `accountingToken`, `scId` is missing, or
   *   cross-chain messaging is disabled for the network; nothing is signed. In backend mode also if
   *   `refundAddress` is missing.
   */
  registerOnOffRampManagerAsBSManager(
    managerAddress: HexString,
    scId?: ShareClassId,
    options: { refundAddress?: HexString } = {}
  ) {
    const self = this
    return this._root._routeDeferredTransaction(
      { resolve: () => self._registrationAction(), candidates: REGISTRATION_ACTIONS },
      this.pool.id.toString(),
      (action) => self._registrationPayload(action as RegistrationAction, managerAddress, scId, options.refundAddress),
      {
        title: 'Register on/off-ramp manager',
        centrifugeId: this.pool.centrifugeId,
        gate: [{ centrifugeId: this.centrifugeId }],
        local: () =>
          self._transact(
            (ctx) => self._registerOnOffRamp(ctx, managerAddress, scId, options.refundAddress),
            self.pool.centrifugeId
          ),
      }
    )
  }

  /** @internal The hub and this network's registry entries at the pool's protocol version, as the backend resolves them. */
  async _registrationContexts() {
    const [hubContext, spoke] = await Promise.all([this._root.protocolContext(this.pool.id), this._protocolContext()])
    return { hub: hubContext.hub, hubContext, spoke }
  }

  private async _registrationAction() {
    const { spoke } = await this._registrationContexts()
    return registrationAction(spoke.onOffRampFactory)
  }

  private async _registrationPayload(
    action: RegistrationAction,
    managerAddress: HexString,
    scId: ShareClassId | undefined,
    refundAddress: HexString | undefined
  ) {
    if (!refundAddress) {
      throw new Error(
        'Registering an on/off-ramp needs an explicit { refundAddress } in backend mode: the registration dispatches ' +
          'paid cross-chain messages and returns the unspent gas to that address, and the backend builds the ' +
          'calldata before any signer is resolved.'
      )
    }
    if (action === 'updateBalanceSheetManagers') {
      return this.pool._balanceSheetManagerPayload(
        [{ centrifugeId: this.centrifugeId, address: managerAddress, canManage: true }],
        refundAddress
      )
    }

    const { spoke } = await this._registrationContexts()
    this._minterGrantToken(spoke.accountingToken)
    if (!scId) throw this._missingScIdError()
    return {
      poolId: this.pool.id.toString(),
      scId: scId.raw,
      centrifugeId: String(this.centrifugeId),
      address: managerAddress,
      refundAddress,
    }
  }

  private _missingScIdError() {
    return new Error(
      `A share class id is required to register an on/off-ramp on centrifugeId ${this.centrifugeId}: it routes the accounting-token minter grant`
    )
  }

  /** Shared body of register and assign; runs in the caller's hub-chain context so it stays buildable. */
  private async *_registerOnOffRamp(
    ctx: TransactionContext,
    managerAddress: HexString,
    scId?: ShareClassId,
    refundAddress?: HexString
  ) {
    const {
      hub,
      hubContext,
      spoke: { onOffRampFactory, accountingToken },
    } = await this._registrationContexts()
    const refund = refundAddress ?? ctx.signingAddress
    const update = [{ centrifugeId: this.centrifugeId, address: managerAddress, canManage: true }]

    if (!onOffRampFactory) {
      const { data, messages } = this.pool._balanceSheetManagerUpdates(update, refund, hubContext)
      yield* wrapTransaction('Update balance sheet managers', ctx, {
        contract: hub,
        policy: { poolId: this.pool.id },
        data,
        messages,
      })
      return
    }

    const token = this._minterGrantToken(accountingToken)
    if (!scId) throw this._missingScIdError()
    const { data, messages } = this.pool._balanceSheetManagerUpdates(update, refund, hubContext)
    const grantMinter = encodeAccountingTokenMinterGrant({
      hubCtx: hubContext,
      poolId: this.pool.id,
      scId: scId.raw,
      centrifugeId: this.centrifugeId,
      accountingToken: token,
      minter: managerAddress,
      refundAddress: refund,
    })
    const grantMinterCall = grantMinter.data
    addMessageForEnabledTarget(messages, this.centrifugeId, grantMinter.message)
    yield* wrapTransaction('Register on/off-ramp manager', ctx, {
      contract: hub,
      policy: { poolId: this.pool.id },
      data: [...data, grantMinterCall],
      messages,
    })
  }

  /** The one guard for registering a ramp with a minter grant; deploy runs it too, before anything is signed. */
  private _minterGrantToken(accountingToken: HexString | null | undefined): HexString {
    assertCrosschainMessagingEnabled(this.centrifugeId)
    if (!accountingToken) {
      throw new Error(
        `On/off-ramp minter grant needs an accountingToken, but the registry lists none for centrifugeId ${this.centrifugeId}`
      )
    }
    return accountingToken
  }

  /**
   * Deploy an On/Off Ramp Manager and register it as a Balance Sheet Manager. Where the registry lists
   * `onOffRampFactory`, the registration also grants minter rights in the same hub transaction (see
   * {@link registerOnOffRampManagerAsBSManager}).
   *
   * On a pool with a hub policy the registration can end in `OutOfPolicy` after the ramp is deployed, and the ramp stays
   * deployed. Register it with {@link registerOnOffRampManagerAsBSManager} and its address, or run this again once the
   * indexer lists the ramp, which skips the deploy; run earlier, it deploys a second ramp
   * (`docs/sdk/hub-policies.md`, "What stops a method").
   * @param scId
   * @throws If no factory is deployed on this network, or, on a network that lists `onOffRampFactory`, if
   *   no `accountingToken` is listed or messaging is disabled. Always in backend mode. All of these are
   *   raised before `newManager` is signed.
   */
  deployAndRegisterOnOffRampManager(scId: ShareClassId) {
    const self = this
    let managerAddress: HexString | null = null

    const deployTransaction = this._transact(async function* (ctx) {
      managerAddress = await self._findDeployedOnOffRampManagerAddress(scId)
      if (managerAddress) return

      const code = await ctx.publicClient.getCode({ address: ctx.signingAddress })
      const isSafeWallet = code === SAFE_PROXY_BYTECODE
      const { factory, abis: ABI, protocolVersion } = await self._resolveOnOffRampFactory()
      const precomputedAddress = isSafeWallet ? await self._simulateNewOnOffRampManager(factory, ABI, scId) : null

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
        eventName: ON_OFF_RAMP_DEPLOY_EVENTS,
        address: factory,
        protocolVersion,
      })

      const deployEvent = events[0]
      const args = deployEvent?.args as { manager?: HexString } | undefined
      if (!args?.manager) {
        throw new Error('DeployOnOfframpManager event not found')
      }
      const finalManagerAddress = args.manager
      refuseMismatchedDeploy('OnOffRampManager', precomputedAddress, finalManagerAddress)

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
      const { spoke } = await self._registrationContexts()
      if (self._root._routesToBackend(registrationAction(spoke.onOffRampFactory))) {
        throw new Error(
          'poolNetwork.deployAndRegisterOnOffRampManager() cannot run in backend mode: the registration leg passes no refundAddress, ' +
            'so it would deploy a ramp it cannot register. Call deployOnOfframpManager(scId), then ' +
            'registerOnOffRampManagerAsBSManager(address, scId, { refundAddress }).'
        )
      }
      if (spoke.onOffRampFactory) self._minterGrantToken(spoke.accountingToken)
    }).pipe(ignoreElements())

    const transaction = makeThenable(concat(preCheck, deployTransaction, registerTransaction), true)
    return Object.assign(transaction, { centrifugeId: self.centrifugeId })
  }

  /**
   * The pool's deployed MerkleProofManager on this network, or `null` when none
   * is projected.
   *
   * Refuses when more than one is projected; the rows carry no block to order by.
   */
  private _deployedMerkleProofManagerAddress() {
    return this._root._queryData(
      'merkleProofManagers',
      { poolId: this.pool.id.toString(), centrifugeId: this.centrifugeId.toString() },
      (items: MerkleProofManagerRow[]) => {
        const manager = requireSingleManager(
          items,
          (item) => item.address,
          'MerkleProofManager',
          `pool ${this.pool.id.toString()} on centrifugeId ${this.centrifugeId}`
        )
        return (manager?.address?.toLowerCase() as HexString | undefined) ?? null
      }
    )
  }

  private _findDeployedMerkleProofManagerAddress() {
    return firstValueFrom(this._deployedMerkleProofManagerAddress())
  }

  private _deployedOnOffRampManagers(scId: ShareClassId) {
    return this._root._queryData(
      'onOffRampManagers',
      { tokenId: scId.toString(), centrifugeId: this.centrifugeId.toString() },
      (items: OnOffRampManagerRow[]) =>
        items.map((manager) => ({
          ...manager,
          address: manager.address.toLowerCase() as HexString,
        }))
    )
  }

  /**
   * The share class's newest deployed OnOffRampManager on this network, or `null`.
   * Drives the "already deployed, skip the deploy leg" branch of
   * {@link deployAndRegisterOnOffRampManager}.
   */
  private async _findDeployedOnOffRampManagerAddress(scId: ShareClassId) {
    const managers = await firstValueFrom(this._deployedOnOffRampManagers(scId))
    return newestOnOffRamp(managers)?.address ?? null
  }

  /**
   * Enable share classes on this network.
   * @param shareClasses - An array of share classes to enable
   *
   * Stays on `LocalBuild` in every mode: enabling a share class on a network is
   * `Hub.notifyShareClass` (plus, on a first deployment, the adapter and pool
   * preamble), and the backend has no `PoolAction` for it — so this is an
   * unmigrated action behaving exactly as it does in public mode, not a
   * decision.
   */
  deployShareClasses(shareClasses: { id: ShareClassId; hook: HexString }[]) {
    return this.deploy(shareClasses, [])
  }

  /**
   * Deploy vaults for share classes that are already enabled on this network.
   * @param vaults - An array of vaults to deploy
   * @param options.refundAddress - Where unspent cross-chain gas is returned.
   * Defaults to the signing address on the local path; REQUIRED in backend mode
   * (see {@link deploy}).
   */
  deployVaults(
    vaults: {
      shareClassId: ShareClassId
      assetId: AssetId
      kind: 'async' | 'syncDeposit'
      factory?: HexString
    }[],
    options: VaultWriteOptions = {}
  ) {
    return this.deploy([], vaults, options)
  }

  /**
   * Enable and deploy share classes/vaults.
   * @param shareClasses - An array of share classes to enable
   * @param vaults - An array of vaults to deploy
   * @param options.refundAddress - Where unspent cross-chain gas payment is
   * returned. The local path defaults it to `ctx.signingAddress`, which is what
   * this method has always encoded. REQUIRED in backend mode: the signer is
   * unknown at preview time and the calldata must be byte-identical at preview,
   * at prepare and again during Fordefi's dual-channel re-derivation.
   *
   * ## Routing
   *
   * Routed to the backend's `deployVault` action for the shape that action can
   * express — exactly one vault, on a network where nothing else needs setting
   * up first — and refused loudly for every other shape rather than falling
   * back. A silent fallback would put a pool-operator write through the browser
   * wallet with no policy evaluation, and the caller would have no way to tell.
   *
   * The four refusals, and what each one is protecting:
   *
   * - **More than one vault.** The action carries one; splitting the call into
   *   N transactions would turn one signing ceremony into N, and on the
   *   custodial route N Fordefi quorums, without the caller asking.
   * - **Share classes alongside vaults.** `notifyShareClass` has no action; the
   *   combined call is not expressible and the vault half must not be sent on
   *   its own into a network where the share class is not enabled yet.
   * - **A `factory` override.** The action takes a `kind` and reads the factory
   *   from the verified registry. Accepting an address would let a caller
   *   install an arbitrary contract as a share class's investment entry point.
   * - **A required preamble.** See {@link deploy}'s note in
   *   `data/routing.ts`: the backend's builder cannot emit `setAdapters`,
   *   `notifyPool`, `updateBalanceSheetManager` or `setRequestManager`, so a
   *   deployment that needs any of them would confirm and leave a vault nobody
   *   can invest through. The state is read here — the same reads the local
   *   path already makes — and the call refuses instead.
   *
   * `deployShareClasses()` (no vaults at all) is not routed and not refused: it
   * has no backend action to route to, so it behaves exactly as in public mode.
   *
   * ## First activation on a network
   *
   * Whether the pool is wired to this network is read from the indexer (both directions' pool
   * adapter rows), so every deployment on another chain than the hub's depends on the indexer
   * being reachable and in sync. While it shows no wiring, `setAdapters` is sent with the pool
   * messages, with no wait between them:
   *
   * `setAdapters` installs the protocol's global (pool 0) adapter set for this route: the hub's adapters
   * toward this network, this network's adapters toward the hub, and the global threshold (and, on v3.2,
   * recovery index). It throws when the global set is empty, its two sides differ in size, or it holds an
   * adapter the registry does not list.
   *
   * - **v3.2:** one Hub batch, `setAdapters` first. Build mode builds it.
   * - **v3.3:** `Hub.setAdapters` reverts inside a Hub batch, so it is a call of its own followed by
   *   the Hub batch, both in one EIP-5792 `wallet_sendCalls` prompt when the wallet supports it and
   *   two transactions otherwise. Build mode refuses it.
   *
   * The pool messages' fee is priced against the adapters being installed: the hub's
   * MultiAdapter holds no set for the pool until `setAdapters` runs, and prices it at nothing. A
   * built activation names them in `pendingPoolAdapters`.
   *
   * `setAdapters` travels over the global adapters and the pool messages over the pool's own, so the
   * pool messages can reach the destination before its adapter configuration and revert there with
   * `InvalidAdapter()`. They stay undelivered at each bridge of the set. Over LayerZero they are
   * re-executed with {@link Centrifuge.retryLayerZeroDelivery} once the adapters have arrived, and
   * {@link Centrifuge.layerZeroDeliveries} reports them as `stuck` until then. Over Axelar and Chainlink
   * they are re-executed with that bridge's own manual execution; the SDK does not drive it, and a set
   * whose threshold needs those bridges' votes waits for them.
   *
   * The hub's set is the authority: when it already holds one and the destination is still
   * receiving it, `setAdapters` is not sent again; when the hub holds a set other than the
   * global set the SDK configures and the destination does not mirror it, the deployment stops
   * rather than overwrite it.
   */
  deploy(
    shareClasses: { id: ShareClassId; hook: HexString }[],
    vaults: {
      shareClassId: ShareClassId
      assetId: AssetId
      kind: 'async' | 'syncDeposit'
      factory?: HexString
    }[],
    options: VaultWriteOptions = {}
  ) {
    const local = () => this.#deployLocal(shareClasses, vaults, options)
    if (vaults.length === 0) {
      return this._root._gateLocal('notifyShareClass', this.pool.id.toString(), {
        centrifugeId: this.pool.centrifugeId,
        gate: [{ centrifugeId: this.centrifugeId }],
        local,
      })
    }

    return this._root._routeDeferredTransaction(
      'deployVault',
      this.pool.id.toString(),
      async () => {
        // The same kill switch the local path asserts. A no-op while the
        // disabled list is empty, and dropping it on this route would be a
        // silent behaviour change the day it is not: the transaction would
        // reach the chain and its cross-chain message would strand.
        assertCrosschainMessagingEnabled(this.centrifugeId)
        const vault = requireSingleDeployableVault(shareClasses, vaults)
        const refundAddress = requireRefundAddress(options, 'poolNetwork.deployVaults()')
        await this.#assertNoDeployPreambleNeeded(vault)
        return {
          poolId: this.pool.id.toString(),
          scId: vault.shareClassId.raw,
          centrifugeId: String(this.centrifugeId),
          assetId: vault.assetId.toString(),
          kind: vault.kind,
          refundAddress,
        }
      },
      {
        title: 'Deploy share classes and vaults',
        centrifugeId: this.pool.centrifugeId,
        gate: [{ centrifugeId: this.centrifugeId }],
        local,
      }
    )
  }

  /**
   * Whether the pool still has to be notified to this network, by the check `deploy()` makes.
   * @internal
   */
  async _needsNotifyPool(): Promise<boolean> {
    return poolNeedsNotify(await this.details())
  }

  /**
   * The chain state `deploy()`'s conditional preamble is decided from.
   *
   * Factored out of the generator because it has a second reader: the backend
   * route has to know whether a preamble WOULD be emitted in order to
   * refuse, and reading it any other way would let the two paths disagree about
   * what "this network is ready" means.
   */
  async #deployState() {
    const [hubContext, spokeContext, details, spokeClient] = await Promise.all([
      this._root.protocolContext(this.pool.id),
      this._protocolContext(),
      this.details(),
      this._root.getClient(this.centrifugeId),
    ])
    const registry = spokeReadTarget(spokeContext)
    // Balance sheet managers live on BalanceSheet on v3.2 and on SpokeRegistry on v3.3, same signature.
    const isSpokeManager = (who: HexString) =>
      isV3_3(spokeContext)
        ? spokeClient.readContract({
            address: registry.address,
            abi: ABIS_V3_3.SpokeRegistry,
            functionName: 'manager',
            args: [this.pool.id.raw, who],
          })
        : spokeClient.readContract({
            address: requireContract(spokeContext, 'balanceSheet'),
            abi: spokeContext.contractAbis.BalanceSheet,
            functionName: 'manager',
            args: [this.pool.id.raw, who],
          })
    // Only a spoke on another chain than the hub needs a way to recover its adapters without the hub.
    const adapterFailover =
      isV3_3(hubContext) && this.pool.centrifugeId !== this.centrifugeId
        ? requireContract(spokeContext, 'adapterFailover')
        : null
    const [
      isAsyncManagerSetOnBalanceSheet,
      isSyncManagerSetOnBalanceSheet,
      existingRequestManager,
      adapterRows,
      isAdapterFailoverManager,
    ] = await Promise.all([
      isSpokeManager(spokeContext.asyncRequestManager),
      isSpokeManager(spokeContext.syncManager),
      spokeClient.readContract({
        address: registry.address,
        abi: registry.abi,
        functionName: 'requestManager',
        args: [this.pool.id.raw],
      }),
      this.#poolAdapterRows(),
      adapterFailover
        ? spokeClient.readContract({
            address: spokeContext.multiAdapter,
            abi: ABIS_V3_3.MultiAdapter,
            functionName: 'manager',
            args: [this.pool.id.raw, adapterFailover],
          })
        : true,
    ])
    let globalAdapterSet: GlobalAdapterSet | null = null
    let adapterPlan: PoolAdapterPlan = adapterRows
      ? planPoolAdapters(adapterRows.onHub, adapterRows.onSpoke, [])
      : { action: 'ready' }
    if (adapterRows && adapterPlan.action !== 'send' && (await this._hubHoldsNoPoolSet(hubContext))) {
      adapterPlan = { action: 'send' }
    }
    if (adapterRows && adapterPlan.action !== 'ready') {
      globalAdapterSet = await this._globalAdapterSet(hubContext)
      if (adapterPlan.action !== 'send') {
        adapterPlan = planPoolAdapters(
          adapterRows.onHub,
          adapterRows.onSpoke,
          globalAdapterSet.names.map((name) => name ?? UNKNOWN_ADAPTER_NAME)
        )
      }
    }
    const needsNotifyPool = poolNeedsNotify(details)
    return {
      hubContext,
      spokeContext,
      details,
      isAsyncManagerSetOnBalanceSheet,
      isSyncManagerSetOnBalanceSheet,
      existingRequestManager,
      adapterPlan,
      globalAdapterSet,
      needsNotifyPool,
      // Whoever made AdapterFailover the manager chose its stewards, so a spoke where it already is gets neither call.
      adapterFailoverToInstall: isAdapterFailoverManager ? null : adapterFailover,
    }
  }

  /** @internal */
  async _globalAdapterSet(hubContext: SdkProtocolContext): Promise<GlobalAdapterSet> {
    const [onHub, onSpoke, recoveryIndex] = await Promise.all([
      firstValueFrom(this.pool.globalAdapters(this.centrifugeId)),
      firstValueFrom(this.pool.remoteGlobalAdapters(this.centrifugeId)),
      isV3_3(hubContext)
        ? 0
        : this._root.getClient(hubContext.centrifugeId).then((client) =>
            client.readContract({
              address: hubContext.multiAdapter,
              abi: ABIS_V3_2.MultiAdapter,
              functionName: 'recoveryIndex',
              args: [this.centrifugeId, 0n],
            })
          ),
    ])
    return {
      local: onHub.adapters,
      remote: onSpoke.adapters,
      threshold: onHub.threshold,
      recoveryIndex,
      names: adapterIndexerNames(hubContext, onHub.adapters),
    }
  }

  /**
   * Whatever the spoke's `ProtocolGuardian.safe()` answers, which becomes the pool's `AdapterFailover` steward there.
   * Only the zero address is refused: it would leave the pool with a manager no one can act through.
   */
  async #adapterFailoverSteward(spokeCtx: SdkProtocolContext): Promise<HexString> {
    const client = await this._root.getClient(this.centrifugeId)
    const safe = await client.readContract({
      address: spokeCtx.protocolGuardian,
      abi: PROTOCOL_GUARDIAN_SAFE_ABI,
      functionName: 'safe',
    })
    if (addressesEqual(safe, NULL_ADDRESS)) {
      throw new AdapterFailoverStewardMissingError(
        `ProtocolGuardian ${spokeCtx.protocolGuardian} on centrifugeId ${this.centrifugeId} answers safe() with the ` +
          `zero address, so ` +
          `pool "${this.pool.id}" cannot be given an AdapterFailover steward there. Nothing was sent.`,
        {
          poolId: this.pool.id.toString(),
          centrifugeId: this.centrifugeId,
          protocolGuardian: spokeCtx.protocolGuardian,
        }
      )
    }
    return safe
  }

  /** The pool's adapter rows the indexer holds for one direction, fetched once, outside the memoised polling query. */
  async #readPoolAdapters(
    localCentrifugeId: CentrifugeId,
    remoteCentrifugeId: CentrifugeId
  ): Promise<PoolAdapterState[]> {
    const vars = {
      poolId: this.pool.id.toString(),
      localCentrifugeId: String(localCentrifugeId),
      remoteCentrifugeId: String(remoteCentrifugeId),
    }
    let rows: PoolAdapterRow[]
    try {
      rows = await this._root._queryDataOnce<PoolAdapterRow[]>('poolAdapters', vars)
    } catch (error) {
      const detail = Array.isArray(error)
        ? error.map((e) => e?.message ?? String(e)).join('; ')
        : error instanceof Error
          ? error.message
          : String(error)
      throw new Error(
        `Could not read the adapters of pool "${this.pool.id}" (centrifugeId ${localCentrifugeId} to ` +
          `${remoteCentrifugeId}) from the data source: ${detail}`,
        { cause: error }
      )
    }
    return rows.map((row) => ({
      name: row.adapter?.name ?? UNKNOWN_ADAPTER_NAME,
      isEnabled: !!row.isEnabled,
      crosschainInProgress: row.crosschainInProgress ?? null,
    }))
  }

  /** Both directions' rows, or `null` on the hub's own chain, where messages never go through adapters. */
  async #poolAdapterRows(): Promise<{ onHub: PoolAdapterState[]; onSpoke: PoolAdapterState[] } | null> {
    if (this.pool.centrifugeId === this.centrifugeId) return null
    const [onHub, onSpoke] = await Promise.all([
      this.#readPoolAdapters(this.pool.centrifugeId, this.centrifugeId),
      this.#readPoolAdapters(this.centrifugeId, this.pool.centrifugeId),
    ])
    return { onHub, onSpoke }
  }

  /**
   * Whether pool messages can reach this network: see {@link isPoolWired}. Read from the indexer.
   * @internal
   */
  async _hasPoolAdapters(): Promise<boolean> {
    const rows = await this.#poolAdapterRows()
    if (rows === null) return true
    if (!isPoolWired(rows.onHub, rows.onSpoke)) return false
    const hubContext = await firstValueFrom(this._root.protocolContext(this.pool.id))
    return !(await this._hubHoldsNoPoolSet(hubContext))
  }

  /** @internal */
  async _hubHoldsNoPoolSet(hubContext: SdkProtocolContext): Promise<boolean> {
    if (!isV3_3(hubContext)) return false
    const { adapters } = await firstValueFrom(
      this._root._readMultiAdapter(of(hubContext), this.centrifugeId, this.pool.id.raw)
    )
    return adapters.length === 0
  }

  /**
   * Refuse a backend `deployVault` whose local equivalent would carry legs the
   * action cannot express.
   *
   * Each condition below mirrors, one for one, a `batch.push(...)` guard in
   * {@link #deployLocal}. They are asserted rather than reproduced because the
   * backend's builder is pure and `chain_v1` projects none of this state, so
   * there is nowhere for those legs to come from on that route — and a vault
   * deployed without them is live, linked and uninvestable.
   */
  async #assertNoDeployPreambleNeeded(vault: { shareClassId: ShareClassId; kind: 'async' | 'syncDeposit' }) {
    const state = await this.#deployState()
    const missing: string[] = []

    if (state.adapterPlan.action !== 'ready') {
      const why = {
        send: 'the pool has no adapters on this network yet',
        wait: 'the pool is still receiving its adapters on this network',
        conflict: 'the hub holds a different adapter set for this network than the network does',
        unnamed: 'the indexer cannot name an adapter of this pool, so its wiring cannot be verified',
      }[state.adapterPlan.action]
      missing.push(`Hub.setAdapters (${why})`)
    }
    if (state.needsNotifyPool) {
      missing.push('Hub.notifyPool (the pool is not registered on this network yet)')
    }
    if (state.adapterFailoverToInstall) {
      missing.push(
        'Hub.updateManager making AdapterFailover the adapter manager',
        'Hub.managerCall naming ProtocolGuardian.safe() its steward'
      )
    }
    if (!state.isAsyncManagerSetOnBalanceSheet) {
      missing.push('Hub.updateBalanceSheetManager for the async request manager')
    }
    if (!state.isSyncManagerSetOnBalanceSheet && vault.kind === 'syncDeposit') {
      missing.push('Hub.updateBalanceSheetManager for the sync manager')
    }
    if (state.existingRequestManager === NULL_ADDRESS) {
      missing.push('Hub.setRequestManager (no request manager is set for this pool on this network)')
    }
    if (!state.details.activeShareClasses.some((sc) => sc.id.equals(vault.shareClassId.raw))) {
      missing.push(
        `Hub.notifyShareClass for "${vault.shareClassId.raw}" (it is not enabled on centrifugeId ${this.centrifugeId})`
      )
    }

    if (missing.length > 0) {
      throw new Error(
        `poolNetwork.deployVaults() cannot use the backend's \`deployVault\` action on centrifugeId ` +
          `${this.centrifugeId} yet: deploying this vault also needs ${missing.join(', ')}. That action ` +
          `deploys a vault and nothing else — its builder is pure and \`chain_v1\` projects none of this ` +
          `state, so those legs cannot be built server-side. Refusing rather than sending the vault leg ` +
          `alone, which would confirm a transaction that leaves a linked vault nobody can invest through; ` +
          `and rather than silently building the whole batch locally, which would bypass the policy ` +
          `engine. Enable the share class and set the managers first — the first vault on a network ` +
          `always needs this, later ones do not.`
      )
    }
  }

  #deployLocal(
    shareClasses: { id: ShareClassId; hook: HexString }[],
    vaults: {
      shareClassId: ShareClassId
      assetId: AssetId
      kind: 'async' | 'syncDeposit'
      factory?: HexString
    }[],
    options: VaultWriteOptions = {}
  ) {
    const self = this
    return this._transact(async function* (ctx) {
      assertCrosschainMessagingEnabled(self.centrifugeId)

      const refundAddress = options.refundAddress ?? ctx.signingAddress
      const deployState = await self.#deployState()
      const { hubContext: hubCtx, spokeContext: spokeCtx } = deployState
      const v3_3 = isV3_3(hubCtx)
      const {
        hubContext: { hub, contractAbis: ABI },
        spokeContext: {
          syncDepositVaultFactory,
          asyncVaultFactory,
          syncManager,
          asyncRequestManager,
          batchRequestManager,
        },
        details,
        isAsyncManagerSetOnBalanceSheet,
        isSyncManagerSetOnBalanceSheet,
        existingRequestManager,
        adapterPlan: plan,
        needsNotifyPool,
        adapterFailoverToInstall,
      } = deployState

      const batch: HexString[] = []
      const messageTypes: MessageTypeWithSubType[] = []

      // The destination's MultiAdapter rejects every message of a pool it has no adapters for, and
      // `setAdapters` travels over the global adapters while the pool messages travel over the pool's
      // own. Sent together, the pool messages can arrive first and revert at the bridge; they are then
      // re-executed there once the adapters have arrived (`Centrifuge.retryLayerZeroDelivery`, or the
      // bridge's own manual execution for Axelar and Chainlink).
      if (plan.action === 'unnamed') {
        throw new Error(
          `The ${plan.side === 'hub' ? 'hub' : `network with centrifugeId ${self.centrifugeId}`} holds a pool ` +
            `adapter for pool "${self.pool.id}" that the indexer cannot name (its address is not in the indexer's ` +
            `adapter registry), so the wiring between the hub and centrifugeId ${self.centrifugeId} cannot be ` +
            `verified. Check the pool's adapters on both chains directly and the indexer's adapter registry.`
        )
      }
      if (plan.action === 'conflict') {
        throw new Error(
          `Pool "${self.pool.id}" has adapters [${plan.onHub.join(', ')}] on the hub for centrifugeId ` +
            `${self.centrifugeId} but [${plan.onSpoke.join(', ') || 'none'}] on that network, with nothing in ` +
            `flight. The SDK only wires the protocol's global adapter set and does not overwrite another configuration; set the ` +
            `pool's adapters for this network through the protocol's admin instead.`
        )
      }
      // After the refusals above, which name the more basic problem, and before `setAdapters`, the first send.
      const adapterFailover = adapterFailoverToInstall
        ? { address: adapterFailoverToInstall, steward: await self.#adapterFailoverSteward(spokeCtx) }
        : null
      // `wait`: an earlier transaction sent the set and it has not arrived yet. The pool messages go now
      // rather than after it, and are re-executed at the bridge if they arrive first.
      let setAdapters: HexString | null = null
      let pendingPoolAdapters: PendingPoolAdaptersByChain | undefined
      const setAdaptersMessages: MessageTypeWithSubType[] = [
        { type: MessageType.SetPoolAdapters, poolId: self.pool.id },
      ]
      if (plan.action === 'send') {
        const globalSet = deployState.globalAdapterSet
        if (!globalSet) throw new Error(`Pool "${self.pool.id}" has no global adapter set read to copy`)
        requireCopyableGlobalSet(globalSet, self.pool.centrifugeId, self.centrifugeId, self.pool.id)
        const remoteAdapters = globalSet.remote.map((adapter) => addressToBytes32(adapter))
        pendingPoolAdapters = { [self.centrifugeId]: globalSet.local }
        // v3.3 refuses `setAdapters` inside a Hub batch, so it cannot share the pool messages' transaction.
        if (v3_3 && ctx.isBatching) {
          throw new Error(
            `Pool "${self.pool.id}" has no adapters on centrifugeId ${self.centrifugeId} yet, and on protocol v3.3 ` +
              `setting them cannot be batched or built as one transaction with the deployment: Hub.setAdapters ` +
              `reverts inside a Hub batch. Either run this deployment with a signer, or build ` +
              `pool.setAdapters([{ centrifugeId: ${self.centrifugeId}, localAdapters: [${globalSet.local.join(', ')}], ` +
              `remoteAdapters: [${globalSet.remote.join(', ')}], threshold: ${globalSet.threshold} }]) first and, once the hub has executed it and the indexer ` +
              `shows it, build this deployment again: it then carries only the pool messages.`
          )
        }
        setAdapters = v3_3
          ? // v3.3 dropped the recovery index.
            encodeFunctionData({
              abi: ABIS_V3_3.Hub,
              functionName: 'setAdapters',
              args: [
                self.pool.id.raw,
                self.centrifugeId,
                globalSet.local,
                remoteAdapters,
                globalSet.threshold,
                refundAddress,
              ],
            })
          : encodeFunctionData({
              abi: ABI.Hub,
              functionName: 'setAdapters',
              args: [
                self.pool.id.raw,
                self.centrifugeId,
                globalSet.local,
                remoteAdapters,
                globalSet.threshold,
                globalSet.recoveryIndex,
                refundAddress,
              ],
            })
        // On v3.2 `setAdapters` heads the Hub batch; its `SetPoolAdapters` belongs to no pool and so
        // leaves in the global batch, over the global adapters.
        if (!v3_3) {
          batch.push(setAdapters)
          messageTypes.push(...setAdaptersMessages)
        }
      }

      // notifyPool must come before the other pool-related messages, because they depend on the pool
      // being active. Only do it on the first deployment to this chain: once any share class is
      // active here the pool is already registered, and re-notifying it (e.g. when deploying a second
      // share class to the same chain) reverts.
      if (needsNotifyPool) {
        const notifyPool = notifyPoolCall(hubCtx, self.pool.id, self.centrifugeId, refundAddress)
        batch.push(notifyPool.data)
        messageTypes.push(notifyPool.message)
      }

      // AdapterFailover can only rotate the pool's adapters on this spoke while it is their manager, and only on
      // behalf of a steward, so both are set while the adapters still deliver.
      if (adapterFailover) {
        batch.push(
          builders.updateManager(builderContext(hubCtx), {
            poolId: self.pool.id.toString(),
            centrifugeId: String(self.centrifugeId),
            kind: 'adapter',
            address: adapterFailover.address,
            canManage: true,
            refundAddress,
          }).data,
          encodeHubManagerCall(hubCtx, {
            centrifugeId: self.centrifugeId,
            target: adapterFailover.address,
            payload: encodeAdapterFailoverStewardPayload({ who: adapterFailover.steward, isSteward: true }),
            label: 'AdapterFailover.UpdateSteward',
            refund: refundAddress,
          })
        )
        messageTypes.push(
          messageV3_3(MessageTypeV3_3.UpdateManager, self.pool.id),
          messageV3_3(MessageTypeV3_3.ManagerCallFromHub, self.pool.id)
        )
      }

      // Set vault managers as balance sheet managers if not already set
      // Async manager is used by both async and sync deposit vaults, so set it when deploying any vault
      const addBalanceSheetManager = (manager: HexString) => {
        const update = self.pool._balanceSheetManagerUpdates(
          [{ centrifugeId: self.centrifugeId, address: manager, canManage: true }],
          refundAddress,
          hubCtx
        )
        batch.push(...update.data)
        messageTypes.push(...(update.messages[self.centrifugeId] ?? []))
      }
      if (!isAsyncManagerSetOnBalanceSheet && vaults.length > 0) {
        addBalanceSheetManager(asyncRequestManager)
      }
      if (!isSyncManagerSetOnBalanceSheet && vaults.some((v) => v.kind === 'syncDeposit')) {
        addBalanceSheetManager(syncManager)
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
              refundAddress,
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
        if (v3_3) {
          // v3.3 deploys the token through the spoke's registrar with no hook;
          // the hook is set by a registrar call that lands after it in the same batch.
          const registrar = requireContract(spokeCtx, 'shareTokenRegistrar')
          batch.push(
            encodeFunctionData({
              abi: ABIS_V3_3.Hub,
              functionName: 'notifyShareClass',
              args: [
                self.pool.id.raw,
                sc.id.raw,
                self.centrifugeId,
                addressToBytes32(registrar),
                '0x',
                0n,
                refundAddress,
              ],
            })
          )
          messageTypes.push({ type: MessageType.NotifyShareClass, poolId: self.pool.id })
          if (!addressesEqual(sc.hook, NULL_ADDRESS)) {
            batch.push(
              encodeHubManagerCall(hubCtx, {
                centrifugeId: self.centrifugeId,
                target: registrar,
                payload: encodeShareTokenRegistrarPayload({ kind: 'setHook', scId: sc.id.raw, hook: sc.hook }),
                label: 'ShareTokenRegistrar.SetHook',
                refund: refundAddress,
              })
            )
            messageTypes.push(messageV3_3(MessageTypeV3_3.ManagerCallFromHub, self.pool.id))
          }
          continue
        }
        batch.push(
          encodeFunctionData({
            abi: ABI.Hub,
            functionName: 'notifyShareClass',
            args: [self.pool.id.raw, sc.id.raw, self.centrifugeId, addressToBytes32(sc.hook), refundAddress],
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

        if (v3_3) {
          if (!details.activeShareClasses.some((activeSc) => activeSc.id.equals(vault.shareClassId.raw))) {
            throw new UnsupportedForProtocolVersionError(
              'deploy',
              hubCtx.protocolVersion,
              `share class "${vault.shareClassId}" is not active on centrifugeId ${self.centrifugeId} yet. On v3.3 ` +
                `the share token is pointed at a new vault in the same batch, from the address the factory will ` +
                `deploy to, which needs the share token to exist. Deploy the share class first, then its vaults.`
            )
          }
          if (vault.kind === 'syncDeposit') {
            batch.push(
              encodeHubManagerCall(hubCtx, {
                centrifugeId: self.centrifugeId,
                target: syncManager,
                payload: encodeSyncManagerPayload({
                  kind: 'maxReserve',
                  scId: vault.shareClassId.raw,
                  assetId: vault.assetId.toString(),
                  maxReserve: maxUint128.toString(),
                }),
                label: 'SyncManager.MaxReserve',
                refund: refundAddress,
              })
            )
            messageTypes.push(messageV3_3(MessageTypeV3_3.ManagerCallFromHub, self.pool.id))
          }
          const vaultAddress = await self.#predictVaultAddress(
            spokeCtx,
            factoryAddress,
            vault.shareClassId,
            vault.assetId
          )
          const linked = builders.updateVault(builderContext(hubCtx), {
            poolId: self.pool.id.toString(),
            scId: vault.shareClassId.raw,
            assetId: vault.assetId.toString(),
            vaultOrFactory: factoryAddress,
            kind: 'deployAndLink',
            refundAddress,
            spoke: builderContext(spokeCtx),
            vaultAddress,
          })
          const notifyAssetPrice = notifyAssetPriceCall(
            hubCtx,
            self.pool.id,
            vault.shareClassId.raw,
            vault.assetId,
            refundAddress
          )
          batch.push(notifyAssetPrice.data, ...(linked.calls ?? []).map((call) => call.data))
          messageTypes.push(
            notifyAssetPrice.message,
            { type: MessageType.UpdateVault, subtype: VaultUpdateKind.DeployAndLink, poolId: self.pool.id },
            messageV3_3(MessageTypeV3_3.ManagerCallFromHub, self.pool.id)
          )
          continue
        }

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
                refundAddress,
              ],
            })
          )
        }

        const notifyAssetPrice = notifyAssetPriceCall(
          hubCtx,
          self.pool.id,
          vault.shareClassId.raw,
          vault.assetId,
          refundAddress
        )
        batch.push(
          notifyAssetPrice.data,
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
              refundAddress,
            ],
          })
        )
        messageTypes.push(notifyAssetPrice.message, {
          type: MessageType.UpdateVault,
          subtype: VaultUpdateKind.DeployAndLink,
          poolId: self.pool.id,
        })
      }

      const setAdaptersInBatch = setAdapters !== null && !v3_3
      if (batch.length === (setAdaptersInBatch ? 1 : 0)) {
        throw new Error('No share classes / vaults to deploy')
      }

      if (setAdapters !== null && v3_3) {
        yield* sendCallsInOrder('Deploy share classes and vaults', ctx, [
          {
            title: 'Set pool adapters',
            contract: hub,
            policy: { poolId: self.pool.id },
            data: [setAdapters],
            messages: { [self.centrifugeId]: setAdaptersMessages },
          },
          {
            title: 'Deploy share classes and vaults',
            contract: hub,
            policy: { poolId: self.pool.id },
            data: batch,
            messages: { [self.centrifugeId]: messageTypes },
            pendingPoolAdapters,
          },
        ])
        return
      }

      yield* wrapTransaction('Deploy share classes and vaults', ctx, {
        data: batch,
        contract: hub,
        policy: { poolId: self.pool.id },
        messages: { [self.centrifugeId]: messageTypes },
        ...(setAdaptersInBatch ? { pendingPoolAdapters } : {}),
      })
    }, this.pool.centrifugeId)
  }

  /**
   * The address a v3.3 vault factory will deploy a vault to, read from the
   * factory itself (`getVault` over the CREATE2 salt), so the hub batch can
   * point the share token at it before it exists.
   */
  async #predictVaultAddress(
    spokeCtx: SdkProtocolContext,
    factory: HexString,
    scId: ShareClassId,
    assetId: AssetId
  ): Promise<HexString> {
    const client = await firstValueFrom(this._root.getClient(this.centrifugeId))
    const registry = spokeReadTarget(spokeCtx)
    const [{ address: asset, tokenId }, token] = await Promise.all([
      spokeAssets(client, spokeCtx).requireAsset(assetId),
      client.readContract({
        address: registry.address,
        abi: registry.abi,
        functionName: 'shareToken',
        args: [this.pool.id.raw, scId.raw],
      }),
    ])
    const vault = await client.readContract({
      address: factory,
      abi: VAULT_FACTORY_ABI_V3_3,
      functionName: 'getVault',
      args: [this.pool.id.raw, scId.raw, asset, tokenId, token, '0x'],
    })
    return vault.toLowerCase() as HexString
  }

  /**
   * Route one part of the backend's batched `updateVaults` action, or build the
   * whole edit locally.
   *
   * Shared by {@link linkVaults} and {@link unlinkVaults} (and mirrored by
   * `Vault.updateMaxReserve`, which fills the third part) because all three
   * send the SAME action with a different key set — which is the action's
   * design: link, unlink and reserve are one transaction, and the partial
   * subsets are covered deliberately.
   *
   * @internal
   */
  #routeVaultEdit(
    title: string,
    payload: (refundAddress: HexString) => Record<string, unknown>,
    local: () => Transaction,
    options: VaultWriteOptions,
    method: string
  ): Transaction {
    return this._root._routeDeferredTransaction(
      'updateVaults',
      this.pool.id.toString(),
      async () => {
        // See the note on the `deployVault` route: the local path asserts this
        // kill switch, so this one does too.
        assertCrosschainMessagingEnabled(this.centrifugeId)
        return {
          poolId: this.pool.id.toString(),
          centrifugeId: String(this.centrifugeId),
          ...payload(requireRefundAddress(options, method)),
        }
      },
      { title, centrifugeId: this.pool.centrifugeId, gate: [{ centrifugeId: this.centrifugeId }], local }
    )
  }

  /**
   * Unlink vaults.
   * @param vaults - An array of vaults to unlink
   * @param options.refundAddress - See {@link deploy}. Required in backend mode.
   *
   * Routed to the `unlink` half of the backend's batched `updateVaults` action
   * in backend mode. The local path's two client-side checks — that the
   * share class is active and that the address is one of its projected vaults —
   * are not repeated on that route: the backend re-derives both from the
   * projection and answers 422 `UNKNOWN_VAULT`, which is the same refusal made
   * authoritative rather than advisory. A caller sees a `TxPreparationError`
   * carrying that code, in place of the local path's plain `Error`; loud either way.
   */
  unlinkVaults(
    vaults: { shareClassId: ShareClassId; assetId: AssetId; address: HexString }[],
    options: VaultWriteOptions = {}
  ) {
    return this.#routeVaultEdit(
      'Unlink vaults',
      (refundAddress) => ({ unlink: vaults.map(toVaultRef), refundAddress }),
      () => this.#unlinkVaultsLocal(vaults, options),
      options,
      'poolNetwork.unlinkVaults()'
    )
  }

  #unlinkVaultsLocal(
    vaults: { shareClassId: ShareClassId; assetId: AssetId; address: HexString }[],
    options: VaultWriteOptions = {}
  ) {
    const self = this
    return this._transact(async function* (ctx) {
      assertCrosschainMessagingEnabled(self.centrifugeId)

      if (vaults.length === 0) {
        throw new Error('No vaults to unlink')
      }

      const refundAddress = options.refundAddress ?? ctx.signingAddress

      const [hubCtx, details, spokeCtx] = await Promise.all([
        self._root.protocolContext(self.pool.id),
        self.details(),
        self._protocolContext(),
      ])
      const { hub, contractAbis: ABI } = hubCtx

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

        if (isV3_3(hubCtx)) {
          // v3.3 also moves the share token's vault pointer, through the registrar, in the same batch.
          const built = builders.updateVault(builderContext(hubCtx), {
            poolId: self.pool.id.toString(),
            scId: vault.shareClassId.raw,
            assetId: vault.assetId.toString(),
            vaultOrFactory: vault.address,
            kind: 'unlink',
            refundAddress,
            spoke: builderContext(spokeCtx),
          })
          batch.push(...(built.calls ?? []).map((call) => call.data))
          messageTypes.push(
            { type: MessageType.UpdateVault, subtype: VaultUpdateKind.Unlink, poolId: self.pool.id },
            messageV3_3(MessageTypeV3_3.ManagerCallFromHub, self.pool.id)
          )
          continue
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
              refundAddress,
            ],
          })
        )
        messageTypes.push({ type: MessageType.UpdateVault, subtype: VaultUpdateKind.Unlink, poolId: self.pool.id })
      }

      yield* wrapTransaction('Unlink vaults', ctx, {
        data: batch,
        contract: hub,
        policy: { poolId: self.pool.id },
        messages: { [self.centrifugeId]: messageTypes },
      })
    }, this.pool.centrifugeId)
  }

  /**
   * Link vaults that are already deployed but currently unlinked.
   * @param vaults - An array of vaults to link.
   * @param options.refundAddress - See {@link deploy}. Required in backend mode.
   *
   * Routed to the `link` half of the backend's batched `updateVaults` action in
   * backend mode; see {@link unlinkVaults} for what happens to the two
   * client-side checks.
   *
   * One detail the local path has that the payload does not: it re-reads the
   * share class's vaults (unlinked included) and encodes the PROJECTED
   * address rather than the caller's, which normalises casing. The backend
   * looks the same row up itself and `addressToBytes32` lowercases on both
   * sides, so the bytes agree whichever spelling the caller passes.
   */
  linkVaults(
    vaults: { shareClassId: ShareClassId; assetId: AssetId; address: HexString }[],
    options: VaultWriteOptions = {}
  ) {
    return this.#routeVaultEdit(
      'Link vaults',
      (refundAddress) => ({ link: vaults.map(toVaultRef), refundAddress }),
      () => this.#linkVaultsLocal(vaults, options),
      options,
      'poolNetwork.linkVaults()'
    )
  }

  #linkVaultsLocal(
    vaults: { shareClassId: ShareClassId; assetId: AssetId; address: HexString }[],
    options: VaultWriteOptions = {}
  ) {
    const self = this
    return this._transact(async function* (ctx) {
      assertCrosschainMessagingEnabled(self.centrifugeId)

      if (vaults.length === 0) {
        throw new Error('No vaults to link')
      }

      const refundAddress = options.refundAddress ?? ctx.signingAddress

      const [hubCtx, details, spokeCtx] = await Promise.all([
        self._root.protocolContext(self.pool.id),
        self.details(),
        self._protocolContext(),
      ])
      const { hub, contractAbis: ABI } = hubCtx

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

        if (isV3_3(hubCtx)) {
          // v3.3 also moves the share token's vault pointer, through the registrar, in the same batch.
          const built = builders.updateVault(builderContext(hubCtx), {
            poolId: self.pool.id.toString(),
            scId: vault.shareClassId.raw,
            assetId: vault.assetId.toString(),
            vaultOrFactory: existingVault.address,
            kind: 'link',
            refundAddress,
            spoke: builderContext(spokeCtx),
          })
          batch.push(...(built.calls ?? []).map((call) => call.data))
          messageTypes.push(
            { type: MessageType.UpdateVault, subtype: VaultUpdateKind.Link, poolId: self.pool.id },
            messageV3_3(MessageTypeV3_3.ManagerCallFromHub, self.pool.id)
          )
          continue
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
              refundAddress,
            ],
          })
        )
        messageTypes.push({ type: MessageType.UpdateVault, subtype: VaultUpdateKind.Link, poolId: self.pool.id })
      }

      yield* wrapTransaction('Link vaults', ctx, {
        data: batch,
        contract: hub,
        policy: { poolId: self.pool.id },
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
      combineLatest([this._protocolContext(), this._root.getClient(this.centrifugeId)]).pipe(
        switchMap(([ctx, client]) => {
          const { protocolVersion } = ctx
          const registry = spokeReadTarget(ctx)
          return defer(async () => {
            try {
              const address = await client.readContract({
                address: registry.address,
                abi: registry.abi,
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
                address: registry.address,
                eventName: 'AddShareClass',
                filter: (events) => {
                  return events.some((event) => event.args.poolId === this.pool.id.raw && event.args.scId === scId.raw)
                },
              },
              this.centrifugeId,
              protocolVersion
            )
          )
        })
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
