import { expect } from 'chai'
import { firstValueFrom, skip } from 'rxjs'
import { Centrifuge } from '../Centrifuge.js'
import { NULL_ADDRESS } from '../constants.js'
import { mockPoolMetadata } from '../tests/mocks/mockPoolMetadata.js'
import { context } from '../tests/setup.js'
import { randomAddress } from '../tests/utils.js'
import { AssetId, PoolId, ShareClassId } from '../utils/types.js'
import { Pool } from './Pool.js'

const chainId = 11155111
const centId = 1
const poolId = PoolId.from(centId, 1)
const scId = ShareClassId.from(poolId, 1)
const assetId = AssetId.from(centId, 1)
const poolManager = '0x423420Ae467df6e90291fd0252c0A8a637C1e03f'

describe('Pool', () => {
  let pool: Pool
  beforeEach(() => {
    const { centrifuge } = context
    pool = new Pool(centrifuge, poolId.raw, chainId)
  })

  it('gets whether an address is manager', async () => {
    const isManager = await pool.isPoolManager(poolManager)
    expect(isManager).to.be.true

    const isManager2 = await pool.isPoolManager(randomAddress())
    expect(isManager2).to.be.false
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
    const vault = await pool.vault(chainId, scId, assetId)
    expect(vault).to.not.be.undefined
    expect(vault.address).to.not.equal(NULL_ADDRESS)
  })

  it('should update the pool metadata', async () => {
    const fakeHash = 'QmPdzJkZ4PVJ21HfBXMJbGopSpUP9C9fqu3A1f9ZVhtRY2'

    const centrifugeWithPin = new Centrifuge({
      environment: 'testnet',
      pinJson: async (data) => {
        expect(data).to.deep.equal(mockPoolMetadata)
        return fakeHash
      },
      rpcUrls: {
        11155111: context.tenderlyFork.rpcUrl,
      },
    })

    const pool = await centrifugeWithPin.pool(poolId)

    const detailsBefore = await pool.details()
    expect(detailsBefore.metadata).to.equal(null)

    context.tenderlyFork.impersonateAddress = poolManager
    centrifugeWithPin.setSigner(context.tenderlyFork.signer)

    const [result, detailsAfter] = await Promise.all([
      pool.updateMetadata(mockPoolMetadata),
      firstValueFrom(pool.details().pipe(skip(1))),
    ])

    expect(result.type).to.equal('TransactionConfirmed')
    expect(detailsAfter.metadata?.pool.asset.class).to.equal('Private credit')
  })

  it('should return the currency of the pool', async () => {
    const currency = await pool.currency()
    expect(currency).to.have.property('name')
    expect(currency).to.have.property('symbol')
    expect(currency).to.have.property('decimals')
  })

  it('should return a pool with details', async () => {
    const details = await pool.details()
    expect(details.id.raw).to.equal(poolId.raw)
    expect(details.metadata).to.not.be.undefined
    expect(details.shareClasses).to.have.length.greaterThan(0)
    expect(details.currency).to.exist
  })

  it('updates pool managers', async () => {
    context.tenderlyFork.impersonateAddress = poolManager
    context.centrifuge.setSigner(context.tenderlyFork.signer)

    const newManager = randomAddress()
    const result = await pool.updatePoolManagers([{ address: newManager, canManage: true }])
    expect(result.type).to.equal('TransactionConfirmed')

    const isNewManager = await pool.isPoolManager(newManager)
    expect(isNewManager).to.be.true
  })
})
