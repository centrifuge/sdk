import { expect } from 'chai'
import { BigIntWrapper, Currency, Dec, DecimalWrapper, Rate, Token } from './BigInt.js'

describe('utils/BigInt', () => {
  describe('BigIntWrapper', () => {
    class TestBigIntWrapper extends BigIntWrapper {}
    const cases = [
      { type: 'bigint', input: 1000n, expected: { bigint: 1000n, decimal: '1000' } },
      { type: 'decimal', input: Dec(1000.1), expected: { bigint: 1000n, decimal: '1000' } },
      { type: 'string', input: '1000', expected: { bigint: 1000n, decimal: '1000' } },
    ]
    cases.forEach(({ type, input, expected }) => {
      it(`should convert ${type}`, () => {
        const a = new TestBigIntWrapper(input)
        expect(a.toBigInt()).to.be.equal(expected.bigint)
        expect(a.toString()).to.be.equal(expected.decimal)
      })
    })
  })
  describe('DecimalWrapper', () => {
    const cases = [
      { type: 'decimal', input: Dec(10.1), expected: { bigint: 10100000n, decimal: '10.1', string: '10100000' } },
      { type: 'string', input: '1000', expected: { bigint: 1000_000_000n, decimal: '1000', string: '1000000000' } },
      { type: 'number', input: 1000, expected: { bigint: 1000_000_000n, decimal: '1000', string: '1000000000' } },
    ]
    cases.forEach(({ type, input, expected }) => {
      it(`should convert ${type}`, () => {
        const a = DecimalWrapper._fromFloat(input, 6)
        expect(a.toBigInt()).to.be.equal(expected.bigint)
        expect(a.toString()).to.be.equal(expected.string)
        expect(a.toDecimal().toString()).to.be.equal(expected.decimal)
      })
    })
    it(`should convert bigint`, () => {
      const a = new DecimalWrapper(1000n, 6)
      expect(a.toBigInt()).to.be.equal(1000n)
      expect(a.toString()).to.be.equal('1000')
      expect(a.toDecimal().toString()).to.be.equal('0.001')
    })
    const additionCases = [
      { type: 'bigint', input: 1000n, expected: { bigint: 2000n, decimal: '0.002', string: '2000' } },
      {
        type: 'DecimalWrapper',
        input: DecimalWrapper._fromFloat(0.001, 6),
        expected: { bigint: 2000n, decimal: '0.002', string: '2000' },
      },
    ]
    additionCases.forEach(({ type, input, expected }) => {
      it(`should add ${type}`, () => {
        const a = new DecimalWrapper(1000n, 6)._add<DecimalWrapper>(input)
        expect(a.toBigInt()).to.be.equal(expected.bigint)
        expect(a.toString()).to.be.equal(expected.string)
        expect(a.toDecimal().toString()).to.be.equal(expected.decimal)
      })
    })
    const subtractionCases = [
      { type: 'bigint', input: 1000n, expected: { bigint: 0n, decimal: '0', string: '0' } },
      {
        type: 'DecimalWrapper',
        input: DecimalWrapper._fromFloat(0.001, 6),
        expected: { bigint: 0n, decimal: '0', string: '0' },
      },
    ]
    subtractionCases.forEach(({ type, input, expected }) => {
      it(`should subtract ${type}`, () => {
        const a = new DecimalWrapper(1000n, 6)._sub<DecimalWrapper>(input)
        expect(a.toBigInt()).to.be.equal(expected.bigint)
        expect(a.toString()).to.be.equal(expected.string)
        expect(a.toDecimal().toString()).to.be.equal(expected.decimal)
      })
    })
    const multiplicationCases = [
      { type: 'bigint', input: 200n, expected: { bigint: 200_000n, decimal: '0.2', string: '200000' } },
      {
        type: 'DecimalWrapper',
        input: DecimalWrapper._fromFloat(0.0002, 6),
        expected: { bigint: 200_000n, decimal: '0.2', string: '200000' },
      },
    ]
    multiplicationCases.forEach(({ type, input, expected }) => {
      it(`should multiply ${type}`, () => {
        const a = new DecimalWrapper(1000n, 6)._mul<DecimalWrapper>(input)
        expect(a.toBigInt()).to.be.equal(expected.bigint)
        expect(a.toString()).to.be.equal(expected.string)
        expect(a.toDecimal().toString()).to.be.equal(expected.decimal)
      })
    })
    const divisionCases = [
      { type: 'bigint', input: 2n, expected: { bigint: 500n, decimal: '0.0005', string: '500' } },
      {
        type: 'DecimalWrapper',
        input: DecimalWrapper._fromFloat(0.000002, 6),
        expected: { bigint: 500n, decimal: '0.0005', string: '500' },
      },
    ]
    divisionCases.forEach(({ type, input, expected }) => {
      it(`should divide ${type}`, () => {
        const a = new DecimalWrapper(1000n, 6)._div<DecimalWrapper>(input)
        expect(a.toBigInt()).to.be.equal(expected.bigint)
        expect(a.toString()).to.be.equal(expected.string)
        expect(a.toDecimal().toString()).to.be.equal(expected.decimal)
      })
    })
  })
  describe('Currency', () => {
    const conversionCases = [
      {
        type: 'decimal',
        input: Dec(1000.1),
        expected: { decimal: '1000.1', float: 1000.1, bigint: 1000100000n, string: '1000100000' },
      },
      {
        type: 'string',
        input: '1000',
        expected: { decimal: '1000', float: 1000, bigint: 1000000000n, string: '1000000000' },
      },
      {
        type: 'number',
        input: 1000,
        expected: { decimal: '1000', float: 1000, bigint: 1000000000n, string: '1000000000' },
      },
    ]
    conversionCases.forEach(({ type, input, expected }) => {
      it(`should convert ${type} to Currency`, () => {
        const currency = Currency.fromFloat(input, 6)
        expect(currency.toBigInt()).to.be.equal(expected.bigint)
        expect(currency.toString()).to.be.equal(expected.string)
        expect(currency.toFloat()).to.be.equal(expected.float)
        expect(currency.toDecimal().toString()).to.be.equal(expected.decimal)
      })
    })
    it(`should convert bigint to Currency`, () => {
      const currency = new Currency(1000n, 6)
      expect(currency.toBigInt()).to.be.equal(1000n)
      expect(currency.toString()).to.be.equal('1000')
      expect(currency.toFloat()).to.be.equal(0.001)
      expect(currency.toDecimal().toString()).to.be.equal('0.001')
    })
    const additionCases = [
      {
        type: 'bigint',
        input: 1000n,
        expected: { bigint: 2000n, float: 0.002, decimal: '0.002', string: '2000' },
      },
      {
        type: 'Currency',
        input: Currency.fromFloat(0.001, 6),
        expected: { bigint: 2000n, float: 0.002, decimal: '0.002', string: '2000' },
      },
    ]
    additionCases.forEach(({ type, input, expected }) => {
      it(`should add ${type} to Currency`, () => {
        const currency = new Currency(1000n, 6)
        const a = currency.add(input)
        expect(a.toBigInt()).to.be.equal(expected.bigint)
        expect(a.toFloat()).to.be.equal(expected.float)
        expect(a.toString()).to.be.equal(expected.string)
        expect(a.toDecimal().toString()).to.be.equal(expected.decimal)
      })
    })
    const subtractionCases = [
      {
        type: 'bigint',
        input: 500n,
        expected: { bigint: 500n, float: 0.0005, decimal: '0.0005', string: '500' },
      },
      {
        type: 'Currency',
        input: Currency.fromFloat(0.0005, 6),
        expected: { bigint: 500n, float: 0.0005, decimal: '0.0005', string: '500' },
      },
    ]
    subtractionCases.forEach(({ type, input, expected }) => {
      it(`should subtract ${type} by Currency`, () => {
        const currency = new Currency(1000n, 6)
        const a = currency.sub(input)
        expect(a.toBigInt()).to.be.equal(expected.bigint)
        expect(a.toFloat()).to.be.equal(expected.float)
        expect(a.toString()).to.be.equal(expected.string)
        expect(a.toDecimal().toString()).to.be.equal(expected.decimal)
      })
    })
    const multiplicationCases = [
      {
        type: 'bigint',
        input: 200n,
        expected: { bigint: 200_000n, float: 0.2, decimal: '0.2', string: '200000' },
      },
      {
        type: 'Currency',
        input: Currency.fromFloat(0.0002, 6),
        expected: { bigint: 200_000n, float: 0.2, decimal: '0.2', string: '200000' },
      },
    ]
    multiplicationCases.forEach(({ type, input, expected }) => {
      it(`should multiply ${type} by Currency`, () => {
        const currency = new Currency(1000n, 6)
        const a = currency.mul(input)
        expect(a.toBigInt()).to.be.equal(expected.bigint)
        expect(a.toFloat()).to.be.equal(expected.float)
        expect(a.toString()).to.be.equal(expected.string)
        expect(a.toDecimal().toString()).to.be.equal(expected.decimal)
      })
    })
    const divisionCases = [
      {
        type: 'bigint',
        input: 2n,
        expected: { bigint: 500n, float: 0.0005, decimal: '0.0005', string: '500' },
      },
      {
        type: 'Currency',
        input: Currency.fromFloat(0.000002, 6),
        expected: { bigint: 500n, float: 0.0005, decimal: '0.0005', string: '500' },
      },
    ]
    divisionCases.forEach(({ type, input, expected }) => {
      it(`should divide ${type} from Currency`, () => {
        const currency = new Currency(1000n, 6)
        const a = currency.div(input)
        expect(a.toBigInt()).to.be.equal(expected.bigint)
        expect(a.toFloat()).to.be.equal(expected.float)
        expect(a.toString()).to.be.equal(expected.string)
        expect(a.toDecimal().toString()).to.be.equal(expected.decimal)
      })
    })
  })
  describe('Rate', () => {
    it('should convert float to Rate', () => {
      const rate = Rate.fromFloat(0.9)
      expect(rate.toDecimal().toString()).to.be.equal('0.9')
      expect(rate.toString()).to.be.equal('900000000000000000000000000')
      expect(rate.toAprPercent().toString()).to.be.equal('-315360000')
      expect(rate.toApr().toString()).to.be.equal('-3153600')
      expect(rate.toAprPercent().toString()).to.be.equal('-315360000')
    })
  })
})
