import type { HexString } from '../types/index.js'
import { VaultUpdateKind, type OutOfPolicyBatchCall } from '../types/transaction.js'
import { peekHubCall, type ParsedHubCall } from './hubCallMessages.js'
import { AssetId, type CentrifugeId } from './types.js'

// The instant calls a matured group rebuilds when `Pool.executeAuthorizations` runs (`entities/hubExecution.ts`). The
// transaction that schedules the group must not send them too. Everything here reads calldata only.

/** The share class a call names: the second argument of every Hub call that is about one. */
export const shareClassOf = ({ args }: ParsedHubCall) => args[1] as HexString

/** The asset of an `updateVault` or a `notifyAssetPrice`. */
export const assetOf = ({ args }: ParsedHubCall) => args[2] as bigint

/** Either overload of `updateSharePrice`; the name is all it reads, so a call that did not decode is one as well. */
export const isSharePriceUpdate = ({ functionName }: { functionName: string | null }) =>
  functionName === 'updateSharePrice'

/** The Hub refuses `setAdapters` inside a batch (`CannotSetAdaptersWhileBatching`), so it has a transaction of its own. */
export const isSetAdapters = ({ functionName }: ParsedHubCall) => functionName === 'setAdapters'

/**
 * `HubRegistry.setPolicy` bumps the pool's authorization nonce, which orphans every authorization still pending, so an
 * install is moved last in the group's multicall: only a call after it would lose its authorization.
 */
export const isSetPolicy = ({ functionName }: ParsedHubCall) => functionName === 'setPolicy'

/** The network a `notifyPool` notifies; null for any other call. */
export const notifiedNetwork = ({ functionName, args }: ParsedHubCall) =>
  functionName === 'notifyPool' ? (args[1] as CentrifugeId) : null

export const deploysVault = ({ functionName, args }: ParsedHubCall) =>
  functionName === 'updateVault' && args[4] === VaultUpdateKind.DeployAndLink

/**
 * The network a call deploys to: a `notifyShareClass`, a `setRequestManager` or an `updateVault` that deploys a vault is
 * bound for it, and the pool has to be on it first. Null for any other call.
 */
export function deploymentTarget(call: ParsedHubCall): CentrifugeId | null {
  if (call.functionName === 'notifyShareClass') return call.args[2] as CentrifugeId
  if (call.functionName === 'setRequestManager') return call.args[1] as CentrifugeId
  return deploysVault(call) ? new AssetId(assetOf(call)).centrifugeId : null
}

/** What the calls that are scheduled make the execution rebuild. */
export type RebuildAnchors = {
  /** Networks the group deploys to: the pool is notified there first. */
  deployed: ReadonlySet<CentrifugeId>
  /** Share classes whose price the group updates: the new price is notified after it. */
  pricedClasses: ReadonlySet<HexString>
  /** The vaults the group deploys, as share class and asset: the asset's price is notified before. */
  deployedVaults: ReadonlySet<string>
}

const vaultKey = (call: ParsedHubCall) => `${shareClassOf(call)}:${assetOf(call)}`

/** The anchors of `scheduled`, the calls of a group. */
export function anchorsOf(scheduled: readonly ParsedHubCall[]): RebuildAnchors {
  return {
    deployed: new Set(scheduled.map(deploymentTarget).filter((target) => target !== null)),
    pricedClasses: new Set(scheduled.filter(isSharePriceUpdate).map(shareClassOf)),
    deployedVaults: new Set(scheduled.filter(deploysVault).map(vaultKey)),
  }
}

/** Whether the execution rebuilds `call`, an instant call, for the calls the anchors came from. */
export function isRebuilt(call: ParsedHubCall, anchors: RebuildAnchors): boolean {
  switch (call.functionName) {
    case 'notifySharePrice':
      return anchors.pricedClasses.has(shareClassOf(call))
    case 'notifyPool':
      return anchors.deployed.has(notifiedNetwork(call)!)
    case 'notifyAssetPrice':
      return anchors.deployedVaults.has(vaultKey(call))
    default:
      return false
  }
}

/** A call of a judged batch: decoded, or null when it does not decode, with its verdict. */
export type JudgedCall = { call: ParsedHubCall | null; status: OutOfPolicyBatchCall['status'] }

/**
 * For each call of a judged batch, whether a scheduling transaction leaves it for the execution: it is ready, and a rule
 * rebuilds it for the calls of the batch that are not. A call that is null is never deferred.
 */
export function deferredOf(batch: readonly JudgedCall[]): boolean[] {
  const scheduled = batch.flatMap(({ call, status }) => (call !== null && status !== 'ready' ? [call] : []))
  const anchors = anchorsOf(scheduled)
  return batch.map(({ call, status }) => call !== null && status === 'ready' && isRebuilt(call, anchors))
}

/** {@link deferredOf} for the calldata of a batch, decoding each call without checking it. */
export function deferredFlags(batch: readonly Pick<OutOfPolicyBatchCall, 'data' | 'status'>[]): boolean[] {
  return deferredOf(batch.map(({ data, status }) => ({ call: peekHubCall(data), status })))
}
