import {
  type HookManagerSeed,
  type HubPhaseName,
  MessageTypeV3_3,
  type ManagerGrant,
  type MigrationStepName,
  type OffboardSpokeInput,
  type OnboardHubInput,
  type OnboardSpokeInput,
  type RampSeed,
  type RotateAsset,
  type SpokePhaseName,
  type SyncReserveKey,
} from '@centrifuge/protocol'
import { encodeAbiParameters, keccak256, toHex, zeroAddress } from 'viem'
import type { HexString } from '../types/index.js'
import { protocolErrorName } from '../utils/protocolErrors.js'
import type { CentrifugeId, PoolId } from '../utils/types.js'
import type { MigrationOperation, PoolMigration, RelayPhase, SpokeStepsBlock } from './PoolMigration.js'

export type MigrationPlanPhase = 'arm' | 'freeze' | 'offboard' | 'onboardHub' | 'onboardSpokes' | 'activate'

export type MigrationPlanEntry = {
  label: string
  phase: MigrationPlanPhase
  /** What `pool.migrationStep` signs for this entry; `null` for a call outside the facade (a ramp-asset registration). */
  operation: MigrationOperation | null
  executeOn: CentrifugeId
  concerns: CentrifugeId
  destinations: CentrifugeId[]
  to: HexString
  data: HexString
  value: bigint
  requiredHubPhase: HubPhaseName
  requiredSpokePhase: SpokePhaseName
  slice: { index: number; count: number } | null
  gasUsed: bigint
  batchGas: bigint
  ceiling: bigint
  binds: string
  manualDelivery: boolean
  widestPayload: { label: string; bytes: number } | null
  signer: 'operator' | 'anyone'
}

export type MigrationPlanStop = { label: string; centrifugeId: CentrifugeId; reason: string; hub: boolean }
export type MigrationPlanSkip = { label: string; centrifugeId: CentrifugeId; reason: string }

export type MigrationPlanChain = {
  centrifugeId: CentrifugeId
  block: bigint
  spokePhase: SpokePhaseName
  frozenGeneration: number
  freezeGeneration: number
}

export type UnreadableSpoke = { centrifugeId: CentrifugeId | null; reason: string }

export type MigrationPlanBundle = {
  phase: MigrationPlanPhase
  executeOn: CentrifugeId
  entries: number[]
  gas: bigint
  value: bigint
}

export type MigrationPlan = {
  poolId: PoolId
  migration: HexString
  /** The recorded operator; the zero address on a plan with nothing to plan and no migration row. */
  operator: HexString
  hubCentrifugeId: CentrifugeId
  hubPhase: HubPhaseName
  spokes: CentrifugeId[]
  /** The chains the spoke set could not be read on, with why; the arm and the hub onboard hold while any is listed. */
  unreadableSpokes: UnreadableSpoke[]
  chains: MigrationPlanChain[]
  complete: boolean
  bridgeCircuitBreaker: boolean
  entries: MigrationPlanEntry[]
  bundles: MigrationPlanBundle[]
  stops: MigrationPlanStop[]
  skips: MigrationPlanSkip[]
  warnings: string[]
}

export function nothingToPlanReason(
  isV33: boolean | null,
  migration: PoolMigration | null,
  facadeHubPhase: HubPhaseName | null
): string | null {
  if (isV33) {
    if (!migration)
      return 'the pool is on v3.3 and the indexer holds no migration row for it: created on v3.3, or the row is not projected yet; nothing to plan'
    if (migration.hubPhase === 'activated')
      return 'the pool is on v3.3 and its migration is activated: nothing left to plan'
    return `the pool reads v3.3 while its migration row reads ${migration.hubPhase}: the indexer has not caught up on the row; nothing to plan`
  }
  if (migration?.hubPhase === 'activated')
    return 'its migration is activated while the pool still reads v3.2: the indexer has not caught up on the version; nothing left to plan'
  if (migration && migration.hubPhase !== 'none' && facadeHubPhase === 'none')
    return `the migration contract no longer holds this pool (hub phase None) while its row reads ${migration.hubPhase}: it activated and the indexer has not caught up; nothing left to plan`
  return null
}

export function migratedPlan(
  poolId: PoolId,
  migration: PoolMigration | null,
  facade: HexString,
  spokes: CentrifugeId[],
  reason: string,
  unreadableSpokes: UnreadableSpoke[] = []
): MigrationPlan {
  return {
    poolId,
    migration: facade,
    operator: migration?.operator ?? zeroAddress,
    hubCentrifugeId: poolId.centrifugeId,
    hubPhase: migration?.hubPhase ?? 'none',
    spokes,
    unreadableSpokes,
    chains: [],
    complete: true,
    bridgeCircuitBreaker: false,
    entries: [],
    bundles: [],
    stops: [],
    skips: [{ label: 'initiateMigration', centrifugeId: poolId.centrifugeId, reason }],
    warnings: [],
  }
}

export type MigrationNextAction = {
  step: MigrationPlanPhase | 'lanes' | 'drain' | 'goLive' | 'blocked'
  on: 'hub' | CentrifugeId
  chain: CentrifugeId
  label: string
  signer: 'operator' | 'anyone'
  /** The plan entry to sign, when there is one. */
  entry: number | null
  nothingToSign?: boolean
  waitingFor?: string
  /** The first stop's reason, when the plan is blocked. */
  reason?: string
}

export type BatchCeiling = {
  centrifugeId: CentrifugeId
  configured: bigint
  blockBudget: bigint
  smallBlock: bigint
  adapterCap: bigint
  ceiling: bigint
  binds: string
  sliceTarget: bigint
  targetBinds: string
  /** Adapters on the lane that quote no delivery gas at all: the lane may not carry the batch. */
  unquotable: HexString[]
}

export type PlanCall = {
  label: string
  phase: MigrationPlanPhase
  operation: MigrationOperation | null
  executeOn: CentrifugeId
  centrifugeId: CentrifugeId
  to: HexString
  data: HexString
  value: bigint
  destinations: CentrifugeId[]
  hubStep: boolean
  signer: 'operator' | 'anyone'
  /** The message the call sends across the lane, priced by the quote; a relayed step unless set. */
  message?: MessageTypeV3_3
}

export type PlanSimulation = {
  ok: boolean
  revert: HexString
  /** Why the simulation itself could not run (the simulated block out of gas, the RPC refusing), when it did not. */
  error?: string
  gasUsed: bigint
  /** `(destination, gasLimit)` of every `SendPayload` the call emitted. */
  batches: { centrifugeId: CentrifugeId; gasLimit: bigint }[]
}

export type PlanBudgets = {
  freezeGas: bigint
  unlinkGas: bigint
  rotateGas: bigint
  managersGas: bigint
  offboardFinalizeGas: bigint
  linkGas: bigint
  registerGas: bigint
  configureGas: bigint
  hookManagersGas: bigint
  assetPriceGas: bigint
  spokeManagersGas: bigint
  seedGas: bigint
  seedQueueGas: bigint
  onboardFinalizeGas: bigint
  rampGas: bigint
  restoreGas: bigint
}

/**
 * Each relayed step's budget, measured by Protocol over the fleet's widest spokes.
 * A copy of Protocol's `MigrationBudgets.production()`: change both together.
 */
export const PRODUCTION_BUDGETS: PlanBudgets = {
  freezeGas: 180_000n,
  unlinkGas: 0n,
  rotateGas: 525_000n,
  managersGas: 310_000n,
  offboardFinalizeGas: 790_000n,
  linkGas: 1_415_000n,
  registerGas: 0n,
  configureGas: 55_000n,
  hookManagersGas: 100_000n,
  assetPriceGas: 0n,
  spokeManagersGas: 0n,
  seedGas: 640_000n,
  seedQueueGas: 0n,
  onboardFinalizeGas: 0n,
  rampGas: 1_470_000n,
  restoreGas: 270_000n,
}

