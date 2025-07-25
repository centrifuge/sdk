import { expect } from 'chai'
import sinon from 'sinon'
import { ABI } from '../abi/index.js'
import { NULL_ADDRESS } from '../constants.js'
import { context } from '../tests/setup.js'
import { doTransaction } from '../utils/transaction.js'
import { AssetId, PoolId, ShareClassId } from '../utils/types.js'
import { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'
import { Vault } from './Vault.js'

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
    expect(vaults).to.have.length.greaterThan(0)
    expect(vaults[0]!.address.toLowerCase()).not.to.equal(NULL_ADDRESS)
  })

  it('gets the details', async () => {
    const details = await poolNetwork.details()
    expect(details.isActive).to.equal(true)
    expect(details.activeShareClasses).to.have.length.greaterThan(0)
    expect(details.activeShareClasses[0]!.shareToken).not.to.equal(NULL_ADDRESS)
    expect(details.activeShareClasses[0]!.id.equals(scId)).to.equal(true)
    expect(details.activeShareClasses[0]!.vaults).to.have.length(1)
  })

  it('deploys share classes and vaults', async () => {
    const { hub, freezeOnlyHook, vaultRouter } = await context.centrifuge._protocolAddresses(chainId)

    context.tenderlyFork.impersonateAddress = poolManager
    context.centrifuge.setSigner(context.tenderlyFork.signer)

    await context.centrifuge._transact(async function* (ctx) {
      yield* doTransaction('Add share class', ctx.publicClient, async () => {
        return ctx.walletClient.writeContract({
          address: hub,
          abi: ABI.Hub,
          functionName: 'addShareClass',
          args: [poolId.raw, 'Test Share Class', 'TSC', '0x1'.padEnd(66, '0') as any],
        })
      })
    }, chainId)

    const scId = ShareClassId.from(poolId, 2)
    const assetId = AssetId.from(1, 1)

    const result = await poolNetwork.deploy(
      [{ id: scId, hook: freezeOnlyHook }],
      [{ shareClassId: scId, assetId, kind: 'syncDeposit' }]
    )
    expect(result.type).to.equal('TransactionConfirmed')

    const details = await poolNetwork.details()
    expect(details.activeShareClasses).to.have.length(2)
    expect(details.activeShareClasses[1]!.id.equals(scId)).to.equal(true)
    expect(details.activeShareClasses[1]!.shareToken).not.to.equal(NULL_ADDRESS)

    const asset = await context.centrifuge.assetCurrency(assetId)
    const vaultAddr = await context.centrifuge.getClient(chainId).readContract({
      address: vaultRouter,
      abi: ABI.VaultRouter,
      functionName: 'getVault',
      args: [poolId.raw, scId.raw, asset.address],
    })
    const vault = new Vault(
      context.centrifuge,
      new PoolNetwork(context.centrifuge, new Pool(context.centrifuge, poolId.raw, chainId), chainId),
      details.activeShareClasses[1]!.shareClass,
      asset.address,
      vaultAddr,
      AssetId.from(1, 1)
    )

    const vaultDetails = await vault.details()

    expect(vaultDetails.isSyncInvest).to.be.true
  })

  it('disables vaults', async () => {
    const { vaultRouter } = await context.centrifuge._protocolAddresses(chainId)

    context.tenderlyFork.impersonateAddress = poolManager
    context.centrifuge.setSigner(context.tenderlyFork.signer)

    const scId = ShareClassId.from(poolId, 2)
    const assetId = AssetId.from(1, 1)
    const asset = await context.centrifuge.assetCurrency(assetId)

    const vaultAddr = await context.centrifuge.getClient(chainId).readContract({
      address: vaultRouter,
      abi: ABI.VaultRouter,
      functionName: 'getVault',
      args: [poolId.raw, scId.raw, asset.address],
    })

    const mock = sinon.mock(poolNetwork)
    mock.expects('details').resolves({
      activeShareClasses: [{ id: scId, vaults: [{ assetId, address: vaultAddr }] }],
    })

    const result = await poolNetwork.disableVaults([{ shareClassId: scId, assetId }])
    expect(result.type).to.equal('TransactionConfirmed')

    const vaultAddr2 = await context.centrifuge.getClient(chainId).readContract({
      address: vaultRouter,
      abi: ABI.VaultRouter,
      functionName: 'getVault',
      args: [poolId.raw, scId.raw, asset.address],
    })
    expect(vaultAddr2).to.equal(NULL_ADDRESS)
  })
})
