import { catchError, combineLatest, defer, map, of, switchMap } from 'rxjs'
import type { Observable } from 'rxjs'
import {
  BuilderArgumentMismatchError,
  deriveSpokeGateState,
  getMessageId,
  HUB_PHASE,
  MIGRATION_STEP,
  migrationBuilders,
  migrationStepName,
  resolveMigrationChain,
  resolveMigrationContext,
  UnknownDeploymentError,
  type ActivateArgs,
  type BuiltProtocolCall,
  type HubPhaseName,
  type InstallPoolAdaptersArgs,
  type LockArgs,
  type MigrationStepName,
  type OnboardHubArgs,
  type PoolArgs,
  type RelayAbortArgs,
  type RelayArmArgs,
  type RelayFreezeArgs,
  type RelayOffboardArgs,
  type RelayOnboardSpokeArgs,
  type SpokeGateState,
  type SpokePhaseName,
} from '@centrifuge/protocol'
import type { CrosschainMessageRow, PoolMigrationRow, PoolMigrationStepRow } from '@centrifuge/queries/core'
import type { Centrifuge } from '../Centrifuge.js'
import type { ChainEnvironment } from '@centrifuge/protocol'
import { BaseError, ContractFunctionRevertedError, encodeFunctionData, type Abi } from 'viem'
import type { HexString } from '../types/index.js'
import { MessageTypeV3_3, messageV3_3, type MessageTypeWithSubType } from '../types/transaction.js'
import { Balance } from '../utils/BigInt.js'
import { AssetId, PoolId, type CentrifugeId } from '../utils/types.js'
import type { Pool } from './Pool.js'
import type { ShareClass } from './ShareClass.js'
import { assetDecimalsByAssetId } from '../utils/assetDecimals.js'
import { protocolErrorName } from '../utils/protocolErrors.js'

export type MigrationStepLanding = 'landed' | 'parked' | 'dropped' | 'inFlight' | 'underpaid' | 'unmatched'

export type MigrationStep = {
  step: number
  stepName: MigrationStepName | null
  centrifugeId: CentrifugeId
  transactionHash: HexString
  logIndex: number
  createdAtBlock: number
  createdAt: Date
  payloadHash: HexString
  gatewayMessageHash: HexString
  isSameChainStep: boolean
  landing: MigrationStepLanding
  messageId: HexString | null
  messageIndex: number | null
  failReason: string | null
  executedAtTxHash: HexString | null
}

export type MigrationStepCounts = {
  relayed: number
  landed: number
  parked: number
  inFlight: number
  underpaid: number
  dropped: number
  unmatched: number
}

export type MigrationSpoke = {
  centrifugeId: CentrifugeId
  isHubChain: boolean
  phase: SpokePhaseName | null
  freezeGeneration: number
  abortedGeneration: number | null
  maxReservesRestored: boolean | null
  facadeFreezeGeneration: number | null
  facadeReadError: string | null
  state: SpokeGateState | null
  steps: MigrationStep[]
  counts: MigrationStepCounts
}

export type PoolMigration = {
  migrationId: string
  poolId: PoolId
  hubCentrifugeId: CentrifugeId
  targetVersion: string
  hubPhase: HubPhaseName
  operator: HexString
  startedAt: Date
  spokes: MigrationSpoke[]
}

export function stepsOfSpoke(migration: PoolMigration | null, centrifugeId: CentrifugeId): MigrationStep[] {
  return migration?.spokes.find((spoke) => spoke.centrifugeId === centrifugeId)?.steps ?? []
}

export function stepsSinceLastFreeze(steps: readonly MigrationStep[]): MigrationStep[] {
  let from = 0
  steps.forEach((step, index) => {
    if (step.step === MIGRATION_STEP.freeze) from = index
  })
  return steps.slice(from)
}

export function openSteps(steps: readonly MigrationStep[], ordinals: readonly number[]): MigrationStep[] {
  return steps.filter(
    (step) =>
      ordinals.includes(step.step) &&
      !step.isSameChainStep &&
      (step.landing === 'inFlight' || step.landing === 'underpaid' || step.landing === 'unmatched')
  )
}

export const PHASE_STEPS = {
  freeze: [MIGRATION_STEP.abort],
  offboard: [
    MIGRATION_STEP.unlinkVaults,
    MIGRATION_STEP.rotateAssets,
    MIGRATION_STEP.removeManagers,
    MIGRATION_STEP.finalizeOffboard,
  ],
  onboardSpokes: [
    MIGRATION_STEP.linkTokens,
    MIGRATION_STEP.seedShareQueue,
    MIGRATION_STEP.copyAssetPrice,
    MIGRATION_STEP.registerVaults,
    MIGRATION_STEP.configureVaults,
    MIGRATION_STEP.setupRamps,
    MIGRATION_STEP.assertRampConfig,
    MIGRATION_STEP.assertHookManagers,
    MIGRATION_STEP.seedEscrow,
    MIGRATION_STEP.assertSpokeManagers,
    MIGRATION_STEP.finalizeOnboard,
  ],
} as const satisfies Record<string, readonly number[]>

