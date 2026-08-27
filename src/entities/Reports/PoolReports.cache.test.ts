import { expect } from 'chai'
import { of } from 'rxjs'
import sinon from 'sinon'
import { Centrifuge } from '../../Centrifuge.js'
import { PoolId, ShareClassId } from '../../utils/types.js'
import { Pool } from '../Pool.js'
import { PoolReports } from './PoolReports.js'

describe('PoolReports share-class cache', () => {
  const poolId = PoolId.from(1, 1)
  const shareClassA = ShareClassId.from(poolId, 1)
  const shareClassB = ShareClassId.from(poolId, 2)
  const timestamp = '1777939200000'

  afterEach(() => sinon.restore())

  for (const method of ['sharePrices', 'shareYields'] as const) {
    for (const unfilteredFirst of [false, true]) {
      it(`${method} isolates share classes when the unfiltered query runs ${unfilteredFirst ? 'first' : 'last'}`, async () => {
        const centrifuge = new Centrifuge({ environment: 'testnet', pollingInterval: 60_000 })
        const pool = new Pool(centrifuge, poolId)
        sinon.stub(pool, '_shareClassIds').returns(centrifuge._query(null, () => of([shareClassA, shareClassB])))
        sinon.stub(pool, 'decimals').returns(centrifuge._query(null, () => of(18)))

        const rows = [shareClassA, shareClassB].map((id) => ({
          tokenId: id.toString(),
          id: id.toString(),
          timestamp,
          totalIssuance: '100',
          tokenPrice: '1000000000000000000',
          triggerChainId: '1',
          yield1d: '10000000000000000000000000',
        }))
        const indexer = sinon.stub(centrifuge, '_queryIndexer')
        const selections = unfilteredFirst ? [rows, [rows[0]!], [rows[1]!]] : [[rows[0]!], [rows[1]!], rows]
        selections.forEach((items, index) => {
          indexer
            .onCall(index)
            .returns(
              centrifuge._query(null, () => of({ tokenInstanceSnapshots: { items }, tokenSnapshots: { items } }))
            )
        })

        const reports = new PoolReports(centrifuge, pool)
        const allQuery = unfilteredFirst ? reports[method]() : undefined
        if (allQuery) await allQuery
        const queryA = reports[method]({ shareClassId: shareClassA })
        const queryB = reports[method]({ shareClassId: shareClassB })
        const resultA = await queryA
        const resultB = await queryB
        const queryAll = allQuery ?? reports[method]()
        const all = await queryAll

        expect(Object.keys(resultA[0]!.shareClasses)).to.deep.equal([shareClassA.toString()])
        expect(Object.keys(resultB[0]!.shareClasses)).to.deep.equal([shareClassB.toString()])
        expect(Object.keys(all[0]!.shareClasses)).to.deep.equal(rows.map((row) => row.id))
        expect(indexer.callCount).to.equal(3)

        const filterField = method === 'sharePrices' ? 'tokenId_in' : 'id_in'
        expect(indexer.getCalls().map((call) => call.args[1]!.filter[filterField])).to.deep.equal(
          selections.map((items) => items.map((row) => row.id))
        )

        const sameClass = ShareClassId.from(poolId, 1)
        expect(reports[method]({ shareClassId: sameClass })).to.equal(queryA)
        expect(await reports[method]({ shareClassId: sameClass })).to.equal(resultA)
        expect(reports[method]()).to.equal(queryAll)
        expect(await reports[method]()).to.equal(all)
        expect(indexer.callCount).to.equal(3)
      })
    }
  }
})
