import { ABIS_V3_3 } from '@centrifuge/protocol'
import type { HubPolicyRow, PoolAuthorizationEventRow } from '@centrifuge/queries/core'
import { combineLatest, defer, filter, of, startWith, switchMap, type Observable } from 'rxjs'
import { BaseError, zeroAddress } from 'viem'
import type { Centrifuge } from '../Centrifuge.js'
import { AuthorizationFoldError } from '../errors.js'
import type { HexString } from '../types/index.js'
import {
  AUTHORIZATION_EVENT_KIND,
  foldAuthorizations,
  hubInstallsOf,
  policyNeedingExpiry,
  type PoolAuthorizationList,
} from '../utils/authorizationFold.js'
import { isNoAnswer } from '../utils/adapters.js'
import { Price } from '../utils/BigInt.js'
import { isV3_3 } from '../utils/protocolVersion.js'
import { STD_HUB_POLICY_ABI } from '../utils/stdHubPolicy.js'
import type { CentrifugeId } from '../utils/types.js'
import type { Pool } from './Pool.js'

/**
 * The policy installed on a pool's hub and the parameters its contract was deployed with. A parameter that is null was
 * not published, which is not 0 or false: `0` turns the two price guards off and demands an exact match for
 * `maxBrmPriceDeviation`, and `false` is a real `isRestrictionUpdateInstant`. Show a null as nothing and raise no
 * alert.
 */
export interface HubExecutionPolicy {
  /** The policy contract; null when the install log carried no address, which leaves the policy unknown. */
  address: HexString | null
  /**
   * The install's place among the pool's installs on the hub chain, from 1. It equals `HubRegistry.policyNonce` when
   * the indexed history is complete.
   */
  installNumber: number
  /** Seconds an out-of-policy call waits after it is scheduled. */
  delay: bigint | null
  /** Seconds a matured authorization stays consumable. */
  expiry: bigint | null
  /** Seconds `setPolicy` and `setSpokePolicy` wait instead of `delay`. */
  escalation: bigint | null
  /** Share price move that takes `updateSharePrice` out of policy, in price units; `0` turns the guard off. */
  maxAbsolutePriceDelta: Price | null
  /** Share price move per second since the last update that takes it out of policy; `0` turns the guard off. */
  thresholdPerSecond: Price | null
  /**
   * Relative deviation a request manager call may have from the committed price: `1e18` is 100%, `0` demands an exact
   * match and `2^128 - 1` turns the guard off.
   */
  maxBrmPriceDeviation: bigint | null
  /** True when every `updateRestriction` runs without a delay, false when only a canonical Freeze does. */
  isRestrictionUpdateInstant: boolean | null
  /**
   * True when accounting calls may come only from the NAVManager and share price updates only from the
   * SimplePriceManager.
   */
  onchainAccounting: boolean | null
}

/** The read behind `Pool.hubExecutionPolicy`. */
export function readHubExecutionPolicy(root: Centrifuge, pool: Pool): Observable<HubExecutionPolicy | null> {
  return onV3_3(root, pool, null, (events, parameters) => defer(() => policyOf(root, pool, events, parameters)))
}

/** The read behind `Pool.authorizations`. */
export function readAuthorizations(root: Centrifuge, pool: Pool): Observable<PoolAuthorizationList> {
  return onV3_3(root, pool, { items: [], skipped: [] }, (events, parameters) =>
    defer(() => authorizationsOf(root, pool, events, parameters))
  )
}

/**
 * Runs `read` over the pool's two policy queries, or answers `otherwise` without a query on a pool below v3.3. A
 * refresh of the pool subscribes the queries again, so a running subscription fetches them anew.
 */
function onV3_3<T>(
  root: Centrifuge,
  pool: Pool,
  otherwise: T,
  read: (events: PoolAuthorizationEventRow[], parameters: HubPolicyRow[]) => Observable<T>
): Observable<T> {
  const poolId = pool.id.toString()
  return root._hubPolicyRefreshes$.pipe(
    filter((refreshed) => refreshed === poolId),
    startWith(poolId),
    switchMap(() => root.protocolContext(pool.id)),
    switchMap((ctx) =>
      isV3_3(ctx)
        ? combineLatest([
            root._queryData<PoolAuthorizationEventRow[]>('poolAuthorizationEvents', { poolId }),
            root._queryData<HubPolicyRow[]>('hubPolicies', { poolId }),
          ]).pipe(switchMap(([events, parameters]) => read(events, parameters)))
        : of(otherwise)
    )
  )
}

/**
 * What {@link Pool.refreshHubPolicyReads} does: clears the keys of the two reads and of their indexer queries, then
 * signals the running subscriptions.
 */
export function refreshHubPolicyReads(root: Centrifuge, pool: Pool): void {
  const poolId = pool.id.toString()
  // The indexer queries go first, so whoever re-reads on a signal for the reads above them finds neither cached.
  for (const keys of [
    ['poolAuthorizationEvents', { poolId }],
    ['hubPolicies', { poolId }],
    ['pool', poolId, 'authorizations'],
    ['pool', poolId, 'hubExecutionPolicy'],
  ]) {
    root.clearQueryCache(keys)
  }
  root._signalHubPolicyRefresh(poolId)
}

