import type { ShareManagerCallRow } from '@centrifuge/queries/core'
import { expect } from 'chai'
import { lastValueFrom, of } from 'rxjs'
import sinon from 'sinon'
import { PoolId, ShareClassId } from '../utils/types.js'
import { Pool } from './Pool.js'
import { ShareClass } from './ShareClass.js'

const poolId = PoolId.from(1, 1)
const scId = ShareClassId.from(poolId, 1)
const account = '0x1111111111111111111111111111111111111111'

function row(overrides: Partial<ShareManagerCallRow>): ShareManagerCallRow {
  return {
    messageId: '0xaaaa',
    messageIndex: 0,
    poolId: poolId.raw.toString(),
    centrifugeId: '2',
    targetAddress: '0xe587b9dc2659d8742447044d964ea3ae72f4a9ad',
    kind: 'Issue',
    scId: scId.raw,
    account,
    shares: '7000000',
    createdAt: '2026-11-16T10:00:00.000Z',
    createdAtTxHash: '0xtx',
    status: 'AwaitingBatchDelivery',
    ...overrides,
  }
}

function shareClass(rows: ShareManagerCallRow[], decimals = 6) {
  const queried: { name: string; vars: unknown }[] = []
  const root = {
    _transact: sinon.stub(),
    _routesToBackend: () => false,
    _query: (_keys: unknown, callback: () => unknown) => callback(),
    _queryData: (name: string, vars: unknown) => {
      queried.push({ name, vars })
      return of(rows)
    },
  }
  const pool = new Pool(root as any, poolId.raw)
  sinon.stub(pool, 'decimals').returns(of(decimals) as any)
  return { shareClass: new ShareClass(root as any, pool, scId.raw), queried }
}

describe('ShareClass.directIssuancesInFlight', () => {
  afterEach(() => {
    sinon.restore()
  })

  it('reads the share class ShareManager calls and lists those not yet executed, shares in pool decimals', async () => {
    const { shareClass: sc, queried } = shareClass([
      row({ messageId: '0x01', status: 'Unsent' }),
      row({ messageId: '0x02', status: 'AwaitingBatchDelivery', kind: 'Revoke', shares: '3000000' }),
      row({ messageId: '0x03', status: 'Failed' }),
      row({ messageId: '0x04', status: 'Executed' }),
      row({ messageId: '0x05', status: 'Cleared' }),
    ])
    const inFlight = await lastValueFrom(sc.directIssuancesInFlight())
    expect(queried).to.deep.equal([{ name: 'shareManagerCalls', vars: { tokenId: scId.raw } }])
    expect(inFlight.map((item) => [item.messageId, item.kind, item.status])).to.deep.equal([
      ['0x01', 'Issue', 'Unsent'],
      ['0x02', 'Revoke', 'AwaitingBatchDelivery'],
      ['0x03', 'Issue', 'Failed'],
    ])
    expect(inFlight[0]!.shares.toFloat()).to.equal(7)
    expect(inFlight[1]!.shares.toFloat()).to.equal(3)
    expect(inFlight[0]!.account).to.equal(account)
    expect(inFlight[0]!.centrifugeId).to.equal(2)
    expect(inFlight[0]!.hubTxHash).to.equal('0xtx')
    expect(inFlight[0]!.createdAt.toISOString()).to.equal('2026-11-16T10:00:00.000Z')
  })

  it('is empty when every call executed', async () => {
    const { shareClass: sc } = shareClass([row({ status: 'Executed' })])
    expect(await lastValueFrom(sc.directIssuancesInFlight())).to.deep.equal([])
  })
})
