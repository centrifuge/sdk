import { expect } from 'chai'
import sinon from 'sinon'
import {
  enabledAdapterNames,
  isPoolWired,
  planPoolAdapters,
  poolAdaptersSettled,
  waitForPoolAdapters,
  type PoolAdapterState,
} from './poolAdapters.js'

const live = (name: string): PoolAdapterState => ({ name, isEnabled: true, crosschainInProgress: null })
const disabled = (name: string): PoolAdapterState => ({ name, isEnabled: false, crosschainInProgress: null })
const inFlight = (name: string): PoolAdapterState => ({ name, isEnabled: false, crosschainInProgress: 'Enabled' })

describe('enabledAdapterNames', () => {
  it('keeps live adapters only, deduplicated and sorted', () => {
    expect(
      enabledAdapterNames([live('layerZero'), disabled('axelar'), live('chainlink'), live('layerZero')])
    ).to.deep.equal(['chainlink', 'layerZero'])
  })
})

describe('poolAdaptersSettled', () => {
  it('needs exactly the expected set live and nothing in flight', () => {
    expect(poolAdaptersSettled([live('layerZero')], ['layerZero'])).to.equal(true)
    expect(poolAdaptersSettled([live('layerZero'), live('axelar')], ['layerZero'])).to.equal(false)
    expect(poolAdaptersSettled([], ['layerZero'])).to.equal(false)
    expect(poolAdaptersSettled([inFlight('layerZero')], ['layerZero'])).to.equal(false)
    expect(poolAdaptersSettled([live('layerZero'), inFlight('axelar')], ['layerZero'])).to.equal(false)
  })
})

describe('isPoolWired', () => {
  it('is wired when the spoke mirrors a non-empty hub set with nothing in flight', () => {
    expect(isPoolWired([live('layerZero')], [live('layerZero')])).to.equal(true)
    expect(isPoolWired([live('unknown')], [live('unknown')])).to.equal(true)
  })

  it('is not wired when a side is empty, the sets differ, or the spoke is still receiving', () => {
    expect(isPoolWired([], [live('layerZero')])).to.equal(false)
    expect(isPoolWired([live('layerZero')], [])).to.equal(false)
    expect(isPoolWired([live('layerZero')], [live('axelar')])).to.equal(false)
    expect(isPoolWired([live('layerZero'), live('axelar')], [live('layerZero')])).to.equal(false)
    expect(isPoolWired([live('layerZero')], [inFlight('layerZero')])).to.equal(false)
  })
})

describe('planPoolAdapters', () => {
  const ours = ['layerZero']

  it('sends when the hub holds nothing', () => {
    expect(planPoolAdapters([], [], ours)).to.deep.equal({ action: 'send', expected: ['layerZero'] })
    expect(planPoolAdapters([], [live('layerZero')], ours)).to.deep.equal({ action: 'send', expected: ['layerZero'] })
  })

  it('is ready when the spoke mirrors the hub with nothing in flight', () => {
    expect(planPoolAdapters([live('layerZero')], [live('layerZero')], ours)).to.deep.equal({ action: 'ready' })
    expect(planPoolAdapters([live('axelar')], [live('axelar')], ours)).to.deep.equal({ action: 'ready' })
  })

  it('waits for the hub set, without sending, while the spoke is still receiving it', () => {
    expect(planPoolAdapters([live('layerZero')], [inFlight('layerZero')], ours)).to.deep.equal({
      action: 'wait',
      expected: ['layerZero'],
    })
    expect(
      planPoolAdapters([live('axelar'), live('layerZero')], [live('layerZero'), inFlight('axelar')], ours)
    ).to.deep.equal({ action: 'wait', expected: ['axelar', 'layerZero'] })
  })

  it('resends only when the hub already holds our set and the settled spoke does not mirror it', () => {
    expect(planPoolAdapters([live('layerZero')], [], ours)).to.deep.equal({ action: 'send', expected: ['layerZero'] })
    expect(planPoolAdapters([live('layerZero')], [live('axelar')], ours)).to.deep.equal({
      action: 'send',
      expected: ['layerZero'],
    })
  })

  it('stops on a hub set that is not ours and that the settled spoke does not mirror', () => {
    expect(planPoolAdapters([live('axelar')], [], ours)).to.deep.equal({
      action: 'conflict',
      onHub: ['axelar'],
      onSpoke: [],
    })
    expect(planPoolAdapters([live('axelar'), live('layerZero')], [live('layerZero')], ours)).to.deep.equal({
      action: 'conflict',
      onHub: ['axelar', 'layerZero'],
      onSpoke: ['layerZero'],
    })
  })
})

