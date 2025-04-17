import { expect } from 'chai'
import { NULL_ADDRESS } from '../constants.js'
import { context } from '../tests/setup.js'
import { PoolId, ShareClassId } from '../utils/types.js'
import { Pool } from './Pool.js'
import { currencies } from '../config/protocol.js'
import { Balance } from '../utils/BigInt.js'

const chainId = 11155111
const poolId = PoolId.from(1, 1)
const scId = ShareClassId.from(poolId, 1)
const asset = currencies[chainId]![0]!
const ipfsHash = '0x516d516d50617842387976724d4d665765443731447a7873365438355178317379765057676f524b694e5a585852'
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
    const pool = await context.centrifuge.pool(poolId)
    context.tenderlyFork.impersonateAddress = poolManager
    context.centrifuge.setSigner(context.tenderlyFork.signer)
    const result = await pool.updateMetadata(ipfsHash)
    expect(result.type).to.equal('TransactionConfirmed')
  })

  it('should return a pool with details', async () => {
    const pool = await context.centrifuge.pool(poolId)
    const details = await pool.details()
    expect(details.poolId.raw).to.equal(poolId.raw)
    expect(details.metadata).to.not.be.undefined
    expect(details.shareClasses).to.have.length(1)
    expect(details.currency).to.be.instanceOf(Balance)
  })
})
