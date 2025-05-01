import { expect } from 'chai'
import { NULL_ADDRESS } from '../constants.js'
import { context } from '../tests/setup.js'
import { PoolId, ShareClassId } from '../utils/types.js'
import { Pool } from './Pool.js'
import { currencies } from '../config/protocol.js'
import { mockPoolMetadata } from '../tests/mocks/mockPoolMetadata.js'
import { Centrifuge } from '../Centrifuge.js'

const chainId = 11155111
const poolId = PoolId.from(1, 1)
const scId = ShareClassId.from(poolId, 1)
const asset = currencies[chainId]![0]!
const poolManager = '0x423420Ae467df6e90291fd0252c0A8a637C1e03f'

describe('Pool', () => {
  let pool: Pool
  beforeEach(() => {
    const { centrifuge } = context
    pool = new Pool(centrifuge, poolId.raw, chainId)
  })

  it('gets active networks of a pool', async () => {
    const networks = await pool.activeNetworks()
    expect(networks).to.have.length(1)
    expect(networks[0]!.chainId).to.equal(chainId)
  })

  it('gets share class IDs of a pool', async () => {
    const shareClasses = await pool.shareClasses()
    expect(shareClasses).to.have.length(1)
    expect(shareClasses[0]!.id.raw).to.equal(scId.raw)
  })

  it('can query a vault', async () => {
    const vault = await pool.vault(chainId, scId, asset)
    expect(vault).to.not.be.undefined
    expect(vault.address).to.not.equal(NULL_ADDRESS)
  })

  it('should update the pool metadata', async () => {
    const fakeHash = 'QmakVZw8HErPUx4x8rKEUGEU9SoGTVB6gN943PQ1d5q9XN'

    const centrifugeWithPin = new Centrifuge({
      environment: 'demo',
      pinJson: async (data) => {
        expect(data).to.deep.equal(mockPoolMetadata)
        return fakeHash
      },
    })

    const pool = await centrifugeWithPin.pool(poolId)

    context.tenderlyFork.impersonateAddress = poolManager
    centrifugeWithPin.setSigner(context.tenderlyFork.signer)

    const result = await pool.updateMetadata(mockPoolMetadata)

    expect(result.type).to.equal('TransactionConfirmed')
  })

  it('should return the currency of the pool', async () => {
    const pool = await context.centrifuge.pool(poolId)
    const currency = await pool.currency()
    expect(currency).to.have.property('id')
    expect(currency).to.have.property('name')
    expect(currency).to.have.property('symbol')
    expect(currency).to.have.property('decimals')
  })

  it('should return a pool with details', async () => {
    const pool = await context.centrifuge.pool(poolId)
    const details = await pool.details()
    expect(details.poolId.raw).to.equal(poolId.raw)
    expect(details.metadata).to.not.be.undefined
    expect(details.shareClasses).to.have.length(1)
    expect(details.currency).to.exist
  })
})
