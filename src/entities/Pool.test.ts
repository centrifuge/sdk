import { expect } from 'chai'
import { firstValueFrom, lastValueFrom, skipWhile } from 'rxjs'
import { getContract } from 'viem'
import { ABI } from '../abi/index.js'
import { Centrifuge } from '../Centrifuge.js'
import { NULL_ADDRESS } from '../constants.js'
import { mockPoolMetadata } from '../tests/mocks/mockPoolMetadata.js'
import { context } from '../tests/setup.js'
import { randomAddress } from '../tests/utils.js'
import { PoolMetadataInput, ShareClassInput } from '../types/poolInput.js'
import { AssetId, PoolId, ShareClassId } from '../utils/types.js'
import { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'

const chainId = 11155111
const centId = 1
const poolId = PoolId.from(centId, 1)
const scId = ShareClassId.from(poolId, 1)
const assetId = AssetId.from(centId, 1)
const poolManager = '0x423420Ae467df6e90291fd0252c0A8a637C1e03f'

describe.skip('Pool', () => {
  let pool: Pool
  before(() => {
    const { centrifuge } = context
    pool = new Pool(centrifuge, poolId.raw)
  })

  it('gets whether an address is manager', async () => {
    const isManager = await pool.isPoolManager(poolManager)
    expect(isManager).to.be.true

    const isManager2 = await pool.isPoolManager(randomAddress())
    expect(isManager2).to.be.false
  })

  it('gets active networks of a pool', async () => {
    const networks = await pool.activeNetworks()
    expect(networks).to.have.length.greaterThan(0)
    expect(networks.some((n) => n.centrifugeId === centId)).to.equal(true)
  })

  it('gets share class IDs of a pool', async () => {
    const shareClasses = await pool.shareClasses()
    expect(shareClasses).to.have.length.greaterThan(0)
    expect(shareClasses[0]!.id.raw).to.equal(scId.raw)
  })

  it.skip('can query a vault', async () => {
    const vault = await pool.vault(chainId, scId, assetId)
    expect(vault).to.not.be.undefined
    expect(vault.address).to.not.equal(NULL_ADDRESS)
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

  it('gets pool managers', async () => {
    const managers = await pool.poolManagers()
    expect(managers.some((m) => m.address === poolManager.toLowerCase())).to.be.true
  })

  it('gets balance sheet managers', async () => {
    const managers = await pool.balanceSheetManagers()

    expect(managers).to.have.length.greaterThan(0)

    for (const manager of managers) {
      expect(manager).to.have.property('address').that.is.a('string')
      expect(manager).to.have.property('chainId').that.is.a('number')
      expect(manager).to.have.property('type').that.is.oneOf(['AsyncRequestManager', 'SyncManager', 'Custom'])
    }

    const protocolManagers = managers.filter((m) => m.type === 'AsyncRequestManager' || m.type === 'SyncManager')
    expect(protocolManagers).to.have.length.greaterThan(0)
  })

  it('updates pool managers', async () => {
    context.tenderlyFork.impersonateAddress = poolManager
    context.centrifuge.setSigner(context.tenderlyFork.signer)

    const newManager = randomAddress()
    const result = await pool.updatePoolManagers([{ address: newManager, canManage: true }])
    expect(result.type).to.equal('TransactionConfirmed')

    const centId = await context.centrifuge.id(chainId)
    const [{ hubRegistry }, client] = await Promise.all([
      context.centrifuge._protocolAddresses(centId),
      firstValueFrom(context.centrifuge.getClient(centId)),
    ])

    const isNewManager = await client.readContract({
      address: hubRegistry,
      abi: ABI.HubRegistry,
      functionName: 'manager',
      args: [poolId.raw, newManager],
    })
    expect(isNewManager).to.be.true
  })

  it('updates oneself at the end of the batch', async () => {
    context.tenderlyFork.impersonateAddress = poolManager
    context.centrifuge.setSigner(context.tenderlyFork.signer)

    const newManager = randomAddress()

    await context.tenderlyFork.fundAccountEth(newManager, 10n ** 18n)

    await pool.updatePoolManagers([{ address: newManager, canManage: true }])

    const newManager2 = randomAddress()

    context.tenderlyFork.impersonateAddress = newManager
    context.centrifuge.setSigner(context.tenderlyFork.signer)

    const result = await lastValueFrom(
      pool.updatePoolManagers([
        // If we removed ourself in the first position, we would not be able to update other manager
        { address: newManager, canManage: false },
        { address: newManager2, canManage: true },
      ])
    )

    expect(result.type).to.equal('TransactionConfirmed')
  })

  it('throws when trying to remove last manager', async () => {
    context.tenderlyFork.impersonateAddress = poolManager
    context.centrifuge.setSigner(context.tenderlyFork.signer)

    const newManager = randomAddress()

    try {
      await lastValueFrom(
        pool.updatePoolManagers([
          // If we removed ourself in the first position, we would not be able to update other manager
          { address: poolManager, canManage: false },
          { address: newManager, canManage: false },
        ])
      )
    } catch (error: any) {
      expect(error.message).to.include('Cannot remove all pool managers')
    }
  })

  it('updates balance sheet managers', async () => {
    context.tenderlyFork.impersonateAddress = poolManager
    context.centrifuge.setSigner(context.tenderlyFork.signer)

    const newManager = randomAddress()
    const result = await pool.updateBalanceSheetManagers([
      { centrifugeId: centId, address: newManager, canManage: true },
    ])
    expect(result.type).to.equal('TransactionConfirmed')

    const [{ balanceSheet }, client] = await Promise.all([
      context.centrifuge._protocolAddresses(centId),
      firstValueFrom(context.centrifuge.getClient(centId)),
    ])

    const isNewManager = await client.readContract({
      address: balanceSheet,
      abi: ABI.BalanceSheet,
      functionName: 'manager',
      args: [poolId.raw, newManager],
    })
    expect(isNewManager).to.be.true
  })

  // TODO: Passes locally with both forge and tenderly, fails on CI, possibly due to order - can be resolved with proper data setup
  it.skip('updates a pool', async () => {
    const fakeHash = 'QmPdzJkZ4PVJ21HfBXMJbGopSpUP9C9fqu3A1f9ZVhtRY2'

    const metadataInput: Partial<PoolMetadataInput> = {
      poolName: 'Updated Test Pool',
      investorType: 'Fake Investor Type',
    }

    const addedShareClasses: ShareClassInput[] = [
      {
        tokenName: 'Test Share Class2',
        symbolName: 'TSC2',
        minInvestment: 1000,
        apyPercentage: 5,
        apy: 'target',
        defaultAccounts: {
          asset: 1000,
          equity: 10000,
          gain: 5000,
          loss: 500,
          expense: 1,
          liability: 2,
        },
      },
    ]

    const updatedShareClasses: ({ id: ShareClassId } & ShareClassInput)[] = [
      {
        id: ShareClassId.from(poolId, 1),
        tokenName: 'Sepolia Pool One Token2',
        symbolName: 'sep.poo.one2',
        minInvestment: 1000,
        apyPercentage: 6,
        apy: 'target',
        defaultAccounts: {
          asset: 3000,
          equity: 30000,
          gain: 4000,
          loss: 400,
          expense: 1,
          liability: 2,
        },
      },
    ]

    const expectedAccounts = [1, 2, 400, 500, 1000, 3000, 4000, 5000, 10000, 30000]

    const centrifugeWithPin = new Centrifuge({
      environment: 'testnet',
      pinJson: async (data) => {
        // Check if shareClasses data got updated correctly
        expect(data.pool.name).to.equal('Updated Test Pool')
        expect(data.pool.investorType).to.equal('Fake Investor Type')
        expect(data.shareClasses['0x00010000000000010000000000000001']).to.deep.equal({
          minInitialInvestment: 1000,
          apy: 'target',
          apyPercentage: 6,
          defaultAccounts: {
            asset: 3000,
            equity: 30000,
            gain: 4000,
            loss: 400,
            expense: 1,
            liability: 2,
          },
        })

        // There is an issue with setup data, where poolDetails.shareClasses has two share classes, but poolDetails.metadata.shareClasses has only one.
        // In the meantime few others appeared
        // Until this is corrected, this count is expected.
        expect(data.shareClasses['0x00010000000000010000000000000005']).to.deep.equal({
          minInitialInvestment: 1000,
          apy: 'target',
          apyPercentage: 5,
          defaultAccounts: {
            asset: 1000,
            equity: 10000,
            gain: 5000,
            loss: 500,
            expense: 1,
            liability: 2,
          },
        })

        return fakeHash
      },
      rpcUrls: {
        11155111: context.tenderlyFork.rpcUrl,
      },
    })

    context.tenderlyFork.impersonateAddress = poolManager
    centrifugeWithPin.setSigner(context.tenderlyFork.signer)

    const pool = await centrifugeWithPin.pool(poolId)

    const result = await pool.update(metadataInput, updatedShareClasses, addedShareClasses)

    expect(result.type).to.equal('TransactionConfirmed')

    // await poolDetails -> check extra share class included
    const poolDetails = await firstValueFrom(
      pool.details().pipe(skipWhile((details) => details.shareClasses[4]?.details == null))
    )

    expect(poolDetails.shareClasses.length).to.equal(5)

    // Check if newly added share class is present with correct data
    expect(poolDetails.shareClasses[4]!.details).to.contain({
      name: 'Test Share Class2',
      symbol: 'TSC2',
    })

    const centId = await context.centrifuge.id(chainId)
    const [{ accounting }, client] = await Promise.all([
      context.centrifuge._protocolAddresses(centId),
      firstValueFrom(context.centrifuge.getClient(centId)),
    ])
    const network = new PoolNetwork(context.centrifuge, pool, centId)

    // Share Token for updated share class
    const shareToken = await network._share(poolDetails.shareClasses[0]!.shareClass.id)

    const accountsContract = getContract({
      address: accounting,
      abi: ABI.Accounting,
      client,
    })

    // Check if all accounts got created properly
    for (const account of expectedAccounts) {
      const exists = await accountsContract.read.exists([poolId.raw, account])
      expect(exists).to.be.true
    }

    // Check if existing share class got updated
    const shareClassContract = getContract({
      address: shareToken,
      abi: ABI.Currency,
      client,
    })

    const updateShareClassName = await shareClassContract.read.name()
    const updatedShareClassSymbol = await shareClassContract.read.symbol()

    expect(updateShareClassName).to.equal('Sepolia Pool One Token2')
    expect(updatedShareClassSymbol).to.equal('sep.poo.one2')
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

    context.tenderlyFork.impersonateAddress = poolManager
    centrifugeWithPin.setSigner(context.tenderlyFork.signer)

    const result = await pool.updateMetadata(mockPoolMetadata)

    expect(result.type).to.equal('TransactionConfirmed')

    const details = await pool.details()
    expect(details.metadata!.pool.asset.class).to.equal('Private credit')
  })
})
