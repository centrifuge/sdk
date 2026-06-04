import { expect } from 'chai'
import { decodeAbiParameters } from 'viem'
import { encodeConfigurableValue, encodeWorkflowInputValue, isWorkflowInputOptional } from './workflowExecute.js'

const ADDRESS_A = '0x1111111111111111111111111111111111111111'
const ADDRESS_B = '0x2222222222222222222222222222222222222222'

describe('utils/workflowExecute', () => {
  describe('encodeWorkflowInputValue', () => {
    it('encodes integer types', () => {
      const encoded = encodeWorkflowInputValue('uint256', '100')
      expect(encoded).to.match(/^0x[0-9a-f]{64}$/)
      expect(decodeAbiParameters([{ type: 'uint256' }], encoded)[0]).to.equal(100n)
      // uint128 (and other widths) go through the same path
      expect(decodeAbiParameters([{ type: 'uint128' }], encodeWorkflowInputValue('uint128', '42'))[0]).to.equal(42n)
    })

    it('encodes addresses (case-insensitive)', () => {
      const encoded = encodeWorkflowInputValue('address', ADDRESS_A)
      expect((decodeAbiParameters([{ type: 'address' }], encoded)[0] as string).toLowerCase()).to.equal(ADDRESS_A)
    })

    it('rejects a non-address for an address parameter', () => {
      expect(() => encodeWorkflowInputValue('address', 'not-an-address')).to.throw()
    })

    it('encodes booleans', () => {
      expect(decodeAbiParameters([{ type: 'bool' }], encodeWorkflowInputValue('bool', 'true'))[0]).to.equal(true)
      expect(decodeAbiParameters([{ type: 'bool' }], encodeWorkflowInputValue('bool', 'false'))[0]).to.equal(false)
      expect(() => encodeWorkflowInputValue('bool', 'yes')).to.throw()
    })

    it('encodes fixed bytes and rejects the wrong length', () => {
      const value = `0x${'ab'.repeat(32)}`
      expect(decodeAbiParameters([{ type: 'bytes32' }], encodeWorkflowInputValue('bytes32', value))[0]).to.equal(value)
      expect(() => encodeWorkflowInputValue('bytes32', '0xabcd')).to.throw()
    })

    it('encodes an (address,uint256)[] from newline-separated lines', () => {
      const encoded = encodeWorkflowInputValue('(address,uint256)[]', `${ADDRESS_A}, 1\n${ADDRESS_B}, 2`)
      const [tuples] = decodeAbiParameters(
        [{ type: 'tuple[]', components: [{ type: 'address' }, { type: 'uint256' }] }],
        encoded
      ) as unknown as [Array<{ 0: string; 1: bigint }>]
      expect(tuples).to.have.length(2)
      expect((tuples[0]![0] as string).toLowerCase()).to.equal(ADDRESS_A)
      expect(tuples[1]![1]).to.equal(2n)
    })

    it('encodes an (address,address)[]', () => {
      const encoded = encodeWorkflowInputValue('(address,address)[]', `${ADDRESS_A}, ${ADDRESS_B}`)
      const [tuples] = decodeAbiParameters(
        [{ type: 'tuple[]', components: [{ type: 'address' }, { type: 'address' }] }],
        encoded
      ) as unknown as [Array<{ 0: string; 1: string }>]
      expect(tuples).to.have.length(1)
      expect((tuples[0]![1] as string).toLowerCase()).to.equal(ADDRESS_B)
    })

    it('treats array types as optional (empty value encodes an empty array)', () => {
      const encoded = encodeWorkflowInputValue('(address,uint256)[]', '')
      const [tuples] = decodeAbiParameters(
        [{ type: 'tuple[]', components: [{ type: 'address' }, { type: 'uint256' }] }],
        encoded
      ) as unknown as [unknown[]]
      expect(tuples).to.have.length(0)
    })

    it('throws on a missing value for a required (non-array) parameter', () => {
      expect(() => encodeWorkflowInputValue('uint256', '')).to.throw(/Missing value/)
    })

    it('throws on an unsupported parameter type', () => {
      expect(() => encodeWorkflowInputValue('string', 'hello')).to.throw(/Unsupported/)
    })

    it('exposes encodeConfigurableValue as an alias', () => {
      expect(encodeConfigurableValue).to.equal(encodeWorkflowInputValue)
    })
  })

  describe('isWorkflowInputOptional', () => {
    it('is true only for the array tuple types', () => {
      expect(isWorkflowInputOptional('(address,uint256)[]')).to.equal(true)
      expect(isWorkflowInputOptional('(address,address)[]')).to.equal(true)
      expect(isWorkflowInputOptional('uint256')).to.equal(false)
      expect(isWorkflowInputOptional('address')).to.equal(false)
    })
  })
})
