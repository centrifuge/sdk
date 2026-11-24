import type { HexString } from '../types/index.js'
import { parseCanonicalWei } from '../tx/wei.js'

/**
 * The backend tx view — the shape `GET pools/:poolId/tx/:txId` returns and,
 * field for field, the shape each row of `GET pools/:poolId/tx` returns.
 *
 * The two endpoints being field-identical is a backend acceptance criterion
 * rather than a coincidence: they share one projection there, so one type
 * describes both here and `pool.transaction(txId)` and `pool.transactions()`
 * cannot disagree about a transaction.
 *
 * Decoded rather than cast. Two fields would otherwise be quietly wrong:
 * `unsignedTx.value` is a decimal wei STRING on the wire and `BigInt('')` is
 * `0n`, and `status` drives every consumer switch, so an unrecognised value
 * must not arrive as a string that falls through to a default branch.
 */

/**
 * The transaction lifecycle, exactly the backend's `TransactionStatus` enum.
 *
 * Frozen by contract: the Fordefi approval state extends the VIEW with
 * `approvals`, not this vocabulary. {@link backendTxStatus} maps these onto
 * `OperationStatus`; nothing here mixes the two, so the detailed custodial
 * states stay the backend's own concern.
 */
export const BACKEND_TX_STATUSES = [
  'prepared',
  'pending_approval',
  'submitted_for_signing',
  'signed_pending_broadcast',
  'broadcast',
  'confirmed',
  'failed',
  'approval_rejected',
] as const

export type BackendTxStatus = (typeof BACKEND_TX_STATUSES)[number]

/** Which route signs the transaction. */
export const BACKEND_SIGNER_TYPES = ['fordefi', 'wallet_connect'] as const

export type BackendSignerType = (typeof BACKEND_SIGNER_TYPES)[number]

/**
 * One approval collected on a custodial transaction.
 *
 * `userId` is OUR platform user id and is null while the Fordefi identity has
 * not been linked to a platform user — an expected state, not an error. Fordefi
 * user ids and approver emails never cross the boundary, so there is nothing
 * here to map back to a Fordefi account.
 */
export interface BackendTxApprover {
  userId: string | null
  name: string | null
  /** Fordefi's own decision timestamp, verbatim; null when it reported none. */
  decidedAt: string | null
}

/** Approval progress on a custodial transaction, consumed by the status mapping. */
export interface BackendTxApprovals {
  collected: number
  required: number
  approvers: BackendTxApprover[]
}

/** The prepared transaction, as `BackendPrepare` also parses it. */
export interface BackendUnsignedTx {
  to: HexString
  data: HexString
  /** Parsed from the backend's canonical decimal wei string. */
  value: bigint
  chainId: number
}

/** One transaction row, plus the Fordefi `approvals`. */
export interface BackendTxView {
  txId: string
  /** The pool's `PoolId.raw` uint64 as a decimal string, as the backend sends it. */
  poolId: string
  chainId: number
  signerType: BackendSignerType
  /** The `PoolActionName` the row was prepared for. */
  actionType: string
  status: BackendTxStatus
  /** Null on a row the backend recorded without calldata (custodial hand-off). */
  unsignedTx: BackendUnsignedTx | null
  txHash: HexString | null
  /** The human half of dual-channel verification: compared against Fordefi's screen. */
  confirmationCode: string
  identiconSeed: string
  lastError: string | null
  createdAt: string
  updatedAt: string
  /**
   * Null on the wallet route (no custodial quorum exists) and on a Fordefi row
   * before its first observed transition. Never `{ collected: 0, required: 0 }`
   * for those cases — the backend distinguishes them deliberately, so "no
   * quorum" and "a quorum nobody has voted in" stay tellable apart.
   */
  approvals: BackendTxApprovals | null
}

/**
 * One page of the pool transaction list.
 *
 * `nextCursor` is the ONLY forward mechanism this SDK offers, and
 * {@link BackendTxListOptions} has no `offset` on purpose — see that type.
 */
export interface BackendTxPage {
  items: BackendTxView[]
  /**
   * The size of the filtered set: every row the same `status` filter matches,
   * not the page and not the table. Unaffected by `cursor`, so it does not
   * shrink as a caller walks forward.
   */
  total: number
  /** Cursor for the next page, or null when this page is the last. */
  nextCursor: string | null
}

