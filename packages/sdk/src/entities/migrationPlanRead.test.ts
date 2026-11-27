import { ABIS_V3_2 } from '@centrifuge/protocol'
import { expect } from 'chai'
import { of } from 'rxjs'
import sinon from 'sinon'
import { Centrifuge } from '../Centrifuge.js'
import { randomAddress } from '../tests/utils.js'
import { MessageTypeV3_3 } from '../types/transaction.js'
import { PoolId } from '../utils/types.js'
import type { Pool } from './Pool.js'
import { LiveDriver } from './migrationPlanRead.js'

describe('LiveDriver.quote', () => {
  afterEach(() => {
    sinon.restore()
  })

  it('quotes a ramp asset registration on a remote spoke instead of refusing its pool id', async () => {
    const centrifuge = new Centrifuge({ environment: 'testnet' })
    sinon.stub(centrifuge as any, 'protocolContext').returns(
      of({
        gasService: randomAddress(),
        multiAdapter: randomAddress(),
        contractAbis: ABIS_V3_2,
        protocolVersion: '3.3',
      } as any)
    )
    const readContract = sinon.stub()
    readContract.withArgs(sinon.match({ functionName: 'messageOverallGasLimit' })).resolves(100n)
    readContract.withArgs(sinon.match({ functionName: 'maxBatchGasLimit' })).resolves(500n)
    readContract.withArgs(sinon.match({ functionName: 'estimate' })).resolves(777n)
    sinon.stub(centrifuge as any, 'getClient').returns(of({ readContract } as any))
    const pool = { id: PoolId.from(1, 1) } as unknown as Pool
    const driver = new LiveDriver(centrifuge, pool, null, randomAddress(), {} as any)

    const value = await driver.quote(2, [1], MessageTypeV3_3.RegisterAsset)

    expect(value > 0n).to.equal(true)
  })
})
