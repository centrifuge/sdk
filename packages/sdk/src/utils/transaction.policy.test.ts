import { ABIS_V3_3 } from '@centrifuge/protocol'
import { expect } from 'chai'
import { of } from 'rxjs'
import sinon from 'sinon'
import { encodeFunctionData, zeroAddress } from 'viem'
import { sepolia } from 'viem/chains'
import { Centrifuge } from '../Centrifuge.js'
import { Pool } from '../entities/Pool.js'
import { randomAddress, stubChain, stubProjectedPools } from '../tests/utils.js'
import type { HexString } from '../types/index.js'
import { MessageType } from '../types/transaction.js'
import type { OperationStatus, OutOfPolicyCall, TransactionContext } from '../types/transaction.js'
import { encodeBatchCalldata, mergeBatchTransactionData, sendCallsInOrder, wrapTransaction } from './transaction.js'
import { PoolId } from './types.js'

const poolId = PoolId.from(2, 33)
const otherPoolId = PoolId.from(2, 34)
const hub = randomAddress()
const signingAddress = randomAddress()
const POLICY = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const
const txHash = '0xabc' as HexString

const hubCall = (pool: PoolId, who: HexString) =>
  encodeFunctionData({ abi: ABIS_V3_3.Hub, functionName: 'updateHubManager', args: [pool.raw, who, true] })
const first = hubCall(poolId, '0x4444444444444444444444444444444444444444')
const second = hubCall(poolId, '0x5555555555555555555555555555555555555555')
const third = hubCall(otherPoolId, '0x6666666666666666666666666666666666666666')

const SC_ID = `0x${'11'.repeat(16)}` as HexString
const sharePriceUpdate = encodeFunctionData({
  abi: ABIS_V3_3.Hub,
  functionName: 'updateSharePrice',
  args: [poolId.raw, SC_ID, 10n ** 18n, 1_700_000_000n],
})
const sharePriceNotification = encodeFunctionData({
  abi: ABIS_V3_3.Hub,
  functionName: 'notifySharePrice',
  args: [poolId.raw, SC_ID, 7, signingAddress],
})

const notReady = (data: HexString): OutOfPolicyCall => ({
  data,
  functionName: 'updateHubManager',
  args: null,
  status: 'needs-authorization',
  reason: null,
  delay: 100n,
  validAfter: null,
  expiresAt: null,
})

async function drain(gen: AsyncGenerator<OperationStatus | unknown, unknown>) {
  return (await run(gen)).out
}

/** Everything the generator yields, and the value it returns. */
async function run(gen: AsyncGenerator<OperationStatus | unknown, unknown>) {
  const out: any[] = []
  let step = await gen.next()
  while (!step.done) {
    out.push(step.value)
    step = await gen.next()
  }
  return { out, result: step.value }
}

/** A transaction context that records every request to the wallet; `classify` answers the pre-send check. */
function makeCtx(classify: (calls: unknown) => Promise<OutOfPolicyCall[]> = async () => []) {
  const sendTransaction = sinon.stub().resolves(txHash)
  const getChainId = sinon.stub().resolves(sepolia.id)
  const classifyHubCalls = sinon.stub().callsFake((_signer: string, calls: unknown) => classify(calls))
  const ctx = {
    isBatching: false,
    signingAddress,
    centrifugeId: 2,
    walletClient: { getChainId, sendTransaction },
    publicClient: {
      getCode: sinon.stub().resolves('0x'),
      waitForTransactionReceipt: sinon.stub().resolves({ status: 'success' }),
    },
    root: {
      _idToChain: sinon.stub().resolves(sepolia.id),
      _estimate: sinon.stub().resolves(0n),
      _classifyHubCalls: classifyHubCalls,
    },
  } as unknown as TransactionContext
  return { ctx, sendTransaction, getChainId, classifyHubCalls }
}

