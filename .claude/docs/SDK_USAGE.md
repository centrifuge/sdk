# SDK Usage Guide

This guide covers how to use the Centrifuge SDK in your application. For development on the SDK itself, see [CLAUDE.md](../CLAUDE.md).

## Quick Start Example

```typescript
import Centrifuge, { PoolId } from '@centrifuge/sdk'

// Initialize SDK
const centrifuge = new Centrifuge({ environment: 'mainnet' })

// Get a pool and query its details
const poolId = PoolId.from(1, 1) // centrifugeId: 1, poolId: 1
const pool = await centrifuge.pool(poolId)
const details = await pool.details()

console.log(details.metadata.pool.name)
console.log(details.shareClasses.length)
```

## Configuration

### Basic Initialization

```typescript
const centrifuge = new Centrifuge({
  environment: 'mainnet' | 'testnet', // Default: 'mainnet'
  rpcUrls: {
    1: 'https://your-ethereum-rpc.com',
    8453: 'https://your-base-rpc.com',
  },
  indexerUrl: 'https://custom-indexer-api.com',
  ipfsUrl: 'https://your-ipfs-gateway.com',
  pollingInterval: 500,
})
```

### Signer Setup

```typescript
// MetaMask or EIP-1193 provider
if (window.ethereum) {
  centrifuge.setSigner(window.ethereum)
}

// Viem LocalAccount (backend/scripts)
import { privateKeyToAccount } from 'viem/accounts'
const account = privateKeyToAccount('0x...')
centrifuge.setSigner(account)
```

## Entity Reference

### Pool - Pool management and configuration

```typescript
const pool = await centrifuge.pool(poolId)
await pool.details()
await pool.activeNetworks()
await pool.shareClasses()
await pool.vault(centrifugeId, scId, assetId)
await pool.isPoolManager(address)
await pool.updatePoolManagers([...])
await pool.updateBalanceSheetManagers([...])
```

### Vault - ERC-7540 tokenized vault operations

```typescript
const vault = await pool.vault(centrifugeId, shareClassId, assetId)
await vault.details()
await vault.investment(investorAddress)
await vault.increaseInvestOrder(amount)
await vault.increaseRedeemOrder(amount)
await vault.claim()
await vault.cancelInvestOrder()
await vault.cancelRedeemOrder()
```

### ShareClass - Share class management

```typescript
const sc = new ShareClass(centrifuge, pool, shareClassId)
await sc.details()
await sc.pendingAmounts()
await sc.updateMember(address, validUntil, centrifugeId)
await sc.freeze(address, centrifugeId)
await sc.unfreeze(address, centrifugeId)
await sc.approveDepositsAndIssueShares([...])
await sc.approveRedeemsAndRevokeShares([...])
```

### Investor - Cross-pool queries

```typescript
const investor = await centrifuge.investor(address)
await investor.investments()
```

## Common Workflows

### Check Investor Position Across All Pools

```typescript
const investor = await centrifuge.investor('0x...')
const investments = await investor.investments()

investments.forEach((inv) => {
  console.log(`Pool ${inv.poolId}: ${inv.shareBalance.toFloat()} shares`)
})
```

### Place Invest Order and Wait for Execution

```typescript
const vault = await pool.vault(centrifugeId, shareClassId, assetId)
const investment = await vault.investment(investorAddress)

console.log(`Allowed to invest: ${investment.isAllowedToInvest}`)
console.log(`Max invest: ${investment.maxInvest.toFloat()}`)

// Place order
const tx$ = vault.increaseInvestOrder(Balance.fromFloat(1000, 6))

// Await completion
const result = await tx$
console.log(`Transaction hash: ${result.hash}`)

// Or subscribe for updates
tx$.subscribe({
  next: (status) => {
    if (status.type === 'signing') console.log('Please sign...')
    if (status.type === 'pending') console.log('Submitted:', status.hash)
    if (status.type === 'confirmed') console.log('Confirmed!')
  },
  error: (err) => console.error('Failed:', err),
})

// Check claimable and claim
const updatedInvestment = await vault.investment(investorAddress)
if (updatedInvestment.claimableInvestShares.gt(0n)) {
  await vault.claim()
}
```

