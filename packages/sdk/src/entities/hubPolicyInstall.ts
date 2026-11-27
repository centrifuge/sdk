import { ABIS_V3_3 } from '@centrifuge/protocol'
import {
  BaseError,
  encodeFunctionData,
  getAddress,
  isAddress,
  maxUint128,
  maxUint48,
  parseEventLogs,
  zeroAddress,
  type Log,
  type PublicClient,
} from 'viem'
import type { SdkProtocolContext } from '../Centrifuge.js'
import { StdHubPolicyFactoryMissingError } from '../errors.js'
import type { HexString } from '../types/index.js'
import { isNoAnswer } from '../utils/adapters.js'
import { addressesEqual, validateAddress } from '../utils/addresses.js'
import { Price } from '../utils/BigInt.js'
import type { ParsedHubCall } from '../utils/hubCallMessages.js'
import { isSetPolicy } from '../utils/hubExecutionRules.js'
import { STD_HUB_POLICY_ABI } from '../utils/stdHubPolicy.js'
import { ShareClassId } from '../utils/types.js'
import type { Pool } from './Pool.js'

/** One caller confined to a set of Hub function selectors for a pool. Each caller must be an address; the rest passes through. */
export interface HubPolicyAllowlistEntry {
  /** The pool the confinement applies to. A `uint64`. */
  poolId: bigint
  /** The caller confined to `selectors`. */
  caller: HexString
  /** The four-byte selectors the caller may call. */
  selectors: HexString[]
}

/**
 * `IStdHubPolicy.Config`, field for field in the contract's order: the factory derives the policy's address from the
 * hash of the encoded struct, so a different value anywhere is a different policy. Every parameter is fixed when the
 * policy is deployed.
 *
 * @remarks `pool.hubExecutionPolicy()` reports `maxAbsolutePriceDelta` and `thresholdPerSecond` as `Price`; this config
 * takes them as `bigint`, so pass `price.toBigInt()`.
 */
export interface HubPolicyConfig {
  /** Seconds a call the policy delays waits after it is scheduled. A `uint48`, greater than 0. */
  delay: bigint
  /** Seconds a matured authorization stays consumable. A `uint48`, greater than 0. */
  expiry: bigint
  /** Seconds replacing the policy waits instead of `delay`. A `uint48`, greater than `delay`. */
  escalation: bigint
  /** Callers confined to a set of selectors. The SDK offers no way to build it and passes it through. */
  allowlist: HubPolicyAllowlistEntry[]
  /** The chain's NAV manager. With `onchainAccounting` it must be the one `pool.hubPolicyDependencies()` reports. */
  navManager: HexString
  /** True when accounting calls may come only from the NAV manager and share price updates only from the price manager. */
  onchainAccounting: boolean
  /** True when every `updateRestriction` runs without a delay, false when only a canonical Freeze does. */
  isRestrictionUpdateInstant: boolean
  /** Share price move per second since the last update that takes `updateSharePrice` out of policy, in D18 price units. `0` turns the guard off. A `uint128`. */
  thresholdPerSecond: bigint
  /** Relative deviation a request manager call may have from the committed price: `1e18` is 100%, `0` demands an exact match and `2^128 - 1` turns the guard off. A `uint128`. */
  maxBrmPriceDeviation: bigint
  /** Share price move that takes `updateSharePrice` out of policy, in D18 price units. `0` turns the guard off. A `uint128`. */
  maxAbsolutePriceDelta: bigint
  /** The chain's price manager. With `onchainAccounting` it must be the one `pool.hubPolicyDependencies()` reports. */
  simplePriceManager: HexString
  /** The pool's request manager on its hub chain (`HubRegistry.hubRequestManager`), or zero for none. */
  requestManager: HexString
  /** The pool's bridging hook, or zero for none. */
  bridgingHook: HexString
  /** The oracle valuation the policy lets update a holding value, or zero for none. */
  oracleValuation: HexString
}

/** The address a config deploys to, and whether a policy is already there. */
export interface HubPolicyPreview {
  /** The address the factory deploys the config's policy at. */
  address: HexString
  /** True when the address holds code, so deploying the same config again would send nothing. */
  deployed: boolean
}

