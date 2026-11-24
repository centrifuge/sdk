import { expect } from 'chai'
import { defer, firstValueFrom, isObservable, mergeMap, of } from 'rxjs'
import sinon from 'sinon'
import { Centrifuge } from '../Centrifuge.js'
import { RestDataSource } from '../data/RestDataSource.js'
import { REST_ROUTES } from '@centrifuge/queries/rest'
import { ACTION_ROUTES, resolveActionRoute } from '../data/routing.js'
import {
  CentrifugeError,
  PolicyDeniedError,
  PoolMigratingError,
  TxConfirmationError,
  TxConfirmationTargetError,
  TxPreparationError,
  UnknownPoolError,
  WalletRequiredError,
} from '../errors.js'
import type { HexString } from '../types/index.js'
import type { OperationStatus, Transaction } from '../types/transaction.js'
import { BackendPrepareStrategy, backendTransaction } from './BackendPrepare.js'
import type { PoolAction } from './TxStrategy.js'
import { stubChain } from '../tests/utils.js'

const BASE_URL = 'https://backend.example/api'
const POOL_ID = '281474976710657'
/** Sepolia — the chain Centrifuge ID 1 maps to on testnet. */
const SEPOLIA = 11155111
const TX_HASH = `0x${'ab'.repeat(32)}` as HexString

const ACTION: PoolAction = {
  action: 'updatePoolMetadata',
  poolId: POOL_ID,
  payload: { poolId: POOL_ID, cid: 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG' },
}

type Call = { url: string; init: RequestInit }

/** A `fetch` that records every call and answers from a scripted function. */
function recordingFetch(answer: (call: Call) => Response) {
  const calls: Call[] = []
  const fetchImpl = (async (input: any, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} }
    calls.push(call)
    return answer(call)
  }) as unknown as typeof fetch
  return { fetch: fetchImpl, calls }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function walletBody(overrides: Record<string, unknown> = {}) {
  return {
    txId: 'tx-1',
    signerType: 'wallet_connect',
    status: 'prepared',
    unsignedTx: { to: `0x${'11'.repeat(20)}`, data: '0xdeadbeef', value: '0', chainId: SEPOLIA },
    ...overrides,
  }
}

function strategyThatAnswers(answer: (call: Call) => Response) {
  const transport = recordingFetch(answer)
  const strategy = new BackendPrepareStrategy({ baseUrl: BASE_URL, transport: { fetch: transport.fetch } })
  return { strategy, calls: transport.calls }
}

async function prepareError(answer: (call: Call) => Response): Promise<any> {
  const { strategy } = strategyThatAnswers(answer)
  try {
    await firstValueFrom(strategy.prepare(ACTION, {}))
    throw new Error('expected prepare to reject')
  } catch (error) {
    return error
  }
}

