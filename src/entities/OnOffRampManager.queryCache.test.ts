import { expect } from 'chai'
import { Centrifuge } from '../Centrifuge.js'
import { PoolId, ShareClassId } from '../utils/types.js'
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