export type RelayPhase = keyof typeof PHASE_STEPS

const stepLabel = (step: Pick<MigrationStep, 'step' | 'stepName'>) => step.stepName ?? `step ${step.step}`

export function openStepsReason(open: readonly MigrationStep[]): string {
  const inFlight = open.filter((step) => step.landing === 'inFlight')
  if (inFlight.length === 0) return ''
  return inFlight
    .map((step) => `${stepLabel(step)} relayed in ${step.transactionHash} is still in flight`)
    .join('; ')
    .concat(
      '. The spoke reads unchanged until it lands, so a step derived now would be the one already sent. Wait for it to land, or deliver it by hand if it was a manual-delivery batch, then re-plan'
    )
}

export function underpaidStepsReason(open: readonly MigrationStep[]): string {
  const underpaid = open.filter((step) => step.landing === 'underpaid')
  if (underpaid.length === 0) return ''
  return underpaid
    .map(
      (step) => `${stepLabel(step)} relayed in ${step.transactionHash} sits in a batch the hub Gateway holds underpaid`
    )
    .join('; ')
    .concat(
      '. The batch never leaves the hub until it is repaid: repay it with centrifuge.repayBatch (or the repayBatch pool action) from the exact bytes of the Gateway UnderpaidBatch event, then wait for the step to land and re-plan. A step repaid already reads underpaid until the indexer clears it; a second repay is refused before signing'
    )
}

export function unmatchedStepsReason(open: readonly MigrationStep[]): string {
  const unmatched = open.filter((step) => step.landing === 'unmatched')
  if (unmatched.length === 0) return ''
  return unmatched
    .map((step) => `${stepLabel(step)} relayed in ${step.transactionHash} has no gateway message matched to it`)
    .join('; ')
    .concat(
      '. Whether it landed is unknown to the indexer and nothing on its row will say so later; check the spoke chain before signing the same step again'
    )
}

/** Whether an offboard step was relayed toward the spoke since its last Freeze; a dropped one never ran. */
export function offboardStarted(migration: PoolMigration | null, centrifugeId: CentrifugeId): boolean {
  const ordinals: readonly number[] = PHASE_STEPS.offboard
  return stepsSinceLastFreeze(stepsOfSpoke(migration, centrifugeId)).some(
    (step) => ordinals.includes(step.step) && step.landing !== 'dropped'
  )
}

export type SpokeStepsBlock = { stop: string; warning: string; parked: boolean; underpaid: boolean }

export function spokeStepsBlock(
  migration: PoolMigration | null,
  centrifugeId: CentrifugeId,
  phase: RelayPhase
): SpokeStepsBlock {
  const ordinals: readonly number[] = PHASE_STEPS[phase]
  const since = stepsSinceLastFreeze(stepsOfSpoke(migration, centrifugeId))
  const parked = since.filter((step) => ordinals.includes(step.step) && step.landing === 'parked')
  const open = openSteps(since, ordinals)
  const underpaid = underpaidStepsReason(open)
  if (parked.length > 0) {
    const stop = parked
      .map((step) => `${stepLabel(step)} parked${step.failReason ? `: ${step.failReason}` : ''}`)
      .join('; ')
      .concat('. A parked step is retried, never planned again; settle it before this spoke is derived again')
    return { stop: underpaid ? `${stop}. ${underpaid}` : stop, warning: '', parked: true, underpaid: underpaid !== '' }
  }
  return {
    stop: underpaid || openStepsReason(open),
    warning: unmatchedStepsReason(open),
    parked: false,
    underpaid: underpaid !== '',
  }
}

export function stepsInFlight(migration: PoolMigration | null): { centrifugeId: CentrifugeId; stepName: string }[] {
  return (migration?.spokes ?? []).flatMap((spoke) =>
    spoke.steps
      .filter((step) => step.landing === 'inFlight' && !step.isSameChainStep)
      .map((step) => ({ centrifugeId: spoke.centrifugeId, stepName: stepLabel(step) }))
  )
}

export type StepRelay = { step: number; transactionHash: HexString; logIndex: number; blockNumber: number }

export function unindexedRelaysReason(relays: readonly StepRelay[], steps: readonly MigrationStep[]): string {
  const fresh = relays.filter(
    (relay) =>
      !steps.some(
        (step) =>
          step.transactionHash.toLowerCase() === relay.transactionHash.toLowerCase() && step.logIndex === relay.logIndex
      )
  )
  if (fresh.length === 0) return ''
  return fresh
    .map(
      (relay) =>
        `${stepLabel({ step: relay.step, stepName: stepNameOf(relay.step) })} relayed in ${relay.transactionHash} at hub block ${relay.blockNumber}`
    )
    .join('; ')
    .concat(
      ' is not in the indexer yet, so where it landed is unknown and the spoke it reads may be behind the chain. Wait for the indexer to catch up, then re-plan'
    )
}

