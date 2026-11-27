import { ABIS_V3_3, BATCH_REQUEST_MANAGER_ACTION } from '@centrifuge/protocol'
import { BaseError, decodeAbiParameters, decodeFunctionData, type AbiParameter } from 'viem'
import type { HexString } from '../types/index.js'
import {
  MessageType,
  MessageTypeV3_3,
  messageV3_3,
  VaultUpdateKind,
  type MessageTypeWithSubType,
} from '../types/transaction.js'
import { HUB_FUNCTIONS } from './authorizationCalldata.js'
import { addressToBytes32 } from './index.js'
import { AssetId, type CentrifugeId, type PoolId } from './types.js'

/** The cross-chain messages a call sends, per destination in the order they leave. */
export type HubCallMessages = Record<CentrifugeId, MessageTypeWithSubType[]>

/** What a call is judged against: the pool it must be for and the pool's `BatchRequestManager` on its hub. */
export type HubCallScope = { poolId: PoolId; batchRequestManager: HexString }

type Derive = (args: readonly any[], scope: HubCallScope) => HubCallMessages

const to = (centrifugeId: number, message: MessageTypeWithSubType): HubCallMessages => ({ [centrifugeId]: [message] })
const poolMessage = (type: MessageType, { poolId }: HubCallScope) => ({ type, poolId }) as MessageTypeWithSubType
const none: Derive = () => ({})

/**
 * The Hub functions the SDK's entities send, each with the messages its entity declares. A function missing here is
 * one no entity builds, so there is nothing to price it by.
 */
const DERIVATIONS: Record<string, Derive> = {
  setPoolMetadata: none,
  addShareClass: none,
  updateShareClassMetadata: none,
  createAccount: none,
  updateHubManager: none,
  setPolicy: none,
  initializeHolding: none,
  updateSharePrice: none,
  notifySharePrice: ([, , centrifugeId], scope) =>
    to(centrifugeId, poolMessage(MessageType.NotifyPricePoolPerShare, scope)),
  notifyAssetPrice: ([, , assetId], scope) =>
    to(new AssetId(assetId).centrifugeId, poolMessage(MessageType.NotifyPricePoolPerAsset, scope)),
  notifyShareMetadata: ([, , centrifugeId], scope) =>
    to(centrifugeId, poolMessage(MessageType.NotifyShareClass, scope)),
  notifyPool: ([, centrifugeId], scope) => to(centrifugeId, poolMessage(MessageType.NotifyPool, scope)),
  notifyShareClass: ([, , centrifugeId], scope) => to(centrifugeId, poolMessage(MessageType.NotifyShareClass, scope)),
  setRequestManager: ([, centrifugeId], scope) => to(centrifugeId, poolMessage(MessageType.SetRequestManager, scope)),
  updateVault: ([, , assetId, , kind], scope) =>
    to(new AssetId(assetId).centrifugeId, {
      type: MessageType.UpdateVault,
      subtype: vaultUpdateKind(kind),
      poolId: scope.poolId,
    }),
  updateRestriction: ([, , centrifugeId], scope) => to(centrifugeId, poolMessage(MessageType.UpdateRestriction, scope)),
  updateManager: ([, centrifugeId], scope) =>
    to(centrifugeId, messageV3_3(MessageTypeV3_3.UpdateManager, scope.poolId)),
  setAdapters: ([, centrifugeId], scope) => to(centrifugeId, poolMessage(MessageType.SetPoolAdapters, scope)),
  managerCall: managerCallMessages,
}

/** A decoded call of the v3.3 Hub that an SDK entity builds, for the pool it was checked against. */
export type ParsedHubCall = { functionName: string; args: readonly unknown[] }

/**
 * Decodes one call of the v3.3 Hub and checks what needs no pool context: the selector is a Hub function, the calldata
 * decodes, the call is for `poolId`, an SDK entity builds the function, and no argument makes the transaction revert or
 * underfund its message. Reads nothing.
 *
 * @throws Error naming the check the call fails.
 */
