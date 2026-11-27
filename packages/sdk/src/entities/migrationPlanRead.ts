import {
  ABIS_V3_3,
  hubPhaseName,
  ProtocolVersionResolutionError,
  resolveMigrationChain,
  spokePhaseName,
  UnsupportedForProtocolVersionError,
} from '@centrifuge/protocol'
import { firstValueFrom } from 'rxjs'
import { decodeAbiParameters, zeroAddress, type Abi, type PublicClient } from 'viem'
import type { Centrifuge } from '../Centrifuge.js'
import { CentrifugeError } from '../errors.js'
import type { HexString } from '../types/index.js'
import { MessageTypeV3_3, messageV3_3 } from '../types/transaction.js'
import { PoolId, type CentrifugeId } from '../utils/types.js'
import { simulateCalls } from '../utils/simulateCalls.js'
import {
  migrationInputsKey,
  type MigrationHubInputs,
  type MigrationInputsOptions,
  type MigrationSpokeInputs,
} from './MigrationInputs.js'
import { deriveMigrationHubInputs, deriveMigrationSpokeInputs } from './migrationInputsRead.js'
import { MigrationRecords } from './migrationRecords.js'
import { activeSpokesOf, unreadableSpokesOf } from './migrationSpokes.js'
import {
  epochMismatchOf,
  laneAdapters,
  laneCap,
  rampIdRows,
  unregisteredRampIds,
  vaultLinkMismatchesOf,
  type LaneRead,
  type MigrationRampId,
} from './migrationLanes.js'
import { clientReader, present } from './MigrationInputs.js'
import { isV3_3, requireContract } from '../utils/protocolVersion.js'
import { parseAbi, parseAbiItem } from 'viem'
import {
  migratedPlan,
  batchCeiling,
  blockGasLimits,
  MigrationPlanner,
  SEND_PAYLOAD_TOPIC,
  type BatchCeiling,
  type MigrationPlan,
  type MigrationPlanDriver,
  type PlanBudgets,
  type PlanCall,
  type PlanSimulation,
  nothingToPlanReason,
} from './MigrationPlan.js'
import type { Pool } from './Pool.js'
import {
  buildMigrationOperation,
  migrationFacadeOf,
  offboardStarted,
  spokeStepsBlock,
  stepsOfSpoke,
  unindexedRelaysReason,
  type MigrationOperation,
  type PoolMigration,
  type RelayPhase,
} from './PoolMigration.js'

export type MigrationPlanOptions = MigrationInputsOptions & {
  /** The address that signs: the refund address of every relay and the account the calls are simulated from. */
  signer?: HexString
  budgets?: PlanBudgets
  bridgeCircuitBreaker?: boolean
  /** Plan a spoke whose relayed step still reads open in the indexer, as a warning instead of a stop. */
  ignoreStepsInFlight?: boolean
}

/** @internal */
export function migrationPlanKey(options: MigrationPlanOptions): string {
  const budgets = options.budgets
    ? Object.entries(options.budgets)
        .map(([k, v]) => `${k}=${v}`)
        .join(',')
    : ''
  return [
    options.signer ?? '',
    migrationInputsKey(options),
    budgets,
    String(options.bridgeCircuitBreaker ?? ''),
    String(options.ignoreStepsInFlight ?? ''),
  ].join('|')
}

/** How far back the hub is swept for a `StepRelayed` the indexer has not written yet. */
const RELAY_SWEEP_BLOCKS = 5_000n
const STEP_RELAYED_EVENT = parseAbiItem(
  'event StepRelayed(uint64 indexed poolId, uint16 indexed centrifugeId, uint8 indexed step, bytes32 payloadHash)'
)

const RAMP_ABI = parseAbi([
  'function toTokenId(uint64 poolId, address asset, bool liability) view returns (uint256)',
  'function assetToId(address asset, uint256 tokenId) view returns (uint128)',
  'function isLinked(address vault) view returns (bool)',
  'function epochId(uint64 poolId, bytes16 scId, uint128 assetId) view returns (uint32 deposit, uint32 issue, uint32 redeem, uint32 revoke)',
])

