import type { HubPolicyRow, PoolAuthorizationEventRow } from '@centrifuge/queries/core'
import {
  BaseError,
  decodeAbiParameters,
  isHex,
  slice,
  toFunctionSelector,
  zeroAddress,
  type Abi,
  type AbiFunction,
} from 'viem'
import { AuthorizationFoldError } from '../errors.js'
import type { HexString } from '../types/index.js'
import { isoInstant } from './date.js'
import { PoolId } from './types.js'

/**
 * Where an authorization stands, as of the block time it was computed at.
 * - `scheduled` before `validAfter`, `matured` from `validAfter` to `expiresAt` inclusive, `expired` after it.
 * - `undetermined`: past `validAfter`, and the policy's expiry is still unknown after the SDK asked the contract. It
 *   may be `matured` or `expired`: offer cancel, not execute.
 * - `canceled` and `consumed` ended it; the same calldata can be scheduled again.
 * - `orphaned`: a later policy install made the id unreachable. The same calldata scheduled again under the current
 *   policy is a new id.
 */
export type AuthorizationStatus =
  'scheduled' | 'matured' | 'expired' | 'undetermined' | 'canceled' | 'consumed' | 'orphaned'

/**
 * The `event_kind` of the four HubRegistry events the fold reads: a policy install and the three that move an
 * authorization. Every other kind in the rows (the Hub's spoke events, the SpokeRegistry's) is ignored.
 */
export const AUTHORIZATION_EVENT_KIND = {
  setPolicy: 'HUB_REGISTRY_SET_POLICY',
  scheduled: 'HUB_REGISTRY_AUTHORIZATION_SCHEDULED',
  canceled: 'HUB_REGISTRY_AUTHORIZATION_CANCELED',
  consumed: 'HUB_REGISTRY_AUTHORIZATION_CONSUMED',
} as const

/**
 * The columns of a `pool_authorization_event` row the fold reads. The rows are one pool's, all kinds and chains:
 * `createdAtBlock` is only comparable within a chain, and the fold reads only the pool's hub chain.
 */
export type AuthorizationEventRow = Pick<
  PoolAuthorizationEventRow,
  | 'centrifugeId'
  | 'poolId'
  | 'eventKind'
  | 'caller'
  | 'authId'
  | 'calldata'
  | 'validAfter'
  | 'policy'
  | 'createdAt'
  | 'createdAtBlock'
  | 'createdAtTxHash'
  | 'createdAtLogIndex'
>

/**
 * The columns of a `hub_policy` row the fold reads, only to look up the `expiry` of the install that shares its primary
 * key `(centrifugeId, createdAtTxHash, createdAtLogIndex)`. A null `expiry` is unknown.
 */
export type HubPolicyParametersRow = Pick<
  HubPolicyRow,
  'centrifugeId' | 'poolId' | 'expiry' | 'createdAtTxHash' | 'createdAtLogIndex'
>

/**
 * One run of an authorization: a scheduling row and what ended it. Calldata scheduled again under the same policy
 * install has the same `authId`, so one id can have several runs, each listed on its own.
 */
export interface PoolAuthorization {
  /**
   * Identifies the run: the lowercased hash of the transaction that scheduled it and the log index of its scheduling
   * row, `<txHash>:<logIndex>`. Stable across reads and unique per run, which `authId` is not.
   */
  runId: string
  /**
   * The authorization id: `HubRegistry.authId(poolId, data)` under the policy installed when it was scheduled. Every
   * run of the same calldata under the same install shares it.
   */
  authId: HexString
  /** The authorized calldata, as scheduled. */
  data: HexString
  /** The Hub function `data` calls, by selector; null for a selector the Hub ABI does not carry. */
  functionName: string | null
  /**
   * The call's arguments by ABI input name, decoded with the v3.3 Hub ABI and as viem returns them (`bigint` for a
   * `uint64`, a checksummed `address`); null when `functionName` is null or the calldata does not decode. A refund
   * address, where the call has one, is `args.refund`.
   */
  args: Readonly<Record<string, unknown>> | null
  /** The manager that scheduled it. */
  caller: HexString
  /**
   * Unix seconds of the block that scheduled it, rounded down: the `created_at` the indexer stamps on the scheduling
   * log (the block timestamp). `validAfter - scheduledAt` is the delay the policy applied.
   */
  scheduledAt: bigint
  /** Unix seconds from which the authorization can be consumed. */
  validAfter: bigint
  /** Unix seconds of the last second it can be consumed; null while the policy's expiry is unknown. */
  expiresAt: bigint | null
  /** Where it stands at `now`; see {@link AuthorizationStatus}. */
  status: AuthorizationStatus
  /** The transaction that scheduled it. */
  txHash: HexString
  /**
   * Unix seconds of the block of the consumption row that ended this run, rounded down, for a `consumed` item; null for
   * every other status.
   */
  executedAt: bigint | null
  /** The transaction that consumed this run, for a `consumed` item; null for every other status. */
  executedTxHash: HexString | null
  /**
   * Unix seconds of the block of the cancel row that ended this run, rounded down, for a `canceled` item; null for
   * every other status.
   */
  canceledAt: bigint | null
  /** The transaction that canceled this run, for a `canceled` item; null for every other status. */
  canceledTxHash: HexString | null
}

