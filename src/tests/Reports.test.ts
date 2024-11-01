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
    const pool = await centrifuge.pool('1615768079')
    const balanceSheetReport = await pool.reports().balanceSheet()
    expect(balanceSheetReport.length).to.be.greaterThan(0)
  })
})
