import { ABIS_V3_3, resolveMigrationChain } from '@centrifuge/protocol'
import { firstValueFrom } from 'rxjs'
import { encodeFunctionData, parseAbi, zeroAddress, type Abi, type PublicClient } from 'viem'
import type { Centrifuge } from '../Centrifuge.js'
import type { HexString } from '../types/index.js'
import type { CentrifugeId } from '../utils/types.js'
import { simulateCalls } from '../utils/simulateCalls.js'
import { queryCrosschainMessages, type CrosschainMessage, type CrosschainMessageStatus } from './crosschainMessages.js'
import {
  MigrationSettleError,
  relayedGap,
  replanRefusal,
  scopeBatches,
  settled,
  settleRun,
  splitBatch,
  unwrapExecutePayload,
  type SettleBatch,
  type SettleContext,
  type SettleDriver,
  type SettleReport,
} from './MigrationSettle.js'
import type { Pool } from './Pool.js'

export type MigrationSettleOptions = {
  /** Dormant parks, by message hash, to be left in place. */
  acceptedDormant?: HexString[]
}

export type MigrationSettleReport = SettleReport & {
  /** Whether nothing but dead parks (and the accepted dormant ones) is left. */
  settled: boolean
  /** Why the spoke's offboard or onboard input must not be derived again yet, empty when it may be. */
  replanRefusal: string
  /** The `migrationSettle` operations that land, in the order to send them. */
  operations: MigrationSettleOperation[]
}

export type MigrationSettleOperation =
  | { kind: 'retry'; centrifugeId: CentrifugeId; message: HexString }
  | { kind: 'routerBridger'; spokeCentrifugeIds: CentrifugeId[] }

export type RouterBridgerSpoke = {
  centrifugeId: CentrifugeId
  router: HexString | null
  restored: boolean | null
  granted: boolean | null
  state: 'grant' | 'holds' | 'waits' | 'unreadable'
}

const PAUSER_ABI = parseAbi(['function paused() view returns (bool)'])
const RETRY_ACCOUNT = '0x0000000000000000000000000000000000000001' as HexString
const EXECUTED: readonly CrosschainMessageStatus[] = ['Delivered', 'PartiallyFailed', 'Completed']
const PAGE = 1000
const MAX_PAGES = 100

/** @internal */
export function migrationSettleKey(centrifugeId: CentrifugeId, options: MigrationSettleOptions): string {
  return [centrifugeId, options.acceptedDormant?.join(',') ?? ''].join('|')
}

const splits = (payload: HexString) => {
  try {
    splitBatch(payload)
    return true
  } catch {
    return false
  }
}

/**
 * The gateway's view of an indexed payload: the bytes as filed, or less the MultiAdapter's 2-byte session prefix.
 * Exactly one form must split by the message table; both splitting is refused rather than guessed, since the wrong
 * form hashes every message wrong and reads every park as absent.
 * @internal
 */
export function batchOf(rawData: HexString | undefined): SettleBatch | null {
  if (!rawData || rawData === '0x') return null
  const raw = splits(rawData)
  const unwrapped = unwrapExecutePayload(rawData)
  const stripped = unwrapped !== '0x' && splits(unwrapped)
  if (raw && stripped) {
    throw new MigrationSettleError(
      `[GAP] an executed payload splits both as filed and without a session prefix (${rawData.slice(0, 22)}...), so its messages cannot be hashed with confidence`
    )
  }
  if (raw) return { payload: rawData, blockNumber: null }
  if (stripped) return { payload: unwrapped, blockNumber: null }
  return null
}