/**
 * A row or run the index holds too little to judge: `schedulingRowMissing` for a cancel or consumption row with no
 * scheduling run open before it, `endingRowMissing` for a scheduling row whose id already has a run open (one entry per
 * such row), `installMissing` for a live scheduling run with no policy install before it (one entry per run). The
 * indexer is usually behind. Show a count, offer no action, and read again later.
 */
export interface SkippedAuthorization {
  /** The authorization id of the row or run that could not be judged; several entries can share it. */
  authId: HexString
  /**
   * What is missing: the scheduling row, the cancel or consumption that ended the run already open for the id, or a
   * policy install before the run.
   */
  reason: 'schedulingRowMissing' | 'endingRowMissing' | 'installMissing'
}

/** A pool's authorization runs and the rows the index could not judge. */
export interface PoolAuthorizationList {
  /** One item per scheduling run, oldest scheduling row first. */
  items: PoolAuthorization[]
  /** The rows the index could not judge, left out of `items`; one entry per row or run. */
  skipped: SkippedAuthorization[]
}

export interface FoldAuthorizationsInput {
  /** Every `pool_authorization_event` row of the pool, in any order. */
  events: readonly AuthorizationEventRow[]
  /** The pool's `hub_policy` rows, in any order. Only `expiry` is read, and only for an install the events hold. */
  policyParameters: readonly HubPolicyParametersRow[]
  /** The Hub ABI the calldata's function name is looked up in. */
  hubAbi: Abi
  /** The hub chain's latest block timestamp in unix seconds. */
  now: bigint
  /** `expiry()` read from the contract per policy address, for installs whose parameter row carries none. */
  contractExpiries?: ReadonlyMap<string, bigint> | undefined
}

type Position = { createdAtBlock: number; createdAtLogIndex: number }

/** One `HUB_REGISTRY_SET_POLICY` row of the hub chain, with the `hub_policy` row of the same log. */
export interface HubInstall<Parameters extends HubPolicyParametersRow = HubPolicyParametersRow> extends Position {
  centrifugeId: string
  createdAtTxHash: string
  /**
   * The install's place among the pool's installs on the hub chain, from 1. It equals `HubRegistry.policyNonce` when
   * the indexed history is complete.
   */
  installNumber: number
  /** Lower-case address; the zero address clears the policy. Null when the log carried none, which is unknown. */
  policy: string | null
  /** The `hub_policy` row with the install's primary key; undefined when it is missing, which is unknown. */
  parameters: Parameters | undefined
}

interface Install extends HubInstall {
  expiry: bigint | null
}

/** A scheduling row and the cancel or consumption row that ended it, when one has. */
interface Run {
  scheduled: AuthorizationEventRow
  ended: AuthorizationEventRow | undefined
}

/** A cancel, consumption or scheduling row the runs cannot place, with what the index lacks for it. */
interface Orphan {
  row: AuthorizationEventRow
  reason: Exclude<SkippedAuthorization['reason'], 'installMissing'>
}

interface Judgement {
  installs: readonly Install[]
  now: bigint
}

const byPosition = (a: Position, b: Position) =>
  a.createdAtBlock - b.createdAtBlock || a.createdAtLogIndex - b.createdAtLogIndex

