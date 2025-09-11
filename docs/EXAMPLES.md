# Centrifuge SDK Examples

Comprehensive examples demonstrating how to use the Centrifuge SDK for various use cases.

## Table of Contents

- [Basic Setup](#basic-setup)
- [Pool Operations](#pool-operations)
- [Investment Workflows](#investment-workflows)
- [Portfolio Management](#portfolio-management)
- [Transaction Handling](#transaction-handling)
- [Multi-Chain Operations](#multi-chain-operations)
- [Real-time Data](#real-time-data)
- [Error Handling](#error-handling)
- [Advanced Use Cases](#advanced-use-cases)

## Basic Setup

### Initialize SDK

```typescript
import Centrifuge, { Balance } from '@centrifuge/sdk'

// Basic initialization
const centrifuge = new Centrifuge({
  environment: 'mainnet' // or 'testnet'
})

// With custom RPC URLs
const centrifuge = new Centrifuge({
  environment: 'mainnet',
  rpcUrls: {
    1: 'https://eth-mainnet.g.alchemy.com/v2/your-key',
    8453: 'https://base-mainnet.g.alchemy.com/v2/your-key',
    42161: 'https://arb-mainnet.g.alchemy.com/v2/your-key'
  }
})
```

### Set Up Wallet

```typescript
import { createWalletClient, custom } from 'viem'
import { mainnet } from 'viem/chains'

// MetaMask integration
const walletClient = createWalletClient({
  chain: mainnet,
  transport: custom(window.ethereum)
})

centrifuge.setSigner(walletClient)
```

## Pool Operations

### Get All Pools

```typescript
async function getAllPools() {
  const centrifuge = new Centrifuge({ environment: 'mainnet' })
  
  try {
    const pools = await centrifuge.pools()
    
    console.log(`Found ${pools.length} pools`)
    pools.forEach(pool => {
      console.log(`Pool ${pool.id}: ${pool.metadata?.name}`)
    })
    
    return pools
  } catch (error) {
    console.error('Error fetching pools:', error)
  }
}
```

### Get Pool Details

```typescript
async function getPoolDetails(poolId: string) {
  const centrifuge = new Centrifuge({ environment: 'mainnet' })
  
  try {
    const pool = await centrifuge.pool(poolId)
    const details = await pool.details()
    const metadata = await pool.metadata()
    
    console.log('Pool Details:', {
      id: pool.id,
      name: metadata.name,
      totalValueLocked: details.totalValueLocked.toString(),
      netAssetValue: details.netAssetValue.toString(),
      shareClasses: details.shareClasses.length
    })
    
    return { pool, details, metadata }
  } catch (error) {
    console.error('Error fetching pool details:', error)
  }
}
```

### Explore Share Classes

```typescript
async function exploreShareClasses(poolId: string) {
  const centrifuge = new Centrifuge({ environment: 'mainnet' })
  
  try {
    const pool = await centrifuge.pool(poolId)
    const shareClasses = await pool.shareClasses()
    
    console.log(`Pool ${poolId} has ${shareClasses.length} share classes:`)
    
    for (const shareClass of shareClasses) {
      const details = await shareClass.details()
      const metadata = await shareClass.metadata()
      
      console.log(`Share Class ${shareClass.id}:`, {
        name: metadata.name,
        currency: details.currency.symbol,
        totalSupply: details.totalSupply.toString(),
        nav: details.netAssetValue.toString()
      })
    }
    
    return shareClasses
  } catch (error) {
    console.error('Error exploring share classes:', error)
  }
}
```

## Investment Workflows

### Basic Investment

```typescript
async function makeInvestment(
  poolId: string,
  shareClassId: string,
  currencyAddress: string,
  amount: number,
  decimals: number
) {
  const centrifuge = new Centrifuge({ environment: 'mainnet' })
  
  try {
    // Get the pool and vault
    const pool = await centrifuge.pool(poolId)
    const vault = await pool.vault(1, shareClassId, currencyAddress) // Ethereum mainnet
    
    // Create investment amount
    const investmentAmount = Balance.fromFloat(amount, decimals)
    
    console.log(`Investing ${amount} ${vault.investmentCurrency.symbol}`)
    
    // Execute investment with status monitoring
    const transaction = vault.increaseInvestOrder(investmentAmount)
    
    transaction.subscribe({
      next: (status) => {
        switch (status.type) {
          case 'SigningTransaction':
            console.log('Please sign the transaction in your wallet')
            break
          case 'TransactionPending':
            console.log('Transaction submitted, waiting for confirmation...')
            break
          case 'TransactionConfirmed':
            console.log('Investment successful!')
            break
        }
      },
      error: (error) => console.error('Investment failed:', error),
      complete: () => console.log('Investment process complete')
    })
    
    // Wait for completion
    await transaction
    
  } catch (error) {
    console.error('Error making investment:', error)
  }
}
```

### Investment with Approval Check

```typescript
async function investmentWithApproval(
  poolId: string,
  shareClassId: string,
  currencyAddress: string,
  amount: number,
  decimals: number,
  investorAddress: string
) {
  const centrifuge = new Centrifuge({ environment: 'mainnet' })
  
  try {
    const pool = await centrifuge.pool(poolId)
    const vault = await pool.vault(1, shareClassId, currencyAddress)
    const investmentAmount = Balance.fromFloat(amount, decimals)
    
    // Check current investment status
    const investment = await vault.investment(investorAddress)
    console.log('Current investment:', {
      pending: investment.pendingInvestment.toString(),
      claimable: investment.claimableInvestment.toString(),
      totalShares: investment.totalShares.toString()
    })
    
    // Check if we have sufficient allowance (this would be done off-chain)
    // In a real app, you'd check ERC20 allowance here
    
    console.log(`Investing additional ${amount} ${vault.investmentCurrency.symbol}`)
    
    // Execute investment
    await vault.increaseInvestOrder(investmentAmount)
    
    console.log('Investment order placed successfully')
    
  } catch (error) {
    if (error.message.includes('allowance') || error.message.includes('insufficient')) {
      console.log('Insufficient allowance. Please approve the token spend first.')
      // Handle approval workflow
    } else {
      console.error('Investment error:', error)
    }
  }
}
```

### Claiming Processed Investments

```typescript
async function claimInvestment(
  poolId: string,
  shareClassId: string,
  currencyAddress: string,
  investorAddress: string
) {
  const centrifuge = new Centrifuge({ environment: 'mainnet' })
  
  try {
    const pool = await centrifuge.pool(poolId)
    const vault = await pool.vault(1, shareClassId, currencyAddress)
    
    // Get current investment status
    const investment = await vault.investment(investorAddress)
    
    const claimableAssets = investment.claimableInvestment
    const claimableShares = investment.claimableShares
    
    if (claimableAssets.toBigInt() === 0n && claimableShares.toBigInt() === 0n) {
      console.log('No claimable investments available')
      return
    }
    
    console.log('Claimable investments:', {
      assets: claimableAssets.toString(),
      shares: claimableShares.toString()
    })
    
    // Claim the processed investment
    await vault.claim(investorAddress, claimableAssets, claimableShares)
    
    console.log('Investment claimed successfully')
    
  } catch (error) {
    console.error('Error claiming investment:', error)
  }
}
```

## Portfolio Management

### Get Investor Portfolio

```typescript
async function getInvestorPortfolio(investorAddress: string) {
  const centrifuge = new Centrifuge({ environment: 'mainnet' })
  const investor = centrifuge.investor(investorAddress)
  
  try {
    // Get portfolio across all supported chains
    const portfolios = []
    
    for (const chainId of centrifuge.chains) {
      try {
        const portfolio = await investor.portfolio(chainId)
        if (portfolio.investments.length > 0) {
          portfolios.push({ chainId, portfolio })
        }
      } catch (error) {
        // Chain might not have any investments
        console.log(`No investments on chain ${chainId}`)
      }
    }
    
    console.log(`Investor ${investorAddress} has investments on ${portfolios.length} chains`)
    
    let totalValue = Balance.fromFloat(0, 18)
    
    portfolios.forEach(({ chainId, portfolio }) => {
      console.log(`\nChain ${chainId} (${portfolio.investments.length} investments):`)
      
      portfolio.investments.forEach(investment => {
        console.log(`  Pool ${investment.poolId}:`)
        console.log(`    Total Investment: ${investment.totalInvestment.toString()}`)
        console.log(`    Total Shares: ${investment.totalShares.toString()}`)
        console.log(`    Pending: ${investment.pendingInvestment.toString()}`)
        console.log(`    Claimable: ${investment.claimableInvestment.toString()}`)
      })
      
      totalValue = totalValue.add(portfolio.totalValue)
    })
    
    console.log(`\nTotal Portfolio Value: ${totalValue.toString()}`)
    
    return portfolios
    
  } catch (error) {
    console.error('Error fetching portfolio:', error)
  }
}
```

### Track Investment Performance

```typescript
async function trackInvestmentPerformance(
  investorAddress: string,
  poolId: string,
  shareClassId: string
) {
  const centrifuge = new Centrifuge({ environment: 'mainnet' })
  
  try {
    const investor = centrifuge.investor(investorAddress)
    const investment = await investor.investment(poolId, shareClassId)
    
    console.log(`Investment Performance for Pool ${poolId}:`)
    console.log(`Total Invested: ${investment.totalInvestment.toString()}`)
    console.log(`Current Shares: ${investment.totalShares.toString()}`)
    
    // Get current share price to calculate value
    const pool = await centrifuge.pool(poolId)
    const shareClass = pool.shareClass(shareClassId)
    const details = await shareClass.details()
    
    if (investment.totalShares.toBigInt() > 0n) {
      const currentValue = investment.totalShares.mul(details.netAssetValue)
      const performance = currentValue.sub(investment.totalInvestment)
      
      console.log(`Current Value: ${currentValue.toString()}`)
      console.log(`Performance: ${performance.toString()}`)
    }
    
  } catch (error) {
    console.error('Error tracking performance:', error)
  }
}
```

## Transaction Handling

### Transaction with Custom Timeout

```typescript
async function transactionWithTimeout(
  vault: any, // Vault instance
  amount: Balance,
  timeoutMs: number = 300000 // 5 minutes
) {
  try {
    const transaction = vault.increaseInvestOrder(amount)
    
    // Race between transaction and timeout
    const result = await Promise.race([
      transaction,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Transaction timeout')), timeoutMs)
      )
    ])
    
    console.log('Transaction completed:', result)
    return result
    
  } catch (error) {
    if (error.message === 'Transaction timeout') {
      console.error('Transaction timed out after', timeoutMs / 1000, 'seconds')
    } else {
      console.error('Transaction failed:', error)
    }
    throw error
  }
}
```

### Batch Transaction Processing

```typescript
async function batchInvestments(investments: Array<{
  vault: any,
  amount: Balance,
  description: string
}>) {
  const results = []
  
  console.log(`Processing ${investments.length} investments...`)
  
  for (const [index, { vault, amount, description }] of investments.entries()) {
    try {
      console.log(`${index + 1}/${investments.length}: ${description}`)
      
      const result = await vault.increaseInvestOrder(amount)
      results.push({ success: true, description, result })
      
      console.log(`✅ ${description} completed`)
      
    } catch (error) {
      console.error(`❌ ${description} failed:`, error.message)
      results.push({ success: false, description, error })
    }
  }
  
  const successful = results.filter(r => r.success).length
  console.log(`\nBatch completed: ${successful}/${investments.length} successful`)
  
  return results
}
```

### Transaction Status Monitoring

```typescript
function monitorTransaction(transaction: any, description: string) {
  console.log(`Starting ${description}...`)
  
  const startTime = Date.now()
  
  return new Promise((resolve, reject) => {
    transaction.subscribe({
      next: (status: any) => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
        
        switch (status.type) {
          case 'SwitchingChain':
            console.log(`[${elapsed}s] Switching to chain ${status.chainId}`)
            break
          case 'SigningTransaction':
            console.log(`[${elapsed}s] Please sign: ${status.title}`)
            break
          case 'TransactionPending':
            console.log(`[${elapsed}s] Transaction pending: ${status.id}`)
            break
          case 'TransactionConfirmed':
            console.log(`[${elapsed}s] Transaction confirmed: ${status.id}`)
            break
        }
      },
      error: (error: any) => {
        console.error(`❌ ${description} failed after ${((Date.now() - startTime) / 1000).toFixed(1)}s:`, error.message)
        reject(error)
      },
      complete: () => {
        console.log(`✅ ${description} completed in ${((Date.now() - startTime) / 1000).toFixed(1)}s`)
        resolve(true)
      }
    })
  })
}
```

## Multi-Chain Operations

### Cross-Chain Investment Strategy

```typescript
async function crossChainInvestment(
  poolId: string,
  shareClassId: string,
  totalAmount: number,
  decimals: number
) {
  const centrifuge = new Centrifuge({ environment: 'mainnet' })
  
  try {
    const pool = await centrifuge.pool(poolId)
    
    // Define investment distribution across chains
    const chainDistribution = [
      { chainId: 1, percentage: 0.5 },      // 50% on Ethereum
      { chainId: 8453, percentage: 0.3 },   // 30% on Base  
      { chainId: 42161, percentage: 0.2 }   // 20% on Arbitrum
    ]
    
    const investments = []
    
    for (const { chainId, percentage } of chainDistribution) {
      try {
        // Get appropriate currency address for each chain
        const currencyAddress = getCurrencyAddressForChain(chainId, 'USDC')
        const vault = await pool.vault(chainId, shareClassId, currencyAddress)
        
        const chainAmount = totalAmount * percentage
        const amount = Balance.fromFloat(chainAmount, decimals)
        
        investments.push({
          vault,
          amount,
          description: `${chainAmount} USDC on chain ${chainId}`
        })
        
      } catch (error) {
        console.log(`Skipping chain ${chainId}: ${error.message}`)
      }
    }
    
    // Execute all investments
    const results = await batchInvestments(investments)
    
    console.log('Cross-chain investment completed')
    return results
    
  } catch (error) {
    console.error('Cross-chain investment failed:', error)
  }
}

function getCurrencyAddressForChain(chainId: number, symbol: string): string {
  const addresses: Record<number, Record<string, string>> = {
    1: { // Ethereum
      'USDC': '0xA0b86a33E6842897c418f41f8e1d6e6f9c8a2f4e',
      'USDT': '0xdAC17F958D2ee523a2206206994597C13D831ec7'
    },
    8453: { // Base
      'USDC': '0x833589fCD6eDb6E6E4C15B8b3E6eaC4c3c0f7b7c'
    },
    42161: { // Arbitrum
      'USDC': '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'
    }
  }
  
  return addresses[chainId]?.[symbol] || '0x0'
}
```

### Chain-Specific Portfolio Analysis

```typescript
async function analyzePortfolioByChain(investorAddress: string) {
  const centrifuge = new Centrifuge({ environment: 'mainnet' })
  const investor = centrifuge.investor(investorAddress)
  
  const chainAnalysis = []
  
  for (const chainId of centrifuge.chains) {
    try {
      const portfolio = await investor.portfolio(chainId)
      
      if (portfolio.investments.length === 0) continue
      
      const analysis = {
        chainId,
        chainName: getChainName(chainId),
        totalInvestments: portfolio.investments.length,
        totalValue: portfolio.totalValue,
        investments: portfolio.investments.map(inv => ({
          poolId: inv.poolId,
          shareClassId: inv.shareClassId,
          currency: inv.currencyAddress,
          totalInvested: inv.totalInvestment,
          currentShares: inv.totalShares,
          pendingAmount: inv.pendingInvestment,
          claimableAmount: inv.claimableInvestment
        }))
      }
      
      chainAnalysis.push(analysis)
      
    } catch (error) {
      console.log(`No portfolio data for chain ${chainId}`)
    }
  }
  
  // Generate report
  console.log(`\n=== Portfolio Analysis for ${investorAddress} ===`)
  
  chainAnalysis.forEach(chain => {
    console.log(`\n${chain.chainName} (Chain ${chain.chainId}):`)
    console.log(`  Total Investments: ${chain.totalInvestments}`)
    console.log(`  Total Value: ${chain.totalValue.toString()}`)
    
    chain.investments.forEach(inv => {
      console.log(`    Pool ${inv.poolId}:`)
      console.log(`      Invested: ${inv.totalInvested.toString()}`)
      console.log(`      Shares: ${inv.currentShares.toString()}`)
      if (inv.pendingAmount.toBigInt() > 0n) {
        console.log(`      Pending: ${inv.pendingAmount.toString()}`)
      }
      if (inv.claimableAmount.toBigInt() > 0n) {
        console.log(`      Claimable: ${inv.claimableAmount.toString()}`)
      }
    })
  })
  
  return chainAnalysis
}

function getChainName(chainId: number): string {
  const names: Record<number, string> = {
    1: 'Ethereum',
    8453: 'Base',
    42161: 'Arbitrum',
    43114: 'Avalanche',
    98866: 'Plume',
    11155111: 'Sepolia',
    84532: 'Base Sepolia',
    421614: 'Arbitrum Sepolia'
  }
  return names[chainId] || `Chain ${chainId}`
}
```

## Real-time Data

### Pool Monitoring with Live Updates

```typescript
function setupPoolMonitoring(poolId: string) {
  const centrifuge = new Centrifuge({ 
    environment: 'mainnet',
    pollingInterval: 5000 // Update every 5 seconds
  })
  
  console.log(`Starting real-time monitoring for pool ${poolId}`)
  
  const subscription = centrifuge.pool(poolId).subscribe({
    next: (pool) => {
      console.log(`[${new Date().toISOString()}] Pool Update:`, {
        id: pool.id,
        name: pool.metadata?.name,
        tvl: pool.details.totalValueLocked.toString(),
        nav: pool.details.netAssetValue.toString(),
        shareClasses: pool.shareClasses.length
      })
    },
    error: (error) => {
      console.error('Pool monitoring error:', error)
      // Attempt to reconnect after 10 seconds
      setTimeout(() => setupPoolMonitoring(poolId), 10000)
    }
  })
  
  // Cleanup function
  return () => {
    subscription.unsubscribe()
    console.log(`Stopped monitoring pool ${poolId}`)
  }
}
```

### Investment Status Tracker

```typescript
function trackInvestmentStatus(
  investorAddress: string,
  poolId: string,
  shareClassId: string,
  currencyAddress: string
) {
  const centrifuge = new Centrifuge({ environment: 'mainnet' })
  
  console.log('Starting investment status tracking...')
  
  const checkStatus = async () => {
    try {
      const pool = await centrifuge.pool(poolId)
      const vault = await pool.vault(1, shareClassId, currencyAddress)
      const investment = await vault.investment(investorAddress)
      
      const status = {
        timestamp: new Date().toISOString(),
        pending: investment.pendingInvestment,
        claimable: investment.claimableInvestment,
        totalShares: investment.totalShares,
        totalInvestment: investment.totalInvestment
      }
      
      console.log('Investment Status:', status)
      
      // Check if there are changes worth notifying about
      if (investment.claimableInvestment.toBigInt() > 0n) {
        console.log('🎉 You have claimable investments!')
      }
      
      if (investment.pendingInvestment.toBigInt() > 0n) {
        console.log('⏳ Investment is being processed...')
      }
      
    } catch (error) {
      console.error('Error checking investment status:', error)
    }
  }
  
  // Check immediately and then every 30 seconds
  checkStatus()
  const interval = setInterval(checkStatus, 30000)
  
  // Return cleanup function
  return () => {
    clearInterval(interval)
    console.log('Stopped investment status tracking')
  }
}
```

## Error Handling

### Comprehensive Error Handling

```typescript
import { 
  CentrifugeError, 
  TransactionError, 
  NetworkError, 
  IndexerError 
} from '@centrifuge/sdk'

async function robustInvestment(
  poolId: string,
  shareClassId: string,
  currencyAddress: string,
  amount: number,
  decimals: number,
  maxRetries: number = 3
) {
  const centrifuge = new Centrifuge({ environment: 'mainnet' })
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Investment attempt ${attempt}/${maxRetries}`)
      
      const pool = await centrifuge.pool(poolId)
      const vault = await pool.vault(1, shareClassId, currencyAddress)
      const investmentAmount = Balance.fromFloat(amount, decimals)
      
      await vault.increaseInvestOrder(investmentAmount)
      
      console.log('Investment successful!')
      return true
      
    } catch (error) {
      console.log(`Attempt ${attempt} failed:`, error.message)
      
      if (error instanceof TransactionError) {
        if (error.message.includes('user rejected')) {
          console.log('User rejected the transaction')
          break // Don't retry user rejections
        } else if (error.message.includes('insufficient funds')) {
          console.log('Insufficient funds')
          break // Don't retry insufficient funds
        } else {
          console.log('Transaction error, retrying...')
        }
      } else if (error instanceof NetworkError) {
        console.log(`Network error on chain ${error.chainId}, retrying...`)
      } else if (error instanceof IndexerError) {
        console.log('Indexer error, retrying...')
      } else if (error instanceof CentrifugeError) {
        console.log('SDK error:', error.message)
        break // Don't retry SDK errors
      } else {
        console.log('Unknown error, retrying...')
      }
      
      // Don't retry on final attempt
      if (attempt === maxRetries) {
        console.log('Max retries reached, giving up')
        throw error
      }
      
      // Wait before retrying (exponential backoff)
      const delay = Math.pow(2, attempt) * 1000
      console.log(`Waiting ${delay}ms before retry...`)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
  
  return false
}
```

### Graceful Fallback Handling

```typescript
async function getPoolWithFallback(poolId: string) {
  const centrifuge = new Centrifuge({ environment: 'mainnet' })
  
  try {
    // Try to get pool with full details
    const pool = await centrifuge.pool(poolId)
    const details = await pool.details()
    const metadata = await pool.metadata()
    
    return {
      pool,
      details,
      metadata,
      status: 'complete'
    }
    
  } catch (error) {
    console.warn('Failed to get complete pool data, trying fallback...')
    
    try {
      // Fallback: try to get just basic pool info
      const pool = await centrifuge.pool(poolId)
      
      return {
        pool,
        details: null,
        metadata: null,
        status: 'partial'
      }
      
    } catch (fallbackError) {
      console.error('Complete fallback failed:', fallbackError)
      
      return {
        pool: null,
        details: null,
        metadata: null,
        status: 'failed',
        error: fallbackError
      }
    }
  }
}
```

## Advanced Use Cases

### Custom Pool Analytics

```typescript
async function generatePoolAnalytics(poolId: string) {
  const centrifuge = new Centrifuge({ environment: 'mainnet' })
  
  try {
    const pool = await centrifuge.pool(poolId)
    const details = await pool.details()
    const metadata = await pool.metadata()
    const shareClasses = await pool.shareClasses()
    
    // Calculate key metrics
    const analytics = {
      basic: {
        name: metadata.name,
        totalValueLocked: details.totalValueLocked,
        netAssetValue: details.netAssetValue,
        numberOfShareClasses: shareClasses.length
      },
      performance: {
        // Calculate performance metrics
        utilizationRate: details.portfolioValuation.div(details.totalValueLocked),
        feeAccrualRate: details.sumPoolFeesAccrued.div(details.totalValueLocked)
      },
      shareClasses: await Promise.all(
        shareClasses.map(async (sc) => {
          const scDetails = await sc.details()
          const scMetadata = await sc.metadata()
          
          return {
            id: sc.id,
            name: scMetadata.name,
            currency: scDetails.currency.symbol,
            totalSupply: scDetails.totalSupply,
            nav: scDetails.netAssetValue,
            investmentCapacity: scDetails.maxReserve.sub(scDetails.totalSupply)
          }
        })
      )
    }
    
    // Generate report
    console.log('\n=== Pool Analytics Report ===')
    console.log(`Pool: ${analytics.basic.name} (${poolId})`)
    console.log(`Total Value Locked: ${analytics.basic.totalValueLocked.toString()}`)
    console.log(`Net Asset Value: ${analytics.basic.netAssetValue.toString()}`)
    console.log(`Utilization Rate: ${(analytics.performance.utilizationRate.toFloat() * 100).toFixed(2)}%`)
    
    console.log('\nShare Classes:')
    analytics.shareClasses.forEach(sc => {
      console.log(`  ${sc.name} (${sc.currency}):`)
      console.log(`    Supply: ${sc.totalSupply.toString()}`)
      console.log(`    NAV: ${sc.nav.toString()}`)
      console.log(`    Capacity: ${sc.investmentCapacity.toString()}`)
    })
    
    return analytics
    
  } catch (error) {
    console.error('Error generating analytics:', error)
  }
}
```

### Automated Investment Strategy

```typescript
class AutoInvestmentStrategy {
  private centrifuge: any
  private config: {
    pools: Array<{
      poolId: string
      shareClassId: string
      currencyAddress: string
      maxInvestment: Balance
      targetAllocation: number
    }>
    investorAddress: string
    rebalanceThreshold: number
  }
  
  constructor(config: any) {
    this.centrifuge = new Centrifuge({ environment: 'mainnet' })
    this.config = config
  }
  
  async getCurrentAllocations() {
    const investor = this.centrifuge.investor(this.config.investorAddress)
    const allocations = []
    
    for (const poolConfig of this.config.pools) {
      try {
        const investment = await investor.investment(
          poolConfig.poolId, 
          poolConfig.shareClassId
        )
        
        allocations.push({
          ...poolConfig,
          currentValue: investment.totalShares, // Simplified - would need NAV conversion
          currentAllocation: 0 // Would calculate percentage
        })
      } catch (error) {
        console.log(`No investment in pool ${poolConfig.poolId}`)
      }
    }
    
    return allocations
  }
  
  async rebalance() {
    console.log('Starting portfolio rebalance...')
    
    try {
      const allocations = await this.getCurrentAllocations()
      const rebalanceActions = []
      
      // Calculate required adjustments
      for (const allocation of allocations) {
        const difference = allocation.targetAllocation - allocation.currentAllocation
        
        if (Math.abs(difference) > this.config.rebalanceThreshold) {
          rebalanceActions.push({
            poolId: allocation.poolId,
            action: difference > 0 ? 'invest' : 'redeem',
            amount: Math.abs(difference)
          })
        }
      }
      
      if (rebalanceActions.length === 0) {
        console.log('Portfolio is balanced, no action needed')
        return
      }
      
      console.log(`Executing ${rebalanceActions.length} rebalance actions...`)
      
      // Execute rebalance actions
      for (const action of rebalanceActions) {
        try {
          const pool = await this.centrifuge.pool(action.poolId)
          const vault = await pool.vault(1, 'shareClassId', 'currencyAddress')
          
          if (action.action === 'invest') {
            await vault.increaseInvestOrder(Balance.fromFloat(action.amount, 6))
            console.log(`✅ Invested ${action.amount} in pool ${action.poolId}`)
          } else {
            await vault.increaseRedeemOrder(Balance.fromFloat(action.amount, 18))
            console.log(`✅ Redeemed ${action.amount} from pool ${action.poolId}`)
          }
          
        } catch (error) {
          console.error(`❌ Failed to ${action.action} in pool ${action.poolId}:`, error.message)
        }
      }
      
      console.log('Rebalancing completed')
      
    } catch (error) {
      console.error('Rebalancing failed:', error)
    }
  }
  
  async startAutoRebalancing(intervalHours: number = 24) {
    console.log(`Starting auto-rebalancing every ${intervalHours} hours`)
    
    const interval = setInterval(() => {
      this.rebalance().catch(console.error)
    }, intervalHours * 60 * 60 * 1000)
    
    // Initial rebalance
    await this.rebalance()
    
    return () => {
      clearInterval(interval)
      console.log('Auto-rebalancing stopped')
    }
  }
}
```

These examples demonstrate the full range of capabilities of the Centrifuge SDK, from basic operations to advanced automated strategies. Each example includes proper error handling and real-world considerations that developers would encounter when building applications on top of the Centrifuge protocol.