describe('BackendPrepareStrategy.prepare', () => {
  it('posts the protocol-neutral action to the pool-scoped prepare route', async () => {
    const { strategy, calls } = strategyThatAnswers(() => json(walletBody(), 200))

    await firstValueFrom(strategy.prepare(ACTION, {}))

    expect(calls).to.have.length(1)
    expect(calls[0]!.url).to.equal(`${BASE_URL}/pools/${POOL_ID}/tx/prepare`)
    expect(calls[0]!.init.method).to.equal('POST')
    expect(JSON.parse(String(calls[0]!.init.body))).to.deep.equal({
      action: 'updatePoolMetadata',
      payload: ACTION.payload,
    })
  })

  it('carries no cookie, credential or CSRF header of its own', async () => {
    // Auth mechanics live in the injected transport, never in these classes.
    const { strategy, calls } = strategyThatAnswers(() => json(walletBody(), 200))

    await firstValueFrom(strategy.prepare(ACTION, {}))

    const init = calls[0]!.init as RequestInit & { credentials?: string }
    expect(init.credentials).to.equal(undefined)
    expect(Object.keys(init.headers as Record<string, string>).sort()).to.deep.equal(['Accept', 'Content-Type'])
  })

  it('omits useWalletConnect unless it was configured', async () => {
    const optedOut = recordingFetch(() => json(walletBody(), 200))
    const strategy = new BackendPrepareStrategy({
      baseUrl: BASE_URL,
      transport: { fetch: optedOut.fetch },
      useWalletConnect: true,
    })

    await firstValueFrom(strategy.prepare(ACTION, {}))

    expect(JSON.parse(String(optedOut.calls[0]!.init.body)).useWalletConnect).to.equal(true)
  })

  it('does not forward signingAddress (prepare has no callerAddress)', async () => {
    const { strategy, calls } = strategyThatAnswers(() => json(walletBody(), 200))

    await firstValueFrom(strategy.prepare(ACTION, { signingAddress: `0x${'22'.repeat(20)}` }))

    expect(JSON.parse(String(calls[0]!.init.body))).to.not.have.property('callerAddress')
  })

  it('reads 200 as the wallet route and parses the decimal wei value to bigint', async () => {
    const { strategy } = strategyThatAnswers(() =>
      json(
        walletBody({
          unsignedTx: { to: `0x${'11'.repeat(20)}`, data: '0xabcd', value: '1000000000000000001', chainId: SEPOLIA },
        }),
        200
      )
    )

    const outcome = await firstValueFrom(strategy.prepare(ACTION, {}))

    expect(outcome).to.deep.equal({
      route: 'wallet',
      txId: 'tx-1',
      unsignedTx: {
        to: `0x${'11'.repeat(20)}`,
        data: '0xabcd',
        value: 1000000000000000001n,
        chainId: SEPOLIA,
      },
    })
  })

  it('reads 202 as the custodial route and needs no signer', async () => {
    const { strategy } = strategyThatAnswers(() =>
      json({ txId: 'tx-2', signerType: 'fordefi', status: 'submitted_for_signing' }, 202)
    )

    const outcome = await firstValueFrom(strategy.prepare(ACTION, {}))

    expect(outcome).to.deep.equal({
      route: 'custodial',
      txId: 'tx-2',
      signerType: 'fordefi',
      status: 'submitted_for_signing',
    })
  })

  // `BigInt('')` is 0n and `BigInt('0x10')` is 16n, so a non-canonical value
  // would silently sign for the wrong amount rather than fail.
  for (const value of ['', '0x10', '-1', '007', '1.5', '1e18', ' 1']) {
    it(`refuses a non-canonical wei value ${JSON.stringify(value)}`, async () => {
      const error = await prepareError(() =>
        json(walletBody({ unsignedTx: { to: `0x${'11'.repeat(20)}`, data: '0x', value, chainId: SEPOLIA } }), 200)
      )
      expect(error).to.be.instanceOf(TxPreparationError)
      expect(error.code).to.equal('MALFORMED_PREPARE_RESPONSE')
      expect(error.message).to.contain('canonical non-negative decimal wei string')
    })
  }

  it('refuses a 200 that claims the fordefi signer type', async () => {
    const error = await prepareError(() => json(walletBody({ signerType: 'fordefi' }), 200))
    expect(error).to.be.instanceOf(TxPreparationError)
    expect(error.code).to.equal('MALFORMED_PREPARE_RESPONSE')
  })

  it('refuses a 200 without unsignedTx', async () => {
    const error = await prepareError(() =>
      json({ txId: 'tx-1', signerType: 'wallet_connect', status: 'prepared' }, 200)
    )
    expect(error).to.be.instanceOf(TxPreparationError)
    expect(error.message).to.contain('carries no `unsignedTx`')
  })

  it('maps 422 POOL_MIGRATING to PoolMigratingError', async () => {
    const error = await prepareError(() => json({ error: 'validation_failed', code: 'POOL_MIGRATING' }, 422))
    expect(error).to.be.instanceOf(PoolMigratingError)
    expect(error.poolId).to.equal(POOL_ID)
  })

  it('maps 422 UNKNOWN_POOL to UnknownPoolError, not to TxPreparationError', async () => {
    // The request is well-formed and authorised, so this is a state of
    // the pool, not a fault the caller can correct — it must not land in the
    // same class as UNSUPPORTED_ACTION or POOL_ID_MISMATCH, which callers
    // handle by fixing the request.
    const error = await prepareError(() => json({ error: 'validation_failed', code: 'UNKNOWN_POOL' }, 422))
    expect(error).to.be.instanceOf(UnknownPoolError)
    expect(error).to.not.be.instanceOf(TxPreparationError)
    expect(error.poolId).to.equal(POOL_ID)
    expect(error.message).to.contain('unknown to the chain projection')
  })

  it('keeps the two version-source refusals distinct from each other', async () => {
    // Both are 422s from the version source; conflating them would tell a
    // caller to wait for a migration that is not happening, or vice versa.
    const migrating = await prepareError(() => json({ error: 'validation_failed', code: 'POOL_MIGRATING' }, 422))
    const unknown = await prepareError(() => json({ error: 'validation_failed', code: 'UNKNOWN_POOL' }, 422))
    expect(migrating).to.not.be.instanceOf(UnknownPoolError)
    expect(unknown).to.not.be.instanceOf(PoolMigratingError)
  })

  it('maps the structured 422 PolicyDeniedError to PolicyDeniedError with violations', async () => {
    const violations = [{ key: 'max_metadata_cid_bytes', current: '300', allowed: '256' }]
    const error = await prepareError(() => json({ error: 'PolicyDeniedError', violations }, 422))
    expect(error).to.be.instanceOf(PolicyDeniedError)
    expect(error.violations).to.deep.equal(violations)
  })

  it('maps 403 to PolicyDeniedError carrying the denial code', async () => {
    const error = await prepareError(() => json({ error: 'forbidden', code: 'MISSING_TX_PREPARE_GRANT' }, 403))
    expect(error).to.be.instanceOf(PolicyDeniedError)
    expect(error.code).to.equal('MISSING_TX_PREPARE_GRANT')
    expect(error.violations).to.deep.equal([])
  })

  for (const code of [
    'UNSUPPORTED_ACTION',
    'UNKNOWN_CHAIN',
    'POOL_ID_MISMATCH',
    'FORDEFI_VAULT_MISSING',
    'FORDEFI_REQUEST_REJECTED',
  ]) {
    it(`maps 422 ${code} to TxPreparationError`, async () => {
      const error = await prepareError(() => json({ error: 'validation_failed', code }, 422))
      expect(error).to.be.instanceOf(TxPreparationError)
      expect(error.code).to.equal(code)
      expect(error.status).to.equal(422)
      expect(error.poolId).to.equal(POOL_ID)
    })
  }

  it('maps 409 SIGNING_CONFIG_NOT_FOUND to TxPreparationError', async () => {
    const error = await prepareError(() => json({ error: 'conflict', code: 'SIGNING_CONFIG_NOT_FOUND' }, 409))
    expect(error).to.be.instanceOf(TxPreparationError)
    expect(error.code).to.equal('SIGNING_CONFIG_NOT_FOUND')
  })

  it('maps 503 FORDEFI_UNAVAILABLE to TxPreparationError', async () => {
    const error = await prepareError(() => json({ error: 'upstream_unavailable', code: 'FORDEFI_UNAVAILABLE' }, 503))
    expect(error).to.be.instanceOf(TxPreparationError)
    expect(error.code).to.equal('FORDEFI_UNAVAILABLE')
  })

  it('still produces a typed error for a code the SDK has never seen', async () => {
    // The backend's code vocabulary grows per vertical; an unknown code must
    // stay branchable rather than becoming an untyped throw.
    const error = await prepareError(() => json({ error: 'validation_failed', code: 'SOME_FUTURE_CODE' }, 422))
    expect(error).to.be.instanceOf(TxPreparationError)
    expect(error.code).to.equal('SOME_FUTURE_CODE')
  })

  it('falls back to the HTTP status when there is no code at all', async () => {
    const error = await prepareError(() => new Response('nope', { status: 500 }))
    expect(error).to.be.instanceOf(TxPreparationError)
    expect(error.code).to.equal('HTTP_500')
    expect(error.status).to.equal(500)
  })

  describe('code / issues precedence', () => {
    const ISSUES = [{ path: 'payload.cid', message: 'Too long' }]

    it("gives a 422's code precedence over its issues, and keeps the issues as detail", async () => {
      // A body carrying BOTH must not lose either half: the code is the
      // refusal's identity, the issues are its per-field detail.
      const error = await prepareError(() =>
        json({ error: 'validation_failed', code: 'POOL_ID_MISMATCH', issues: ISSUES }, 422)
      )
      expect(error).to.be.instanceOf(TxPreparationError)
      expect(error.code).to.equal('POOL_ID_MISMATCH')
      expect(error.issues).to.deep.equal(ISSUES)
      expect(error.message).to.contain('payload.cid')
    })

    it('names the error VALIDATION_FAILED only when there is no code', async () => {
      const error = await prepareError(() => json({ error: 'validation_failed', issues: ISSUES }, 422))
      expect(error.code).to.equal('VALIDATION_FAILED')
      expect(error.issues).to.deep.equal(ISSUES)
    })

    it('attaches issues on any other status too, rather than dropping them', async () => {
      const error = await prepareError(() => json({ error: 'teapot', code: 'WEIRD', issues: ISSUES }, 418))
      expect(error.code).to.equal('WEIRD')
      expect(error.issues).to.deep.equal(ISSUES)
    })

    it('leaves issues undefined when the backend sent none', async () => {
      const error = await prepareError(() => json({ error: 'validation_failed', code: 'UNKNOWN_CHAIN' }, 422))
      expect(error.issues).to.equal(undefined)
    })

    it('lets a code win over the 429 default, if the backend ever sends one', async () => {
      expect((await prepareError(() => json({ error: 'rate_limit_exceeded' }, 429))).code).to.equal('RATE_LIMITED')
      expect((await prepareError(() => json({ error: 'rate_limit_exceeded', code: 'QUOTA' }, 429))).code).to.equal(
        'QUOTA'
      )
    })
  })

  it('extracts the denial code from the 422 policy shape, exactly as from a 403', async () => {
    // Both denial shapes carry a meaningful `code`; a consumer branching on it
    // must not have to know which status delivered it.
    const violations = [{ key: 'max_metadata_cid_bytes' }]
    const from422 = await prepareError(() =>
      json({ error: 'PolicyDeniedError', code: 'POLICY_LIMIT_EXCEEDED', violations }, 422)
    )
    const from403 = await prepareError(() => json({ error: 'forbidden', code: 'TX_PREPARE_DENIED' }, 403))

    expect(from422).to.be.instanceOf(PolicyDeniedError)
    expect(from422.code).to.equal('POLICY_LIMIT_EXCEEDED')
    expect(from422.violations).to.deep.equal(violations)
    expect(from403).to.be.instanceOf(PolicyDeniedError)
    expect(from403.code).to.equal('TX_PREPARE_DENIED')
  })
})

