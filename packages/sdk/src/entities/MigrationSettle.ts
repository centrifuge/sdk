import {
  ABIS_V3_3,
  MessageTypeV3_3,
  MIGRATION_STEP,
  V33_MIGRATION_ABI_V3_3,
  type MigrationStepName,
} from '@centrifuge/protocol'
import { decodeAbiParameters, keccak256, toFunctionSelector, type Abi, type AbiFunction } from 'viem'
import type { HexString } from '../types/index.js'
import type { CentrifugeId, PoolId } from '../utils/types.js'

/**
 * The settle step, as `MigrationSettle.sol` decides it: the pool's own parked messages on one remote spoke,
 * each classified by the refusal a retry meets now, and the retries that land, found by simulation in the
 * hub's send order. Input is what the spoke's MultiAdapter executed, so the run needs no log scan of its own
 * and is testable against a scripted driver.
 */

export type SettleKind =
  | 'Arm'
  | 'Freeze'
  | 'Abort'
  | 'UnlinkVaults'
  | 'RotateAssets'
  | 'RemoveManagers'
  | 'FinalizeOffboard'
  | 'NotifyPool'
  | 'UpdateManager'
  | 'LinkTokens'
  | 'SeedShareQueue'
  | 'NotifyPricePoolPerShare'
  | 'CopyAssetPrice'
  | 'RegisterVaults'
  | 'UpdateVault'
  | 'ConfigureVaults'
  | 'SetupRamps'
  | 'RampGrant'
  | 'RampConfig'
  | 'AssertRampConfig'
  | 'AssertHookManagers'
  | 'UpdateHookManager'
  | 'SeedEscrow'
  | 'AssertSpokeManagers'
  | 'FinalizeOnboard'
  | 'SetRequestManager'
  | 'RestoreMaxReserves'
  | 'Other'

/** The hub's send order, which is the order settle retries in. */
export const SETTLE_KIND_ORDER: readonly SettleKind[] = [
  'Arm',
  'Freeze',
  'Abort',
  'UnlinkVaults',
  'RotateAssets',
  'RemoveManagers',
  'FinalizeOffboard',
  'NotifyPool',
  'UpdateManager',
  'LinkTokens',
  'SeedShareQueue',
  'NotifyPricePoolPerShare',
  'CopyAssetPrice',
  'RegisterVaults',
  'UpdateVault',
  'ConfigureVaults',
  'SetupRamps',
  'RampGrant',
  'RampConfig',
  'AssertRampConfig',
  'AssertHookManagers',
  'UpdateHookManager',
  'SeedEscrow',
  'AssertSpokeManagers',
  'FinalizeOnboard',
  'SetRequestManager',
  'RestoreMaxReserves',
  'Other',
]

/**
 * `waiting` lands now or waits on a predecessor; `dead` is refused by a guard that never reopens; `blocking` is a
 * counted step refused for good, which the phase cannot close around; `dormant` is live for anyone to land later,
 * which is not the plan's to do now.
 */
export type SettleClass = 'waiting' | 'dead' | 'blocking' | 'dormant'

export type SettleBatch = { payload: HexString; blockNumber: bigint | null }

export type SettleMessage = {
  batch: number
  index: number
  data: HexString
  hash: HexString
  kind: SettleKind
  /** A `ManagerCallFromHub` addressed to the migration contract, whose payload leads with the step. */
  isStep: boolean
  step: number | null
  stepName: MigrationStepName | null
  payload: HexString | null
}

export type SettlePark = {
  message: SettleMessage
  class: SettleClass
  /** The refusal the last simulated retry met; for a park that landed, the one before it did, if any. */
  refusal: HexString
  /** The pass whose simulated retry landed it, 0 for none. */
  pass: number
  /** An Abort's, which is never retried: whether its retry would land now, read before any other retry. */
  wouldLand: boolean
  /** A Freeze or offboard step stamped at or below a live parked Abort's generation, never retried either. */
  held: boolean
  /** A Link refused because its vault is linked already: its effect holds, so it is classed dead. */
  duplicate: boolean
  action: string
}

export type SettleReport = {
  centrifugeId: CentrifugeId
  batches: number
  messages: number
  fromBlock: bigint | null
  toBlock: bigint | null
  /** A `NotifyPool` is in scope: `onboardHub` was sent. */
  onboardHubSent: boolean
  /** The activate batch is in scope, the last one settle reads. */
  activated: boolean
  /** In retry order: kind, then batch, then message. */
  parks: SettlePark[]
  /** Indices into `parks`, in the order their retries landed in the simulation, which is the order to send. */
  retries: number[]
  passes: number
  waiting: number
  dead: number
  blocking: number
  dormant: number
}

