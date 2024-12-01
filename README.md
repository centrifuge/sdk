[![Codecov](https://codecov.io/gh/centrifuge/sdk/graph/badge.svg?token=Q2yU8QfefP)](https://codecov.io/gh/centrifuge/sdk)
[![Build CI status](https://github.com/centrifuge/sdk/actions/workflows/build-test-report.yml/badge.svg)](https://github.com/centrifuge/sdk/actions/workflows/build-test-report.yml)
<!-- [![npm version](https://badge.fury.io/js/@centrifuge%2Fsdk.svg)](https://www.npmjs.com/package/@centrifuge/sdk) -->
[![Latest Release](https://img.shields.io/github/v/release/centrifuge/sdk?sort=semver)](https://github.com/centrifuge/sdk/releases/latest)


# Centrifuge JavaScript SDK

CentrifugeSDK provides a JavaScript client to interact with the Centrifuge ecosystem. It provides a comprehensive interface to easily create and manage pools, nfts, loans and metadata.

## Installation

CentrifugeSDK uses [Viem](https://viem.sh/) under the hood. It's necessary to install it alongside the SDK.

```bash
npm install --save @centrifuge/sdk viem
```

## Init and config

Create an instance and pass optional configuration

```js
import Centrifuge from '@centrifuge/sdk'

const centrifuge = new Centrifuge()
```

The following config options can be passed on initilization of CentrifugeSDK:

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

`signer` can be a [EIP1193](https://eips.ethereum.org/EIPS/eip-1193)-compatible provider or a Viem [LocalAccount](https://viem.sh/docs/accounts/local)

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

### PR Naming Convention for Semantic Versioning

PR naming convention is used to determine the semantic version bump of the package. It is enforced by a GitHub action in each pull request.

Version bumps:

- `major: breaking changes`
- `minor: new features`
- `patch: bug fixes`
- `none: no version bump, no publish`
