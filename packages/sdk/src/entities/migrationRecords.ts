import {
  SPOKE_PHASE,
  V33_MIGRATION_ABI_V3_3,
  type AssetPriceKey,
  type HookManagerSeed,
  type OffboardSpokeInput,
  type OnboardSpokeInput,
  type RampConfigSeed,
  type RampSeed,
  type RotateAsset,
  type SyncReserveKey,
  type VaultKey,
  type VaultSeed,
} from '@centrifuge/protocol'
import { encodeAbiParameters, isAddressEqual, keccak256, parseAbi, type Abi } from 'viem'
import type { HexString } from '../types/index.js'
import { ShareClassId, type CentrifugeId, type PoolId } from '../utils/types.js'
import {
  answered,
  includes,
  LEGACY_ABI,
  unique,
  type MigrationInputsDerivation,
  type MigrationInputsReader,
  type MigrationSpokeInventory,
} from './MigrationInputs.js'

const FACADE_ABI = V33_MIGRATION_ABI_V3_3 as Abi
const SPOKE_REGISTRY_ABI = parseAbi(['function isLinked(address vault) view returns (bool)'])

/** @internal */
export class MigrationRecords {
  constructor(
    readonly reader: MigrationInputsReader,
    readonly migration: HexString,
    readonly poolId: PoolId
  ) {}

  private async facade<T>(functionName: string, args: readonly unknown[][]): Promise<T[]> {
    const results = await this.reader.read(
      args.map((rest) => ({ address: this.migration, abi: FACADE_ABI, functionName, args: [this.poolId.raw, ...rest] }))
    )
    return results.map((result) => answered<T>(result, `V33Migration.${functionName}`))
  }

  private async one<T>(functionName: string, ...args: unknown[]): Promise<T> {
    const [value] = await this.facade<T>(functionName, [args])
    return value as T
  }

  private async keep<T>(items: readonly T[], functionName: string, args: (item: T) => unknown[]): Promise<T[]> {
    if (items.length === 0) return []
    const done = await this.facade<boolean>(functionName, items.map(args))
    return items.filter((_, i) => !done[i])
  }

  async spokePhase(): Promise<number> {
    return Number(await this.one<number | bigint>('spokePhase'))
  }

  async restoreOffboarded(derivation: MigrationInputsDerivation, inv: MigrationSpokeInventory, phase: number) {
    const [removedSpoke, removedGateway, recordedScIds, recordedKeys, rotated] = await Promise.all([
      this.one<HexString[]>('removedSpokeManagers'),
      this.one<HexString[]>('removedGatewayManagers'),
      this.one<HexString[]>('spokeScIds'),
      this.one<readonly { scId: HexString; asset: HexString }[]>('syncKeys'),
      inv.assets.length === 0
        ? Promise.resolve([])
        : this.facade<boolean>(
            'assetRotated',
            inv.assets.map((a) => [a])
          ),
    ])
    const offboarded = phase >= SPOKE_PHASE.offboarded
    const { scIds, tokens } = await this.recordedClasses(derivation, inv, recordedScIds)
    const notCarried = {
      balanceSheetManagers: offboarded ? without(inv.balanceSheetManagers, removedSpoke) : [],
      gatewayManagers: offboarded ? without(inv.gatewayManagers, removedGateway) : [],
    }
    warnNotCarried(this.poolId, inv.centrifugeId, 'balance sheet', notCarried.balanceSheetManagers)
    warnNotCarried(this.poolId, inv.centrifugeId, 'gateway', notCarried.gatewayManagers)
    const rotatedAssets = inv.assets.filter((_, i) => rotated[i])
    const restored: MigrationSpokeInventory = {
      ...inv,
      scIds,
      tokens,
      balanceSheetManagers: offboarded ? [...removedSpoke] : unique([...inv.balanceSheetManagers, ...removedSpoke]),
      gatewayManagers: offboarded ? [...removedGateway] : unique([...inv.gatewayManagers, ...removedGateway]),
      rotationAssets: unique([...inv.rotationAssets, ...rotatedAssets]),
      syncReserves: withRecordedKeys(inv.syncReserves, recordedKeys),
      notCarried,
      sources: {
        ...inv.sources,
        balanceSheetManagers: 'record',
        gatewayManagers: 'record',
        ...(recordedScIds.length > 0 ? { scIds: 'record' as const } : {}),
        ...(rotatedAssets.length > 0 ? { rotationAssets: 'record' as const } : {}),
        ...(recordedKeys.length > 0 ? { syncReserves: 'record' as const } : {}),
      },
    }
    const [grantedRamps, hookGrants] = await Promise.all([
      derivation.v32Ramps(this.poolId, restored.balanceSheetManagers),
      this.hooksBeforeRotation(derivation, scIds, tokens).then((hooks) =>
        derivation.hookGrantsOn(scIds, tokens, hooks)
      ),
    ])
    return { ...restored, grantedRamps, hookGrants }
  }

  private async recordedClasses(
    derivation: MigrationInputsDerivation,
    inv: MigrationSpokeInventory,
    recorded: readonly HexString[]
  ): Promise<{ scIds: ShareClassId[]; tokens: HexString[] }> {
    if (recorded.length === 0) return { scIds: inv.scIds, tokens: inv.tokens }
    const results = await this.reader.read(
      recorded.map((scId) => ({
        address: derivation.v32.spoke,
        abi: derivation.abis.Spoke,
        functionName: 'shareToken',
        args: [this.poolId.raw, scId],
      }))
    )
    return {
      scIds: recorded.map((scId) => new ShareClassId(scId)),
      tokens: results.map((result) => answered<HexString>(result, 'restoreOffboarded: v3.2 Spoke.shareToken')),
    }
  }

  async hooksBeforeRotation(
    derivation: MigrationInputsDerivation,
    scIds: readonly ShareClassId[],
    tokens: readonly HexString[]
  ): Promise<HexString[]> {
    if (scIds.length === 0) return []
    const classArgs = scIds.map((scId) => [scId.raw])
    const [linked, recorded, current] = await Promise.all([
      this.facade<boolean>('tokenLinked', classArgs),
      this.facade<HexString>('recordedOldHook', classArgs),
      derivation.reader.read(tokens.map((token) => ({ address: token, abi: LEGACY_ABI, functionName: 'hook' }))),
    ])
    return scIds.map((_, i) =>
      linked[i] ? recorded[i]! : answered<HexString>(current[i]!, 'hooksBeforeRotation: v3.2 ShareToken.hook')
    )
  }

  async pendingOffboard(input: OffboardSpokeInput): Promise<OffboardSpokeInput> {
    const [vaults, assets, removedSpoke, removedGateway] = await Promise.all([
      this.pendingVaultKeys(input.vaults),
      this.pendingRotations(input.assets),
      this.one<HexString[]>('removedSpokeManagers'),
      this.one<HexString[]>('removedGatewayManagers'),
    ])
    return {
      ...input,
      vaults,
      assets,
      balanceSheetManagers: without(input.balanceSheetManagers, removedSpoke),
      gatewayManagers: without(input.gatewayManagers, removedGateway),
    }
  }

  async pendingOnboard(input: OnboardSpokeInput, spokeRegistry: HexString): Promise<OnboardSpokeInput> {
    const [
      scIds,
      seedQueueScIds,
      assetPrices,
      registerVaults,
      configureVaults,
      ramps,
      rampConfigs,
      hookManagers,
      escrowSeeded,
    ] = await Promise.all([
      this.pendingClasses(input.scIds),
      this.pendingShareQueues(input.seedQueueScIds),
      this.pendingAssetPrices(input.assetPrices),
      this.pendingVaultRegistrations(input.registerVaults, spokeRegistry),
      this.pendingVaultSeeds(input.configureVaults),
      this.pendingRamps(input.ramps),
      this.pendingRampConfigs(input.rampConfigs),
      this.pendingHookGrants(input.hookManagers),
      this.one<boolean>('escrowSeeded'),
    ])
    return {
      ...input,
      scIds,
      seedQueueScIds,
      assetPrices,
      registerVaults,
      configureVaults,
      ramps,
      rampConfigs,
      hookManagers,
      seedEscrow: input.seedEscrow && !escrowSeeded,
    }
  }