export type SettleContext = {
  poolId: PoolId
  hubCentrifugeId: CentrifugeId
  spokeCentrifugeId: CentrifugeId
  /** The spoke's v3.3 Gateway, which counts the parks and retries them. */
  gateway: HexString
  /** One address on every chain. */
  migration: HexString
  /** The spoke's v3.3 AccountingToken, the target of a ramp's minter grant; null where the chain records none. */
  accountingToken: HexString | null
}

export interface SettleDriver {
  paused(): Promise<boolean>
  failedMessages(hash: HexString): Promise<number>
  spokePhase(): Promise<number>
  frozenGeneration(): Promise<number>
  /** Simulates `Gateway.retry(hub, message)` after the retries in `after`, in order; the result is the last call's. */
  retry(message: HexString, after: readonly HexString[]): Promise<{ ok: boolean; revert: HexString }>
}

export class MigrationSettleError extends Error {
  override name = 'MigrationSettleError'
}

// ---------------------------------------------------------------------------------------------------
// Messages: `MessageLib` lengths and the step carried by a manager call
// ---------------------------------------------------------------------------------------------------

const BASE_LENGTH: Readonly<Record<number, number>> = {
  [MessageTypeV3_3.ScheduleUpgrade]: 33,
  [MessageTypeV3_3.CancelUpgrade]: 33,
  [MessageTypeV3_3.RegisterAsset]: 18,
  [MessageTypeV3_3.SetPoolAdapters]: 14,
  [MessageTypeV3_3.NotifyPool]: 9,
  [MessageTypeV3_3.NotifyShareClass]: 250 + 16,
  [MessageTypeV3_3.NotifyPricePoolPerShare]: 49,
  [MessageTypeV3_3.NotifyPricePoolPerAsset]: 65,
  [MessageTypeV3_3.NotifyShareMetadata]: 185 + 16,
  [MessageTypeV3_3.InitiateTransferShares]: 139,
  [MessageTypeV3_3.ExecuteTransferShares]: 89,
  [MessageTypeV3_3.UpdateRestriction]: 41,
  [MessageTypeV3_3.UpdateVault]: 90,
  [MessageTypeV3_3.UpdateAssets]: 91,
  [MessageTypeV3_3.UpdateShares]: 75,
  [MessageTypeV3_3.Request]: 57,
  [MessageTypeV3_3.RequestCallback]: 57,
  [MessageTypeV3_3.SetRequestManager]: 41,
  [MessageTypeV3_3.ManagerCallFromSpoke]: 89,
  [MessageTypeV3_3.ManagerCallFromHub]: 57,
  [MessageTypeV3_3.UpdateManager]: 43,
  [MessageTypeV3_3.SetPolicy]: 41,
  [MessageTypeV3_3.AuthorizeSpokeCall]: 9,
  [MessageTypeV3_3.UnauthorizeSpokeCall]: 9,
}

const WITH_PAYLOAD = new Set<number>([
  MessageTypeV3_3.NotifyShareClass,
  MessageTypeV3_3.UpdateRestriction,
  MessageTypeV3_3.UpdateVault,
  MessageTypeV3_3.ManagerCallFromHub,
  MessageTypeV3_3.ManagerCallFromSpoke,
  MessageTypeV3_3.Request,
  MessageTypeV3_3.RequestCallback,
  MessageTypeV3_3.AuthorizeSpokeCall,
  MessageTypeV3_3.UnauthorizeSpokeCall,
])

function byteAt(hex: HexString, offset: number): number {
  return parseInt(hex.slice(2 + offset * 2, 4 + offset * 2), 16)
}

function uint16At(hex: HexString, offset: number): number {
  return parseInt(hex.slice(2 + offset * 2, 2 + offset * 2 + 4), 16)
}

function slice(hex: HexString, offset: number, length: number): HexString {
  return `0x${hex.slice(2 + offset * 2, 2 + (offset + length) * 2)}` as HexString
}

function byteLength(hex: HexString): number {
  return (hex.length - 2) / 2
}

/** `MessageLib.messageLength`: the bytes the message at the head of `remaining` spans, on v3.3 ordinals. */
export function messageLength(remaining: HexString): number {
  const kind = byteAt(remaining, 0)
  const base = BASE_LENGTH[kind]
  if (kind === MessageTypeV3_3._Invalid || base === undefined) {
    throw new MigrationSettleError(`unknown message type ${kind} in a batch`)
  }
  if (WITH_PAYLOAD.has(kind)) return base + 2 + uint16At(remaining, base)
  if (kind === MessageTypeV3_3.SetPoolAdapters) return base + uint16At(remaining, 12) * 32
  return base
}

