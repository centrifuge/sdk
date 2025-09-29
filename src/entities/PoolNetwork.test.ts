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
import { MerkleProofManager } from './MerkleProofManager.js'
import { Centrifuge } from '../Centrifuge.js'

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
    expect(details.activeShareClasses[0]!.vaults).to.have.length.greaterThan(0)
  })

  it('deploys share classes and vaults', async () => {
    const { hub, freezeOnlyHook, vaultRouter } = await context.centrifuge._protocolAddresses(chainId)

    context.tenderlyFork.impersonateAddress = poolManager
    context.centrifuge.setSigner(context.tenderlyFork.signer)

    await context.centrifuge._transact(async function* (ctx) {
      yield* doTransaction('Add share class', ctx, async () => {
        return ctx.walletClient.writeContract({
          address: hub,
          abi: ABI.Hub,
          functionName: 'addShareClass',
          args: [poolId.raw, 'Test Share Class', 'TSC', '0x123'.padEnd(66, '0') as any],
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
      vaultAddr as any,
      AssetId.from(1, 1)
    )

    const vaultDetails = await vault.details()
    expect(vaultDetails.isSyncInvest).to.be.true

    const addresses = await context.centrifuge._protocolAddresses(chainId)

    const maxReserve = await context.centrifuge.getClient(chainId).readContract({
      address: addresses.syncManager,
      abi: ABI.SyncRequests,
      functionName: 'maxReserve',
      args: [poolId.raw, scId.raw, asset.address, 0n],
    })
    expect(maxReserve).to.equal(340282366920938463463374607431768211455n)
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

    const unlinkResult = await poolNetwork.updateVaultLinks([{ shareClassId: scId, assetId }], false)
    expect(unlinkResult.type).to.equal('TransactionConfirmed')

    const vaultAddrAfterUnlink = await context.centrifuge.getClient(chainId).readContract({
      address: vaultRouter,
      abi: ABI.VaultRouter,
      functionName: 'getVault',
      args: [poolId.raw, scId.raw, asset.address],
    })
    expect(vaultAddrAfterUnlink).to.equal(NULL_ADDRESS)
  })

  it('enables vaults again', async () => {
    const { vaultRouter } = await context.centrifuge._protocolAddresses(chainId)

    context.tenderlyFork.impersonateAddress = poolManager
    context.centrifuge.setSigner(context.tenderlyFork.signer)

    const scId = ShareClassId.from(poolId, 2)
    const assetId = AssetId.from(1, 1)
    const asset = await context.centrifuge.assetCurrency(assetId)
    const vaultAddr = '0x1234567890abcdef1234567890abcdef12345678'

    const mock = sinon.mock(poolNetwork)
    mock.expects('details').resolves({
      activeShareClasses: [{ id: scId, vaults: [{ assetId, address: vaultAddr }] }],
    })

    const linkResult = await poolNetwork.updateVaultLinks([{ shareClassId: scId, assetId }], true)
    expect(linkResult.type).to.equal('TransactionConfirmed')

    const vaultAddrAfterLink = await context.centrifuge.getClient(chainId).readContract({
      address: vaultRouter,
      abi: ABI.VaultRouter,
      functionName: 'getVault',
      args: [poolId.raw, scId.raw, asset.address],
    })
    expect(vaultAddrAfterLink).to.not.equal(NULL_ADDRESS)
  })

  describe('merkleProofManager', () => {
    it('should return merkleProofManager', async () => {
      const result = await poolNetwork.merkleProofManager()

      expect(result).to.be.instanceOf(MerkleProofManager)
    })

    it('should deploy merkleProofManager', async () => {
      context.tenderlyFork.impersonateAddress = poolManager
      context.centrifuge.setSigner(context.tenderlyFork.signer)

      await context.tenderlyFork.fundAccountEth(poolManager, 10n ** 18n)

      const poolId = PoolId.from(1, 10)
      const { centrifuge } = context
      const pool = new Pool(centrifuge, poolId.raw, 11155111)
      const poolNetwork = new PoolNetwork(centrifuge, pool, 11155111)

      const result = await poolNetwork.deployMerkleProofManager()

      expect(result.type).to.equal('TransactionConfirmed')
    })

    it('should throw when it does not find merkleProofManager', async () => {
      const poolId = PoolId.from(1, 10)
      const { centrifuge } = context
      const pool = new Pool(centrifuge, poolId.raw, 11155111)
      const poolNetwork = new PoolNetwork(centrifuge, pool, 11155111)
      try {
        await poolNetwork.merkleProofManager()
      } catch (error: any) {
        expect(error.message).to.equal('MerkleProofManager not found')
      }
    })
  })

  describe('onOfframpManager', () => {
    it.skip('returns onOfframpManager', async () => {
      context.tenderlyFork.impersonateAddress = poolManager
      context.centrifuge.setSigner(context.tenderlyFork.signer)

      await context.tenderlyFork.fundAccountEth(poolManager, 10n ** 18n)
      await poolNetwork.pool.updateBalanceSheetManagers([
        { chainId, address: '0x8c0E6DC2461c6190A3e5703B714942cacfCb3C14', canManage: true },
      ])

      // TODO: Needs data in indexer for manager to be balance sheet manager
      await poolNetwork.onOfframpManager(ShareClassId.from(poolId, 1))

      // expect(result).to.be.instanceOf(OnOffRampManager)
    })

    it('should throw when it does not find onOfframpManager', async () => {
      try {
        await poolNetwork.onOfframpManager(ShareClassId.from(poolId, 10))
      } catch (error: any) {
        expect(error.message).to.equal('OnOffRampManager not found')
      }
    })

    it('should throw when onOfframpManager is not balance sheet manager', async () => {
      context.tenderlyFork.impersonateAddress = poolManager
      context.centrifuge.setSigner(context.tenderlyFork.signer)

      await context.tenderlyFork.fundAccountEth(poolManager, 10n ** 18n)
      await poolNetwork.pool.updateBalanceSheetManagers([
        { chainId, address: '0x8c0E6DC2461c6190A3e5703B714942cacfCb3C14', canManage: true },
      ])

      try {
        await poolNetwork.onOfframpManager(ShareClassId.from(poolId, 1))
      } catch (error: any) {
        expect(error.message).to.equal('OnOffRampManager not found in balance sheet managers')
      }
    })

    it('should deploy onOfframpManager', async () => {
      const centrifugeWithPin = new Centrifuge({
        environment: 'testnet',
        pinJson: async () => {
          return 'abc'
        },
        rpcUrls: {
          11155111: context.tenderlyFork.rpcUrl,
        },
      })

      context.tenderlyFork.impersonateAddress = poolManager
      centrifugeWithPin.setSigner(context.tenderlyFork.signer)

      await context.tenderlyFork.fundAccountEth(poolManager, 10n ** 18n)

      const pool = new Pool(centrifugeWithPin, poolId.raw, 11155111)

      await pool.update({}, [], [{ tokenName: 'DummyShareClass', symbolName: 'DSC' }])

      const addresses = await centrifugeWithPin._protocolAddresses(11155111)

      const shareClassesCount = await centrifugeWithPin.getClient(11155111).readContract({
        address: addresses.shareClassManager,
        abi: ABI.ShareClassManager,
        functionName: 'shareClassCount',
        args: [poolId.raw],
      })

      await poolNetwork.deploy([{ id: ShareClassId.from(pool.id, shareClassesCount), hook: '0x' }])

      const result = await poolNetwork.deployOnOfframpManager(ShareClassId.from(pool.id, shareClassesCount))

      expect(result.type).to.equal('TransactionConfirmed')
    })
  })
})
