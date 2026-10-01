import { expect } from 'chai'
import { lastValueFrom, Observable, of, toArray } from 'rxjs'
import sinon from 'sinon'
import { decodeAbiParameters, decodeFunctionData, getAddress } from 'viem'
import { ABI } from '../abi/index.js'
import { Centrifuge } from '../Centrifuge.js'
import { stubChain } from '../tests/utils.js'
import { MessageType } from '../types/transaction.js'
import { addressToBytes32 } from '../utils/index.js'
import { makeThenable } from '../utils/rx.js'
import { PoolId, ShareClassId } from '../utils/types.js'
import { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'

const hubCentrifugeId = 1
const rampCentrifugeId = 13
const poolId = PoolId.from(hubCentrifugeId, 1)
const scId = ShareClassId.from(poolId, 1)
const hub = '0xcccccccccccccccccccccccccccccccccccccccc'
const accountingToken = '0xdddddddddddddddddddddddddddddddddddddddd'
const factory = '0x2222222222222222222222222222222222222222'
const signingAddress = '0x1111111111111111111111111111111111111111'
const ramp = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const

// Reference calldata for legacy registration and authorizeOnchainPM; the encoding must not change.
const LEGACY_REGISTRATION_CALL =
  '0x6f644fb00000000000000000000000000000000000000000000000000001000000000001000000000000000000000000000000000000000000000000000000000000000dbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb00000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000001111111111111111111111111111111111111111'
const AUTHORIZE_ONCHAIN_PM_MINTER_GRANT_CALL =
  '0xf3046c8e00000000000000000000000000000000000000000000000000010000000000010001000000000001000000000000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000ddddddddddddddddddddddddddddddddddddddddd00000000000000000000000000000000000000000000000000000000000000000000000000000000000000e0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000011111111111111111111111111111111111111110000000000000000000000000000000000000000000000000000000000000040bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb0000000000000000000000000000000000000000000000000000000000000000000000000000000000000001'

type Batch = { contract: string; data: `0x${string}`[]; messages: Record<number, { type: number }[]> }
type IndexedRamp = { address: `0x${string}`; createdAtBlock: number }

function createSubject({
  protocolAddresses = { onOffRampFactory: factory, accountingToken },
  ramps = [],
  balanceSheetManagers = [],
  signing = false,
}: {
  protocolAddresses?: Record<string, unknown>
  ramps?: IndexedRamp[]
  balanceSheetManagers?: { address: `0x${string}`; centrifugeId: number; type: string }[]
  // Runs the transaction as a wallet would sign it instead of yielding the raw batch.
  signing?: boolean
} = {}) {
  const client = {
    readContract: sinon.stub().rejects(new Error('unexpected eth_call')),
    call: sinon.stub().rejects(new Error('unexpected eth_call')),
    simulateContract: sinon.stub().rejects(new Error('unexpected eth_call')),
  }
  const walletClient = {
    writeContract: sinon.stub(),
    sendTransaction: sinon.stub().resolves('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
    getChainId: sinon.stub().resolves(1),
  }
  // Called when a transaction starts, which is where the real _transact resolves the wallet.
  const transactionStarted = sinon.stub()
  const publicClient = {
    getCode: sinon.stub().resolves('0x'),
    waitForTransactionReceipt: sinon.stub().resolves({ status: 'success', logs: [] }),
  }

  const root: any = {
    _query: (_keys: unknown, callback: () => unknown) => callback(),
    // Returns only the fields the query selects, as the indexer does.
    _queryIndexer: (query: string, _variables: unknown, transform: (data: unknown) => unknown) => {
      if (!query.includes('onOffRampManagers')) throw new Error(`Unexpected indexer query: ${query}`)
      const items = ramps.map((row) =>
        Object.fromEntries(Object.entries(row).filter(([field]) => query.includes(field)))
      )
      return of(transform({ onOffRampManagers: { items } }))
    },
    _protocolAddresses: sinon
      .stub()
      .callsFake(async (centrifugeId: number) => (centrifugeId === hubCentrifugeId ? { hub } : protocolAddresses)),
    getClient: sinon.stub().resolves(client),
    _estimate: sinon.stub().resolves(0n),
    _idToChain: sinon.stub().resolves(1),
    _transact: (callback: (ctx: any) => AsyncGenerator<unknown> | Observable<unknown>, centrifugeId: number) => {
      const tx = new Observable<unknown>((subscriber) => {
        ;(async () => {
          try {
            transactionStarted()
            const ctx = signing
              ? { isBatching: false, signingAddress, centrifugeId, walletClient, publicClient, root }
              : // isBatching makes wrapTransaction yield the raw batch instead of signing.
                { isBatching: true, signingAddress, centrifugeId, walletClient, root }
            const result = callback(ctx)
            if (Symbol.asyncIterator in result) {
              for await (const item of result) subscriber.next(item)
              subscriber.complete()
              return
            }
            result.subscribe(subscriber)
          } catch (error) {
            subscriber.error(error)
          }
        })()
      })
      return Object.assign(tx, { centrifugeId })
    },
  }

  const pool = new Pool(root, poolId.raw)
  sinon.stub(pool, 'balanceSheetManagers').returns(of(balanceSheetManagers) as any)
  const poolNetwork = new PoolNetwork(root, pool, rampCentrifugeId)
  return { poolNetwork, client, walletClient, publicClient, transactionStarted, root }
}

async function emitted(tx: unknown) {
  return lastValueFrom((tx as Observable<unknown>).pipe(toArray()))
}

async function rejection(tx: unknown) {
  try {
    await emitted(tx)
  } catch (error) {
    return error as Error
  }
  throw new Error('expected the transaction to fail')
}

function expectNoEthCall(client: ReturnType<typeof createSubject>['client']) {
  expect(client.readContract.callCount).to.equal(0)
  expect(client.call.callCount).to.equal(0)
  expect(client.simulateContract.callCount).to.equal(0)
}

function decodeRegisteredRamp(batch: Batch) {
  const decoded = decodeFunctionData({ abi: ABI.Hub, data: batch.data[0]! })
  return decoded.args![2] as string
}

describe('PoolNetwork on/off-ramp registration with the accounting-token minter grant', () => {
  afterEach(() => {
    sinon.restore()
  })

  describe('registerOnOffRampManagerAsBSManager', () => {
    it('on a new-factory chain batches the manager registration and the minter grant into one hub transaction', async () => {
      const { poolNetwork, client } = createSubject()

      const items = await emitted(poolNetwork.registerOnOffRampManagerAsBSManager(ramp, scId))

      expect(items).to.have.length(1)
      const batch = items[0] as Batch
      expect(batch.contract).to.equal(hub)
      expect(batch.data).to.have.length(2)

      const register = decodeFunctionData({ abi: ABI.Hub, data: batch.data[0]! })
      expect(register.functionName).to.equal('updateBalanceSheetManager')
      expect(register.args).to.deep.equal([
        poolId.raw,
        rampCentrifugeId,
        addressToBytes32(ramp),
        true,
        getAddress(signingAddress),
      ])

      const grant = decodeFunctionData({ abi: ABI.Hub, data: batch.data[1]! })
      expect(grant.functionName).to.equal('updateContract')
      const [grantPoolId, grantScId, grantCentrifugeId, target, payload, extraGas, refund] = grant.args!
      expect([grantPoolId, grantScId, grantCentrifugeId, extraGas, refund]).to.deep.equal([
        poolId.raw,
        scId.raw,
        rampCentrifugeId,
        0n,
        getAddress(signingAddress),
      ])
      expect(target).to.equal(addressToBytes32(accountingToken))
      expect(decodeAbiParameters([{ type: 'bytes32' }, { type: 'bool' }], payload as `0x${string}`)).to.deep.equal([
        addressToBytes32(ramp),
        true,
      ])

      expect(batch.messages).to.deep.equal({
        [rampCentrifugeId]: [
          { type: MessageType.UpdateBalanceSheetManager, poolId },
          { type: MessageType.TrustedContractUpdate, poolId },
        ],
      })
      expectNoEthCall(client)
    })

    it('encodes the minter grant byte-identically to authorizeOnchainPM for the same manager and token', async () => {
      const { poolNetwork } = createSubject()

      const [batch] = (await emitted(poolNetwork.registerOnOffRampManagerAsBSManager(ramp, scId))) as Batch[]

      expect(batch!.data[0]).to.equal(LEGACY_REGISTRATION_CALL)
      expect(batch!.data[1]).to.equal(AUTHORIZE_ONCHAIN_PM_MINTER_GRANT_CALL)
    })

    it('keeps legacy updateBalanceSheetManager calldata byte-identical on a chain without onOffRampFactory', async () => {
      const { poolNetwork, client } = createSubject({ protocolAddresses: { onOfframpManagerFactory: factory } })

      const items = await emitted(poolNetwork.registerOnOffRampManagerAsBSManager(ramp))

      const batch = items[0] as Batch
      expect(items).to.have.length(1)
      expect(batch.data).to.deep.equal([LEGACY_REGISTRATION_CALL])
      expect(batch.messages).to.deep.equal({
        [rampCentrifugeId]: [{ type: MessageType.UpdateBalanceSheetManager, poolId }],
      })
      expectNoEthCall(client)
    })

    it('on a legacy-factory chain ignores an accountingToken in the deployments', async () => {
      const { poolNetwork } = createSubject({
        protocolAddresses: { onOfframpManagerFactory: factory, accountingToken },
      })

      const [batch] = (await emitted(poolNetwork.registerOnOffRampManagerAsBSManager(ramp, scId))) as Batch[]

      expect(batch!.data).to.deep.equal([LEGACY_REGISTRATION_CALL])
    })

    it('throws before anything is signed when the new-factory chain lists no accountingToken', async () => {
      const { poolNetwork, client, walletClient } = createSubject({
        protocolAddresses: { onOffRampFactory: factory, accountingToken: null },
      })

      const error = await rejection(poolNetwork.registerOnOffRampManagerAsBSManager(ramp, scId))

      expect(error.message).to.match(/accountingToken/)
      expect(error.message).to.contain(`centrifugeId ${rampCentrifugeId}`)
      expect(walletClient.writeContract.callCount).to.equal(0)
      expect(walletClient.sendTransaction.callCount).to.equal(0)
      expectNoEthCall(client)
    })

    it('emits no batch when the new-factory chain lists no accountingToken', async () => {
      const { poolNetwork } = createSubject({ protocolAddresses: { onOffRampFactory: factory } })
      const batches: unknown[] = []

      await new Promise<void>((resolve) =>
        poolNetwork.registerOnOffRampManagerAsBSManager(ramp, scId).subscribe({
          next: (item) => batches.push(item),
          error: () => resolve(),
          complete: () => resolve(),
        })
      )

      expect(batches).to.have.length(0)
    })

    it('throws before anything is signed when a new-factory chain gets no share class', async () => {
      const { poolNetwork, walletClient } = createSubject()
      const batches: unknown[] = []

      const error = await new Promise<Error>((resolve, reject) =>
        poolNetwork.registerOnOffRampManagerAsBSManager(ramp).subscribe({
          next: (item) => batches.push(item),
          error: resolve,
          complete: () => reject(new Error('expected an error')),
        })
      )

      expect(error.message).to.match(/share class id is required/)
      expect(batches).to.have.length(0)
      expect(walletClient.writeContract.callCount).to.equal(0)
      expect(walletClient.sendTransaction.callCount).to.equal(0)
    })
  })

  describe('Pool.updateBalanceSheetManagers', () => {
    it('keeps legacy updateBalanceSheetManager calldata, hub and messages byte-identical', async () => {
      const { poolNetwork } = createSubject({ protocolAddresses: { onOfframpManagerFactory: factory } })

      const items = (await emitted(
        poolNetwork.pool.updateBalanceSheetManagers([
          { centrifugeId: rampCentrifugeId, address: ramp, canManage: true },
        ])
      )) as Batch[]

      expect(items).to.have.length(1)
      expect(items[0]!.contract).to.equal(hub)
      expect(items[0]!.data).to.deep.equal([LEGACY_REGISTRATION_CALL])
      expect(items[0]!.messages).to.deep.equal({
        [rampCentrifugeId]: [{ type: MessageType.UpdateBalanceSheetManager, poolId }],
      })
    })
  })

  describe('authorizeOnchainPM', () => {
    it('keeps its calldata byte-identical', async () => {
      const { poolNetwork, client } = createSubject()

      const [batch] = (await emitted(poolNetwork.authorizeOnchainPM(ramp, scId.raw))) as Batch[]

      expect(batch!.data).to.deep.equal([LEGACY_REGISTRATION_CALL, AUTHORIZE_ONCHAIN_PM_MINTER_GRANT_CALL])
      expectNoEthCall(client)
    })
  })

  describe('picking the newest indexed ramp', () => {
    const older = { address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', createdAtBlock: 9 } as const
    const newer = { address: '0x1111111111111111111111111111111111111110', createdAtBlock: 10 } as const
    const inBothOrders: [string, IndexedRamp[]][] = [
      ['the older ramp is listed last', [newer, older]],
      ['the older ramp is listed first', [older, newer]],
    ]

    for (const [title, ramps] of inBothOrders) {
      it(`finds the higher createdAtBlock when ${title}, comparing blocks numerically, not as text`, async () => {
        const { poolNetwork } = createSubject({ ramps })

        expect(await (poolNetwork as any)._findDeployedOnOffRampManagerAddress(scId)).to.equal(newer.address)
      })

      it(`onOfframpManager resolves the higher createdAtBlock among verified ramps when ${title}`, async () => {
        const { poolNetwork } = createSubject({
          ramps,
          balanceSheetManagers: [older, newer].map(({ address }) => ({
            address,
            centrifugeId: rampCentrifugeId,
            type: 'balanceSheet',
          })),
        })

        const manager = await lastValueFrom(poolNetwork.onOfframpManager(scId))

        expect(manager.onrampAddress).to.equal(newer.address)
      })

      it(`assignOnOffRampManagerPermissions registers only the higher createdAtBlock when ${title}`, async () => {
        const { poolNetwork, client } = createSubject({ ramps })

        const items = (await emitted(poolNetwork.assignOnOffRampManagerPermissions(scId))) as Batch[]

        expect(items).to.have.length(1)
        expect(items[0]!.data).to.have.length(2)
        expect(decodeRegisteredRamp(items[0]!)).to.equal(addressToBytes32(newer.address))
        expectNoEthCall(client)
      })
    }

    it('onOfframpManager ignores a newer ramp that is not a balance sheet manager', async () => {
      const { poolNetwork } = createSubject({
        ramps: [older, newer],
        balanceSheetManagers: [{ address: older.address, centrifugeId: rampCentrifugeId, type: 'balanceSheet' }],
      })

      const manager = await lastValueFrom(poolNetwork.onOfframpManager(scId))

      expect(manager.onrampAddress).to.equal(older.address)
    })

    it('breaks a createdAtBlock tie with the highest lowercase address', async () => {
      const low = { address: '0x00000000000000000000000000000000000000a1', createdAtBlock: 5 } as const
      const high = { address: '0x00000000000000000000000000000000000000f1', createdAtBlock: 5 } as const
      for (const ramps of [
        [low, high],
        [high, low],
      ]) {
        const { poolNetwork } = createSubject({ ramps })

        expect(await (poolNetwork as any)._findDeployedOnOffRampManagerAddress(scId)).to.equal(high.address)
      }
    })

    it('assignOnOffRampManagerPermissions fails naming the ramp when the newest one is already a balance sheet manager', async () => {
      const { poolNetwork } = createSubject({
        ramps: [older, newer],
        balanceSheetManagers: [{ address: newer.address, centrifugeId: rampCentrifugeId, type: 'balanceSheet' }],
      })

      const error = await rejection(poolNetwork.assignOnOffRampManagerPermissions(scId))

      expect(error.message).to.contain(`The newest on/off-ramp ${newer.address} is already a balance sheet manager`)
      expect(error.message).to.contain('registerOnOffRampManagerAsBSManager')
    })

    it('assignOnOffRampManagerPermissions fails naming the share class when no ramp is indexed', async () => {
      const { poolNetwork } = createSubject({ ramps: [] })

      const error = await rejection(poolNetwork.assignOnOffRampManagerPermissions(scId))

      expect(error.message).to.match(/No on\/off-ramp is indexed for share class .* on centrifugeId 13/)
    })

    it('assignOnOffRampManagerPermissions still registers when the newest ramp is a manager on another network', async () => {
      const { poolNetwork } = createSubject({
        ramps: [older, newer],
        balanceSheetManagers: [{ address: newer.address, centrifugeId: rampCentrifugeId + 1, type: 'balanceSheet' }],
      })

      const items = (await emitted(poolNetwork.assignOnOffRampManagerPermissions(scId))) as Batch[]

      expect(items).to.have.length(1)
      expect(decodeRegisteredRamp(items[0]!)).to.equal(addressToBytes32(newer.address))
    })

    it('assignOnOffRampManagerPermissions on a legacy-factory chain registers the newest ramp without a grant', async () => {
      const { poolNetwork } = createSubject({
        protocolAddresses: { onOfframpManagerFactory: factory },
        ramps: [newer, older],
      })

      const items = (await emitted(poolNetwork.assignOnOffRampManagerPermissions(scId))) as Batch[]

      expect(items).to.have.length(1)
      expect(items[0]!.data).to.have.length(1)
      expect(decodeRegisteredRamp(items[0]!)).to.equal(addressToBytes32(newer.address))
    })
  })

  describe('deployAndRegisterOnOffRampManager', () => {
    it('routes the minter grant through the share class of an already indexed ramp', async () => {
      const { poolNetwork, walletClient, client } = createSubject({
        ramps: [{ address: ramp, createdAtBlock: 7 }],
      })

      const items = (await emitted(poolNetwork.deployAndRegisterOnOffRampManager(scId))) as Batch[]

      expect(items).to.have.length(1)
      expect(items[0]!.data).to.have.length(2)
      const grant = decodeFunctionData({ abi: ABI.Hub, data: items[0]!.data[1]! })
      expect(grant.args![1]).to.equal(scId.raw)
      expect(walletClient.writeContract.callCount).to.equal(0)
      expectNoEthCall(client)
    })
  })

  describe('hub chain', () => {
    const older = { address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', createdAtBlock: 1 } as const

    it('runs register on the pool hub chain, not the ramp chain, in both branches', async () => {
      const grant = createSubject()
      const legacy = createSubject({ protocolAddresses: { onOfframpManagerFactory: factory } })

      expect(grant.poolNetwork.registerOnOffRampManagerAsBSManager(ramp, scId).centrifugeId).to.equal(hubCentrifugeId)
      expect(legacy.poolNetwork.registerOnOffRampManagerAsBSManager(ramp).centrifugeId).to.equal(hubCentrifugeId)
      expect(hubCentrifugeId).to.not.equal(rampCentrifugeId)
    })

    it('runs assign on the pool hub chain', () => {
      const { poolNetwork } = createSubject({ ramps: [older] })

      expect(poolNetwork.assignOnOffRampManagerPermissions(scId).centrifugeId).to.equal(hubCentrifugeId)
    })
  })

  describe('when signing', () => {
    it('sends the legacy registration under the balance sheet manager title', async () => {
      const { poolNetwork, walletClient } = createSubject({
        signing: true,
        protocolAddresses: { onOfframpManagerFactory: factory },
      })

      const items = (await emitted(poolNetwork.registerOnOffRampManagerAsBSManager(ramp))) as { title?: string }[]

      expect(items.some((item) => item.title === 'Update balance sheet managers')).to.equal(true)
      expect(walletClient.sendTransaction.callCount).to.equal(1)
      expect(walletClient.sendTransaction.firstCall.args[0].data).to.equal(LEGACY_REGISTRATION_CALL)
    })

    it('sends the new-factory registration with the grant as one transaction under its own title', async () => {
      const { poolNetwork, walletClient } = createSubject({ signing: true })

      const items = (await emitted(poolNetwork.registerOnOffRampManagerAsBSManager(ramp, scId))) as { title?: string }[]

      expect(items.some((item) => item.title === 'Register on/off-ramp manager')).to.equal(true)
      expect(walletClient.sendTransaction.callCount).to.equal(1)
    })

    it('sends nothing when the new-factory chain lists no accountingToken', async () => {
      const { poolNetwork, walletClient } = createSubject({
        signing: true,
        protocolAddresses: { onOffRampFactory: factory, accountingToken: null },
      })

      await rejection(poolNetwork.registerOnOffRampManagerAsBSManager(ramp, scId))

      expect(walletClient.sendTransaction.callCount).to.equal(0)
      expect(walletClient.writeContract.callCount).to.equal(0)
    })

    it('sends nothing when a new-factory chain gets no share class', async () => {
      const { poolNetwork, walletClient } = createSubject({ signing: true })

      await rejection(poolNetwork.registerOnOffRampManagerAsBSManager(ramp))

      expect(walletClient.sendTransaction.callCount).to.equal(0)
      expect(walletClient.writeContract.callCount).to.equal(0)
    })
  })

  describe('deployAndRegisterOnOffRampManager without an accountingToken', () => {
    it('throws before newManager is signed on a chain that lists onOffRampFactory', async () => {
      const { poolNetwork, walletClient, publicClient, transactionStarted } = createSubject({
        signing: true,
        protocolAddresses: { onOffRampFactory: factory },
      })

      const error = await rejection(poolNetwork.deployAndRegisterOnOffRampManager(scId))
      expect(transactionStarted.callCount).to.equal(0)

      expect(error.message).to.match(/accountingToken/)
      expect(walletClient.writeContract.callCount).to.equal(0)
      expect(walletClient.sendTransaction.callCount).to.equal(0)
      expect(publicClient.getCode.callCount).to.equal(0)
    })
  })

  describe('buildOnly through a real Centrifuge', () => {
    const olderRamp = { address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const, createdAtBlock: 1 }
    const newestRamp = { address: ramp, createdAtBlock: 2 }

    function createRealSubject({
      protocolAddresses = { onOffRampFactory: factory, accountingToken },
      ramps = [],
    }: { protocolAddresses?: Record<string, unknown>; ramps?: IndexedRamp[] } = {}) {
      const centrifuge = new Centrifuge({ environment: 'testnet' })
      const client = {
        readContract: sinon.stub().rejects(new Error('unexpected eth_call')),
        call: sinon.stub().rejects(new Error('unexpected eth_call')),
        simulateContract: sinon.stub().rejects(new Error('unexpected eth_call')),
      }
      stubChain(centrifuge, client)
      const thenable = <T>(value: T) => makeThenable(of(value))
      sinon
        .stub(centrifuge as any, '_protocolAddresses')
        .callsFake((centrifugeId: any) => thenable(centrifugeId === hubCentrifugeId ? { hub } : protocolAddresses))
      sinon.stub(centrifuge as any, '_queryIndexer').callsFake((_query: any, _vars: any, transform: any) => {
        return of(transform({ onOffRampManagers: { items: ramps } }))
      })

      const pool = new Pool(centrifuge, poolId.raw)
      sinon.stub(pool, 'balanceSheetManagers').returns(of([]) as any)
      return { centrifuge, poolNetwork: new PoolNetwork(centrifuge, pool, rampCentrifugeId), client }
    }

    it('builds legacy registration with no signer and no nested transaction', async () => {
      const { centrifuge, poolNetwork, client } = createRealSubject({
        protocolAddresses: { onOfframpManagerFactory: factory },
      })

      const built = await centrifuge.buildOnly(poolNetwork.registerOnOffRampManagerAsBSManager(ramp), {
        fromAddress: signingAddress,
      })

      expect(built.centrifugeId).to.equal(hubCentrifugeId)
      expect(built.to).to.equal(hub)
      expect(built.data).to.equal(LEGACY_REGISTRATION_CALL)
      expectNoEthCall(client)
    })

    it('builds registration with the minter grant with no signer', async () => {
      const { centrifuge, poolNetwork } = createRealSubject()

      const built = await centrifuge.buildOnly(poolNetwork.registerOnOffRampManagerAsBSManager(ramp, scId), {
        fromAddress: signingAddress,
      })

      expect(built.centrifugeId).to.equal(hubCentrifugeId)
      expect(built.calls.map((call) => call.data)).to.deep.equal([
        LEGACY_REGISTRATION_CALL,
        AUTHORIZE_ONCHAIN_PM_MINTER_GRANT_CALL,
      ])
      expect((built.messages![rampCentrifugeId] as { type: number }[]).map((message) => message.type)).to.deep.equal([
        MessageType.UpdateBalanceSheetManager,
        MessageType.TrustedContractUpdate,
      ])
    })

    it('builds assign for the newest ramp with no signer', async () => {
      const { centrifuge, poolNetwork } = createRealSubject({ ramps: [newestRamp, olderRamp] })

      const built = await centrifuge.buildOnly(poolNetwork.assignOnOffRampManagerPermissions(scId), {
        fromAddress: signingAddress,
      })

      expect(built.centrifugeId).to.equal(hubCentrifugeId)
      expect(built.calls.map((call) => call.data)).to.deep.equal([
        LEGACY_REGISTRATION_CALL,
        AUTHORIZE_ONCHAIN_PM_MINTER_GRANT_CALL,
      ])
    })

    it('rejects building assign when no ramp is indexed', async () => {
      const { centrifuge, poolNetwork } = createRealSubject({ ramps: [] })

      let error: Error | null = null
      try {
        await centrifuge.buildOnly(poolNetwork.assignOnOffRampManagerPermissions(scId), { fromAddress: signingAddress })
      } catch (e) {
        error = e as Error
      }

      expect(error?.message).to.match(/No on\/off-ramp is indexed/)
    })
  })
})
