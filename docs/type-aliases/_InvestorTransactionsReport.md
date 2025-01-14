
## Type: InvestorTransactionsReport

> **InvestorTransactionsReport**: `object`

Defined in: [src/types/reports.ts:137](https://github.com/centrifuge/sdk/blob/06481dd97d36d4bab50ba6896f271ad18817fe4b/src/types/reports.ts#L137)

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
