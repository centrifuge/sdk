import { expect } from 'chai'
import { Centrifuge } from '../Centrifuge.js'
import { forkTenderlyNetwork, deleteTenderlyRpcEndpoint } from './tenderly.js'

describe('Centrifuge', () => {
  let centrifuge: Centrifuge
  let vnetId: string

  before(async () => {
    const fork = await forkTenderlyNetwork(11155111)
    vnetId = fork.vnetId
    console.log('Created tenderly fork with id', vnetId)
    centrifuge = new Centrifuge({
      environment: 'demo',
      rpcUrls: {
        11155111: fork.forkedRpcUrl,
      },
    })
  })
  after(async () => {
    const deleted = await deleteTenderlyRpcEndpoint(vnetId)
    if (deleted) {
      console.log('deleted tenderly rpc endpoint with id', vnetId)
    } else {
      console.log('failed to delete tenderly rpc endpoint with id', vnetId)
    }
  })
  it('should be connected to sepolia', async () => {
    const client = centrifuge.getClient()
    expect(client?.chain.id).to.equal(11155111)
    const chains = centrifuge.chains
    expect(chains).to.include(11155111)
  })
  it('should fetch account and balances', async () => {
    const account = await centrifuge.account('0x423420Ae467df6e90291fd0252c0A8a637C1e03f')
    const balances = await account.balances()
    expect(balances).to.exist
  })
  it('should fetch a pool by id', async () => {
    const pool = await centrifuge.pool('4139607887')
    expect(pool).to.exist
  })
})