export const MESSAGE_MAX_LENGTH = 1000
export const RELAY_HEADER = 59
export const PAYLOAD_BUDGET = MESSAGE_MAX_LENGTH - RELAY_HEADER
export const HYPER_EVM_SMALL_BLOCK = 3_000_000n
export const HYPER_EVM_BIG_BLOCK = 30_000_000n
export const HYPER_EVM_CHAIN_IDS: readonly number[] = [999, 998]
/** EIP-7825: the execution gas one transaction may carry. Under EIP-8037 state gas is drawn above it, up to `tx.gas`. */
export const MAX_TRANSACTION_GAS = 16_777_216n
/**
 * The pad, in percent, on simulated gas: Protocol's forge multiplies by it by default, and the App is to apply it
 * when it declares a bundle's gas limit. A bundle's limit divides by it, as Protocol's `_bundleGasLimit()` does:
 * change both together.
 */
export const GAS_LIMIT_PAD_PERCENT = 130n
export function migrationGasLimit(simulated: bigint): bigint {
  const padded = (simulated * GAS_LIMIT_PAD_PERCENT) / 100n
  if (padded <= MAX_TRANSACTION_GAS || simulated > MAX_TRANSACTION_GAS) return padded
  return MAX_TRANSACTION_GAS
}

export const BATCH_TOO_EXPENSIVE = '0xdaae71c5'
export const CHAINLINK_GAS_LIMIT_TOO_HIGH = '0x4c4fc93a'
export const SEND_PAYLOAD_TOPIC = keccak256(
  toHex('SendPayload(uint16,bytes32,bytes,address,bytes32,uint256,uint256,address)')
) as HexString

/** What the planner asks of the chains and the indexer; a test scripts it, the SDK reads it live. */
export interface MigrationPlanDriver {
  hubPhase(): Promise<HubPhaseName>
  spokePhase(centrifugeId: CentrifugeId): Promise<SpokePhaseName>
  spokeArmed(centrifugeId: CentrifugeId): Promise<boolean>
  armedSpokes(): Promise<CentrifugeId[]>
  poolAdaptersInstalled(readOn: CentrifugeId, toward: CentrifugeId): Promise<boolean>
  freezeGeneration(centrifugeId: CentrifugeId): Promise<number>
  frozenGeneration(centrifugeId: CentrifugeId): Promise<number>
  blockOf(centrifugeId: CentrifugeId): Promise<bigint>
  freezeInput(centrifugeId: CentrifugeId): Promise<{ syncReserves: SyncReserveKey[] }>
  offboardInput(centrifugeId: CentrifugeId): Promise<OffboardSpokeInput>
  onboardSpokeInput(centrifugeId: CentrifugeId): Promise<OnboardSpokeInput>
  onboardHubInput(armed: CentrifugeId[]): Promise<OnboardHubInput>
  rampRegistrations(
    centrifugeId: CentrifugeId
  ): Promise<{ spoke: HexString; accountingToken: HexString; tokenIds: bigint[] }>
  spokeStepsBlock(centrifugeId: CentrifugeId, phase: RelayPhase): Promise<SpokeStepsBlock>
  offboardStarted(centrifugeId: CentrifugeId): Promise<boolean>
  vaultLinkMismatches(centrifugeId: CentrifugeId): Promise<{ vault: HexString; wasLinked: boolean }[]>
  epochIdMismatch(): Promise<string>
  /** Simulates `call` after `after`, in order, on the chain that signs it; the result is `call`'s. */
  simulate(call: PlanCall, after: readonly PlanCall[]): Promise<PlanSimulation>
  ceiling(centrifugeId: CentrifugeId): Promise<BatchCeiling>
  quote(executeOn: CentrifugeId, destinations: CentrifugeId[], message: MessageTypeV3_3): Promise<bigint>
  hubTransactionGasLimit(): Promise<bigint>
  build(operation: MigrationOperation, executeOn: CentrifugeId): { to: HexString; data: HexString }
}

export type PlanConfig = {
  poolId: PoolId
  migration: HexString
  operator: HexString
  hubCentrifugeId: CentrifugeId
  spokeCentrifugeIds: CentrifugeId[]
  unreadableSpokes?: UnreadableSpoke[]
  budgets?: PlanBudgets
  bridgeCircuitBreaker?: boolean
  ignoreStepsInFlight?: boolean
  registerValue?: bigint
}

/**
 * `MigrationLimits.batchCeiling`: the tightest of the configured batch limit, the destination block and the
 * adapter cap; on a dual-block chain the ceiling is the big block and the slice target the small one.
 * @internal
 */
export function batchCeiling(
  centrifugeId: CentrifugeId,
  configured: bigint,
  blockGasLimit: bigint,
  smallBlockGasLimit: bigint,
  adapterCap: bigint,
  unquotable: HexString[] = []
): BatchCeiling {
  let ceiling = configured
  let binds = 'maxBatchGasLimit'
  if (blockGasLimit !== 0n && (ceiling === 0n || blockGasLimit < ceiling)) {
    ceiling = blockGasLimit
    binds = smallBlockGasLimit === 0n ? 'destination block' : 'big block'
  }
  if (adapterCap !== 0n && (ceiling === 0n || adapterCap < ceiling)) {
    ceiling = adapterCap
    binds = 'adapter delivery cap'
  }
  let sliceTarget = ceiling
  let targetBinds = binds
  if (smallBlockGasLimit !== 0n && smallBlockGasLimit < sliceTarget) {
    sliceTarget = smallBlockGasLimit
    targetBinds = 'small block'
  }
  return {
    centrifugeId,
    configured,
    blockBudget: blockGasLimit,
    smallBlock: smallBlockGasLimit,
    adapterCap,
    ceiling,
    binds,
    sliceTarget,
    targetBinds,
    unquotable,
  }
}

/** @internal */
export function blockGasLimits(
  chainId: number,
  gasLimit: bigint
): { blockGasLimit: bigint; smallBlockGasLimit: bigint } {
  if (HYPER_EVM_CHAIN_IDS.includes(chainId))
    return { blockGasLimit: HYPER_EVM_BIG_BLOCK, smallBlockGasLimit: HYPER_EVM_SMALL_BLOCK }
  return { blockGasLimit: gasLimit, smallBlockGasLimit: 0n }
}

// Payload rows: the relayed payloads encoded exactly as the contract relays them, the freeze generation as uint32(0)

const STEP = {
  freeze: 1,
  rotateAssets: 4,
  removeManagers: 5,
  finalizeOffboard: 6,
  linkTokens: 7,
  setupRamps: 14,
  assertHookManagers: 15,
  assertSpokeManagers: 17,
} as const

type PayloadRow = { label: string; bytes: number; overBudget: boolean }

const bytesOf = (hex: HexString) => (hex.length - 2) / 2
const scIds = (ids: readonly string[]) => ids as readonly HexString[]

/** @internal */
export function freezeLength(input: { syncReserves: readonly SyncReserveKey[] }): number {
  return bytesOf(
    encodeAbiParameters(
      [
        { type: 'uint8' },
        { type: 'uint32' },
        {
          type: 'tuple[]',
          components: [
            { name: 'scId', type: 'bytes16' },
            { name: 'asset', type: 'address' },
          ],
        },
        { type: 'uint32' },
      ],
      [STEP.freeze, 0, input.syncReserves.map((k) => ({ scId: k.scId as HexString, asset: k.asset as HexString })), 0]
    )
  )
}

/** @internal */
export function rotateAssetLength(asset: RotateAsset): number {
  return bytesOf(
    encodeAbiParameters(
      [
        { type: 'uint8' },
        { type: 'uint32' },
        {
          type: 'tuple',
          components: [
            { name: 'asset', type: 'address' },
            { name: 'assetId', type: 'uint128' },
            { name: 'scIds', type: 'bytes16[]' },
          ],
        },
      ],
      [
        STEP.rotateAssets,
        0,
        { asset: asset.asset as HexString, assetId: BigInt(asset.assetId), scIds: scIds(asset.scIds) },
      ]
    )
  )
}

