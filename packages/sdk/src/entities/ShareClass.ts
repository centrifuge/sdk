import {
  catchError,
  combineLatest,
  defer,
  distinctUntilChanged,
  EMPTY,
  expand,
  filter,
  firstValueFrom,
  map,
  merge,
  of,
  switchMap,
  timer,
} from 'rxjs'
import {
  BaseError,
  ContractFunctionRevertedError,
  encodeFunctionData,
  encodePacked,
  getContract,
  hexToBigInt,
  zeroAddress,
} from 'viem'
import {
  ABIS_V3_3,
  builders,
  encodeBatchRequestManagerPayload,
  encodeShareTokenRegistrarPayload,
  encodeSyncManagerPayload,
  PROTOCOL_VERSION_V3_3,
  STANDARD_ABIS,
  UnsupportedForProtocolVersionError,
  type BatchRequestManagerPayload,
} from '@centrifuge/protocol'
import type {
  EpochInvestOrderRow,
  EpochRedeemOrderRow,
  HoldingEscrowRow,
  InvestOrderRow,
  InvestOrderState,
  PageInfo,
  RedeemOrderRow,
  RedeemOrderState,
  ShareManagerCallRow,
  TokenInstancePositionRow,
  TokenInstanceRow,
  VaultRow,
  WhitelistedInvestorRow,
  WhitelistedInvestorsPage,
} from '@centrifuge/queries/core'
import type { Centrifuge, SdkProtocolContext } from '../Centrifuge.js'
import { AccountType } from '../types/holdings.js'
import { HexString } from '../types/index.js'
import {
  MessageType,
  MessageTypeV3_3,
  MessageTypeWithSubType,
  messageV3_3,
  type TransactionContext,
} from '../types/transaction.js'
import type { Query } from '../types/query.js'
import { convertToEvmAddress } from '../utils/addresses.js'
import { AddressMap } from '../utils/AddressMap.js'
import { Balance, Price } from '../utils/BigInt.js'
import {
  addMessageForEnabledTarget,
  assertCrosschainMessagingEnabled,
  filterCrosschainEnabledTargets,
  isCrosschainMessagingDisabled,
} from '../utils/crosschainHotfix.js'
import { addressToBytes32, encode, randomUint } from '../utils/index.js'
import {
  balanceSheetAddress,
  builderContext,
  encodeHubManagerCall,
  isV3_3,
  refuseOnV3_3,
  requireContract,
  spokeReadTarget,
} from '../utils/protocolVersion.js'
import type { OrderKind } from '../utils/orderSettlements.js'
import { repeatOnEvents } from '../utils/rx.js'
import { doTransaction, mergeMessages, wrapTransaction } from '../utils/transaction.js'
import { AssetId, CentrifugeId, PoolId, ShareClassId } from '../utils/types.js'
import {
  bridgeAuthorizationKey,
  bridgeLimitRefusal,
  circuitBreakerKey,
  circuitBreakerLimit,
  type BridgeLimit,
} from '../utils/bridgeLimit.js'
import { BridgeLimitError, BridgeNotEnabledError, InvalidBridgeChainError, type BridgeLimitReason } from '../errors.js'
import { BalanceSheet } from './BalanceSheet.js'
import { Entity } from './Entity.js'
import type { Pool } from './Pool.js'
import { assetDecimalsByAssetId } from '../utils/assetDecimals.js'
import { notifyAssetPriceCall, PoolNetwork, VaultManagerTrustedCall } from './PoolNetwork.js'
import { Vault } from './Vault.js'

const GAS_LIMIT = 30_000_000n
const ESTIMATE_PER_MESSAGE = 700_000n
const ESTIMATE_PER_MESSAGE_IF_LOCAL = 360_000n

/**
 * How many claim notifications fit beside the `hubMessages` cross-chain messages the hub batch already sends for an
 * asset, out of the asset's share of `GAS_LIMIT` among the `assetsSettling` assets that issue or revoke. A message costs
 * less when the asset lives on the pool's hub chain.
 * @internal
 */
export function claimNotificationBudget(
  assetId: AssetId,
  hubCentrifugeId: CentrifugeId,
  assetsSettling: number,
  hubMessages: number
): number {
  const perMessage = assetId.centrifugeId === hubCentrifugeId ? ESTIMATE_PER_MESSAGE_IF_LOCAL : ESTIMATE_PER_MESSAGE
  const gasLeft = GAS_LIMIT / BigInt(assetsSettling) - BigInt(hubMessages) * perMessage
  return gasLeft > 0n ? Number(gasLeft / perMessage) : 0
}

/**
 * The `validUntil` the management app uses for "membership never expires",
 * `type(uint32).max`, and the value the backend's `op: "add"` sugar resolves to
 * (`MEMBERSHIP_NEVER_EXPIRES` in `apps/private-api`).
 *
 * Named here so the backend payload can tell a grant from a scheduled expiry
 * without consulting a clock: the builder must be pure, and preview, prepare
 * and Fordefi's re-derivation all have to produce the same bytes.
 */
const MEMBERSHIP_NEVER_EXPIRES = 4294967295

/** Options every restriction-hook write takes. */
export interface RestrictionWriteOptions {
  /**
   * Where unspent cross-chain gas is returned.
   *
   * Required in backend mode and ignored on the local path, which keeps using
   * the signing address exactly as before. The backend cannot default it: it
   * builds the calldata at PREVIEW time, before any signer is resolved, and the
   * bytes must be identical again at prepare and during Fordefi's dual-channel
   * verification.
   */
  refundAddress?: HexString
}

// The Hub rejects a share price timestamp that isn't strictly before the on-chain block
// timestamp. Defaulting to `new Date()` can land at or after `block.timestamp` (clock skew,
// network latency), reverting with `CannotSetFuturePrice`. Back the default off by a small
// buffer so callers that don't pass `updatedAt` explicitly stay safely in the past.
const SHARE_PRICE_TIMESTAMP_SAFETY_BUFFER_SECONDS = 60

/**
 * The options {@link ShareClass.updateSharePrice} takes.
 *
 * An options object rather than a bare parameter for the same reason
 * {@link VaultWriteOptions} is one: the field means the same thing wherever it
 * appears, and a later addition does not change the signature again.
 */
export interface SharePriceWriteOptions {
  /**
   * Where unspent cross-chain gas payment is returned.
   *
   * Optional on the local path, where it defaults to the signing address —
   * exactly what this method has always encoded, so a caller who never passes
   * one is unaffected. REQUIRED in backend mode whenever a network is notified:
   * the signer is resolved AFTER the calldata is built, and the bytes must be
   * identical at preview, at prepare and again during Fordefi's dual-channel
   * verification. Defaulting to the connected wallet there would send a pool's
   * refunds to an address a custodial signer does not control.
   *
   * Must be ABSENT when nothing is notified. `Hub.updateSharePrice` on its own
   * dispatches no cross-chain message, so there is no unspent payment to
   * return, and accepting an address would tell the caller a refund was
   * arranged when none was needed. Both the pure builder and the backend's DTO
   * refuse that combination; so does this method, before anything is prepared.
   */
  refundAddress?: HexString
  /**
   * Networks NOT to notify, as `centrifugeId`s — an operator unticking a chain
   * whose messaging is paused. An exclude-list rather than an allow-list so the
   * SDK keeps deciding where the share class is deployed and the caller can
   * only subtract from that set, never forget a network. An id the share class
   * is not deployed on is ignored. Skipping every deployed network is a
   * hub-only update that sends no message.
   */
  skipNetworks?: CentrifugeId[]
}

/**
 * One investor's claim notification, as the order flows and the claim methods collect them.
 * @internal
 */
export interface ClaimNotification {
  assetId: AssetId
  investor: HexString
  maxClaims: number
}

/**
 * `BatchRequestManager.notifyDeposit` / `notifyRedeem` calls, one per
 * notification.
 *
 * v3.2 keys the notification by the investor's `bytes32` and is encoded here,
 * unchanged. v3.3 keys it by `uint256 requestId`, which `BatchRequestManager`
 * reads back as the investor's `bytes32` (`bytes32(requestId.raw())`), and is
 * built by `builders.notifyOrderClaims`, so the bytes and the refund rule
 * (the caller's address only when a callback leaves the hub chain) are the
 * builder's.
 * @internal
 */
export function encodeClaimNotifications(
  hubCtx: SdkProtocolContext,
  kind: 'deposit' | 'redeem',
  poolId: PoolId,
  scId: HexString,
  notifications: ClaimNotification[],
  refund: HexString
): HexString[] {
  if (notifications.length === 0) return []
  if (!isV3_3(hubCtx)) {
    return notifications.map((notification) =>
      encodeFunctionData({
        abi: hubCtx.contractAbis.BatchRequestManager,
        functionName: kind === 'deposit' ? 'notifyDeposit' : 'notifyRedeem',
        args: [
          poolId.raw,
          scId,
          notification.assetId.raw,
          addressToBytes32(notification.investor),
          notification.maxClaims,
          refund,
        ],
      })
    )
  }
  const byAsset = new Map<string, ClaimNotification[]>()
  for (const notification of notifications) {
    const key = notification.assetId.toString()
    byAsset.set(key, [...(byAsset.get(key) ?? []), notification])
  }
  const built = builders.notifyOrderClaims(builderContext(hubCtx), {
    poolId: poolId.toString(),
    scId,
    kind,
    notify: [...byAsset].map(([assetId, entries]) => ({
      assetId,
      notifications: entries.map((entry) => ({
        investor: entry.investor,
        maxClaims: entry.maxClaims,
        requestId: hexToBigInt(addressToBytes32(entry.investor)).toString(),
      })),
    })),
    ...(orderManagerRefund(notifications, poolId.centrifugeId, refund) === zeroAddress
      ? {}
      : { refundAddress: refund }),
  })
  return (built.calls ?? []).map((call) => call.data)
}

/**
 * The refund a v3.3 order manager call carries, by the builders' rule
 * (`resolveRefund` in packages/protocol): the caller's address when the batch
 * sends a callback off the hub chain, the inert zero address when every asset
 * is local. Matching it keeps the SDK's bytes equal to the builders'.
 */
function orderManagerRefund(
  assets: { assetId: AssetId }[],
  hubCentrifugeId: CentrifugeId,
  refundAddress: HexString
): HexString {
  const dispatches = assets.some(
    (asset) => !asset.assetId.isNationalCurrency && asset.assetId.centrifugeId !== hubCentrifugeId
  )
  return dispatches ? refundAddress : zeroAddress
}

/**
 * One v3.3 `Hub.managerCall` to the pool's `BatchRequestManager`, the
 * replacement for calling its approve, issue and revoke functions directly.
 */
function encodeOrderManagerCall(
  hubCtx: SdkProtocolContext,
  payload: BatchRequestManagerPayload,
  refund: HexString
): HexString {
  return encodeHubManagerCall(hubCtx, {
    centrifugeId: hubCtx.centrifugeId,
    target: hubCtx.batchRequestManager,
    payload: encodeBatchRequestManagerPayload(payload),
    label: `BatchRequestManager.${payload.kind}`,
    refund,
  })
}

/** The whole seconds the `Hub.updateSharePrice` `computedAt` argument carries. */
function sharePriceComputedAt(updatedAt: Date): number {
  return Math.floor(updatedAt.getTime() / 1000)
}

/**
 * `Hub.notifySharePrice` to one network, with the messages it sends.
 * @internal
 */
export function sharePriceNotification(
  hubCtx: SdkProtocolContext,
  poolId: PoolId,
  scId: HexString,
  centrifugeId: CentrifugeId,
  refundAddress: HexString
): { data: HexString; messages: Record<number, MessageTypeWithSubType[]> } {
  const messages: Record<number, MessageTypeWithSubType[]> = {}
  addMessageForEnabledTarget(messages, centrifugeId, { type: MessageType.NotifyPricePoolPerShare, poolId })
  const data = encodeFunctionData({
    abi: hubCtx.contractAbis.Hub,
    functionName: 'notifySharePrice',
    args: [poolId.raw, scId, centrifugeId, refundAddress],
  })
  return { data, messages }
}

/**
 * `Hub.notifySharePrice` to each network, in the order given. A share price update propagates through these, and so
 * does the execution of a matured update.
 * @internal
 */
export function sharePriceNotifications(
  hubCtx: SdkProtocolContext,
  poolId: PoolId,
  scId: HexString,
  networks: readonly CentrifugeId[],
  refundAddress: HexString
): { data: HexString; messages: Record<number, MessageTypeWithSubType[]> }[] {
  return networks.map((centrifugeId) => sharePriceNotification(hubCtx, poolId, scId, centrifugeId, refundAddress))
}

/**
 * The refund address, refused rather than defaulted on the backend route.
 *
 * See {@link SharePriceWriteOptions.refundAddress}. Refused at payload-build
 * time so nothing is prepared: an orphaned backend row is worse than an early
 * throw.
 */
function requireSharePriceRefundAddress(options: SharePriceWriteOptions): HexString {
  if (!options.refundAddress) {
    throw new Error(
      `shareClass.updateSharePrice() needs an explicit { refundAddress } in backend mode: this price ` +
        `update notifies at least one network, which is a paid cross-chain send, and unspent gas is ` +
        `refunded to the address baked into the calldata. The backend builds that calldata before any ` +
        `signer is resolved, so it cannot use "the connected wallet" — on the custodial route that is a ` +
        `Fordefi vault the refund would not reach. Pass the address the refund should go to; the local ` +
        `build path still defaults it to the signing address.`
    )
  }
  return options.refundAddress
}

/**
 * Refuse a `refundAddress` on a share class with nothing to notify, rather than
 * dropping it: the caller asked for something this transaction cannot do.
 *
 * Returns the empty spread for the payload so the field is absent, which is
 * what the backend's DTO requires in this case.
 */
function refuseUnusableRefundAddress(options: SharePriceWriteOptions): Record<string, never> {
  if (options.refundAddress) {
    const reason = options.skipNetworks?.length
      ? 'every network it is deployed on was skipped (`skipNetworks`)'
      : 'this share class is deployed on no network'
    throw new Error(
      `shareClass.updateSharePrice() was given a { refundAddress } but ${reason}, so no notification is ` +
        `sent. \`Hub.updateSharePrice\` alone dispatches no cross-chain message and there is no unspent gas ` +
        `payment to return; accepting the address would suggest a refund had been arranged. Omit it for a ` +
        `hub-only update.`
    )
  }
  return {}
}

/** A direct issue or revoke the hub sent to a remote `ShareManager` that the spoke has not executed. */
export interface DirectIssuanceInFlight {
  messageId: HexString
  messageIndex: number
  centrifugeId: number
  kind: 'Issue' | 'Revoke'
  account: HexString
  shares: Balance
  status: ShareManagerCallRow['status']
  hubTxHash: HexString
  createdAt: Date
}

/**
 * A closed redemption order, i.e. an epoch for which shares have been revoked.
 * `investor` is null for the epoch-level aggregate returned when no per-investor
 * orders are indexed for a revoked epoch.
 */
export interface ClosedRedemption {
  investor: HexString | null
  index: number
  assetId: AssetId
  approvedAmount: Balance
  approvedAt: string | null
  payoutAmount: Balance
  revokedAt: string | null
  priceAsset: Price
  pricePerShare: Price
  claimedAt: string | null
  isClaimed: boolean
  asset: {
    symbol: string
    name: string
    decimals: number
  }
  centrifugeId: CentrifugeId
  token: {
    decimals: number
  }
}

/**
 * The cursor-shaped page envelope `holders()` and `whitelistedHolders()`
 * return, built from the bounds the caller asked for.
 *
 * Synthesised here rather than sourced from either adapter: the backend's
 * endpoint answers `{ items, total }` and has no cursors to serve, and every
 * consumer of these two methods pages by `limit`/`offset` anyway. This keeps
 * the public return shape the same across both adapters and keeps them
 * honest — neither has to invent cursors the other cannot produce.
 *
 * `startCursor`/`endCursor` are therefore `null`, which is what they mean:
 * offset pagination has no cursors, and nothing in the SDK accepts one for
 * these entries. A synthetic cursor would be a value a caller could pass back
 * and have silently ignored.
 */
function pageInfoFor(offset: number, totalCount: number, returned: number): PageInfo {
  return {
    hasNextPage: offset + returned < totalCount,
    hasPreviousPage: offset > 0,
    startCursor: null,
    endCursor: null,
  }
}

/**
 * Asset id -> that asset's decimals, taken from the order rows the holders
 * views already read.
 *
 * Taken from the order rows rather than from a whole-table `assets` lookup,
 * for two reasons. The backend's investor endpoints serve investors and not
 * assets, so there is nothing to read a whole table from on that route; and a
 * whole-table read is the weaker source anyway — capped at 1000 rows on
 * public-api, with a miss falling through to a hardcoded `?? 18`, which
 * renders a USDC amount a trillion times too small.
 *
 * The order rows carry the asset joined per order, so an asset an investor has
 * an outstanding subscription in is always present here. The pool currency's
 * decimals are the last resort, reached only where there is no outstanding
 * invest at all and the amount is therefore zero, where the scale cannot change
 * the value.
 */

/**
 * Filter for {@link ShareClass.closedRedemptions}.
 */
export interface ClosedRedemptionsFilter {
  /** Restrict to a single payout asset. */
  assetId?: AssetId
  /** Restrict to a single epoch (the `epochId` passed to approve/revoke). */
  epochIndex?: number
  /** Only return orders not yet claimed/notified on the hub (`claimedAt` is null). */
  onlyUnclaimed?: boolean
}

/**
 * One asset's instruction to {@link ShareClass.approveDepositsAndIssueShares}:
 * approve a deposit epoch, issue shares for the approved ones, or both.
 *
 * Presence-discriminated, which is what makes the two legs distinguishable
 * without changing the existing call sites — and what the backend's action
 * vocabulary deliberately does NOT mirror; see `ACTION_ROUTES`.
 */
export type DepositOrderInstruction = { assetId: AssetId } & (
  { approveAssetAmount: Balance; approvePricePerAsset: Balance } | { issuePricePerShare?: Price | Price[] }
)

/** The redeem mirror of {@link DepositOrderInstruction}. */
export type RedeemOrderInstruction = { assetId: AssetId } & (
  { approveShareAmount: Balance; approvePricePerAsset: Balance } | { revokePricePerShare: Price | Price[] }
)

/** Options shared by the two order write methods. */
export interface OrderWriteOptions {
  /**
   * Where unspent cross-chain gas payment is returned.
   *
   * Optional on the local build path, where it defaults to the connected signer
   * exactly as it always has. Required in backend mode whenever any named asset
   * lives on another network — the SDK will not guess the connected wallet
   * there, because on the custodial route the signer is the pool's Fordefi vault
   * and the refund would land somewhere the operator does not control.
   */
  refundAddress?: HexString
  /**
   * Whether the local build notifies investor claims after an issue or revoke.
   * Defaults to true. On v3.3 the notifications are a second transaction on
   * `BatchRequestManager`, which `buildOnly` and batching cannot return, so
   * building there with claims pending refuses unless this is false; notify the
   * investors with `claimDeposit` / `claimRedeem` afterwards.
   */
  notify?: boolean
}

/** Which leg(s) of a dual-shape order call a caller's entries carry. */
type OrderLeg = 'first' | 'second' | 'both'

/**
 * Classify a dual-shape order call by the KEYS its entries carry, the same way
 * the local build path discriminates them.
 *
 * `'both'` covers the two shapes the backend's vocabulary cannot express in one
 * transaction: entries of both kinds in one array, and a single entry carrying
 * both key sets (which the local loop runs through both branches). An array
 * with neither key set also lands here rather than being guessed at.
 */
function orderLegOf(entries: { assetId: AssetId }[], firstKey: string, secondKey: string): OrderLeg {
  const first = entries.some((entry) => firstKey in entry)
  const second = entries.some((entry) => secondKey in entry)
  const mixedEntry = entries.some((entry) => firstKey in entry && secondKey in entry)
  if (mixedEntry || (first && second) || (!first && !second)) return 'both'
  return first ? 'first' : 'second'
}

/**
 * Refuse a repeated asset, matching the local path's own guard.
 *
 * The backend refuses it too (`refuseDuplicateAssets` in the DTO, and
 * `requireNoDuplicates` in the builder), because the second call for one asset
 * either reverts `EpochNotInSequence` or pays for a duplicate cross-chain
 * message depending on ordering. Checked here so both paths refuse identically
 * and before a backend row exists.
 */
function requireDistinctAssets(entries: { assetId: AssetId }[]): void {
  const seen = new Set<string>()
  for (const entry of entries) {
    const id = entry.assetId.toString()
    if (seen.has(id)) throw new Error('Assets array contains multiple entries for the same asset ID')
    seen.add(id)
  }
}

/**
 * One `D18` price per epoch of an issue/revoke PAGE, as the decimal strings the
 * backend payload carries.
 *
 * The page size is `min(outstanding, prices.length)` for an array and
 * `outstanding` for a single price — the same count the local loop produces
 * (`for (i = 0; i < outstanding; i++) { ...; if (!price) break }`), so the two
 * paths act on the same epochs.
 *
 * Note what is NOT here: a gas budget. The local path derives its page from
 * `GAS_LIMIT / ESTIMATE_PER_MESSAGE` (42 messages), and a measured live route
 * has an effective cap of SIX. Porting that constant onto this path would
 * silently build a batch the chain refuses with `0x4c4fc93a`, a selector in no
 * bundled ABI. The explicit page goes on the wire and the backend refuses an
 * over-large one with 422 `BRIDGE_BATCH_TOO_LARGE`, naming the declared and
 * effective caps.
 */
function epochPrices(
  price: Price | Price[] | undefined,
  outstanding: number,
  assetId: AssetId,
  label: string,
  nothingToDo: string
): string[] {
  if (outstanding <= 0) throw new Error(nothingToDo)
  const prices: string[] = []
  for (let i = 0; i < outstanding; i++) {
    const entry = Array.isArray(price) ? price[i] : price
    if (!entry) break
    if (entry.lte(0n)) throw new Error(`${label} must be greater than 0 for asset "${assetId.toString()}"`)
    prices.push(entry.toBigInt().toString())
  }
  if (prices.length === 0) {
    throw new Error(
      `No ${label.toLowerCase()} was given for asset "${assetId.toString()}", so there is nothing to ` +
        `price. The page size IS the number of epochs the transaction acts on.`
    )
  }
  return prices
}

/**
 * After a balance sheet event, when `_liveBalances()` re-reads the indexed escrow rows (ms after
 * the event). The indexer projects an event seconds after it is mined.
 */
const ESCROW_REFRESH_DELAYS_MS = [5_000, 15_000, 45_000] as const

/**
 * Refuses a `holdingEscrows` row missing a money-shaped field rather than reporting it as zero.
 * Names the row by chain, asset and escrow: one asset can sit in two escrows on one chain.
 */
function requireEscrowRowFields<F extends 'asset' | 'assetAmount' | 'assetPrice'>(
  row: HoldingEscrowRow,
  shareClassId: ShareClassId,
  fields: readonly F[]
) {
  const missing = fields.filter((field) => row[field] == null)
  if (missing.length > 0) {
    throw new Error(
      `holdingEscrows row for asset ${row.assetId} in escrow ${row.escrowAddress} on centrifugeId ` +
        `${row.centrifugeId} of share class ${shareClassId.toString()} has no ${missing.join(', ')}; ` +
        `refusing to report it as a zero balance`
    )
  }
}

function orderEpochKey(assetId: string, epoch: string | number): string {
  return `${assetId}:${String(epoch).toLowerCase()}`
}

function hasApprovalHash<T extends { approvedAtTxHash: string | null }>(
  order: T
): order is T & { approvedAtTxHash: string } {
  return order.approvedAtTxHash !== null
}

function groupOrders<T>(orders: readonly T[], keyOf: (order: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const order of orders) {
    const key = keyOf(order)
    const group = groups.get(key)
    if (group) group.push(order)
    else groups.set(key, [order])
  }
  return groups
}

/**
 * What the indexer holds for the epochs of one asset that an issue or a revoke settled. `open` lists the epochs that do
 * not show as closed yet. `investors` are those with an order of those epochs that is closed and not yet notified, each
 * with the number of such orders they have for the asset.
 * @internal
 */
export type SettledOrders = {
  open: number[]
  investors: { investor: HexString; maxClaims: number }[]
}

/** One epoch row of the closed orders of a side, and one investor order, as the claims read them. */
type ClosedEpochRow = { assetId: string; index: number; closed: boolean; key: string | null }
type ClosedOrderRow = { assetId: string; account: HexString; claimed: boolean; key: string | null }

/**
 * Query and interact with a share class, which allows querying total issuance, NAV per share,
 * and allows interactions related to asynchronous deposits and redemptions.
 */
export class ShareClass extends Entity {
  id: ShareClassId

  constructor(
    _root: Centrifuge,
    public pool: Pool,
    id: string | ShareClassId
  ) {
    const _id = id instanceof ShareClassId ? id : new ShareClassId(id)
    super(_root, ['shareclass', _id.toString()])
    this.id = _id
  }

  /**
   * Query the details of the share class.
   * @returns The details of the share class, including name, symbol, total issuance, NAV per share and relavant metadata from the pool metadata.
   */
  details() {
    return this._query(['shareClassDetails'], () =>
      combineLatest([
        this._metrics(),
        this._metadata(),
        this.navPerNetwork(),
        this.pool.decimals(),
        this.pool.metadata(),
      ]).pipe(
        map(([metrics, metadata, navPerNetwork, poolDecimals, poolMeta]) => {
          const totalIssuance = navPerNetwork.reduce(
            (acc, item) => acc.add(item.totalIssuance),
            new Balance(0n, poolDecimals)
          )

          const meta = poolMeta?.shareClasses?.[this.id.raw]

          return {
            id: this.id,
            name: metadata.name,
            symbol: metadata.symbol,
            totalIssuance,
            pricePerShare: metrics.pricePerShare,
            priceComputedAt: metrics.priceComputedAt,
            nav: totalIssuance.mul(metrics.pricePerShare),
            navPerNetwork,
            icon: meta?.icon || null,
            minInitialInvestment: meta?.minInitialInvestment || null,
            apyPercentage: meta?.apyPercentage || null,
            apy: meta?.apy || null,
            defaultAccounts: {
              asset: meta?.defaultAccounts?.asset || null,
              equity: meta?.defaultAccounts?.equity || null,
              gain: meta?.defaultAccounts?.gain || null,
              loss: meta?.defaultAccounts?.loss || null,
              expense: meta?.defaultAccounts?.expense || null,
              liability: meta?.defaultAccounts?.liability || null,
            },
          }
        })
      )
    )
  }

