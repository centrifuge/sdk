import { expect } from 'chai'
import { processor } from './Processor.js'
import { mockPoolSnapshots } from '../tests/mocks/mockPoolSnapshots.js'
import { mockTrancheSnapshots } from '../tests/mocks/mockTrancheSnapshots.js'
import { mockPoolFeeSnapshots } from '../tests/mocks/mockPoolFeeSnapshot.js'
import { PoolSnapshot } from '../queries/poolSnapshots.js'
import { Currency } from '../utils/BigInt.js'
import { PoolFeeSnapshot, PoolFeeSnapshotsByDate } from '../queries/poolFeeSnapshots.js'

describe('Processor', () => {
  describe('balanceSheet', () => {
    it('should process pool and tranche data correctly', () => {
      const result = processor.balanceSheet({
        poolSnapshots: mockPoolSnapshots,
        trancheSnapshots: mockTrancheSnapshots,
      })

      expect(result).to.have.lengthOf(2)
      const report = result[0]

      expect(report?.timestamp).to.equal('2024-01-01T12:00:00Z')
      expect(report?.assetValuation.toBigInt()).to.equal(0n)
      expect(report?.onchainReserve.toBigInt()).to.equal(0n)
      expect(report?.offchainCash.toBigInt()).to.equal(0n)
      expect(report?.accruedFees.toBigInt()).to.equal(0n)
      expect(report?.netAssetValue.toBigInt()).to.equal(0n)

      expect(report?.tranches?.length).to.equal(2)
      const seniorTranche = report?.tranches?.find((t) => t.tokenId === 'senior')!
      const juniorTranche = report?.tranches?.find((t) => t.tokenId === 'junior')!

      expect(seniorTranche?.tokenPrice!.toBigInt()).to.equal(1000000000000000000n)
      expect(juniorTranche?.tokenPrice!.toBigInt()).to.equal(1120000000000000000n)
      expect(report?.totalCapital?.toBigInt()).to.equal(0n)
    })

    it('should throw error when no tranches found', () => {
      expect(() =>
        processor.balanceSheet({
          poolSnapshots: mockPoolSnapshots,
          trancheSnapshots: {},
        })
      ).to.throw('No tranches found for snapshot')
    })
    it('should return empty array when no pool snapshots found', () => {
      expect(
        processor.balanceSheet({
          poolSnapshots: [],
          trancheSnapshots: {},
        })
      ).to.deep.equal([])
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

  describe('cashflow', () => {
    const mockCashflowPoolSnapshots: PoolSnapshot[] = [
      {
        ...mockPoolSnapshots[0],
        id: 'pool-10',
        timestamp: '2024-01-01T12:00:00Z',
        sumPrincipalRepaidAmountByPeriod: Currency.fromFloat(1, 6), // 1.0
        sumInterestRepaidAmountByPeriod: Currency.fromFloat(0.05, 6), // 0.05
        sumBorrowedAmountByPeriod: Currency.fromFloat(2, 6), // 2.0
      },
      {
        ...mockPoolSnapshots[0],
        id: 'pool-11',
        timestamp: '2024-01-01T18:00:00Z', // Same day, different time
        sumPrincipalRepaidAmountByPeriod: Currency.fromFloat(0.5, 6), // 0.5
        sumInterestRepaidAmountByPeriod: Currency.fromFloat(0.025, 6), // 0.025
        sumBorrowedAmountByPeriod: Currency.fromFloat(1, 6), // 1.0
      },
      {
        ...mockPoolSnapshots[0],
        id: 'pool-12',
        timestamp: '2024-01-02T12:00:00Z', // Next day
        sumPrincipalRepaidAmountByPeriod: Currency.fromFloat(2, 6), // 2.0
        sumInterestRepaidAmountByPeriod: Currency.fromFloat(0.1, 6), // 0.1
        sumBorrowedAmountByPeriod: Currency.fromFloat(4, 6), // 4.0
      },
    ] as PoolSnapshot[]

    const mockCashflowFeeSnapshots: PoolFeeSnapshotsByDate = {
      '2024-01-01': [
        {
          ...mockPoolFeeSnapshots['2024-01-01']?.[0],
          poolFee: { name: 'serviceFee' },
          sumPaidAmountByPeriod: new Currency(1_000_000n, 6), // 1.0
          sumAccruedAmountByPeriod: new Currency(500_000n, 6), // 0.5
        } as PoolFeeSnapshot,
        {
          ...mockPoolFeeSnapshots['2024-01-01']?.[1],
          poolFee: { name: 'adminFee' },
          sumPaidAmountByPeriod: new Currency(2_000_000n, 6), // 2.0
          sumAccruedAmountByPeriod: new Currency(1_000_000n, 6), // 1.0
        } as PoolFeeSnapshot,
      ],
      '2024-01-02': [
        {
          ...mockPoolFeeSnapshots['2024-01-02']?.[0],
          poolFee: { name: 'serviceFee' },
          sumPaidAmountByPeriod: new Currency(3_000_000n, 6), // 3.0
          sumAccruedAmountByPeriod: new Currency(1_500_000n, 6), // 1.5
        } as PoolFeeSnapshot,
        {
          ...mockPoolFeeSnapshots['2024-01-02']?.[1],
          poolFee: { name: 'adminFee' },
          sumPaidAmountByPeriod: new Currency(4_000_000n, 6), // 4.0
          sumAccruedAmountByPeriod: new Currency(2_000_000n, 6), // 2.0
        } as PoolFeeSnapshot,
      ],
    }

    it('should aggregate values correctly when grouping by day', () => {
      const result = processor.cashflow(
        { poolSnapshots: mockCashflowPoolSnapshots, poolFeeSnapshots: mockCashflowFeeSnapshots },
        { groupBy: 'day' }
      )

      expect(result).to.have.lengthOf(2)

      const jan1 = result[0]
      expect(jan1?.timestamp.slice(0, 10)).to.equal('2024-01-01')
      expect(jan1?.principalPayments.toFloat()).to.equal(1.5) // 1.0 + 0.5
      expect(jan1?.interestPayments.toFloat()).to.equal(0.075) // 0.05 + 0.025
      expect(jan1?.assetPurchases.toFloat()).to.equal(3) // 2.0 + 1.0
      expect(jan1?.fees.length).to.equal(2)
      expect(jan1?.fees[0]?.name).to.equal('serviceFee')
      expect(jan1?.fees[1]?.name).to.equal('adminFee')
      expect(jan1?.fees[0]?.amount.toFloat()).to.equal(1)
      expect(jan1?.fees[1]?.amount.toFloat()).to.equal(2)
      expect(jan1?.fees[0]?.timestamp.slice(0, 10)).to.equal('2024-01-01')
      expect(jan1?.fees[1]?.timestamp.slice(0, 10)).to.equal('2024-01-01')

      const jan2 = result[1]
      expect(jan2?.timestamp.slice(0, 10)).to.equal('2024-01-02')
      expect(jan2?.principalPayments.toFloat()).to.equal(2) // 2.0
      expect(jan2?.interestPayments.toFloat()).to.equal(0.1) // 0.1
      expect(jan2?.assetPurchases.toFloat()).to.equal(4) // 4.0
      expect(jan2?.fees.length).to.equal(2)
      expect(jan2?.fees[0]?.name).to.equal('serviceFee')
      expect(jan2?.fees[1]?.name).to.equal('adminFee')
      expect(jan2?.fees[0]?.amount.toFloat()).to.equal(3)
      expect(jan2?.fees[1]?.amount.toFloat()).to.equal(4)
      expect(jan2?.fees[0]?.timestamp.slice(0, 10)).to.equal('2024-01-02')
      expect(jan2?.fees[1]?.timestamp.slice(0, 10)).to.equal('2024-01-02')
    })

    it('should aggregate values correctly when grouping by month (except for fees)', () => {
      const result = processor.cashflow(
        { poolSnapshots: mockCashflowPoolSnapshots, poolFeeSnapshots: mockCashflowFeeSnapshots },
        { groupBy: 'month' }
      )

      expect(result).to.have.lengthOf(1)

      const january = result[0]
      expect(january?.timestamp.slice(0, 7)).to.equal('2024-01')
      expect(january?.principalPayments.toFloat()).to.equal(3.5) // 1.0 + 0.5 + 2.0
      expect(january?.interestPayments.toFloat()).to.equal(0.175) // 0.05 + 0.025 + 0.1
      expect(january?.assetPurchases.toFloat()).to.equal(7) // 2.0 + 1.0 + 4.0
      expect(january?.fees.length).to.equal(2)
      expect(january?.fees[0]?.name).to.equal('serviceFee')
      expect(january?.fees[1]?.name).to.equal('adminFee')
      // fees are NOT aggregated by period
      expect(january?.fees[0]?.amount.toFloat()).to.equal(3)
      expect(january?.fees[1]?.amount.toFloat()).to.equal(4)
    })
  })
})