/** The batches the spoke executed for the pool from its hub, in delivery order, off the indexer's payload rows; null where a payload does not split. */
async function executedBatches(
  root: Centrifuge,
  pool: Pool,
  centrifugeId: CentrifugeId
): Promise<{ batches: (SettleBatch | null)[]; range: string }> {
  const items: CrosschainMessage[] = []
  let after: string | undefined
  let total = 0
  for (let page = 0; ; page++) {
    if (page === MAX_PAGES) {
      throw new MigrationSettleError(
        `[GAP] more than ${MAX_PAGES * PAGE} executed payloads from cid ${pool.centrifugeId} toward cid ${centrifugeId}; the Arm batch may lie past them`
      )
    }
    const result = await firstValueFrom(
      queryCrosschainMessages(root, {
        poolId: pool.id,
        fromCentrifugeId: pool.centrifugeId,
        toCentrifugeId: centrifugeId,
        status: [...EXECUTED],
        limit: PAGE,
        ...(after ? { after } : {}),
      })
    )
    items.push(...result.items)
    total = result.totalCount
    if (!result.pageInfo.hasNextPage || !result.pageInfo.endCursor) break
    after = result.pageInfo.endCursor
  }
  const executed = items
    .filter((payload) => EXECUTED.includes(payload.status))
    .sort(
      (a, b) => (a.deliveredAt ?? a.createdAt).getTime() - (b.deliveredAt ?? b.createdAt).getTime() || a.index - b.index
    )
  return {
    batches: executed.map((payload) => batchOf(payload.rawData)),
    range: `the ${total} executed payloads from cid ${pool.centrifugeId} toward cid ${centrifugeId}`,
  }
}

async function settleDriver(ctx: SettleContext, client: PublicClient, migrationAbi: Abi): Promise<SettleDriver> {
  const gatewayAbi = ABIS_V3_3.Gateway as unknown as Abi
  const retryData = (message: HexString) =>
    encodeFunctionData({ abi: gatewayAbi, functionName: 'retry', args: [ctx.hubCentrifugeId, message] })
  return {
    async paused() {
      const pauser = (await client.readContract({
        address: ctx.gateway,
        abi: gatewayAbi,
        functionName: 'pauser',
      })) as HexString
      if (!pauser || pauser === zeroAddress) return false
      try {
        return Boolean(await client.readContract({ address: pauser, abi: PAUSER_ABI, functionName: 'paused' }))
      } catch (error) {
        throw new MigrationSettleError(
          `the spoke gateway's pauser ${pauser} did not answer paused(): ${(error as Error).message}`
        )
      }
    },
    async failedMessages(hash) {
      return Number(
        await client.readContract({
          address: ctx.gateway,
          abi: gatewayAbi,
          functionName: 'failedMessages',
          args: [ctx.hubCentrifugeId, hash],
        })
      )
    },
    async spokePhase() {
      return Number(
        await client.readContract({
          address: ctx.migration,
          abi: migrationAbi,
          functionName: 'spokePhase',
          args: [ctx.poolId.raw],
        })
      )
    },
    async frozenGeneration() {
      return Number(
        await client.readContract({
          address: ctx.migration,
          abi: migrationAbi,
          functionName: 'frozenGeneration',
          args: [ctx.poolId.raw],
        })
      )
    },
    async retry(message, after) {
      const { results } = await simulateCalls(client, {
        account: RETRY_ACCOUNT,
        calls: [...after, message].map((m) => ({ to: ctx.gateway, data: retryData(m) })),
      })
      const last = results[results.length - 1] as unknown as { status: 'success' | 'failure'; data?: HexString }
      return { ok: last.status === 'success', revert: last.status === 'success' ? '0x' : (last.data ?? '0x') }
    },
  }
}

