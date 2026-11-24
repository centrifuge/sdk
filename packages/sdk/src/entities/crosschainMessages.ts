import { map } from 'rxjs'
import type { Centrifuge } from '../Centrifuge.js'
import type { HexString } from '../types/index.js'
import type { Query } from '../types/query.js'
import type { CentrifugeId, PoolId } from '../utils/types.js'

/**
 * Status of a cross-chain message envelope (indexer-side `CrosschainPayload`).
 *
 * - `Underpaid` — gas paid was less than required; awaiting top-up.
 * - `InTransit` — sent from the origin, not yet delivered on the destination.
 * - `Delivered` — handled on the destination; may still be awaiting follow-up.
 * - `PartiallyFailed` — at least one inner message failed.
 * - `Completed` — fully processed end-to-end.
 */
export type CrosschainMessageStatus = 'Underpaid' | 'InTransit' | 'Delivered' | 'PartiallyFailed' | 'Completed'

/**
 * Status of an inner cross-chain message (one of the messages bundled inside
 * a `CrosschainMessage` envelope).
 */
export type CrosschainInnerMessageStatus = 'Unsent' | 'AwaitingBatchDelivery' | 'Failed' | 'Executed' | 'Cleared'

export type AdapterParticipationType = 'PAYLOAD' | 'PROOF'
export type AdapterParticipationSide = 'SEND' | 'HANDLE'

export type CrosschainBlockchainRef = {
  id: string
  centrifugeId: CentrifugeId
  network: string
}

export type CrosschainPoolRef = {
  id: string
  name: string | undefined
}

export type CrosschainTokenRef = {
  name: string | undefined
  symbol: string | undefined
}

export type CrosschainAdapterRef = {
  address: HexString
  name: string
  centrifugeId: CentrifugeId
}

export type CrosschainInnerMessage = {
  id: HexString
  index: number
  poolId: string | null
  tokenId: string | null
  payloadId: HexString
  payloadIndex: number
  fromCentrifugeId: CentrifugeId
  toCentrifugeId: CentrifugeId
  messageType: string
  status: CrosschainInnerMessageStatus
  rawData: HexString | undefined
  data: unknown
  failReason: string | undefined
  createdAt: Date
  executedAt: Date | undefined
  executedAtTxHash: HexString | undefined
}

export type AdapterParticipation = {
  centrifugeId: CentrifugeId
  fromCentrifugeId: CentrifugeId
  toCentrifugeId: CentrifugeId
  type: AdapterParticipationType
  side: AdapterParticipationSide
  gasPaid: bigint | undefined
  timestamp: Date
  transactionHash: HexString
  adapter?: CrosschainAdapterRef
}

/**
 * Optional joined data on a cross-chain message. Each field is `undefined`
 * unless the corresponding flag is set on the request's `include` option.
 *
 * Single-message reads (`centrifuge.crosschainMessage(id, index)`) request
 * every join by default since the page renders one row.
 */
export type CrosschainMessageIncludes = {
  pool?: boolean
  token?: boolean
  blockchains?: boolean
  innerMessages?: boolean
  adapterParticipations?: boolean
}

export type CrosschainMessage = {
  id: HexString
  index: number
  poolId: string | null
  tokenId: string | null
  fromCentrifugeId: CentrifugeId
  toCentrifugeId: CentrifugeId
  status: CrosschainMessageStatus
  rawData: HexString | undefined
  gasLimit: bigint | undefined
  gasPrice: bigint | undefined
  createdAt: Date
  deliveredAt: Date | undefined
  completedAt: Date | undefined
  createdAtTxHash: HexString | undefined
  deliveredAtTxHash: HexString | undefined
  pool: CrosschainPoolRef | undefined
  token: CrosschainTokenRef | undefined
  fromBlockchain: CrosschainBlockchainRef | undefined
  toBlockchain: CrosschainBlockchainRef | undefined
  innerMessages: CrosschainInnerMessage[] | undefined
  adapterParticipations: AdapterParticipation[] | undefined
}