/** @internal */
export function removeManagersLength(input: OffboardSpokeInput): number {
  return bytesOf(
    encodeAbiParameters(
      [{ type: 'uint8' }, { type: 'uint32' }, { type: 'address[]' }, { type: 'address[]' }],
      [STEP.removeManagers, 0, input.balanceSheetManagers as HexString[], input.gatewayManagers as HexString[]]
    )
  )
}

/** @internal */
export function finalizeOffboardLength(input: OffboardSpokeInput): number {
  return bytesOf(
    encodeAbiParameters(
      [
        { type: 'uint8' },
        { type: 'uint32' },
        { type: 'bytes16[]' },
        { type: 'uint32' },
        { type: 'uint32' },
        { type: 'uint32' },
      ],
      [
        STEP.finalizeOffboard,
        0,
        scIds(input.scIds),
        Number(input.totalVaults),
        Number(input.totalAssets),
        Number(input.totalManagers),
      ]
    )
  )
}

/** @internal */
export function linkTokensLength(input: OnboardSpokeInput): number {
  return bytesOf(encodeAbiParameters([{ type: 'uint8' }, { type: 'bytes16[]' }], [STEP.linkTokens, scIds(input.scIds)]))
}

/** @internal */
export function assertHookManagersLength(seed: HookManagerSeed): number {
  return bytesOf(
    encodeAbiParameters(
      [{ type: 'uint8' }, { type: 'bytes16' }, { type: 'address' }, { type: 'address[]' }],
      [STEP.assertHookManagers, seed.scId as HexString, seed.hook as HexString, seed.managers as HexString[]]
    )
  )
}

/** @internal */
export function setupRampsLength(ramp: RampSeed): number {
  return bytesOf(
    encodeAbiParameters(
      [{ type: 'uint8' }, { type: 'bytes16' }, { type: 'address' }, { type: 'address' }, { type: 'address[]' }],
      [
        STEP.setupRamps,
        ramp.scId as HexString,
        ramp.instance as HexString,
        ramp.v32Instance as HexString,
        ramp.rampAssets as HexString[],
      ]
    )
  )
}

/** @internal */
export function assertSpokeManagersLength(grants: readonly ManagerGrant[]): number {
  const kinds = `0x${grants.map(() => '01').join('')}` as HexString
  const who = grants.map((grant) => `0x${grant.who.slice(2, 42)}` as HexString)
  return bytesOf(
    encodeAbiParameters(
      [{ type: 'uint8' }, { type: 'bytes' }, { type: 'address[]' }],
      [STEP.assertSpokeManagers, kinds, who]
    )
  )
}

function row(label: string, bytes: number): PayloadRow {
  return { label, bytes, overBudget: bytes > PAYLOAD_BUDGET }
}

function offboardRows(input: OffboardSpokeInput): PayloadRow[] {
  return [
    row('RemoveManagers', removeManagersLength(input)),
    row('FinalizeOffboard', finalizeOffboardLength(input)),
    ...input.assets.map((asset) => row('RotateAssets', rotateAssetLength(asset))),
  ]
}

function onboardRows(input: OnboardSpokeInput): PayloadRow[] {
  return [
    ...(input.scIds.length > 0 ? [row('LinkTokens', linkTokensLength(input))] : []),
    ...input.hookManagers.map((seed) => row('AssertHookManagers', assertHookManagersLength(seed))),
    ...input.ramps.map((ramp) => row('SetupRamps', setupRampsLength(ramp))),
  ]
}

function widest(rows: PayloadRow[]): { label: string; bytes: number } | null {
  let best: PayloadRow | null = null
  for (const r of rows) if (best === null || r.bytes > best.bytes) best = r
  return best ? { label: best.label, bytes: best.bytes } : null
}

// Slicing

function overlap(from: number, count: number, base: number, len: number): { start: number; n: number } {
  const lo = Math.max(from, base)
  const hi = Math.min(from + count, base + len)
  if (hi <= lo) return { start: 0, n: 0 }
  return { start: lo - base, n: hi - lo }
}

function range<T>(all: readonly T[], from: number, count: number, base: number): T[] {
  const { start, n } = overlap(from, count, base, all.length)
  return all.slice(start, start + n)
}

/** `count` items of the whole-spoke offboard starting at `from`, vaults then rotations then managers; the finalize slice carries only totals. @internal */
export function offboardSlice(
  input: OffboardSpokeInput,
  from: number,
  count: number,
  finalize: boolean
): OffboardSpokeInput {
  const nv = input.vaults.length
  const na = input.assets.length
  const nb = input.balanceSheetManagers.length
  const part: OffboardSpokeInput = {
    vaults: range(input.vaults, from, count, 0),
    assets: range(input.assets, from, count, nv),
    balanceSheetManagers: range(input.balanceSheetManagers, from, count, nv + na),
    gatewayManagers: range(input.gatewayManagers, from, count, nv + na + nb),
    scIds: [],
    assetIds: input.assetIds,
    unlinkGas: input.unlinkGas,
    rotateGas: input.rotateGas,
    managersGas: input.managersGas,
    finalizeGas: input.finalizeGas,
    finalize: false,
    totalVaults: '0',
    totalAssets: '0',
    totalManagers: '0',
  }
  if (!finalize) return part
  return {
    ...part,
    scIds: input.scIds,
    finalize: true,
    totalVaults: input.totalVaults,
    totalAssets: input.totalAssets,
    totalManagers: input.totalManagers,
  }
}

const offboardItems = (input: OffboardSpokeInput) =>
  input.vaults.length + input.assets.length + input.balanceSheetManagers.length + input.gatewayManagers.length

/** One window of the spoke onboard: the classes first, then prices, vault seeds, ramps and hook managers; the finalize slice carries the totals. @internal */
export function onboardSlice(
  input: OnboardSpokeInput,
  classes: boolean,
  from: number,
  count: number,
  finalize: boolean
): OnboardSpokeInput {
  const part: OnboardSpokeInput = {
    scIds: [],
    seedQueueScIds: [],
    registerVaults: [],
    configureVaults: [],
    assetPrices: [],
    ramps: [],
    rampConfigs: [],
    hookManagers: [],
    linkGas: input.linkGas,
    registerGas: input.registerGas,
    configureGas: input.configureGas,
    hookManagersGas: input.hookManagersGas,
    assetPriceGas: input.assetPriceGas,
    spokeManagersGas: input.spokeManagersGas,
    seedGas: input.seedGas,
    seedQueueGas: input.seedQueueGas,
    finalizeGas: input.finalizeGas,
    seedEscrow: false,
    finalize: false,
    totalTokens: '0',
    totalRegistered: '0',
    totalConfigured: '0',
    totalRamps: '0',
    totalHookGrants: '0',
    totalShareQueues: '0',
    totalAssetPrices: '0',
    totalRampConfigs: '0',
  }
  if (classes && !finalize) {
    return {
      ...part,
      scIds: range(input.scIds, from, count, 0),
      seedQueueScIds: range(input.seedQueueScIds, from, count, input.scIds.length),
    }
  }
  if (!finalize) {
    const np = input.assetPrices.length
    const nv = input.registerVaults.length
    const nc = input.configureVaults.length
    const nr = input.ramps.length
    const ng = input.rampConfigs.length
    return {
      ...part,
      assetPrices: range(input.assetPrices, from, count, 0),
      registerVaults: range(input.registerVaults, from, count, np),
      configureVaults: range(input.configureVaults, from, count, np + nv),
      ramps: range(input.ramps, from, count, np + nv + nc),
      rampConfigs: range(input.rampConfigs, from, count, np + nv + nc + nr),
      hookManagers: range(input.hookManagers, from, count, np + nv + nc + nr + ng),
    }
  }
  return {
    ...part,
    seedEscrow: input.seedEscrow,
    finalize: true,
    totalTokens: input.totalTokens,
    totalRegistered: input.totalRegistered,
    totalConfigured: input.totalConfigured,
    totalRamps: input.totalRamps,
    totalHookGrants: input.totalHookGrants,
    totalShareQueues: input.totalShareQueues,
    totalAssetPrices: input.totalAssetPrices,
    totalRampConfigs: input.totalRampConfigs,
  }
}

