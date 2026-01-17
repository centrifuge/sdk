# Centrifuge SDK Solana Examples

## Available Examples

### Basic Solana Integration

**File**: [solana-example.ts](./solana-example.ts)

Demonstrates basic Solana integration features:

```bash
node --loader ts-node/esm src/solana/examples/solana-example.ts
```

**Features shown**:

- Initializing SDK with Solana configuration
- Querying Solana slot and current block information
- Getting SOL account balances
- Getting USDC token balances
- Getting account information
- Using the observable pattern
- Accessing the underlying Solana connection

### Investment Example

**File**: [invest-example.ts](./invest-example.ts)

Demonstrates investing USDC into Centrifuge pools via Solana with wallet adapter integration.

**Features shown**:

- Wallet adapter integration
- Checking pool Solana support
- Investing USDC with transaction status updates
- Error handling with specific error codes
- Observable and async/await patterns

## Documentation

- [Solana Integration Guide](../docs/SOLANA_INTEGRATION.md) - Complete Solana integration documentation
- [SDK Usage Guide](https://docs.centrifuge.io/developer/centrifuge-sdk/overview/) - Main SDK documentation

## Requirements

- Node.js >= 18.18
- pnpm (for development)

## Running Examples

Run examples with ts-node:

```bash
# Basic Solana integration
node --loader ts-node/esm src/solana/examples/solana-example.ts

# Investment example (requires wallet configuration)
node --loader ts-node/esm src/solana/examples/invest-example.ts
```

## Development

To add a new example:

1. Create a new `.ts` file in this directory
2. Import from `../../index.js`
3. Add documentation here
4. Test it with `node --loader ts-node/esm examples/your-example.ts`
