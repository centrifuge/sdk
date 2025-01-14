
## Type: InvestorTransactionsReport

> **InvestorTransactionsReport**: `object`

Defined in: [src/types/reports.ts:137](https://github.com/centrifuge/sdk/blob/ae12cdce6833f297c221dbc7667d8a8a900a03f0/src/types/reports.ts#L137)

### Type declaration

#### account

> **account**: `string`

#### chainId

> **chainId**: `number` \| `"centrifuge"`

#### currencyAmount

> **currencyAmount**: [`Currency`](#class-currency)

#### epoch

> **epoch**: `string`

#### price

> **price**: [`Price`](#class-price)

#### timestamp

> **timestamp**: `string`

#### trancheTokenAmount

> **trancheTokenAmount**: [`Currency`](#class-currency)

#### trancheTokenId

> **trancheTokenId**: `string`

#### transactionHash

> **transactionHash**: `string`

#### transactionType

> **transactionType**: `SubqueryInvestorTransactionType`

#### type

> **type**: `"investorTransactions"`
