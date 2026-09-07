import { expect } from 'chai'
import { addressesEqual, convertToEvmAddress, validateAddress } from './addresses.js'

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
    expect(addressesEqual('0x423420Ae467df6e90291fd0252c0A8a637C1e03f', '0x423420ae467df6e90291fd0252c0a8a637c1e03f'))
      .to.be.true
  })

  it('returns false for different addresses', () => {
    expect(addressesEqual('0x1111111111111111111111111111111111111111', '0x2222222222222222222222222222222222222222'))
      .to.be.false
  })
})

describe('convertToEvmAddress', () => {
  it('left-pads a centrifuge id into a 20-byte address', () => {
    expect(convertToEvmAddress(1)).to.equal('0x0000000000000000000000000000000000000001')
    expect(convertToEvmAddress(255)).to.equal('0x00000000000000000000000000000000000000ff')
  })

  it('produces a valid, distinct address per id', () => {
    // These stand in for a chain in permission checks, so a collision between two ids would grant
    // one chain's rights to another.
    const first = convertToEvmAddress(1)
    const second = convertToEvmAddress(2)
    expect(validateAddress(first)).to.equal(validateAddress(first))
    expect(addressesEqual(first, second)).to.equal(false)
  })

  it('handles zero', () => {
    expect(convertToEvmAddress(0)).to.equal(`0x${'0'.repeat(40)}`)
  })
})
