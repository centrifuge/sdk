
## Type: InvestorListReport

> **InvestorListReport**: `object`

Defined in: [src/types/reports.ts:279](https://github.com/centrifuge/centrifuge-sdk/blob/e8ba8663632aeb3b16074665a356e75ab51e8c4b/src/types/reports.ts#L279)

### Type declaration

#### accountId

> **accountId**: `string`

#### chainId

> **chainId**: `number` \| `"centrifuge"` \| `"all"`

#### evmAddress?

> `optional` **evmAddress**: `string`

#### pendingInvest

> **pendingInvest**: [`Currency`](#class-currency)

#### pendingRedeem

> **pendingRedeem**: [`Currency`](#class-currency)

#### poolPercentage

> **poolPercentage**: [`Rate`](#class-rate)

#### position

> **position**: [`Currency`](#class-currency)

#### type

> **type**: `"investorList"`
