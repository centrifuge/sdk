import { expect } from 'chai'
import { lastValueFrom, Observable, of } from 'rxjs'
import sinon from 'sinon'
import { encodeAbiParameters, encodeEventTopics, parseAbi } from 'viem'
import type { TransactionReceipt } from 'viem'
import { ABI } from '../abi/index.js'
import { Centrifuge } from '../Centrifuge.js'
import { NULL_ADDRESS } from '../constants.js'
import { context } from '../tests/setup.js'
import { doTransaction } from '../utils/transaction.js'
import { AssetId, PoolId, ShareClassId } from '../utils/types.js'
import { MerkleProofManager } from './MerkleProofManager.js'
import { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'
import { Vault } from './Vault.js'

const poolId = PoolId.from(1, 1)
const scId = ShareClassId.from(poolId, 1)
const chainId = 11155111
const centId = 1
const poolManager = '0x423420Ae467df6e90291fd0252c0A8a637C1e03f'
const signingAddress = '0x1111111111111111111111111111111111111111'
const onOffRampFactory = '0x2222222222222222222222222222222222222222'
const onOffRampEventAbi = parseAbi([
  'event DeployOnOfframpManager(uint64 indexed poolId, bytes16 scId, address indexed manager)',
])

describe.skip('PoolNetwork', () => {
  let poolNetwork: PoolNetwork

  beforeEach(() => {
    const { centrifuge } = context
    const pool = new Pool(centrifuge, poolId.raw)
    poolNetwork = new PoolNetwork(centrifuge, pool, centId)
  })

  it('should get whether a pool is deployed to a network', async () => {
    const isActive = await poolNetwork.isActive()
    expect(isActive).to.equal(true)

    // non-active pool/network
    const poolNetwork2 = new PoolNetwork(context.centrifuge, new Pool(context.centrifuge, '123'), centId)
    const isActive2 = await poolNetwork2.isActive()
    expect(isActive2).to.equal(false)
  })

  it.skip('get vaults for a share class', async () => {
    const vaults = await poolNetwork.vaults(scId)
    expect(vaults).to.have.length.greaterThan(0)
    expect(vaults[0]!.address.toLowerCase()).not.to.equal(NULL_ADDRESS)
  })

  it.skip('gets the details', async () => {
    const details = await poolNetwork.details()
    expect(details.isActive).to.equal(true)
    expect(details.activeShareClasses).to.have.length.greaterThan(0)
    expect(details.activeShareClasses[0]!.shareToken).not.to.equal(NULL_ADDRESS)
    expect(details.activeShareClasses[0]!.id.equals(scId)).to.equal(true)
    expect(details.activeShareClasses[0]!.vaults).to.have.length.greaterThan(0)
  })

  it.skip('deploys share classes and vaults', async () => {
    const { hub, freezeOnlyHook, vaultRouter } = await context.centrifuge._protocolAddresses(centId)

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
    }, centId)

    const addresses = await context.centrifuge._protocolAddresses(centId)
    const client = await context.centrifuge.getClient(centId)
    const shareClassCount = await client.readContract({
      address: addresses.shareClassManager,
      abi: ABI.ShareClassManager,
      functionName: 'shareClassCount',
      args: [poolId.raw],
    })
    const nextIndex = Number(shareClassCount)
    const scId = ShareClassId.from(poolId, nextIndex)

    const assetId = AssetId.from(1, 1)

    const result = await poolNetwork.deploy(
      [{ id: scId, hook: freezeOnlyHook }],
      [{ shareClassId: scId, assetId, kind: 'syncDeposit' }]
    )
    expect(result.type).to.equal('TransactionConfirmed')

    const details = await poolNetwork.details()
    expect(details.activeShareClasses.some((sc) => sc.id.equals(scId))).to.be.true

    const asset = await context.centrifuge.assetCurrency(assetId)
    const vaultAddr = await client.readContract({
      address: vaultRouter,
      abi: ABI.VaultRouter,
      functionName: 'getVault',
      args: [poolId.raw, scId.raw, asset.address],
    })

    const vault = new Vault(
      context.centrifuge,
      new PoolNetwork(context.centrifuge, new Pool(context.centrifuge, poolId.raw), centId),
      details.activeShareClasses.find((sc) => sc.id.equals(scId))!.shareClass,
      asset.address,
      vaultAddr as any,
      assetId
    )

    const vaultDetails = await vault.details()
    expect(vaultDetails.isSyncDeposit).to.be.true

    const maxReserve = await client.readContract({
      address: addresses.syncManager,
      abi: ABI.SyncManager,
      functionName: 'maxReserve',
      args: [poolId.raw, scId.raw, asset.address, 0n],
    })
    expect(maxReserve).to.equal(340282366920938463463374607431768211455n)
  })

  it.skip('disables vaults', async () => {
    const { vaultRouter } = await context.centrifuge._protocolAddresses(centId)
    const client = await context.centrifuge.getClient(centId)

    context.tenderlyFork.impersonateAddress = poolManager
    context.centrifuge.setSigner(context.tenderlyFork.signer)

    const scId = ShareClassId.from(poolId, 2)
    const assetId = AssetId.from(1, 1)
    const asset = await context.centrifuge.assetCurrency(assetId)

    const vaultAddr = await client.readContract({
      address: vaultRouter,
      abi: ABI.VaultRouter,
      functionName: 'getVault',
      args: [poolId.raw, scId.raw, asset.address],
    })

    const mock = sinon.mock(poolNetwork)
    mock.expects('details').resolves({
      activeShareClasses: [{ id: scId, vaults: [{ assetId, address: vaultAddr }] }],
    })

    const result = await poolNetwork.unlinkVaults([
      { shareClassId: scId, assetId, address: vaultAddr as `0x${string}` },
    ])
    expect(result.type).to.equal('TransactionConfirmed')

    const vaultAddr2 = await client.readContract({
      address: vaultRouter,
      abi: ABI.VaultRouter,
      functionName: 'getVault',
      args: [poolId.raw, scId.raw, asset.address],
    })
    expect(vaultAddr2).to.equal(NULL_ADDRESS)
  })

  it.skip('links vaults', async () => {
    const { vaultRouter } = await context.centrifuge._protocolAddresses(centId)
    const client = await context.centrifuge.getClient(centId)

    context.tenderlyFork.impersonateAddress = poolManager
    context.centrifuge.setSigner(context.tenderlyFork.signer)

    const scId = ShareClassId.from(poolId, 2)
    const assetId = AssetId.from(1, 1)
    const asset = await context.centrifuge.assetCurrency(assetId)

    const initialVaultAddr = await client.readContract({
      address: vaultRouter,
      abi: ABI.VaultRouter,
      functionName: 'getVault',
      args: [poolId.raw, scId.raw, asset.address],
    })
    expect(initialVaultAddr).not.to.equal(NULL_ADDRESS)

    const mockUnlink = sinon.mock(poolNetwork)
    mockUnlink.expects('details').resolves({
      activeShareClasses: [{ id: scId, vaults: [{ assetId, address: initialVaultAddr }] }],
    })

    const unlinkResult = await poolNetwork.unlinkVaults([
      { shareClassId: scId, assetId, address: initialVaultAddr as `0x${string}` },
    ])
    expect(unlinkResult.type).to.equal('TransactionConfirmed')

    mockUnlink.restore()

    const unlinkedVaultAddr = await client.readContract({
      address: vaultRouter,
      abi: ABI.VaultRouter,
      functionName: 'getVault',
      args: [poolId.raw, scId.raw, asset.address],
    })
    expect(unlinkedVaultAddr).to.equal(NULL_ADDRESS)

    const mockLink = sinon.mock(poolNetwork)
    mockLink.expects('details').resolves({
      activeShareClasses: [
        {
          id: scId,
          vaults: [{ assetId, address: initialVaultAddr }],
        },
      ],
    })

    const linkResult = await poolNetwork.linkVaults([
      { shareClassId: scId, assetId, address: initialVaultAddr as `0x${string}` },
    ])
    expect(linkResult.type).to.equal('TransactionConfirmed')

    mockLink.restore()

    const linkedVaultAddr = await client.readContract({
      address: vaultRouter,
      abi: ABI.VaultRouter,
      functionName: 'getVault',
      args: [poolId.raw, scId.raw, asset.address],
    })
    expect(linkedVaultAddr).to.equal(initialVaultAddr)
    expect(linkedVaultAddr).not.to.equal(NULL_ADDRESS)
  })


  describe.skip('onOfframpManager', () => {
    it.skip('returns onOfframpManager', async () => {
      context.tenderlyFork.impersonateAddress = poolManager
      context.centrifuge.setSigner(context.tenderlyFork.signer)

      await context.tenderlyFork.fundAccountEth(poolManager, 10n ** 18n)
      await poolNetwork.pool.updateBalanceSheetManagers([
        { centrifugeId: centId, address: '0x8c0E6DC2461c6190A3e5703B714942cacfCb3C14', canManage: true },
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
        { centrifugeId: centId, address: '0x8c0E6DC2461c6190A3e5703B714942cacfCb3C14', canManage: true },
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

      const pool = new Pool(centrifugeWithPin, poolId.raw)

      await pool.update({}, [], [{ tokenName: 'DummyShareClass', symbolName: 'DSC' }])

      const addresses = await centrifugeWithPin._protocolAddresses(centId)
      const client = await centrifugeWithPin.getClient(centId)

      const shareClassesCount = await client.readContract({
        address: addresses.shareClassManager,
        abi: ABI.ShareClassManager,
        functionName: 'shareClassCount',
        args: [poolId.raw],
      })

      await poolNetwork.deploy([{ id: ShareClassId.from(pool.id, shareClassesCount), hook: '0x' }], [])

      const result = await poolNetwork.deployOnOfframpManager(ShareClassId.from(pool.id, shareClassesCount))

      expect(result.type).to.equal('TransactionConfirmed')
    })

    it.skip('should assign onOfframpManager permissions', async () => {
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

      const pool = new Pool(centrifugeWithPin, poolId.raw)

      await pool.update({}, [], [{ tokenName: 'DummyShareClass', symbolName: 'DSC' }])

      const addresses = await centrifugeWithPin._protocolAddresses(centId)
      const client = await centrifugeWithPin.getClient(centId)

      const shareClassesCount = await client.readContract({
        address: addresses.shareClassManager,
        abi: ABI.ShareClassManager,
        functionName: 'shareClassCount',
        args: [poolId.raw],
      })

      await poolNetwork.deploy([{ id: ShareClassId.from(pool.id, shareClassesCount), hook: '0x' }], [])

      await poolNetwork.deployOnOfframpManager(ShareClassId.from(pool.id, shareClassesCount))

      // TODO: Needs data in indexer to return onOffRampManager who is not already a balance sheet manager
      await poolNetwork.assignOnOffRampManagerPermissions(ShareClassId.from(pool.id, shareClassesCount))
    })
  })
})

describe('PoolNetwork manager deployment flows', () => {
  afterEach(() => {
    sinon.restore()
  })

  it('reuses an existing on/off-ramp manager and only updates balance sheet access', async () => {
    const existingManager = '0x4444444444444444444444444444444444444444'
    const { poolNetwork, walletClient, updateBalanceSheetManagers } = createManagerDeploymentTestSubject({
      onOffRampManagers: [{ address: existingManager }],
    })

    const result = await lastValueFrom(poolNetwork.deployAndRegisterOnOffRampManager(scId))

    expect(result.type).to.equal('TransactionConfirmed')
    expect(walletClient.writeContract.called).to.equal(false)
    expect(
      updateBalanceSheetManagers.calledOnceWithExactly([
        { centrifugeId: centId, address: existingManager, canManage: true },
      ])
    ).to.equal(true)
  })

  it('deploys a new on/off-ramp manager and then updates balance sheet access', async () => {
    const deployedManager = '0x5555555555555555555555555555555555555555'
    const receipt = makeOnOffRampReceipt(deployedManager)
    const { poolNetwork, walletClient, updateBalanceSheetManagers } = createManagerDeploymentTestSubject({
      receipt,
    })

    const result = await lastValueFrom(poolNetwork.deployAndRegisterOnOffRampManager(scId))

    expect(result.type).to.equal('TransactionConfirmed')
    expect(walletClient.writeContract.calledOnce).to.equal(true)
    expect(
      updateBalanceSheetManagers.calledOnceWithExactly([
        { centrifugeId: centId, address: deployedManager, canManage: true },
      ])
    ).to.equal(true)
  })

})

function createManagerDeploymentTestSubject({
  onOffRampManagers = [],
  receipt = { status: 'success', logs: [] } as any as TransactionReceipt,
}: {
  onOffRampManagers?: { address: `0x${string}` }[]
  receipt?: TransactionReceipt
}) {
  const publicClient = {
    getCode: sinon.stub().resolves('0x'),
    waitForTransactionReceipt: sinon.stub().resolves(receipt),
  }
  const walletClient = {
    writeContract: sinon.stub().resolves('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
  }

  const root = {
    _query: (_keys: unknown, callback: () => unknown) => callback(),
    _queryIndexer: (query: string, _variables: unknown, transform: (data: unknown) => unknown) => {
      if (query.includes('onOffRampManagers')) {
        return of(transform({ onOffRampManagers: { items: onOffRampManagers } }))
      }

      throw new Error(`Unexpected indexer query: ${query}`)
    },
    _protocolAddresses: sinon.stub().resolves({
      onOfframpManagerFactory: onOffRampFactory,
    }),
    getClient: sinon.stub().resolves(publicClient),
    _transact: (callback: (ctx: any) => AsyncGenerator<unknown> | Observable<unknown>, centrifugeId: number) => {
      const tx = new Observable<unknown>((subscriber) => {
        ;(async () => {
          try {
            const result = callback({
              publicClient,
              walletClient,
              signingAddress,
              executionAddress: signingAddress,
              chain: {} as any,
              centrifugeId,
              signer: {} as any,
              root,
            })

            if (Symbol.asyncIterator in result) {
              for await (const item of result) {
                subscriber.next(item)
              }
            } else {
              result.subscribe(subscriber)
              return
            }

            subscriber.complete()
          } catch (error) {
            subscriber.error(error)
          }
        })()
      })

      return Object.assign(tx, { centrifugeId })
    },
  }

  const pool = new Pool(root as any, poolId.raw)
  const updateBalanceSheetManagers = sinon
    .stub(pool, 'updateBalanceSheetManagers')
    .returns(of({ type: 'TransactionConfirmed' } as any) as any)

  const poolNetwork = new PoolNetwork(root as any, pool, centId)

  return {
    poolNetwork,
    walletClient,
    updateBalanceSheetManagers,
  }
}

function makeOnOffRampReceipt(manager: `0x${string}`) {
  const topics = encodeEventTopics({
    abi: onOffRampEventAbi,
    eventName: 'DeployOnOfframpManager',
    args: { poolId: poolId.raw, manager },
  })

  const data = encodeAbiParameters([{ type: 'bytes16' }], [scId.raw])

  return {
    status: 'success',
    logs: [
      {
        address: onOffRampFactory,
        topics,
        data,
      },
    ],
  } as any as TransactionReceipt
}