export function parseHubCall(data: HexString, poolId: PoolId): ParsedHubCall {
  const { functionName, args, inputs } = decodeHubCallArguments(data)
  const first = args[0]
  if (typeof first !== 'bigint') {
    throw new Error(`Hub.${functionName} takes no pool as its first argument, so it is not a call for pool ${poolId}`)
  }
  if (first !== poolId.raw) {
    throw new Error(`Hub.${functionName} is a call for pool ${first}, not for pool ${poolId}`)
  }
  derivationOf(functionName)
  refuseWhatReverts(functionName, args, inputs)
  return { functionName, args }
}

function derivationOf(functionName: string): Derive {
  const derive = Object.hasOwn(DERIVATIONS, functionName) ? DERIVATIONS[functionName] : undefined
  if (!derive) {
    throw new Error(
      `Hub.${functionName} is not a call an SDK entity builds, so its cross-chain messages cannot be derived`
    )
  }
  return derive
}

/**
 * Refuses an argument that makes the transaction revert or underfund the message, whatever the pool: a `managerCall`
 * with a local value, since the Hub needs a local target's to equal the transaction's value and a remote target's to
 * be 0 (`ManagerCallUnexpectedValue`) and the SDK's value is the message fee, and extra gas on a function whose
 * messages carry none, which the fee would then not cover.
 */
function refuseWhatReverts(functionName: string, args: readonly unknown[], inputs: readonly AbiParameter[]) {
  const argument = (name: string) => args[inputs.findIndex((input) => input.name === name)]
  const localValue = argument('localValue')
  if (typeof localValue === 'bigint' && localValue !== 0n) {
    throw new Error(
      `Hub.${functionName} carries a local value of ${localValue}: the Hub needs a local target's local value to equal ` +
        "the transaction's value and a remote target's to be 0, and the SDK's value is the message fee"
    )
  }
  const extraGasLimit = argument('extraGasLimit')
  if (functionName !== 'managerCall' && typeof extraGasLimit === 'bigint' && extraGasLimit > 0n) {
    throw new Error(
      `Hub.${functionName} carries an extra gas limit of ${extraGasLimit}, which the SDK adds to no message, so ` +
        'the fee would not cover it'
    )
  }
}

/**
 * The cross-chain messages the entity that owns the function declares for the call. `scope.batchRequestManager` is what
 * tells an order call, which sends a callback to the asset's chain, from any other `managerCall`.
 *
 * @throws Error when no entity builds the function, or the messages cannot be derived from the call's arguments.
 */
export function deriveHubCallMessages({ functionName, args }: ParsedHubCall, scope: HubCallScope): HubCallMessages {
  return derivationOf(functionName)(args, scope)
}

/** The function a call names and its arguments by position. */
function decodeHubCallArguments(data: HexString) {
  const selector = selectorOf(data)
  const hubFunction = HUB_FUNCTIONS.get(selector)
  if (!hubFunction) {
    throw new Error(`Hub call ${selector} is not a function of the v3.3 Hub`)
  }
  const decoded = decodeWithHubAbi(data)
  if (!decoded) throw new Error(`Hub call ${selector} does not decode with the v3.3 Hub ABI`)
  return { ...decoded, inputs: hubFunction.inputs }
}

/**
 * The function and the arguments by position of a call of the v3.3 Hub, or null when the selector is none of its
 * functions or the calldata does not decode. Unlike {@link parseHubCall} it checks nothing else and never throws for
 * the data it is given.
 */
export function peekHubCall(data: HexString): ParsedHubCall | null {
  return HUB_FUNCTIONS.has(selectorOf(data)) ? decodeWithHubAbi(data) : null
}

const selectorOf = (data: HexString) => data.slice(0, 10).toLowerCase()

function decodeWithHubAbi(data: HexString): ParsedHubCall | null {
  try {
    const { functionName, args } = decodeFunctionData({ abi: ABIS_V3_3.Hub, data })
    return { functionName: functionName as string, args: (args ?? []) as readonly unknown[] }
  } catch (error) {
    if (error instanceof BaseError) return null
    throw error
  }
}

