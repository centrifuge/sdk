import { expect } from 'chai'
import { NULL_ADDRESS } from '../constants.js'
import { context } from '../tests/setup.js'
import { Pool } from './Pool.js'

const poolId = '562949953421313'
const scId = '0x00000000000000000002000000000002'
const asset = '0x86eb50b22dd226fe5d1f0753a40e247fd711ad6e'

describe('Pool', () => {
  let pool: Pool
  beforeEach(() => {
    const { centrifuge } = context
    pool = new Pool(centrifuge, poolId, 11155111)
  })

  it('gets active networks of a pool', async () => {
    const networks = await pool.activeNetworks()
    expect(networks).to.have.length(1)
    expect(networks[0]!.chainId).to.equal(11155111)
  })

  it('gets share class IDs of a pool', async () => {
    const shareClasses = await pool.shareClasses()
    expect(shareClasses).to.have.length(1)
    expect(shareClasses[0]!.id).to.equal(scId)
  })

  it('can query a vault', async () => {
    const vault = await pool.vault(11155111, scId, asset)
    expect(vault).to.not.be.undefined
    expect(vault.address).to.not.equal(NULL_ADDRESS)
  })
})
