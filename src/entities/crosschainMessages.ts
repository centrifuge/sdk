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
export type CrosschainInnerMessageStatus = 'Unsent' | 'AwaitingBatchDelivery' | 'Failed' | 'Executed'

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

const BLOCKCHAIN_FRAGMENT = `{ id centrifugeId network }`
const POOL_FRAGMENT = `{ id name }`
const TOKEN_FRAGMENT = `{ name symbol }`
const INNER_MESSAGE_FRAGMENT = `{
  items {
    id
    index
    poolId
    tokenId
    payloadId
    payloadIndex
    fromCentrifugeId
    toCentrifugeId
    messageType
    status
    rawData
    data
    failReason
    createdAt
    executedAt
    executedAtTxHash
  }
}`
const ADAPTER_PARTICIPATIONS_FRAGMENT = `(orderBy: "timestamp", orderDirection: "asc") {
  items {
    centrifugeId
    fromCentrifugeId
    toCentrifugeId
    type
    side
    gasPaid
    timestamp
    transactionHash
    adapter { address name centrifugeId }
  }
}`

const PAYLOAD_BASE_FIELDS = `
  id
  index
  poolId
  tokenId
  fromCentrifugeId
  toCentrifugeId
  status
  rawData
  gasLimit
  gasPrice
  createdAt
  deliveredAt
  completedAt
  createdAtTxHash
  deliveredAtTxHash
`

function payloadSelection(include: CrosschainMessageIncludes) {
  const parts = [PAYLOAD_BASE_FIELDS]
  if (include.pool) parts.push(`pool ${POOL_FRAGMENT}`)
  if (include.token) parts.push(`token ${TOKEN_FRAGMENT}`)
  if (include.blockchains) parts.push(`fromBlockchain ${BLOCKCHAIN_FRAGMENT}`, `toBlockchain ${BLOCKCHAIN_FRAGMENT}`)
  if (include.innerMessages) parts.push(`crosschainMessages ${INNER_MESSAGE_FRAGMENT}`)
  if (include.adapterParticipations) parts.push(`adapterParticipations${ADAPTER_PARTICIPATIONS_FRAGMENT}`)
  return parts.join('\n      ')
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
    gasLimit: raw.gasLimit ? BigInt(raw.gasLimit) : undefined,
    gasPrice: raw.gasPrice ? BigInt(raw.gasPrice) : undefined,
    createdAt: new Date(Number(raw.createdAt)),
    deliveredAt: raw.deliveredAt ? new Date(Number(raw.deliveredAt)) : undefined,
    completedAt: raw.completedAt ? new Date(Number(raw.completedAt)) : undefined,
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
      createdAt: new Date(Number(m.createdAt)),
      executedAt: m.executedAt ? new Date(Number(m.executedAt)) : undefined,
      executedAtTxHash: m.executedAtTxHash ? (m.executedAtTxHash as HexString) : undefined,
    })),
    adapterParticipations: raw.adapterParticipations?.items.map((a) => ({
      centrifugeId: Number(a.centrifugeId) as CentrifugeId,
      fromCentrifugeId: Number(a.fromCentrifugeId) as CentrifugeId,
      toCentrifugeId: Number(a.toCentrifugeId) as CentrifugeId,
      type: a.type,
      side: a.side,
      gasPaid: a.gasPaid ? BigInt(a.gasPaid) : undefined,
      timestamp: new Date(Number(a.timestamp)),
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
    filter.poolId !== undefined ? (typeof filter.poolId === 'bigint' ? filter.poolId : filter.poolId.raw).toString() : '',
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
      ._queryIndexer<{
        crosschainPayloads: {
          totalCount: number
          pageInfo: CrosschainMessagesPageInfo
          items: CrosschainPayloadRaw[]
        }
      }>(
        `query ($filter: CrosschainPayloadFilter, $limit: Int!, $before: String, $after: String) {
          crosschainPayloads(
            where: $filter
            orderBy: "createdAt"
            orderDirection: "desc"
            limit: $limit
            before: $before
            after: $after
          ) {
            totalCount
            pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
            items {
              ${payloadSelection(include)}
            }
          }
        }`,
        { filter: buildWhere(filter), limit, before, after }
      )
      .pipe(
        map(({ crosschainPayloads }) => ({
          items: crosschainPayloads.items.map(toMessage),
          totalCount: crosschainPayloads.totalCount,
          pageInfo: crosschainPayloads.pageInfo,
        }))
      )
  ) as Query<CrosschainMessagesPage>
}

/** @internal */
export function queryCrosschainMessage(
  centrifuge: Centrifuge,
  id: HexString,
  index: number,
  include: CrosschainMessageIncludes = ALL_INCLUDES
): Query<CrosschainMessage | undefined> {
  return centrifuge._query(['crosschainMessage', id, index, Object.keys(include).sort().join('|')], () =>
    centrifuge
      ._queryIndexer<{ crosschainPayload: CrosschainPayloadRaw | null }>(
        `query ($id: String!, $index: Float!) {
          crosschainPayload(id: $id, index: $index) {
            ${payloadSelection(include)}
          }
        }`,
        { id, index }
      )
      .pipe(map(({ crosschainPayload }) => (crosschainPayload ? toMessage(crosschainPayload) : undefined)))
  ) as Query<CrosschainMessage | undefined>
}
