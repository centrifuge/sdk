import { ABIS_V3_2 } from '@centrifuge/protocol'
import { expect } from 'chai'
import { of } from 'rxjs'
import sinon from 'sinon'
import { Centrifuge } from './Centrifuge.js'
import { randomAddress } from './tests/utils.js'
import { MessageType, MessageTypeV3_3, messageV3_3 } from './types/transaction.js'
import { PoolId } from './utils/types.js'

const poolId = PoolId.from(1, 1)

describe('Centrifuge._estimate', () => {
  afterEach(() => {
    sinon.restore()
  })

  it('resolves 0n for a same-chain message without reading a contract', async () => {
    const centrifuge = new Centrifuge({ environment: 'testnet' })
    // Models what MultiAdapter.estimate answers for the local chain: no
    // adapters, so 0. Without the short-circuit the zero-fee refusal fires.
    const readContract = sinon.stub().resolves(0n)

    const protocolContext = sinon
      .stub(centrifuge as any, 'protocolContext')
      .returns(of({ gasService: randomAddress(), multiAdapter: randomAddress(), contractAbis: ABIS_V3_2 } as any))
    const getClient = sinon.stub(centrifuge as any, 'getClient').returns(of({ readContract } as any))

    const estimate = await centrifuge._estimate(1, 1, { type: MessageType.NotifyPool, poolId })

    expect(estimate).to.equal(0n)
    expect(readContract.called).to.equal(false)
    expect(protocolContext.called).to.equal(false)
    expect(getClient.called).to.equal(false)
  })

  it('still estimates via a contract read for a real crosschain route', async () => {
    const centrifuge = new Centrifuge({ environment: 'testnet' })
    const readContract = sinon.stub()
    readContract.withArgs(sinon.match({ functionName: 'messageOverallGasLimit' })).resolves(100n)
    readContract.withArgs(sinon.match({ functionName: 'maxBatchGasLimit' })).resolves(500n)
    readContract.withArgs(sinon.match({ functionName: 'estimate' })).resolves(777n)

    sinon
      .stub(centrifuge as any, 'protocolContext')
      .returns(of({ gasService: randomAddress(), multiAdapter: randomAddress(), contractAbis: ABIS_V3_2 } as any))
    sinon.stub(centrifuge as any, 'getClient').returns(of({ readContract } as any))

    const estimate = await centrifuge._estimate(1, 2, { type: MessageType.NotifyPool, poolId })

    expect(estimate).to.equal(1165n)
    expect(readContract.called).to.equal(true)
  })

  it('prices a v3.3-only message on the v3.3 stack of the sending chain, even for a pool that still resolves to v3.2', async () => {
    const centrifuge = new Centrifuge({ environment: 'testnet' })
    const protocolContext = sinon.stub(centrifuge as any, 'protocolContext').callsFake((target: unknown) => {
      const asked = target as { protocolVersion?: string }
      return of({
        gasService: randomAddress(),
        multiAdapter: randomAddress(),
        contractAbis: ABIS_V3_2,
        protocolVersion: asked.protocolVersion ?? '3.2',
      } as any)
    })
    const readContract = sinon.stub().rejects(new Error('stop after the context'))
    sinon.stub(centrifuge as any, 'getClient').returns(of({ readContract } as any))

    const error = await centrifuge._estimate(1, 2, [messageV3_3(MessageTypeV3_3.ManagerCallFromHub, poolId)]).then(
      () => null,
      (e: unknown) => e as Error
    )

    expect(protocolContext.firstCall.args[0]).to.deep.equal({ centrifugeId: 1, protocolVersion: '3.3' })
    expect(error?.message ?? '').to.not.contain('exists on protocol v3.3 only')
  })

  it('keeps pricing a v3.2 message against the pool it names', async () => {
    const centrifuge = new Centrifuge({ environment: 'testnet' })
    const protocolContext = sinon
      .stub(centrifuge as any, 'protocolContext')
      .returns(of({ gasService: randomAddress(), multiAdapter: randomAddress(), contractAbis: ABIS_V3_2 } as any))
    sinon.stub(centrifuge as any, 'getClient').returns(of({ readContract: sinon.stub().resolves(1n) } as any))

    await centrifuge._estimate(1, 2, { type: MessageType.NotifyPool, poolId }).then(
      () => undefined,
      () => undefined
    )

    expect(protocolContext.firstCall.args[0]).to.deep.equal({ poolId, centrifugeId: 1 })
  })
})