  balanceSheet(centrifugeId: CentrifugeId) {
    return this._query(['balanceSheet', centrifugeId], () =>
      this.pool.activeNetworks().pipe(
        map((networks) => {
          const network = networks.find((n) => n.centrifugeId === centrifugeId)
          if (!network) {
            throw new Error(`No active network found for centrifuge ID ${centrifugeId}`)
          }
          return new BalanceSheet(this._root, network, this)
        })
      )
    )
  }

  deploymentPerNetwork() {
    return this._query(['deploymentPerNetwork'], () =>
      this.pool.activeNetworks().pipe(
        switchMap((networks) => {
          if (networks.length === 0) return of([])

          return combineLatest(
            networks.map((network) =>
              combineLatest([
                this._share(network.centrifugeId).pipe(catchError(() => of(null))),
                this._restrictionManager(network.centrifugeId).pipe(catchError(() => of(null))),
                this.valuation(network.centrifugeId),
                of(network),
              ])
            )
          )
        }),
        map((data) =>
          data
            .filter(([share, restrictionManager]) => share != null && restrictionManager != null)
            .map(([share, restrictionManager, valuation, network]) => ({
              centrifugeId: network.centrifugeId,
              shareTokenAddress: share!,
              restrictionManagerAddress: restrictionManager!,
              valuation,
            }))
        )
      )
    )
  }

  navPerNetwork() {
    return this._query(['navPerNetwork'], () =>
      this.pool.decimals().pipe(
        switchMap((poolDecimals) =>
          this._root._queryData('tokenInstances', { tokenId: this.id.raw }, (items: TokenInstanceRow[]) =>
            items.map((item) => ({
              centrifugeId: Number(item.centrifugeId),
              totalIssuance: new Balance(BigInt(item.totalIssuance), poolDecimals),
              pricePerShare: new Price(BigInt(item.tokenPrice)),
              nav: new Balance(BigInt(item.totalIssuance), poolDecimals).mul(new Price(BigInt(item.tokenPrice))),
              address: item.address,
            }))
          )
        )
      )
    )
  }

  /**
   * Query the vaults of the share class.
   * @param centrifugeId The optional centrifuge ID to query the vaults on.
   * @param includeUnlinked Whether to include unlinked vaults.
   * @returns Vaults of the share class.
   */
  vaults(centrifugeId?: CentrifugeId, includeUnlinked = false) {
    return this._query(['vaults', centrifugeId, includeUnlinked.toString()], () =>
      this._allVaults().pipe(
        map((allVaults) => {
          return allVaults.filter((vault) => {
            if (centrifugeId !== undefined && vault.centrifugeId !== centrifugeId) return false
            if (!includeUnlinked && vault.status === 'Unlinked') return false
            return true
          })
        }),
        map((vaults) =>
          vaults.map(
            (vault) =>
              new Vault(
                this._root,
                new PoolNetwork(this._root, this.pool, vault.centrifugeId),
                this,
                vault.assetAddress,
                vault.address,
                vault.assetId
              )
          )
        )
      )
    )
  }

  /**
   * Query all the balances of the share class (from the indexed escrows and Holdings).
   *
   * One entry per (centrifuge id, asset id, escrow address): a pool with a legacy and a v3.3
   * escrow on one chain returns two entries for an asset there, one per escrow. Entries are
   * never merged across escrows; a caller that wants a total per asset adds the amounts.
   *
   * `amount` is the asset balance the indexer projects for that escrow (its deposits less its
   * withdrawals), not `availableBalanceOf`: it includes any amount reserved for redemptions. It
   * refreshes shortly after a deposit or withdrawal on the share class's balance sheet, once the
   * indexer has projected it (see `_liveBalances`).
   * `price` is read on chain per asset and `holding` is the hub's per-asset holding, so both
   * repeat on every escrow entry of the same asset.
   */
  balances(centrifugeId?: CentrifugeId) {
    return this._query(['balances', centrifugeId], () =>
      combineLatest([this._liveBalances(), this.pool.currency()]).pipe(
        switchMap(([res, poolCurrency]) => {
          if (res.length === 0) {
            return of([])
          }
          const items = res.filter(
            // Skip holdings whose asset metadata isn't indexed yet (`asset` is null):
            // they can't be priced/rendered, and reading `asset.address` below would
            // otherwise throw and fail the whole `balances()` stream.
            (item) => (Number(item.centrifugeId) === centrifugeId || !centrifugeId) && item.asset != null
          )

          if (items.length === 0) return of([])

          return combineLatest([
            combineLatest(
              items.map((holding) => {
                if (!holding.holding) return of(null)
                const assetId = new AssetId(holding.assetId)
                return this._holding(assetId).pipe(catchError(() => of(null)))
              })
            ),
            combineLatest(
              items.map((holding) => this._assetPrice(Number(holding.centrifugeId), new AssetId(holding.assetId)))
            ),
          ]).pipe(
            map(([holdings, prices]) =>
              items.map((data, i) => {
                const holding = holdings[i]
                // If the holding hasn't been initialized yet, the price is 1
                const price = holding ? prices[i]! : Price.fromFloat(1)
                requireEscrowRowFields(data, this.id, ['assetAmount'])
                const amount = new Balance(BigInt(data.assetAmount), data.asset.decimals)
                const value = Balance.fromFloat(amount.toDecimal().mul(price.toDecimal()), poolCurrency.decimals)
                return {
                  assetId: new AssetId(data.assetId),
                  escrowAddress: data.escrowAddress,
                  amount,
                  value,
                  price,
                  asset: {
                    decimals: data.asset.decimals,
                    address: data.asset.address,
                    tokenId: BigInt(data.asset.assetTokenId),
                    name: data.asset.name,
                    symbol: data.asset.symbol,
                    centrifugeId: Number(data.centrifugeId) as CentrifugeId,
                  },
                  holding: holding && {
                    valuation: holding.valuation,
                    amount: holding.amount,
                    value: holding.value,
                    isLiability: holding.isLiability,
                    accounts: holding.accounts,
                  },
                }
              })
            )
          )
        })
      )
    )
  }

  /**
   * Query the indexed escrow balances of the share class.
   *
   * One entry per (centrifuge id, asset id, escrow address), each with that escrow's own amount
   * and price. Entries are never merged across escrows.
   *
   * `price` is the last asset price on that escrow's own protocol stack. After a pool migrates,
   * prices are only sent to the new stack, so a legacy escrow's entry keeps the legacy stack's
   * last price; `balances()` prices every entry at the current price instead.
   */
  escrows() {
    return this._query(['escrows'], () =>
      this._liveBalances().pipe(
        map((rows) =>
          rows.map((row) => {
            requireEscrowRowFields(row, this.id, ['asset', 'assetAmount', 'assetPrice'])
            return {
              escrowAddress: row.escrowAddress,
              centrifugeId: Number(row.centrifugeId),
              assetId: new AssetId(row.assetId),
              amount: new Balance(BigInt(row.assetAmount), row.asset.decimals),
              price: new Price(BigInt(row.assetPrice)),
              asset: {
                address: row.asset.address,
                name: row.asset.name,
                symbol: row.asset.symbol,
                decimals: row.asset.decimals,
              },
            }
          })
        )
      )
    )
  }

  /**
   * Get the pending and approved amounts for deposits and redemptions for each asset.
   */
  pendingAmounts() {
    return this._query(['pendingAmounts'], () =>
      combineLatest([
        this._allVaults().pipe(map((vaults) => vaults.filter((v) => v.status === 'Linked'))),
        this._investOrders(),
        this._redeemOrders(),
        this.balances(),
        this.pool.currency(),
      ]).pipe(
        map(([vaults, investData, redeemData, balancesData, poolCurrency]) => {
          const poolDecimals = poolCurrency.decimals

          if (vaults.length === 0) {
            const zeroBalance = new Balance(0n, poolDecimals)
            return {
              byVault: [],
              shareClassTotals: {
                pendingInvestments: zeroBalance,
                pendingRedemptions: zeroBalance,
                approvedInvestments: zeroBalance,
                approvedRedemptions: zeroBalance,
              },
            }
          }

          const investmentsPending = new Map<string, Balance>()
          investData.epochOutstandingInvests.forEach((order) => {
            investmentsPending.set(`${order.assetId.toString()}-${order.centrifugeId}`, order.pendingAmount)
          })

          const redemptionsPending = new Map<string, Balance>()
          redeemData.epochOutstandingRedeems.forEach((order) => {
            redemptionsPending.set(`${order.assetId.toString()}-${order.centrifugeId}`, order.pendingAmount)
          })

          const investmentsApproved = new Map<string, { amount: Balance; approvedAt: Date | null; epoch: number }[]>()
          investData.epochInvestOrders.forEach((order) => {
            const isApproved = !!order.approvedAt && !order.issuedAt
            const key = `${order.assetId.toString()}-${order.centrifugeId}`
            if (isApproved) {
              if (!investmentsApproved.has(key)) investmentsApproved.set(key, [])
              investmentsApproved.get(key)!.push({
                amount: order.approvedAmount,
                approvedAt: order.approvedAt,
                epoch: order.index,
              })
            }
          })

          const redemptionsApproved = new Map<
            string,
            { amount: Balance; approvedAt: Date | null; epoch: number; approvedAtTxHash?: string | null }[]
          >()
          redeemData.epochRedeemOrders.forEach((order) => {
            const isApproved = !!order.approvedAt && !order.revokedAt
            const key = `${order.assetId.toString()}-${order.centrifugeId}`
            if (isApproved) {
              if (!redemptionsApproved.has(key)) redemptionsApproved.set(key, [])
              redemptionsApproved.get(key)!.push({
                amount: order.approvedAmount,
                approvedAt: order.approvedAt,
                epoch: order.index,
                approvedAtTxHash: order.approvedAtTxHash ?? null,
              })
            }
          })

          const assetDecimals = new Map<string, number>()
          balancesData.forEach((b) => assetDecimals.set(b.assetId.toString(), b.asset.decimals))

          const queuedInvestments = new Map<string, Balance>()
          investData.pendingInvestOrders.forEach((order) => {
            const key = `${order.assetId.toString()}-${order.centrifugeId}`
            const decimals = assetDecimals.get(order.assetId.toString()) ?? 18
            const queuedAmount = new Balance(order.queuedAmount, decimals)
            const existing = queuedInvestments.get(key)
            if (existing) {
              queuedInvestments.set(key, existing.add(queuedAmount))
            } else {
              queuedInvestments.set(key, queuedAmount)
            }
          })

          const queuedRedemptions = new Map<string, Balance>()
          redeemData.pendingRedeemOrders.forEach((order) => {
            const key = `${order.assetId.toString()}-${order.centrifugeId}`
            const existing = queuedRedemptions.get(key)
            if (existing) {
              queuedRedemptions.set(key, existing.add(order.queuedAmount))
            } else {
              queuedRedemptions.set(key, order.queuedAmount)
            }
          })

          const priceByAsset = new Map<string, Price>()
          balancesData.forEach((b) => priceByAsset.set(b.assetId.toString(), b.price))

          let totalPendingInvestments = new Balance(0n, poolDecimals)
          let totalPendingRedemptions = new Balance(0n, poolDecimals)
          let totalApprovedInvestments = new Balance(0n, poolDecimals)
          let totalApprovedRedemptions = new Balance(0n, poolDecimals)

          const byVault = vaults.map((vault) => {
            const key = `${vault.assetId.toString()}-${vault.centrifugeId}`

            const pendingDeposit = investmentsPending.get(key) ?? new Balance(0n, 18)
            const pendingRedeem = redemptionsPending.get(key) ?? new Balance(0n, 18)

            const pendingIssuances = investmentsApproved.get(key) ?? []
            const pendingRevocations = redemptionsApproved.get(key) ?? []

            const investTokenDecimals = assetDecimals.get(vault.assetId.toString()) ?? 18
            const pendingIssuancesTotal = pendingIssuances.reduce(
              (acc, curr) => acc.add(curr.amount),
              new Balance(0n, pendingIssuances[0]?.amount.decimals ?? investTokenDecimals)
            )
            const redeemTokenDecimals =
              redeemData.epochRedeemOrders[0]?.tokenDecimals ??
              redeemData.epochOutstandingRedeems[0]?.pendingAmount.decimals ??
              18

            const pendingRevocationsTotal = pendingRevocations.reduce(
              (acc, curr) => acc.add(curr.amount),
              new Balance(0n, pendingRevocations[0]?.amount.decimals ?? redeemTokenDecimals)
            )

            const queuedInvest = queuedInvestments.get(key) ?? new Balance(0n, investTokenDecimals)
            const queuedRedeem = queuedRedemptions.get(key) ?? new Balance(0n, redeemTokenDecimals)

            const assetPrice = priceByAsset.get(vault.assetId.toString()) ?? Price.fromFloat(1)

            const pendingDepositInPoolCurrency = pendingDeposit.mul(assetPrice).scale(poolDecimals)
            totalPendingInvestments = totalPendingInvestments.add(pendingDepositInPoolCurrency)

            const pendingRedeemScaled = pendingRedeem.scale(poolDecimals)
            totalPendingRedemptions = totalPendingRedemptions.add(pendingRedeemScaled)

            const approvedInvestInPoolCurrency = pendingIssuancesTotal.mul(assetPrice).scale(poolDecimals)
            totalApprovedInvestments = totalApprovedInvestments.add(approvedInvestInPoolCurrency)

            const approvedRedeemScaled = pendingRevocationsTotal.scale(poolDecimals)
            totalApprovedRedemptions = totalApprovedRedemptions.add(approvedRedeemScaled)

            const maxInvestIndex =
              investData.maxEpochByAsset.get(vault.assetId.toString()) ??
              (pendingIssuances.length > 0 ? Math.max(...pendingIssuances.map((p) => p.epoch)) : 0)
            const minInvestIndex =
              pendingIssuances.length > 0 ? Math.min(...pendingIssuances.map((p) => p.epoch)) : maxInvestIndex + 1
            const maxRedeemIndex =
              redeemData.maxEpochByAsset.get(vault.assetId.toString()) ??
              (pendingRevocations.length > 0 ? Math.max(...pendingRevocations.map((p) => p.epoch)) : 0)
            const minRedeemIndex =
              pendingRevocations.length > 0 ? Math.min(...pendingRevocations.map((p) => p.epoch)) : maxRedeemIndex + 1

            return {
              assetId: vault.assetId,
              centrifugeId: vault.centrifugeId,
              pendingDeposit,
              pendingRedeem,
              pendingIssuances,
              pendingIssuancesTotal,
              pendingRevocations,
              pendingRevocationsTotal,
              queuedInvest,
              queuedRedeem,
              assetPrice,
              depositEpoch: maxInvestIndex + 1,
              redeemEpoch: maxRedeemIndex + 1,
              issueEpoch: minInvestIndex,
              revokeEpoch: minRedeemIndex,
            }
          })

          return {
            byVault,
            shareClassTotals: {
              pendingInvestments: totalPendingInvestments,
              pendingRedemptions: totalPendingRedemptions,
              approvedInvestments: totalApprovedInvestments,
              approvedRedemptions: totalApprovedRedemptions,
            },
          }
        })
      )
    )
  }

  /**
   * Check if an address is a member of the share class.
   * @param address Address to check
   * @param centrifugeId Centrifuge ID of the network on which to check the member
   */
  member(address: HexString, centrifugeId: CentrifugeId) {
    const addr = address.toLowerCase() as HexString
    return this._query(['member', addr, centrifugeId], () =>
      combineLatest([
        this._share(centrifugeId),
        this._restrictionManager(centrifugeId),
        this._root.getClient(centrifugeId),
        this._root.protocolContext({ poolId: this.pool.id, centrifugeId }),
      ]).pipe(
        switchMap(([share, restrictionManager, client, { contractAbis: ABI, protocolVersion }]) =>
          defer(async () => {
            const res = await client.readContract({
              address: restrictionManager,
              abi: ABI.RestrictionManager,
              functionName: 'isMember',
              args: [share, addr],
            })
            return {
              isMember: res[0],
              validUntil: new Date(Number(res[1]) * 1000),
            }
          }).pipe(
            repeatOnEvents(
              this._root,
              {
                address: restrictionManager,
                eventName: 'UpdateMember',
                filter: (events) =>
                  events.some(
                    (event) => event.args.user?.toLowerCase() === addr && event.args.token?.toLowerCase() === share
                  ),
              },
              centrifugeId,
              protocolVersion
            ),
            catchError((e) => {
              console.warn('Error checking member status', e)
              // Freeze-only hook doesn't have isMember function
              return of({
                isMember: false,
                validUntil: new Date(0),
              })
            })
          )
        )
      )
    )
  }

  /**
   * Create a holding for a registered asset in the share class.
   * @param assetId - Asset ID of the asset to create a holding for
   * @param valuation - Valuation of the asset
   * @param isLiability - Whether the holding is a liability or not
   * @param accounts - Accounts to use for the holding. An asset or expense account will be created if not provided.
   * Other accounts are expected to be provided or to exist in the pool metadata.
   */
  createHolding<Liability extends boolean>(
    assetId: AssetId,
    valuation: HexString,
    isLiability: Liability,
    accounts?: Liability extends true
      ? { [key in AccountType.Expense | AccountType.Liability]?: number }
      : { [key in AccountType.Asset | AccountType.Equity | AccountType.Loss | AccountType.Gain]?: number }
  ) {
    return this._root._routeDeferredTransaction(
      'createHolding',
      this.pool.id.toString(),
      () => this.#createHoldingPayload(assetId, valuation, isLiability, accounts),
      {
        title: 'Create holding',
        centrifugeId: this.pool.centrifugeId,
        gate: [],
        local: () => this.#createHoldingLocal(assetId, valuation, isLiability, accounts),
      }
    )
  }

