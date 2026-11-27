import type { HubTokenSnapshotPriceRow } from '@centrifuge/queries/core'
import { expect } from 'chai'
import sinon from 'sinon'
import { Centrifuge } from '../Centrifuge.js'
import { PoolId, ShareClassId } from '../utils/types.js'
import { Pool } from './Pool.js'
import { ShareClass } from './ShareClass.js'
import { SHARE_PRICE_UPDATES_POLL_INTERVAL, toSharePriceUpdates } from './sharePriceUpdates.js'

const poolId = PoolId.from(1, 1)
const scId = ShareClassId.from(poolId, 1)
const otherScId = ShareClassId.from(poolId, 2)

const PRICE = '1006159296891391412'
const UPDATE = 'shareClassManager:UpdatePricePoolPerShare'
const SHARE_CLASS_UPDATE = 'shareClassManager:UpdateShareClass'
const DAILY = 'snapshot:DailySnapshotTrigger'

/** An instant as public-api writes it: six fraction digits and an offset. */
const wire = (instant: string) => instant.replace('Z', '.000000+00:00')

/** The snapshot a price update writes: written at the block time of the commit. */
function commit(
  committedAt: string,
  computedAt: string | null,
  price: string | null = PRICE,
  trigger = UPDATE
): HubTokenSnapshotPriceRow {
  return {
    timestamp: wire(committedAt),
    trigger,
    triggerBlockTimestamp: wire(committedAt),
    tokenPrice: price,
    tokenPriceComputedAt: computedAt === null ? null : wire(computedAt),
  }
}

/** The snapshot of a day boundary: written at midnight by a block a little later, carrying the price in force. */
function boundary(day: string, computedAt: string | null, price: string | null = PRICE): HubTokenSnapshotPriceRow {
  return {
    timestamp: wire(`${day}T00:00:00Z`),
    trigger: DAILY,
    triggerBlockTimestamp: wire(`${day}T00:38:23Z`),
    tokenPrice: price,
    tokenPriceComputedAt: computedAt === null ? null : wire(computedAt),
  }
}

type Table = Record<string, HubTokenSnapshotPriceRow[]>

/**
 * The `tokenSnapshots` connection behind the indexer: it applies the document's own `filter`, `first` and `after`, so a
 * read that asks for the wrong token, range or page gets different rows.
 */
function connection(table: Table) {
  return async (_document: string, variables: any) => {
    const { filter, first, after } = variables
    const lower = filter.timestamp?.greaterThanOrEqualTo as string | undefined
    const upper = filter.timestamp?.lessThanOrEqualTo as string | undefined
    const matching = (table[filter.id.equalTo] ?? [])
      .filter((row) => lower === undefined || Date.parse(row.timestamp) >= Date.parse(lower))
      .filter((row) => upper === undefined || Date.parse(row.timestamp) <= Date.parse(upper))
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    const start = after === null ? 0 : Number(after)
    const nodes = matching.slice(start, start + first)
    const end = start + nodes.length
    return { tokenSnapshots: { pageInfo: { hasNextPage: end < matching.length, endCursor: String(end) }, nodes } }
  }
}