describe('wrapTransaction under a hub policy', () => {
  afterEach(() => sinon.restore())

  it('sends the same request with a policy scope as without one when every call is ready', async () => {
    const plain = makeCtx()
    const scoped = makeCtx()

    await drain(wrapTransaction('Plain', plain.ctx, { contract: hub, data: [first, second], value: 3n }))
    await drain(
      wrapTransaction('Scoped', scoped.ctx, { contract: hub, data: [first, second], value: 3n, policy: { poolId } })
    )

    expect(scoped.sendTransaction.callCount).to.equal(1)
    expect(scoped.sendTransaction.firstCall.args).to.deep.equal(plain.sendTransaction.firstCall.args)
  })

  it('judges every inner call by the pool, as the wallet’s address', async () => {
    const { ctx, classifyHubCalls } = makeCtx()

    await drain(wrapTransaction('Scoped', ctx, { contract: hub, data: [first, second], policy: { poolId } }))

    expect(classifyHubCalls.callCount).to.equal(1)
    expect(classifyHubCalls.firstCall.args).to.deep.equal([
      signingAddress,
      [
        { poolId, data: first },
        { poolId, data: second },
      ],
    ])
  })

  it('does not ask the policy about a transaction that names no pool', async () => {
    const { ctx, classifyHubCalls, sendTransaction } = makeCtx()

    await drain(wrapTransaction('Unscoped', ctx, { contract: hub, data: first }))

    expect(classifyHubCalls.called).to.equal(false)
    expect(sendTransaction.callCount).to.equal(1)
  })

  it('ends with OutOfPolicy and signs nothing when a call is not ready', async () => {
    const { ctx, sendTransaction, getChainId } = makeCtx(async () => [notReady(second)])

    const out = await drain(
      wrapTransaction('Update managers', ctx, { contract: hub, data: [first, second], policy: { poolId } })
    )

    expect(out).to.have.length(1)
    expect(out[0]).to.deep.include({ type: 'OutOfPolicy', title: 'Update managers', calls: [notReady(second)] })
    expect(out[0].id).to.be.a('string').and.not.equal('')
    expect(sendTransaction.called).to.equal(false)
    expect(getChainId.called).to.equal(false)
  })

  it('lists every judged call in send order with its status, the ready ones too, so a caller can rebuild the transaction', async () => {
    const { ctx } = makeCtx(async () => [notReady(second)])

    const [status] = await drain(
      wrapTransaction('Update managers', ctx, { contract: hub, data: [first, second, first], policy: { poolId } })
    )

    expect(status.batch).to.deep.equal([
      { data: first, status: 'ready', deferred: false },
      { data: second, status: 'needs-authorization', deferred: false },
      { data: first, status: 'ready', deferred: false },
    ])
  })

  it('names each not-ready status in the batch as the call carries it', async () => {
    const forbidden = { ...notReady(first), status: 'forbidden' as const, reason: 'other' as const }
    const pending = { ...notReady(second), status: 'pending' as const }
    const { ctx } = makeCtx(async () => [forbidden, pending])

    const [status] = await drain(
      wrapTransaction('Update managers', ctx, { contract: hub, data: [first, second], policy: { poolId } })
    )

    expect(status.batch.map(({ status: value }: { status: string }) => value)).to.deep.equal(['forbidden', 'pending'])
  })

  it('marks a ready call deferred when a rule of the execution rebuilds it for a call that is not ready', async () => {
    const { ctx } = makeCtx(async () => [{ ...notReady(sharePriceUpdate), functionName: 'updateSharePrice' }])

    const [status] = await drain(
      wrapTransaction('Update price', ctx, {
        contract: hub,
        data: [sharePriceUpdate, sharePriceNotification],
        policy: { poolId },
      })
    )

    expect(status.batch).to.deep.equal([
      { data: sharePriceUpdate, status: 'needs-authorization', deferred: false },
      { data: sharePriceNotification, status: 'ready', deferred: true },
    ])
  })

  it('leaves out of the batch a call that names no pool, as it is not judged', async () => {
    const { ctx } = makeCtx(async () => [notReady(second)])
    const merged = mergeBatchTransactionData([
      { contract: hub, data: [first], policy: { poolId } },
      { contract: hub, data: [first] },
      { contract: hub, data: [second], policy: { poolId } },
    ])

    const [status] = await drain(wrapTransaction('Batch', ctx, merged))

    expect(status.batch.map(({ data }: { data: string }) => data)).to.deep.equal([first, second])
  })

  it('returns the OutOfPolicy status it yielded, where building and simulating return nothing', async () => {
    const refused = makeCtx(async () => [notReady(first)])
    const ready = makeCtx()
    const building = makeCtx()
    ;(building.ctx as any).isBatching = true
    const simulating = makeCtx()
    ;(simulating.ctx.publicClient as any).simulateCalls = sinon.stub().resolves({ results: [] })
    const scoped = { contract: hub, data: first, policy: { poolId } }

    const returned = [
      await run(wrapTransaction('Refused', refused.ctx, scoped)),
      await run(wrapTransaction('Sent', ready.ctx, scoped)),
      await run(wrapTransaction('Built', building.ctx, scoped)),
      await run(wrapTransaction('Simulated', simulating.ctx, scoped, { simulate: true })),
    ].map(({ result }) => (result as { type?: string } | undefined)?.type)

    expect(returned).to.deep.equal(['OutOfPolicy', 'TransactionConfirmed', undefined, undefined])
  })

  it('judges before it estimates the cross-chain fee', async () => {
    const { ctx } = makeCtx(async () => [notReady(first)])
    const estimate = (ctx.root as any)._estimate as sinon.SinonStub

    await drain(
      wrapTransaction('Refused', ctx, {
        contract: hub,
        data: first,
        policy: { poolId },
        messages: { 3: [MessageType.RegisterAsset] },
      })
    )

    expect(estimate.called).to.equal(false)
  })

  it('does not send when the check itself fails', async () => {
    const { ctx, sendTransaction } = makeCtx(async () => {
      throw new Error('check failed')
    })

    let error: unknown
    try {
      await drain(wrapTransaction('Scoped', ctx, { contract: hub, data: first, policy: { poolId } }))
    } catch (e) {
      error = e
    }

    expect((error as Error).message).to.equal('check failed')
    expect(sendTransaction.called).to.equal(false)
  })

  it('does not judge a simulation', async () => {
    const { ctx, classifyHubCalls } = makeCtx()
    ;(ctx.publicClient as any).simulateCalls = sinon.stub().resolves({ results: ['ok'] })

    const out = await drain(
      wrapTransaction('Simulate', ctx, { contract: hub, data: first, policy: { poolId } }, { simulate: true })
    )

    expect(out).to.deep.equal([{ type: 'TransactionSimulation', title: 'Simulate', result: ['ok'] }])
    expect(classifyHubCalls.called).to.equal(false)
  })

  it('hands the scope on instead of judging when it only builds', async () => {
    const { ctx, classifyHubCalls } = makeCtx()
    ;(ctx as any).isBatching = true

    const out = await drain(wrapTransaction('Build', ctx, { contract: hub, data: [first, second], policy: { poolId } }))

    expect(classifyHubCalls.called).to.equal(false)
    expect(out).to.have.length(1)
    expect(out[0]).to.deep.include({ contract: hub, data: [first, second], policy: { poolId } })
  })

  it('judges only the calls of a merged batch that name a pool', async () => {
    const { ctx, classifyHubCalls } = makeCtx()
    const exempt = hubCall(poolId, '0x7777777777777777777777777777777777777777')
    const merged = mergeBatchTransactionData([
      { contract: hub, data: [first], policy: { poolId } },
      { contract: hub, data: [exempt] },
      { contract: hub, data: [third], policy: { poolId: otherPoolId } },
    ])

    await drain(wrapTransaction('Batch', ctx, merged))

    expect(classifyHubCalls.firstCall.args[1]).to.deep.equal([
      { poolId, data: first },
      { poolId: otherPoolId, data: third },
    ])
  })
})