export type CrosschainMessagesPageInfo = {
  hasNextPage: boolean
  hasPreviousPage: boolean
  startCursor: string | null
  endCursor: string | null
}

export type CrosschainMessagesPage = {
  items: CrosschainMessage[]
  totalCount: number
  pageInfo: CrosschainMessagesPageInfo
}

export type CrosschainMessagesFilter = {
  poolId?: PoolId | bigint
  fromCentrifugeId?: CentrifugeId
  toCentrifugeId?: CentrifugeId
  status?: CrosschainMessageStatus | CrosschainMessageStatus[]
  /** Match all payloads emitted by the same source transaction (batch). */
  createdAtTxHash?: HexString
  limit?: number
  before?: string
  after?: string
  include?: CrosschainMessageIncludes
}

const ALL_INCLUDES: Required<CrosschainMessageIncludes> = {
  pool: true,
  token: true,
  blockchains: true,
  innerMessages: true,
  adapterParticipations: true,
}


type CrosschainPayloadRaw = {
  id: string
  index: number
  poolId: string | null
  tokenId: string | null
  fromCentrifugeId: string
  toCentrifugeId: string
  status: CrosschainMessageStatus
  rawData: string | null
  gasLimit: string | null
  gasPrice: string | null
  createdAt: string
  deliveredAt: string | null
  completedAt: string | null
  createdAtTxHash: string | null
  deliveredAtTxHash: string | null
  pool?: { id: string; name: string | null } | null
  token?: { name: string | null; symbol: string | null } | null
  fromBlockchain?: { id: string; centrifugeId: string; network: string } | null
  toBlockchain?: { id: string; centrifugeId: string; network: string } | null
  crosschainMessages?: {
    items: {
      id: string
      index: number
      poolId: string | null
      tokenId: string | null
      payloadId: string
      payloadIndex: number
      fromCentrifugeId: string
      toCentrifugeId: string
      messageType: string
      status: CrosschainInnerMessageStatus
      rawData: string | null
      data: unknown
      failReason: string | null
      createdAt: string
      executedAt: string | null
      executedAtTxHash: string | null
    }[]
  }
  adapterParticipations?: {
    items: {
      centrifugeId: string
      fromCentrifugeId: string
      toCentrifugeId: string
      type: AdapterParticipationType
      side: AdapterParticipationSide
      gasPaid: string | null
      timestamp: string
      transactionHash: string
      adapter: { address: string; name: string; centrifugeId: string } | null
    }[]
  }
}

function toBlockchainRef(b: CrosschainPayloadRaw['fromBlockchain']): CrosschainBlockchainRef | undefined {
  if (!b) return undefined
  return { id: b.id, centrifugeId: Number(b.centrifugeId) as CentrifugeId, network: b.network }
}

/**
 * Parse a crosschain timestamp from either wire format the two data sources
 * produce, and throw on anything else.
 *
 * The two sources spell the column differently: api-v3 (Ponder) serves epoch
 * MILLISECONDS as a decimal string (`'1773411360000'`), the backend serves
 * ISO-8601 UTC — the wire convention every entry in the `@centrifuge/queries`
 * catalogue follows. A bare `new Date(Number(value))` is correct for exactly
 * one of them: `Number('2026-02-01T00:00:00.000Z')` is `NaN`, which turns
 * every date on every message into `Invalid Date`.
 *
 * Both formats are accepted because both sources are in the tree (the api-v3
 * documents live in `packages/queries/src/graphql/api-v3.ts`), and they are
 * unambiguous: an epoch-millis string is all digits and an ISO-8601 string
 * never is.
 *
 * An unparseable value THROWS rather than returning `Invalid Date`. A thrown
 * error names the field and the value; an `Invalid Date` renders as
 * "Invalid Date" in a table cell and is indistinguishable from a projection
 * that has no timestamp yet.
 */
