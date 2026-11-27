import { expect } from 'chai'
import type { HexString, ProtocolContracts } from '../types/index.js'
import { adapterIndexerNames, requireCopyableGlobalSet, type GlobalAdapterSet } from './adapters.js'
import { PoolId } from './types.js'

const HUB = 1
const SPOKE = 17
const poolId = PoolId.from(HUB, 1)
const address = (byte: string) => `0x${byte.repeat(40)}` as HexString

const registry: Partial<ProtocolContracts> = {
  layerZeroAdapter: address('1'),
  hyperlaneAdapter: address('2'),
  chainlinkAdapter: address('3'),
  axelarAdapter: address('4'),
}

const set = (overrides: Partial<GlobalAdapterSet> = {}): GlobalAdapterSet => ({
  local: [address('1'), address('4')],
  remote: [address('a'), address('b')],
  threshold: 2,
  recoveryIndex: 2,
  names: ['layerZero', 'axelar'],
  ...overrides,
})

describe('adapterIndexerNames', () => {
  it("names each address the indexer's way, the registry key without Adapter, whatever its case", () => {
    expect(
      adapterIndexerNames(registry, [address('3'), address('1').toUpperCase().replace('0X', '0x') as HexString])
    ).to.deep.equal(['chainlink', 'layerZero'])
  })

  it('answers null for an adapter the registry does not list', () => {
    expect(adapterIndexerNames(registry, [address('9')])).to.deep.equal([null])
  })
})

describe('requireCopyableGlobalSet', () => {
  it('passes a global set with both sides the same size and every adapter listed, keeping its names', () => {
    expect(requireCopyableGlobalSet(set(), HUB, SPOKE, poolId)).to.deep.equal(['layerZero', 'axelar'])
  })

  it('refuses when the protocol has no global adapters on the route', () => {
    expect(() =>
      requireCopyableGlobalSet(set({ local: [], remote: [], threshold: 0, names: [] }), HUB, SPOKE, poolId)
    ).to.throw(`The protocol has no global adapters from centrifugeId ${HUB} to centrifugeId ${SPOKE}`)
  })

  it('refuses when the two sides of the global set differ in size', () => {
    expect(() => requireCopyableGlobalSet(set({ remote: [address('a')] }), HUB, SPOKE, poolId)).to.throw(
      'name 2 adapter(s) on the hub but 1 on centrifugeId 17'
    )
  })

  it('refuses a global adapter the registry does not list, naming it', () => {
    expect(() =>
      requireCopyableGlobalSet(
        set({ local: [address('1'), address('9')], names: ['layerZero', null] }),
        HUB,
        SPOKE,
        poolId
      )
    ).to.throw(address('9'))
  })
})
