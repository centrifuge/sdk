import type { SdkProtocolContext } from '../Centrifuge.js'
import type { OperationOutOfPolicyStatus, OutOfPolicyBatchCall, OutOfPolicyCall } from '../types/transaction.js'
import type { HexString } from '../types/index.js'
import {
  assertAuthorizationCalldata,
  assertDistinctCalldata,
  encodeInitiateAuthorization,
} from '../utils/authorizationCalldata.js'
import { parseHubCall, type HubCallMessages } from '../utils/hubCallMessages.js'
import {
  deferredOf,
  deploymentTarget,
  isSetAdapters,
  isSetPolicy,
  notifiedNetwork,
} from '../utils/hubExecutionRules.js'
import { mergeMessages, type PoolPolicyScope } from '../utils/transaction.js'
import type { CentrifugeId } from '../utils/types.js'
import { describeGroup, refusing, type ParsedCall } from './hubExecution.js'
import type { Pool } from './Pool.js'

const METHOD = 'Pool.scheduleOutOfPolicy'

/** A call of the status that passed the checks that read nothing. */
export type BatchEntry = ParsedCall & Pick<OutOfPolicyBatchCall, 'status' | 'deferred'>

/** What the scheduling transaction sends: its calls in batch order and the pool that judges each, if any. */
export type SchedulePlan = {
  data: HexString[]
  /** A call to send is judged by the pool's policy; a call that schedules one is not, since no policy classifies it. */
  policies: (PoolPolicyScope | undefined)[]
  /** The messages of the calls that are sent; scheduling sends none. */
  messages: HubCallMessages
}

/**
 * The checks of a status that need no read of the chain.
 *
 * @throws Error naming the first call that fails a check.
 */
export function parseSchedule(pool: Pool, status: OperationOutOfPolicyStatus): BatchEntry[] {
  const batch = batchOfStatus(status)
  batch.forEach(({ data }) => assertAuthorizationCalldata(data, METHOD))
  const entries = batch.map((call) => ({ ...call, ...refusing(METHOD, () => parseHubCall(call.data, pool.id)) }))
  const expected = deferredOf(entries.map((entry) => ({ call: entry, status: entry.status })))
  entries.forEach((entry, index) => refuse(whyWrongDeferral(entry, expected[index]!)))
  entries.forEach((entry) => refuse(whyNotScheduled(entry, status.calls)))
  const unnotified = networksLeftUnnotified(entries)
  entries.forEach((entry) => refuse(whyOutrunsNotifyPool(entry, unnotified)))
  const scheduled = entries.filter(isScheduled)
  if (scheduled.length === 0) {
    throw new Error(`${METHOD}: nothing to schedule: no call of the batch needs an authorization`)
  }
  assertDistinctCalldata(
    scheduled.map(({ data }) => data),
    METHOD
  )
  return entries
}

/**
 * The transaction that schedules the calls that need an authorization and sends the instant calls that stay, in batch
 * order. Messages are derived for every call against the pool's own `BatchRequestManager`, as the execution does, so an
 * underivable call is refused here.
 *
 * @throws Error naming the first call whose messages cannot be derived.
 */
export function planSchedule(pool: Pool, hubCtx: SdkProtocolContext, entries: readonly BatchEntry[]): SchedulePlan {
  const sent = describeGroup(pool, hubCtx, entries, METHOD).filter(({ deferred }) => !deferred)
  return {
    data: sent.map((call) => (isScheduled(call) ? encodeInitiateAuthorization(pool.id, call.data) : call.data)),
    policies: sent.map((call) => (isScheduled(call) ? undefined : { poolId: pool.id })),
    messages: mergeMessages(sent.filter((call) => !isScheduled(call)).map(({ messages }) => messages)),
  }
}

const isScheduled = ({ status }: BatchEntry) => status === 'needs-authorization'

function batchOfStatus(status: OperationOutOfPolicyStatus): OutOfPolicyBatchCall[] {
  if (status?.type !== 'OutOfPolicy' || !Array.isArray(status.batch) || !Array.isArray(status.calls)) {
    throw new Error(`${METHOD} takes the OutOfPolicy status of a transaction, with its calls and its batch`)
  }
  if (status.batch.length === 0) throw new Error(`${METHOD} needs a status with at least one call in its batch`)
  return status.batch
}

