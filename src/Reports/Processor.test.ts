import { expect } from 'chai'
import { processor } from './Processor.js'
import { mockPoolSnapshots } from '../tests/mocks/mockPoolSnapshots.js'
import { mockFeeTransactions } from '../tests/mocks/mockPoolFeeTransactions.js'
import { mockTrancheSnapshots } from '../tests/mocks/mockTrancheSnapshots.js'
import { mockPoolFeeSnapshots } from '../tests/mocks/mockPoolFeeSnapshot.js'
import { mockPoolMetadata } from '../tests/mocks/mockPoolMetadata.js'
import { mockInvestorTransactions } from '../tests/mocks/mockInvestorTransactions.js'
import { mockAssetTransactions } from '../tests/mocks/mockAssetTransactions.js'
import { PoolSnapshot } from '../queries/poolSnapshots.js'
import { Currency, Price, Token } from '../utils/BigInt.js'
import { PoolFeeSnapshot, PoolFeeSnapshotsByDate } from '../queries/poolFeeSnapshots.js'
import {
  AssetTransactionReportFilter,
  ProfitAndLossReportPrivateCredit,
  ProfitAndLossReportPublicCredit,
} from '../types/reports.js'
import { InvestorTransaction } from '../queries/investorTransactions.js'

describe('Processor', () => {
  describe('balanceSheet processor', () => {
    it('should return empty array when no pool snapshots found', () => {
      expect(
        processor.balanceSheet({
          poolSnapshots: [],
          trancheSnapshots: {},
        })
      ).to.deep.equal([])
    })
    it('should throw error when no tranches found', () => {
      expect(() =>
        processor.balanceSheet({
          poolSnapshots: mockPoolSnapshots,
          trancheSnapshots: {},
        })
      ).to.throw('No tranches found for snapshot')
    })
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

  describe('cashflow processor', () => {
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

    it('should return empty array when no snapshots found', () => {
      expect(processor.cashflow({ poolSnapshots: [], poolFeeSnapshots: {}, metadata: undefined })).to.deep.equal([])
    })

    it('should aggregate values correctly when grouping by day', () => {
      const result = processor.cashflow(
        {
          poolSnapshots: mockCashflowPoolSnapshots,
          poolFeeSnapshots: mockCashflowFeeSnapshots,
          metadata: mockPoolMetadata,
        },
        { groupBy: 'day' }
      )

      expect(result).to.have.lengthOf(2)

      const jan1 = result[0]
      expect(jan1?.timestamp.slice(0, 10)).to.equal('2024-01-01')
      expect(jan1?.principalPayments.toFloat()).to.equal(1.5) // 1.0 + 0.5
      expect(jan1?.interestPayments.toFloat()).to.equal(0.075) // 0.05 + 0.025
      expect(
        jan1?.subtype === 'privateCredit' ? jan1?.assetFinancing?.toFloat() : jan1?.assetPurchases?.toFloat()
      ).to.equal(3) // 2.0 + 1.0
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
      expect(
        jan2?.subtype === 'privateCredit' ? jan2?.assetFinancing?.toFloat() : jan2?.assetPurchases?.toFloat()
      ).to.equal(4) // 4.0
      expect(jan2?.fees.length).to.equal(2)
      expect(jan2?.fees[0]?.name).to.equal('serviceFee')
      expect(jan2?.fees[1]?.name).to.equal('adminFee')
      expect(jan2?.fees[0]?.amount.toFloat()).to.equal(3)
      expect(jan2?.fees[1]?.amount.toFloat()).to.equal(4)
      expect(jan2?.fees[0]?.timestamp.slice(0, 10)).to.equal('2024-01-02')
      expect(jan2?.fees[1]?.timestamp.slice(0, 10)).to.equal('2024-01-02')
    })

    it('should aggregate values correctly when grouping by month', () => {
      const result = processor.cashflow(
        {
          poolSnapshots: mockCashflowPoolSnapshots,
          poolFeeSnapshots: mockCashflowFeeSnapshots,
          metadata: mockPoolMetadata,
        },
        { groupBy: 'month' }
      )

      expect(result).to.have.lengthOf(1)

      const january = result[0]
      expect(january?.timestamp.slice(0, 10)).to.equal('2024-01-02') // Grouping by month returns the last day of the period
      expect(january?.principalPayments.toFloat()).to.equal(3.5) // 1.0 + 0.5 + 2.0
      expect(january?.interestPayments.toFloat()).to.equal(0.175) // 0.05 + 0.025 + 0.1
      expect(
        january?.subtype === 'privateCredit' ? january?.assetFinancing?.toFloat() : january?.assetPurchases?.toFloat()
      ).to.equal(7) // 2.0 + 1.0 + 4.0
      expect(january?.fees.length).to.equal(2)
      expect(january?.fees[0]?.name).to.equal('serviceFee')
      expect(january?.fees[1]?.name).to.equal('adminFee')
      // fees are NOT aggregated by period
      expect(january?.fees[0]?.amount.toFloat()).to.equal(3)
      expect(january?.fees[1]?.amount.toFloat()).to.equal(4)
    })
    it('should return realizedPL if pool is public credit', () => {
      const result = processor.cashflow(
        {
          poolSnapshots: mockCashflowPoolSnapshots,
          poolFeeSnapshots: mockCashflowFeeSnapshots,
          metadata: {
            ...mockPoolMetadata,
            pool: { ...mockPoolMetadata.pool, asset: { ...mockPoolMetadata.pool.asset, class: 'Public credit' } },
          },
        },
        { groupBy: 'day' }
      )
      expect(result?.[0]).to.have.property('realizedPL')
    })
  })

  describe('profit and loss processor', () => {
    const mockPLPoolSnapshots: PoolSnapshot[] = [
      {
        ...mockPoolSnapshots[0],
        id: 'pool-10',
        timestamp: '2024-01-01T12:00:00Z',
        sumInterestRepaidAmountByPeriod: Currency.fromFloat(0.05, 6), // 0.05
        sumInterestAccruedByPeriod: Currency.fromFloat(0.1, 6), // 0.1
        sumDebtWrittenOffByPeriod: Currency.fromFloat(0.02, 6), // 0.02
        sumUnscheduledRepaidAmountByPeriod: Currency.fromFloat(0.01, 6), // 0.01
        sumUnrealizedProfitByPeriod: Currency.fromFloat(0.15, 6), // 0.15
      },
      {
        ...mockPoolSnapshots[0],
        id: 'pool-11',
        timestamp: '2024-01-02T12:00:00Z',
        sumInterestRepaidAmountByPeriod: Currency.fromFloat(0.1, 6),
        sumInterestAccruedByPeriod: Currency.fromFloat(0.2, 6),
        sumDebtWrittenOffByPeriod: Currency.fromFloat(0.03, 6),
        sumUnscheduledRepaidAmountByPeriod: Currency.fromFloat(0.02, 6),
        sumUnrealizedProfitByPeriod: Currency.fromFloat(0.25, 6),
      },
    ] as PoolSnapshot[]

    const mockPLFeeSnapshots: PoolFeeSnapshotsByDate = {
      '2024-01-01': [
        {
          poolFee: { name: 'serviceFee' },
          sumAccruedAmountByPeriod: Currency.fromFloat(0.01, 6),
          sumChargedAmountByPeriod: Currency.fromFloat(0.02, 6),
          timestamp: '2024-01-01T12:00:00Z',
          poolFeeId: 'pool-fee-1',
        } as PoolFeeSnapshot,
      ],
      '2024-01-02': [
        {
          poolFee: { name: 'serviceFee' },
          sumAccruedAmountByPeriod: Currency.fromFloat(0.02, 6),
          sumChargedAmountByPeriod: Currency.fromFloat(0.03, 6),
          timestamp: '2024-01-02T12:00:00Z',
          poolFeeId: 'pool-fee-2',
        } as PoolFeeSnapshot,
      ],
    }

    it('should return empty array when no snapshots found', () => {
      expect(processor.profitAndLoss({ poolSnapshots: [], poolFeeSnapshots: {}, metadata: undefined })).to.deep.equal(
        []
      )
    })

    it('should handle undefined metadata', () => {
      const result = processor.profitAndLoss({
        poolSnapshots: mockPLPoolSnapshots,
        poolFeeSnapshots: mockPLFeeSnapshots,
        metadata: undefined,
      })
      expect(result).to.have.lengthOf(2)
      const firstDay = result[0]
      expect(firstDay?.subtype).to.equal('privateCredit') // should default to privateCredit
    })

    it('should process private credit pool data correctly', () => {
      const result = processor.profitAndLoss({
        poolSnapshots: mockPLPoolSnapshots,
        poolFeeSnapshots: mockPLFeeSnapshots,
        metadata: mockPoolMetadata, // defaults to private credit
      })

      expect(result).to.have.lengthOf(2)
      const firstDay = result[0] as ProfitAndLossReportPrivateCredit

      expect(firstDay?.subtype).to.equal('privateCredit')
      expect(firstDay).to.have.property('interestAccrued')
      expect(firstDay).to.have.property('assetWriteOffs')
      expect(firstDay?.interestAccrued.toFloat()).to.equal(0.1)
      expect(firstDay?.assetWriteOffs.toFloat()).to.equal(0.02)
      expect(firstDay?.interestPayments.toFloat()).to.equal(0.05)
      expect(firstDay?.otherPayments.toFloat()).to.equal(0.01)
      expect(firstDay?.profitAndLossFromAsset.toFloat()).to.equal(0.16) // 0.05 + 0.1 + 0.02 - 0.01
    })

    it('should process public credit pool correctly', () => {
      const result = processor.profitAndLoss({
        poolSnapshots: mockPLPoolSnapshots,
        poolFeeSnapshots: mockPLFeeSnapshots,
        metadata: {
          ...mockPoolMetadata,
          pool: {
            ...mockPoolMetadata.pool,
            asset: { ...mockPoolMetadata.pool.asset, class: 'Public credit' },
          },
        },
      })

      expect(result).to.have.lengthOf(2)
      const firstDay = result[0] as ProfitAndLossReportPublicCredit

      expect(firstDay?.subtype).to.equal('publicCredit')
      expect(firstDay?.profitAndLossFromAsset.toFloat()).to.equal(0.15) // unrealized profit
      expect(firstDay?.interestPayments.toFloat()).to.equal(0.05)
      expect(firstDay?.otherPayments.toFloat()).to.equal(0.01)
      expect(firstDay).to.have.property('totalIncome')
      expect(firstDay?.totalIncome.toFloat()).to.equal(0.21) // 0.15 + 0.05 + 0.01
    })

    it('should aggregate values correctly when grouping by month', () => {
      const result = processor.profitAndLoss(
        {
          poolSnapshots: mockPLPoolSnapshots,
          poolFeeSnapshots: mockPLFeeSnapshots,
          metadata: mockPoolMetadata,
        },
        { groupBy: 'month' }
      )

      expect(result).to.have.lengthOf(1)
      const january = result[0]
      expect(january?.timestamp.slice(0, 10)).to.equal('2024-01-02')
      expect(january?.interestPayments.toFloat()).to.equal(0.15) // 0.05 + 0.1
      expect(january?.otherPayments.toFloat()).to.equal(0.03) // 0.01 + 0.02
    })
    it('should make sure timestamp for pool state and pool fee match', () => {
      const result = processor.profitAndLoss({
        poolSnapshots: mockPLPoolSnapshots,
        poolFeeSnapshots: mockPLFeeSnapshots,
        metadata: mockPoolMetadata,
      })
      expect(result[0]?.timestamp.slice(0, 10)).to.equal('2024-01-01')
      expect(result[0]?.fees?.[0]?.timestamp.slice(0, 10)).to.equal('2024-01-01')
    })
  })

  describe('investor transactions processor', () => {
    it('should return empty array when no transactions found', () => {
      expect(processor.investorTransactions({ investorTransactions: [] })).to.deep.equal([])
    })

    it('should process investor transactions correctly without filters', () => {
      const result = processor.investorTransactions({
        investorTransactions: mockInvestorTransactions,
      })

      expect(result).to.have.lengthOf(2)
      const firstTx = result[0]

      expect(firstTx?.timestamp.slice(0, 10)).to.equal('2024-01-01')
      expect(firstTx?.chainId).to.equal(1)
      expect(firstTx?.account).to.equal('0x123a')
      expect(firstTx?.epoch).to.equal('1')
      expect(firstTx?.transactionType).to.equal('INVEST_ORDER_UPDATE')
      expect(firstTx?.currencyAmount.toFloat()).to.equal(1.0)
      expect(firstTx?.trancheTokenAmount.toFloat()).to.equal(0.9)
      expect(firstTx?.price.toString()).to.equal('1100000000000000000')
      expect(firstTx?.transactionHash).to.equal('0xabc')
    })

    it('should filter by tokenId', () => {
      const mockInvestorTransactionsWithJunior = [
        ...mockInvestorTransactions,
        {
          ...mockInvestorTransactions[0],
          trancheId: 'junior',
        } as InvestorTransaction,
      ]
      const result = processor.investorTransactions(
        {
          investorTransactions: mockInvestorTransactionsWithJunior,
        },
        { tokenId: 'senior' }
      )
      expect(result).to.have.lengthOf(2)
      expect(result[0]?.trancheTokenId).to.equal('senior')
    })
    it('should filter by address', () => {
      const result = processor.investorTransactions(
        {
          investorTransactions: mockInvestorTransactions,
        },
        { address: '0x123a' }
      )
      expect(result).to.have.lengthOf(1)
      expect(result[0]?.account).to.equal('0x123a')
    })
    it('should filter by network', () => {
      const mockInvestorTransactionsWithNetwork = [
        ...mockInvestorTransactions,
        {
          ...mockInvestorTransactions[0],
          chainId: 2,
        } as InvestorTransaction,
      ]
      const result = processor.investorTransactions(
        {
          investorTransactions: mockInvestorTransactionsWithNetwork,
        },
        { network: 2 }
      )
      expect(result).to.have.lengthOf(1)
      expect(result[0]?.chainId).to.equal(2)
    })
    it('should filter by all networks', () => {
      const result = processor.investorTransactions(
        {
          investorTransactions: mockInvestorTransactions,
        },
        { network: 'all' }
      )
      expect(result).to.have.lengthOf(2)
    })
    it('should filter by centrifuge network', () => {
      const mockInvestorTransactionsWithCentrifuge = [
        ...mockInvestorTransactions,
        {
          ...mockInvestorTransactions[0],
          chainId: 'centrifuge',
        } as InvestorTransaction,
      ]
      const result = processor.investorTransactions(
        {
          investorTransactions: mockInvestorTransactionsWithCentrifuge,
        },
        { network: 'centrifuge' }
      )
      expect(result).to.have.lengthOf(1)
      expect(result[0]?.chainId).to.equal('centrifuge')
    })
    it('should filter by transaction type', () => {
      const result = processor.investorTransactions(
        {
          investorTransactions: mockInvestorTransactions,
        },
        { transactionType: 'orders' }
      )
      expect(result).to.have.lengthOf(1)
      expect(result[0]?.transactionType).to.equal('INVEST_ORDER_UPDATE')
    })
    it('should filter by network and transaction type', () => {
      const mockInvestorTransactionsWithNetworkAndOrders = [
        ...mockInvestorTransactions,
        {
          ...mockInvestorTransactions[0],
          chainId: 2,
        } as InvestorTransaction,
      ]
      const result = processor.investorTransactions(
        {
          investorTransactions: mockInvestorTransactionsWithNetworkAndOrders,
        },
        { network: 1, transactionType: 'orders' }
      )
      expect(result).to.have.lengthOf(1)
      expect(result[0]?.chainId).to.equal(1)
      expect(result[0]?.transactionType).to.equal('INVEST_ORDER_UPDATE')
    })
    it('should return an empty array when no filters match', () => {
      const result = processor.investorTransactions(
        {
          investorTransactions: mockInvestorTransactions,
        },
        { network: 2, transactionType: 'executions' }
      )
      expect(result).to.deep.equal([])
    })
  })

  describe('asset transactions processor', () => {
    it('should return empty array when no transactions found', () => {
      expect(processor.assetTransactions({ assetTransactions: [] })).to.deep.equal([])
    })
    it('should process asset transactions correctly without filters', () => {
      const result = processor.assetTransactions({
        assetTransactions: mockAssetTransactions,
      })
      expect(result).to.have.lengthOf(3)
    })
    it('should filter by assetId', () => {
      const result = processor.assetTransactions(
        {
          assetTransactions: mockAssetTransactions,
        },
        { assetId: '1' }
      )
      expect(result).to.have.lengthOf(2)
    })
    it('should filter by transaction type', () => {
      const types: { type: AssetTransactionReportFilter['transactionType']; expected: number }[] = [
        { type: 'created', expected: 0 },
        { type: 'financed', expected: 1 },
        { type: 'repaid', expected: 1 },
        { type: 'priced', expected: 0 },
        { type: 'closed', expected: 0 },
        { type: 'cashTransfer', expected: 1 },
      ]
      for (const { type, expected } of types) {
        const result = processor.assetTransactions(
          {
            assetTransactions: mockAssetTransactions,
          },
          { transactionType: type }
        )
        expect(result).to.have.lengthOf(expected)
      }
    })
  })

  describe('fee transactions processor', () => {
    it('should return empty array when no transactions found', () => {
      expect(processor.feeTransactions({ poolFeeTransactions: [] })).to.deep.equal([])
    })
    it('should process fee transactions correctly', () => {
      const result = processor.feeTransactions({ poolFeeTransactions: mockFeeTransactions })
      expect(result).to.have.lengthOf(2)
    })
    it('should filter by transaction type all', () => {
      const result = processor.feeTransactions({ poolFeeTransactions: mockFeeTransactions }, { transactionType: 'all' })
      expect(result).to.have.lengthOf(2)
    })
    it('should filter by transaction type accrued', () => {
      const result = processor.feeTransactions(
        { poolFeeTransactions: mockFeeTransactions },
        { transactionType: 'accrued' }
      )
      expect(result).to.have.lengthOf(1)
    })
    it('should filter by transaction type paid', () => {
      const result = processor.feeTransactions(
        { poolFeeTransactions: mockFeeTransactions },
        { transactionType: 'paid' }
      )
      expect(result).to.have.lengthOf(1)
    })
    it('should return an empty array when no filters match', () => {
      const result = processor.feeTransactions(
        { poolFeeTransactions: mockFeeTransactions },
        { transactionType: 'directChargeMade' }
      )
      expect(result).to.deep.equal([])
    })
  })

  describe('token price processor', () => {
    it('should return empty array when no snapshots found', () => {
      expect(processor.tokenPrice({ trancheSnapshots: {} })).to.deep.equal([])
    })
    it('should process token price correctly', () => {
      const result = processor.tokenPrice({ trancheSnapshots: mockTrancheSnapshots })
      expect(result).to.have.lengthOf(2)
      expect(result[0]?.tranches[0]?.price?.toDecimal().toString()).to.equal('1')
      expect(result[0]?.tranches[0]?.id).to.equal('senior')
    })
    it('should group by month', () => {
      const result = processor.tokenPrice({ trancheSnapshots: mockTrancheSnapshots }, { groupBy: 'month' })
      expect(result).to.have.lengthOf(1)
    })
  })

  describe('applyGrouping', () => {
    const applyGrouping = processor['applyGrouping']
    const mockData = [
      { a: Currency.fromFloat(10, 6), timestamp: '2024-01-01' },
      { a: Currency.fromFloat(20, 6), timestamp: '2024-01-01' },
    ]
    it('should return empty array when no items found', () => {
      expect(applyGrouping([], 'day', 'sum')).to.deep.equal([])
    })
    it('should return items by day when no grouping is specified', () => {
      const latest = applyGrouping(mockData, undefined, 'latest')
      expect(latest).to.deep.equal([{ a: Currency.fromFloat(20, 6), timestamp: '2024-01-01' }])
      const summed = applyGrouping(mockData, undefined, 'sum')
      expect(summed).to.deep.equal([{ a: Currency.fromFloat(30, 6), timestamp: '2024-01-01' }])
    })
    it('should return latest item when strategy is latest', () => {
      const grouped = applyGrouping(mockData, 'day', 'latest')
      expect(grouped).to.deep.equal([{ a: Currency.fromFloat(20, 6), timestamp: '2024-01-01' }])
    })
    it('should aggregate values when strategy is sum', () => {
      const grouped = applyGrouping(mockData, 'day', 'sum')
      expect(grouped).to.deep.equal([{ a: Currency.fromFloat(30, 6), timestamp: '2024-01-01' }])
    })
    it('should return latest item when strategy is latest and no grouping is specified', () => {
      const grouped = applyGrouping(mockData, undefined, 'latest')
      expect(grouped).to.deep.equal([{ a: Currency.fromFloat(20, 6), timestamp: '2024-01-01' }])
    })
    it('should aggregate values when strategy is sum and no grouping is specified', () => {
      const grouped = applyGrouping(mockData, undefined, 'sum')
      expect(grouped).to.deep.equal([{ a: Currency.fromFloat(30, 6), timestamp: '2024-01-01' }])
    })
    it('should return latest item when strategy is latest and grouping is month', () => {
      const extendedMockData = [...mockData, { a: Currency.fromFloat(30, 6), timestamp: '2024-02-01' }]
      const grouped = applyGrouping(extendedMockData, 'month', 'latest')
      const expected = [
        { a: Currency.fromFloat(20, 6), timestamp: '2024-01-01' },
        { a: Currency.fromFloat(30, 6), timestamp: '2024-02-01' },
      ]
      expect(grouped).to.deep.equal(expected)
    })
    it('should aggregate values when strategy is sum and grouping is month (Token)', () => {
      const extendedMockData = [
        { a: Token.fromFloat(10, 6), timestamp: '2024-01-01' },
        { a: Token.fromFloat(20, 6), timestamp: '2024-01-02' },
        { a: Token.fromFloat(30, 6), timestamp: '2024-02-01' },
      ]
      const grouped = applyGrouping(extendedMockData, 'month', 'sum')
      const expected = [
        { a: Token.fromFloat(30, 6), timestamp: '2024-01-02' },
        { a: Token.fromFloat(30, 6), timestamp: '2024-02-01' },
      ]
      expect(grouped).to.deep.equal(expected)
    })
    it('should aggregate values when strategy is sum and grouping is month (Price)', () => {
      const extendedMockData = [
        { a: Price.fromFloat(10), timestamp: '2024-01-01' },
        { a: Price.fromFloat(20), timestamp: '2024-01-02' },
        { a: Price.fromFloat(30), timestamp: '2024-02-01' },
      ]
      const grouped = applyGrouping(extendedMockData, 'month', 'sum')
      const expected = [
        { a: Price.fromFloat(30), timestamp: '2024-01-02' },
        { a: Price.fromFloat(30), timestamp: '2024-02-01' },
      ]
      expect(grouped).to.deep.equal(expected)
    })
    it('should only aggregate top-level Currency values and use last value for nested objects', () => {
      const items = [
        {
          timestamp: '2024-01-01T12:00:00Z',
          topLevelAmount: Currency.fromFloat(1, 6), // should be summed
          nested: {
            amount: Currency.fromFloat(1, 6), // should take last value
            description: 'first',
          },
          fees: [
            {
              amount: Currency.fromFloat(0.5, 6), // should take last value
              name: 'fee1',
            },
          ],
        },
        {
          timestamp: '2024-01-01T18:00:00Z',
          topLevelAmount: Currency.fromFloat(2, 6),
          nested: {
            amount: Currency.fromFloat(3, 6),
            description: 'second',
          },
          fees: [
            {
              amount: Currency.fromFloat(0.7, 6),
              name: 'fee1',
            },
          ],
        },
      ]

      const result = processor['applyGrouping'](items, 'day', 'sum')

      expect(result).to.have.lengthOf(1)
      const aggregated = result[0]

      // Top level Currency should be summed
      expect(aggregated?.topLevelAmount.toFloat()).to.equal(3) // 1 + 2

      // Nested Currency should be from last item
      expect(aggregated?.nested?.amount.toFloat()).to.equal(3) // last value only
      expect(aggregated?.nested?.description).to.equal('second')

      // Array of objects with Currency should be from last item
      expect(aggregated?.fees[0]?.amount.toFloat()).to.equal(0.7)
      expect(aggregated?.fees[0]?.name).to.equal('fee1')
    })
  })
})
