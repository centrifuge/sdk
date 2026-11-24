import DecimalLight, { type Numeric, type Decimal as DecimalJsType } from 'decimal.js-light'

const Decimal = DecimalLight.default || DecimalLight

Decimal.set({
  precision: 30,
  toExpNeg: -7,
  toExpPos: 29,
  rounding: Decimal.ROUND_HALF_CEIL,
})

export function Dec(value: Numeric) {
  return new Decimal(value)
}

export type { Numeric }
export { Decimal, DecimalJsType }
