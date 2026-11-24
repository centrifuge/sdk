import { ABIS_V3_2 } from '@centrifuge/protocol'
import { expect } from 'chai'
import sinon from 'sinon'
import { MessageType, emptyMessage } from '../types/transaction.js'
import { estimateBatchBridgeFee } from './gas.js'
import { PoolId } from './types.js'

const GAS_SERVICE = '0x1111111111111111111111111111111111111111'
const MULTI_ADAPTER = '0x2222222222222222222222222222222222222222'

const POOL_A = new PoolId(281474976710657n)
const POOL_B = new PoolId(281474976710658n)

/**
 * Real payloads, built the way the only production caller builds them
 * (`Centrifuge._estimate` -> `emptyMessage`).
 *
 * A stand-in like `'0x01'` is not a protocol payload — `emptyMessage` emits 250
 * bytes for every type and 90 for `UpdateVault` — and it sits exactly on the
 * grouping hazard: a payload shorter than 9 bytes carries no uint64 pool id to
 * group by, so a truncated key would merge unrelated payloads into one batch
 * and the test would agree with the merge.
 */
const poolAMessages = [
  emptyMessage({ type: MessageType.NotifyPool, poolId: POOL_A }),
  emptyMessage({ type: MessageType.NotifyShareClass, poolId: POOL_A }),
] as const
const poolBMessage = emptyMessage({ type: MessageType.NotifyPool, poolId: POOL_B })

describe('utils/gas estimate flow', () => {
  afterEach(() => {
    sinon.restore()
  })

  it('uses maxBatchGasLimit, passes summed gas to estimate, and applies estimate buffer', async () => {
    const readContract = sinon.stub()
    const publicClient = { readContract } as any
    readContract.onCall(0).resolves(100n) // messageOverallGasLimit
    readContract.onCall(1).resolves(140n) // messageOverallGasLimit
    readContract.onCall(2).resolves(500n) // maxBatchGasLimit
    readContract.onCall(3).resolves(777n) // estimate

    const result = await estimateBatchBridgeFee({
      publicClient,
      gasService: GAS_SERVICE,
      multiAdapter: MULTI_ADAPTER,
      abis: ABIS_V3_2,
      // Two messages for the SAME pool: one batch, gas summed. This is the
      // legitimate grouping, and it still happens — the fix narrows WHICH
      // payloads may share a key, not whether same-pool messages batch.
      gasMessagePayloads: [...poolAMessages],
      toCentrifugeId: 2,
    })

    expect(result).to.equal(1165n)
    expect(
      readContract.calledWithMatch({
        address: GAS_SERVICE,
        functionName: 'maxBatchGasLimit',
        args: [2],
      })
    ).to.equal(true)
    expect(
      // The payload handed to `estimate` is the batch's first message verbatim,
      // and it matters that it is a real payload: MultiAdapter reads the pool
      // id out of it to pick the adapter set, and the fee depends on the
      // payload's CONTENT (the same message padded with `0xff` cost
      // 50,815,112,882 wei more, measured live).
      readContract.calledWithMatch({
        address: MULTI_ADAPTER,
        functionName: 'estimate',
        args: [2, poolAMessages[0], 240n],
      })
    ).to.equal(true)
    // One batch, so exactly one estimate call.
    expect(readContract.withArgs(sinon.match({ functionName: 'estimate' })).callCount).to.equal(1)
  })

  it('throws when summed message gas exceeds maxBatchGasLimit', async () => {
    const readContract = sinon.stub()
    const publicClient = { readContract } as any
    readContract.onCall(0).resolves(200n) // messageOverallGasLimit
    readContract.onCall(1).resolves(300n) // messageOverallGasLimit
    readContract.onCall(2).resolves(400n) // maxBatchGasLimit
    readContract.onCall(3).resolves(777n) // estimate

    try {
      await estimateBatchBridgeFee({
        publicClient,
        gasService: GAS_SERVICE,
        multiAdapter: MULTI_ADAPTER,
        abis: ABIS_V3_2,
        gasMessagePayloads: [...poolAMessages],
        toCentrifugeId: 2,
      })
      expect.fail('Expected estimateBatchBridgeFee to throw when maxBatchGasLimit is exceeded')
    } catch (error) {
      expect((error as Error).message).to.equal('Batch gas 500 exceeds limit 400 for chain 2')
    }

    // `MultiAdapter.estimate` reverts on an over-limit batch with an
    // adapter-side custom error that is in no bundled ABI, so calling it would
    // give the caller an undecodable selector instead of this message. The
    // limit check runs first and the call is skipped.
    expect(readContract.calledWithMatch({ functionName: 'estimate' })).to.equal(false)
  })

  it('refuses a zero estimate rather than returning a fee that underpays', async () => {
    // A zero fee is not an error the chain reports: `estimate` resolves the
    // adapter set for the payload's pool and sums over it, so an unconfigured
    // set returns 0 at any gas limit. Paying 0 does not revert — the hub
    // transaction succeeds and the message stalls, recoverable only through
    // `repayBatch`. Verified against live mainnet pools.
    const readContract = sinon.stub()
    const publicClient = { readContract } as any
    readContract.onCall(0).resolves(100n) // messageOverallGasLimit
    readContract.onCall(1).resolves(500n) // maxBatchGasLimit
    readContract.onCall(2).resolves(0n) // estimate: unconfigured adapter set

    try {
      await estimateBatchBridgeFee({
        publicClient,
        gasService: GAS_SERVICE,
        multiAdapter: MULTI_ADAPTER,
        abis: ABIS_V3_2,
        gasMessagePayloads: [poolAMessages[0]],
        toCentrifugeId: 2,
      })
      expect.fail('Expected estimateBatchBridgeFee to throw on a zero estimate')
    } catch (error) {
      expect((error as Error).message).to.contain('estimated to 0 for chain 2')
      expect((error as Error).message).to.contain('underpaid')
    }
  })

  it('refuses when ONE pool of several estimates to zero', async () => {
    // Checked per batch, not on the sum: a pool with no adapters would
    // otherwise be masked by another pool's fee in the same call, and only that
    // pool's message would stall.
    const readContract = sinon.stub()
    const publicClient = { readContract } as any
    readContract.onCall(0).resolves(100n) // messageOverallGasLimit
    readContract.onCall(1).resolves(100n) // messageOverallGasLimit
    readContract.onCall(2).resolves(500n) // maxBatchGasLimit
    readContract.onCall(3).resolves(777n) // estimate: configured pool
    readContract.onCall(4).resolves(0n) // estimate: unconfigured pool

    try {
      await estimateBatchBridgeFee({
        publicClient,
        gasService: GAS_SERVICE,
        multiAdapter: MULTI_ADAPTER,
        abis: ABIS_V3_2,
        gasMessagePayloads: [poolAMessages[0], poolBMessage],
        toCentrifugeId: 2,
      })
      expect.fail('Expected estimateBatchBridgeFee to throw when one batch estimates to zero')
    } catch (error) {
      expect((error as Error).message).to.contain('estimated to 0 for chain 2')
    }
  })
})

