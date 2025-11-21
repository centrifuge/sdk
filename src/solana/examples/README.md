# Centrifuge SDK Solana Examples

## Available Examples

### Solana Integration Example

**File**: [solana-example.ts](./solana-example.ts)

Demonstrates how to use the Solana integration alongside EVM functionality:

```bash
node --loader ts-node/esm src/solana/examples/solana-example.ts
```

**Features shown**:

- Initializing SDK with Solana configuration
- Querying Solana slot and account balances
- Getting account information
- Using the observable pattern
- Accessing the underlying Solana connection

## Documentation

- [Solana Integration Guide](../docs/SOLANA_INTEGRATION.md) - Complete Solana integration documentation
- [SDK Usage Guide](https://docs.centrifuge.io/developer/centrifuge-sdk/overview/) - Main SDK documentation

## Requirements

- Node.js >= 18.18
- pnpm (for development)

## Development

To add a new example:

1. Create a new `.ts` file in this directory
2. Import from `../src/index.js`
3. Add documentation here
4. Test it with `node --loader ts-node/esm examples/your-example.ts`
