import { expect } from 'chai'
import { defer, isObservable, lastValueFrom, of } from 'rxjs'
import sinon from 'sinon'
import { decodeFunctionData, encodeFunctionData, zeroAddress } from 'viem'
import { ABIS_V3_3, resolveProtocolContext } from '@centrifuge/protocol'
import { Centrifuge } from '../Centrifuge.js'
import { stubChain, stubLayerZeroGlobalSet, stubMigrationRows } from '../tests/utils.js'
import type { HexString } from '../types/index.js'
import { addressToBytes32 } from '../utils/index.js'
import { makeThenable } from '../utils/rx.js'
import { PoolId, ShareClassId } from '../utils/types.js'
import { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'

// First activation of a v3.3 pool on another network. `Hub.setAdapters` reverts inside a Hub
// batch on v3.3, so the activation is `setAdapters` and then the Hub batch, in one
// `wallet_sendCalls` prompt when the wallet takes it. Built against the bundled testnet registry.

const HUB = 1
const SPOKE = 2
const POOL_ID = PoolId.from(HUB, 33)
const SC_ID = ShareClassId.from(POOL_ID, 1)
const SIGNER = '0x6bcb240d3e1f1c4321ecaffdacb45691dc03be5d' as HexString
const REQUEST_MANAGER = '0x19f46d8130e610c6c0f0116ea40fb781defade93' as HexString
const HOOK = '0x9999999999999999999999999999999999999999' as HexString
const SEPOLIA = 11155111
const HASH_1 = `0x${'11'.repeat(32)}` as HexString
const HASH_2 = `0x${'22'.repeat(32)}` as HexString
const LZ_LIVE = { name: 'layerZero', isEnabled: true, crosschainInProgress: null }

const thenable = <T>(value: T) => makeThenable(of(value))
const hub33 = () => resolveProtocolContext(POOL_ID.raw.toString(), '3.3', { environment: 'testnet' })

const STALE_LZ = '0x9537000000000000000000000000000000ee39' as HexString

/**
 * A testnet SDK that knows pool 33 as v3.3, with the pool's adapter rows per chain as the indexer reports them and the
 * pool set the hub's MultiAdapter holds toward each network.
 */
function setup(
  poolAdapters: (localCentrifugeId: number) => (typeof LZ_LIVE)[],
  walletClient?: object,
  signal?: AbortSignal,
  hubPoolSet: (centrifugeId: number) => HexString[] = () => [hub33().addresses.layerZeroAdapter!]
) {
  const centrifuge = new Centrifuge({ environment: 'testnet' })
  stubLayerZeroGlobalSet()
  // Entities bind `_transact` at construction, so the signing stub goes in before any is built.
  const statuses = walletClient ? signWith(centrifuge, walletClient, signal) : []
  sinon
    .stub(centrifuge as any, '_poolRows')
    .returns(of([{ id: POOL_ID.toString(), protocolVersion: '3.3', migrationStatus: 'live' }]))
  stubMigrationRows(centrifuge)
  stubChain(centrifuge, {
    // Every manager read answers yes, so no balance sheet manager or AdapterFailover leg is added.
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === 'manager') return true
      if (functionName === 'requestManager') return REQUEST_MANAGER
      // The pool has no hub policy, so the pre-send check ends at this read.
      if (functionName === 'policy') return zeroAddress
      throw new Error(`unexpected read ${functionName}`)
    },
  })
  sinon.stub(centrifuge as any, '_queryDataOnce').callsFake((async (name: string, vars: any) => {
    if (name !== 'poolAdapters') throw new Error(`unexpected data query "${name}"`)
    return poolAdapters(Number(vars.localCentrifugeId)).map((row) => ({ ...row, adapter: { name: row.name } }))
  }) as any)
  sinon.stub(centrifuge, '_estimate').returns(thenable(0n) as any)
  const readMultiAdapter = sinon.stub(centrifuge, '_readMultiAdapter').callsFake(((
    _on: unknown,
    centrifugeId: number,
    poolId: bigint
  ) => {
    if (poolId !== POOL_ID.raw) throw new Error(`unexpected MultiAdapter read for pool ${poolId}`)
    const adapters = hubPoolSet(centrifugeId)
    return of({ adapters, threshold: adapters.length })
  }) as any)
  const network = new PoolNetwork(centrifuge, new Pool(centrifuge, POOL_ID), SPOKE)
  sinon.stub(network, 'details').returns(thenable({ isActive: false, activeShareClasses: [] }) as any)
  return { centrifuge, network, statuses, readMultiAdapter }
}

/**
 * A browser wallet recording what it is asked. `capabilities` is its `wallet_getCapabilities` entry for the chain,
 * or `null` when it does not know the method. The bundle is pending on the first status poll, with the first
 * transaction mined, and done on the second.
 */