/**
 * Options for `pool.transactions()`.
 *
 * **There is deliberately no `offset`.** The backend serves both `?offset=` and
 * `?cursor=`, and they are not equivalent: `pool_transactions` is written while
 * it is read (prepare inserts at the FRONT of a newest-first list; the Fordefi
 * poller and webhook move rows in and out of a `?status=` filtered set on every
 * transition), and `OFFSET n` means "discard the first n rows of the CURRENT
 * result set". An insert therefore slides every later page back by one, so the
 * last row of page 1 comes back as the first row of page 2; a row leaving a
 * filtered set slides the rest forward, so the row that would have started page
 * 2 is never returned at all. The backend's own suite carries an offset
 * control arm proving both effects are real rather than theoretical.
 *
 * A keyset cursor is immune to both, because the page boundary is a value
 * carried by a row already returned rather than a count of rows. Since this
 * surface exists to track a Fordefi transaction through a human approval quorum
 * — i.e. to read a list precisely while it is being written — offset paging
 * here would skip and repeat exactly the rows a caller is watching. Exposing it
 * as an option would make the unsafe path the default for anyone reaching for
 * the familiar name, so it is not exposed at all.
 */
export interface BackendTxListOptions {
  /** Narrow to one lifecycle status. An unknown value is refused by the backend as 422. */
  status?: BackendTxStatus
  /** Page size. The backend defaults to 50 and caps at 200. */
  limit?: number
  /**
   * A `nextCursor` from a previous page. Opaque: it comes from a response and
   * is never constructed by hand.
   */
  cursor?: string
}

/**
 * A backend tx read returned a body that is not a tx view.
 *
 * Carries the field that failed and the url, so a contract drift is actionable
 * instead of surfacing as a bare `TypeError` from wherever the value was first
 * touched. Deliberately a throw and not a partially-populated row: `status` and
 * `unsignedTx.value` are what consumers branch on and sign against.
 */
export class BackendTxViewError extends Error {
  override name = 'BackendTxViewError'
  readonly url: string

  constructor(url: string, detail: string) {
    super(`Backend transaction view from ${url} is malformed: ${detail}`)
    this.url = url
  }
}

function asRecord(value: unknown, url: string, what: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return raise(url, `${what} is not an object (got ${JSON.stringify(value)})`)
  }
  return value as Record<string, unknown>
}

function raise(url: string, detail: string): never {
  throw new BackendTxViewError(url, detail)
}

function requireString(value: unknown, url: string, field: string): string {
  if (typeof value !== 'string') {
    return raise(url, `\`${field}\` must be a string, got ${JSON.stringify(value)}`)
  }
  return value
}

function requireNullableString(value: unknown, url: string, field: string): string | null {
  if (value === null || value === undefined) {
    return null
  }
  return requireString(value, url, field)
}

function requireInteger(value: unknown, url: string, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return raise(url, `\`${field}\` must be an integer, got ${JSON.stringify(value)}`)
  }
  return value
}

function requireMember<T extends string>(
  value: unknown,
  url: string,
  field: string,
  allowed: readonly T[],
  note: string
): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    return raise(
      url,
      `\`${field}\` must be one of ${allowed.map((v) => `"${v}"`).join(', ')}, got ${JSON.stringify(value)}. ${note}`
    )
  }
  return value as T
}

function decodeUnsignedTx(value: unknown, url: string): BackendUnsignedTx | null {
  if (value === null || value === undefined) {
    return null
  }
  const raw = asRecord(value, url, '`unsignedTx`')
  return {
    to: requireString(raw.to, url, 'unsignedTx.to') as HexString,
    data: requireString(raw.data, url, 'unsignedTx.data') as HexString,
    // Same rule and the same helper as the prepare path: the wire form is a
    // decimal string, and `BigInt('')` is 0n, so a wrong format must fail
    // rather than read back as a plausible amount.
    value: parseCanonicalWei(
      raw.value,
      (quoted) =>
        new BackendTxViewError(
          url,
          `\`unsignedTx.value\` must be a canonical non-negative decimal wei string, got ${quoted}`
        )
    ),
    chainId: requireInteger(raw.chainId, url, 'unsignedTx.chainId'),
  }
}

