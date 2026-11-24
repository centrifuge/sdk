import { expect } from 'chai'
import { firstValueFrom, of, Subject } from 'rxjs'
import sinon from 'sinon'
import { Centrifuge } from '../Centrifuge.js'
import { Balance, Price } from '../utils/BigInt.js'
import { AssetId, PoolId, ShareClassId } from '../utils/types.js'
import { Pool } from './Pool.js'
import { ShareClass } from './ShareClass.js'

const centId = 1
const poolId = PoolId.from(centId, 1)
const scId = ShareClassId.from(poolId, 1)
const escrowAddress = '0x1111111111111111111111111111111111111111'
const legacyEscrowAddress = '0x3333333333333333333333333333333333333333'
const assetId = AssetId.from(centId, 1)

const usdc = {
  decimals: 6,
  assetTokenId: '0',
  address: '0x2222222222222222222222222222222222222222' as const,
  name: 'USD Coin',
  symbol: 'USDC',
  blockchain: { id: '1', centrifugeId: '1' },
}

function row(over: Record<string, unknown> = {}) {
  return {
    centrifugeId: '1',
    holding: { createdAt: null },
    assetId: assetId.toString(),
    escrowAddress,
    assetAmount: '2500000',
    assetPrice: '1000000000000000000',
    asset: usdc,
    ...over,
  }
}

/** One asset on one chain held in two escrows: a pool with a legacy and a v3.3 escrow. */
const dualEscrowRows = [
  row({ escrowAddress: legacyEscrowAddress, assetAmount: '1000000', assetPrice: '1000000000000000000' }),
  row({ escrowAddress, assetAmount: '4000000', assetPrice: '2000000000000000000' }),
]

describe('ShareClass.escrows', () => {
  let centrifuge: Centrifuge
  let pool: Pool
  let shareClass: ShareClass

  beforeEach(() => {
    // Offline: no balance sheet event watch (see the live-refresh suite below).
    centrifuge = new Centrifuge({ environment: 'testnet', disableRepeatOnEvents: true })
    pool = new Pool(centrifuge, poolId)
    shareClass = new ShareClass(centrifuge, pool, scId.raw)
  })

  afterEach(() => sinon.restore())

  it('labels each holding escrow row with its own escrow address', async () => {
    sinon.stub(shareClass, '_balances').returns(of([row()]) as any)

    const [escrow] = await firstValueFrom(shareClass.escrows())

    expect(escrow!.escrowAddress).to.equal(escrowAddress)
    expect(escrow!.centrifugeId).to.equal(1)
    expect(escrow!.assetId.equals(assetId)).to.equal(true)
    expect(escrow!.amount).to.be.instanceOf(Balance)
    expect(escrow!.amount.toFloat()).to.equal(2.5)
    expect(escrow!.amount.decimals).to.equal(6)
    expect(escrow!.price).to.be.instanceOf(Price)
    expect(escrow!.price.toFloat()).to.equal(1)
    expect(escrow!.asset).to.deep.equal({ address: usdc.address, name: usdc.name, symbol: usdc.symbol, decimals: 6 })
  })

  it('returns one entry per escrow when one asset sits in two escrows on a chain', async () => {
    sinon.stub(shareClass, '_balances').returns(of(dualEscrowRows) as any)

    const escrows = await firstValueFrom(shareClass.escrows())

    expect(
      escrows.map((e) => ({
        escrowAddress: e.escrowAddress,
        centrifugeId: e.centrifugeId,
        assetId: e.assetId.toString(),
        amount: e.amount.toFloat(),
        price: e.price.toFloat(),
      }))
    ).to.deep.equal([
      { escrowAddress: legacyEscrowAddress, centrifugeId: 1, assetId: assetId.toString(), amount: 1, price: 1 },
      { escrowAddress, centrifugeId: 1, assetId: assetId.toString(), amount: 4, price: 2 },
    ])
  })

  it('refuses a row whose asset or amounts are missing instead of reporting zero', async () => {
    sinon.stub(shareClass, '_balances').returns(of([row({ assetAmount: null, asset: null })]) as any)

    let error: unknown
    try {
      await firstValueFrom(shareClass.escrows())
    } catch (e) {
      error = e
    }

    expect(String(error)).to.match(/has no asset, assetAmount/)
    expect(String(error)).to.contain(assetId.toString())
    expect(String(error)).to.contain(escrowAddress)
  })
})