/** The messages of one executed batch, in order; `payload` is the gateway's view, without the 2-byte session prefix. */
export function splitBatch(payload: HexString): HexString[] {
  const messages: HexString[] = []
  let offset = 0
  const total = byteLength(payload)
  while (offset < total) {
    const remaining = slice(payload, offset, total - offset)
    const length = messageLength(remaining)
    if (offset + length > total) throw new MigrationSettleError('a batch ends inside its last message')
    messages.push(slice(payload, offset, length))
    offset += length
  }
  return messages
}

/** The MultiAdapter's wrapped payload less its 2-byte session id, which is what the gateway handles. */
export function unwrapExecutePayload(wrapped: HexString): HexString {
  return byteLength(wrapped) <= 2 ? '0x' : slice(wrapped, 2, byteLength(wrapped) - 2)
}

/** `MessageLib.messagePoolId`: the pool a message carries at offset 1, 0 for a pool-independent one. */
export function messagePoolId(message: HexString): bigint {
  const kind = byteAt(message, 0)
  if (kind === MessageTypeV3_3.SetPoolAdapters || kind >= MessageTypeV3_3.NotifyPool)
    return BigInt(slice(message, 1, 8))
  return 0n
}

/** `CastLib.toAddress`: the first 20 bytes of the bytes32 target at offset 9. */
function managerCallTarget(message: HexString): HexString {
  return `0x${message.slice(2 + 9 * 2, 2 + 9 * 2 + 40)}` as HexString
}

function managerCallPayload(message: HexString): HexString {
  const length = uint16At(message, 57)
  return slice(message, 59, length)
}

/** @internal */
export function stepOf(ctx: SettleContext, message: HexString): { isStep: boolean; step: number; payload: HexString } {
  if (byteAt(message, 0) !== MessageTypeV3_3.ManagerCallFromHub) return { isStep: false, step: 0, payload: '0x' }
  const payload = managerCallPayload(message)
  if (!sameAddress(managerCallTarget(message), ctx.migration) || byteLength(payload) < 32) {
    return { isStep: false, step: 0, payload: '0x' }
  }
  return { isStep: true, step: Number(BigInt(slice(payload, 0, 32))), payload }
}

function stampedGeneration(payload: HexString): number {
  const [, generation] = decodeAbiParameters([{ type: 'uint8' }, { type: 'uint32' }], payload)
  return Number(generation)
}

const STEP_KIND: Readonly<Record<number, SettleKind>> = {
  [MIGRATION_STEP.arm]: 'Arm',
  [MIGRATION_STEP.freeze]: 'Freeze',
  [MIGRATION_STEP.abort]: 'Abort',
  [MIGRATION_STEP.unlinkVaults]: 'UnlinkVaults',
  [MIGRATION_STEP.rotateAssets]: 'RotateAssets',
  [MIGRATION_STEP.removeManagers]: 'RemoveManagers',
  [MIGRATION_STEP.finalizeOffboard]: 'FinalizeOffboard',
  [MIGRATION_STEP.linkTokens]: 'LinkTokens',
  [MIGRATION_STEP.registerVaults]: 'RegisterVaults',
  [MIGRATION_STEP.configureVaults]: 'ConfigureVaults',
  [MIGRATION_STEP.seedEscrow]: 'SeedEscrow',
  [MIGRATION_STEP.seedShareQueue]: 'SeedShareQueue',
  [MIGRATION_STEP.finalizeOnboard]: 'FinalizeOnboard',
  [MIGRATION_STEP.restoreMaxReserves]: 'RestoreMaxReserves',
  [MIGRATION_STEP.setupRamps]: 'SetupRamps',
  [MIGRATION_STEP.assertHookManagers]: 'AssertHookManagers',
  [MIGRATION_STEP.copyAssetPrice]: 'CopyAssetPrice',
  [MIGRATION_STEP.assertSpokeManagers]: 'AssertSpokeManagers',
  [MIGRATION_STEP.assertRampConfig]: 'AssertRampConfig',
}

const STEP_NAMES = Object.entries(MIGRATION_STEP) as [MigrationStepName, number][]

function stepName(step: number): MigrationStepName | null {
  return STEP_NAMES.find(([, value]) => value === step)?.[0] ?? null
}

/**
 * One message's kind. `onboardHub`'s batch carries no step, which is what tells its manager grants from a ramp's;
 * a manager call that is neither a step nor the minter grant is a ramp config when its leading word is a config
 * kind, and a hook-manager grant when it leads with a share class id.
 * @internal
 */
