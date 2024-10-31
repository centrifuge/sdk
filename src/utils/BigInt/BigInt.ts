import type { Decimal as DecimalType, Config, Numeric } from 'decimal.js-light'
import Decimal from 'decimal.js-light'

Decimal.set({
  precision: 30,
  toExpNeg: -7,
  toExpPos: 29,
  rounding: Decimal.ROUND_HALF_CEIL, // ROUND_HALF_CEIL is 1
})

export function Dec(value: Numeric) {
  return new Decimal(value)
}

abstract class BigIntWrapper {
  protected value: bigint

  constructor(value: Numeric | bigint) {
    if (typeof value === 'bigint') {
      this.value = value
    } else if (value instanceof Decimal) {
      this.value = BigInt(value.toFixed(0))
    } else if (typeof value === 'number') {
      this.value = BigInt(Math.floor(value))
    } else {
      this.value = BigInt(String(value).split('.')[0] || '0')
    }
  }

  toString() {
    return this.value.toString()
  }

  toBigInt() {
    return this.value
  }
}

class DecimalWrapper extends BigIntWrapper {
  protected decimals: number

  constructor(value: Numeric | bigint, decimals: number) {
    super(value)
    this.decimals = decimals
  }

  static _fromFloat<T extends DecimalWrapper>(num: Numeric, decimals: number) {
    const n = Dec(num.toString()).mul(Dec(10).pow(decimals)).toDecimalPlaces(0).toString()
    return new (this as any)(n, decimals) as T
  }

  toDecimal() {
    return Dec(this.value.toString()).div(Dec(10).pow(this.decimals))
  }

  toFloat() {
    return this.toDecimal().toNumber()
  }

  _add<T>(value: bigint): T {
    return new (this.constructor as any)(this.value + value, this.decimals)
  }

  _sub<T>(value: bigint): T {
    return this._add<T>(-value)
  }

  _mul<T>(value: bigint): T {
    return new (this.constructor as any)(this.value * value, this.decimals)
  }

  _div<T>(value: bigint): T {
    if (value === 0n) {
      throw new Error('Division by zero')
    }
    return new (this.constructor as any)(this.value / value, this.decimals)
  }
}

export class Currency extends DecimalWrapper {
  static fromFloat(num: Numeric, decimals: number) {
    return Currency._fromFloat<Currency>(num, decimals)
  }

  add(value: bigint) {
    return this._add<Currency>(value)
  }

  sub(value: bigint) {
    return this._sub<Currency>(value)
  }

  mul(value: bigint) {
    return this._mul<Currency>(value)
  }

  div(value: bigint) {
    return this._div<Currency>(value)
  }
}

export class Token extends Currency {
  static override fromFloat(number: Numeric, decimals: number) {
    const n = Dec(number.toString()).mul(Dec(10).pow(decimals)).toDecimalPlaces(0).toString()
    return new Token(n, decimals)
  }

  override add(value: bigint) {
    return this._add<Token>(value)
  }

  override sub(value: bigint) {
    return this._sub<Token>(value)
  }

  override mul(value: bigint) {
    return this._mul<Token>(value)
  }

  override div(value: bigint) {
    return this._div<Token>(value)
  }
}

const secondsPerYear = Dec(60 * 60 * 24 * 365)
export class Rate extends DecimalWrapper {
  static decimals = 27

  static fromFloat(number: Numeric) {
    return Rate._fromFloat<Rate>(number, this.decimals)
  }

  static fromPercent(number: Numeric) {
    return Rate.fromFloat(Dec(number.toString()).div(100))
  }

  static fromApr(apr: Numeric) {
    const i = Dec(apr.toString())
    const rate = i.div(secondsPerYear).plus(1)
    return Rate.fromFloat(rate)
  }

  static fromAprPercent(apr: Numeric) {
    return this.fromApr(Dec(apr.toString()).div(100))
  }

  toPercent() {
    return this.toDecimal().mul(100)
  }

  toApr() {
    const rate = this.toDecimal()
    if (rate.isZero()) {
      return rate
    }
    return rate.minus(1).times(secondsPerYear)
  }

  toAprPercent() {
    return this.toApr().mul(100)
  }
}

export class Price extends DecimalWrapper {
  static decimals = 18

  static fromFloat(number: Numeric) {
    return Price._fromFloat<Price>(number, this.decimals)
  }
}

export class Perquintill extends DecimalWrapper {
  static decimals = 18

  static fromFloat(number: Numeric) {
    return Perquintill._fromFloat<Perquintill>(number, this.decimals)
  }

  static fromPercent(number: Numeric) {
    return Perquintill.fromFloat(Dec(number).div(100))
  }

  toPercent() {
    return this.toDecimal().mul(100)
  }
}
