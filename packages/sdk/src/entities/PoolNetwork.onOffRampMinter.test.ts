import { ABIS_V3_2 } from '@centrifuge/protocol'
import { expect } from 'chai'
import { defer, firstValueFrom, lastValueFrom, Observable, of, toArray } from 'rxjs'
import sinon from 'sinon'
import { decodeAbiParameters, decodeFunctionData, getAddress } from 'viem'
import { ABIS_V3_2 as ABI } from '@centrifuge/protocol'
import { Centrifuge } from '../Centrifuge.js'
import { stubChain, stubProjectedPools } from '../tests/utils.js'
import type { PoolAction, PrepareOutcome, TxStrategy } from '../tx/TxStrategy.js'
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
const refundAddress = '0x6666666666666666666666666666666666666666'
const ramp = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const

// Reference calldata for legacy registration and authorizeOnchainPM; the encoding must not change.
const LEGACY_REGISTRATION_CALL =
  '0x6f644fb00000000000000000000000000000000000000000000000000001000000000001000000000000000000000000000000000000000000000000000000000000000dbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb00000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000001111111111111111111111111111111111111111'
const AUTHORIZE_ONCHAIN_PM_MINTER_GRANT_CALL =
  '0xf3046c8e00000000000000000000000000000000000000000000000000010000000000010001000000000001000000000000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000ddddddddddddddddddddddddddddddddddddddddd00000000000000000000000000000000000000000000000000000000000000000000000000000000000000e0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000011111111111111111111111111111111111111110000000000000000000000000000000000000000000000000000000000000040bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb0000000000000000000000000000000000000000000000000000000000000000000000000000000000000001'

type Batch = { contract: string; data: `0x${string}`[]; messages: Record<number, { type: number }[]> }
type IndexedRamp = { address: `0x${string}`; createdAtBlock: number }
type Routed = { action: string; poolId: string; payload: unknown }

// The pool target resolves the hub entry and its version; the explicit pair resolves the spoke entry.
function registryFor(target: unknown, protocolAddresses: Record<string, unknown>) {
  if (target instanceof PoolId) return { hub, protocolVersion: '3.2', contractAbis: ABIS_V3_2 }
  if (target === hubCentrifugeId) return { hub, contractAbis: ABIS_V3_2 }
  return { ...protocolAddresses, contractAbis: ABIS_V3_2 }
}

