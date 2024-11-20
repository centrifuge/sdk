import { expect } from 'chai'
import { Centrifuge } from '../Centrifuge.js'
import { spy } from 'sinon'
import { ReportFilter, Reports } from '../Reports/index.js'
import * as balanceSheetProcessor from '../Reports/processors/balanceSheet.js'
import { firstValueFrom } from 'rxjs'

describe('Reports', () => {
  let centrifuge: Centrifuge

  before(async () => {
    centrifuge = new Centrifuge({
      environment: 'mainnet',
      indexerUrl: 'https://subql.embrio.tech/',
    })
  })

  it('should get balance sheet report', async () => {
    const ns3PoolId = '1615768079'
    const pool = await centrifuge.pool(ns3PoolId)
    const balanceSheetReport = await pool.reports.balanceSheet({
      from: '2024-11-03T22:11:29.776Z',
      to: '2024-11-06T22:11:29.776Z',
      groupBy: 'day',
    })
    expect(balanceSheetReport.length).to.be.eql(3)
    expect(balanceSheetReport?.[0]?.tranches?.length ?? 0).to.be.eql(2) // ns3 has 2 tranches
    expect(balanceSheetReport?.[0]?.tranches?.[0]?.timestamp.slice(0, 10)).to.be.eql(
      balanceSheetReport?.[0]?.date.slice(0, 10)
    )
  })

  it('should use cached data for repeated queries', async () => {
    const processBalanceSheetSpy = spy(balanceSheetProcessor, 'processBalanceSheetData')

    const ns3PoolId = '1615768079'
    const reports = new Reports(centrifuge, ns3PoolId)

    const filter: ReportFilter = {
      from: '2024-11-03T22:11:29.776Z',
      to: '2024-11-06T22:11:29.776Z',
      groupBy: 'day',
    }

    await firstValueFrom(reports.balanceSheet(filter))
    expect(processBalanceSheetSpy.callCount).to.equal(1)

    // Same query should use cache
    await firstValueFrom(reports.balanceSheet(filter))
    // TODO: Can't spy on es module
    expect(processBalanceSheetSpy.callCount).to.equal(1)
  })
})
