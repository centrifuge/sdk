import { expect } from 'chai'
import { lastValueFrom, Observable } from 'rxjs'
import sinon from 'sinon'
import type { TransactionReceipt } from 'viem'
import { Centrifuge } from '../Centrifuge.js'
import { stubProjectedPools } from '../tests/utils.js'
import { PoolId, ShareClassId } from '../utils/types.js'
import { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'

const signingAddress = '0x1111111111111111111111111111111111111111'
const predictedManager = '0x6666666666666666666666666666666666666666'
const onOffRampFactory = '0x22E2f679669D69b6b6f22CC9C1731035a3Fa0296'
const legacyFactory = '0x2539e60B0B50D7BD004A09e9D2b7E8c86EB0AaF6'
// Centrifuge id and EVM chain id of the mainnet chains that list both factories.
const BOTH_FACTORIES = [
  { centrifugeId: 1, chainId: 1, name: 'ethereum' },
  { centrifugeId: 2, chainId: 8453, name: 'base' },
  { centrifugeId: 3, chainId: 42161, name: 'arbitrum' },
  { centrifugeId: 10, chainId: 10, name: 'optimism' },
]

/** A mainnet Centrifuge on the bundled registry, with a fake chain behind the clients. */
function subject(centrifugeId: number) {
  const poolId = PoolId.from(centrifugeId, 1)
  const centrifuge = new Centrifuge({ environment: 'mainnet' })
  stubProjectedPools(centrifuge, [poolId])
  const publicClient = {
    getCode: sinon.stub().resolves('0x'),
    waitForTransactionReceipt: sinon
      .stub()
      .resolves({ status: 'success', logs: [] } as unknown as TransactionReceipt),
    simulateContract: sinon.stub().resolves({ result: predictedManager }),
  }
  const walletClient = { writeContract: sinon.stub().resolves(`0x${'aa'.repeat(32)}`) }
  sinon.stub(centrifuge, 'getClient').resolves(publicClient as any)
  sinon.stub(centrifuge, '_transact').callsFake(((callback: (ctx: any) => AsyncGenerator<unknown>, id: number) => {
    const tx = new Observable<unknown>((subscriber) => {
      ;(async () => {
        try {
          const ctx = { publicClient, walletClient, signingAddress, executionAddress: signingAddress, centrifugeId: id }
          for await (const item of callback(ctx)) subscriber.next(item)
          subscriber.complete()
        } catch (error) {
          subscriber.error(error)
        }
      })()
    })
    return Object.assign(tx, { centrifugeId: id })
  }) as any)
  const poolNetwork = new PoolNetwork(centrifuge, new Pool(centrifuge, poolId.raw), centrifugeId)
  return { poolNetwork, publicClient, walletClient, scId: ShareClassId.from(poolId, 1) }
}

describe('PoolNetwork on/off-ramp factory against the bundled registry', () => {
  afterEach(() => {
    sinon.restore()
  })

  for (const { centrifugeId, chainId, name } of BOTH_FACTORIES) {
    describe(`mainnet centrifugeId ${centrifugeId} (${name}, chain ${chainId})`, () => {
      it('resolves a protocol context that carries both factories', async () => {
        const { poolNetwork } = subject(centrifugeId)
        const context = await (poolNetwork.pool._root.protocolContext(centrifugeId) as any)

        expect(context.onOffRampFactory).to.equal(onOffRampFactory)
        expect(context.onOfframpManagerFactory).to.equal(legacyFactory)
      })

      it('deploys a manager through onOffRampFactory', async () => {
        const { poolNetwork, walletClient, scId } = subject(centrifugeId)

        // The receipt carries no deploy event, so the flow fails after the write.
        await lastValueFrom(poolNetwork.deployOnOfframpManager(scId) as unknown as Observable<any>).catch(() => {})

        expect(walletClient.writeContract.callCount).to.equal(1)
        expect(walletClient.writeContract.firstCall.args[0].address).to.equal(onOffRampFactory)
        expect(walletClient.writeContract.firstCall.args[0].functionName).to.equal('newManager')
      })

      it('computes the manager address against onOffRampFactory', async () => {
        const { poolNetwork, publicClient, scId } = subject(centrifugeId)

        expect(await poolNetwork.computeOnOffRampManagerAddress(scId)).to.equal(predictedManager)
        expect(publicClient.simulateContract.firstCall.args[0].address).to.equal(onOffRampFactory)
      })
    })
  }
})
