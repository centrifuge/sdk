import { expect } from 'chai'
import { Centrifuge } from '../Centrifuge.js'

describe('Reports', () => {
  let centrifuge: Centrifuge

  before(async () => {
    centrifuge = new Centrifuge({
      environment: 'mainnet',
      subqueryUrl: 'https://subql.embrio.tech/',
    })
  })

  it('should get balance sheet report', async () => {
    const ns3PoolId = '1615768079'
    const pool = await centrifuge.pool(ns3PoolId)
    const balanceSheetReport = await pool.reports().balanceSheet({
      from: '2024-11-03T22:11:29.776Z',
      to: '2024-11-06T22:11:29.776Z',
      groupBy: 'day',
    })
    expect(balanceSheetReport.length).to.be.eql(2)
    expect(balanceSheetReport?.[0]?.tranches?.length ?? 0).to.be.greaterThan(1)
  })
})
