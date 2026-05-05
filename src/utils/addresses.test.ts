import { expect } from 'chai'
import { addressesEqual, validateAddress } from './addresses.js'

describe('validateAddress', () => {
  it('returns the checksummed address for a valid lowercase input', () => {
    const result = validateAddress('0x423420ae467df6e90291fd0252c0a8a637c1e03f')
    expect(result).to.equal('0x423420Ae467df6e90291fd0252c0A8a637C1e03f')
  })

  it('returns the same value for already-checksummed input', () => {
    const input = '0x423420Ae467df6e90291fd0252c0A8a637C1e03f'
    expect(validateAddress(input)).to.equal(input)
  })

  it('throws on a too-short address', () => {
    expect(() => validateAddress('0x123')).to.throw(/Invalid address/)
  })

  it('throws on a non-hex address', () => {
    expect(() => validateAddress('not-an-address')).to.throw(/Invalid address/)
  })

  it('throws on an address missing the 0x prefix', () => {
    expect(() => validateAddress('423420ae467df6e90291fd0252c0a8a637c1e03f')).to.throw(/Invalid address/)
  })

  it('includes the label in the error message', () => {
    expect(() => validateAddress('garbage', 'hub address')).to.throw(/Invalid hub address/)
  })
})

describe('addressesEqual', () => {
  it('returns true for the same address with different cases', () => {
    expect(
      addressesEqual('0x423420Ae467df6e90291fd0252c0A8a637C1e03f', '0x423420ae467df6e90291fd0252c0a8a637c1e03f')
    ).to.be.true
  })

  it('returns false for different addresses', () => {
    expect(
      addressesEqual('0x1111111111111111111111111111111111111111', '0x2222222222222222222222222222222222222222')
    ).to.be.false
  })
})