/**
 * Folds the indexed authorization log into one item per scheduling run, oldest scheduling row first, judged at `now`.
 * A run starts at a `HUB_REGISTRY_AUTHORIZATION_SCHEDULED` row and ends at the next cancel or consumption of its id; the
 * same calldata scheduled again is a new run, and each run is judged alone. Rows are ordered by block and log index,
 * never by timestamp. The installs and their numbers come from the event rows (the running count of
 * `HUB_REGISTRY_SET_POLICY` rows, from 1). An install's expiry is its `hub_policy` row's, else `contractExpiries`', else
 * unknown, which shows as `expiresAt: null` and not as a failure. A cancel or consumption with no run open before it,
 * a scheduling row whose id already has a run open, and a live run with no install before it, go to `skipped`.
 *
 * @throws AuthorizationFoldError for rows that are broken: rows of two pools, a hub row of another chain than the
 * pool's hub chain, a hub row without a column it needs, or a malformed number.
 */
export function foldAuthorizations(input: FoldAuthorizationsInput): PoolAuthorizationList {
  const expiries = new Map(
    [...(input.contractExpiries ?? [])].map(([address, expiry]) => [address.toLowerCase(), expiry])
  )
  const installs: Install[] = hubInstallsOf(input.events, input.policyParameters).map((install) => ({
    ...install,
    expiry: expiryOf(install, expiries),
  }))
  const judgement: Judgement = { installs, now: input.now }
  const hubFunctions = hubFunctionsBySelector(input.hubAbi)
  const lifecycle = input.events
    .filter((row) => isHubRow(row) && row.eventKind !== AUTHORIZATION_EVENT_KIND.setPolicy)
    .sort(byPosition)

  const { runs, orphans } = runsOf(lifecycle)
  const listed: { scheduled: AuthorizationEventRow; item: PoolAuthorization }[] = []
  const skipped: { at: Position; entry: SkippedAuthorization }[] = orphans.map(({ row, reason }) => ({
    at: row,
    entry: { authId: hexColumn(row.authId, 'authId', row), reason },
  }))
  for (const run of runs) {
    const install = installs.findLast((candidate) => byPosition(candidate, run.scheduled) < 0)
    const validAfter = secondsColumn(run.scheduled.validAfter, 'validAfter', run.scheduled)
    const status = statusOf(run.ended, install, validAfter, judgement)
    if (status === undefined) {
      skipped.push({
        at: run.scheduled,
        entry: { authId: hexColumn(run.scheduled.authId, 'authId', run.scheduled), reason: 'installMissing' },
      })
      continue
    }
    listed.push({ scheduled: run.scheduled, item: toItem(run, validAfter, install, status, hubFunctions) })
  }

  return {
    items: listed.sort((a, b) => byPosition(a.scheduled, b.scheduled)).map(({ item }) => item),
    skipped: skipped.sort((a, b) => byPosition(a.at, b.at)).map(({ entry }) => entry),
  }
}

/**
 * The installs of the pool on its hub chain in chain order: its `HUB_REGISTRY_SET_POLICY` rows, each with the
 * `hub_policy` row that has the same primary key.
 *
 * @throws AuthorizationFoldError for rows of two pools, or a hub row or parameter row of another chain than the hub
 * chain the pool id names.
 */
export function hubInstallsOf<Parameters extends HubPolicyParametersRow>(
  events: readonly AuthorizationEventRow[],
  policyParameters: readonly Parameters[]
): HubInstall<Parameters>[] {
  assertOneHubPool(events, policyParameters)
  const parameters = new Map(policyParameters.map((row) => [primaryKeyOf(row), row]))

  return events
    .filter((row) => row.eventKind === AUTHORIZATION_EVENT_KIND.setPolicy)
    .sort(byPosition)
    .map((row, index) => ({
      centrifugeId: row.centrifugeId,
      createdAtBlock: row.createdAtBlock,
      createdAtTxHash: row.createdAtTxHash,
      createdAtLogIndex: row.createdAtLogIndex,
      installNumber: index + 1,
      policy: row.policy === null ? null : row.policy.toLowerCase(),
      parameters: parameters.get(primaryKeyOf(row)),
    }))
}

/**
 * The policy an `expiry()` read could settle: the latest install's, when its parameter row gives no expiry and it names
 * a policy. A live authorization is judged under the latest install, and an earlier install's authorizations are
 * orphaned and need no expiry.
 */
export function policyNeedingExpiry(installs: readonly HubInstall[]): string | null {
  const latest = installs.at(-1)
  if (!latest || latest.parameters?.expiry != null) return null
  return latest.policy === null || latest.policy === zeroAddress ? null : latest.policy
}

