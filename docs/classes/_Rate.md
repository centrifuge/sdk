
## Class: ~~Rate~~

Defined in: [src/utils/BigInt.ts:177](https://github.com/centrifuge/sdk/blob/ae12cdce6833f297c221dbc7667d8a8a900a03f0/src/utils/BigInt.ts#L177)

### Deprecated

### Extends

- `DecimalWrapper`

### Constructors

#### new Rate()

> **new Rate**(`value`, `decimals`): [`Rate`](#class-rate)

Defined in: [src/utils/BigInt.ts:29](https://github.com/centrifuge/sdk/blob/ae12cdce6833f297c221dbc7667d8a8a900a03f0/src/utils/BigInt.ts#L29)

##### Parameters

###### value

`bigint` | `Numeric`

###### decimals

`number` = `27`

##### Returns

[`Rate`](#class-rate)

##### Inherited from

`DecimalWrapper.constructor`

### Properties

#### ~~decimals~~

> `readonly` **decimals**: `number` = `27`

Defined in: [src/utils/BigInt.ts:27](https://github.com/centrifuge/sdk/blob/ae12cdce6833f297c221dbc7667d8a8a900a03f0/src/utils/BigInt.ts#L27)

##### Inherited from

`DecimalWrapper.decimals`

***

#### ~~value~~

> `protected` **value**: `bigint`

Defined in: [src/utils/BigInt.ts:3](https://github.com/centrifuge/sdk/blob/ae12cdce6833f297c221dbc7667d8a8a900a03f0/src/utils/BigInt.ts#L3)

##### Inherited from

`DecimalWrapper.value`

***

#### ~~decimals~~

> `static` **decimals**: `number` = `27`

Defined in: [src/utils/BigInt.ts:178](https://github.com/centrifuge/sdk/blob/ae12cdce6833f297c221dbc7667d8a8a900a03f0/src/utils/BigInt.ts#L178)

### Methods

#### ~~eq()~~

> **eq**\<`T`\>(`value`): `boolean`

Defined in: [src/utils/BigInt.ts:115](https://github.com/centrifuge/sdk/blob/ae12cdce6833f297c221dbc7667d8a8a900a03f0/src/utils/BigInt.ts#L115)

##### Type Parameters

• **T**

##### Parameters

###### value

`bigint` | `T` *extends* `BigIntWrapper` ? `T`\<`T`\> : `never`

##### Returns

`boolean`

##### Inherited from

`DecimalWrapper.eq`

***

#### ~~gt()~~

> **gt**\<`T`\>(`value`): `boolean`

Defined in: [src/utils/BigInt.ts:105](https://github.com/centrifuge/sdk/blob/ae12cdce6833f297c221dbc7667d8a8a900a03f0/src/utils/BigInt.ts#L105)

##### Type Parameters

• **T**

##### Parameters

###### value

`bigint` | `T` *extends* `BigIntWrapper` ? `T`\<`T`\> : `never`

##### Returns

`boolean`

##### Inherited from

`DecimalWrapper.gt`

***

#### ~~gte()~~

> **gte**\<`T`\>(`value`): `boolean`

Defined in: [src/utils/BigInt.ts:110](https://github.com/centrifuge/sdk/blob/ae12cdce6833f297c221dbc7667d8a8a900a03f0/src/utils/BigInt.ts#L110)

##### Type Parameters

• **T**

##### Parameters

###### value

`bigint` | `T` *extends* `BigIntWrapper` ? `T`\<`T`\> : `never`

##### Returns

`boolean`

##### Inherited from

`DecimalWrapper.gte`

***

#### ~~isZero()~~

> **isZero**(): `boolean`

Defined in: [src/utils/BigInt.ts:119](https://github.com/centrifuge/sdk/blob/ae12cdce6833f297c221dbc7667d8a8a900a03f0/src/utils/BigInt.ts#L119)

##### Returns

`boolean`

##### Inherited from

`DecimalWrapper.isZero`

***

#### ~~lt()~~

> **lt**\<`T`\>(`value`): `boolean`

Defined in: [src/utils/BigInt.ts:95](https://github.com/centrifuge/sdk/blob/ae12cdce6833f297c221dbc7667d8a8a900a03f0/src/utils/BigInt.ts#L95)

##### Type Parameters

• **T**

##### Parameters

###### value

`bigint` | `T` *extends* `BigIntWrapper` ? `T`\<`T`\> : `never`

##### Returns

`boolean`

##### Inherited from

`DecimalWrapper.lt`

***

#### ~~lte()~~

> **lte**\<`T`\>(`value`): `boolean`

Defined in: [src/utils/BigInt.ts:100](https://github.com/centrifuge/sdk/blob/ae12cdce6833f297c221dbc7667d8a8a900a03f0/src/utils/BigInt.ts#L100)

##### Type Parameters

• **T**

##### Parameters

###### value

`bigint` | `T` *extends* `BigIntWrapper` ? `T`\<`T`\> : `never`

##### Returns

`boolean`

##### Inherited from

`DecimalWrapper.lte`

***

#### ~~toApr()~~

> **toApr**(): `Decimal`

Defined in: [src/utils/BigInt.ts:202](https://github.com/centrifuge/sdk/blob/ae12cdce6833f297c221dbc7667d8a8a900a03f0/src/utils/BigInt.ts#L202)

##### Returns

`Decimal`

***

#### ~~toAprPercent()~~

> **toAprPercent**(): `Decimal`

Defined in: [src/utils/BigInt.ts:210](https://github.com/centrifuge/sdk/blob/ae12cdce6833f297c221dbc7667d8a8a900a03f0/src/utils/BigInt.ts#L210)

##### Returns

`Decimal`

***

#### ~~toBigInt()~~

> **toBigInt**(): `bigint`

Defined in: [src/utils/BigInt.ts:21](https://github.com/centrifuge/sdk/blob/ae12cdce6833f297c221dbc7667d8a8a900a03f0/src/utils/BigInt.ts#L21)

##### Returns

`bigint`

##### Inherited from

`DecimalWrapper.toBigInt`

***

#### ~~toDecimal()~~

> **toDecimal**(): `Decimal`

Defined in: [src/utils/BigInt.ts:43](https://github.com/centrifuge/sdk/blob/ae12cdce6833f297c221dbc7667d8a8a900a03f0/src/utils/BigInt.ts#L43)

##### Returns

`Decimal`

##### Inherited from

`DecimalWrapper.toDecimal`

***

#### ~~toFloat()~~

> **toFloat**(): `number`

Defined in: [src/utils/BigInt.ts:47](https://github.com/centrifuge/sdk/blob/ae12cdce6833f297c221dbc7667d8a8a900a03f0/src/utils/BigInt.ts#L47)

##### Returns

`number`

##### Inherited from

`DecimalWrapper.toFloat`

***

#### ~~toPercent()~~

> **toPercent**(): `Decimal`

Defined in: [src/utils/BigInt.ts:198](https://github.com/centrifuge/sdk/blob/ae12cdce6833f297c221dbc7667d8a8a900a03f0/src/utils/BigInt.ts#L198)

##### Returns

`Decimal`

***

#### ~~toString()~~

> **toString**(): `string`

Defined in: [src/utils/BigInt.ts:17](https://github.com/centrifuge/sdk/blob/ae12cdce6833f297c221dbc7667d8a8a900a03f0/src/utils/BigInt.ts#L17)

##### Returns

`string`

##### Inherited from

`DecimalWrapper.toString`

***

#### ~~fromApr()~~

> `static` **fromApr**(`apr`): [`Rate`](#class-rate)

Defined in: [src/utils/BigInt.ts:188](https://github.com/centrifuge/sdk/blob/ae12cdce6833f297c221dbc7667d8a8a900a03f0/src/utils/BigInt.ts#L188)

##### Parameters

###### apr

`Numeric`

##### Returns

[`Rate`](#class-rate)

***

#### ~~fromAprPercent()~~

> `static` **fromAprPercent**(`apr`): [`Rate`](#class-rate)

Defined in: [src/utils/BigInt.ts:194](https://github.com/centrifuge/sdk/blob/ae12cdce6833f297c221dbc7667d8a8a900a03f0/src/utils/BigInt.ts#L194)

##### Parameters

###### apr

`Numeric`

##### Returns

[`Rate`](#class-rate)

***

#### ~~fromFloat()~~

> `static` **fromFloat**(`number`): [`Rate`](#class-rate)

Defined in: [src/utils/BigInt.ts:180](https://github.com/centrifuge/sdk/blob/ae12cdce6833f297c221dbc7667d8a8a900a03f0/src/utils/BigInt.ts#L180)

##### Parameters

###### number

`Numeric`

##### Returns

[`Rate`](#class-rate)

***

#### ~~fromPercent()~~

> `static` **fromPercent**(`number`): [`Rate`](#class-rate)

Defined in: [src/utils/BigInt.ts:184](https://github.com/centrifuge/sdk/blob/ae12cdce6833f297c221dbc7667d8a8a900a03f0/src/utils/BigInt.ts#L184)

##### Parameters

###### number

`Numeric`

##### Returns

[`Rate`](#class-rate)