/**
 * What a plan derivation depends on, flattened: the hub phase, each spoke's phase and generations, and where every
 * relayed step landed. Two migration reads with the same fingerprint plan the same, so a poll that changed nothing
 * need not re-derive.
 * @internal
 */
export function migrationFingerprint(migration: PoolMigration | null): string {
  if (!migration) return 'none'
  return [
    migration.hubPhase,
    migration.operator,
    ...migration.spokes.map((spoke) =>
      [
        spoke.centrifugeId,
        spoke.phase ?? '-',
        spoke.freezeGeneration,
        spoke.facadeFreezeGeneration ?? '-',
        spoke.maxReservesRestored ?? '-',
        spoke.steps.map((step) => `${step.step}:${step.landing}`).join(','),
      ].join('/')
    ),
  ].join('|')
}

export type MigrationDrainItem = {
  centrifugeId: CentrifugeId
  shareClassId: HexString
  assetId: AssetId
  pendingDeposit: Balance
  pendingRedeem: Balance
  queuedInvest: Balance
  queuedRedeem: Balance
}

const PHASE_NAME_BY_ROW: Readonly<Record<string, HubPhaseName>> = {
  None: 'none',
  Armed: 'armed',
  HubOnboarded: 'hubOnboarded',
  Activated: 'activated',
}

const SPOKE_PHASE_NAME_BY_ROW: Readonly<Record<string, SpokePhaseName>> = {
  None: 'none',
  Armed: 'armed',
  Frozen: 'frozen',
  Offboarded: 'offboarded',
  Onboarded: 'onboarded',
}

export function hubPhaseOfRow(phase: string): HubPhaseName {
  const name = PHASE_NAME_BY_ROW[phase]
  if (!name) throw new Error(`pool_migration.hub_phase "${phase}" is not a hub phase`)
  return name
}

export function spokePhaseOfRow(phase: string): SpokePhaseName {
  const name = SPOKE_PHASE_NAME_BY_ROW[phase]
  if (!name) throw new Error(`pool_migration_spoke.phase "${phase}" is not a spoke phase`)
  return name
}

export async function migrationRelayTargets(
  client: { readContract: (call: any) => Promise<unknown> },
  poolId: PoolId,
  operation: MigrationOperation,
  environment: ChainEnvironment
): Promise<CentrifugeId[]> {
  if (operation.name !== 'onboardHub') return []
  const facade = migrationFacadeOf(poolId.centrifugeId, environment)
  if (!facade) throw new Error(`no migration facade is deployed on centrifugeId ${poolId.centrifugeId}`)
  const armed = (await client.readContract({
    address: facade.address,
    abi: facade.abi,
    functionName: 'armedSpokes',
    args: [poolId.raw],
  })) as readonly (number | bigint)[]
  return armed.map((cid) => Number(cid) as CentrifugeId)
}

export function migrationFacadeOf(
  centrifugeId: CentrifugeId,
  environment: ChainEnvironment
): { address: HexString; abi: Abi } | null {
  try {
    const chain = resolveMigrationChain(centrifugeId, { environment })
    return { address: chain.migration as HexString, abi: chain.abi as Abi }
  } catch (error) {
    if (error instanceof UnknownDeploymentError) return null
    throw error
  }
}

/**
 * The highest freeze generation a spoke has aborted, read off its row: an
 * `Armed` spoke with a non-zero generation aborted that generation, and a
 * spoke past `Armed` at generation g aborted every generation below g, since
 * a re-freeze is only legal after an abort.
 */
export function abortedGenerationOfRow(phase: SpokePhaseName | null, freezeGeneration: number): number | null {
  if (phase === null || freezeGeneration === 0) return null
  if (phase === 'armed' || phase === 'none') return freezeGeneration
  return freezeGeneration > 1 ? freezeGeneration - 1 : null
}

export function landingOf(
  step: Pick<PoolMigrationStepRow, 'isSameChainStep' | 'hasGatewayPrepareMessage'>,
  message: CrosschainMessageRow | undefined
): MigrationStepLanding {
  if (step.isSameChainStep) return 'landed'
  if (!step.hasGatewayPrepareMessage) return 'unmatched'
  if (!message) return 'inFlight'
  switch (message.status) {
    case 'Executed':
      return 'landed'
    case 'Failed':
      return 'parked'
    case 'Cleared':
      return 'dropped'
    default:
      return message.payloadStatus === 'Underpaid' ? 'underpaid' : 'inFlight'
  }
}

