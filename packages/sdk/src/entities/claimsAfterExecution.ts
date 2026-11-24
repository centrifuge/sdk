import type { Centrifuge, SdkProtocolContext } from '../Centrifuge.js'
import type { HexString } from '../types/index.js'
import { MessageType, type MessageTypeWithSubType } from '../types/transaction.js'
import { addMessageForEnabledTarget, assertCrosschainMessagingEnabled } from '../utils/crosschainHotfix.js'
import { orderStepsOf, type OrderKind, type OrderStep } from '../utils/orderSettlements.js'
import { requireContract } from '../utils/protocolVersion.js'
import { mergeMessages, sleep } from '../utils/transaction.js'
import type { AssetId } from '../utils/types.js'
import type { ParsedCall } from './hubExecution.js'
import type { Pool } from './Pool.js'
import {
  claimNotificationBudget,
  encodeClaimNotifications,
  ShareClass,
  type ClaimNotification,
  type SettledOrders,
} from './ShareClass.js'

export const CLAIMS_METHOD = 'Pool.claimsAfterExecution'

/** How often, and for how long, the indexer is asked whether it has processed the settlement of the group. */
export const INDEXER_POLL_MS = 3_000
export const INDEXER_WAIT_MS = 120_000

export const noSettlementError = () =>
  new Error(`${CLAIMS_METHOD}: the group holds no issue or revoke, so there are no claims to send`)

const alreadyClaimedError = () =>
  new Error(
    `${CLAIMS_METHOD}: every investor of the epochs the group settled is already claimed, so there is nothing to claim`
  )

/** The claims of a group as one `BatchRequestManager` transaction. */
export type ClaimsPlan = { data: HexString[]; messages: Record<number, MessageTypeWithSubType[]> }

/** The epochs of an asset that a group issues or revokes, and the messages its hub batch sends for the asset. */
type AssetSettlement = { assetId: AssetId; epochs: Set<number>; hubMessages: number; settles: boolean }
/** What a group settles for the deposits or the redeems of one share class. */
type Settlement = { scId: HexString; kind: OrderKind; assets: AssetSettlement[] }
/** What the indexer holds for a settlement, per asset in the order of `assets`. */
type Indexed = { settlement: Settlement; assets: SettledOrders[] }

/** A deposit approval sends a callback like an issue; a redeem approval sends none. */
const sendsCallback = ({ kind, step }: OrderStep) => step === 'settle' || kind === 'deposit'

/** The assets each share class and side of `steps` settle, in the order the group first names them. */
function settlementsOf(steps: readonly OrderStep[]): Settlement[] {
  const sides = new Map<string, { scId: HexString; kind: OrderKind; assets: Map<string, AssetSettlement> }>()
  for (const step of steps) {
    const side = sides.get(`${step.scId}:${step.kind}`) ?? { scId: step.scId, kind: step.kind, assets: new Map() }
    sides.set(`${step.scId}:${step.kind}`, side)
    const key = step.assetId.toString()
    const asset = side.assets.get(key) ?? { assetId: step.assetId, epochs: new Set(), hubMessages: 0, settles: false }
    side.assets.set(key, asset)
    if (sendsCallback(step)) asset.hubMessages++
    if (step.step === 'settle') {
      asset.epochs.add(step.epoch)
      asset.settles = true
    }
  }
  return [...sides.values()]
    .map(({ assets, ...side }) => ({ ...side, assets: [...assets.values()].filter(({ settles }) => settles) }))
    .filter(({ assets }) => assets.length > 0)
}

const readIndexer = (root: Centrifuge, pool: Pool, settlements: readonly Settlement[]): Promise<Indexed[]> =>
  Promise.all(
    settlements.map(async (settlement) => ({
      settlement,
      assets: await new ShareClass(root, pool, settlement.scId)._settledOrdersNow(
        settlement.kind,
        settlement.assets.map(({ assetId, epochs }) => ({ assetId, epochs: [...epochs] }))
      ),
    }))
  )

const openEpochs = (indexed: readonly Indexed[]) =>
  indexed.flatMap(({ settlement, assets }) =>
    assets.flatMap(({ open }, index) =>
      open.length > 0 ? [`epoch ${open.join(', ')} of asset ${settlement.assets[index]!.assetId}`] : []
    )
  )
const hasUnclaimed = (indexed: readonly Indexed[]) =>
  indexed.some(({ assets }) => assets.some(({ investors }) => investors.length > 0))

