import { expect } from 'chai'
import { lastValueFrom, Observable, of, toArray } from 'rxjs'
import sinon from 'sinon'
import { decodeFunctionData } from 'viem'
import { ABI } from '../abi/index.js'
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
 * No fork, no indexer: a fake root with per-chain clients.
 */

const HUB = 1
const SPOKE = 2
const poolId = PoolId.from(HUB, 7)
const scId = ShareClassId.from(poolId, 1)
const signingAddress = '0x5675675675675675675675675675675675675675' as HexString
const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as HexString
const HUB_LZ = addr(0xa1)
const HUB_AXELAR = addr(0xa2)
const SPOKE_LZ = addr(0xb1)
const SPOKE_AXELAR = addr(0xb2)
const OTHER = addr(0xee)

type AdapterState = Record<number, HexString[] | (() => HexString[])>

function createSubject({
  adapters,
  signing = false,
  spokeHasAxelar = true,
}: {
  /** What each chain's MultiAdapter reports for the pool; a function is consulted on every read. */
  adapters: AdapterState
  signing?: boolean
  spokeHasAxelar?: boolean
}) {
  const hubContext = { hub: addr(0x10), multiAdapter: addr(0x11), layerZeroAdapter: HUB_LZ, axelarAdapter: HUB_AXELAR }
  const spokeContext = {
    spoke: addr(0x20),
    balanceSheet: addr(0x21),
    multiAdapter: addr(0x22),
    syncDepositVaultFactory: addr(0x23),
    asyncVaultFactory: addr(0x24),
    syncManager: addr(0x25),
    asyncRequestManager: addr(0x26),
    batchRequestManager: addr(0x27),
    layerZeroAdapter: SPOKE_LZ,
    ...(spokeHasAxelar ? { axelarAdapter: SPOKE_AXELAR } : {}),
  }
  const quorumReads: number[] = []
  // `quorum` fixes the list a read of the adapters starts from; `adapters(i)` then indexes it.
  const lastAdapters = new Map<number, HexString[]>()
  const clientFor = (centrifugeId: number) => ({
    readContract: async ({ functionName, args }: { functionName: string; args: readonly unknown[] }) => {
      if (functionName === 'manager') return true
      if (functionName === 'requestManager') return addr(0xff)
      if (functionName === 'quorum') {
        quorumReads.push(centrifugeId)
        const state = adapters[centrifugeId] ?? []
        const list = typeof state === 'function' ? state() : state
        lastAdapters.set(centrifugeId, list)
        return list.length
      }
      if (functionName === 'adapters') return lastAdapters.get(centrifugeId)?.[Number(args[2])]
      throw new Error(`unexpected read ${functionName}`)
    },
    getCode: async () => undefined,
    waitForTransactionReceipt: async ({ hash }: { hash: HexString }) => ({ status: 'success', hash }),
  })
  const clients = { [HUB]: clientFor(HUB), [SPOKE]: clientFor(SPOKE) }
  const sendTransaction = sinon.stub()
  sendTransaction.onFirstCall().resolves('0x01').onSecondCall().resolves('0x02')
  const walletClient = { sendTransaction, getChainId: async () => 1 }
  const statuses: any[] = []

  const root: any = {
    _query: (_keys: unknown, callback: () => unknown) => callback(),
    _protocolAddresses: async (centrifugeId: number) => (centrifugeId === HUB ? hubContext : spokeContext),
    getClient: async (centrifugeId: number) => clients[centrifugeId as 1 | 2],
    _estimate: async () => 0n,
    _idToChain: async () => 1,
    _transact: (callback: (ctx: any) => AsyncGenerator<unknown>, centrifugeId: number) => {
      const tx = new Observable<unknown>((subscriber) => {
        ;(async () => {
          try {
            const ctx = signing
              ? { isBatching: false, signingAddress, centrifugeId, walletClient, publicClient: clients[HUB], root }
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
  return { poolNetwork, sendTransaction, statuses, quorumReads }
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

  it('skips setAdapters when both MultiAdapters already hold the wiring', async () => {
    const { poolNetwork } = createSubject({ adapters: { [HUB]: [HUB_LZ], [SPOKE]: [SPOKE_LZ] } })
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
      { [HUB]: [HUB_LZ], [SPOKE]: [] },
      { [HUB]: [], [SPOKE]: [SPOKE_LZ] },
    ]) {
      const { poolNetwork } = createSubject({ adapters })
      const error = await rejection(deploy(poolNetwork))
      expect(error.message).to.contain('has no adapters')
      sinon.restore()
    }
  })

  it('does not skip setAdapters when the spoke holds a different set than the hub', async () => {
    const { poolNetwork } = createSubject({ adapters: { [HUB]: [HUB_LZ], [SPOKE]: [OTHER] } })
    const error = await rejection(deploy(poolNetwork))
    expect(error.message).to.contain('has no adapters')
  })

  it('does not skip setAdapters when the hub uses an adapter the spoke registry lacks', async () => {
    const { poolNetwork } = createSubject({
      adapters: { [HUB]: [HUB_AXELAR], [SPOKE]: [SPOKE_LZ] },
      spokeHasAxelar: false,
    })
    const error = await rejection(deploy(poolNetwork))
    expect(error.message).to.contain('has no adapters')
  })

  it('respects a wiring through adapters the registry does not know', async () => {
    const { poolNetwork } = createSubject({ adapters: { [HUB]: [OTHER], [SPOKE]: [OTHER] } })
    const [batch] = (await emitted(deploy(poolNetwork))) as any[]
    expect(batch.data.flatMap((data: HexString) => hubCalls(data))).to.not.include('setAdapters')
  })

  it('sends setAdapters on its own and waits for the destination before the pool messages', async () => {
    // Unwired when the deployment starts; wired by the time the SDK polls for it.
    let spokeReads = 0
    const { poolNetwork, sendTransaction, statuses, quorumReads } = createSubject({
      signing: true,
      adapters: { [HUB]: [], [SPOKE]: () => (spokeReads++ === 0 ? [] : [SPOKE_LZ]) },
    })

    await emitted(deploy(poolNetwork))

    expect(sendTransaction.callCount).to.equal(2)
    expect(hubCalls(sendTransaction.firstCall.args[0].data)).to.deep.equal(['setAdapters'])
    const second = hubCalls(sendTransaction.secondCall.args[0].data)
    expect(second).to.not.include('setAdapters')
    expect(second).to.include('notifyPool')
    expect(second).to.include('notifyShareClass')
    expect(quorumReads.filter((id) => id === SPOKE).length).to.be.greaterThan(1)

    const types = statuses.map((s) => s.type)
    const awaiting = types.indexOf('AwaitingCrosschainDelivery')
    expect(awaiting).to.be.greaterThan(types.indexOf('TransactionConfirmed'))
    expect(awaiting).to.be.lessThan(types.lastIndexOf('SigningTransaction'))
    expect(statuses[awaiting].hash).to.equal('0x01')
    expect(statuses[awaiting].toCentrifugeId).to.equal(SPOKE)
  })

  it('keeps waiting while the destination holds a different adapter set', async () => {
    const answers: HexString[][] = [[], [OTHER], [OTHER], [SPOKE_LZ]]
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
})
