import { expect } from 'chai'
import { context } from '../../tests/setup.js'
import { Balance, Price } from '../../utils/BigInt.js'
import { PoolId, ShareClassId } from '../../utils/types.js'
import { Pool } from '../Pool.js'
import { PoolReports } from './PoolReports.js'
import { PoolSharePricesReport } from './PoolSharePricesReport.js'

const centId = 1
const poolId = PoolId.from(centId, 1)
const scId = ShareClassId.from(poolId, 1)

describe('PoolSharePricesReport', () => {
  let poolSharePricesReport: PoolSharePricesReport

  before(() => {
    const { centrifuge } = context
    const pool = new Pool(centrifuge, poolId)
    const poolReports = new PoolReports(centrifuge, pool)
    poolSharePricesReport = new PoolSharePricesReport(centrifuge, poolReports)
  })

  it('should fetch the report', async () => {
    const report = await poolSharePricesReport.report()
    expect(report).to.be.an('array')
    expect(report.length).to.be.greaterThan(0)
    expect(report[0]).to.have.property('timestamp')
    expect(report[0]!.shareClasses[scId.raw]!.price).to.be.instanceOf(Price)
    expect(report[0]!.shareClasses[scId.raw]!.totalIssuance).to.be.instanceOf(Balance)
    expect(report[0]!.shareClasses[scId.raw]!.yields).to.be.an('object')
  })

  it('should apply grouping', async () => {
    const report = await poolSharePricesReport.report({ groupBy: 'month' })
    const firstDate = new Date(report[0]!.timestamp)
    const secondDate = new Date(report[1]!.timestamp)
    expect(firstDate.getMonth()).to.not.equal(secondDate.getMonth())
  })

  it('sums issuance across chains for the same (date, tokenId)', () => {
    const tokenId = scId.raw
    const data = {
      tokenInstanceSnapshots: {
        items: [
          { tokenId, timestamp: '1777939200000', totalIssuance: '100', tokenPrice: '1000000000000000000', triggerChainId: '1' },
          { tokenId, timestamp: '1777939200000', totalIssuance: '200', tokenPrice: '1000000000000000000', triggerChainId: '8453' },
          { tokenId, timestamp: '1777939200000', totalIssuance: '300', tokenPrice: '1000000000000000000', triggerChainId: '42161' },
        ],
      },
    }

    const report = poolSharePricesReport._process(data, {}, 18)
    expect(report).to.have.length(1)
    const entry = report[0]!.shareClasses[tokenId]!
    expect(entry.totalIssuance.toBigInt()).to.equal(600n)
    expect(entry.totalIssuance.decimals).to.equal(18)
  })

  it('prefers the price from the chain with the largest issuance', () => {
    const tokenId = scId.raw
    const stalePrice = '900000000000000000'
    const freshPrice = '1100000000000000000'
    const data = {
      tokenInstanceSnapshots: {
        items: [
          { tokenId, timestamp: '1777939200000', totalIssuance: '0', tokenPrice: stalePrice, triggerChainId: '143' },
          { tokenId, timestamp: '1777939200000', totalIssuance: '500', tokenPrice: freshPrice, triggerChainId: '1' },
          { tokenId, timestamp: '1777939200000', totalIssuance: '100', tokenPrice: stalePrice, triggerChainId: '8453' },
        ],
      },
    }

    const report = poolSharePricesReport._process(data, {}, 18)
    const entry = report[0]!.shareClasses[tokenId]!
    expect(entry.totalIssuance.toBigInt()).to.equal(600n)
    expect(entry.price.toBigInt()).to.equal(BigInt(freshPrice))
  })

  it('merges yields from token_snapshot by (date, shareClassId)', () => {
    const tokenId = scId.raw
    const price = '1000000000000000000'
    const priceData = {
      tokenInstanceSnapshots: {
        items: [
          { tokenId, timestamp: '1777939200000', totalIssuance: '100', tokenPrice: price, triggerChainId: '1' },
        ],
      },
    }
    // Ray-encoded yields: 5.5% -> 0.055 * 1e27 = 5.5e25
    const yieldsData = {
      tokenSnapshots: {
        items: [
          {
            id: tokenId,
            timestamp: '1777939200000',
            yieldYtd: '55000000000000000000000000',
            yield30d365: '120000000000000000000000000',
            yield1d: null,
            yield1d360: null,
            yield1d365: null,
            yield7d: null,
            yield7d360: null,
            yield7d365: null,
            yield15d: null,
            yield15d360: null,
            yield15d365: null,
            yield30d: null,
            yield30d360: null,
            yield90d: null,
            yield90d360: null,
            yield90d365: null,
            yield180d: null,
            yield180d360: null,
            yield180d365: null,
            yield30dComp360: null,
            yield30dComp365: null,
            yieldTtm: null,
            yieldSinceInception: null,
          },
        ],
      },
    }

    const report = poolSharePricesReport._process(priceData, {}, 18, yieldsData)
    const entry = report[0]!.shareClasses[tokenId]!
    expect(entry.yields.yieldYtd!.toNumber()).to.equal(5.5)
    expect(entry.yields.yield30d365!.toNumber()).to.equal(12)
    expect(entry.yields.yield1d).to.equal(undefined)
  })

  it('dedupes duplicate rows for the same (date, chain) before summing', () => {
    const tokenId = scId.raw
    const price = '1000000000000000000'
    // The indexer can emit multiple rows for the same (date, chain) — e.g. when
    // a period boundary triggers more than once. Each chain should contribute
    // only its largest-issuance row to the daily total.
    const data = {
      tokenInstanceSnapshots: {
        items: [
          { tokenId, timestamp: '1777939200000', totalIssuance: '500', tokenPrice: price, triggerChainId: '1' },
          { tokenId, timestamp: '1777939200000', totalIssuance: '500', tokenPrice: price, triggerChainId: '1' },
          { tokenId, timestamp: '1777939200000', totalIssuance: '500', tokenPrice: price, triggerChainId: '1' },
          { tokenId, timestamp: '1777939200000', totalIssuance: '300', tokenPrice: price, triggerChainId: '8453' },
          { tokenId, timestamp: '1777939200000', totalIssuance: '300', tokenPrice: price, triggerChainId: '8453' },
        ],
      },
    }

    const report = poolSharePricesReport._process(data, {}, 18)
    const entry = report[0]!.shareClasses[tokenId]!
    // Naive sum would be 2100; correct dedup-then-sum is 800.
    expect(entry.totalIssuance.toBigInt()).to.equal(800n)
  })
})
