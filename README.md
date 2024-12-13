# Centrifuge SDK [![Codecov](https://codecov.io/gh/centrifuge/sdk/graph/badge.svg?token=Q2yU8QfefP)](https://codecov.io/gh/centrifuge/sdk) [![Build CI status](https://github.com/centrifuge/sdk/actions/workflows/build-test-report.yml/badge.svg)](https://github.com/centrifuge/sdk/actions/workflows/build-test-report.yml) [![Latest Release](https://img.shields.io/github/v/release/centrifuge/sdk?sort=semver)](https://github.com/centrifuge/sdk/releases/latest)

The Centrifuge SDK is a JavaScript client for interacting with the [Centrifuge](https://centrifuge.io) ecosystem. It provides a comprehensive, fully typed library to integrate investments and redemptions, generate financial reports, manage pools, and much more.

## Installation

Centrifuge SDK uses [Viem](https://viem.sh/) under the hood. It's necessary to install it alongside the SDK.

```bash
npm install --save @centrifuge/sdk viem
# or
yarn install @centrifuge/sdk viem
```

## Init and config

Create an instance and pass optional configuration

```js
import Centrifuge from '@centrifuge/sdk'

const centrifuge = new Centrifuge()
```

The following config options can be passed on initialization of the SDK:

- `environment: 'mainnet' | 'demo' | 'dev'`
  - Optional
  - Default value: `mainnet`
- `rpcUrls: Record<number, string>`
  - Optional
  - A object mapping chain ids to RPC URLs

## Queries

Queries return Promise-like [Observables](https://rxjs.dev/guide/observable). They can be either awaited to get a single value, or subscribed to to get fresh data whenever on-chain data changes.

```js
try {
  const pool = await centrifuge.pools()
} catch (error) {
  console.error(error)
}
```

```js
const subscription = centrifuge.pools().subscribe(
  (pool) => console.log(pool),
  (error) => console.error(error)
)
subscription.unsubscribe()
```

The returned results are either immutable values, or entities that can be further queried.

## Transactions

To perform transactions, you need to set a signer on the `centrifuge` instance.

```js
centrifuge.setSigner(signer)
```

`signer` can be a [EIP1193](https://eips.ethereum.org/EIPS/eip-1193)-compatible provider or a Viem [LocalAccount](https://viem.sh/docs/accounts/local).

With this you can call transaction methods. Similar to queries they can be awaited to get their final result, or subscribed to get get status updates.

```js
const pool = await centrifuge.pool('1')
try {
  const status = await pool.closeEpoch()
  console.log(status)
} catch (error) {
  console.error(error)
}
```

```js
const pool = await centrifuge.pool('1')
const subscription = pool.closeEpoch().subscribe(
  (status) => console.log(pool),
  (error) => console.error(error),
  () => console.log('complete')
)
```

## Reports

Reports are generated from data from the Centrifuge API and are combined with pool metadata to provide a comprehensive view of the pool's financials.

Available reports are:

- `balanceSheet`
- `profitAndLoss`
- `cashflow`

```ts
const pool = await centrifuge.pool('<pool-id>')
const balanceSheetReport = await pool.reports.balanceSheet()
```

### Report Filtering

Reports can be filtered using the `ReportFilter` type.

```ts
type GroupBy = 'day' | 'month' | 'quarter' | 'year'

const balanceSheetReport = await pool.reports.balanceSheet({
  from: '2024-01-01',
  to: '2024-01-31',
  groupBy: 'month',
})
```

## Developer Docs

### Dev server

```bash
yarn dev
```

### Build

```bash
yarn build
```

### Test

```bash
yarn test
yarn test:single <path-to-file>
yarn test:simple:single <path-to-file> # without setup file, faster and without tenderly setup
```

### PR Naming Convention

PR naming should follow the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) specification.

### Semantic Versioning

PRs should be marked with the appropriate type: `major`, `minor`, `patch`, `no-release`.
