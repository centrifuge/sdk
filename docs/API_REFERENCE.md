# Centrifuge SDK API Reference

Complete reference documentation for all classes, methods, and types in the Centrifuge SDK.

## Table of Contents

- [Centrifuge Class](#centrifuge-class)
- [Pool Class](#pool-class)
- [Vault Class](#vault-class)
- [Investor Class](#investor-class)
- [ShareClass Class](#shareclass-class)
- [Transaction System](#transaction-system)
- [Types](#types)
- [Utilities](#utilities)
- [Error Classes](#error-classes)

## Centrifuge Class

The main entry point for the Centrifuge SDK.

### Constructor

```typescript
new Centrifuge(config?: Config)
```

#### Config Interface

```typescript
interface Config {
  environment?: 'mainnet' | 'testnet'
  rpcUrls?: Record<number, string | string[]>
  indexerUrl?: string
  ipfsUrl?: string
  cache?: boolean
  pollingInterval?: number
  pinJson?: (json: any) => Promise<string>
  pinFile?: (b64URI: string) => Promise<string>
}
```

### Properties

- `chains: number[]` - Array of supported chain IDs
- `environment: 'mainnet' | 'testnet'` - Current environment

### Methods

#### Pool Operations

```typescript
// Get all pools
pools(): Promise<Pool[]>

// Get specific pool
pool(poolId: PoolId): Promise<Pool>
```

#### Investor Operations

```typescript
// Get investor instance
investor(address: HexString): Investor

// Get all investors
investors(): Promise<Investor[]>
```

#### Chain Management

```typescript
// Get viem client for specific chain
getClient(chainId: number): PublicClient

// Get chain configuration
getChainConfig(chainId: number): Chain

// Set wallet signer for transactions
setSigner(signer: Signer | null): void
```

#### Vault Operations

```typescript
// Get vault directly by address
vault(address: HexString, chainId: number, shareClassId: ShareClassId): Promise<Vault>
```

## Pool Class

Represents an investment pool in the Centrifuge ecosystem.

### Properties

```typescript
class Pool {
  id: PoolId
  chainId: number
  details: PoolDetails
  metadata: PoolMetadata
  shareClasses: ShareClass[]
}
```

### Methods

#### Core Information

```typescript
// Get detailed pool information
details(): Promise<PoolDetails>

// Get pool metadata from IPFS
metadata(): Promise<PoolMetadata>

// Get all share classes
shareClasses(): Promise<ShareClass[]>
```

#### Vault Access

```typescript
// Get vault for specific parameters
vault(
  chainId: number, 
  shareClassId: ShareClassId, 
  currencyAddress: HexString
): Promise<Vault>
```

#### Pool Management

```typescript
// Close current epoch (pool admin only)
closeEpoch(): Transaction

// Solve epoch (pool admin only)
solveEpoch(): Transaction

// Update pool metadata (pool admin only)
updateMetadata(metadata: PoolMetadata): Transaction
```

#### Specific Entities

```typescript
// Get specific share class
shareClass(shareClassId: ShareClassId): ShareClass

// Get balance sheet for reporting
balanceSheet(): BalanceSheet
```

## Vault Class

ERC-7540 tokenized vault for investments and redemptions.

### Properties

```typescript
class Vault {
  address: HexString
  chainId: number
  shareClass: ShareClass
  investmentCurrency: CurrencyDetails
  shareCurrency: CurrencyDetails
  maxDeposit: Balance
  maxMint: Balance
  maxWithdraw: Balance
  maxRedeem: Balance
  totalAssets: Balance
  totalSupply: Balance
  pendingDepositRequest: Balance
  claimableDepositRequest: Balance
  pendingRedeemRequest: Balance
  claimableRedeemRequest: Balance
}
```

### Methods

#### Investment Information

```typescript
// Get investment details for specific investor
investment(investorAddress: HexString): Promise<Investment>

// Get vault details
details(): Promise<VaultDetails>
```

#### Investment Operations (Async)

```typescript
// Increase investment order
increaseInvestOrder(amount: Balance): Transaction

// Decrease investment order  
decreaseInvestOrder(amount: Balance): Transaction

// Claim processed deposits
claim(
  address: HexString, 
  assets: Balance, 
  shares: Balance
): Transaction
```

#### Redemption Operations (Async)

```typescript
// Increase redemption order
increaseRedeemOrder(shares: Balance): Transaction

// Decrease redemption order
decreaseRedeemOrder(shares: Balance): Transaction
```

#### Sync Operations (if supported)

```typescript
// Direct deposit (sync vaults only)
deposit(amount: Balance, receiver?: HexString): Transaction

// Mint shares directly (sync vaults only)
mint(shares: Balance, receiver?: HexString): Transaction

// Withdraw assets directly (sync vaults only)
withdraw(
  amount: Balance, 
  receiver?: HexString, 
  owner?: HexString
): Transaction

// Redeem shares directly (sync vaults only)
redeem(
  shares: Balance, 
  receiver?: HexString, 
  owner?: HexString
): Transaction
```

#### Preview Operations

```typescript
// Preview deposit conversion
previewDeposit(assets: Balance): Promise<Balance>

// Preview mint conversion
previewMint(shares: Balance): Promise<Balance>

// Preview withdraw conversion
previewWithdraw(assets: Balance): Promise<Balance>

// Preview redeem conversion
previewRedeem(shares: Balance): Promise<Balance>
```

## Investor Class

Represents an individual investor across all supported chains.

### Properties

```typescript
class Investor {
  address: HexString
}
```

### Methods

#### Portfolio Information

```typescript
// Get portfolio for specific or all chains
portfolio(chainId?: number): Promise<Portfolio>

// Get specific investment
investment(poolId: PoolId, shareClassId: ShareClassId): Promise<Investment>
```

#### Membership

```typescript
// Check if investor is member of share class
isMember(poolId: PoolId, shareClassId: ShareClassId): Promise<boolean>
```

## ShareClass Class

Represents a share class within a pool with specific terms and restrictions.

### Properties

```typescript
class ShareClass {
  id: ShareClassId
  poolId: PoolId
  details: ShareClassDetails
  metadata: ShareClassMetadata
}
```

### Methods

#### Information

```typescript
// Get share class details
details(): Promise<ShareClassDetails>

// Get share class metadata
metadata(): Promise<ShareClassMetadata>
```

#### Member Management

```typescript
// Get member information
member(address: HexString): Promise<Member>

// Add member (admin only)
addMember(address: HexString, validUntil: Date): Transaction

// Remove member (admin only)  
removeMember(address: HexString): Transaction
```

#### Management

```typescript
// Update share class metadata (admin only)
updateMetadata(metadata: ShareClassMetadata): Transaction
```

## Transaction System

The SDK uses an Observable-based transaction system that provides real-time status updates.

### Transaction Type

```typescript
type Transaction = Observable<OperationStatus> & Promise<OperationConfirmedStatus>
```

### Operation Status Types

```typescript
type OperationStatus = 
  | SwitchingChainStatus
  | SigningTransactionStatus  
  | TransactionPendingStatus
  | TransactionConfirmedStatus

interface SwitchingChainStatus {
  type: 'SwitchingChain'
  chainId: number
}

interface SigningTransactionStatus {
  type: 'SigningTransaction' 
  id: string
  title: string
}

interface TransactionPendingStatus {
  type: 'TransactionPending'
  id: string
  title: string
  txHash: string
}

interface TransactionConfirmedStatus {
  type: 'TransactionConfirmed'
  id: string
  title: string
  txHash: string
  receipt: TransactionReceipt
}
```

### Usage Patterns

```typescript
// As Promise - waits for completion
const result = await vault.increaseInvestOrder(amount)

// As Observable - real-time updates
vault.increaseInvestOrder(amount).subscribe({
  next: (status) => console.log(status),
  error: (error) => console.error(error),
  complete: () => console.log('Complete')
})
```

## Types

### Core Financial Types

```typescript
// Precise decimal arithmetic
class Balance {
  static fromFloat(value: number, decimals: number): Balance
  static fromBigInt(value: bigint, decimals: number): Balance
  
  toFloat(): number
  toBigInt(): bigint
  toString(): string
  add(other: Balance): Balance
  sub(other: Balance): Balance
  mul(other: Balance | Price): Balance
  div(other: Balance | Price): Balance
}

// Price/rate representation  
class Price {
  static fromFloat(value: number, decimals: number): Price
  static fromBigInt(value: bigint, decimals: number): Price
  
  toFloat(): number
  toBigInt(): bigint
  toString(): string
  mul(amount: Balance): Balance
}

// Percentage representation (parts per quintillion)
class Perquintill {
  static fromPercent(value: number): Perquintill
  static fromFloat(value: number): Perquintill
  
  toPercent(): number
  toFloat(): number
  toString(): string
}
```

### Identifier Types

```typescript
// Type-safe hex addresses
type HexString = `0x${string}`

// Pool identifier
type PoolId = string

// Share class identifier  
type ShareClassId = string

// Asset identifier
type AssetId = string
```

### Data Types

```typescript
interface CurrencyDetails {
  address: HexString
  name: string
  symbol: string
  decimals: number
}

interface PoolDetails {
  id: PoolId
  metadata: PoolMetadata
  shareClasses: ShareClassDetails[]
  totalValueLocked: Balance
  netAssetValue: Balance
  offchainCashValue: Balance
  portfolioValuation: Balance
  sumPoolFeesAccrued: Balance
  sumPoolFeesAccruedAmount: Balance
  sumPoolFeesPaidAmount: Balance
}

interface Investment {
  investorAddress: HexString
  poolId: PoolId
  shareClassId: ShareClassId
  currencyAddress: HexString
  claimableInvestment: Balance
  pendingInvestment: Balance
  claimableShares: Balance
  totalInvestment: Balance
  totalShares: Balance
}

interface Portfolio {
  investorAddress: HexString
  chainId: number
  investments: Investment[]
  totalValue: Balance
}
```

## Utilities

### Type Guards

```typescript
// Check if string is valid hex address
function isHexString(value: string): value is HexString

// Check if string is valid pool ID
function isPoolId(value: string): value is PoolId

// Check if string is valid share class ID
function isShareClassId(value: string): value is ShareClassId
```

### Formatters

```typescript
// Format balance for display
function formatBalance(
  balance: Balance, 
  currency?: string, 
  precision?: number
): string

// Format percentage
function formatPercentage(
  perquintill: Perquintill, 
  precision?: number
): string

// Format address (truncated)
function formatAddress(address: HexString): string
```

### Converters

```typescript
// Convert between different representations
function balanceToFloat(balance: Balance): number
function floatToBalance(value: number, decimals: number): Balance
function priceToFloat(price: Price): number
function floatToPrice(value: number, decimals: number): Price
```

## Error Classes

### Base Error Classes

```typescript
// Base SDK error
class CentrifugeError extends Error {
  name: 'CentrifugeError'
  message: string
  cause?: Error
}

// Transaction-related errors
class TransactionError extends CentrifugeError {
  name: 'TransactionError'
  transactionHash?: string
  receipt?: TransactionReceipt
}

// Network/RPC errors
class NetworkError extends CentrifugeError {
  name: 'NetworkError'
  chainId: number
}

// Indexer query errors
class IndexerError extends CentrifugeError {
  name: 'IndexerError'
  query: string
}
```

### Specific Error Types

```typescript
// Insufficient balance/allowance
class InsufficientBalanceError extends TransactionError

// Pool not found
class PoolNotFoundError extends CentrifugeError

// Share class not found  
class ShareClassNotFoundError extends CentrifugeError

// Unauthorized operation
class UnauthorizedError extends CentrifugeError

// Invalid parameter
class InvalidParameterError extends CentrifugeError
```

### Error Handling Examples

```typescript
try {
  await vault.increaseInvestOrder(amount)
} catch (error) {
  if (error instanceof InsufficientBalanceError) {
    console.log('Insufficient balance or allowance')
  } else if (error instanceof TransactionError) {
    console.log('Transaction failed:', error.transactionHash)
  } else if (error instanceof NetworkError) {
    console.log('Network error on chain:', error.chainId)
  } else {
    console.log('Unknown error:', error.message)
  }
}
```

## Constants

### Environment URLs

```typescript
const MAINNET_INDEXER_URL = 'https://api.centrifuge.io'
const TESTNET_INDEXER_URL = 'https://api-v3-hitz.marble.live/graphql'
const IPFS_GATEWAY_URL = 'https://centrifuge.mypinata.cloud'
```

### Chain IDs

```typescript
// Mainnet chains
const ETHEREUM_MAINNET = 1
const BASE_MAINNET = 8453  
const ARBITRUM_MAINNET = 42161
const AVALANCHE_MAINNET = 43114
const PLUME_MAINNET = 98866

// Testnet chains
const SEPOLIA_TESTNET = 11155111
const BASE_SEPOLIA = 84532
const ARBITRUM_SEPOLIA = 421614
```

### Default Values

```typescript
const DEFAULT_POLLING_INTERVAL = 2000 // 2 seconds
const DEFAULT_CACHE_ENABLED = true
const DEFAULT_CACHE_TTL = 30000 // 30 seconds
```