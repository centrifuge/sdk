# Solana Investment Feature

This document explains how to use the Solana investment functionality in the Centrifuge SDK.

## Overview

The Solana investment feature allows investors to invest USDC directly into Centrifuge pools using their Solana wallet. This provides an alternative to EVM-based investments, enabling users to invest via the Solana blockchain.

## Key Features

- **USDC Investments**: Transfer USDC from your Solana wallet to pool addresses
- **Wallet Adapter Support**: Compatible with @solana/wallet-adapter-react
- **Type-Safe**: Full TypeScript support with proper error handling
- **Observable Pattern**: Subscribe to transaction status updates
- **Internal Mapping**: Pool addresses are managed internally by the SDK
- **Comprehensive Validation**: Checks wallet connection, balance, decimals, and pool configuration

## Architecture

### Components

1. **SolanaManager** ([../SolanaManager.ts](../SolanaManager.ts))

   - Main class for all Solana operations
   - Contains the `invest()` and `isSolanaPool()` methods
   - Manages connection to Solana RPC
   - Accessible via `sdk.solana`

2. **Pool Address Mapping** ([../config/poolAddresses.ts](../config/poolAddresses.ts))

   - Internal configuration mapping ShareClass IDs to Solana addresses
   - Environment-specific (mainnet/devnet)
   - Cannot be overridden by SDK users

3. **Wallet Types** ([../types/wallet.ts](../types/wallet.ts))
   - `SolanaWalletAdapter`: Minimal interface for wallet compatibility
   - `SolanaTransactionStatus`: Transaction status types
   - `SolanaTransactionError`: Custom error types with error codes

## Usage

### 1. Initialize SDK with Solana Support

```typescript
import { Centrifuge } from '@centrifuge/sdk'

const sdk = new Centrifuge({
  environment: 'mainnet',
  solana: {
    rpcUrl: 'https://api.mainnet-beta.solana.com',
    commitment: 'confirmed',
  },
})
```

### 2. Basic Investment Flow

```typescript
import { Balance, ShareClassId } from '@centrifuge/sdk'

// Prepare share class ID
const shareClassId = new ShareClassId('0x1234567890abcdef1234567890abcdef')

// Check if available
if (!sdk.solana!.isSolanaPool(shareClassId)) {
  console.log('This pool does not support Solana investments')
  return
}

// Prepare amount (USDC has 6 decimals)
const amount = Balance.fromFloat(1000, 6)

// Create wallet adapter from connected wallet
const wallet = { publicKey, signTransaction }

// Invest
await sdk.solana!.invest(amount, shareClassId, wallet)
```

### 3. React Integration with Wallet Adapter

```tsx
import { useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { Centrifuge, Balance, ShareClassId } from '@centrifuge/sdk'

function InvestComponent() {
  const { publicKey, signTransaction } = useWallet()
  const [status, setStatus] = useState('')

  const handleInvest = async () => {
    if (!publicKey || !signTransaction) {
      alert('Please connect wallet')
      return
    }

    const shareClassId = new ShareClassId('0x1234567890abcdef1234567890abcdef')
    const amount = Balance.fromFloat(1000, 6)
    const wallet = { publicKey, signTransaction }

    sdk.solana!.invest(amount, shareClassId, wallet).subscribe({
      next: (status) => {
        setStatus(status.message)
        if (status.type === 'confirmed') {
          console.log('Transaction:', status.signature)
        }
      },
      error: (error) => {
        console.error('Failed:', error)
        setStatus(`Error: ${error.message}`)
      },
    })
  }

  return (
    <div>
      <WalletMultiButton />
      <button onClick={handleInvest} disabled={!publicKey}>
        Invest 1000 USDC
      </button>
      <p>{status}</p>
    </div>
  )
}
```

### 4. Subscribe to Transaction Status