/** The price a share class last committed on the hub. */
export interface HubPolicyCommittedPrice {
  /** The share class the price belongs to. */
  shareClassId: ShareClassId
  /** `ShareClassManager.pricePoolPerShare`, the price the policy's guards measure moves from. */
  price: Price
  /** Unix seconds the price was computed at; `0n` for a share class that never committed one. */
  computedAt: bigint
}

/** What a policy for the pool is built from, as the hub chain holds it. */
export interface HubPolicyDependencies {
  /** `HubRegistry.hubRequestManager(poolId, hubCentrifugeId)`: the pool's request manager on its hub chain, zero for none. */
  requestManager: HexString
  /** `HubRegistry.bridgingHook(poolId)`, zero for none. */
  bridgingHook: HexString
  /** The chain's NAV manager. */
  navManager: HexString
  /** The chain's price manager. */
  simplePriceManager: HexString
  /** The chain's oracle valuation, zero where it lists none. */
  oracleValuation: HexString
  /** True when the pool's NAV hook is the price manager, so its share price is computed onchain. */
  usesOnchainNav: boolean
  /** One entry per share class, in share class order. */
  committedPrices: HubPolicyCommittedPrice[]
  /** `Hub.policy(poolId)`, the zero address when none is installed. */
  installedPolicy: HexString
}

/** The two reads of a hub chain client, whether it came from the root or from a transaction's context. */
type ReadClient = { getCode: PublicClient['getCode']; readContract: PublicClient['readContract'] }

const DURATIONS = ['delay', 'expiry', 'escalation'] as const
const GUARDS = ['thresholdPerSecond', 'maxBrmPriceDeviation', 'maxAbsolutePriceDelta'] as const
const ADDRESSES = ['navManager', 'simplePriceManager', 'requestManager', 'bridgingHook', 'oracleValuation'] as const
const DEPENDENCIES = ['hub', 'hubRegistry', 'multiAdapter', 'shareClassManager'] as const

const isZero = (address: string) => address.toLowerCase() === zeroAddress

/**
 * `value` checksummed. A value that is no address is refused, and so is a mixed-case address whose checksum is wrong,
 * which is a typo. Lower and upper case carry no checksum and pass.
 */
function checksummed(value: string, label: string): HexString {
  validateAddress(value, label)
  const digits = value.slice(2)
  const mixedCase = digits !== digits.toLowerCase() && digits !== digits.toUpperCase()
  if (mixedCase && !isAddress(value, { strict: true }))
    throw new Error(`Invalid ${label}: ${value} has a wrong checksum`)
  return getAddress(value.toLowerCase())
}

function assertUint(method: string, config: HubPolicyConfig, field: (typeof DURATIONS | typeof GUARDS)[number]) {
  const [max, type] = (DURATIONS as readonly string[]).includes(field) ? [maxUint48, 'uint48'] : [maxUint128, 'uint128']
  const value: unknown = config[field]
  if (typeof value !== 'bigint') throw new Error(`${method}: ${field} must be a bigint, got ${typeof value}`)
  if (value < 0n || value > max) throw new Error(`${method}: ${field} must fit a ${type} (0 to ${max}), got ${value}`)
}

/**
 * Refuses, reading nothing, a config the policy constructor reverts on (`InvalidConfig`), one whose values the encoder
 * would wrap or reject, an address or an allowlist caller that is none or has a wrong checksum, and `onchainAccounting`
 * with no NAV manager or price manager.
 *
 * @throws Error naming `method` and the field.
 */
