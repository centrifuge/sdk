import { expect } from 'chai'
import { Currency, Rate, Token } from '../utils/BigInt.js'

describe('utils/BigInt', () => {
  it('should convert float/string/bigint to Currency', () => {
    // float conversion
    const balance = Currency.fromFloat(1000.1, 6)
    expect(balance.toDecimal().toString()).to.be.equal('1000.1')
    expect(balance.toFloat()).to.be.equal(1000.1)
    expect(balance.toBigInt()).to.be.equal(1000100000n)
    expect(balance.toString()).to.be.equal('1000100000')
    // string conversion
    const balance2 = Currency.fromFloat('1000', 6)
    expect(balance2.toDecimal().toString()).to.be.equal('1000')
    expect(balance2.toFloat()).to.be.equal(1000)
    expect(balance2.toBigInt()).to.be.equal(1000000000n)
    expect(balance2.toString()).to.be.equal('1000000000')
    // bigint conversion
    const balance3 = new Currency(1000n, 6)
    expect(balance3.toBigInt()).to.be.equal(1000n)
    expect(balance3.toDecimal().toFixed()).to.be.equal('0.001')
    expect(balance3.toFloat()).to.be.equal(0.001)
  })
  it('should perform arithmetic operations on Currency', () => {
    const a = new Currency(1000n, 6)
    const b = a.add(1000n)
    expect(b.toBigInt()).to.be.equal(2000n)
    expect(b.toFloat()).to.be.equal(0.002)
    const c = a.add(1000n)
    expect(c.toDecimal().toString()).to.be.equal('0.002')
    const d = a.sub(1500n)
    expect(d.toBigInt()).to.be.equal(-500n)
    const e = a.mul(2n)
    expect(e.toString()).to.be.equal('2000')
    const f = a.div(2n)
    expect(f.toDecimal().toString()).to.be.equal('0.0005')
  })
  it('should convert float to Token and perform arithmetic operations', () => {
    const token = Token.fromFloat(1000, 6)
    expect(token.toDecimal().toString()).to.be.equal('1000')
    expect(token.toFloat()).to.be.equal(1000)
    expect(token.toBigInt()).to.be.equal(1000000000n)
    expect(token.toString()).to.be.equal('1000000000')
    const a = token.add(1000n)
    expect(a.toDecimal().toString()).to.be.equal('1000.001')
    const b = token.sub(500n)
    expect(b.toString()).to.be.equal('999999500')
    const c = token.mul(BigInt(2))
    expect(c.toDecimal().toString()).to.be.equal('2000')
  })
  it('should convert float to Rate', () => {
    const rate = Rate.fromFloat(0.9)
    expect(rate.toDecimal().toString()).to.be.equal('0.9')
    expect(rate.toString()).to.be.equal('900000000000000000000000000')
    // TODO: check if these are correct
    expect(rate.toAprPercent().toString()).to.be.equal('-315360000')
    expect(rate.toApr().toString()).to.be.equal('-3153600')
    expect(rate.toAprPercent().toString()).to.be.equal('-315360000')
  })
  // it('should convert apr/percent/aprPercent/aprPercentFraction to Rate', () => {
  // const rate = Rate.fromApr(0.01)
  // expect(rate.toDecimal().toString()).to.be.equal('1.000000000317097919837645865')
  // expect(rate.toString()).to.be.equal('1000000000317097919837645865')

  // const rate2 = Rate.fromAprPercent(50)
  // expect(rate2.toDecimal().toString()).to.be.equal('1.000000015854895991882293252')
  // expect(rate2.toString()).to.be.equal('1000000015854895991882293252')

  // const rate3 = Rate.fromPercent(0.01)
  // expect(rate3.toDecimal().toString()).to.be.equal('1.000000000317097919837645865')
  // expect(rate3.toString()).to.be.equal('1000000000317097919837645865')
  // })
})