export function classifyMessage(
  ctx: SettleContext,
  data: HexString,
  carriesStep: boolean
): Omit<SettleMessage, 'batch' | 'index'> {
  const base = { data, hash: keccak256(data) as HexString, isStep: false, step: null, stepName: null, payload: null }
  const kind = byteAt(data, 0)
  switch (kind) {
    case MessageTypeV3_3.NotifyPool:
      return { ...base, kind: 'NotifyPool' }
    case MessageTypeV3_3.UpdateManager:
      return { ...base, kind: carriesStep ? 'RampGrant' : 'UpdateManager' }
    case MessageTypeV3_3.NotifyPricePoolPerShare:
      return { ...base, kind: 'NotifyPricePoolPerShare' }
    case MessageTypeV3_3.UpdateVault:
      return { ...base, kind: 'UpdateVault' }
    case MessageTypeV3_3.SetRequestManager:
      return { ...base, kind: 'SetRequestManager' }
    case MessageTypeV3_3.ManagerCallFromHub: {
      const { isStep, step, payload } = stepOf(ctx, data)
      if (isStep)
        return { ...base, kind: STEP_KIND[step] ?? 'Other', isStep: true, step, stepName: stepName(step), payload }
      const target = managerCallTarget(data)
      const callPayload = managerCallPayload(data)
      if (ctx.accountingToken && sameAddress(target, ctx.accountingToken)) return { ...base, kind: 'RampGrant' }
      if (byteLength(callPayload) >= 32) {
        const lead = BigInt(slice(callPayload, 0, 32))
        return { ...base, kind: lead <= 0xffn ? 'RampConfig' : lead >> 128n !== 0n ? 'UpdateHookManager' : 'Other' }
      }
      return { ...base, kind: 'Other' }
    }
    default:
      return { ...base, kind: 'Other' }
  }
}

function sameAddress(a: HexString, b: HexString): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

// ---------------------------------------------------------------------------------------------------
// Scope and the relayed cross-check
// ---------------------------------------------------------------------------------------------------

function carries(
  ctx: SettleContext,
  messages: readonly HexString[]
): { arm: boolean; restore: boolean; step: boolean } {
  let arm = false
  let restore = false
  let step = false
  for (const message of messages) {
    const found = stepOf(ctx, message)
    if (!found.isStep) continue
    step = true
    if (found.step === MIGRATION_STEP.arm) arm = true
    if (found.step === MIGRATION_STEP.restoreMaxReserves) restore = true
  }
  return { arm, restore, step }
}

/**
 * The pool's batches, in order, from the first that carries the Arm up to and including the first that carries
 * `RestoreMaxReserves`; earlier pool traffic on the v3.3 gateway (the lane install) is not migration traffic. The
 * Arm is the positive control: a set that holds none of the pool's batches is far more often a source answered short than a
 * spoke with nothing parked, and the two must not read alike.
 * @internal
 */
export function scopeBatches(ctx: SettleContext, found: readonly (SettleBatch | null)[], range: string): SettleBatch[] {
  const kept: SettleBatch[] = []
  let armSeen = false
  let unparsed = 0
  for (const batch of found) {
    if (batch === null) {
      if (armSeen) unparsed++
      continue
    }
    if (byteLength(batch.payload) === 0) continue
    const messages = splitBatch(batch.payload)
    if (messages.length === 0 || messagePoolId(messages[0]!) !== ctx.poolId.raw) continue
    const { arm, restore } = carries(ctx, messages)
    armSeen = armSeen || arm
    if (!armSeen) continue
    kept.push(batch)
    if (restore) break
  }
  if (unparsed !== 0) {
    throw new MigrationSettleError(
      `[GAP] ${unparsed} executed payload(s) toward cid ${ctx.spokeCentrifugeId} after the Arm carry no batch the message table can split, so the parks cannot be counted`
    )
  }
  if (!armSeen) {
    throw new MigrationSettleError(
      `[GAP] no batch carrying pool ${ctx.poolId.raw}'s Arm step among the ${found.length} executed batch(es) from cid ${ctx.hubCentrifugeId} in ${range}. This is not 'nothing parked': the source answered short of the block relayArm landed in`
    )
  }
  return kept
}

function stepHashes(ctx: SettleContext, batches: readonly SettleBatch[]): HexString[] {
  const hashes: HexString[] = []
  for (const batch of batches) {
    for (const message of splitBatch(batch.payload)) {
      const found = stepOf(ctx, message)
      if (found.isStep) hashes.push(keccak256(found.payload) as HexString)
    }
  }
  return hashes
}

