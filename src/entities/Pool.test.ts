import { expect } from 'chai'
import { context } from '../tests/setup.js'
import { Pool } from './Pool.js'

const poolId = '2779829532'
const trancheId = '0xac6bffc5fd68f7772ceddec7b0a316ca'
const asset = '0x8503b4452Bf6238cC76CdbEE223b46d7196b1c93'

describe('Pool', () => {
  let pool: Pool
  beforeEach(() => {
    const { centrifuge } = context
    pool = new Pool(centrifuge, poolId, 11155511)
  })

  it('get active networks of a pool', async () => {
    const networks = await pool.activeNetworks()
    expect(networks).to.have.length(2)
    expect(networks[0]!.chainId).to.equal(11155111)
    expect(networks[1]!.chainId).to.equal(84532)
  })

  it('can query a vault', async () => {
    const vault = await pool.vault(11155111, trancheId, asset)
    expect(vault).to.not.be.undefined
  })
})