function createSubject({
  protocolAddresses = { onOffRampFactory: factory, accountingToken },
  ramps = [],
  balanceSheetManagers = [],
  signing = false,
  route = 'local',
}: {
  protocolAddresses?: Record<string, unknown>
  ramps?: IndexedRamp[]
  balanceSheetManagers?: { address: `0x${string}`; centrifugeId: number; type: string }[]
  // Runs the transaction as a wallet would sign it instead of yielding the raw batch.
  signing?: boolean
  // 'backend' records the routed action and payload instead of building locally.
  route?: 'local' | 'backend'
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
  const routed: Routed[] = []

  const root: any = {
    _query: (_keys: unknown, callback: () => unknown) => callback(),
    _queryData: (name: string, _variables: unknown, transform: (rows: unknown) => unknown) => {
      if (name !== 'onOffRampManagers') throw new Error(`Unexpected query: ${name}`)
      return of(transform(ramps))
    },
    protocolContext: sinon.stub().callsFake(async (target: unknown) => registryFor(target, protocolAddresses)),
    getClient: sinon.stub().resolves(client),
    _estimate: sinon.stub().resolves(0n),
    _classifyHubCalls: sinon.stub().resolves([]),
    _idToChain: sinon.stub().resolves(1),
    _routesToBackend: () => route === 'backend',
    _routeDeferredTransaction: (
      actionName: string | { resolve: () => Promise<string> },
      id: string,
      buildPayload: (action: string) => Promise<unknown>,
      options: { local: () => Observable<unknown> & { centrifugeId?: number }; centrifugeId: number }
    ) => {
      if (route === 'local') return options.local()
      const tx = defer(async () => {
        const action = typeof actionName === 'string' ? actionName : await actionName.resolve()
        routed.push({ action, poolId: id, payload: await buildPayload(action) })
        return { type: 'Routed' }
      })
      return Object.assign(tx, { centrifugeId: options.centrifugeId })
    },
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
  return { poolNetwork, client, walletClient, publicClient, transactionStarted, root, routed }
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

    it('refunds both calls to an explicit refundAddress', async () => {
      const { poolNetwork } = createSubject()

      const [batch] = (await emitted(
        poolNetwork.registerOnOffRampManagerAsBSManager(ramp, scId, { refundAddress })
      )) as Batch[]

      const refunds = batch!.data.map((data) => {
        const args = decodeFunctionData({ abi: ABI.Hub, data }).args!
        return args[args.length - 1]
      })
      expect(refunds).to.deep.equal([getAddress(refundAddress), getAddress(refundAddress)])
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

    it('on a legacy-factory chain ignores an accountingToken in the registry', async () => {
      const { poolNetwork } = createSubject({
        protocolAddresses: { onOfframpManagerFactory: factory, accountingToken },
      })

      const [batch] = (await emitted(poolNetwork.registerOnOffRampManagerAsBSManager(ramp, scId))) as Batch[]

      expect(batch!.data).to.deep.equal([LEGACY_REGISTRATION_CALL])
    })

    it('throws before anything is signed when the new-factory chain lists no accountingToken', async () => {
      const { poolNetwork, client, walletClient } = createSubject({
        protocolAddresses: { onOffRampFactory: factory, accountingToken: undefined },
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

  describe('in backend mode', () => {
    it('routes a new-factory chain to registerOnOffRamp', async () => {
      const { poolNetwork, routed } = createSubject({ route: 'backend' })

      await emitted(poolNetwork.registerOnOffRampManagerAsBSManager(ramp, scId, { refundAddress }))

      expect(routed).to.deep.equal([
        {
          action: 'registerOnOffRamp',
          poolId: poolId.toString(),
          payload: {
            poolId: poolId.toString(),
            scId: scId.raw,
            centrifugeId: String(rampCentrifugeId),
            address: ramp,
            refundAddress,
          },
        },
      ])
    })

    it('routes a legacy chain to updateBalanceSheetManagers with one entry', async () => {
      const { poolNetwork, routed } = createSubject({
        route: 'backend',
        protocolAddresses: { onOfframpManagerFactory: factory },
      })

      await emitted(poolNetwork.registerOnOffRampManagerAsBSManager(ramp, scId, { refundAddress }))

      expect(routed).to.deep.equal([
        {
          action: 'updateBalanceSheetManagers',
          poolId: poolId.toString(),
          payload: {
            poolId: poolId.toString(),
            refundAddress,
            updates: [{ centrifugeId: String(rampCentrifugeId), address: ramp, canManage: true }],
          },
        },
      ])
    })

    for (const [label, protocolAddresses] of [
      ['a new-factory chain', { onOffRampFactory: factory, accountingToken }],
      ['a legacy chain', { onOfframpManagerFactory: factory }],
    ] as const) {
      it(`refuses ${label} without a refundAddress`, async () => {
        const { poolNetwork, routed } = createSubject({ route: 'backend', protocolAddresses })

        const error = await rejection(poolNetwork.registerOnOffRampManagerAsBSManager(ramp, scId))

        expect(error.message).to.match(/refundAddress/)
        expect(routed).to.have.length(0)
      })
    }

    it('refuses a new-factory chain without a share class', async () => {
      const { poolNetwork } = createSubject({ route: 'backend' })

      const error = await rejection(poolNetwork.registerOnOffRampManagerAsBSManager(ramp, undefined, { refundAddress }))

      expect(error.message).to.match(/share class id is required/)
    })

    it('refuses a new-factory chain without an accountingToken', async () => {
      const { poolNetwork } = createSubject({ route: 'backend', protocolAddresses: { onOffRampFactory: factory } })

      const error = await rejection(poolNetwork.registerOnOffRampManagerAsBSManager(ramp, scId, { refundAddress }))

      expect(error.message).to.match(/accountingToken/)
    })

    it('refuses assign after checking the newest ramp, since it passes no refundAddress', async () => {
      const { poolNetwork, routed } = createSubject({ route: 'backend', ramps: [{ address: ramp, createdAtBlock: 1 }] })

      const error = await rejection(poolNetwork.assignOnOffRampManagerPermissions(scId))

      expect(error.message).to.match(/cannot run in backend mode/)
      expect(routed).to.have.length(0)
    })

    it('reports a missing ramp from assign before the refundAddress refusal', async () => {
      const { poolNetwork } = createSubject({ route: 'backend', ramps: [] })

      const error = await rejection(poolNetwork.assignOnOffRampManagerPermissions(scId))

      expect(error.message).to.match(/No on\/off-ramp is indexed/)
    })

    it('reaches a real strategy as registerOnOffRamp on X Layer and as updateBalanceSheetManagers on Plume', async () => {
      const actions: PoolAction[] = []
      const strategy: TxStrategy = {
        prepare(action: PoolAction) {
          actions.push(action)
          return of({
            route: 'custodial',
            txId: 'tx-ramp',
            signerType: 'fordefi',
            status: 'pending_approval',
          } satisfies PrepareOutcome)
        },
      }
      const centrifuge = new Centrifuge({ environment: 'mainnet', txStrategy: strategy })
      sinon.stub(centrifuge as any, '_idToChain').callsFake(() => makeThenable(of(1)))
      stubProjectedPools(centrifuge, [poolId])

      for (const centrifugeId of [13, 4]) {
        const network = new PoolNetwork(centrifuge, new Pool(centrifuge, poolId.raw), centrifugeId)
        await new Promise((resolve) =>
          (network.registerOnOffRampManagerAsBSManager(ramp, scId, { refundAddress }) as any).subscribe({
            complete: resolve,
            error: resolve,
          })
        )
      }

      expect(actions.map((action) => action.action)).to.deep.equal(['registerOnOffRamp', 'updateBalanceSheetManagers'])
      expect(actions[0]!.payload).to.deep.include({ centrifugeId: '13', scId: scId.raw, address: ramp })
      expect(actions[1]!.payload).to.deep.equal({
        poolId: poolId.toString(),
        refundAddress,
        updates: [{ centrifugeId: '4', address: ramp, canManage: true }],
      })
    })
  })

  describe('with a strategy injected but neither candidate action routed to the backend', () => {
    it('runs the local transaction behind the migration gate', async () => {
      const strategy: TxStrategy = { prepare: () => of({ route: 'custodial' } as unknown as PrepareOutcome) }
      const centrifuge = new Centrifuge({ environment: 'mainnet', txStrategy: strategy })
      sinon.stub(centrifuge as any, '_queryData').returns(of(null))
      const local = of({ type: 'Local' }) as any

      const routed = centrifuge._routeDeferredTransaction(
        { resolve: async () => 'registerOnOffRamp', candidates: ['registerOnOffRamp', 'updateBalanceSheetManagers'] },
        poolId.toString(),
        async () => ({}),
        {
          title: 'test',
          centrifugeId: hubCentrifugeId,
          gate: [],
          local: () => local,
          routes: { registerOnOffRamp: 'local', updateBalanceSheetManagers: 'local' },
        }
      )

      expect(await firstValueFrom(routed as any)).to.deep.equal({ type: 'Local' })
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

      expect(batch!.contract).to.equal(hub)
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

    it('compares blocks as numbers when one is far larger than the other', async () => {
      const { poolNetwork } = createSubject({
        ramps: [
          { address: older.address, createdAtBlock: 999 },
          { address: newer.address, createdAtBlock: 2_000_000_000 },
        ],
      })

      expect(await (poolNetwork as any)._findDeployedOnOffRampManagerAddress(scId)).to.equal(newer.address)
    })

    it('refuses to order two rows that carry no block', async () => {
      const { poolNetwork } = createSubject({
        ramps: [{ address: older.address }, { address: newer.address }] as unknown as IndexedRamp[],
      })

      const error = await (poolNetwork as any)._findDeployedOnOffRampManagerAddress(scId).catch((e: Error) => e)

      expect(error.message).to.match(/no createdAtBlock/)
    })

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

    it('registers only the newest of two indexed ramps', async () => {
      const older = { address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', createdAtBlock: 1 } as const
      const { poolNetwork } = createSubject({ ramps: [older, { address: ramp, createdAtBlock: 2 }] })

      const items = (await emitted(poolNetwork.deployAndRegisterOnOffRampManager(scId))) as Batch[]

      expect(decodeRegisteredRamp(items[0]!)).to.equal(addressToBytes32(ramp))
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
      expect(walletClient.sendTransaction.firstCall.args[0].to).to.equal(hub)
    })

    it('sends nothing when the new-factory chain lists no accountingToken', async () => {
      const { poolNetwork, walletClient } = createSubject({
        signing: true,
        protocolAddresses: { onOffRampFactory: factory },
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

  describe('deployAndRegisterOnOffRampManager in backend mode', () => {
    it('refuses before deploying or prompting the wallet', async () => {
      const { poolNetwork, walletClient, transactionStarted, routed } = createSubject({
        route: 'backend',
        signing: true,
      })

      const error = await rejection(poolNetwork.deployAndRegisterOnOffRampManager(scId))

      expect(error.message).to.match(/cannot run in backend mode/)
      expect(error.message).to.contain('registerOnOffRampManagerAsBSManager')
      expect(transactionStarted.callCount).to.equal(0)
      expect(walletClient.sendTransaction.callCount).to.equal(0)
      expect(walletClient.writeContract.callCount).to.equal(0)
      expect(routed).to.have.length(0)
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
        .stub(centrifuge as any, 'protocolContext')
        .callsFake((target: any) => thenable(registryFor(target, protocolAddresses)))
      sinon.stub(centrifuge as any, '_queryData').callsFake((name: any, _vars: any, transform: any) => {
        if (name === 'poolMigration') return of(null)
        if (name === 'poolMigrationSteps') return of([])
        return of(transform(ramps))
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

  describe('against the bundled registry', () => {
    function realRegistrySubject(centrifugeId: number) {
      const centrifuge = new Centrifuge({ environment: 'mainnet' })
      stubChain(centrifuge)
      stubProjectedPools(centrifuge, [poolId])
      sinon.stub(centrifuge as any, '_estimate').callsFake(() => makeThenable(of(0n)))
      return { centrifuge, poolNetwork: new PoolNetwork(centrifuge, new Pool(centrifuge, poolId.raw), centrifugeId) }
    }

    for (const centrifugeId of [1, 2, 3, 10, 13, 14]) {
      it(`centrifugeId ${centrifugeId}: builds register plus a grant aimed at the registry's accountingToken`, async () => {
        const { centrifuge, poolNetwork } = realRegistrySubject(centrifugeId)
        const listed = (await (centrifuge.protocolContext(centrifugeId) as any)) as { accountingToken?: string }

        const built = await centrifuge.buildOnly(poolNetwork.registerOnOffRampManagerAsBSManager(ramp, scId), {
          fromAddress: signingAddress,
        })

        expect(listed.accountingToken, 'the registry lists an accountingToken').to.be.a('string')
        expect(built.calls).to.have.length(2)
        const grant = decodeFunctionData({ abi: ABI.Hub, data: built.calls[1]!.data })
        expect(grant.functionName).to.equal('updateContract')
        const [, grantScId, grantCentrifugeId, target] = grant.args as unknown as [bigint, string, number, string]
        expect(target).to.equal(addressToBytes32(listed.accountingToken!.toLowerCase() as `0x${string}`))
        expect(grantScId).to.equal(scId.raw)
        expect(grantCentrifugeId).to.equal(centrifugeId)
      })
    }

    it('a legacy chain builds the plain registration', async () => {
      const { centrifuge, poolNetwork } = realRegistrySubject(4)

      const built = await centrifuge.buildOnly(poolNetwork.registerOnOffRampManagerAsBSManager(ramp), {
        fromAddress: signingAddress,
      })

      expect(built.calls).to.have.length(1)
      expect(decodeFunctionData({ abi: ABI.Hub, data: built.data }).functionName).to.equal('updateBalanceSheetManager')
    })
  })
})
