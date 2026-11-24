import { ABIS_V3_3 } from '@centrifuge/protocol'
import { firstValueFrom } from 'rxjs'
import { BaseError, ContractFunctionRevertedError, isAddressEqual, zeroAddress, type PublicClient } from 'viem'
import type { Centrifuge } from '../Centrifuge.js'
import { HubPolicyPreflightError } from '../errors.js'
import type { HexString } from '../types/index.js'
import type {
  OutOfPolicyCall,
  OutOfPolicyCallStatus,
  OutOfPolicyForbiddenReason,
  PolicyCall,
} from '../types/transaction.js'
import { HUB_FUNCTIONS } from '../utils/authorizationCalldata.js'
import { decodeHubCall } from '../utils/authorizationFold.js'
import { isSharePriceUpdate } from '../utils/hubExecutionRules.js'
import { isV3_3 } from '../utils/protocolVersion.js'
import { STD_HUB_POLICY_ABI } from '../utils/stdHubPolicy.js'
import type { PoolId } from '../utils/types.js'
import { latestTimestamp, readAccountingGuard, readExpiry } from './hubPolicyRead.js'
import { Pool } from './Pool.js'

/** What one pool's calls are judged against: the policy installed now, the hub chain's block time and its expiry. */
type PolicyState = {
  root: Centrifuge
  client: PublicClient
  hubRegistry: HexString
  policy: HexString
  /** The hub chain's latest block timestamp in unix seconds. */
  now: bigint
  /** Seconds a matured authorization stays consumable; null when unknown. Read on first use, once per pool. */
  expiryOf: () => Promise<bigint | null>
}

const FORBIDDEN_REASONS: ReadonlyMap<string, OutOfPolicyForbiddenReason> = new Map([
  ['CallerNotAllowed', 'callerNotAllowed'],
  ['OnchainAccountingOnly', 'accountingOnly'],
])

/**
 * The calls among `calls` that the pool's hub policy does not let through for `signer`, in order, each with why. A call
 * is ready when the policy answers a delay of zero, or when an authorization for exactly this calldata has matured and
 * not expired (the send consumes it). Each call is judged against the chain as it is now, not as an earlier call of the
 * batch leaves it.
 *
 * Per pool: one read of the installed policy and of the hub chain's block time. The policy's expiry is read only for a
 * call whose authorization has matured, the one case where it decides: from the contract, and from the index only when
 * the contract has no `expiry()` view. A pool with no policy installed is ready after the first read, and a pool below
 * v3.3 with no block or contract read.
 *
 * @throws HubPolicyPreflightError when a read fails: a failed read is never a ready call.
 */
export async function classifyHubCalls(
  root: Centrifuge,
  signer: HexString,
  calls: readonly PolicyCall[]
): Promise<OutOfPolicyCall[]> {
  const states = new Map<string, Promise<PolicyState | null>>()
  const stateOf = (poolId: PoolId) => {
    const key = poolId.toString()
    if (!states.has(key)) states.set(key, readPolicyState(root, poolId))
    return states.get(key)!
  }

  const verdicts = await Promise.all(
    calls.map(async ({ poolId, data }) => {
      const state = await stateOf(poolId)
      return state === null ? null : verdictOf(state, poolId, signer, data)
    })
  )
  return verdicts.filter((verdict): verdict is OutOfPolicyCall => verdict !== null)
}

/** The state to judge a pool's calls by, or null when no policy applies: a pool below v3.3, or none installed. */
async function readPolicyState(root: Centrifuge, poolId: PoolId): Promise<PolicyState | null> {
  const context = await guarded(poolId, 'the pool’s protocol version', () => root.protocolContext(poolId))
  if (!isV3_3(context)) return null

  const client = await guarded(poolId, 'the client of the hub chain', () => root.getClient(poolId.centrifugeId))
  const policy = (await guarded(poolId, 'the installed hub policy', () =>
    client.readContract({ address: context.hub, abi: ABIS_V3_3.Hub, functionName: 'policy', args: [poolId.raw] })
  )) as HexString
  if (policy === zeroAddress) return null

  const now = await guarded(poolId, 'the hub chain’s block time', () => latestTimestamp(root, poolId.centrifugeId))
  let expiry: Promise<bigint | null> | undefined
  const expiryOf = () =>
    (expiry ??= guarded(poolId, 'the hub policy’s expiry', () => readPolicyExpiry(root, poolId, policy)))
  return { root, client, hubRegistry: context.hubRegistry, policy, now, expiryOf }
}

/**
 * The contract's `expiry()`, an immutable that `readExpiry` keeps per chain and policy. The index answers only for a
 * policy with no such view, and only when its latest install is the installed policy: the index may lag or lead a
 * `setPolicy`, and another policy's expiry would misjudge every matured authorization.
 */
async function readPolicyExpiry(root: Centrifuge, poolId: PoolId, policy: HexString): Promise<bigint | null> {
  const fromContract = await readExpiry(root, poolId.centrifugeId, policy)
  if (fromContract !== null) return fromContract

  const indexed = await firstValueFrom(new Pool(root, poolId).hubExecutionPolicy())
  return indexed?.address?.toLowerCase() === policy.toLowerCase() ? indexed.expiry : null
}