/** Throws unless every row is one pool's, and every hub row and parameter row is on that pool's hub chain. */
function assertOneHubPool(
  events: readonly AuthorizationEventRow[],
  policyParameters: readonly HubPolicyParametersRow[]
) {
  const poolIds = new Set([...events, ...policyParameters].map((row) => row.poolId))
  if (poolIds.size > 1) {
    throw new AuthorizationFoldError(`The rows to fold must belong to one pool, got ${[...poolIds].join(', ')}`)
  }
  const [poolId] = poolIds
  if (poolId === undefined) return

  const hubChain = hubChainOf(poolId)
  for (const row of [...events.filter(isHubRow), ...policyParameters]) {
    if (row.centrifugeId !== hubChain) {
      throw new AuthorizationFoldError(
        `${locate(row)} is on chain ${row.centrifugeId}, but the hub chain of pool ${poolId} is ${hubChain}`
      )
    }
  }
}

/** The pool id carries the hub chain's centrifugeId in its upper 16 bits. */
function hubChainOf(poolId: string): string {
  if (!/^\d+$/.test(poolId)) throw new AuthorizationFoldError(`poolId is not a whole number: ${poolId}`)
  return String(new PoolId(poolId).centrifugeId)
}

const HUB_KINDS: ReadonlySet<string> = new Set(Object.values(AUTHORIZATION_EVENT_KIND))

const isHubRow = (row: AuthorizationEventRow) => HUB_KINDS.has(row.eventKind)

/** The primary key shared by an event row and its `hub_policy` row: the log. */
const primaryKeyOf = (row: Pick<AuthorizationEventRow, 'centrifugeId' | 'createdAtTxHash' | 'createdAtLogIndex'>) =>
  `${row.centrifugeId}:${row.createdAtTxHash.toLowerCase()}:${row.createdAtLogIndex}`

/** The install's expiry: its parameter row's, else the contract's by lower-case policy address, else unknown. */
function expiryOf(install: HubInstall, contractExpiries: ReadonlyMap<string, bigint>): bigint | null {
  if (install.parameters?.expiry != null) return secondsColumn(install.parameters.expiry, 'expiry', install.parameters)
  return (install.policy === null ? undefined : contractExpiries.get(install.policy)) ?? null
}

/**
 * The runs of rows in chain order, and the rows that could not be placed. A scheduling row opens a run; the next cancel
 * or consumption of the same id ends it. A cancel or consumption with no run open is an orphan, and so is a scheduling
 * row whose id already has a run open, which stays the open run.
 */
function runsOf(rows: readonly AuthorizationEventRow[]): { runs: Run[]; orphans: Orphan[] } {
  const runs: Run[] = []
  const orphans: Orphan[] = []
  const open = new Map<string, Run>()
  for (const row of rows) {
    const key = column(row.authId, 'authId', row).toLowerCase()
    const openRun = open.get(key)
    if (row.eventKind === AUTHORIZATION_EVENT_KIND.scheduled) {
      if (openRun) {
        orphans.push({ row, reason: 'endingRowMissing' })
        continue
      }
      const run: Run = { scheduled: row, ended: undefined }
      runs.push(run)
      open.set(key, run)
      continue
    }
    if (!openRun) {
      orphans.push({ row, reason: 'schedulingRowMissing' })
      continue
    }
    openRun.ended = row
    open.delete(key)
  }
  return { runs, orphans }
}

/** The status of a run, or undefined when a live run has no install before it to judge it by. */
function statusOf(
  ended: AuthorizationEventRow | undefined,
  install: Install | undefined,
  validAfter: bigint,
  { installs, now }: Judgement
): AuthorizationStatus | undefined {
  if (ended?.eventKind === AUTHORIZATION_EVENT_KIND.canceled) return 'canceled'
  if (ended?.eventKind === AUTHORIZATION_EVENT_KIND.consumed) return 'consumed'
  if (!install) return undefined
  if (install.installNumber !== installs.length) return 'orphaned'
  if (now < validAfter) return 'scheduled'
  if (install.expiry === null) return 'undetermined'
  return now <= validAfter + install.expiry ? 'matured' : 'expired'
}