function missing(
  wanted: readonly HexString[],
  held: readonly HexString[]
): { missing: number; first: HexString | null; copy: boolean } {
  const taken = new Array<boolean>(held.length).fill(false)
  let count = 0
  let first: HexString | null = null
  let copy = false
  for (const value of wanted) {
    let any = false
    let found = false
    for (let i = 0; i < held.length; i++) {
      if (held[i]!.toLowerCase() !== value.toLowerCase()) continue
      any = true
      if (taken[i]) continue
      taken[i] = true
      found = true
      break
    }
    if (found) continue
    if (count === 0) {
      first = value
      copy = any
    }
    count++
  }
  return { missing: count, first, copy }
}

/**
 * Refuses a scope whose steps are not the steps the hub relayed toward the spoke: each side is the other's
 * positive control. Counted copy for copy, since a re-sent copy still in flight can land after the admins hold
 * the pool. Returns the gap, or null when both sides agree.
 * @internal
 */
export function relayedGap(
  ctx: SettleContext,
  batches: readonly SettleBatch[],
  relayed: readonly HexString[],
  range: string
): string | null {
  const executed = stepHashes(ctx, batches)
  const notExecuted = missing(relayed, executed)
  if (notExecuted.missing !== 0) {
    return `[GAP] the hub relayed ${notExecuted.missing} step(s) toward this spoke that no batch in ${range} carries, the first with payload hash ${notExecuted.first}${notExecuted.copy ? ': a re-sent copy of a step that executed, still in flight' : ': a batch still in flight'}, so wait for it to execute (deliver a [MANUAL] one by hand) and read again`
  }
  const notRelayed = missing(executed, relayed)
  if (notRelayed.missing !== 0) {
    return `[GAP] ${notRelayed.missing} step(s) executed in ${range} are not in the hub's StepRelayed records toward this spoke, the first with payload hash ${notRelayed.first}: the hub record came back short`
  }
  return null
}

// ---------------------------------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------------------------------

/** @internal */
export function errorSelectors(abi: Abi, names: readonly string[]): HexString[] {
  return names.map((name) => {
    const item = abi.find((entry) => entry.type === 'error' && entry.name === name)
    if (!item || item.type !== 'error') throw new MigrationSettleError(`error ${name} is not in the ABI`)
    return toFunctionSelector({
      ...item,
      type: 'function',
      outputs: [],
      stateMutability: 'view',
    } as AbiFunction) as HexString
  })
}

const FACADE_ABI = V33_MIGRATION_ABI_V3_3 as unknown as Abi
const REGISTRY_ABI = ABIS_V3_3.SpokeRegistry as unknown as Abi
const GATEWAY_ABI = ABIS_V3_3.Gateway as unknown as Abi

const facade = (name: string) => errorSelectors(FACADE_ABI, [name])[0]!
const registry = (name: string) => errorSelectors(REGISTRY_ABI, [name])[0]!

const WRONG_SPOKE_PHASE = facade('WrongSpokePhase')
const STALE_FREEZE_GENERATION = facade('StaleFreezeGeneration')
const OFFBOARD_ALREADY_STARTED = facade('OffboardAlreadyStarted')
const RAMP_ASSET_NOT_REGISTERED = facade('RampAssetNotRegistered')
const ALREADY_LINKED_VAULT = registry('AlreadyLinkedVault')
const GATEWAY_PAUSED = errorSelectors(GATEWAY_ABI, ['Paused'])[0]!
const CANNOT_SET_OLDER_PRICE = registry('CannotSetOlderPrice')

const STEP_EARLY = new Set(
  errorSelectors(FACADE_ABI, [
    'CountersIncomplete',
    'ShareTokenNotLinked',
    'HookNotRecorded',
    'SpokeManagerNotGranted',
    'RampConfigNotApplied',
    'SpokeManagersNotAsserted',
    'EscrowNotSeeded',
    'RampAssetNotRegistered',
  ])
)
const REGISTRY_EARLY = new Set(errorSelectors(REGISTRY_ABI, ['InvalidPool', 'ShareTokenDoesNotExist', 'UnknownVault']))
const ONE_SHOT = new Set(
  errorSelectors(FACADE_ABI, [
    'TokenAlreadyLinked',
    'ShareQueueAlreadySeeded',
    'EscrowAlreadySeeded',
    'AssetPriceAlreadyCopied',
    'VaultAlreadyConfigured',
    'RampAlreadySetup',
    'RampConfigAlreadyAsserted',
    'HookGrantsAlreadyAsserted',
    'SpokeManagersAlreadyAsserted',
    'MaxReservesAlreadyRestored',
    'AssetAlreadyRotated',
  ])
)

