import { expect } from 'chai'
import sinon from 'sinon'
import type { PublicClient } from 'viem'
import { MIN_SIMULATION_BLOCK_GAS, simulateCalls } from './simulateCalls.js'

const account = '0xc1A929CBc122Ddb8794287D05Bf890E41f23c8cb'
const to = '0x25f4dA387f8154E78763Cac7e545a776c4D245C6'

function client(gasLimit: bigint) {
  const simulateBlocks = sinon.stub().resolves([{ calls: [{ status: 'success', data: '0x', gasUsed: 2_116_637n }] }])
  return { client: { getBlock: async () => ({ gasLimit }), simulateBlocks } as unknown as PublicClient, simulateBlocks }
}

describe('simulateCalls', () => {
  it('raises a 3M small block (HyperEVM) to the big-block limit, so a heavy call is not starved of gas in simulation', async () => {
    const { client: small, simulateBlocks } = client(3_000_000n)
    await simulateCalls(small, { account, calls: [{ to, data: '0x1234' }] })
    const [block] = simulateBlocks.firstCall.args[0].blocks
    expect(block.blockOverrides.gasLimit).to.equal(MIN_SIMULATION_BLOCK_GAS)
  })

  it("keeps a chain's own block gas limit when it is above the floor", async () => {
    const { client: large, simulateBlocks } = client(45_000_000n)
    await simulateCalls(large, { account, calls: [{ to, data: '0x1234' }] })
    expect(simulateBlocks.firstCall.args[0].blocks[0].blockOverrides.gasLimit).to.equal(45_000_000n)
  })

  it('sends only the given calls, each from the account, with no call of its own added', async () => {
    const { client: small, simulateBlocks } = client(3_000_000n)
    const { results } = await simulateCalls(small, {
      account,
      calls: [
        { to, data: '0x1234', value: 1n },
        { to, data: '0x5678' },
      ],
    })
    expect(simulateBlocks.firstCall.args[0].blocks[0].calls).to.deep.equal([
      { to, data: '0x1234', value: 1n, account },
      { to, data: '0x5678', account },
    ])
    expect(results).to.deep.equal([{ status: 'success', data: '0x', gasUsed: 2_116_637n }])
  })
})