describe('BackendPrepareStrategy.confirm', () => {
  async function prepared(answer: (call: Call) => Response) {
    const { strategy, calls } = strategyThatAnswers(answer)
    await firstValueFrom(strategy.prepare(ACTION, {}))
    return { strategy, calls }
  }

  it('posts the broadcast report to the pool-scoped confirm route', async () => {
    const { strategy, calls } = await prepared((call) =>
      call.url.endsWith('/prepare') ? json(walletBody(), 200) : json({ txId: 'tx-1' }, 200)
    )

    await strategy.confirm('tx-1', { status: 'broadcast', txHash: TX_HASH })

    expect(calls[1]!.url).to.equal(`${BASE_URL}/pools/${POOL_ID}/tx/tx-1/confirm`)
    expect(JSON.parse(String(calls[1]!.init.body))).to.deep.equal({ status: 'broadcast', txHash: TX_HASH })
  })

  it('posts the rejection report', async () => {
    const { strategy, calls } = await prepared((call) =>
      call.url.endsWith('/prepare') ? json(walletBody(), 200) : json({ txId: 'tx-1' }, 200)
    )

    await strategy.confirm('tx-1', { status: 'rejected' })

    expect(JSON.parse(String(calls[1]!.init.body))).to.deep.equal({ status: 'rejected' })
  })

  it('refuses to guess the pool for a transaction it did not prepare', async () => {
    const { strategy, calls } = strategyThatAnswers(() => json({}, 200))
    let error: any
    try {
      await strategy.confirm('tx-unknown', { status: 'rejected' })
    } catch (e) {
      error = e
    }
    // A client-side condition: its own class, NOT a TxConfirmationError with an
    // invented code. The backend owns that code union, and a client value
    // sitting in it would add a branch to consumer switches that the backend
    // never sends.
    expect(error).to.be.instanceOf(TxConfirmationTargetError)
    expect(error).to.not.be.instanceOf(TxConfirmationError)
    expect(error).to.be.instanceOf(CentrifugeError)
    expect(error.origin).to.equal('client')
    expect(error.txId).to.equal('tx-unknown')
    expect(error).to.not.have.property('code')
    // Nothing went over the wire.
    expect(calls).to.deep.equal([])
  })

  it('marks every backend-sent confirm refusal as backend-origin', async () => {
    const { strategy } = await prepared((call) =>
      call.url.endsWith('/prepare') ? json(walletBody(), 200) : json({ error: 'conflict', code: 'NOT_PENDABLE' }, 409)
    )
    let error: any
    try {
      await strategy.confirm('tx-1', { status: 'rejected' })
    } catch (e) {
      error = e
    }
    expect(error.origin).to.equal('backend')
  })

  it('accepts an explicit poolId for a transaction prepared elsewhere', async () => {
    const { strategy, calls } = strategyThatAnswers(() => json({ txId: 'tx-9' }, 200))

    await strategy.confirm('tx-9', { status: 'rejected' }, { poolId: POOL_ID })

    expect(calls[0]!.url).to.equal(`${BASE_URL}/pools/${POOL_ID}/tx/tx-9/confirm`)
  })

  for (const code of [
    'NOT_WALLET_CONNECT',
    'CONCURRENT_MODIFICATION',
    'NOT_BROADCASTABLE',
    'NOT_PENDABLE',
    'NOT_REJECTABLE',
  ]) {
    it(`maps the 409 ${code} conflict to TxConfirmationError`, async () => {
      const { strategy } = await prepared((call) =>
        call.url.endsWith('/prepare') ? json(walletBody(), 200) : json({ error: 'conflict', code }, 409)
      )
      let error: any
      try {
        await strategy.confirm('tx-1', { status: 'broadcast', txHash: TX_HASH })
      } catch (e) {
        error = e
      }
      expect(error).to.be.instanceOf(TxConfirmationError)
      expect(error.code).to.equal(code)
      expect(error.txId).to.equal('tx-1')
      expect(error.status).to.equal(409)
    })
  }

  it('maps 404 TX_NOT_FOUND to TxConfirmationError', async () => {
    const { strategy } = await prepared((call) =>
      call.url.endsWith('/prepare') ? json(walletBody(), 200) : json({ error: 'not_found', code: 'TX_NOT_FOUND' }, 404)
    )
    let error: any
    try {
      await strategy.confirm('tx-1', { status: 'broadcast', txHash: TX_HASH })
    } catch (e) {
      error = e
    }
    expect(error).to.be.instanceOf(TxConfirmationError)
    expect(error.code).to.equal('TX_NOT_FOUND')
  })

  it('maps 403 on confirm to PolicyDeniedError', async () => {
    const { strategy } = await prepared((call) =>
      call.url.endsWith('/prepare') ? json(walletBody(), 200) : json({ error: 'forbidden', code: 'NOT_A_MEMBER' }, 403)
    )
    let error: any
    try {
      await strategy.confirm('tx-1', { status: 'rejected' })
    } catch (e) {
      error = e
    }
    expect(error).to.be.instanceOf(PolicyDeniedError)
    expect(error.code).to.equal('NOT_A_MEMBER')
  })
})

