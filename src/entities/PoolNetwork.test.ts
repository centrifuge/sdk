import { expect } from 'chai'
import { ABI } from '../abi/index.js'
import { NULL_ADDRESS } from '../constants.js'
import { context } from '../tests/setup.js'
import { AssetId, PoolId, ShareClassId } from '../utils/types.js'
import { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'

const poolId = PoolId.from(1, 1)
const scId = ShareClassId.from(poolId, 1)
const chainId = 11155111
const poolManager = '0x423420Ae467df6e90291fd0252c0A8a637C1e03f'

describe('PoolNetwork', () => {
  let poolNetwork: PoolNetwork

  beforeEach(() => {
    const { centrifuge } = context
    const pool = new Pool(centrifuge, poolId.raw, 11155111)
    poolNetwork = new PoolNetwork(centrifuge, pool, 11155111)
  })

  it('should get whether a pool is deployed to a network', async () => {
    const isActive = await poolNetwork.isActive()
    expect(isActive).to.equal(true)

    // non-active pool/network
    const poolNetwork2 = new PoolNetwork(context.centrifuge, new Pool(context.centrifuge, '123', 11155111), 11155111)
    const isActive2 = await poolNetwork2.isActive()
    expect(isActive2).to.equal(false)
  })

  it('get vaults for a share class', async () => {
    const vaults = await poolNetwork.vaults(scId)
    expect(vaults).to.have.length(1)
    expect(vaults[0]!.address.toLowerCase()).not.to.equal(NULL_ADDRESS)
  })

  it('gets the details', async () => {
    const details = await poolNetwork.details()
    expect(details.isActive).to.equal(true)
    expect(details.activeShareClasses).to.have.length(1)
    expect(details.activeShareClasses[0]!.shareToken).not.to.equal(NULL_ADDRESS)
    expect(details.activeShareClasses[0]!.id.equals(scId)).to.equal(true)
    expect(details.activeShareClasses[0]!.vaults).to.have.length(1)
  })

  it('deploys share classes and vaults', async () => {
    const { hub, freezeOnlyHook } = await context.centrifuge._protocolAddresses(chainId)

    context.tenderlyFork.impersonateAddress = poolManager
    context.centrifuge.setSigner(context.tenderlyFork.signer)

    await context.centrifuge._transact(
      'Add share class',
      async ({ walletClient }) => {
        return walletClient.writeContract({
          address: hub,
          abi: ABI.Hub,
          functionName: 'addShareClass',
          args: [poolId.raw, 'Test Share Class', 'TSC', '0x1'.padEnd(66, '0') as any],
        })
      },
      chainId
    )

    const result = await poolNetwork.deploy(
      [{ id: ShareClassId.from(poolId, 2), hook: freezeOnlyHook }],
      [{ shareClassId: ShareClassId.from(poolId, 2), assetId: AssetId.from(1, 1), kind: 'syncDeposit' }]
    )
    expect(result.type).to.equal('TransactionConfirmed')

    const details = await poolNetwork.details()
    expect(details.activeShareClasses).to.have.length(2)
    expect(details.activeShareClasses[1]!.id.equals(ShareClassId.from(poolId, 2))).to.equal(true)
    expect(details.activeShareClasses[1]!.shareToken).not.to.equal(NULL_ADDRESS)
    expect(details.activeShareClasses[1]!.vaults).to.have.length(1)
  })
})
