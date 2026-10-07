import { expect } from 'chai'
import sinon from 'sinon'
import type { HexString } from '../types/index.js'
import { waitForPoolAdapters } from './poolAdapters.js'

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
