import { expect } from 'chai'
import { NEVER, of, throwError } from 'rxjs'
import sinon from 'sinon'
import { Centrifuge } from '../Centrifuge.js'
import { makeThenable } from '../utils/rx.js'
import { PoolId, type CentrifugeId } from '../utils/types.js'
import { candidatesFor } from './migrationPreCheckRead.js'
import { activeSpokesOf, migrationSpokeCandidates, unreadableSpokesOf } from './migrationSpokes.js'
import { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'

const POOL = PoolId.from(1, 7)

type Activity = boolean | 'timeout' | Error

function setup(chains: Record<number, Activity>, record: CentrifugeId[] | Error, version: '3.2' | '3.3' = '3.2') {
  const centrifuge = new Centrifuge({ environment: 'testnet' })
  const pool = new Pool(centrifuge, POOL.toString())
  const networks = Object.keys(chains).map((cid) => new PoolNetwork(centrifuge, pool, Number(cid) as CentrifugeId))
  sinon.stub(pool, 'networks').returns(makeThenable(of(networks)) as any)
  for (const network of networks) {
    const activity = chains[network.centrifugeId]!
    const read = activity === 'timeout' ? NEVER : activity instanceof Error ? throwError(() => activity) : of(activity)
    sinon.stub(network, 'isActive').returns(makeThenable(read) as any)
  }
  sinon.stub(centrifuge, 'protocolContext').callsFake(() => {
    if (record instanceof Error) return makeThenable(throwError(() => record)) as any
    return makeThenable(of({ protocolVersion: version, contractAbis: {}, contracts: {} })) as any
  })
  if (!(record instanceof Error) && version === '3.2') {
    // The v3.2 hub record is read through the inputs derivation; stand in for it.
    sinon.stub(pool, 'id').value(POOL)
  }
  return { centrifuge, pool, networks }
}

describe('migrationSpokeCandidates', () => {
  afterEach(() => sinon.restore())

  it('names every chain the directory, the hub record and the migration name, each confirmed on its chain', async () => {
    const { centrifuge, pool } = setup(
      { 1: true, 2: true, 3: false, 4: 'timeout', 5: new Error('rpc down') },
      [],
      '3.3'
    )
    const candidates = await migrationSpokeCandidates(centrifuge, pool, [2, 6 as CentrifugeId], 20)
    expect(candidates.hubRecordError).to.equal(null)
    expect(candidates.spokes.map((spoke) => [spoke.centrifugeId, spoke.activity, spoke.sources])).to.deep.equal([
      [1, 'active', ['chain']],
      [2, 'active', ['chain', 'migration']],
      [3, 'inactive', ['chain']],
      [4, 'unreadable', ['chain']],
      [5, 'unreadable', ['chain']],
      [6, 'unreadable', ['migration']],
    ])
    expect(candidates.spokes[3]!.reason).to.equal('the activity read timed out after 20 ms')
    expect(candidates.spokes[4]!.reason).to.equal('rpc down')
    expect(activeSpokesOf(candidates)).to.deep.equal([1, 2])
    expect(unreadableSpokesOf(candidates).map((spoke) => spoke.centrifugeId)).to.deep.equal([4, 5, 6])
  })

  it('names a hub record that could not be read instead of dropping its spokes silently', async () => {
    const { centrifuge, pool } = setup({ 1: true }, new Error('hub rpc down'))
    const candidates = await migrationSpokeCandidates(centrifuge, pool)
    expect(candidates.hubRecordError).to.equal('hub rpc down')
    expect(unreadableSpokesOf(candidates)).to.deep.equal([
      { centrifugeId: null, reason: "the v3.2 hub's spoke record could not be read: hub rpc down" },
    ])
  })

  it('gives the plan and the pre-check the same spoke set', async () => {
    const { centrifuge, pool } = setup({ 1: true, 2: false, 3: 'timeout' }, [], '3.3')
    const candidates = await migrationSpokeCandidates(centrifuge, pool, [], 20)
    sinon.stub(pool, 'migrationSpokeCandidates').resolves(candidates)
    expect(await candidatesFor(centrifuge, pool).spokes()).to.deep.equal(activeSpokesOf(candidates))
    expect(activeSpokesOf(candidates)).to.deep.equal([1])
  })
})
