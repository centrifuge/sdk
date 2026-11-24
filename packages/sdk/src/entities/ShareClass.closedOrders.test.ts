import { expect } from 'chai'
import { of } from 'rxjs'
import sinon from 'sinon'
import { Centrifuge } from '../Centrifuge.js'
import { Pool } from './Pool.js'
import { ShareClass } from './ShareClass.js'

const POOL_ID = '281474976710665'
const SC_ID = '0x00010000000000010001000000000001'
const USDC = '281474976710657'
const DAI = '281474976710658'
const HASH_A = `0x${'aa'.repeat(32)}`
const HASH_B = `0x${'bb'.repeat(32)}`
const asset = { symbol: 'USDC', name: 'USD Coin', decimals: 6, centrifugeId: '1' }
const token = { decimals: 18 }

function withReads(reads: Record<string, unknown[]>) {
  const centrifuge = new Centrifuge({ environment: 'testnet' })
  const calls: { name: string; params: unknown }[] = []
  sinon.stub(centrifuge as any, '_queryData').callsFake((...args: unknown[]) => {
    const name = String(args[0])
    calls.push({ name, params: args[1] })
    const rows = reads[name]
    if (!rows) throw new Error(`unexpected catalogue read ${name}`)
    const project = args[2] as ((rows: unknown[]) => unknown) | undefined
    return of(project ? project(rows) : rows)
  })
  const shareClass = new ShareClass(centrifuge, new Pool(centrifuge, POOL_ID), SC_ID)
  return { shareClass, calls }
}

