
## Class: Price

Defined in: [src/utils/BigInt.ts:215](https://github.com/centrifuge/sdk/blob/ae12cdce6833f297c221dbc7667d8a8a900a03f0/src/utils/BigInt.ts#L215)

### Extends

- `DecimalWrapper`

### Constructors

#### new Price()

> **new Price**(`value`): [`Price`](#class-price)

Defined in: [src/utils/BigInt.ts:218](https://github.com/centrifuge/sdk/blob/ae12cdce6833f297c221dbc7667d8a8a900a03f0/src/utils/BigInt.ts#L218)

##### Parameters

###### value

`bigint` | `Numeric`

##### Returns

[`Price`](#class-price)

##### Overrides

`DecimalWrapper.constructor`

### Properties

#### decimals

> `readonly` **decimals**: `number` = `27`

Defined in: [src/utils/BigInt.ts:27](https://github.com/centrifuge/sdk/blob/ae12cdce6833f297c221dbc7667d8a8a900a03f0/src/utils/BigInt.ts#L27)

##### Inherited from

`DecimalWrapper.decimals`

***

#### value

> `protected` **value**: `bigint`

Defined in: [src/utils/BigInt.ts:3](https://github.com/centrifuge/sdk/blob/ae12cdce6833f297c221dbc7667d8a8a900a03f0/src/utils/BigInt.ts#L3)

##### Inherited from

`DecimalWrapper.value`

***

#### decimals

> `static` **decimals**: `number` = `18`

Defined in: [src/utils/BigInt.ts:216](https://github.com/centrifuge/sdk/blob/ae12cdce6833f297c221dbc7667d8a8a900a03f0/src/utils/BigInt.ts#L216)

### Methods

#### add()

> **add**(`value`): [`Price`](#class-price)

Defined in: [src/utils/BigInt.ts:226](https://github.com/centrifuge/sdk/blob/ae12cdce6833f297c221dbc7667d8a8a900a03f0/src/utils/BigInt.ts#L226)

##### Parameters

###### value

`bigint` | [`Price`](#class-price)

##### Returns

[`Price`](#class-price)

***

#### div()

> **div**(`value`): [`Price`](#class-price)

Defined in: [src/utils/BigInt.ts:238](https://github.com/centrifuge/sdk/blob/ae12cdce6833f297c221dbc7667d8a8a900a03f0/src/utils/BigInt.ts#L238)

##### Parameters

###### value

`bigint` | [`Price`](#class-price)

##### Returns

[`Price`](#class-price)

***

#### eq()

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

#### gt()

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

#### gte()

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

#### isZero()

> **isZero**(): `boolean`

Defined in: [src/utils/BigInt.ts:119](https://github.com/centrifuge/sdk/blob/ae12cdce6833f297c221dbc7667d8a8a900a03f0/src/utils/BigInt.ts#L119)

##### Returns

`boolean`

##### Inherited from

`DecimalWrapper.isZero`

***

#### lt()

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

#### lte()

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

#### mul()

> **mul**(`value`): [`Price`](#class-price)

Defined in: [src/utils/BigInt.ts:234](https://github.com/centrifuge/sdk/blob/ae12cdce6833f297c221dbc7667d8a8a900a03f0/src/utils/BigInt.ts#L234)

##### Parameters

###### value

`bigint` | [`Price`](#class-price)

##### Returns

[`Price`](#class-price)

***

#### sub()

> **sub**(`value`): [`Price`](#class-price)

Defined in: [src/utils/BigInt.ts:230](https://github.com/centrifuge/sdk/blob/ae12cdce6833f297c221dbc7667d8a8a900a03f0/src/utils/BigInt.ts#L230)

##### Parameters

###### value

`bigint` | [`Price`](#class-price)

##### Returns

[`Price`](#class-price)

***

#### toBigInt()

> **toBigInt**(): `bigint`

Defined in: [src/utils/BigInt.ts:21](https://github.com/centrifuge/sdk/blob/ae12cdce6833f297c221dbc7667d8a8a900a03f0/src/utils/BigInt.ts#L21)

##### Returns

`bigint`

##### Inherited from

`DecimalWrapper.toBigInt`

***

#### toDecimal()

> **toDecimal**(): `Decimal`

Defined in: [src/utils/BigInt.ts:43](https://github.com/centrifuge/sdk/blob/ae12cdce6833f297c221dbc7667d8a8a900a03f0/src/utils/BigInt.ts#L43)

##### Returns

`Decimal`

##### Inherited from

`DecimalWrapper.toDecimal`

***

#### toFloat()

> **toFloat**(): `number`

Defined in: [src/utils/BigInt.ts:47](https://github.com/centrifuge/sdk/blob/ae12cdce6833f297c221dbc7667d8a8a900a03f0/src/utils/BigInt.ts#L47)

##### Returns

`number`

##### Inherited from

`DecimalWrapper.toFloat`

***

#### toString()

> **toString**(): `string`

Defined in: [src/utils/BigInt.ts:17](https://github.com/centrifuge/sdk/blob/ae12cdce6833f297c221dbc7667d8a8a900a03f0/src/utils/BigInt.ts#L17)

##### Returns

`string`

##### Inherited from

`DecimalWrapper.toString`

***

#### fromFloat()

> `static` **fromFloat**(`number`): [`Price`](#class-price)

Defined in: [src/utils/BigInt.ts:222](https://github.com/centrifuge/sdk/blob/ae12cdce6833f297c221dbc7667d8a8a900a03f0/src/utils/BigInt.ts#L222)

##### Parameters

###### number

`Numeric`

##### Returns

[`Price`](#class-price)
