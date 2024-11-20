import { expect } from 'chai'
import { Centrifuge } from '../Centrifuge.js'
import { SinonSpy, spy } from 'sinon'
import { Reports } from '../Reports/index.js'
import { ReportFilter } from './types.js'
import { processor } from './Processor.js'

describe('Reports', () => {
  let centrifuge: Centrifuge
  let processBalanceSheetSpy: SinonSpy

  beforeEach(async () => {
    centrifuge = new Centrifuge({
      environment: 'mainnet',
      indexerUrl: 'https://subql.embrio.tech/',
    })
    processBalanceSheetSpy = spy(processor, 'balanceSheet')
  })
  afterEach(() => {
    processBalanceSheetSpy.restore()
  })

  it('should get balance sheet report', async () => {
    const ns3PoolId = '1615768079'
    const pool = await centrifuge.pool(ns3PoolId)
    const balanceSheetReport = await pool.reports.balanceSheet({
      from: '2024-11-02T22:11:29.776Z',
      to: '2024-11-06T22:11:29.776Z',
      groupBy: 'day',
    })
    expect(balanceSheetReport.length).to.be.eql(4)
    expect(balanceSheetReport?.[0]?.tranches?.length ?? 0).to.be.eql(2) // ns3 has 2 tranches
    expect(balanceSheetReport?.[0]?.tranches?.[0]?.timestamp.slice(0, 10)).to.be.eql(
      balanceSheetReport?.[0]?.date.slice(0, 10)
    )
  })

  it('should use cached data for repeated queries', async () => {
    const ns3PoolId = '1615768079'
    const reports = new Reports(centrifuge, ns3PoolId)

    const filter: ReportFilter = {
      from: '2024-11-03T22:11:29.776Z',
      to: '2024-11-06T22:11:29.776Z',
      groupBy: 'day',
    }

    await reports.balanceSheet(filter)
    expect(processBalanceSheetSpy.callCount).to.equal(1)

    // Same query should use cache
    await reports.balanceSheet(filter)
    expect(processBalanceSheetSpy.callCount).to.equal(1)
  })

  it('should fetch new data for different query', async () => {
    const ns3PoolId = '1615768079'
    const reports = new Reports(centrifuge, ns3PoolId)

    const filter: ReportFilter = {
      from: '2024-11-03T22:11:29.776Z',
      to: '2024-11-06T22:11:29.776Z',
      groupBy: 'day',
    }

    const report = await reports.balanceSheet(filter)
    expect(processBalanceSheetSpy.callCount).to.equal(1)
    expect(report.length).to.equal(3)

    // Different query should fetch new data
    const report2 = await reports.balanceSheet({ ...filter, to: '2024-11-10T22:11:29.776Z' })
    expect(processBalanceSheetSpy.callCount).to.equal(2)
    expect(report2.length).to.equal(7)

    const report3 = await reports.balanceSheet({ ...filter, groupBy: 'month' })
    expect(processBalanceSheetSpy.callCount).to.equal(3)
    expect(report3.length).to.equal(1)
  })
})
