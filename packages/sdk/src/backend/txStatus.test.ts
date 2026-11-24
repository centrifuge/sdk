import { expect } from 'chai'
import { firstValueFrom, takeUntil, timeout, timer, toArray, type Observable } from 'rxjs'
import { Centrifuge } from '../Centrifuge.js'
import type { OperationStatus, OperationStatusType } from '../types/transaction.js'
import { PoolId } from '../utils/types.js'
import { createBackendCentrifuge } from './BackendCentrifuge.js'
import { BackendPool } from './BackendPool.js'
import type { BackendTxReads } from './BackendTxReads.js'
import {
  FORDEFI_APPROVAL_SESSION,
  FORDEFI_BROADCAST_SESSION,
  FORDEFI_REJECTED_SESSION,
  fordefiTxRow,
  recordedSessionTransport,
  RECORDED_TX_HASH,
  RECORDED_TX_ID,
} from './tests/fordefiSession.js'
import { mockBackendTxView } from './tests/mockBackendTxView.js'
import {
  BACKEND_TX_STATUS_PHASES,
  BackendTxFailedError,
  backendTxStatus,
  isBackendTxStatus,
  trackedTxStatusKey,
  type BackendTxStatusInput,
  type TrackedTxStatus,
} from './txStatus.js'
import { BACKEND_TX_STATUSES, decodeBackendTxView, type BackendTxStatus, type BackendTxView } from './txView.js'

const BASE_URL = 'https://backend.test/api'
const POOL_ID = new PoolId(281474976710657n)
const POOLS_BODY = [{ id: POOL_ID.raw.toString(), protocolVersion: '3.2', migrationStatus: 'live' }]

/**
 * A row as the mapper receives it in production: decoded by
 * `decodeBackendTxView` from a wire body built from the backend controller's
 * own field list. Going through the decoder rather than hand-building a
 * `BackendTxView` is deliberate — a fixture that satisfied the parsed type by
 * construction would agree with the decoder instead of being checked by it.
 */
function row(overrides: Parameters<typeof fordefiTxRow>[0]): BackendTxView {
  return decodeBackendTxView(fordefiTxRow(overrides), 'fixture')
}

/**
 * Every discriminant the mapping can emit.
 *
 * Typed as `OperationStatusType[]`, which is the compile-time link between the
 * mapping and the root's status vocabulary: a discriminant emitted here that
 * `OperationStatusType` does not list is a type error on this line.
 */
const EMITTED_TYPES: OperationStatusType[] = [
  'Queued',
  'AwaitingApprovals',
  'Approved',
  'Rejected',
  'TransactionPending',
  'Confirmed',
  'UnknownTxState',
]

describe('custodial lifecycle mapping: the table', () => {
  it('maps every backend row state, and only those', () => {
    // The table as shipped, spelled out rather than derived, so this test
    // disagrees with the implementation if either one changes alone.
    expect(BACKEND_TX_STATUS_PHASES).to.deep.equal({
      prepared: 'queued',
      submitted_for_signing: 'queued',
      pending_approval: 'awaiting-approvals',
      signed_pending_broadcast: 'approved',
      broadcast: 'approved',
      confirmed: 'confirmed',
      approval_rejected: 'rejected',
      failed: 'failed',
    })
    // And the keys ARE the vocabulary, from the vocabulary's own definition.
    // The compile-time half of this (a `Record<BackendTxStatus, …>` cannot be
    // short a key) is what actually gates a new backend state; this is the
    // runtime witness that the two lists are the same list.
    expect(Object.keys(BACKEND_TX_STATUS_PHASES).sort()).to.deep.equal([...BACKEND_TX_STATUSES].sort())
  })

  it('recognises exactly the vocabulary, so the guard and the table cannot disagree', () => {
    for (const status of BACKEND_TX_STATUSES) {
      expect(isBackendTxStatus(status), status).to.equal(true)
    }
    for (const notAStatus of ['', 'Prepared', 'awaiting_moon_phase', 'confirmed ']) {
      expect(isBackendTxStatus(notAStatus), notAStatus).to.equal(false)
    }
  })

  it('emits only statuses the root vocabulary lists, and only OperationStatus values', () => {
    const emitted: TrackedTxStatus[] = []
    for (const status of BACKEND_TX_STATUSES) {
      if (BACKEND_TX_STATUS_PHASES[status] === 'failed') continue
      emitted.push(backendTxStatus(row({ status, collected: 1, required: 2, txHash: RECORDED_TX_HASH })))
    }
    for (const status of emitted) {
      expect(EMITTED_TYPES).to.include(status.type)
    }
    // Additive, at the type level: every tracked status is an OperationStatus,
    // so an app renders a custodial transaction with the switch it already has.
    const asOperationStatuses: OperationStatus[] = emitted
    expect(asOperationStatuses).to.have.length(BACKEND_TX_STATUSES.length - 1)
  })
})

