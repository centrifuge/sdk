import { expect } from 'chai'
import { lastValueFrom, of } from 'rxjs'
import sinon from 'sinon'
import { PoolId } from '../utils/types.js'
import { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'

const poolId = PoolId.from(1, 1)
const centId = 2
const shareManager = '0xaD304e02FC56ff4536aD304e02FC56ff4536aD30'
const asyncRequestManager = '0x8888888888888888888888888888888888888888'
const syncManager = '0x9999999999999999999999999999999999999999'

type ManagerRow = {
  address: `0x${string}`
  centrifugeId: string
  isBalancesheetManager?: boolean
  crosschainInProgress?: 'CanManage' | 'CanNotManage' | null
}

function network({ shareManager, poolManagers = [] }: { shareManager?: `0x${string}`; poolManagers?: ManagerRow[] }) {
  const root = {
    _transact: sinon.stub(),
    _routesToBackend: () => false,
    _query: (_keys: unknown, callback: () => unknown) => callback(),
    _queryData: (name: string, _variables: unknown, transform?: (data: unknown) => unknown) => {
      if (name !== 'poolManagers') throw new Error(`Unexpected query: ${name}`)
      const rows = poolManagers.map((m) => ({
        isHubManager: false,
        isBalancesheetManager: false,
        crosschainInProgress: null,
        poolId: poolId.toString(),
        ...m,
      }))
      return of(transform ? transform(rows) : rows)
    },
    protocolContext: sinon.stub().returns(of({ asyncRequestManager, syncManager, shareManager })),
  }
  const pool = new Pool(root as any, poolId.raw)
  return new PoolNetwork(root as any, pool, centId)
}

describe('PoolNetwork.shareManagerStatus', () => {
  afterEach(() => {
    sinon.restore()
  })

  it('is null where the network has no ShareManager', async () => {
    expect(await lastValueFrom(network({}).shareManagerStatus())).to.equal(null)
  })

  it('reports the manager as not a balance sheet manager and nothing in transit without the grant', async () => {
    const status = await lastValueFrom(network({ shareManager }).shareManagerStatus())
    expect(status).to.deep.equal({ address: shareManager, isBalancesheetManager: false, crosschainInProgress: null })
  })

  it('reports the grant in transit once sent from the hub and not yet confirmed', async () => {
    const status = await lastValueFrom(
      network({
        shareManager,
        poolManagers: [{ address: shareManager, centrifugeId: String(centId), crosschainInProgress: 'CanManage' }],
      }).shareManagerStatus()
    )
    expect(status).to.deep.equal({
      address: shareManager,
      isBalancesheetManager: false,
      crosschainInProgress: 'CanManage',
    })
  })

  it('reports the manager as a balance sheet manager once the grant is confirmed, matching the indexed address by value', async () => {
    const status = await lastValueFrom(
      network({
        shareManager,
        poolManagers: [
          {
            address: shareManager.toLowerCase() as `0x${string}`,
            centrifugeId: String(centId),
            isBalancesheetManager: true,
          },
        ],
      }).shareManagerStatus()
    )
    expect(status).to.deep.equal({ address: shareManager, isBalancesheetManager: true, crosschainInProgress: null })
  })

  it('keeps a live manager live while its revoke is in transit', async () => {
    const status = await lastValueFrom(
      network({
        shareManager,
        poolManagers: [
          {
            address: shareManager,
            centrifugeId: String(centId),
            isBalancesheetManager: true,
            crosschainInProgress: 'CanNotManage',
          },
        ],
      }).shareManagerStatus()
    )
    expect(status).to.deep.equal({
      address: shareManager,
      isBalancesheetManager: true,
      crosschainInProgress: 'CanNotManage',
    })
  })

  it('ignores the same manager address confirmed on another network', async () => {
    const status = await lastValueFrom(
      network({
        shareManager,
        poolManagers: [{ address: shareManager, centrifugeId: '99', isBalancesheetManager: true }],
      }).shareManagerStatus()
    )
    expect(status).to.deep.equal({ address: shareManager, isBalancesheetManager: false, crosschainInProgress: null })
  })
})
