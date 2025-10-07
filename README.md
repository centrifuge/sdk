# Centrifuge SDK [![Codecov](https://codecov.io/gh/centrifuge/sdk/graph/badge.svg?token=Q2yU8QfefP)](https://codecov.io/gh/centrifuge/sdk) [![Build CI status](https://github.com/centrifuge/sdk/actions/workflows/build-test-report.yml/badge.svg)](https://github.com/centrifuge/sdk/actions/workflows/build-test-report.yml) [![Latest Release](https://img.shields.io/github/v/release/centrifuge/sdk?sort=semver)](https://github.com/centrifuge/sdk/releases/latest)

A fully typed JavaScript client to interact with the [Centrifuge](https://centrifuge.io) ecosystem. Use it to manage pools, investments, redemptions, financial reports, and more.

---

## Table of Contents

1. [Features](#features)
2. [Installation](#installation)
3. [Getting Started](#getting-started)
   - [Initialization & Configuration](#initialization--configuration)
   - [Queries](#queries)
   - [Transactions](#transactions)
   - [Investments](#investments)
   - [Reports](#reports)
4. [Developer Guide](#developer-guide)
   - [Development Mode](#development-mode)
   - [Building](#building)
   - [Testing](#testing)
5. [Contributing](#contributing)
   - [Docs](#docs)
   - [PR Conventions & Versioning](#pr-naming-convention--versioning)
6. [License](#license)

---

## Features

- Typed JavaScript/TypeScript client
- Support for mainnet & testnet environments
- Full querying interface (readonly) + subscription support
- Transaction support (awaitable or observable for updates)
- Handling of share classes, vaults, and ERC-7540 tokenized vaults
- Reports: balance sheet, profit & loss, cash flow

---

## Installation

```bash
npm install @centrifuge/sdk
```

## Getting Started

### Initialization & Configuration

```typescript
import Centrifuge from '@centrifuge/sdk'

const centrifuge = new Centrifuge({
  environment: 'mainnet' | 'testnet',         // optional, defaults to 'mainnet'
  rpcUrls?: { [chainId: number]: string },     // optional RPC endpoints
  indexerUrl?: string,                         // optional indexer API URL
  ipfsUrl?: string                             // optional IPFS gateway, default: https://centrifuge.mypinata.cloud
})
```

### Queries

Queries return Observables (rxjs), which can be:

- awaited (for one value), or
- subscribed to (to receive updates when on-chain data changes)

```typescript
const pools = await centrifuge.pools()

// Or subscribe
const subscription = centrifuge.pools().subscribe(
  (pools) => console.log(pools),
  (error) => console.error(error)
)

// Later, to stop updates:
subscription.unsubscribe()
```

### Transactions

- Before calling transaction methods, set a signer on the centrifuge instance.
- The signer can be:
  - An EIP-1193-compatible provider
  - A Viem LocalAccount
- Transactions, like queries, support either awaiting for completion or subscribing for status updates.

```typescript
centrifuge.setSigner(signer)
const poolId = PoolId.from(1, 1)
const pool = await centrifuge.pool(poolId)
const tx = await pool.updatePoolManagers([
  {
    address: '0xAddress',
    canManage: true,
  },
])
console.log(tx.hash)

// or, subscribe to transaction lifecycle:
const sub = pool.pool
  .updatePoolManagers([
    {
      address: '0xAddress',
      canManage: true,
    },
  ])
  .subscribe(
    (status) => console.log(status),
    (error) => console.error(error),
    () => console.log('Done')
  )
```

### Investments

The SDK supports [ERC-7540](https://eips.ethereum.org/EIPS/eip-7540) tokenized vaults. Vaults are created per share class, chain, and currency.

```typescript
const pool = await centrifuge.pool(poolId)
const scId = ShareClassId.from(poolId, 1)
const assetId = AssetId.from(centId, 1)
// Get a vault
const vault = await pool.vault(11155111, scId, assetId)
```

#### Vault Types

Vaults can behave differently depending on how the pool is configured:

- Synchronous deposit vaults
  These vaults follow a hybrid model using both ERC-4626 and ERC-7540. Deposits are executed instantly using ERC-4626 behavior, allowing users to receive shares immediately. However, redemptions are handled asynchronously through ERC-7540, using the Hub to queue and manage the withdrawal requests.

- Asynchronous vaults
  Asynchronous vaults are fully request-based and follow the ERC-7540 standard. They allow both deposit and redemption actions to be handled through an asynchronous workflow, using the Centrifuge Hub to manage requests.

You can query an individual investor’s state:

```typescript
const inv = await vault.investment('0xInvestorAddress')

// Example returned fields include:
//   isAllowedToInvest
//   investmentCurrency, investmentCurrencyBalance, investmentCurrencyAllowance
//   shareCurrency, shareBalance
//   claimableInvestShares, claimableInvestCurrencyEquivalent
//   claimableRedeemCurrency, claimableRedeemSharesEquivalent
//   pendingInvestCurrency, pendingRedeemShares
//   hasPendingCancelInvestRequest, hasPendingCancelRedeemRequest
```

To invest:

```typescript
const { investmentCurrency } = await vault.details()
const amount = Balance.fromFloat(1000, investmentCurrency.decimals)
const tx = await vault.increaseInvestOrder(amount)
console.log(result.hash)
```

Once processed, any claimable shares or currencies can be claimed:

```typescript
const claimResult = await vault.claim()
```

### Reports

You can generate financial reports for a pool based on on-chain + API data.

Available report types:

- token price

Filtering is supported:

```typescript
type ReportFilter = {
  from?: string // e.g. '2024-01-01'
  to?: string // e.g. '2024-01-31'
  groupBy?: 'day' | 'month' | 'quarter' | 'year'
}

const fromNum = toUTCEpoch(filters.from, unit)
const toNum = toUTCEpoch(filters.to, unit)

const report = await pool.reports.sharePrices({
  from: fromNum,
  to: toNum,
  groupBy: 'day',
})
```

### Developer Guide

#### Development Mode

```bash
yarn dev
```

#### Building

```bash
yarn build
```

#### Dockerized test workflow

This project uses a fully Dockerized setup to run both the Indexer (api-v3) and an Anvil fork (foundry) locally.
Tests can be executed against this environment or within CI, ensuring consistent, reproducible results.

1. Build and start services

```bash
yarn build:docker
```

This command will:

- Start the Indexer container (api-v3)
- Start the Anvil fork container (foundry) with the configured fork URL, chain ID, and block number
- Wait for the Indexer to become ready and accept requests

Environment variables defined in docker-compose.yml control parameters such as API keys, fork block numbers, and chain IDs.

2. Configure local indexer connection

In your test environment file `(./src/tests/.env)`, set the local Indexer URL:

```bash
INDEXER_LOCAL_URL=http://localhost:8080
LOCAL_POLL_INTERVAL=2000
```

This ensures all tests point to the locally running Indexer.

3. Run the tests

```bash
yarn test
```

Executes the full test suite against the Dockerized services.
Streams all Mocha and related test output to your console.
For CI pipelines, you can use:

```bash
yarn test:ci
```

4. Stop and cleanup services

After tests complete, stop and remove all containers and volumes:

```bash
docker compose down -v
```

##### Running tests against Tenderly

Tests can also be executed against Tenderly instead of the local Anvil fork.
This mode is controlled by environment variables:

```bash
LOCAL=false
DEBUG=true
```

:::info
When testing against Tenderly, use existing on-chain pools instead of creating new ones.
It’s recommended to run single tests in this mode for more predictable and faster runs.
:::

### Contributing

#### Docs

Detailed user & developer documentation is maintained in the [documentation repository](https://github.com/centrifuge/documentation/tree/main/docs/developer/centrifuge-sdk).

#### PR Naming Convention & Versioning

PR titles & commits should follow Conventional Commits style.

Use semantic versioning: tags/releases should be one of major, minor, patch.

If no release is needed, label as no-release.

### License

This project is licensed under LGPL-3.0.
See the [LICENSE](./LICENSE) file for details.