describe('custodial lifecycle mapping: state by state', () => {
  it('maps prepared and submitted_for_signing to Queued, echoing which one it was', () => {
    for (const status of ['prepared', 'submitted_for_signing'] as const) {
      const mapped = backendTxStatus(row({ status }))
      expect(mapped.type).to.equal('Queued')
      // The echo is not decoration: without it `Queued` from a backend row the
      // user has not seen yet and `Queued` from a request Fordefi is holding
      // are the same value, and only one of them means "ask an approver".
      expect(mapped).to.deep.equal({
        id: RECORDED_TX_ID,
        type: 'Queued',
        title: 'updatePoolMetadata',
        txId: RECORDED_TX_ID,
        backendStatus: status,
      })
    }
  })

  it('maps pending_approval with counts to AwaitingApprovals', () => {
    const mapped = backendTxStatus(row({ status: 'pending_approval', collected: 1, required: 2 }))
    expect(mapped).to.deep.equal({
      id: RECORDED_TX_ID,
      type: 'AwaitingApprovals',
      title: 'updatePoolMetadata',
      txId: RECORDED_TX_ID,
      collected: 1,
      required: 2,
      backendStatus: 'pending_approval',
    })
  })

  it('does NOT invent a quorum when pending_approval carries no approvals', () => {
    // The backend sends `approvals: null` before the first Fordefi transition, and
    // distinguishes it from `{ collected: 0, required: 0 }` on purpose. "0 of
    // 0" or "0 of 2" here would be a number no part of the system stated,
    // rendered to a user as fact — so the honest mapping is Queued.
    const mapped = backendTxStatus(row({ status: 'pending_approval' }))
    expect(mapped.type).to.equal('Queued')
    expect(mapped).to.not.have.property('collected')
    expect(mapped).to.not.have.property('required')
  })

  it('maps the two broadcast states to Approved while there is no hash', () => {
    for (const status of ['signed_pending_broadcast', 'broadcast'] as const) {
      const mapped = backendTxStatus(row({ status, collected: 2, required: 2 }))
      expect(mapped.type, status).to.equal('Approved')
      expect(mapped).to.not.have.property('hash')
    }
  })

  it('moves to TransactionPending as soon as a hash exists', () => {
    for (const status of ['signed_pending_broadcast', 'broadcast'] as const) {
      const mapped = backendTxStatus(row({ status, collected: 2, required: 2, txHash: RECORDED_TX_HASH }))
      // The EXISTING pending status, reused: an app's block-explorer link and
      // spinner work for a custodial transaction with no new branch.
      expect(mapped).to.deep.equal({
        id: RECORDED_TX_ID,
        type: 'TransactionPending',
        title: 'updatePoolMetadata',
        hash: RECORDED_TX_HASH,
      })
    }
  })

  it('maps confirmed to Confirmed with the hash, and never to TransactionConfirmed', () => {
    const mapped = backendTxStatus(row({ status: 'confirmed', collected: 2, required: 2, txHash: RECORDED_TX_HASH }))
    expect(mapped).to.deep.equal({
      id: RECORDED_TX_ID,
      type: 'Confirmed',
      title: 'updatePoolMetadata',
      txId: RECORDED_TX_ID,
      hash: RECORDED_TX_HASH,
      backendStatus: 'confirmed',
    })
    // `TransactionConfirmed` promises a `receipt: TransactionReceipt` and the
    // tx view carries none. Emitting it would mean synthesising a receipt, and
    // widening the field to optional would break every existing
    // `status.receipt.…` narrowing, which this mapping must not cause.
    expect(mapped.type).to.not.equal('TransactionConfirmed')
    expect(mapped).to.not.have.property('receipt')
  })

  it('reports a confirmed row with no hash as unknown rather than downgrading it', () => {
    const mapped = backendTxStatus(row({ status: 'confirmed', collected: 2, required: 2 }))
    expect(mapped.type).to.equal('UnknownTxState')
    expect(mapped).to.have.property('reason').that.contains('no `txHash`')
    expect((mapped as { backendStatus: string }).backendStatus).to.equal('confirmed')
  })

  it('maps approval_rejected to Rejected, which is a value and not an error', () => {
    const mapped = backendTxStatus(row({ status: 'approval_rejected', collected: 0, required: 2 }))
    expect(mapped.type).to.equal('Rejected')
    expect((mapped as { backendStatus: string }).backendStatus).to.equal('approval_rejected')
  })

  it('raises failed as an error, carrying the backend reason', () => {
    let error: any
    try {
      backendTxStatus(row({ status: 'failed', lastError: 'execution reverted: NotAuthorized' }))
    } catch (e) {
      error = e
    }
    expect(error).to.be.instanceOf(BackendTxFailedError)
    expect(error.txId).to.equal(RECORDED_TX_ID)
    expect(error.actionType).to.equal('updatePoolMetadata')
    expect(error.lastError).to.equal('execution reverted: NotAuthorized')
    expect(error.message).to.contain('NotAuthorized')

    // A row the backend failed without a reason still names the transaction
    // rather than reading as an empty message.
    let bare: any
    try {
      backendTxStatus(row({ status: 'failed' }))
    } catch (e) {
      bare = e
    }
    expect(bare.message).to.contain('recorded no reason')

    // And a caller mapping a LIST — where one dead row must not take out the
    // page — can tell before calling, with the same table.
    expect(BACKEND_TX_STATUS_PHASES.failed).to.equal('failed')
  })
})

