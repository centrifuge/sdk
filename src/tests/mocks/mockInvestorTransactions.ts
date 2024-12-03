import { InvestorTransaction } from '../../queries/investorTransactions.js'
import { Price } from '../../utils/BigInt.js'

import { Currency } from '../../utils/BigInt.js'

export const mockInvestorTransactions: InvestorTransaction[] = [
  {
    id: 'tx-1',
    poolId: 'pool-1',
    timestamp: new Date('2024-01-01T12:00:00Z'),
    accountId: 'account-1',
    chainId: 1,
    evmAddress: '0x123a',
    trancheId: 'senior',
    epochNumber: 1,
    type: 'INVEST_ORDER_UPDATE',
    currencyAmount: new Currency(1_000_000n, 6), // 1.0
    tokenAmount: new Currency(900_000n, 6), // 0.9
    tokenPrice: new Price(1_100_000_000_000_000_000n), // 1.1
    hash: '0xabc',
  } as InvestorTransaction,
  {
    id: 'tx-2',
    poolId: 'pool-1',
    timestamp: new Date('2024-01-01T18:00:00Z'),
    accountId: 'account-1',
    chainId: 1,
    evmAddress: '0x123b',
    trancheId: 'senior',
    epochNumber: 1,
    type: 'INVEST_EXECUTION',
    currencyAmount: new Currency(2_000_000n, 6), // 2.0
    tokenAmount: new Currency(1_800_000n, 6), // 1.8
    tokenPrice: new Price(1_100_000_000_000_000_000n), // 1.1
    hash: '0xdef',
  } as InvestorTransaction,
]