const onboardClasses = (input: OnboardSpokeInput) => input.scIds.length + input.seedQueueScIds.length
const onboardTail = (input: OnboardSpokeInput) =>
  input.assetPrices.length +
  input.registerVaults.length +
  input.configureVaults.length +
  input.ramps.length +
  input.rampConfigs.length +
  input.hookManagers.length

const isSmaller = (revert: HexString) =>
  revert.length === 10 && (revert === BATCH_TOO_EXPENSIVE || revert === CHAINLINK_GAS_LIMIT_TOO_HIGH)

/**
 * `MigrationWalk`, derived rather than executed: from the phases the pool holds now, every operator call of the
 * current checkpoints with the inputs the App would send, each simulated on the chain that signs it. The slice
 * size is decided by the contract, as in the reference: a slice is offered whole, halved when the gateway or the
 * lane refuses it for size, and cut back when it lands over the destination's slice target. Nothing is sent and
 * no delivery is modelled: a spoke's parks come from the indexer, a stop ends that spoke's plan and the others
 * carry on. Re-planning at the same blocks reproduces the same calldata.
 * @internal
 */
export class MigrationPlanner {
  private readonly entries: MigrationPlanEntry[] = []
  private readonly stops: MigrationPlanStop[] = []
  private readonly skips: MigrationPlanSkip[] = []
  private readonly warnings: string[] = []
  private readonly stopped = new Set<CentrifugeId>()
  private hubStopped = false
  private armsLanded = false
  private readonly budgets: PlanBudgets
  private hubPhaseRead: Promise<HubPhaseName> | null = null
  private readonly spokePhases = new Map<CentrifugeId, Promise<SpokePhaseName>>()
  private readonly freezeGenerations = new Map<CentrifugeId, Promise<number>>()
  private readonly frozenGenerations = new Map<CentrifugeId, Promise<number>>()
  private readonly quotes = new Map<string, Promise<bigint>>()
  private readonly landed = new Map<CentrifugeId, PlanCall[]>()

  constructor(
    private readonly cfg: PlanConfig,
    private readonly driver: MigrationPlanDriver
  ) {
    this.budgets = cfg.budgets ?? PRODUCTION_BUDGETS
  }

  async run(): Promise<MigrationPlan> {
    const hubPhase = await this.hubPhase()
    const chains = await this.chains()
    await this.arm()
    for (const cid of this.cfg.spokeCentrifugeIds) await this.freeze(cid)
    for (const cid of this.cfg.spokeCentrifugeIds) await this.offboard(cid)
    for (const cid of this.cfg.spokeCentrifugeIds) await this.registerRampAssets(cid)
    await this.onboardHub()
    await this.checkEpochCarry()
    for (const cid of this.cfg.spokeCentrifugeIds) {
      await this.onboardSpoke(cid)
      await this.checkVaultLinks(cid)
    }
    await this.activate()
    const complete = !this.hubStopped && this.cfg.spokeCentrifugeIds.every((cid) => !this.stopped.has(cid))
    return {
      poolId: this.cfg.poolId,
      migration: this.cfg.migration,
      operator: this.cfg.operator,
      hubCentrifugeId: this.cfg.hubCentrifugeId,
      hubPhase,
      spokes: [...this.cfg.spokeCentrifugeIds],
      unreadableSpokes: [...(this.cfg.unreadableSpokes ?? [])],
      chains,
      complete,
      bridgeCircuitBreaker: this.cfg.bridgeCircuitBreaker ?? true,
      entries: this.entries,
      bundles: await this.bundles(),
      stops: this.stops,
      skips: this.skips,
      warnings: this.warnings,
    }
  }

  private async chains(): Promise<MigrationPlanChain[]> {
    const ids = [
      this.cfg.hubCentrifugeId,
      ...this.cfg.spokeCentrifugeIds.filter((cid) => cid !== this.cfg.hubCentrifugeId),
    ]
    return Promise.all(
      ids.map(async (centrifugeId) => ({
        centrifugeId,
        block: await this.driver.blockOf(centrifugeId),
        spokePhase: await this.spokePhase(centrifugeId),
        frozenGeneration: await this.frozenGeneration(centrifugeId),
        freezeGeneration: await this.freezeGeneration(centrifugeId),
      }))
    )
  }

  // The derivation point: every phase and generation is read once, so the plan is consistent with itself

  private hubPhase(): Promise<HubPhaseName> {
    if (!this.hubPhaseRead) this.hubPhaseRead = this.driver.hubPhase()
    return this.hubPhaseRead
  }

  private spokePhase(cid: CentrifugeId): Promise<SpokePhaseName> {
    let read = this.spokePhases.get(cid)
    if (!read) {
      read = this.driver.spokePhase(cid)
      this.spokePhases.set(cid, read)
    }
    return read
  }

  private freezeGeneration(cid: CentrifugeId): Promise<number> {
    let read = this.freezeGenerations.get(cid)
    if (!read) {
      read = this.driver.freezeGeneration(cid)
      this.freezeGenerations.set(cid, read)
    }
    return read
  }

  private frozenGeneration(cid: CentrifugeId): Promise<number> {
    let read = this.frozenGenerations.get(cid)
    if (!read) {
      read = this.driver.frozenGeneration(cid)
      this.frozenGenerations.set(cid, read)
    }
    return read
  }

  private quote(executeOn: CentrifugeId, destinations: CentrifugeId[], message: MessageTypeV3_3): Promise<bigint> {
    const key = `${executeOn}:${destinations.join(',')}:${message}`
    let quote = this.quotes.get(key)
    if (!quote) {
      quote = this.driver.quote(executeOn, destinations, message)
      this.quotes.set(key, quote)
    }
    return quote
  }

  private after(cid: CentrifugeId): PlanCall[] {
    let list = this.landed.get(cid)
    if (!list) {
      list = []
      this.landed.set(cid, list)
    }
    return list
  }

  // Phases

  private async arm() {
    const hub = this.cfg.hubCentrifugeId
    if ((await this.hubPhase()) === 'none') {
      await this.run1(this.call('initiateMigration', 'arm', { name: 'initiateMigration' }, hub, hub, [], true), [])
      this.skip('relayArm', hub, 'the hub is not armed yet: lanes and the arm follow once initiateMigration landed')
      return
    }
    this.skip('initiateMigration', hub, 'hub already armed')
    await this.installLanes()
    if (this.hubStopped) return
    if (
      (await this.hubPhase()) === 'armed' &&
      this.holdOnUnreadableSpokes('relayArm', 'cannot be armed, and cannot be left out of the arm either', 'skip')
    )
      return
    const pending: CentrifugeId[] = []
    const held: CentrifugeId[] = []
    for (const cid of this.cfg.spokeCentrifugeIds) {
      if (await this.driver.spokeArmed(cid)) continue
      if (this.stopped.has(cid)) held.push(cid)
      else pending.push(cid)
    }
    for (const cid of held) this.skip('relayArm', cid, 'stopped on its lane; left out of this arm')
    if (pending.length === 0) {
      this.skip(
        'relayArm',
        hub,
        held.length > 0 ? 'every spoke not stopped already armed' : 'every spoke already armed'
      )
      return
    }
    const remote = this.remoteOf(pending)
    const missing: string[] = []
    for (const cid of remote) {
      const sides = [
        (await this.driver.poolAdaptersInstalled(hub, cid)) ? null : 'hub',
        (await this.driver.poolAdaptersInstalled(cid, hub)) ? null : 'spoke',
      ].filter((side) => side !== null)
      if (sides.length > 0) missing.push(`cid ${cid}: ${sides.join(' and ')} side`)
    }
    if (missing.length > 0) {
      this.skip(
        'relayArm',
        hub,
        `lane missing on ${missing.join('; ')}: the arm follows once both halves are installed`
      )
      return
    }
    await this.run1(
      this.call('relayArm', 'arm', { name: 'relayArm', args: { spokeCentrifugeIds: pending } }, hub, hub, remote, true),
      []
    )
  }

