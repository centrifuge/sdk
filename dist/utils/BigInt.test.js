import { expect } from 'chai';
import { Balance, BigIntWrapper, DecimalWrapper, Price, Rate } from './BigInt.js';
import { Dec } from './decimal.js';
describe('utils/BigInt', () => {
    describe('BigIntWrapper', () => {
        class TestBigIntWrapper extends BigIntWrapper {
        }
        const conversionCases = [
            { type: 'bigint', input: 1000n, expected: { bigint: 1000n, decimal: '1000' } },
            { type: 'decimal', input: Dec(1000.1), expected: { bigint: 1000n, decimal: '1000' } },
            { type: 'string', input: '1000', expected: { bigint: 1000n, decimal: '1000' } },
        ];
        conversionCases.forEach(({ type, input, expected }) => {
            it(`should convert ${type}`, () => {
                const a = new TestBigIntWrapper(input);
                expect(a.toBigInt()).to.be.equal(expected.bigint);
                expect(a.toString()).to.be.equal(expected.decimal);
            });
        });
    });
    describe('DecimalWrapper', () => {
        const conversionCases = [
            {
                title: 'decimal',
                input: DecimalWrapper._fromFloat(Dec(10.1), 6),
                expected: { bigint: 10100000n, decimal: '10.1', string: '10100000' },
            },
            {
                title: 'string',
                input: DecimalWrapper._fromFloat('1000', 6),
                expected: { bigint: 1000000000n, decimal: '1000', string: '1000000000' },
            },
            {
                title: 'number',
                input: DecimalWrapper._fromFloat(1000, 6),
                expected: { bigint: 1000000000n, decimal: '1000', string: '1000000000' },
            },
            {
                title: 'bigint',
                input: new DecimalWrapper(1000n, 6),
                expected: { bigint: 1000n, decimal: '0.001', string: '1000' },
            },
        ];
        conversionCases.forEach(({ title, input, expected }) => {
            it(`should convert ${title} to DecimalWrapper`, () => {
                expect(input.toBigInt()).to.be.equal(expected.bigint);
                expect(input.toString()).to.be.equal(expected.string);
                expect(input.toDecimal().toString()).to.be.equal(expected.decimal);
            });
        });
        it('should throw an error when a number passed to fromFloat is too small', () => {
            const fromFloat = () => DecimalWrapper._fromFloat(0.0000001, 6);
            expect(fromFloat).to.throw();
        });
        const arithmeticCases = [
            {
                title: 'DecimalWrapper + bigint',
                input: new DecimalWrapper(1000n, 6)._add(1000n),
                expected: { bigint: 2000n, decimal: '0.002', string: '2000' },
            },
            {
                title: 'DecimalWrapper + DecimalWrapper.fromFloat',
                input: new DecimalWrapper(1000n, 6)._add(DecimalWrapper._fromFloat(0.001, 6)),
                expected: { bigint: 2000n, decimal: '0.002', string: '2000' },
            },
            {
                title: 'DecimalWrapper - bigint',
                input: new DecimalWrapper(1000n, 6)._sub(1000n),
                expected: { bigint: 0n, decimal: '0', string: '0' },
            },
            {
                title: 'DecimalWrapper - DecimalWrapper.fromFloat',
                input: new DecimalWrapper(1000n, 6)._sub(DecimalWrapper._fromFloat(0.001, 6)),
                expected: { bigint: 0n, decimal: '0', string: '0' },
            },
            {
                title: 'DecimalWrapper * bigint',
                input: new DecimalWrapper(1000n, 3)._mul(2000n),
                expected: { bigint: 2000n, decimal: '2', string: '2000' },
            },
            {
                title: 'DecimalWrapper * DecimalWrapper.fromFloat on numbers that are too small and result in 0',
                input: new DecimalWrapper(1000n, 6)._mul(DecimalWrapper._fromFloat(0.0002, 6)),
                expected: { bigint: 0n, decimal: '0', string: '0' },
            },
            {
                title: 'DecimalWrapper * DecimalWrapper.fromFloat',
                input: new DecimalWrapper(1000n, 6)._mul(DecimalWrapper._fromFloat(2, 6)),
                expected: { bigint: 2000n, decimal: '0.002', string: '2000' },
            },
            {
                title: 'DecimalsWrapper * Decimal',
                input: new DecimalWrapper(1000n, 6)._mul(Dec(2)),
                expected: { bigint: 2000n, decimal: '0.002', string: '2000' },
            },
            {
                title: 'DecimalsWrapper * Decimal',
                input: new DecimalWrapper(1000n, 6)._mul(Dec(1.111)),
                expected: { bigint: 1111n, decimal: '0.001111', string: '1111' },
            },
            {
                title: 'DecimalWrapper / bigint',
                input: new DecimalWrapper(1000n, 6)._div(2n),
                expected: { bigint: 500n, decimal: '0.0005', string: '500' },
            },
            {
                title: 'DecimalWrapper / DecimalWrapper.fromFloat',
                input: new DecimalWrapper(1000n, 6)._div(DecimalWrapper._fromFloat(0.000002, 6)),
                expected: { bigint: 500n, decimal: '0.0005', string: '500' },
            },
        ];
        arithmeticCases.forEach(({ title, input, expected }) => {
            it(`should do ${title}`, () => {
                expect(input.toBigInt()).to.be.equal(expected.bigint);
                expect(input.toString()).to.be.equal(expected.string);
                expect(input.toDecimal().toString()).to.be.equal(expected.decimal);
            });
        });
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
        ];
        comparisonCases.forEach(({ title, a, b, expected }) => {
            it(`should compare ${title}`, () => {
                expect(a.lt(b)).to.be.equal(expected.lt);
                expect(a.lte(b)).to.be.equal(expected.lte);
                expect(a.gt(b)).to.be.equal(expected.gt);
                expect(a.gte(b)).to.be.equal(expected.gte);
            });
        });
    });
    describe('Balance', () => {
        const conversionCases = [
            {
                title: 'decimal',
                input: Balance.fromFloat(Dec(1000.1), 6),
                expected: { decimal: '1000.1', float: 1000.1, bigint: 1000100000n, string: '1000100000' },
            },
            {
                title: 'string',
                input: Balance.fromFloat('1000', 6),
                expected: { decimal: '1000', float: 1000, bigint: 1000000000n, string: '1000000000' },
            },
            {
                title: 'number',
                input: Balance.fromFloat(1000, 6),
                expected: { decimal: '1000', float: 1000, bigint: 1000000000n, string: '1000000000' },
            },
            {
                title: 'bigint',
                input: new Balance(1000n, 6),
                expected: { decimal: '0.001', float: 0.001, bigint: 1000n, string: '1000' },
            },
        ];
        conversionCases.forEach(({ title, input, expected }) => {
            it(`should convert ${title} to Balance`, () => {
                expect(input.toBigInt()).to.be.equal(expected.bigint);
                expect(input.toString()).to.be.equal(expected.string);
                expect(input.toFloat()).to.be.equal(expected.float);
                expect(input.toDecimal().toString()).to.be.equal(expected.decimal);
            });
        });
        const arithmeticCases = [
            {
                title: 'Balance + bigint',
                input: new Balance(1000n, 6).add(1000n),
                expected: { bigint: 2000n, float: 0.002, decimal: '0.002', string: '2000' },
            },
            {
                title: 'Balance + Balance.fromFloat',
                input: new Balance(1000n, 6).add(Balance.fromFloat(0.001, 6)),
                expected: { bigint: 2000n, float: 0.002, decimal: '0.002', string: '2000' },
            },
            {
                title: 'Balance - bigint',
                input: new Balance(1000n, 6).sub(500n),
                expected: { bigint: 500n, float: 0.0005, decimal: '0.0005', string: '500' },
            },
            {
                title: 'Balance - Balance.fromFloat',
                input: new Balance(1000n, 6).sub(Balance.fromFloat(0.0005, 6)),
                expected: { bigint: 500n, float: 0.0005, decimal: '0.0005', string: '500' },
            },
            {
                title: 'Balance * bigint',
                input: new Balance(1000n, 3).mul(2000n),
                expected: { bigint: 2000n, float: 2, decimal: '2', string: '2000' },
            },
            {
                title: 'Balance * Balance',
                input: new Balance(1000000000n, 6).mul(new Balance(2000000000n, 6)),
                expected: {
                    bigint: 2000000000000n,
                    float: 2000000,
                    decimal: '2000000',
                    string: '2000000000000',
                },
            },
            {
                title: 'Balance * Balance.fromFloat(float)',
                input: new Balance(1000000n, 6).mul(Balance.fromFloat(1.000001, 6)),
                expected: { bigint: 1000001n, float: 1.000001, decimal: '1.000001', string: '1000001' },
            },
            {
                title: 'Balance * Balance.fromFloat(Dec)',
                input: new Balance(20000000000000n, 6).mul(Balance.fromFloat(Dec(1.1), 6)),
                expected: { bigint: 22000000000000n, float: 22000000, decimal: '22000000', string: '22000000000000' },
            },
            {
                title: 'Balance * Balance',
                input: new Balance(1566119435n, 6).mul(new Balance(1000000n, 6)),
                expected: {
                    bigint: 1566119435n,
                    float: 1566.119435,
                    decimal: '1566.119435',
                    string: '1566119435',
                },
            },
            {
                title: 'Balance * Balance',
                input: Balance.fromFloat(1, 6).mul(new Price(1010000000000000000n)),
                expected: { bigint: 1010000n, float: 1.01, decimal: '1.01', string: '1010000' },
            },
            {
                title: 'Balance * Balance',
                input: Balance.fromFloat(1, 6).mul(Price.fromFloat(1.01)),
                expected: { bigint: 1010000n, float: 1.01, decimal: '1.01', string: '1010000' },
            },
            {
                title: 'Balance / bigint',
                input: new Balance(1000n, 6).div(2n),
                expected: { bigint: 500n, float: 0.0005, decimal: '0.0005', string: '500' },
            },
            {
                title: 'Balance / Balance.fromFloat',
                input: new Balance(1000n, 6).div(Balance.fromFloat(0.000002, 6)),
                expected: { bigint: 500n, float: 0.0005, decimal: '0.0005', string: '500' },
            },
            {
                title: 'Balance mulPrice Balance',
                input: new Balance(1000000n, 6).mul(Price.fromFloat(1.01)),
                expected: { bigint: 1010000n, float: 1.01, decimal: '1.01', string: '1010000' },
            },
            {
                title: 'Balance mulPrice Balance',
                input: Balance.fromFloat(1, 6).mul(new Price(1010000000000000000n)),
                expected: { bigint: 1010000n, float: 1.01, decimal: '1.01', string: '1010000' },
            },
        ];
        arithmeticCases.forEach(({ title, input, expected }) => {
            it(`should do ${title}`, () => {
                expect(input.toBigInt()).to.be.equal(expected.bigint);
                expect(input.toFloat()).to.be.equal(expected.float);
                expect(input.toString()).to.be.equal(expected.string);
                expect(input.toDecimal().toString()).to.be.equal(expected.decimal);
            });
        });
    });
    describe('Rate', () => {
        it('should convert float to Rate', () => {
            const rate = Rate.fromFloat(0.9);
            expect(rate.toDecimal().toString()).to.be.equal('0.9');
            expect(rate.toString()).to.be.equal('900000000000000000000000000');
            expect(rate.toAprPercent().toString()).to.be.equal('-315360000');
            expect(rate.toApr().toString()).to.be.equal('-3153600');
            expect(rate.toAprPercent().toString()).to.be.equal('-315360000');
        });
    });
});
//# sourceMappingURL=BigInt.test.js.map