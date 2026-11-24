import { stubProjectedPools } from '../tests/utils.js'
import { expect } from 'chai'
import { firstValueFrom, of, toArray } from 'rxjs'
import sinon from 'sinon'
import { builders, resolveProtocolContext, type ProtocolContext } from '@centrifuge/protocol'
import { Centrifuge } from '../Centrifuge.js'
import { backendRoutingTable } from '../data/routing.js'
import type { HexString } from '../types/index.js'
import type { PoolAction, PrepareOutcome, TxStrategy } from '../tx/TxStrategy.js'
import { makeThenable } from '../utils/rx.js'
import { PoolId, ShareClassId } from '../utils/types.js'
import { Pool } from './Pool.js'
import { ShareClass } from './ShareClass.js'

/**
 * Pool-access write acceptance: routing, payloads, refusals, and
 * calldata parity between the backend's builders and what the SDK actually puts
 * on the wire.
 *
 * The "SDK side" of every parity assertion is not a re-encode written in this
 * file — that would only prove the test agrees with itself. It is the bytes the local path hands
 * to the wallet, captured out of a fake EIP-1193 provider at
 * `eth_sendTransaction`. The "backend side" is `@centrifuge/protocol`'s builder,
 * the same function `ProtocolTxBuilder.build()` calls in `apps/private-api`,
 * over the same bundled deployment registry — so the `Hub` address is the
 * deployed one on both sides.
 *
 * Everything runs off that registry: no indexer, no RPC, no fork.
 */

const ENVIRONMENT = 'mainnet'
const PROTOCOL_VERSION = '3.2'
/** A pool on centrifugeId 1 (ethereum); the balance sheet lives on spoke 2 (base). */
const POOL_ID = PoolId.from(1, 9)
const SC_ID = ShareClassId.from(POOL_ID, 1)
const HUB_CENT_ID = 1
const HUB_CHAIN_ID = 1
const SPOKE_CENT_ID = 2
const SPOKE_CHAIN_ID = 8453

const SIGNER_ADDRESS = '0xabcabcabcabcabcabcabcabcabcabcabcabcabca' as HexString
const ALICE = '0x1111111111111111111111111111111111111111' as HexString
const BOB = '0x2222222222222222222222222222222222222222' as HexString
const REFUND = '0x3333333333333333333333333333333333333333' as HexString
const HOOK = '0x4444444444444444444444444444444444444444' as HexString
const VALUATION = '0x5555555555555555555555555555555555555555' as HexString
const ADAPTER_LOCAL = '0x6666666666666666666666666666666666666666' as HexString
const ADAPTER_REMOTE = '0x7777777777777777777777777777777777777777' as HexString

/** What the crosschain gas estimate is stubbed to, so `value` is observable. */
const ESTIMATE = 4_200n

/** A captured `eth_sendTransaction` request. */
interface SentTx {
  to: HexString
  data: HexString
  value: bigint
}

/**
 * A wallet that answers just enough JSON-RPC to let `sendTransaction` encode
 * and "send", and records what it was asked to send.
 *
 * An EIP-1193 provider rather than a local account, deliberately: that is the
 * shape a browser wallet has and what `_transact` builds its wallet client
 * from, so viem forwards the fully encoded transaction as `eth_sendTransaction`
 * instead of signing it locally — which is exactly the bytes this file compares.
 */
function recordingSigner(chainId: number) {
  const sent: SentTx[] = []
  const signer = {
    request: async ({ method, params }: { method: string; params?: any[] }) => {
      switch (method) {
        case 'eth_requestAccounts':
        case 'eth_accounts':
          return [SIGNER_ADDRESS]
        case 'eth_chainId':
          return `0x${chainId.toString(16)}`
        case 'eth_sendTransaction': {
          const tx = params![0]
          sent.push({
            to: tx.to as HexString,
            data: (tx.data ?? '0x') as HexString,
            value: tx.value === undefined ? 0n : BigInt(tx.value),
          })
          return `0x${'99'.repeat(32)}`
        }
        default:
          throw new Error(`recordingSigner: unexpected RPC method "${method}"`)
      }
    },
  }
  return { signer, sent }
}