describe('UnknownTxState: a value, not a throw', () => {
  it('returns a typed status for a row state this SDK version has never heard of', () => {
    // Reachable without a cast: `BackendTxStatusInput.status` accepts a string
    // on purpose, because a defensive branch that can only be entered by lying
    // to the compiler is a branch nobody can test honestly.
    const unknown: BackendTxStatusInput = {
      txId: 'tx-future',
      actionType: 'updatePoolMetadata',
      status: 'awaiting_moon_phase',
      txHash: null,
      approvals: null,
      lastError: null,
    }

    const mapped = backendTxStatus(unknown)

    expect(mapped.type).to.equal('UnknownTxState')
    expect(mapped).to.deep.equal({
      id: 'tx-future',
      type: 'UnknownTxState',
      title: 'updatePoolMetadata',
      txId: 'tx-future',
      backendStatus: 'awaiting_moon_phase',
      reason:
        '`awaiting_moon_phase` is not a transaction state this SDK version knows. The SDK is behind the ' +
        'backend; the transaction itself is not necessarily in trouble.',
    })
  })

  it('does not soften the DECODER: it still refuses the same value', () => {
    // The two halves are deliberately different. A wire body with an
    // unrecognised `status` is a contract disagreement and fails loudly at the
    // parse; the MAPPING is what must not throw, because it is what a poll
    // runs. Relaxing the parse instead would put an unknown string into every
    // consumer's default branch, where a stalled transaction renders as idle.
    expect(() => decodeBackendTxView({ ...mockBackendTxView(), status: 'awaiting_moon_phase' }, 'u')).to.throw(
      /`status` must be one of/
    )
  })

  it('keeps a polling surface alive across an unrecognised state', async () => {
    // The property that matters: an unknown state must not end the
    // subscription that was watching the transaction.
    //
    // The rows are injected below the decoder, and they have to be: the parse
    // refuses an unrecognised `status`, so no HTTP body can carry one this far.
    // The rows themselves are real wire rows (the controller's own field list,
    // via `mockBackendTxView`); only the nominal `BackendTxReads` type is
    // bypassed, which is what the cast is for.
    const rows: BackendTxView[] = [
      {
        ...row({ status: 'pending_approval', collected: 1, required: 2 }),
        status: 'awaiting_moon_phase' as BackendTxStatus,
      },
      row({ status: 'pending_approval', collected: 1, required: 2 }),
      row({ status: 'confirmed', collected: 2, required: 2, txHash: RECORDED_TX_HASH }),
    ]
    let step = 0
    const reads = {
      get: async () => rows[Math.min(step++, rows.length - 1)]!,
      list: async () => ({ items: rows, total: rows.length, nextCursor: null }),
    } as unknown as BackendTxReads

    const centrifuge = new Centrifuge({ environment: 'testnet', cache: false })
    const pool = new BackendPool(centrifuge, POOL_ID, reads, 5)

    const statuses = await collect(pool.transactionStatus(RECORDED_TX_ID), 300)

    expect(statuses.map((s) => s.type)).to.deep.equal(['UnknownTxState', 'AwaitingApprovals', 'Confirmed'])
    // The subscription outlived the unknown state and went on to see the
    // transaction confirm — which is the whole reason this is a value.
    expect(statuses[0]).to.have.property('backendStatus', 'awaiting_moon_phase')
  })
})

