# Solana Integration Guide

This document explains how to use the Solana integration in the Centrifuge SDK.

## Overview

The Centrifuge SDK now supports both EVM chains and the Solana blockchain. You can use a single `Centrifuge` instance to interact with both ecosystems while maintaining the same observable-based patterns and query caching.

## Setup

### Installation

The Solana dependencies are included automatically when you install the SDK:

```bash
npm install @centrifuge/sdk
# or
pnpm add @centrifuge/sdk
```

### Configuration

Initialize the SDK with Solana configuration:

```typescript
import { Centrifuge } from '@centrifuge/sdk'

const centrifugeSdk = new Centrifuge({
  environment: 'mainnet', // or 'testnet'

  // EVM configuration (existing)
  rpcUrls: {
    1: 'https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY',
    // ... other EVM chains
  },

  // Solana configuration (new)
  solana: {
    rpcUrl: 'https://api.mainnet-beta.solana.com',
    commitment: 'confirmed', // optional: 'processed' | 'confirmed' | 'finalized'
    wsEndpoint: 'wss://api.mainnet-beta.solana.com', // optional
  },
})
```

For testnet/devnet:

```typescript
const centrifugeSdk = new Centrifuge({
  environment: 'testnet',
  solana: {
    rpcUrl: 'https://api.devnet.solana.com',
    commitment: 'confirmed',
  },
})
```

## Usage

### Accessing Solana Functionality

All Solana functionality is accessed through the `solana` property:

```typescript
// Check if Solana is configured
if (centrifugeSdk.solana) {
  // Solana is available
  const balance = await centrifugeSdk.solana.balance('...')
} else {
  // Solana was not configured
  console.log('Solana not available')
}
```

### Getting Account Balance

Get the balance of any Solana account in lamports (1 SOL = 1,000,000,000 lamports):

```typescript
import { PublicKey } from '@solana/web3.js'

// Using string address
const balance$ = centrifugeSdk.solana!.balance('YourSolanaAddressHere')
const balance = await balance$
console.log(`Balance: ${balance / 1_000_000_000} SOL`)

// Or using PublicKey
const pubkey = new PublicKey('YourSolanaAddressHere')
const balance$ = centrifugeSdk.solana!.balance(pubkey)
const balance = await balance$
```

### Getting Account Info

Retrieve detailed account information:

```typescript
const accountInfo$ = centrifugeSdk.solana!.accountInfo('YourSolanaAddressHere')
const info = await accountInfo$

if (info) {
  console.log('Owner:', info.owner.toBase58())
  console.log('Lamports:', info.lamports)
  console.log('Executable:', info.executable)
  console.log('Data length:', info.data.length)
}
```

### Transferring SOL

Transfer SOL from one account to another:

```typescript
import { Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js'

// Set up signer (keypair)
const keypair = Keypair.fromSecretKey(yourSecretKey)
centrifugeSdk.solana!.setSigner(keypair)

// Transfer 0.5 SOL
const transfer$ = centrifugeSdk.solana!.transferSol('RecipientAddressHere', 0.5 * LAMPORTS_PER_SOL)

// Option 1: Subscribe to status updates
transfer$.subscribe({
  next: (status) => {
    if (status.status === 'signing') {
      console.log('Signing transaction...')
    } else if (status.status === 'sending') {
      console.log('Sending transaction...')
    } else if (status.status === 'confirmed') {
      console.log('Transaction confirmed!', status.signature)
    }
  },
  error: (error) => {
    console.error('Transaction failed:', error)
  },
})

// Option 2: Await completion
try {
  const result = await transfer$
  console.log('Transaction signature:', result.signature)
} catch (error) {
  console.error('Transaction failed:', error)
}
```

### Watching Account Changes

Subscribe to real-time updates for account changes:

```typescript
const accountUpdates$ = centrifugeSdk.solana!.watchAccount('YourSolanaAddressHere')

const subscription = accountUpdates$.subscribe({
  next: (accountInfo) => {
    console.log('Account updated:', accountInfo)
  },
  error: (error) => {
    console.error('Error watching account:', error)
  },
})

// Don't forget to unsubscribe when done
// subscription.unsubscribe()
```

### Getting Current Slot

Query the current Solana slot:

```typescript
const slot$ = centrifugeSdk.solana!.getSlot()
const currentSlot = await slot$
console.log('Current slot:', currentSlot)
```

### Direct Connection Access

Access the underlying Solana `Connection` for advanced operations:

```typescript
const connection = centrifugeSdk.solana!.connection

// Use any @solana/web3.js methods
const recentBlockhash = await connection.getLatestBlockhash()
const slot = await connection.getSlot()
```

## Architecture

### Directory Structure