async function verdictOf(
  state: PolicyState,
  poolId: PoolId,
  signer: HexString,
  data: HexString
): Promise<OutOfPolicyCall | null> {
  const described = decodeHubCall(HUB_FUNCTIONS, data)
  const forbidden = (reason: OutOfPolicyForbiddenReason): OutOfPolicyCall => ({
    data,
    ...described,
    status: 'forbidden',
    reason,
    delay: null,
    validAfter: null,
    expiresAt: null,
  })

  if (isSharePriceUpdate(described) && (await priceUpdatesRefused(state, poolId, signer))) {
    return forbidden('accountingOnly')
  }

  const delay = await delayOf(state, poolId, signer, data)
  if (typeof delay !== 'bigint') return forbidden(delay.forbidden)
  if (delay === 0n) return null

  const validAfter = await validAfterOf(state, poolId, data)
  const { status, expiresAt } = await judge(state, validAfter)
  if (status === 'ok') return null
  return { data, ...described, status, reason: null, delay, validAfter, expiresAt }
}

/**
 * Whether the policy refuses `signer` a share price update outright: under onchain accounting it takes only the
 * SimplePriceManager's. `authorizationDelay` does not check this (so a manager can schedule such an update), but the
 * send reverts `OnchainAccountingOnly`. A policy that cannot answer one of the two views keeps its own verdict.
 */
async function priceUpdatesRefused(state: PolicyState, poolId: PoolId, signer: HexString): Promise<boolean> {
  const guard = await guarded(poolId, 'who may update the share price', () =>
    readAccountingGuard(state.root, poolId.centrifugeId, state.policy)
  )
  return guard !== null && guard.onchainAccounting && !isAddressEqual(guard.simplePriceManager, signer)
}

/** The delay the policy puts on the call for `signer`; the reason when it refuses the call by reverting. */
async function delayOf(
  state: PolicyState,
  poolId: PoolId,
  signer: HexString,
  data: HexString
): Promise<bigint | { forbidden: OutOfPolicyForbiddenReason }> {
  try {
    const delay = await state.client.readContract({
      address: state.policy,
      abi: STD_HUB_POLICY_ABI,
      functionName: 'authorizationDelay',
      args: [poolId.raw, signer, data],
    })
    return BigInt(delay)
  } catch (error) {
    const revert =
      error instanceof BaseError ? error.walk((cause) => cause instanceof ContractFunctionRevertedError) : null
    if (revert instanceof ContractFunctionRevertedError) {
      return { forbidden: FORBIDDEN_REASONS.get(revert.data?.errorName ?? '') ?? 'other' }
    }
    throw failed(poolId, 'the delay of a call', error)
  }
}

/** When the call's authorization matures under the installed policy; null when none is scheduled. */
function validAfterOf(state: PolicyState, poolId: PoolId, data: HexString): Promise<bigint | null> {
  return guarded(poolId, 'the authorization of a call', async () => {
    const authId = await state.client.readContract({
      address: state.hubRegistry,
      abi: ABIS_V3_3.HubRegistry,
      functionName: 'authId',
      args: [poolId.raw, data],
    })
    const validAfter = await state.client.readContract({
      address: state.hubRegistry,
      abi: ABIS_V3_3.HubRegistry,
      functionName: 'authorizedAfter',
      args: [authId],
    })
    return validAfter === 0 ? null : BigInt(validAfter)
  })
}

/**
 * Where a delayed call stands. `ok` is a matured authorization within its expiry: the send consumes it. A matured one
 * whose expiry is unknown cannot be called ok or expired. The expiry is read only once the authorization has matured,
 * so `expiresAt` is null for any other status.
 */
async function judge(
  state: PolicyState,
  validAfter: bigint | null
): Promise<{ status: OutOfPolicyCallStatus | 'ok'; expiresAt: bigint | null }> {
  if (validAfter === null) return { status: 'needs-authorization', expiresAt: null }
  if (state.now < validAfter) return { status: 'pending', expiresAt: null }

  const expiry = await state.expiryOf()
  if (expiry === null) return { status: 'undetermined', expiresAt: null }
  const expiresAt = validAfter + expiry
  return { status: state.now <= expiresAt ? 'ok' : 'expired', expiresAt }
}

async function guarded<T>(poolId: PoolId, what: string, read: () => Promise<T> | T): Promise<T> {
  try {
    return await read()
  } catch (error) {
    throw failed(poolId, what, error)
  }
}

function failed(poolId: PoolId, what: string, error: unknown): HubPolicyPreflightError {
  const reason =
    error instanceof BaseError ? error.shortMessage : error instanceof Error ? error.message : String(error)
  return new HubPolicyPreflightError(
    `Pool ${poolId} was not checked against its hub policy and this hub transaction was not signed or sent: ` +
      `reading ${what} failed: ${reason}`,
    { cause: error }
  )
}
