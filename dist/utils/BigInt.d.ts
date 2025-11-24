import { DecimalJsType, type Numeric } from './decimal.js';
export declare abstract class BigIntWrapper {
    protected value: bigint;
    constructor(value: Numeric | bigint);
    toString(): string;
    toBigInt(): bigint;
}
export declare class DecimalWrapper extends BigIntWrapper {
    readonly decimals: number;
    constructor(value: Numeric | bigint, decimals: number);
    toDecimal(): DecimalJsType;
    toFloat(): number;
    scale(targetDecimals: number): Balance;
    lt<T>(value: bigint | (T extends BigIntWrapper ? T : never)): boolean;
    lte<T>(value: bigint | (T extends BigIntWrapper ? T : never)): boolean;
    gt<T>(value: bigint | (T extends BigIntWrapper ? T : never)): boolean;
    gte<T>(value: bigint | (T extends BigIntWrapper ? T : never)): boolean;
    eq<T>(value: bigint | (T extends BigIntWrapper ? T : never)): boolean;
    isZero(): boolean;
}
export declare class Balance extends DecimalWrapper {
    static fromFloat(num: Numeric, decimals: number): Balance;
    static ZERO: Balance;
    add(value: bigint | Balance): Balance;
    sub(value: bigint | Balance): Balance;
    mul(value: bigint | Balance | Price | DecimalJsType): Balance;
    div(value: bigint | Balance | DecimalJsType): Balance;
}
/**
 * @deprecated
 */
export declare class Rate extends DecimalWrapper {
    static decimals: number;
    constructor(value: Numeric | bigint);
    static fromFloat(number: Numeric): Rate;
    static fromPercent(number: Numeric): Rate;
    static fromApr(apr: Numeric): Rate;
    static fromAprPercent(apr: Numeric): Rate;
    toPercent(): DecimalJsType;
    toApr(): DecimalJsType;
    toAprPercent(): DecimalJsType;
}
export declare class Price extends DecimalWrapper {
    static decimals: number;
    constructor(value: Numeric | bigint);
    static fromFloat(number: Numeric): Price;
    add(value: bigint | Price): Price;
    sub(value: bigint | Price): Price;
    mul(value: bigint | Price | DecimalJsType): Price;
    div(value: bigint | Price): Price;
}
/**
 * @deprecated
 */
export declare class Perquintill extends DecimalWrapper {
    static decimals: number;
    constructor(value: Numeric | bigint);
    static fromFloat(number: Numeric): Perquintill;
    static fromPercent(number: Numeric): Perquintill;
    toPercent(): DecimalJsType;
}
//# sourceMappingURL=BigInt.d.ts.map