import { expect } from 'chai'
import sinon from 'sinon'
import type { HexString } from '../types/index.js'
import { readPoolAdapters, sameAdapters, waitForPoolAdapters } from './poolAdapters.js'

const MULTI_ADAPTER = '0x35c837f0a54b715a23d193e1476bfc9bc30073be' as HexString
const LZ = '0xd517bc7ba17271a8d87be7355b2523bf5c750295' as HexString
const OTHER = '0x9999999999999999999999999999999999999999' as HexString
const POOL_ID = 281474976710663n

/** A MultiAdapter whose answers follow `script`, one entry per `quorum` read; reads past the end repeat the last. */
function multiAdapterReads(script: (HexString[] | Error)[]) {
  let reads = 0
  let current: HexString[] = []
  const client = {
    readContract: async ({ functionName, args }: { functionName: string; args: readonly unknown[] }) => {
      if (functionName === 'quorum') {
        const answer = script[Math.min(reads++, script.length - 1)]!
        if (answer instanceof Error) throw answer
        current = answer
        return current.length
      }
      if (functionName === 'adapters') return current[Number(args[2])]
      throw new Error(`unexpected read ${functionName}`)
    },
  }
  return { client: client as any, reads: () => reads }
}

describe('waitForPoolAdapters', () => {
  let clock: sinon.SinonFakeTimers
  beforeEach(() => {
    clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'Date'] })
  })
  afterEach(() => {
    clock.restore()
  })

  it('returns once the destination holds exactly the expected set', async () => {
    const { client, reads } = multiAdapterReads([[], [OTHER], [LZ]])
    const done = waitForPoolAdapters(client, MULTI_ADAPTER, 1, POOL_ID, [LZ], { intervalMs: 1000 })
    await clock.tickAsync(2000)
    await done
    expect(reads()).to.equal(3)
  })

  it('treats a failed read as not yet, and keeps polling', async () => {
    const { client, reads } = multiAdapterReads([new Error('429 Too Many Requests'), [LZ]])
    const done = waitForPoolAdapters(client, MULTI_ADAPTER, 1, POOL_ID, [LZ], { intervalMs: 1000 })
    await clock.tickAsync(1000)
    await done
    expect(reads()).to.equal(2)
  })

  it('rejects at the deadline, naming what the destination holds', async () => {
    const { client } = multiAdapterReads([[OTHER]])
    const done = waitForPoolAdapters(client, MULTI_ADAPTER, 1, POOL_ID, [LZ], { intervalMs: 1000, timeoutMs: 3000 })
    const outcome = done.then(
      () => undefined,
      (error: Error) => error
    )
    await clock.tickAsync(4000)
    const error = await outcome
    expect(error?.message).to.contain('Timed out')
    expect(error?.message).to.contain(OTHER)
    expect(error?.message).to.contain(LZ)
  })

  it('rejects at the deadline with the last read error when nothing could be read', async () => {
    const { client } = multiAdapterReads([new Error('rpc down')])
    const done = waitForPoolAdapters(client, MULTI_ADAPTER, 1, POOL_ID, [LZ], { intervalMs: 1000, timeoutMs: 2000 })
    const outcome = done.then(
      () => undefined,
      (error: Error) => error
    )
    await clock.tickAsync(3000)
    const error = await outcome
    expect(error?.message).to.contain('could not be read')
    expect(error?.message).to.contain('rpc down')
  })
})

describe('readPoolAdapters', () => {
  it('returns an empty list when the pool has no adapters, without reading entries', async () => {
    const { client, reads } = multiAdapterReads([[]])
    const entryReads = sinon.spy(client, 'readContract')
    expect(await readPoolAdapters(client, MULTI_ADAPTER, 1, POOL_ID)).to.deep.equal([])
    expect(reads()).to.equal(1)
    expect(entryReads.callCount).to.equal(1)
  })

  it('reads quorum, then one entry per index, in configuration order', async () => {
    const { client } = multiAdapterReads([[LZ, OTHER]])
    const calls: { functionName: string; args: readonly unknown[] }[] = []
    const original = client.readContract
    client.readContract = async (call: { functionName: string; args: readonly unknown[] }) => {
      calls.push(call)
      return original(call)
    }
    expect(await readPoolAdapters(client, MULTI_ADAPTER, 1, POOL_ID)).to.deep.equal([LZ, OTHER])
    expect(calls.map((c) => c.functionName)).to.deep.equal(['quorum', 'adapters', 'adapters'])
    expect(calls.slice(1).map((c) => c.args[2])).to.deep.equal([0n, 1n])
    expect(calls.every((c) => c.args[0] === 1 && c.args[1] === POOL_ID)).to.equal(true)
  })
})

describe('sameAdapters', () => {
  const lzChecksummed = '0xD517BC7ba17271a8D87BE7355B2523bF5c750295' as HexString

  it('ignores address case', () => {
    expect(sameAdapters([LZ], [lzChecksummed])).to.equal(true)
  })

  it('requires the same length and the same order', () => {
    expect(sameAdapters([LZ], [LZ, OTHER])).to.equal(false)
    expect(sameAdapters([LZ, OTHER], [OTHER, LZ])).to.equal(false)
    expect(sameAdapters([], [])).to.equal(true)
  })

  it('never matches a missing entry', () => {
    expect(sameAdapters([LZ], [undefined])).to.equal(false)
    expect(sameAdapters([undefined], [undefined])).to.equal(false)
  })
})
