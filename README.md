# Centrifuge JavaScript SDK

CentrifugeSDK provides a JavaScript client to interact with the Centrifuge ecosystem. It provides a comprehensive interface to easily create and manage pools, nfts, loans and metadata.

## Installation

```bash
npm install --save @centrifuge/centrifuge-sdk
```

## Init and config

Create an instance and pass optional configuration

```js
import Centrifuge from '@centrifuge/centrifuge-sdk'

const centrifuge = new Centrifuge()
```

The following config options can be passed on initilization of CentrifugeSDK:

#### `TDB`

Default value:
