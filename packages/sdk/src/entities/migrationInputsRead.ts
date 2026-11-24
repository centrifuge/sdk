import { firstValueFrom } from 'rxjs'
import type {
  MerkleProofManagerRow,
  OffRampAddressRow,
  OffRampRelayerRow,
  OnOffRampManagerRow,
  PoolManagerRow,
  VaultRow,
} from '@centrifuge/queries/core'
import type { Centrifuge } from '../Centrifuge.js'
import type { HexString } from '../types/index.js'
import { PoolId, type CentrifugeId, type ShareClassId } from '../utils/types.js'
import { isV3_3 } from '../utils/protocolVersion.js'
import { migrationFacadeOf } from './PoolMigration.js'
import { MigrationRecords } from './migrationRecords.js'
import { SPOKE_PHASE } from '@centrifuge/protocol'
import {
  clientReader,
  MigrationInputsDerivation,
  MigrationInputsReadError,
  v32RefsOf,
  v33RefsOf,
  type MigrationHubInputs,
  type MigrationInputsOptions,
  type MigrationSpokeCandidates,
  type MigrationSpokeInputs,
  type MigrationSpokeInventory,
} from './MigrationInputs.js'

/** The rows of one indexer read, refused by name when the answer is not a list. */
async function listOf<T>(read: string, rows: Promise<T[]>): Promise<T[]> {
  const value: unknown = await rows
  if (!Array.isArray(value)) {
    throw new MigrationInputsReadError(`spokeCandidates: ${read}`, 'the indexer answered something other than a list')
  }
  return value as T[]
}

/** @internal */
export async function spokeCandidates(
  root: Centrifuge,
  poolId: PoolId,
  centrifugeId: CentrifugeId,
  scIds: readonly ShareClassId[]
): Promise<MigrationSpokeCandidates> {
  const cid = String(centrifugeId)
  const [managers, merkle, perClass] = await Promise.all([
    listOf(
      'poolManagers',
      firstValueFrom(root._queryData<PoolManagerRow[]>('poolManagers', { poolId: poolId.toString() }))
    ),
    listOf(
      'merkleProofManagers',
      firstValueFrom(
        root._queryData<MerkleProofManagerRow[]>('merkleProofManagers', {
          poolId: poolId.toString(),
          centrifugeId: cid,
        })
      )
    ),
    Promise.all(
      scIds.map(async (scId) => {
        const tokenId = scId.raw
        const [vaults, ramps, relayers, offramps] = await Promise.all([
          listOf('allVaults', firstValueFrom(root._queryData<VaultRow[]>('allVaults', { tokenId }))),
          listOf(
            'onOffRampManagers',
            firstValueFrom(root._queryData<OnOffRampManagerRow[]>('onOffRampManagers', { tokenId, centrifugeId: cid }))
          ),
          listOf(
            'onOffRampRelayers',
            firstValueFrom(root._queryData<OffRampRelayerRow[]>('onOffRampRelayers', { tokenId, centrifugeId: cid }))
          ),
          listOf(
            'offRampAddresses',
            firstValueFrom(root._queryData<OffRampAddressRow[]>('offRampAddresses', { tokenId, centrifugeId: cid }))
          ),
        ])
        return { vaults, ramps, relayers, offramps }
      })
    ),
  ])
  const lower = (address: string) => address.toLowerCase() as HexString
  return {
    managers: [
      ...managers.filter((row) => row.centrifugeId === cid).map((row) => lower(row.address)),
      ...merkle.map((row) => lower(row.address)),
    ],
    vaults: perClass.flatMap(({ vaults }) =>
      vaults.filter((row) => row.centrifugeId === cid).map((row) => lower(row.address))
    ),
    rampInstances: perClass.flatMap(({ ramps }) => ramps.map((row) => lower(row.address))),
    ramp: {
      relayers: perClass.flatMap(({ relayers }) => relayers.map((row) => lower(row.address))),
      offrampAssets: perClass.flatMap(({ offramps }) => offramps.map((row) => lower(row.assetAddress))),
      offrampReceivers: perClass.flatMap(({ offramps }) => offramps.map((row) => lower(row.receiverAddress))),
    },
  }
}

async function hubDerivation(root: Centrifuge, poolId: PoolId, options: MigrationInputsOptions) {
  const [ctx, client] = await Promise.all([
    firstValueFrom(root.protocolContext(poolId)),
    firstValueFrom(root.getClient(poolId.centrifugeId)),
  ])
  const block = await client.getBlockNumber()
  const v33 = await firstValueFrom(root.protocolContext({ centrifugeId: poolId.centrifugeId, protocolVersion: '3.3' }))
  return new MigrationInputsDerivation(
    clientReader(client, block),
    v32RefsOf(ctx),
    v33RefsOf(v33),
    ctx.contractAbis,
    poolId.centrifugeId,
    options
  )
}