const ERROR_NAMES: ReadonlyMap<string, string> = new Map([
  ...FACADE_ABI.filter((item) => item.type === 'error').map(
    (item) => [facade(item.name), `V33Migration.${item.name}`] as const
  ),
  ...REGISTRY_ABI.filter((item) => item.type === 'error').map(
    (item) => [registry(item.name), `SpokeRegistry.${item.name}`] as const
  ),
  ...GATEWAY_ABI.filter((item) => item.type === 'error').map(
    (item) => [errorSelectors(GATEWAY_ABI, [item.name])[0]!, `IGateway.${item.name}`] as const
  ),
])

const SPOKE_NONE = 0
const SPOKE_ARMED = 1
const SPOKE_FROZEN = 2
const SPOKE_OFFBOARDED = 3
const SPOKE_ONBOARDED = 4

const selectorOf = (refusal: HexString): HexString | null =>
  byteLength(refusal) >= 4 ? (refusal.slice(0, 10) as HexString) : null

/** @internal */
export function describeSettleRevert(refusal: HexString): string {
  if (byteLength(refusal) === 0) return 'empty revert (a missing contract or a shortfall of gas)'
  const selector = selectorOf(refusal)
  const name = selector ? ERROR_NAMES.get(selector) : undefined
  return name ? `${name}, raw ${refusal}` : `revert ${selector}, data ${refusal}`
}

/** `duplicateLink`: a Link the registry refuses as already linked, raised only when `isLinked` holds for the vault. */
export function duplicateLink(park: Pick<SettlePark, 'message' | 'refusal'>): boolean {
  if (park.message.kind !== 'UpdateVault' || selectorOf(park.refusal) !== ALREADY_LINKED_VAULT) return false
  return byteAt(park.message.data, 73) === 1
}

function abortBetween(aborts: readonly number[], from: number, below: number): boolean {
  return aborts.some((generation) => generation >= from && generation < below)
}

/**
 * Past the step's phase is for good, with the one way back: Frozen returns to Armed through an Abort, after which
 * only a generation above the aborted one is ever accepted, since `frozenGeneration` only rises.
 */
function phaseClass(m: SettleMessage, phase: number, generation: number, aborts: readonly number[]): SettleClass {
  const step = m.step!
  if (step === MIGRATION_STEP.arm) return phase > SPOKE_NONE ? 'dead' : 'waiting'
  if (step <= MIGRATION_STEP.finalizeOffboard) {
    if (phase >= SPOKE_OFFBOARDED) return 'dead'
    const stamped = stampedGeneration(m.payload!)
    if (step === MIGRATION_STEP.freeze) {
      return phase === SPOKE_FROZEN && !abortBetween(aborts, generation, stamped) ? 'dead' : 'waiting'
    }
    return phase === SPOKE_ARMED && stamped <= generation ? 'dead' : 'waiting'
  }
  if (step === MIGRATION_STEP.restoreMaxReserves) return 'waiting'
  if (step > MIGRATION_STEP.assertRampConfig) return 'blocking'
  return phase === SPOKE_ONBOARDED ? 'dead' : 'waiting'
}

function abortClass(
  park: Pick<SettlePark, 'message' | 'refusal' | 'wouldLand'>,
  phase: number,
  generation: number
): SettleClass {
  if (park.wouldLand || byteLength(park.refusal) < 4) return 'dormant'
  const s = selectorOf(park.refusal)
  if (s === STALE_FREEZE_GENERATION || s === OFFBOARD_ALREADY_STARTED) return 'dead'
  if (s === WRONG_SPOKE_PHASE && phaseClass(park.message, phase, generation, []) === 'dead') return 'dead'
  return 'dormant'
}

function stepClass(
  m: SettleMessage,
  s: HexString,
  phase: number,
  generation: number,
  aborts: readonly number[]
): SettleClass {
  if (s === WRONG_SPOKE_PHASE) return phaseClass(m, phase, generation, aborts)
  if (s === STALE_FREEZE_GENERATION || s === OFFBOARD_ALREADY_STARTED) return 'dead'
  if (ONE_SHOT.has(s)) return 'dead'
  if (STEP_EARLY.has(s) || REGISTRY_EARLY.has(s)) return 'waiting'
  return 'blocking'
}

/**
 * A park its retry did not land, by its current refusal and the spoke's phase and generation; `aborts` are the
 * generations of the parked Aborts not themselves dead.
 * @internal
 */
