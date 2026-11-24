import { stubProjectedPools } from '../tests/utils.js'
import { expect } from 'chai'
import { firstValueFrom, of, toArray } from 'rxjs'
import sinon from 'sinon'
import { builders, MessageType, resolveProtocolContext, type ProtocolContext } from '@centrifuge/protocol'
import { REST_ROUTES } from '@centrifuge/queries/rest'
import { Centrifuge } from '../Centrifuge.js'
import { backendRoutingTable } from '../data/routing.js'
import type { HexString } from '../types/index.js'
import type { PoolAction, PrepareOutcome, TxStrategy } from '../tx/TxStrategy.js'
import { makeThenable } from '../utils/rx.js'
import { PoolId, ShareClassId } from '../utils/types.js'
import { Pool } from './Pool.js'
import { ShareClass } from './ShareClass.js'

/**
 * Investors acceptance: which catalogue rows are routed, which writes route,
 * and calldata + MESSAGE MANIFEST parity between the backend's builders and
 * what the SDK actually puts on the wire.
 *
 * The "SDK side" of every parity assertion is not a re-encode written in this
 * file — that would prove only that the test agrees with itself. It is the bytes the local path
 * hands the wallet, captured out of a fake EIP-1193 provider at
 * `eth_sendTransaction`. The "backend side" is `@centrifuge/protocol`'s
 * builder, the same function `ProtocolTxBuilder.build()` calls in
 * `apps/private-api`, over the same bundled deployment registry.
 *
 * The manifest half matters as much as the calldata: `value` matching proves
 * nothing when the two sides reach it for different reasons, and an SDK
 * UNDER-estimate strands a message after the transaction confirms.
 * `crosschainTransferShares` is exactly that shape — its manifest branches on
 * whether the source network is the pool's hub — so the manifests are compared
 * directly, per network and per message, not through `value`.
 */

const ENVIRONMENT = 'mainnet'
const PROTOCOL_VERSION = '3.2'
/** A pool on centrifugeId 1 (ethereum); the spoke used throughout is 2 (base). */
const POOL_ID = PoolId.from(1, 9)
const SC_ID = ShareClassId.from(POOL_ID, 1)
const HUB_CENT_ID = 1
const HUB_CHAIN_ID = 1
const SPOKE_CENT_ID = 2
const SPOKE_CHAIN_ID = 8453
/** A third network, so a "destination is neither hub nor source" case exists. */
const OTHER_CENT_ID = 3

const SIGNER_ADDRESS = '0xabcabcabcabcabcabcabcabcabcabcabcabcabca' as HexString
const ALICE = '0x1111111111111111111111111111111111111111' as HexString
const BOB = '0x2222222222222222222222222222222222222222' as HexString
const REFUND = '0x3333333333333333333333333333333333333333' as HexString

/** `type(uint32).max` — the app's "membership never expires" sentinel. */
const NEVER_EXPIRES = 4294967295
/** A concrete future expiry, i.e. a scheduled removal. */
const EXPIRES_2030 = 1893456000

/** What the crosschain gas estimate is stubbed to, so `value` is observable. */
const ESTIMATE = 4_200n

/** A captured `eth_sendTransaction` request. */
interface SentTx {
  to: HexString
  data: HexString
  value: bigint
}

