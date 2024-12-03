import { expect } from 'chai'
import { Centrifuge } from '../Centrifuge.js'
import { spy } from 'sinon'
import { Reports } from '../Reports/index.js'
import { ReportFilter } from './types.js'
import { processor } from './Processor.js'

describe('Reports', () => {
  let centrifuge: Centrifuge

  before(() => {
    centrifuge = new Centrifuge({
      environment: 'mainnet',
      indexerUrl: 'https://subql.embrio.tech/',
    })
  })

  describe('balance sheet report', () => {
    it('should fetch balance sheet report', async () => {
      const processBalanceSheetSpy = spy(processor, 'balanceSheet')
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
        balanceSheetReport?.[0]?.timestamp.slice(0, 10)
      )
      expect(processBalanceSheetSpy.callCount).to.equal(1)
      processBalanceSheetSpy.restore()
    })

    it('should use cached data for repeated queries', async () => {
      const processBalanceSheetSpy = spy(processor, 'balanceSheet')
      const ns3PoolId = '1615768079'
      const pool = await centrifuge.pool(ns3PoolId)
      const reports = new Reports(centrifuge, pool)

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

      processBalanceSheetSpy.restore()
    })

    it('should fetch new data for different query', async () => {
      const processBalanceSheetSpy = spy(processor, 'balanceSheet')
      const ns3PoolId = '1615768079'
      const pool = await centrifuge.pool(ns3PoolId)
      const reports = new Reports(centrifuge, pool)

      const filter: ReportFilter = {
        from: '2024-10-03T22:11:29.776Z',
        to: '2024-10-06T22:11:29.776Z',
        groupBy: 'day',
      }

      const report = await reports.balanceSheet(filter)
      expect(processBalanceSheetSpy.callCount).to.equal(1)
      expect(report.length).to.equal(3)

      // Different query should fetch new data
      const report2 = await reports.balanceSheet({ ...filter, to: '2024-10-10T22:11:29.776Z' })

      expect(processBalanceSheetSpy.callCount).to.equal(2)
      expect(report2.length).to.equal(7)

      const report3 = await reports.balanceSheet({ ...filter, groupBy: 'month' })

      expect(processBalanceSheetSpy.callCount).to.equal(3)
      expect(report3.length).to.equal(1)

      processBalanceSheetSpy.restore()
    })

    it('should retrieve 6 months worth of data and group by day, month, quarter and year', async () => {
      const anemoyPoolId = '4139607887'
      const pool = await centrifuge.pool(anemoyPoolId)
      const reports = new Reports(centrifuge, pool)
      let filter: ReportFilter = {
        from: '2024-01-01',
        to: '2024-06-30',
        groupBy: 'day',
      }
      const report = await reports.balanceSheet(filter)
      expect(report.length).to.equal(181)

      filter = {
        ...filter,
        groupBy: 'month',
      }
      const report2 = await reports.balanceSheet(filter)
      expect(report2.length).to.equal(6)
      expect(report?.[report.length - 1]?.timestamp.slice(0, 10)).to.equal('2024-06-30')
      expect(report?.[report.length - 1]?.netAssetValue.toString()).to.equal('11865636571724') // real data

      filter = {
        ...filter,
        groupBy: 'quarter',
      }
      const report3 = await reports.balanceSheet(filter)
      expect(report3.length).to.equal(2)

      filter = {
        ...filter,
        groupBy: 'year',
      }
      const report4 = await reports.balanceSheet(filter)
      expect(report4.length).to.equal(1)
      expect(report4?.[0]?.timestamp.slice(0, 10)).to.equal('2024-06-30')
    })
  })

  describe('cashflow report', () => {
    it('should fetch cashflow report', async () => {
      const processCashflowSpy = spy(processor, 'cashflow')
      const ltfPoolId = '4139607887'
      const lftMetadataHash = 'QmTjbzx4mX1A9vRFxzLDZszKQSTsFbH8YgnpfmTSfWx73G'
      const pool = await centrifuge.pool(ltfPoolId, lftMetadataHash)
      const cashflowReport = await pool.reports.cashflow({
        from: '2024-11-02T22:11:29.776Z',
        to: '2024-11-06T22:11:29.776Z',
        groupBy: 'day',
      })
      expect(cashflowReport.length).to.be.eql(4)
      expect(processCashflowSpy.callCount).to.equal(1)
      expect(cashflowReport?.[0]?.timestamp.slice(0, 10)).to.be.eq(
        cashflowReport?.[0]?.fees?.[0]?.timestamp.slice(0, 10)
      )
    })
    it('should retrieve 6 months worth of data and group by day, month, quarter and year', async () => {
      const anemoyPoolId = '4139607887'
      const pool = await centrifuge.pool(anemoyPoolId)
      const reports = new Reports(centrifuge, pool)
      let filter: ReportFilter = {
        from: '2024-01-01',
        to: '2024-06-30',
        groupBy: 'day',
      }
      const report = await reports.cashflow(filter)
      expect(report.length).to.equal(181)
      expect(report?.[report.length - 1]?.timestamp.slice(0, 10)).to.equal('2024-06-30')

      filter = {
        ...filter,
        groupBy: 'month',
      }
      const report2 = await reports.cashflow(filter)
      expect(report2.length).to.equal(6)
      expect(report2?.[report2.length - 1]?.totalCashflow.toString()).to.equal('-8374299271') // real data

      filter = {
        ...filter,
        groupBy: 'quarter',
      }
      const report3 = await reports.cashflow(filter)
      expect(report3.length).to.equal(2)

      filter = {
        ...filter,
        groupBy: 'year',
      }
      const report4 = await reports.cashflow(filter)
      expect(report4.length).to.equal(1)
      expect(report4?.[0]?.timestamp.slice(0, 10)).to.equal('2024-06-30')
    })
  })
  describe('profit and loss report', () => {
    it('should fetch profit and loss report', async () => {
      const pool = await centrifuge.pool('1615768079')
      const report = await pool.reports.profitAndLoss({
        from: '2024-11-02T22:11:29.776Z',
        to: '2024-11-06T22:11:29.776Z',
        groupBy: 'day',
      })
      expect(report.length).to.equal(4)
    })
  })
  describe('investor transactions report', () => {
    it('should fetch investor transactions report', async () => {
      const anemoyPoolId = '4139607887'
      const pool = await centrifuge.pool(anemoyPoolId)
      const report = await pool.reports.investorTransactions({
        from: '2024-01-16T22:11:29.776Z',
        to: '2024-01-19T22:11:29.776Z',
      })
      expect(report.length).to.equal(5)
    })
    it('should filter by evm address', async () => {
      const anemoyPoolId = '4139607887'
      const pool = await centrifuge.pool(anemoyPoolId)
      const report = await pool.reports.investorTransactions({
        from: '2024-01-01T22:11:29.776Z',
        to: '2024-12-03T22:11:29.776Z',
        address: '0x86552B8d4F4a600D92d516eE8eA8B922EFEcB561',
      })
      expect(report.length).to.equal(3)
    })
    it('should filter by substrate address (subtrate address must be converted to evm style)', async () => {
      const anemoyPoolId = '4139607887'
      const pool = await centrifuge.pool(anemoyPoolId)
      const report = await pool.reports.investorTransactions({
        from: '2024-01-01T22:11:29.776Z',
        to: '2024-12-03T22:11:29.776Z',
        address: '0xa23adc45d99e11ba3dbe9c029a4d378565eeb663e393569cee93fd9f89610faf', // 4f1TYnM7qt92veCgRjZy9rgMWXQRS2825NmcBiY9yHFbAXJa
      })
      expect(report.length).to.equal(8)
    })
  })
})
