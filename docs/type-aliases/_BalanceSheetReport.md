
## Type: BalanceSheetReport

> **BalanceSheetReport**: `object`

Defined in: [src/types/reports.ts:36](https://github.com/centrifuge/centrifuge-sdk/blob/e8ba8663632aeb3b16074665a356e75ab51e8c4b/src/types/reports.ts#L36)

Balance sheet type

### Type declaration

#### accruedFees

> **accruedFees**: [`Currency`](#class-currency)

#### assetValuation

> **assetValuation**: [`Currency`](#class-currency)

#### netAssetValue

> **netAssetValue**: [`Currency`](#class-currency)

#### offchainCash

> **offchainCash**: [`Currency`](#class-currency)

#### onchainReserve

> **onchainReserve**: [`Currency`](#class-currency)

#### timestamp

> **timestamp**: `string`

#### totalCapital?

> `optional` **totalCapital**: [`Currency`](#class-currency)

#### tranches?

> `optional` **tranches**: `object`[]

#### type

> **type**: `"balanceSheet"`