function refuse(reason: string | null): void {
  if (reason !== null) throw new Error(`${METHOD}: ${reason}`)
}

/** A wrong `deferred` would leave a call out of every transaction or send one the execution rebuilds. */
function whyWrongDeferral(entry: BatchEntry, expected: boolean): string | null {
  if (entry.deferred === expected) return null
  const rule = expected ? 'rebuilds it, so it must not be sent' : 'does not rebuild it, so it must be sent or scheduled'
  return (
    `Hub.${entry.functionName} says deferred: ${String(entry.deferred)}, but for the calls of this batch that are not ` +
    `ready the execution ${rule}: pass the status as the action yielded it`
  )
}

/** Why a call cannot be part of the scheduling transaction, with what to do instead; null when it can. */
function whyNotScheduled(entry: BatchEntry, calls: readonly OutOfPolicyCall[]): string | null {
  const call = `Hub.${entry.functionName}`
  const verdict = calls.find(({ data }) => data === entry.data)
  switch (entry.status) {
    case 'forbidden':
      return (
        `${call} is forbidden for this signer${verdict?.reason ? ` (${verdict.reason})` : ''}: no authorization ` +
        'changes that, so the action cannot be scheduled'
      )
    case 'pending':
      return (
        `${call} is already scheduled and has not matured${verdict?.validAfter ? ` (it matures at ${verdict.validAfter})` : ''}: ` +
        'wait for it, then execute its group with Pool.executeAuthorizations'
      )
    case 'expired':
      return (
        `${call} has an authorization that expired: cancel it with Pool.cancelAuthorization, then run the action ` +
        'again for a new status'
      )
    case 'undetermined':
      return (
        `${call} has an authorization that matured with an expiry the SDK cannot read, so it may be usable or ` +
        'expired: cancel it with Pool.cancelAuthorization, then run the action again for a new status'
      )
    default:
      return whyReadyCallCannotBeSent(entry, call)
  }
}

/** Why a call that is ready cannot go in the scheduling transaction; null when it can. */
function whyReadyCallCannotBeSent(entry: BatchEntry, call: string): string | null {
  if (isIndependentSetAdapters(entry)) {
    return (
      `${call} is ready, and the Hub refuses setAdapters inside a batch, so it cannot be sent with the scheduling ` +
      'transaction: send it on its own first, then run the action again for a new status'
    )
  }
  if (isIndependentSetPolicy(entry)) {
    return (
      `${call} is ready, and installing a policy orphans the authorizations this transaction schedules, so it cannot ` +
      'be sent with them: send it on its own first, then run the action again for a new status'
    )
  }
  return null
}

/** The networks whose `notifyPool` the scheduling transaction leaves to the execution. */
const networksLeftUnnotified = (entries: readonly BatchEntry[]): ReadonlySet<CentrifugeId> =>
  new Set(entries.filter(({ deferred }) => deferred).flatMap((entry) => notifiedNetwork(entry) ?? []))

/**
 * A deployment leg that is ready is sent with the transaction, ahead of a `notifyPool` the execution sends later, and
 * the network rejects a message for a pool it has not been told about.
 */
function whyOutrunsNotifyPool(entry: BatchEntry, unnotified: ReadonlySet<CentrifugeId>): string | null {
  const target = deploymentTarget(entry)
  if (entry.status !== 'ready' || entry.deferred || target === null || !unnotified.has(target)) return null
  return (
    `Hub.${entry.functionName} to network ${target} is ready and would be sent now, but this batch leaves ` +
    `Hub.notifyPool to that network to the execution, so the network would receive it before the pool. The call is ` +
    'ready now, most likely through an authorization that matured earlier: execute that group first with ' +
    'Pool.executeAuthorizations, then run the action again for a new status'
  )
}

/** A `setAdapters` the batch would send rather than schedule: the Hub refuses it inside a multicall. */
const isIndependentSetAdapters = (entry: BatchEntry) => isSetAdapters(entry) && !isScheduled(entry)

/** A `setPolicy` the batch would send rather than schedule: it would orphan what the same transaction schedules. */
const isIndependentSetPolicy = (entry: BatchEntry) => isSetPolicy(entry) && !isScheduled(entry)
