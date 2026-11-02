import { expect } from 'chai'
import { chains } from './chains.js'

describe('chain configuration', () => {
  it('declares Multicall3 on every mainnet chain so reads can be batched', () => {
    const missing = chains.filter((chain) => !chain.testnet && !chain.contracts?.multicall3).map((chain) => chain.name)
    expect(missing).to.deep.equal([])
  })
})