describe('mergeBatchTransactionData keeps the pool of every call', () => {
  it('names the pool per call, undefined for a call without one, in call order', () => {
    const merged = mergeBatchTransactionData([
      { contract: hub, data: [first, second], policy: { poolId } },
      { contract: hub, data: [third] },
    ])

    expect(merged.policies).to.deep.equal([{ poolId }, { poolId }, undefined])
    expect(merged).to.not.have.property('policy')
  })

  it('keeps the pools of a batch that was merged before', () => {
    const inner = mergeBatchTransactionData([
      { contract: hub, data: [first], policy: { poolId } },
      { contract: hub, data: [second] },
    ])

    const outer = mergeBatchTransactionData([inner, { contract: hub, data: [third], policy: { poolId: otherPoolId } }])

    expect(outer.policies).to.deep.equal([{ poolId }, undefined, { poolId: otherPoolId }])
  })

  it('names no pool when no batch has one', () => {
    expect(mergeBatchTransactionData([{ contract: hub, data: [first] }])).to.not.have.property('policies')
  })
})

describe('sendCallsInOrder under a hub policy', () => {
  afterEach(() => sinon.restore())

  const calls = [
    { title: 'First', contract: hub, data: [first], policy: { poolId } },
    { title: 'Second', contract: hub, data: [second, third], policy: { poolId } },
  ]

  it('judges every call before the first is signed, and yields OutOfPolicy when only the last is refused', async () => {
    const { ctx, sendTransaction, classifyHubCalls } = makeCtx(async () => [notReady(third)])

    const out = await drain(sendCallsInOrder('Deploy', ctx, calls))

    expect(classifyHubCalls.firstCall.args[1]).to.deep.equal([
      { poolId, data: first },
      { poolId, data: second },
      { poolId, data: third },
    ])
    expect(out).to.have.length(1)
    expect(out[0]).to.deep.include({ type: 'OutOfPolicy', title: 'Deploy', calls: [notReady(third)] })
    expect(sendTransaction.called).to.equal(false)
  })

  it('lists the calls of every send of the order in one batch, in send order', async () => {
    const { ctx } = makeCtx(async () => [notReady(third)])

    const [status] = await drain(sendCallsInOrder('Deploy', ctx, calls))

    expect(status.batch).to.deep.equal([
      { data: first, status: 'ready', deferred: false },
      { data: second, status: 'ready', deferred: false },
      { data: third, status: 'needs-authorization', deferred: false },
    ])
  })

  it('returns the OutOfPolicy status it yielded, and estimates no fee for a send it refuses', async () => {
    const { ctx } = makeCtx(async () => [notReady(first)])
    const estimate = (ctx.root as any)._estimate as sinon.SinonStub
    const priced: Parameters<typeof sendCallsInOrder>[2] = [
      { ...calls[0]!, messages: { 3: [MessageType.RegisterAsset] } },
      calls[1]!,
    ]

    const { out, result } = await run(sendCallsInOrder('Deploy', ctx, priced))

    expect(result).to.equal(out[0])
    expect((result as { type: string }).type).to.equal('OutOfPolicy')
    expect(estimate.called).to.equal(false)
  })

  it('sends the calls one by one when every call is ready', async () => {
    const { ctx, sendTransaction } = makeCtx()

    await drain(sendCallsInOrder('Deploy', ctx, calls))

    expect(sendTransaction.callCount).to.equal(2)
    expect(sendTransaction.firstCall.args[0]).to.deep.equal({ to: hub, data: first, value: 0n })
    expect(sendTransaction.secondCall.args[0]).to.deep.equal({
      to: hub,
      data: encodeBatchCalldata([second, third]),
      value: 0n,
    })
  })

  it('does not ask about a call that names no pool', async () => {
    const { ctx, classifyHubCalls } = makeCtx()

    await drain(sendCallsInOrder('Deploy', ctx, [{ title: 'First', contract: hub, data: [first] }]))

    expect(classifyHubCalls.called).to.equal(false)
  })
})