```typescript
solanaInvest.invest(amount, wallet).subscribe({
  next: (status) => {
    switch (status.type) {
      case 'preparing':
        console.log('Preparing transaction...')
        break
      case 'signing':
        console.log('Please sign in wallet')
        break
      case 'sending':
        console.log('Sending to blockchain...')
        break
      case 'confirming':
        console.log('Waiting for confirmation...', status.signature)
        break
      case 'confirmed':
        console.log('Success!', status.signature)
        // Update UI, refresh balances, etc.
        break
    }
  },
  error: (error) => {
    if (error.code === SolanaErrorCode.WALLET_NOT_CONNECTED) {
      // Handle wallet not connected
    } else if (error.code === SolanaErrorCode.INSUFFICIENT_BALANCE) {
      // Handle insufficient balance
    }
    console.error(error.message)
  },
})
```

## Configuration

### Adding Pool Addresses

Pool addresses are configured internally in [config/poolAddresses.ts](./config/poolAddresses.ts):

```typescript
const POOL_ADDRESS_MAPPING: Record<string, SolanaPoolConfig> = {
  '0x1234567890abcdef1234567890abcdef12345678': {
    address: 'PoolAddr1111111111111111111111111111111111',
    environment: 'mainnet',
    poolName: 'Example Pool',
    poolId: 123456789000000,
  },
}
```

**Important**: Only SDK maintainers can modify this configuration. Pool addresses cannot be overridden by SDK users.

### Environment-Specific Configuration

The SDK automatically maps environments:

- **EVM testnet** → **Solana devnet** (uses devnet USDC mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`)
- **EVM mainnet** → **Solana mainnet** (uses mainnet USDC mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`)

You can override the Solana environment explicitly if needed:

```typescript
const sdk = new Centrifuge({
  environment: 'testnet', // EVM environment
  solana: {
    rpcUrl: 'https://api.devnet.solana.com',
    environment: 'devnet', // Explicitly set Solana environment
  },
})
```

## Error Handling

The SDK provides comprehensive error handling with specific error codes:

```typescript
import { SolanaErrorCode, SolanaTransactionError } from '@centrifuge/sdk'

try {
  await solanaInvest.invest(amount, wallet)
} catch (error) {
  if (error instanceof SolanaTransactionError) {
    switch (error.code) {
      case SolanaErrorCode.WALLET_NOT_CONNECTED:
        // Wallet not connected
        break
      case SolanaErrorCode.INVALID_AMOUNT:
        // Invalid amount (zero or negative)
        break
      case SolanaErrorCode.INVALID_DECIMALS:
        // Wrong decimals (must be 6 for USDC)
        break
      case SolanaErrorCode.POOL_NOT_CONFIGURED:
        // Pool doesn't support Solana
        break
      case SolanaErrorCode.INSUFFICIENT_BALANCE:
        // Not enough USDC
        break
      case SolanaErrorCode.SIGNATURE_REJECTED:
        // User rejected in wallet
        break
      case SolanaErrorCode.TRANSACTION_FAILED:
        // Transaction failed on-chain
        break
      case SolanaErrorCode.NETWORK_ERROR:
        // Network/RPC error
        break
    }
  }
}
```

## API Reference

### `SolanaManager.invest()`

```typescript
invest(
  amount: Balance,
  shareClassId: ShareClassId,
  wallet: SolanaWalletAdapter
): Observable<SolanaTransactionStatus>
```

**Parameters:**

- `amount`: USDC amount with 6 decimals
- `shareClassId`: The share class ID to invest in
- `wallet`: Connected Solana wallet adapter

**Returns:** Observable that emits transaction status updates

**Throws:** `SolanaTransactionError` on validation or execution failure

### `SolanaManager.isSolanaPool()`

```typescript
isSolanaPool(shareClassId: ShareClassId): boolean
```

**Parameters:**

- `shareClassId`: The share class ID to check

**Returns:** `true` if the pool has a Solana address configured for the current environment

Check if a pool/share class supports Solana investments.

## Testing

Tests are located in [solana.test.ts](../solana.test.ts).

Run tests:

```bash
pnpm test:simple:single src/solana/solana.test.ts
```

The tests cover:

- Validation (wallet connection, amount, decimals, pool config)
- Transaction flow and status updates
- Error handling
- Balance class integration
- Observable pattern