function fakePublicClient(readContract: () => Promise<unknown> = async () => undefined) {
  return {
    // The adapters are contracts; every other address, the signer included, reads as an account.
    getCode: async ({ address }: { address: HexString }) =>
      [ADAPTER_LOCAL, ADAPTER_REMOTE].includes(address) ? ('0x60' as HexString) : undefined,
    waitForTransactionReceipt: async ({ hash }: { hash: HexString }) => ({ status: 'success', hash }),
    readContract,
  }
}

/**
 * Stub only the chain plumbing. `_protocolContext` is deliberately NOT stubbed:
 * the `Hub` address on both sides of every parity assertion has to come from
 * the one bundled registry, or the comparison proves nothing about the real
 * deployment.
 */
function stubChain(centrifuge: Centrifuge, readContract?: () => Promise<unknown>) {
  const thenable = <T>(value: T) => makeThenable(of(value))
  const chainOf = (centrifugeId: number) => (centrifugeId === HUB_CENT_ID ? HUB_CHAIN_ID : SPOKE_CHAIN_ID)
  sinon.stub(centrifuge as any, '_idToChain').callsFake((id: any) => thenable(chainOf(Number(id))))
  sinon
    .stub(centrifuge as any, 'getChainConfig')
    .callsFake((id: any) => thenable({ id: chainOf(Number(id)), name: 'test' }))
  sinon.stub(centrifuge as any, 'getClient').callsFake(() => thenable(fakePublicClient(readContract)))
  // The crosschain fee `wrapTransaction` attaches to the OUTER transaction.
  // Stubbed to a fixed, non-zero amount rather than to zero: the backend prices
  // this server-side from the builder's message manifest, so the two
  // sides are expected to differ on `value` and the tests below say so instead
  // of arranging for the difference to vanish.
  sinon.stub(centrifuge as any, '_estimate').callsFake(() => thenable(ESTIMATE))
}

function entities(centrifuge: Centrifuge) {
  const pool = new Pool(centrifuge, POOL_ID.raw)
  return { pool, shareClass: new ShareClass(centrifuge, pool, SC_ID.raw) }
}

/** A strategy that records the action and answers on the custodial route. */
function recordingStrategy() {
  const actions: PoolAction[] = []
  const strategy: TxStrategy = {
    prepare(action: PoolAction) {
      actions.push(action)
      return of({
        route: 'custodial',
        txId: 'tx-sdk-9',
        signerType: 'fordefi',
        status: 'pending_approval',
      } satisfies PrepareOutcome)
    },
  }
  return { strategy, actions }
}

function backendCentrifuge() {
  const { strategy, actions } = recordingStrategy()
  const centrifuge = new Centrifuge({
    environment: ENVIRONMENT,
    dataSource: { query: () => of({}) } as any,
    txStrategy: strategy,
  })
  stubProjectedPools(centrifuge, [POOL_ID])
  stubChain(centrifuge)
  return { centrifuge, actions }
}

/** A default-configured SDK: no seams, so the write table is never consulted. */
function localCentrifuge(readContract?: () => Promise<unknown>) {
  const centrifuge = new Centrifuge({ environment: ENVIRONMENT })
  stubProjectedPools(centrifuge, [POOL_ID])
  stubChain(centrifuge, readContract)
  return centrifuge
}

/** The pure-builder context for a hub-side action. */
function protocolContext(centrifugeId: number): ProtocolContext {
  return resolveProtocolContext(POOL_ID.toString(), PROTOCOL_VERSION, {
    environment: ENVIRONMENT,
    centrifugeId,
  })
}

/** Run a local transaction to completion against the recording wallet. */
async function sendLocally(centrifuge: Centrifuge, tx: any, chainId: number): Promise<SentTx[]> {
  const { signer, sent } = recordingSigner(chainId)
  centrifuge.setSigner(signer as any)
  await firstValueFrom(tx.pipe(toArray()))
  return sent
}

/** The existing manager set the local `updatePoolManagers` guard reads. */
function stubExistingManagers(pool: Pool, addresses: HexString[]) {
  return sinon
    .stub(pool, 'poolManagers')
    .returns(makeThenable(of(addresses.map((address) => ({ address })))) as any)
}

afterEach(() => {
  sinon.restore()
})