/** @internal */
export async function deriveMigrationSettle(
  root: Centrifuge,
  pool: Pool,
  centrifugeId: CentrifugeId,
  options: MigrationSettleOptions = {}
): Promise<MigrationSettleReport> {
  if (centrifugeId === pool.centrifugeId) {
    throw new MigrationSettleError(
      'settle reads a remote spoke: a same-chain spoke runs every step inline and parks nothing'
    )
  }
  const [ctx33, client, migration] = await Promise.all([
    firstValueFrom(root.protocolContext({ centrifugeId, protocolVersion: '3.3' })),
    firstValueFrom(root.getClient(centrifugeId)) as Promise<PublicClient>,
    firstValueFrom(pool.migration()),
  ])
  const chain = resolveMigrationChain(centrifugeId, { environment: root.config.environment })
  const ctx: SettleContext = {
    poolId: pool.id,
    hubCentrifugeId: pool.centrifugeId,
    spokeCentrifugeId: centrifugeId,
    gateway: ctx33.gateway as HexString,
    migration: chain.migration as HexString,
    accountingToken: (ctx33 as unknown as { accountingToken?: HexString }).accountingToken ?? null,
  }
  const { batches: found, range } = await executedBatches(root, pool, centrifugeId)
  const batches = scopeBatches(ctx, found, range)
  const relayed =
    migration?.spokes.find((spoke) => spoke.centrifugeId === centrifugeId)?.steps.map((step) => step.payloadHash) ?? []
  const gap = relayedGap(ctx, batches, relayed, range)
  if (gap) throw new MigrationSettleError(gap)
  const report = await settleRun(ctx, batches, await settleDriver(ctx, client, chain.abi as unknown as Abi))
  const accepted = options.acceptedDormant ?? []
  return {
    ...report,
    settled: settled(report, accepted),
    replanRefusal: replanRefusal(report, accepted),
    operations: report.retries.map((k) => ({ kind: 'retry', centrifugeId, message: report.parks[k]!.message.data })),
  }
}

/**
 * After `activate`: each armed spoke's own v3.3 VaultRouter and whether it holds `bridger` on the pool, held per
 * spoke until its restore has landed, since a restore arriving later would overwrite the grant.
 * @internal
 */
export async function routerBridgerState(root: Centrifuge, pool: Pool): Promise<RouterBridgerSpoke[]> {
  const hub = resolveMigrationChain(pool.centrifugeId, { environment: root.config.environment })
  const hubClient = (await firstValueFrom(root.getClient(pool.centrifugeId))) as PublicClient
  const abi = hub.abi as unknown as Abi
  const armed = (await hubClient.readContract({
    address: hub.migration,
    abi,
    functionName: 'armedSpokes',
    args: [pool.id.raw],
  })) as readonly number[]
  return Promise.all(
    armed.map(async (cid) => {
      const centrifugeId = cid as CentrifugeId
      try {
        const [ctx33, client] = await Promise.all([
          firstValueFrom(root.protocolContext({ centrifugeId, protocolVersion: '3.3' })),
          firstValueFrom(root.getClient(centrifugeId)) as Promise<PublicClient>,
        ])
        const chain = resolveMigrationChain(centrifugeId, { environment: root.config.environment })
        const router = (ctx33 as unknown as { vaultRouter?: HexString }).vaultRouter ?? null
        const registry = (ctx33 as unknown as { spokeRegistry?: HexString }).spokeRegistry ?? null
        if (!router || !registry)
          return { centrifugeId, router, restored: null, granted: null, state: 'unreadable' as const }
        const [restored, granted] = await Promise.all([
          client.readContract({
            address: chain.migration,
            abi: chain.abi as unknown as Abi,
            functionName: 'maxReservesRestored',
            args: [pool.id.raw],
          }) as Promise<boolean>,
          client.readContract({
            address: registry,
            abi: ABIS_V3_3.SpokeRegistry as unknown as Abi,
            functionName: 'bridger',
            args: [pool.id.raw, router],
          }) as Promise<boolean>,
        ])
        return {
          centrifugeId,
          router,
          restored,
          granted,
          state: granted ? ('holds' as const) : restored ? ('grant' as const) : ('waits' as const),
        }
      } catch {
        return { centrifugeId, router: null, restored: null, granted: null, state: 'unreadable' as const }
      }
    })
  )
}
