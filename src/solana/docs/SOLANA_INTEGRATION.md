# Solana Integration Guide

This document explains how to use the Solana integration in the Centrifuge SDK.

## Overview

The Centrifuge SDK supports both EVM chains and the Solana blockchain. You can use a single `Centrifuge` instance to interact with both ecosystems while maintaining the same observable-based patterns and query caching.

The primary use case is investing USDC into Centrifuge pools via Solana, providing an alternative to EVM-based investments.

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

### Getting SOL Balance

Get the SOL balance of any Solana account in lamports (1 SOL = 1,000,000,000 lamports):

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

### Getting USDC Balance

Get the USDC token balance for a wallet:

```typescript
import { Balance } from '@centrifuge/sdk'

const usdcBalance$ = centrifugeSdk.solana!.usdcBalance('YourSolanaAddressHere')
const balance = await usdcBalance$ // Returns Balance instance with 6 decimals

console.log(`USDC Balance: ${balance.toFloat()} USDC`)
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

### Investing USDC into Pools

Invest USDC into a Centrifuge pool via Solana:

```typescript
import { Balance, ShareClassId } from '@centrifuge/sdk'
import { useWallet } from '@solana/wallet-adapter-react'

// In a React component with wallet adapter
const { publicKey, signTransaction } = useWallet()

// Prepare share class ID
const shareClassId = new ShareClassId('0x1234567890abcdef1234567890abcdef')

// Check if pool supports Solana investments
if (!centrifugeSdk.solana!.isSolanaPool(shareClassId)) {
  console.log('Pool does not support Solana investments')
  return
}

// Prepare investment amount (USDC has 6 decimals)
const amount = Balance.fromFloat(100, 6) // 100 USDC

// Invest with wallet adapter
const invest$ = centrifugeSdk.solana!.invest(amount, shareClassId, {
  publicKey,
  signTransaction,
})

// Subscribe to transaction status updates
invest$.subscribe({
  next: (status) => {
    if (status.type === 'preparing') console.log('Preparing transaction...')
    if (status.type === 'signing') console.log('Waiting for signature...')
    if (status.type === 'sending') console.log('Sending transaction...')
    if (status.type === 'confirming') console.log('Confirming...', status.signature)
    if (status.type === 'confirmed') console.log('Success!', status.signature)
  },
  error: (error) => {
    console.error('Investment failed:', error.message)
  },
})

// Or await completion
try {
  await invest$
  console.log('Investment completed successfully')
} catch (error) {
  console.error('Investment failed:', error)
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
│   ├── SolanaClient.ts         # Connection wrapper
│   ├── SolanaManager.ts        # Main Solana API
│   ├── config/                 # Pool addresses and configuration
│   ├── types/                  # TypeScript types
│   ├── examples/               # Code examples
│   └── docs/                   # Documentation
```

### Key Components

- **SolanaClient**: Low-level connection management
- **SolanaManager**: High-level API for all Solana operations, accessible via `centrifugeSdk.solana`

### Observable Pattern

All Solana methods return RxJS Observables that:

- Can be awaited for a single value
- Can be subscribed to for status updates
- Are cached using the same mechanism as EVM queries
- Follow the same patterns as EVM operations

## Transaction Status Updates

When investing via Solana, the transaction goes through multiple phases:

1. **preparing** - Building and validating the transaction
2. **signing** - Waiting for user to approve in wallet
3. **sending** - Submitting to Solana network
4. **confirming** - Waiting for network confirmation
5. **confirmed** - Transaction successfully completed

Each phase emits a status update via the Observable, allowing you to show progress to users.

## Error Handling

The SDK provides specific error codes for common failure scenarios:

```typescript
import { SolanaTransactionError, SolanaErrorCode } from '@centrifuge/sdk'

try {
  await centrifugeSdk.solana!.invest(amount, shareClassId, wallet)
} catch (error) {
  if (error instanceof SolanaTransactionError) {
    switch (error.code) {
      case SolanaErrorCode.WALLET_NOT_CONNECTED:
        console.error('Please connect your wallet')
        break
      case SolanaErrorCode.INSUFFICIENT_BALANCE:
        console.error('Insufficient USDC balance')
        break
      case SolanaErrorCode.SIGNATURE_REJECTED:
        console.error('Transaction was rejected')
        break
      case SolanaErrorCode.POOL_NOT_CONFIGURED:
        console.error('Pool does not support Solana')
        break
      default:
        console.error('Transaction failed:', error.message)
    }
  }
}
```

## Testing

Run the Solana integration tests:

```bash
# Basic integration tests
pnpm test:simple:single src/solana/solana.test.ts

# Investment tests
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
import {
  Centrifuge,
  SolanaConfig,
  SolanaManager,
  SolanaClient,
  SolanaTransactionError,
  SolanaErrorCode,
  SolanaTransactionStatus,
  SolanaWalletAdapter,
} from '@centrifuge/sdk'

// Also import Solana web3.js types
import { PublicKey, Connection, Transaction } from '@solana/web3.js'
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

### Investment Fails with "Insufficient Balance"

Ensure the wallet has:

1. Enough USDC for the investment amount
2. Enough SOL for transaction fees (usually ~0.000005 SOL)
3. A USDC token account (created automatically on first USDC receipt)

### Rate Limiting

Public RPC endpoints have rate limits. For production applications:

1. Use a dedicated RPC provider
2. Implement request throttling
3. Cache responses when possible

## Wallet Adapter Support

The SDK is designed to work with the Solana wallet adapter ecosystem:

- [@solana/wallet-adapter-react](https://github.com/solana-labs/wallet-adapter)
- [@solana/wallet-adapter-wallets](https://github.com/solana-labs/wallet-adapter)

Supported wallets include Phantom, Solflare, Backpack, and many others.

## Contributing

To add new Solana functionality:

1. Add methods to `SolanaManager.ts`
2. Add tests in `src/solana/*.test.ts`
3. Update this documentation

## Related Documentation

- [SDK Usage Guide](https://docs.centrifuge.io/developer/centrifuge-sdk/overview/)
- [Solana Investment Example](../examples/invest-example.ts)
- [@solana/web3.js Docs](https://solana-foundation.github.io/solana-web3.js/)
- [Solana Developer Docs](https://docs.solana.com/)
- [Wallet Adapter Docs](https://github.com/solana-labs/wallet-adapter)
