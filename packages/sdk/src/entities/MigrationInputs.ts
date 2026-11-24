import {
  ABIS_V3_3,
  STANDARD_ABIS,
  V33_MIGRATION_ABI_V3_3,
  type AssetPriceKey,
  type HoldingSeed,
  type HookManagerSeed,
  type ManagerGrant,
  type OffboardSpokeInput,
  type OnboardHubInput,
  type OnboardSpokeInput,
  type RampConfigSeed,
  type RampSeed,
  type RotateAsset,
  type SyncReserveKey,
  type VaultKey,
  type VaultSeed,
} from '@centrifuge/protocol'
import {
  BaseError,
  ContractFunctionRevertedError,
  encodeAbiParameters,
  isAddressEqual,
  keccak256,
  parseAbi,
  toHex,
  zeroAddress,
  type Abi,
  type PublicClient,
} from 'viem'
import type { SdkProtocolContext } from '../Centrifuge.js'
import { CentrifugeError } from '../errors.js'
import type { HexString } from '../types/index.js'
import { requireContract } from '../utils/protocolVersion.js'
import { AssetId, PoolId, ShareClassId, type CentrifugeId } from '../utils/types.js'

export type MigrationInputSource = 'chain' | 'idx' | 'idxchain' | 'logs' | 'skipped' | 'record'

export type MigrationLiveVault = {
  vault: HexString
  factory: HexString
  scId: ShareClassId
  assetId: AssetId
  asset: HexString
  isLinked: boolean
  isSync: boolean
}

export type MigrationHookGrants = {
  scId: ShareClassId
  token: HexString
  v32Hook: HexString
  managers: HexString[]
}

export type MigrationSpokeCandidates = {
  managers: HexString[]
  vaults: HexString[]
  rampInstances: HexString[]
  ramp: {
    relayers: HexString[]
    offrampAssets: HexString[]
    offrampReceivers: HexString[]
  }
}

export type MigrationSpokeInventory = {
  centrifugeId: CentrifugeId
  block: bigint
  scIds: ShareClassId[]
  tokens: HexString[]
  assetIds: AssetId[]
  assets: HexString[]
  vaults: MigrationLiveVault[]
  unknownVaults: HexString[]
  rotationAssets: HexString[]
  balanceSheetManagers: HexString[]
  gatewayManagers: HexString[]
  grantedRamps: HexString[]
  syncReserves: SyncReserveKey[]
  assetPrices: AssetPriceKey[]
  hookGrants: MigrationHookGrants[]
  /** Live v3.2 managers the offboard did not remove, so they keep their v3.2 authority; empty before Offboarded. */
  notCarried: { balanceSheetManagers: HexString[]; gatewayManagers: HexString[] }
  sources: Record<
    | 'scIds'
    | 'assets'
    | 'vaults'
    | 'rotationAssets'
    | 'balanceSheetManagers'
    | 'gatewayManagers'
    | 'grantedRamps'
    | 'syncReserves'
    | 'assetPrices'
    | 'hookGrants',
    MigrationInputSource
  >
}

export type MigrationHubInventory = {
  block: bigint
  classCount: number
  scIds: ShareClassId[]
  registeredAssetIds: AssetId[]
  orderedAssetIds: AssetId[]
  spokeRecord: CentrifugeId[]
  v32Admins: HexString[]
  holdings: HoldingSeed[]
}

export type MigrationSpokeInputs = {
  inventory: MigrationSpokeInventory
  freeze: { syncReserves: SyncReserveKey[] }
  offboard: OffboardSpokeInput
  onboardSpoke: OnboardSpokeInput
  managerGrants: ManagerGrant[]
}

export type MigrationHubInputs = {
  inventory: MigrationHubInventory
  onboardHub: OnboardHubInput
}

export type MigrationInputsOptions = {
  /** First block of the `UpdateHookManager` sweep; omitted, no hook-manager grants are derived. */
  hookLogsFromBlock?: bigint
  /** The ramp seeds' own gas budget, measured by the walk rather than derived here. */
  rampExtraGasLimit?: bigint
  /** The v3.2 hooks the deployed migration maps to v3.3 hooks, in the same order. */
  hookMap?: { v32: HexString[]; v33: HexString[] }
  /**
   * The deployed migration facade on the chain read. Past the offboard the v3.2 registry reads every vault
   * unlinked, so a vault's link bit comes back from the facade's own `vaultUnlinked` record, as
   * `MigrationRecords.restoreOffboarded` does before the reference derives the onboard.
   */
  migration?: HexString
}

/** @internal */
export function migrationInputsKey(options: MigrationInputsOptions): string {
  return [
    options.hookLogsFromBlock?.toString() ?? '',
    options.rampExtraGasLimit?.toString() ?? '',
    options.hookMap?.v32.join(',') ?? '',
    options.hookMap?.v33.join(',') ?? '',
    options.migration ?? '',
  ].join('|')
}

export class MigrationInputsReadError extends CentrifugeError {
  override name = 'MigrationInputsReadError'
  constructor(what: string, detail: string) {
    super(`[GAP] ${what}: ${detail}`)
  }
}

/** @internal */
export const CLASS_PROBE_MAX = 64
const ASSET_PROBE_STRIDE = 32
/** @internal */
export const HUB_ASSET_CID_MAX = 16
/** @internal */
export const HUB_ASSET_COUNTER_MAX = 128
/** @internal */
export const MAX_V32_CENTRIFUGE_ID = 16

