
## Type: BalanceSheetReport

> **BalanceSheetReport**: `object`

Defined in: [src/types/reports.ts:36](https://github.com/centrifuge/sdk/blob/06481dd97d36d4bab50ba6896f271ad18817fe4b/src/types/reports.ts#L36)

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