  private async installLanes() {
    const hub = this.cfg.hubCentrifugeId
    for (const cid of this.cfg.spokeCentrifugeIds) {
      if (cid === hub) {
        this.skip('installPoolAdapters', cid, 'same-chain spoke, no lane to install')
        continue
      }
      await this.installOneSide(cid, 'hub')
      if (await this.haltedFor('installPoolAdapters (spoke side)', cid)) continue
      await this.installOneSide(cid, 'spoke')
    }
  }

  private async installOneSide(spoke: CentrifugeId, side: 'hub' | 'spoke') {
    const hub = this.cfg.hubCentrifugeId
    const label = `installPoolAdapters (${side} side)`
    const [executeOn, toward] = side === 'hub' ? [hub, spoke] : [spoke, hub]
    if (await this.driver.poolAdaptersInstalled(executeOn, toward)) {
      this.skip(label, spoke, 'lane already installed')
      return
    }
    const operation: MigrationOperation = { name: 'installPoolAdapters', args: { centrifugeId: spoke, signOn: side } }
    const call = this.call(label, 'arm', operation, executeOn, spoke, [], false)
    call.signer = 'anyone'
    await this.run1(call, [])
  }

  private async freeze(cid: CentrifugeId) {
    if (await this.haltedFor('relayFreeze', cid)) return
    if ((await this.spokePhase(cid)) !== 'armed') {
      this.skip('relayFreeze', cid, 'spoke not Armed')
      return
    }
    if (await this.stopsOnFreezeInFlight(cid)) return
    if (await this.stopsOnArmInFlight(cid)) return
    if (await this.stopsOnSpokeSteps('relayFreeze', cid, 'freeze')) return
    const input = await this.driver.freezeInput(cid)
    const operation: MigrationOperation = {
      name: 'relayFreeze',
      args: { centrifugeId: cid, syncReserves: input.syncReserves, extraGasLimit: this.budgets.freezeGas.toString() },
    }
    const rows = [row('Freeze', freezeLength(input))]
    await this.run1(
      this.call('relayFreeze', 'freeze', operation, this.cfg.hubCentrifugeId, cid, this.remoteOne(cid), false),
      rows
    )
  }

  private async stopsOnFreezeInFlight(cid: CentrifugeId): Promise<boolean> {
    const hubGeneration = await this.freezeGeneration(cid)
    const spokeGeneration = await this.frozenGeneration(cid)
    if (spokeGeneration === hubGeneration) return false
    this.stopSpoke(
      'relayFreeze',
      cid,
      `spoke reads Armed at generation ${spokeGeneration} while the hub's current freeze is generation ${hubGeneration}: a Freeze toward it is in flight or parked, and another would be a second one. Wait for it to land, or settle its parked messages and retry the original`
    )
    return true
  }

  private async stopsOnArmInFlight(cid: CentrifugeId): Promise<boolean> {
    if (this.armsLanded) return false
    const armed = await this.driver.armedSpokes()
    for (const other of armed) {
      if (!this.cfg.spokeCentrifugeIds.includes(other)) continue
      if ((await this.spokePhase(other)) !== 'none') continue
      this.stopSpoke(
        'relayFreeze',
        cid,
        `armed spoke cid ${other} reads None: its Arm is in flight or parked, and no Freeze is sent until every armed spoke reads Armed. Wait for it to land, or settle its parked messages, then re-plan`
      )
      return true
    }
    this.armsLanded = true
    return false
  }

  private async stopsOnSpokeSteps(label: string, cid: CentrifugeId, phase: RelayPhase): Promise<boolean> {
    if (cid === this.cfg.hubCentrifugeId) return false
    const { stop, warning, parked, underpaid } = await this.driver.spokeStepsBlock(cid, phase)
    if (warning) this.warn(label, cid, warning)
    if (!stop) return false
    if (this.cfg.ignoreStepsInFlight && !parked && !underpaid) {
      this.warn(label, cid, `${stop} (ignoreStepsInFlight: planned anyway)`)
      return false
    }
    this.stopSpoke(label, cid, stop)
    return true
  }

  private async offboard(cid: CentrifugeId) {
    if (await this.haltedFor('relayOffboard', cid)) return
    const hubGeneration = await this.freezeGeneration(cid)
    if ((await this.spokePhase(cid)) !== 'frozen') {
      this.skip('relayOffboard', cid, 'spoke not Frozen')
      return
    }
    const spokeGeneration = await this.frozenGeneration(cid)
    if (spokeGeneration !== hubGeneration) {
      this.stopSpoke(
        'relayOffboard',
        cid,
        `spoke frozen at generation ${spokeGeneration} while the hub's current freeze is generation ${hubGeneration}: an offboard step would run under the older freeze, because an Abort or re-freeze toward it has not landed in order`
      )
      return
    }
    if (await this.stopsOnUnfrozenSpoke(cid)) return
    if (await this.stopsOnSpokeSteps('relayOffboard', cid, 'offboard')) return
    const input: OffboardSpokeInput = {
      ...(await this.driver.offboardInput(cid)),
      unlinkGas: this.budgets.unlinkGas.toString(),
      rotateGas: this.budgets.rotateGas.toString(),
      managersGas: this.budgets.managersGas.toString(),
      finalizeGas: this.budgets.offboardFinalizeGas.toString(),
    }
    await this.offboardSlices(cid, input)
  }

  /**
   * The first offboard toward any spoke waits until every other armed spoke reads Frozen at the hub's current
   * generation: a spoke without its outgoing block can still start a share transfer toward the offboarded one, and the
   * offboard cannot be undone. An offboard already started finishes its slices.
   */
  private async stopsOnUnfrozenSpoke(cid: CentrifugeId): Promise<boolean> {
    if (await this.driver.offboardStarted(cid)) return false
    for (const other of await this.driver.armedSpokes()) {
      if (other === cid || !this.cfg.spokeCentrifugeIds.includes(other)) continue
      const phase = await this.spokePhase(other)
      if (phase === 'offboarded' || phase === 'onboarded') continue
      const hubGeneration = await this.freezeGeneration(other)
      const spokeGeneration = await this.frozenGeneration(other)
      if (phase === 'frozen' && spokeGeneration === hubGeneration) continue
      this.stopSpoke(
        'relayOffboard',
        cid,
        `${unfrozenCase(other, phase, hubGeneration, spokeGeneration)}. The first offboard waits until every armed spoke is frozen, since it cannot be undone. Wait for it, then re-plan`
      )
      return true
    }
    return false
  }

  private offboardCall(cid: CentrifugeId, part: OffboardSpokeInput, slice: number): PlanCall {
    return this.call(
      slice === 0 ? 'relayOffboard' : `relayOffboard slice ${slice}`,
      'offboard',
      { name: 'relayOffboard', args: { centrifugeId: cid, input: part } },
      this.cfg.hubCentrifugeId,
      cid,
      this.remoteOne(cid),
      false
    )
  }

  private async offboardSlices(cid: CentrifugeId, input: OffboardSpokeInput) {
    this.landed.set(cid, [])
    const items = offboardItems(input)
    if (cid === this.cfg.hubCentrifugeId) {
      await this.run1(this.offboardCall(cid, input, 0), offboardRows(input))
      return
    }
    let from = 0
    let slice = 0
    while (from < items) {
      let count = items - from
      let sent = false
      while (count > 0) {
        slice++
        const part = offboardSlice(input, from, count, false)
        if (await this.offer(this.offboardCall(cid, part, slice), offboardRows(part), cid, count)) {
          from += count
          sent = true
          break
        }
        slice--
        if (this.stopped.has(cid)) return
        count = Math.floor(count / 2)
      }
      if (!sent) return
    }
    const last = offboardSlice(input, 0, 0, true)
    await this.run1(
      this.offboardCall(cid, last, items === 0 ? 0 : slice + 1),
      offboardRows(last),
      items === 0 ? null : { index: 0, count: 0 }
    )
    this.numberSlices(cid, 'offboard')
  }

