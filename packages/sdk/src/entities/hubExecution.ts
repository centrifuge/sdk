import type { Centrifuge, SdkProtocolContext } from '../Centrifuge.js'
import type { HexString } from '../types/index.js'
import { assertAuthorizationCalldata, assertDistinctCalldata } from '../utils/authorizationCalldata.js'
import {
  deriveHubCallMessages,
  parseHubCall,
  type HubCallMessages,
  type ParsedHubCall,
} from '../utils/hubCallMessages.js'
import {
  anchorsOf,
  assetOf,
  deploysVault,
  isSetAdapters,
  isSharePriceUpdate,
  shareClassOf,
} from '../utils/hubExecutionRules.js'
import { requireContract } from '../utils/protocolVersion.js'
import { mergeMessages, mergePendingAdapters, type PendingPoolAdaptersByChain } from '../utils/transaction.js'
import { AssetId, type CentrifugeId } from '../utils/types.js'
import type { Pool } from './Pool.js'
import { notifyAssetPriceCall, notifyPoolCall } from './PoolNetwork.js'
import { ShareClass, sharePriceNotifications } from './ShareClass.js'

const METHOD = 'Pool.executeAuthorizations'

/** A call of a group as it was scheduled, with what its entity declares for it. */
export type ScheduledCall = ParsedCall & { messages: HubCallMessages }

/** A call of the send: scheduled, or rebuilt because a scheduled call depends on it. */
export type PlannedCall = { data: HexString; messages: HubCallMessages }

/** What a matured group sends. */
export type ExecutionPlan = {
  /** Sent first, each in its own transaction: the Hub refuses `setAdapters` inside a batch. */
  setAdapters: PlannedCall[]
  /** The rest, in the order of the one transaction that sends them. */
  calls: PlannedCall[]
  /** The messages of `calls`, per destination in call order. */
  messages: HubCallMessages
  /** Where `setAdapters` installs the pool's adapters, which the messages of `calls` are priced against. */
  pendingPoolAdapters: PendingPoolAdaptersByChain | undefined
  /** Whether the transaction wraps its calls in a `multicall` even when it has one. */
  alwaysBatch: boolean
}

/** A call of a group that passed the checks that need no pool context. */
export type ParsedCall = ParsedHubCall & { data: HexString }

/**
 * The checks of a group that read nothing: it is not empty, none of its calls is repeated, each is the calldata of one
 * call of the v3.3 Hub for this pool that an SDK entity builds, and no argument makes the transaction revert or
 * underfund its message.
 *
 * @param method - The method the refusals name.
 * @throws Error naming the first call that fails a check.
 */
export function parseGroup(pool: Pool, datas: readonly HexString[], method = METHOD): ParsedCall[] {
  if (datas.length === 0) throw new Error(`${method} needs at least one hub call`)
  datas.forEach((data) => assertAuthorizationCalldata(data, method))
  assertDistinctCalldata(datas, method)
  return datas.map((data) => ({ data, ...refusing(method, () => parseHubCall(data, pool.id)) }))
}

/**
 * The messages of each call of a group, derived against the pool's own `BatchRequestManager`: a pool below v3.3 has
 * been refused before this, and a call whose messages cannot be derived is refused here, before anything is signed.
 *
 * @throws Error naming the first call whose messages cannot be derived.
 */
export function describeGroup<T extends ParsedCall>(
  pool: Pool,
  hubCtx: SdkProtocolContext,
  group: readonly T[],
  method = METHOD
): (T & { messages: HubCallMessages })[] {
  const scope = { poolId: pool.id, batchRequestManager: requireContract(hubCtx, 'batchRequestManager') }
  return group.map((call) => ({ ...call, messages: refusing(method, () => deriveHubCallMessages(call, scope)) }))
}

export function refusing<T>(method: string, check: () => T): T {
  try {
    return check()
  } catch (error) {
    throw new Error(`${method}: ${(error as Error).message}`, { cause: error })
  }
}

/**
 * The send of a matured group: the scheduled calls in the caller's order, with the instant calls they depend on rebuilt
 * through the entity emitters and refunded to `signer` (`docs/sdk/hub-policies.md`, "Executing a group").
 */
export async function planGroup(
  root: Centrifuge,
  pool: Pool,
  hubCtx: SdkProtocolContext,
  signer: HexString,
  group: readonly ScheduledCall[]
): Promise<ExecutionPlan> {
  const adapters = group.filter(isSetAdapters)
  const scheduled = group.filter((call) => !isSetAdapters(call))
  const calls = await withInstantCalls(root, pool, hubCtx, signer, scheduled)
  return {
    setAdapters: adapters.map(planned),
    calls,
    messages: mergeMessages(calls.map((call) => call.messages)),
    pendingPoolAdapters: installedAdapters(adapters),
    // A managerCall's callback is paid from the hub batch, so even one call is wrapped.
    alwaysBatch: calls.length > 1 || scheduled.some((call) => isLocalManagerCall(call, pool) && hasMessages(call)),
  }
}