/**
 * Reads the indexer until it has processed the settlement: every epoch the group issues or revokes shows as closed. An
 * epoch's investors are written right after its row, so a read that finds the epochs closed and no investor to notify
 * is repeated once before the investors are called claimed.
 *
 * @throws Error when the indexer has not caught up after {@link INDEXER_WAIT_MS}, or the wait is cancelled. A failing
 * read is not retried.
 */
async function indexedSettlements(
  root: Centrifuge,
  pool: Pool,
  settlements: readonly Settlement[],
  signal: AbortSignal | undefined
): Promise<Indexed[]> {
  const deadline = Date.now() + INDEXER_WAIT_MS
  let emptySeen = false
  for (;;) {
    const indexed = await readIndexer(root, pool, settlements)
    const open = openEpochs(indexed)
    const timedOut = Date.now() >= deadline
    if (open.length === 0 && (hasUnclaimed(indexed) || emptySeen || timedOut)) return indexed
    if (timedOut) {
      throw new Error(
        `${CLAIMS_METHOD}: the indexer has not processed the execution yet, ${INDEXER_WAIT_MS / 1000} s after the ` +
          `call (${open.join('; ')} still open). Nothing was sent; call again`
      )
    }
    emptySeen = open.length === 0
    await sleep(INDEXER_POLL_MS, signal)
    if (signal?.aborted)
      throw new Error(`${CLAIMS_METHOD}: stopped waiting for the indexer, the transaction was cancelled`)
  }
}

/** The first notifications of each asset that its budget allows, in the order of the indexer's list. */
function notificationsOf({ settlement, assets }: Indexed, pool: Pool): ClaimNotification[] {
  return assets.flatMap(({ investors }, index) => {
    const { assetId, hubMessages } = settlement.assets[index]!
    const budget = claimNotificationBudget(assetId, pool.centrifugeId, assets.length, hubMessages)
    return investors.slice(0, budget).map(({ investor, maxClaims }) => ({ assetId, investor, maxClaims }))
  })
}

/**
 * The claims a group left: for each epoch the group issues or revokes, a notification for the investors the indexer
 * lists as unclaimed, with the number of their closed epochs the indexer lists as unclaimed, as many as the entities'
 * gas budget allows, refunded to `signer`. It waits for the indexer to process the settlement first.
 *
 * @throws Error when the group has no issue or revoke to the pool's own `BatchRequestManager`, when an asset it settles
 * is on a chain whose cross-chain messaging is disabled, when the indexer does not catch up, and when no investor is
 * left to notify.
 */
export async function planClaims(
  root: Centrifuge,
  pool: Pool,
  hubCtx: SdkProtocolContext,
  signer: HexString,
  group: readonly ParsedCall[],
  signal?: AbortSignal
): Promise<ClaimsPlan> {
  const scope = { poolId: pool.id, batchRequestManager: requireContract(hubCtx, 'batchRequestManager') }
  const settlements = settlementsOf(orderStepsOf(group, scope))
  if (settlements.length === 0) throw noSettlementError()
  settlements.forEach(({ assets }) =>
    assets.forEach(({ assetId }) => assertCrosschainMessagingEnabled(assetId.centrifugeId))
  )

  const indexed = await indexedSettlements(root, pool, settlements, signal)
  if (!hasUnclaimed(indexed)) throw alreadyClaimedError()
  const batches = indexed.map((entry) => ({ ...entry.settlement, notifications: notificationsOf(entry, pool) }))
  const data = batches.flatMap(({ scId, kind, notifications }) =>
    encodeClaimNotifications(hubCtx, kind, pool.id, scId, notifications, signer)
  )
  if (data.length === 0) {
    throw new Error(
      `${CLAIMS_METHOD}: the hub batch of the group leaves no gas budget for a claim notification, so claim ` +
        'with shareClass.claimDeposit and claimRedeem'
    )
  }
  return { data, messages: mergeMessages(batches.map(({ notifications }) => callbacksOf(pool, notifications))) }
}

/** One `RequestCallback` to the chain of the asset for each notification, as the entities declare them. */
function callbacksOf(pool: Pool, notifications: readonly ClaimNotification[]) {
  const messages: Record<number, MessageTypeWithSubType[]> = {}
  for (const { assetId } of notifications) {
    addMessageForEnabledTarget(messages, assetId.centrifugeId, { type: MessageType.RequestCallback, poolId: pool.id })
  }
  return messages
}