export function assertHubPolicyConfig(method: string, config: HubPolicyConfig): void {
  for (const field of [...DURATIONS, ...GUARDS]) assertUint(method, config, field)
  for (const field of ADDRESSES) checksummed(config[field], `${method} ${field}`)
  config.allowlist.forEach(({ caller }, index) => checksummed(caller, `${method} allowlist[${index}] caller`))
  if (config.delay === 0n) throw new Error(`${method}: delay must be greater than 0`)
  if (config.expiry === 0n) throw new Error(`${method}: expiry must be greater than 0`)
  if (config.escalation <= config.delay) {
    throw new Error(
      `${method}: escalation must be greater than the delay, got escalation ${config.escalation} and delay ${config.delay}`
    )
  }
  if (!config.onchainAccounting) return
  if (isZero(config.navManager))
    throw new Error(`${method}: onchainAccounting needs a navManager, got the zero address`)
  if (isZero(config.simplePriceManager)) {
    throw new Error(`${method}: onchainAccounting needs a simplePriceManager, got the zero address`)
  }
}

/**
 * Under `onchainAccounting` the policy confines accounting calls to its `navManager` and share price updates to its
 * `simplePriceManager`, so another address than the chain's locks the real managers out until the policy is replaced.
 */
function assertChainManagers(method: string, hubCtx: SdkProtocolContext, config: HubPolicyConfig) {
  if (!config.onchainAccounting) return
  for (const field of ['navManager', 'simplePriceManager'] as const) {
    if (addressesEqual(config[field], hubCtx[field])) continue
    throw new Error(
      `${method}: onchainAccounting needs the chain's ${field} ${hubCtx[field]}, got ${config[field]}. ` +
        'Use the one Pool.hubPolicyDependencies reports'
    )
  }
}

/**
 * A policy bounds a `managerCall` to its own request manager by `maxBrmPriceDeviation`, lets a `SetPaused` to its
 * bridging hook through, and delays every other target. One built with another request manager delays every call to the
 * pool's own and bounds calls to that address, and the zero address delays every `managerCall` to it, until the policy
 * is replaced.
 */
async function assertRequestManager(
  method: string,
  pool: Pool,
  hubCtx: SdkProtocolContext,
  client: ReadClient,
  config: HubPolicyConfig
) {
  if (isZero(config.requestManager)) return
  const held = await client.readContract({
    address: hubCtx.hubRegistry,
    abi: ABIS_V3_3.HubRegistry,
    functionName: 'hubRequestManager',
    args: [pool.id.raw, pool.centrifugeId],
  })
  if (addressesEqual(held, config.requestManager)) return
  throw new Error(
    `${method}: requestManager ${config.requestManager} is not the pool's request manager on its hub chain, ${held}. ` +
      'Use the one Pool.hubPolicyDependencies reports, or the zero address for none'
  )
}

/**
 * The hub chain's factory, once the config is well formed and, unless its request manager is the zero address, names
 * the pool's own, and with `onchainAccounting` the chain's own NAV and price managers.
 *
 * @throws StdHubPolicyFactoryMissingError where the address book lists no factory.
 * @throws Error naming `method` and what the config gets wrong.
 */
export async function assertDeployable(
  method: string,
  pool: Pool,
  hubCtx: SdkProtocolContext,
  client: ReadClient,
  config: HubPolicyConfig
): Promise<HexString> {
  const factory = hubCtx.stdHubPolicyFactory
  if (!factory) {
    throw new StdHubPolicyFactoryMissingError(
      `${method}: no StdHubPolicyFactory for centrifugeId ${pool.centrifugeId} at protocol ${hubCtx.protocolVersion}: the address book lists none for this chain`,
      { poolId: pool.id.toString(), centrifugeId: pool.centrifugeId }
    )
  }
  assertHubPolicyConfig(method, config)
  assertChainManagers(method, hubCtx, config)
  await assertRequestManager(method, pool, hubCtx, client, config)
  return factory
}

/**
 * The struct the factory hashes, from a config `assertHubPolicyConfig` accepted. A `uint48` is a number to viem, which a
 * validated value always fits, and viem accepts an address only in lower case or checksummed.
 */