function toItem(
  { scheduled, ended }: Run,
  validAfter: bigint,
  install: Install | undefined,
  status: AuthorizationStatus,
  hubFunctions: ReadonlyMap<string, AbiFunction>
): PoolAuthorization {
  const data = hexColumn(scheduled.calldata, 'calldata', scheduled)
  const expiry = install?.expiry ?? null

  return {
    runId: `${hexColumn(scheduled.createdAtTxHash, 'createdAtTxHash', scheduled).toLowerCase()}:${scheduled.createdAtLogIndex}`,
    authId: hexColumn(scheduled.authId, 'authId', scheduled),
    data,
    ...decodeHubCall(hubFunctions, data),
    caller: hexColumn(scheduled.caller, 'caller', scheduled),
    scheduledAt: blockTimeSeconds(scheduled),
    validAfter,
    expiresAt: expiry === null ? null : validAfter + expiry,
    status,
    txHash: hexColumn(scheduled.createdAtTxHash, 'createdAtTxHash', scheduled),
    ...(status === 'consumed' && ended ? executionOf(ended) : { executedAt: null, executedTxHash: null }),
    ...(status === 'canceled' && ended ? cancelOf(ended) : { canceledAt: null, canceledTxHash: null }),
  }
}

/** When and in which transaction a consumption row ran. */
function executionOf(consumption: AuthorizationEventRow): Pick<PoolAuthorization, 'executedAt' | 'executedTxHash'> {
  return {
    executedAt: blockTimeSeconds(consumption),
    executedTxHash: hexColumn(consumption.createdAtTxHash, 'createdAtTxHash', consumption),
  }
}

/** When and in which transaction a cancel row ran. */
function cancelOf(cancel: AuthorizationEventRow): Pick<PoolAuthorization, 'canceledAt' | 'canceledTxHash'> {
  return {
    canceledAt: blockTimeSeconds(cancel),
    canceledTxHash: hexColumn(cancel.createdAtTxHash, 'createdAtTxHash', cancel),
  }
}

export function hubFunctionsBySelector(abi: Abi): Map<string, AbiFunction> {
  const functions = abi.filter((item): item is AbiFunction => item.type === 'function')
  return new Map(functions.map((item) => [toFunctionSelector(item), item]))
}

/** The Hub function a call's selector names and its arguments, as {@link PoolAuthorization} carries them. */
export function decodeHubCall(
  hubFunctions: ReadonlyMap<string, AbiFunction>,
  data: HexString
): Pick<PoolAuthorization, 'functionName' | 'args'> {
  const hubFunction = hubFunctions.get(slice(data, 0, 4).toLowerCase())
  return {
    functionName: hubFunction?.name ?? null,
    args: hubFunction ? decodeArgs(hubFunction, data) : null,
  }
}

/** The call's arguments by input name, an unnamed input by its position; null when the data does not decode. */
function decodeArgs(hubFunction: AbiFunction, data: HexString): Readonly<Record<string, unknown>> | null {
  try {
    const values = decodeAbiParameters(hubFunction.inputs, `0x${data.slice(10)}`)
    return Object.fromEntries(hubFunction.inputs.map((input, index) => [input.name || `arg${index}`, values[index]]))
  } catch (error) {
    if (error instanceof BaseError) return null
    throw error
  }
}

function locate(row: { eventKind?: string; createdAtLogIndex: number; createdAtBlock?: number }): string {
  const block = row.createdAtBlock === undefined ? '' : ` at block ${row.createdAtBlock}`
  return `the ${row.eventKind ?? 'row'}${block}, log ${row.createdAtLogIndex}`
}

/** A column a hub row must carry; null means the projection or the query dropped it. */
function column(
  value: string | null | undefined,
  name: string,
  row: AuthorizationEventRow | HubPolicyParametersRow
): string {
  if (value == null) throw new AuthorizationFoldError(`${name} is missing on ${locate(row)}`)
  return value
}

function hexColumn(value: string | null, name: string, row: AuthorizationEventRow): HexString {
  const text = column(value, name, row)
  if (!isHex(text)) throw new AuthorizationFoldError(`${name} is not hex on ${locate(row)}: ${text}`)
  return text
}

/** The block time of a row in unix seconds, rounded down: its `createdAt`, a column that is never null. */
function blockTimeSeconds(row: AuthorizationEventRow): bigint {
  const text = column(row.createdAt, 'createdAt', row)
  const instant = isoInstant(text)
  if (instant === null) {
    throw new AuthorizationFoldError(`createdAt is not an ISO-8601 timestamp with an offset on ${locate(row)}: ${text}`)
  }
  return BigInt(Math.floor(instant.getTime() / 1000))
}

/** A numeric(78,0) column as unix seconds; the API returns it as a decimal string. */
function secondsColumn(
  value: string | null,
  name: string,
  row: AuthorizationEventRow | HubPolicyParametersRow
): bigint {
  const text = column(value, name, row)
  if (!/^\d+$/.test(text)) throw new AuthorizationFoldError(`${name} is not a whole number on ${locate(row)}: ${text}`)
  return BigInt(text)
}