function wallet(capabilities: object | null = { atomic: { status: 'supported' } }) {
  const requests: { method: string; params: any }[] = []
  const sendTransaction = sinon.stub()
  sendTransaction.onFirstCall().resolves(HASH_1)
  sendTransaction.resolves(HASH_2)
  const receipt = (transactionHash: HexString) => ({
    status: '0x1',
    blockNumber: '0x1',
    gasUsed: '0x1',
    transactionHash,
    logs: [],
  })
  const request = async ({ method, params }: { method: string; params: any }) => {
    requests.push({ method, params })
    if (method === 'wallet_getCapabilities') {
      if (!capabilities) throw new Error('Method not found')
      return { [`0x${SEPOLIA.toString(16)}`]: capabilities }
    }
    if (method === 'wallet_sendCalls') return { id: 'bundle-1' }
    if (method === 'wallet_getCallsStatus') {
      const polls = requests.filter((r) => r.method === 'wallet_getCallsStatus').length
      return polls === 1
        ? { status: 100, receipts: [receipt(HASH_1)] }
        : { status: 200, receipts: [receipt(HASH_1), receipt(HASH_2)] }
    }
    throw new Error(`unexpected wallet request ${method}`)
  }
  const client = {
    uid: 'wallet',
    pollingInterval: 1,
    account: { address: SIGNER, type: 'json-rpc' },
    chain: { id: SEPOLIA },
    request,
    getChainId: async () => SEPOLIA,
    sendTransaction,
  }
  return { client, requests, sendTransaction }
}

/** Runs `deploy` as the wallet signs it, collecting the statuses. `signal` is the caller's cancel signal. */
function signWith(centrifuge: Centrifuge, walletClient: object, signal = new AbortController().signal) {
  const statuses: any[] = []
  sinon.stub(centrifuge, '_transact').callsFake(((callback: any, centrifugeId: number) =>
    (async () => {
      const generator = callback({
        isBatching: false,
        signingAddress: SIGNER,
        centrifugeId,
        signal,
        walletClient,
        publicClient: {
          getCode: async () => undefined,
          getTransactionReceipt: async ({ hash }: { hash: HexString }) => ({
            status: 'success',
            transactionHash: hash,
            logs: [],
          }),
          waitForTransactionReceipt: async ({ hash }: { hash: HexString }) => ({
            status: 'success',
            transactionHash: hash,
            logs: [],
          }),
        },
        root: centrifuge,
      })
      if (isObservable(generator)) {
        await lastValueFrom(generator, { defaultValue: undefined })
        return
      }
      for await (const status of generator) statuses.push(status)
    })()) as any)
  return statuses
}

const setAdaptersCall = () =>
  encodeFunctionData({
    abi: ABIS_V3_3.Hub,
    functionName: 'setAdapters',
    args: [
      POOL_ID.raw,
      SPOKE,
      [hub33().addresses.layerZeroAdapter!],
      [
        addressToBytes32(
          resolveProtocolContext(POOL_ID.raw.toString(), '3.3', { environment: 'testnet', centrifugeId: SPOKE })
            .addresses.layerZeroAdapter!
        ),
      ],
      1,
      SIGNER,
    ],
  })

const hubBatch = (data: HexString) => {
  const outer = decodeFunctionData({ abi: ABIS_V3_3.Hub, data })
  const inner = outer.functionName === 'multicall' ? (outer.args![0] as readonly HexString[]) : [data]
  return inner.map((call) => decodeFunctionData({ abi: ABIS_V3_3.Hub, data: call }).functionName)
}

const deployShareClass = (network: PoolNetwork) => network.deployShareClasses([{ id: SC_ID, hook: HOOK }])

