import { stubProjectedPools } from '../tests/utils.js'
import { expect } from 'chai'
import { firstValueFrom, of } from 'rxjs'
import sinon from 'sinon'
import { builders, resolveProtocolContext, type ProtocolContext } from '@centrifuge/protocol'
import { isPublicApiSupported } from '@centrifuge/queries/graphql'
import { Centrifuge } from '../Centrifuge.js'
import { RestDataSource } from '../data/RestDataSource.js'
import { backendRoutingTable } from '../data/routing.js'
import type { HexString } from '../types/index.js'
import type { PoolAction, PrepareOutcome, TxStrategy } from '../tx/TxStrategy.js'
import { Price } from '../utils/BigInt.js'
import { makeThenable } from '../utils/rx.js'
import { PoolId, ShareClassId } from '../utils/types.js'
import { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'
import { ShareClass } from './ShareClass.js'

/**
 * NAV write acceptance: routing, payload, refusals, and calldata parity
 * between the backend's builder and what the SDK actually puts on the wire.
 *
 * The "SDK side" of every parity comparison is not a re-encode written in this
 * file — that would only prove the test agrees with itself. `updateSharePrice` routes through
 * `wrapTransaction`, so it is `buildOnly`'s output: the exact bytes the signing
 * path would broadcast, from the same encoder. The "backend side" is
 * `@centrifuge/protocol`'s `updateSharePrice` builder — the same function
 * `ProtocolTxBuilder.buildUpdateSharePrice` calls — over the same bundled
 * deployment registry, so the `Hub` address is the deployed one on both sides.
 *
 * `value` is `0n` on both, and for DIFFERENT reasons: the builder is pure and
 * leaves `MultiAdapter.estimate` to private-api, while `buildOnly` skips the
 * estimate in `wrapTransaction`'s batching branch. So a `value` equality proves
 * nothing here, and the fee comparison that DOES mean something is the
 * cross-chain message MANIFEST each side hands its pricer, checked below for a
 * write whose whole point is notification.
 *
 * Everything runs off the bundled deployment registry: no indexer, no RPC, no
 * fork.
 */

const ENVIRONMENT = 'mainnet'
const PROTOCOL_VERSION = '3.2'
/** Pool on centrifugeId 1 (ethereum); the share class is deployed on 1 and 2. */
const POOL_ID = PoolId.from(1, 7)
const SC_ID = ShareClassId.from(POOL_ID, 1)
const OTHER_SC_ID = ShareClassId.from(POOL_ID, 2)
const HUB_CENT_ID = 1
const SPOKE_CENT_ID = 2
const HUB_CHAIN_ID = 1
const SPOKE_CHAIN_ID = 8453

const REFUND = '0x5675675675675675675675675675675675675675' as HexString
const SIGNER = '0x000000000000000000000000000000000000dead' as HexString

/** 1.045513765272640000 pool per share, as the on-chain D18 integer. */
const PRICE = new Price(1045513765272640000n)
/** Fixed so the encoded `computedAt` is a constant, not a clock read. */
const UPDATED_AT = new Date('2026-05-05T09:41:07.512Z')
/** What `Hub.updateSharePrice` receives: whole seconds, floored. */
const COMPUTED_AT = Math.floor(UPDATED_AT.getTime() / 1000)
/** What travels in the payload: the same instant, already truncated. */
const FINAL_DATE = new Date(COMPUTED_AT * 1000).toISOString()

/** The pure-builder context for the hub-side action. */
function protocolContext(centrifugeId: number): ProtocolContext {
  return resolveProtocolContext(POOL_ID.toString(), PROTOCOL_VERSION, {
    environment: ENVIRONMENT,
    centrifugeId,
  })
}

const thenable = <T>(value: T) => makeThenable(of(value))

/**
 * Stub only the chain plumbing. `_protocolContext` is deliberately NOT stubbed:
 * the `Hub` address on both sides of every parity assertion has to come from
 * the one bundled registry, or the comparison proves nothing about the real
 * deployment.
 */
function stubChain(centrifuge: Centrifuge) {
  const chainOf = (centrifugeId: number) => (centrifugeId === HUB_CENT_ID ? HUB_CHAIN_ID : SPOKE_CHAIN_ID)
  sinon.stub(centrifuge as any, '_idToChain').callsFake((id: any) => thenable(chainOf(Number(id))))
  sinon
    .stub(centrifuge as any, 'getChainConfig')
    .callsFake((id: any) => thenable({ id: chainOf(Number(id)), name: 'test' }))
  sinon.stub(centrifuge as any, 'getClient').callsFake(() =>
    thenable({
      getCode: async () => undefined,
      waitForTransactionReceipt: async ({ hash }: { hash: HexString }) => ({ status: 'success', hash }),
      readContract: async () => undefined,
    })
  )
}

function entities(centrifuge: Centrifuge) {
  const pool = new Pool(centrifuge, POOL_ID.raw)
  const shareClass = new ShareClass(centrifuge, pool, SC_ID.raw)
  return { pool, shareClass }
}

/**
 * Put the pool into a state where `activeShareClasses` names this share class
 * on exactly `deployedOn`.
 *
 * `pool.activeNetworks()` and each network's `details()` are what
 * `_notifySharePriceNetworks()` composes, so those are what is faked — not the
 * resolver itself, which is the code under test.
 *
 * `networks` is the pool's ACTIVE network list in its own order, and
 * `deployedOn` the subset carrying a share token for this share class. Keeping
 * them separate is what lets a case prove the notify set is filtered rather
 * than copied.
 */
function stubNetworks(
  centrifuge: Centrifuge,
  pool: Pool,
  networks: number[],
  deployedOn: number[] = networks
): void {
  const deployed = new Set(deployedOn)
  const poolNetworks = networks.map((centrifugeId) => {
    const network = new PoolNetwork(centrifuge, pool, centrifugeId)
    sinon.stub(network, 'details').returns(
      thenable({
        isActive: true,
        // A second share class on every network, so a `some(...)` that ignored
        // the id would notify the same set and pass anyway.
        activeShareClasses: [
          { id: OTHER_SC_ID },
          ...(deployed.has(centrifugeId) ? [{ id: SC_ID }] : []),
        ],
      }) as any
    )
    return network
  })
  sinon.stub(pool, 'activeNetworks').returns(thenable(poolNetworks) as any)
}

/** A strategy that records the action and answers on the custodial route. */
function recordingStrategy() {
  const actions: PoolAction[] = []
  const strategy: TxStrategy = {
    prepare(action: PoolAction) {
      actions.push(action)
      return of({
        route: 'custodial',
        txId: 'tx-sdk-10',
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
  stubChain(centrifuge)
  return centrifuge
}

/** Run a transaction and return the error it threw, or undefined. */
async function failure(tx: unknown): Promise<any> {
  try {
    await firstValueFrom(tx as any)
    return undefined
  } catch (error) {
    return error
  }
}

afterEach(() => {
  sinon.restore()
})

describe('NAV writes: routing', () => {
  it('routes the ONE action the backend ships a builder for, and none of the other six', () => {
    const table = backendRoutingTable()

    expect(table.writes.updateSharePrice).to.equal('backend')
    // The rest of the NAV write list. Each has no `PoolAction`, no DTO case and
    // no builder in `packages/protocol`, so there is nothing to route to —
    // a backend gap, not an omission here. Named individually so the day one of
    // them gains a builder, this test says where the row goes.
    for (const action of [
      'notifySharePrice',
      'notifyAssetPrice',
      'setMaxSharePriceAge',
      'setMaxAssetPriceAge',
      'updateValuation',
      'updateOracleValuationFeeder',
    ]) {
      expect(table.writes[action as keyof typeof table.writes], action).to.equal(undefined)
    }
  })

  it('sends the price, the truncated finalDate and the resolved notify set', async () => {
    const { centrifuge, actions } = backendCentrifuge()
    const { pool, shareClass } = entities(centrifuge)
    stubNetworks(centrifuge, pool, [HUB_CENT_ID, SPOKE_CENT_ID])

    await firstValueFrom(shareClass.updateSharePrice(PRICE, UPDATED_AT, { refundAddress: REFUND }))

    expect(actions).to.have.length(1)
    expect(actions[0]!.action).to.equal('updateSharePrice')
    expect(actions[0]!.poolId).to.equal(POOL_ID.toString())
    expect(actions[0]!.payload).to.deep.equal({
      poolId: POOL_ID.toString(),
      scId: SC_ID.raw,
      input: { kind: 'navPerShare', price: PRICE.toBigInt().toString() },
      finalDate: FINAL_DATE,
      notifyNetworks: [String(HUB_CENT_ID), String(SPOKE_CENT_ID)],
      refundAddress: REFUND,
    })
    // Whole seconds: the payload's instant is exactly the one the calldata
    // carries, so the backend's own `Math.floor(getTime() / 1000)` cannot
    // disagree with this method's truncation by a second.
    expect(new Date(FINAL_DATE).getTime() % 1000).to.equal(0)
    expect(Math.floor(new Date(FINAL_DATE).getTime() / 1000)).to.equal(COMPUTED_AT)
  })

  it('notifies only the networks the share class is actually deployed on', async () => {
    // The set is FILTERED, not copied from the active-network list: an extra
    // network is a paid cross-chain message to a spoke with no share token, and
    // the backend refuses one with 422 SHARE_CLASS_NOT_ON_NETWORK.
    const { centrifuge, actions } = backendCentrifuge()
    const { pool, shareClass } = entities(centrifuge)
    stubNetworks(centrifuge, pool, [HUB_CENT_ID, SPOKE_CENT_ID], [SPOKE_CENT_ID])

    await firstValueFrom(shareClass.updateSharePrice(PRICE, UPDATED_AT, { refundAddress: REFUND }))

    expect((actions[0]!.payload as any).notifyNetworks).to.deep.equal([String(SPOKE_CENT_ID)])
  })

  it('sends an empty notify set and NO refundAddress for a hub-only share class', async () => {
    // `.nonempty()` is deliberately not applied to `notifyNetworks`, and
    // `refundAddress` must be ABSENT here: `Hub.updateSharePrice` alone
    // dispatches no cross-chain message, so the backend's DTO refuses an address
    // (there would be no unspent gas to return).
    const { centrifuge, actions } = backendCentrifuge()
    const { pool, shareClass } = entities(centrifuge)
    stubNetworks(centrifuge, pool, [HUB_CENT_ID, SPOKE_CENT_ID], [])

    await firstValueFrom(shareClass.updateSharePrice(PRICE, UPDATED_AT))

    expect((actions[0]!.payload as any).notifyNetworks).to.deep.equal([])
    expect(actions[0]!.payload).to.not.have.property('refundAddress')
  })

  it('never reaches the backend without an injected txStrategy, whatever the table says', async () => {
    // A bare `new Centrifuge({ … })` builds locally, so a route row cannot
    // change what a default-configured caller does. Proven by calldata coming out of
    // `buildOnly`, since on that path there is no strategy to observe.
    const centrifuge = localCentrifuge()
    const { pool, shareClass } = entities(centrifuge)
    stubNetworks(centrifuge, pool, [SPOKE_CENT_ID])

    const built = await centrifuge.buildOnly(shareClass.updateSharePrice(PRICE, UPDATED_AT), {
      fromAddress: SIGNER,
    })

    expect(built.calls).to.have.length(2)
  })
})

describe('NAV writes: refusals rather than plausible defaults', () => {
  it('refuses a notifying price update in backend mode without an explicit refundAddress', async () => {
    const { centrifuge, actions } = backendCentrifuge()
    const { pool, shareClass } = entities(centrifuge)
    stubNetworks(centrifuge, pool, [SPOKE_CENT_ID])

    const error = await failure(shareClass.updateSharePrice(PRICE, UPDATED_AT))

    expect(error?.message).to.contain('refundAddress')
    // And it refused BEFORE preparing anything: no orphaned backend row.
    expect(actions).to.have.length(0)
  })

  it('refuses a refundAddress on a share class with nothing to notify', async () => {
    // The other direction, and not pedantry: accepting the address would tell
    // the caller a refund had been arranged for a transaction that sends no
    // message. Both the pure builder and the backend's DTO refuse the combination, so
    // dropping it here would just move the 422 further away.
    const { centrifuge, actions } = backendCentrifuge()
    const { pool, shareClass } = entities(centrifuge)
    stubNetworks(centrifuge, pool, [HUB_CENT_ID], [])

    const error = await failure(shareClass.updateSharePrice(PRICE, UPDATED_AT, { refundAddress: REFUND }))

    expect(error?.message).to.contain('no notification is sent')
    expect(actions).to.have.length(0)
  })

  it('still defaults refundAddress to the signer on the local path, unchanged', async () => {
    // The new option must not become a requirement for callers that have never
    // passed one. `buildOnly`'s `fromAddress` is what `ctx.signingAddress`
    // resolves to in build mode, so the default is observable in the calldata.
    const centrifuge = localCentrifuge()
    const { pool, shareClass } = entities(centrifuge)
    stubNetworks(centrifuge, pool, [SPOKE_CENT_ID])

    const [withDefault, explicit] = await Promise.all([
      centrifuge.buildOnly(shareClass.updateSharePrice(PRICE, UPDATED_AT), { fromAddress: REFUND }),
      centrifuge.buildOnly(shareClass.updateSharePrice(PRICE, UPDATED_AT, { refundAddress: REFUND }), {
        fromAddress: SIGNER,
      }),
    ])

    expect(withDefault.data).to.equal(explicit.data)
  })
})

describe('NAV writes: calldata parity', () => {
  it('updateSharePrice with one notification is byte-equal', async () => {
    const centrifuge = localCentrifuge()
    const { pool, shareClass } = entities(centrifuge)
    stubNetworks(centrifuge, pool, [SPOKE_CENT_ID])

    const localBuilt = await centrifuge.buildOnly(
      shareClass.updateSharePrice(PRICE, UPDATED_AT, { refundAddress: REFUND })
    )
    const built = builders.updateSharePrice(protocolContext(HUB_CENT_ID), {
      poolId: POOL_ID.toString(),
      scId: SC_ID.raw,
      pricePerShare: PRICE.toBigInt().toString(),
      computedAt: String(COMPUTED_AT),
      notifyNetworks: [String(SPOKE_CENT_ID)],
      refundAddress: REFUND,
    })
    const otherPrice = builders.updateSharePrice(protocolContext(HUB_CENT_ID), {
      poolId: POOL_ID.toString(),
      scId: SC_ID.raw,
      pricePerShare: (PRICE.toBigInt() + 1n).toString(),
      computedAt: String(COMPUTED_AT),
      notifyNetworks: [String(SPOKE_CENT_ID)],
      refundAddress: REFUND,
    })

    expect(localBuilt.calls).to.have.length(2)
    expect(localBuilt.data).to.equal(built.data)
    expect(localBuilt.to.toLowerCase()).to.equal(built.to.toLowerCase())
    // The control that keeps the equality above from passing on a shared wrong
    // encoding: the price really is in the compared bytes.
    expect(built.data).to.not.equal(otherPrice.data)
  })

  it('the notify legs come out in the same ORDER on both sides', async () => {
    // The order is load-bearing twice over. `Hub.notifySharePrice` reads the
    // stored price back out, so the update must come FIRST or every spoke is
    // sent the price it is replacing; and with several networks the legs must
    // be in a deterministic order or two builds of the same update produce
    // different calldata.
    const centrifuge = localCentrifuge()
    const { pool, shareClass } = entities(centrifuge)
    stubNetworks(centrifuge, pool, [HUB_CENT_ID, SPOKE_CENT_ID])

    const localBuilt = await centrifuge.buildOnly(
      shareClass.updateSharePrice(PRICE, UPDATED_AT, { refundAddress: REFUND })
    )
    const built = builders.updateSharePrice(protocolContext(HUB_CENT_ID), {
      poolId: POOL_ID.toString(),
      scId: SC_ID.raw,
      pricePerShare: PRICE.toBigInt().toString(),
      computedAt: String(COMPUTED_AT),
      notifyNetworks: [String(HUB_CENT_ID), String(SPOKE_CENT_ID)],
      refundAddress: REFUND,
    })
    const reversed = builders.updateSharePrice(protocolContext(HUB_CENT_ID), {
      poolId: POOL_ID.toString(),
      scId: SC_ID.raw,
      pricePerShare: PRICE.toBigInt().toString(),
      computedAt: String(COMPUTED_AT),
      notifyNetworks: [String(SPOKE_CENT_ID), String(HUB_CENT_ID)],
      refundAddress: REFUND,
    })

    expect(localBuilt.calls).to.have.length(3)
    expect(localBuilt.data).to.equal(built.data)
    // The control: order is observable in the bytes, so the equality above is
    // an ORDER claim and not just a set claim.
    expect(built.data).to.not.equal(reversed.data)
  })

  it('a hub-only update is byte-equal, and is not the same as a notifying one', async () => {
    const centrifuge = localCentrifuge()
    const { pool, shareClass } = entities(centrifuge)
    stubNetworks(centrifuge, pool, [HUB_CENT_ID, SPOKE_CENT_ID], [])

    const localBuilt = await centrifuge.buildOnly(shareClass.updateSharePrice(PRICE, UPDATED_AT))
    const built = builders.updateSharePrice(protocolContext(HUB_CENT_ID), {
      poolId: POOL_ID.toString(),
      scId: SC_ID.raw,
      pricePerShare: PRICE.toBigInt().toString(),
      computedAt: String(COMPUTED_AT),
      notifyNetworks: [],
    })
    const notifying = builders.updateSharePrice(protocolContext(HUB_CENT_ID), {
      poolId: POOL_ID.toString(),
      scId: SC_ID.raw,
      pricePerShare: PRICE.toBigInt().toString(),
      computedAt: String(COMPUTED_AT),
      notifyNetworks: [String(SPOKE_CENT_ID)],
      refundAddress: REFUND,
    })

    // One call, so no multicall wrapper on either side — `encodeBatchCalldata`
    // sends a lone call verbatim in both packages, and that agreement is part
    // of what is being compared.
    expect(localBuilt.calls).to.have.length(1)
    expect(localBuilt.data).to.equal(built.data)
    expect(localBuilt.to.toLowerCase()).to.equal(built.to.toLowerCase())
    expect(built.data).to.not.equal(notifying.data)
  })

  it('the timestamp really is in the compared bytes', async () => {
    // Without this the `finalDate` claim would rest on the payload assertion
    // alone. `computedAt` is a `uint64` in the same word layout as everything
    // else, so a builder that ignored it would still match on every case above.
    const built = builders.updateSharePrice(protocolContext(HUB_CENT_ID), {
      poolId: POOL_ID.toString(),
      scId: SC_ID.raw,
      pricePerShare: PRICE.toBigInt().toString(),
      computedAt: String(COMPUTED_AT),
      notifyNetworks: [],
    })
    const aSecondLater = builders.updateSharePrice(protocolContext(HUB_CENT_ID), {
      poolId: POOL_ID.toString(),
      scId: SC_ID.raw,
      pricePerShare: PRICE.toBigInt().toString(),
      computedAt: String(COMPUTED_AT + 1),
      notifyNetworks: [],
    })

    expect(built.data).to.not.equal(aSecondLater.data)

    // And the SDK's own truncation lands on the same second for any instant
    // within it, which is what makes sending the truncated ISO safe.
    const centrifuge = localCentrifuge()
    const { pool, shareClass } = entities(centrifuge)
    stubNetworks(centrifuge, pool, [HUB_CENT_ID], [])
    const fromMillis = await centrifuge.buildOnly(shareClass.updateSharePrice(PRICE, UPDATED_AT))
    const fromTruncated = await centrifuge.buildOnly(shareClass.updateSharePrice(PRICE, new Date(FINAL_DATE)))
    expect(fromMillis.data).to.equal(fromTruncated.data)
    expect(fromMillis.data).to.equal(built.data)
  })

  it('the cross-chain message manifests agree, so both sides price the same fee', async () => {
    // `value` is 0n on both sides here for different reasons (see the file
    // docstring), so the fee itself is not comparable in this suite. What IS
    // comparable is the manifest each side hands its pricer, and this is the
    // vertical where it matters most: `notifySharePrice` is the whole payable
    // part of the action. A divergence of this shape — the SDK listing two
    // messages where the backend lists three — is an UNDER-estimate, and
    // under-payment strands a message after the transaction has confirmed.
    const centrifuge = localCentrifuge()
    const { pool, shareClass } = entities(centrifuge)
    stubNetworks(centrifuge, pool, [HUB_CENT_ID, SPOKE_CENT_ID])

    const localBuilt = await centrifuge.buildOnly(
      shareClass.updateSharePrice(PRICE, UPDATED_AT, { refundAddress: REFUND })
    )
    const built = builders.updateSharePrice(protocolContext(HUB_CENT_ID), {
      poolId: POOL_ID.toString(),
      scId: SC_ID.raw,
      pricePerShare: PRICE.toBigInt().toString(),
      computedAt: String(COMPUTED_AT),
      notifyNetworks: [String(HUB_CENT_ID), String(SPOKE_CENT_ID)],
      refundAddress: REFUND,
    })

    // One message per NOTIFIED NETWORK on both sides — the fee is charged per
    // route, so a price notified to two spokes is two estimates.
    expect(Object.keys(localBuilt.messages ?? {}).sort()).to.deep.equal(
      Object.keys(built.messages ?? {}).sort()
    )
    for (const centrifugeId of [HUB_CENT_ID, SPOKE_CENT_ID]) {
      expect(localBuilt.messages?.[centrifugeId], `sdk ${centrifugeId}`).to.have.length(1)
      expect(built.messages?.[centrifugeId], `backend ${centrifugeId}`).to.have.length(1)
    }
  })

  it('leaves the networks the caller skips out of the set, on both paths', async () => {
    const THIRD_CENT_ID = 3
    const options = { refundAddress: REFUND, skipNetworks: [SPOKE_CENT_ID] }
    const { centrifuge, actions } = backendCentrifuge()
    const { pool, shareClass } = entities(centrifuge)
    stubNetworks(centrifuge, pool, [HUB_CENT_ID, SPOKE_CENT_ID, THIRD_CENT_ID])

    await firstValueFrom(shareClass.updateSharePrice(PRICE, UPDATED_AT, options))

    expect(actions[0]!.payload).to.deep.include({ notifyNetworks: [String(HUB_CENT_ID), String(THIRD_CENT_ID)] })

    const local = localCentrifuge()
    const localEntities = entities(local)
    stubNetworks(local, localEntities.pool, [HUB_CENT_ID, SPOKE_CENT_ID, THIRD_CENT_ID])
    const localBuilt = await local.buildOnly(localEntities.shareClass.updateSharePrice(PRICE, UPDATED_AT, options))
    const built = builders.updateSharePrice(protocolContext(HUB_CENT_ID), {
      poolId: POOL_ID.toString(),
      scId: SC_ID.raw,
      pricePerShare: PRICE.toBigInt().toString(),
      computedAt: String(COMPUTED_AT),
      notifyNetworks: [String(HUB_CENT_ID), String(THIRD_CENT_ID)],
      refundAddress: REFUND,
    })
    expect(localBuilt.data).to.equal(built.data)
    expect(Object.keys(localBuilt.messages ?? {}).map(Number)).to.deep.equal([HUB_CENT_ID, THIRD_CENT_ID])

    // The skipped network is not read at all, on either path: that is what lets an
    // operator untick a chain whose RPC or bridge is down.
    for (const candidate of [pool, localEntities.pool]) {
      const calls = new Map(
        (await candidate.activeNetworks()).map((n) => [n.centrifugeId, (n.details as sinon.SinonStub).callCount])
      )
      expect(calls.get(SPOKE_CENT_ID)).to.equal(0)
      expect(calls.get(HUB_CENT_ID)).to.be.greaterThan(0)
    }
  })

  it('ignores a skipped network the share class is not deployed on', async () => {
    const { centrifuge, actions } = backendCentrifuge()
    const { pool, shareClass } = entities(centrifuge)
    stubNetworks(centrifuge, pool, [HUB_CENT_ID, SPOKE_CENT_ID])

    await firstValueFrom(shareClass.updateSharePrice(PRICE, UPDATED_AT, { refundAddress: REFUND, skipNetworks: [9] }))

    expect(actions[0]!.payload).to.deep.include({ notifyNetworks: [String(HUB_CENT_ID), String(SPOKE_CENT_ID)] })
  })

  it('skipping every deployed network is a hub-only update, on both paths', async () => {
    const skipNetworks = [HUB_CENT_ID, SPOKE_CENT_ID]
    const { centrifuge, actions } = backendCentrifuge()
    const { pool, shareClass } = entities(centrifuge)
    stubNetworks(centrifuge, pool, [HUB_CENT_ID, SPOKE_CENT_ID])

    await firstValueFrom(shareClass.updateSharePrice(PRICE, UPDATED_AT, { skipNetworks }))

    expect(actions[0]!.payload).to.deep.include({ notifyNetworks: [] })
    expect(actions[0]!.payload).to.not.have.property('refundAddress')

    const local = localCentrifuge()
    const localEntities = entities(local)
    stubNetworks(local, localEntities.pool, [HUB_CENT_ID, SPOKE_CENT_ID])
    const localBuilt = await local.buildOnly(
      localEntities.shareClass.updateSharePrice(PRICE, UPDATED_AT, { skipNetworks })
    )
    const built = builders.updateSharePrice(protocolContext(HUB_CENT_ID), {
      poolId: POOL_ID.toString(),
      scId: SC_ID.raw,
      pricePerShare: PRICE.toBigInt().toString(),
      computedAt: String(COMPUTED_AT),
      notifyNetworks: [],
    })
    expect(localBuilt.data).to.equal(built.data)
    expect(Object.keys(localBuilt.messages ?? {})).to.deep.equal([])

    // A refund with nothing left to notify is refused, and the reason names the skip.
    const error = await failure(shareClass.updateSharePrice(PRICE, UPDATED_AT, { skipNetworks, refundAddress: REFUND }))
    expect(error?.message).to.contain('was skipped')
  })

  it('a hub-only update declares an EMPTY manifest on both sides', async () => {
    // The positive statement that there is nothing to pay for.
    // `Hub.updateSharePrice` is `payable` in the ABI but dispatches no message,
    // so a manifest entry here would make private-api attach a fee for a
    // message that is never sent — and would hide the case where a notify leg
    // was dropped.
    const centrifuge = localCentrifuge()
    const { pool, shareClass } = entities(centrifuge)
    stubNetworks(centrifuge, pool, [HUB_CENT_ID, SPOKE_CENT_ID], [])

    const localBuilt = await centrifuge.buildOnly(shareClass.updateSharePrice(PRICE, UPDATED_AT))
    const built = builders.updateSharePrice(protocolContext(HUB_CENT_ID), {
      poolId: POOL_ID.toString(),
      scId: SC_ID.raw,
      pricePerShare: PRICE.toBigInt().toString(),
      computedAt: String(COMPUTED_AT),
      notifyNetworks: [],
    })

    expect(Object.keys(localBuilt.messages ?? {})).to.deep.equal([])
    expect(Object.keys(built.messages ?? {})).to.deep.equal([])
  })
})

/**
 * The two NAV READS, end to end through the shipped route table.
 *
 * ## Why this is here and not (fully) in `rest-parity.integration.test.ts`
 *
 * Every other vertical's read parity is a live rest-vs-graphql comparison over
 * one `chain_v1`. These two entries were `support: "blocked"` until public-api
 * gained `filter` (PostGraphile v5, backend#572) and, for the ordering both
 * now use, the `timestamp` indexes backend#613 added on
 * `token_instance_snapshot` and `token_snapshot`. They are served now, so the
 * assertion below pins that, and the live rest-vs-graphql case for them —
 * which needs the full private-api stack this package's tests don't stand up
 * — is still owed in `rest-parity.integration.test.ts`.
 *
 * What IS checkable deterministically is the whole REST path: the endpoint's
 * body shape -> the route's `decode` -> the entity's `_process`. That chain
 * carries the ISO/epoch trap, and none of the three halves alone would catch
 * it. The bodies below are the shapes the backend's controller serialises,
 * with timestamps produced by `Date.prototype.toISOString()` exactly as the
 * `queries/sql` adapter emits them (`sql-queries.integration.test.ts` pins that
 * against the live projection).
 */
describe('NAV reads: the routed entries, end to end', () => {
  const BASE_URL = 'https://backend.example/api'
  const OTHER_POOL_SC = ShareClassId.from(PoolId.from(2, 9), 1)

  /** The SDK wired exactly as backend mode wires it, over a scripted fetch. */
  function restCentrifuge(answer: (url: string) => Response) {
    const urls: string[] = []
    const transport = {
      fetch: (async (input: any) => {
        urls.push(String(input))
        return answer(String(input))
      }) as unknown as typeof fetch,
    }
    // `RestDataSource` takes the root (it builds the graphql fallback over
    // `root._executeGraphql`), so the seam is injected through a thin delegate
    // — the same knot an app ties. The SHIPPED route table, not a staged one:
    // this is about what backend mode actually does.
    const wired: { source?: RestDataSource } = {}
    const centrifuge = new Centrifuge({
      environment: ENVIRONMENT,
      dataSource: { query: (name: any, vars: any) => wired.source!.query(name, vars) },
    })
    stubProjectedPools(centrifuge, [POOL_ID])
    wired.source = new RestDataSource(centrifuge, { baseUrl: BASE_URL, transport })
    const pool = new Pool(centrifuge, POOL_ID.raw)
    // `_shareClassIds()` and `decimals()` are HubRegistry / ShareClassManager
    // contract reads — they consume no catalogue entry in either mode, which is
    // why they are stubbed rather than routed.
    sinon.stub(pool, '_shareClassIds').returns(thenable([SC_ID]) as any)
    sinon.stub(pool, 'decimals').returns(thenable(6) as any)
    return { centrifuge, pool, urls }
  }

  function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  it('states that public-api serves both entries', () => {
    expect(isPublicApiSupported('sharePricesReport')).to.equal(true)
    expect(isPublicApiSupported('shareYieldsReport')).to.equal(true)
    expect(isPublicApiSupported('hubSharePricesReport')).to.equal(true)
  })

  it('builds the share prices report from backend rows, summing across networks', async () => {
    // Two networks on one day and two days in the series, which is the shape
    // that makes `_process` more than a pass-through: 100 + 200 on the 5th,
    // price taken from the larger-issuance chain.
    const { pool, urls } = restCentrifuge(() =>
      json({
        items: [
          {
            tokenId: SC_ID.raw,
            timestamp: new Date('2026-05-05T00:00:00Z').toISOString(),
            totalIssuance: '200000000',
            tokenPrice: '1100000000000000000',
            triggerChainId: '8453',
          },
          {
            tokenId: SC_ID.raw,
            timestamp: new Date('2026-05-05T00:00:00Z').toISOString(),
            totalIssuance: '100000000',
            tokenPrice: '1000000000000000000',
            triggerChainId: '1',
          },
          {
            tokenId: SC_ID.raw,
            timestamp: new Date('2026-05-04T00:00:00Z').toISOString(),
            totalIssuance: '100000000',
            tokenPrice: '1000000000000000000',
            triggerChainId: '1',
          },
        ],
      })
    )

    const report = await pool.reports.sharePrices()

    expect(urls).to.deep.equal([
      `${BASE_URL}/pools/${POOL_ID.toString()}/nav/prices?limit=1000&scId=${SC_ID.raw}`,
    ])
    expect(report.map((item) => item.timestamp)).to.deep.equal([
      '2026-05-04T00:00:00.000Z',
      '2026-05-05T00:00:00.000Z',
    ])
    const day2 = report[1]!.shareClasses[SC_ID.raw]!
    expect(day2.totalIssuance.toBigInt()).to.equal(300000000n)
    // The pool's decimals, not the share token's: `_process` is handed
    // `pool.decimals()` and a wrong scale here would misprice the whole report.
    expect(day2.totalIssuance.decimals).to.equal(6)
    expect(day2.price.toBigInt()).to.equal(1100000000000000000n)
  })

  it('builds the share yields report from backend rows, newest row per day winning', async () => {
    const { pool, urls } = restCentrifuge(() =>
      json({
        items: [
          {
            id: SC_ID.raw,
            timestamp: new Date('2026-05-05T12:00:00Z').toISOString(),
            yieldYtd: '70000000000000000000000000',
            yieldTtm: null,
          },
          {
            id: SC_ID.raw,
            timestamp: new Date('2026-05-05T00:00:00Z').toISOString(),
            yieldYtd: '55000000000000000000000000',
            yieldTtm: null,
          },
        ],
      })
    )

    const report = await pool.reports.shareYields()

    expect(urls).to.deep.equal([
      `${BASE_URL}/pools/${POOL_ID.toString()}/nav/yields?limit=1000&scId=${SC_ID.raw}`,
    ])
    expect(report).to.have.length(1)
    expect(report[0]!.timestamp).to.equal('2026-05-05T00:00:00.000Z')
    // Ray -> percent, and the FIRST row of the day (the noon one) wins.
    expect(report[0]!.shareClasses[SC_ID.raw]!.yieldYtd!.toNumber()).to.equal(7)
    // A null column is absent rather than zero: "no figure for this window yet"
    // is a real answer and 0% would read as a flat year.
    expect(report[0]!.shareClasses[SC_ID.raw]!.yieldTtm).to.equal(undefined)
  })

  it('narrows to one share class when the report filter names one', async () => {
    const { pool, urls } = restCentrifuge(() => json({ items: [] }))
    ;(pool._shareClassIds as any).restore()
    sinon.stub(pool, '_shareClassIds').returns(thenable([SC_ID, OTHER_SC_ID]) as any)

    await pool.reports.sharePrices({ shareClassId: OTHER_SC_ID })

    expect(urls[0]).to.contain(`scId=${OTHER_SC_ID.raw}`)
  })

  it('asks for the whole pool when the report covers every share class', async () => {
    const { pool, urls } = restCentrifuge(() => json({ items: [] }))
    ;(pool._shareClassIds as any).restore()
    sinon.stub(pool, '_shareClassIds').returns(thenable([SC_ID, OTHER_SC_ID]) as any)

    await pool.reports.sharePrices()

    expect(urls[0]).to.equal(`${BASE_URL}/pools/${POOL_ID.toString()}/nav/prices?limit=1000`)
  })

  it('refuses share class ids that do not all belong to one pool', async () => {
    // Unreachable through `pool.reports` — `_shareClassIds()` is one pool's —
    // but the route is the thing that would otherwise silently drop a pool's
    // rows, so the refusal is pinned from this side too.
    const { pool } = restCentrifuge(() => json({ items: [] }))
    ;(pool._shareClassIds as any).restore()
    sinon.stub(pool, '_shareClassIds').returns(thenable([SC_ID, OTHER_POOL_SC]) as any)

    const error = await failure(pool.reports.sharePrices())

    expect(error?.message).to.contain('more than one pool')
  })

  it('does not fall back to graphql when the NAV route fails', async () => {
    // The fallback would not even reach data: both entries are blocked on
    // public-api, so a silent fallback would disguise a broken route as a
    // capability gap. The route failing must surface as the route failing.
    const { pool } = restCentrifuge(() => json({ error: 'not_found', code: 'POOL_NOT_FOUND' }, 404))

    const error = await failure(pool.reports.sharePrices())

    expect(error?.name).to.equal('RestQueryError')
    expect(error?.code).to.equal('POOL_NOT_FOUND')
  })
})