describe('ShareClass.balances', () => {
  let centrifuge: Centrifuge
  let pool: Pool
  let shareClass: ShareClass

  beforeEach(() => {
    // Offline: no balance sheet event watch (see the live-refresh suite below).
    centrifuge = new Centrifuge({ environment: 'testnet', disableRepeatOnEvents: true })
    pool = new Pool(centrifuge, poolId)
    shareClass = new ShareClass(centrifuge, pool, scId.raw)
    sinon.stub(pool, 'currency').returns(of({ decimals: 18 }) as any)
    sinon.stub(shareClass, '_assetPrice').returns(of(Price.fromFloat(1.5)) as any)
  })

  afterEach(() => sinon.restore())

  it('returns one entry per escrow, each with its own address and row amount', async () => {
    sinon.stub(shareClass, '_balances').returns(of(dualEscrowRows) as any)
    // An initialized hub holding, so the chain price applies.
    sinon.stub(shareClass, '_holding').returns(of({ valuation: '0x', accounts: {} }) as any)
    const assetPrice = shareClass._assetPrice as sinon.SinonStub

    const balances = await firstValueFrom(shareClass.balances())

    expect(
      balances.map((b) => ({
        escrowAddress: b.escrowAddress,
        assetId: b.assetId.toString(),
        amount: b.amount.toFloat(),
        price: b.price.toFloat(),
        value: b.value.toFloat(),
      }))
    ).to.deep.equal([
      { escrowAddress: legacyEscrowAddress, assetId: assetId.toString(), amount: 1, price: 1.5, value: 1.5 },
      { escrowAddress, assetId: assetId.toString(), amount: 4, price: 1.5, value: 6 },
    ])
    // The price is a per-asset chain read, keyed by chain and asset — not by escrow.
    expect(assetPrice.alwaysCalledWith(1, sinon.match((id: AssetId) => id.equals(assetId)))).to.equal(true)
  })

  it('refuses a row with no amount instead of reporting zero', async () => {
    sinon.stub(shareClass, '_balances').returns(of([row({ holding: null, assetAmount: null })]) as any)

    let error: unknown
    try {
      await firstValueFrom(shareClass.balances())
    } catch (e) {
      error = e
    }

    expect(String(error)).to.match(/has no assetAmount/)
    expect(String(error)).to.contain(escrowAddress)
  })

  it('returns the single-escrow entry with its escrow address', async () => {
    sinon.stub(shareClass, '_balances').returns(of([row({ holding: null })]) as any)

    const [balance] = await firstValueFrom(shareClass.balances())

    expect(balance!.escrowAddress).to.equal(escrowAddress)
    expect(balance!.amount.toFloat()).to.equal(2.5)
    expect(balance!.amount.decimals).to.equal(6)
    // No hub holding yet: priced at 1, the chain price is not used.
    expect(balance!.price.toFloat()).to.equal(1)
    expect(balance!.holding).to.equal(null)
    expect(balance!.asset).to.deep.equal({
      decimals: 6,
      address: usdc.address,
      tokenId: 0n,
      name: usdc.name,
      symbol: usdc.symbol,
      centrifugeId: 1,
    })
  })
})

describe('ShareClass._liveBalances', () => {
  const balanceSheet = '0x4444444444444444444444444444444444444444'
  let clock: sinon.SinonFakeTimers
  let centrifuge: Centrifuge
  let shareClass: ShareClass
  let events: Subject<any[]>
  let reread: sinon.SinonStub

  beforeEach(() => {
    clock = sinon.useFakeTimers()
    centrifuge = new Centrifuge({ environment: 'testnet' })
    const pool = new Pool(centrifuge, poolId)
    shareClass = new ShareClass(centrifuge, pool, scId.raw)
    events = new Subject()
    sinon.stub(shareClass, '_balances').returns(of([row({ assetAmount: '1000000' })]) as any)
    sinon
      .stub(centrifuge, 'protocolContext')
      .returns(of({ balanceSheet, protocolVersion: '3.2' }) as any)
    sinon.stub(centrifuge, '_filteredEvents').returns(events as any)
    reread = sinon.stub(centrifuge, '_queryDataOnce').resolves([row({ assetAmount: '3000000' })])
  })

  afterEach(() => {
    clock.restore()
    sinon.restore()
  })

  it('re-reads the escrow rows after a balance sheet event for the share class', async () => {
    const seen: string[] = []
    const sub = shareClass._liveBalances().subscribe((rows) => seen.push(rows[0]!.assetAmount))

    expect(seen).to.deep.equal(['1000000'])
    expect((centrifuge._filteredEvents as sinon.SinonStub).firstCall.args.slice(0, 3)).to.deep.equal([
      balanceSheet,
      ['NoteDeposit', 'Deposit', 'Withdraw'],
      1,
    ])

    events.next([{ args: { scId: scId.raw } }])
    await clock.tickAsync(5_000)

    expect(reread.calledWith('holdingEscrows', { tokenId: scId.raw })).to.equal(true)
    expect(seen).to.deep.equal(['1000000', '3000000'])

    // Later re-reads that return the same rows emit nothing new.
    await clock.tickAsync(45_000)
    expect(reread.callCount).to.equal(3)
    expect(seen).to.deep.equal(['1000000', '3000000'])
    sub.unsubscribe()
  })

  it('ignores balance sheet events for another share class', async () => {
    const sub = shareClass._liveBalances().subscribe()

    events.next([{ args: { scId: ShareClassId.from(poolId, 2).raw } }])
    await clock.tickAsync(60_000)

    expect(reread.called).to.equal(false)
    sub.unsubscribe()
  })
})
