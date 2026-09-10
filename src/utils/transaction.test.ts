import { expect } from 'chai'
import sinon from 'sinon'
import { encodeFunctionData, parseAbi } from 'viem'
import { sepolia } from 'viem/chains'
import { randomAddress } from '../tests/utils.js'
import { HexString } from '../types/index.js'
import { MessageType } from '../types/transaction.js'
import type { OperationStatus, TransactionContext } from '../types/transaction.js'
import { encodeBatchCalldata, wrapTransaction } from './transaction.js'

const ABI = parseAbi(['function setValue(uint256 v)', 'function multicall(bytes[] data) payable'])

describe('encodeBatchCalldata', () => {
  it('throws on an empty call list', () => {
    expect(() => encodeBatchCalldata([])).to.throw('No calldata to encode')
  })

  it('returns a single call verbatim (no multicall wrapper)', () => {
    const call = encodeFunctionData({ abi: ABI, functionName: 'setValue', args: [42n] })
    expect(encodeBatchCalldata([call])).to.equal(call)
  })

  it('wraps two or more calls in multicall(bytes[])', () => {
    const call1 = encodeFunctionData({ abi: ABI, functionName: 'setValue', args: [1n] })
    const call2 = encodeFunctionData({ abi: ABI, functionName: 'setValue', args: [2n] })
    const expected = encodeFunctionData({ abi: ABI, functionName: 'multicall', args: [[call1, call2]] })
    expect(encodeBatchCalldata([call1, call2])).to.equal(expected)
  })

  it('wraps a single call in multicall(bytes[]) when alwaysBatch is set', () => {
    const call = encodeFunctionData({ abi: ABI, functionName: 'setValue', args: [42n] })
    const expected = encodeFunctionData({ abi: ABI, functionName: 'multicall', args: [[call]] })
    expect(encodeBatchCalldata([call], { alwaysBatch: true })).to.equal(expected)
  })

  it('preserves call order when wrapping', () => {
    const a = encodeFunctionData({ abi: ABI, functionName: 'setValue', args: [10n] })
    const b = encodeFunctionData({ abi: ABI, functionName: 'setValue', args: [20n] })
    const c = encodeFunctionData({ abi: ABI, functionName: 'setValue', args: [30n] })
    const forward = encodeBatchCalldata([a, b, c] as HexString[])
    const reordered = encodeBatchCalldata([c, b, a] as HexString[])
    expect(forward).to.not.equal(reordered)
    expect(forward).to.equal(encodeFunctionData({ abi: ABI, functionName: 'multicall', args: [[a, b, c]] }))
  })
})