describe('backendTransaction', () => {
  /**
   * Replace `_transact` with a passthrough over a synthetic
   * `TransactionContext`, so the real `doTransaction` emission sequence runs
   * without a signer, a chain or an RPC. The signer check and chain switch that
   * `_transact` itself owns are covered by the unstubbed cases below and by the
   * existing suite.
   */
  function stubTransact(centrifuge: Centrifuge, walletClient: { sendTransaction: (args: any) => Promise<HexString> }) {
    // A signer must be present for the wallet route to proceed past the
    // resume-context check; the stub below stands in for everything
    // `_transact` would do with it (chain switch, wallet client, address).
    centrifuge.setSigner({ request: async () => undefined })
    const receipt = { status: 'success', transactionHash: TX_HASH } as any
    const ctx: any = {
      centrifugeId: 1,
      signingAddress: `0x${'33'.repeat(20)}`,
      chain: { id: SEPOLIA },
      publicClient: {
        getCode: async () => '0x',
        waitForTransactionReceipt: async () => receipt,
      },
      walletClient,
      root: centrifuge,
    }
    return sinon
      .stub(centrifuge, '_transact')
      .callsFake(
        ((callback: any) =>
          defer(() => callback(ctx)).pipe(mergeMap((d: any) => (isObservable(d) ? d : of(d)))) as any) as any
      )
  }

  afterEach(() => sinon.restore())

  it('emits the LocalBuild status sequence on the wallet route and confirms the hash', async () => {
    const centrifuge = new Centrifuge({ environment: 'testnet' })
    const sent: any[] = []
    stubTransact(centrifuge, {
      sendTransaction: async (args) => {
        sent.push(args)
        return TX_HASH
      },
    })
    const confirmed: any[] = []
    const strategy = {
      prepare: () =>
        of({
          route: 'wallet' as const,
          txId: 'tx-1',
          unsignedTx: {
            to: `0x${'11'.repeat(20)}` as HexString,
            data: '0xabcd' as HexString,
            value: 7n,
            chainId: SEPOLIA,
          },
        }),
      confirm: async (txId: string, report: any, opts?: any) => {
        confirmed.push({ txId, report, opts, seen: statuses.map((s) => s.type) })
      },
    }
    const statuses: OperationStatus[] = []

    const tx = backendTransaction(centrifuge, strategy, ACTION, { title: 'Update metadata', centrifugeId: 1 })
    await new Promise<void>((resolve, reject) =>
      tx.subscribe({ next: (s) => statuses.push(s), error: reject, complete: resolve })
    )

    expect(statuses.map((s) => s.type)).to.deep.equal([
      'SigningTransaction',
      'TransactionPending',
      'TransactionConfirmed',
    ])
    expect(sent).to.deep.equal([{ to: `0x${'11'.repeat(20)}`, data: '0xabcd', value: 7n }])
    // Reported once the hash exists, and only after a subscriber has seen it.
    expect(confirmed).to.have.length(1)
    expect(confirmed[0]!.report).to.deep.equal({ status: 'broadcast', txHash: TX_HASH })
    expect(confirmed[0]!.opts).to.deep.equal({ poolId: POOL_ID })
    expect(confirmed[0]!.seen).to.deep.equal(['SigningTransaction', 'TransactionPending'])
    expect((tx as Transaction).centrifugeId).to.equal(1)
  })

  it('reports a rejection when the wallet never broadcasts, and rethrows the cause', async () => {
    const centrifuge = new Centrifuge({ environment: 'testnet' })
    const declined = Object.assign(new Error('User rejected the request'), { code: 4001 })
    stubTransact(centrifuge, {
      sendTransaction: async () => {
        throw declined
      },
    })
    const confirmed: any[] = []
    const strategy = {
      prepare: () =>
        of({
          route: 'wallet' as const,
          txId: 'tx-1',
          unsignedTx: { to: `0x${'11'.repeat(20)}` as HexString, data: '0x' as HexString, value: 0n, chainId: SEPOLIA },
        }),
      confirm: async (txId: string, report: any) => {
        confirmed.push({ txId, report })
      },
    }

    let error: unknown
    try {
      await backendTransaction(centrifuge, strategy, ACTION, { title: 'Update metadata', centrifugeId: 1 })
    } catch (e) {
      error = e
    }

    expect(error).to.equal(declined)
    expect(confirmed).to.deep.equal([{ txId: 'tx-1', report: { status: 'rejected' } }])
  })

  it('emits one CustodialHandoff status and completes, with no signer set', async () => {
    const centrifuge = new Centrifuge({ environment: 'testnet' })
    const strategy = {
      prepare: () =>
        of({ route: 'custodial' as const, txId: 'tx-2', signerType: 'fordefi' as const, status: 'pending_approval' }),
      confirm: async () => {
        throw new Error('confirm must not be called on the custodial route')
      },
    }
    const statuses: OperationStatus[] = []

    const tx = backendTransaction(centrifuge, strategy, ACTION, { title: 'Update metadata', centrifugeId: 1 })
    await new Promise<void>((resolve, reject) =>
      tx.subscribe({ next: (s) => statuses.push(s), error: reject, complete: resolve })
    )

    expect(centrifuge.signer).to.equal(null)
    expect(statuses).to.deep.equal([
      {
        id: 'tx-2',
        type: 'CustodialHandoff',
        title: 'Update metadata',
        txId: 'tx-2',
        signerType: 'fordefi',
        status: 'pending_approval',
      },
    ])
  })

  it('raises WalletRequiredError only once the wallet route is known, not at subscribe', async () => {
    const centrifuge = new Centrifuge({ environment: 'testnet' })
    let prepareCalls = 0
    const strategy = {
      prepare: () => {
        prepareCalls++
        return of({
          route: 'wallet' as const,
          txId: 'tx-1',
          unsignedTx: {
            to: `0x${'11'.repeat(20)}` as HexString,
            data: '0x' as HexString,
            value: 0n,
            chainId: SEPOLIA,
          },
        })
      },
    }

    const tx = backendTransaction(centrifuge, strategy, ACTION, { title: 'Update metadata', centrifugeId: 1 })
    // Constructing and subscribing does not throw; the prepare round trip runs first.
    expect(prepareCalls).to.equal(0)

    let error: unknown
    try {
      await tx
    } catch (e) {
      error = e
    }

    expect(error).to.be.instanceOf(WalletRequiredError)
    expect(prepareCalls).to.equal(1)
  })

  it('names the prepared transaction on WalletRequiredError so it can be resumed', async () => {
    // The row exists and is awaiting a signature. Without its id the caller's
    // only recovery is to prepare again, which orphans it.
    const centrifuge = new Centrifuge({ environment: 'testnet' })
    const unsignedTx = {
      to: `0x${'11'.repeat(20)}` as HexString,
      data: '0xdeadbeef' as HexString,
      value: 42n,
      chainId: SEPOLIA,
    }
    const confirmed: any[] = []
    const strategy = {
      prepare: () => of({ route: 'wallet' as const, txId: 'tx-resume-me', unsignedTx }),
      confirm: async (txId: string, report: any, opts?: any) => {
        confirmed.push({ txId, report, opts })
      },
    }

    let error: any
    try {
      await backendTransaction(centrifuge, strategy, ACTION, { title: 'Update metadata', centrifugeId: 1 })
    } catch (e) {
      error = e
    }

    expect(error).to.be.instanceOf(WalletRequiredError)
    expect(error.txId).to.equal('tx-resume-me')
    expect(error.prepared).to.deep.equal({ txId: 'tx-resume-me', chainId: SEPOLIA, unsignedTx })
    // The calldata is carried verbatim, value included, so it is signable as-is.
    expect(error.prepared.unsignedTx.value).to.equal(42n)
    expect(error.message).to.contain('tx-resume-me')
    expect(error.message).to.contain('orphaned')

    // The documented recovery path: report against the SAME id, no re-prepare.
    await strategy.confirm(error.prepared.txId, { status: 'rejected' })
    expect(confirmed).to.deep.equal([{ txId: 'tx-resume-me', report: { status: 'rejected' }, opts: undefined }])
  })

  it('carries no prepared reference in public mode, where nothing was prepared', () => {
    const bare = new WalletRequiredError()
    expect(bare.message).to.equal('Signer not set')
    expect(bare.prepared).to.equal(undefined)
    expect(bare.txId).to.equal(undefined)
  })

  it('refuses to sign a transaction prepared for a different chain', async () => {
    const centrifuge = new Centrifuge({ environment: 'testnet' })
    const strategy = {
      prepare: () =>
        of({
          route: 'wallet' as const,
          txId: 'tx-1',
          unsignedTx: { to: `0x${'11'.repeat(20)}` as HexString, data: '0x' as HexString, value: 0n, chainId: 1 },
        }),
    }

    let error: any
    try {
      await backendTransaction(centrifuge, strategy, ACTION, { title: 'Update metadata', centrifugeId: 1 })
    } catch (e) {
      error = e
    }

    expect(error?.message).to.contain('prepared "updatePoolMetadata" for chain 1')
    expect(error?.message).to.contain(`is chain ${SEPOLIA}`)
  })

  it('refuses a local outcome from a backend strategy', async () => {
    const centrifuge = new Centrifuge({ environment: 'testnet' })
    const strategy = { prepare: () => of({ route: 'local' as const, built: {} as any }) }

    let error: any
    try {
      await backendTransaction(centrifuge, strategy, ACTION, { title: 'Update metadata', centrifugeId: 1 })
    } catch (e) {
      error = e
    }

    expect(error?.message).to.contain('returned the "local" route')
  })
})