export function classify(
  park: Pick<SettlePark, 'message' | 'refusal' | 'wouldLand'>,
  phase: number,
  generation: number,
  aborts: readonly number[]
): SettleClass {
  const m = park.message
  if (m.kind === 'Abort') return abortClass(park, phase, generation)
  if (byteLength(park.refusal) === 0) return 'waiting'
  const s = selectorOf(park.refusal)!
  if (m.isStep) return stepClass(m, s, phase, generation, aborts)
  if (REGISTRY_EARLY.has(s)) return 'waiting'
  if (m.kind === 'NotifyPricePoolPerShare' && s === CANNOT_SET_OLDER_PRICE) return 'dead'
  if (duplicateLink(park)) return 'dead'
  return 'dormant'
}

const PAUSED_REFUSAL = "the spoke's gateway is paused: every retry would revert Paused, so settle once it is unpaused"

function refusePaused(revert: HexString) {
  if (selectorOf(revert) === GATEWAY_PAUSED) throw new MigrationSettleError(PAUSED_REFUSAL)
}

function liveAborts(parks: readonly SettlePark[]): number[] {
  return parks
    .filter((park) => park.message.kind === 'Abort' && park.class !== 'dead')
    .map((park) => stampedGeneration(park.message.payload!))
}

function messagesOf(ctx: SettleContext, batches: readonly SettleBatch[], report: SettleReport): SettleMessage[] {
  const all: SettleMessage[] = []
  report.batches = batches.length
  if (batches.length !== 0) {
    report.fromBlock = batches[0]!.blockNumber
    report.toBlock = batches[batches.length - 1]!.blockNumber
  }
  batches.forEach((batch, b) => {
    const messages = splitBatch(batch.payload)
    const carriesStep = carries(ctx, messages).step
    messages.forEach((data, index) => {
      const m: SettleMessage = { ...classifyMessage(ctx, data, carriesStep), batch: b, index }
      if (m.kind === 'NotifyPool') report.onboardHubSent = true
      if (m.kind === 'RestoreMaxReserves') report.activated = true
      all.push(m)
    })
  })
  report.messages = all.length
  return all
}

/** Parks are counted per message hash, not per occurrence: the latest copies of a hash are the ones taken as parked. */
async function parksOf(all: readonly SettleMessage[], driver: SettleDriver): Promise<SettlePark[]> {
  const parked = new Array<boolean>(all.length).fill(false)
  const seen = new Array<boolean>(all.length).fill(false)
  for (let i = 0; i < all.length; i++) {
    if (seen[i]) continue
    let copies = 0
    for (let j = i; j < all.length; j++) {
      if (all[j]!.hash !== all[i]!.hash) continue
      seen[j] = true
      copies++
    }
    const counter = await driver.failedMessages(all[i]!.hash)
    let left = Math.min(counter, copies)
    for (let j = all.length; j > i && left > 0; j--) {
      if (all[j - 1]!.hash !== all[i]!.hash) continue
      parked[j - 1] = true
      left--
    }
  }
  const parks: SettlePark[] = []
  for (const kind of SETTLE_KIND_ORDER) {
    all.forEach((m, i) => {
      if (parked[i] && m.kind === kind) {
        parks.push({
          message: m,
          class: 'waiting',
          refusal: '0x',
          pass: 0,
          wouldLand: false,
          held: false,
          duplicate: false,
          action: '',
        })
      }
    })
  }
  return parks
}

function recovery(report: SettleReport): string {
  if (report.activated) return 'After activate: the AS43 lookalike path or a spell'
  if (report.onboardHubSent) return 'Before activate: a corrected re-plan'
  return 'Before onboardHub: a corrected re-plan of the offboard, or an abort and re-freeze while no offboard step has landed'
}

function actionOf(report: SettleReport, k: number): string {
  const park = report.parks[k]!
  if (park.pass !== 0) return `retry #${report.retries.indexOf(k) + 1}, lands in pass ${park.pass}`
  if (park.duplicate) {
    return 'duplicate, effect holds: the vault is linked already, so the copy has nothing left to land; were the vault unlinked, a retry would link it again'
  }
  if (park.class === 'waiting' && selectorOf(park.refusal) === RAMP_ASSET_NOT_REGISTERED) {
    return "wait: send this spoke's registerAsset entries from the plan, then settle again"
  }
  if (park.class === 'waiting') return 'wait: settle again once its predecessor has landed'
  if (park.class === 'dead') return 'recorded and ignored: the refusal never lifts'
  if (park.class === 'blocking') return `STOP. ${recovery(report)}`
  if (park.held)
    return 'held behind a live Abort and not retried: retry the Abort to abort, or supersede it with a new relayFreeze'
  if (park.message.kind === 'Abort') return 'not retried: retry it to abort, or supersede it with a new relayFreeze'
  return 'not retried: anyone can retry it later and re-apply its effect; after activation the admins can grant a pool Gateway manager on this spoke who clears it with clearFailedMessage'
}