/** A `DataSource` that records every catalogue call and answers from a table. */
function recordingSource(answers: Record<string, unknown> = {}) {
  const calls: { name: string; vars: Record<string, any> | undefined }[] = []
  const dataSource = {
    query: (name: string, vars?: Record<string, any>) => {
      calls.push({ name, vars })
      // `in`, not `??`: a seeded `null` is a REAL answer for the single-row
      // entries ("no such message"), and `?? []` would turn it into an empty
      // list the mapper then tries to read fields off.
      return of(name in answers ? answers[name] : [])
    },
  }
  return { dataSource, calls }
}

describe('pool-access reads: the pool-scoped crosschain message', () => {
  it('sends the pool id the backend route is gated on', async () => {
    // `GET /pools/:poolId/crosschain-messages/:id` is `@PoolMembers()` on the
    // pool in its PATH, so the unscoped `centrifuge.crosschainMessage()` has no
    // endpoint to reach in backend mode and the route table refuses it rather
    // than guessing a pool. This is the caller that carries one.
    const { dataSource, calls } = recordingSource({ crosschainMessage: null })
    const centrifuge = new Centrifuge({ environment: ENVIRONMENT, dataSource: dataSource as any })
    stubProjectedPools(centrifuge, [POOL_ID])
    const { pool } = entities(centrifuge)
    const id = `0x${'cc'.repeat(32)}` as HexString

    const message = await pool.crosschainMessage(id, 1)

    expect(calls).to.have.length(1)
    expect(calls[0]!.name).to.equal('crosschainMessage')
    expect(calls[0]!.vars).to.include({ id, index: 1, poolId: POOL_ID.toString() })
    // The entry's "no such message" answer, unchanged by the scoping.
    expect(message).to.equal(undefined)
  })

  it('does not share a cache entry with the unscoped read', async () => {
    // The same `(id, index)` scoped to a pool and read unscoped are two
    // different queries — one of them can 404 where the other does not — so
    // sharing a cache entry would serve one caller the other's answer.
    const { dataSource, calls } = recordingSource({ crosschainMessage: null })
    const centrifuge = new Centrifuge({ environment: ENVIRONMENT, dataSource: dataSource as any })
    stubProjectedPools(centrifuge, [POOL_ID])
    const { pool } = entities(centrifuge)
    const id = `0x${'cc'.repeat(32)}` as HexString

    await pool.crosschainMessage(id, 1)
    await centrifuge.crosschainMessage(id, 1)

    expect(calls).to.have.length(2)
    expect(calls[0]!.vars).to.have.property('poolId')
    expect(calls[1]!.vars).to.not.have.property('poolId')
  })
})