  /**
   * The `createHolding` action's payload, or a refusal.
   *
   * The backend's builder is PURE — its calldata is re-derived at preview, at
   * prepare and again during Fordefi's dual-channel verification — so it cannot
   * allocate account ids of its own, and the ids arrive as data. That is fine
   * for the two sources this method already has: an explicit `accounts`
   * argument, and the share class's `defaultAccounts` in the pool metadata.
   *
   * It is NOT fine for the third. When neither source supplies an id, the local
   * path invents a random one, probes `Accounting.exists` over RPC until it is
   * free, and prepends a `Hub.createAccount` leg per invented id — a shape the
   * `createHolding` action cannot express, and a random value that would make
   * preview, prepare and verification disagree.
   *
   * So backend mode refuses, rather than falling back to the local build. The
   * fallback would be the worse answer: the calldata would be correct, but the
   * holding would be created through the connected wallet with no policy
   * evaluation, no approval quorum and no audit row — a security-relevant
   * difference decided by whether a pool's IPFS metadata happens to carry
   * default accounts. Refusing names the two ways forward instead.
   */
  async #createHoldingPayload(
    assetId: AssetId,
    valuation: HexString,
    isLiability: boolean,
    accounts?: Record<number, number | undefined>
  ) {
    const metadata = await this.pool.metadata()
    const provided = (accounts ?? {}) as Record<number, number | undefined>
    const defaults = metadata?.shareClasses?.[this.id.raw]?.defaultAccounts

    const resolve = (explicit: number | undefined, fallback: number | undefined, name: string): string => {
      const id = explicit ?? fallback
      if (id === undefined) {
        throw new Error(
          `Cannot build "createHolding" for share class ${this.id.raw} in backend mode: no ${name} ` +
            `account id was given and the pool metadata declares no default for this share class. The ` +
            `local build path would allocate a random id and prepend a Hub.createAccount leg, which the ` +
            `backend action cannot express and Fordefi's re-derivation would reject. Create the ` +
            `accounts first (pool.createAccounts()) and pass their ids, or record them as the share ` +
            `class's defaultAccounts in the pool metadata.`
        )
      }
      return BigInt(id).toString()
    }

    const scope = {
      poolId: this.pool.id.toString(),
      scId: this.id.raw,
      assetId: assetId.toString(),
      valuationAddress: valuation,
    }

    return isLiability
      ? {
          ...scope,
          isLiability: true,
          accounts: {
            expense: resolve(provided[AccountType.Expense], defaults?.expense, 'expense'),
            liability: resolve(provided[AccountType.Liability], defaults?.liability, 'liability'),
          },
        }
      : {
          ...scope,
          isLiability: false,
          accounts: {
            asset: resolve(provided[AccountType.Asset], defaults?.asset, 'asset'),
            equity: resolve(provided[AccountType.Equity], defaults?.equity, 'equity'),
            gain: resolve(provided[AccountType.Gain], defaults?.gain, 'gain'),
            loss: resolve(provided[AccountType.Loss], defaults?.loss, 'loss'),
          },
        }
  }

  #createHoldingLocal<Liability extends boolean>(
    assetId: AssetId,
    valuation: HexString,
    isLiability: Liability,
    accounts?: Liability extends true
      ? { [key in AccountType.Expense | AccountType.Liability]?: number }
      : { [key in AccountType.Asset | AccountType.Equity | AccountType.Loss | AccountType.Gain]?: number }
  ) {
    const self = this
    return this._transact(async function* (ctx) {
      const [hubCtx, metadata] = await Promise.all([self._root.protocolContext(self.pool.id), self.pool.metadata()])
      const { hub, accounting, contractAbis: ABI } = hubCtx
      // Before any account is allocated, so a refused liability creates nothing.
      if (isLiability) {
        refuseOnV3_3(
          hubCtx,
          'createHolding',
          'initializeLiability was removed and the liability slot mapping is undecided'
        )
      }

      const provided = (accounts ?? {}) as Record<number, number | undefined>
      const defaults = metadata?.shareClasses?.[self.id.raw]?.defaultAccounts
      const createAccountCalls: HexString[] = []

      const client = await firstValueFrom(self._root.getClient(self.pool.centrifugeId))
      const allocatedIds = new Set<bigint>()

      // Resolve an account id from the explicit input or the share class defaults,
      // otherwise allocate a fresh account with the correct normal balance. By
      // double-entry convention asset/loss/expense are debit-normal; equity/gain/
      // liability are credit-normal. This lets a holding be created on a pool that
      // hasn't pre-created its accounts (instead of reverting "Missing required accounts").
      const resolveAccount = async (
        explicit: number | undefined,
        fallback: number | undefined,
        isDebitNormal: boolean
      ): Promise<bigint> => {
        const existing = explicit ?? fallback
        if (existing !== undefined) return BigInt(existing)
        // Generate a fresh id that doesn't already exist on-chain and isn't already
        // allocated in this batch — `initializeHolding` reverts InvalidAccountCombination
        // if any two of the four accounts collide.
        let id = randomUint(256)
        while (
          allocatedIds.has(id) ||
          (await client.readContract({
            address: accounting,
            abi: ABI.Accounting,
            functionName: 'exists',
            args: [self.pool.id.raw, id],
          }))
        ) {
          id = randomUint(256)
        }
        allocatedIds.add(id)
        createAccountCalls.push(
          encodeFunctionData({
            abi: ABI.Hub,
            functionName: 'createAccount',
            args: [self.pool.id.raw, id, isDebitNormal],
          })
        )
        return id
      }

      let initData: HexString
      if (isLiability) {
        const expenseAccount = await resolveAccount(provided[AccountType.Expense], defaults?.expense, true)
        const liabilityAccount = await resolveAccount(provided[AccountType.Liability], defaults?.liability, false)
        initData = encodeFunctionData({
          abi: ABI.Hub,
          functionName: 'initializeLiability',
          args: [self.pool.id.raw, self.id.raw, assetId.raw, valuation, expenseAccount, liabilityAccount],
        })
      } else {
        const assetAccount = await resolveAccount(provided[AccountType.Asset], defaults?.asset, true)
        const equityAccount = await resolveAccount(provided[AccountType.Equity], defaults?.equity, false)
        const gainAccount = await resolveAccount(provided[AccountType.Gain], defaults?.gain, false)
        const lossAccount = await resolveAccount(provided[AccountType.Loss], defaults?.loss, true)
        initData = isV3_3(hubCtx)
          ? builders.createHolding(builderContext(hubCtx), {
              poolId: self.pool.id.toString(),
              scId: self.id.raw,
              assetId: assetId.toString(),
              valuationAddress: valuation,
              isLiability: false,
              accounts: {
                asset: assetAccount.toString(),
                equity: equityAccount.toString(),
                gain: gainAccount.toString(),
                loss: lossAccount.toString(),
              },
            }).data
          : encodeFunctionData({
              abi: ABI.Hub,
              functionName: 'initializeHolding',
              args: [
                self.pool.id.raw,
                self.id.raw,
                assetId.raw,
                valuation,
                assetAccount,
                equityAccount,
                gainAccount,
                lossAccount,
              ],
            })
      }

      const data: HexString | HexString[] = createAccountCalls.length > 0 ? [...createAccountCalls, initData] : initData
      yield* wrapTransaction('Create holding', ctx, {
        contract: hub,
        policy: { poolId: self.pool.id },
        data,
      })
    }, this.pool.centrifugeId)
  }

  /**
   * Set the share class's pool-per-share price and propagate it to every
   * network it is deployed on.
   *
   * @param pricePerShare - The new pool-per-share price.
   * @param updatedAt - When the price was struck. Defaults to
   * {@link SHARE_PRICE_TIMESTAMP_SAFETY_BUFFER_SECONDS} in the past; the chain
   * reverts `CannotSetFuturePrice` on anything at or after `block.timestamp`.
   * Only whole seconds reach the calldata.
   * @param options.refundAddress - Where unspent cross-chain gas payment is
   * returned. See {@link SharePriceWriteOptions.refundAddress}.
   * @param options.skipNetworks - Deployed networks NOT to notify. See
   * {@link SharePriceWriteOptions.skipNetworks}.
   *
   * ## Routing
   *
   * Routed to the backend's `updateSharePrice` action, which is the ONLY NAV
   * write the backend ships a builder for. Two things the SDK keeps doing, and
   * one it stops:
   *
   * - It still RESOLVES the notify set itself, over the same RPC reads as
   *   before, and sends it as `notifyNetworks`. The backend cannot derive it:
   *   the calldata is built once at preview and again at prepare, and a set
   *   read from mutable projection state would let the two disagree. It
   *   VALIDATES the set instead — a network the share class is not on is 422
   *   `SHARE_CLASS_NOT_ON_NETWORK`, one it is on but the payload omits is 422
   *   `INCOMPLETE_PRICE_NOTIFY` — so a projection that moves between the two
   *   builds surfaces as a refusal rather than as different bytes.
   * - It sends `finalDate` as the truncated instant the calldata carries, so
   *   the backend's `Math.floor(getTime() / 1000)` and this method's own
   *   truncation cannot disagree by a second.
   * - It stops defaulting the refund destination to the signer. See
   *   {@link SharePriceWriteOptions.refundAddress}.
   *
   * The input travels as `{ kind: 'navPerShare' }`: this signature takes a
   * price, so the price is what the audit row records. The backend's other input mode
   * (`navTotal`, where the backend divides by the projected issuance) has no
   * SDK method to reach it — the caller here has already done any division.
   *
   * Three behaviour changes on the backend route, all refusals rather than
   * plausible values, and none reachable on the local path:
   *
   * - A price of ZERO is refused (`OnChainAmountSchema`), where the local path
   *   encodes it. On chain a zero price is legal and catastrophic: every spoke
   *   would report the share class worthless and nothing downstream could tell
   *   it from a real quote.
   * - A `finalDate` earlier than the projected `computedAt` is refused (422
   *   `STALE_SHARE_PRICE_DATE`) — `UpdateNavModal`'s `minSelectableDate` rule,
   *   which the chain does NOT enforce and BackendPrepare mode bypasses.
   * - The action additionally needs the granular `nav:update` permission on top
   *   of `tx:prepare`.
   *
   * A network in {@link TEMPORARILY_DISABLED_CROSSCHAIN_CENTRIFUGE_IDS} or in
   * `options.skipNetworks` is skipped on both paths. If a network the share
   * class IS deployed on is left out either way, the backend answers 422
   * `INCOMPLETE_PRICE_NOTIFY` rather than sending a partial notification — it
   * knows neither the kill-switch nor the caller's choice. The kill-switch
   * list is empty today, so nothing is skipped unless the caller asks for it.
   */
  updateSharePrice(
    pricePerShare: Price,
    updatedAt = new Date(Date.now() - SHARE_PRICE_TIMESTAMP_SAFETY_BUFFER_SECONDS * 1000),
    options: SharePriceWriteOptions = {}
  ) {
    return this._root._routeDeferredTransaction(
      'updateSharePrice',
      this.pool.id.toString(),
      async () => {
        const notifyNetworks = await this._notifySharePriceNetworks(options.skipNetworks)
        return {
          poolId: this.pool.id.toString(),
          scId: this.id.raw,
          input: { kind: 'navPerShare', price: pricePerShare.toBigInt().toString() },
          // The instant the calldata carries, truncated to the second the chain
          // argument is. Sending the untruncated value would still floor to the
          // same second server-side, but the audit row would then record a
          // timestamp that is not the one on chain.
          finalDate: new Date(sharePriceComputedAt(updatedAt) * 1000).toISOString(),
          notifyNetworks: notifyNetworks.map(String),
          ...(notifyNetworks.length > 0
            ? { refundAddress: requireSharePriceRefundAddress(options) }
            : refuseUnusableRefundAddress(options)),
        }
      },
      {
        title: 'Update share price',
        centrifugeId: this.pool.centrifugeId,
        gate: [],
        local: () => this.#updateSharePriceLocal(pricePerShare, updatedAt, options),
      }
    )
  }

  #updateSharePriceLocal(pricePerShare: Price, updatedAt: Date, options: SharePriceWriteOptions) {
    const self = this
    return this._transact(async function* (ctx) {
      const [hubCtx, notifyNetworks] = await Promise.all([
        self._root.protocolContext(self.pool.id),
        self._notifySharePriceNetworks(options.skipNetworks),
      ])
      const refundAddress = options.refundAddress ?? ctx.signingAddress
      const notifications = sharePriceNotifications(hubCtx, self.pool.id, self.id.raw, notifyNetworks, refundAddress)

      const batch: HexString[] = [
        encodeFunctionData({
          abi: hubCtx.contractAbis.Hub,
          functionName: 'updateSharePrice',
          args: [self.pool.id.raw, self.id.raw, pricePerShare.toBigInt(), BigInt(sharePriceComputedAt(updatedAt))],
        }),
        ...notifications.map(({ data }) => data),
      ]

      yield* wrapTransaction('Update share price', ctx, {
        contract: hubCtx.hub,
        policy: { poolId: self.pool.id },
        data: batch,
        messages: mergeMessages(notifications.map(({ messages }) => messages)),
      })
    }, this.pool.centrifugeId)
  }

  /**
   * The networks a share-price update propagates to: every ACTIVE network of
   * the pool that has a share token for this share class, minus any the
   * cross-chain kill-switch disables and minus `skip`.
   *
   * Factored out of the local build so both routes resolve the set from the
   * same reads — the same reason `#deployState()` is factored out — and
   * returned in `pool.activeNetworks()` order.
   *
   * The order is load-bearing: it is also the backend's `notifyNetworks`
   * array order, so two builds of the same update must assemble the batch in
   * the same order to produce identical calldata. A byte-comparison against a
   * server-built batch cannot tolerate a shuffled order, and an operator's
   * confirmation code would otherwise depend on which per-network `details()`
   * read happens to resolve first. The reads still run in parallel; only the
   * assembly is ordered.
   * @internal
   */
  async _notifySharePriceNetworks(skip: CentrifugeId[] = []): Promise<CentrifugeId[]> {
    const activeNetworks = await this.pool.activeNetworks()
    const deployed = await Promise.all(
      activeNetworks.map(async (network) => {
        if (isCrosschainMessagingDisabled(network.centrifugeId) || skip.includes(network.centrifugeId)) return false
        const details = await network.details()
        return details.activeShareClasses.some((shareClass) => shareClass.id.equals(this.id))
      })
    )
    return activeNetworks.filter((_, index) => deployed[index]).map((network) => network.centrifugeId)
  }

  setMaxAssetPriceAge(assetId: AssetId, maxPriceAge: number) {
    const self = this
    return this._transact(async function* (ctx) {
      assertCrosschainMessagingEnabled(assetId.centrifugeId)

      const hubCtx = await self._root.protocolContext(self.pool.id)
      refuseOnV3_3(
        hubCtx,
        'setMaxAssetPriceAge',
        'maximum price ages were removed from the protocol with no replacement'
      )
      const { hub, contractAbis: ABI } = hubCtx
      yield* wrapTransaction('Set max asset price age', ctx, {
        contract: hub,
        policy: { poolId: self.pool.id },
        data: encodeFunctionData({
          abi: ABI.Hub,
          functionName: 'setMaxAssetPriceAge',
          args: [self.pool.id.raw, self.id.raw, assetId.raw, BigInt(maxPriceAge), ctx.signingAddress],
        }),
        messages: {
          [assetId.centrifugeId]: [{ type: MessageType.SetMaxAssetPriceAge, poolId: self.pool.id }],
        },
      })
    }, this.pool.centrifugeId)
  }

  setMaxSharePriceAge(centrifugeId: CentrifugeId, maxPriceAge: number) {
    const self = this
    return this._transact(async function* (ctx) {
      assertCrosschainMessagingEnabled(centrifugeId)

      const hubCtx = await self._root.protocolContext(self.pool.id)
      refuseOnV3_3(
        hubCtx,
        'setMaxSharePriceAge',
        'maximum price ages were removed from the protocol with no replacement'
      )
      const { hub, contractAbis: ABI } = hubCtx
      yield* wrapTransaction('Set max share price age', ctx, {
        contract: hub,
        policy: { poolId: self.pool.id },
        data: encodeFunctionData({
          abi: ABI.Hub,
          functionName: 'setMaxSharePriceAge',
          args: [self.pool.id.raw, self.id.raw, centrifugeId, BigInt(maxPriceAge), ctx.signingAddress],
        }),
        messages: {
          [centrifugeId]: [{ type: MessageType.SetMaxSharePriceAge, poolId: self.pool.id }],
        },
      })
    }, this.pool.centrifugeId)
  }

  notifyAssetPrice(assetId: AssetId) {
    const self = this
    return this._transact(async function* (ctx) {
      assertCrosschainMessagingEnabled(assetId.centrifugeId)

      const hubCtx = await self._root.protocolContext(self.pool.id)
      const { data, message } = notifyAssetPriceCall(hubCtx, self.pool.id, self.id.raw, assetId, ctx.signingAddress)
      yield* wrapTransaction('Notify asset price', ctx, {
        contract: hubCtx.hub,
        policy: { poolId: self.pool.id },
        data,
        messages: { [assetId.centrifugeId]: [message] },
      })
    }, this.pool.centrifugeId)
  }

  notifySharePrice(centrifugeId: CentrifugeId) {
    const self = this
    return this._transact(async function* (ctx) {
      assertCrosschainMessagingEnabled(centrifugeId)

      const hubCtx = await self._root.protocolContext(self.pool.id)
      const notification = sharePriceNotification(hubCtx, self.pool.id, self.id.raw, centrifugeId, ctx.signingAddress)
      yield* wrapTransaction('Notify share price', ctx, {
        contract: hubCtx.hub,
        policy: { poolId: self.pool.id },
        data: notification.data,
        messages: notification.messages,
      })
    }, this.pool.centrifugeId)
  }

  /**
   * Approve deposits and issue shares for the given assets.
   * @param assets - Array of assets to approve deposits and/or issue shares for
   * `issuePricePerShare` can be a single price for all epochs or an array of prices for each epoch to be issued for.
   * @param options.refundAddress - Where unspent cross-chain gas payment is
   * returned. Defaults to the connected signer on the local path, exactly as
   * before; REQUIRED in backend mode whenever a named asset lives on another
   * network, because the signer there may be a Fordefi vault the SDK cannot see.
   *
   * Routed to the backend's `approveDeposits` or `issueShares` action in backend
   * mode. See {@link ShareClass.approveRedeemsAndRevokeShares} and
   * `ACTION_ROUTES` in `data/routing.ts` for the three differences the split
   * makes: one leg per transaction, an epoch read from the CHAIN rather than the
   * projection, and no per-investor `notify` tail.
   */
  approveDepositsAndIssueShares(assets: DepositOrderInstruction[], options: OrderWriteOptions = {}) {
    const leg = orderLegOf(assets, 'approveAssetAmount', 'issuePricePerShare')
    return this._root._routeDeferredTransaction(
      leg === 'second' ? 'issueShares' : 'approveDeposits',
      this.pool.id.toString(),
      () => this.#depositOrderPayload(assets, leg, options),
      {
        title: leg === 'second' ? 'Issue' : 'Approve',
        centrifugeId: this.pool.centrifugeId,
        gate: assets.map(({ assetId }) => ({ assetId: assetId.toString() })),
        local: () => this.#approveDepositsAndIssueSharesLocal(assets, options),
      }
    )
  }

  /**
   * The `approveDeposits` / `issueShares` payload, or a refusal.
   *
   * ## Why a mixed call is refused rather than split
   *
   * One `PoolAction` is one transaction, and the action vocabulary deliberately
   * does not mirror the SDK's presence-discriminated union — the action names
   * are protocol-neutral and shared with the backend: approving commits an aggregate
   * against an epoch's pending total, issuing sets the price that epoch settles
   * at, and "both" and "neither" are states a wire contract should not be able
   * to reach. Falling back to the local build for the mixed shape would be the
   * worse answer — the same calldata, but signed by the connected wallet with no
   * policy evaluation, no approval quorum and no audit row, decided by which
   * KEYS a caller happened to put in an array. So it refuses and names the two
   * calls that express it.
   *
   * ## Where the epochs come from, and why not from `pendingAmounts()`
   *
   * From the CHAIN (`BatchRequestManager.nowDepositEpoch` / `nowIssueEpoch`),
   * not from the projection. Two reasons. The contract requires the exact
   * current epoch (`EpochNotInSequence`), so the chain is the authority. And in
   * backend mode `pendingAmounts()` cannot run at all: it composes
   * `investOrderState` / `redeemOrderState`, both of which answer 503
   * `NOT_YET_PROJECTED` while `chain_v1.{invest,redeem}_order.account` carries
   * the wrong `bytes32` convention — so deriving the epoch from it would make
   * this path refuse for a reason that has nothing to do with the epoch.
   *
   * ## What is NOT checked here
   *
   * The pending ceiling. The local path compares the approval against
   * `pendingAmounts()`; the backend compares it against `epochOutstandingInvest`
   * and answers 422 `DEPOSIT_APPROVAL_EXCEEDS_PENDING`. Keeping the check
   * server-side is the point: the two sides measure the same ceiling in the
   * ASSET's smallest unit, where the redeem side measures it in SHARE tokens and
   * answers `REDEEM_APPROVAL_EXCEEDS_PENDING`. The codes stay distinct because
   * the units are.
   */
  async #depositOrderPayload(assets: DepositOrderInstruction[], leg: OrderLeg, options: OrderWriteOptions) {
    requireDistinctAssets(assets)
    if (leg === 'both') {
      throw new Error(
        `Cannot build one backend action for shareClass.approveDepositsAndIssueShares(): the call ` +
          `carries both an approval and an issuance, and the backend's action vocabulary splits them ` +
          `into "approveDeposits" and "issueShares" — one transaction each, with different arguments ` +
          `and different message counts. Call approveDepositsAndIssueShares() once with only ` +
          `\`approveAssetAmount\` entries and once with only \`issuePricePerShare\` entries. (The local ` +
          `build could batch both, but running it here would sign a pool action through the connected ` +
          `wallet with no policy evaluation and no audit row.)`
      )
    }

    const scope = { poolId: this.pool.id.toString(), scId: this.id.raw }
    const refund = this.#orderRefund(assets, options, 'approveDepositsAndIssueShares')

    if (leg === 'first') {
      const approvals = await Promise.all(
        assets.map(async (asset) => {
          const { approveAssetAmount, approvePricePerAsset } = asset as {
            approveAssetAmount: Balance
            approvePricePerAsset: Balance
          }
          if (approveAssetAmount.lte(0n)) {
            throw new Error(`Approve amount must be greater than 0 for asset "${asset.assetId.toString()}"`)
          }
          const { depositEpoch } = await this.#depositEpochs(asset.assetId)
          return {
            assetId: asset.assetId.toString(),
            epochId: String(depositEpoch),
            approvedAssetAmount: approveAssetAmount.toBigInt().toString(),
            pricePoolPerAsset: approvePricePerAsset.toBigInt().toString(),
          }
        })
      )
      return { ...scope, approvals, ...refund }
    }

    const issuances = await Promise.all(
      assets.map(async (asset) => {
        const { depositEpoch, issueEpoch } = await this.#depositEpochs(asset.assetId)
        const prices = epochPrices(
          (asset as { issuePricePerShare?: Price | Price[] }).issuePricePerShare,
          depositEpoch - issueEpoch,
          asset.assetId,
          'Issue price per share',
          'Nothing to issue'
        )
        return { assetId: asset.assetId.toString(), fromEpochId: String(issueEpoch), navPerShare: prices }
      })
    )
    // No `notify` tail. `notifyDeposit` takes the investor as `bytes32` and the
    // backend cannot recover one: `chain_v1.invest_order.account` is decoded
    // with the LEFT-padded convention against a protocol that RIGHT-pads (463
    // of 499 rows, 463 of 463 on the async ones this would page). Supplying the
    // field is 503 `NOT_YET_PROJECTED` from `OrderWriteResolver`, so sending an
    // empty one would only turn a refusal into a silent no-tail. It is absent
    // here for the same reason, and the difference is stated in ACTION_ROUTES:
    // the local build batches the notifications, this route does not.
    return { ...scope, issuances, ...refund }
  }

  /** `nowDepositEpoch` / `nowIssueEpoch` for one asset, read from the chain. */
  async #depositEpochs(assetId: AssetId) {
    const contract = await this.#batchRequestManager()
    const [depositEpoch, issueEpoch] = await Promise.all([
      contract.read.nowDepositEpoch([this.pool.id.raw, this.id.raw, assetId.raw]),
      contract.read.nowIssueEpoch([this.pool.id.raw, this.id.raw, assetId.raw]),
    ])
    return { depositEpoch: Number(depositEpoch), issueEpoch: Number(issueEpoch) }
  }

  /** `nowRedeemEpoch` / `nowRevokeEpoch` for one asset, read from the chain. */
  async #redeemEpochs(assetId: AssetId) {
    const contract = await this.#batchRequestManager()
    const [redeemEpoch, revokeEpoch] = await Promise.all([
      contract.read.nowRedeemEpoch([this.pool.id.raw, this.id.raw, assetId.raw]),
      contract.read.nowRevokeEpoch([this.pool.id.raw, this.id.raw, assetId.raw]),
    ])
    return { redeemEpoch: Number(redeemEpoch), revokeEpoch: Number(revokeEpoch) }
  }

  async #batchRequestManager() {
    const [{ batchRequestManager, contractAbis: ABI }, client] = await Promise.all([
      this._root.protocolContext(this.pool.id),
      firstValueFrom(this._root.getClient(this.pool.centrifugeId)),
    ])
    return getContract({ address: batchRequestManager, abi: ABI.BatchRequestManager, client })
  }

  /**
   * The `refundAddress` field of an order payload: present iff the transaction
   * dispatches a cross-chain message, absent otherwise.
   *
   * The rule is the builder's (`resolveRefund` in `packages/protocol`) and the
   * DTO's (`refuseRefundMismatch`), restated on this side so the caller hears
   * about a missing address here rather than as a 422 after a round trip. An
   * asset on the pool's own chain dispatches nothing —
   * `MessageDispatcher.sendRequestCallback` short-circuits the bridge — and a
   * national currency (`centrifugeId 0`) is not a network at all.
   *
   * No default. The zero address is a burn, and the connected wallet is the
   * wrong guess on the custodial route, where the signer is a Fordefi vault: the
   * refund would land in an account the operator does not control.
   */
  #orderRefund(assets: { assetId: AssetId }[], options: OrderWriteOptions, method: string) {
    const dispatches = assets.some(
      (asset) => !asset.assetId.isNationalCurrency && asset.assetId.centrifugeId !== this.pool.centrifugeId
    )
    if (!dispatches) return {}
    if (!options.refundAddress) {
      throw new Error(
        `shareClass.${method}() needs an explicit { refundAddress } in backend mode: this transaction ` +
          `dispatches a paid cross-chain message to another network and the unspent gas payment needs a ` +
          `destination. It is not defaulted to the connected wallet, because on the custodial route the ` +
          `signer is the pool's Fordefi vault and the refund would go to an account the operator does ` +
          `not control.`
      )
    }
    return { refundAddress: options.refundAddress }
  }

  #approveDepositsAndIssueSharesLocal(assets: DepositOrderInstruction[], options: OrderWriteOptions = {}) {
    const self = this
    return this._transact(async function* (ctx) {
      const refundAddress = options.refundAddress ?? ctx.signingAddress
      const [hubCtx, pendingAmountsData, orders] = await Promise.all([
        self._root.protocolContext(self.pool.id),
        self.pendingAmounts(),
        firstValueFrom(
          self._investOrders().pipe(
            switchMap((investOrders) => {
              if (investOrders.investOrders.length === 0) return of([])

              return combineLatest(
                investOrders.investOrders
                  .filter((order) => !order.issuedAt)
                  .map((order) => self._investorOrder(order.assetId, order.investor))
              )
            })
          )
        ),
      ])
      const pendingAmounts = pendingAmountsData.byVault

      const ordersByAssetId: Record<string, typeof orders> = {}
      orders.forEach((order) => {
        if (order.pendingDeposit === 0n) return
        const id = order.assetId.toString()
        if (!ordersByAssetId[id]) ordersByAssetId[id] = []
        // Prevent deduplicate investor orders: _investorOrder returns investor-level data (not per-epoch),
        // so multiple epoch entries for the same investor will cause duplicate notifyDeposit calls
        if (ordersByAssetId[id].some((o) => o.investor === order.investor)) return
        ordersByAssetId[id].push(order)
      })

      const uniqueAssets = new Set(assets.map((a) => a.assetId.toString()))
      if (uniqueAssets.size !== assets.length) {
        throw new Error('Assets array contains multiple entries for the same asset ID')
      }

      const crosschainEnabledAssets = assets.filter(
        (asset) => !isCrosschainMessagingDisabled(asset.assetId.centrifugeId)
      )
      const assetsWithApprove = crosschainEnabledAssets.filter((a) => 'approveAssetAmount' in a).length
      const assetsWithIssue = crosschainEnabledAssets.filter((a) => 'issuePricePerShare' in a).length

      const { batchRequestManager, contractAbis: ABI } = hubCtx
      const batch: HexString[] = []
      const messages: Record<number, MessageTypeWithSubType[]> = {}
      // v3.3 sends approvals and issuances through Hub.managerCall, and the
      // notifications, which stay direct BatchRequestManager calls, cannot share
      // that batch: they go out in a second transaction.
      const notifications: ClaimNotification[] = []
      const notifyMessages: Record<number, MessageTypeWithSubType[]> = {}
      const v3_3 = isV3_3(hubCtx)
      const managerRefund = orderManagerRefund(crosschainEnabledAssets, self.pool.centrifugeId, refundAddress)

      for (const asset of crosschainEnabledAssets) {
        let hubMessages = 0
        const pending = pendingAmounts.find((e) => e.assetId.equals(asset.assetId))
        if (!pending) {
          throw new Error(`No pending amount found for asset "${asset.assetId.toString()}"`)
        }

        let nowDepositEpoch = pending?.depositEpoch

        if ('approveAssetAmount' in asset) {
          if (asset.approveAssetAmount.gt(pending.pendingDeposit)) {
            throw new Error(`Approve amount exceeds pending amount for asset "${asset.assetId.toString()}"`)
          }
          if (asset.approveAssetAmount.lte(0n)) {
            throw new Error(`Approve amount must be greater than 0 for asset "${asset.assetId.toString()}"`)
          }
          batch.push(
            v3_3
              ? encodeOrderManagerCall(
                  hubCtx,
                  {
                    kind: 'approveDeposits',
                    scId: self.id.raw,
                    assetId: asset.assetId.toString(),
                    epochId: String(nowDepositEpoch),
                    approvedAssetAmount: asset.approveAssetAmount.toBigInt().toString(),
                    pricePoolPerAsset: asset.approvePricePerAsset.toBigInt().toString(),
                    refundAddress: managerRefund,
                  },
                  managerRefund
                )
              : encodeFunctionData({
                  abi: ABI.BatchRequestManager,
                  functionName: 'approveDeposits',
                  args: [
                    self.pool.id.raw,
                    self.id.raw,
                    asset.assetId.raw,
                    nowDepositEpoch,
                    asset.approveAssetAmount.toBigInt(),
                    asset.approvePricePerAsset.toBigInt(),
                    refundAddress,
                  ],
                })
          )
          addMessageForEnabledTarget(messages, asset.assetId.centrifugeId, {
            type: MessageType.RequestCallback,
            poolId: self.pool.id,
          })
          hubMessages++
          nowDepositEpoch++
        }

        const nowIssueEpoch = pending.issueEpoch

        if ('issuePricePerShare' in asset) {
          if (nowIssueEpoch >= nowDepositEpoch) throw new Error('Nothing to issue')

          let i
          for (i = 0; i < nowDepositEpoch - nowIssueEpoch; i++) {
            const price = Array.isArray(asset.issuePricePerShare)
              ? asset.issuePricePerShare[i]
              : asset.issuePricePerShare
            if (!price) break

            if (price.lte(0n)) {
              throw new Error(`Issue price per share must be greater than 0 for asset "${asset.assetId.toString()}"`)
            }

            batch.push(
              v3_3
                ? encodeOrderManagerCall(
                    hubCtx,
                    {
                      kind: 'issueShares',
                      scId: self.id.raw,
                      assetId: asset.assetId.toString(),
                      epochId: String(nowIssueEpoch + i),
                      pricePoolPerShare: price.toBigInt().toString(),
                      refundAddress: managerRefund,
                    },
                    managerRefund
                  )
                : encodeFunctionData({
                    abi: ABI.BatchRequestManager,
                    functionName: 'issueShares',
                    args: [
                      self.pool.id.raw,
                      self.id.raw,
                      asset.assetId.raw,
                      nowIssueEpoch + i,
                      price.toBigInt(),
                      0n,
                      refundAddress,
                    ],
                  })
            )
            addMessageForEnabledTarget(messages, asset.assetId.centrifugeId, {
              type: MessageType.RequestCallback,
              poolId: self.pool.id,
            })
            hubMessages++
          }
          // If we've issued shares, also notify a number of invest orders
          if (i) {
            const claims = claimNotificationBudget(asset.assetId, self.pool.centrifugeId, assetsWithIssue, hubMessages)
            const assetOrders = ordersByAssetId[asset.assetId.toString()]
            assetOrders?.slice(0, claims).forEach((order) => {
              if (order.pendingDeposit > 0n && options.notify !== false) {
                const notification = {
                  assetId: asset.assetId,
                  investor: order.investor,
                  maxClaims: order.maxDepositClaims + i, // maxDepositClaims is the current claimable count, +i for the newly issued epochs in this batch
                }
                if (v3_3) notifications.push(notification)
                else
                  batch.push(
                    ...encodeClaimNotifications(
                      hubCtx,
                      'deposit',
                      self.pool.id,
                      self.id.raw,
                      [notification],
                      refundAddress
                    )
                  )
                addMessageForEnabledTarget(v3_3 ? notifyMessages : messages, asset.assetId.centrifugeId, {
                  type: MessageType.RequestCallback,
                  poolId: self.pool.id,
                })
              }
            })
          }
        }
      }

      if (batch.length === 0) {
        throw new Error('No approve or issue actions provided')
      }
      let title = 'Approve and issue'
      if (assetsWithApprove === 0) {
        title = 'Issue'
      } else if (assetsWithIssue === 0) {
        title = 'Approve'
      }

      if (ctx.isBatching && notifications.length > 0) {
        throw new UnsupportedForProtocolVersionError(
          'order claim notifications',
          hubCtx.protocolVersion,
          'they are a second transaction, which a built or batched transaction cannot carry. Pass ' +
            '{ notify: false } and notify the investors with claimDeposit / claimRedeem afterwards'
        )
      }

      const result = yield* wrapTransaction(title, ctx, {
        contract: v3_3 ? hubCtx.hub : batchRequestManager,
        policy: { poolId: self.pool.id },
        data: batch,
        messages,
        // A v3.3 managerCall's callback is paid from the hub batch, so even one call is wrapped.
        alwaysBatch: v3_3,
      })
      // A refused approve or issue must not be followed by the claim notifications.
      if (result?.type === 'OutOfPolicy') return
      if (notifications.length > 0) {
        yield* wrapTransaction('Notify claims', ctx, {
          contract: batchRequestManager,
          data: encodeClaimNotifications(hubCtx, 'deposit', self.pool.id, self.id.raw, notifications, refundAddress),
          messages: notifyMessages,
        })
      }
    }, this.pool.centrifugeId)
  }

  /**
   * Approve redeems and revoke shares for the given assets.
   * @param assets - Array of assets to approve redeems and/or revoke shares for
   * `approveShareAmount` can be a single amount for all epochs or an array of amounts for each epoch to be revoked.
   * @param options.refundAddress - See
   * {@link ShareClass.approveDepositsAndIssueShares}. Only the REVOKE leg can
   * need one: `approveRedeems` dispatches no cross-chain message at all.
   *
   * Routed to the backend's `approveRedeems` or `revokeShares` action in backend
   * mode, split for the same reason the deposit side is.
   */
  approveRedeemsAndRevokeShares(assets: RedeemOrderInstruction[], options: OrderWriteOptions = {}) {
    const leg = orderLegOf(assets, 'approveShareAmount', 'revokePricePerShare')
    return this._root._routeDeferredTransaction(
      leg === 'second' ? 'revokeShares' : 'approveRedeems',
      this.pool.id.toString(),
      () => this.#redeemOrderPayload(assets, leg, options),
      {
        title: leg === 'second' ? 'Revoke' : 'Approve',
        centrifugeId: this.pool.centrifugeId,
        gate: assets.map(({ assetId }) => ({ assetId: assetId.toString() })),
        local: () => this.#approveRedeemsAndRevokeSharesLocal(assets, options),
      }
    )
  }

  /**
   * The `approveRedeems` / `revokeShares` payload, or a refusal. The redeem
   * mirror of {@link ShareClass.approveDepositsAndIssueShares}'s payload; read
   * that one for why a mixed call refuses and where the epochs come from.
   *
   * ## `approveRedeems` carries NO refund address, and that is the contract
   *
   * `BatchRequestManager.approveRedeems` dispatches nothing — its body ends at
   * `emit ApproveRedeems(...)` — and is the only one of the four whose signature
   * has no `refund` parameter. The function is still `payable`, the contract has
   * no `receive` and no recovery path, so wei attached to a standalone
   * `approveRedeems` is STRANDED. Over-paying here is unrecoverable, which is
   * why the zero is stated rather than left to a default.
   */
  async #redeemOrderPayload(assets: RedeemOrderInstruction[], leg: OrderLeg, options: OrderWriteOptions) {
    requireDistinctAssets(assets)
    if (leg === 'both') {
      throw new Error(
        `Cannot build one backend action for shareClass.approveRedeemsAndRevokeShares(): the call ` +
          `carries both an approval and a revocation, and the backend's action vocabulary splits them ` +
          `into "approveRedeems" and "revokeShares" — one transaction each. Call ` +
          `approveRedeemsAndRevokeShares() once with only \`approveShareAmount\` entries and once with ` +
          `only \`revokePricePerShare\` entries.`
      )
    }

    const scope = { poolId: this.pool.id.toString(), scId: this.id.raw }

    if (leg === 'first') {
      const approvals = await Promise.all(
        assets.map(async (asset) => {
          const { approveShareAmount, approvePricePerAsset } = asset as {
            approveShareAmount: Balance
            approvePricePerAsset: Balance
          }
          if (approveShareAmount.lte(0n)) {
            throw new Error(`Share amount must be greater than 0 for asset "${asset.assetId.toString()}"`)
          }
          const { redeemEpoch } = await this.#redeemEpochs(asset.assetId)
          return {
            assetId: asset.assetId.toString(),
            epochId: String(redeemEpoch),
            approvedShareAmount: approveShareAmount.toBigInt().toString(),
            pricePoolPerAsset: approvePricePerAsset.toBigInt().toString(),
          }
        })
      )
      // No `refundAddress`: see the note above. Sending one is a 422, not a
      // harmless extra field, and the DTO refuses it precisely so nobody reads
      // this action's zero `msg.value` as an omission.
      return { ...scope, approvals }
    }

    const revocations = await Promise.all(
      assets.map(async (asset) => {
        const { redeemEpoch, revokeEpoch } = await this.#redeemEpochs(asset.assetId)
        const prices = epochPrices(
          (asset as { revokePricePerShare: Price | Price[] }).revokePricePerShare,
          redeemEpoch - revokeEpoch,
          asset.assetId,
          'Revoke price per share',
          'Nothing to revoke'
        )
        return { assetId: asset.assetId.toString(), fromEpochId: String(revokeEpoch), navPerShare: prices }
      })
    )
    // No `notify` tail: `chain_v1.redeem_order.account` is corrupted on 323 of
    // 323 live rows, so `notifyRedeem`'s `bytes32 investor` is not recoverable.
    // See the deposit side for the whole note.
    return { ...scope, revocations, ...this.#orderRefund(assets, options, 'approveRedeemsAndRevokeShares') }
  }

  #approveRedeemsAndRevokeSharesLocal(assets: RedeemOrderInstruction[], options: OrderWriteOptions = {}) {
    const self = this
    return this._transact(async function* (ctx) {
      const refundAddress = options.refundAddress ?? ctx.signingAddress
      const [hubCtx, pendingAmountsData, orders] = await Promise.all([
        self._root.protocolContext(self.pool.id),
        self.pendingAmounts(),
        firstValueFrom(
          self._redeemOrders().pipe(
            switchMap((redeemOrders) => {
              if (redeemOrders.redeemOrders.length === 0) return of([])

              return combineLatest(
                redeemOrders.redeemOrders
                  .filter((order) => !order.revokedAt)
                  .map((order) => self._investorOrder(order.assetId, order.investor))
              )
            })
          )
        ),
      ])
      const pendingAmounts = pendingAmountsData.byVault

      const ordersByAssetId: Record<string, typeof orders> = {}
      orders.forEach((order) => {
        if (order.pendingRedeem === 0n) return
        const id = order.assetId.toString()
        if (!ordersByAssetId[id]) ordersByAssetId[id] = []
        // Prevent deduplicate investor orders: _investorOrder returns investor-level data (not per-epoch),
        // so multiple epoch entries for the same investor will cause duplicate notifyRedeem calls
        if (ordersByAssetId[id].some((o) => o.investor === order.investor)) return
        ordersByAssetId[id].push(order)
      })

      const uniqueAssets = new Set(assets.map((a) => a.assetId.toString()))
      if (uniqueAssets.size !== assets.length) {
        throw new Error('Assets array contains multiple entries for the same asset ID')
      }

      const crosschainEnabledAssets = assets.filter(
        (asset) => !isCrosschainMessagingDisabled(asset.assetId.centrifugeId)
      )
      const assetsWithApprove = crosschainEnabledAssets.filter((a) => 'approveShareAmount' in a).length
      const assetsWithRevoke = crosschainEnabledAssets.filter((a) => 'revokePricePerShare' in a).length

      const { batchRequestManager, contractAbis: ABI } = hubCtx
      const batch: HexString[] = []
      const messages: Record<number, MessageTypeWithSubType[]> = {}
      // See #approveDepositsAndIssueSharesLocal: on v3.3 the notifications go out in a second transaction.
      const notifications: ClaimNotification[] = []
      const notifyMessages: Record<number, MessageTypeWithSubType[]> = {}
      const v3_3 = isV3_3(hubCtx)
      const managerRefund = orderManagerRefund(crosschainEnabledAssets, self.pool.centrifugeId, refundAddress)

      for (const asset of crosschainEnabledAssets) {
        let hubMessages = 0
        const pending = pendingAmounts.find((e) => e.assetId.equals(asset.assetId))
        if (!pending) {
          throw new Error(`No pending amount found for asset "${asset.assetId.toString()}"`)
        }

        let nowRedeemEpoch = pending.redeemEpoch

        if ('approveShareAmount' in asset) {
          if (asset.approveShareAmount.gt(pending.pendingRedeem)) {
            throw new Error(`Share amount exceeds pending redeem for asset "${asset.assetId.toString()}"`)
          }
          if (asset.approveShareAmount.lte(0n)) {
            throw new Error(`Share amount must be greater than 0 for asset "${asset.assetId.toString()}"`)
          }
          batch.push(
            v3_3
              ? encodeOrderManagerCall(
                  hubCtx,
                  {
                    kind: 'approveRedeems',
                    scId: self.id.raw,
                    assetId: asset.assetId.toString(),
                    epochId: String(nowRedeemEpoch),
                    approvedShareAmount: asset.approveShareAmount.toBigInt().toString(),
                    pricePoolPerAsset: asset.approvePricePerAsset.toBigInt().toString(),
                  },
                  // approveRedeems dispatches nothing, so its refund is inert.
                  zeroAddress
                )
              : encodeFunctionData({
                  abi: ABI.BatchRequestManager,
                  functionName: 'approveRedeems',
                  args: [
                    self.pool.id.raw,
                    self.id.raw,
                    asset.assetId.raw,
                    nowRedeemEpoch,
                    asset.approveShareAmount.toBigInt(),
                    asset.approvePricePerAsset.toBigInt(),
                  ],
                })
          )
          nowRedeemEpoch++
        }

        const nowRevokeEpoch = pending.revokeEpoch
        if ('revokePricePerShare' in asset) {
          if (nowRevokeEpoch >= nowRedeemEpoch) throw new Error('Nothing to revoke')

          let i
          for (i = 0; i < nowRedeemEpoch - nowRevokeEpoch; i++) {
            const price = Array.isArray(asset.revokePricePerShare)
              ? asset.revokePricePerShare[i]
              : asset.revokePricePerShare
            if (!price) break

            if (price.lte(0n)) {
              throw new Error(`Revoke price per share must be greater than 0 for asset "${asset.assetId.toString()}"`)
            }

            batch.push(
              v3_3
                ? encodeOrderManagerCall(
                    hubCtx,
                    {
                      kind: 'revokeShares',
                      scId: self.id.raw,
                      assetId: asset.assetId.toString(),
                      epochId: String(nowRevokeEpoch + i),
                      pricePoolPerShare: price.toBigInt().toString(),
                      refundAddress: managerRefund,
                    },
                    managerRefund
                  )
                : encodeFunctionData({
                    abi: ABI.BatchRequestManager,
                    functionName: 'revokeShares',
                    args: [
                      self.pool.id.raw,
                      self.id.raw,
                      asset.assetId.raw,
                      nowRevokeEpoch + i,
                      price.toBigInt(),
                      0n,
                      refundAddress,
                    ],
                  })
            )
            addMessageForEnabledTarget(messages, asset.assetId.centrifugeId, {
              type: MessageType.RequestCallback,
              poolId: self.pool.id,
            })
            hubMessages++
          }

          // If we've revoked shares, also notify a number of redeem orders
          if (i) {
            const claims = claimNotificationBudget(asset.assetId, self.pool.centrifugeId, assetsWithRevoke, hubMessages)
            const assetOrders = ordersByAssetId[asset.assetId.toString()]
            assetOrders?.slice(0, claims).forEach((order) => {
              if (order.pendingRedeem > 0n && options.notify !== false) {
                const notification = {
                  assetId: asset.assetId,
                  investor: order.investor,
                  maxClaims: order.maxRedeemClaims + i, // maxRedeemClaims is the current claimable count, +i for the newly revoked epochs in this batch
                }
                if (v3_3) notifications.push(notification)
                else
                  batch.push(
                    ...encodeClaimNotifications(
                      hubCtx,
                      'redeem',
                      self.pool.id,
                      self.id.raw,
                      [notification],
                      refundAddress
                    )
                  )
                addMessageForEnabledTarget(v3_3 ? notifyMessages : messages, asset.assetId.centrifugeId, {
                  type: MessageType.RequestCallback,
                  poolId: self.pool.id,
                })
              }
            })
          }
        }
      }
      if (batch.length === 0) {
        throw new Error('No approve or revoke actions provided')
      }

      let title = 'Approve and revoke'
      if (assetsWithApprove === 0) {
        title = 'Revoke'
      } else if (assetsWithRevoke === 0) {
        title = 'Approve'
      }

      if (ctx.isBatching && notifications.length > 0) {
        throw new UnsupportedForProtocolVersionError(
          'order claim notifications',
          hubCtx.protocolVersion,
          'they are a second transaction, which a built or batched transaction cannot carry. Pass ' +
            '{ notify: false } and notify the investors with claimDeposit / claimRedeem afterwards'
        )
      }

      const result = yield* wrapTransaction(title, ctx, {
        contract: v3_3 ? hubCtx.hub : batchRequestManager,
        policy: { poolId: self.pool.id },
        data: batch,
        messages,
        alwaysBatch: v3_3,
      })
      // A refused approve or revoke must not be followed by the claim notifications.
      if (result?.type === 'OutOfPolicy') return
      if (notifications.length > 0) {
        yield* wrapTransaction('Notify claims', ctx, {
          contract: batchRequestManager,
          data: encodeClaimNotifications(hubCtx, 'redeem', self.pool.id, self.id.raw, notifications, refundAddress),
          messages: notifyMessages,
        })
      }
    }, this.pool.centrifugeId)
  }

  #claimGate(action: 'claimDeposit' | 'claimRedeem', assetId: AssetId) {
    return { poolId: this.pool.id.toString(), action, targets: [{ assetId: assetId.toString() }] }
  }

  /**
   * Claim a deposit on the Hub side for the given asset and investor after the shares have been issued.
   * This will send a message to the Spoke that will allow the investor to claim their shares.
   *
   * ## Stays on the local build in every mode today, and why
   *
   * There is no `notifyDeposit` action to route it to. The backend's vocabulary
   * carries the notification only as the optional `notify` tail of
   * `issueShares` / `revokeShares`, and that tail answers 503
   * `NOT_YET_PROJECTED`: `notifyDeposit` takes the investor as a `bytes32` and
   * `chain_v1.invest_order.account` is decoded with the LEFT-padded convention
   * against a protocol that RIGHT-pads, so the address is not recoverable from
   * the projection. Embrio owns the fix, and there is deliberately no local
   * repair.
   *
   * This method is unaffected by that, because its investor is CALLER-supplied
   * rather than projection-derived — the same thing that keeps
   * `issueSharesDirect` clear of the bug. `maxDepositClaims` likewise comes from
   * the chain (`_investorOrder` reads `BatchRequestManager.maxDepositClaims`
   * keyed by the RIGHT-padded `bytes32`), never from the corrupted column, so a
   * caller who knows the investor gets a correct claim count in both modes.
   */
  claimDeposit(assetId: AssetId, investor: HexString) {
    const self = this
    return this._gatedTransact(this.#claimGate('claimDeposit', assetId), this.pool.centrifugeId, async function* (ctx) {
      assertCrosschainMessagingEnabled(assetId.centrifugeId)

      const [hubCtx, investorOrder] = await Promise.all([
        self._root.protocolContext(self.pool.id),
        self._investorOrder(assetId, investor),
      ])
      yield* wrapTransaction('Claim deposit', ctx, {
        contract: hubCtx.batchRequestManager,
        data: encodeClaimNotifications(
          hubCtx,
          'deposit',
          self.pool.id,
          self.id.raw,
          [{ assetId, investor, maxClaims: investorOrder.maxDepositClaims }],
          ctx.signingAddress
        ),
        messages: { [assetId.centrifugeId]: [{ type: MessageType.RequestCallback, poolId: self.pool.id }] },
      })
    })
  }

  /**
   * Claim a redemption on the Hub side for the given asset and investor after the shares have been revoked.
   * This will send a message to the Spoke that will allow the investor to claim their redeemed currency.
   *
   * Stays on the local build in every mode today, for the reason
   * {@link ShareClass.claimDeposit} states — with `redeem_order.account`
   * corrupted on 323 of 323 live mainnet rows rather than 463 of 499.
   */
  claimRedeem(assetId: AssetId, investor: HexString) {
    const self = this
    return this._gatedTransact(this.#claimGate('claimRedeem', assetId), this.pool.centrifugeId, async function* (ctx) {
      assertCrosschainMessagingEnabled(assetId.centrifugeId)

      const [hubCtx, investorOrder] = await Promise.all([
        self._root.protocolContext(self.pool.id),
        self._investorOrder(assetId, investor),
      ])
      yield* wrapTransaction('Claim redeem', ctx, {
        contract: hubCtx.batchRequestManager,
        data: encodeClaimNotifications(
          hubCtx,
          'redeem',
          self.pool.id,
          self.id.raw,
          [{ assetId, investor, maxClaims: investorOrder.maxRedeemClaims }],
          ctx.signingAddress
        ),
        messages: { [assetId.centrifugeId]: [{ type: MessageType.RequestCallback, poolId: self.pool.id }] },
      })
    })
  }

  /**
   * Update a member of the share class.
   * @param address Address of the investor
   * @param validUntil Time in seconds from Unix epoch until the investor is valid
   * @param centrifugeId Centrifuge ID of the network on which to update the member
   * @param options.refundAddress Where unspent cross-chain gas is returned. Required in backend
   *   mode; on the local path the signing address is used, as before.
   */
  updateMember(
    address: HexString,
    validUntil: number,
    centrifugeId: CentrifugeId,
    options: RestrictionWriteOptions = {}
  ) {
    return this.updateMembers([{ address, validUntil, centrifugeId }], options)
  }

  /**
   * Batch update a list of members of the share class.
   * @param members Array of members to update, each with address, validUntil and centrifugeId
   * @param members.address Address of the investor
   * @param members.validUntil Time in seconds from Unix epoch until the investor is valid
   * @param members.centrifugeId Centrifuge ID of the network on which to update the member
   * @param options.refundAddress See {@link ShareClass.updateMember}.
   *
   * ## Backend mode takes ONE member, and refuses a batch rather than dropping to the wallet
   *
   * The backend's `updateMember` action is deliberately per-investor per-network: the management app
   * edits one investor at a time and already issues one transaction per change, so the backend
   * shipped no batch (`pool-action.ts`, "no batching, unlike `updateVaults`"). A multi-member call
   * therefore has no action to carry it.
   *
   * It REFUSES instead of falling back to `LocalBuild`, which is the fallback every unrouted
   * action takes. The difference is that this one IS routed: silently building it locally would
   * take a whitelist edit around the policy engine, the approval quorum and the audit row, and on
   * the custodial route there is no browser wallet to sign it with anyway — so the "fallback"
   * would be a security downgrade that then failed at signing time. Split the batch, or call
   * `updateMember` per investor.
   */
  updateMembers(
    members: { address: HexString; validUntil: number; centrifugeId: CentrifugeId }[],
    options: RestrictionWriteOptions = {}
  ) {
    return this._root._routeDeferredTransaction(
      'updateMember',
      this.pool.id.toString(),
      async () => {
        // The same kill-switch the local path applies, applied first, so the two
        // agree on which networks a call touches before the arity is judged.
        const enabled = filterCrosschainEnabledTargets(members)
        if (enabled.length === 0) {
          throw new Error('No data to update members')
        }
        if (enabled.length > 1) {
          throw new Error(
            `shareClass.updateMembers() cannot batch ${enabled.length} members in backend mode: ` +
              "the backend's `updateMember` action is one investor on one network, by design. Call " +
              'updateMember() per investor. Refusing rather than building this locally, which ' +
              'would take the edit around the policy engine and the approval quorum.'
          )
        }
        const member = enabled[0]!
        if (!options.refundAddress) {
          throw new Error(
            'shareClass.updateMember() needs an explicit { refundAddress } in backend mode: ' +
              'Hub.updateRestriction dispatches a paid cross-chain message and returns the unspent ' +
              'gas to that address, and the backend builds the calldata before any signer is ' +
              'resolved. Pass the address that will sign — the pool vault address on the Fordefi ' +
              'route.'
          )
        }
        return {
          poolId: this.pool.id.toString(),
          scId: this.id.raw,
          centrifugeId: String(member.centrifugeId),
          address: member.address,
          refundAddress: options.refundAddress,
          // `add` is sugar for the MAX_UINT32 sentinel and must NOT carry a
          // `validUntil` (the DTO refuses both together — two sources for one
          // field). Every other instant is a scheduled expiry, which is what
          // `op: "remove"` means on the wire: the hook reverts on a PAST
          // timestamp, so "remove" is always "expire at this future instant",
          // never a backdated one.
          ...(member.validUntil === MEMBERSHIP_NEVER_EXPIRES
            ? { op: 'add' as const }
            : { op: 'remove' as const, validUntil: String(member.validUntil) }),
        }
      },
      {
        title: `Update member${members.length > 1 ? 's' : ''}`,
        centrifugeId: this.pool.centrifugeId,
        gate: members.map(({ centrifugeId }) => ({ centrifugeId })),
        local: () => this.#updateMembersLocal(members),
      }
    )
  }

  #updateMembersLocal(members: { address: HexString; validUntil: number; centrifugeId: CentrifugeId }[]) {
    const self = this

    return this._transact(async function* (ctx) {
      const { hub, contractAbis: ABI } = await self._root.protocolContext(self.pool.id)

      const batch: HexString[] = []
      const messages: Record<number, MessageTypeWithSubType[]> = {}

      filterCrosschainEnabledTargets(members).forEach((member) => {
        batch.push(
          encodeFunctionData({
            abi: ABI.Hub,
            functionName: 'updateRestriction',
            args: [
              self.pool.id.raw,
              self.id.raw,
              member.centrifugeId,
              encodePacked(
                ['uint8', 'bytes32', 'uint64'],
                [/* UpdateRestrictionType.Member */ 1, addressToBytes32(member.address), BigInt(member.validUntil)]
              ),
              0n,
              ctx.signingAddress,
            ],
          })
        )
        addMessageForEnabledTarget(messages, member.centrifugeId, {
          type: MessageType.UpdateRestriction,
          poolId: self.pool.id,
        })
      })

      if (batch.length === 0) {
        throw new Error('No data to update members')
      }

      yield* wrapTransaction(`Update member${batch.length > 1 ? 's' : ''}`, ctx, {
        contract: hub,
        policy: { poolId: self.pool.id },
        data: batch,
        messages,
      })
    }, this.pool.centrifugeId)
  }

  /**
   * Retrieve all holders of the share class.
   * @param options Optional pagination and filter options object
   * @param options.limit Number of results to return (default: 20)
   * @param options.offset Offset for pagination (default: 0)
   * @param options.orderBy Order by field (default: "balance")
   * @param options.orderDirection Order direction (default: "desc")
   * @param options.filter Optional filter criteria
   * @param options.filter.balance_gt Investor minimum position amount filter
   * @param options.filter.holderAddress Filter by holder address (partial text match)
   * @param options.filter.centrifugeIds Filter by centrifuge IDs (array of centrifuge IDs)
   */
  holders(options?: {
    limit?: number
    offset?: number
    orderBy?: string
    orderDirection?: string
    filter?: {
      balance_gt?: bigint
      holderAddress?: string
      centrifugeIds?: string[]
    }
  }) {
    const limit = options?.limit ?? 20
    const offset = options?.offset ?? 0
    const orderBy = options?.orderBy ?? 'balance'
    const orderDirection = options?.orderDirection ?? 'desc'
    const filter = options?.filter

    return this._query(
      [
        'holders',
        this.id.raw,
        limit,
        offset,
        filter?.balance_gt?.toString(),
        filter?.holderAddress,
        filter?.centrifugeIds?.join(','),
        orderBy,
        orderDirection,
      ],
      () =>
        combineLatest([
          this.pool.currency(),
          this._investOrders(),
          this._redeemOrders(),
          this._tokenInstancePositions({ limit, offset, orderBy, orderDirection, filter }),
        ]).pipe(
          switchMap(
            ([
              poolCurrency,
              { outstandingInvests, epochInvestOrders, epochOutstandingInvests },
              { outstandingRedeems },
              { items: tokenInstancePositions, totalCount },
            ]) => {
              const pageInfo = pageInfoFor(offset, totalCount, tokenInstancePositions.length)
              const assetDecimals = assetDecimalsByAssetId(epochInvestOrders, epochOutstandingInvests)
              // Handle empty positions case or else combineLatest([]) can hang indefinitely
              if (tokenInstancePositions.length === 0) {
                return of({
                  investors: [],
                  pageInfo,
                  totalCount,
                })
              }

              const whitelistedQueries = tokenInstancePositions.map((position) =>
                this._whitelistedInvestor({
                  accountAddress: position.accountAddress,
                  centrifugeId: position.centrifugeId,
                  tokenId: this.id.raw,
                }).pipe(catchError(() => of(null)))
              )

              return combineLatest(whitelistedQueries).pipe(
                map((whitelistResults) => {
                  const investors = tokenInstancePositions.map((position, i) => {
                    const whitelistData = whitelistResults[i]
                    const centrifugeId = Number(position.centrifugeId) as CentrifugeId
                    const outstandingInvest = outstandingInvests.find(
                      (order) => order.investor === position.accountAddress
                    )
                    const outstandingRedeem = outstandingRedeems.find(
                      (order) => order.investor === position.accountAddress
                    )
                    const assetId = outstandingInvest?.assetId.toString()
                    const decimals = assetId ? assetDecimals(assetId, poolCurrency.decimals) : poolCurrency.decimals
                    // The SERVED flag, not `parseInt(validUntil) > Date.now()`.
                    // That comparison read an ISO string as a year on
                    // public-api and seconds against milliseconds on api-v3,
                    // so it was false for every investor — see
                    // `isWhitelistedAt` in `@centrifuge/queries`. In backend
                    // mode this is the boolean the backend evaluated in Postgres
                    // with the same expression its `?status=whitelisted`
                    // filter uses.
                    const isWhitelistedStatus = whitelistData?.isWhitelisted ?? false

                    return {
                      address: position.accountAddress,
                      amount: new Balance(outstandingInvest?.pendingAmount ?? 0n, decimals),
                      centrifugeId,
                      createdAt: whitelistData?.createdAt ?? '',
                      holdings: new Balance(position.balance, poolCurrency.decimals),
                      isFrozen: whitelistData?.isFrozen ?? position.isFrozen,
                      outstandingInvest: outstandingInvest
                        ? new Balance(outstandingInvest.pendingAmount, decimals).scale(poolCurrency.decimals)
                        : new Balance(0n, poolCurrency.decimals),
                      outstandingRedeem: outstandingRedeem
                        ? outstandingRedeem.pendingAmount
                        : new Balance(0n, poolCurrency.decimals),
                      queuedInvest: outstandingInvest
                        ? new Balance(outstandingInvest.queuedAmount, decimals).scale(poolCurrency.decimals)
                        : new Balance(0n, poolCurrency.decimals),
                      queuedRedeem: outstandingRedeem
                        ? outstandingRedeem.queuedAmount
                        : new Balance(0n, poolCurrency.decimals),
                      isWhitelisted: isWhitelistedStatus,
                    }
                  })

                  investors.sort((a, b) => {
                    const aValue = BigInt(a.holdings.toBigInt())
                    const bValue = BigInt(b.holdings.toBigInt())
                    return aValue > bValue ? -1 : aValue < bValue ? 1 : 0
                  })

                  return {
                    investors,
                    pageInfo,
                    totalCount,
                  }
                })
              )
            }
          )
        )
    )
  }

  /**
   * Retrieve only whitelisted holders of the share class.
   * @param options Optional pagination options object for whitelisted investors query
   * @param options.limit Number of results to return (default: 20)
   * @param options.offset Offset for pagination (default: 0)
   */
  whitelistedHolders(options?: { limit: number; offset?: number }) {
    const limit = options?.limit ?? 20
    const offset = options?.offset ?? 0

    return this._query(['whitelistedHolders', this.id.raw, limit, offset], () =>
      combineLatest([
        this.pool.currency(),
        this._investOrders(),
        this._redeemOrders(),
        this._whitelistedInvestors({ limit, offset }),
      ]).pipe(
        switchMap(
          ([
            poolCurrency,
            { outstandingInvests, epochInvestOrders, epochOutstandingInvests },
            { outstandingRedeems },
            { items: whitelistedInvestors, totalCount },
          ]) => {
            const pageInfo = pageInfoFor(offset, totalCount, whitelistedInvestors.length)
            const assetDecimals = assetDecimalsByAssetId(epochInvestOrders, epochOutstandingInvests)
            if (whitelistedInvestors.length === 0) {
              return of({
                investors: [],
                pageInfo,
                totalCount,
              })
            }

            const positionQueries = whitelistedInvestors.map((investor) =>
              this._tokenInstancePosition({
                accountAddress: investor.address,
                centrifugeId: investor.centrifugeId,
                tokenId: this.id.raw,
              }).pipe(catchError(() => of(null)))
            )

            return combineLatest(positionQueries).pipe(
              map((positionResults) => {
                const investors = whitelistedInvestors.map((investor, i) => {
                  const positionData = positionResults[i]
                  const outstandingInvest = outstandingInvests.find((order) => order.investor === investor.address)
                  const outstandingRedeem = outstandingRedeems.find((order) => order.investor === investor.address)
                  const assetId = outstandingInvest?.assetId.toString()
                  const positionBalance = positionData?.balance ?? 0n
                  const decimals = assetId ? assetDecimals(assetId, poolCurrency.decimals) : poolCurrency.decimals
                  // The served flag, for the reason `holders()` spells out: the
                  // `parseInt(validUntil, 10) > Date.now()` this replaces was
                  // false for every investor on both graphql targets, which is
                  // what emptied the client's Whitelisted tab.
                  const isWhitelisted = investor.isWhitelisted

                  return {
                    address: investor.address,
                    amount: new Balance(outstandingInvest?.pendingAmount ?? 0n, decimals),
                    centrifugeId: Number(investor.centrifugeId),
                    createdAt: investor.createdAt,
                    holdings: new Balance(positionBalance, poolCurrency.decimals),
                    isFrozen: investor.isFrozen ?? positionData?.isFrozen,
                    outstandingInvest: outstandingInvest
                      ? new Balance(outstandingInvest.pendingAmount, decimals).scale(poolCurrency.decimals)
                      : new Balance(0n, poolCurrency.decimals),
                    outstandingRedeem: outstandingRedeem
                      ? outstandingRedeem.pendingAmount
                      : new Balance(0n, poolCurrency.decimals),
                    queuedInvest: outstandingInvest
                      ? new Balance(outstandingInvest.queuedAmount, decimals).scale(poolCurrency.decimals)
                      : new Balance(0n, poolCurrency.decimals),
                    queuedRedeem: outstandingRedeem
                      ? outstandingRedeem.queuedAmount
                      : new Balance(0n, poolCurrency.decimals),
                    isWhitelisted,
                  }
                })

                investors.sort((a, b) => {
                  const aValue = BigInt(a.holdings.toBigInt())
                  const bValue = BigInt(b.holdings.toBigInt())
                  return aValue > bValue ? -1 : aValue < bValue ? 1 : 0
                })

                return {
                  investors,
                  pageInfo,
                  totalCount,
                }
              })
            )
          }
        )
      )
    )
  }

  /**
   * Retrieve investor orders of the share class.
   * @returns Investor orders
   */
  investorOrders() {
    const self = this

    return this._query(['investorOrders'], () =>
      combineLatest([self._investOrders(), self._redeemOrders()]).pipe(
        switchMap(([investOrders, redeemOrders]) =>
          combineLatest([
            ...investOrders.outstandingInvests.map((order) => self._investorOrder(order.assetId, order.investor)),
            ...redeemOrders.outstandingRedeems.map((order) => self._investorOrder(order.assetId, order.investor)),
          ]).pipe(
            map((investorOrders) => {
              const ordersByInvestor = new AddressMap<
                {
                  investor: HexString
                  assetId: AssetId
                  maxRedeemClaims: number
                  maxDepositClaims: number
                  pendingRedeem: bigint
                  pendingDeposit: bigint
                  queuedInvest: bigint
                  queuedRedeem: bigint
                }[]
              >()

              investorOrders.forEach((order) => {
                const key = order.investor

                if (ordersByInvestor.has(key)) {
                  const existing = ordersByInvestor.get(key)!
                  const existingForAsset = existing.find((e) => e.assetId.equals(order.assetId))

                  if (!existingForAsset) {
                    existing.push(order)
                  }
                } else {
                  ordersByInvestor.set(key, [order])
                }
              })

              return ordersByInvestor
            })
          )
        )
      )
    )
  }

  /**
   * Freeze a member of the share class.
   * @param address Address to freeze
   * @param centrifugeId Centrifuge ID of the network on which to freeze the member
   * @param options.refundAddress See {@link ShareClass.updateMember}.
   *
   * Its own action rather than a flag on `updateMember`, on both routes: the hook keeps the frozen
   * bit and the membership expiry in different parts of one `hookData` word, so one call must
   * never quietly reset the other.
   */
  freezeMember(address: HexString, centrifugeId: CentrifugeId, options: RestrictionWriteOptions = {}) {
    return this.#routeFreeze('freezeMember', address, centrifugeId, options)
  }

  /**
   * Unfreeze a member of the share class
   * @param address Address to unfreeze
   * @param centrifugeId Centrifuge ID of the network on which to unfreeze the member
   * @param options.refundAddress See {@link ShareClass.updateMember}.
   */
  unfreezeMember(address: HexString, centrifugeId: CentrifugeId, options: RestrictionWriteOptions = {}) {
    return this.#routeFreeze('unfreezeMember', address, centrifugeId, options)
  }

  #routeFreeze(
    action: 'freezeMember' | 'unfreezeMember',
    address: HexString,
    centrifugeId: CentrifugeId,
    options: RestrictionWriteOptions
  ) {
    const freeze = action === 'freezeMember'
    return this._root._routeDeferredTransaction(
      action,
      this.pool.id.toString(),
      async () => {
        // The same refusal the local path makes, and before the strategy is
        // reached: a disabled network must not be paid for on either route.
        assertCrosschainMessagingEnabled(centrifugeId)
        if (!options.refundAddress) {
          throw new Error(
            `shareClass.${action}() needs an explicit { refundAddress } in backend mode: ` +
              'Hub.updateRestriction dispatches a paid cross-chain message and returns the unspent ' +
              'gas to that address, and the backend builds the calldata before any signer is ' +
              'resolved. Pass the address that will sign — the pool vault address on the Fordefi ' +
              'route.'
          )
        }
        return {
          poolId: this.pool.id.toString(),
          scId: this.id.raw,
          centrifugeId: String(centrifugeId),
          address,
          refundAddress: options.refundAddress,
        }
      },
      {
        title: freeze ? 'Freeze member' : 'Unfreeze member',
        centrifugeId: this.pool.centrifugeId,
        gate: [{ centrifugeId }],
        local: () => this.#freezeMemberLocal(freeze, address, centrifugeId),
      }
    )
  }

  #freezeMemberLocal(freeze: boolean, address: HexString, centrifugeId: CentrifugeId) {
    const self = this

    return this._transact(async function* (ctx) {
      assertCrosschainMessagingEnabled(centrifugeId)

      const { hub, contractAbis: ABI } = await self._root.protocolContext(self.pool.id)
      const payload = encodePacked(
        ['uint8', 'bytes32'],
        [/* UpdateRestrictionType.Freeze / Unfreeze */ freeze ? 2 : 3, addressToBytes32(address)]
      )

      yield* wrapTransaction(freeze ? 'Freeze member' : 'Unfreeze member', ctx, {
        contract: hub,
        policy: { poolId: self.pool.id },
        data: encodeFunctionData({
          abi: ABI.Hub,
          functionName: 'updateRestriction',
          args: [self.pool.id.raw, self.id.raw, centrifugeId, payload, 0n, ctx.signingAddress],
        }),
        messages: { [centrifugeId]: [{ type: MessageType.UpdateRestriction, poolId: self.pool.id }] },
      })
    }, this.pool.centrifugeId)
  }

  /**
   * Get the pending and claimable investment/redeem amounts for all investors
   * in a given share class (per vault/chain)
   */
  investmentsByVault(centrifugeId: CentrifugeId) {
    return this._query(['investmentsByVault', centrifugeId], () =>
      combineLatest([
        this._investOrders(),
        this._redeemOrders(),
        this.vaults(centrifugeId),
        this.pendingAmounts(),
      ]).pipe(
        switchMap(([investOrders, redeemOrders, vaults, pendingAmountsData]) => {
          if (!vaults.length) return of([])
          const pendingAmounts = pendingAmountsData.byVault

          const allInvestors = new Set<HexString>()
          investOrders.outstandingInvests.forEach((o) => allInvestors.add(o.investor))
          redeemOrders.outstandingRedeems.forEach((o) => allInvestors.add(o.investor))

          if (allInvestors.size === 0) return of([])

          return combineLatest(
            vaults.map((vault) => {
              const vaultInvestors = new Set<HexString>()
              investOrders.outstandingInvests
                .filter((o) => o.assetId.equals(vault.assetId))
                .forEach((o) => vaultInvestors.add(o.investor))
              redeemOrders.outstandingRedeems
                .filter((o) => o.assetId.equals(vault.assetId))
                .forEach((o) => vaultInvestors.add(o.investor))

              if (vaultInvestors.size === 0) return of([])

              const pendingMatch = pendingAmounts.find(
                (p) => p.assetId.equals(vault.assetId) && p.centrifugeId === vault.centrifugeId
              )

              const allPendingIssuances = pendingMatch?.pendingIssuances ?? []
              const allPendingRevocations = pendingMatch?.pendingRevocations ?? []

              return combineLatest(
                Array.from(vaultInvestors).map((investor) =>
                  vault.investment(investor).pipe(
                    map((investment) => {
                      const pendingIssuances = allPendingIssuances.map((epoch) => ({
                        ...epoch,
                        assetId: vault.assetId,
                        centrifugeId: vault.centrifugeId,
                      }))

                      const pendingRevocations = allPendingRevocations.map((epoch) => ({
                        ...epoch,
                        assetId: vault.assetId,
                        centrifugeId: vault.centrifugeId,
                      }))

                      return {
                        investor,
                        investment,
                        assetId: vault.assetId,
                        centrifugeId: vault.centrifugeId,
                        pendingIssuances,
                        pendingRevocations,
                        pendingMatch,
                      }
                    }),
                    catchError(() =>
                      of({
                        investor,
                        investment: null,
                        assetId: vault.assetId,
                        centrifugeId: vault.centrifugeId,
                        pendingIssuances: [],
                        pendingRevocations: [],
                        pendingMatch: null,
                      })
                    )
                  )
                )
              )
            })
          ).pipe(
            map((vaultResults) => {
              const expandedRecords: Array<{
                investor: HexString
                assetId: AssetId
                centrifugeId: number
                epoch: number
                epochType: 'deposit' | 'issue' | 'redeem' | 'revoke'
                investorAmount: Balance
                totalEpochAmount: Balance
                claimableDepositShares?: Balance
                claimableRedeemAssets?: Balance
                pendingIssuances: any[]
                pendingRevocations: any[]
              }> = []

              vaultResults.forEach((vaultInvestments) => {
                // Group by asset to calculate totals
                const investmentsByAsset = new Map<string, typeof vaultInvestments>()
                vaultInvestments.forEach((inv) => {
                  const key = inv.assetId.toString()
                  if (!investmentsByAsset.has(key)) {
                    investmentsByAsset.set(key, [])
                  }
                  investmentsByAsset.get(key)!.push(inv)
                })

                investmentsByAsset.forEach((assetInvestments) => {
                  if (assetInvestments.length === 0) return

                  const totalPendingDeposits = assetInvestments.reduce(
                    (sum, inv) => {
                      if (!inv.investment) return sum
                      return sum.add(inv.investment.pendingDepositAssets)
                    },
                    new Balance(0n, assetInvestments[0]?.investment?.pendingDepositAssets?.decimals ?? 18)
                  )

                  const totalPendingRedeems = assetInvestments.reduce(
                    (sum, inv) => {
                      if (!inv.investment) return sum
                      return sum.add(inv.investment.pendingRedeemShares)
                    },
                    new Balance(0n, assetInvestments[0]?.investment?.pendingRedeemShares?.decimals ?? 18)
                  )

                  assetInvestments.forEach((inv) => {
                    if (!inv.investment || !inv.pendingMatch) return

                    if (inv.pendingMatch.depositEpoch !== undefined && !inv.investment.pendingDepositAssets.isZero()) {
                      const investorRatio = totalPendingDeposits.isZero()
                        ? 0
                        : inv.investment.pendingDepositAssets.toDecimal().div(totalPendingDeposits.toDecimal())
                      const investorAmount = Balance.fromFloat(
                        inv.pendingMatch.pendingDeposit.toDecimal().mul(investorRatio),
                        inv.pendingMatch.pendingDeposit.decimals
                      )

                      expandedRecords.push({
                        investor: inv.investor,
                        assetId: inv.assetId,
                        centrifugeId: inv.centrifugeId,
                        epoch: inv.pendingMatch.depositEpoch,
                        epochType: 'deposit',
                        investorAmount,
                        totalEpochAmount: inv.pendingMatch.pendingDeposit,
                        claimableDepositShares: inv.investment.claimableDepositShares,
                        pendingIssuances: inv.pendingIssuances,
                        pendingRevocations: inv.pendingRevocations,
                      })
                    }

                    inv.pendingIssuances.forEach((issuance) => {
                      if (!inv.investment.pendingDepositAssets.isZero()) {
                        const investorRatio = totalPendingDeposits.isZero()
                          ? 0
                          : inv.investment.pendingDepositAssets.toDecimal().div(totalPendingDeposits.toDecimal())
                        const investorAmount = Balance.fromFloat(
                          issuance.amount.toDecimal().mul(investorRatio),
                          issuance.amount.decimals
                        )

                        expandedRecords.push({
                          investor: inv.investor,
                          assetId: inv.assetId,
                          centrifugeId: inv.centrifugeId,
                          epoch: issuance.epoch,
                          epochType: 'issue',
                          investorAmount,
                          totalEpochAmount: issuance.amount,
                          claimableDepositShares: inv.investment.claimableDepositShares,
                          pendingIssuances: inv.pendingIssuances,
                          pendingRevocations: inv.pendingRevocations,
                        })
                      }
                    })

                    if (inv.pendingMatch.redeemEpoch !== undefined && !inv.investment.pendingRedeemShares.isZero()) {
                      const investorRatio = totalPendingRedeems.isZero()
                        ? 0
                        : inv.investment.pendingRedeemShares.toDecimal().div(totalPendingRedeems.toDecimal())
                      const investorAmount = Balance.fromFloat(
                        inv.pendingMatch.pendingRedeem.toDecimal().mul(investorRatio),
                        inv.pendingMatch.pendingRedeem.decimals
                      )

                      expandedRecords.push({
                        investor: inv.investor,
                        assetId: inv.assetId,
                        centrifugeId: inv.centrifugeId,
                        epoch: inv.pendingMatch.redeemEpoch,
                        epochType: 'redeem',
                        investorAmount,
                        totalEpochAmount: inv.pendingMatch.pendingRedeem,
                        claimableRedeemAssets: inv.investment.claimableRedeemAssets,
                        pendingIssuances: inv.pendingIssuances,
                        pendingRevocations: inv.pendingRevocations,
                      })
                    }

                    inv.pendingRevocations.forEach((revocation) => {
                      if (!inv.investment.pendingRedeemShares.isZero()) {
                        const investorRatio = totalPendingRedeems.isZero()
                          ? 0
                          : inv.investment.pendingRedeemShares.toDecimal().div(totalPendingRedeems.toDecimal())
                        const investorAmount = Balance.fromFloat(
                          revocation.amount.toDecimal().mul(investorRatio),
                          revocation.amount.decimals
                        )

                        expandedRecords.push({
                          investor: inv.investor,
                          assetId: inv.assetId,
                          centrifugeId: inv.centrifugeId,
                          epoch: revocation.epoch,
                          epochType: 'revoke',
                          investorAmount,
                          totalEpochAmount: revocation.amount,
                          claimableRedeemAssets: inv.investment.claimableRedeemAssets,
                          pendingIssuances: inv.pendingIssuances,
                          pendingRevocations: inv.pendingRevocations,
                        })
                      }
                    })
                  })
                })
              })

              return expandedRecords
            })
          )
        })
      )
    )
  }

  /**
   * Get closed investment orders
   * @returns Closed investment orders where shares have been issued
   */
  closedInvestments() {
    return this._query(['closedInvestments'], () =>
      this._root
        ._queryData('epochInvestOrders', { tokenId: this.id.raw }, (items: EpochInvestOrderRow[]) => items)
        .pipe(
          switchMap((epochs) => {
            if (epochs.length === 0) return of([])
            return this._root
              ._queryData('closedInvestOrders', { tokenId: this.id.raw }, (items: InvestOrderRow[]) => items)
              .pipe(
                map((orders) => {
                  // Join per-investor orders to their epoch by approvedAtTxHash, NOT index:
                  // investOrders.index and epochInvestOrders.index use different numbering
                  // (instant/sync investments all carry investOrders.index 0 regardless of
                  // which epoch they belong to), so joining on index collapses distinct
                  // epochs together. approvedAtTxHash maps each epoch to its investors 1:1 —
                  // approvals are per-epoch (never batched across epochs the way issues are,
                  // where a single issuedAtTxHash can cover multiple epochs of the same asset).
                  const byEpoch = groupOrders(orders.filter(hasApprovalHash), (order) =>
                    orderEpochKey(order.assetId, order.approvedAtTxHash)
                  )
                  return epochs.map((epochData) => ({
                    epochData,
                    orders: epochData.approvedAtTxHash
                      ? (byEpoch.get(orderEpochKey(epochData.assetId, epochData.approvedAtTxHash)) ?? [])
                      : [],
                  }))
                })
              )
          }),
          map((results: any[]) => {
            const allOrders: any[] = []

            results.forEach((result: any) => {
              const { epochData, orders } = result

              if (orders.length === 0 && epochData.issuedAt) {
                allOrders.push({
                  investor: null,
                  index: epochData.index,
                  assetId: new AssetId(epochData.assetId),
                  approvedAmount: new Balance(epochData.approvedAssetsAmount || 0n, epochData.asset.decimals),
                  approvedAt: epochData.approvedAt ? epochData.approvedAt : null,
                  approvedAtTxHash: epochData.approvedAtTxHash ?? null,
                  issuedAmount: new Balance(epochData.issuedSharesAmount || 0n, epochData.token.decimals),
                  issuedAt: epochData.issuedAt,
                  issuedAtTxHash: epochData.issuedAtTxHash ?? null,
                  priceAsset: new Price(epochData.issuedWithNavAssetPerShare || 0n),
                  pricePerShare: new Price(epochData.issuedWithNavPoolPerShare || 0n),
                  claimedAt: null,
                  isClaimed: false,
                  asset: {
                    symbol: epochData.asset.symbol,
                    name: epochData.asset.name,
                    decimals: epochData.asset.decimals,
                  },
                  centrifugeId: epochData.asset.centrifugeId,
                  token: {
                    decimals: epochData.token.decimals,
                  },
                })
              } else {
                orders.forEach((order: any) => {
                  const asset = order.asset ?? epochData.asset
                  const token = order.token ?? epochData.token
                  allOrders.push({
                    investor: order.account.toLowerCase() as HexString,
                    // Use the epoch's index, not order.index: per-investor investOrders.index
                    // is on a different numbering scheme (see the join comment above), and the
                    // app keys/filters closed investments by epoch index.
                    index: epochData.index,
                    assetId: new AssetId(order.assetId),
                    approvedAmount: new Balance(order.approvedAssetsAmount || 0n, asset.decimals),
                    approvedAt: order.approvedAt ? order.approvedAt : null,
                    approvedAtTxHash: order.approvedAtTxHash ?? null,
                    issuedAmount: new Balance(order.issuedSharesAmount || 0n, token.decimals),
                    issuedAt: order.issuedAt ? order.issuedAt : null,
                    issuedAtTxHash: order.issuedAtTxHash ?? null,
                    priceAsset: new Price(order.issuedWithNavAssetPerShare || 0n),
                    pricePerShare: new Price(order.issuedWithNavPoolPerShare || 0n),
                    claimedAt: order.claimedAt ? order.claimedAt : null,
                    isClaimed: !!order.claimedAtBlock,
                    createdAtTxHash: order.createdAtTxHash ?? null,
                    asset: {
                      symbol: asset.symbol,
                      name: asset.name,
                      decimals: asset.decimals,
                    },
                    centrifugeId: asset.centrifugeId,
                    token: {
                      decimals: token.decimals,
                    },
                  })
                })
              }
            })
            return allOrders
          })
        )
    )
  }

  /**
   * Get closed redemption orders, i.e. epochs for which shares have been revoked.
   *
   * Without a filter this returns every closed order across the share class' entire
   * redemption history, in two indexer requests whatever the epoch count. Pass a
   * `filter` to scope it:
   *
   * - `assetId` / `epochIndex` narrow which epochs are returned. `epochIndex` is the
   *   `epochId` passed to `approveRedeems`/`revokeShares`; with it the per-investor
   *   rows are read per matching epoch, filtered on the server. Without it the share
   *   class' whole closed set is read once.
   * - `onlyUnclaimed` drops orders already claimed/notified on the hub. Because each
   *   `notifyRedeem` stamps `claimedAt`, this is safe to poll: an operator bot can
   *   re-run it with `epochIndex` to get exactly the investors of an epoch still
   *   awaiting a `notifyRedeem`, in one small read per asset.
   *
   * @returns Closed redemption orders where shares have been revoked
   */
  closedRedemptions(filter: ClosedRedemptionsFilter = {}) {
    const { assetId, epochIndex, onlyUnclaimed = false } = filter

    // AssetId.raw is a bigint (not JSON-serializable); the catalogue's assetId
    // param is the decimal string, which each adapter maps to its own scalar.
    return this._query(['closedRedemptions', assetId?.toString(), epochIndex, onlyUnclaimed], () =>
      this._root
        ._queryData(
          'epochRedeemOrders',
          {
            tokenId: this.id.raw,
            ...(assetId !== undefined ? { assetId: assetId.toString() } : {}),
            ...(epochIndex !== undefined ? { index: epochIndex } : {}),
          },
          (items: EpochRedeemOrderRow[]) => items
        )
        .pipe(
          switchMap((epochs) => {
            if (epochs.length === 0) return of([])
            if (epochIndex !== undefined) {
              return combineLatest(
                epochs.map((epochData) =>
                  this._root._queryData(
                    'redeemOrdersByEpoch',
                    { tokenId: this.id.raw, assetId: String(epochData.assetId), index: epochData.index, onlyUnclaimed },
                    (orders: RedeemOrderRow[]) => ({ epochData, orders })
                  )
                )
              )
            }
            return this._root
              ._queryData('closedRedeemOrders', { tokenId: this.id.raw }, (items: RedeemOrderRow[]) => items)
              .pipe(
                map((orders) => {
                  const byEpoch = groupOrders(
                    orders.filter((order) => !onlyUnclaimed || order.claimedAt === null),
                    (order) => orderEpochKey(order.assetId, order.index)
                  )
                  return epochs.map((epochData) => ({
                    epochData,
                    orders: byEpoch.get(orderEpochKey(epochData.assetId, epochData.index)) ?? [],
                  }))
                })
              )
          }),
          map((results: any[]) => {
            const allOrders: ClosedRedemption[] = []

            results.forEach((result: any) => {
              const { epochData, orders } = result

              // The epoch-level aggregate is a fallback for revoked epochs with no
              // indexed per-investor orders; skip it when filtering to unclaimed, where
              // an empty result legitimately means everyone has been notified.
              if (orders.length === 0 && epochData.revokedAt && !onlyUnclaimed) {
                allOrders.push({
                  investor: null,
                  index: epochData.index,
                  assetId: new AssetId(epochData.assetId),
                  approvedAmount: new Balance(epochData.approvedSharesAmount || 0n, epochData.token.decimals),
                  approvedAt: epochData.approvedAt ? epochData.approvedAt : null,
                  payoutAmount: new Balance(epochData.revokedAssetsAmount || 0n, epochData.asset.decimals),
                  revokedAt: epochData.revokedAt,
                  priceAsset: new Price(epochData.revokedWithNavAssetPerShare || 0n),
                  pricePerShare: new Price(epochData.revokedWithNavPoolPerShare || 0n),
                  claimedAt: null,
                  isClaimed: false,
                  asset: {
                    symbol: epochData.asset.symbol,
                    name: epochData.asset.name,
                    decimals: epochData.asset.decimals,
                  },
                  // The indexer returns centrifugeId as a string; CentrifugeId is a number.
                  centrifugeId: Number(epochData.asset.centrifugeId),
                  token: {
                    decimals: epochData.token.decimals,
                  },
                })
              } else {
                orders.forEach((order: any) => {
                  const asset = order.asset ?? epochData.asset
                  const token = order.token ?? epochData.token
                  allOrders.push({
                    investor: order.account.toLowerCase() as HexString,
                    index: order.index,
                    assetId: new AssetId(order.assetId),
                    approvedAmount: new Balance(order.approvedSharesAmount || 0n, token.decimals),
                    approvedAt: order.approvedAt ? order.approvedAt : null,
                    payoutAmount: new Balance(order.revokedAssetsAmount || 0n, asset.decimals),
                    revokedAt: order.revokedAt ? order.revokedAt : null,
                    priceAsset: new Price(order.revokedWithNavAssetPerShare || 0n),
                    pricePerShare: new Price(order.revokedWithNavPoolPerShare || 0n),
                    claimedAt: order.claimedAt ? order.claimedAt : null,
                    isClaimed: !!order.claimedAtBlock,
                    asset: {
                      symbol: asset.symbol,
                      name: asset.name,
                      decimals: asset.decimals,
                    },
                    centrifugeId: Number(asset.centrifugeId),
                    token: {
                      decimals: token.decimals,
                    },
                  })
                })
              }
            })

            return allOrders
          })
        )
    )
  }

  /**
   * Get detailed invest order information including per-user breakdowns with helper methods.
   * @returns Invest order data with helper methods for efficient lookups
   */
  investOrdersDetails() {
    return this._query(['investOrdersDetails'], () =>
      combineLatest([this._investOrders(), this.balances()]).pipe(
        map(([investData, balancesData]) => {
          const assetPrices = new Map<string, Price>()
          const assetDecimals = new Map<string, number>()
          balancesData.forEach((b) => {
            assetPrices.set(b.assetId.toString(), b.price)
            assetDecimals.set(b.assetId.toString(), b.asset.decimals)
          })

          type PendingInvestOrder = Omit<
            (typeof investData.pendingInvestOrders)[number],
            'pendingAmount' | 'queuedAmount'
          > & {
            pendingAmount: Balance
            queuedAmount: Balance
          }
          const pendingInvestsByVault = new Map<string, PendingInvestOrder[]>()
          const queuedInvestByAsset = new Map<string, Balance>()

          for (const order of investData.pendingInvestOrders) {
            const assetKey = order.assetId.toString()
            const decimals = assetDecimals.get(assetKey) ?? 18
            const parsedOrder: PendingInvestOrder = {
              ...order,
              pendingAmount: new Balance(order.pendingAmount, decimals),
              queuedAmount: new Balance(order.queuedAmount, decimals),
            }

            const vaultKey = `${order.assetId.toString()}-${order.centrifugeId}`
            if (!pendingInvestsByVault.has(vaultKey)) {
              pendingInvestsByVault.set(vaultKey, [])
            }
            pendingInvestsByVault.get(vaultKey)!.push(parsedOrder)

            const queuedAmount = parsedOrder.queuedAmount
            const existing = queuedInvestByAsset.get(assetKey)
            if (existing) {
              queuedInvestByAsset.set(assetKey, existing.add(queuedAmount))
            } else {
              queuedInvestByAsset.set(assetKey, queuedAmount)
            }
          }

          type ApprovedInvestOrder = (typeof investData.investOrders)[number]
          const approvedInvestsByVaultAndEpoch = new Map<string, ApprovedInvestOrder[]>()
          const filteredApprovedInvests = investData.investOrders.filter((i) => !!i.approvedAt && !i.issuedAt)

          for (const order of filteredApprovedInvests) {
            const key = `${order.assetId.toString()}-${order.centrifugeId}-${order.index}`
            if (!approvedInvestsByVaultAndEpoch.has(key)) {
              approvedInvestsByVaultAndEpoch.set(key, [])
            }
            approvedInvestsByVaultAndEpoch.get(key)!.push(order)
          }

          const toAssetKey = (assetId: AssetId | string): string =>
            typeof assetId === 'string' ? assetId : assetId.toString()

          return {
            getPendingInvestsByVault: (assetId: AssetId | string, centrifugeId: CentrifugeId): PendingInvestOrder[] => {
              const key = `${toAssetKey(assetId)}-${centrifugeId}`
              return pendingInvestsByVault.get(key) ?? []
            },
            getApprovedInvestsByVaultAndEpoch: (
              assetId: AssetId | string,
              centrifugeId: CentrifugeId,
              epoch: number
            ): ApprovedInvestOrder[] => {
              const key = `${toAssetKey(assetId)}-${centrifugeId}-${epoch}`
              return approvedInvestsByVaultAndEpoch.get(key) ?? []
            },
            getQueuedInvestByAsset: (assetId: AssetId | string): Balance | undefined => {
              return queuedInvestByAsset.get(toAssetKey(assetId))
            },
            getAssetPrice: (assetId: AssetId | string): Price | undefined => {
              return assetPrices.get(toAssetKey(assetId))
            },
          }
        })
      )
    )
  }

  /**
   * Get detailed redeem order information including per-user breakdowns with helper methods.
   * @returns Redeem order data with helper methods for efficient lookups
   */
  redeemOrdersDetails() {
    return this._query(['redeemOrdersDetails'], () =>
      combineLatest([this._redeemOrders(), this.balances()]).pipe(
        map(([redeemData, balancesData]) => {
          const assetPrices = new Map<string, Price>()
          balancesData.forEach((b) => {
            assetPrices.set(b.assetId.toString(), b.price)
          })

          type PendingRedeemOrder = (typeof redeemData.pendingRedeemOrders)[number]
          const pendingRedeemsByVault = new Map<string, PendingRedeemOrder[]>()
          const queuedRedeemByAsset = new Map<string, Balance>()

          for (const order of redeemData.pendingRedeemOrders) {
            const vaultKey = `${order.assetId.toString()}-${order.centrifugeId}`
            if (!pendingRedeemsByVault.has(vaultKey)) {
              pendingRedeemsByVault.set(vaultKey, [])
            }
            pendingRedeemsByVault.get(vaultKey)!.push(order)

            const assetKey = order.assetId.toString()
            const existing = queuedRedeemByAsset.get(assetKey)
            if (existing) {
              queuedRedeemByAsset.set(assetKey, existing.add(order.queuedAmount))
            } else {
              queuedRedeemByAsset.set(assetKey, order.queuedAmount)
            }
          }

          type ApprovedRedeemOrder = (typeof redeemData.redeemOrders)[number]
          const approvedRedeemsByVaultAndEpoch = new Map<string, ApprovedRedeemOrder[]>()
          const filteredApprovedRedeems = redeemData.redeemOrders.filter((i) => !!i.approvedAt && !i.revokedAt)

          for (const order of filteredApprovedRedeems) {
            const key = `${order.assetId.toString()}-${order.centrifugeId}-${order.index}`
            if (!approvedRedeemsByVaultAndEpoch.has(key)) {
              approvedRedeemsByVaultAndEpoch.set(key, [])
            }
            approvedRedeemsByVaultAndEpoch.get(key)!.push(order)
          }

          const toAssetKey = (assetId: AssetId | string): string =>
            typeof assetId === 'string' ? assetId : assetId.toString()

          return {
            getPendingRedeemsByVault: (assetId: AssetId | string, centrifugeId: CentrifugeId): PendingRedeemOrder[] => {
              const key = `${toAssetKey(assetId)}-${centrifugeId}`
              return pendingRedeemsByVault.get(key) ?? []
            },
            getApprovedRedeemsByVaultAndEpoch: (
              assetId: AssetId | string,
              centrifugeId: CentrifugeId,
              epoch: number
            ): ApprovedRedeemOrder[] => {
              const key = `${toAssetKey(assetId)}-${centrifugeId}-${epoch}`
              return approvedRedeemsByVaultAndEpoch.get(key) ?? []
            },
            getQueuedRedeemByAsset: (assetId: AssetId | string): Balance | undefined => {
              return queuedRedeemByAsset.get(toAssetKey(assetId))
            },
            getAssetPrice: (assetId: AssetId | string): Price | undefined => {
              return assetPrices.get(toAssetKey(assetId))
            },
          }
        })
      )
    )
  }

  /**
   * Get the valuation contract address for this share class on a specific chain.
   * @param centrifugeId
   */
  valuation(centrifugeId: CentrifugeId) {
    return this._query(['valuation', centrifugeId], () =>
      combineLatest([
        this._root.protocolContext({ poolId: this.pool.id, centrifugeId }),
        this._root.getClient(centrifugeId),
      ]).pipe(
        switchMap(([{ syncManager, contractAbis: ABI, protocolVersion }, client]) =>
          defer(async () => {
            const valuation = await client.readContract({
              address: syncManager,
              abi: ABI.SyncManager,
              functionName: 'valuation',
              args: [this.pool.id.raw, this.id.raw],
            })
            return valuation as HexString
          }).pipe(
            repeatOnEvents(
              this._root,
              {
                address: syncManager,
                eventName: ['SetValuation'],
                filter: (events) =>
                  events.some((event) => event.args.poolId === this.pool.id.raw && event.args.scId === this.id.raw),
              },
              centrifugeId,
              protocolVersion
            )
          )
        )
      )
    )
  }

  /**
   * Set the default valuation contract for this share class on a specific chain.
   * @param centrifugeId - The centrifuge ID where the valuation should be updated
   * @param valuation - The address of the valuation contract
   */
  updateValuation(centrifugeId: CentrifugeId, valuation: HexString) {
    const self = this
    return this._transact(async function* (ctx) {
      assertCrosschainMessagingEnabled(centrifugeId)

      const [hubCtx, spokeAddresses] = await Promise.all([
        self._root.protocolContext(self.pool.id),
        self._root.protocolContext({ poolId: self.pool.id, centrifugeId }),
      ])
      const update = self.#valuationUpdate(hubCtx, spokeAddresses, centrifugeId, valuation, ctx.signingAddress)

      yield* wrapTransaction('Update valuation', ctx, {
        contract: hubCtx.hub,
        policy: { poolId: self.pool.id },
        data: update.data,
        messages: { [centrifugeId]: [update.message] },
      })
    }, this.pool.centrifugeId)
  }

  /** The SyncManager valuation update: `updateContract` on v3.2, `managerCall` on v3.3. */
  #valuationUpdate(
    hubCtx: SdkProtocolContext,
    spokeCtx: SdkProtocolContext,
    centrifugeId: CentrifugeId,
    valuation: HexString,
    refund: HexString
  ): { data: HexString; message: MessageTypeWithSubType } {
    if (isV3_3(hubCtx)) {
      return {
        data: encodeHubManagerCall(hubCtx, {
          centrifugeId,
          target: spokeCtx.syncManager,
          payload: encodeSyncManagerPayload({ kind: 'valuation', scId: this.id.raw, valuation }),
          label: 'SyncManager.Valuation',
          refund,
        }),
        message: messageV3_3(MessageTypeV3_3.ManagerCallFromHub, this.pool.id),
      }
    }
    return {
      data: encodeFunctionData({
        abi: hubCtx.contractAbis.Hub,
        functionName: 'updateContract',
        args: [
          this.pool.id.raw,
          this.id.raw,
          centrifugeId,
          addressToBytes32(spokeCtx.syncManager),
          encode([VaultManagerTrustedCall.Valuation, addressToBytes32(valuation)]),
          0n,
          refund,
        ],
      }),
      message: { type: MessageType.TrustedContractUpdate, poolId: this.pool.id },
    }
  }

  /**
   * The share hook update: `Hub.updateShareHook` on v3.2; on v3.3 a
   * `managerCall` to the share token's registrar, read from SpokeRegistry
   * because `fromHub` refuses unless the registrar is the token's own.
   */
  async #hookUpdate(
    hubCtx: SdkProtocolContext,
    spokeCtx: SdkProtocolContext,
    centrifugeId: CentrifugeId,
    hook: HexString,
    refund: HexString
  ): Promise<{ data: HexString; message: MessageTypeWithSubType }> {
    if (isV3_3(hubCtx)) {
      const client = await firstValueFrom(this._root.getClient(centrifugeId))
      const [, registrar] = await client.readContract({
        address: requireContract(spokeCtx, 'spokeRegistry'),
        abi: ABIS_V3_3.SpokeRegistry,
        functionName: 'shareTokenAndRegistrar',
        args: [this.pool.id.raw, this.id.raw],
      })
      return {
        data: encodeHubManagerCall(hubCtx, {
          centrifugeId,
          target: registrar,
          payload: encodeShareTokenRegistrarPayload({ kind: 'setHook', scId: this.id.raw, hook }),
          label: 'ShareTokenRegistrar.SetHook',
          refund,
        }),
        message: messageV3_3(MessageTypeV3_3.ManagerCallFromHub, this.pool.id),
      }
    }
    return {
      data: encodeFunctionData({
        abi: hubCtx.contractAbis.Hub,
        functionName: 'updateShareHook',
        args: [this.pool.id.raw, this.id.raw, centrifugeId, addressToBytes32(hook), refund],
      }),
      message: { type: MessageType.UpdateShareHook, poolId: this.pool.id },
    }
  }

  /**
   * Update the hook for this share class on a specific chain.
   * @param centrifugeId - The centrifuge ID where the hook should be updated
   * @param hook - The address of the new hook contract
   */
  updateHook(centrifugeId: CentrifugeId, hook: HexString) {
    const self = this
    return this._transact(async function* (ctx) {
      assertCrosschainMessagingEnabled(centrifugeId)

      const [hubCtx, spokeCtx] = await Promise.all([
        self._root.protocolContext(self.pool.id),
        self._root.protocolContext({ poolId: self.pool.id, centrifugeId }),
      ])
      const update = await self.#hookUpdate(hubCtx, spokeCtx, centrifugeId, hook, ctx.signingAddress)

      yield* wrapTransaction('Update hook', ctx, {
        contract: hubCtx.hub,
        policy: { poolId: self.pool.id },
        data: update.data,
        messages: { [centrifugeId]: [update.message] },
      })
    }, this.pool.centrifugeId)
  }

  /**
   * Update both (or one of) the hook and valuation for this share class on a specific chain in a single transaction.
   * @param centrifugeId - The centrifuge ID where the updates should be applied
   * @param hook - The address of the new hook contract (optional)
   * @param valuation - The address of the new valuation contract (optional)
   */
  updateHookAndValuation(centrifugeId: CentrifugeId, hook?: HexString, valuation?: HexString) {
    if (!hook && !valuation) {
      throw new Error('At least one of hook or valuation must be provided')
    }

    const self = this
    return this._transact(async function* (ctx) {
      assertCrosschainMessagingEnabled(centrifugeId)

      const [hubCtx, spokeAddresses] = await Promise.all([
        self._root.protocolContext(self.pool.id),
        self._root.protocolContext({ poolId: self.pool.id, centrifugeId }),
      ])
      const { hub } = hubCtx

      const calls: HexString[] = []
      const messages: MessageTypeWithSubType[] = []

      if (hook) {
        const update = await self.#hookUpdate(hubCtx, spokeAddresses, centrifugeId, hook, ctx.signingAddress)
        calls.push(update.data)
        messages.push(update.message)
      }

      if (valuation) {
        const update = self.#valuationUpdate(hubCtx, spokeAddresses, centrifugeId, valuation, ctx.signingAddress)
        calls.push(update.data)
        messages.push(update.message)
      }

      const title = hook && valuation ? 'Update hook and valuation' : hook ? 'Update hook' : 'Update valuation'

      yield* wrapTransaction(title, ctx, {
        contract: hub,
        policy: { poolId: self.pool.id },
        data: calls,
        messages: { [centrifugeId]: messages },
      })
    }, this.pool.centrifugeId)
  }

  /**
   * Per-chain view of what still blocks cross-chain transfers of this share class, obtained by asking
   * each chain's share token the same question the protocol asks at transfer time:
   *  - outbound: `checkTransferRestriction(holder, address(uint160(destinationCentrifugeId)))` on the
   *    source chain, for every other deployed chain, and
   *  - inbound: `checkTransferRestriction(address(0), spoke)`, because delivery mints to the spoke
   *    before forwarding to the receiver, so transfers to a chain revert if its spoke isn't allowed.
   *
   * Going through the token's hook (instead of comparing hook addresses) makes the result correct
   * for any hook — the shared ones, pool-specific instances and custom hooks alike. Hooks that don't
   * restrict transfers simply answer true and report nothing blocked.
   *
   * @param holder - Sender used in the outbound check. Defaults to the source chain's own
   *                 representative address, a plain address with no special treatment in the hooks.
   *                 Pass a real holder to also account for freezes.
   * @returns Observable of one entry per deployed chain: the destination chains it can't send to
   *          (`blockedDestinations`) and whether it can't receive (`inboundBlocked`). A chain whose
   *          checks couldn't be read is reported as fully blocked, with the cause in `error`.
   */
  crossChainTransferRestrictions(holder?: HexString) {
    const holderKey = holder?.toLowerCase()
    return this._query(['crossChainTransferRestrictions', holderKey], () =>
      this.deploymentPerNetwork().pipe(
        switchMap((deployments) => {
          if (deployments.length < 2) return of([])

          return combineLatest(
            deployments.map((deployment) => {
              const destinations = deployments
                .map((other) => other.centrifugeId)
                .filter((centrifugeId) => centrifugeId !== deployment.centrifugeId)

              return defer(() =>
                combineLatest([
                  this._root.getClient(deployment.centrifugeId),
                  this._root.protocolContext({ poolId: this.pool.id, centrifugeId: deployment.centrifugeId }),
                ])
              ).pipe(
                switchMap(([client, { spoke }]) =>
                  defer(async () => {
                    const share = getContract({
                      address: deployment.shareTokenAddress,
                      abi: STANDARD_ABIS.Currency,
                      client,
                    })
                    const check = (from: HexString, to: HexString) =>
                      share.read.checkTransferRestriction([from, to, 0n])

                    const from = holder ?? convertToEvmAddress(deployment.centrifugeId)
                    const [inboundAllowed, ...outboundAllowed] = await Promise.all([
                      check(zeroAddress, spoke),
                      ...destinations.map((centrifugeId) => check(from, convertToEvmAddress(centrifugeId))),
                    ])

                    return {
                      centrifugeId: deployment.centrifugeId,
                      blockedDestinations: destinations.filter((_, i) => !outboundAllowed[i]),
                      inboundBlocked: !inboundAllowed,
                      error: undefined as unknown,
                    }
                  })
                ),
                catchError((error) => {
                  console.warn(`Error checking cross-chain transfer restrictions on ${deployment.centrifugeId}`, error)
                  return of({
                    centrifugeId: deployment.centrifugeId,
                    blockedDestinations: destinations,
                    inboundBlocked: true,
                    error,
                  })
                }),
                repeatOnEvents(
                  this._root,
                  {
                    address: deployment.restrictionManagerAddress,
                    eventName: 'UpdateMember',
                    filter: (events) =>
                      events.some(
                        (event) => event.args.token?.toLowerCase() === deployment.shareTokenAddress.toLowerCase()
                      ),
                  },
                  deployment.centrifugeId
                )
              )
            })
          )
        })
      )
    )
  }

  /**
   * Whether cross-chain transfers of this share class are fully enabled: no chain reports anything
   * blocked in `crossChainTransferRestrictions`. Also true when the token is deployed on fewer than
   * 2 chains (nothing to transfer between).
   */
  crossChainTransferStatus(holder?: HexString) {
    return this._query(['crossChainTransferStatus', holder?.toLowerCase()], () =>
      this.crossChainTransferRestrictions(holder).pipe(
        map((chains) => chains.every((chain) => chain.blockedDestinations.length === 0 && !chain.inboundBlocked))
      )
    )
  }

  /**
   * Check which destination networks are valid for a cross-chain share transfer from a given source chain.
   *
   * For each deployed destination network, validates:
   * 1. The share token and hook (restriction manager) are deployed on both source and destination
   * 2. On the source chain: `checkTransferRestriction(sender, address(uint160(destinationCentrifugeId)), 0)`
   *    — verifies the destination chain's representative address is a valid receiver
   * 3. On the destination chain: `checkTransferRestriction(address(uint160(sourceCentrifugeId)), receiver, 0)`
   *    — verifies the receiver can receive tokens on the destination chain
   *
   * @param sourceCentrifugeId - The chain the shares would be transferred from
   * @param receiver - The address that would receive shares on the destination chain
   * @returns Observable of a map: destination centrifugeId → whether the transfer is allowed
   */
  allowedCrosschainTransferDestinations(sourceCentrifugeId: CentrifugeId, receiver: HexString) {
    const addr = receiver.toLowerCase() as HexString
    return this._query(['allowedCrosschainTransferDestinations', sourceCentrifugeId, addr], () =>
      combineLatest([this.deploymentPerNetwork(), this._root.getClient(sourceCentrifugeId)]).pipe(
        switchMap(([deployments, sourceClient]) => {
          const sourceDeployment = deployments.find((d) => d.centrifugeId === sourceCentrifugeId)
          if (!sourceDeployment) return of(new Map<number, boolean>())

          const destinations = deployments.filter((d) => d.centrifugeId !== sourceCentrifugeId)
          if (destinations.length === 0) return of(new Map<number, boolean>())

          return combineLatest(
            destinations.map((dest) =>
              this._root.getClient(dest.centrifugeId).pipe(
                switchMap((destClient) =>
                  defer(async () => {
                    try {
                      const destRepAddress = convertToEvmAddress(dest.centrifugeId)
                      const sourceAllows = await sourceClient.readContract({
                        address: sourceDeployment.shareTokenAddress,
                        abi: STANDARD_ABIS.Currency,
                        functionName: 'checkTransferRestriction',
                        args: [addr, destRepAddress, 0n],
                      })

                      const sourceRepAddress = convertToEvmAddress(sourceCentrifugeId)
                      const destAllows = await destClient.readContract({
                        address: dest.shareTokenAddress,
                        abi: STANDARD_ABIS.Currency,
                        functionName: 'checkTransferRestriction',
                        args: [sourceRepAddress, addr, 0n],
                      })

                      return { centrifugeId: dest.centrifugeId, allowed: !!(sourceAllows && destAllows) }
                    } catch {
                      return { centrifugeId: dest.centrifugeId, allowed: false }
                    }
                  })
                )
              )
            )
          ).pipe(
            map((results) => {
              const allowed = new Map<number, boolean>()
              for (const r of results) {
                allowed.set(r.centrifugeId, r.allowed)
              }
              return allowed
            })
          )
        })
      )
    )
  }

  /**
   * Transfer shares cross-chain. Burns shares on the source chain and mints them on the destination chain.
   * @param sourceCentrifugeId - The chain where the shares currently exist
   * @param destinationCentrifugeId - The chain to transfer shares to
   * @param receiver - The address to receive shares on the destination chain
   * @param amount - Amount of shares to transfer (as bigint, raw on-chain value)
   */
  crosschainTransferShares(
    sourceCentrifugeId: CentrifugeId,
    destinationCentrifugeId: CentrifugeId,
    receiver: HexString,
    amount: bigint,
    options: RestrictionWriteOptions = {}
  ) {
    return this._root._routeDeferredTransaction(
      'crosschainTransferShares',
      this.pool.id.toString(),
      async () => {
        assertCrosschainMessagingEnabled(sourceCentrifugeId)
        assertCrosschainMessagingEnabled(destinationCentrifugeId)
        if (!options.refundAddress) {
          throw new Error(
            'shareClass.crosschainTransferShares() needs an explicit { refundAddress } in backend ' +
              'mode: Spoke.crosschainTransferShares dispatches a paid cross-chain message and ' +
              'returns the unspent gas to that address, and the backend builds the calldata before ' +
              'any signer is resolved. Pass the address that will sign — the pool vault address on ' +
              'the Fordefi route.'
          )
        }
        return {
          poolId: this.pool.id.toString(),
          scId: this.id.raw,
          // The SOURCE selects the chain the transaction is sent to (its
          // `Spoke`); the destination travels as the first argument. Getting
          // that round the wrong way would burn the shares on the chain they
          // were meant to arrive on, which is why both are named rather than
          // one being implied by the context.
          sourceCentrifugeId: String(sourceCentrifugeId),
          destinationCentrifugeId: String(destinationCentrifugeId),
          receiver,
          // Money-shaped: the on-chain integer as a decimal string, never a
          // JS number.
          amount: amount.toString(),
          refundAddress: options.refundAddress,
        }
      },
      {
        title: 'Cross chain transfer shares',
        // NOT the pool's hub: this transaction is sent on the source network.
        centrifugeId: sourceCentrifugeId,
        gate: [{ centrifugeId: sourceCentrifugeId, destinationCentrifugeId }],
        local: () => this.#crosschainTransferSharesLocal(sourceCentrifugeId, destinationCentrifugeId, receiver, amount),
      }
    )
  }

  #crosschainTransferSharesLocal(
    sourceCentrifugeId: CentrifugeId,
    destinationCentrifugeId: CentrifugeId,
    receiver: HexString,
    amount: bigint
  ) {
    const self = this
    return this._transact(async function* (ctx) {
      assertCrosschainMessagingEnabled(sourceCentrifugeId)
      assertCrosschainMessagingEnabled(destinationCentrifugeId)
      // Spoke reverts both (LocalTransferNotAllowed, EmptyAmount) on every version and route; refused before any read.
      if (destinationCentrifugeId === sourceCentrifugeId) {
        throw new Error(
          `crosschainTransferShares: destination ${destinationCentrifugeId} is the source network; ` +
            'a transfer to the same chain is not a cross-chain transfer'
        )
      }
      if (amount <= 0n) throw new Error('crosschainTransferShares: amount must be greater than 0')

      const spokeCtx = await self._root.protocolContext({ poolId: self.pool.id, centrifugeId: sourceCentrifugeId })
      const { spoke, contractAbis: ABI } = spokeCtx
      const hubCentrifugeId = self.pool.id.centrifugeId
      const messages: Record<number, MessageTypeWithSubType[]> =
        sourceCentrifugeId === hubCentrifugeId
          ? {
              [destinationCentrifugeId]: [{ type: MessageType.ExecuteTransferShares, poolId: self.pool.id }],
            }
          : {
              [hubCentrifugeId]: [{ type: MessageType.InitiateTransferShares, poolId: self.pool.id }],
            }

      if (!isV3_3(spokeCtx)) {
        yield* wrapTransaction('Cross chain transfer shares', ctx, {
          contract: spoke,
          data: encodeFunctionData({
            abi: ABI.Spoke,
            functionName: 'crosschainTransferShares',
            args: [
              destinationCentrifugeId,
              self.pool.id.raw,
              self.id.raw,
              addressToBytes32(receiver),
              amount,
              0n,
              0n,
              ctx.signingAddress,
            ],
          }),
          messages,
        })
        return
      }

      // v3.3's Spoke bridges only for an owner the pool allows to bridge (NotBridger otherwise).
      // Anyone else goes through TokenBridge, which is a bridger and forwards the caller as sender.
      const isBridger = await ctx.publicClient.readContract({
        address: requireContract(spokeCtx, 'spokeRegistry'),
        abi: ABIS_V3_3.SpokeRegistry,
        functionName: 'bridger',
        args: [self.pool.id.raw, ctx.signingAddress],
      })
      // The hub runs its bridging hook when the transfer arrives, after the burn on a remote
      // source, so a transfer it would refuse is refused here, before anything is signed.
      await self._assertBridgeLimit(sourceCentrifugeId, destinationCentrifugeId, ctx.signingAddress, receiver, amount)

      if (isBridger) {
        // Spoke pulls the shares from the owner with transferFrom, so it needs an allowance too.
        yield* self.#approveShares(ctx, spokeCtx, spoke, amount)
        yield* wrapTransaction('Cross chain transfer shares', ctx, {
          contract: spoke,
          data: builders.crosschainTransferShares(builderContext(spokeCtx), {
            poolId: self.pool.id.toString(),
            scId: self.id.raw,
            destinationCentrifugeId: String(destinationCentrifugeId),
            receiver,
            amount: amount.toString(),
            refundAddress: ctx.signingAddress,
            senderAddress: ctx.signingAddress,
          }).data,
          messages,
        })
        return
      }

      yield* self.#tokenBridgeSend(ctx, spokeCtx, destinationCentrifugeId, receiver, amount)
    }, sourceCentrifugeId)
  }

  /**
   * Approves the share token on the source chain to `spender` when the
   * signer's allowance is below `amount`; both v3.3 routes pull the shares
   * with `transferFrom`. A built or batched transaction cannot carry the
   * approve, so it refuses instead. Returns the share token.
   */
  async *#approveShares(ctx: TransactionContext, spokeCtx: SdkProtocolContext, spender: HexString, amount: bigint) {
    const share = await ctx.publicClient.readContract({
      address: requireContract(spokeCtx, 'spokeRegistry'),
      abi: ABIS_V3_3.SpokeRegistry,
      functionName: 'shareToken',
      args: [this.pool.id.raw, this.id.raw],
    })
    if (share === zeroAddress) {
      throw new Error(
        `Share class ${this.id} of pool ${this.pool.id} has no share token on centrifugeId ${spokeCtx.centrifugeId}`
      )
    }
    const allowance = await ctx.publicClient.readContract({
      address: share,
      abi: STANDARD_ABIS.Currency,
      functionName: 'allowance',
      args: [ctx.signingAddress, spender],
    })
    if (allowance >= amount) return share
    if (ctx.isBatching) {
      throw new Error(
        `crosschainTransferShares: the share token allowance of ${ctx.signingAddress} to ${spender} is below ` +
          `${amount}. Approve it first; a built or batched transaction cannot carry the approve.`
      )
    }
    yield* doTransaction('Approve', ctx, () =>
      ctx.walletClient.writeContract({
        address: share,
        abi: STANDARD_ABIS.Currency,
        functionName: 'approve',
        args: [spender, amount],
      })
    )
    return share
  }

  /**
   * `TokenBridge.send` for an owner that is not a bridger, after an approve of
   * the share token to the bridge when the allowance falls short. The pool
   * must have made the source chain's TokenBridge a bridger, or `Spoke`
   * reverts the send. The bridge takes the destination as its EVM chain id and
   * refuses inside a gateway batch (`NotBatchable`), so it is always a call of
   * its own; a built transaction carries it only when no approve is needed.
   */
  async *#tokenBridgeSend(
    ctx: TransactionContext,
    spokeCtx: SdkProtocolContext,
    destinationCentrifugeId: CentrifugeId,
    receiver: HexString,
    amount: bigint
  ) {
    const sourceCentrifugeId = spokeCtx.centrifugeId
    if (ctx.isBatching && !ctx.isBuilding) {
      throw new Error(
        'crosschainTransferShares cannot be batched on v3.3 for an owner that is not a bridger: ' +
          'TokenBridge.send has no multicall and reverts inside a gateway batch (NotBatchable)'
      )
    }
    const tokenBridge = requireContract(spokeCtx, 'tokenBridge')
    const [bridgeEnabled, destinationChainId, [extraGasLimit, remoteExtraGasLimit]] = await Promise.all([
      ctx.publicClient.readContract({
        address: requireContract(spokeCtx, 'spokeRegistry'),
        abi: ABIS_V3_3.SpokeRegistry,
        functionName: 'bridger',
        args: [this.pool.id.raw, tokenBridge],
      }),
      this._root._idToChain(destinationCentrifugeId),
      ctx.publicClient.readContract({
        address: tokenBridge,
        abi: ABIS_V3_3.TokenBridge,
        functionName: 'gasLimits',
        args: [this.pool.id.raw, this.id.raw],
      }),
    ])
    if (!bridgeEnabled) {
      throw new BridgeNotEnabledError(
        `Pool ${this.pool.id} has not made TokenBridge ${tokenBridge} a bridger on centrifugeId ` +
          `${sourceCentrifugeId}: TokenBridge.send would revert NotBridger. A hub manager enables it with a ` +
          'Bridger grant toward that chain.',
        { poolId: this.pool.id.toString(), sourceCentrifugeId, tokenBridge }
      )
    }
    const mappedCentrifugeId = await ctx.publicClient.readContract({
      address: tokenBridge,
      abi: ABIS_V3_3.TokenBridge,
      functionName: 'chainIdToCentrifugeId',
      args: [BigInt(destinationChainId)],
    })
    if (mappedCentrifugeId !== destinationCentrifugeId) {
      throw new InvalidBridgeChainError(
        `TokenBridge on centrifugeId ${sourceCentrifugeId} maps chain ${destinationChainId} to centrifugeId ` +
          `${mappedCentrifugeId}, not ${destinationCentrifugeId}: TokenBridge.send would revert InvalidChainId`,
        { sourceCentrifugeId, destinationCentrifugeId, destinationChainId, mappedCentrifugeId }
      )
    }
    const share = yield* this.#approveShares(ctx, spokeCtx, tokenBridge, amount)
    yield* wrapTransaction('Cross chain transfer shares', ctx, {
      contract: tokenBridge,
      data: encodeFunctionData({
        abi: ABIS_V3_3.TokenBridge,
        functionName: 'send',
        args: [share, amount, addressToBytes32(receiver), BigInt(destinationChainId), ctx.signingAddress],
      }),
      messages: this.#tokenBridgeMessages(
        sourceCentrifugeId,
        destinationCentrifugeId,
        extraGasLimit,
        remoteExtraGasLimit
      ),
    })
  }

  /**
   * What `TokenBridge.send` pays for. TokenBridge forwards its per-share-class
   * gas limits into the transfer, and `GasService` adds a message's extra gas
   * to its cost, so a manifest without them underpays and the gateway reverts
   * `NotEnoughGas`. From the hub chain the hub sends `ExecuteTransferShares`
   * with `remoteExtraGasLimit`; from another spoke the spoke sends
   * `InitiateTransferShares` to the hub with `extraGasLimit` (the hub's own
   * leg is not paid from this transaction).
   */
  #tokenBridgeMessages(
    sourceCentrifugeId: CentrifugeId,
    destinationCentrifugeId: CentrifugeId,
    extraGasLimit: bigint,
    remoteExtraGasLimit: bigint
  ): Record<number, MessageTypeWithSubType[]> {
    const hubCentrifugeId = this.pool.id.centrifugeId
    const fromHub = sourceCentrifugeId === hubCentrifugeId
    const [to, type, extra] = fromHub
      ? [destinationCentrifugeId, MessageTypeV3_3.ExecuteTransferShares, remoteExtraGasLimit]
      : [hubCentrifugeId, MessageTypeV3_3.InitiateTransferShares, extraGasLimit]
    return { [to]: [{ ...messageV3_3(type, this.pool.id), extraGasLimit: extra }] }
  }

  /**
   * The bridge limit the pool's hub applies to transfers of this share class
   * leaving `originCentrifugeId`, read on the hub chain at its latest state: whether
   * a hook is set and is the protocol's `BridgeCircuitBreaker`, whether
   * bridging is paused, the origin's `rateMax` and `rateWindow`, and what is
   * left of the current window. A v3.2 pool has no hook. The hub applies it
   * when a transfer's message arrives, which on a source other than the hub
   * chain is after the shares have burned; `crosschainTransferShares` refuses
   * before signing what it would revert.
   * @param originCentrifugeId - The chain the shares leave from
   */
  bridgeLimit(originCentrifugeId: CentrifugeId): Query<BridgeLimit> {
    return this._query(
      ['bridgeLimit', originCentrifugeId],
      () => defer(() => this._readBridgeLimit(originCentrifugeId)),
      {
        valueCacheTime: 30_000,
      }
    )
  }

  /** @internal A fresh read of {@link bridgeLimit}. */
  async _readBridgeLimit(originCentrifugeId: CentrifugeId): Promise<BridgeLimit> {
    const [hubCtx, client] = await Promise.all([
      this._root.protocolContext(this.pool.id),
      this._root.getClient(this.pool.centrifugeId),
    ])
    if (!isV3_3(hubCtx)) return { kind: 'none', originCentrifugeId }
    const hook = await client.readContract({
      address: hubCtx.hubRegistry,
      abi: ABIS_V3_3.HubRegistry,
      functionName: 'bridgingHook',
      args: [this.pool.id.raw],
    })
    if (hook === zeroAddress) return { kind: 'none', originCentrifugeId }
    const breaker = requireContract(hubCtx, 'bridgeCircuitBreaker')
    if (hook.toLowerCase() !== breaker.toLowerCase()) {
      return { kind: 'unknown', originCentrifugeId, hook: hook.toLowerCase() as HexString }
    }
    // The book's guard is the breaker's: the breaker takes it at deployment and cannot change it.
    const guard = requireContract(hubCtx, 'circuitBreakerGuard')
    const [paused, [rateMax, rateWindow], [total, windowStart], block] = await Promise.all([
      client.readContract({
        address: breaker,
        abi: ABIS_V3_3.BridgeCircuitBreaker,
        functionName: 'paused',
        args: [this.pool.id.raw, this.id.raw],
      }),
      client.readContract({
        address: breaker,
        abi: ABIS_V3_3.BridgeCircuitBreaker,
        functionName: 'limits',
        args: [this.pool.id.raw, this.id.raw, originCentrifugeId],
      }),
      client.readContract({
        address: guard,
        abi: ABIS_V3_3.CircuitBreakerGuard,
        functionName: 'cumulative',
        args: [breaker, circuitBreakerKey(this.pool.id.raw, this.id.raw, originCentrifugeId)],
      }),
      client.getBlock(),
    ])
    return circuitBreakerLimit({
      originCentrifugeId,
      hook: breaker.toLowerCase() as HexString,
      paused,
      rateMax,
      rateWindow,
      total,
      windowStart,
      now: block.timestamp,
    })
  }

  /**
   * Throws {@link BridgeLimitError} when the hub's `BridgeCircuitBreaker` would
   * refuse this transfer, unless a hub manager authorized it exactly (same
   * route, sender, receiver and amount). `sender` is the transfer's owner as
   * the Spoke forwards it: the signer on both the direct and the TokenBridge
   * path. A hook that is not the address book's breaker cannot be judged: the
   * transfer proceeds with a warning, as the migration gate does when it cannot
   * judge.
   * @internal
   */
  async _assertBridgeLimit(
    originCentrifugeId: CentrifugeId,
    destinationCentrifugeId: CentrifugeId,
    sender: HexString,
    receiver: HexString,
    amount: bigint
  ) {
    const limit = await this._readBridgeLimit(originCentrifugeId)
    if (limit.kind === 'unknown') {
      console.warn(
        `Bridge limit: pool ${this.pool.id} bridges through hook ${limit.hook}, not the BridgeCircuitBreaker the ` +
          'address book names, so the SDK cannot tell whether the hub will accept this transfer; it is not checked.'
      )
      return
    }
    let authorized = false
    if (limit.kind === 'circuitBreaker' && !limit.paused) {
      const client = await this._root.getClient(this.pool.centrifugeId)
      const count = await client.readContract({
        address: limit.hook,
        abi: ABIS_V3_3.BridgeCircuitBreaker,
        functionName: 'authorizations',
        args: [
          bridgeAuthorizationKey({
            poolId: this.pool.id.raw,
            scId: this.id.raw,
            originCentrifugeId,
            targetCentrifugeId: destinationCentrifugeId,
            sender: addressToBytes32(sender),
            receiver: addressToBytes32(receiver),
            amount,
          }),
        ],
      })
      authorized = count > 0n
    }
    const reason = bridgeLimitRefusal(limit, amount, authorized)
    if (reason === null) return
    const why: Record<BridgeLimitReason, string> = {
      paused: 'bridging of the share class is paused',
      limitUnset:
        `no bridge limit is set for centrifugeId ${originCentrifugeId}, so only a transfer a hub manager ` +
        'authorized one by one passes',
      exceedsRateMax: `the amount is above the per-window limit of ${limit.kind === 'circuitBreaker' ? limit.rateMax : 0n}`,
      exceedsWindow: `the amount is above the ${limit.kind === 'circuitBreaker' ? limit.remaining : 0n} left in the current window`,
    }
    throw new BridgeLimitError(
      `Cross-chain transfer of ${amount} shares of ${this.id} from centrifugeId ${originCentrifugeId} to ` +
        `${destinationCentrifugeId} refused before signing: ${why[reason]}. The hub's circuit breaker would revert it.`,
      {
        reason,
        poolId: this.pool.id.toString(),
        scId: this.id.raw,
        originCentrifugeId,
        destinationCentrifugeId,
        amount,
        limit,
      }
    )
  }

  /** @internal */
  _balances() {
    return this._root._queryData<HoldingEscrowRow[]>('holdingEscrows', { tokenId: this.id.raw })
  }

  /**
   * The share class's direct issues and revokes the hub sent to a remote `ShareManager` and the
   * spoke has not executed: a failed message is listed, a cleared one is not. Shares are in the
   * pool's decimals.
   */
  directIssuancesInFlight(): Query<DirectIssuanceInFlight[]> {
    return this._query(['directIssuancesInFlight'], () =>
      combineLatest([
        this._root._queryData<ShareManagerCallRow[]>('shareManagerCalls', { tokenId: this.id.raw }),
        this.pool.decimals(),
      ]).pipe(
        map(([rows, decimals]) =>
          rows
            .filter((row) => row.status !== 'Executed' && row.status !== 'Cleared')
            .map((row) => ({
              messageId: row.messageId,
              messageIndex: row.messageIndex,
              centrifugeId: Number(row.centrifugeId),
              kind: row.kind,
              account: row.account,
              shares: new Balance(BigInt(row.shares), decimals),
              status: row.status,
              hubTxHash: row.createdAtTxHash,
              createdAt: new Date(row.createdAt),
            }))
        )
      )
    )
  }

  /**
   * The `holdingEscrows` rows, re-read soon after the share class's balance sheet moves.
   *
   * `_balances()` alone refreshes on the indexer poll (minutes), so a deposit or withdrawal would
   * show late. On a `NoteDeposit` / `Deposit` / `Withdraw` for this share class on any chain it
   * holds assets on, the rows are re-read at {@link ESCROW_REFRESH_DELAYS_MS}, giving the
   * indexer time to project the event; a slower indexer is caught by the regular poll. Events are
   * watched on the balance sheet of the pool's resolved version on each chain.
   * @internal
   */
  _liveBalances() {
    return this._query(['liveBalances'], () => {
      const rows$ = this._balances()
      if (this._root.config.disableRepeatOnEvents) return rows$
      // The chains the share class holds assets on; the event watch restarts only when they change,
      // so a poll result arriving mid-wait does not cancel a pending re-read.
      const chains$ = rows$.pipe(
        map((rows) => [...new Set(rows.map((row) => Number(row.centrifugeId) as CentrifugeId))].sort()),
        distinctUntilChanged((a, b) => a.join() === b.join())
      )
      const moved$ = chains$.pipe(
        switchMap((chains) =>
          merge(
            ...chains.map((centrifugeId) =>
              this._root.protocolContext({ poolId: this.pool.id, centrifugeId }).pipe(
                switchMap((addresses) =>
                  this._root._filteredEvents(
                    balanceSheetAddress(addresses),
                    ['NoteDeposit', 'Deposit', 'Withdraw'],
                    centrifugeId,
                    addresses.protocolVersion
                  )
                ),
                filter((events) => events.some((event: any) => event.args.scId === this.id.raw))
              )
            )
          )
        )
      )
      const reread$ = moved$.pipe(
        switchMap(() =>
          merge(
            ...ESCROW_REFRESH_DELAYS_MS.map((ms) =>
              timer(ms).pipe(
                switchMap(() =>
                  defer(() =>
                    this._root._queryDataOnce<HoldingEscrowRow[]>('holdingEscrows', { tokenId: this.id.raw })
                  ).pipe(
                    // A failed early re-read is not surfaced here: it reads the same source as the
                    // regular poll, and a failing source errors that stream loudly.
                    catchError(() => EMPTY)
                  )
                )
              )
            )
          )
        )
      )
      return merge(rows$, reread$).pipe(distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)))
    })
  }

  /** @internal */
  _holding(assetId: AssetId) {
    return this._query(['holding', assetId.toString()], () =>
      combineLatest([
        this._root.protocolContext(this.pool.id),
        this.pool.currency(),
        this._root._assetDecimals(assetId, this.pool.id),
      ]).pipe(
        switchMap(([{ holdings: holdingsAddr, contractAbis: ABI, protocolVersion }, poolCurrency, assetDecimals]) =>
          defer(async () => {
            const client = await firstValueFrom(this._root.getClient(this.pool.centrifugeId))
            const holdings = getContract({
              address: holdingsAddr,
              abi: ABI.Holdings,
              client,
            })

            const [valuation, amount, value, isLiability, ...accounts] = await Promise.all([
              holdings.read.valuation([this.pool.id.raw, this.id.raw, assetId.raw]),
              holdings.read.amount([this.pool.id.raw, this.id.raw, assetId.raw]),
              holdings.read.value([this.pool.id.raw, this.id.raw, assetId.raw]),
              // v3.3 has no liability flag: a liability is a holding whose accounts are liability-normal.
              protocolVersion === PROTOCOL_VERSION_V3_3
                ? Promise.resolve(false)
                : holdings.read.isLiability([this.pool.id.raw, this.id.raw, assetId.raw]),
              // v3.3 keys accounts by AccountKind: AmountDebit (asset), AmountCredit (equity),
              // ValueIncrease (gain), ValueDecrease (loss), and has no expense or liability slot.
              // Read in the v3.2 order the destructure below expects: asset, equity, loss, gain.
              ...(protocolVersion === PROTOCOL_VERSION_V3_3
                ? [0, 1, 3, 2]
                : [
                    AccountType.Asset,
                    AccountType.Equity,
                    AccountType.Loss,
                    AccountType.Gain,
                    AccountType.Expense,
                    AccountType.Liability,
                  ]
              ).map((kind) => holdings.read.accountId([this.pool.id.raw, this.id.raw, assetId.raw, kind])),
            ])
            return {
              assetId,
              assetDecimals,
              valuation,
              amount: new Balance(amount, assetDecimals),
              value: new Balance(value, poolCurrency.decimals),
              isLiability,
              accounts: {
                [AccountType.Asset]: accounts[0] || null,
                [AccountType.Equity]: accounts[1] || null,
                [AccountType.Loss]: accounts[2] || null,
                [AccountType.Gain]: accounts[3] || null,
                [AccountType.Expense]: accounts[4] || null,
                [AccountType.Liability]: accounts[5] || null,
              },
            }
          }).pipe(
            repeatOnEvents(
              this._root,
              {
                address: holdingsAddr,
                eventName: ['Increase', 'Decrease', 'Update', 'UpdateValuation'],
                filter: (events) => {
                  return events.some((event) => {
                    return event.args.scId === this.id && event.args.assetId === assetId.raw
                  })
                },
              },
              this.pool.centrifugeId,
              protocolVersion
            )
          )
        )
      )
    )
  }

  /** @internal */
  _assetPrice(centrifugeId: CentrifugeId, assetId: AssetId) {
    return this._query(['assetPrice', centrifugeId, assetId.toString()], () =>
      this.#spokeAssetPrice(centrifugeId, assetId, false).pipe(map((price) => price!))
    )
  }

  /**
   * The spoke's pool-per-asset price as the spoke itself validates it: `null` when the spoke
   * holds no valid price for the asset (the read reverts with `InvalidPrice`), the price otherwise.
   * Reads the `Spoke` on v3.2 and the `SpokeRegistry` on v3.3 and refreshes on the price update
   * event of whichever contract emits it. Anything but a revert (an unreachable node, a contract
   * without the function) stays an error.
   * @param centrifugeId - The spoke network
   * @param assetId - The asset on that network
   */
  validAssetPrice(centrifugeId: CentrifugeId, assetId: AssetId) {
    return this._query(['validAssetPrice', centrifugeId, assetId.toString()], () =>
      this.#spokeAssetPrice(centrifugeId, assetId, true)
    )
  }

  #spokeAssetPrice(centrifugeId: CentrifugeId, assetId: AssetId, checkValidity: boolean) {
    return combineLatest([
      this._root.protocolContext({ poolId: this.pool.id, centrifugeId }),
      this._root.getClient(centrifugeId),
    ]).pipe(
      switchMap(([addresses, client]) => {
        const registry = spokeReadTarget(addresses)
        return defer(async (): Promise<Price | null> => {
          try {
            const priceBn = await client.readContract({
              address: registry.address,
              abi: registry.abi,
              functionName: 'pricePoolPerAsset',
              args: [this.pool.id.raw, this.id.raw, assetId.raw, checkValidity],
            })
            return new Price(priceBn)
          } catch (error) {
            const reverted =
              error instanceof BaseError && !!error.walk((e) => e instanceof ContractFunctionRevertedError)
            if (!checkValidity || !reverted) throw error
            return null
          }
        }).pipe(
          repeatOnEvents(
            this._root,
            {
              // v3.2 emits the price on Spoke; v3.3 emits it on SpokeRegistry.
              address: registry.address,
              eventName: 'UpdateAssetPrice',
              filter: (events) => {
                return events.some((event) => event.args.scId === this.id.raw && event.args.assetId === assetId.raw)
              },
            },
            centrifugeId,
            addresses.protocolVersion
          )
        )
      })
    )
  }

  /** @internal */
  _investOrders() {
    return this._query(['investOrders'], () =>
      this._root.protocolContext(this.pool.id).pipe(
        switchMap(({ batchRequestManager, protocolVersion }) =>
          this._root._queryData<InvestOrderState>('investOrderState', { tokenId: this.id.raw }).pipe(
            map((data) => {
              const maxEpochByAsset = new Map<string, number>()
              for (const item of data.epochInvestOrders) {
                const current = maxEpochByAsset.get(item.assetId) ?? -1
                if (item.index > current) {
                  maxEpochByAsset.set(item.assetId, item.index)
                }
              }

              return {
                maxEpochByAsset,
                epochOutstandingInvests: data.epochOutstandingInvests.map((item) => ({
                  assetId: new AssetId(item.assetId),
                  centrifugeId: Number(item.asset.centrifugeId) as CentrifugeId,
                  pendingAmount: new Balance(item.pendingAssetsAmount || '0', item.asset.decimals),
                  createdAtTxHash: item.createdAtTxHash ?? null,
                  updatedAtTxHash: item.updatedAtTxHash ?? null,
                })),
                epochInvestOrders: data.epochInvestOrders.map((item) => ({
                  assetId: new AssetId(item.assetId),
                  centrifugeId: Number(item.asset.centrifugeId) as CentrifugeId,
                  index: item.index,
                  approvedAt: item.approvedAt ? new Date(item.approvedAt) : null,
                  approvedAtTxHash: item.approvedAtTxHash ?? null,
                  approvedAmount: new Balance(item.approvedAssetsAmount || '0', item.asset.decimals),
                  issuedAt: item.issuedAt,
                  issuedAtTxHash: item.issuedAtTxHash ?? null,
                  tokenDecimals: item.token.decimals,
                  assetDecimals: item.asset.decimals,
                })),
                pendingInvestOrders: data.pendingInvestOrders.map((item) => {
                  const assetId = new AssetId(item.assetId)
                  return {
                    assetId,
                    centrifugeId: assetId.centrifugeId,
                    account: item.account.toLowerCase() as HexString,
                    investor: item.account.toLowerCase() as HexString,
                    pendingAmount: item.pendingAssetsAmount || '0',
                    queuedAmount: item.queuedAssetsAmount || '0',
                  }
                }),
                investOrders: data.investOrders.map((item) => {
                  const assetId = new AssetId(item.assetId)
                  return {
                    assetId,
                    centrifugeId: assetId.centrifugeId,
                    account: item.account.toLowerCase() as HexString,
                    investor: item.account.toLowerCase() as HexString,
                    index: item.index,
                    approvedAt: item.approvedAt ? new Date(item.approvedAt) : null,
                    approvedAtTxHash: item.approvedAtTxHash ?? null,
                    approvedAmount: new Balance(item.approvedAssetsAmount || '0', item.asset.decimals),
                    issuedAt: item.issuedAt ? new Date(item.issuedAt) : null,
                    createdAtTxHash: item.createdAtTxHash ?? null,
                  }
                }),
                // Derived: the deprecated `outstandingInvests` indexer field was removed
                // (testnet). It enumerated every investor with outstanding activity —
                // pending OR queued OR approved-but-not-yet-issued. We reconstruct that set
                // as the union of pendingInvestOrders (pending/queued) and the open
                // investOrders (issuedAt: null → approved-but-not-issued), keyed by
                // (investor, assetId). pending/queued amounts come from the pending table
                // (raw strings, '0' for approved-only investors); consumers wrap them in
                // Balance with asset decimals and only read assetId/investor/pending/queued.
                outstandingInvests: (() => {
                  const byKey = new Map<
                    string,
                    {
                      assetId: AssetId
                      account: HexString
                      investor: HexString
                      tokenId: HexString
                      pendingAmount: string
                      queuedAmount: string
                    }
                  >()

                  data.pendingInvestOrders.forEach((item) => {
                    const assetId = new AssetId(item.assetId)
                    const account = item.account.toLowerCase() as HexString

                    byKey.set(`${assetId.toString()}-${account}`, {
                      assetId,
                      account,
                      investor: account,
                      tokenId: this.id.raw,
                      pendingAmount: item.pendingAssetsAmount || '0',
                      queuedAmount: item.queuedAssetsAmount || '0',
                    })
                  })

                  data.investOrders.forEach((item) => {
                    const assetId = new AssetId(item.assetId)
                    const account = item.account.toLowerCase() as HexString
                    const key = `${assetId.toString()}-${account}`

                    if (!byKey.has(key)) {
                      byKey.set(key, {
                        assetId,
                        account,
                        investor: account,
                        tokenId: this.id.raw,
                        pendingAmount: '0',
                        queuedAmount: '0',
                      })
                    }
                  })

                  return Array.from(byKey.values())
                })(),
              }
            }),
            repeatOnEvents(
              this._root,
              {
                address: batchRequestManager,
                eventName: ['UpdateDepositRequest', 'ApproveDeposits', 'IssueShares', 'ClaimDeposit'],
                filter: (events) =>
                  events.some((event) => event.args.shareClassId === this.id.raw || event.args.scId === this.id.raw),
              },
              this.pool.centrifugeId,
              protocolVersion
            )
          )
        )
      )
    )
  }

  /** @internal */
  _redeemOrders() {
    return this._query(['redeemOrders'], () =>
      this._root.protocolContext(this.pool.id).pipe(
        switchMap(({ batchRequestManager, protocolVersion }) =>
          this._root._queryData<RedeemOrderState>('redeemOrderState', { tokenId: this.id.raw }).pipe(
            map((data) => {
              const maxEpochByAsset = new Map<string, number>()
              for (const item of data.epochRedeemOrders) {
                const current = maxEpochByAsset.get(item.assetId) ?? -1
                if (item.index > current) {
                  maxEpochByAsset.set(item.assetId, item.index)
                }
              }

              return {
                maxEpochByAsset,
                epochOutstandingRedeems: data.epochOutstandingRedeems.map((item) => {
                  const assetId = new AssetId(item.assetId)
                  return {
                    assetId,
                    centrifugeId: assetId.centrifugeId,
                    pendingAmount: new Balance(item.pendingSharesAmount || '0', item.token.decimals),
                    createdAtTxHash: item.createdAtTxHash ?? null,
                    updatedAtTxHash: item.updatedAtTxHash ?? null,
                  }
                }),
                epochRedeemOrders: data.epochRedeemOrders.map((item) => {
                  const assetId = new AssetId(item.assetId)
                  return {
                    assetId,
                    centrifugeId: assetId.centrifugeId,
                    index: item.index,
                    approvedAt: item.approvedAt ? new Date(item.approvedAt) : null,
                    approvedAtTxHash: item.approvedAtTxHash ?? null,
                    revokedAt: item.revokedAt ? new Date(item.revokedAt) : null,
                    revokedAtTxHash: item.revokedAtTxHash ?? null,
                    approvedAmount: new Balance(item.approvedSharesAmount || '0', item.token.decimals),
                    createdAtTxHash: item.createdAtTxHash ?? null,
                    tokenDecimals: item.token.decimals,
                    assetDecimals: item.asset.decimals,
                  }
                }),
                pendingRedeemOrders: data.pendingRedeemOrders.map((item) => {
                  const assetId = new AssetId(item.assetId)
                  const tokenDecimals =
                    data.epochOutstandingRedeems[0]?.token.decimals ?? data.epochRedeemOrders[0]?.token.decimals ?? 18
                  return {
                    assetId,
                    centrifugeId: assetId.centrifugeId,
                    account: item.account.toLowerCase() as HexString,
                    investor: item.account.toLowerCase() as HexString,
                    pendingAmount: new Balance(item.pendingSharesAmount ?? '0', tokenDecimals),
                    queuedAmount: new Balance(item.queuedSharesAmount ?? '0', tokenDecimals),
                    createdAtTxHash: item.createdAtTxHash ?? null,
                    updatedAtTxHash: item.updatedAtTxHash ?? null,
                    tokenId: item.tokenId,
                  }
                }),
                redeemOrders: data.redeemOrders.map((item) => {
                  const assetId = new AssetId(item.assetId)
                  return {
                    assetId,
                    centrifugeId: assetId.centrifugeId,
                    account: item.account.toLowerCase() as HexString,
                    investor: item.account.toLowerCase() as HexString,
                    index: item.index,
                    approvedAt: item.approvedAt ? new Date(item.approvedAt) : null,
                    approvedAmount: new Balance(item.approvedSharesAmount || '0', item.token.decimals),
                    revokedAt: item.revokedAt ? new Date(item.revokedAt) : null,
                  }
                }),
                // Derived: the deprecated `outstandingRedeems` indexer field was removed
                // (testnet). It enumerated every investor with outstanding activity —
                // pending OR queued OR approved-but-not-yet-revoked. We reconstruct that set
                // as the union of pendingRedeemOrders (pending/queued) and the open
                // redeemOrders (revokedAt: null → approved-but-not-revoked), keyed by
                // (investor, assetId). pending/queued amounts come from the pending table as
                // Balance (already scaled by token decimals; zero for approved-only
                // investors); consumers only read assetId/investor/pending/queued.
                outstandingRedeems: (() => {
                  const tokenDecimals =
                    data.epochOutstandingRedeems[0]?.token.decimals ?? data.epochRedeemOrders[0]?.token.decimals ?? 18

                  const byKey = new Map<
                    string,
                    {
                      assetId: AssetId
                      account: HexString
                      investor: HexString
                      tokenId: HexString
                      pendingAmount: Balance
                      queuedAmount: Balance
                      tokenDecimals: number
                    }
                  >()

                  data.pendingRedeemOrders.forEach((item) => {
                    const assetId = new AssetId(item.assetId)
                    const account = item.account.toLowerCase() as HexString

                    byKey.set(`${assetId.toString()}-${account}`, {
                      assetId,
                      account,
                      investor: account,
                      tokenId: this.id.raw,
                      pendingAmount: new Balance(item.pendingSharesAmount ?? '0', tokenDecimals),
                      queuedAmount: new Balance(item.queuedSharesAmount ?? '0', tokenDecimals),
                      tokenDecimals,
                    })
                  })

                  data.redeemOrders.forEach((item) => {
                    const assetId = new AssetId(item.assetId)
                    const account = item.account.toLowerCase() as HexString
                    const key = `${assetId.toString()}-${account}`

                    if (!byKey.has(key)) {
                      byKey.set(key, {
                        assetId,
                        account,
                        investor: account,
                        tokenId: this.id.raw,
                        pendingAmount: new Balance('0', tokenDecimals),
                        queuedAmount: new Balance('0', tokenDecimals),
                        tokenDecimals,
                      })
                    }
                  })

                  return Array.from(byKey.values())
                })(),
              }
            }),
            repeatOnEvents(
              this._root,
              {
                address: batchRequestManager,
                eventName: ['UpdateRedeemRequest', 'ApproveRedeems', 'RevokeShares', 'ClaimRedeem'],
                filter: (events) =>
                  events.some((event) => event.args.shareClassId === this.id.raw || event.args.scId === this.id.raw),
              },
              this.pool.centrifugeId,
              protocolVersion
            )
          )
        )
      )
    )
  }

  /**
   * What the indexer answers now, outside the cached queries so that a poll sees the latest rows, for the epochs an issue
   * (`deposit`) or a revoke (`redeem`) settled, per asset.
   *
   * An investor's `maxClaims` is the number of their closed orders of the asset that no `notifyDeposit` or `notifyRedeem`
   * has settled: the issued or revoked epochs waiting for them, which is the window `BatchRequestManager` counts in
   * `maxDepositClaims` and `maxRedeemClaims`. A deposit order belongs to the epoch its approval transaction approved, a
   * redeem order to the epoch of its index, as `closedInvestments` and `closedRedemptions` join them.
   * @internal
   */
  async _settledOrdersNow(
    kind: OrderKind,
    settled: readonly { assetId: AssetId; epochs: readonly number[] }[]
  ): Promise<SettledOrders[]> {
    const { epochs, orders } = await this.#closedOrdersNow(kind)
    return settled.map(({ assetId, epochs: wanted }) => {
      const asset = assetId.toString()
      const rows = wanted.map((index) => ({ index, row: epochs.find((e) => e.assetId === asset && e.index === index) }))
      const keys = new Set(rows.flatMap(({ row }) => (row?.key ? [row.key] : [])))
      const unclaimed = orders.filter((order) => order.assetId === asset && !order.claimed)
      const claims = new Map<HexString, number>()
      for (const { account } of unclaimed) claims.set(account, (claims.get(account) ?? 0) + 1)
      const investors = new Set(
        unclaimed.filter(({ key }) => key !== null && keys.has(key)).map(({ account }) => account)
      )
      return {
        open: rows.filter(({ row }) => !row?.closed).map(({ index }) => index),
        investors: [...investors].map((investor) => ({ investor, maxClaims: claims.get(investor)! })),
      }
    })
  }

  async #closedOrdersNow(kind: OrderKind): Promise<{ epochs: ClosedEpochRow[]; orders: ClosedOrderRow[] }> {
    const tokenId = this.id.raw
    if (kind === 'deposit') {
      const [epochs, orders] = await Promise.all([
        this._root._queryDataOnce<EpochInvestOrderRow[]>('epochInvestOrders', { tokenId }),
        this._root._queryDataOnce<InvestOrderRow[]>('closedInvestOrders', { tokenId }),
      ])
      return {
        epochs: epochs.map((epoch) => ({
          assetId: String(epoch.assetId),
          index: epoch.index,
          closed: !!epoch.issuedAt,
          key: epoch.approvedAtTxHash ? orderEpochKey(epoch.assetId, epoch.approvedAtTxHash) : null,
        })),
        orders: orders.map((order) => ({
          assetId: String(order.assetId),
          account: order.account.toLowerCase() as HexString,
          claimed: !!order.claimedAt,
          key: order.approvedAtTxHash ? orderEpochKey(order.assetId, order.approvedAtTxHash) : null,
        })),
      }
    }
    const [epochs, orders] = await Promise.all([
      this._root._queryDataOnce<EpochRedeemOrderRow[]>('epochRedeemOrders', { tokenId }),
      this._root._queryDataOnce<RedeemOrderRow[]>('closedRedeemOrders', { tokenId }),
    ])
    return {
      epochs: epochs.map((epoch) => ({
        assetId: String(epoch.assetId),
        index: epoch.index,
        closed: !!epoch.revokedAt,
        key: orderEpochKey(epoch.assetId, epoch.index),
      })),
      orders: orders.map((order) => ({
        assetId: String(order.assetId),
        account: order.account.toLowerCase() as HexString,
        claimed: !!order.claimedAt,
        key: orderEpochKey(order.assetId, order.index),
      })),
    }
  }

  /** @internal */
  _investorOrder(assetId: AssetId, investor: HexString) {
    return this._query(['investorOrder', assetId.toString(), investor.toLowerCase()], () =>
      combineLatest([this._root.protocolContext(this.pool.id), this._root.getClient(this.pool.centrifugeId)]).pipe(
        switchMap(([{ batchRequestManager, contractAbis: ABI, protocolVersion }, client]) =>
          defer(async () => {
            const contract = getContract({
              address: batchRequestManager,
              abi: ABI.BatchRequestManager,
              client,
            })

            const [
              maxDepositClaims,
              maxRedeemClaims,
              [pendingDeposit],
              [pendingRedeem],
              [, queuedInvest],
              [, queuedRedeem],
            ] = await Promise.all([
              contract.read.maxDepositClaims([this.pool.id.raw, this.id.raw, addressToBytes32(investor), assetId.raw]),
              contract.read.maxRedeemClaims([this.pool.id.raw, this.id.raw, addressToBytes32(investor), assetId.raw]),
              contract.read.depositRequest([this.pool.id.raw, this.id.raw, assetId.raw, addressToBytes32(investor)]),
              contract.read.redeemRequest([this.pool.id.raw, this.id.raw, assetId.raw, addressToBytes32(investor)]),
              contract.read.queuedDepositRequest([
                this.pool.id.raw,
                this.id.raw,
                assetId.raw,
                addressToBytes32(investor),
              ]),
              contract.read.queuedRedeemRequest([
                this.pool.id.raw,
                this.id.raw,
                assetId.raw,
                addressToBytes32(investor),
              ]),
            ])

            return {
              assetId,
              investor,
              maxDepositClaims,
              maxRedeemClaims,
              pendingDeposit,
              pendingRedeem,
              queuedInvest,
              queuedRedeem,
            }
          }).pipe(
            repeatOnEvents(
              this._root,
              {
                address: batchRequestManager,
                eventName: [
                  'UpdateDepositRequest',
                  'UpdateRedeemRequest',
                  'ClaimDeposit',
                  'ClaimRedeem',
                  'ApproveDeposits',
                  'ApproveRedeems',
                ],
                filter: (events) => {
                  return events.some(
                    (event) =>
                      event.args.scId === this.id.raw &&
                      (event.args.depositAssetId === assetId.raw || event.args.payoutAssetId === assetId.raw)
                  )
                },
              },
              this.pool.centrifugeId,
              protocolVersion
            )
          )
        )
      )
    )
  }

  /** @internal */
  _allVaults() {
    return this._root._queryData('allVaults', { tokenId: this.id.raw }, (items: VaultRow[]) =>
      items.map(({ centrifugeId, asset, ...rest }) => ({
        ...rest,
        centrifugeId: Number(centrifugeId),
        assetId: new AssetId(asset.id),
      }))
    )
  }

  /** @internal */
  _metadata() {
    return this._query(['metadata'], () =>
      this._root.protocolContext(this.pool.id).pipe(
        switchMap(({ shareClassManager, contractAbis: ABI, protocolVersion }) =>
          defer(async () => {
            const client = await firstValueFrom(this._root.getClient(this.pool.centrifugeId))
            const [name, symbol] = await client.readContract({
              address: shareClassManager,
              abi: ABI.ShareClassManager,
              functionName: 'metadata',
              args: [this.pool.id.raw, this.id.raw],
            })
            return {
              name,
              symbol,
            }
          }).pipe(
            repeatOnEvents(
              this._root,
              {
                address: shareClassManager,
                eventName: 'UpdateMetadata',
                filter: (events) => {
                  return events.some((event) => {
                    return event.args.scId === this.id
                  })
                },
              },
              this.pool.centrifugeId,
              protocolVersion
            )
          )
        )
      )
    )
  }

  /** @internal */
  _metrics() {
    return this._query(['metrics'], () =>
      combineLatest([this._root.protocolContext(this.pool.id), this._root.getClient(this.pool.centrifugeId)]).pipe(
        switchMap(([{ shareClassManager, contractAbis: ABI, protocolVersion }, client]) =>
          defer(async () => {
            const contract = getContract({
              address: shareClassManager,
              abi: ABI.ShareClassManager,
              client,
            })

            const [totalIssuance, [pricePerShare, computedAt]] = await Promise.all([
              contract.read.totalIssuance([this.pool.id.raw, this.id.raw]),
              contract.read.pricePoolPerShare([this.pool.id.raw, this.id.raw]),
            ])

            return {
              totalIssuance: new Balance(totalIssuance, 18),
              pricePerShare: new Price(pricePerShare),
              priceComputedAt: computedAt > 0n ? new Date(Number(computedAt) * 1000) : null,
            }
          }).pipe(
            repeatOnEvents(
              this._root,
              {
                address: shareClassManager,
                eventName: [
                  'RevokeShares',
                  'IssueShares',
                  'RemoteIssueShares',
                  'RemoteRevokeShares',
                  'UpdateShareClass',
                  'UpdatePricePoolPerShare',
                ],
                filter: (events) => {
                  return events.some((event) => {
                    return event.args.scId === this.id.raw
                  })
                },
              },
              this.pool.centrifugeId,
              protocolVersion
            )
          )
        )
      )
    )
  }

  /** @internal */
  _updateContract(centrifugeId: CentrifugeId, target: HexString, payload: HexString) {
    const self = this
    return this._transact(async function* (ctx) {
      assertCrosschainMessagingEnabled(centrifugeId)

      const hubCtx = await self._root.protocolContext(self.pool.id)
      // The payload is a v3.2 trusted-call encoding; a v3.3 target's fromHub decodes another layout.
      refuseOnV3_3(
        hubCtx,
        '_updateContract',
        'Hub.updateContract was replaced by Hub.managerCall with per-target payloads'
      )
      const { hub, contractAbis: ABI } = hubCtx
      yield* wrapTransaction('Update contract', ctx, {
        contract: hub,
        policy: { poolId: self.pool.id },
        data: encodeFunctionData({
          abi: ABI.Hub,
          functionName: 'updateContract',
          args: [
            self.pool.id.raw,
            self.id.raw,
            centrifugeId,
            addressToBytes32(target),
            payload,
            0n,
            ctx.signingAddress,
          ],
        }),
        messages: { [centrifugeId]: [{ type: MessageType.TrustedContractUpdate, poolId: self.pool.id }] },
      })
    }, this.pool.centrifugeId)
  }

  /** @internal */
  _share(centrifugeId: CentrifugeId) {
    return this._query(['share', centrifugeId], () =>
      this.pool.network(centrifugeId).pipe(switchMap((network) => network._share(this.id)))
    )
  }

  /** @internal */
  _restrictionManager(centrifugeId: CentrifugeId) {
    return this._query(['restrictionManager', centrifugeId], () =>
      combineLatest([this._share(centrifugeId), this._root.getClient(centrifugeId)]).pipe(
        switchMap(([share, client]) =>
          defer(async () => {
            const address = await client.readContract({
              address: share,
              abi: STANDARD_ABIS.Currency,
              functionName: 'hook',
            })
            return address.toLowerCase() as HexString
          })
        )
      )
    )
  }

  /** @internal */
  _getFreeAccountId() {
    return this._query(['getFreeAccountId'], () =>
      this._root.protocolContext(this.pool.id).pipe(
        map(({ accounting, contractAbis: ABI }) => ({ accounting, ABI, id: null, triesLeft: 10 })),
        expand(({ accounting, ABI, triesLeft }) => {
          const id = randomUint(256)

          if (triesLeft <= 0) return EMPTY

          return defer(async () => {
            const client = await firstValueFrom(this._root.getClient(this.pool.centrifugeId))
            const exists = await client.readContract({
              address: accounting,
              abi: ABI.Accounting,
              functionName: 'exists',
              args: [this.pool.id.raw, id],
            })
            return { accounting, ABI, id: exists ? null : id, triesLeft: triesLeft - 1 }
          })
        }),
        filter(({ id }) => !!id),
        map(({ id }) => id!)
      )
    )
  }

  /** @internal */
  _tokenInstancePositions(options?: {
    limit?: number
    offset?: number
    orderBy?: string
    orderDirection?: string
    filter?: {
      balance_gt?: bigint
      holderAddress?: string
      centrifugeIds?: string[]
    }
  }) {
    const limit = options?.limit ?? 1000
    const offset = options?.offset ?? 0
    const orderBy = options?.orderBy ?? 'balance'
    const orderDirection = options?.orderDirection ?? 'desc'
    const balance_gt = options?.filter?.balance_gt
    const holderAddress = options?.filter?.holderAddress?.toLowerCase()
    const centrifugeIds = options?.filter?.centrifugeIds

    return this._query(
      [
        'tokenInstancePositions',
        this.id.raw,
        limit,
        offset,
        balance_gt?.toString(),
        holderAddress,
        centrifugeIds?.join(','),
        orderBy,
        orderDirection,
      ],
      () =>
        combineLatest([this._root._systemAddresses(this.pool.centrifugeId), this.pool._escrow()]).pipe(
          switchMap(([systemAddresses, escrowAddress]) => {
            // The catalogue owns the document; the SDK supplies domain params.
            // `excludedAddresses` are the protocol-owned accounts of every
            // version deployed on the chain, so a migrated pool still hides
            // the managers of the version it left.
            return this._root
              ._queryData<{
                items: TokenInstancePositionRow[]
                totalCount: number
              }>('tokenInstancePositions', {
                tokenId: this.id.raw,
                limit,
                offset,
                orderBy,
                orderDirection,
                excludedAddresses: [...systemAddresses, escrowAddress.toLowerCase()],
                ...(balance_gt !== undefined ? { balanceGt: balance_gt.toString() } : {}),
                ...(holderAddress ? { holderAddress } : {}),
                ...(centrifugeIds ? { centrifugeIds } : {}),
              })
              .pipe(map((data) => ({ items: data.items, totalCount: data.totalCount })))
          })
        )
    )
  }

  /** @internal */
  _whitelistedInvestors(options?: { limit: number; offset?: number }) {
    const limit = options?.limit ?? 1000
    const offset = options?.offset ?? 0
    const MAX_CENTRIFUGE_ID = 100n

    return this._query(['whitelistedInvestors', this.id.raw, limit, offset], () =>
      this._root.protocolContext(this.pool.id).pipe(
        switchMap(({ hub, protocolVersion }) =>
          this._root
            ._queryData<WhitelistedInvestorsPage>('whitelistedInvestors', {
              tokenId: this.id.raw,
              limit,
              offset,
            })
            .pipe(
              map((data) => {
                return {
                  items: data.items
                    .map(({ accountAddress, ...rest }) => ({
                      address: accountAddress.toLowerCase() as HexString,
                      ...rest,
                    }))
                    .filter((investor) => BigInt(investor.address) > MAX_CENTRIFUGE_ID),
                  totalCount: data.totalCount,
                }
              }),
              repeatOnEvents(
                this._root,
                {
                  address: hub,
                  eventName: 'UpdateRestriction',
                  filter: (events) => events.some((event) => event.args.scId === this.id.raw),
                },
                this.pool.centrifugeId,
                protocolVersion
              )
            )
        )
      )
    )
  }

  /** @internal */
  _whitelistedInvestor(params: { accountAddress: string; centrifugeId: string; tokenId: string }) {
    return this._query(
      ['whitelistedInvestor', this.id.raw, params.accountAddress, params.centrifugeId, params.tokenId],
      () =>
        this._root.protocolContext(this.pool.id).pipe(
          switchMap(({ hub, protocolVersion }) =>
            this._root
              ._queryData<WhitelistedInvestorRow | null>('whitelistedInvestor', {
                tokenId: params.tokenId,
                centrifugeId: params.centrifugeId,
                accountAddress: params.accountAddress,
              })
              .pipe(
                map((investor) => {
                  if (!investor) return null
                  const { accountAddress, ...rest } = investor
                  return {
                    address: accountAddress.toLowerCase() as HexString,
                    ...rest,
                  }
                }),
                repeatOnEvents(
                  this._root,
                  {
                    address: hub,
                    eventName: 'UpdateRestriction',
                    filter: (events) =>
                      events.some(
                        (event) =>
                          event.args.scId === this.id.raw &&
                          event.args.user?.toLowerCase() === params.accountAddress.toLowerCase()
                      ),
                  },
                  this.pool.centrifugeId,
                  protocolVersion
                )
              )
          )
        )
    )
  }

  /** @internal */
  _tokenInstancePosition(params: { accountAddress: string; centrifugeId: string; tokenId: string }) {
    return this._query(
      ['tokenInstancePosition', this.id.raw, params.accountAddress, params.centrifugeId, params.tokenId],
      () =>
        this._root
          ._queryData<TokenInstancePositionRow | null>('tokenInstancePosition', {
            tokenId: params.tokenId,
            centrifugeId: params.centrifugeId,
            accountAddress: params.accountAddress,
          })
          .pipe(
            map((position) => {
              if (!position) return null
              const { accountAddress, balance, ...rest } = position
              return {
                accountAddress: accountAddress.toLowerCase() as HexString,
                balance: BigInt(balance),
                ...rest,
              }
            })
          )
    )
  }

  /** @internal */
  _getQuote(valuationAddress: HexString, assetId: AssetId, baseAmount: Balance) {
    return this._query(['getQuote', valuationAddress, baseAmount.toString(), assetId.toString()], () =>
      timer(0, 120_000).pipe(
        switchMap(() =>
          combineLatest([this._root.getClient(this.pool.centrifugeId), this._root.protocolContext(this.pool.id)])
        ),
        switchMap(([client, { contractAbis: ABI }]) =>
          combineLatest([
            this.pool.currency(),
            defer(() => {
              return client.readContract({
                address: valuationAddress,
                abi: ABI.Valuation,
                functionName: 'getQuote',
                args: [this.pool.id.raw, this.id.raw, assetId.raw, baseAmount.toBigInt()],
              })
            }),
          ])
        ),
        map(([poolCurrency, quote]) => {
          return new Balance(quote, poolCurrency.decimals)
        })
      )
    )
  }
}
