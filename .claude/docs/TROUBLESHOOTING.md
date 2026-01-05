# Troubleshooting Guide

Comprehensive troubleshooting guide for the Centrifuge SDK.

## Common Errors and Solutions

### Transaction Errors

#### "Insufficient balance"

```typescript
// Check balance AND allowance
const investment = await vault.investment(address)
console.log('Currency balance:', investment.investmentCurrencyBalance.toFloat())
console.log('Allowance:', investment.investmentCurrencyAllowance.toFloat())
console.log('Max invest:', investment.maxInvest.toFloat())

// If balance is sufficient but maxInvest is 0, need approval
// SDK handles this automatically in increaseInvestOrder()
```

#### "User rejected transaction"

```typescript
// Handle gracefully - this is expected behavior
try {
  const result = await vault.increaseInvestOrder(amount)
} catch (error) {
  if (error.message.includes('User rejected') || error.message.includes('User denied')) {
    console.log('Transaction cancelled by user')
    return
  }
  throw error
}
```

#### "ExceedsDepositLimits"

```typescript
// Check maxInvest before placing order
const investment = await vault.investment(address)
const maxInvest = investment.maxInvest.toFloat()

if (amount.toFloat() > maxInvest) {
  console.error(`Maximum invest amount is ${maxInvest}`)
  return
}

await vault.increaseInvestOrder(amount)
```

#### "NotAllowedToInvest" / "NotAllowedToRedeem"

```typescript
// Check investor status
const investment = await vault.investment(address)

if (!investment.isAllowedToInvest) {
  console.error('Investor not whitelisted or membership expired')
  // Pool manager needs to call:
  // await shareClass.updateMember(address, validUntil, centrifugeId)
}
```

### Query Errors

#### "Pool metadata not loading"

```typescript
// 1. Check indexer URL
console.log(centrifuge.config.indexerUrl)

// 2. Verify pool exists
const pools = await centrifuge.pools()
const poolExists = pools.some((p) => p.id.equals(poolId))

// 3. Try direct blockchain queries
const shareClasses = await pool.shareClasses()
```

#### "RPC call failed" / "Network error"

```typescript
// Configure fallback RPC URLs
const centrifuge = new Centrifuge({
  environment: 'mainnet',
  rpcUrls: {
    1: ['https://primary-rpc.com', 'https://fallback-rpc.com'],
  },
})
```

#### "Observable never emits" / "Query hangs"

```typescript
import { firstValueFrom, timeout } from 'rxjs'

// ❌ WRONG: Can hang forever
const result = await vault.investment(address).pipe(skip(1))

// ✅ CORRECT: Add timeout
try {
  const result = await firstValueFrom(vault.investment(address).pipe(skip(1), timeout(30000)))
} catch (error) {
  if (error.name === 'TimeoutError') {
    console.error('Query timed out after 30 seconds')
  }
}
```

### Type Errors

#### "Cannot add balances with different decimals"

```typescript
const usdc = Balance.fromFloat(1000, 6)
const shares = Balance.fromFloat(100, 18)

// ❌ WRONG
const total = usdc.add(shares) // Error!

// ✅ CORRECT: Convert decimals or don't add different tokens
const usdcIn18 = new Balance(usdc.toBigInt() * 10n ** 12n, 18)
const total = usdcIn18.add(shares)
```

#### "Type 'number' is not assignable to type 'Balance'"

```typescript
// ❌ WRONG
await vault.increaseInvestOrder(1000)

// ✅ CORRECT
const { investmentCurrency } = await vault.details()
const amount = Balance.fromFloat(1000, investmentCurrency.decimals)
await vault.increaseInvestOrder(amount)
```

## Debugging Strategies

### Enable Detailed Logging

```typescript
import { tap, catchError } from 'rxjs'

const result = await vault.investment(address).pipe(
  tap((inv) => console.log('Investment data:', inv)),
  catchError((err) => {
    console.error('Query error:', err)
    throw err
  })
)
```

### Inspect Transaction Status

```typescript
vault.increaseInvestOrder(amount).subscribe({
  next: (status) => {
    console.log('Status type:', status.type)
    console.log('Full status:', status)
  },
  error: (err) => {
    console.error('Transaction error:', err)
    console.error('Error stack:', err.stack)
  },
})
```

### Check Contract State Directly

```typescript
import { getContract } from 'viem'
import { ABI } from './abi/index.js'

const client = await centrifuge.getClient(centrifugeId)
const vault = getContract({
  address: vaultAddress,
  abi: ABI.AsyncVault,
  client,
})

// Read contract directly
const maxMint = await vault.read.maxMint([investorAddress])
console.log('Max mint (raw):', maxMint)
```

### Verify Contract Addresses

```typescript
const addresses = await centrifuge._protocolAddresses(centrifugeId)
console.log('Hub:', addresses.hub)
console.log('Gateway:', addresses.gateway)

// Verify bytecode exists
const client = await centrifuge.getClient(centrifugeId)
const bytecode = await client.getBytecode({ address: addresses.hub })
console.log('Hub has bytecode:', bytecode !== undefined)
```

## Performance Issues

### Slow Queries

- Check RPC endpoint latency
- Use indexer for historical data
- Reduce polling interval: `new Centrifuge({ pollingInterval: 1000 })`
- Cache results at application level

### Memory Leaks

```typescript
// ❌ WRONG: Not unsubscribing
const sub = vault.investment(address).subscribe(...)
// Memory leak if component unmounts

// ✅ CORRECT: Always unsubscribe
const sub = vault.investment(address).subscribe(...)
return () => sub.unsubscribe()

// Or use async/await
const result = await vault.investment(address)
```

### High RPC Costs

- Use WebSocket RPC endpoints
- Batch queries when possible
- Use indexer for non-critical data
- Configure longer polling intervals

## Getting Help

1. **Check SDK Version:** `npm list @centrifuge/sdk`
2. **Check Protocol Version:** See `PROTOCOL_VERSION.md` or recent commits
3. **Search Issues:** [github.com/centrifuge/sdk/issues](https://github.com/centrifuge/sdk/issues)
4. **Check Examples:** Review test files in `src/entities/*.test.ts`
5. **Ask Community:** Centrifuge Discord or GitHub Discussions