describe('utils/gas batch grouping', () => {
  afterEach(() => {
    sinon.restore()
  })

  it('prices two pools as two batches, each against its own payload', async () => {
    // The property the grouping exists for. `MultiAdapter.estimate` resolves
    // the adapter set for the payload's OWN pool, so two pools must be two
    // calls with two payloads — never one call priced against whichever
    // payload happened to be first.
    const readContract = sinon.stub()
    const publicClient = { readContract } as any
    readContract.onCall(0).resolves(100n) // messageOverallGasLimit (pool A)
    readContract.onCall(1).resolves(200n) // messageOverallGasLimit (pool B)
    readContract.onCall(2).resolves(500n) // maxBatchGasLimit
    readContract.onCall(3).resolves(300n) // estimate (pool A)
    readContract.onCall(4).resolves(500n) // estimate (pool B)

    const result = await estimateBatchBridgeFee({
      publicClient,
      gasService: GAS_SERVICE,
      multiAdapter: MULTI_ADAPTER,
      abis: ABIS_V3_2,
      gasMessagePayloads: [poolAMessages[0], poolBMessage],
      toCentrifugeId: 2,
    })

    expect(result).to.equal(1200n) // (300 + 500) * 3 / 2
    expect(readContract.withArgs(sinon.match({ functionName: 'estimate' })).callCount).to.equal(2)
    expect(readContract.calledWithMatch({ functionName: 'estimate', args: [2, poolAMessages[0], 100n] })).to.equal(true)
    expect(readContract.calledWithMatch({ functionName: 'estimate', args: [2, poolBMessage, 200n] })).to.equal(true)
  })

  it('refuses a payload too short to carry a pool id instead of grouping it under a truncated key', async () => {
    // What a truncated grouping key costs: two unrelated payloads share one
    // batch and `estimate` is called ONCE, for the summed gas of both, priced
    // against one pool's adapter set, with nothing anywhere reporting a
    // problem. A merged batch also masks the zero-estimate refusal, since one
    // payload's fee covers for a pool whose `quorum(2, poolId)` is 0 (5 of 12
    // live mainnet pools).
    //
    // So it is refused before any estimate goes out. Nothing legitimate is
    // refused — every payload on this path comes from `emptyMessage`, which is
    // never shorter than 90 bytes.
    const readContract = sinon.stub()
    const publicClient = { readContract } as any
    readContract.resolves(100n)

    try {
      await estimateBatchBridgeFee({
        publicClient,
        gasService: GAS_SERVICE,
        multiAdapter: MULTI_ADAPTER,
        abis: ABIS_V3_2,
        gasMessagePayloads: ['0x01', '0x02'],
        toCentrifugeId: 2,
      })
      expect.fail('Expected estimateBatchBridgeFee to refuse a sub-9-byte payload')
    } catch (error) {
      const message = (error as Error).message
      expect(message).to.contain('Cannot price crosschain message 1 of 2 for chain 2')
      expect(message).to.contain('not a protocol payload')
      expect(message).to.contain('at least 9 bytes')
      expect((error as Error).cause, 'the protocol refusal is kept as cause').to.be.an('error')
    }

    // Nothing was priced. The refusal is not "we estimated and then noticed".
    expect(readContract.calledWithMatch({ functionName: 'estimate' })).to.equal(false)
    expect(readContract.calledWithMatch({ functionName: 'maxBatchGasLimit' })).to.equal(false)
  })

  it('names the offending payload by position when only one of several is short', async () => {
    const readContract = sinon.stub()
    const publicClient = { readContract } as any
    readContract.resolves(100n)

    try {
      await estimateBatchBridgeFee({
        publicClient,
        gasService: GAS_SERVICE,
        multiAdapter: MULTI_ADAPTER,
        abis: ABIS_V3_2,
        gasMessagePayloads: [poolAMessages[0], '0x1700010000', poolBMessage],
        toCentrifugeId: 2,
      })
      expect.fail('Expected estimateBatchBridgeFee to refuse the short payload')
    } catch (error) {
      // A 5-byte payload is the more interesting case than the 1-byte one: its
      // truncated key was '00010000', which every pool whose raw id starts with
      // those four bytes would have collided with — i.e. the collision was not
      // limited to payloads with no pool id at all. Position matters because a
      // caller passing several messages needs to know which one to look at.
      expect((error as Error).message).to.contain('Cannot price crosschain message 2 of 3')
    }
  })
})