/** One `_estimate` call: the SDK's manifest, as the SDK actually priced it. */
interface EstimateCall {
  from: number
  to: number
  types: number[]
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

function fakePublicClient() {
  return {
    getCode: async () => undefined,
    waitForTransactionReceipt: async ({ hash }: { hash: HexString }) => ({ status: 'success', hash }),
    readContract: async () => undefined,
  }
}

/**
 * Stub only the chain plumbing, and RECORD the manifest.
 *
 * `_protocolContext` is deliberately NOT stubbed: the `Hub` and `Spoke`
 * addresses on both sides of every parity assertion have to come from the one
 * bundled registry, or the comparison proves nothing about the real deployment.
 *
 * `_estimate` is stubbed to a fixed amount AND its arguments kept. That is the
 * manifest comparison's SDK side: `wrapTransaction` calls it once per
 * destination network with that network's message list, so the calls ARE what
 * the SDK believes it is paying for — rather than `value`, which is one number
 * two different manifests can agree on.
 */
function stubChain(centrifuge: Centrifuge) {
  const estimates: EstimateCall[] = []
  const thenable = <T>(value: T) => makeThenable(of(value))
  const chainOf = (centrifugeId: number) => (centrifugeId === HUB_CENT_ID ? HUB_CHAIN_ID : SPOKE_CHAIN_ID)
  sinon.stub(centrifuge as any, '_idToChain').callsFake((id: any) => thenable(chainOf(Number(id))))
  sinon
    .stub(centrifuge as any, 'getChainConfig')
    .callsFake((id: any) => thenable({ id: chainOf(Number(id)), name: 'test' }))
  sinon.stub(centrifuge as any, 'getClient').callsFake(() => thenable(fakePublicClient()))
  sinon.stub(centrifuge as any, '_estimate').callsFake((from: any, to: any, types: any) => {
    estimates.push({
      from: Number(from),
      to: Number(to),
      types: (Array.isArray(types) ? types : [types]).map((t: any) => (typeof t === 'object' ? t.type : t)),
    })
    return thenable(ESTIMATE)
  })
  return estimates
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
        txId: 'tx-sdk-11',
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
function localCentrifuge() {
  const centrifuge = new Centrifuge({ environment: ENVIRONMENT })
  stubProjectedPools(centrifuge, [POOL_ID])
  const estimates = stubChain(centrifuge)
  return { centrifuge, estimates }
}

/** The pure-builder context for one network. */
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

/** A `DataSource` that records every catalogue call and answers from a table. */
function recordingSource(answers: Record<string, unknown> = {}) {
  const calls: { name: string; vars: Record<string, any> | undefined }[] = []
  const dataSource = {
    query: (name: string, vars?: Record<string, any>) => {
      calls.push({ name, vars })
      return of(name in answers ? answers[name] : [])
    },
  }
  return { dataSource, calls }
}

/**
 * The manifest a builder declares, flattened to the same shape the SDK's
 * `_estimate` calls produce so the two are directly comparable.
 */
function builderManifest(
  built: { messages?: Readonly<Record<number, readonly { type: number }[]>> },
  from: number
) {
  return Object.entries(built.messages ?? {}).map(([to, messages]) => ({
    from,
    to: Number(to),
    types: messages.map((m) => m.type),
  }))
}

afterEach(() => {
  sinon.restore()
})

describe('investors reads: the catalogue rows', () => {
  it('routes five of six, and names the one the backend is short', () => {
    const reads = backendRoutingTable().reads
    for (const entry of [
      'whitelistedInvestors',
      'whitelistedInvestor',
      'tokenInstancePositions',
      'tokenInstancePosition',
      'investorTransactions',
    ] as const) {
      expect(reads[entry], `${entry} still falls back to graphql`).to.not.equal(undefined)
    }
    // Not a decision and not convenience: `investorPortfolioSources` is the
    // GLOBAL, pool-less catalogue of every vault asset address and every share
    // token address, which `Investor.portfolio()` pairs with an on-chain
    // `balanceOf`. Every private-api route that could serve those addresses is
    // pool-scoped, because `PoolRolesGuard` reads the pool out of the PATH, so
    // there is no endpoint to bind to. The backend is short an endpoint; this
    // is not a decision to leave the entry on graphql.
    expect(reads.investorPortfolioSources).to.equal(undefined)
  })

  it('reads the SERVED isWhitelisted, never parseInt(validUntil) > Date.now()', async () => {
    // `parseInt(validUntil) > Date.now()` is false for EVERY investor on both
    // graphql targets — `parseInt` of an ISO string is the year, and api-v3's
    // seconds never exceed a millisecond clock — which would empty the
    // client's Whitelisted tab. Seeds a `validUntil` that predicate rejects
    // but the served `isWhitelisted` flag accepts, so a regression to that
    // predicate turns this row's `isWhitelisted` false and fails the test.
    const { dataSource } = recordingSource({
      whitelistedInvestors: {
        items: [
          {
            accountAddress: ALICE,
            centrifugeId: String(SPOKE_CENT_ID),
            createdAt: '2026-01-01T00:00:00.000Z',
            isFrozen: false,
            validUntil: '2030-01-01T00:00:00.000Z',
            isWhitelisted: true,
          },
        ],
        totalCount: 1,
      },
      investOrderState: {
        epochOutstandingInvests: [],
        epochInvestOrders: [],
        pendingInvestOrders: [],
        investOrders: [],
      },
      redeemOrderState: {
        epochOutstandingRedeems: [],
        epochRedeemOrders: [],
        pendingRedeemOrders: [],
        redeemOrders: [],
      },
      tokenInstancePosition: null,
    })
    const centrifuge = new Centrifuge({ environment: ENVIRONMENT, dataSource: dataSource as any })
    stubProjectedPools(centrifuge, [POOL_ID])
    stubChain(centrifuge)
    const { pool, shareClass } = entities(centrifuge)
    sinon.stub(pool, 'currency').returns(makeThenable(of({ decimals: 6, symbol: 'USD' })) as any)

    const page = await shareClass.whitelistedHolders({ limit: 20, offset: 0 })

    expect(page.investors).to.have.length(1)
    expect(page.investors[0]!.isWhitelisted).to.equal(true)
    // The entity-side page envelope is synthesised, not sourced from the
    // backend: it answers `{ items, total }` and has no cursors to serve.
    expect(page.pageInfo).to.deep.equal({
      hasNextPage: false,
      hasPreviousPage: false,
      startCursor: null,
      endCursor: null,
    })
    expect(page.totalCount).to.equal(1)
  })

  it('scales an outstanding subscription by the ORDER asset decimals, not by 18', async () => {
    // Decimals come from the order row, not from a whole-table `assets` read
    // whose miss falls through to `?? 18`. A 6-decimal asset is the case that
    // distinguishes the two: at 18 the amount renders a trillion times too
    // small.
    const ASSET_ID = '5192296858534827628530496329220097'
    const { dataSource } = recordingSource({
      whitelistedInvestors: {
        items: [
          {
            accountAddress: ALICE,
            centrifugeId: String(SPOKE_CENT_ID),
            createdAt: '2026-01-01T00:00:00.000Z',
            isFrozen: false,
            validUntil: '2030-01-01T00:00:00.000Z',
            isWhitelisted: true,
          },
        ],
        totalCount: 1,
      },
      investOrderState: {
        epochOutstandingInvests: [
          {
            assetId: ASSET_ID,
            poolId: POOL_ID.toString(),
            tokenId: SC_ID.raw,
            pendingAssetsAmount: '1000000',
            asset: { decimals: 6, centrifugeId: String(SPOKE_CENT_ID) },
            token: { decimals: 18, centrifugeId: String(SPOKE_CENT_ID) },
          },
        ],
        epochInvestOrders: [],
        pendingInvestOrders: [
          {
            account: ALICE,
            assetId: ASSET_ID,
            tokenId: SC_ID.raw,
            pendingAssetsAmount: '1000000',
            queuedAssetsAmount: '0',
          },
        ],
        investOrders: [],
      },
      redeemOrderState: {
        epochOutstandingRedeems: [],
        epochRedeemOrders: [],
        pendingRedeemOrders: [],
        redeemOrders: [],
      },
      tokenInstancePosition: null,
    })
    const centrifuge = new Centrifuge({ environment: ENVIRONMENT, dataSource: dataSource as any })
    stubProjectedPools(centrifuge, [POOL_ID])
    stubChain(centrifuge)
    const { pool, shareClass } = entities(centrifuge)
    sinon.stub(pool, 'currency').returns(makeThenable(of({ decimals: 6, symbol: 'USD' })) as any)

    const page = await shareClass.whitelistedHolders({ limit: 20, offset: 0 })

    // 1_000_000 at 6 decimals is 1.0; at 18 decimals it is 1e-12, so a
    // fallback to a hardcoded 18 renders this amount a trillion times small.
    expect(page.investors[0]!.amount.decimals).to.equal(6)
    expect(page.investors[0]!.amount.toFloat()).to.equal(1)
    expect(page.investors[0]!.outstandingInvest.toFloat()).to.equal(1)
  })
})

describe('investors writes: routing', () => {
  it('routes exactly the four actions the backend ships builders for', () => {
    const writes = backendRoutingTable().writes
    expect(writes.updateMember).to.equal('backend')
    expect(writes.freezeMember).to.equal('backend')
    expect(writes.unfreezeMember).to.equal('backend')
    expect(writes.crosschainTransferShares).to.equal('backend')
    // `updateMembers` is not its own action: the backend takes one investor per
    // action, deliberately, so the batch has nothing to route to.
    expect(writes).to.not.have.property('updateMembers')
  })

  it('sends updateMember with the add sentinel as op:add and no validUntil', async () => {
    const { centrifuge, actions } = backendCentrifuge()
    const { shareClass } = entities(centrifuge)

    await firstValueFrom(
      shareClass.updateMember(ALICE, NEVER_EXPIRES, SPOKE_CENT_ID, { refundAddress: REFUND })
    )

    expect(actions).to.have.length(1)
    expect(actions[0]!.action).to.equal('updateMember')
    expect(actions[0]!.poolId).to.equal(POOL_ID.toString())
    // `add` is the DTO's sugar for the sentinel and must NOT be accompanied by
    // a `validUntil`: two sources for one field is a body whose meaning depends
    // on which one the server reads, and the DTO 422s the pair.
    expect(actions[0]!.payload).to.deep.equal({
      poolId: POOL_ID.toString(),
      scId: SC_ID.raw,
      centrifugeId: String(SPOKE_CENT_ID),
      address: ALICE,
      refundAddress: REFUND,
      op: 'add',
    })
  })

  it('sends any other expiry as op:remove carrying the instant', async () => {
    const { centrifuge, actions } = backendCentrifuge()
    const { shareClass } = entities(centrifuge)

    await firstValueFrom(shareClass.updateMember(ALICE, EXPIRES_2030, SPOKE_CENT_ID, { refundAddress: REFUND }))

    // "remove" on the wire is "expire at this future instant", never a
    // backdated one: `BaseTransferHook.updateMember` is
    // `require(block.timestamp <= validUntil)`, so a past value reverts on the
    // spoke AFTER the message has been paid for.
    expect(actions[0]!.payload).to.deep.include({ op: 'remove', validUntil: String(EXPIRES_2030) })
  })

  it('sends freezeMember and unfreezeMember as separate actions with no validUntil', async () => {
    const { centrifuge, actions } = backendCentrifuge()
    const { shareClass } = entities(centrifuge)

    await firstValueFrom(shareClass.freezeMember(ALICE, SPOKE_CENT_ID, { refundAddress: REFUND }))
    await firstValueFrom(shareClass.unfreezeMember(ALICE, SPOKE_CENT_ID, { refundAddress: REFUND }))

    expect(actions.map((a) => a.action)).to.deep.equal(['freezeMember', 'unfreezeMember'])
    // No expiry on either: the hook keeps the frozen bit and the membership
    // expiry in different parts of one `hookData` word, so a freeze that
    // carried an expiry would reset a membership nobody asked to change.
    for (const action of actions) {
      expect(action.payload).to.deep.equal({
        poolId: POOL_ID.toString(),
        scId: SC_ID.raw,
        centrifugeId: String(SPOKE_CENT_ID),
        address: ALICE,
        refundAddress: REFUND,
      })
    }
  })

  it('sends crosschainTransferShares with source and destination both named, amount as a string', async () => {
    const { centrifuge, actions } = backendCentrifuge()
    const { shareClass } = entities(centrifuge)

    await firstValueFrom(
      shareClass.crosschainTransferShares(SPOKE_CENT_ID, OTHER_CENT_ID, BOB, 5_000n, { refundAddress: REFUND })
    )

    expect(actions[0]!.action).to.equal('crosschainTransferShares')
    expect(actions[0]!.payload).to.deep.equal({
      poolId: POOL_ID.toString(),
      scId: SC_ID.raw,
      sourceCentrifugeId: String(SPOKE_CENT_ID),
      destinationCentrifugeId: String(OTHER_CENT_ID),
      receiver: BOB,
      amount: '5000',
      refundAddress: REFUND,
    })
  })

  it('routes the transfer on the SOURCE network, not on the pool hub', async () => {
    // The routed transaction carries the network it will be signed on, and
    // `backendTransaction` refuses a prepared transaction whose chain id does
    // not match it. `Spoke.crosschainTransferShares` is sent on the SOURCE
    // network — the only write in this vertical that is not a hub call — so
    // taking the pool's hub here would reject every correctly prepared
    // transfer from a spoke, and would be invisible in the payload, which
    // names both networks either way.
    const { centrifuge } = backendCentrifuge()
    const { shareClass } = entities(centrifuge)

    const tx: any = shareClass.crosschainTransferShares(SPOKE_CENT_ID, OTHER_CENT_ID, BOB, 1n, {
      refundAddress: REFUND,
    })
    await firstValueFrom(tx)

    expect(tx.centrifugeId).to.equal(SPOKE_CENT_ID)
    expect(tx.centrifugeId).to.not.equal(POOL_ID.centrifugeId)
    // ...and the restriction edits go the other way: hub-side transaction,
    // spoke-side effect.
    const member: any = shareClass.updateMember(ALICE, NEVER_EXPIRES, SPOKE_CENT_ID, { refundAddress: REFUND })
    await firstValueFrom(member)
    expect(member.centrifugeId).to.equal(HUB_CENT_ID)
  })

  it('never reaches the backend without an injected txStrategy, whatever the table says', async () => {
    // A bare `new Centrifuge({ … })` builds locally, whatever the table says.
    // Proven by the wallet receiving the transaction, not by a strategy going
    // uncalled — there is no strategy on this path to observe.
    const { centrifuge } = localCentrifuge()
    const { shareClass } = entities(centrifuge)

    const sent = await sendLocally(centrifuge, shareClass.freezeMember(ALICE, SPOKE_CENT_ID), HUB_CHAIN_ID)

    expect(sent).to.have.length(1)
  })
})

describe('investors writes: refusals', () => {
  for (const [name, call] of [
    ['updateMember', (sc: ShareClass) => sc.updateMember(ALICE, NEVER_EXPIRES, SPOKE_CENT_ID)],
    ['freezeMember', (sc: ShareClass) => sc.freezeMember(ALICE, SPOKE_CENT_ID)],
    ['unfreezeMember', (sc: ShareClass) => sc.unfreezeMember(ALICE, SPOKE_CENT_ID)],
    [
      'crosschainTransferShares',
      (sc: ShareClass) => sc.crosschainTransferShares(SPOKE_CENT_ID, OTHER_CENT_ID, BOB, 1n),
    ],
  ] as const) {
    it(`refuses ${name} in backend mode without a refundAddress`, async () => {
      const { centrifuge, actions } = backendCentrifuge()
      const { shareClass } = entities(centrifuge)

      let error: any
      try {
        await firstValueFrom(call(shareClass))
      } catch (e) {
        error = e
      }

      expect(error?.message, name).to.contain('refundAddress')
      expect(error?.message, name).to.contain('backend mode')
      // Nothing was prepared: the refusal happens before the strategy is
      // reached, so no policy evaluation and no Fordefi ceremony is spent.
      expect(actions).to.have.length(0)
    })
  }

  it('keeps all four working with no refundAddress locally', async () => {
    // The other half: a new option must not become a requirement for callers
    // that have never passed one. The refund stays the signing address, and the
    // bytes are the builder's with that address substituted.
    const { centrifuge } = localCentrifuge()
    const { shareClass } = entities(centrifuge)

    const sent = await sendLocally(
      centrifuge,
      shareClass.updateMember(ALICE, NEVER_EXPIRES, SPOKE_CENT_ID),
      HUB_CHAIN_ID
    )
    const withSigner = builders.updateMember(protocolContext(HUB_CENT_ID), {
      poolId: POOL_ID.toString(),
      scId: SC_ID.raw,
      centrifugeId: String(SPOKE_CENT_ID),
      address: ALICE,
      validUntil: String(NEVER_EXPIRES),
      refundAddress: SIGNER_ADDRESS,
    })

    expect(sent).to.have.length(1)
    expect(sent[0]!.data).to.equal(withSigner.data)
  })

  it('refuses a multi-member batch in backend mode rather than building it locally', async () => {
    // The backend's action is one investor on one network, by design. The fallback
    // every unrouted action takes would be a security downgrade here: this
    // action IS routed, so building it locally would take a whitelist edit
    // around the policy engine and the approval quorum — and on the custodial
    // route there is no browser wallet to sign it with anyway.
    const { centrifuge, actions } = backendCentrifuge()
    const { shareClass } = entities(centrifuge)

    let error: any
    try {
      await firstValueFrom(
        shareClass.updateMembers(
          [
            { address: ALICE, validUntil: NEVER_EXPIRES, centrifugeId: SPOKE_CENT_ID },
            { address: BOB, validUntil: NEVER_EXPIRES, centrifugeId: OTHER_CENT_ID },
          ],
          { refundAddress: REFUND }
        )
      )
    } catch (e) {
      error = e
    }

    expect(error?.message).to.contain('cannot batch 2 members')
    expect(actions).to.have.length(0)
  })

  it('still batches the same call on the local path', async () => {
    // The control for the case above: the local batch is intact, so the
    // difference is the ROUTE and not a capability that was deleted.
    const { centrifuge } = localCentrifuge()
    const { shareClass } = entities(centrifuge)

    const sent = await sendLocally(
      centrifuge,
      shareClass.updateMembers([
        { address: ALICE, validUntil: NEVER_EXPIRES, centrifugeId: SPOKE_CENT_ID },
        { address: BOB, validUntil: NEVER_EXPIRES, centrifugeId: OTHER_CENT_ID },
      ]),
      HUB_CHAIN_ID
    )

    expect(sent).to.have.length(1)
    // One transaction, two inner calls, and TWO messages priced — one per
    // network.
    expect(sent[0]!.value).to.equal(ESTIMATE * 2n)
  })

  it('refuses an empty members list on both routes', async () => {
    const { centrifuge, actions } = backendCentrifuge()
    const { shareClass } = entities(centrifuge)

    let error: any
    try {
      await firstValueFrom(shareClass.updateMembers([], { refundAddress: REFUND }))
    } catch (e) {
      error = e
    }
    expect(error?.message).to.contain('No data to update members')
    expect(actions).to.have.length(0)
  })
})

describe('investors writes: calldata parity (backend builder vs local build)', () => {
  it('updateMember is byte-equal for the add sentinel and for a scheduled expiry', async () => {
    const { centrifuge } = localCentrifuge()
    const { shareClass } = entities(centrifuge)

    for (const validUntil of [NEVER_EXPIRES, EXPIRES_2030]) {
      const sent = await sendLocally(
        centrifuge,
        shareClass.updateMember(ALICE, validUntil, SPOKE_CENT_ID),
        HUB_CHAIN_ID
      )
      const built = builders.updateMember(protocolContext(HUB_CENT_ID), {
        poolId: POOL_ID.toString(),
        scId: SC_ID.raw,
        centrifugeId: String(SPOKE_CENT_ID),
        address: ALICE,
        validUntil: String(validUntil),
        refundAddress: SIGNER_ADDRESS,
      })

      const last = sent[sent.length - 1]!
      expect(last.data, String(validUntil)).to.equal(built.data)
      expect(last.to.toLowerCase()).to.equal(built.to.toLowerCase())
      // `value` is where the two sides deliberately differ: the SDK attaches
      // the crosschain estimate it read from `MultiAdapter`, while the builder
      // stays pure and `private-api` prices the same manifest server-side.
      // The CALLDATA is what has to match.
      expect(last.value).to.equal(ESTIMATE)
      expect(built.value).to.equal(0n)
    }
  })

  it('freezeMember and unfreezeMember are byte-equal, and are not each other', async () => {
    const { centrifuge } = localCentrifuge()
    const { shareClass } = entities(centrifuge)
    const args = {
      poolId: POOL_ID.toString(),
      scId: SC_ID.raw,
      centrifugeId: String(SPOKE_CENT_ID),
      address: ALICE,
      refundAddress: SIGNER_ADDRESS,
    }

    const frozen = await sendLocally(centrifuge, shareClass.freezeMember(ALICE, SPOKE_CENT_ID), HUB_CHAIN_ID)
    const thawed = await sendLocally(centrifuge, shareClass.unfreezeMember(ALICE, SPOKE_CENT_ID), HUB_CHAIN_ID)
    const builtFreeze = builders.freezeMember(protocolContext(HUB_CENT_ID), args)
    const builtUnfreeze = builders.unfreezeMember(protocolContext(HUB_CENT_ID), args)

    expect(frozen[0]!.data).to.equal(builtFreeze.data)
    expect(thawed[thawed.length - 1]!.data).to.equal(builtUnfreeze.data)
    // The control that makes the two assertions above independent: the payload
    // discriminator is a single byte (2 vs 3), and a builder that emitted the
    // same byte for both would pass each comparison against a matching SDK bug.
    expect(builtFreeze.data).to.not.equal(builtUnfreeze.data)
    expect(frozen[0]!.data).to.not.equal(thawed[thawed.length - 1]!.data)
  })

  it('crosschainTransferShares is byte-equal from a spoke and from the hub', async () => {
    const { centrifuge } = localCentrifuge()
    const { shareClass } = entities(centrifuge)

    for (const [source, chainId] of [
      [SPOKE_CENT_ID, SPOKE_CHAIN_ID],
      [HUB_CENT_ID, HUB_CHAIN_ID],
    ] as const) {
      const sent = await sendLocally(
        centrifuge,
        shareClass.crosschainTransferShares(source, OTHER_CENT_ID, BOB, 7_000n),
        chainId
      )
      const built = builders.crosschainTransferShares(protocolContext(source), {
        poolId: POOL_ID.toString(),
        scId: SC_ID.raw,
        destinationCentrifugeId: String(OTHER_CENT_ID),
        receiver: BOB,
        amount: '7000',
        refundAddress: SIGNER_ADDRESS,
      })

      const last = sent[sent.length - 1]!
      expect(last.data, `source ${source}`).to.equal(built.data)
      // The target is the SOURCE network's Spoke, not the hub — the one write
      // in this vertical that is not a hub call. Getting it round the wrong way
      // would burn the shares on the chain they were meant to arrive on.
      expect(last.to.toLowerCase()).to.equal(built.to.toLowerCase())
      expect(last.to.toLowerCase()).to.equal(protocolContext(source).addresses.spoke!.toLowerCase())
    }
  })

  it('pads every bytes32 address in the same direction as the consuming call', async () => {
    // The control these actions need most. Both the restriction payload's
    // `user` and the transfer's `receiver` are bytes32 the spoke decodes with
    // `CastLib.toAddress`, which is `address(bytes20(addr))` guarded by
    // `require(uint96(uint256(addr)) == 0)` — so a LEFT-padded value reverts,
    // and only on the spoke, after the cross-chain message has been paid for
    // and dispatched. A fixture that shared the builder's misunderstanding of
    // the padding direction would hide exactly that, which is why the direction
    // is asserted against the raw bytes rather than against another encoder.
    const { centrifuge } = localCentrifuge()
    const { shareClass } = entities(centrifuge)
    const rightPadded = (a: HexString) => `${a.slice(2).toLowerCase()}${'0'.repeat(24)}`
    const leftPadded = (a: HexString) => `${'0'.repeat(24)}${a.slice(2).toLowerCase()}`

    const member = await sendLocally(
      centrifuge,
      shareClass.updateMember(ALICE, NEVER_EXPIRES, SPOKE_CENT_ID),
      HUB_CHAIN_ID
    )
    expect(member[0]!.data.toLowerCase()).to.contain(rightPadded(ALICE))
    expect(member[0]!.data.toLowerCase()).to.not.contain(leftPadded(ALICE))

    // The transfer's `receiver` is a static bytes32 ARGUMENT, so it occupies a
    // whole 32-byte word and the check is made word-wise rather than by
    // substring. A substring check is a false positive here and was one while
    // this test was being written: the preceding `scId` word is a right-padded
    // bytes16, so its 32 trailing zero nibbles run straight into the receiver's
    // leading `22`s and spell a left-padded address that is not in the calldata
    // at all. The packed payload above cannot be read word-wise (it is bytes
    // inside a dynamic argument), which is why the two use different checks.
    const transfer = await sendLocally(
      centrifuge,
      shareClass.crosschainTransferShares(SPOKE_CENT_ID, OTHER_CENT_ID, BOB, 1n),
      SPOKE_CHAIN_ID
    )
    const argWords = (data: HexString) => (data.slice(10).toLowerCase().match(/.{64}/g) ?? [])
    const transferWords = argWords(transfer[transfer.length - 1]!.data)
    expect(transferWords).to.contain(rightPadded(BOB))
    expect(transferWords).to.not.contain(leftPadded(BOB))
    // And the control that the word-wise check can still see a difference: the
    // refund address IS a plain `address`, so it is left-padded in its own word.
    expect(transferWords).to.contain(leftPadded(SIGNER_ADDRESS))
    expect(transferWords).to.not.contain(rightPadded(SIGNER_ADDRESS))
  })
})

describe('investors writes: cross-chain MESSAGE MANIFEST parity', () => {
  /**
   * `value` equal on both sides for different reasons is not parity evidence.
   * A backend listing three messages where the SDK lists two under-pays and
   * strands a message after the transaction confirms. So these cases compare
   * the manifests themselves: which network is paid, and how many messages of
   * which type.
   */
  it('the three restriction edits each declare exactly one UpdateRestriction to the named network', async () => {
    const { centrifuge, estimates } = localCentrifuge()
    const { shareClass } = entities(centrifuge)
    const args = {
      poolId: POOL_ID.toString(),
      scId: SC_ID.raw,
      centrifugeId: String(SPOKE_CENT_ID),
      address: ALICE,
      refundAddress: SIGNER_ADDRESS,
    }

    await sendLocally(centrifuge, shareClass.updateMember(ALICE, NEVER_EXPIRES, SPOKE_CENT_ID), HUB_CHAIN_ID)
    const afterMember = estimates.splice(0)
    await sendLocally(centrifuge, shareClass.freezeMember(ALICE, SPOKE_CENT_ID), HUB_CHAIN_ID)
    const afterFreeze = estimates.splice(0)
    await sendLocally(centrifuge, shareClass.unfreezeMember(ALICE, SPOKE_CENT_ID), HUB_CHAIN_ID)
    const afterUnfreeze = estimates.splice(0)

    const expected = [
      { from: HUB_CENT_ID, to: SPOKE_CENT_ID, types: [MessageType.UpdateRestriction] },
    ]
    expect(afterMember).to.deep.equal(expected)
    expect(afterFreeze).to.deep.equal(expected)
    expect(afterUnfreeze).to.deep.equal(expected)

    expect(builderManifest(builders.updateMember(protocolContext(HUB_CENT_ID), { ...args, validUntil: '1' }), HUB_CENT_ID)).to.deep.equal(expected)
    expect(builderManifest(builders.freezeMember(protocolContext(HUB_CENT_ID), args), HUB_CENT_ID)).to.deep.equal(expected)
    expect(builderManifest(builders.unfreezeMember(protocolContext(HUB_CENT_ID), args), HUB_CENT_ID)).to.deep.equal(expected)
  })

  it('crosschainTransferShares agrees on the manifest in BOTH branches, count included', async () => {
    // The branch is the whole risk: from the hub the transfer dispatches
    // straight to the destination (`ExecuteTransferShares`), from a spoke it
    // routes via the hub (`InitiateTransferShares`) and the hub-to-destination
    // leg is paid out of the hub's own subsidy. A side that listed both legs
    // would over-charge; a side that listed the wrong network would pay the
    // wrong route.
    const { centrifuge, estimates } = localCentrifuge()
    const { shareClass } = entities(centrifuge)

    for (const [source, chainId] of [
      [SPOKE_CENT_ID, SPOKE_CHAIN_ID],
      [HUB_CENT_ID, HUB_CHAIN_ID],
    ] as const) {
      const sent = await sendLocally(
        centrifuge,
        shareClass.crosschainTransferShares(source, OTHER_CENT_ID, BOB, 7_000n),
        chainId
      )
      const sdkManifest = estimates.splice(0)
      const built = builders.crosschainTransferShares(protocolContext(source), {
        poolId: POOL_ID.toString(),
        scId: SC_ID.raw,
        destinationCentrifugeId: String(OTHER_CENT_ID),
        receiver: BOB,
        amount: '7000',
        refundAddress: SIGNER_ADDRESS,
      })

      expect(sdkManifest, `source ${source}`).to.deep.equal(builderManifest(built, source))
      // Stated as a count as well as a deep-equal, because the count is the
      // thing that goes wrong: one message, one network, on both sides.
      expect(sdkManifest).to.have.length(1)
      expect(sdkManifest[0]!.types).to.have.length(1)
      expect(sent[sent.length - 1]!.value).to.equal(ESTIMATE)
    }
  })

  it('the two branches are not the same manifest, so agreeing on one proves nothing about the other', async () => {
    // The control for the case above: if both branches produced the same
    // manifest, the deep-equal would pass for a builder that ignored the
    // branch entirely.
    const fromSpoke = builders.crosschainTransferShares(protocolContext(SPOKE_CENT_ID), {
      poolId: POOL_ID.toString(),
      scId: SC_ID.raw,
      destinationCentrifugeId: String(OTHER_CENT_ID),
      receiver: BOB,
      amount: '7000',
      refundAddress: SIGNER_ADDRESS,
    })
    const fromHub = builders.crosschainTransferShares(protocolContext(HUB_CENT_ID), {
      poolId: POOL_ID.toString(),
      scId: SC_ID.raw,
      destinationCentrifugeId: String(OTHER_CENT_ID),
      receiver: BOB,
      amount: '7000',
      refundAddress: SIGNER_ADDRESS,
    })

    expect(builderManifest(fromSpoke, SPOKE_CENT_ID)).to.deep.equal([
      { from: SPOKE_CENT_ID, to: HUB_CENT_ID, types: [MessageType.InitiateTransferShares] },
    ])
    expect(builderManifest(fromHub, HUB_CENT_ID)).to.deep.equal([
      { from: HUB_CENT_ID, to: OTHER_CENT_ID, types: [MessageType.ExecuteTransferShares] },
    ])
  })
})

describe('investors: the REST route table matches what the endpoints accept', () => {
  it('derives the pool the investor routes are guarded on from the share class id', () => {
    // `packages/queries` restates the bytes16 layout because it cannot import
    // `ShareClassId`; this is the cross-check against the real class, the same
    // one `tokenInstances` has.
    const path = REST_ROUTES.whitelistedInvestors!.path({ tokenId: SC_ID.raw, limit: 20, offset: 0 })
    expect(path.startsWith(`pools/${POOL_ID.toString()}/share-classes/${SC_ID.raw}/investors`)).to.equal(true)
    expect(SC_ID.poolId.toString()).to.equal(POOL_ID.toString())
  })
})
