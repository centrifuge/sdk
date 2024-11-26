import { expect } from 'chai'
import sinon from 'sinon'
import { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'
import { context } from './tests/setup.js'

const poolId = '2779829532'
const trancheId = '0xac6bffc5fd68f7772ceddec7b0a316ca'
const vaultAddress = '0x05eb35c2e4fa21fb06d3fab92916191b254b3504'

describe('PoolNetwork', () => {
  let poolNetwork: PoolNetwork
  beforeEach(() => {
    const { centrifuge } = context
    const pool = new Pool(centrifuge, poolId)
    poolNetwork = new PoolNetwork(centrifuge, pool, 11155111)
  })

  it('should get whether a pool is deployed to a network', async () => {
    const isActive = await poolNetwork.isActive()
    expect(isActive).to.equal(true)

    // non-active pool/network
    const poolNetwork2 = new PoolNetwork(context.centrifuge, new Pool(context.centrifuge, '123'), 11155111)
    const isActive2 = await poolNetwork2.isActive()
    expect(isActive2).to.equal(false)
  })

  it('get vaults for a tranche', async () => {
    const fetchSpy = sinon.spy(globalThis, 'fetch')
    const vaults = await poolNetwork.vaults(trancheId)
    expect(vaults).to.have.length(1)
    expect(vaults[0]!.address.toLowerCase()).to.equal(vaultAddress)
    // Calls should get batched
    expect(fetchSpy.getCalls().length).to.equal(1)
  })
})
