import { ABIS_V3_2 } from '@centrifuge/protocol'
import { expect } from 'chai'
import { lastValueFrom, Observable, of } from 'rxjs'
import sinon from 'sinon'
import { encodeEventTopics, parseAbi } from 'viem'
import type { TransactionReceipt } from 'viem'
import { SAFE_PROXY_BYTECODE } from '../constants.js'
import type { HexString } from '../types/index.js'
import { PoolId } from '../utils/types.js'
import { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'

const centId = 1
const poolId = PoolId.from(centId, 1)
const signingAddress = '0x1111111111111111111111111111111111111111'
const factory = '0x2222222222222222222222222222222222222222'
const deployedManager = '0x5555555555555555555555555555555555555555'

const deployEventAbi = parseAbi(['event DeployMerkleProofManager(uint64 indexed poolId, address indexed manager)'])

const deployReceipt = {
  status: 'success',
  logs: [
    {
      address: factory,
      topics: encodeEventTopics({
        abi: deployEventAbi,
        eventName: 'DeployMerkleProofManager',
        args: { poolId: poolId.raw, manager: deployedManager },
      }),
      data: '0x',
    },
  ],
} as any as TransactionReceipt

function subject({ simulated, receipt }: { simulated: HexString; receipt: TransactionReceipt }) {
  const getCode = sinon.stub().resolves('0x')
  getCode.onFirstCall().resolves(SAFE_PROXY_BYTECODE)
  const publicClient = { getCode, waitForTransactionReceipt: sinon.stub().resolves(receipt) }
  const walletClient = {
    writeContract: sinon.stub().resolves('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
  }
  const root = {
    _transact(callback: (ctx: any) => AsyncGenerator<unknown>, centrifugeId: number) {
      const tx = new Observable<unknown>((subscriber) => {
        ;(async () => {
          try {
            const ctx = { publicClient, walletClient, signingAddress, executionAddress: signingAddress, centrifugeId }
            for await (const item of callback(ctx)) subscriber.next(item)
            subscriber.complete()
          } catch (error) {
            subscriber.error(error)
          }
        })()
      })
      return Object.assign(tx, { centrifugeId })
    },
  }
  const poolNetwork = new PoolNetwork(root as any, new Pool(root as any, poolId.raw), centId)
  sinon.stub(poolNetwork as any, '_findDeployedMerkleProofManagerAddress').resolves(null)
  sinon.stub(poolNetwork as any, '_protocolContext').resolves({
    merkleProofManagerFactory: factory,
    contractAbis: ABIS_V3_2,
    protocolVersion: '3.2',
  })
  sinon.stub(poolNetwork, 'computeMerkleProofManagerAddress').resolves(simulated)
  const register = sinon
    .stub(poolNetwork, 'registerMerkleProofManagerAsBSManager')
    .returns(of({ type: 'TransactionConfirmed' } as any) as any)
  return { poolNetwork, register }
}

async function captureError(run: () => Promise<unknown>) {
  try {
    await run()
  } catch (e) {
    return e as Error
  }
  return null
}

const deploy = (poolNetwork: PoolNetwork) =>
  lastValueFrom(poolNetwork.deployMerkleProofManager() as unknown as Observable<any>)

describe('PoolNetwork.deployMerkleProofManager on a Safe', () => {
  afterEach(() => sinon.restore())

  it('registers the manager the receipt deployed when the simulation agrees', async () => {
    const { poolNetwork, register } = subject({ simulated: deployedManager, receipt: deployReceipt })

    await deploy(poolNetwork)

    expect(register.firstCall.args).to.deep.equal([deployedManager])
  })

  it('registers nothing when the simulated address is not the one the receipt deployed', async () => {
    const simulated = '0x7777777777777777777777777777777777777777'
    const { poolNetwork, register } = subject({ simulated, receipt: deployReceipt })

    const error = await captureError(() => deploy(poolNetwork))

    expect(error?.message).to.contain('no roles were granted')
    expect(register.called).to.equal(false)
  })

  it('registers nothing when the receipt carries no deploy event', async () => {
    const { poolNetwork, register } = subject({
      simulated: deployedManager,
      receipt: { status: 'success', logs: [] } as any as TransactionReceipt,
    })

    const error = await captureError(() => deploy(poolNetwork))

    expect(error?.message).to.equal('DeployMerkleProofManager event not found')
    expect(register.called).to.equal(false)
  })
})
