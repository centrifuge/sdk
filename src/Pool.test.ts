import { expect } from 'chai'
import { Pool } from './Pool.js'
import { context } from './tests/setup.js'

const poolId = '2779829532'
const trancheId = '0xac6bffc5fd68f7772ceddec7b0a316ca'
const vaultAddress = '0x05eb35c2e4fa21fb06d3fab92916191b254b3504'

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

  it('can query a vault', async () => {
    const vault = await pool.vault(11155111, trancheId, vaultAddress)
    expect(vault).to.not.be.undefined
  })
})