// The real check over a scripted hub chain: a pool with no policy installed and a v3.2 pool send the request a call
// without a policy scope sends.
describe('wrapTransaction without a hub policy', () => {
  afterEach(() => sinon.restore())

  function rootOf(options: { version: '3.2' | '3.3'; installed: string; indexed: string | null }) {
    const centrifuge = new Centrifuge({ environment: 'testnet' })
    stubProjectedPools(centrifuge, [poolId], options.version)
    const readContract = sinon.stub().callsFake(async ({ functionName }: { functionName: string }) => {
      if (functionName === 'policy') return options.installed
      throw new Error(`unexpected read ${functionName}`)
    })
    const getBlock = sinon.stub().rejects(new Error('unexpected block read'))
    stubChain(centrifuge, { readContract, getBlock })
    sinon
      .stub(Pool.prototype, 'hubExecutionPolicy')
      .callsFake(() => of(options.indexed === null ? null : { address: options.indexed, expiry: 500n }) as any)
    return { centrifuge, readContract }
  }

  // On chain a pool with no policy and one whose policy was set to the zero address are the same state.
  const cases = [
    { name: 'a pool with no policy installed', version: '3.3', installed: zeroAddress, indexed: null, reads: 1 },
    {
      name: 'a pool whose index still lists a policy the chain no longer has',
      version: '3.3',
      installed: zeroAddress,
      indexed: POLICY,
      reads: 1,
    },
    { name: 'a v3.2 pool', version: '3.2', installed: POLICY, indexed: POLICY, reads: 0 },
  ] as const

  for (const { name, version, installed, indexed, reads } of cases) {
    it(`sends ${name} as a call with no policy scope, after ${reads} read${reads === 1 ? '' : 's'}`, async () => {
      const { centrifuge, readContract } = rootOf({ version, installed, indexed })
      const unscoped = makeCtx()
      const scoped = makeCtx()
      ;(scoped.ctx as any).root._classifyHubCalls = centrifuge._classifyHubCalls.bind(centrifuge)

      await drain(wrapTransaction('Update', unscoped.ctx, { contract: hub, data: [first, second], value: 7n }))
      await drain(
        wrapTransaction('Update', scoped.ctx, { contract: hub, data: [first, second], value: 7n, policy: { poolId } })
      )

      expect(scoped.sendTransaction.firstCall.args).to.deep.equal(unscoped.sendTransaction.firstCall.args)
      expect(readContract.callCount).to.equal(reads)
    })
  }
})
