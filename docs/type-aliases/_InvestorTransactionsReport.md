
## Type: InvestorTransactionsReport

> **InvestorTransactionsReport**: `object`

Defined in: [src/types/reports.ts:137](https://github.com/centrifuge/sdk/blob/53d114090a2f30046959761b9bf8f6f2a6b15867/src/types/reports.ts#L137)

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
