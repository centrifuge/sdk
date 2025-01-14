
## Class: Reports

Defined in: [src/Reports/index.ts:34](https://github.com/centrifuge/sdk/blob/53d114090a2f30046959761b9bf8f6f2a6b15867/src/Reports/index.ts#L34)

### Extends

- `Entity`

### Properties

#### pool

> **pool**: [`Pool`](#class-pool)

Defined in: [src/Reports/index.ts:39](https://github.com/centrifuge/sdk/blob/53d114090a2f30046959761b9bf8f6f2a6b15867/src/Reports/index.ts#L39)

### Methods

#### assetList()

> **assetList**(`filter`?): [`Query`](#type-query)\<[`AssetListReport`](#type-assetlistreport)[]\>

Defined in: [src/Reports/index.ts:73](https://github.com/centrifuge/sdk/blob/53d114090a2f30046959761b9bf8f6f2a6b15867/src/Reports/index.ts#L73)

##### Parameters

###### filter?

[`AssetListReportFilter`](#type-assetlistreportfilter)

##### Returns

[`Query`](#type-query)\<[`AssetListReport`](#type-assetlistreport)[]\>

***

#### assetTransactions()

> **assetTransactions**(`filter`?): [`Query`](#type-query)\<[`AssetTransactionReport`](#type-assettransactionreport)[]\>

Defined in: [src/Reports/index.ts:61](https://github.com/centrifuge/sdk/blob/53d114090a2f30046959761b9bf8f6f2a6b15867/src/Reports/index.ts#L61)

##### Parameters

###### filter?

[`AssetTransactionReportFilter`](#type-assettransactionreportfilter)

##### Returns

[`Query`](#type-query)\<[`AssetTransactionReport`](#type-assettransactionreport)[]\>

***

#### balanceSheet()

> **balanceSheet**(`filter`?): [`Query`](#type-query)\<[`BalanceSheetReport`](#type-balancesheetreport)[]\>

Defined in: [src/Reports/index.ts:45](https://github.com/centrifuge/sdk/blob/53d114090a2f30046959761b9bf8f6f2a6b15867/src/Reports/index.ts#L45)

##### Parameters

###### filter?

[`ReportFilter`](#interfaces-reportfilter)

##### Returns

[`Query`](#type-query)\<[`BalanceSheetReport`](#type-balancesheetreport)[]\>

***

#### cashflow()

> **cashflow**(`filter`?): [`Query`](#type-query)\<[`CashflowReport`](#type-cashflowreport)[]\>

Defined in: [src/Reports/index.ts:49](https://github.com/centrifuge/sdk/blob/53d114090a2f30046959761b9bf8f6f2a6b15867/src/Reports/index.ts#L49)

##### Parameters

###### filter?

[`ReportFilter`](#interfaces-reportfilter)

##### Returns

[`Query`](#type-query)\<[`CashflowReport`](#type-cashflowreport)[]\>

***

#### feeTransactions()

> **feeTransactions**(`filter`?): [`Query`](#type-query)\<[`FeeTransactionReport`](#type-feetransactionreport)[]\>

Defined in: [src/Reports/index.ts:69](https://github.com/centrifuge/sdk/blob/53d114090a2f30046959761b9bf8f6f2a6b15867/src/Reports/index.ts#L69)

##### Parameters

###### filter?

[`FeeTransactionReportFilter`](#type-feetransactionreportfilter)

##### Returns

[`Query`](#type-query)\<[`FeeTransactionReport`](#type-feetransactionreport)[]\>

***

#### investorList()

> **investorList**(`filter`?): [`Query`](#type-query)\<[`InvestorListReport`](#type-investorlistreport)[]\>

Defined in: [src/Reports/index.ts:77](https://github.com/centrifuge/sdk/blob/53d114090a2f30046959761b9bf8f6f2a6b15867/src/Reports/index.ts#L77)

##### Parameters

###### filter?

[`InvestorListReportFilter`](#type-investorlistreportfilter)

##### Returns

[`Query`](#type-query)\<[`InvestorListReport`](#type-investorlistreport)[]\>

***

#### investorTransactions()

> **investorTransactions**(`filter`?): [`Query`](#type-query)\<[`InvestorTransactionsReport`](#type-investortransactionsreport)[]\>

Defined in: [src/Reports/index.ts:57](https://github.com/centrifuge/sdk/blob/53d114090a2f30046959761b9bf8f6f2a6b15867/src/Reports/index.ts#L57)

##### Parameters

###### filter?

[`InvestorTransactionsReportFilter`](#type-investortransactionsreportfilter)

##### Returns

[`Query`](#type-query)\<[`InvestorTransactionsReport`](#type-investortransactionsreport)[]\>

***

#### profitAndLoss()

> **profitAndLoss**(`filter`?): [`Query`](#type-query)\<[`ProfitAndLossReport`](#type-profitandlossreport)[]\>

Defined in: [src/Reports/index.ts:53](https://github.com/centrifuge/sdk/blob/53d114090a2f30046959761b9bf8f6f2a6b15867/src/Reports/index.ts#L53)

##### Parameters

###### filter?

[`ReportFilter`](#interfaces-reportfilter)

##### Returns

[`Query`](#type-query)\<[`ProfitAndLossReport`](#type-profitandlossreport)[]\>

***

#### tokenPrice()

> **tokenPrice**(`filter`?): [`Query`](#type-query)\<[`TokenPriceReport`](#type-tokenpricereport)[]\>

Defined in: [src/Reports/index.ts:65](https://github.com/centrifuge/sdk/blob/53d114090a2f30046959761b9bf8f6f2a6b15867/src/Reports/index.ts#L65)

##### Parameters

###### filter?

[`TokenPriceReportFilter`](#type-tokenpricereportfilter)

##### Returns

[`Query`](#type-query)\<[`TokenPriceReport`](#type-tokenpricereport)[]\>