describe('per-entry write fallback (Centrifuge._routeTransaction)', () => {
  const stubDataSource = { query: () => of({}) }

  function backendCentrifuge(txStrategy: any) {
    return new Centrifuge({
      environment: 'testnet',
      dataSource: stubDataSource,
      txStrategy,
    })
  }

  it('ships exactly the routed rows and nothing else, so every other action falls back', () => {
    // THE exhaustive assertion about this table, and the only one: a
    // per-vertical copy of it would go red whenever another vertical appended
    // its own legitimate rows, so the per-vertical suites assert only their own
    // rows and this is where "and nothing else" is claimed.
    //
    // Five holdings rows, two vaults, one NAV, two pool-access manager writes,
    // four investors, four orders epoch actions and one on/off-ramp registration. `updatePoolMetadata` is the
    // useful control — the backend accepts that action and it is STILL local,
    // because no vertical has claimed it.
    expect(ACTION_ROUTES).to.deep.equal({
      createHolding: 'backend',
      depositHolding: 'backend',
      withdrawHolding: 'backend',
      issueSharesDirect: 'backend',
      revokeSharesDirect: 'backend',
      deployVault: 'backend',
      updateVaults: 'backend',
      updateSharePrice: 'backend',
      updatePoolManagers: 'backend',
      updateBalanceSheetManagers: 'backend',
      registerOnOffRamp: 'backend',
      updateMember: 'backend',
      freezeMember: 'backend',
      unfreezeMember: 'backend',
      crosschainTransferShares: 'backend',
      approveDeposits: 'backend',
      issueShares: 'backend',
      approveRedeems: 'backend',
      revokeShares: 'backend',
    })
    expect(resolveActionRoute('createHolding')).to.equal('backend')
    expect(resolveActionRoute('approveDeposits')).to.equal('backend')
    expect(resolveActionRoute('updatePoolMetadata')).to.equal('local')
    expect(resolveActionRoute('anythingElse')).to.equal('local')
    // The NAV write methods beyond `updateSharePrice`: no builder, no DTO case,
    // no row — so LocalBuild in every mode until the backend ships one.
    for (const action of [
      'notifySharePrice',
      'notifyAssetPrice',
      'setMaxSharePriceAge',
      'setMaxAssetPriceAge',
      'updateValuation',
      'updateOracleValuationFeeder',
    ]) {
      expect(resolveActionRoute(action), action).to.equal('local')
    }
  })

  it('builds an unrouted action locally, seam or no seam', async () => {
    const prepare = sinon.stub()
    const centrifuge = backendCentrifuge({ prepare })
    stubChain(centrifuge)
    let built = 0
    const local = () => ((built += 1), of({ type: 'TransactionConfirmed' }) as unknown as Transaction)

    const routed = centrifuge._routeTransaction(ACTION, {
      title: 'Update metadata',
      centrifugeId: 1,
      gate: [],
      local,
    })

    expect(await firstValueFrom(routed)).to.deep.equal({ type: 'TransactionConfirmed' })
    expect(built).to.equal(1)
    expect(prepare.called).to.equal(false)
  })

  it('routes through the strategy for an action the table sends to the backend', async () => {
    const centrifuge = backendCentrifuge({
      prepare: () =>
        of({ route: 'custodial' as const, txId: 'tx-3', signerType: 'fordefi' as const, status: 'pending_approval' }),
    })
    let localCalls = 0

    const routed = centrifuge._routeTransaction(ACTION, {
      title: 'Update metadata',
      centrifugeId: 1,
      gate: [],
      local: () => {
        localCalls++
        return of() as unknown as Transaction
      },
      routes: { updatePoolMetadata: 'backend' },
    })
    const status = await firstValueFrom(routed)

    expect(localCalls).to.equal(0)
    expect(status).to.include({ type: 'CustodialHandoff', txId: 'tx-3' })
  })

  it('never routes to the backend without an injected txStrategy, whatever the table says', async () => {
    // A bare `new Centrifuge({ … })` is unaffected by a routed row, because with
    // the default LocalBuildStrategy the table is not consulted at all.
    const centrifuge = new Centrifuge({ environment: 'testnet' })
    stubChain(centrifuge)
    let built = 0
    const local = () => ((built += 1), of({ type: 'TransactionConfirmed' }) as unknown as Transaction)

    const routed = centrifuge._routeTransaction(ACTION, {
      title: 'Update metadata',
      centrifugeId: 1,
      gate: [],
      local,
      routes: { updatePoolMetadata: 'backend' },
    })

    expect(await firstValueFrom(routed)).to.deep.equal({ type: 'TransactionConfirmed' })
    expect(built).to.equal(1)
  })

  it('does not enable backend writes when only the read seam is injected', async () => {
    // The seams are independent: backend reads with wallet-signed writes must
    // not start preparing writes through the default LocalBuildStrategy as if
    // it were a backend strategy.
    const centrifuge = new Centrifuge({ environment: 'testnet', dataSource: stubDataSource })
    stubChain(centrifuge)
    let built = 0
    const local = () => ((built += 1), of({ type: 'TransactionConfirmed' }) as unknown as Transaction)

    const routed = centrifuge._routeTransaction(ACTION, {
      title: 'Update metadata',
      centrifugeId: 1,
      gate: [],
      local,
      routes: { updatePoolMetadata: 'backend' },
    })

    expect(await firstValueFrom(routed)).to.deep.equal({ type: 'TransactionConfirmed' })
    expect(built).to.equal(1)
  })
})