function structOf(config: HubPolicyConfig) {
  const address = (value: HexString) => getAddress(value.toLowerCase())
  return {
    delay: Number(config.delay),
    expiry: Number(config.expiry),
    escalation: Number(config.escalation),
    allowlist: config.allowlist.map(({ poolId, caller, selectors }) => ({
      poolId,
      caller: address(caller),
      selectors,
    })),
    navManager: address(config.navManager),
    onchainAccounting: config.onchainAccounting,
    isRestrictionUpdateInstant: config.isRestrictionUpdateInstant,
    thresholdPerSecond: config.thresholdPerSecond,
    maxBrmPriceDeviation: config.maxBrmPriceDeviation,
    maxAbsolutePriceDelta: config.maxAbsolutePriceDelta,
    simplePriceManager: address(config.simplePriceManager),
    requestManager: address(config.requestManager),
    bridgingHook: address(config.bridgingHook),
    oracleValuation: address(config.oracleValuation),
  }
}

async function hasCode(client: ReadClient, address: HexString): Promise<boolean> {
  const code = await client.getCode({ address })
  return code !== undefined && code !== '0x'
}

/** The address the factory derives from `config`, and whether code is there already. */
export async function previewHubPolicyAt(
  client: ReadClient,
  factory: HexString,
  config: HubPolicyConfig
): Promise<HubPolicyPreview> {
  const address = await client.readContract({
    address: factory,
    abi: ABIS_V3_3.StdHubPolicyFactory,
    functionName: 'previewHubPolicy',
    args: [structOf(config)],
  })
  return { address, deployed: await hasCode(client, address) }
}

/** `StdHubPolicyFactory.newHubPolicy(config)`. */
export const encodeNewHubPolicy = (config: HubPolicyConfig): HexString =>
  encodeFunctionData({ abi: ABIS_V3_3.StdHubPolicyFactory, functionName: 'newHubPolicy', args: [structOf(config)] })

/**
 * The policy the factory's `DeployHubPolicy` event in the receipt names, checked against the address previewed: the
 * address that is installed next must be the one the config derived.
 *
 * @throws Error when the receipt has no such event from the factory, or it names another address.
 */
export function deployedPolicyOf(
  method: string,
  logs: readonly Log[],
  factory: HexString,
  previewed: HexString,
  hash: HexString
): HexString {
  const ofFactory = logs.filter((log) => addressesEqual(log.address, factory))
  const [event] = parseEventLogs({ abi: ABIS_V3_3.StdHubPolicyFactory, eventName: 'DeployHubPolicy', logs: ofFactory })
  if (!event) {
    throw new Error(
      `${method}: transaction ${hash} confirmed but its receipt has no DeployHubPolicy event of ${factory}`
    )
  }
  if (!addressesEqual(event.args.policy, previewed)) {
    throw new Error(
      `${method}: transaction ${hash} deployed ${event.args.policy}, not the ${previewed} the factory previewed for this config`
    )
  }
  return event.args.policy
}

/** A view of a policy, null for a contract that answers it with a revert or no data. */
async function readDependency(client: ReadClient, policy: HexString, functionName: (typeof DEPENDENCIES)[number]) {
  try {
    return await client.readContract({ address: policy, abi: STD_HUB_POLICY_ABI, functionName })
  } catch (error) {
    if (error instanceof BaseError && error.walk(isNoAnswer) !== null) return null
    throw error
  }
}

/**
 * The checksummed `policy`, after refusing an address a pool must not install: one that is no address or has a wrong
 * checksum, the zero address (which clears the policy), one with no code, the policy installed now (the install would
 * orphan the pending authorizations for nothing), or a policy whose `hub()`, `hubRegistry()`, `multiAdapter()` or
 * `shareClassManager()` are not the pool's, or that fails to answer any one of them. Reads the chain, never signs.
 *
 * @throws Error naming `method`, the address and what is wrong.
 */
