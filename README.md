# Centrifuge SDK

A comprehensive TypeScript SDK for interacting with the Centrifuge ecosystem - a multi-chain asset management platform that bridges real-world assets with DeFi through tokenized vaults and cross-chain liquidity.

## 🌟 Key Features

- **🌉 Multi-Chain Support** - Seamless interaction across Ethereum, Base, Arbitrum, Avalanche, and more
- **📊 Real-time Data** - Observable-based architecture with live updates from GraphQL indexer
- **🔗 ERC-7540 Vaults** - Full support for tokenized vault standard with async deposits/redemptions
- **💰 Precise Finance** - Decimal-aware calculations for financial operations
- **🔒 Type Safety** - Comprehensive TypeScript coverage with generated types
- **⚡ Performance** - Built-in caching and query optimization
- **🛡️ Wallet Integration** - Support for all EIP-1193 compatible wallets

## 📦 Installation

```bash
npm install @centrifuge/sdk
# or
yarn add @centrifuge/sdk
# or  
pnpm add @centrifuge/sdk
```

## 🚀 Quick Start

```typescript
import Centrifuge from '@centrifuge/sdk'

// Initialize the SDK
const centrifuge = new Centrifuge({
  environment: 'mainnet', // or 'testnet'
  rpcUrls: {
    1: 'https://eth-mainnet.g.alchemy.com/v2/your-key',
    8453: 'https://base-mainnet.g.alchemy.com/v2/your-key'
  }
})

// Get all pools
const pools = await centrifuge.pools()

// Get a specific pool
const pool = await centrifuge.pool('your-pool-id')

// Get vault for investment
const vault = await pool.vault(1, 'share-class-id', 'currency-address')

// Make an investment
const investment = vault.increaseInvestOrder(amount)
await investment // Wait for transaction completion
```

## 📋 Table of Contents