function decodeApprovals(value: unknown, url: string): BackendTxApprovals | null {
  if (value === null || value === undefined) {
    return null
  }
  const raw = asRecord(value, url, '`approvals`')
  const approvers = raw.approvers
  if (!Array.isArray(approvers)) {
    return raise(url, `\`approvals.approvers\` must be an array, got ${JSON.stringify(approvers)}`)
  }
  return {
    collected: requireInteger(raw.collected, url, 'approvals.collected'),
    required: requireInteger(raw.required, url, 'approvals.required'),
    approvers: approvers.map((entry, index) => {
      const approver = asRecord(entry, url, `\`approvals.approvers[${index}]\``)
      return {
        userId: requireNullableString(approver.userId, url, `approvals.approvers[${index}].userId`),
        name: requireNullableString(approver.name, url, `approvals.approvers[${index}].name`),
        decidedAt: requireNullableString(approver.decidedAt, url, `approvals.approvers[${index}].decidedAt`),
      }
    }),
  }
}

/**
 * Decode one tx view row.
 *
 * @param body - The parsed JSON body (or one item of a list body).
 * @param url - The request it came from, for the error message.
 * @throws {BackendTxViewError} On any field the contract does not allow.
 */
export function decodeBackendTxView(body: unknown, url: string): BackendTxView {
  const raw = asRecord(body, url, 'the response body')
  return {
    txId: requireString(raw.txId, url, 'txId'),
    poolId: requireString(raw.poolId, url, 'poolId'),
    chainId: requireInteger(raw.chainId, url, 'chainId'),
    signerType: requireMember(
      raw.signerType,
      url,
      'signerType',
      BACKEND_SIGNER_TYPES,
      'The route vocabulary is fixed by the backend contract.'
    ),
    actionType: requireString(raw.actionType, url, 'actionType'),
    // Refused rather than passed through. `status` is what every consumer
    // branches on, and an unknown value handed on as a string lands in a
    // default branch that reads as "nothing to do" — a stalled transaction
    // rendered as an idle one. The status MAPPING has the typed
    // `UnknownTxState` for its own purposes; here an unrecognised lifecycle
    // value means the two sides disagree about the contract and must say so.
    status: requireMember(
      raw.status,
      url,
      'status',
      BACKEND_TX_STATUSES,
      'The lifecycle vocabulary is frozen by the backend contract; a new value means the SDK is behind the backend.'
    ),
    unsignedTx: decodeUnsignedTx(raw.unsignedTx, url),
    txHash: requireNullableString(raw.txHash, url, 'txHash') as HexString | null,
    confirmationCode: requireString(raw.confirmationCode, url, 'confirmationCode'),
    identiconSeed: requireString(raw.identiconSeed, url, 'identiconSeed'),
    lastError: requireNullableString(raw.lastError, url, 'lastError'),
    createdAt: requireString(raw.createdAt, url, 'createdAt'),
    updatedAt: requireString(raw.updatedAt, url, 'updatedAt'),
    approvals: decodeApprovals(raw.approvals, url),
  }
}

/**
 * Decode a page of the tx list.
 *
 * `nextCursor` is required to be present (as a string or `null`) rather than
 * treated as optional: a body missing the field entirely would decode as "this
 * is the last page" and silently truncate a caller's walk at page one.
 */
export function decodeBackendTxPage(body: unknown, url: string): BackendTxPage {
  const raw = asRecord(body, url, 'the response body')
  const items = raw.items
  if (!Array.isArray(items)) {
    return raise(url, `\`items\` must be an array, got ${JSON.stringify(items)}`)
  }
  if (!('nextCursor' in raw)) {
    return raise(
      url,
      'the response has no `nextCursor` field. Absent is not the same as null: treating it as null would ' +
        "end a caller's walk at the first page and look like a short list rather than a broken contract."
    )
  }
  return {
    items: items.map((item) => decodeBackendTxView(item, url)),
    total: requireInteger(raw.total, url, 'total'),
    nextCursor: requireNullableString(raw.nextCursor, url, 'nextCursor'),
  }
}