/**
 * The own parks of `batches`, classified, and the retries that land, simulated in the hub's send order until a
 * pass lands nothing. An Abort is never retried: landing it is a decision. Nor, while a parked Abort can still
 * land, is a Freeze or offboard step of its generation or below.
 * @internal
 */
export async function settleRun(
  ctx: SettleContext,
  batches: readonly SettleBatch[],
  driver: SettleDriver
): Promise<SettleReport> {
  if (await driver.paused()) throw new MigrationSettleError(PAUSED_REFUSAL)
  const report: SettleReport = {
    centrifugeId: ctx.spokeCentrifugeId,
    batches: 0,
    messages: 0,
    fromBlock: null,
    toBlock: null,
    onboardHubSent: false,
    activated: false,
    parks: [],
    retries: [],
    passes: 0,
    waiting: 0,
    dead: 0,
    blocking: 0,
    dormant: 0,
  }
  report.parks = await parksOf(messagesOf(ctx, batches, report), driver)

  const [phase, generation] = await Promise.all([driver.spokePhase(), driver.frozenGeneration()])
  for (const park of report.parks) {
    if (park.message.kind !== 'Abort') continue
    const { ok, revert } = await driver.retry(park.message.data, [])
    if (!ok) refusePaused(revert)
    park.wouldLand = ok
    park.refusal = ok ? '0x' : revert
    park.class = classify(park, phase, generation, [])
  }

  const aborts = liveAborts(report.parks)
  if (aborts.length !== 0) {
    const highest = Math.max(...aborts)
    for (const park of report.parks) {
      const m = park.message
      if (!m.isStep || m.step === MIGRATION_STEP.arm || m.step === MIGRATION_STEP.abort) continue
      if (m.step! > MIGRATION_STEP.finalizeOffboard) continue
      park.held = stampedGeneration(m.payload!) <= highest
    }
  }

  const landed: HexString[] = []
  for (;;) {
    let tried = false
    let landedThisPass = 0
    for (let k = 0; k < report.parks.length; k++) {
      const park = report.parks[k]!
      if (park.pass !== 0 || park.message.kind === 'Abort' || park.held) continue
      if (!tried) {
        report.passes++
        tried = true
      }
      const { ok, revert } = await driver.retry(park.message.data, landed)
      if (!ok) {
        refusePaused(revert)
        park.refusal = revert
        continue
      }
      park.pass = report.passes
      report.retries.push(k)
      landed.push(park.message.data)
      landedThisPass++
    }
    if (!tried || landedThisPass === 0) break
  }

  const live = liveAborts(report.parks)
  for (const park of report.parks) {
    if (park.held) park.class = 'dormant'
    else if (park.message.kind !== 'Abort') {
      park.class = park.pass !== 0 ? 'waiting' : classify(park, phase, generation, live)
      park.duplicate = park.pass === 0 && duplicateLink(park)
    }
    if (park.class === 'waiting') report.waiting++
    else if (park.class === 'dead') report.dead++
    else if (park.class === 'blocking') report.blocking++
    else report.dormant++
  }
  report.parks.forEach((park, k) => {
    park.action = actionOf(report, k)
  })
  return report
}

/** Whether nothing but dead parks is left, with the dormant parks `accepted` names left in place. */
export function settled(report: SettleReport, accepted: readonly HexString[] = []): boolean {
  return report.waiting + report.blocking + dormantLeft(report, accepted) === 0
}

/** The dormant parks `accepted` does not name. An Abort and the steps it holds are never accepted. */
export function dormantLeft(report: SettleReport, accepted: readonly HexString[]): number {
  let n = 0
  for (const park of report.parks) {
    if (park.class !== 'dormant') continue
    const raceOpen = park.message.kind === 'Abort' || park.held
    if (!raceOpen && accepted.some((hash) => hash.toLowerCase() === park.message.hash.toLowerCase())) continue
    n++
  }
  return n
}

/**
 * Why the spoke's offboard or onboard input must not be derived again yet, empty when it may be: a re-derivation
 * re-offers every item the contract has not recorded as done, a parked one included.
 */
export function replanRefusal(report: SettleReport, accepted: readonly HexString[] = []): string {
  const dormant = dormantLeft(report, accepted)
  if (report.waiting + dormant === 0) return ''
  return `${report.waiting} waiting and ${dormant} dormant own park(s). Settle first: retry what lands on that chain and resolve every dormant row, then plan again once nothing is left. A plan derived now would re-send what is parked rather than retry the original`
}
