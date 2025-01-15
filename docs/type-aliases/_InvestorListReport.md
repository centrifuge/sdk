
## Type: InvestorListReport

> **InvestorListReport**: `object`

Defined in: [src/types/reports.ts:279](https://github.com/centrifuge/sdk/blob/e8e313ed95c35b522a7e87515220a81ae2649430/src/types/reports.ts#L279)

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
