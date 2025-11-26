# Solana Environment Configuration

## Overview

Solana supports three distinct network environments, which are separate from the EVM environment configuration used by the rest of the Centrifuge SDK.

## Solana Environment Types

- **`mainnet`** - Solana's production network
- **`testnet`** - Solana's test network (less commonly used)
- **`devnet`** - Solana's development network (most commonly used for development)

## Configuration

### Default Behavior (Automatic Mapping)

By default, the Solana environment is automatically derived from the main SDK `environment` configuration:

```typescript
import { Centrifuge } from '@centrifuge/sdk'

// EVM testnet → Solana devnet
const sdk = new Centrifuge({
  environment: 'testnet',
  solana: {
    rpcUrl: 'https://api.devnet.solana.com',
  },
})

// EVM mainnet → Solana mainnet
const sdk = new Centrifuge({
  environment: 'mainnet',
  solana: {
    rpcUrl: 'https://api.mainnet-beta.solana.com',
  },
})
```

### Explicit Environment Override

You can explicitly specify the Solana environment if needed:

```typescript
import { Centrifuge } from '@centrifuge/sdk'

const sdk = new Centrifuge({
  environment: 'testnet', // EVM environment
  solana: {
    rpcUrl: 'https://api.testnet.solana.com',
    environment: 'testnet', // Explicitly use Solana testnet instead of devnet
  },
})
```

### Development Setup

For local development with Solana devnet:

```typescript
import { Centrifuge } from '@centrifuge/sdk'

const sdk = new Centrifuge({
  environment: 'testnet',
  solana: {
    rpcUrl: 'https://api.devnet.solana.com',
    commitment: 'confirmed',
    // environment: 'devnet' is automatically set based on EVM 'testnet'
  },
})
```

## Environment Mapping Table

| EVM Environment | Default Solana Environment | Can Override? |
| --------------- | -------------------------- | ------------- |
| `mainnet`       | `mainnet`                  | Yes           |
| `testnet`       | `devnet`                   | Yes           |

## Pool Address Configuration

Pool addresses are configured per Solana environment in `src/solana/config/poolAddresses.ts`:

```typescript
const POOL_ADDRESS_MAPPING: Record<string, SolanaPoolConfig> = {
  '0x00010000000000060000000000000001': {
    address: 'BdvsupcBZ3odJvWvLKZPGTQwPjpShuWVpmnTq3gfdCbN',
    environment: 'devnet', // This pool is only available on devnet
    poolName: 'AAA_CLO',
  },
}
```

## USDC Mint Addresses

Each Solana environment has its own USDC mint address:

- **Mainnet**: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` (Production USDC)
- **Testnet**: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (Test USDC)
- **Devnet**: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (Same as testnet)

## Important Notes

### Separation of Concerns

**Solana environment configuration is completely separate from EVM environment configuration:**

- EVM contracts use `environment: 'mainnet' | 'testnet'`
- Solana uses `environment: 'mainnet' | 'testnet' | 'devnet'`
- The `devnet` option is **only available for Solana configuration**
- Do NOT use `devnet` in the main SDK `environment` field

### Example: Correct vs Incorrect Usage

**Correct:**

```typescript
const sdk = new Centrifuge({
  environment: 'testnet', // EVM environment (only mainnet/testnet allowed)
  solana: {
    rpcUrl: 'https://api.devnet.solana.com',
    environment: 'devnet', // Solana-specific environment
  },
})
```

**Incorrect:**

```typescript
const sdk = new Centrifuge({
  environment: 'devnet', // TypeScript error: 'devnet' not allowed here
  solana: {
    rpcUrl: 'https://api.devnet.solana.com',
  },
})
```

## Checking Pool Availability

Use the `isAvailable()` method to check if a pool supports Solana investments in the current environment:

```typescript
import { ShareClassId, SolanaInvestment } from '@centrifuge/sdk'

const shareClassId = new ShareClassId('0x1234567890abcdef1234567890abcdef')
const solanaInvest = new SolanaInvestment(sdk, shareClassId)

if (solanaInvest.isAvailable()) {
  // Pool is available for Solana investments
  const investment$ = solanaInvest.invest(amount, wallet)
} else {
  // Pool doesn't have Solana address configured for this environment
  console.log('Solana investments not available for this pool')
}
```

## RPC Endpoints

Common Solana RPC endpoints:

| Environment | Public RPC Endpoint                   | Note                       |
| ----------- | ------------------------------------- | -------------------------- |
| Mainnet     | `https://api.mainnet-beta.solana.com` | Rate-limited, use paid RPC |
| Devnet      | `https://api.devnet.solana.com`       | Free for development       |
| Testnet     | `https://api.testnet.solana.com`      | Less commonly used         |

**Recommended:** Use a dedicated RPC provider like [Alchemy](https://www.alchemy.com/solana)

## Testing

Environment configuration is tested in `src/solana/config/poolAddresses.test.ts`:

```bash
pnpm test:simple:single src/solana/config/poolAddresses.test.ts
```

## See Also

- [Solana Investment Example](./examples/invest-example.ts)
- [Pool Address Configuration](./config/poolAddresses.ts)
- [Solana Documentation](https://docs.solana.com/)
