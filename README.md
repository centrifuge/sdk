# Centrifuge SDK [![Codecov](https://codecov.io/gh/centrifuge/sdk/graph/badge.svg?token=Q2yU8QfefP)](https://codecov.io/gh/centrifuge/sdk) [![Build CI status](https://github.com/centrifuge/sdk/actions/workflows/build-test-report.yml/badge.svg)](https://github.com/centrifuge/sdk/actions/workflows/build-test-report.yml) [![Latest Release](https://img.shields.io/github/v/release/centrifuge/sdk?sort=semver)](https://github.com/centrifuge/sdk/releases/latest)

# Centrifuge SDK

A fully typed JavaScript client to interact with the Centrifuge ecosystem. Use it to manage pools, investments, redemptions, financial reports, and more.

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
import Centrifuge from '@centrifuge/sdk';

const centrifuge = new Centrifuge({
  environment: 'mainnet' | 'testnet',         // optional, defaults to 'mainnet'
  rpcUrls?: { [chainId: number]: string },     // optional RPC endpoints
  indexerUrl?: string,                         // optional indexer API URL
  ipfsUrl?: string                             // optional IPFS gateway, default: https://centrifuge.mypinata.cloud
});
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

const pool = await centrifuge.pool('1')
const tx = await pool.closeEpoch()
console.log(tx.hash)

// or, subscribe to transaction lifecycle:
const sub = pool.closeEpoch().subscribe(
  (status) => console.log(status),
  (error) => console.error(error),
  () => console.log('Done')
)
```

### Investments

The SDK supports ERC-7540 tokenized vaults. Vaults are created per share class, chain, and currency.

```typescript
const pool = await centrifuge.pool('1')
const vault = await pool.vault(1, '0xShareClassAddress', '0xInvestmentCurrencyAddress')
```

You can query an individual investor’s situation:

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
const result = await vault.increaseInvestOrder(1000)
console.log(result.hash)
```

Once processed, any claimable shares or currencies can be claimed:

```typescript
const claimResult = await vault.claim()
```

### Reports

You can generate financial reports for a pool based on on-chain + API data.

Available report types:

- balanceSheet
- profitAndLoss
- cashflow

Filtering is supported:

```typescript
type ReportFilter = {
  from?: string // e.g. '2024-01-01'
  to?: string // e.g. '2024-01-31'
  groupBy?: 'day' | 'month' | 'quarter' | 'year'
}

const report = await pool.reports.balanceSheet({
  from: '2024-01-01',
  to: '2024-01-31',
  groupBy: 'month',
})
```

### Developer Guide

#### Development Mode

```bash
npm dev
```

#### Building

```bash
npm build
```

#### Testing

```bash
yarn test                # full test suite
yarn test:single <file>  # test specific file
yarn test:simple:single <file>
# (runs faster excluding setup files)
```

### Contributing

#### Docs

Detailed user & developer documentation is maintained in the `sdk/docs` repository.

#### PR Naming Convention & Versioning

PR titles & commits should follow Conventional Commits style.

Use semantic versioning: tags/releases should be one of major, minor, patch.

If no release is needed, label as no-release.

### License

This project is licensed under LGPL-3.0.
See the [LICENSE](./LICENSE) file for details.
