import type { BackendSignerType, BackendTxStatus } from '../txView.js'

/**
 * A backend tx view row on the wire, for the backend-subpath tests.
 *
 * Built from the shape the real producer emits, not the shape convenient to
 * assert: the field list is `toResponse` in the backend's
 * `interfaces/http/controllers/transactions.controller.ts`, which projects
 * `PoolTransactionView` — so `confirmationCode` and `identiconSeed` are present
 * and required, `fordefiState` is absent, `approvals` is `null` rather than
 * `{ collected: 0, required: 0 }` on the wallet route, and `unsignedTx.value`
 * is a decimal STRING (the backend's `Wei` type) rather than a number.
 *
 * Lives inside the subpath rather than in `src/tests/mocks/` beside the other
 * fixtures, even though that is the repo's convention: it imports the subpath's
 * types, and the `sdk-root-no-backend-subpath` boundary rule covers TYPE
 * imports too (`tsPreCompilationDeps` is on for the packages cruise, without
 * which the rule would be blind to exactly this).
 *
 * Deliberately typed loosely as `Record<string, unknown>`. Typing it as
 * `BackendTxView` would make the fixture agree with the decoder by
 * construction, and the decoder is what these tests are checking — a wire shape
 * that has to satisfy the parsed type cannot express the malformed cases at all.
 */
export function mockBackendTxView(
  overrides: {
    txId?: string
    poolId?: string
    status?: BackendTxStatus
    signerType?: BackendSignerType
    txHash?: string | null
    unsignedTx?: unknown
    approvals?: unknown
    createdAt?: string
  } = {}
): Record<string, unknown> {
  return {
    txId: overrides.txId ?? 'tx-1',
    poolId: overrides.poolId ?? '281474976710657',
    chainId: 11155111,
    signerType: overrides.signerType ?? 'wallet_connect',
    actionType: 'updatePoolMetadata',
    status: overrides.status ?? 'prepared',
    unsignedTx:
      'unsignedTx' in overrides
        ? overrides.unsignedTx
        : {
            to: `0x${'11'.repeat(20)}`,
            data: '0xdeadbeef',
            value: '1000000000000000',
            chainId: 11155111,
          },
    txHash: overrides.txHash ?? null,
    confirmationCode: 'BRAVE-OTTER-42',
    identiconSeed: 'ff00ff00',
    lastError: null,
    createdAt: overrides.createdAt ?? '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
    approvals: 'approvals' in overrides ? overrides.approvals : null,
  }
}

/** A Fordefi row mid-quorum, as the backend's projection produces it. */
export function mockBackendFordefiTxView(collected: number, required: number): Record<string, unknown> {
  return mockBackendTxView({
    txId: 'tx-fordefi',
    signerType: 'fordefi',
    status: 'pending_approval',
    unsignedTx: null,
    approvals: {
      collected,
      required,
      approvers: Array.from({ length: collected }, (_, i) => ({
        userId: i === 0 ? 'user-1' : null,
        name: i === 0 ? 'Ada Lovelace' : null,
        decidedAt: '2026-09-01T10:05:00.000Z',
      })),
    },
  })
}