export type MessagesById = ReadonlyMap<string, readonly CrosschainMessageRow[]>

export function groupMessagesById(messages: readonly CrosschainMessageRow[]): MessagesById {
  const byId = new Map<string, CrosschainMessageRow[]>()
  for (const row of messages) {
    const list = byId.get(row.id) ?? []
    list.push(row)
    byId.set(row.id, list)
  }
  for (const list of byId.values()) list.sort((a, b) => a.index - b.index)
  return byId
}

function stepNameOf(step: number): MigrationStepName | null {
  try {
    return migrationStepName(step)
  } catch {
    return null
  }
}

/**
 * Pairs the relayed steps toward one spoke with the inner messages of their
 * message id by count in hub log order: the k-th relay of one payload is the
 * k-th row of that id.
 */
export function landStepsOfSpoke(
  hubCentrifugeId: CentrifugeId,
  spokeCentrifugeId: CentrifugeId,
  steps: readonly PoolMigrationStepRow[],
  byId: MessagesById
): MigrationStep[] {
  const taken = new Map<string, number>()
  return steps.map((row) => {
    const messageId =
      row.isSameChainStep || !row.hasGatewayPrepareMessage
        ? null
        : getMessageId(hubCentrifugeId, spokeCentrifugeId, row.gatewayMessageHash)
    let message: CrosschainMessageRow | undefined
    if (messageId !== null) {
      const used = taken.get(messageId) ?? 0
      message = byId.get(messageId)?.[used]
      taken.set(messageId, used + 1)
    }
    return {
      step: row.step,
      stepName: stepNameOf(row.step),
      centrifugeId: Number(row.centrifugeId),
      transactionHash: row.transactionHash,
      logIndex: row.logIndex,
      createdAtBlock: row.createdAtBlock,
      createdAt: new Date(row.createdAt),
      payloadHash: row.payloadHash,
      gatewayMessageHash: row.gatewayMessageHash,
      isSameChainStep: row.isSameChainStep,
      landing: landingOf(row, message),
      messageId,
      messageIndex: message?.index ?? null,
      failReason: message?.failReason ?? null,
      executedAtTxHash: message?.executedAtTxHash ?? null,
    }
  })
}

export function countSteps(steps: readonly MigrationStep[]): MigrationStepCounts {
  const counts: MigrationStepCounts = {
    relayed: steps.length,
    landed: 0,
    parked: 0,
    inFlight: 0,
    underpaid: 0,
    dropped: 0,
    unmatched: 0,
  }
  for (const step of steps) {
    switch (step.landing) {
      case 'landed':
        counts.landed += 1
        break
      case 'parked':
        counts.parked += 1
        break
      case 'inFlight':
        counts.inFlight += 1
        break
      case 'underpaid':
        counts.underpaid += 1
        break
      case 'dropped':
        counts.dropped += 1
        break
      case 'unmatched':
        counts.unmatched += 1
        break
    }
  }
  return counts
}

export function messageIdsOf(hubCentrifugeId: CentrifugeId, steps: readonly PoolMigrationStepRow[]): HexString[] {
  const ids = new Set<HexString>()
  for (const row of steps) {
    if (row.isSameChainStep || !row.hasGatewayPrepareMessage) continue
    ids.add(getMessageId(hubCentrifugeId, Number(row.centrifugeId), row.gatewayMessageHash))
  }
  return [...ids]
}

/** The spokes a migration touches: every spoke row plus every chain a step was relayed toward. */
export function spokeIdsOf(row: PoolMigrationRow, steps: readonly PoolMigrationStepRow[]): CentrifugeId[] {
  const ids = new Set<CentrifugeId>(row.spokes.map((spoke) => Number(spoke.centrifugeId)))
  for (const step of steps) ids.add(Number(step.centrifugeId))
  return [...ids].sort((a, b) => a - b)
}

export type FacadeFlags = { restored: boolean | null; freezeGeneration: number | null; error: string | null }