```
src/
├── solana/
│   ├── SolanaClient.ts         # Manages Solana connection
│   ├── SolanaManager.ts        # Main Solana interface
│   ├── SolanaEntity.ts         # Base class for Solana entities
│   ├── entities/               # Solana-specific entities (future)
│   ├── idl/                    # Anchor IDL files (future)
│   └── utils/                  # Solana utilities (future)
```

### Key Components

- **SolanaClient**: Low-level connection management, similar to viem clients for EVM
- **SolanaManager**: High-level API for Solana operations, accessible via `centrifugeSdk.solana`
- **SolanaEntity**: Base class for future Solana entities (similar to EVM `Entity`)

### Observable Pattern

All Solana queries return RxJS Observables that:

- Can be awaited for a single value
- Can be subscribed to for updates
- Are cached using the same mechanism as EVM queries
- Support the same patterns as EVM operations

## Use Cases

### Unified Multi-Chain Application

```typescript
const centrifugeSdk = new Centrifuge({
  environment: 'mainnet',
  rpcUrls: {
    1: 'https://eth-mainnet...',
    8453: 'https://base-mainnet...',
  },
  solana: {
    rpcUrl: 'https://api.mainnet-beta.solana.com',
  },
})

// Query EVM pool
const pool = await centrifugeSdk.pool(poolId)
const poolDetails = await pool.details()

// Query Solana account
const solBalance = await centrifugeSdk.solana!.balance('...')

// Use both in your application
console.log('EVM Pool:', poolDetails.name)
console.log('Solana Balance:', solBalance)
```

### Cross-Chain Asset Tracking

```typescript
// Track balances on both chains
const evmBalance = await centrifugeSdk.balance(
  '0xTokenAddress',
  '0xUserAddress',
  1 // Ethereum
)

const solBalance = await centrifugeSdk.solana!.balance('SolanaUserAddress')

const totalValue = calculateTotalValue(evmBalance, solBalance)
```

## Future Enhancements

The following features are planned for future releases:

1. **Solana Program Integration**

   - Support for Anchor programs via IDL
   - Type-safe program interactions
   - Similar pattern to EVM contract ABIs

2. **Solana Entities**

   - `SolanaPool`, `SolanaVault`, etc.
   - Follow same entity pattern as EVM side
   - Shared caching and observable patterns

3. **SPL Token Support**

   - Query SPL token balances
   - Transfer SPL tokens
   - Token metadata queries

4. **Transaction Building**
   - Advanced transaction construction
   - Multi-signature support
   - Transaction batching

## Testing

Run the Solana integration tests:

```bash
pnpm test:simple:single src/solana/solana.test.ts
```

## Network Endpoints

### Mainnet

- RPC: `https://api.mainnet-beta.solana.com`
- WebSocket: `wss://api.mainnet-beta.solana.com`

### Devnet

- RPC: `https://api.devnet.solana.com`
- WebSocket: `wss://api.devnet.solana.com`

### Testnet

- RPC: `https://api.testnet.solana.com`
- WebSocket: `wss://api.testnet.solana.com`

**Note**: Public endpoints may have rate limits. Consider using services like:

- [Helius](https://helius.dev/)
- [QuickNode](https://www.quicknode.com/)
- [Alchemy](https://www.alchemy.com/)
- [GenesysGo](https://www.genesysgo.com/)

## TypeScript Types

All Solana types are exported from the main package:

```typescript
import { Centrifuge, SolanaConfig, SolanaManager, SolanaClient, SolanaEntity } from '@centrifuge/sdk'

// Also export Solana web3.js types
import { PublicKey, Keypair, Connection, Transaction } from '@solana/web3.js'
```

## Troubleshooting

### "Solana is null"

Make sure you've configured Solana in the constructor:

```typescript
const centrifugeSdk = new Centrifuge({
  solana: {
    rpcUrl: 'https://api.devnet.solana.com',
  },
})
```

### Transaction Fails with "Insufficient Funds"

Ensure the signing account has enough SOL for:

1. The transfer amount
2. Transaction fees (usually ~0.000005 SOL)

### Rate Limiting

Public RPC endpoints have rate limits. For production applications:

1. Use a dedicated RPC provider
2. Implement request throttling
3. Cache responses when possible

## Contributing

To add new Solana functionality:

1. Add methods to [SolanaManager.ts](../src/solana/SolanaManager.ts)
2. Create entities in `src/solana/entities/` if needed
3. Add tests in `src/solana/*.test.ts`
4. Update this documentation

## Related Documentation

- [SDK Usage Guide](https://docs.centrifuge.io/developer/centrifuge-sdk/overview/) - Main SDK documentation
- [@solana/web3.js Docs](https://solana-foundation.github.io/solana-web3.js/)
- [Solana Developer Docs](https://docs.solana.com/)
