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
   - [Debugging](#debugging)
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
pnpm dev
```

#### Building

```bash
pnpm build
```

#### Testing

```bash
pnpm test                # full test suite
pnpm test:single <file>  # test specific file
pnpm test:simple:single <file>
# (runs faster excluding setup files)
```

#### Debugging

This project provides a fully Dockerized environment for running both the Indexer (api-v3) and an Anvil fork (Foundry) locally.
To prepare your testing environment for on-chain debugging, first set up the debugging script:

`./src/debugIssues.mjs`

```javascript
// @ts-check

import { catchError, combineLatest, lastValueFrom, map, of, switchMap, tap } from 'rxjs'
import { parseAbiItem } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { AssetId, Balance, Centrifuge, PoolId, Price, ShareClass, ShareClassId } from './dist/index.js'

const abiItem = parseAbiItem('function balanceOf(address owner) view returns (uint256)')

const chainId = 1

const cent = new Centrifuge({
  environment: 'mainnet',
  pinJson: async () => 'test',
  rpcUrls: {
    1: 'http://127.0.0.1:8545',
  },
  inexerPollingInterval: 2000,
  indexerUrl: 'http://localhost:8000',
})

const account = privateKeyToAccount('0xPrivateKey')

cent.setSigner(account)

async function main() {
  const client = cent.getClient(chainId)

  const pool = await cent.pool(new PoolId('PoolId'))
  const scId = new ShareClassId('0x00010000000000010000000000000001')
  const shareClass = new ShareClass(cent, pool, scId)
  const assetId = new AssetId('AssetId')

  const result = await shareClass.approveDepositsAndIssueShares([
    {
      assetId,
      approveAssetAmount: Balance.fromFloat(10, 6),
      issuePricePerShare: Price.fromFloat(1.0),
    },
  ])
}

main()
```

:::warning
Before running the debugging script, comment out the transaction you intend to test if you don’t want it to execute.
Keep in mind that running this script locally will perform the same transaction logic as it would on the testnet or mainnet.
:::

Then, build and start the Docker containers:

```bash
docker compose up -d
```

Once you’re done, tear down the environment and remove associated volumes with:

```bash
docker compose down -v
```

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
