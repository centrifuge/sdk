import { ProtocolVersionResolutionError } from '@centrifuge/protocol'
import { expect } from 'chai'
import { BehaviorSubject, firstValueFrom, of } from 'rxjs'
import sinon from 'sinon'
import { Centrifuge } from '../Centrifuge.js'
import { PoolId } from '../utils/types.js'
import { Pool } from './Pool.js'

const poolId = PoolId.from(1, 7)

describe('Pool protocol version', () => {
  afterEach(() => sinon.restore())

  it('reads protocolVersion and migrationStatus off the pools entry', async () => {
    const centrifuge = new Centrifuge({ environment: 'mainnet' })
    sinon
      .stub(centrifuge as any, '_queryData')
      .returns(of([{ id: poolId.toString(), protocolVersion: '3.2', migrationStatus: 'migrating' }]))
    const pool = new Pool(centrifuge, poolId)

    expect(await pool.protocolVersion()).to.equal('3.2')
    expect(await pool.migrationStatus()).to.equal('migrating')
  })

  it('refuses protocolVersion on a transport that projects none', async () => {
    const centrifuge = new Centrifuge({ environment: 'mainnet' })
    sinon
      .stub(centrifuge as any, '_queryData')
      .returns(of([{ id: poolId.toString(), protocolVersion: null, migrationStatus: null }]))
    const pool = new Pool(centrifuge, poolId)

    let error: unknown
    try {
      await pool.protocolVersion()
    } catch (e) {
      error = e
    }
    expect((error as Error).message).to.contain('no protocolVersion')
    expect(await pool.migrationStatus()).to.equal(null)
  })

  it('refuses protocolVersion on a pool the catalogue does not list, as a resolution error', async () => {
    const centrifuge = new Centrifuge({ environment: 'mainnet' })
    sinon.stub(centrifuge as any, '_queryData').returns(of([]))
    const pool = new Pool(centrifuge, poolId)

    await pool.protocolVersion().then(
      () => expect.fail('expected the missing pool to refuse'),
      (error: Error) => {
        expect(error).to.be.instanceOf(ProtocolVersionResolutionError)
        expect(error.message).to.contain('does not list it')
      }
    )
  })

  it('re-resolves the pool context when the projected version changes, as a mainnet pool migrating to v3.3 does', async () => {
    const centrifuge = new Centrifuge({ environment: 'mainnet' })
    const rows = new BehaviorSubject([{ id: poolId.toString(), protocolVersion: '3.2', migrationStatus: 'live' }])
    sinon.stub(centrifuge as any, '_queryData').returns(rows.asObservable())
    const resolved: string[] = []
    const subscription = centrifuge.protocolContext(poolId).subscribe({
      next: (ctx) => resolved.push(ctx.protocolVersion),
      error: (e: Error) => resolved.push(`error:${e.name}`),
    })
    await firstValueFrom(centrifuge.protocolContext(poolId))

    rows.next([{ id: poolId.toString(), protocolVersion: '3.3', migrationStatus: 'live' }])
    await new Promise((resolve) => setTimeout(resolve, 0))
    subscription.unsubscribe()

    expect(resolved).to.deep.equal(['3.2', '3.3'])
  })

  it('excludes the system addresses of every version deployed on the chain, lowercased and deduped', async () => {
    const centrifuge = new Centrifuge({ environment: 'mainnet' })
    const addresses = await centrifuge._systemAddresses(1)
    const contexts = await Promise.all(
      (['3.2', '3.3'] as const).map((protocolVersion) =>
        centrifuge.protocolContext({ centrifugeId: 1, protocolVersion })
      )
    )

    expect(addresses).to.have.members([
      ...new Set(
        contexts.flatMap((context) =>
          [context.balanceSheet ?? context.spoke, context.asyncRequestManager, context.syncManager].map((a) =>
            a.toLowerCase()
          )
        )
      ),
    ])
    expect(addresses).to.have.length.greaterThan(3)
    expect(addresses.every((a) => a === a.toLowerCase())).to.equal(true)
  })

  it('refuses the system addresses of a chain with no deployment', async () => {
    const centrifuge = new Centrifuge({ environment: 'mainnet' })

    let error: unknown
    try {
      await centrifuge._systemAddresses(9999)
    } catch (e) {
      error = e
    }
    expect((error as Error).name).to.equal('ProtocolVersionResolutionError')
  })
})