describe('wrapTransaction broadcast path', () => {
  afterEach(() => sinon.restore())

  const signingAddress = randomAddress()
  const contract = randomAddress()
  const txHash = '0xabc' as HexString

  // Build a mock TransactionContext that drives the non-batching broadcast branch
  // of wrapTransaction: a wallet client that records sendTransaction args, a
  // public client whose receipt confirms success, and a root that resolves the
  // chain so assertWalletChainMatches passes.
  function makeCtx() {
    const sendTransaction = sinon.stub().resolves(txHash)
    const writeContract = sinon.stub().resolves(txHash)
    const ctx = {
      isBatching: false,
      signingAddress,
      centrifugeId: 1,
      walletClient: {
        getChainId: sinon.stub().resolves(sepolia.id),
        sendTransaction,
        writeContract,
      },
      publicClient: {
        getCode: sinon.stub().resolves('0x'),
        waitForTransactionReceipt: sinon.stub().resolves({ status: 'success' }),
      },
      root: {
        _idToChain: sinon.stub().resolves(sepolia.id),
        _estimate: sinon.stub().resolves(0n),
      },
    } as unknown as TransactionContext
    return { ctx, sendTransaction, writeContract }
  }

  async function drain(gen: AsyncGenerator<OperationStatus | unknown>) {
    const out: any[] = []
    for await (const v of gen) out.push(v)
    return out
  }

  it('broadcasts a single call verbatim via sendTransaction (no multicall wrapper)', async () => {
    const { ctx, sendTransaction, writeContract } = makeCtx()
    const data = encodeFunctionData({ abi: ABI, functionName: 'setValue', args: [42n] })

    const statuses = await drain(wrapTransaction('Single', ctx, { contract, data, value: 5n }))

    expect(writeContract.called).to.equal(false)
    expect(sendTransaction.calledOnce).to.equal(true)
    expect(sendTransaction.firstCall.args[0]).to.deep.equal({ to: contract, data, value: 5n })
    expect(statuses.some((s) => s.type === 'TransactionConfirmed' && s.hash === txHash)).to.equal(true)
  })

  it('broadcasts multiple calls as multicall(bytes[]) calldata via sendTransaction', async () => {
    const { ctx, sendTransaction, writeContract } = makeCtx()
    const call1 = encodeFunctionData({ abi: ABI, functionName: 'setValue', args: [1n] })
    const call2 = encodeFunctionData({ abi: ABI, functionName: 'setValue', args: [2n] })

    await drain(wrapTransaction('Multi', ctx, { contract, data: [call1, call2] }))

    expect(writeContract.called).to.equal(false)
    expect(sendTransaction.calledOnce).to.equal(true)
    const sent = sendTransaction.firstCall.args[0]
    expect(sent.to).to.equal(contract)
    expect(sent.data).to.equal(encodeBatchCalldata([call1, call2]))
    expect(sent.value).to.equal(0n)
  })

  it('yields BatchTransactionData (no broadcast) when batching', async () => {
    const { ctx, sendTransaction } = makeCtx()
    ;(ctx as any).isBatching = true
    const data = encodeFunctionData({ abi: ABI, functionName: 'setValue', args: [7n] })

    const out = await drain(wrapTransaction('Batch', ctx, { contract, data }))

    expect(sendTransaction.called).to.equal(false)
    expect(out).to.have.length(1)
    expect(out[0]).to.deep.include({ contract, data: [data] })
  })

  it('carries alwaysBatch through BatchTransactionData when batching', async () => {
    const { ctx } = makeCtx()
    ;(ctx as any).isBatching = true
    const data = encodeFunctionData({ abi: ABI, functionName: 'setValue', args: [7n] })

    const out = await drain(wrapTransaction('Batch', ctx, { contract, data, alwaysBatch: true }))

    expect(out).to.have.length(1)
    expect(out[0]).to.deep.include({ contract, data: [data], alwaysBatch: true })
  })

  it('wraps a single call with alwaysBatch and forwards the message estimate as value', async () => {
    const { ctx, sendTransaction } = makeCtx()
    ;(ctx.root as any)._estimate = sinon.stub().resolves(100n)
    const data = encodeFunctionData({ abi: ABI, functionName: 'setValue', args: [42n] })

    await drain(
      wrapTransaction('Single alwaysBatch', ctx, {
        contract,
        data,
        alwaysBatch: true,
        messages: { 2: [MessageType.RegisterAsset] },
      })
    )

    expect(sendTransaction.calledOnce).to.equal(true)
    const sent = sendTransaction.firstCall.args[0]
    expect(sent.to).to.equal(contract)
    // Building this with encodeBatchCalldata would make the assertion circular.
    expect(sent.data).to.equal(encodeFunctionData({ abi: ABI, functionName: 'multicall', args: [[data]] }))
    expect(sent.value).to.equal(100n)
  })

  it('simulates a single call via the multicall(bytes[]) branch when alwaysBatch is set', async () => {
    const { ctx } = makeCtx()
    const simulateCalls = sinon.stub().resolves({ results: ['ok'] })
    ;(ctx.publicClient as any).simulateCalls = simulateCalls
    const data = encodeFunctionData({ abi: ABI, functionName: 'setValue', args: [5n] })

    await drain(wrapTransaction('Simulate alwaysBatch', ctx, { contract, data, alwaysBatch: true }, { simulate: true }))

    expect(simulateCalls.calledOnce).to.equal(true)
    const call = simulateCalls.firstCall.args[0].calls[0]
    expect(call).to.deep.include({ to: contract, functionName: 'multicall', args: [[data]] })
  })
})