describe('recorded session through pool.transactionStatus', () => {
  function session(bodies: readonly unknown[]) {
    const transport = recordedSessionTransport({
      baseUrl: BASE_URL,
      poolId: POOL_ID.raw.toString(),
      bodies,
      poolsBody: POOLS_BODY,
    })
    const centrifuge = createBackendCentrifuge(
      { environment: 'testnet', baseUrl: BASE_URL, txPollingInterval: 5, cache: false },
      // A stub the transport contract requires and this surface never calls;
      // only the invalidation stream opens one.
      { fetch: transport.fetch, eventSource: () => ({}) as EventSource }
    )
    return { transport, centrifuge }
  }

  it('emits queued -> awaiting (1 of 2) -> approved -> confirmed, once each', async () => {
    const { transport, centrifuge } = session(FORDEFI_APPROVAL_SESSION)
    const pool = await centrifuge.pool(POOL_ID)

    const statuses = await collect(pool.transactionStatus(RECORDED_TX_ID), 300)

    expect(statuses.map((s) => s.type)).to.deep.equal(['Queued', 'AwaitingApprovals', 'Approved', 'Confirmed'])
    expect(statuses[0]).to.have.property('backendStatus', 'submitted_for_signing')
    expect(statuses[1]).to.deep.include({ collected: 1, required: 2 })
    expect(statuses[2]).to.have.property('backendStatus', 'signed_pending_broadcast')
    expect(statuses[3]).to.have.property('hash', RECORDED_TX_HASH)

    // ONCE each, over many more polls than emissions: the row stops moving
    // while an approver is being waited on, and every reply carries a fresh
    // `updatedAt` (the Fordefi poller touches the row on every check). A
    // surface that emitted per fetch would report the same state dozens of
    // times, and anything reacting to a change would fire on each one.
    expect(transport.polls()).to.be.greaterThan(statuses.length)
  })

  it('reads the same rows pool.transaction serves, not a second endpoint', async () => {
    // `transactionStatus` is built ON `transaction`, so the row and the status
    // cannot disagree about a transaction and there is one poll, not two.
    const { transport, centrifuge } = session(FORDEFI_APPROVAL_SESSION)
    const pool = await centrifuge.pool(POOL_ID)

    await collect(pool.transactionStatus(RECORDED_TX_ID), 120)

    const paths = new Set(transport.urls.map((url) => url.replace(BASE_URL, '').split('?')[0]))
    expect([...paths].sort()).to.deep.equal(['/pools', `/pools/${POOL_ID.raw}/tx/${RECORDED_TX_ID}`])
  })

  it('shows the hash the moment it appears, then the confirmation', async () => {
    const { centrifuge } = session(FORDEFI_BROADCAST_SESSION)
    const pool = await centrifuge.pool(POOL_ID)

    const statuses = await collect(pool.transactionStatus(RECORDED_TX_ID), 300)

    expect(statuses.map((s) => s.type)).to.deep.equal(['Approved', 'TransactionPending', 'Confirmed'])
    expect(statuses[1]).to.have.property('hash', RECORDED_TX_HASH)
  })

  it('ends on Rejected as a value, with the subscription still healthy', async () => {
    const { centrifuge } = session(FORDEFI_REJECTED_SESSION)
    const pool = await centrifuge.pool(POOL_ID)

    const statuses = await collect(pool.transactionStatus(RECORDED_TX_ID), 200)

    expect(statuses.map((s) => s.type)).to.deep.equal(['AwaitingApprovals', 'Rejected'])
    // A declined approval is a decision, not a malfunction: the stream carries
    // it and completes normally rather than erroring.
    expect(statuses[1]).to.have.property('backendStatus', 'approval_rejected')
  })

  it('errors the observable when the row reaches failed', async () => {
    const { centrifuge } = session([
      fordefiTxRow({ status: 'broadcast', collected: 2, required: 2, txHash: RECORDED_TX_HASH }),
      fordefiTxRow({ status: 'failed', collected: 2, required: 2, lastError: 'execution reverted' }),
    ])
    const pool = await centrifuge.pool(POOL_ID)

    let error: any
    try {
      await collect(pool.transactionStatus(RECORDED_TX_ID), 200)
    } catch (e) {
      error = e
    }
    // Terminal, and terminal in the way the SDK's own transaction observable is
    // terminal for a transaction that will not execute: the error reaches the
    // subscriber's error handler rather than arriving as a status it has to
    // recognise as fatal.
    expect(error).to.be.instanceOf(BackendTxFailedError)
    expect(error.lastError).to.equal('execution reverted')
  })
})