describe('utils/gas pending pool adapters', () => {
  const LZ_ADAPTER = '0x3333333333333333333333333333333333333333'
  const globalMessage = emptyMessage({ type: MessageType.SetPoolAdapters, poolId: POOL_A })

  afterEach(() => sinon.restore())

  /** Answers gas limits of 100, a generous batch limit, and a fee per (address, payload) read. */
  function chain() {
    const readContract = sinon.stub().callsFake(async ({ address, functionName, args }: any) => {
      if (functionName === 'messageOverallGasLimit') return 100n
      if (functionName === 'maxBatchGasLimit') return 10_000n
      if (functionName === 'estimate') return address === LZ_ADAPTER ? 300n : 200n
      throw new Error(`unexpected read ${functionName}${args}`)
    })
    return { publicClient: { readContract } as any, readContract }
  }

  it('prices the pool batch against the pending adapters and the global batch against the MultiAdapter', async () => {
    const { publicClient, readContract } = chain()

    const result = await estimateBatchBridgeFee({
      publicClient,
      gasService: GAS_SERVICE,
      multiAdapter: MULTI_ADAPTER,
      abis: ABIS_V3_2,
      gasMessagePayloads: [globalMessage, ...poolAMessages],
      toCentrifugeId: 2,
      pendingPoolAdapters: { adapters: [LZ_ADAPTER], sessionPrefix: false },
    })

    // 200 (global, MultiAdapter) + 300 (pool, LayerZero adapter), plus the 50% buffer.
    expect(result).to.equal(750n)
    const estimates = readContract.getCalls().filter((call) => call.args[0].functionName === 'estimate')
    expect(estimates.map((call) => call.args[0].address)).to.have.members([MULTI_ADAPTER, LZ_ADAPTER])
    const lz = estimates.find((call) => call.args[0].address === LZ_ADAPTER)!.args[0]
    expect(lz.args).to.deep.equal([2, poolAMessages[0], 200n])
  })

  it('asks the adapters behind the 2-byte v3.3 session id, as the MultiAdapter does', async () => {
    const { publicClient, readContract } = chain()

    await estimateBatchBridgeFee({
      publicClient,
      gasService: GAS_SERVICE,
      multiAdapter: MULTI_ADAPTER,
      abis: ABIS_V3_2,
      gasMessagePayloads: [...poolAMessages],
      toCentrifugeId: 2,
      pendingPoolAdapters: { adapters: [LZ_ADAPTER], sessionPrefix: true },
    })

    const lz = readContract.getCalls().find((call) => call.args[0].address === LZ_ADAPTER)!.args[0]
    expect(lz.args[1]).to.equal(`0x0101${poolAMessages[0].slice(2)}`)
  })
})