  pendingVaultKeys(keys: readonly VaultKey[]) {
    return this.keep(keys, 'vaultUnlinked', (key) => [key.vault])
  }

  pendingRotations(assets: readonly RotateAsset[]) {
    return this.keep(assets, 'assetRotated', (asset) => [asset.asset])
  }

  pendingClasses(scIds: readonly string[]) {
    return this.keep(scIds, 'tokenLinked', (scId) => [scId])
  }

  pendingShareQueues(scIds: readonly string[]) {
    return this.keep(scIds, 'shareQueueSeeded', (scId) => [scId])
  }

  pendingAssetPrices(keys: readonly AssetPriceKey[]) {
    return this.keep(keys, 'assetPriceCopied', (key) => [key.scId, BigInt(key.assetId)])
  }

  pendingVaultSeeds(seeds: readonly VaultSeed[]) {
    return this.keep(seeds, 'vaultConfigured', (seed) => [seed.vault])
  }

  pendingRamps(seeds: readonly RampSeed[]) {
    return this.keep(seeds, 'rampSetup', (seed) => [seed.scId])
  }

  pendingRampConfigs(seeds: readonly RampConfigSeed[]) {
    return this.keep(seeds, 'rampConfigAsserted', (seed) => [rampConfigHash(seed)])
  }

  pendingHookGrants(seeds: readonly HookManagerSeed[]) {
    return this.keep(seeds, 'hookGrantsAsserted', (seed) => [seed.scId])
  }

  async pendingVaultRegistrations(seeds: readonly VaultSeed[], spokeRegistry: HexString): Promise<VaultSeed[]> {
    if (seeds.length === 0) return []
    const [registered, linked] = await Promise.all([
      this.facade<boolean>(
        'vaultRegistered',
        seeds.map((seed) => [seed.vault])
      ),
      this.reader.read(
        seeds.map((seed) => ({
          address: spokeRegistry,
          abi: SPOKE_REGISTRY_ABI as Abi,
          functionName: 'isLinked',
          args: [seed.vault],
        }))
      ),
    ])
    return seeds.filter((seed, i) => {
      if (!registered[i]) return true
      if (!seed.link) return false
      return !answered<boolean>(linked[i]!, 'pendingVaultRegistrations: v3.3 SpokeRegistry.isLinked')
    })
  }
}

/** @internal */
export function rampConfigHash(seed: Pick<RampConfigSeed, 'scId' | 'config'>): HexString {
  return keccak256(
    encodeAbiParameters([{ type: 'bytes16' }, { type: 'bytes' }], [seed.scId as HexString, seed.config as HexString])
  )
}

function without<T extends string>(list: readonly T[], removed: readonly HexString[]): T[] {
  return list.filter((who) => !includes(removed, who as HexString))
}

function warnNotCarried(poolId: PoolId, centrifugeId: CentrifugeId, kind: string, managers: readonly HexString[]) {
  if (managers.length === 0) return
  console.warn(
    `Migration inputs: pool ${poolId.toString()} on centrifugeId ${centrifugeId} has ${managers.length} live v3.2 ${kind} manager(s) the offboard did not remove, so they keep their v3.2 authority: ${managers.join(', ')}`
  )
}

function withRecordedKeys(
  live: readonly SyncReserveKey[],
  recorded: readonly { scId: HexString; asset: HexString }[]
): SyncReserveKey[] {
  const same = (a: SyncReserveKey, b: { scId: string; asset: string }) =>
    a.scId.toLowerCase() === b.scId.toLowerCase() && isAddressEqual(a.asset as HexString, b.asset as HexString)
  return recorded.reduce<SyncReserveKey[]>(
    (keys, key) => (keys.some((have) => same(have, key)) ? keys : [...keys, { scId: key.scId, asset: key.asset }]),
    [...live]
  )
}