const planned = ({ data, messages }: ScheduledCall): PlannedCall => ({ data, messages })
const destinationsOf = ({ messages }: ScheduledCall) => Object.keys(messages).map(Number)
const hasMessages = ({ messages }: ScheduledCall) => Object.keys(messages).length > 0
const isLocalManagerCall = (call: ScheduledCall, pool: Pool) =>
  call.functionName === 'managerCall' && call.args[1] === pool.centrifugeId

/** What a price notification pushes: the call, the share class and the asset or network it goes to. */
const notificationKey = (functionName: string, scId: unknown, target: unknown) => `${functionName}:${scId}:${target}`
/** The price notifications the group holds, which are sent as scheduled and so are not rebuilt. */
const heldNotifications = ({ functionName, args }: ScheduledCall) =>
  functionName === 'notifyAssetPrice' || functionName === 'notifySharePrice'
    ? [notificationKey(functionName, args[1], args[2])]
    : []

/** `setAdapters` installs the local adapters it names, which prices the pool's messages toward that network. */
function installedAdapters(adapters: readonly ScheduledCall[]): PendingPoolAdaptersByChain | undefined {
  if (adapters.length === 0) return undefined
  return mergePendingAdapters(
    adapters.map(({ args }) => {
      const [, centrifugeId, localAdapters] = args as [bigint, CentrifugeId, HexString[]]
      return { [centrifugeId]: localAdapters }
    })
  )
}

async function withInstantCalls(
  root: Centrifuge,
  pool: Pool,
  hubCtx: SdkProtocolContext,
  signer: HexString,
  scheduled: readonly ScheduledCall[]
): Promise<PlannedCall[]> {
  const calls: PlannedCall[] = []
  // A network the caller notifies itself is not notified again.
  const decided = new Set(scheduled.filter(({ functionName }) => functionName === 'notifyPool').flatMap(destinationsOf))
  // Likewise a price the caller notifies itself: a second copy shares the first one's authorization and reverts.
  const held = new Set(scheduled.flatMap(heldNotifications))
  const unnotified = await networksNeedingNotifyPool(pool, scheduled, decided)
  const priceNetworks = await sharePriceNetworks(root, pool, scheduled)
  for (const call of scheduled) {
    calls.push(...poolNotifications(pool, hubCtx, signer, destinationsOf(call), unnotified))
    if (deploysVault(call) && !held.has(notificationKey('notifyAssetPrice', shareClassOf(call), assetOf(call))))
      calls.push(assetPriceNotification(pool, hubCtx, signer, call))
    calls.push(planned(call))
    if (isSharePriceUpdate(call)) {
      const scId = shareClassOf(call)
      const networks = priceNetworks.get(scId)!.filter((id) => !held.has(notificationKey('notifySharePrice', scId, id)))
      calls.push(...sharePriceNotifications(hubCtx, pool.id, scId, networks, signer))
    }
  }
  return calls
}

/** The networks the group deploys to that the caller does not notify itself and the pool is not on yet. */
async function networksNeedingNotifyPool(
  pool: Pool,
  scheduled: readonly ScheduledCall[],
  decided: ReadonlySet<CentrifugeId>
): Promise<Set<CentrifugeId>> {
  const deployed = [...anchorsOf(scheduled).deployed]
  const undecided = deployed.filter((centrifugeId) => !decided.has(centrifugeId))
  const needed = await Promise.all(undecided.map(async (id) => (await pool.network(id))._needsNotifyPool()))
  return new Set(undecided.filter((_, index) => needed[index]))
}

/** The `notifyPool` to each of `networks` still in `unnotified`, which each network leaves with its first call. */
function poolNotifications(
  pool: Pool,
  hubCtx: SdkProtocolContext,
  signer: HexString,
  networks: readonly CentrifugeId[],
  unnotified: Set<CentrifugeId>
): PlannedCall[] {
  const notifications: PlannedCall[] = []
  for (const centrifugeId of networks) {
    if (!unnotified.delete(centrifugeId)) continue
    const { data, message } = notifyPoolCall(hubCtx, pool.id, centrifugeId, signer)
    notifications.push({ data, messages: { [centrifugeId]: [message] } })
  }
  return notifications
}

function assetPriceNotification(
  pool: Pool,
  hubCtx: SdkProtocolContext,
  signer: HexString,
  call: ScheduledCall
): PlannedCall {
  const assetId = new AssetId(assetOf(call))
  const { data, message } = notifyAssetPriceCall(hubCtx, pool.id, shareClassOf(call), assetId, signer)
  return { data, messages: { [assetId.centrifugeId]: [message] } }
}

/** The networks each share class of an `updateSharePrice` of the group notifies now, read once per share class. */
async function sharePriceNetworks(
  root: Centrifuge,
  pool: Pool,
  scheduled: readonly ScheduledCall[]
): Promise<Map<HexString, CentrifugeId[]>> {
  const scIds = [...anchorsOf(scheduled).pricedClasses]
  const networks = await Promise.all(scIds.map((scId) => new ShareClass(root, pool, scId)._notifySharePriceNetworks()))
  return new Map(scIds.map((scId, index) => [scId, networks[index]!]))
}
