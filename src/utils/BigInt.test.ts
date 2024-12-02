import { expect } from 'chai'
import { BigIntWrapper, Currency, DecimalWrapper, Price, Rate, Token } from './BigInt.js'
import { Dec } from './decimal.js'

describe('utils/BigInt', () => {
  describe('BigIntWrapper', () => {
    class TestBigIntWrapper extends BigIntWrapper {}
    const conversionCases = [
      { type: 'bigint', input: 1000n, expected: { bigint: 1000n, decimal: '1000' } },
      { type: 'decimal', input: Dec(1000.1), expected: { bigint: 1000n, decimal: '1000' } },
      { type: 'string', input: '1000', expected: { bigint: 1000n, decimal: '1000' } },
    ]
    conversionCases.forEach(({ type, input, expected }) => {
      it(`should convert ${type}`, () => {
        const a = new TestBigIntWrapper(input)
        expect(a.toBigInt()).to.be.equal(expected.bigint)
        expect(a.toString()).to.be.equal(expected.decimal)
      })
    })
  })
  describe('DecimalWrapper', () => {
    const conversionCases = [
      {
        title: 'decimal',
        input: DecimalWrapper._fromFloat(Dec(10.1), 6),
        expected: { bigint: 10_100_000n, decimal: '10.1', string: '10100000' },
      },
      {
        title: 'string',
        input: DecimalWrapper._fromFloat('1000', 6),
        expected: { bigint: 1000_000_000n, decimal: '1000', string: '1000000000' },
      },
      {
        title: 'number',
        input: DecimalWrapper._fromFloat(1000, 6),
        expected: { bigint: 1000_000_000n, decimal: '1000', string: '1000000000' },
      },
      {
        title: 'bigint',
        input: new DecimalWrapper(1000n, 6),
        expected: { bigint: 1000n, decimal: '0.001', string: '1000' },
      },
    ]
    conversionCases.forEach(({ title, input, expected }) => {
      it(`should convert ${title} to DecimalWrapper`, () => {
        expect(input.toBigInt()).to.be.equal(expected.bigint)
        expect(input.toString()).to.be.equal(expected.string)
        expect(input.toDecimal().toString()).to.be.equal(expected.decimal)
      })
    })
    it('should throw an error when a number passed to fromFloat is too small', () => {
      const fromFloat = () => DecimalWrapper._fromFloat(0.0000001, 6)
      expect(fromFloat).to.throw()
    })
    const arithmeticCases = [
      {
        title: 'DecimalWrapper + bigint',
        input: new DecimalWrapper(1000n, 6)._add<DecimalWrapper>(1000n),
        expected: { bigint: 2000n, decimal: '0.002', string: '2000' },
      },
      {
        title: 'DecimalWrapper + DecimalWrapper.fromFloat',
        input: new DecimalWrapper(1000n, 6)._add<DecimalWrapper>(DecimalWrapper._fromFloat(0.001, 6)),
        expected: { bigint: 2000n, decimal: '0.002', string: '2000' },
      },
      {
        title: 'DecimalWrapper - bigint',
        input: new DecimalWrapper(1000n, 6)._sub<DecimalWrapper>(1000n),
        expected: { bigint: 0n, decimal: '0', string: '0' },
      },
      {
        title: 'DecimalWrapper - DecimalWrapper.fromFloat',
        input: new DecimalWrapper(1000n, 6)._sub<DecimalWrapper>(DecimalWrapper._fromFloat(0.001, 6)),
        expected: { bigint: 0n, decimal: '0', string: '0' },
      },
      {
        title: 'DecimalWrapper * bigint',
        input: new DecimalWrapper(1000n, 3)._mul<DecimalWrapper>(2000n),
        expected: { bigint: 2000n, decimal: '2', string: '2000' },
      },
      {
        title: 'DecimalWrapper * DecimalWrapper.fromFloat on numbers that are too small and result in 0',
        input: new DecimalWrapper(1000n, 6)._mul<DecimalWrapper>(DecimalWrapper._fromFloat(0.0002, 6)),
        expected: { bigint: 0n, decimal: '0', string: '0' },
      },
      {
        title: 'DecimalWrapper * DecimalWrapper.fromFloat',
        input: new DecimalWrapper(1000n, 6)._mul<DecimalWrapper>(DecimalWrapper._fromFloat(2, 6)),
        expected: { bigint: 2000n, decimal: '0.002', string: '2000' },
      },
      {
        title: 'DecimalWrapper / bigint',
        input: new DecimalWrapper(1000n, 6)._div<DecimalWrapper>(2n),
        expected: { bigint: 500n, decimal: '0.0005', string: '500' },
      },
      {
        title: 'DecimalWrapper / DecimalWrapper.fromFloat',
        input: new DecimalWrapper(1000n, 6)._div<DecimalWrapper>(DecimalWrapper._fromFloat(0.000002, 6)),
        expected: { bigint: 500n, decimal: '0.0005', string: '500' },
      },
    ]
    arithmeticCases.forEach(({ title, input, expected }) => {
      it(`should do ${title}`, () => {
        expect(input.toBigInt()).to.be.equal(expected.bigint)
        expect(input.toString()).to.be.equal(expected.string)
        expect(input.toDecimal().toString()).to.be.equal(expected.decimal)
      })
    })
    const comparisonCases = [
      {
        title: 'DecimalWrapper to DecimalWrapper',
        a: new DecimalWrapper(1000n, 6),
        b: new DecimalWrapper(1000n, 6),
        expected: { lt: false, lte: true, gt: false, gte: true },
      },
      {
        title: 'DecimalWrapper to bigint',
        a: new DecimalWrapper(1000n, 6),
        b: 1000n,
        expected: { lt: false, lte: true, gt: false, gte: true },
      },
      {
        title: 'DecimalWrapper to DecimalWrapper',
        a: new DecimalWrapper(0n, 6),
        b: new DecimalWrapper(1000n, 6),
        expected: { lt: true, lte: true, gt: false, gte: false },
      },
      {
        title: 'DecimalWrapper to bigint',
        a: new DecimalWrapper(0n, 6),
        b: 1000n,
        expected: { lt: true, lte: true, gt: false, gte: false },
      },
      {
        title: 'DecimalWrapper to bigint',
        a: new DecimalWrapper(0n, 6),
        b: -1n,
        expected: { lt: false, lte: false, gt: true, gte: true },
      },
    ]
    comparisonCases.forEach(({ title, a, b, expected }) => {
      it(`should compare ${title}`, () => {
        expect(a.lt<DecimalWrapper>(b)).to.be.equal(expected.lt)
        expect(a.lte<DecimalWrapper>(b)).to.be.equal(expected.lte)
        expect(a.gt<DecimalWrapper>(b)).to.be.equal(expected.gt)
        expect(a.gte<DecimalWrapper>(b)).to.be.equal(expected.gte)
      })
    })
  })
  describe('Currency', () => {
    const conversionCases = [
      {
        title: 'decimal',
        input: Currency.fromFloat(Dec(1000.1), 6),
        expected: { decimal: '1000.1', float: 1000.1, bigint: 1_000_100_000n, string: '1000100000' },
      },
      {
        title: 'string',
        input: Currency.fromFloat('1000', 6),
        expected: { decimal: '1000', float: 1000, bigint: 1_000_000_000n, string: '1000000000' },
      },
      {
        title: 'number',
        input: Currency.fromFloat(1000, 6),
        expected: { decimal: '1000', float: 1000, bigint: 1_000_000_000n, string: '1000000000' },
      },
      {
        title: 'bigint',
        input: new Currency(1000n, 6),
        expected: { decimal: '0.001', float: 0.001, bigint: 1000n, string: '1000' },
      },
    ]
    conversionCases.forEach(({ title, input, expected }) => {
      it(`should convert ${title} to Currency`, () => {
        expect(input.toBigInt()).to.be.equal(expected.bigint)
        expect(input.toString()).to.be.equal(expected.string)
        expect(input.toFloat()).to.be.equal(expected.float)
        expect(input.toDecimal().toString()).to.be.equal(expected.decimal)
      })
    })
    const arithmeticCases = [
      {
        title: 'Currency + bigint',
        input: new Currency(1000n, 6).add(1000n),
        expected: { bigint: 2000n, float: 0.002, decimal: '0.002', string: '2000' },
      },
      {
        title: 'Currency + Currency.fromFloat',
        input: new Currency(1000n, 6).add(Currency.fromFloat(0.001, 6)),
        expected: { bigint: 2000n, float: 0.002, decimal: '0.002', string: '2000' },
      },
      {
        title: 'Currency - bigint',
        input: new Currency(1000n, 6).sub(500n),
        expected: { bigint: 500n, float: 0.0005, decimal: '0.0005', string: '500' },
      },
      {
        title: 'Currency - Currency.fromFloat',
        input: new Currency(1000n, 6).sub(Currency.fromFloat(0.0005, 6)),
        expected: { bigint: 500n, float: 0.0005, decimal: '0.0005', string: '500' },
      },
      {
        title: 'Currency * bigint',
        input: new Currency(1000n, 3).mul(2000n),
        expected: { bigint: 2000n, float: 2, decimal: '2', string: '2000' },
      },
      {
        title: 'Currency * Currency',
        input: new Currency(1_000_000_000n, 6).mul(new Currency(2_000_000_000n, 6)),
        expected: {
          bigint: 2_000_000_000_000n,
          float: 2000000,
          decimal: '2000000',
          string: '2000000000000',
        },
      },
      {
        title: 'Currency * Currency.fromFloat(float)',
        input: new Currency(1_000_000n, 6).mul(Currency.fromFloat(1.000001, 6)),
        expected: { bigint: 1_000_001n, float: 1.000001, decimal: '1.000001', string: '1000001' },
      },
      {
        title: 'Currency * Currency.fromFloat(Dec)',
        input: new Currency(20_000_000_000_000n, 6).mul(Currency.fromFloat(Dec(1.1), 6)),
        expected: { bigint: 22_000_000_000_000n, float: 22000000, decimal: '22000000', string: '22000000000000' },
      },
      {
        title: 'Currency * Currency',
        input: new Currency(1_566_119_435n, 6).mul(new Currency(1_000_000n, 6)),
        expected: {
          bigint: 1_566_119_435n,
          float: 1566.119435,
          decimal: '1566.119435',
          string: '1566119435',
        },
      },
      {
        title: 'Currency * Currency',
        input: Currency.fromFloat(1, 6).mul(new Price(1010000000000000000n)),
        expected: { bigint: 1_010_000n, float: 1.01, decimal: '1.01', string: '1010000' },
      },
      {
        title: 'Currency * Currency',
        input: Currency.fromFloat(1, 6).mul(Price.fromFloat(1.01)),
        expected: { bigint: 1_010_000n, float: 1.01, decimal: '1.01', string: '1010000' },
      },
      {
        title: 'Currency / bigint',
        input: new Currency(1000n, 6).div(2n),
        expected: { bigint: 500n, float: 0.0005, decimal: '0.0005', string: '500' },
      },
      {
        title: 'Currency / Currency.fromFloat',
        input: new Currency(1000n, 6).div(Currency.fromFloat(0.000002, 6)),
        expected: { bigint: 500n, float: 0.0005, decimal: '0.0005', string: '500' },
      },
      {
        title: 'Currency * Token.toBigInt()',
        input: new Currency(100n, 2).mul(new Token(100n, 4).toBigInt()),
        expected: { bigint: 100n, float: 1, decimal: '1', string: '100' },
      },
      {
        title: 'Currency * Token.toBigInt()',
        input: new Currency(100n, 2).mul(Token.fromFloat(0.000001, 6).toBigInt()),
        expected: { bigint: 1n, float: 0.01, decimal: '0.01', string: '1' },
      },
      {
        title: 'Currency mulPrice Currency',
        input: new Currency(1_000_000n, 6).mul(Price.fromFloat(1.01)),
        expected: { bigint: 1_010_000n, float: 1.01, decimal: '1.01', string: '1010000' },
      },
      {
        title: 'Currency mulPrice Currency',
        input: Currency.fromFloat(1, 6).mul(new Price(1010000000000000000n)),
        expected: { bigint: 1_010_000n, float: 1.01, decimal: '1.01', string: '1010000' },
      },
    ]
    arithmeticCases.forEach(({ title, input, expected }) => {
      it(`should do ${title}`, () => {
        expect(input.toBigInt()).to.be.equal(expected.bigint)
        expect(input.toFloat()).to.be.equal(expected.float)
        expect(input.toString()).to.be.equal(expected.string)
        expect(input.toDecimal().toString()).to.be.equal(expected.decimal)
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
