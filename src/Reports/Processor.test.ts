import { expect } from 'chai'
import { processor } from './Processor.js'
import { mockPoolSnapshots } from '../tests/mocks/mockPoolSnapshots.js'
import { mockTrancheSnapshots } from '../tests/mocks/mockTrancheSnapshots.js'
import { PoolSnapshot } from '../queries/poolSnapshots.js'
import { TrancheSnapshot } from '../queries/trancheSnapshots.js'

describe('Processor', () => {
  describe('balanceSheet', () => {
    it('should process pool and tranche data correctly', () => {
      const result = processor.balanceSheet({
        poolSnapshots: mockPoolSnapshots,
        trancheSnapshots: mockTrancheSnapshots,
      })

      expect(result).to.have.lengthOf(2)
      const report = result[0]

      // Check pool data
      expect(report?.timestamp).to.equal('2024-01-01T12:00:00Z')
      expect(report?.assetValuation.toBigInt()).to.equal(0n)
      expect(report?.onchainReserve.toBigInt()).to.equal(0n)
      expect(report?.offchainCash.toBigInt()).to.equal(0n)
      expect(report?.accruedFees.toBigInt()).to.equal(0n)
      expect(report?.netAssetValue.toBigInt()).to.equal(0n)

      // Check tranche data
      expect(report?.tranches?.length).to.equal(2)
      const seniorTranche = report?.tranches?.find((t) => t.tokenId === 'senior')!
      const juniorTranche = report?.tranches?.find((t) => t.tokenId === 'junior')!

      expect(seniorTranche?.tokenSupply.toBigInt()).to.equal(0n)
      expect(seniorTranche?.tokenPrice!.toBigInt()).to.equal(1000000000000000000n)
      expect(seniorTranche?.trancheValue.toBigInt()).to.equal(0n)

      expect(juniorTranche?.tokenSupply.toBigInt()).to.equal(0n)
      expect(juniorTranche?.tokenPrice!.toBigInt()).to.equal(1120000000000000000n)
      expect(juniorTranche?.trancheValue.toBigInt()).to.equal(0n)

      // Check total capital
      expect(report?.totalCapital?.toBigInt()).to.equal(0n)
    })

    it('should throw error when no tranches found', () => {
      expect(() =>
        processor.balanceSheet({
          poolSnapshots: mockPoolSnapshots,
          trancheSnapshots: [],
        })
      ).to.throw('No tranches found for snapshot')
    })

    it('should group data by day when specified', () => {
      const result = processor.balanceSheet(
        {
          poolSnapshots: mockPoolSnapshots,
          trancheSnapshots: mockTrancheSnapshots,
        },
        { groupBy: 'day' }
      )

      expect(result).to.have.lengthOf(2)
      expect(result?.[0]?.timestamp.slice(0, 10)).to.equal('2024-01-01')
      expect(result?.[1]?.timestamp.slice(0, 10)).to.equal('2024-01-02')
    })

    it('should group data by month when specified', () => {
      const result = processor.balanceSheet(
        {
          poolSnapshots: mockPoolSnapshots,
          trancheSnapshots: mockTrancheSnapshots,
        },
        { groupBy: 'month' }
      )

      expect(result).to.have.lengthOf(1)
      expect(result?.[0]?.timestamp.slice(0, 10)).to.equal('2024-01-02')
    })
  })
})
