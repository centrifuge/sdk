import { expect } from 'chai'
import { firstValueFrom, of } from 'rxjs'
import sinon from 'sinon'
import { Centrifuge } from '../Centrifuge.js'
import { Balance } from '../utils/BigInt.js'
import { AssetId, PoolId, ShareClassId } from '../utils/types.js'
import { OnOffRampManager } from './OnOffRampManager.js'
import { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'
import { ShareClass } from './ShareClass.js'

const poolId = PoolId.from(1, 15)
const scId = ShareClassId.from(poolId, 1)
const centrifugeId = 13
const ramp = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const otherRamp = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

function subject(...ramps: `0x${string}`[]) {
  const centrifuge = new Centrifuge({ environment: 'mainnet' })
  const pool = new Pool(centrifuge, poolId.raw)
  const network = new PoolNetwork(centrifuge, pool, centrifugeId)
  const shareClass = new ShareClass(centrifuge, pool, scId)
  return {
    centrifuge,
    managers: ramps.map((address) => new OnOffRampManager(centrifuge, network, shareClass, address)),
  }
}

function queries(manager: OnOffRampManager) {
  return [manager.receivers(), manager.relayers(), manager.assets(), manager.balances()]
}

describe('OnOffRampManager query cache keys', () => {
  it('memoizes receivers, relayers, assets and balances', () => {
    const [manager] = subject(ramp).managers

    const first = queries(manager!)

    queries(manager!).forEach((query, i) => expect(query).to.equal(first[i]))
  })

  it('drops them on a clearQueryCache of the entity prefix', () => {
    const { centrifuge, managers } = subject(ramp)
    const before = queries(managers[0]!)

    centrifuge.clearQueryCache(['onofframpmanager', scId.toString(), centrifugeId])

    queries(managers[0]!).forEach((query, i) => expect(query).to.not.equal(before[i]))
  })

  it('keeps two ramps of the same share class and chain apart', () => {
    const [legacy, current] = subject(otherRamp, ramp).managers

    queries(legacy!).forEach((query, i) => expect(query).to.not.equal(queries(current!)[i]))
  })
})

describe('OnOffRampManager query results', () => {
  const assetAddress = '0x4444444444444444444444444444444444444444'
  const receiverAddress = '0x5555555555555555555555555555555555555555'
  const assetId = AssetId.from(centrifugeId, 1)

  afterEach(() => sinon.restore())

  function indexedSubject(field: string, items: unknown[]) {
    const { centrifuge, managers } = subject(ramp)
    const queryIndexer = sinon.stub(centrifuge, '_queryIndexer').callsFake((query, variables, transform) => {
      expect(query).to.contain(`${field}(where:`)
      expect(variables).to.deep.equal({ scId: scId.toString(), centrifugeId: centrifugeId.toString() })
      return of(transform!({ [field]: { items } })) as any
    })
    return { centrifuge, manager: managers[0]!, queryIndexer }
  }

  it('reads receivers using the offRampAddresss field from the indexer schema', async () => {
    const { manager } = indexedSubject('offRampAddresss', [
      { assetAddress, receiverAddress, asset: { id: assetId.toString() } },
    ])

    expect(await firstValueFrom(manager.receivers())).to.deep.equal([{ assetAddress, receiverAddress, assetId }])
  })

  it('preserves enabled and disabled relayers', async () => {
    const items = [
      { address: receiverAddress, isEnabled: true },
      { address: otherRamp, isEnabled: false },
    ]
    const { manager } = indexedSubject('offrampRelayers', items)

    expect(await firstValueFrom(manager.relayers())).to.deep.equal(items)
  })

  it('returns assets with their SDK asset IDs', async () => {
    const { manager } = indexedSubject('onRampAssets', [{ assetAddress, asset: { id: assetId.toString() } }])

    expect(await firstValueFrom(manager.assets())).to.deep.equal([{ assetAddress, assetId }])
  })

  it('reads the ramp balances on its own chain and excludes zero balances', async () => {
    const { centrifuge, manager } = indexedSubject('onRampAssets', [
      { assetAddress, asset: { id: assetId.toString() } },
      { assetAddress: otherRamp, asset: { id: AssetId.from(centrifugeId, 2).toString() } },
    ])
    const funded = { balance: Balance.fromFloat(10, 6) }
    const balance = sinon.stub(centrifuge, 'balance')
    balance.withArgs(assetAddress, ramp, centrifugeId).returns(of(funded) as any)
    balance.withArgs(otherRamp, ramp, centrifugeId).returns(of({ balance: Balance.fromFloat(0, 6) }) as any)

    expect(await firstValueFrom(manager.balances())).to.deep.equal([funded])
    expect(balance.callCount).to.equal(2)
  })

  it('emits an empty balance list without making balance reads when no assets are enabled', async () => {
    const { centrifuge, manager } = indexedSubject('onRampAssets', [])
    const balance = sinon.stub(centrifuge, 'balance').throws(new Error('Unexpected balance read'))

    expect(await firstValueFrom(manager.balances())).to.deep.equal([])
    expect(balance.called).to.equal(false)
  })
})
