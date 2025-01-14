
## Class: ~~Perquintill~~

Defined in: [src/utils/BigInt.ts:246](https://github.com/centrifuge/sdk/blob/862f7f1e7a8d6021f967d75a29f9dd861d4ba104/src/utils/BigInt.ts#L246)

### Deprecated

### Extends

- `DecimalWrapper`

### Constructors

#### new Perquintill()

> **new Perquintill**(`value`): [`Perquintill`](#class-perquintill)

Defined in: [src/utils/BigInt.ts:249](https://github.com/centrifuge/sdk/blob/862f7f1e7a8d6021f967d75a29f9dd861d4ba104/src/utils/BigInt.ts#L249)

##### Parameters

###### value

`bigint` | `Numeric`

##### Returns

[`Perquintill`](#class-perquintill)

##### Overrides

`DecimalWrapper.constructor`

### Properties

#### ~~decimals~~

> `readonly` **decimals**: `number` = `27`

Defined in: [src/utils/BigInt.ts:27](https://github.com/centrifuge/sdk/blob/862f7f1e7a8d6021f967d75a29f9dd861d4ba104/src/utils/BigInt.ts#L27)

##### Inherited from

`DecimalWrapper.decimals`

***

#### ~~value~~

> `protected` **value**: `bigint`

Defined in: [src/utils/BigInt.ts:3](https://github.com/centrifuge/sdk/blob/862f7f1e7a8d6021f967d75a29f9dd861d4ba104/src/utils/BigInt.ts#L3)

##### Inherited from

`DecimalWrapper.value`

***

#### ~~decimals~~

> `static` **decimals**: `number` = `18`

Defined in: [src/utils/BigInt.ts:247](https://github.com/centrifuge/sdk/blob/862f7f1e7a8d6021f967d75a29f9dd861d4ba104/src/utils/BigInt.ts#L247)

### Methods

#### ~~eq()~~

> **eq**\<`T`\>(`value`): `boolean`

Defined in: [src/utils/BigInt.ts:115](https://github.com/centrifuge/sdk/blob/862f7f1e7a8d6021f967d75a29f9dd861d4ba104/src/utils/BigInt.ts#L115)

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

Defined in: [src/utils/BigInt.ts:105](https://github.com/centrifuge/sdk/blob/862f7f1e7a8d6021f967d75a29f9dd861d4ba104/src/utils/BigInt.ts#L105)

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

Defined in: [src/utils/BigInt.ts:110](https://github.com/centrifuge/sdk/blob/862f7f1e7a8d6021f967d75a29f9dd861d4ba104/src/utils/BigInt.ts#L110)

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

Defined in: [src/utils/BigInt.ts:119](https://github.com/centrifuge/sdk/blob/862f7f1e7a8d6021f967d75a29f9dd861d4ba104/src/utils/BigInt.ts#L119)

##### Returns

`boolean`

##### Inherited from

`DecimalWrapper.isZero`

***

#### ~~lt()~~

> **lt**\<`T`\>(`value`): `boolean`

Defined in: [src/utils/BigInt.ts:95](https://github.com/centrifuge/sdk/blob/862f7f1e7a8d6021f967d75a29f9dd861d4ba104/src/utils/BigInt.ts#L95)

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

Defined in: [src/utils/BigInt.ts:100](https://github.com/centrifuge/sdk/blob/862f7f1e7a8d6021f967d75a29f9dd861d4ba104/src/utils/BigInt.ts#L100)

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

#### ~~toBigInt()~~

> **toBigInt**(): `bigint`

Defined in: [src/utils/BigInt.ts:21](https://github.com/centrifuge/sdk/blob/862f7f1e7a8d6021f967d75a29f9dd861d4ba104/src/utils/BigInt.ts#L21)

##### Returns

`bigint`

##### Inherited from

`DecimalWrapper.toBigInt`

***

#### ~~toDecimal()~~

> **toDecimal**(): `Decimal`

Defined in: [src/utils/BigInt.ts:43](https://github.com/centrifuge/sdk/blob/862f7f1e7a8d6021f967d75a29f9dd861d4ba104/src/utils/BigInt.ts#L43)

##### Returns

`Decimal`

##### Inherited from

`DecimalWrapper.toDecimal`

***

#### ~~toFloat()~~

> **toFloat**(): `number`

Defined in: [src/utils/BigInt.ts:47](https://github.com/centrifuge/sdk/blob/862f7f1e7a8d6021f967d75a29f9dd861d4ba104/src/utils/BigInt.ts#L47)

##### Returns

`number`

##### Inherited from

`DecimalWrapper.toFloat`

***

#### ~~toPercent()~~

> **toPercent**(): `Decimal`

Defined in: [src/utils/BigInt.ts:261](https://github.com/centrifuge/sdk/blob/862f7f1e7a8d6021f967d75a29f9dd861d4ba104/src/utils/BigInt.ts#L261)

##### Returns

`Decimal`

***

#### ~~toString()~~

> **toString**(): `string`

Defined in: [src/utils/BigInt.ts:17](https://github.com/centrifuge/sdk/blob/862f7f1e7a8d6021f967d75a29f9dd861d4ba104/src/utils/BigInt.ts#L17)

##### Returns

`string`

##### Inherited from

`DecimalWrapper.toString`

***

#### ~~fromFloat()~~

> `static` **fromFloat**(`number`): [`Perquintill`](#class-perquintill)

Defined in: [src/utils/BigInt.ts:253](https://github.com/centrifuge/sdk/blob/862f7f1e7a8d6021f967d75a29f9dd861d4ba104/src/utils/BigInt.ts#L253)

##### Parameters

###### number

`Numeric`

##### Returns

[`Perquintill`](#class-perquintill)

***

#### ~~fromPercent()~~

> `static` **fromPercent**(`number`): [`Perquintill`](#class-perquintill)

Defined in: [src/utils/BigInt.ts:257](https://github.com/centrifuge/sdk/blob/862f7f1e7a8d6021f967d75a29f9dd861d4ba104/src/utils/BigInt.ts#L257)

##### Parameters

###### number

`Numeric`

##### Returns

[`Perquintill`](#class-perquintill)
