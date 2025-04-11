import { expect } from 'chai'
import { spy } from 'sinon'
import { Centrifuge } from '../../Centrifuge.js'
import { AssetListReportPublicCredit, ProfitAndLossReportPublicCredit, ReportFilter } from '../../types/reports.js'
import { PoolId } from '../../utils/types.js'
import { Reports } from '../Reports/index.js'
import { processor } from './Processor.js'

describe.skip('Reports', () => {
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
      const ns3PoolId = new PoolId('1615768079')
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
      const ns3PoolId = new PoolId('1615768079')
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
      const ns3PoolId = new PoolId('1615768079')
      const pool = await centrifuge.pool(ns3PoolId)
      const reports = new Reports(centrifuge, pool)

      const filter: ReportFilter = {
        from: '2024-10-03',
        to: '2024-10-06',
        groupBy: 'day',
      }

      const report = await reports.balanceSheet(filter)
      expect(processBalanceSheetSpy.callCount).to.equal(1)
      expect(report.length).to.equal(4)

      // Different query should fetch new data
      const report2 = await reports.balanceSheet({ ...filter, to: '2024-10-10' })

      expect(processBalanceSheetSpy.callCount).to.equal(2)
      expect(report2.length).to.equal(8)

      const report3 = await reports.balanceSheet({ ...filter, groupBy: 'month' })

      expect(processBalanceSheetSpy.callCount).to.equal(3)
      expect(report3.length).to.equal(1)

      processBalanceSheetSpy.restore()
    })

    it('should retrieve 6 months worth of data and group by day, month, quarter and year', async () => {
      const anemoyPoolId = new PoolId('4139607887')
      const pool = await centrifuge.pool(anemoyPoolId)
      const reports = new Reports(centrifuge, pool)
      let filter: ReportFilter = {
        from: '2024-01-01',
        to: '2024-06-30',
        groupBy: 'day',
      }
      const report = await reports.balanceSheet(filter)
      expect(report.length).to.equal(182)

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
    it('should check the total capital and tranche value with production data', async () => {
      const anemoyPoolId = new PoolId('4139607887')
      const pool = await centrifuge.pool(anemoyPoolId)
      const report = await pool.reports.balanceSheet({
        from: '2024-01-31',
        to: '2024-01-31',
        groupBy: 'day',
      })
      expect(report[0]?.totalCapital?.toString()).to.equal('4605474877478')
      expect(report[0]?.tranches?.[0]?.trancheValue?.toString()).to.equal('4605474877478')
    })
  })

  describe('cashflow report', () => {
    it('should fetch cashflow report', async () => {
      const processCashflowSpy = spy(processor, 'cashflow')
      const ltfPoolId = new PoolId('4139607887')
      const pool = await centrifuge.pool(ltfPoolId)
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
      const anemoyPoolId = new PoolId('4139607887')
      const pool = await centrifuge.pool(anemoyPoolId)
      const reports = new Reports(centrifuge, pool)
      let filter: ReportFilter = {
        from: '2024-01-01',
        to: '2024-06-30',
        groupBy: 'day',
      }
      const report = await reports.cashflow(filter)
      expect(report.length).to.equal(182)
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
      const ns3PoolId = new PoolId('1615768079')
      const pool = await centrifuge.pool(ns3PoolId)
      const report = await pool.reports.profitAndLoss({
        from: '2024-11-02T22:11:29.776Z',
        to: '2024-11-06T22:11:29.776Z',
        groupBy: 'day',
      })
      expect(report.length).to.equal(4)
    })
    it('should provide the correct totalIncome for Anemoy on 01/01/2025', async () => {
      const anemoyPoolId = new PoolId('4139607887')
      const pool = await centrifuge.pool(anemoyPoolId)
      const report = await pool.reports.profitAndLoss({
        from: '2025-01-01',
        to: '2025-01-01',
        groupBy: 'day',
      })
      expect((report[0] as ProfitAndLossReportPublicCredit)?.totalIncome.toString()).to.equal('4847257770')
    })
    it('should retrieve 6 months worth of data and group by day, month, quarter and year', async () => {
      const anemoyPoolId = new PoolId('4139607887')
      const pool = await centrifuge.pool(anemoyPoolId)
      const reports = new Reports(centrifuge, pool)
      let filter: ReportFilter = {
        from: '2024-01-01',
        to: '2024-06-30',
        groupBy: 'day',
      }
      const report = await reports.profitAndLoss(filter)
      expect(report.length).to.equal(182)

      filter = {
        ...filter,
        groupBy: 'month',
      }
      const report2 = await reports.profitAndLoss(filter)
      expect(report2.length).to.equal(6)
      expect(report?.[report.length - 1]?.timestamp.slice(0, 10)).to.equal('2024-06-30')
      expect(report?.[report.length - 1]?.subtype).to.equal('publicCredit') // real data
      expect((report?.[report.length - 1] as ProfitAndLossReportPublicCredit)?.totalIncome).to.exist
      expect((report?.[report.length - 1] as ProfitAndLossReportPublicCredit)?.totalIncome.toString()).to.equal('0') // real data

      filter = {
        ...filter,
        groupBy: 'quarter',
      }
      const report3 = await reports.profitAndLoss(filter)
      expect(report3.length).to.equal(2)

      filter = {
        ...filter,
        groupBy: 'year',
      }
      const report4 = await reports.profitAndLoss(filter)
      expect(report4.length).to.equal(1)
      expect(report4?.[0]?.timestamp.slice(0, 10)).to.equal('2024-06-30')
    })
    it('should retrieve monthly data starting with Jan 2024', async () => {
      const anemoyPoolId = new PoolId('4139607887')
      const pool = await centrifuge.pool(anemoyPoolId)
      const report = await pool.reports.profitAndLoss({
        from: '2024-01-11',
        to: '2025-01-28',
        groupBy: 'month',
      })
      expect(report.length).to.equal(13)
      expect(report[0]?.timestamp.slice(0, 7)).to.equal('2024-01')
      expect(report[report.length - 1]?.timestamp.slice(0, 7)).to.equal('2025-01')
      expect(report[report.length - 2]?.timestamp.slice(0, 7)).to.equal('2024-12')
    })
    it('should retrieve quarterly data starting with Q3 2023', async () => {
      const anemoyPoolId = new PoolId('4139607887')
      const pool = await centrifuge.pool(anemoyPoolId)
      const report = await pool.reports.profitAndLoss({
        from: '2023-01-01',
        to: '2025-01-01',
        groupBy: 'quarter',
      })
      expect(report.length).to.equal(7)
      expect(report[0]?.timestamp.slice(0, 7)).to.equal('2023-09')
    })
    it('should retrieve yearly data starting in Sept 2023', async () => {
      const anemoyPoolId = new PoolId('4139607887')
      const pool = await centrifuge.pool(anemoyPoolId)
      const report = await pool.reports.profitAndLoss({
        from: '2023-09-18',
        to: '2025-01-01',
        groupBy: 'year',
      })
      expect(report.length).to.equal(3)
      expect(report[0]?.timestamp.slice(0, 10)).to.equal('2023-12-31')
      expect(report[0]?.totalProfitAndLoss.toBigInt()).to.equal(0n)
      expect(report[1]?.timestamp.slice(0, 10)).to.equal('2024-12-31')
      expect(report[1]?.totalProfitAndLoss.toBigInt()).to.equal(170194942096n)
      expect(report[2]?.timestamp.slice(0, 10)).to.equal('2025-01-01')
      expect(report[2]?.totalProfitAndLoss.toBigInt()).to.equal(5003078970n)
    })
  })

  describe('investor transactions report', () => {
    it('should fetch investor transactions report', async () => {
      const anemoyPoolId = new PoolId('4139607887')
      const pool = await centrifuge.pool(anemoyPoolId)
      const report = await pool.reports.investorTransactions({
        from: '2024-01-16T22:11:29.776Z',
        to: '2024-01-19T22:11:29.776Z',
      })
      expect(report.length).to.equal(5)
    })
    it('should filter by evm address', async () => {
      const anemoyPoolId = new PoolId('4139607887')
      const pool = await centrifuge.pool(anemoyPoolId)
      const report = await pool.reports.investorTransactions({
        from: '2024-01-01T22:11:29.776Z',
        to: '2024-12-03T22:11:29.776Z',
        address: '0x86552B8d4F4a600D92d516eE8eA8B922EFEcB561',
      })
      expect(report.length).to.equal(3)
    })
    it('should filter by substrate address (subtrate address must be converted to evm style)', async () => {
      const anemoyPoolId = new PoolId('4139607887')
      const pool = await centrifuge.pool(anemoyPoolId)
      const report = await pool.reports.investorTransactions({
        from: '2024-01-01T22:11:29.776Z',
        to: '2024-12-03T22:11:29.776Z',
        address: '0xa23adc45d99e11ba3dbe9c029a4d378565eeb663e393569cee93fd9f89610faf', // 4f1TYnM7qt92veCgRjZy9rgMWXQRS2825NmcBiY9yHFbAXJa
      })
      expect(report.length).to.equal(8)
    })
  })

  describe('asset transactions report', () => {
    it('should fetch asset transactions report', async () => {
      const anemoyPoolId = new PoolId('4139607887')
      const pool = await centrifuge.pool(anemoyPoolId)
      const report = await pool.reports.assetTransactions({
        from: '2024-01-01T22:11:29.776Z',
        to: '2024-01-03T22:11:29.776Z',
      })
      expect(report.length).to.equal(5)
    })
    it('should return empty array when no transactions found', async () => {
      const anemoyPoolId = new PoolId('4139607887')
      const pool = await centrifuge.pool(anemoyPoolId)
      const report = await pool.reports.assetTransactions({
        to: '2024-01-01T22:11:29.776Z',
        from: '2024-01-01T22:11:29.776Z',
      })
      expect(report).to.deep.equal([])
    })
    it('should filter by transaction type', async () => {
      const anemoyPoolId = new PoolId('4139607887')
      const pool = await centrifuge.pool(anemoyPoolId)
      const report = await pool.reports.assetTransactions({
        from: '2024-06-30T22:11:29.776Z',
        to: '2024-12-04T22:11:29.776Z',
        transactionType: 'financed',
      })
      expect(report.length).to.equal(13)
    })
    it('should filter by asset id', async () => {
      const anemoyPoolId = new PoolId('4139607887')
      const pool = await centrifuge.pool(anemoyPoolId)
      const report = await pool.reports.assetTransactions({
        from: '2024-01-01T22:11:29.776Z',
        to: '2024-12-04T22:11:29.776Z',
        assetId: '14',
      })
      expect(report.length).to.equal(2)
    })
  })

  describe('fee transactions report', () => {
    it('should fetch fee transactions report', async () => {
      const anemoyPoolId = new PoolId('4139607887')
      const pool = await centrifuge.pool(anemoyPoolId)
      const report = await pool.reports.feeTransactions({
        from: '2024-12-01',
        to: '2024-12-03',
      })
      expect(report.length).to.equal(6)
    })
    it('should filter by transaction type paid', async () => {
      const anemoyPoolId = new PoolId('4139607887')
      const pool = await centrifuge.pool(anemoyPoolId)
      const report = await pool.reports.feeTransactions({
        from: '2024-07-23',
        to: '2024-07-26',
        transactionType: 'paid',
      })
      expect(report.length).to.equal(2)
    })
    it('should filter by transaction type directChargeMade', async () => {
      const anemoyPoolId = new PoolId('4139607887')
      const pool = await centrifuge.pool(anemoyPoolId)
      const report = await pool.reports.feeTransactions({
        from: '2024-03-28T22:11:29.776Z',
        to: '2024-12-26T22:11:29.776Z',
        transactionType: 'directChargeMade',
      })
      expect(report.length).to.equal(0)
    })
  })

  describe('token price report', () => {
    it('should fetch token price report', async () => {
      const anemoyPoolId = new PoolId('4139607887')
      const pool = await centrifuge.pool(anemoyPoolId)
      const report = await pool.reports.tokenPrice({
        from: '2024-01-01T22:11:29.776Z',
        to: '2024-01-03T22:11:29.776Z',
      })
      expect(report.length).to.equal(2)
    })
    it('should group by month', async () => {
      const anemoyPoolId = new PoolId('4139607887')
      const pool = await centrifuge.pool(anemoyPoolId)
      const report = await pool.reports.tokenPrice({
        from: '2024-01-01T22:11:29.776Z',
        to: '2024-02-03T22:11:29.776Z',
        groupBy: 'month',
      })
      expect(report.length).to.equal(2)
    })
    it('should group by quarter', async () => {
      const anemoyPoolId = new PoolId('4139607887')
      const pool = await centrifuge.pool(anemoyPoolId)
      const report = await pool.reports.tokenPrice({
        from: '2024-01-01T22:11:29.776Z',
        to: '2024-12-03T22:11:29.776Z',
        groupBy: 'quarter',
      })
      expect(report.length).to.equal(4)
    })
    it('should group by year', async () => {
      const anemoyPoolId = new PoolId('4139607887')
      const pool = await centrifuge.pool(anemoyPoolId)
      const report = await pool.reports.tokenPrice({
        from: '2024-01-01T22:11:29.776Z',
        to: '2024-12-03T22:11:29.776Z',
        groupBy: 'year',
      })
      expect(report.length).to.equal(1)
    })
  })

  describe('asset list report', () => {
    it('should fetch asset list report', async () => {
      const anemoyPoolId = new PoolId('4139607887')
      const pool = await centrifuge.pool(anemoyPoolId)
      const report = await pool.reports.assetList({
        from: '2024-01-01T22:11:29.776Z',
        to: '2024-01-03T22:11:29.776Z',
      })
      expect(report.length).to.equal(4)
      expect(report?.[0]?.subtype).to.equal('publicCredit')
    })
    it('should filter by status ongoing', async () => {
      const anemoyPoolId = new PoolId('4139607887')
      const pool = await centrifuge.pool(anemoyPoolId)
      const report = await pool.reports.assetList({
        status: 'ongoing',
        from: '2024-01-01T00:00:00.000Z',
        to: '2024-01-06T23:59:59.999Z',
      })
      expect(report.length).to.equal(0)
    })
    it('should filter by status overdue', async () => {
      const anemoyPoolId = new PoolId('4139607887')
      const pool = await centrifuge.pool(anemoyPoolId)
      const report = await pool.reports.assetList({
        status: 'overdue',
        from: '2024-01-01T00:00:00.000Z',
        to: '2024-01-06T23:59:59.999Z',
      })
      expect(report.length).to.equal(6)
    })
    it('should check marketPrice and faceValue with production data', async () => {
      const anemoyPoolId = new PoolId('4139607887')
      const pool = await centrifuge.pool(anemoyPoolId)
      const report = await pool.reports.assetList({
        from: '2024-01-01T00:00:00.000Z',
        to: '2024-01-06T23:59:59.999Z',
      })
      expect((report[0] as AssetListReportPublicCredit).currentPrice?.toDecimal().toString()).to.equal('97.728111')
      expect((report[0] as AssetListReportPublicCredit).faceValue?.toDecimal().toString()).to.equal('512000')
    })
  })

  describe('investor list report', () => {
    it('should fetch investor list report', async () => {
      const anemoyPoolId = new PoolId('4139607887')
      const pool = await centrifuge.pool(anemoyPoolId)
      const report = await pool.reports.investorList({
        to: '2024-12-31T23:59:59.999Z',
      })
      expect(report.length).to.equal(8)
    })
    it('should filter by network', async () => {
      const anemoyPoolId = new PoolId('4139607887')
      const pool = await centrifuge.pool(anemoyPoolId)
      const report = await pool.reports.investorList({ network: 1, to: '2024-12-31T23:59:59.999Z' })
      expect(report.length).to.equal(3)
    })
    it('should filter by network centrifuge', async () => {
      const anemoyPoolId = new PoolId('4139607887')
      const pool = await centrifuge.pool(anemoyPoolId)
      const report = await pool.reports.investorList({ network: 'centrifuge', to: '2024-12-31T23:59:59.999Z' })
      expect(report.length).to.equal(1)
    })
    it('should filter by network all', async () => {
      const anemoyPoolId = new PoolId('4139607887')
      const pool = await centrifuge.pool(anemoyPoolId)
      const report = await pool.reports.investorList({ network: 'all', to: '2024-12-31T23:59:59.999Z' })
      expect(report.length).to.equal(8)
    })
    it('should filter by tranche', async () => {
      const anemoyPoolId = new PoolId('4139607887')
      const pool = await centrifuge.pool(anemoyPoolId)
      const report = await pool.reports.investorList({ trancheId: '0x97aa65f23e7be09fcd62d0554d2e9273' })
      expect(report.length).to.equal(8)
    })
    it('should filter by address', async () => {
      const anemoyPoolId = new PoolId('4139607887')
      const pool = await centrifuge.pool(anemoyPoolId)
      const report = await pool.reports.investorList({
        address: '0x6f94eb271ceb5a33aeab5bb8b8edea8ecf35ee86',
        to: '2024-12-31T23:59:59.999Z',
      })
      expect(report.length).to.equal(1)
    })
    it('should check pool percentage with production data', async () => {
      const anemoyPoolId = new PoolId('4139607887')
      const pool = await centrifuge.pool(anemoyPoolId)
      const report = await pool.reports.investorList({
        from: '2024-01-01',
        to: '2024-01-01',
      })
      expect(report.length).to.equal(8)
      const investorWithMaxPercentage = report.find(
        (investor) => investor.evmAddress === '0x6f94eb271ceb5a33aeab5bb8b8edea8ecf35ee86'
      )
      expect(investorWithMaxPercentage?.poolPercentage.toDecimal().toString()).to.equal('0.78048089390228782509666569')
    })
  })

  describe('orders list report', () => {
    it('should fetch orders list report', async () => {
      const anemoyPoolId = new PoolId('4139607887')
      const pool = await centrifuge.pool(anemoyPoolId)
      const report = await pool.reports.ordersList({
        from: '2024-01-01T22:11:29.776Z',
        to: '2024-01-03T22:11:29.776Z',
      })
      expect(report.length).to.equal(1)
    })
    it('should fetch orders list report filtered by date', async () => {
      const anemoyPoolId = new PoolId('4139607887')
      const pool = await centrifuge.pool(anemoyPoolId)
      const report = await pool.reports.ordersList({
        from: '2024-01-01T22:11:29.776Z',
        to: '2024-01-03T22:11:29.776Z',
      })
      expect(report.length).to.equal(1)
    })
    it('should fetch orders list report', async () => {
      const anemoyPoolId = new PoolId('4139607887')
      const pool = await centrifuge.pool(anemoyPoolId)
      const report = await pool.reports.ordersList({
        to: '2024-12-31T23:59:59.999Z',
      })
      expect(report.length).to.equal(28)
    })
  })

  describe('asset time series report', () => {
    it('should fetch asset time series report', async () => {
      const anemoyPoolId = new PoolId('4139607887')
      const pool = await centrifuge.pool(anemoyPoolId)
      const report = await pool.reports.assetTimeSeries({
        from: '2024-01-01T22:11:29.776Z',
        to: '2024-01-03T22:11:29.776Z',
      })
      expect(report.length).to.equal(5)
    })
    it('should filter by name', async () => {
      const anemoyPoolId = new PoolId('4139607887')
      const pool = await centrifuge.pool(anemoyPoolId)
      const report = await pool.reports.assetTimeSeries({
        name: '912797HT7',
        from: '2024-01-01T22:11:29.776Z',
        to: '2024-01-03T22:11:29.776Z',
      })
      expect(report.length).to.equal(2)
    })
    it('should filter by asset id', async () => {
      const anemoyPoolId = new PoolId('4139607887')
      const pool = await centrifuge.pool(anemoyPoolId)
      const report = await pool.reports.assetTimeSeries({
        assetId: '2',
        from: '2024-01-01T22:11:29.776Z',
        to: '2024-01-03T22:11:29.776Z',
      })
      expect(report.length).to.equal(2)
    })
  })
})
