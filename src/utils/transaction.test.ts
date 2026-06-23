import { expect } from 'chai'
import { encodeFunctionData, parseAbi } from 'viem'
import { HexString } from '../types/index.js'
import { encodeBatchCalldata } from './transaction.js'

const ABI = parseAbi(['function setValue(uint256 v)', 'function multicall(bytes[] data) payable'])

describe('encodeBatchCalldata', () => {
  it('throws on an empty call list', () => {
    expect(() => encodeBatchCalldata([])).to.throw('No calldata to encode')
  })

  it('returns a single call verbatim (no multicall wrapper)', () => {
    const call = encodeFunctionData({ abi: ABI, functionName: 'setValue', args: [42n] })
    expect(encodeBatchCalldata([call])).to.equal(call)
  })

  it('wraps two or more calls in multicall(bytes[])', () => {
    const call1 = encodeFunctionData({ abi: ABI, functionName: 'setValue', args: [1n] })
    const call2 = encodeFunctionData({ abi: ABI, functionName: 'setValue', args: [2n] })
    const expected = encodeFunctionData({ abi: ABI, functionName: 'multicall', args: [[call1, call2]] })
    expect(encodeBatchCalldata([call1, call2])).to.equal(expected)
  })

  it('preserves call order when wrapping', () => {
    const a = encodeFunctionData({ abi: ABI, functionName: 'setValue', args: [10n] })
    const b = encodeFunctionData({ abi: ABI, functionName: 'setValue', args: [20n] })
    const c = encodeFunctionData({ abi: ABI, functionName: 'setValue', args: [30n] })
    const forward = encodeBatchCalldata([a, b, c] as HexString[])
    const reordered = encodeBatchCalldata([c, b, a] as HexString[])
    expect(forward).to.not.equal(reordered)
    expect(forward).to.equal(encodeFunctionData({ abi: ABI, functionName: 'multicall', args: [[a, b, c]] }))
  })
})