export function assembleMigration(input: {
  row: PoolMigrationRow
  hubPhase: HubPhaseName
  steps: readonly PoolMigrationStepRow[]
  messages: readonly CrosschainMessageRow[]
  facade: ReadonlyMap<CentrifugeId, FacadeFlags>
  /** Spokes the pool is live on that no row or step names yet; listed with no phase and no steps. */
  liveSpokes?: readonly CentrifugeId[]
}): PoolMigration {
  const poolId = new PoolId(input.row.poolId)
  const hubCentrifugeId = poolId.centrifugeId
  const byId = groupMessagesById(input.messages)
  const spokeRows = new Map(input.row.spokes.map((spoke) => [Number(spoke.centrifugeId), spoke]))
  const spokeIds = [...new Set([...spokeIdsOf(input.row, input.steps), ...(input.liveSpokes ?? [])])].sort(
    (a, b) => a - b
  )
  const spokes = spokeIds.map((centrifugeId): MigrationSpoke => {
    const spokeRow = spokeRows.get(centrifugeId)
    const phase = spokeRow ? spokePhaseOfRow(spokeRow.phase) : null
    const freezeGeneration = spokeRow ? Number(spokeRow.freezeGeneration) : 0
    const abortedGeneration = abortedGenerationOfRow(phase, freezeGeneration)
    const stepRows = input.steps.filter((step) => Number(step.centrifugeId) === centrifugeId)
    const steps = landStepsOfSpoke(hubCentrifugeId, centrifugeId, stepRows, byId)
    const flags = input.facade.get(centrifugeId) ?? { restored: null, freezeGeneration: null, error: null }
    return {
      centrifugeId,
      isHubChain: centrifugeId === hubCentrifugeId,
      phase,
      freezeGeneration,
      abortedGeneration,
      maxReservesRestored: flags.restored,
      facadeFreezeGeneration: flags.freezeGeneration,
      facadeReadError: flags.error,
      state:
        input.hubPhase === 'activated' && flags.restored === null
          ? null
          : gateStateOrNull({
              hubPhase: HUB_PHASE[input.hubPhase],
              relayedSteps: steps.filter((step) => step.stepName !== null).map((step) => step.step),
              abortedGeneration,
              expectedFreezeGeneration: flags.freezeGeneration,
              maxReservesRestored: flags.restored ?? false,
            }),
      steps,
      counts: countSteps(steps),
    }
  })
  return {
    migrationId: input.row.migrationId,
    poolId,
    hubCentrifugeId,
    targetVersion: input.row.targetVersion,
    hubPhase: input.hubPhase,
    operator: input.row.operator,
    startedAt: new Date(input.row.startedAt),
    spokes,
  }
}

function gateStateOrNull(input: Parameters<typeof deriveSpokeGateState>[0]): SpokeGateState | null {
  try {
    return deriveSpokeGateState(input)
  } catch (error) {
    if (error instanceof BuilderArgumentMismatchError) return null
    throw error
  }
}

type FacadeRead<T> = { value: T | null; error: string | null }

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

function readOnFacade<T>(
  root: Centrifuge,
  centrifugeId: CentrifugeId,
  read: (client: any, migration: HexString, abi: unknown) => Promise<T>
): Observable<FacadeRead<T>> {
  return defer(() => {
    const chain = resolveMigrationChain(centrifugeId, { environment: root.config.environment })
    return root
      .getClient(centrifugeId)
      .pipe(switchMap((client) => defer(() => read(client, chain.migration, chain.abi))))
  }).pipe(
    map((value) => ({ value, error: null })),
    catchError((error) => {
      console.warn(`Pool migration: facade read on centrifugeId ${centrifugeId} failed`, error)
      return of({ value: null, error: describeError(error) })
    })
  )
}

function readFreezeGenerations(
  root: Centrifuge,
  pool: Pool,
  spokeIds: readonly CentrifugeId[]
): Observable<FacadeRead<number>[]> {
  return readOnFacade<FacadeRead<number>[]>(root, pool.centrifugeId, async (client, migration, abi) => {
    const results: { status: 'success' | 'failure'; result?: unknown; error?: unknown }[] = await client.multicall({
      contracts: spokeIds.map((centrifugeId) => ({
        address: migration,
        abi,
        functionName: 'freezeGeneration',
        args: [pool.id.raw, centrifugeId],
      })),
      allowFailure: true,
    })
    return results.map((result) =>
      result.status === 'success'
        ? { value: Number(result.result), error: null }
        : { value: null, error: describeError(result.error) }
    )
  }).pipe(map((read) => read.value ?? spokeIds.map(() => ({ value: null, error: read.error }))))
}

/**
 * What the facade says about each spoke: the hub's freeze generation toward
 * it (one multicall on the hub chain, always) and whether its max reserves
 * are restored (read on the spoke chain, only once the hub activated). A read
 * that fails answers null for that spoke with the error beside it, logs a
 * warning, and leaves the others intact.
 */
export function readFacadeFlags(
  root: Centrifuge,
  pool: Pool,
  hubPhase: HubPhaseName,
  spokeIds: readonly CentrifugeId[]
): Observable<ReadonlyMap<CentrifugeId, FacadeFlags>> {
  if (hubPhase === 'none' || spokeIds.length === 0) return of(new Map())
  const restored$ = combineLatest(
    spokeIds.map((centrifugeId) =>
      hubPhase === 'activated'
        ? readOnFacade<boolean>(root, centrifugeId, async (client, migration, abi) =>
            Boolean(
              await client.readContract({
                address: migration,
                abi,
                functionName: 'maxReservesRestored',
                args: [pool.id.raw],
              })
            )
          )
        : of<FacadeRead<boolean>>({ value: null, error: null })
    )
  )
  return combineLatest([readFreezeGenerations(root, pool, spokeIds), restored$]).pipe(
    map(
      ([generations, restored]) =>
        new Map(
          spokeIds.map((centrifugeId, index) => [
            centrifugeId,
            {
              freezeGeneration: generations[index]!.value,
              restored: restored[index]!.value,
              error: generations[index]!.error ?? restored[index]!.error,
            },
          ])
        )
    )
  )
}