function toCrosschainDate(value: string, field: string): Date {
  const parsed = /^\d+$/.test(value) ? new Date(Number(value)) : new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(
      `Cannot read crosschain message field \`${field}\`: ${JSON.stringify(value)} is neither an ` +
        `ISO-8601 timestamp (what the backend serves) nor a decimal epoch-millisecond string (what ` +
        `api-v3 served).`
    )
  }
  return parsed
}

/** {@link toCrosschainDate} for a nullable column. */
function toOptionalCrosschainDate(value: string | null, field: string): Date | undefined {
  return value ? toCrosschainDate(value, field) : undefined
}

function toMessage(raw: CrosschainPayloadRaw): CrosschainMessage {
  return {
    id: raw.id as HexString,
    index: raw.index,
    poolId: raw.poolId,
    tokenId: raw.tokenId,
    fromCentrifugeId: Number(raw.fromCentrifugeId) as CentrifugeId,
    toCentrifugeId: Number(raw.toCentrifugeId) as CentrifugeId,
    status: raw.status,
    rawData: raw.rawData ? (raw.rawData as HexString) : undefined,
    // Gas quantities stay raw bigints: `Balance`/`Price`/`Rate` model pool- and asset-denominated
    // amounts with decimals, and gas units and wei-per-gas are neither. Wrapping them would invent a
    // currency for them; callers format them with viem's own gas helpers instead.
    gasLimit: raw.gasLimit ? BigInt(raw.gasLimit) : undefined,
    gasPrice: raw.gasPrice ? BigInt(raw.gasPrice) : undefined,
    createdAt: toCrosschainDate(raw.createdAt, 'createdAt'),
    deliveredAt: toOptionalCrosschainDate(raw.deliveredAt, 'deliveredAt'),
    completedAt: toOptionalCrosschainDate(raw.completedAt, 'completedAt'),
    createdAtTxHash: raw.createdAtTxHash ? (raw.createdAtTxHash as HexString) : undefined,
    deliveredAtTxHash: raw.deliveredAtTxHash ? (raw.deliveredAtTxHash as HexString) : undefined,
    pool: raw.pool ? { id: raw.pool.id, name: raw.pool.name ?? undefined } : undefined,
    token: raw.token ? { name: raw.token.name ?? undefined, symbol: raw.token.symbol ?? undefined } : undefined,
    fromBlockchain: toBlockchainRef(raw.fromBlockchain),
    toBlockchain: toBlockchainRef(raw.toBlockchain),
    innerMessages: raw.crosschainMessages?.items.map((m) => ({
      id: m.id as HexString,
      index: m.index,
      poolId: m.poolId,
      tokenId: m.tokenId,
      payloadId: m.payloadId as HexString,
      payloadIndex: m.payloadIndex,
      fromCentrifugeId: Number(m.fromCentrifugeId) as CentrifugeId,
      toCentrifugeId: Number(m.toCentrifugeId) as CentrifugeId,
      messageType: m.messageType,
      status: m.status,
      rawData: m.rawData ? (m.rawData as HexString) : undefined,
      data: m.data,
      failReason: m.failReason ?? undefined,
      createdAt: toCrosschainDate(m.createdAt, 'innerMessages[].createdAt'),
      executedAt: toOptionalCrosschainDate(m.executedAt, 'innerMessages[].executedAt'),
      executedAtTxHash: m.executedAtTxHash ? (m.executedAtTxHash as HexString) : undefined,
    })),
    adapterParticipations: raw.adapterParticipations?.items.map((a) => ({
      centrifugeId: Number(a.centrifugeId) as CentrifugeId,
      fromCentrifugeId: Number(a.fromCentrifugeId) as CentrifugeId,
      toCentrifugeId: Number(a.toCentrifugeId) as CentrifugeId,
      type: a.type,
      side: a.side,
      // Native-token wei paid for delivery — see the gas note in `toMessage`.
      gasPaid: a.gasPaid ? BigInt(a.gasPaid) : undefined,
      timestamp: toCrosschainDate(a.timestamp, 'adapterParticipations[].timestamp'),
      transactionHash: a.transactionHash as HexString,
      adapter: a.adapter
        ? {
            address: a.adapter.address as HexString,
            name: a.adapter.name,
            centrifugeId: Number(a.adapter.centrifugeId) as CentrifugeId,
          }
        : undefined,
    })),
  }
}