describe('ShareClass.sharePriceUpdates', () => {
  let centrifuge: Centrifuge
  let shareClass: ShareClass
  let executeGraphql: sinon.SinonStub

  function indexerHolds(table: Table) {
    executeGraphql.callsFake(connection(table))
  }

  beforeEach(() => {
    centrifuge = new Centrifuge({ environment: 'testnet' })
    executeGraphql = sinon.stub(centrifuge as any, '_executeGraphql')
    shareClass = new ShareClass(centrifuge, new Pool(centrifuge, poolId), scId)
  })

  afterEach(() => sinon.restore())

  it('gives one entry per price update, with its commit time and computed-at', async () => {
    indexerHolds({
      [scId.raw]: [
        commit('2026-08-27T21:20:47Z', '2026-08-26T12:00:00Z', '1000000000000000000'),
        commit('2026-08-28T16:50:35Z', '2026-08-27T12:00:00Z', '1010000000000000000'),
      ],
    })

    const updates = await shareClass.sharePriceUpdates()

    expect(
      updates.map((update) => [
        update.price.toFloat(),
        update.committedAt.toISOString(),
        update.computedAt?.toISOString(),
      ])
    ).to.deep.equal([
      [1, '2026-08-27T21:20:47.000Z', '2026-08-26T12:00:00.000Z'],
      [1.01, '2026-08-28T16:50:35.000Z', '2026-08-27T12:00:00.000Z'],
    ])
  })

  it('leaves out the day-boundary snapshots that repeat the price in force', async () => {
    indexerHolds({
      [scId.raw]: [
        commit('2026-08-27T21:20:47Z', '2026-08-26T12:00:00Z'),
        boundary('2026-08-28', '2026-08-26T12:00:00Z'),
        boundary('2026-08-29', '2026-08-26T12:00:00Z'),
      ],
    })

    const updates = await shareClass.sharePriceUpdates()

    expect(updates.map((update) => update.committedAt.toISOString())).to.deep.equal(['2026-08-27T21:20:47.000Z'])
  })

  it('leaves out the snapshots of a share class update, the pre-3.1 price commit no hub policy judged', async () => {
    indexerHolds({
      [scId.raw]: [
        commit('2026-08-27T21:20:47Z', '2026-08-26T12:00:00Z'),
        commit('2026-08-28T10:00:00Z', null, '1050000000000000000', SHARE_CLASS_UPDATE),
      ],
    })

    const updates = await shareClass.sharePriceUpdates()

    expect(updates).to.have.length(1)
    expect(updates[0]!.price.toBigInt()).to.equal(BigInt(PRICE))
  })

  it('carries no entry for the price in force when the range opens', async () => {
    indexerHolds({
      [scId.raw]: [
        boundary('2026-08-27', '2026-08-25T12:00:00Z', '1000000000000000000'),
        commit('2026-08-27T21:20:47Z', '2026-08-26T12:00:00Z', '1010000000000000000'),
      ],
    })

    const updates = await shareClass.sharePriceUpdates({ from: new Date('2026-08-27T00:00:00Z') })

    expect(updates.map((update) => update.price.toFloat())).to.deep.equal([1.01])
  })

  it('keeps two prices committed on one day as two entries', async () => {
    indexerHolds({
      [scId.raw]: [
        commit('2026-08-27T10:00:00Z', '2026-08-27T09:00:00Z', '1010000000000000000'),
        commit('2026-08-27T18:00:00Z', '2026-08-27T17:00:00Z', '1020000000000000000'),
      ],
    })

    const updates = await shareClass.sharePriceUpdates()

    expect(updates.map((update) => update.price.toFloat())).to.deep.equal([1.01, 1.02])
  })

  it('keeps a correction under one computed-at as an entry of its own, in commit order', async () => {
    indexerHolds({
      [scId.raw]: [
        commit('2026-02-04T22:33:23Z', '2026-02-04T12:00:00Z', '1015794808695680000'),
        commit('2026-02-05T20:06:35Z', '2026-02-04T12:00:00Z', '1015884914205150000'),
      ],
    })

    const updates = await shareClass.sharePriceUpdates()

    expect(updates.map((update) => update.price.toBigInt())).to.deep.equal([1015794808695680000n, 1015884914205150000n])
  })

  it('orders by commit time, a backdated computed-at not moving its commit', async () => {
    indexerHolds({
      [scId.raw]: [
        commit('2026-08-27T10:00:00Z', '2026-08-27T09:00:00Z', '1030000000000000000'),
        commit('2026-08-28T10:00:00Z', '2026-08-26T09:00:00Z', '1010000000000000000'),
        commit('2026-08-29T10:00:00Z', '2026-08-28T09:00:00Z', '1020000000000000000'),
      ],
    })

    const updates = await shareClass.sharePriceUpdates()

    expect(updates.map((update) => update.price.toFloat())).to.deep.equal([1.03, 1.01, 1.02])
    expect(updates.map((update) => update.computedAt?.toISOString())).to.deep.equal([
      '2026-08-27T09:00:00.000Z',
      '2026-08-26T09:00:00.000Z',
      '2026-08-28T09:00:00.000Z',
    ])
  })

  it('sorts rows by block time and keeps commits with one block time in the order they arrive', () => {
    const first = commit('2026-08-27T10:00:00Z', null, '1010000000000000000')
    const second = commit('2026-08-27T10:00:00Z', null, '1020000000000000000')
    const earlier = commit('2026-08-27T09:00:00Z', null, '1000000000000000000')

    const updates = toSharePriceUpdates([second, first, earlier])

    expect(updates.map((update) => update.price.toFloat())).to.deep.equal([1, 1.02, 1.01])
  })

  it('keeps only the exact trigger of a price update', () => {
    const row = commit('2026-08-27T10:00:00Z', null, PRICE, `${UPDATE}:carried`)

    expect(toSharePriceUpdates([row])).to.deep.equal([])
  })

  it('takes the commit time from the block time of the trigger, not from the snapshot timestamp', () => {
    const row = { ...commit('2026-08-27T10:00:00Z', null), timestamp: wire('2026-08-27T00:00:00Z') }

    const [update] = toSharePriceUpdates([row])

    expect(update!.committedAt.toISOString()).to.equal('2026-08-27T10:00:00.000Z')
  })

  it('drops a commit without a price and keeps a committed price of zero', async () => {
    indexerHolds({
      [scId.raw]: [
        commit('2026-08-27T10:00:00Z', '2026-08-27T09:00:00Z', null),
        commit('2026-08-28T10:00:00Z', '2026-08-28T09:00:00Z', '0'),
      ],
    })

    const updates = await shareClass.sharePriceUpdates()

    expect(updates.map((update) => update.price.toBigInt())).to.deep.equal([0n])
  })

  it('answers a null computed-at as null', async () => {
    indexerHolds({ [scId.raw]: [commit('2026-08-27T10:00:00Z', null)] })

    const [update] = await shareClass.sharePriceUpdates()

    expect(update!.computedAt).to.equal(null)
  })

  it('builds the price from the raw D18 value without going through a float', async () => {
    indexerHolds({ [scId.raw]: [commit('2026-08-27T10:00:00Z', '2026-08-27T09:00:00Z')] })

    const [update] = await shareClass.sharePriceUpdates()

    expect(update!.price.toBigInt()).to.equal(1006159296891391412n)
    expect(update!.price.decimals).to.equal(18)
  })

  it('is empty when the indexer holds no snapshot in the range', async () => {
    indexerHolds({})

    expect(await shareClass.sharePriceUpdates()).to.deep.equal([])
  })

  it('reads only its own share class', async () => {
    indexerHolds({
      [scId.raw]: [commit('2026-08-27T10:00:00Z', '2026-08-27T09:00:00Z', '1000000000000000000')],
      [otherScId.raw]: [commit('2026-08-27T11:00:00Z', '2026-08-27T10:00:00Z', '2000000000000000000')],
    })

    const updates = await shareClass.sharePriceUpdates()

    expect(updates.map((update) => update.price.toFloat())).to.deep.equal([1])
  })

  it('asks the indexer for the range as ISO instants, bounding the commit time inclusively', async () => {
    indexerHolds({
      [scId.raw]: [
        commit('2026-08-26T23:59:59Z', '2026-08-26T12:00:00Z', '1000000000000000000'),
        commit('2026-08-27T00:00:00Z', '2026-08-27T00:00:00Z', '1010000000000000000'),
        commit('2026-08-28T00:00:00Z', '2026-08-28T00:00:00Z', '1020000000000000000'),
        commit('2026-08-28T00:00:01Z', '2026-08-28T00:00:01Z', '1030000000000000000'),
      ],
    })

    const updates = await shareClass.sharePriceUpdates({
      from: new Date('2026-08-27T00:00:00Z'),
      to: new Date('2026-08-28T00:00:00Z'),
    })

    expect(updates.map((update) => update.price.toFloat())).to.deep.equal([1.01, 1.02])
    expect(executeGraphql.firstCall.args[1].filter).to.deep.equal({
      id: { equalTo: scId.raw },
      timestamp: { greaterThanOrEqualTo: '2026-08-27T00:00:00.000Z', lessThanOrEqualTo: '2026-08-28T00:00:00.000Z' },
    })
  })

  it('sends no time bound when none is given', async () => {
    indexerHolds({ [scId.raw]: [] })

    await shareClass.sharePriceUpdates()

    expect(executeGraphql.firstCall.args[1].filter).to.deep.equal({ id: { equalTo: scId.raw } })
  })

  it('caches one query per range, and a from is not read as a to', () => {
    const date = new Date('2026-08-27T00:00:00Z')
    const other = new Date('2026-08-28T00:00:00Z')

    expect(shareClass.sharePriceUpdates({ from: date })).to.equal(shareClass.sharePriceUpdates({ from: date }))
    expect(shareClass.sharePriceUpdates()).to.equal(shareClass.sharePriceUpdates({}))
    expect(shareClass.sharePriceUpdates({ from: date })).to.not.equal(shareClass.sharePriceUpdates({ to: date }))
    expect(shareClass.sharePriceUpdates({ from: date })).to.not.equal(shareClass.sharePriceUpdates({ from: other }))
    expect(shareClass.sharePriceUpdates({ from: date })).to.not.equal(shareClass.sharePriceUpdates())
    expect(shareClass.sharePriceUpdates({ from: date, to: date })).to.not.equal(
      shareClass.sharePriceUpdates({ from: date, to: other })
    )
    expect(shareClass.sharePriceUpdates({ to: date })).to.not.equal(shareClass.sharePriceUpdates({ to: other }))
  })

  it('polls hourly, like the reports over the same snapshots', () => {
    const queryData = sinon.spy(centrifuge, '_queryData')

    shareClass.sharePriceUpdates()

    expect(queryData.firstCall.args[3]).to.equal(SHARE_PRICE_UPDATES_POLL_INTERVAL)
    expect(SHARE_PRICE_UPDATES_POLL_INTERVAL).to.equal(60 * 60 * 1000)
  })

  it('refuses an invalid date with a message that names the bound, before asking the indexer', () => {
    expect(() => shareClass.sharePriceUpdates({ from: new Date(Number.NaN) })).to.throw(
      RangeError,
      '"from" is an invalid Date'
    )
    expect(() => shareClass.sharePriceUpdates({ to: new Date(Number.NaN) })).to.throw(
      RangeError,
      '"to" is an invalid Date'
    )
    expect(executeGraphql.called).to.equal(false)
  })

  it('refuses a row whose instant is not an ISO-8601 timestamp, instead of guessing', () => {
    const row = {
      ...commit('2026-08-27T10:00:00Z', '2026-08-27T09:00:00Z'),
      triggerBlockTimestamp: '2026-08-27T10:00:00',
    }

    expect(() => toSharePriceUpdates([row])).to.throw('not an ISO-8601 timestamp')
  })

  it('refuses a price update that carries no block time', () => {
    const row = { ...commit('2026-08-27T10:00:00Z', '2026-08-27T09:00:00Z'), triggerBlockTimestamp: null }

    expect(() => toSharePriceUpdates([row])).to.throw('without a block time')
  })
})