  private async registerRampAssets(cid: CentrifugeId) {
    if (this.hubStopped || this.stopped.has(cid)) return
    if ((await this.spokePhase(cid)) !== 'offboarded') return
    const { spoke, accountingToken, tokenIds } = await this.driver.rampRegistrations(cid)
    for (const tokenId of tokenIds) {
      const data = encodeRegisterAsset(this.cfg.poolId.centrifugeId, accountingToken, tokenId, this.cfg.operator)
      const call: PlanCall = {
        label: 'registerAsset (ramp accounting id, backend precondition)',
        phase: 'offboard',
        operation: null,
        executeOn: cid,
        centrifugeId: cid,
        to: spoke,
        data,
        value: this.cfg.registerValue ?? 0n,
        destinations: this.hubFrom(cid),
        hubStep: false,
        signer: 'anyone',
        message: MessageTypeV3_3.RegisterAsset,
      }
      await this.run1(call, [])
      if (this.stopped.has(cid)) break
    }
  }

  private async onboardHub() {
    if (this.hubStopped) return
    const hub = this.cfg.hubCentrifugeId
    if ((await this.hubPhase()) !== 'armed') {
      this.skip('onboardHub', hub, 'hub not Armed')
      return
    }
    if (
      this.holdOnUnreadableSpokes(
        'onboardHub',
        'cannot be told armed or not: onboarding the hub now could leave it on v3.2 with no way to arm it after',
        'stop'
      )
    )
      return
    const armed = await this.driver.armedSpokes()
    const unarmed = await this.unarmedSpokes()
    if (unarmed.length > 0) {
      this.skip(
        'onboardHub',
        hub,
        `the arm has not reached ${unarmed.map((cid) => `cid ${cid}`).join(', ')}: onboarding the hub now would leave it on v3.2 with no way to arm it after`
      )
      return
    }
    if (!(await this.allSpokesIn(armed, 'offboarded'))) {
      this.skip('onboardHub', hub, 'not every armed spoke reached Offboarded')
      return
    }
    for (const cid of armed) {
      const hubGeneration = await this.freezeGeneration(cid)
      const spokeGeneration = await this.frozenGeneration(cid)
      if (spokeGeneration === hubGeneration) continue
      this.stop(
        'onboardHub',
        hub,
        `cid ${cid} offboarded at generation ${spokeGeneration} while the hub's current freeze is generation ${hubGeneration}: its offboard ran under an older freeze. Do not onboard the hub; compare the two freezes' inputs`
      )
      return
    }
    const input = {
      ...(await this.driver.onboardHubInput(armed)),
      noV32Spokes: this.cfg.spokeCentrifugeIds.length === 0,
    }
    await this.run1(
      this.call(
        'onboardHub',
        'onboardHub',
        { name: 'onboardHub', args: { input } },
        hub,
        hub,
        this.remoteOf(armed),
        true
      ),
      []
    )
  }

  private async checkEpochCarry() {
    if (this.hubStopped) return
    if ((await this.hubPhase()) !== 'hubOnboarded') return
    const mismatch = await this.driver.epochIdMismatch()
    if (mismatch.length !== 0) this.stop('onboardHub epoch carry', this.cfg.hubCentrifugeId, mismatch)
  }

  private async checkVaultLinks(cid: CentrifugeId) {
    if ((await this.spokePhase(cid)) !== 'onboarded') return
    for (const { vault, wasLinked } of await this.driver.vaultLinkMismatches(cid)) {
      this.warn(
        'relayOnboardSpoke vault link',
        cid,
        `vault ${vault}${
          wasLinked
            ? ' was linked on v3.2 and is NOT linked on v3.3: it refuses requests until the manager sends a hub Link'
            : ' was unlinked on v3.2 and IS linked on v3.3: it accepts requests until the manager sends a hub Unlink'
        }`
      )
    }
  }

  private async onboardSpoke(cid: CentrifugeId) {
    if (await this.haltedFor('relayOnboardSpoke', cid)) return
    if ((await this.hubPhase()) !== 'hubOnboarded') {
      this.skip('relayOnboardSpoke', cid, 'hub not HubOnboarded')
      return
    }
    if ((await this.spokePhase(cid)) !== 'offboarded') {
      this.skip('relayOnboardSpoke', cid, 'spoke not Offboarded')
      return
    }
    if (await this.stopsOnSpokeSteps('relayOnboardSpoke', cid, 'onboardSpokes')) return
    const raw = await this.driver.onboardSpokeInput(cid)
    const b = this.budgets
    const input: OnboardSpokeInput = {
      ...raw,
      linkGas: b.linkGas.toString(),
      registerGas: b.registerGas.toString(),
      configureGas: b.configureGas.toString(),
      hookManagersGas: b.hookManagersGas.toString(),
      assetPriceGas: b.assetPriceGas.toString(),
      spokeManagersGas: b.spokeManagersGas.toString(),
      seedGas: b.seedGas.toString(),
      seedQueueGas: b.seedQueueGas.toString(),
      finalizeGas: b.onboardFinalizeGas.toString(),
      ramps: raw.ramps.map((ramp) => ({ ...ramp, extraGasLimit: b.rampGas.toString() })),
    }
    await this.onboardSlices(cid, input)
  }

  private onboardCall(cid: CentrifugeId, part: OnboardSpokeInput, slice: number): PlanCall {
    return this.call(
      slice === 0 ? 'relayOnboardSpoke' : `relayOnboardSpoke slice ${slice}`,
      'onboardSpokes',
      { name: 'relayOnboardSpoke', args: { centrifugeId: cid, input: part } },
      this.cfg.hubCentrifugeId,
      cid,
      this.remoteOne(cid),
      false
    )
  }

  private async onboardSlices(cid: CentrifugeId, input: OnboardSpokeInput) {
    this.landed.set(cid, [])
    if (cid === this.cfg.hubCentrifugeId) {
      await this.run1(this.onboardCall(cid, input, 0), onboardRows(input))
      return
    }
    const cursor = { slice: 0 }
    await this.onboardWindow(cid, input, true, cursor)
    if (this.stopped.has(cid)) return
    await this.onboardWindow(cid, input, false, cursor)
    if (this.stopped.has(cid)) return
    const last = onboardSlice(input, false, 0, 0, true)
    await this.run1(this.onboardCall(cid, last, cursor.slice + 1), onboardRows(last), { index: 0, count: 0 })
    this.numberSlices(cid, 'onboardSpokes')
  }

  private async onboardWindow(
    cid: CentrifugeId,
    input: OnboardSpokeInput,
    classes: boolean,
    cursor: { slice: number }
  ) {
    const items = classes ? onboardClasses(input) : onboardTail(input)
    let from = 0
    while (from < items) {
      let count = items - from
      let sent = false
      while (count > 0) {
        cursor.slice++
        const part = onboardSlice(input, classes, from, count, false)
        if (await this.offer(this.onboardCall(cid, part, cursor.slice), onboardRows(part), cid, count)) {
          from += count
          sent = true
          break
        }
        cursor.slice--
        if (this.stopped.has(cid)) return
        count = Math.floor(count / 2)
      }
      if (!sent) return
    }
  }

  private async activate() {
    if (this.hubStopped) return
    const hub = this.cfg.hubCentrifugeId
    if ((await this.hubPhase()) !== 'hubOnboarded') {
      this.skip('activate', hub, 'hub not HubOnboarded')
      return
    }
    const armed = await this.driver.armedSpokes()
    const unarmed = await this.unarmedSpokes()
    if (unarmed.length > 0) {
      this.stop(
        'activate',
        hub,
        `${unarmed.map((cid) => `cid ${cid}`).join(', ')} was never armed and the hub is past the arm: activating would leave it on v3.2`
      )
      return
    }
    if (!(await this.allSpokesIn(armed, 'onboarded'))) {
      this.skip('activate', hub, 'not every armed spoke reached Onboarded')
      return
    }
    const operation: MigrationOperation = {
      name: 'activate',
      args: { restoreGas: this.budgets.restoreGas.toString(), spokeCentrifugeIds: armed },
    }
    await this.run1(this.call('activate', 'activate', operation, hub, hub, this.remoteOf(armed), true), [])
  }

