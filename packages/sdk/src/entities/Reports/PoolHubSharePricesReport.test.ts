import { expect } from 'chai'
import { of } from 'rxjs'
import sinon from 'sinon'
import { Centrifuge } from '../../Centrifuge.js'
import { PoolId, ShareClassId } from '../../utils/types.js'
import { Pool } from '../Pool.js'
import { PoolHubSharePricesReport } from './PoolHubSharePricesReport.js'
import { PoolReports } from './PoolReports.js'

const centId = 1
const poolId = PoolId.from(centId, 1)
const scId = ShareClassId.from(poolId, 1)
const otherScId = ShareClassId.from(poolId, 2)

describe('PoolHubSharePricesReport', () => {
  let centrifuge: Centrifuge
  let pool: Pool
  let report: PoolHubSharePricesReport

  before(() => {
    centrifuge = new Centrifuge({ environment: 'testnet' })
    pool = new Pool(centrifuge, poolId)
    report = new PoolHubSharePricesReport(centrifuge, new PoolReports(centrifuge, pool))
  })

  afterEach(() => sinon.restore())

  it('passes the page bound through to the catalogue entry', async () => {
    sinon.stub(pool, '_shareClassIds').returns(of([scId, otherScId]) as any)
    sinon.stub(pool, 'decimals').returns(of(18) as any)
    const queryData = sinon.stub(centrifuge, '_queryData').returns(of({ tokenSnapshots: { items: [] } }) as any)

    await report.report({ shareClassId: scId, limit: 7 })

    expect(queryData.calledOnce).to.equal(true)
    expect(queryData.firstCall.args[0]).to.equal('hubSharePricesReport')
    expect(queryData.firstCall.args[1]).to.deep.equal({ tokenIds: [scId.toString()], limit: 7 })
  })

  it('forwards from/to as ISO instants and keys the cache on them', async () => {
    sinon.stub(pool, '_shareClassIds').returns(of([scId]) as any)
    sinon.stub(pool, 'decimals').returns(of(18) as any)
    const queryData = sinon.stub(centrifuge, '_queryData').returns(of({ tokenSnapshots: { items: [] } }) as any)
    const from = Date.UTC(2026, 0, 1)
    const to = Date.UTC(2026, 1, 1)

    await report.report({ from, to })
    await report.report({ from })

    expect(queryData.callCount).to.equal(2)
    expect(queryData.firstCall.args[1]).to.deep.equal({
      tokenIds: [scId.toString()],
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-02-01T00:00:00.000Z',
    })
    expect(queryData.secondCall.args[1]).to.deep.equal({
      tokenIds: [scId.toString()],
      from: '2026-01-01T00:00:00.000Z',
    })
  })

  it('picks the latest row of a day whatever order the rows arrive in', () => {
    const row = (timestamp: string, tokenPrice: string) => ({
      id: scId.raw,
      timestamp,
      tokenPrice,
      totalIssuance: '1000000',
      trigger: 'snapshot:DailySnapshotTrigger',
    })
    const data = {
      tokenSnapshots: {
        items: [
          row('2026-05-05T00:00:00.000000+00:00', '1000000000000000000'),
          row('2026-05-05T18:00:00.000000+00:00', '1200000000000000000'),
          row('2026-05-05T09:00:00.000000+00:00', '1100000000000000000'),
        ],
      },
    }

    const result = report._process(data, {}, 6)

    expect(result).to.have.length(1)
    expect(result[0]!.shareClasses[scId.raw]!.price.toFloat()).to.equal(1.2)
  })

  it('drops a day whose latest row has no price rather than falling back to an older row', () => {
    const data = {
      tokenSnapshots: {
        items: [
          {
            id: scId.raw,
            timestamp: '2026-05-05T12:00:00.000000+00:00',
            tokenPrice: null,
            totalIssuance: '1000000',
            trigger: 'shareClassManager:UpdatePricePoolPerShare',
          },
          {
            id: scId.raw,
            timestamp: '2026-05-05T00:00:00.000000+00:00',
            tokenPrice: '1000000000000000000',
            totalIssuance: '1000000',
            trigger: 'snapshot:DailySnapshotTrigger',
          },
          {
            id: scId.raw,
            timestamp: '2026-05-04T00:00:00.000000+00:00',
            tokenPrice: '1000000000000000000',
            totalIssuance: '1000000',
            trigger: 'snapshot:DailySnapshotTrigger',
          },
        ],
      },
    }

    const result = report._process(data, {}, 6)

    expect(result.map((r) => r.timestamp)).to.deep.equal(['2026-05-04T00:00:00.000Z'])
  })

  it('keeps the latest hub snapshot per (date, shareClassId) and scales issuance with the pool decimals', () => {
    const tokenId = scId.raw
    const data = {
      tokenSnapshots: {
        items: [
          {
            id: tokenId,
            timestamp: '2026-05-05T14:00:00.000000+00:00',
            tokenPrice: '1050000000000000000',
            totalIssuance: '200000000000000000000',
            trigger: 'shareClassManager:UpdatePricePoolPerShare',
          },
          {
            id: tokenId,
            timestamp: '2026-05-05T00:00:00.000000+00:00',
            tokenPrice: '1040000000000000000',
            totalIssuance: '190000000000000000000',
            trigger: 'snapshot:DailySnapshotTrigger',
          },
          {
            id: tokenId,
            timestamp: '1777852800000',
            tokenPrice: '1030000000000000000',
            totalIssuance: '180000000000000000000',
            trigger: 'shareClassManager:NewPeriod',
          },
        ],
      },
    }

    const result = report._process(data, {}, 18)

    expect(result.map((r) => r.timestamp)).to.deep.equal(['2026-05-04T00:00:00.000Z', '2026-05-05T00:00:00.000Z'])
    const latest = result[1]!.shareClasses[tokenId]!
    expect(latest.price.toFloat()).to.equal(1.05)
    expect(latest.totalIssuance.decimals).to.equal(18)
    expect(latest.totalIssuance.toFloat()).to.equal(200)
    expect(result[0]!.shareClasses[tokenId]!.price.toFloat()).to.equal(1.03)
  })

  it('skips rows with no price or issuance instead of failing the report', () => {
    const data = {
      tokenSnapshots: {
        items: [
          {
            id: scId.raw,
            timestamp: '2026-05-06T00:00:00.000000+00:00',
            tokenPrice: null,
            totalIssuance: '1000000',
            trigger: 'snapshot:DailySnapshotTrigger',
          },
          {
            id: scId.raw,
            timestamp: '2026-05-05T00:00:00.000000+00:00',
            tokenPrice: '1000000000000000000',
            totalIssuance: null,
            trigger: 'snapshot:DailySnapshotTrigger',
          },
          {
            id: scId.raw,
            timestamp: '2026-05-04T00:00:00.000000+00:00',
            tokenPrice: '1000000000000000000',
            totalIssuance: '1000000',
            trigger: 'snapshot:DailySnapshotTrigger',
          },
        ],
      },
    }

    const result = report._process(data, {}, 6)

    expect(result.map((r) => r.timestamp)).to.deep.equal(['2026-05-04T00:00:00.000Z'])
  })

  it('keeps share classes apart on the same day', () => {
    const data = {
      tokenSnapshots: {
        items: [
          {
            id: scId.raw,
            timestamp: '2026-05-05T00:00:00.000000+00:00',
            tokenPrice: '1000000000000000000',
            totalIssuance: '1000000',
            trigger: 'snapshot:DailySnapshotTrigger',
          },
          {
            id: otherScId.raw,
            timestamp: '2026-05-05T00:00:00.000000+00:00',
            tokenPrice: '2000000000000000000',
            totalIssuance: '2000000',
            trigger: 'snapshot:DailySnapshotTrigger',
          },
        ],
      },
    }

    const result = report._process(data, {}, 6)

    expect(result).to.have.length(1)
    expect(result[0]!.shareClasses[scId.raw]!.price.toFloat()).to.equal(1)
    expect(result[0]!.shareClasses[otherScId.raw]!.price.toFloat()).to.equal(2)
    expect(result[0]!.shareClasses[otherScId.raw]!.totalIssuance.toFloat()).to.equal(2)
  })
})