function answeredOrThrow<T>(
  result: { status: 'success'; result: unknown } | { status: 'failure'; error: unknown },
  what: string
): T {
  if (result.status === 'failure') throw new CentrifugeError(`migrationPlan: ${what} did not answer`)
  return result.result as T
}

/** @internal */
export class LiveDriver implements MigrationPlanDriver {
  readonly #clients = new Map<CentrifugeId, Promise<PublicClient>>()
  readonly #spokeInputs = new Map<CentrifugeId, Promise<MigrationSpokeInputs>>()
  #hubInputs: Promise<MigrationHubInputs> | null = null
  readonly #ceilings = new Map<CentrifugeId, Promise<BatchCeiling>>()

  constructor(
    private readonly root: Centrifuge,
    private readonly pool: Pool,
    private readonly migration: PoolMigration | null,
    private readonly operator: HexString,
    private readonly options: MigrationPlanOptions
  ) {}

  private get poolId(): PoolId {
    return this.pool.id
  }

  private get hub(): CentrifugeId {
    return this.poolId.centrifugeId
  }

  private client(centrifugeId: CentrifugeId): Promise<PublicClient> {
    let client = this.#clients.get(centrifugeId)
    if (!client) {
      client = firstValueFrom(this.root.getClient(centrifugeId)) as Promise<PublicClient>
      this.#clients.set(centrifugeId, client)
    }
    return client
  }

  private facade(centrifugeId: CentrifugeId) {
    return resolveMigrationChain(centrifugeId, { environment: this.root.config.environment })
  }

  private async v33(centrifugeId: CentrifugeId) {
    return firstValueFrom(this.root.protocolContext({ centrifugeId, protocolVersion: '3.3' }))
  }

  private async laneRead(centrifugeId: CentrifugeId): Promise<LaneRead> {
    const client = await this.client(centrifugeId)
    return clientReader(client, await client.getBlockNumber()).read
  }