export async function assertInstallable(
  method: string,
  pool: Pool,
  hubCtx: SdkProtocolContext,
  client: ReadClient,
  policy: HexString
): Promise<HexString> {
  const address = checksummed(policy, `${method} policy`)
  if (isZero(address)) throw new Error(`${method}: the zero address would clear the pool's policy, not install one`)
  if (!(await hasCode(client, address))) {
    throw new Error(
      `${method}: ${address} has no code on centrifugeId ${pool.centrifugeId}; deploy it first with Pool.deployHubPolicy`
    )
  }
  const [installed, ...answers] = await Promise.all([
    client.readContract({ address: hubCtx.hub, abi: ABIS_V3_3.Hub, functionName: 'policy', args: [pool.id.raw] }),
    ...DEPENDENCIES.map((name) => readDependency(client, address, name)),
  ])
  if (addressesEqual(installed, address)) {
    throw new Error(
      `${method}: ${address} is the policy installed already, and installing it again orphans the pool's pending authorizations`
    )
  }
  DEPENDENCIES.forEach((name, index) => {
    const answered = answers[index]!
    if (answered === null) {
      throw new Error(`${method}: the contract at ${address} fails to answer ${name}(), so it is not a StdHubPolicy`)
    }
    if (!addressesEqual(answered, hubCtx[name])) {
      throw new Error(
        `${method}: the policy at ${address} was built for another deployment of the protocol: its ${name}() is ${answered}, this pool's is ${hubCtx[name]}`
      )
    }
  })
  return address
}

/**
 * {@link assertInstallable} for the address each `setPolicy` call of a group names, before any call of the group is
 * signed or scheduled. The zero address passes: it removes the policy, which the protocol allows and only
 * `installHubPolicy` refuses.
 */
export async function assertGroupInstalls(
  method: string,
  pool: Pool,
  hubCtx: SdkProtocolContext,
  client: ReadClient,
  calls: readonly ParsedHubCall[]
): Promise<void> {
  await Promise.all(
    calls
      .filter(isSetPolicy)
      .filter((call) => !isZero(call.args[1] as string))
      .map((call) => assertInstallable(method, pool, hubCtx, client, call.args[1] as HexString))
  )
}

/** What {@link Pool.hubPolicyDependencies} answers: every read is on the pool's hub chain. */
export async function readHubPolicyDependencies(
  pool: Pool,
  hubCtx: SdkProtocolContext,
  client: ReadClient
): Promise<HubPolicyDependencies> {
  const poolId = pool.id.raw
  const shareClassCount = await client.readContract({
    address: hubCtx.shareClassManager,
    abi: ABIS_V3_3.ShareClassManager,
    functionName: 'shareClassCount',
    args: [poolId],
  })
  const shareClassIds = Array.from({ length: shareClassCount }, (_, index) => ShareClassId.from(pool.id, index + 1))
  const [requestManager, bridgingHook, navHook, installedPolicy, prices] = await Promise.all([
    client.readContract({
      address: hubCtx.hubRegistry,
      abi: ABIS_V3_3.HubRegistry,
      functionName: 'hubRequestManager',
      args: [poolId, pool.centrifugeId],
    }),
    client.readContract({
      address: hubCtx.hubRegistry,
      abi: ABIS_V3_3.HubRegistry,
      functionName: 'bridgingHook',
      args: [poolId],
    }),
    client.readContract({
      address: hubCtx.navManager,
      abi: ABIS_V3_3.NAVManager,
      functionName: 'navHook',
      args: [poolId],
    }),
    client.readContract({ address: hubCtx.hub, abi: ABIS_V3_3.Hub, functionName: 'policy', args: [poolId] }),
    Promise.all(
      shareClassIds.map((shareClassId) =>
        client.readContract({
          address: hubCtx.shareClassManager,
          abi: ABIS_V3_3.ShareClassManager,
          functionName: 'pricePoolPerShare',
          args: [poolId, shareClassId.raw],
        })
      )
    ),
  ])

  return {
    requestManager,
    bridgingHook,
    navManager: hubCtx.navManager,
    simplePriceManager: hubCtx.simplePriceManager,
    oracleValuation: hubCtx.oracleValuation ?? zeroAddress,
    usesOnchainNav: addressesEqual(navHook, hubCtx.simplePriceManager),
    committedPrices: shareClassIds.map((shareClassId, index) => {
      const [price, computedAt] = prices[index]!
      return { shareClassId, price: new Price(price), computedAt }
    }),
    installedPolicy,
  }
}