/** @internal */
export const LEGACY_ABI = parseAbi([
  'function poolId() view returns (uint256)',
  'function scId() view returns (bytes16)',
  'function balanceSheet() view returns (address)',
  'function relayer(address who) view returns (bool)',
  'function onramp(address asset) view returns (bool)',
  'function offramp(address asset, address receiver) view returns (bool)',
  'function contractUpdater() view returns (uint256)',
  'function hubRegistry() view returns (uint256)',
  'function hook() view returns (address)',
  'function manager(address token, address who) view returns (bool)',
  'function syncDepositManager() view returns (address)',
  'function hubRequestManager(uint64 poolId, uint16 centrifugeId) view returns (address)',
  'event UpdateHookManager(address indexed token, address indexed manager, bool canManage)',
  'event Rely(address indexed user)',
])

/** @internal */
export type Call = { address: HexString; abi: Abi; functionName: string; args?: readonly unknown[] }
/** @internal */
export type Result = { status: 'success'; result: unknown } | { status: 'failure'; error: unknown }

export type MigrationInputsReader = {
  readonly block: bigint
  read(calls: readonly Call[]): Promise<Result[]>
  logs(input: { address: HexString; topics: HexString[]; fromBlock: bigint }): Promise<{ topics: HexString[] }[]>
  hasCode(address: HexString, block: bigint): Promise<boolean>
  /** The bytecode at `address` at the reader's block; `0x` for none. Optional: only the pre-check classifies hooks by code. */
  code?(address: HexString): Promise<HexString>
}

/** @internal */
export function clientReader(client: PublicClient, block: bigint): MigrationInputsReader {
  return {
    block,
    async read(calls) {
      if (calls.length === 0) return []
      const results = await client.multicall({
        contracts: calls.map((call) => ({ ...call, args: call.args ?? [] })) as any,
        allowFailure: true,
        blockNumber: block,
      })
      return results.map((result: any) =>
        result.status === 'success'
          ? { status: 'success', result: result.result }
          : { status: 'failure', error: result.error }
      )
    },
    async logs({ address, topics, fromBlock }) {
      const logs = await client.request({
        method: 'eth_getLogs',
        params: [{ address, topics, fromBlock: `0x${fromBlock.toString(16)}`, toBlock: `0x${block.toString(16)}` }],
      } as any)
      return (logs as { topics: HexString[] }[]).map((log) => ({ topics: log.topics }))
    },
    async hasCode(address, at) {
      const code = await client.getCode({ address, blockNumber: at })
      return code !== undefined && code !== '0x'
    },
    async code(address) {
      return ((await client.getCode({ address, blockNumber: block })) ?? '0x') as HexString
    },
  }
}

/** @internal */
export function revertedWith(error: unknown, errorName: string): boolean {
  return (
    error instanceof BaseError &&
    !!error.walk((e) => e instanceof ContractFunctionRevertedError && e.data?.errorName === errorName)
  )
}

/** `VaultRegistry.vaultDetails` answers one struct, which viem decodes to an object, not a tuple. */
type VaultDetails = { assetId: bigint; asset: HexString; tokenId: bigint; isLinked: boolean }

/** @internal */
export function answered<T>(result: Result, what: string): T {
  if (result.status === 'failure') {
    throw new MigrationInputsReadError(what, 'the read failed, so its key set would be short')
  }
  return result.result as T
}

/** @internal */
export function present(result: Result, absent: string, what: string): boolean {
  if (result.status === 'success') return true
  if (revertedWith(result.error, absent)) return false
  throw new MigrationInputsReadError(what, 'the read failed with something other than its absent-key revert')
}

/** @internal */
export function word(result: Result): bigint {
  if (result.status !== 'success') return 0n
  const value = result.result
  if (typeof value === 'bigint') return value
  if (typeof value === 'string' && value.startsWith('0x')) return BigInt(value)
  if (typeof value === 'boolean') return value ? 1n : 0n
  return 0n
}

/** @internal */
export function addressWord(result: Result): HexString | null {
  const value = word(result)
  if (value === 0n || value > (1n << 160n) - 1n) return null
  return `0x${value.toString(16).padStart(40, '0')}` as HexString
}

