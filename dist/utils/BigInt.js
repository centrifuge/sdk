import { Dec, Decimal } from './decimal.js';
export class BigIntWrapper {
    value;
    constructor(value) {
        if (typeof value === 'bigint') {
            this.value = value;
        }
        else if (value instanceof Decimal) {
            this.value = BigInt(value.toFixed(0));
        }
        else if (typeof value === 'number') {
            this.value = BigInt(Math.floor(value));
        }
        else {
            this.value = BigInt(String(value).split('.')[0] || '0');
        }
    }
    toString() {
        return this.value.toString();
    }
    toBigInt() {
        return this.value;
    }
}
export class DecimalWrapper extends BigIntWrapper {
    decimals;
    constructor(value, decimals) {
        super(value);
        this.decimals = decimals;
    }
    /** @internal */
    static _fromFloat(num, decimals) {
        const n = Dec(num.toString()).mul(Dec(10).pow(decimals));
        if (Dec(n).gt(0) && Dec(n).lt(1)) {
            throw new Error(`${num} is too small to be represented with ${decimals} decimals`);
        }
        return new this(n.toDecimalPlaces(0), decimals);
    }
    toDecimal() {
        return Dec(this.value.toString()).div(Dec(10).pow(this.decimals));
    }
    toFloat() {
        return this.toDecimal().toNumber();
    }
    scale(targetDecimals) {
        if (targetDecimals === this.decimals) {
            return this;
        }
        return Balance.fromFloat(this.toDecimal(), targetDecimals);
    }
    /** @internal */
    _add(value) {
        const val = typeof value === 'bigint' ? value : value.toBigInt();
        return new this.constructor(this.value + val, this.decimals);
    }
    /** @internal */
    _sub(value) {
        const val = typeof value === 'bigint' ? value : value.toBigInt();
        return this._add(-val);
    }
    /**
     * a._mul(b) will preserve the decimals of a
     * @example
     * Currency.fromFloat(1, 6).mul(Price.fromFloat(1.01))
     * // Price has 18 decimals
     * // returns Currency with 6 decimals (1_010_000n or 1.01)
     *
     * @internal
     */
    _mul(value) {
        let val;
        if (typeof value === 'bigint') {
            val = Dec(value.toString());
        }
        else if (value instanceof Decimal) {
            val = value.mul(Dec(10).pow(this.decimals));
        }
        else {
            val = value.toDecimal().mul(Dec(10).pow(this.decimals));
        }
        return new this.constructor(this.toDecimal().mul(val), this.decimals);
    }
    /** @internal */
    _div(value) {
        if (!value) {
            throw new Error(`Division by zero`);
        }
        if (typeof value === 'bigint') {
            return new this.constructor(this.value / value, this.decimals);
        }
        if (value instanceof Decimal) {
            return new this.constructor(this.value / BigInt(value.mul(Dec(10).pow(this.decimals)).toDecimalPlaces(0).toString()), this.decimals);
        }
        return new this.constructor(this.value / value.toBigInt(), this.decimals);
    }
    lt(value) {
        const val = typeof value === 'bigint' ? value : value.toBigInt();
        return this.value < val;
    }
    lte(value) {
        const val = typeof value === 'bigint' ? value : value.toBigInt();
        return this.value <= val;
    }
    gt(value) {
        const val = typeof value === 'bigint' ? value : value.toBigInt();
        return this.value > val;
    }
    gte(value) {
        const val = typeof value === 'bigint' ? value : value.toBigInt();
        return this.value >= val;
    }
    eq(value) {
        const val = typeof value === 'bigint' ? value : value.toBigInt();
        return this.value === val;
    }
    isZero() {
        return this.value === 0n;
    }
}
export class Balance extends DecimalWrapper {
    static fromFloat(num, decimals) {
        return Balance._fromFloat(num, decimals);
    }
    static ZERO = new Balance(0n, 0);
    add(value) {
        return this._add(value);
    }
    sub(value) {
        return this._sub(value);
    }
    mul(value) {
        return this._mul(value);
    }
    div(value) {
        return this._div(value);
    }
}
const secondsPerYear = Dec(60 * 60 * 24 * 365);
/**
 * @deprecated
 */
export class Rate extends DecimalWrapper {
    static decimals = 27;
    constructor(value) {
        super(value, 27);
    }
    static fromFloat(number) {
        return Rate._fromFloat(number, this.decimals);
    }
    static fromPercent(number) {
        return Rate.fromFloat(Dec(number.toString()).div(100));
    }
    static fromApr(apr) {
        const i = Dec(apr.toString());
        const rate = i.div(secondsPerYear).plus(1);
        return Rate.fromFloat(rate);
    }
    static fromAprPercent(apr) {
        return this.fromApr(Dec(apr.toString()).div(100));
    }
    toPercent() {
        return this.toDecimal().mul(100);
    }
    toApr() {
        const rate = this.toDecimal();
        if (rate.isZero()) {
            return rate;
        }
        return rate.minus(1).times(secondsPerYear);
    }
    toAprPercent() {
        return this.toApr().mul(100);
    }
}
export class Price extends DecimalWrapper {
    static decimals = 18;
    constructor(value) {
        super(value, 18);
    }
    static fromFloat(number) {
        return Price._fromFloat(number, this.decimals);
    }
    add(value) {
        return this._add(value);
    }
    sub(value) {
        return this._sub(value);
    }
    mul(value) {
        return this._mul(value);
    }
    div(value) {
        return this._div(value);
    }
}
/**
 * @deprecated
 */
export class Perquintill extends DecimalWrapper {
    static decimals = 18;
    constructor(value) {
        super(value, 18);
    }
    static fromFloat(number) {
        return Perquintill._fromFloat(number, this.decimals);
    }
    static fromPercent(number) {
        return Perquintill.fromFloat(Dec(number).div(100));
    }
    toPercent() {
        return this.toDecimal().mul(100);
    }
}
//# sourceMappingURL=BigInt.js.map