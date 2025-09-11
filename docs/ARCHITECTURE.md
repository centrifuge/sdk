# Centrifuge SDK Architecture

This document provides a comprehensive overview of the Centrifuge SDK architecture, design patterns, and implementation details.

## Table of Contents

- [Overview](#overview)
- [Core Architecture](#core-architecture)
- [Data Flow](#data-flow)
- [Entity Model](#entity-model)
- [Transaction System](#transaction-system)
- [Multi-Chain Support](#multi-chain-support)
- [Caching Strategy](#caching-strategy)
- [GraphQL Integration](#graphql-integration)
- [Error Handling](#error-handling)
- [Design Patterns](#design-patterns)
- [Performance Considerations](#performance-considerations)
- [Security Model](#security-model)

## Overview

The Centrifuge SDK is designed as a comprehensive TypeScript library that abstracts the complexity of interacting with the Centrifuge protocol - a multi-chain asset management ecosystem that tokenizes real-world assets through ERC-7540 vaults.

### Key Design Goals

1. **Developer Experience** - Simple, intuitive APIs that hide blockchain complexity
2. **Type Safety** - Full TypeScript support with generated types from on-chain data
3. **Multi-Chain Native** - Seamless interaction across multiple EVM chains
4. **Real-time Data** - Observable-based architecture for live updates
5. **Performance** - Intelligent caching and query optimization
6. **Extensibility** - Modular design for easy feature additions

## Core Architecture

### High-Level Structure

```
┌─────────────────────────────────────────────────────────┐
│                    Application Layer                    │
├─────────────────────────────────────────────────────────┤
│                  Centrifuge SDK API                     │
├─────────────────────────────────────────────────────────┤
│    Entity Layer    │   Transaction Layer   │   Cache    │
├─────────────────────────────────────────────────────────┤
│        Blockchain Clients        │     GraphQL Client   │
├─────────────────────────────────────────────────────────┤
│  Ethereum  │  Base  │  Arbitrum  │   Centrifuge API     │
└─────────────────────────────────────────────────────────┘
```

### Main Components

#### 1. Centrifuge Class
- **Role**: Central orchestrator and entry point
- **Responsibilities**:
  - Client management for multiple chains
  - Signer coordination for transactions
  - Configuration management
  - Entity factory methods

#### 2. Entity Classes
- **Pool**: Investment pool management
- **Vault**: ERC-7540 tokenized vault operations
- **Investor**: Cross-chain investor portfolio
- **ShareClass**: Share class metadata and restrictions

#### 3. Transaction System
- **Observable-based**: Real-time status updates
- **Chain switching**: Automatic wallet chain management
- **Error recovery**: Robust error handling and retries

#### 4. Data Layer
- **GraphQL client**: Centralized indexer queries
- **Blockchain clients**: Direct chain interaction via viem
- **Cache layer**: Intelligent result caching

## Data Flow

### Query Flow
```
Application Request
       │
       ▼
   Entity Method
       │
       ├─── Cache Check ──── Hit ──── Return Cached
       │                       │
       ▼                       ▼
   Cache Miss              Log Cache Hit
       │
       ▼
GraphQL/Blockchain Query
       │
       ▼
   Data Transform
       │
       ▼
    Cache Store
       │
       ▼
   Return to App
```

### Transaction Flow
```
Transaction Request
       │
       ▼
  Validation & Preparation
       │
       ▼
   Chain Switch (if needed)
       │
       ▼
   Wallet Interaction
       │
       ├── Sign ──── Pending ──── Confirmed
       │                              │
       ▼                              ▼
    Failed                        Cache Update
       │                              │
       ▼                              ▼
Error Handling                  Notify Success
```

## Entity Model

The SDK uses a domain-driven design approach with entities representing real-world concepts in the Centrifuge ecosystem.

### Entity Hierarchy

```
Centrifuge (Root)
├── Pool[]
│   ├── ShareClass[]
│   │   └── Member[]
│   ├── Vault[]
│   └── BalanceSheet
├── Investor[]
│   └── Portfolio[]
│       └── Investment[]
└── PoolNetwork[]
```

### Entity Relationships

```typescript
// Pool contains multiple share classes
Pool ──────● ShareClass
  │             │
  │             └────● Member
  │
  └────● Vault (ERC-7540)
         │
         └────● Investment
```

### Entity Lifecycle

1. **Lazy Loading**: Entities are created on-demand
2. **Data Binding**: Automatic updates through observables
3. **Cache Integration**: Transparent caching at entity level
4. **State Management**: Consistent state across entity instances

## Transaction System

### Observable Transaction Pattern

The SDK implements a unique pattern where transactions are both Observables (for status updates) and Promises (for completion).

```typescript
interface Transaction extends Observable<OperationStatus>, Promise<OperationConfirmedStatus> {
  // Dual nature allows both patterns:
  // await transaction (Promise)
  // transaction.subscribe() (Observable)
}
```

### Transaction States

```
Initial ──┐
          │
          ▼
    SwitchingChain ──┐
                     │
                     ▼
               SigningTransaction ──┐
                                   │
                                   ▼
                              TransactionPending ──┐
                                                   │
                                                   ▼
                                              TransactionConfirmed
                                                   │
                                                   ▼
                                                Complete
```

### Multi-Step Transactions

Some operations require multiple blockchain transactions:

```typescript
// Example: Investment with approval
async function investWithApproval() {
  // 1. Check allowance
  // 2. Approve if needed
  // 3. Execute investment
  // Each step emits status updates
}
```

## Multi-Chain Support

### Chain Management Architecture

```
Centrifuge Instance
├── Chain 1 (Ethereum)
│   ├── PublicClient (viem)
│   ├── WalletClient (viem)
│   └── Contract Instances
├── Chain 8453 (Base)
│   ├── PublicClient (viem)
│   ├── WalletClient (viem)
│   └── Contract Instances
└── Chain 42161 (Arbitrum)
    ├── PublicClient (viem)
    ├── WalletClient (viem)
    └── Contract Instances
```

### Cross-Chain Operations

1. **Automatic Chain Detection**: Determines correct chain for operations
2. **Chain Switching**: Prompts wallet to switch chains when needed
3. **Parallel Queries**: Concurrent data fetching across chains
4. **Unified Responses**: Aggregates cross-chain data seamlessly

### Chain Configuration

```typescript
interface ChainConfig {
  id: number
  name: string
  rpcUrls: string[]
  contracts: {
    [contractName: string]: HexString
  }
  blockTime: number
  gasLimit: bigint
}
```

## Caching Strategy

### Multi-Layer Caching

```
Application Request
       │
       ▼
┌──────────────────┐
│   Memory Cache   │ ←── Hot data (< 30s old)
├──────────────────┤
│  GraphQL Cache   │ ←── Query results (< 5m old)
├──────────────────┤
│ Blockchain Cache │ ←── On-chain data (< 2m old)
└──────────────────┘
       │
       ▼
   Network Request
```

### Cache Invalidation Strategy

1. **Time-based**: TTL for different data types
2. **Event-based**: Blockchain events trigger cache invalidation  
3. **Manual**: Explicit cache clearing for specific operations
4. **Memory management**: Automatic cleanup of stale entries

### Cache Implementation

```typescript
interface CacheEntry<T> {
  data: T
  timestamp: number
  ttl: number
  key: string
}

class Cache {
  private store = new Map<string, CacheEntry<any>>()
  
  get<T>(key: string): T | null
  set<T>(key: string, data: T, ttl?: number): void
  invalidate(pattern: string): void
  clear(): void
}
```

## GraphQL Integration

### Query Architecture

The SDK uses GraphQL as the primary data source for aggregated, indexed data across all supported chains.

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Application   │───▶│  GraphQL Client  │───▶│  Centrifuge API │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                              │                          │
                              │                          ▼
                              │                  ┌───────────────┐
                              │                  │   Database    │
                              │                  │  (Indexed)    │
                              │                  └───────────────┘
                              │
                              ▼
                       ┌──────────────┐
                       │ Query Cache  │
                       └──────────────┘
```

### Query Optimization

1. **Batching**: Multiple queries combined into single request
2. **Field Selection**: Only request needed fields
3. **Pagination**: Efficient handling of large datasets
4. **Subscription**: Real-time updates for live data

### Generated Types

The SDK includes generated TypeScript types from the GraphQL schema:

```typescript
// Generated from GraphQL schema
interface PoolQuery {
  pool: {
    id: string
    metadata: PoolMetadata
    shareClasses: ShareClassDetails[]
    totalValueLocked: string
  }
}
```

## Error Handling

### Error Hierarchy

```
CentrifugeError (Base)
├── NetworkError
│   ├── RpcError
│   └── ConnectionError
├── TransactionError
│   ├── UserRejectedError
│   ├── InsufficientFundsError
│   └── ContractError
├── IndexerError
│   ├── QueryError
│   └── ValidationError
└── ConfigurationError
    ├── InvalidChainError
    └── MissingConfigError
```

### Error Recovery Strategies

1. **Automatic Retry**: Network errors with exponential backoff
2. **Fallback Sources**: Alternative RPC endpoints
3. **Graceful Degradation**: Partial functionality when services unavailable
4. **User Guidance**: Clear error messages with suggested actions

### Error Context

```typescript
class TransactionError extends CentrifugeError {
  constructor(
    message: string,
    public readonly transactionHash?: string,
    public readonly chainId?: number,
    public readonly gasUsed?: bigint
  ) {
    super(message)
  }
}
```

## Design Patterns

### 1. Observable Pattern

Used extensively for real-time data and transaction status:

```typescript
// Data observables for live updates
pool.details().subscribe(details => {
  // React to pool changes
})

// Transaction observables for status
transaction.subscribe(status => {
  // Handle status updates
})
```

### 2. Factory Pattern

Entity creation through factory methods:

```typescript
class Centrifuge {
  pool(id: string): Pool {
    return new Pool(id, this.config, this.clients)
  }
  
  investor(address: string): Investor {
    return new Investor(address, this.config, this.clients)
  }
}
```

### 3. Builder Pattern

Complex configuration setup:

```typescript
const centrifuge = new CentrifugeBuilder()
  .environment('mainnet')
  .rpcUrl(1, 'https://ethereum-rpc.com')
  .cache(true)
  .pollingInterval(5000)
  .build()
```

### 4. Decorator Pattern

Method enhancement for caching and error handling:

```typescript
class Pool {
  @cached(300) // 5 minute cache
  @retryable(3) // 3 retry attempts
  async details(): Promise<PoolDetails> {
    return this.fetchDetails()
  }
}
```

### 5. Strategy Pattern

Different transaction strategies based on vault type:

```typescript
interface TransactionStrategy {
  execute(params: TransactionParams): Transaction
}

class SyncVaultStrategy implements TransactionStrategy {
  execute(params: TransactionParams): Transaction {
    // Direct deposit/withdraw
  }
}

class AsyncVaultStrategy implements TransactionStrategy {
  execute(params: TransactionParams): Transaction {
    // Order-based investment
  }
}
```

## Performance Considerations

### Query Optimization

1. **Lazy Loading**: Data loaded only when accessed
2. **Batch Queries**: Combine multiple requests
3. **Selective Fields**: Request only needed data
4. **Parallel Execution**: Concurrent chain queries

### Memory Management

1. **Weak References**: Prevent memory leaks in long-running apps
2. **Cache Limits**: Maximum entries and memory usage
3. **Garbage Collection**: Automatic cleanup of unused entities
4. **Resource Pooling**: Reuse HTTP connections and clients

### Network Optimization

1. **Connection Pooling**: Reuse HTTP connections
2. **Compression**: GZIP compression for GraphQL queries
3. **CDN**: Cache static assets (ABIs, metadata)
4. **Edge Caching**: Geographic distribution of API responses

### Code Splitting

```typescript
// Lazy load heavy modules
const TenderlyFork = await import('./utils/tenderly')
const Reports = await import('./entities/Reports')
```

## Security Model

### Private Key Management

The SDK never handles private keys directly - all signing is delegated to wallet providers:

```typescript
// Wallet integration pattern
centrifuge.setSigner(walletClient) // viem WalletClient
// OR
centrifuge.setSigner(localAccount) // For server-side usage
```

### Input Validation

1. **Address Validation**: Checksum validation for all addresses
2. **Amount Validation**: Decimal precision and overflow checks
3. **Parameter Sanitization**: Clean user inputs
4. **Type Guards**: Runtime type checking

### RPC Security

1. **HTTPS Only**: All RPC connections use TLS
2. **Rate Limiting**: Built-in rate limiting for RPC calls
3. **Timeout Handling**: Prevent hanging requests
4. **Error Sanitization**: Don't expose sensitive error details

### API Security

1. **No API Keys**: Public GraphQL endpoint doesn't require authentication
2. **Query Limits**: Size and complexity limits on GraphQL queries
3. **CORS**: Proper cross-origin handling
4. **Input Sanitization**: All user inputs validated and sanitized

### Smart Contract Interaction

1. **ABI Validation**: Ensure contract interfaces match expectations
2. **Gas Estimation**: Accurate gas estimates before transactions
3. **Slippage Protection**: Built-in protection against MEV attacks
4. **Multisig Support**: Compatible with multisig wallets

### Data Integrity

1. **Cryptographic Verification**: Verify on-chain data integrity
2. **Consensus Checking**: Compare data across multiple RPC endpoints
3. **Hash Verification**: Validate IPFS content hashes
4. **Signature Verification**: Validate signed messages

This architecture enables the Centrifuge SDK to provide a robust, type-safe, and performant interface to the complex multi-chain asset management ecosystem while maintaining security and developer experience as top priorities.