describe('RestDataSource fallback', () => {
  /**
   * The one entry with no endpoint to route ONTO. `investorPortfolioSources`
   * is the GLOBAL, pool-less catalogue of vault asset addresses and share
   * token addresses that `Investor.portfolio()` pairs with an on-chain
   * `balanceOf`, and every private-api route that could serve those addresses
   * is pool-scoped because `PoolRolesGuard` reads the pool out of the path.
   * That makes it a stable example: it is blocked on the backend shipping an
   * endpoint at all.
   */
  const UNROUTED = 'investorPortfolioSources'
  const SOURCES = {
    vaults: { items: [{ assetAddress: `0x${'22'.repeat(20)}`, centrifugeId: '1' }] },
    tokenInstances: { items: [{ address: `0x${'33'.repeat(20)}`, centrifugeId: '1' }] },
  }

  it('answers an unrouted entry through the graphql adapter', async () => {
    expect(REST_ROUTES[UNROUTED], `${UNROUTED} must still be unflipped`).to.equal(undefined)
    const centrifuge = new Centrifuge({ environment: 'testnet', graphqlTarget: 'api-v3' })
    const execute = sinon.stub(centrifuge as any, '_executeGraphql').resolves(SOURCES)
    const source = new RestDataSource(centrifuge, {
      baseUrl: BASE_URL,
      transport: {
        fetch: (async () => {
          throw new Error('no REST request may go out for an unrouted entry')
        }) as unknown as typeof fetch,
      },
      graphqlTarget: 'api-v3',
    })

    const result = await firstValueFrom(source.query(UNROUTED, {}))

    expect(execute.calledOnce).to.equal(true)
    expect(result).to.deep.equal({
      vaults: SOURCES.vaults.items,
      tokenInstances: SOURCES.tokenInstances.items,
    })
    sinon.restore()
  })

  it('sends a ROUTED entry to the backend and never to graphql', async () => {
    // `blockchains` is routed to REST, so the fallback must not be reachable
    // for it: a graphql answer to a failed REST read would hide a broken route
    // behind plausible data.
    const centrifuge = new Centrifuge({ environment: 'testnet', graphqlTarget: 'api-v3' })
    const execute = sinon.stub(centrifuge as any, '_executeGraphql').rejects(new Error('graphql must not be used'))
    const urls: string[] = []
    const source = new RestDataSource(centrifuge, {
      baseUrl: BASE_URL,
      transport: {
        fetch: (async (input: any) => {
          urls.push(String(input))
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }) as unknown as typeof fetch,
      },
      graphqlTarget: 'api-v3',
    })

    const result = await firstValueFrom(source.query('blockchains', {}))

    expect(result).to.deep.equal([])
    expect(urls).to.deep.equal([`${BASE_URL}/blockchains`])
    expect(execute.called).to.equal(false)
    sinon.restore()
  })
})