  // One operator call, simulated

  private call(
    label: string,
    phase: MigrationPlanPhase,
    operation: MigrationOperation,
    executeOn: CentrifugeId,
    centrifugeId: CentrifugeId,
    destinations: CentrifugeId[],
    hubStep: boolean
  ): PlanCall {
    const { to, data } = this.driver.build(operation, executeOn)
    return {
      label,
      phase,
      operation,
      executeOn,
      centrifugeId,
      to,
      data,
      value: 0n,
      destinations,
      hubStep,
      signer: 'operator',
    }
  }

  private async priced(call: PlanCall): Promise<PlanCall> {
    if (call.destinations.length === 0 || call.value !== 0n) return call
    return {
      ...call,
      value: await this.quote(call.executeOn, call.destinations, call.message ?? MessageTypeV3_3.ManagerCallFromHub),
    }
  }

  private async run1(call: PlanCall, rows: PayloadRow[], slice: { index: number; count: number } | null = null) {
    const priced = await this.priced(call)
    const hubPhase = await this.hubPhase()
    const spokePhase = await this.spokePhase(priced.centrifugeId)
    const after = slice === null ? [] : this.after(priced.centrifugeId)
    const sim = await this.driver.simulate(priced, after)
    const clean = await this.record(priced, rows, sim, hubPhase, spokePhase, slice)
    if (clean && slice !== null) after.push(priced)
  }

  /** `MigrationWalk._offer`: a refusal read as "smaller" is silent, a landing over the slice target is cut back, anything else is recorded. */
  private async offer(call: PlanCall, rows: PayloadRow[], cid: CentrifugeId, count: number): Promise<boolean> {
    const priced = await this.priced(call)
    const hubPhase = await this.hubPhase()
    const spokePhase = await this.spokePhase(cid)
    const after = this.after(cid)
    const sim = await this.driver.simulate(priced, after)
    const ceiling = await this.driver.ceiling(cid)
    const batch = batchGasOf(sim, cid)
    const over = sim.ok && ceiling.ceiling !== 0n && batch > ceiling.ceiling
    const aboveTarget = sim.ok && ceiling.sliceTarget !== 0n && batch > ceiling.sliceTarget
    if (count > 1 && (aboveTarget || (!sim.ok && isSmaller(sim.revert)))) return false
    const clean = await this.record(priced, rows, sim, hubPhase, spokePhase, { index: 0, count: 0 })
    if (clean && !over) after.push(priced)
    return clean && !over
  }

  private async record(
    call: PlanCall,
    rows: PayloadRow[],
    sim: PlanSimulation,
    hubPhase: HubPhaseName,
    spokePhase: SpokePhaseName,
    slice: { index: number; count: number } | null
  ): Promise<boolean> {
    let batchGas = 0n
    let ceiling: BatchCeiling | null = null
    const ceilinged = call.destinations.length !== 0 && call.executeOn === this.cfg.hubCentrifugeId
    if (ceilinged) {
      let worst: CentrifugeId | null = null
      let over = 0n
      for (const destination of call.destinations) {
        const gas = batchGasOf(sim, destination)
        const limit = (await this.driver.ceiling(destination)).ceiling
        if (limit !== 0n && gas > limit && gas - limit > over) over = gas - limit
        else if (over !== 0n || gas < batchGas) continue
        batchGas = gas
        worst = destination
      }
      ceiling = await this.driver.ceiling(worst ?? call.destinations[0]!)
    }
    const overCeiling = ceiling !== null && ceiling.ceiling !== 0n && batchGas > ceiling.ceiling
    if (!sim.ok || overCeiling) {
      const reason = !sim.ok
        ? (sim.error ?? describeRevert(sim.revert))
        : `the batch (${batchGas}) is over its ${ceiling!.binds} ceiling (${ceiling!.ceiling}), so it would revert at apply time`
      if (call.hubStep) this.stop(call.label, call.centrifugeId, reason)
      else this.stopSpoke(call.label, call.centrifugeId, reason)
      return false
    }
    let manual = false
    if (ceilinged) {
      for (const destination of call.destinations) {
        const limits = await this.driver.ceiling(destination)
        if (limits.smallBlock !== 0n && batchGasOf(sim, destination) > limits.smallBlock) manual = true
        if (limits.unquotable.length !== 0 && !this.laneWarned.has(destination)) {
          this.laneWarned.add(destination)
          this.warn(
            call.label,
            destination,
            `adapter(s) ${limits.unquotable.join(', ')} on the lane toward cid ${destination} quote no delivery gas at all, so the lane may not carry the batch`
          )
        }
      }
    }
    this.entries.push({
      label: call.label,
      phase: call.phase,
      operation: call.operation,
      executeOn: call.executeOn,
      concerns: call.centrifugeId,
      destinations: call.destinations,
      to: call.to,
      data: call.data,
      value: call.value,
      requiredHubPhase: hubPhase,
      requiredSpokePhase: spokePhase,
      slice,
      gasUsed: sim.gasUsed,
      batchGas,
      ceiling: ceiling?.ceiling ?? 0n,
      binds: ceiling?.binds ?? '',
      manualDelivery: manual,
      widestPayload: widest(rows),
      signer: call.signer,
    })
    for (const r of rows)
      if (r.overBudget)
        this.warn(call.label, call.centrifugeId, `${r.label} payload ${r.bytes} B over the ${PAYLOAD_BUDGET} B budget`)
    return true
  }

  private numberSlices(cid: CentrifugeId, phase: MigrationPlanPhase) {
    const slices = this.entries.filter(
      (entry) => entry.phase === phase && entry.concerns === cid && entry.slice !== null
    )
    slices.forEach((entry, i) => {
      entry.slice = { index: i + 1, count: slices.length }
    })
  }

  /**
   * AS47: one phase's hub entries in one approval, breaking at a manual entry, another chain, a phase boundary or the
   * hub's transaction limit. The limit leaves room for the signer's gas pad, so entries grouped together stay under
   * EIP-7825 once padded; an entry over the limit on its own is still its own bundle.
   */
  private async bundles(): Promise<MigrationPlanBundle[]> {
    const block = await this.driver.hubTransactionGasLimit()
    const limit = ((block < MAX_TRANSACTION_GAS ? block : MAX_TRANSACTION_GAS) * 90n) / GAS_LIMIT_PAD_PERCENT
    const bundles: MigrationPlanBundle[] = []
    let open: MigrationPlanBundle | null = null
    const close = () => {
      if (open) bundles.push(open)
      open = null
    }
    this.entries.forEach((entry, i) => {
      const alone = entry.manualDelivery || entry.executeOn !== this.cfg.hubCentrifugeId || entry.operation === null
      const isFinalize = entry.slice !== null && entry.slice.index === entry.slice.count && entry.slice.count > 1
      const isFirstOffboardSlice = entry.phase === 'offboard' && entry.slice !== null && entry.slice.index === 1
      if (alone || isFinalize || isFirstOffboardSlice) {
        close()
        bundles.push({
          phase: entry.phase,
          executeOn: entry.executeOn,
          entries: [i],
          gas: entry.gasUsed,
          value: entry.value,
        })
        return
      }
      if (
        open &&
        (open.phase !== entry.phase || open.executeOn !== entry.executeOn || open.gas + entry.gasUsed > limit)
      )
        close()
      if (!open) open = { phase: entry.phase, executeOn: entry.executeOn, entries: [], gas: 0n, value: 0n }
      open.entries.push(i)
      open.gas += entry.gasUsed
      open.value += entry.value
    })
    close()
    return bundles
  }

  // Helpers

  private async haltedFor(label: string, cid: CentrifugeId): Promise<boolean> {
    if (this.stopped.has(cid)) {
      this.skip(label, cid, 'this spoke stopped on an earlier step')
      return true
    }
    if (this.hubStopped) {
      this.skip(label, cid, 'the hub stopped on an earlier step')
      return true
    }
    return false
  }

