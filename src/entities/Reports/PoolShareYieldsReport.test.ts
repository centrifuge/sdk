import { expect } from 'chai'
import { context } from '../../tests/setup.js'
import { PoolId, ShareClassId } from '../../utils/types.js'
import { Pool } from '../Pool.js'
import { PoolReports } from './PoolReports.js'
import { PoolShareYieldsReport } from './PoolShareYieldsReport.js'

const centId = 1
const poolId = PoolId.from(centId, 1)
const scId = ShareClassId.from(poolId, 1)

describe('PoolShareYieldsReport', () => {
  let poolShareYieldsReport: PoolShareYieldsReport

  before(() => {
    const { centrifuge } = context
    const pool = new Pool(centrifuge, poolId)
    const poolReports = new PoolReports(centrifuge, pool)
    poolShareYieldsReport = new PoolShareYieldsReport(centrifuge, poolReports)
  })

  it('converts Ray-encoded yields to Decimal percentages keyed by (date, shareClassId)', () => {
    const tokenId = scId.raw
    // Ray-encoded yields: 5.5% -> 0.055 * 1e27 = 5.5e25
    const data = {
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

    const report = poolShareYieldsReport._process(data, {})
    const entry = report[0]!.shareClasses[tokenId]!
    expect(entry.yieldYtd!.toNumber()).to.equal(5.5)
    expect(entry.yield30d365!.toNumber()).to.equal(12)
    expect(entry.yield1d).to.equal(undefined)
  })

  it('keeps the latest snapshot per (date, shareClassId)', () => {
    const tokenId = scId.raw
    const data = {
      tokenSnapshots: {
        items: [
          // Order returned by indexer: timestamp DESC, so the first row is the latest.
          {
            id: tokenId,
            timestamp: '1777982400000',
            yieldYtd: '70000000000000000000000000',
            yield30d365: null,
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
          {
            id: tokenId,
            timestamp: '1777939200000',
            yieldYtd: '55000000000000000000000000',
            yield30d365: null,
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

    const report = poolShareYieldsReport._process(data, {})
    // Both rows share the same UTC date; the first (latest) one wins.
    expect(report).to.have.length(1)
    expect(report[0]!.shareClasses[tokenId]!.yieldYtd!.toNumber()).to.equal(7)
  })
})
