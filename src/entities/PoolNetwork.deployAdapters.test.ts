import { expect } from 'chai'
import { lastValueFrom, Observable, of, toArray } from 'rxjs'
import sinon from 'sinon'
import { decodeFunctionData } from 'viem'
import { ABI } from '../abi/index.js'
import { SAFE_PROXY_BYTECODE } from '../constants.js'
import type { PoolAdapterState } from '../utils/poolAdapters.js'
import type { HexString } from '../types/index.js'
import { makeThenable } from '../utils/rx.js'
import { PoolId, ShareClassId } from '../utils/types.js'
import { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'

/**
 * `PoolNetwork.deploy` on a network the pool is not wired to yet. The destination MultiAdapter
 * rejects every message of a pool it has no adapters for, and `setAdapters` travels through the
 * global adapters while the pool messages travel through the pool's own LayerZero 1/1, so batching
 * them in one transaction made the pool messages arrive first and fail. These cases pin the split.
 * Whether the pool is wired, and when the spoke has received the configuration, is read from the
 * indexer's pool adapter rows. No fork, no indexer: a fake root with per-chain clients.
 */

const HUB = 1
const SPOKE = 2
const poolId = PoolId.from(HUB, 7)
const scId = ShareClassId.from(poolId, 1)
const signingAddress = '0x5675675675675675675675675675675675675675' as HexString
const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as HexString
const HUB_LZ = addr(0xa1)
const SPOKE_LZ = addr(0xb1)
const OTHER = addr(0xee)
const HASH_1 = `0x${'1'.padStart(64, '0')}` as HexString
const HASH_2 = `0x${'2'.padStart(64, '0')}` as HexString
const LZ_LIVE: PoolAdapterState = { name: 'layerZero', isEnabled: true, crosschainInProgress: null }
const AXELAR_LIVE: PoolAdapterState = { name: 'axelar', isEnabled: true, crosschainInProgress: null }
const LZ_IN_FLIGHT: PoolAdapterState = { name: 'layerZero', isEnabled: false, crosschainInProgress: 'Enabled' }

/** The indexer's pool adapter rows per chain (`localCentrifugeId`); a function is consulted on every read. */
type AdapterState = Record<number, PoolAdapterState[] | (() => PoolAdapterState[])>

function createSubject({
  adapters,
  signing = false,
  safeSigner = false,
}: {
  adapters: AdapterState
  signing?: boolean
  /** Make the signer look like a Safe proxy, so `doTransaction` takes the Safe path. */
  safeSigner?: boolean
}) {
  const hubContext = { hub: addr(0x10), layerZeroAdapter: HUB_LZ }
  const spokeContext = {
    spoke: addr(0x20),
    balanceSheet: addr(0x21),
    syncDepositVaultFactory: addr(0x23),
    asyncVaultFactory: addr(0x24),
    syncManager: addr(0x25),
    asyncRequestManager: addr(0x26),
    batchRequestManager: addr(0x27),
    layerZeroAdapter: SPOKE_LZ,
  }
  const indexerReads: number[] = []
  const client = {
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === 'manager') return true
      if (functionName === 'requestManager') return addr(0xff)
      throw new Error(`unexpected read ${functionName}`)
    },
    getCode: async () => (safeSigner ? SAFE_PROXY_BYTECODE : undefined),
    waitForTransactionReceipt: async ({ hash }: { hash: HexString }) => ({
      status: 'success',
      hash,
      transactionHash: hash,
    }),
  }
  const sendTransaction = sinon.stub()
  sendTransaction.onFirstCall().resolves(HASH_1).onSecondCall().resolves(HASH_2)
  const walletClient = { sendTransaction, getChainId: async () => 1 }
  const statuses: any[] = []

  const root: any = {
    _query: (_keys: unknown, callback: () => unknown) => callback(),
    _protocolAddresses: async (centrifugeId: number) => (centrifugeId === HUB ? hubContext : spokeContext),
    getClient: async () => client,
    _estimate: async () => 0n,
    _idToChain: async () => 1,
    // The indexer rows behind the pool adapters query, keyed by the chain asked (`local`).
    _getIndexerObservable: (_query: string, vars: { local: string }) => {
      const local = Number(vars.local)
      indexerReads.push(local)
      const state = adapters[local] ?? []
      const rows = typeof state === 'function' ? state() : state
      return of({
        poolAdapters: {
          items: rows.map((row) => ({
            isEnabled: row.isEnabled,
            crosschainInProgress: row.crosschainInProgress,
            adapter: { name: row.name },
          })),
        },
      })
    },
    _transact: (callback: (ctx: any) => AsyncGenerator<unknown>, centrifugeId: number) => {
      const tx = new Observable<unknown>((subscriber) => {
        ;(async () => {
          try {
            const ctx = signing
              ? { isBatching: false, signingAddress, centrifugeId, walletClient, publicClient: client, root }
              : { isBatching: true, signingAddress, centrifugeId, walletClient, root }
            for await (const item of callback(ctx)) {
              statuses.push(item)
              subscriber.next(item)
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

  const pool = new Pool(root, poolId.raw)
  const poolNetwork = new PoolNetwork(root, pool, SPOKE)
  sinon.stub(poolNetwork, 'details').returns(makeThenable(of({ isActive: false, activeShareClasses: [] })) as any)
  return { poolNetwork, sendTransaction, statuses, indexerReads }
}

async function emitted(tx: unknown) {
  return lastValueFrom((tx as Observable<unknown>).pipe(toArray()))
}

async function rejection(tx: unknown): Promise<Error> {
  try {
    await emitted(tx)
  } catch (error) {
    return error as Error
  }
  throw new Error('expected the transaction to fail')
}

function hubCalls(data: HexString): string[] {
  const outer = decodeFunctionData({ abi: ABI.Hub, data })
  const inner = outer.functionName === 'multicall' ? (outer.args![0] as readonly HexString[]) : [data]
  return inner.map((call) => decodeFunctionData({ abi: ABI.Hub, data: call }).functionName)
}

const deploy = (poolNetwork: PoolNetwork) => poolNetwork.deploy([{ id: scId, hook: OTHER }], [])

describe('PoolNetwork.deploy: pool adapters are set before the pool messages', () => {
  afterEach(() => sinon.restore())

  it('skips setAdapters when the indexer shows the pool wired on both sides', async () => {
    const { poolNetwork } = createSubject({ adapters: { [HUB]: [LZ_LIVE], [SPOKE]: [LZ_LIVE] } })
    const [batch] = (await emitted(deploy(poolNetwork))) as any[]
    const calls = batch.data.flatMap((data: HexString) => hubCalls(data))
    expect(calls).to.not.include('setAdapters')
    expect(calls).to.include('notifyPool')
    expect(calls).to.include('notifyShareClass')
  })

  it('refuses to build a deployment that still needs setAdapters, rather than racing it', async () => {
    const { poolNetwork } = createSubject({ adapters: { [HUB]: [], [SPOKE]: [] } })
    const error = await rejection(deploy(poolNetwork))
    expect(error.message).to.contain('has no adapters')
  })

  it('does not skip setAdapters when only one side is configured', async () => {
    for (const adapters of [
      { [HUB]: [LZ_LIVE], [SPOKE]: [] },
      { [HUB]: [], [SPOKE]: [LZ_LIVE] },
    ]) {
      const { poolNetwork } = createSubject({ adapters })
      const error = await rejection(deploy(poolNetwork))
      expect(error.message).to.contain('has no adapters')
      sinon.restore()
    }
  })

  it('does not skip setAdapters while the spoke is still receiving the configuration', async () => {
    // The indexer creates the spoke row when the hub sends the message and marks it in flight
    // until the spoke executes it; a non-empty row is not a delivered one.
    const { poolNetwork } = createSubject({ adapters: { [HUB]: [LZ_LIVE], [SPOKE]: [LZ_IN_FLIGHT] } })
    const error = await rejection(deploy(poolNetwork))
    expect(error.message).to.contain('has no adapters')
  })

  it('does not skip setAdapters when the spoke holds a different set than the hub', async () => {
    const { poolNetwork } = createSubject({ adapters: { [HUB]: [LZ_LIVE], [SPOKE]: [AXELAR_LIVE] } })
    const error = await rejection(deploy(poolNetwork))
    expect(error.message).to.contain('has no adapters')
  })

  it('compares adapters by their indexer name, so an unknown adapter wired on both sides is respected', async () => {
    const unknown: PoolAdapterState = { name: 'unknown', isEnabled: true, crosschainInProgress: null }
    const { poolNetwork } = createSubject({ adapters: { [HUB]: [unknown], [SPOKE]: [unknown] } })
    const [batch] = (await emitted(deploy(poolNetwork))) as any[]
    expect(batch.data.flatMap((data: HexString) => hubCalls(data))).to.not.include('setAdapters')
  })

  it('sends setAdapters on its own and waits for the spoke rows to settle before the pool messages', async () => {
    // Unwired when the deployment starts; live on the spoke by the time the SDK polls for it.
    let spokeReads = 0
    const { poolNetwork, sendTransaction, statuses, indexerReads } = createSubject({
      signing: true,
      adapters: { [HUB]: [], [SPOKE]: () => (spokeReads++ === 0 ? [] : [LZ_LIVE]) },
    })

    await emitted(deploy(poolNetwork))

    expect(sendTransaction.callCount).to.equal(2)
    expect(hubCalls(sendTransaction.firstCall.args[0].data)).to.deep.equal(['setAdapters'])
    const second = hubCalls(sendTransaction.secondCall.args[0].data)
    expect(second).to.not.include('setAdapters')
    expect(second).to.include('notifyPool')
    expect(second).to.include('notifyShareClass')
    expect(indexerReads.filter((id) => id === SPOKE).length).to.be.greaterThan(1)

    const types = statuses.map((s) => s.type)
    const awaiting = types.indexOf('AwaitingCrosschainDelivery')
    expect(awaiting).to.be.greaterThan(types.indexOf('TransactionConfirmed'))
    expect(awaiting).to.be.lessThan(types.lastIndexOf('SigningTransaction'))
    expect(statuses[awaiting].hash).to.equal(HASH_1)
    expect(statuses[awaiting].toCentrifugeId).to.equal(SPOKE)
  })

  it('keeps waiting while the spoke rows are in flight or hold a different set', async () => {
    // One answer per spoke read. Pre-check: empty. Polls: in flight, a stale set, then live.
    const answers: PoolAdapterState[][] = [[], [LZ_IN_FLIGHT], [AXELAR_LIVE], [LZ_LIVE]]
    let spokeReads = 0
    const { poolNetwork, sendTransaction } = createSubject({
      signing: true,
      adapters: { [HUB]: [], [SPOKE]: () => answers[Math.min(spokeReads++, answers.length - 1)]! },
    })
    const clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'Date'] })
    try {
      const done = emitted(deploy(poolNetwork))
      for (let i = 0; i < 3; i++) await clock.tickAsync(10_000)
      await done
    } finally {
      clock.restore()
    }
    expect(sendTransaction.callCount).to.equal(2)
    expect(spokeReads).to.equal(answers.length)
  })

  it('still carries the setAdapters id and hash when a Safe already executed it', async () => {
    // `doTransaction` takes the Safe path when the signer is a Safe proxy; an already executed
    // Safe transaction must still produce the confirmed status the wait is keyed on.
    sinon.stub(globalThis, 'fetch').resolves({
      ok: true,
      json: async () => ({ isExecuted: true, transactionHash: HASH_1 }),
    } as any)
    let spokeReads = 0
    const { poolNetwork, sendTransaction, statuses } = createSubject({
      signing: true,
      safeSigner: true,
      adapters: { [HUB]: [], [SPOKE]: () => (spokeReads++ === 0 ? [] : [LZ_LIVE]) },
    })

    await emitted(deploy(poolNetwork))

    expect(sendTransaction.callCount).to.equal(2)
    const awaiting = statuses.find((s) => s.type === 'AwaitingCrosschainDelivery')
    expect(awaiting.id).to.be.a('string').and.not.empty
    expect(awaiting.hash).to.equal(HASH_1)
    expect(statuses.filter((s) => s.type === 'TransactionConfirmed')).to.have.length(2)
  })
})
