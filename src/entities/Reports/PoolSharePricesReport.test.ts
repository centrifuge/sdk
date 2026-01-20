import { expect } from 'chai'
import { context } from '../../tests/setup.js'
import { Balance, Price } from '../../utils/BigInt.js'
import { PoolId, ShareClassId } from '../../utils/types.js'
import { Pool } from '../Pool.js'
import { PoolReports } from './PoolReports.js'
import { PoolSharePricesReport } from './PoolSharePricesReport.js'

const chainId = 11155111
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
  })

  it('should apply grouping', async () => {
    const report = await poolSharePricesReport.report({ groupBy: 'month' })
    const firstDate = new Date(report[0]!.timestamp)
    const secondDate = new Date(report[1]!.timestamp)
    expect(firstDate.getMonth()).to.not.equal(secondDate.getMonth())
  })
})
