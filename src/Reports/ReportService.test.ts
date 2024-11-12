import { expect, use } from 'chai'
import sinon from 'sinon'
import { ReportService } from './ReportService.js'
import { ReportData, ReportFilter } from './types.js'
import { Currency, Price } from '../utils/BigInt.js'
import sinonChai from 'sinon-chai'

interface TestReport extends ReportData {
  timestamp: string
  value: Currency
  nested: {
    price: Price
  }
}

use(sinonChai)

describe('ReportService', () => {
  let clock: sinon.SinonFakeTimers
  const mockData: TestReport = {
    timestamp: '2024-01-01T00:00:00Z',
    value: new Currency(1000000n, 6),
    nested: {
      price: Price.fromFloat('1.02'),
    },
  }

  const createMockProcessor = (response = [mockData]) => ({
    process: sinon.stub().returns(response),
    getCacheKey: (poolId: string, filter?: ReportFilter) =>
      ['test', poolId, filter?.from, filter?.to].filter(Boolean).join(':'),
  })

  beforeEach(() => {
    ReportService.cleanup()
    clock = sinon.useFakeTimers(new Date('2024-01-01').getTime())
  })

  afterEach(() => {
    clock.restore()
  })

  describe('Cache Management', () => {
    it('should cache results and reuse them', async () => {
      const mockProcessor = createMockProcessor()

      const result1 = await ReportService.generate(mockProcessor, 'pool1', {})
      const result2 = await ReportService.generate(mockProcessor, 'pool1', {})

      expect(mockProcessor.process.callCount).to.equal(1)
      expect(result1).to.deep.equal(result2)
    })

    it('should create different cache entries for different pools', async () => {
      const mockProcessor = createMockProcessor()

      await ReportService.generate(mockProcessor, 'pool1', {})
      await ReportService.generate(mockProcessor, 'pool2', {})

      expect(mockProcessor.process.callCount).to.equal(2)
    })

    it('should create different cache entries for different filters', async () => {
      const mockProcessor = createMockProcessor()

      await ReportService.generate(mockProcessor, 'pool1', {}, { from: '2024-01-01' })
      await ReportService.generate(mockProcessor, 'pool1', {}, { from: '2024-01-02' })

      expect(mockProcessor.process.callCount).to.equal(2)
    })

    it('should expire cache after TTL', async () => {
      const mockProcessor = createMockProcessor()

      await ReportService.generate(mockProcessor, 'pool1', {})

      // Move time forward past TTL (5 minutes)
      clock.tick(6 * 60 * 1000)

      await ReportService.generate(mockProcessor, 'pool1', {})

      expect(mockProcessor.process.callCount).to.equal(2)
    })

    it('should keep cache within TTL', async () => {
      const mockProcessor = createMockProcessor()

      await ReportService.generate(mockProcessor, 'pool1', {})

      // Move time forward but stay within TTL
      clock.tick(4 * 60 * 1000)

      await ReportService.generate(mockProcessor, 'pool1', {})

      expect(mockProcessor.process.callCount).to.equal(1)
    })

    it('should cleanup expired cache entries', async () => {
      const mockProcessor = createMockProcessor()

      await ReportService.generate(mockProcessor, 'pool1', {})
      await ReportService.generate(mockProcessor, 'pool2', {})

      // Move time forward past TTL
      clock.tick(6 * 60 * 1000)

      // Cleanup should remove expired entries
      ReportService.cleanup()

      // Both should reprocess (no cache)
      await ReportService.generate(mockProcessor, 'pool1', {})
      await ReportService.generate(mockProcessor, 'pool2', {})

      expect(mockProcessor.process.callCount).to.equal(4)
    })
  })

  describe('Report Generation', () => {
    it('should return correctly structured report', async () => {
      const mockProcessor = createMockProcessor()
      const report = await ReportService.generate<any, TestReport>(mockProcessor, 'pool1', {})

      expect(report).to.be.an('array')
      expect(report).to.have.lengthOf(1)
      expect(report?.[0]).to.have.all.keys(['timestamp', 'value', 'nested'])
      expect(report?.[0]?.value).to.be.instanceOf(Currency)
      expect(report?.[0]?.nested.price).to.be.instanceOf(Price)
    })

    it('should handle empty results', async () => {
      const mockProcessor = createMockProcessor([])
      const report = await ReportService.generate(mockProcessor, 'pool1', {})

      expect(report).to.be.an('array')
      expect(report).to.have.lengthOf(0)
    })

    it('should handle multiple results', async () => {
      const mockProcessor = createMockProcessor([mockData, mockData])
      const report = await ReportService.generate(mockProcessor, 'pool1', {})

      expect(report).to.be.an('array')
      expect(report).to.have.lengthOf(2)
    })

    it('should pass filters to processor', async () => {
      const mockProcessor = createMockProcessor()
      const filter = { from: '2024-01-01', to: '2024-01-31' }

      await ReportService.generate(mockProcessor, 'pool1', {}, filter)

      expect(mockProcessor.process).to.have.been.calledWith(sinon.match.any, sinon.match(filter))
    })

    it('should preserve data types in cached results', async () => {
      const mockProcessor = createMockProcessor()

      await ReportService.generate(mockProcessor, 'pool1', {})
      const result2 = await ReportService.generate<any, TestReport>(mockProcessor, 'pool1', {})

      expect(result2?.[0]?.value).to.be.instanceOf(Currency)
      expect(result2?.[0]?.nested.price).to.be.instanceOf(Price)
      expect(result2?.[0]?.value.toDecimal().toString()).to.equal('1')
      expect(result2?.[0]?.nested.price.toDecimal().toString()).to.equal('1.02')
    })
  })
})