type InvestOrders = Awaited<ReturnType<ShareClass['_investOrders']>>
type RedeemOrders = Awaited<ReturnType<ShareClass['_redeemOrders']>>
export type DrainInvestOrders = Pick<
  InvestOrders,
  'epochOutstandingInvests' | 'epochInvestOrders' | 'pendingInvestOrders'
>
export type DrainRedeemOrders = Pick<RedeemOrders, 'epochOutstandingRedeems' | 'pendingRedeemOrders'>

/**
 * The pending and queued orders of one share class on one spoke, from the
 * order rows themselves rather than the linked vaults, so a vault the
 * offboard already unlinked still shows what has not settled.
 */
export function drainItemsOf(
  centrifugeId: CentrifugeId,
  shareClassId: HexString,
  invest: DrainInvestOrders,
  redeem: DrainRedeemOrders,
  assetDecimals: ReadonlyMap<string, number> = new Map()
): MigrationDrainItem[] {
  const byAsset = new Map<string, MigrationDrainItem>()
  const fromOrders = assetDecimalsByAssetId(invest.epochInvestOrders, invest.epochOutstandingInvests)
  const decimalsOf = (assetId: string) => assetDecimals.get(assetId) ?? fromOrders(assetId, 18)
  const item = (assetId: AssetId): MigrationDrainItem => {
    const key = assetId.toString()
    const existing = byAsset.get(key)
    if (existing) return existing
    const assetDecimals = decimalsOf(key)
    const created: MigrationDrainItem = {
      centrifugeId,
      shareClassId,
      assetId,
      pendingDeposit: new Balance(0n, assetDecimals),
      pendingRedeem: new Balance(0n, 18),
      queuedInvest: new Balance(0n, assetDecimals),
      queuedRedeem: new Balance(0n, 18),
    }
    byAsset.set(key, created)
    return created
  }
  for (const order of invest.epochOutstandingInvests) {
    if (order.centrifugeId !== centrifugeId) continue
    item(order.assetId).pendingDeposit = order.pendingAmount
  }
  for (const order of invest.pendingInvestOrders) {
    if (order.centrifugeId !== centrifugeId) continue
    const current = item(order.assetId)
    current.queuedInvest = current.queuedInvest.add(new Balance(order.queuedAmount, current.queuedInvest.decimals))
  }
  for (const order of redeem.epochOutstandingRedeems) {
    if (order.centrifugeId !== centrifugeId) continue
    item(order.assetId).pendingRedeem = order.pendingAmount
  }
  for (const order of redeem.pendingRedeemOrders) {
    if (order.centrifugeId !== centrifugeId) continue
    const current = item(order.assetId)
    current.queuedRedeem = current.queuedRedeem.isZero()
      ? order.queuedAmount
      : current.queuedRedeem.add(order.queuedAmount)
  }
  return [...byAsset.values()].filter(
    (entry) =>
      !entry.pendingDeposit.isZero() ||
      !entry.pendingRedeem.isZero() ||
      !entry.queuedInvest.isZero() ||
      !entry.queuedRedeem.isZero()
  )
}

export type MigrationOperation =
  | { name: 'initiateMigration'; args?: Record<never, never> }
  | { name: 'installPoolAdapters'; args: { centrifugeId: CentrifugeId; signOn: 'hub' | 'spoke' } }
  | { name: 'relayArm'; args: { spokeCentrifugeIds: CentrifugeId[]; value?: bigint } }
  | {
      name: 'relayFreeze'
      args: Omit<RelayFreezeArgs, 'poolId' | 'refundAddress' | 'value' | 'centrifugeId'> & {
        centrifugeId: CentrifugeId
        value?: bigint
      }
    }
  | {
      name: 'relayAbort'
      args: Omit<RelayAbortArgs, 'poolId' | 'refundAddress' | 'value' | 'centrifugeId'> & {
        centrifugeId: CentrifugeId
        value?: bigint
      }
    }
  | {
      name: 'relayOffboard'
      args: Omit<RelayOffboardArgs, 'poolId' | 'refundAddress' | 'value' | 'centrifugeId'> & {
        centrifugeId: CentrifugeId
        value?: bigint
      }
    }
  | { name: 'onboardHub'; args: Omit<OnboardHubArgs, 'poolId' | 'refundAddress' | 'value'> & { value?: bigint } }
  | {
      name: 'relayOnboardSpoke'
      args: Omit<RelayOnboardSpokeArgs, 'poolId' | 'refundAddress' | 'value' | 'centrifugeId'> & {
        centrifugeId: CentrifugeId
        value?: bigint
      }
    }
  | {
      name: 'activate'
      args: Omit<ActivateArgs, 'poolId' | 'refundAddress' | 'value'> & {
        spokeCentrifugeIds: CentrifugeId[]
        value?: bigint
      }
    }
  | { name: 'forceRelease'; args?: Record<never, never> }
  | { name: 'lock'; args: LockArgs & { centrifugeId: CentrifugeId } }