describe('custodial status de-duplication identity', () => {
  it('treats a changed approval count as a change and an unchanged row as a repeat', () => {
    const oneOfTwo = backendTxStatus(row({ status: 'pending_approval', collected: 1, required: 2 }))
    const alsoOneOfTwo = backendTxStatus(row({ status: 'pending_approval', collected: 1, required: 2 }))
    const twoOfTwo = backendTxStatus(row({ status: 'pending_approval', collected: 2, required: 2 }))

    expect(trackedTxStatusKey(oneOfTwo)).to.equal(trackedTxStatusKey(alsoOneOfTwo))
    // The one that matters: an approver voting is the event the surface exists
    // to report, and a key that ignored the counts would swallow it.
    expect(trackedTxStatusKey(oneOfTwo)).to.not.equal(trackedTxStatusKey(twoOfTwo))
  })

  it('gives every distinct mapped state a distinct key', () => {
    const keys = [
      row({ status: 'prepared' }),
      row({ status: 'submitted_for_signing' }),
      row({ status: 'pending_approval', collected: 1, required: 2 }),
      row({ status: 'signed_pending_broadcast', collected: 2, required: 2 }),
      row({ status: 'broadcast', collected: 2, required: 2, txHash: RECORDED_TX_HASH }),
      row({ status: 'confirmed', collected: 2, required: 2, txHash: RECORDED_TX_HASH }),
      row({ status: 'approval_rejected' }),
    ].map((view) => trackedTxStatusKey(backendTxStatus(view)))

    expect(new Set(keys).size).to.equal(keys.length)
  })
})

/**
 * Collect everything a status observable emits inside a window.
 *
 * A window rather than `take(n)`: the point of most of these assertions is that
 * the surface emits EXACTLY the lifecycle sequence over many more polls than
 * emissions, and `take(n)` would stop at the n-th and prove nothing about
 * repeats. The window is generous relative to the 5ms poll interval, so a slow
 * machine sees fewer polls rather than fewer states.
 */
function collect(source: Observable<TrackedTxStatus>, windowMs: number): Promise<TrackedTxStatus[]> {
  return firstValueFrom(source.pipe(takeUntil(timer(windowMs)), toArray(), timeout({ each: windowMs + 2000 })))
}