  private async hubInputsOrDerive() {
    if (!this.#hubInputs)
      this.#hubInputs = deriveMigrationHubInputs(this.root, this.poolId, await this.armedSpokes(), this.options)
    return this.#hubInputs
  }

  private async read<T>(centrifugeId: CentrifugeId, functionName: string, args: readonly unknown[]): Promise<T> {
    const chain = this.facade(centrifugeId)
    const client = await this.client(centrifugeId)
    return (await client.readContract({ address: chain.migration, abi: chain.abi, functionName, args } as any)) as T
  }

  async hubPhase() {
    return hubPhaseName(Number(await this.read<number | bigint>(this.hub, 'hubPhase', [this.poolId.raw])))
  }

  async spokePhase(centrifugeId: CentrifugeId) {
    return spokePhaseName(Number(await this.read<number | bigint>(centrifugeId, 'spokePhase', [this.poolId.raw])))
  }

  spokeArmed(centrifugeId: CentrifugeId) {
    return this.read<boolean>(this.hub, 'spokeArmed', [this.poolId.raw, centrifugeId])
  }

  async armedSpokes() {
    return (await this.read<readonly number[]>(this.hub, 'armedSpokes', [this.poolId.raw])).map(
      (cid) => cid as CentrifugeId
    )
  }

  poolAdaptersInstalled(readOn: CentrifugeId, toward: CentrifugeId) {
    return this.read<boolean>(readOn, 'poolAdaptersInstalled', [this.poolId.raw, toward])
  }

  async freezeGeneration(centrifugeId: CentrifugeId) {
    return Number(await this.read<number | bigint>(this.hub, 'freezeGeneration', [this.poolId.raw, centrifugeId]))
  }

  async frozenGeneration(centrifugeId: CentrifugeId) {
    return Number(await this.read<number | bigint>(centrifugeId, 'frozenGeneration', [this.poolId.raw]))
  }

  async blockOf(centrifugeId: CentrifugeId) {
    return (await this.client(centrifugeId)).getBlockNumber()
  }

  private spokeInputs(centrifugeId: CentrifugeId): Promise<MigrationSpokeInputs> {
    let inputs = this.#spokeInputs.get(centrifugeId)
    if (!inputs) {
      inputs = deriveMigrationSpokeInputs(this.root, this.poolId, centrifugeId, this.options)
      this.#spokeInputs.set(centrifugeId, inputs)
    }
    return inputs
  }

  async freezeInput(centrifugeId: CentrifugeId) {
    return (await this.spokeInputs(centrifugeId)).freeze
  }

  /** Read at the latest block, newer than the cached inputs: the records only ever drop more of what landed since. */
  private async records(centrifugeId: CentrifugeId) {
    const client = await this.client(centrifugeId)
    const reader = clientReader(client, await client.getBlockNumber())
    return new MigrationRecords(reader, this.facade(centrifugeId).migration as HexString, this.poolId)
  }

  async offboardInput(centrifugeId: CentrifugeId) {
    const [inputs, records] = await Promise.all([this.spokeInputs(centrifugeId), this.records(centrifugeId)])
    return records.pendingOffboard(inputs.offboard)
  }

  async onboardSpokeInput(centrifugeId: CentrifugeId) {
    const [inputs, records, ctx] = await Promise.all([
      this.spokeInputs(centrifugeId),
      this.records(centrifugeId),
      this.v33(centrifugeId),
    ])
    return records.pendingOnboard(inputs.onboardSpoke, requireContract(ctx, 'spokeRegistry') as HexString)
  }

  async onboardHubInput(armed: CentrifugeId[]) {
    if (!this.#hubInputs) this.#hubInputs = deriveMigrationHubInputs(this.root, this.poolId, armed, this.options)
    return (await this.#hubInputs).onboardHub
  }

  async rampRegistrations(centrifugeId: CentrifugeId) {
    return rampRegistrationsOf(this.root, this.poolId, centrifugeId, await this.spokeInputs(centrifugeId))
  }

  async offboardStarted(centrifugeId: CentrifugeId) {
    return offboardStarted(this.migration, centrifugeId)
  }

  async spokeStepsBlock(centrifugeId: CentrifugeId, phase: RelayPhase) {
    const block = spokeStepsBlock(this.migration, centrifugeId, phase)
    if (block.stop) return block
    const fresh = await unindexedRelaysOf(
      this.root,
      this.poolId,
      this.migration,
      centrifugeId,
      await this.client(this.hub)
    )
    return fresh ? { ...block, stop: fresh } : block
  }

  /** The spoke's v3.2 vaults whose v3.3 link state is not the one the offboard recorded unlinking. */
  async vaultLinkMismatches(centrifugeId: CentrifugeId) {
    const [inputs, ctx, client] = await Promise.all([
      this.spokeInputs(centrifugeId),
      this.v33(centrifugeId),
      this.client(centrifugeId),
    ])
    const vaults = inputs.inventory.vaults.map((vault) => vault.vault)
    if (vaults.length === 0) return [] as { vault: HexString; wasLinked: boolean }[]
    const chain = this.facade(centrifugeId)
    const registry = requireContract(ctx, 'spokeRegistry') as HexString
    const read = clientReader(client, await client.getBlockNumber()).read
    const [wasLinked, linked] = await Promise.all([
      read(
        vaults.map((vault) => ({
          address: chain.migration as HexString,
          abi: chain.abi as Abi,
          functionName: 'vaultUnlinked',
          args: [this.poolId.raw, vault],
        }))
      ),
      read(
        vaults.map((vault) => ({ address: registry, abi: RAMP_ABI as Abi, functionName: 'isLinked', args: [vault] }))
      ),
    ])
    return vaultLinkMismatchesOf(
      vaults,
      wasLinked.map((result) => Boolean(answeredOrThrow<boolean>(result, 'V33Migration.vaultUnlinked'))),
      linked.map((result) => Boolean(answeredOrThrow<boolean>(result, 'v3.3 SpokeRegistry.isLinked')))
    )
  }

  /** The first (class, asset) pair whose v3.3 BRM epoch pointers are not the v3.2 ones, once the hub is onboarded. */
  async epochIdMismatch() {
    const [inputs, ctx32, ctx33, client] = await Promise.all([
      this.hubInputsOrDerive(),
      firstValueFrom(this.root.protocolContext(this.poolId)),
      this.v33(this.hub),
      this.client(this.hub),
    ])
    const pairs = inputs.inventory.scIds.flatMap((scId) =>
      inputs.onboardHub.epochAssetIds.map((assetId) => ({ scId: scId.raw, assetId }))
    )
    if (pairs.length === 0) return ''
    const v32Brm = requireContract(ctx32, 'batchRequestManager') as HexString
    const v33Brm = requireContract(ctx33, 'batchRequestManager') as HexString
    const read = clientReader(client, await client.getBlockNumber()).read
    const epochCall = (brm: HexString) => (pair: { scId: HexString; assetId: string }) => ({
      address: brm,
      abi: RAMP_ABI as Abi,
      functionName: 'epochId',
      args: [this.poolId.raw, pair.scId, BigInt(pair.assetId)],
    })
    const [v32, v33] = await Promise.all([read(pairs.map(epochCall(v32Brm))), read(pairs.map(epochCall(v33Brm)))])
    return epochMismatchOf(
      pairs,
      v32.map((result) => answeredOrThrow<readonly (number | bigint)[]>(result, 'v3.2 BRM.epochId')),
      v33.map((result) => answeredOrThrow<readonly (number | bigint)[]>(result, 'v3.3 BRM.epochId'))
    )
  }

  async simulate(call: PlanCall, after: readonly PlanCall[]): Promise<PlanSimulation> {
    const client = await this.client(call.executeOn)
    let results: unknown[]
    try {
      results = (
        await simulateCalls(client, {
          account: this.operator,
          calls: [...after, call].map((c) => ({ to: c.to, data: c.data, value: c.value })),
        })
      ).results
    } catch (error) {
      return {
        ok: false,
        revert: '0x',
        error: `the simulation of ${call.label} after ${after.length} earlier call(s) could not run: ${(error as Error).message}`,
        gasUsed: 0n,
        batches: [],
      }
    }
    const result = results[results.length - 1] as unknown as {
      status: 'success' | 'failure'
      data?: HexString
      gasUsed?: bigint
      logs?: { topics: HexString[]; data: HexString }[]
    }
    const batches: PlanSimulation['batches'] = []
    for (const log of result.logs ?? []) {
      if (log.topics[0] !== SEND_PAYLOAD_TOPIC || log.topics.length < 2) continue
      const [, , , gasLimit] = decodeAbiParameters(
        [
          { type: 'bytes' },
          { type: 'address' },
          { type: 'bytes32' },
          { type: 'uint256' },
          { type: 'uint256' },
          { type: 'address' },
        ],
        log.data
      )
      batches.push({ centrifugeId: Number(BigInt(log.topics[1]!)) as CentrifugeId, gasLimit: gasLimit as bigint })
    }
    return {
      ok: result.status === 'success',
      revert: result.status === 'success' ? '0x' : (result.data ?? '0x'),
      gasUsed: result.gasUsed ?? 0n,
      batches,
    }
  }

  ceiling(centrifugeId: CentrifugeId): Promise<BatchCeiling> {
    let ceiling = this.#ceilings.get(centrifugeId)
    if (!ceiling) {
      ceiling = (async () => {
        const [hubCtx, hubClient, client] = await Promise.all([
          firstValueFrom(this.root.protocolContext({ centrifugeId: this.hub, protocolVersion: '3.3' })),
          this.client(this.hub),
          this.client(centrifugeId),
        ])
        const configured = hubCtx.gasService
          ? ((await hubClient.readContract({
              address: hubCtx.gasService,
              abi: hubCtx.contractAbis.GasService,
              functionName: 'maxBatchGasLimit',
              args: [centrifugeId],
            } as any)) as bigint)
          : 0n
        const block = await client.getBlock()
        const { blockGasLimit, smallBlockGasLimit } = blockGasLimits(this.facade(centrifugeId).chainId, block.gasLimit)
        let adapterCap = 0n
        let unquotable: HexString[] = []
        const multiAdapter = (hubCtx as unknown as { multiAdapter?: HexString }).multiAdapter
        if (multiAdapter && centrifugeId !== this.hub) {
          const read = await this.laneRead(this.hub)
          const lane = await laneAdapters(
            read,
            multiAdapter,
            this.poolId,
            centrifugeId,
            (hubCtx as unknown as { layerZeroAdapter?: HexString }).layerZeroAdapter ?? null,
            (hubCtx as unknown as { chainlinkAdapter?: HexString }).chainlinkAdapter ?? null
          )
          const cap = await laneCap(read, lane.set, centrifugeId)
          adapterCap = cap.tightest
          unquotable = cap.unquotable
        }
        return batchCeiling(centrifugeId, configured, blockGasLimit, smallBlockGasLimit, adapterCap, unquotable)
      })()
      this.#ceilings.set(centrifugeId, ceiling)
    }
    return ceiling
  }

  async quote(executeOn: CentrifugeId, destinations: CentrifugeId[], message: MessageTypeV3_3) {
    let total = 0n
    for (const destination of destinations) {
      total += await firstValueFrom(this.root._estimate(executeOn, destination, [messageV3_3(message, this.poolId)]))
    }
    return total
  }

  async hubTransactionGasLimit() {
    return (await (await this.client(this.hub)).getBlock()).gasLimit
  }

  build(operation: MigrationOperation, executeOn: CentrifugeId) {
    const built = buildMigrationOperation({
      environment: this.root.config.environment,
      poolId: this.poolId,
      signedOn: executeOn,
      refundAddress: this.operator,
      operation,
    })
    return { to: built.to as HexString, data: built.data as HexString }
  }
}

/**
 * The accounting-token ids a spoke's ramps need on its v3.3 Spoke and that are not registered yet: a receipt and a
 * liability id per ramp asset, as `SetupRamps` asserts them; `assetToId` reverts `UnknownAsset` for one not yet
 * registered. Shared by the plan driver and the guards.
 * @internal
 */
export async function rampRegistrationsOf(
  root: Centrifuge,
  poolId: PoolId,
  centrifugeId: CentrifugeId,
  inputs: MigrationSpokeInputs
): Promise<{ spoke: HexString; accountingToken: HexString; tokenIds: bigint[] }> {
  const { spoke, accountingToken, tokenIds, registered } = await readRampIds(root, poolId, centrifugeId, inputs)
  return { spoke, accountingToken, tokenIds: unregisteredRampIds(tokenIds, registered) }
}

/**
 * Every ramp id of the spoke with its registration state, registered or not.
 * @internal
 */
export async function rampIdsOf(
  root: Centrifuge,
  poolId: PoolId,
  centrifugeId: CentrifugeId,
  inputs: MigrationSpokeInputs
): Promise<MigrationRampId[]> {
  const { assets, tokenIds, registered } = await readRampIds(root, poolId, centrifugeId, inputs)
  return rampIdRows(assets, tokenIds, registered)
}

async function readRampIds(root: Centrifuge, poolId: PoolId, centrifugeId: CentrifugeId, inputs: MigrationSpokeInputs) {
  const [ctx, client] = await Promise.all([
    firstValueFrom(root.protocolContext({ centrifugeId, protocolVersion: '3.3' })),
    firstValueFrom(root.getClient(centrifugeId)) as Promise<PublicClient>,
  ])
  const spoke = requireContract(ctx, 'spoke') as HexString
  const accountingToken = requireContract(ctx, 'accountingToken') as HexString
  const registry = requireContract(ctx, 'spokeRegistry') as HexString
  const assets = inputs.onboardSpoke.ramps.flatMap((ramp) => ramp.rampAssets.map((asset) => asset as HexString))
  if (assets.length === 0)
    return { spoke, accountingToken, assets, tokenIds: [] as bigint[], registered: [] as bigint[] }
  const read = clientReader(client, await client.getBlockNumber()).read
  const idResults = await read(
    assets.flatMap((asset) =>
      [true, false].map((liability) => ({
        address: accountingToken,
        abi: RAMP_ABI as Abi,
        functionName: 'toTokenId',
        args: [poolId.raw, asset, liability],
      }))
    )
  )
  const tokenIds = idResults.map((result) => BigInt(answeredOrThrow<bigint>(result, 'v3.3 AccountingToken.toTokenId')))
  const answers = await read(
    tokenIds.map((tokenId) => ({
      address: registry,
      abi: RAMP_ABI as Abi,
      functionName: 'assetToId',
      args: [accountingToken, tokenId],
    }))
  )
  const registered = answers.map((result) =>
    present(result, 'UnknownAsset', 'v3.3 SpokeRegistry.assetToId') ? BigInt((result as { result: bigint }).result) : 0n
  )
  return { spoke, accountingToken, assets, tokenIds, registered }
}

function unresolvedVersion(error: unknown): null {
  if (error instanceof ProtocolVersionResolutionError) return null
  throw error
}

async function poolOnV33Registry(
  root: Centrifuge,
  client: PublicClient,
  pool: Pool,
  facade: HexString | null
): Promise<boolean> {
  let hubRegistry: HexString | undefined
  try {
    hubRegistry = (
      await firstValueFrom(root.protocolContext({ centrifugeId: pool.centrifugeId, protocolVersion: '3.3' }))
    ).hubRegistry
  } catch (error) {
    if (error instanceof ProtocolVersionResolutionError || error instanceof UnsupportedForProtocolVersionError)
      return false
    throw error
  }
  if (!hubRegistry || hubRegistry === zeroAddress) return false
  const registry = { address: hubRegistry, abi: ABIS_V3_3.HubRegistry } as const
  const exists = await client.readContract({ ...registry, functionName: 'exists', args: [pool.id.raw] })
  if (!exists || !facade) return exists
  const reserved = await client.readContract({ ...registry, functionName: 'manager', args: [pool.id.raw, facade] })
  return !reserved
}

/**
 * A `StepRelayed` the hub emitted toward `centrifugeId` that `migration` does not hold yet, as the reason to stop
 * on, swept from the block after the last indexed relay within the last `RELAY_SWEEP_BLOCKS`; a sweep the RPC
 * refuses is a reason too, since the relay cannot be ruled out. Empty when every relay is indexed.
 * @internal
 */
export async function unindexedRelaysOf(
  root: Centrifuge,
  poolId: PoolId,
  migration: PoolMigration | null,
  centrifugeId: CentrifugeId,
  hubClient: PublicClient,
  advice = 'Retry, or plan with ignoreStepsInFlight once the spoke chain has been checked'
): Promise<string> {
  const steps = stepsOfSpoke(migration, centrifugeId)
  const indexed = steps.reduce((max, step) => Math.max(max, step.createdAtBlock), 0)
  let logs
  let range = ''
  try {
    const latest = await hubClient.getBlockNumber()
    const fromBlock = BigInt(Math.max(indexed + 1, Number(latest - RELAY_SWEEP_BLOCKS)))
    if (fromBlock > latest) return ''
    range = ` from block ${fromBlock} to ${latest}`
    logs = await hubClient.getLogs({
      address: resolveMigrationChain(poolId.centrifugeId, { environment: root.config.environment })
        .migration as HexString,
      event: STEP_RELAYED_EVENT,
      args: { poolId: poolId.raw, centrifugeId },
      fromBlock,
      toBlock: latest,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message.split('\n')[0] : String(error)
    return `the hub RPC refused the StepRelayed sweep${range} (${message}), so a relay toward this spoke the indexer has not written yet cannot be ruled out. ${advice}`
  }
  return unindexedRelaysReason(
    logs.map((log) => ({
      step: Number(log.args.step),
      transactionHash: log.transactionHash as HexString,
      logIndex: log.logIndex,
      blockNumber: Number(log.blockNumber),
    })),
    steps
  )
}

/** @internal */
export async function deriveMigrationPlan(
  root: Centrifuge,
  pool: Pool,
  options: MigrationPlanOptions = {}
): Promise<MigrationPlan> {
  const [migration, version, candidates] = await Promise.all([
    firstValueFrom(pool.migration()),
    firstValueFrom(pool.protocolVersion()).catch(unresolvedVersion),
    pool.migrationSpokeCandidates(),
  ])
  const spokes = activeSpokesOf(candidates)
  const unreadableSpokes = unreadableSpokesOf(candidates)
  const facade = migrationFacadeOf(pool.centrifugeId, root.config.environment)
  const isV33 = version === null ? null : isV3_3({ protocolVersion: version })
  let reason = nothingToPlanReason(isV33, migration, null)
  if (reason !== null)
    return migratedPlan(pool.id, migration, facade?.address ?? zeroAddress, spokes, reason, unreadableSpokes)
  const client = (await firstValueFrom(root.getClient(pool.centrifugeId))) as PublicClient
  if (isV33 === null && !migration && (await poolOnV33Registry(root, client, pool, facade?.address ?? null))) {
    reason = nothingToPlanReason(true, null, null)
    return migratedPlan(pool.id, migration, facade?.address ?? zeroAddress, spokes, reason!, unreadableSpokes)
  }
  if (!facade) {
    throw new CentrifugeError(
      `migrationPlan: no v3.3 migration contract is deployed on cid ${pool.centrifugeId}, the hub chain of pool ${pool.id.toString()}`
    )
  }
  const chain = { migration: facade.address, abi: facade.abi }
  if (migration && migration.hubPhase !== 'none') {
    const phase = await client.readContract({
      address: chain.migration,
      abi: chain.abi,
      functionName: 'hubPhase',
      args: [pool.id.raw],
    } as any)
    reason = nothingToPlanReason(isV33, migration, hubPhaseName(Number(phase)))
    if (reason !== null) return migratedPlan(pool.id, migration, chain.migration, spokes, reason, unreadableSpokes)
  }
  const recorded = (await client.readContract({
    address: chain.migration,
    abi: chain.abi,
    functionName: 'operator',
    args: [pool.id.raw],
  } as any)) as HexString
  if (recorded === zeroAddress && !options.signer) {
    throw new CentrifugeError(
      `migrationPlan: pool ${pool.id.toString()} has no migration operator recorded yet; pass options.signer, the hub manager that will start it`
    )
  }
  const operator = recorded !== zeroAddress ? recorded : options.signer!
  const driver = new LiveDriver(root, pool, migration, operator, options)
  return new MigrationPlanner(
    {
      poolId: pool.id,
      migration: chain.migration as HexString,
      operator,
      hubCentrifugeId: pool.centrifugeId,
      spokeCentrifugeIds: spokes,
      unreadableSpokes,
      budgets: options.budgets,
      bridgeCircuitBreaker: options.bridgeCircuitBreaker,
      ignoreStepsInFlight: options.ignoreStepsInFlight,
    },
    driver
  ).run()
}