/** How {@link Pool.migrationStep} and {@link Pool.migrationBundle} send. */
export type MigrationSendOptions = {
  /** The gas limit the transaction declares; without it the wallet estimates. Batching and `buildOnly` ignore it. */
  gas?: bigint
}

export type MigrationOperationName = MigrationOperation['name']

/** The chain the operation is signed on. */
export function migrationOperationChain(poolId: PoolId, operation: MigrationOperation): CentrifugeId {
  switch (operation.name) {
    case 'lock':
      return operation.args.centrifugeId
    case 'installPoolAdapters':
      return operation.args.signOn === 'spoke' ? operation.args.centrifugeId : poolId.centrifugeId
    default:
      return poolId.centrifugeId
  }
}

/** The cross-chain relays the operation pays for, keyed by destination. */
export function migrationOperationMessages(
  poolId: PoolId,
  operation: MigrationOperation,
  armedSpokes: readonly CentrifugeId[] = []
): Record<CentrifugeId, MessageTypeWithSubType[]> {
  const relay = (): MessageTypeWithSubType => messageV3_3(MessageTypeV3_3.ManagerCallFromHub, poolId)
  const toward = (ids: readonly CentrifugeId[]) =>
    Object.fromEntries(ids.filter((id) => id !== poolId.centrifugeId).map((id) => [id, [relay()]]))
  switch (operation.name) {
    case 'relayArm':
      return toward(operation.args.spokeCentrifugeIds)
    case 'relayFreeze':
    case 'relayAbort':
    case 'relayOffboard':
    case 'relayOnboardSpoke':
      return toward([operation.args.centrifugeId])
    case 'activate':
      return toward(operation.args.spokeCentrifugeIds)
    case 'onboardHub':
      return toward(armedSpokes)
    default:
      return {}
  }
}

/** The facade call of one operation, built with the protocol package's builders. */
export function buildMigrationOperation(input: {
  environment: ChainEnvironment
  poolId: PoolId
  signedOn: CentrifugeId
  refundAddress: HexString
  operation: MigrationOperation
}): BuiltProtocolCall {
  const poolId = input.poolId.raw.toString()
  const { operation } = input
  const ctx = resolveMigrationContext(poolId, { environment: input.environment, centrifugeId: input.signedOn })
  const value = (v: bigint | undefined) => (v === undefined ? {} : { value: v.toString() })
  switch (operation.name) {
    case 'initiateMigration':
      return migrationBuilders.initiateMigration(ctx, { poolId } satisfies PoolArgs)
    case 'installPoolAdapters':
      // `centrifugeId` names the lane's spoke; signed on the spoke, the lane's other end is the hub.
      return migrationBuilders.installPoolAdapters(ctx, {
        poolId,
        centrifugeId: String(
          operation.args.signOn === 'spoke' ? input.poolId.centrifugeId : operation.args.centrifugeId
        ),
      } satisfies InstallPoolAdaptersArgs)
    case 'relayArm':
      return migrationBuilders.relayArm(ctx, {
        poolId,
        spokeCentrifugeIds: operation.args.spokeCentrifugeIds.map(String),
        refundAddress: input.refundAddress,
        ...value(operation.args.value),
      } satisfies RelayArmArgs)
    case 'relayFreeze':
      return migrationBuilders.relayFreeze(ctx, {
        poolId,
        centrifugeId: String(operation.args.centrifugeId),
        syncReserves: operation.args.syncReserves,
        extraGasLimit: operation.args.extraGasLimit,
        refundAddress: input.refundAddress,
        ...value(operation.args.value),
      })
    case 'relayAbort':
      return migrationBuilders.relayAbort(ctx, {
        poolId,
        centrifugeId: String(operation.args.centrifugeId),
        extraGasLimit: operation.args.extraGasLimit,
        refundAddress: input.refundAddress,
        ...value(operation.args.value),
      })
    case 'relayOffboard':
      return migrationBuilders.relayOffboard(ctx, {
        poolId,
        centrifugeId: String(operation.args.centrifugeId),
        input: operation.args.input,
        refundAddress: input.refundAddress,
        ...value(operation.args.value),
      })
    case 'onboardHub':
      return migrationBuilders.onboardHub(ctx, {
        poolId,
        input: operation.args.input,
        refundAddress: input.refundAddress,
        ...value(operation.args.value),
      })
    case 'relayOnboardSpoke':
      return migrationBuilders.relayOnboardSpoke(ctx, {
        poolId,
        centrifugeId: String(operation.args.centrifugeId),
        input: operation.args.input,
        refundAddress: input.refundAddress,
        ...value(operation.args.value),
      })
    case 'activate':
      return migrationBuilders.activate(ctx, {
        poolId,
        restoreGas: operation.args.restoreGas,
        refundAddress: input.refundAddress,
        ...value(operation.args.value),
      })
    case 'forceRelease':
      return migrationBuilders.forceRelease(ctx, { poolId })
    case 'lock':
      return migrationBuilders.lock(ctx, { allSpokesQuiescent: operation.args.allSpokesQuiescent })
  }
}