describe('closed orders read once per share class', () => {
  afterEach(() => sinon.restore())

  it('groups the issued orders onto their epochs by asset and approval hash, either side cased, in two reads; an order with no approval hash or no epoch is dropped', async () => {
    const epoch = (index: number, assetId: string, approvedAtTxHash: string | null) => ({
      index,
      assetId,
      approvedAtTxHash,
      approvedAt: '2026-01-01T00:00:00.000Z',
      approvedAssetsAmount: '1000000',
      issuedAt: '2026-01-02T00:00:00.000Z',
      issuedAtTxHash: HASH_B,
      issuedSharesAmount: '1000000000000000000',
      issuedWithNavAssetPerShare: '1000000000000000000',
      issuedWithNavPoolPerShare: '1000000000000000000',
      asset,
      token,
    })
    const order = (account: string, assetId: string, approvedAtTxHash: string) => ({
      account,
      index: 0,
      assetId,
      approvedAtTxHash,
      approvedAt: '2026-01-01T00:00:00.000Z',
      approvedAssetsAmount: '500000',
      issuedAt: '2026-01-02T00:00:00.000Z',
      issuedAtTxHash: HASH_B,
      issuedSharesAmount: '500000000000000000',
      issuedWithNavAssetPerShare: '1000000000000000000',
      issuedWithNavPoolPerShare: '1000000000000000000',
      claimedAt: null,
      claimedAtBlock: null,
      createdAtTxHash: null,
      asset,
      token,
    })
    const upper = (hash: string) => hash.toUpperCase().replace('0X', '0x')
    const { shareClass, calls } = withReads({
      epochInvestOrders: [epoch(3, USDC, HASH_A), epoch(4, USDC, upper(HASH_B)), epoch(5, DAI, null)],
      closedInvestOrders: [
        order('0xA1', USDC, HASH_A),
        order('0xA2', USDC, upper(HASH_A)),
        order('0xB1', USDC, HASH_B),
        order('0xD1', DAI, HASH_A),
        { ...order('0xN1', USDC, HASH_A), approvedAtTxHash: null },
        order('0xO1', USDC, `0x${'cc'.repeat(32)}`),
      ],
    })

    const closed = await shareClass.closedInvestments()

    expect(calls.map((c) => c.name)).to.deep.equal(['epochInvestOrders', 'closedInvestOrders'])
    expect(calls[1]!.params).to.deep.equal({ tokenId: SC_ID })
    expect(closed.map((row) => [row.index, row.investor])).to.deep.equal([
      [3, '0xa1'],
      [3, '0xa2'],
      [4, '0xb1'],
      [5, null],
    ])
    expect(closed[0]!.approvedAmount.toString()).to.equal('500000')
    expect(closed[3]!.approvedAmount.toString()).to.equal('1000000')
  })

  it('reads nothing per investor for a share class with no closed epochs', async () => {
    const invest = withReads({ epochInvestOrders: [] })
    expect(await invest.shareClass.closedInvestments()).to.deep.equal([])
    expect(invest.calls.map((c) => c.name)).to.deep.equal(['epochInvestOrders'])
    sinon.restore()

    const redeem = withReads({ epochRedeemOrders: [] })
    expect(await redeem.shareClass.closedRedemptions({ epochIndex: 7, onlyUnclaimed: true })).to.deep.equal([])
    expect(redeem.calls.map((c) => c.name)).to.deep.equal(['epochRedeemOrders'])
  })

  it("falls back to the epoch's asset and token when the order's are unresolved", async () => {
    const { shareClass } = withReads({
      epochInvestOrders: [
        {
          index: 1,
          assetId: USDC,
          approvedAtTxHash: HASH_A,
          issuedAt: '2026-01-02T00:00:00.000Z',
          approvedAssetsAmount: '1000000',
          issuedSharesAmount: '1000000000000000000',
          asset,
          token,
        },
      ],
      closedInvestOrders: [
        {
          account: '0xA1',
          index: 0,
          assetId: USDC,
          approvedAtTxHash: HASH_A,
          approvedAssetsAmount: '500000',
          issuedSharesAmount: '500000000000000000',
          claimedAt: null,
          claimedAtBlock: null,
          asset: null,
          token: null,
        },
      ],
    })
    const [row] = await shareClass.closedInvestments()
    expect(row!.asset).to.deep.equal({ symbol: 'USDC', name: 'USD Coin', decimals: 6 })
    expect(row!.approvedAmount.decimals).to.equal(6)
    expect(row!.issuedAmount.decimals).to.equal(18)
  })

  it('keeps the same request count for many epochs', async () => {
    const epochs = Array.from({ length: 40 }, (_, i) => ({
      index: i,
      assetId: USDC,
      approvedAtTxHash: `0x${i.toString(16).padStart(64, '0')}`,
      issuedAt: '2026-01-02T00:00:00.000Z',
      asset,
      token,
    }))
    const { shareClass, calls } = withReads({ epochInvestOrders: epochs, closedInvestOrders: [] })
    const closed = await shareClass.closedInvestments()
    expect(calls).to.have.length(2)
    expect(closed).to.have.length(40)
  })

  it('groups the revoked orders onto their epochs by asset and index, honouring the filter', async () => {
    const epoch = (index: number, assetId: string) => ({
      index,
      assetId,
      revokedAt: '2026-01-02T00:00:00.000Z',
      approvedAt: '2026-01-01T00:00:00.000Z',
      approvedSharesAmount: '1000000000000000000',
      revokedAssetsAmount: '1000000',
      revokedWithNavAssetPerShare: '1000000000000000000',
      revokedWithNavPoolPerShare: '1000000000000000000',
      asset,
      token,
    })
    const order = (account: string, assetId: string, index: number, claimedAt: string | null) => ({
      account,
      index,
      assetId,
      approvedAt: '2026-01-01T00:00:00.000Z',
      approvedSharesAmount: '500000000000000000',
      revokedAt: '2026-01-02T00:00:00.000Z',
      revokedAssetsAmount: '500000',
      revokedWithNavAssetPerShare: '1000000000000000000',
      revokedWithNavPoolPerShare: '1000000000000000000',
      claimedAt,
      claimedAtBlock: claimedAt ? 10 : null,
      asset,
      token,
    })
    const reads = {
      epochRedeemOrders: [epoch(1, USDC), epoch(2, USDC), epoch(1, DAI)],
      closedRedeemOrders: [
        order('0xA1', USDC, 1, null),
        order('0xA2', USDC, 1, '2026-01-03T00:00:00.000Z'),
        order('0xB1', USDC, 2, '2026-01-03T00:00:00.000Z'),
        order('0xD1', DAI, 1, null),
      ],
    }

    const all = withReads(reads)
    const closed = await all.shareClass.closedRedemptions()
    expect(all.calls.map((c) => c.name)).to.deep.equal(['epochRedeemOrders', 'closedRedeemOrders'])
    expect(closed.map((row) => [row.assetId.toString(), row.index, row.investor, row.isClaimed])).to.deep.equal([
      [USDC, 1, '0xa1', false],
      [USDC, 1, '0xa2', true],
      [USDC, 2, '0xb1', true],
      [DAI, 1, '0xd1', false],
    ])
    sinon.restore()

    const unclaimed = withReads(reads)
    const open = await unclaimed.shareClass.closedRedemptions({ onlyUnclaimed: true })
    expect(open.map((row) => [row.assetId.toString(), row.index, row.investor])).to.deep.equal([
      [USDC, 1, '0xa1'],
      [DAI, 1, '0xd1'],
    ])
    sinon.restore()

    const scoped = withReads({
      ...reads,
      epochRedeemOrders: [epoch(2, USDC)],
      redeemOrdersByEpoch: [order('0xB1', USDC, 2, null)],
    })
    const one = await scoped.shareClass.closedRedemptions({ epochIndex: 2, onlyUnclaimed: true })
    expect(scoped.calls.map((c) => c.name)).to.deep.equal(['epochRedeemOrders', 'redeemOrdersByEpoch'])
    expect(scoped.calls[0]!.params).to.deep.equal({ tokenId: SC_ID, index: 2 })
    expect(scoped.calls[1]!.params).to.deep.equal({ tokenId: SC_ID, assetId: USDC, index: 2, onlyUnclaimed: true })
    expect(one.map((row) => [row.index, row.investor])).to.deep.equal([[2, '0xb1']])
  })
})