/** @internal */
export function unique(addresses: readonly HexString[]): HexString[] {
  const seen = new Set<string>()
  return addresses.filter((address) => {
    const key = address.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** @internal */
export function includes(list: readonly HexString[], who: HexString): boolean {
  return list.some((entry) => isAddressEqual(entry, who))
}

/** @internal */
export function addressToBytes32(who: HexString): HexString {
  return `0x${who.slice(2).toLowerCase().padEnd(64, '0')}` as HexString
}

/** @internal */
export function addressTopic(who: HexString): HexString {
  return `0x${who.slice(2).toLowerCase().padStart(64, '0')}` as HexString
}

/** @internal */
export type V32Refs = {
  spoke: HexString
  gateway: HexString
  holdings: HexString
  hubRegistry: HexString
  balanceSheet: HexString
  syncManager: HexString
  vaultRegistry: HexString
  poolEscrowFactory: HexString
  shareClassManager: HexString
  asyncRequestManager: HexString
  batchRequestManager: HexString
}

/** @internal */
export type V33Refs = {
  asyncRequestManager: HexString
  syncManager: HexString
  asyncVaultFactory: HexString
  syncDepositVaultFactory: HexString
  onOffRampFactory: HexString
}

/** @internal */
export function v32RefsOf(ctx: SdkProtocolContext): V32Refs {
  return {
    spoke: requireContract(ctx, 'spoke'),
    gateway: requireContract(ctx, 'gateway'),
    holdings: requireContract(ctx, 'holdings'),
    hubRegistry: requireContract(ctx, 'hubRegistry'),
    balanceSheet: requireContract(ctx, 'balanceSheet'),
    syncManager: requireContract(ctx, 'syncManager'),
    vaultRegistry: requireContract(ctx, 'vaultRegistry'),
    poolEscrowFactory: requireContract(ctx, 'poolEscrowFactory'),
    shareClassManager: requireContract(ctx, 'shareClassManager'),
    asyncRequestManager: requireContract(ctx, 'asyncRequestManager'),
    batchRequestManager: requireContract(ctx, 'batchRequestManager'),
  }
}

/** @internal */
export function v33RefsOf(ctx: SdkProtocolContext): V33Refs {
  return {
    asyncRequestManager: requireContract(ctx, 'asyncRequestManager'),
    syncManager: requireContract(ctx, 'syncManager'),
    asyncVaultFactory: requireContract(ctx, 'asyncVaultFactory'),
    syncDepositVaultFactory: requireContract(ctx, 'syncDepositVaultFactory'),
    onOffRampFactory: requireContract(ctx, 'onOffRampFactory'),
  }
}

/**
 * Derives the v3.3 migration's input structs from the live v3.2 stack of one chain at one block,
 * the way `MigrationInputs.sol` does: every list-shaped v3.2 set is enumerated elsewhere (the
 * indexer, as candidates) and decided here against the v3.2 contracts. A pure function of its
 * reads: the same block gives the same structs.
 * @internal
 */
export class MigrationInputsDerivation {
  constructor(
    readonly reader: MigrationInputsReader,
    readonly v32: V32Refs,
    readonly v33: V33Refs,
    readonly abis: SdkProtocolContext['contractAbis'],
    /** The chain this instance reads, never the hub's: a spoke's asset ids are keyed by its own chain. */
    readonly localCentrifugeId: CentrifugeId,
    readonly options: MigrationInputsOptions = {}
  ) {}

  // Hub side

  async hubShareClassCount(poolId: PoolId): Promise<number> {
    const [result] = await this.reader.read([
      {
        address: this.v32.shareClassManager,
        abi: this.abis.ShareClassManager,
        functionName: 'shareClassCount',
        args: [poolId.raw],
      },
    ])
    return Number(answered<number | bigint>(result!, 'hubShareClassCount: v3.2 ShareClassManager.shareClassCount'))
  }

  hubScIds(poolId: PoolId, count: number): ShareClassId[] {
    return Array.from({ length: count }, (_, i) => ShareClassId.from(poolId, i + 1))
  }

  async hubSpokeRecord(poolId: PoolId): Promise<CentrifugeId[]> {
    const cids = Array.from({ length: MAX_V32_CENTRIFUGE_ID }, (_, i) => (i + 1) as CentrifugeId)
    const results = await this.reader.read(
      cids.map((cid) => ({
        address: this.v32.hubRegistry,
        abi: LEGACY_ABI,
        functionName: 'hubRequestManager',
        args: [poolId.raw, cid],
      }))
    )
    return cids.filter((_, i) => {
      const manager = answered<HexString>(
        results[i]!,
        'hubSpokeRecord: the v3.2 hub registry did not answer hubRequestManager'
      )
      return !isAddressEqual(manager, zeroAddress)
    })
  }

  async hubAssetIds(): Promise<AssetId[]> {
    const candidates: AssetId[] = []
    for (let cid = 1; cid <= HUB_ASSET_CID_MAX; cid++) {
      for (let counter = 1; counter <= HUB_ASSET_COUNTER_MAX; counter++) candidates.push(AssetId.from(cid, counter))
    }
    const results = await this.reader.read(
      candidates.map((id) => ({
        address: this.v32.hubRegistry,
        abi: this.abis.HubRegistry,
        functionName: 'isRegistered',
        args: [id.raw],
      }))
    )
    return candidates.filter((id, i) => {
      if (!answered<boolean>(results[i]!, 'hubAssetIds: v3.2 HubRegistry.isRegistered')) return false
      if (id.centrifugeId === HUB_ASSET_CID_MAX || Number(id.raw & 0xffffffffffffffffn) === HUB_ASSET_COUNTER_MAX) {
        throw new MigrationInputsReadError(
          'hubAssetIds',
          'a registered asset sits on the probe window edge; widen HUB_ASSET_CID_MAX / HUB_ASSET_COUNTER_MAX'
        )
      }
      return true
    })
  }

  async orderedAssetIds(poolId: PoolId, scIds: ShareClassId[], candidates: AssetId[]): Promise<AssetId[]> {
    const calls: Call[] = []
    for (const scId of scIds) {
      for (const assetId of candidates) {
        const args = [poolId.raw, scId.raw, assetId.raw]
        calls.push(
          { address: this.v32.batchRequestManager, abi: this.abis.BatchRequestManager, functionName: 'epochId', args },
          {
            address: this.v32.batchRequestManager,
            abi: this.abis.BatchRequestManager,
            functionName: 'pendingDeposit',
            args,
          },
          {
            address: this.v32.batchRequestManager,
            abi: this.abis.BatchRequestManager,
            functionName: 'pendingRedeem',
            args,
          }
        )
      }
    }
    const results = await this.reader.read(calls)
    return candidates.filter((_, a) =>
      scIds.some((_, s) => {
        const p = (s * candidates.length + a) * 3
        const epochs = answered<readonly (number | bigint)[]>(results[p]!, 'BRM.epochId')
        const active = epochs.some((epoch) => BigInt(epoch) !== 0n)
        return (
          active ||
          BigInt(answered<bigint>(results[p + 1]!, 'BRM.pendingDeposit')) !== 0n ||
          BigInt(answered<bigint>(results[p + 2]!, 'BRM.pendingRedeem')) !== 0n
        )
      })
    )
  }

  async holdingSeeds(poolId: PoolId, scIds: ShareClassId[], assetIds: AssetId[]): Promise<HoldingSeed[]> {
    const calls: Call[] = []
    for (const scId of scIds) {
      for (const assetId of assetIds) {
        calls.push({
          address: this.v32.holdings,
          abi: this.abis.Holdings,
          functionName: 'holding',
          args: [poolId.raw, scId.raw, assetId.raw],
        })
      }
    }
    const results = await this.reader.read(calls)
    const seeds: HoldingSeed[] = []
    scIds.forEach((scId, s) => {
      assetIds.forEach((assetId, a) => {
        const row = answered<readonly unknown[]>(
          results[s * assetIds.length + a]!,
          'holdingSeeds: v3.2 Holdings.holding'
        )
        const amount = BigInt(row[0] as bigint)
        const isLiability = Boolean(row[row.length - 1])
        if (amount === 0n && !isLiability) return
        seeds.push({ scId: scId.raw, assetId: assetId.raw.toString() })
      })
    })
    return seeds
  }

  async liveManagers(poolId: PoolId, registry: HexString, candidates: readonly HexString[]): Promise<HexString[]> {
    const results = await this.reader.read(
      candidates.map((who) => ({
        address: registry,
        abi: this.abis.BalanceSheet,
        functionName: 'manager',
        args: [poolId.raw, who],
      }))
    )
    const live = candidates.filter((_, i) => answered<boolean>(results[i]!, 'liveManagers: v3.2 manager'))
    return unique(live)
  }

  async hubInventory(
    poolId: PoolId,
    managerCandidates: readonly HexString[],
    holdingOrigins: CentrifugeId[] = [],
    classCount?: number
  ): Promise<MigrationHubInventory> {
    const count = classCount ?? (await this.hubShareClassCount(poolId))
    const scIds = this.hubScIds(poolId, count)
    const [registeredAssetIds, spokeRecord, v32Admins] = await Promise.all([
      this.hubAssetIds(),
      this.hubSpokeRecord(poolId),
      this.liveManagers(poolId, this.v32.hubRegistry, managerCandidates),
    ])
    const scoped =
      holdingOrigins.length === 0
        ? registeredAssetIds
        : registeredAssetIds.filter((id) => holdingOrigins.includes(id.centrifugeId))
    const [orderedAssetIds, holdings] = await Promise.all([
      this.orderedAssetIds(poolId, scIds, registeredAssetIds),
      this.holdingSeeds(poolId, scIds, scoped),
    ])
    return {
      block: this.reader.block,
      classCount: count,
      scIds,
      registeredAssetIds,
      orderedAssetIds,
      spokeRecord,
      v32Admins,
      holdings,
    }
  }

  onboardHubInput(inv: MigrationHubInventory, grants: ManagerGrant[], noV32Spokes: boolean): OnboardHubInput {
    return {
      v32Admins: inv.v32Admins,
      holdings: inv.holdings,
      epochAssetIds: inv.orderedAssetIds.map((id) => id.raw.toString()),
      grants,
      noV32Spokes,
    }
  }

  // Spoke side

  async spokeClasses(poolId: PoolId, hubClassCount: number): Promise<{ scIds: ShareClassId[]; tokens: HexString[] }> {
    const count = hubClassCount === 0 ? CLASS_PROBE_MAX : hubClassCount
    const scIds = this.hubScIds(poolId, count)
    const results = await this.reader.read(
      scIds.map((scId) => ({
        address: this.v32.spoke,
        abi: this.abis.Spoke,
        functionName: 'shareToken',
        args: [poolId.raw, scId.raw],
      }))
    )
    const found: { scIds: ShareClassId[]; tokens: HexString[] } = { scIds: [], tokens: [] }
    scIds.forEach((scId, i) => {
      if (!present(results[i]!, 'ShareTokenDoesNotExist', 'spokeClasses: v3.2 Spoke.shareToken')) return
      const token = (results[i] as { result: HexString }).result
      if (isAddressEqual(token, zeroAddress)) return
      found.scIds.push(scId)
      found.tokens.push(token)
    })
    return found
  }

  async registeredAssets(
    withErc20: boolean,
    withPositions: boolean
  ): Promise<{ assetIds: AssetId[]; assets: HexString[]; tokenIds: bigint[] }> {
    const found: { assetIds: AssetId[]; assets: HexString[]; tokenIds: bigint[] } = {
      assetIds: [],
      assets: [],
      tokenIds: [],
    }
    for (let start = 1; ; start += ASSET_PROBE_STRIDE) {
      const ids = Array.from({ length: ASSET_PROBE_STRIDE }, (_, k) => AssetId.from(this.localCentrifugeId, start + k))
      const results = await this.reader.read(
        ids.map((id) => ({ address: this.v32.spoke, abi: this.abis.Spoke, functionName: 'idToAsset', args: [id.raw] }))
      )
      let exhausted = false
      for (let k = 0; k < ids.length; k++) {
        if (!present(results[k]!, 'UnknownAsset', 'spokeAssets: v3.2 Spoke.idToAsset')) {
          exhausted = true
          break
        }
        const [asset, tokenId] = (results[k] as { result: [HexString, bigint] }).result
        if (tokenId === 0n ? !withErc20 : !withPositions) continue
        found.assetIds.push(ids[k]!)
        found.assets.push(asset)
        found.tokenIds.push(tokenId)
      }
      if (exhausted) break
    }
    return found
  }

  async liveVaults(
    poolId: PoolId,
    candidates: readonly HexString[]
  ): Promise<{ vaults: MigrationLiveVault[]; unknown: HexString[] }> {
    const details = await this.reader.read(
      candidates.map((vault) => ({
        address: this.v32.vaultRegistry,
        abi: this.abis.VaultRegistry,
        functionName: 'vaultDetails',
        args: [vault],
      }))
    )
    const present_ = candidates.map((_, i) =>
      present(details[i]!, 'UnknownVault', 'liveVaults: v3.2 VaultRegistry.vaultDetails')
    )
    const known = candidates.filter((_, i) => present_[i])
    const unknown = candidates.filter((_, i) => !present_[i])
    const probes = await this.reader.read(
      known.flatMap((vault) => [
        { address: vault, abi: this.abis.AsyncVault, functionName: 'poolId' },
        { address: vault, abi: this.abis.AsyncVault, functionName: 'scId' },
        { address: vault, abi: LEGACY_ABI, functionName: 'syncDepositManager' },
      ])
    )
    const migration = this.options.migration
    const unlinked = migration
      ? await this.reader.read(
          known.map((vault) => ({
            address: migration,
            abi: V33_MIGRATION_ABI_V3_3 as Abi,
            functionName: 'vaultUnlinked',
            args: [poolId.raw, vault],
          }))
        )
      : []
    const vaults: MigrationLiveVault[] = []
    known.forEach((vault, i) => {
      const { assetId, asset, isLinked } = answered<VaultDetails>(
        details[candidates.indexOf(vault)]!,
        'liveVaults: v3.2 VaultRegistry.vaultDetails'
      )
      const vaultPool = BigInt(answered<bigint>(probes[i * 3]!, 'liveVaults: v3.2 vault.poolId'))
      if (vaultPool !== poolId.raw) return
      const scId = answered<HexString>(probes[i * 3 + 1]!, 'liveVaults: v3.2 vault.scId')
      const sync = probes[i * 3 + 2]!
      const isSync = sync.status === 'success'
      const wasUnlinked = migration
        ? Boolean(answered<boolean>(unlinked[i]!, 'liveVaults: V33Migration.vaultUnlinked'))
        : false
      vaults.push({
        vault,
        factory: isSync ? this.v33.syncDepositVaultFactory : this.v33.asyncVaultFactory,
        scId: new ShareClassId(scId),
        assetId: new AssetId(assetId),
        asset,
        isLinked: isLinked || wasUnlinked,
        isSync,
      })
    })
    return { vaults, unknown }
  }

  async rotationAssets(
    poolId: PoolId,
    scIds: ShareClassId[],
    assets: readonly HexString[],
    excludedTokens: readonly HexString[]
  ): Promise<HexString[]> {
    const [escrowResult] = await this.reader.read([
      {
        address: this.v32.poolEscrowFactory,
        abi: this.abis.PoolEscrowFactory,
        functionName: 'escrow',
        args: [poolId.raw],
      },
    ])
    const escrow = answered<HexString>(escrowResult!, 'rotationAssets: v3.2 PoolEscrowFactory.escrow')
    const calls: Call[] = []
    for (const asset of assets) {
      calls.push({ address: asset, abi: STANDARD_ABIS.Currency, functionName: 'balanceOf', args: [escrow] })
      for (const scId of scIds) {
        calls.push({ address: escrow, abi: this.abis.PoolEscrow, functionName: 'holding', args: [scId.raw, asset, 0n] })
      }
    }
    const results = await this.reader.read(calls)
    const stride = 1 + scIds.length
    return assets.filter((asset, a) => {
      if (includes(excludedTokens, asset)) return false
      if (BigInt(answered<bigint>(results[a * stride]!, 'rotationAssets: balanceOf')) !== 0n) return true
      return scIds.some((_, s) => {
        const [total, reserved] = answered<readonly [bigint, bigint]>(
          results[a * stride + 1 + s]!,
          'ledgerRow: v3.2 PoolEscrow.holding'
        )
        return BigInt(total) !== 0n || BigInt(reserved) !== 0n
      })
    })
  }

  async v32Ramps(poolId: PoolId, managers: readonly HexString[]): Promise<HexString[]> {
    const results = await this.reader.read(
      managers.flatMap((manager) => [
        { address: manager, abi: LEGACY_ABI, functionName: 'poolId' },
        { address: manager, abi: LEGACY_ABI, functionName: 'balanceSheet' },
        { address: manager, abi: LEGACY_ABI, functionName: 'relayer', args: [zeroAddress] },
      ])
    )
    return managers.filter((_, i) => {
      if (word(results[i * 3]!) !== poolId.raw) return false
      const sheet = addressWord(results[i * 3 + 1]!)
      if (sheet === null || !isAddressEqual(sheet, this.v32.balanceSheet)) return false
      return results[i * 3 + 2]!.status === 'success'
    })
  }

  async peripheryInstances(managers: readonly HexString[]): Promise<HexString[]> {
    const results = await this.reader.read(
      managers.flatMap((manager) => [
        { address: manager, abi: LEGACY_ABI, functionName: 'poolId' },
        { address: manager, abi: LEGACY_ABI, functionName: 'contractUpdater' },
      ])
    )
    return unique(
      managers.filter((_, i) => {
        const pool = word(results[i * 2]!)
        if (pool === 0n || pool > 0xffffffffffffffffn) return false
        return addressWord(results[i * 2 + 1]!) !== null
      })
    )
  }

  async managerGrants(centrifugeId: CentrifugeId, balanceSheetManagers: readonly HexString[]): Promise<ManagerGrant[]> {
    const periphery = await this.peripheryInstances(balanceSheetManagers)
    return balanceSheetManagers
      .filter((who) => !includes(periphery, who))
      .map((who) => ({
        centrifugeId: String(centrifugeId),
        kind: 'spoke' as const,
        who: addressToBytes32(this.swapStack(who)),
      }))
  }

  async hubStackBound(candidates: readonly HexString[]): Promise<HexString[]> {
    const results = await this.reader.read(
      candidates.map((who) => ({ address: who, abi: LEGACY_ABI, functionName: 'hubRegistry' }))
    )
    return candidates.filter((_, i) => {
      const registry = addressWord(results[i]!)
      return registry !== null && isAddressEqual(registry, this.v32.hubRegistry)
    })
  }

  swapStack(who: HexString): HexString {
    if (isAddressEqual(who, this.v32.asyncRequestManager)) return this.v33.asyncRequestManager
    if (isAddressEqual(who, this.v32.syncManager)) return this.v33.syncManager
    return who
  }

  async syncReserveKeys(
    poolId: PoolId,
    scIds: ShareClassId[],
    assets: readonly HexString[]
  ): Promise<SyncReserveKey[]> {
    const calls: Call[] = []
    for (const scId of scIds) {
      for (const asset of assets) {
        calls.push({
          address: this.v32.syncManager,
          abi: this.abis.SyncManager,
          functionName: 'maxReserve',
          args: [poolId.raw, scId.raw, asset, 0n],
        })
      }
    }
    const results = await this.reader.read(calls)
    const keys: SyncReserveKey[] = []
    scIds.forEach((scId, s) => {
      assets.forEach((asset, a) => {
        const max = BigInt(
          answered<bigint>(results[s * assets.length + a]!, 'syncReserveKeys: v3.2 SyncManager.maxReserve')
        )
        if (max !== 0n) keys.push({ scId: scId.raw, asset })
      })
    })
    return keys
  }

  async assetPriceKeys(
    poolId: PoolId,
    scIds: ShareClassId[],
    ids: readonly (AssetId | null)[]
  ): Promise<AssetPriceKey[]> {
    const calls: Call[] = []
    for (const scId of scIds) {
      for (const id of ids) {
        calls.push({
          address: this.v32.spoke,
          abi: this.abis.Spoke,
          functionName: 'markersPricePoolPerAsset',
          args: [poolId.raw, scId.raw, id?.raw ?? 0n],
        })
      }
    }
    const results = await this.reader.read(calls)
    const keys: AssetPriceKey[] = []
    scIds.forEach((scId, s) => {
      ids.forEach((id, a) => {
        if (id === null) return
        const [computedAt] = answered<readonly [bigint, bigint, bigint]>(
          results[s * ids.length + a]!,
          'assetPriceKeys: v3.2 Spoke.markersPricePoolPerAsset'
        )
        if (BigInt(computedAt) === 0n) return
        keys.push({ scId: scId.raw, assetId: id.raw.toString() })
      })
    })
    return keys
  }

  async registeredAssetPriceKeys(poolId: PoolId, scIds: ShareClassId[]): Promise<AssetPriceKey[]> {
    const { assetIds } = await this.registeredAssets(true, true)
    return this.assetPriceKeys(poolId, scIds, assetIds)
  }

  async hookGrants(scIds: ShareClassId[], tokens: readonly HexString[]): Promise<MigrationHookGrants[]> {
    const hookResults = await this.reader.read(
      tokens.map((token) => ({ address: token, abi: LEGACY_ABI, functionName: 'hook' }))
    )
    const hooks = tokens.map((_, i) => answered<HexString>(hookResults[i]!, 'hookGrants: v3.2 ShareToken.hook'))
    return this.hookGrantsOn(scIds, tokens, hooks)
  }

  async hookGrantsOn(
    scIds: ShareClassId[],
    tokens: readonly HexString[],
    hooks: readonly HexString[]
  ): Promise<MigrationHookGrants[]> {
    const grants: MigrationHookGrants[] = []
    for (let i = 0; i < scIds.length; i++) {
      const hook = hooks[i]!
      if (isAddressEqual(hook, zeroAddress)) continue
      const live = await this.liveHookManagers(hook, tokens[i]!)
      if (live.length === 0) continue
      grants.push({ scId: scIds[i]!, token: tokens[i]!, v32Hook: hook, managers: live })
    }
    return grants
  }

  async liveHookManagers(hook: HexString, token: HexString): Promise<HexString[]> {
    const fromBlock = this.options.hookLogsFromBlock
    if (fromBlock === undefined) return []
    if (fromBlock > 0n && (await this.reader.hasCode(hook, fromBlock - 1n))) {
      throw new MigrationInputsReadError(
        `hook managers of ${token}`,
        `hookLogsFromBlock ${fromBlock} is after hook ${hook} was deployed, so the sweep would miss grants made before it`
      )
    }
    const [logs, control] = await Promise.all([
      this.reader.logs({
        address: hook,
        topics: [topicOf('UpdateHookManager(address,address,bool)'), addressTopic(token)],
        fromBlock,
      }),
      this.reader.logs({ address: hook, topics: [topicOf('Rely(address)')], fromBlock }),
    ])
    if (logs.length === 0 && control.length === 0) {
      throw new MigrationInputsReadError(
        `hook managers of ${token}`,
        `the UpdateHookManager sweep on hook ${hook} answered nothing and the same range answers no Rely from the hook either, so its zero is not a measurement`
      )
    }
    return this.hookManagersFromLogs(hook, token, logs)
  }

  async hookManagersFromLogs(
    hook: HexString,
    token: HexString,
    logs: readonly { topics: HexString[] }[]
  ): Promise<HexString[]> {
    const seen = unique(
      logs.filter((log) => log.topics.length >= 3).map((log) => `0x${log.topics[2]!.slice(26)}` as HexString)
    )
    const results = await this.reader.read(
      seen.map((who) => ({ address: hook, abi: LEGACY_ABI, functionName: 'manager', args: [token, who] }))
    )
    return seen.filter(
      (_, i) => results[i]!.status === 'success' && (results[i] as { result: boolean }).result === true
    )
  }

  hookManagerSeeds(grants: readonly MigrationHookGrants[]): HookManagerSeed[] {
    const map = this.options.hookMap ?? { v32: [], v33: [] }
    if (map.v32.length !== map.v33.length)
      throw new MigrationInputsReadError('hookManagerSeeds', 'hook map halves disagree')
    const seeds: HookManagerSeed[] = []
    for (const grant of grants) {
      let resolved = grant.v32Hook
      map.v32.forEach((v32Hook, j) => {
        if (isAddressEqual(v32Hook, grant.v32Hook) && !isAddressEqual(map.v33[j]!, zeroAddress)) resolved = map.v33[j]!
      })
      if (isAddressEqual(resolved, grant.v32Hook)) continue
      seeds.push({ scId: grant.scId.raw, hook: resolved, managers: grant.managers })
    }
    return seeds
  }

  // Ramps

  async rampConfigs(
    instance: HexString,
    candidates: MigrationSpokeCandidates['ramp'],
    assets: readonly HexString[],
    assetIds: readonly AssetId[]
  ): Promise<HexString[]> {
    const results = await this.reader.read([
      ...assets.map((asset) => ({ address: instance, abi: LEGACY_ABI, functionName: 'onramp', args: [asset] })),
      ...candidates.relayers.map((relayer) => ({
        address: instance,
        abi: LEGACY_ABI,
        functionName: 'relayer',
        args: [relayer],
      })),
      ...candidates.offrampReceivers.map((receiver, i) => ({
        address: instance,
        abi: LEGACY_ABI,
        functionName: 'offramp',
        args: [candidates.offrampAssets[i]!, receiver],
      })),
    ])
    const configs: HexString[] = []
    const push = (tuple: HexString) => {
      if (!configs.includes(tuple)) configs.push(tuple)
    }
    let p = 0
    assets.forEach((_, i) => {
      const ok = results[p++]!
      if (ok.status === 'success' && ok.result === true) {
        push(
          encodeAbiParameters([{ type: 'uint8' }, { type: 'uint128' }, { type: 'bool' }], [0, assetIds[i]!.raw, true])
        )
      }
    })
    candidates.relayers.forEach((relayer) => {
      const ok = results[p++]!
      if (ok.status === 'success' && ok.result === true) {
        push(
          encodeAbiParameters(
            [{ type: 'uint8' }, { type: 'bytes32' }, { type: 'bool' }],
            [1, addressToBytes32(relayer), true]
          )
        )
      }
    })
    candidates.offrampReceivers.forEach((receiver, i) => {
      const ok = results[p++]!
      const at = assets.findIndex((asset) => isAddressEqual(asset, candidates.offrampAssets[i]!))
      if (at === -1 || ok.status !== 'success' || ok.result !== true) return
      push(
        encodeAbiParameters(
          [{ type: 'uint8' }, { type: 'uint128' }, { type: 'bytes32' }, { type: 'bool' }],
          [2, assetIds[at]!.raw, addressToBytes32(receiver), true]
        )
      )
    })
    return configs
  }

  async rampAssets(
    instance: HexString,
    candidates: MigrationSpokeCandidates['ramp'],
    assets: readonly HexString[]
  ): Promise<HexString[]> {
    const results = await this.reader.read([
      ...assets.map((asset) => ({ address: instance, abi: LEGACY_ABI, functionName: 'onramp', args: [asset] })),
      ...candidates.offrampReceivers.map((receiver, i) => ({
        address: instance,
        abi: LEGACY_ABI,
        functionName: 'offramp',
        args: [candidates.offrampAssets[i]!, receiver],
      })),
    ])
    const list: HexString[] = []
    assets.forEach((asset, i) => {
      const ok = results[i]!
      if (ok.status === 'success' && ok.result === true && !includes(list, asset)) list.push(asset)
    })
    candidates.offrampAssets.forEach((asset, i) => {
      const ok = results[assets.length + i]!
      if (ok.status === 'success' && ok.result === true && !includes(list, asset)) list.push(asset)
    })
    return list
  }

  async rampSeeds(
    poolId: PoolId,
    inv: MigrationSpokeInventory,
    candidates: MigrationSpokeCandidates['ramp']
  ): Promise<{ seeds: RampSeed[]; configs: RampConfigSeed[] }> {
    const seeds: RampSeed[] = []
    const configs: RampConfigSeed[] = []
    const ids = await this.reader.read(
      inv.grantedRamps.flatMap((ramp) => [
        { address: ramp, abi: LEGACY_ABI, functionName: 'poolId' },
        { address: ramp, abi: LEGACY_ABI, functionName: 'scId' },
      ])
    )
    for (let i = 0; i < inv.grantedRamps.length; i++) {
      const v32Instance = inv.grantedRamps[i]!
      if (word(ids[i * 2]!) !== poolId.raw) continue
      const scId = answered<HexString>(ids[i * 2 + 1]!, 'rampSeeds: v3.2 OnOfframp.scId')
      const [preview] = await this.reader.read([
        {
          address: this.v33.onOffRampFactory,
          abi: ABIS_V3_3.OnOffRampFactory as Abi,
          functionName: 'previewManager',
          args: [poolId.raw, scId],
        },
      ])
      const instance = answered<HexString>(preview!, 'rampSeeds: v3.3 OnOffRampFactory.previewManager')
      const twin = seeds.find((seed) => seed.scId === scId)
      if (twin) {
        throw new MigrationInputsReadError(
          'rampSeeds',
          `share class ${scId} has two BS-granted v3.2 OnOfframp instances, ${twin.v32Instance} and ${v32Instance}: v3.3 gives a class one instance, so SetupRamps would refuse the second with RampAlreadySetup; revoke one's v3.2 BalanceSheet manager grant before arming`
        )
      }
      seeds.push({
        scId,
        instance,
        v32Instance,
        extraGasLimit: (this.options.rampExtraGasLimit ?? 0n).toString(),
        rampAssets: await this.rampAssets(v32Instance, candidates, inv.assets),
      })
      for (const config of await this.rampConfigs(v32Instance, candidates, inv.assets, inv.assetIds)) {
        configs.push({ scId, instance, v32Instance, config })
      }
    }
    return { seeds, configs }
  }

  // The whole spoke inventory and the three spoke inputs

  async spokeInventory(
    poolId: PoolId,
    hubClassCount: number,
    candidates: MigrationSpokeCandidates
  ): Promise<MigrationSpokeInventory> {
    const { scIds, tokens } = await this.spokeClasses(poolId, hubClassCount)
    const { assetIds, assets } = await this.registeredAssets(true, false)
    const [{ vaults, unknown }, balanceSheetManagers, gatewayManagers] = await Promise.all([
      this.liveVaults(poolId, unique(candidates.vaults)),
      this.liveManagers(poolId, this.v32.balanceSheet, [...candidates.managers, ...candidates.rampInstances]),
      this.liveManagers(poolId, this.v32.gateway, candidates.managers),
    ])
    const [rotationAssets, grantedRamps, syncReserves, assetPrices, hookGrants] = await Promise.all([
      this.rotationAssets(poolId, scIds, assets, tokens),
      this.v32Ramps(poolId, balanceSheetManagers),
      this.syncReserveKeys(poolId, scIds, assets),
      this.registeredAssetPriceKeys(poolId, scIds),
      this.hookGrants(scIds, tokens),
    ])
    return {
      centrifugeId: this.localCentrifugeId,
      block: this.reader.block,
      scIds,
      tokens,
      assetIds,
      assets,
      vaults,
      unknownVaults: unknown,
      rotationAssets,
      balanceSheetManagers,
      gatewayManagers,
      grantedRamps,
      syncReserves,
      assetPrices,
      hookGrants,
      notCarried: { balanceSheetManagers: [], gatewayManagers: [] },
      sources: {
        scIds: 'chain',
        assets: 'chain',
        vaults: 'idxchain',
        rotationAssets: 'chain',
        balanceSheetManagers: 'idxchain',
        gatewayManagers: 'idxchain',
        grantedRamps: 'chain',
        syncReserves: 'chain',
        assetPrices: 'chain',
        hookGrants: this.options.hookLogsFromBlock === undefined ? 'skipped' : 'logs',
      },
    }
  }

  freezeInput(inv: MigrationSpokeInventory): { syncReserves: SyncReserveKey[] } {
    return { syncReserves: inv.syncReserves }
  }

  offboardInput(inv: MigrationSpokeInventory, brmAssetIds: readonly AssetId[]): OffboardSpokeInput {
    const linked = inv.vaults.filter((vault) => vault.isLinked)
    const vaults: VaultKey[] = linked.map((vault) => ({
      scId: vault.scId.raw,
      assetId: vault.assetId.raw.toString(),
      vault: vault.vault,
    }))
    const swept: string[] = brmAssetIds.map((id) => id.raw.toString())
    const assets: RotateAsset[] = inv.rotationAssets.map((asset) => {
      const at = inv.assets.findIndex((candidate) => isAddressEqual(candidate, asset))
      if (at === -1)
        throw new MigrationInputsReadError('offboardInput', 'a rotation asset is not among the spoke registered assets')
      const assetId = inv.assetIds[at]!.raw.toString()
      if (!swept.includes(assetId)) swept.push(assetId)
      return { asset, assetId, scIds: inv.scIds.map((scId) => scId.raw) }
    })
    return {
      vaults,
      assets,
      balanceSheetManagers: inv.balanceSheetManagers,
      gatewayManagers: inv.gatewayManagers,
      scIds: inv.scIds.map((scId) => scId.raw),
      assetIds: swept,
      unlinkGas: '0',
      rotateGas: '0',
      managersGas: '0',
      finalizeGas: '0',
      finalize: true,
      totalVaults: String(linked.length),
      totalAssets: String(inv.rotationAssets.length),
      totalManagers: String(inv.balanceSheetManagers.length + inv.gatewayManagers.length),
    }
  }

  onboardSpokeInput(
    inv: MigrationSpokeInventory,
    hooks: readonly HookManagerSeed[],
    ramps: { seeds: RampSeed[]; configs: RampConfigSeed[] }
  ): OnboardSpokeInput {
    const seeds: VaultSeed[] = inv.vaults.map((vault) => ({
      scId: vault.scId.raw,
      assetId: vault.assetId.raw.toString(),
      factory: vault.factory,
      vault: vault.vault,
      link: vault.isLinked,
    }))
    const scIds = inv.scIds.map((scId) => scId.raw)
    return {
      scIds,
      seedQueueScIds: scIds,
      registerVaults: seeds,
      configureVaults: seeds,
      assetPrices: inv.assetPrices,
      ramps: ramps.seeds,
      rampConfigs: ramps.configs,
      hookManagers: [...hooks],
      linkGas: '0',
      registerGas: '0',
      configureGas: '0',
      hookManagersGas: '0',
      assetPriceGas: '0',
      spokeManagersGas: '0',
      seedGas: '0',
      seedQueueGas: '0',
      finalizeGas: '0',
      seedEscrow: true,
      finalize: true,
      totalTokens: String(inv.scIds.length),
      totalRegistered: String(seeds.length),
      totalConfigured: String(seeds.length),
      totalRamps: String(ramps.seeds.length),
      totalHookGrants: String(hooks.reduce((sum, hook) => sum + hook.managers.length, 0)),
      totalShareQueues: String(inv.scIds.length),
      totalAssetPrices: String(inv.assetPrices.length),
      totalRampConfigs: String(ramps.configs.length),
    }
  }
}

/** @internal */
export function topicOf(signature: string): HexString {
  return keccak256(toHex(signature)) as HexString
}