/**
 * The facade's `multicall` over hub operations already built and priced: each entry runs as its own
 * call with its own value, the entries' values must sum to `msg.value`, and a failing entry reverts
 * the bundle. The entries carry no target, so every one must be a facade call on the hub.
 */
export function encodeMigrationBundle(input: {
  environment: ChainEnvironment
  poolId: PoolId
  entries: readonly { data: HexString; value: bigint }[]
}): { to: HexString; data: HexString; value: bigint } {
  const ctx = resolveMigrationContext(input.poolId.raw.toString(), {
    environment: input.environment,
    centrifugeId: input.poolId.centrifugeId,
  })
  const data = encodeFunctionData({
    abi: ctx.abi,
    functionName: 'multicall',
    args: [input.entries.map(({ data, value }) => ({ data, value }))],
  })
  return { to: ctx.migration, data, value: input.entries.reduce((sum, entry) => sum + entry.value, 0n) }
}

/**
 * A revert the simulation could not decode, named from the protocol's errors: the simulation is given no ABI, so a
 * revert from a contract the facade calls, such as the Gateway's `NotEnoughGas()`, arrives as a bare selector.
 * @internal
 */
export function namedRevert(reason: unknown): Error | undefined {
  if (!(reason instanceof BaseError)) return undefined
  const revert = reason.walk((error) => error instanceof ContractFunctionRevertedError)
  if (!(revert instanceof ContractFunctionRevertedError) || revert.data?.errorName) return undefined
  const data = revert.raw ?? revert.signature
  if (!data) return undefined
  const name = protocolErrorName(data)
  return name ? new Error(name) : undefined
}

export class MigrationSimulationError extends Error {
  override name = 'MigrationSimulationError'
  /** The revert, named from the protocol's errors when the simulation left it a bare selector. */
  readonly reason: unknown
  constructor(
    /** The failing operation, or `multicall` when every entry passes alone and the bundle fails. */
    readonly operation: MigrationOperationName | 'multicall',
    reason: unknown,
    /** The failing entry's 1-based place in a bundle of `count`. */
    readonly position?: { index: number; count: number }
  ) {
    const named = namedRevert(reason) ?? reason
    const where = position ? ` (entry ${position.index} of ${position.count} in the bundle)` : ''
    super(
      `Migration operation ${operation}${where} fails in simulation: ${named instanceof Error ? named.message : String(named)}`
    )
    this.reason = named
  }
}

export type MigrationRecordWorklistItem = {
  centrifugeId: CentrifugeId
  shareClassId: HexString
  assetId: string
  pendingDeposit: string
  pendingRedeem: string
  queuedInvest: string
  queuedRedeem: string
}

/** One unsigned record pinned at a point of no return: a first offboard toward a spoke, or the hub onboard. */
export type MigrationRecord = {
  poolId: string
  centrifugeId: CentrifugeId
  step:
    Extract<MigrationStepName, 'unlinkVaults' | 'rotateAssets' | 'removeManagers' | 'finalizeOffboard'> | 'onboardHub'
  worklist: MigrationRecordWorklistItem[]
  acceptance: { operator: HexString; acceptedAt: string }
  overrides: Record<string, unknown>
  planInputBlocks: Record<string, number>
}

export function migrationRecordName(environment: ChainEnvironment, poolId: PoolId): string {
  return `${environment}-migration-${poolId.raw.toString()}`
}

export function worklistSnapshot(items: readonly MigrationDrainItem[]): MigrationRecordWorklistItem[] {
  return items.map((item) => ({
    centrifugeId: item.centrifugeId,
    shareClassId: item.shareClassId,
    assetId: item.assetId.raw.toString(),
    pendingDeposit: item.pendingDeposit.toBigInt().toString(),
    pendingRedeem: item.pendingRedeem.toBigInt().toString(),
    queuedInvest: item.queuedInvest.toBigInt().toString(),
    queuedRedeem: item.queuedRedeem.toBigInt().toString(),
  }))
}