## Integration with Frontend App

### In apps-invest-v3

1. **Install wallet adapter packages:**

```bash
npm install @solana/wallet-adapter-react @solana/wallet-adapter-wallets @solana/wallet-adapter-react-ui
```

2. **Set up wallet provider:**

```tsx
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base'
import { WalletProvider } from '@solana/wallet-adapter-react'
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets'

const wallets = [new PhantomWalletAdapter(), new SolflareWalletAdapter()]

function App() {
  return (
    <WalletProvider wallets={wallets} autoConnect>
      {/* Your app */}
    </WalletProvider>
  )
}
```

3. **Use in invest component:**

```tsx
import { useWallet } from '@solana/wallet-adapter-react'
import { ShareClassId, Balance } from '@centrifuge/sdk'

function InvestButton({ shareClassId, amount }) {
  const { publicKey, signTransaction, connected } = useWallet()
  const [investing, setInvesting] = useState(false)

  const handleSolanaInvest = async () => {
    if (!connected || !publicKey || !signTransaction) return

    setInvesting(true)

    const id = new ShareClassId(shareClassId)
    const usdcAmount = Balance.fromFloat(amount, 6)
    const wallet = { publicKey, signTransaction }

    try {
      await sdk.solana!.invest(usdcAmount, id, wallet)
      toast.success('Investment successful!')
    } catch (error) {
      toast.error(`Investment failed: ${error.message}`)
    } finally {
      setInvesting(false)
    }
  }

  return (
    <button onClick={handleSolanaInvest} disabled={!connected || investing}>
      {investing ? 'Investing...' : 'Invest via Solana'}
    </button>
  )
}
```

## Comparison with EVM Investment

| Feature              | EVM (`increaseInvestOrder`)               | Solana (`invest`)                        |
| -------------------- | ----------------------------------------- | ---------------------------------------- |
| **Network**          | Ethereum, Base, Arbitrum, etc.            | Solana                                   |
| **Currency**         | Various (USDC, USDT, DAI, etc.)           | USDC only                                |
| **Wallet**           | MetaMask, WalletConnect, etc.             | Phantom, Solflare, etc.                  |
| **Signer**           | Set via `sdk.setSigner()`                 | Pass wallet to `invest()`                |
| **Approval**         | Needs ERC20 approval or permit            | SPL Token transfer (no approval)         |
| **Transaction Type** | Async request (order-based)               | Direct transfer                          |
| **Status Updates**   | Observable with signing/pending/confirmed | Observable with 5 stages                 |
| **Entity Access**    | `vault.increaseInvestOrder()`             | `sdk.solana!.invest(amount, id, wallet)` |

## Troubleshooting

### "Wallet not connected" error

Make sure the wallet is connected before calling `invest()`. Check `wallet.publicKey` is not null.

### "Pool not configured" error

This pool doesn't have a Solana address configured yet. Contact the SDK maintainers to add the pool to the mapping.

### "Invalid decimals" error

USDC must have 6 decimals. Use: `Balance.fromFloat(amount, 6)`

### "Insufficient balance" error

The wallet doesn't have enough USDC. Check the balance before investing.

### Transaction fails without clear error

Check the Solana RPC endpoint is working and accessible. Try using a different RPC provider.

## Security Considerations

1. **Address Verification**: Pool addresses are hardcoded internally and cannot be modified by users
2. **Balance Checks**: SDK verifies USDC balance before attempting transfer
3. **Wallet Signing**: All transactions must be signed by the user's wallet
4. **Amount Validation**: Validates amount is positive and has correct decimals
5. **Error Handling**: All errors are wrapped in `SolanaTransactionError` with codes

## Future Enhancements

Potential future features:

- Support for other SPL tokens beyond USDC
- Batch investments across multiple pools
- Redeem functionality via Solana
- Historical transaction queries
- Gas estimation
- Transaction simulation before signing

## Support

For questions or issues:

- Check the [SDK documentation](https://github.com/centrifuge/sdk)
- Review the [examples](../examples/)