describe('pool-access writes: routing', () => {
  it('routes exactly the two actions the backend ships builders for', () => {
    const writes = backendRoutingTable().writes
    expect(writes.updatePoolManagers).to.equal('backend')
    expect(writes.updateBalanceSheetManagers).to.equal('backend')
    // The three neighbouring pool-access writes have NO PoolAction at all — no
    // builder in @centrifuge/protocol, no member of the backend's
    // `PoolActionType` — so they are backend gaps rather than decisions, and
    // routing them would mean inventing a contract.
    expect(writes).to.not.have.property('setAdapters')
    expect(writes).to.not.have.property('updateHook')
    expect(writes).to.not.have.property('updateHookAndValuation')
  })

  it('sends updatePoolManagers with the caller order, and no refund address', async () => {
    const { centrifuge, actions } = backendCentrifuge()
    const { pool } = entities(centrifuge)

    await firstValueFrom(
      pool.updatePoolManagers([
        { address: ALICE, canManage: true },
        { address: BOB, canManage: false },
      ])
    )

    expect(actions).to.have.length(1)
    expect(actions[0]!.action).to.equal('updatePoolManagers')
    expect(actions[0]!.poolId).to.equal(POOL_ID.toString())
    // `Hub.updateHubManager` dispatches no cross-chain message, so there is no
    // unspent gas to return and the action carries no `refundAddress`. The
    // backend's DTO refuses one, so sending it would 422 the whole call.
    expect(actions[0]!.payload).to.deep.equal({
      poolId: POOL_ID.toString(),
      updates: [
        { address: ALICE, canManage: true },
        { address: BOB, canManage: false },
      ],
    })
  })

  it('sends updateBalanceSheetManagers per network, with decimal-string ids', async () => {
    const { centrifuge, actions } = backendCentrifuge()
    const { pool } = entities(centrifuge)

    await firstValueFrom(
      pool.updateBalanceSheetManagers([{ centrifugeId: SPOKE_CENT_ID, address: ALICE, canManage: true }], {
        refundAddress: REFUND,
      })
    )

    expect(actions[0]!.action).to.equal('updateBalanceSheetManagers')
    expect(actions[0]!.payload).to.deep.equal({
      poolId: POOL_ID.toString(),
      refundAddress: REFUND,
      updates: [{ centrifugeId: String(SPOKE_CENT_ID), address: ALICE, canManage: true }],
    })
  })

  it('leaves setAdapters and the hook writes on the local path, seam or no seam', async () => {
    // Not "not migrated yet" as a comment — checked. All three reach the WALLET
    // with a strategy injected, because none of them is routed at all: they
    // call `_transact` directly rather than `_routeTransaction`, which is the
    // only honest state while no `PoolAction` exists for them. This case is the
    // guard for the day someone wires one up without a builder behind it —
    // adding a row to `ACTION_ROUTES` alone would not move it, and the case
    // above (`routes exactly the two actions`) is what catches that.
    const { strategy, actions } = recordingStrategy()
    const centrifuge = new Centrifuge({
      environment: ENVIRONMENT,
      dataSource: { query: () => of({}) } as any,
      txStrategy: strategy,
    })
    stubProjectedPools(centrifuge, [POOL_ID])
    // `setAdapters` reads each adapter's `entrypoint()`; both answer the pool's MultiAdapter, as deployed ones do.
    const multiAdapter = protocolContext(HUB_CENT_ID).addresses.multiAdapter
    stubChain(centrifuge, async () => multiAdapter)
    const { pool, shareClass } = entities(centrifuge)

    const adapters = await sendLocally(
      centrifuge,
      pool.setAdapters([
        { centrifugeId: SPOKE_CENT_ID, localAdapters: [ADAPTER_LOCAL], remoteAdapters: [ADAPTER_REMOTE] },
      ]),
      HUB_CHAIN_ID
    )
    const hook = await sendLocally(centrifuge, shareClass.updateHook(SPOKE_CENT_ID, HOOK), HUB_CHAIN_ID)
    const both = await sendLocally(
      centrifuge,
      shareClass.updateHookAndValuation(SPOKE_CENT_ID, HOOK, VALUATION),
      HUB_CHAIN_ID
    )

    expect(adapters).to.have.length(1)
    expect(hook).to.have.length(1)
    expect(both).to.have.length(1)
    expect(actions).to.have.length(0)
  })

  it('never reaches the backend without an injected txStrategy, whatever the table says', async () => {
    // A bare `new Centrifuge({ … })` builds locally, whatever the table says.
    // Proven by the wallet receiving the transaction, not by a strategy going
    // uncalled — there is no strategy on this path to observe.
    const centrifuge = localCentrifuge()
    const { pool } = entities(centrifuge)
    stubExistingManagers(pool, [SIGNER_ADDRESS])

    const sent = await sendLocally(centrifuge, pool.updatePoolManagers([{ address: ALICE, canManage: true }]), HUB_CHAIN_ID)

    expect(sent).to.have.length(1)
  })
})

