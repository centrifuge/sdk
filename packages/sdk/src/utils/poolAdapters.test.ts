import { expect } from 'chai'
import {
  enabledAdapterNames,
  hasUnnamedAdapter,
  isPoolWired,
  planPoolAdapters,
  poolAdaptersSettled,
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
  })

  it('is not wired when either side holds an adapter the indexer cannot name', () => {
    expect(isPoolWired([live('unknown')], [live('unknown')])).to.equal(false)
    expect(isPoolWired([live('layerZero')], [live('layerZero'), live('unknown')])).to.equal(false)
    expect(isPoolWired([live('layerZero')], [live('layerZero'), disabled('unknown')])).to.equal(true)
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
    expect(planPoolAdapters([], [], ours)).to.deep.equal({ action: 'send' })
    expect(planPoolAdapters([], [live('layerZero')], ours)).to.deep.equal({ action: 'send' })
  })

  it('is ready when the spoke mirrors the hub with nothing in flight', () => {
    expect(planPoolAdapters([live('layerZero')], [live('layerZero')], ours)).to.deep.equal({ action: 'ready' })
    expect(planPoolAdapters([live('axelar')], [live('axelar')], ours)).to.deep.equal({ action: 'ready' })
  })

  it('waits for the hub set, without sending, while the spoke is still receiving it', () => {
    expect(planPoolAdapters([live('layerZero')], [inFlight('layerZero')], ours)).to.deep.equal({ action: 'wait' })
    expect(
      planPoolAdapters([live('axelar'), live('layerZero')], [live('layerZero'), inFlight('axelar')], ours)
    ).to.deep.equal({ action: 'wait' })
  })

  it('resends only when the hub already holds our set and the settled spoke does not mirror it', () => {
    expect(planPoolAdapters([live('layerZero')], [], ours)).to.deep.equal({ action: 'send' })
    expect(planPoolAdapters([live('layerZero')], [live('axelar')], ours)).to.deep.equal({ action: 'send' })
  })

  it('stops on an adapter it cannot name, on either side, before anything else', () => {
    expect(planPoolAdapters([live('unknown')], [], ours)).to.deep.equal({ action: 'unnamed', side: 'hub' })
    expect(planPoolAdapters([live('layerZero')], [inFlight('unknown')], ours)).to.deep.equal({
      action: 'unnamed',
      side: 'destination',
    })
    expect(hasUnnamedAdapter([disabled('unknown')])).to.equal(false)
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
