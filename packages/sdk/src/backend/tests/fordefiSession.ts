import { mockBackendTxView } from './mockBackendTxView.js'
import type { BackendTxStatus } from '../txView.js'

/**
 * A recorded Fordefi session: the ordered wire bodies `GET
 * pools/:poolId/tx/:txId` returns as ONE custodial transaction crosses a 2-of-2
 * approval quorum and confirms.
 *
 * Recorded rather than assembled per test so the sequence is a fixture with one
 * definition, and built on {@link mockBackendTxView}, whose field list comes
 * from the backend controller's own `toResponse` — so `approvals` is null (not
 * zeroed) before the first Fordefi transition, `unsignedTx` is null on a
 * custodial row, and `confirmationCode`/`identiconSeed` are present, all as the
 * real producer emits them — a fake built from the shape convenient to assert
 * is a test that cannot fail.
 */

/** The hash the session's transaction gets once it is broadcast. */
export const RECORDED_TX_HASH = `0x${'ab'.repeat(32)}`

export const RECORDED_TX_ID = 'tx-fordefi'

function approvers(collected: number): { userId: string | null; name: string | null; decidedAt: string }[] {
  const roster = [
    { userId: 'user-1', name: 'Ada Lovelace' },
    { userId: null, name: null },
  ]
  return Array.from({ length: collected }, (_, i) => ({
    ...(roster[i] ?? { userId: null, name: null }),
    decidedAt: `2026-09-01T10:0${5 + i}:00.000Z`,
  }))
}

/**
 * One custodial row on the wire.
 *
 * `approvals: null` when no quorum has been observed yet, which is the state
 * the backend sends before the first Fordefi transition — and the case the
 * mapping must not turn into "0 of 0".
 */
export function fordefiTxRow(row: {
  status: BackendTxStatus
  collected?: number
  required?: number
  txHash?: string | null
  lastError?: string | null
}): Record<string, unknown> {
  const body = mockBackendTxView({
    txId: RECORDED_TX_ID,
    signerType: 'fordefi',
    status: row.status,
    unsignedTx: null,
    txHash: row.txHash ?? null,
    approvals:
      row.required === undefined
        ? null
        : { collected: row.collected ?? 0, required: row.required, approvers: approvers(row.collected ?? 0) },
  })
  return row.lastError === undefined ? body : { ...body, lastError: row.lastError }
}

/**
 * Queued -> awaiting (1 of 2) -> approved -> confirmed, the full custodial
 * sequence.
 *
 * No hash until the row is confirmed, so the `approved` step is the
 * hash-less window that maps to `Approved`. The
 * {@link FORDEFI_BROADCAST_SESSION} below is the same session with the
 * broadcast step's hash present, which is where `TransactionPending` comes in.
 */
export const FORDEFI_APPROVAL_SESSION: readonly Record<string, unknown>[] = [
  fordefiTxRow({ status: 'submitted_for_signing' }),
  fordefiTxRow({ status: 'pending_approval', collected: 1, required: 2 }),
  fordefiTxRow({ status: 'signed_pending_broadcast', collected: 2, required: 2 }),
  fordefiTxRow({ status: 'confirmed', collected: 2, required: 2, txHash: RECORDED_TX_HASH }),
]

/** The same session, with the hash appearing while the row is `broadcast`. */
export const FORDEFI_BROADCAST_SESSION: readonly Record<string, unknown>[] = [
  fordefiTxRow({ status: 'signed_pending_broadcast', collected: 2, required: 2 }),
  fordefiTxRow({ status: 'broadcast', collected: 2, required: 2, txHash: RECORDED_TX_HASH }),
  fordefiTxRow({ status: 'confirmed', collected: 2, required: 2, txHash: RECORDED_TX_HASH }),
]

/** An approver declined. Terminal, and not an error. */
export const FORDEFI_REJECTED_SESSION: readonly Record<string, unknown>[] = [
  fordefiTxRow({ status: 'pending_approval', collected: 0, required: 2 }),
  fordefiTxRow({ status: 'approval_rejected', collected: 0, required: 2 }),
]

/**
 * A fake session that replays recorded bodies for one transaction.
 *
 * Each `GET .../tx/:txId` returns the next recorded body and then HOLDS on the
 * last one, which is what a real poll sees: the row stops moving and the same
 * state comes back over and over. Every reply carries a FRESH `updatedAt`, as
 * the backend's Fordefi poller produces (it touches the row on every check),
 * so a de-duplication that keyed on the row rather than on the lifecycle would
 * emit once per poll and the sequence assertions would catch it.
 */
export function recordedSessionTransport(options: {
  baseUrl: string
  poolId: string
  txId?: string
  bodies: readonly unknown[]
  poolsBody: unknown
}): { fetch: typeof fetch; urls: string[]; polls: () => number } {
  const txId = options.txId ?? RECORDED_TX_ID
  const urls: string[] = []
  let step = 0
  let touched = 0

  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    urls.push(url)
    const path = url.replace(options.baseUrl, '').split('?')[0]!
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

    if (path === '/pools') {
      return json(options.poolsBody)
    }
    if (path === `/pools/${options.poolId}/tx/${txId}`) {
      const body = options.bodies[Math.min(step, options.bodies.length - 1)]
      step += 1
      touched += 1
      const tick = String(touched).padStart(3, '0')
      return json({ ...(body as Record<string, unknown>), updatedAt: `2026-09-01T10:00:00.${tick}Z` })
    }
    return json({ error: 'not_found', code: 'NO_FAKE_ROUTE', path, method: init.method ?? 'GET' }, 404)
  }) as unknown as typeof fetch

  return { fetch: fetchImpl, urls, polls: () => touched }
}