const UNPUBLISHED = {
  delay: null,
  expiry: null,
  escalation: null,
  maxAbsolutePriceDelta: null,
  thresholdPerSecond: null,
  maxBrmPriceDeviation: null,
  isRestrictionUpdateInstant: null,
  onchainAccounting: null,
} as const

async function policyOf(
  root: Centrifuge,
  pool: Pool,
  events: PoolAuthorizationEventRow[],
  policyRows: HubPolicyRow[]
): Promise<HubExecutionPolicy | null> {
  const install = hubInstallsOf(events, policyRows).at(-1)
  if (!install || install.policy === zeroAddress) return null
  if (install.policy === null) return { address: null, installNumber: install.installNumber, ...UNPUBLISHED }

  const address = install.policy as HexString
  const row = install.parameters
  return {
    address,
    installNumber: install.installNumber,
    delay: optionalNumeric(row?.delay, 'delay'),
    expiry: row?.expiry != null ? numeric(row.expiry, 'expiry') : await readExpiry(root, pool.centrifugeId, address),
    escalation: optionalNumeric(row?.escalation, 'escalation'),
    maxAbsolutePriceDelta: priceOf(row?.maxAbsolutePriceDelta, 'maxAbsolutePriceDelta'),
    thresholdPerSecond: priceOf(row?.thresholdPerSecond, 'thresholdPerSecond'),
    maxBrmPriceDeviation: optionalNumeric(row?.maxBrmPriceDeviation, 'maxBrmPriceDeviation'),
    isRestrictionUpdateInstant: row?.isRestrictionUpdateInstant ?? null,
    onchainAccounting: row?.onchainAccounting ?? null,
  }
}

async function authorizationsOf(
  root: Centrifuge,
  pool: Pool,
  events: PoolAuthorizationEventRow[],
  policyParameters: HubPolicyRow[]
): Promise<PoolAuthorizationList> {
  const hubAbi = ABIS_V3_3.Hub
  const hasScheduling = events.some((row) => row.eventKind === AUTHORIZATION_EVENT_KIND.scheduled)
  if (!hasScheduling) return foldAuthorizations({ events, policyParameters, hubAbi, now: 0n })

  const policy = policyNeedingExpiry(hubInstallsOf(events, policyParameters))
  const [now, expiry] = await Promise.all([
    latestTimestamp(root, pool.centrifugeId),
    policy === null ? null : readExpiry(root, pool.centrifugeId, policy as HexString),
  ])
  const contractExpiries = policy !== null && expiry !== null ? new Map([[policy, expiry]]) : undefined
  return foldAuthorizations({ events, policyParameters, hubAbi, now, contractExpiries })
}

/** The latest block timestamp of a chain, in unix seconds. */
export async function latestTimestamp(root: Centrifuge, centrifugeId: CentrifugeId): Promise<bigint> {
  return (await (await root.getClient(centrifugeId)).getBlock()).timestamp
}

/**
 * `expiry()` of a policy in seconds, null for a contract that answers none. It is an immutable, so a successful answer
 * is kept per chain and policy (a failed read is not).
 */
export function readExpiry(root: Centrifuge, centrifugeId: CentrifugeId, address: HexString) {
  return root._query(
    ['stdHubPolicyExpiry', centrifugeId, address],
    () =>
      defer(async () => {
        try {
          const client = await root.getClient(centrifugeId)
          return BigInt(await client.readContract({ address, abi: STD_HUB_POLICY_ABI, functionName: 'expiry' }))
        } catch (error) {
          if (error instanceof BaseError && error.walk(isNoAnswer) !== null) return null
          throw error
        }
      }),
    { observableCacheTime: Infinity }
  )
}

/**
 * Who a policy lets update the share price: `onchainAccounting()` and `simplePriceManager()`, null for a contract that
 * answers either of them with a revert or no data. Both are immutables, so an answer is kept per chain and policy, null
 * included, as `readExpiry` keeps its own: a null only leaves the verdict of `authorizationDelay`, which the chain's
 * own revert settles. A failed read is not kept.
 */
export function readAccountingGuard(root: Centrifuge, centrifugeId: CentrifugeId, address: HexString) {
  return root._query(
    ['stdHubPolicyAccountingGuard', centrifugeId, address],
    () =>
      defer(async (): Promise<{ onchainAccounting: boolean; simplePriceManager: HexString } | null> => {
        try {
          const client = await root.getClient(centrifugeId)
          const [onchainAccounting, simplePriceManager] = await Promise.all([
            client.readContract({ address, abi: STD_HUB_POLICY_ABI, functionName: 'onchainAccounting' }),
            client.readContract({ address, abi: STD_HUB_POLICY_ABI, functionName: 'simplePriceManager' }),
          ])
          return { onchainAccounting, simplePriceManager }
        } catch (error) {
          if (error instanceof BaseError && error.walk(isNoAnswer) !== null) return null
          throw error
        }
      }),
    { observableCacheTime: Infinity }
  )
}

/** A numeric(78,0) column the API returns as a decimal string. */
function numeric(value: string, name: string): bigint {
  if (!/^\d+$/.test(value)) throw new AuthorizationFoldError(`${name} is not a whole number: ${value}`)
  return BigInt(value)
}

const optionalNumeric = (value: string | null | undefined, name: string) =>
  value == null ? null : numeric(value, name)

const priceOf = (value: string | null | undefined, name: string) =>
  value == null ? null : new Price(numeric(value, name))