describe('waitForPoolAdapters', () => {
  let clock: sinon.SinonFakeTimers
  beforeEach(() => {
    clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'Date'] })
  })
  afterEach(() => {
    clock.restore()
  })

  /** A read whose answers follow `script`; reads past the end repeat the last. */
  function scripted(script: (PoolAdapterState[] | Error)[]) {
    let reads = 0
    const read = async () => {
      const answer = script[Math.min(reads++, script.length - 1)]!
      if (answer instanceof Error) throw answer
      return answer
    }
    return { read, reads: () => reads }
  }

  it('returns once the spoke rows show exactly the expected set, settled', async () => {
    const { read, reads } = scripted([[], [inFlight('layerZero')], [live('layerZero')]])
    const done = waitForPoolAdapters(read, ['layerZero'], { intervalMs: 1000 })
    await clock.tickAsync(2000)
    await done
    expect(reads()).to.equal(3)
  })

  it('treats a failed read as not yet, and keeps polling', async () => {
    const { read, reads } = scripted([new Error('indexer 502'), [live('layerZero')]])
    const done = waitForPoolAdapters(read, ['layerZero'], { intervalMs: 1000 })
    await clock.tickAsync(1000)
    await done
    expect(reads()).to.equal(2)
  })

  it('rejects at the deadline, naming what the indexer reports', async () => {
    const { read } = scripted([[inFlight('layerZero')]])
    const outcome = waitForPoolAdapters(read, ['layerZero'], { intervalMs: 1000, timeoutMs: 3000 }).then(
      () => undefined,
      (error: Error) => error
    )
    await clock.tickAsync(4000)
    const error = await outcome
    expect(error?.message).to.contain('Timed out')
    expect(error?.message).to.contain('Enabled in flight')
  })

  it('fails at once when the spoke holds an adapter the indexer cannot name', async () => {
    const { read, reads } = scripted([[inFlight('unknown')], [live('unknown')]])
    const outcome = waitForPoolAdapters(read, ['layerZero'], { intervalMs: 1000 }).then(
      () => undefined,
      (error: Error) => error
    )
    await clock.tickAsync(0)
    const error = await outcome
    expect(error?.message).to.contain('cannot name')
    expect(reads()).to.equal(1)
  })

  it('still matches an unnamed adapter when that is what is expected', async () => {
    const { read } = scripted([[live('unknown')]])
    await waitForPoolAdapters(read, ['unknown'], { intervalMs: 1000 })
  })

  it('stops polling when the signal aborts', async () => {
    const { read, reads } = scripted([[inFlight('layerZero')]])
    const controller = new AbortController()
    const outcome = waitForPoolAdapters(read, ['layerZero'], { intervalMs: 1000, signal: controller.signal }).then(
      () => undefined,
      (error: Error) => error
    )
    await clock.tickAsync(1500)
    controller.abort()
    await clock.tickAsync(5000)
    const error = await outcome
    expect(error?.message).to.contain('cancelled')
    expect(reads()).to.equal(2)
  })

  it('rejects at the deadline with the last read error when nothing could be read', async () => {
    const { read } = scripted([new Error('indexer down')])
    const outcome = waitForPoolAdapters(read, ['layerZero'], { intervalMs: 1000, timeoutMs: 2000 }).then(
      () => undefined,
      (error: Error) => error
    )
    await clock.tickAsync(3000)
    const error = await outcome
    expect(error?.message).to.contain('could not be read')
    expect(error?.message).to.contain('indexer down')
  })
})
