import { expect } from 'chai'
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
    const vaults = await poolNetwork.vaults(trancheId)
    expect(vaults).to.have.length(1)
    expect(vaults[0]!.address.toLowerCase()).to.equal(vaultAddress)
  })

  it('should deploy a tranche', async () => {
    const poolId = '1287682503'
    const trancheId = '0x02bbf52e452ddb47103913051212382c'
    const pool = new Pool(context.centrifuge, poolId)
    const poolNetwork = new PoolNetwork(context.centrifuge, pool, 11155111)

    const canTrancheBeDeployed = await poolNetwork.canTrancheBeDeployed(trancheId)
    expect(canTrancheBeDeployed).to.equal(true)

    const result = await poolNetwork.deployTranche(trancheId)
    expect(result.type).to.equal('TransactionConfirmed')
  })

  it('should deploy a vault', async () => {
    const poolId = '1287682503'
    const trancheId = '0x02bbf52e452ddb47103913051212382c'
    const pool = new Pool(context.centrifuge, poolId)
    const poolNetwork = new PoolNetwork(context.centrifuge, pool, 11155111)
    const tUSD = '0x8503b4452Bf6238cC76CdbEE223b46d7196b1c93'

    const result = await poolNetwork.deployVault(trancheId, tUSD)
    expect(result.type).to.equal('TransactionConfirmed')
  })
})