async function spokeDerivation(
  root: Centrifuge,
  poolId: PoolId,
  centrifugeId: CentrifugeId,
  options: MigrationInputsOptions,
  atBlock?: bigint
) {
  const [ctx, v33, client] = await Promise.all([
    firstValueFrom(root.protocolContext({ poolId, centrifugeId })),
    firstValueFrom(root.protocolContext({ centrifugeId, protocolVersion: '3.3' })),
    firstValueFrom(root.getClient(centrifugeId)),
  ])
  const block = atBlock ?? (await client.getBlockNumber())
  return new MigrationInputsDerivation(
    clientReader(client, block),
    v32RefsOf(ctx),
    v33RefsOf(v33),
    ctx.contractAbis,
    centrifugeId,
    { ...options, migration: options.migration ?? migrationFacadeOf(centrifugeId, root.config.environment)?.address }
  )
}

/** The spokes the v3.2 hub records for the pool (`hubRequestManager` toward cid 1..16); none for a pool on v3.3. @internal */
export async function hubSpokeRecordOf(root: Centrifuge, poolId: PoolId): Promise<CentrifugeId[]> {
  const ctx = await firstValueFrom(root.protocolContext(poolId))
  if (isV3_3(ctx)) return []
  const hub = await hubDerivation(root, poolId, {})
  return hub.hubSpokeRecord(poolId)
}

/** @internal */
export async function restoredSpokeInventory(
  derivation: MigrationInputsDerivation,
  poolId: PoolId,
  classCount: number,
  candidates: MigrationSpokeCandidates
): Promise<MigrationSpokeInventory> {
  const inventory = await derivation.spokeInventory(poolId, classCount, candidates)
  const migration = derivation.options.migration
  if (!migration) return inventory
  const records = new MigrationRecords(derivation.reader, migration, poolId)
  const phase = await records.spokePhase()
  if (phase < SPOKE_PHASE.frozen) return inventory
  return records.restoreOffboarded(derivation, inventory, phase)
}

/** @internal */
export async function deriveMigrationSpokeInputs(
  root: Centrifuge,
  poolId: PoolId,
  centrifugeId: CentrifugeId,
  options: MigrationInputsOptions = {}
): Promise<MigrationSpokeInputs> {
  const hub = await hubDerivation(root, poolId, options)
  const classCount = await hub.hubShareClassCount(poolId)
  const hubScIds = hub.hubScIds(poolId, classCount)
  const [spoke, candidates, brmAssetIds] = await Promise.all([
    spokeDerivation(
      root,
      poolId,
      centrifugeId,
      options,
      centrifugeId === poolId.centrifugeId ? hub.reader.block : undefined
    ),
    spokeCandidates(root, poolId, centrifugeId, hubScIds),
    hub.hubAssetIds().then((registered) => hub.orderedAssetIds(poolId, hubScIds, registered)),
  ])
  const inventory = await restoredSpokeInventory(spoke, poolId, classCount, candidates)
  const [managerGrants, ramps] = await Promise.all([
    spoke.managerGrants(centrifugeId, inventory.balanceSheetManagers),
    spoke.rampSeeds(poolId, inventory, candidates.ramp),
  ])
  const hooks = spoke.hookManagerSeeds(inventory.hookGrants)
  return {
    inventory,
    freeze: spoke.freezeInput(inventory),
    offboard: spoke.offboardInput(inventory, brmAssetIds),
    onboardSpoke: spoke.onboardSpokeInput(inventory, hooks, ramps),
    managerGrants,
  }
}

/** @internal */
export async function deriveMigrationHubInputs(
  root: Centrifuge,
  poolId: PoolId,
  spokeCentrifugeIds: readonly CentrifugeId[],
  options: MigrationInputsOptions = {}
): Promise<MigrationHubInputs> {
  const hub = await hubDerivation(root, poolId, options)
  const classCount = await hub.hubShareClassCount(poolId)
  const hubScIds = hub.hubScIds(poolId, classCount)
  const managers = await firstValueFrom(
    root._queryData<PoolManagerRow[]>('poolManagers', { poolId: poolId.toString() })
  )
  const hubManagerCandidates = managers
    .filter((row) => row.centrifugeId === String(poolId.centrifugeId))
    .map((row) => row.address.toLowerCase() as HexString)
  const spokes = await Promise.all(
    spokeCentrifugeIds.map(async (centrifugeId) => {
      const [derivation, candidates] = await Promise.all([
        spokeDerivation(
          root,
          poolId,
          centrifugeId,
          options,
          centrifugeId === poolId.centrifugeId ? hub.reader.block : undefined
        ),
        spokeCandidates(root, poolId, centrifugeId, hubScIds),
      ])
      const inventory = await restoredSpokeInventory(derivation, poolId, classCount, candidates)
      const grants = await derivation.managerGrants(centrifugeId, inventory.balanceSheetManagers)
      return { inventory, grants }
    })
  )
  const inventory = await hub.hubInventory(poolId, hubManagerCandidates, [...spokeCentrifugeIds], classCount)
  const grants = spokes.flatMap(({ grants }) => grants)
  return { inventory, onboardHub: hub.onboardHubInput(inventory, grants, spokeCentrifugeIds.length === 0) }
}