  private async unarmedSpokes(): Promise<CentrifugeId[]> {
    const unarmed: CentrifugeId[] = []
    for (const cid of this.cfg.spokeCentrifugeIds) if (!(await this.driver.spokeArmed(cid))) unarmed.push(cid)
    return unarmed
  }

  private async allSpokesIn(armed: CentrifugeId[], expected: SpokePhaseName): Promise<boolean> {
    for (const cid of armed) if ((await this.spokePhase(cid)) !== expected) return false
    return true
  }

  private holdOnUnreadableSpokes(label: string, consequence: string, how: 'skip' | 'stop'): boolean {
    const unreadable = this.cfg.unreadableSpokes ?? []
    if (unreadable.length === 0) return false
    const named = unreadable
      .map((spoke) => (spoke.centrifugeId === null ? spoke.reason : `cid ${spoke.centrifugeId} (${spoke.reason})`))
      .join('; ')
    const reason = `the spoke set could not be read in full: ${named}. A spoke the plan cannot see ${consequence}`
    if (how === 'stop') this.stop(label, this.cfg.hubCentrifugeId, reason)
    else this.skip(label, this.cfg.hubCentrifugeId, reason)
    return true
  }

  private stop(label: string, centrifugeId: CentrifugeId, reason: string) {
    this.stops.push({ label, centrifugeId, reason, hub: true })
    this.hubStopped = true
  }

  private stopSpoke(label: string, centrifugeId: CentrifugeId, reason: string) {
    this.stops.push({ label, centrifugeId, reason, hub: false })
    this.stopped.add(centrifugeId)
  }

  private skip(label: string, centrifugeId: CentrifugeId, reason: string) {
    this.skips.push({ label, centrifugeId, reason })
  }

  private readonly laneWarned = new Set<CentrifugeId>()

  private warn(label: string, centrifugeId: CentrifugeId, why: string) {
    this.warnings.push(`${label} cid ${centrifugeId} - ${why}`)
  }

  private remoteOne(cid: CentrifugeId): CentrifugeId[] {
    return cid === this.cfg.hubCentrifugeId ? [] : [cid]
  }

  private hubFrom(cid: CentrifugeId): CentrifugeId[] {
    return cid === this.cfg.hubCentrifugeId ? [] : [this.cfg.hubCentrifugeId]
  }

  private remoteOf(cids: readonly CentrifugeId[]): CentrifugeId[] {
    return cids.filter((cid) => cid !== this.cfg.hubCentrifugeId)
  }
}

function batchGasOf(sim: PlanSimulation, cid: CentrifugeId): bigint {
  let total = 0n
  for (const batch of sim.batches) if (batch.centrifugeId === cid && batch.gasLimit > total) total = batch.gasLimit
  return total
}

/** @internal */
export function encodeRegisterAsset(
  hubCentrifugeId: CentrifugeId,
  asset: HexString,
  tokenId: bigint,
  refund: HexString
): HexString {
  const selector = keccak256(toHex('registerAsset(uint16,address,uint256,address)')).slice(0, 10)
  const args = encodeAbiParameters(
    [{ type: 'uint16' }, { type: 'address' }, { type: 'uint256' }, { type: 'address' }],
    [hubCentrifugeId, asset, tokenId, refund]
  )
  return `${selector}${args.slice(2)}` as HexString
}

const REVERT_NAMES: Record<string, string> = {
  [BATCH_TOO_EXPENSIVE]: 'IGateway.BatchTooExpensive (the batch needs slicing)',
  [CHAINLINK_GAS_LIMIT_TOO_HIGH]:
    'Chainlink MessageGasLimitTooHigh (the batch is over the lane CCIP gas cap and needs slicing)',
}

/** @internal */
export function describeRevert(revert: HexString): string {
  if (revert === '0x' || revert.length < 10)
    return revert.length < 10 && revert !== '0x'
      ? `malformed revert data ${revert}`
      : 'empty revert (out of gas, or a plain require)'
  const selector = revert.slice(0, 10)
  const name = REVERT_NAMES[selector]
  if (name) return `${name}, raw ${revert}`
  return protocolErrorName(revert) ?? `revert ${selector}, data ${revert}`
}

/**
 * The one action the call order puts first: the first plan entry, since the planner lists entries in the
 * call order; a wait when nothing is signable and a relayed step is still in flight; null once nothing remains.
 * @internal
 */
export function nextActionOf(
  plan: MigrationPlan,
  inFlight: readonly { centrifugeId: CentrifugeId; stepName: string }[]
): MigrationNextAction | null {
  const entry = plan.entries[0]
  if (entry) {
    const hub = entry.executeOn === plan.hubCentrifugeId && entry.concerns === plan.hubCentrifugeId
    return {
      step: entry.label.startsWith('installPoolAdapters') ? 'lanes' : entry.phase,
      on: hub ? 'hub' : entry.concerns,
      chain: entry.executeOn,
      label: entry.label,
      signer: entry.signer,
      entry: 0,
    }
  }
  const wait = inFlight[0]
  if (wait) {
    return {
      step: phaseOfStep(wait.stepName, plan.hubPhase),
      on: wait.centrifugeId,
      chain: wait.centrifugeId,
      label: `Wait for ${wait.stepName} on cid ${wait.centrifugeId}`,
      signer: 'operator',
      entry: null,
      nothingToSign: true,
      waitingFor: wait.stepName,
    }
  }
  const stop = plan.stops[0]
  if (stop) {
    return {
      step: 'blocked',
      on: stop.hub ? 'hub' : stop.centrifugeId,
      chain: stop.centrifugeId,
      label: `${stop.label} stopped on cid ${stop.centrifugeId}`,
      signer: 'operator',
      entry: null,
      nothingToSign: true,
      reason: stop.reason,
    }
  }
  return null
}

const PHASE_OF_STEP: Readonly<Record<MigrationStepName, MigrationNextAction['step']>> = {
  arm: 'arm',
  freeze: 'freeze',
  abort: 'freeze',
  unlinkVaults: 'offboard',
  rotateAssets: 'offboard',
  removeManagers: 'offboard',
  finalizeOffboard: 'offboard',
  linkTokens: 'onboardSpokes',
  registerVaults: 'onboardSpokes',
  configureVaults: 'onboardSpokes',
  seedEscrow: 'onboardSpokes',
  seedShareQueue: 'onboardSpokes',
  finalizeOnboard: 'onboardSpokes',
  restoreMaxReserves: 'goLive',
  setupRamps: 'onboardSpokes',
  assertHookManagers: 'onboardSpokes',
  copyAssetPrice: 'onboardSpokes',
  assertSpokeManagers: 'onboardSpokes',
  assertRampConfig: 'onboardSpokes',
}

function phaseOfStep(stepName: string, hubPhase: HubPhaseName): MigrationNextAction['step'] {
  const known = (PHASE_OF_STEP as Record<string, MigrationNextAction['step'] | undefined>)[stepName]
  if (known) return known
  return hubPhase === 'activated' ? 'goLive' : 'freeze'
}

function unfrozenCase(
  cid: CentrifugeId,
  phase: SpokePhaseName,
  hubGeneration: number,
  spokeGeneration: number
): string {
  if (phase === 'frozen') {
    return `spoke cid ${cid} is frozen at generation ${spokeGeneration} while the hub's current freeze is generation ${hubGeneration}: an Abort or re-freeze toward it is in flight`
  }
  if (phase === 'none') return `spoke cid ${cid} is armed on the hub but reads None: its Arm is in flight`
  if (hubGeneration !== spokeGeneration)
    return `spoke cid ${cid} reads Armed while the hub sent Freeze generation ${hubGeneration}: its Freeze is in flight`
  if (hubGeneration === 0) return `spoke cid ${cid} reads Armed and was never frozen: no Freeze was sent toward it`
  return `spoke cid ${cid} reads Armed again after an Abort: it needs a new Freeze`
}