function buildWhere(filter: CrosschainMessagesFilter) {
  const { poolId, fromCentrifugeId, toCentrifugeId, status, createdAtTxHash } = filter
  return {
    ...(poolId !== undefined ? { poolId: (typeof poolId === 'bigint' ? poolId : poolId.raw).toString() } : {}),
    ...(fromCentrifugeId !== undefined ? { fromCentrifugeId: String(fromCentrifugeId) } : {}),
    ...(toCentrifugeId !== undefined ? { toCentrifugeId: String(toCentrifugeId) } : {}),
    ...(Array.isArray(status) ? { status_in: status } : status ? { status } : {}),
    ...(createdAtTxHash ? { createdAtTxHash } : {}),
  }
}

function filterCacheKey(filter: CrosschainMessagesFilter) {
  const includeKey = Object.entries(filter.include ?? {})
    .filter(([, v]) => v)
    .map(([k]) => k)
    .sort()
    .join('|')
  return [
    'crosschainMessages',
    filter.poolId !== undefined
      ? (typeof filter.poolId === 'bigint' ? filter.poolId : filter.poolId.raw).toString()
      : '',
    filter.fromCentrifugeId,
    filter.toCentrifugeId,
    Array.isArray(filter.status) ? filter.status.join(',') : (filter.status ?? ''),
    filter.createdAtTxHash ?? '',
    filter.limit ?? '',
    filter.before ?? '',
    filter.after ?? '',
    includeKey,
  ]
}

/** @internal */
export function queryCrosschainMessages(
  centrifuge: Centrifuge,
  filter: CrosschainMessagesFilter
): Query<CrosschainMessagesPage> {
  const { limit = 100, before, after, include = {} } = filter
  return centrifuge._query(filterCacheKey(filter), () =>
    centrifuge
      ._queryData<{
        totalCount: number
        pageInfo: CrosschainMessagesPageInfo
        items: CrosschainPayloadRaw[]
      }>('crosschainMessages', {
        filter: buildWhere(filter),
        limit,
        ...(before !== undefined ? { before } : {}),
        ...(after !== undefined ? { after } : {}),
        include,
      })
      .pipe(
        map((crosschainPayloads) => ({
          items: crosschainPayloads.items.map(toMessage),
          totalCount: crosschainPayloads.totalCount,
          pageInfo: crosschainPayloads.pageInfo,
        }))
      )
  ) as Query<CrosschainMessagesPage>
}

/**
 * @internal
 *
 * `poolId` is optional here and REQUIRED by the backend route: `GET
 * /pools/:poolId/crosschain-messages/:id` is gated `@PoolMembers()` on the pool
 * in its path, so there is no unscoped endpoint to read a payload from. It is
 * part of the CACHE KEY rather than only of the request, because the same
 * `(id, index)` read scoped to a pool and read unscoped are two different
 * queries — one of which can 404 where the other does not — and sharing a cache
 * entry between them would serve one caller the other's answer.
 */
export function queryCrosschainMessage(
  centrifuge: Centrifuge,
  id: HexString,
  index: number,
  include: CrosschainMessageIncludes = ALL_INCLUDES,
  poolId?: PoolId | bigint
): Query<CrosschainMessage | undefined> {
  const scope = poolId === undefined ? undefined : (typeof poolId === 'bigint' ? poolId : poolId.raw).toString()
  return centrifuge._query(
    ['crosschainMessage', id, index, Object.keys(include).sort().join('|'), scope ?? ''],
    () =>
      centrifuge
        ._queryData<CrosschainPayloadRaw | null>('crosschainMessage', {
          id,
          index,
          include,
          ...(scope !== undefined ? { poolId: scope } : {}),
        })
        .pipe(map((crosschainPayload) => (crosschainPayload ? toMessage(crosschainPayload) : undefined)))
  ) as Query<CrosschainMessage | undefined>
}