describe('pool-access writes: refusals and server-side guards', () => {
  it('refuses updateBalanceSheetManagers in backend mode without a refundAddress', async () => {
    const { centrifuge, actions } = backendCentrifuge()
    const { pool } = entities(centrifuge)

    let error: any
    try {
      await firstValueFrom(
        pool.updateBalanceSheetManagers([{ centrifugeId: SPOKE_CENT_ID, address: ALICE, canManage: true }])
      )
    } catch (e) {
      error = e
    }

    expect(error?.message).to.contain('refundAddress')
    expect(error?.message).to.contain('backend mode')
    // Nothing was prepared: the refusal happens before the strategy is reached,
    // so no policy evaluation and no Fordefi ceremony is spent on it.
    expect(actions).to.have.length(0)
  })

  it('keeps updateBalanceSheetManagers working with no refundAddress locally', async () => {
    // The other half: a new option must not become a requirement for callers
    // that have never passed one. The refund stays the signing address.
    const centrifuge = localCentrifuge()
    const { pool } = entities(centrifuge)

    const sent = await sendLocally(
      centrifuge,
      pool.updateBalanceSheetManagers([{ centrifugeId: SPOKE_CENT_ID, address: ALICE, canManage: true }]),
      HUB_CHAIN_ID
    )

    const withSigner = builders.updateBalanceSheetManagers(protocolContext(HUB_CENT_ID), {
      poolId: POOL_ID.toString(),
      refundAddress: SIGNER_ADDRESS,
      updates: [{ centrifugeId: String(SPOKE_CENT_ID), address: ALICE, canManage: true }],
    })
    expect(sent).to.have.length(1)
    expect(sent[0]!.data).to.equal(withSigner.data)
  })

  it('does not run the last-pool-manager pre-flight in backend mode', async () => {
    // The guard moves SERVER-side (422 LAST_POOL_MANAGER, evaluated against the
    // projection). Checked two ways, because either alone is weak: the read the
    // local guard needs is never made, AND a batch the local guard WOULD refuse
    // is prepared here instead of throwing.
    const { centrifuge, actions } = backendCentrifuge()
    const { pool } = entities(centrifuge)
    const managers = stubExistingManagers(pool, [ALICE])

    await firstValueFrom(pool.updatePoolManagers([{ address: ALICE, canManage: false }]))

    expect(managers.called, 'backend mode must not read the manager set').to.equal(false)
    expect(actions).to.have.length(1)
    expect((actions[0]!.payload as any).updates).to.deep.equal([{ address: ALICE, canManage: false }])
  })

  it('still refuses the same batch on the local path', async () => {
    // The control for the case above: the local guard is intact, so the
    // difference is the ROUTE and not a guard that was deleted.
    const centrifuge = localCentrifuge()
    const { pool } = entities(centrifuge)
    stubExistingManagers(pool, [ALICE])

    let error: any
    try {
      await sendLocally(centrifuge, pool.updatePoolManagers([{ address: ALICE, canManage: false }]), HUB_CHAIN_ID)
    } catch (e) {
      error = e
    }

    expect(error?.message).to.contain('Cannot remove all pool managers')
  })
})