- [Installation](#-installation)
- [Configuration](#-configuration)
- [Core Concepts](#-core-concepts)
- [API Reference](#-api-reference)
- [Transaction Management](#-transaction-management)
- [Multi-Chain Operations](#-multi-chain-operations)
- [Examples](#-examples)
- [TypeScript Support](#-typescript-support)
- [Contributing](#-contributing)

## ⚙️ Configuration

### Basic Configuration

```typescript
import Centrifuge from '@centrifuge/sdk'

const centrifuge = new Centrifuge({
  environment: 'mainnet',          // 'mainnet' | 'testnet'
  rpcUrls: {                      // Custom RPC endpoints (optional)
    1: 'https://ethereum-rpc.com',
    8453: 'https://base-rpc.com'
  },
  indexerUrl: 'https://api.centrifuge.io', // GraphQL endpoint
  cache: true,                    // Enable query caching
  pollingInterval: 2000          // Real-time update interval (ms)
})
```

### Environment-Specific Defaults

#### Mainnet
- **Indexer**: `https://api.centrifuge.io`
- **Supported Chains**: Ethereum (1), Base (8453), Arbitrum (42161), Avalanche (43114), Plume (98866)
- **IPFS Gateway**: `https://centrifuge.mypinata.cloud`

#### Testnet  
- **Indexer**: `https://api-v3-hitz.marble.live/graphql`
- **Supported Chains**: Sepolia (11155111), Base Sepolia (84532), Arbitrum Sepolia (421614)
- **IPFS Gateway**: `https://centrifuge.mypinata.cloud`

## 🧠 Core Concepts

### Pools
Investment pools that tokenize real-world assets and enable DeFi liquidity.

```typescript
// Get all pools
const pools = await centrifuge.pools()

// Get specific pool with metadata
const pool = await centrifuge.pool('pool-id')
const details = await pool.details()
```

### Vaults (ERC-7540)
Tokenized vaults implementing the ERC-7540 standard for async deposits and redemptions.

```typescript
// Get vault for specific share class and currency
const vault = await pool.vault(chainId, shareClassId, currencyAddress)

// Check investment status
const investment = await vault.investment(investorAddress)

// Make investment
const transaction = vault.increaseInvestOrder(amount)
```

### Investors
Individual participants who invest in pools across different chains.

```typescript
const investor = centrifuge.investor(address)
const portfolio = await investor.portfolio(chainId)
```

### Share Classes
Different investment terms and restrictions within the same pool.

```typescript
const shareClass = pool.shareClass(shareClassId)
const member = await shareClass.member(investorAddress)
```

## 📚 API Reference

### Centrifuge Class

The main SDK entry point providing access to all functionality.

#### Constructor

```typescript
new Centrifuge(config?: Config)
```

**Config Options:**
- `environment`: `'mainnet' | 'testnet'` - Network environment
- `rpcUrls?`: `Record<number, string | string[]>` - Custom RPC URLs per chain ID
- `indexerUrl?`: `string` - GraphQL indexer endpoint
- `ipfsUrl?`: `string` - IPFS gateway URL
- `cache?`: `boolean` - Enable query caching (default: true)
- `pollingInterval?`: `number` - Update polling interval in ms (default: 2000)

#### Core Methods

```typescript
// Pool operations
pools(): Promise<Pool[]>
pool(poolId: string): Promise<Pool>

// Investor operations  
investor(address: HexString): Investor
investors(): Promise<Investor[]>

// Chain management
getClient(chainId: number): PublicClient
getChainConfig(chainId: number): Chain
setSigner(signer: Signer): void

// Utility
get chains(): number[]
```

### Pool Class

Represents an investment pool with metadata and share classes.

```typescript
class Pool {
  // Pool information
  id: string
  chainId: number
  
  // Core methods
  details(): Promise<PoolDetails>
  metadata(): Promise<PoolMetadata>  
  shareClasses(): Promise<ShareClass[]>
  vault(chainId: number, shareClassId: string, currencyAddress: HexString): Promise<Vault>
  
  // Pool management (requires permissions)
  closeEpoch(): Transaction
  solveEpoch(): Transaction
  
  // Specific entities
  shareClass(shareClassId: string): ShareClass
  balanceSheet(): BalanceSheet
}
```

### Vault Class

ERC-7540 tokenized vault for investments and redemptions.

```typescript
class Vault {
  // Vault information
  address: HexString
  chainId: number
  shareClass: ShareClass
  investmentCurrency: CurrencyDetails
  shareCurrency: CurrencyDetails
  
  // Investment operations
  investment(investorAddress: HexString): Promise<Investment>
  increaseInvestOrder(amount: Balance): Transaction
  decreaseInvestOrder(amount: Balance): Transaction
  claim(address: HexString, assets: Balance, shares: Balance): Transaction
  
  // Redemption operations  
  increaseRedeemOrder(amount: Balance): Transaction
  decreaseRedeemOrder(amount: Balance): Transaction
  
  // Sync operations (if supported)
  deposit(amount: Balance, receiver?: HexString): Transaction
  mint(shares: Balance, receiver?: HexString): Transaction
  withdraw(amount: Balance, receiver?: HexString, owner?: HexString): Transaction
  redeem(shares: Balance, receiver?: HexString, owner?: HexString): Transaction
}
```

### Investor Class

Represents an individual investor across all chains.

```typescript
class Investor {
  address: HexString
  
  // Portfolio information
  portfolio(chainId?: number): Promise<Portfolio>
  investment(poolId: string, shareClassId: string): Promise<Investment>
  
  // Membership
  isMember(poolId: string, shareClassId: string): Promise<boolean>
}
```

### Transaction System

All blockchain operations return Transaction observables that provide real-time status updates.

```typescript
type OperationStatus = 
  | { type: 'SwitchingChain', chainId: number }
  | { type: 'SigningTransaction', id: string, title: string }  
  | { type: 'TransactionPending', id: string, title: string }
  | { type: 'TransactionConfirmed', id: string, title: string, receipt: any }

// Usage patterns
const transaction = vault.increaseInvestOrder(amount)

// As Promise (waits for completion)
await transaction

// As Observable (status updates)
transaction.subscribe(
  status => console.log(status),
  error => console.error(error),
  () => console.log('Complete')
)
```

## 🔄 Transaction Management

### Simple Transactions

```typescript
// Basic investment
const amount = Balance.fromFloat(1000, 6) // 1000 USDC
await vault.increaseInvestOrder(amount)
```

### Transaction Status Monitoring

```typescript
vault.increaseInvestOrder(amount).subscribe({
  next: (status) => {
    switch (status.type) {
      case 'SwitchingChain':
        console.log(`Switching to chain ${status.chainId}`)
        break
      case 'SigningTransaction':
        console.log(`Please sign transaction: ${status.title}`)
        break
      case 'TransactionPending':
        console.log(`Transaction pending: ${status.id}`)
        break
      case 'TransactionConfirmed':
        console.log(`Transaction confirmed: ${status.id}`)
        console.log('Receipt:', status.receipt)
        break
    }
  },
  error: (error) => console.error('Transaction failed:', error),
  complete: () => console.log('Transaction complete')
})
```

### Batch Operations

```typescript
// Multiple operations in sequence
const operations = [
  vault.increaseInvestOrder(amount1),
  vault2.increaseInvestOrder(amount2)
]

for (const op of operations) {
  await op
}
```

## 🌉 Multi-Chain Operations

### Cross-Chain Investments

```typescript
// Invest in pool from different chains
const ethereumVault = await pool.vault(1, 'shareClassId', '0xA0b86a33E6842...') // USDC
const baseVault = await pool.vault(8453, 'shareClassId', '0x833589fCD6eD...') // USDC

// Invest from Ethereum
await ethereumVault.increaseInvestOrder(Balance.fromFloat(1000, 6))

// Invest from Base  
await baseVault.increaseInvestOrder(Balance.fromFloat(500, 6))
```

### Chain-Specific Queries

```typescript
// Get investor portfolio on specific chain
const portfolio = await investor.portfolio(1) // Ethereum only

// Get all investments across chains
const allPortfolios = await Promise.all(
  centrifuge.chains.map(chainId => 
    investor.portfolio(chainId)
  )
)
```

## 💡 Examples

### Basic Pool Investment

```typescript
import Centrifuge, { Balance } from '@centrifuge/sdk'

async function investInPool() {
  const centrifuge = new Centrifuge({ environment: 'mainnet' })
  
  // Get the pool
  const pool = await centrifuge.pool('your-pool-id')
  
  // Get vault for USDC on Ethereum
  const vault = await pool.vault(1, 'share-class-id', '0xA0b86a33E6842...')
  
  // Check current investment
  const investment = await vault.investment('0x742d35Cc6635...')
  console.log('Current investment:', investment)
  
  // Make additional investment
  const amount = Balance.fromFloat(1000, 6) // 1000 USDC
  await vault.increaseInvestOrder(amount)
  
  console.log('Investment successful!')
}
```

### Portfolio Management

```typescript
async function getPortfolioSummary(investorAddress: string) {
  const centrifuge = new Centrifuge({ environment: 'mainnet' })
  const investor = centrifuge.investor(investorAddress)
  
  // Get portfolio across all chains
  const portfolios = await Promise.all(
    centrifuge.chains.map(async (chainId) => {
      try {
        const portfolio = await investor.portfolio(chainId)
        return { chainId, portfolio }
      } catch {
        return null
      }
    })
  )
  
  const activePortfolios = portfolios.filter(p => p !== null)
  
  console.log(`Active on ${activePortfolios.length} chains`)
  activePortfolios.forEach(({ chainId, portfolio }) => {
    console.log(`Chain ${chainId}:`, portfolio)
  })
}
```

### Real-time Pool Monitoring

```typescript
function monitorPool(poolId: string) {
  const centrifuge = new Centrifuge({ environment: 'mainnet' })
  
  // Subscribe to real-time pool updates
  centrifuge.pool(poolId).subscribe({
    next: (pool) => {
      console.log('Pool updated:', {
        id: pool.id,
        totalValueLocked: pool.details.totalValueLocked,
        shareClasses: pool.shareClasses.length
      })
    },
    error: (error) => console.error('Pool monitoring error:', error)
  })
}
```

### Advanced Transaction Handling

```typescript
async function complexInvestment() {
  const centrifuge = new Centrifuge({ environment: 'mainnet' })
  
  // Set up wallet signer
  centrifuge.setSigner(walletClient)
  
  const vault = await centrifuge.pool('pool-id')
    .then(pool => pool.vault(1, 'share-class', 'currency-address'))
  
  // Check if we need to approve first
  const investment = await vault.investment(investorAddress)
  const amount = Balance.fromFloat(1000, 6)
  
  try {
    // Attempt investment (may require approval)
    const transaction = vault.increaseInvestOrder(amount)
    
    // Handle transaction with timeout
    const result = await Promise.race([
      transaction,
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Transaction timeout')), 300000)
      )
    ])
    
    console.log('Investment successful:', result)
    
  } catch (error) {
    if (error.message.includes('allowance')) {
      console.log('Approval required - please approve in your wallet')
      // Handle approval workflow
    } else {
      console.error('Investment failed:', error)
    }
  }
}
```

## 🔧 TypeScript Support

The SDK is built with TypeScript and provides comprehensive type definitions.

### Key Types

```typescript
import { 
  Balance,
  Price, 
  HexString,
  PoolId,
  ShareClassId,
  CurrencyDetails,
  Investment,
  Portfolio,
  PoolDetails,
  Transaction
} from '@centrifuge/sdk'

// Type-safe addresses
const address: HexString = '0x742d35Cc6635C0532925a3b8D0C9FDf3d9CAF3c3'

// Precise decimal handling
const amount: Balance = Balance.fromFloat(1000.50, 6)
const price: Price = Price.fromFloat(1.05, 18)

// Pool and share class IDs
const poolId: PoolId = 'your-pool-id'
const shareClassId: ShareClassId = 'share-class-id'
```

### Custom Type Guards

```typescript
import { isHexString, isPoolId } from '@centrifuge/sdk'

// Runtime type checking
if (isHexString(userInput)) {
  // userInput is now typed as HexString
  const investor = centrifuge.investor(userInput)
}

if (isPoolId(poolInput)) {
  // poolInput is now typed as PoolId  
  const pool = await centrifuge.pool(poolInput)
}
```

## 🐛 Error Handling

```typescript
import { CentrifugeError, TransactionError } from '@centrifuge/sdk'

try {
  await vault.increaseInvestOrder(amount)
} catch (error) {
  if (error instanceof TransactionError) {
    console.error('Transaction failed:', error.message)
    console.error('Transaction hash:', error.transactionHash)
  } else if (error instanceof CentrifugeError) {
    console.error('SDK error:', error.message)
  } else {
    console.error('Unexpected error:', error)
  }
}
```

## 🔌 Wallet Integration

### MetaMask

```typescript
import { createWalletClient, custom } from 'viem'
import { mainnet } from 'viem/chains'

const walletClient = createWalletClient({
  chain: mainnet,
  transport: custom(window.ethereum)
})

centrifuge.setSigner(walletClient)
```

### WalletConnect

```typescript
import { createWalletClient } from 'viem'
import { walletConnect } from 'viem/connectors'

const walletClient = createWalletClient({
  chain: mainnet,
  connectors: [
    walletConnect({
      projectId: 'your-project-id'
    })
  ]
})

centrifuge.setSigner(walletClient)
```

## 📊 Performance & Caching

The SDK includes intelligent caching to minimize API calls and improve performance.

### Cache Configuration

```typescript
const centrifuge = new Centrifuge({
  cache: true,           // Enable caching
  pollingInterval: 5000  // Update every 5 seconds
})
```

### Manual Cache Control

```typescript
// Clear all cached data
centrifuge.clearCache()

// Disable caching for specific queries
const pool = await centrifuge.pool('id', { cache: false })
```

## 🧪 Testing

### Mock Centrifuge Instance

```typescript
import { createMockCentrifuge } from '@centrifuge/sdk/testing'

const mockCentrifuge = createMockCentrifuge({
  environment: 'testnet',
  mockData: {
    pools: [/* mock pool data */],
    investments: [/* mock investment data */]
  }
})
```

## 🔗 Related Resources

- [Centrifuge Documentation](https://docs.centrifuge.io/)
- [GraphQL API Explorer](https://api.centrifuge.io)
- [ERC-7540 Standard](https://eips.ethereum.org/EIPS/eip-7540)
- [Centrifuge Protocol](https://centrifuge.io)

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details on:

- Setting up the development environment
- Running tests
- Code style guidelines
- Submitting pull requests

## 📄 License

This project is licensed under the Apache 2.0 License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- [GitHub Issues](https://github.com/centrifuge/sdk/issues)
- [Discord Community](https://discord.gg/centrifuge)
- [Documentation](https://docs.centrifuge.io/)