function vaultUpdateKind(kind: number): VaultUpdateKind {
  if (kind !== VaultUpdateKind.DeployAndLink && kind !== VaultUpdateKind.Link && kind !== VaultUpdateKind.Unlink) {
    throw new Error(`Hub.updateVault has kind ${kind}, which is none of deploy and link, link and unlink`)
  }
  return kind
}

/**
 * A `Hub.managerCall` is one `ManagerCallFromHub` message to its destination, with the extra gas it carries. A call to
 * the pool's `BatchRequestManager` on the hub is read by its payload: an approval, issue or revoke sends a
 * `RequestCallback` to the chain of the asset it names, and a redeem approval sends nothing.
 */
function managerCallMessages(args: readonly any[], scope: HubCallScope): HubCallMessages {
  const [, centrifugeId, , payload, extraGasLimit] = args
  if (callsBatchRequestManager(args, scope)) return batchRequestManagerMessages(payload, scope)
  return to(centrifugeId, {
    ...messageV3_3(MessageTypeV3_3.ManagerCallFromHub, scope.poolId),
    ...(extraGasLimit > 0n ? { extraGasLimit } : {}),
  })
}

/** Whether the arguments of a `managerCall` send it to the pool's `BatchRequestManager` on its hub chain. */
export function callsBatchRequestManager([, centrifugeId, target]: readonly any[], scope: HubCallScope): boolean {
  return (
    centrifugeId === scope.poolId.centrifugeId &&
    (target as string).toLowerCase() === addressToBytes32(scope.batchRequestManager)
  )
}

const ORDER_CALL_LAYOUT: readonly AbiParameter[] = [
  { type: 'uint8' },
  { type: 'bytes16' },
  { type: 'uint128' },
  { type: 'uint32' },
  { type: 'uint128' },
  { type: 'uint128' },
]
const WITH_REFUND: readonly AbiParameter[] = [...ORDER_CALL_LAYOUT, { type: 'address' }]

/** The layout of each `BatchRequestManager` action the SDK builds; its third word is the asset. */
const ORDER_ACTIONS: Record<number, { layout: readonly AbiParameter[]; callback: boolean }> = {
  [BATCH_REQUEST_MANAGER_ACTION.approveDeposits]: { layout: WITH_REFUND, callback: true },
  [BATCH_REQUEST_MANAGER_ACTION.approveRedeems]: { layout: ORDER_CALL_LAYOUT, callback: false },
  [BATCH_REQUEST_MANAGER_ACTION.issueShares]: { layout: WITH_REFUND, callback: true },
  [BATCH_REQUEST_MANAGER_ACTION.revokeShares]: { layout: WITH_REFUND, callback: true },
}

/** A `BatchRequestManager` payload the SDK builds: which action it is, and the share class, asset and epoch it names. */
export type OrderCall = { action: number; scId: HexString; assetId: AssetId; epoch: number }

/** Decodes an approve, issue or revoke payload; null for any other payload. */
export function decodeOrderCall(payload: HexString): OrderCall | null {
  try {
    const [action] = decodeAbiParameters([{ type: 'uint8' }], payload)
    const known = ORDER_ACTIONS[action]
    if (!known) return null
    const [, scId, assetId, epoch] = decodeAbiParameters(known.layout as AbiParameter[], payload)
    return { action, scId: scId as HexString, assetId: new AssetId(assetId as bigint), epoch: Number(epoch) }
  } catch (error) {
    if (error instanceof BaseError) return null
    throw error
  }
}

function batchRequestManagerMessages(payload: HexString, scope: HubCallScope): HubCallMessages {
  const order = decodeOrderCall(payload)
  if (!order) {
    throw new Error(
      'Hub.managerCall to the BatchRequestManager carries a payload that is not an approve, issue or revoke ' +
        'the SDK builds, so its cross-chain messages cannot be derived'
    )
  }
  if (!ORDER_ACTIONS[order.action]!.callback) return {}
  return to(order.assetId.centrifugeId, poolMessage(MessageType.RequestCallback, scope))
}
