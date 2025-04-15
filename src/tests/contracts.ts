import { expect } from 'chai'
import { Centrifuge } from '../Centrifuge.js'

const expectedContractKeys = [
  'root',
  'adminSafe',
  'guardian',
  'gasService',
  'gateway',
  'messageProcessor',
  'messageDispatcher',
  'poolRegistry',
  'assetRegistry',
  'accounting',
  'holdings',
  'multiShareClass',
  'poolRouter',
  'transientValuation',
  'identityValuation',
  'escrow',
  'routerEscrow',
  'restrictionManager',
  'restrictedRedemptions',
  'tokenFactory',
  'investmentManager',
  'vaultFactory',
  'poolManager',
  'vaultRouter',
  'currencies',
]

describe('Protocol addresses', () => {
  it('should fetch protocol addresses for the demo chain (sepolia)', async () => {
    const centrifuge = new Centrifuge({ environment: 'demo' })
    const chainId = centrifuge.config.defaultChain

    const result = await centrifuge._protocolAddresses(chainId)

    expect(result).to.be.an('object')
    expect(Object.keys(result)).to.be.eql(expectedContractKeys)
    expect(result.currencies).to.be.an('array')
  })
})
