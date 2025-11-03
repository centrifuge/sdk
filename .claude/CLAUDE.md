# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Repository Overview

This is the **Centrifuge SDK** - a TypeScript middleware layer providing a JavaScript/TypeScript interface to the [Centrifuge Protocol](https://github.com/centrifuge/protocol) smart contracts.

**Purpose:**
1. Expose EVM contract ABIs to JS/TS projects
2. Provide typed, developer-friendly API for protocol contracts
3. Handle blockchain interactions via Viem
4. Manage observable-based queries and transaction flows

**Bridge Between:**
- **Backend**: Solidity contracts in [protocol repository](https://github.com/centrifuge/protocol) (Foundry)
- **Frontend**: JS/TS apps like [apps-v3](https://github.com/centrifuge/apps-v3)

**For SDK usage examples**, see [docs/SDK_USAGE.md](docs/SDK_USAGE.md).

## Development Commands

### Package Manager
This project uses **pnpm** (version 10.10.0). All commands use `pnpm`.

### Build and Development
- `pnpm build` - Compile TypeScript to `dist/`
- `pnpm dev` - Watch mode compilation
- `pnpm prepare` - Auto-build (package manager hooks)

### Testing
- `pnpm test` - Run all tests with Tenderly
- `pnpm test:single <path>` - Run single test with Tenderly
- `pnpm test:simple:single <path>` - Run single test without Tenderly (faster)

**Test Setup:**
- Copy `src/tests/env.example` to `.env`
- Add Tenderly credentials: `TENDERLY_ACCESS_KEY`, `PROJECT_SLUG`, `ACCOUNT_SLUG`
- Set `DEBUG=true` to keep Tenderly RPC alive after tests
- Set `LOCAL=true` to use local Anvil forks

**What Tests Validate:**
- ABI correctness (indirectly via contract calls)
- Transaction flows (invest/redeem, pool management)
- State changes and error conditions
- Multi-chain operations

### Code Quality
- `pnpm format` - Format with Prettier
- ESLint config in `eslint.config.js`

### Documentation
- `pnpm gen:docs` - Generate TypeDoc in `docs/`

## Architecture Overview

### Core Design Patterns

**Observable-based Queries**: All data fetching returns RxJS Observables (can be awaited or subscribed).

**Entity Pattern**: Domain objects (Pool, Vault, ShareClass) inherit from `Entity` base class.

**Transaction System**: Uses generator functions with `_transact()` for multi-step operations with status updates.

**Multi-Chain Support**: Handles multiple EVM chains with different RPC endpoints.

### Directory Structure

```
src/
├── Centrifuge.ts          # Main SDK entry point
├── index.ts               # Public API exports
├── abi/                   # Smart contract ABIs (human-readable)
│   ├── index.ts           # ABI aggregation via viem
│   └── *.abi.ts           # One file per contract
├── entities/              # Domain objects
│   ├── Entity.ts          # Base class
│   ├── Pool.ts            # Pool management
│   ├── Vault.ts           # ERC-7540 vault ops
│   ├── ShareClass.ts      # Share class ops
│   ├── Investor.ts        # Investor functionality
│   ├── PoolNetwork.ts     # Multi-chain coordination
│   ├── BalanceSheet.ts    # Accounting queries
│   ├── MerkleProofManager.ts
│   ├── OnOffRampManager.ts
│   └── Reports/           # Financial reporting
├── config/
│   ├── chains.ts          # Chain configurations
│   └── protocol.ts        # Protocol contract addresses
├── types/                 # TypeScript type definitions
├── utils/                 # Utility functions
│   ├── BigInt.ts          # Balance, Price, Rate classes
│   ├── transaction.ts     # Transaction helpers
│   ├── permit.ts          # EIP-2612 permit signing
│   ├── ipfs.ts            # IPFS pinning/fetching
│   └── types.ts           # PoolId, ShareClassId, AssetId
└── tests/                 # Test utilities
    ├── setup.ts           # Mocha hooks for Tenderly
    └── tenderly.ts        # Tenderly fork management
```

### Key Components

**Centrifuge Class** (`src/Centrifuge.ts`)
- Primary SDK interface
- Manages blockchain clients (Viem)
- Handles signers (EIP-1193 or Viem LocalAccount)
- Query caching and subscription management
- Creates entity instances

**Entity Base Class** (`src/entities/Entity.ts`)
- Base for all domain objects
- `_query()` for cached observable queries
- `_transact()` for multi-step transactions
- Query key hierarchy for cache invalidation

**ABI Management** (`src/abi/`)
- Human-readable format (array of strings)
- Parsed via `viem.parseAbi()` in `src/abi/index.ts`
- One file per contract, exported via `ABI` object
- Type-safe with `viem.getContract()`

**Transaction Flow:**
1. User calls entity method → 2. Method uses `_transact()` generator → 3. Yields steps (signing, sending, waiting) → 4. Returns Observable with status updates → 5. Can be awaited or subscribed

**Query Flow:**
1. User calls entity method → 2. Method uses `_query()` with cache keys → 3. Returns Observable from cache or creates new → 4. Can poll or subscribe → 5. Can be awaited or subscribed

## Protocol Integration & ABI Updates

### Relationship with Protocol Repository

The [protocol repository](https://github.com/centrifuge/protocol) contains Solidity contracts built with Foundry. This SDK syncs with protocol changes via:

1. **Manual Identification**: Identify when protocol changes require SDK updates
2. **ABI Extraction**: Extract from deployed contracts or compilation artifacts
3. **Manual Update**: Update ABI files in `src/abi/`
4. **Entity Updates**: Update entity classes to expose new functionality
5. **Testing**: Update/add tests

### ABI File Format

Human-readable format (Viem/ethers style):

```typescript
// src/abi/AsyncRequestManager.abi.ts
export default [
  'function investments(address vault, address investor) view returns (uint128, uint128, ...)',
  'function requestDeposit(address vault_, uint256 assets, address, address, address) returns (bool)',
  'event DepositRequest(address indexed vault, address indexed controller, uint256 assets)',
  'error ExceedsDepositLimits()',
] as const
```

Benefits: Readable, includes only needed functions, parsed by `viem.parseAbi()`, type-safe.

### How to Update ABIs

**When protocol releases a new version:**

1. **Identify changed contracts** (check protocol release notes)
2. **Extract ABIs** using `cast abi <address>` or from protocol artifacts
3. **Convert to human-readable** (see [docs/ABI_MAINTENANCE.md](docs/ABI_MAINTENANCE.md))
4. **Update `src/abi/*.abi.ts`** with new/changed functions
5. **Update entity classes** to expose new functionality
6. **Add/update tests**
7. **Run `pnpm test`**
8. **Document in `PROTOCOL_VERSION.md`** (if exists)

**Historical References:**
- Commit `47a5a19` - Bulk ABI updates for v3.1 (23 files)
- Commit `1598ce3` - Breaking protocol changes (22 files)

**📖 For detailed procedures, see [docs/ABI_MAINTENANCE.md](docs/ABI_MAINTENANCE.md)**

### ABI Validation

**IMPORTANT:** No automated ABI validation exists. Correctness relies on:
1. Manual extraction/conversion
2. Integration tests (indirect validation via contract calls)
3. Developer vigilance
4. Code review

**What Tests Catch:**
- ✅ Function signature mismatches (encoding errors)
- ✅ Return type mismatches (decoding errors)
- ✅ Missing required functions (TypeScript errors)
- ✅ Event structure issues (for tested events)

**What Tests DON'T Catch:**
- ❌ Unused functions with incorrect signatures
- ❌ Events not subscribed in tests
- ❌ Error types not triggered in tests
- ❌ Functions present in ABI but removed from contract

See [ABI_VALIDATION_ANALYSIS.md](ABI_VALIDATION_ANALYSIS.md) for detailed analysis.

### Post-Update Verification Checklist

- [ ] All changed ABIs compile (`pnpm build`)
- [ ] All tests pass (`pnpm test`)
- [ ] Entity methods updated for new functions
- [ ] New functions have test coverage
- [ ] Removed functions no longer referenced
- [ ] `PROTOCOL_VERSION.md` updated (if exists)
- [ ] Breaking changes documented in PR
- [ ] Cross-chain compatibility verified (if applicable)

## Key Patterns & Conventions

### Entity Structure

All entities follow this pattern:

```typescript
import { Entity } from './Entity.js'

export class MyEntity extends Entity {
  constructor(_root: Centrifuge, ...cacheKeyComponents) {
    super(_root, ['key', 'hierarchy', ...cacheKeyComponents])
  }

  // Query method
  someQuery() {
    return this._query(['someQuery'], () => {
      return new Observable(subscriber => {
        // Query logic
      })
    })
  }

  // Transaction method
  someTransaction(param: string) {
    return this._transact(function* (this: MyEntity) {
      const contract = getContract({ ... })

      const result = yield* doTransaction({
        ...,
        action: () => contract.write.someFunction([param]),
      })

      return { hash: result.transactionHash }
    }.bind(this))
  }
}
```

### Type Safety with Viem

```typescript
import { getContract } from 'viem'
import { ABI } from '../abi/index.js'

const hub = getContract({
  address: this.network.hub,
  abi: ABI.Hub,
  client: this._root.getClient(chainId)
})

// TypeScript knows methods and signatures
const result = await hub.read.someViewFunction([arg1, arg2])
await hub.write.someStateChangingFunction([arg1, arg2])
```

### Balance Handling

Always use SDK's `Balance`, `Price`, `Rate` classes:

```typescript
import { Balance } from './utils/BigInt.js'

// Create from float (requires decimals)
const amount = Balance.fromFloat(1000.50, 6) // USDC (6 decimals)

// Create from bigint (raw on-chain)
const amount = new Balance(1000500000n, 6)

// Convert for display
const displayValue = amount.toFloat() // 1000.50

// Perform calculations
const doubled = amount.mul(2)
const sum = amount.add(otherBalance) // Must have same decimals
```

Similarly: `Price.fromFloat(1.05)` for prices, `Rate.fromFloat(5.0)` for rates.

### Observable Pattern

```typescript
// Queries return Observables
const details$ = vault.details()

// Await for single value
const details = await details$

// Subscribe for updates
const sub = details$.subscribe(
  data => console.log(data),
  error => console.error(error)
)
// Always unsubscribe: sub.unsubscribe()
```

### Transaction Pattern

```typescript
const tx$ = pool.updatePoolManagers([...])

// Await completion
const result = await tx$

// Or subscribe for status
tx$.subscribe(status => {
  if (status.type === 'signing') console.log('Sign...')
  if (status.type === 'pending') console.log('Sent:', status.hash)
  if (status.type === 'confirmed') console.log('Confirmed!')
})
```

## Common Development Tasks

### Adding a New Entity

1. Create class extending `Entity` in `src/entities/`
2. Add constructor with cache key components
3. Implement query methods using `this._query()`
4. Implement transaction methods using `this._transact()`
5. Export from `src/index.ts`
6. Add tests in `src/entities/<EntityName>.test.ts`

### Exposing a New Query

1. Identify data source (contract, indexer, or both)
2. Add method to relevant entity
3. Use `this._query([keys], () => Observable)` with unique keys
4. Combine observables with RxJS operators if needed
5. Return typed Observable (can be awaited or subscribed)

### Exposing a New Transaction

1. Identify contract and function
2. Add method to relevant entity
3. Use `this._transact(function* () { ... })` generator
4. Yield transaction steps with `doTransaction()` helper
5. Return result object with transaction hash
6. Handle multi-step flows (approve + deposit, etc.)

### Running a Single Test

```bash
# With Tenderly (blockchain fork)
pnpm test:single src/entities/Vault.test.ts

# Without Tenderly (faster, unit tests)
pnpm test:simple:single src/utils/BigInt.test.ts
```

## Build Configuration

- **TypeScript**: ES2023 target, Node.js ESM
- **Output**: `dist/` with `.d.ts` files
- **Strict Mode**: Enabled with `noUncheckedIndexedAccess`
- **Module Type**: ESM only (`type: "module"`)
- **Exports**: Single entry at `./dist/index.js`

## Key Dependencies

- **viem** (^2.33.3): Ethereum client, blockchain interactions
- **rxjs** (^7.8.1): Reactive programming, observables
- **decimal.js-light** (^2.5.1): Precise decimal math
- **isomorphic-ws** (^5.0.0): WebSocket subscriptions
- **tslib** (^2.8.1): TypeScript runtime helpers

## Contributing & Versioning

- **Commits**: Follow Conventional Commits
- **PR Labels**: Use semantic versioning labels or "no-release"
- **Testing**: All PRs must pass CI tests
- **Coverage**: Tracked via Codecov
- **Docs**: User docs at [centrifuge/documentation](https://github.com/centrifuge/documentation)

## Supported Chains

See `src/config/chains.ts`:
- **Mainnet:** Ethereum, Base, Arbitrum, Avalanche, Plume
- **Testnet:** Sepolia, Base Sepolia, Arbitrum Sepolia

Contract addresses configured in protocol config. Verify contracts deployed on target chain.

## Debugging & Local Development

### Docker-based Testing

```bash
# Start local environment (Anvil + Indexer)
docker compose up -d

# Use debug script
node src/debugIssues.mjs

# Stop
docker compose down -v
```

Debug script should point to:
- Local RPC: `rpcUrls: { 1: 'http://127.0.0.1:8545' }`
- Local indexer: `indexerUrl: 'http://localhost:8000'`

### Tenderly Forks

- Each test suite gets fresh fork
- Forks deleted after tests (unless `DEBUG=true`)
- Use `pnpm test:single` for iteration

### Analyzing On-Chain Data

`local-workbench/` contains helper scripts for analyzing events/data (local dev tools only).

## Quick Troubleshooting

**Transaction fails:**
- Check balance and allowance
- Verify investor whitelisted (`investment.isAllowedToInvest`)
- Check `maxInvest` before placing orders

**Query fails:**
- Verify indexer URL correct
- Try direct blockchain queries instead
- Check RPC endpoint availability

**Type errors:**
- Use `Balance.fromFloat()` with correct decimals
- Can't add balances with different decimals
- Always use `toFloat()` for display

**For detailed troubleshooting, see [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)**

## Related Documentation

- **SDK Usage**: [SDK_USAGE.md](docs/SDK_USAGE.md) - User-facing SDK guide
- **ABI Maintenance**: [ABI_MAINTENANCE.md](docs/ABI_MAINTENANCE.md) - Detailed ABI update procedures
- **Troubleshooting**: [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) - Comprehensive error guide
- **Protocol**: [github.com/centrifuge/protocol](https://github.com/centrifuge/protocol) - Smart contracts
- **Apps**: [github.com/centrifuge/apps-v3](https://github.com/centrifuge/apps-v3) - Frontend using SDK
- **Documentation**: [github.com/centrifuge/documentation](https://github.com/centrifuge/documentation) - User/dev docs