describe('PoolNetwork first activation on v3.3', () => {
  afterEach(() => sinon.restore())

  it('sends setAdapters and then the Hub batch in one wallet_sendCalls prompt', async () => {
    const { client, requests, sendTransaction } = wallet()
    const { centrifuge, network, statuses } = setup(() => [], client)

    await deployShareClass(network)

    expect(sendTransaction.callCount).to.equal(0)
    const sent = requests.filter((r) => r.method === 'wallet_sendCalls')
    expect(sent).to.have.length(1)
    const calls = sent[0]!.params[0].calls as { to: HexString; data: HexString }[]
    const hub = hub33().addresses.hub!.toLowerCase()
    expect(calls.map((call) => call.to.toLowerCase())).to.deep.equal([hub, hub])
    expect(calls[0]!.data).to.equal(setAdaptersCall())
    const batch = hubBatch(calls[1]!.data)
    expect(batch).to.not.include('setAdapters')
    expect(batch[0]).to.equal('notifyPool')
    expect(batch).to.include('notifyShareClass')
    // One prompt; pending as soon as the wallet names the first transaction, confirmed with the last.
    expect(statuses.map((s) => [s.type, s.hash])).to.deep.equal([
      ['SigningTransaction', undefined],
      ['TransactionPending', HASH_1],
      ['TransactionConfirmed', HASH_2],
    ])
    expect(statuses.map((s) => s.type)).to.not.include('AwaitingCrosschainDelivery')
    // `SetPoolAdapters` routes over the global set; the pool's messages are priced against the adapter it installs.
    const estimate = centrifuge._estimate as unknown as sinon.SinonStub
    expect(estimate.getCalls().map((call) => call.args[3])).to.deep.equal([
      undefined,
      [hub33().addresses.layerZeroAdapter],
    ])
  })

  it('falls back to two transactions back to back when the wallet does not take wallet_sendCalls', async () => {
    const { client, requests, sendTransaction } = wallet(null)
    const { network, statuses } = setup(() => [], client)

    await deployShareClass(network)

    expect(requests.map((r) => r.method)).to.not.include('wallet_sendCalls')
    expect(sendTransaction.callCount).to.equal(2)
    expect(sendTransaction.firstCall.args[0].data).to.equal(setAdaptersCall())
    expect(hubBatch(sendTransaction.secondCall.args[0].data)[0]).to.equal('notifyPool')
    expect(statuses.filter((s) => s.type === 'TransactionConfirmed')).to.have.length(2)
  })

  it('falls back to two transactions when the wallet states no batching for the chain', async () => {
    const { client, requests, sendTransaction } = wallet({})
    const { network } = setup(() => [], client)

    await deployShareClass(network)

    expect(requests.map((r) => r.method)).to.not.include('wallet_sendCalls')
    expect(sendTransaction.callCount).to.equal(2)
  })

  it('stops waiting for the call bundle when the caller cancels, naming the bundle', async () => {
    const controller = new AbortController()
    const { client } = wallet()
    const request = client.request
    client.request = async (args: { method: string; params: any }) => {
      if (args.method === 'wallet_getCallsStatus') controller.abort()
      return request(args)
    }
    const { network } = setup(() => [], client, controller.signal)

    let error: Error | undefined
    try {
      await deployShareClass(network)
    } catch (e) {
      error = e as Error
    }

    expect(error?.message).to.contain('cancelled')
    expect(error?.message).to.contain('bundle-1')
  })

  it('sends one transaction, without setAdapters, when the pool is already wired', async () => {
    const { client, requests, sendTransaction } = wallet()
    const { network } = setup(() => [LZ_LIVE], client)

    await deployShareClass(network)

    expect(requests.map((r) => r.method)).to.not.include('wallet_sendCalls')
    expect(sendTransaction.callCount).to.equal(1)
    expect(hubBatch(sendTransaction.firstCall.args[0].data)).to.not.include('setAdapters')
  })

  it('refuses to build an activation that needs setAdapters, which cannot run inside a Hub batch', async () => {
    const { centrifuge, network } = setup(() => [])

    let error: Error | undefined
    try {
      await centrifuge.buildOnly(deployShareClass(network), { fromAddress: SIGNER })
    } catch (e) {
      error = e as Error
    }

    expect(error?.message).to.contain('reverts inside a Hub batch')
    // It names the call a multisig can build on its own instead, with the adapters `deploy` would set.
    const spokeLz = resolveProtocolContext(POOL_ID.raw.toString(), '3.3', {
      environment: 'testnet',
      centrifugeId: SPOKE,
    }).addresses.layerZeroAdapter!
    expect(error?.message).to.contain(
      `pool.setAdapters([{ centrifugeId: ${SPOKE}, localAdapters: [${hub33().addresses.layerZeroAdapter}], ` +
        `remoteAdapters: [${spokeLz}], threshold: 1 }])`
    )
  })

  it('builds the pool messages alone once a separately sent setAdapters is in flight to the spoke', async () => {
    const inFlight = {
      name: 'layerZero',
      isEnabled: false,
      crosschainInProgress: 'Enabled',
    } as unknown as typeof LZ_LIVE
    const { centrifuge, network } = setup((local) => (local === HUB ? [LZ_LIVE] : [inFlight]))

    const built = await centrifuge.buildOnly(deployShareClass(network), { fromAddress: SIGNER })

    const batch = hubBatch(built.data)
    expect(batch).to.not.include('setAdapters')
    expect(batch[0]).to.equal('notifyPool')
    expect(built.pendingPoolAdapters).to.equal(undefined)
  })

  it('sends setAdapters when the hub holds no pool set, though the indexer keeps an enabled row on both sides', async () => {
    const { client, requests } = wallet()
    const { centrifuge, network } = setup(() => [LZ_LIVE], client, undefined, () => [])

    await deployShareClass(network)

    const sent = requests.filter((r) => r.method === 'wallet_sendCalls')
    expect(sent).to.have.length(1)
    const calls = sent[0]!.params[0].calls as { to: HexString; data: HexString }[]
    expect(calls[0]!.data).to.equal(setAdaptersCall())
    expect(hubBatch(calls[1]!.data)).to.not.include('setAdapters')
    const estimate = centrifuge._estimate as unknown as sinon.SinonStub
    expect(estimate.getCalls().map((call) => call.args[3])).to.deep.equal([
      undefined,
      [hub33().addresses.layerZeroAdapter],
    ])
  })

  it('sends setAdapters over a stale in-flight row when the hub holds no pool set', async () => {
    const inFlight = { name: 'layerZero', isEnabled: false, crosschainInProgress: 'Enabled' } as unknown as typeof LZ_LIVE
    const { centrifuge, network } = setup((local) => (local === HUB ? [LZ_LIVE] : [inFlight]), undefined, undefined, () => [])

    let error: Error | undefined
    try {
      await centrifuge.buildOnly(deployShareClass(network), { fromAddress: SIGNER })
    } catch (e) {
      error = e as Error
    }

    expect(error?.message).to.contain('reverts inside a Hub batch')
  })

  it('trusts the indexer rows and does not read the pool set when they already ask for setAdapters', async () => {
    const { network, readMultiAdapter } = setup(() => [], wallet().client, undefined, () => [STALE_LZ])

    await deployShareClass(network)

    expect(readMultiAdapter.callCount).to.equal(0)
  })

  it('runs deployToNetworks one network at a time when a wired-looking network has no pool set on the hub', async () => {
    const { centrifuge } = setup(() => [LZ_LIVE], wallet().client, undefined, (cid) => (cid === 3 ? [] : [STALE_LZ]))
    const batchTransactions = sinon.stub(centrifuge, 'batchTransactions')
    const deployed: number[] = []
    sinon.stub(PoolNetwork.prototype, 'deploy').callsFake(function (this: PoolNetwork) {
      deployed.push(this.centrifugeId)
      return of({ type: 'TransactionConfirmed' }) as any
    })

    await new Pool(centrifuge, POOL_ID).deployToNetworks([
      { centrifugeId: SPOKE, shareClasses: [{ id: SC_ID, hook: HOOK }] },
      { centrifugeId: 3, shareClasses: [{ id: SC_ID, hook: HOOK }] },
    ])

    expect(batchTransactions.callCount).to.equal(0)
    expect(deployed).to.deep.equal([SPOKE, 3])
  })

  it('runs deployToNetworks one network at a time when a network still needs its adapters', async () => {
    const { centrifuge } = setup((local) => (local === 3 ? [] : [LZ_LIVE]), wallet().client)
    const batchTransactions = sinon.stub(centrifuge, 'batchTransactions')
    const deployed: number[] = []
    sinon.stub(PoolNetwork.prototype, 'deploy').callsFake(function (this: PoolNetwork) {
      deployed.push(this.centrifugeId)
      return of({ type: 'TransactionConfirmed' }) as any
    })

    await new Pool(centrifuge, POOL_ID).deployToNetworks([
      { centrifugeId: SPOKE, shareClasses: [{ id: SC_ID, hook: HOOK }] },
      { centrifugeId: 3, shareClasses: [{ id: SC_ID, hook: HOOK }] },
    ])

    expect(batchTransactions.callCount).to.equal(0)
    expect(deployed).to.deep.equal([SPOKE, 3])
  })

  it('stops deployToNetworks at the first network whose deploy ends out of policy', async () => {
    const { centrifuge } = setup((local) => (local === 3 ? [] : [LZ_LIVE]), wallet().client)
    const started: number[] = []
    sinon.stub(PoolNetwork.prototype, 'deploy').callsFake(function (this: PoolNetwork) {
      const centrifugeId = this.centrifugeId
      return defer(() => {
        started.push(centrifugeId)
        return of({ id: 'refused', type: 'OutOfPolicy', title: 'Deploy', calls: [] })
      }) as any
    })

    await new Pool(centrifuge, POOL_ID).deployToNetworks([
      { centrifugeId: SPOKE, shareClasses: [{ id: SC_ID, hook: HOOK }] },
      { centrifugeId: 3, shareClasses: [{ id: SC_ID, hook: HOOK }] },
    ])

    expect(started).to.deep.equal([SPOKE])
  })
})