describe('pool-access writes: calldata parity (backend builder vs local build)', () => {
  it('updatePoolManagers is byte-equal for a grants-only batch', async () => {
    const centrifuge = localCentrifuge()
    const { pool } = entities(centrifuge)
    stubExistingManagers(pool, [SIGNER_ADDRESS])
    const updates = [
      { address: ALICE, canManage: true },
      { address: BOB, canManage: true },
    ]

    const sent = await sendLocally(centrifuge, pool.updatePoolManagers([...updates]), HUB_CHAIN_ID)
    const built = builders.updatePoolManagers(protocolContext(HUB_CENT_ID), {
      poolId: POOL_ID.toString(),
      updates,
    })

    expect(sent).to.have.length(1)
    expect(sent[0]!.data).to.equal(built.data)
    expect(sent[0]!.to.toLowerCase()).to.equal(built.to.toLowerCase())
    // No cross-chain message on this action, so both sides are truly zero
    // rather than "zero because the estimate was stubbed away".
    expect(sent[0]!.value).to.equal(0n)
    expect(built.value).to.equal(0n)
  })

  it('updatePoolManagers is byte-equal for the case the SDK reorder exists for', async () => {
    // A self-revocation alongside an addition. The SDK moves the SIGNER's entry
    // last; the builder emits all grants before all revokes. On this batch the
    // two rules produce the SAME order — which is the point: the builder's rule
    // is signer-independent and strictly stronger, and it agrees with the SDK
    // exactly where the SDK's rule matters.
    const centrifuge = localCentrifuge()
    const { pool } = entities(centrifuge)
    stubExistingManagers(pool, [SIGNER_ADDRESS, ALICE])
    const updates = [
      { address: SIGNER_ADDRESS, canManage: false },
      { address: BOB, canManage: true },
    ]

    const sent = await sendLocally(centrifuge, pool.updatePoolManagers([...updates]), HUB_CHAIN_ID)
    const built = builders.updatePoolManagers(protocolContext(HUB_CENT_ID), {
      poolId: POOL_ID.toString(),
      updates,
    })

    expect(sent[0]!.data).to.equal(built.data)
  })

  it('updatePoolManagers DIVERGES when the caller writes a revoke before a grant', async () => {
    // The one deliberate difference, pinned rather than discovered later. The
    // signer is in neither entry, so the SDK's reorder is a no-op and the
    // caller's order survives; the builder still partitions. Both transactions
    // are correct and idempotent — they differ only in the order two
    // independent `updateHubManager` calls are batched in — but they are NOT
    // byte-equal, and a decoded preview will show them in the builder's order.
    const centrifuge = localCentrifuge()
    const { pool } = entities(centrifuge)
    stubExistingManagers(pool, [SIGNER_ADDRESS, ALICE])
    const updates = [
      { address: ALICE, canManage: false },
      { address: BOB, canManage: true },
    ]

    const sent = await sendLocally(centrifuge, pool.updatePoolManagers([...updates]), HUB_CHAIN_ID)
    const built = builders.updatePoolManagers(protocolContext(HUB_CENT_ID), {
      poolId: POOL_ID.toString(),
      updates,
    })

    expect(sent[0]!.data).to.not.equal(built.data)
    // ...and the divergence really is only the order: swapping the caller's two
    // entries makes the SDK produce exactly the builder's bytes.
    const swapped = await sendLocally(
      centrifuge,
      pool.updatePoolManagers([updates[1]!, updates[0]!]),
      HUB_CHAIN_ID
    )
    expect(swapped[swapped.length - 1]!.data).to.equal(built.data)
  })

  it('updateBalanceSheetManagers is byte-equal across two networks', async () => {
    const centrifuge = localCentrifuge()
    const { pool } = entities(centrifuge)
    const updates = [
      { centrifugeId: SPOKE_CENT_ID, address: ALICE, canManage: true },
      { centrifugeId: 3, address: BOB, canManage: false },
    ]

    const sent = await sendLocally(
      centrifuge,
      pool.updateBalanceSheetManagers(updates as any, { refundAddress: REFUND }),
      HUB_CHAIN_ID
    )
    const built = builders.updateBalanceSheetManagers(protocolContext(HUB_CENT_ID), {
      poolId: POOL_ID.toString(),
      refundAddress: REFUND,
      updates: updates.map(({ centrifugeId, address, canManage }) => ({
        centrifugeId: String(centrifugeId),
        address,
        canManage,
      })),
    })

    expect(sent).to.have.length(1)
    expect(sent[0]!.data).to.equal(built.data)
    expect(sent[0]!.to.toLowerCase()).to.equal(built.to.toLowerCase())
    // `value` is where the two sides deliberately differ: the SDK attaches the
    // crosschain estimate it read from `MultiAdapter` (one per network, hence
    // 2x the stub), while the builder stays pure and `private-api` prices the
    // same manifest server-side. The CALLDATA is what has to match.
    expect(sent[0]!.value).to.equal(ESTIMATE * 2n)
    expect(built.value).to.equal(0n)
  })

  it('updateBalanceSheetManagers pads the manager address in the same direction', async () => {
    // The control this action needs most. `who` is a bytes32 the spoke decodes
    // with `CastLib.toAddress`, which reverts `PrefixNotZero` on a LEFT-padded
    // value — and only there, after the cross-chain message has been paid for
    // and dispatched. A fixture that shared a builder's misunderstanding of the
    // padding direction would hide exactly that.
    const centrifuge = localCentrifuge()
    const { pool } = entities(centrifuge)

    const sent = await sendLocally(
      centrifuge,
      pool.updateBalanceSheetManagers([{ centrifugeId: SPOKE_CENT_ID, address: ALICE, canManage: true }], {
        refundAddress: REFUND,
      }),
      HUB_CHAIN_ID
    )

    // Right-padded: the address in the HIGH 20 bytes, 24 zero nibbles after it.
    const rightPadded = `${ALICE.slice(2).toLowerCase()}${'0'.repeat(24)}`
    const leftPadded = `${'0'.repeat(24)}${ALICE.slice(2).toLowerCase()}`
    expect(sent[0]!.data.toLowerCase()).to.contain(rightPadded)
    expect(sent[0]!.data.toLowerCase()).to.not.contain(leftPadded)
  })
})