### Query Pool NAV and Share Prices

```typescript
const details = await pool.details()

details.shareClasses.forEach((sc) => {
  console.log(`${sc.details.name}:`)
  console.log(`  Supply: ${sc.supply.toFloat()}`)
  console.log(`  NAV: ${sc.nav?.toFloat() || 'N/A'}`)
  console.log(`  Price: ${sc.price?.toFloat() || 'N/A'}`)
})
```

### Multi-Chain Vault Operations

```typescript
const baseVault = await pool.vault(8453, shareClassId, assetId)
const arbVault = await pool.vault(42161, shareClassId, assetId)

const baseInv = await baseVault.investment(address)
const arbInv = await arbVault.investment(address)

console.log(`Base: ${baseInv.shareBalance.toFloat()}`)
console.log(`Arbitrum: ${arbInv.shareBalance.toFloat()}`)
```

## Type System

### Identity Types

```typescript
import { PoolId, ShareClassId, AssetId } from '@centrifuge/sdk'

// PoolId
const poolId = PoolId.from(1, 1)
const poolId = new PoolId('0x0001000000000001')

// ShareClassId
const scId = ShareClassId.from(poolId, 1)
const poolId = scId.toPoolId()

// AssetId
const assetId = AssetId.from(1, 1)
```

### Numeric Types

```typescript
import { Balance, Price, Rate } from '@centrifuge/sdk'

// Balance - Token amounts
const amount = Balance.fromFloat(1000.5, 6) // USDC (6 decimals)
const shares = Balance.fromFloat(100, 18) // shares (18 decimals)
const amount = new Balance(1000500000n, 6) // from bigint

amount.toFloat() // 1000.5
amount.toBigInt() // 1000500000n
amount.mul(2) // arithmetic
amount.add(other) // requires same decimals
amount.gt(other) // comparison

// Price - Price per share (18 decimals)
const price = Price.fromFloat(1.05)

// Rate - Interest rates (18 decimals)
const rate = Rate.fromFloat(5.0) // 5% APY
```

### Common Pitfalls

**Mixing decimal precision:**

```typescript
// ❌ WRONG
const usdc = Balance.fromFloat(1000, 6)
const eth = Balance.fromFloat(1, 18)
const total = usdc.add(eth) // Error: decimals don't match

// ✅ CORRECT
const usdcIn18 = new Balance(usdc.toBigInt() * 10n ** 12n, 18)
const total = usdcIn18.add(eth)
```

**Using wrong types:**

```typescript
// ❌ WRONG
await vault.increaseInvestOrder(1000)

// ✅ CORRECT
const { investmentCurrency } = await vault.details()
const amount = Balance.fromFloat(1000, investmentCurrency.decimals)
await vault.increaseInvestOrder(amount)
```

## Observable Pattern

```typescript
// Queries return Observables
const details$ = vault.details()

// Await for single value
const details = await details$

// Subscribe for updates
const subscription = details$.subscribe(
  (data) => console.log('Updated:', data),
  (error) => console.error(error)
)
// Later: subscription.unsubscribe()
```

## Indexer Integration

The SDK uses a GraphQL indexer API for aggregated data:

- **Mainnet:** `https://api.centrifuge.io`
- **Testnet:** `https://api-v3-hitz.marble.live/graphql`

| Data Type           | Source     | Reason                  |
| ------------------- | ---------- | ----------------------- |
| Pool metadata       | Indexer    | IPFS, indexed for speed |
| Share class details | Blockchain | Current state           |
| Investor balances   | Blockchain | Real-time accuracy      |
| Historical reports  | Indexer    | Aggregated data         |
| Pending orders      | Blockchain | Current state           |

For detailed troubleshooting, see [TROUBLESHOOTING.md](./TROUBLESHOOTING.md).
