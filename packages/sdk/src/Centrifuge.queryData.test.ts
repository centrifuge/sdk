import { expect } from 'chai'
import { firstValueFrom, of } from 'rxjs'
import sinon from 'sinon'
import { Centrifuge } from './Centrifuge.js'
import type { DataSource } from './data/DataSource.js'

describe('Centrifuge._queryData', () => {
  const rows = [{ centrifugeId: '1', asset: { id: '5192296858534827628530496329220097' } }]

  function centrifugeWith(query: sinon.SinonStub) {
    return new Centrifuge({ environment: 'testnet', dataSource: { query } as unknown as DataSource })
  }

  it('gives a mapped reader its own shape after a raw reader of the same query, as the migration inputs read does', async () => {
    const query = sinon.stub().returns(of(rows))
    const centrifuge = centrifugeWith(query)
    const raw = await firstValueFrom(centrifuge._queryData<typeof rows>('allVaults', { tokenId: '0x01' }))
    const mapped = await firstValueFrom(
      centrifuge._queryData('allVaults', { tokenId: '0x01' }, (items: typeof rows) =>
        items.map((item) => ({ assetId: item.asset.id }))
      )
    )
    expect(raw).to.deep.equal(rows)
    expect(mapped).to.deep.equal([{ assetId: '5192296858534827628530496329220097' }])
  })

  it('gives a raw reader the rows after a mapped reader of the same query', async () => {
    const centrifuge = centrifugeWith(sinon.stub().returns(of(rows)))
    await firstValueFrom(
      centrifuge._queryData('allVaults', { tokenId: '0x01' }, (items: typeof rows) => items.map(() => 'mapped'))
    )
    expect(await firstValueFrom(centrifuge._queryData('allVaults', { tokenId: '0x01' }))).to.deep.equal(rows)
  })

  it('still asks the source once for readers of the same query', async () => {
    const query = sinon.stub().returns(of(rows))
    const centrifuge = centrifugeWith(query)
    const first = centrifuge._queryData('allVaults', { tokenId: '0x01' }, (items: typeof rows) => items.length)
    const second = centrifuge._queryData<typeof rows>('allVaults', { tokenId: '0x01' })
    await Promise.all([firstValueFrom(first), firstValueFrom(second)])
    expect(query.callCount).to.equal(1)
  })
})
