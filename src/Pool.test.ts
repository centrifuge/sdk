import { expect } from 'chai'
import { Pool } from './Pool.js'
import { context } from './tests/setup.js'

const poolId = '2779829532'

describe('Pool', () => {
  let pool: Pool
  beforeEach(() => {
    const { centrifuge } = context
    pool = new Pool(centrifuge, poolId)
  })

  it('get active networks of a pool', async () => {
    const networks = await pool.activeNetworks()
    expect(networks).to.have.length(2)
    expect(networks[0]!.chainId).to.equal(11155111)
    expect(networks[1]!.chainId).to.equal(84532)
  })
})
