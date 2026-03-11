import { expect } from 'chai'
import { lastValueFrom, Observable, of } from 'rxjs'
import sinon from 'sinon'
import { encodeAbiParameters, encodeEventTopics, parseAbi } from 'viem'
import type { TransactionReceipt } from 'viem'
import { PoolId, ShareClassId } from '../utils/types.js'
import { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'

const centId = 1
const poolId = PoolId.from(centId, 1)
const scId = ShareClassId.from(poolId, 1)
const signingAddress = '0x1111111111111111111111111111111111111111'
const onOffRampFactory = '0x2222222222222222222222222222222222222222'
const merkleFactory = '0x3333333333333333333333333333333333333333'

const onOffRampEventAbi = parseAbi([
  'event DeployOnOfframpManager(uint64 indexed poolId, bytes16 scId, address indexed manager)',
])
const merkleEventAbi = parseAbi(['event DeployMerkleProofManager(uint64 indexed poolId, address indexed manager)'])

describe('PoolNetwork manager deployment flows', () => {
  afterEach(() => {
    sinon.restore()
  })

  it('reuses an existing on/off-ramp manager and only updates balance sheet access', async () => {
    const existingManager = '0x4444444444444444444444444444444444444444'
    const { poolNetwork, walletClient, updateBalanceSheetManagers } = createTestSubject({
      onOffRampManagers: [{ address: existingManager }],
    })

    const result = await lastValueFrom(poolNetwork.deployAndRegisterOnOffRampManager(scId))

    expect(result.type).to.equal('TransactionConfirmed')
    expect(walletClient.writeContract.called).to.equal(false)
    expect(
      updateBalanceSheetManagers.calledOnceWithExactly([
        { centrifugeId: centId, address: existingManager, canManage: true },
      ])
    ).to.equal(true)
  })

  it('deploys a new on/off-ramp manager and then updates balance sheet access', async () => {
    const deployedManager = '0x5555555555555555555555555555555555555555'
    const receipt = makeOnOffRampReceipt(deployedManager)
    const { poolNetwork, walletClient, updateBalanceSheetManagers } = createTestSubject({
      receipt,
    })

    const result = await lastValueFrom(poolNetwork.deployAndRegisterOnOffRampManager(scId))

    expect(result.type).to.equal('TransactionConfirmed')
    expect(walletClient.writeContract.calledOnce).to.equal(true)
    expect(
      updateBalanceSheetManagers.calledOnceWithExactly([
        { centrifugeId: centId, address: deployedManager, canManage: true },
      ])
    ).to.equal(true)
  })

  it('reuses an existing merkle proof manager and only updates balance sheet access', async () => {
    const existingManager = '0x6666666666666666666666666666666666666666'
    const { poolNetwork, walletClient, updateBalanceSheetManagers } = createTestSubject({
      merkleProofManagers: [{ address: existingManager }],
    })

    const result = await lastValueFrom(poolNetwork.deployMerkleProofManager())

    expect(result.type).to.equal('TransactionConfirmed')
    expect(walletClient.writeContract.called).to.equal(false)
    expect(
      updateBalanceSheetManagers.calledOnceWithExactly([
        { centrifugeId: centId, address: existingManager, canManage: true },
      ])
    ).to.equal(true)
  })

  it('deploys a new merkle proof manager and then updates balance sheet access', async () => {
    const deployedManager = '0x7777777777777777777777777777777777777777'
    const receipt = makeMerkleReceipt(deployedManager)
    const { poolNetwork, walletClient, updateBalanceSheetManagers } = createTestSubject({
      receipt,
    })

    const result = await lastValueFrom(poolNetwork.deployMerkleProofManager())

    expect(result.type).to.equal('TransactionConfirmed')
    expect(walletClient.writeContract.calledOnce).to.equal(true)
    expect(
      updateBalanceSheetManagers.calledOnceWithExactly([
        { centrifugeId: centId, address: deployedManager, canManage: true },
      ])
    ).to.equal(true)
  })
})

function createTestSubject({
  onOffRampManagers = [],
  merkleProofManagers = [],
  receipt = { status: 'success', logs: [] } as any as TransactionReceipt,
}: {
  onOffRampManagers?: { address: `0x${string}` }[]
  merkleProofManagers?: { address: `0x${string}` }[]
  receipt?: TransactionReceipt
}) {
  const publicClient = {
    getCode: sinon.stub().resolves('0x'),
    waitForTransactionReceipt: sinon.stub().resolves(receipt),
  }
  const walletClient = {
    writeContract: sinon.stub().resolves('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
  }

  const root = {
    _query: (_keys: unknown, callback: () => unknown) => callback(),
    _queryIndexer: (query: string, _variables: unknown, transform: (data: unknown) => unknown) => {
      if (query.includes('onOffRampManagers')) {
        return of(transform({ onOffRampManagers: { items: onOffRampManagers } }))
      }

      if (query.includes('merkleProofManagers')) {
        return of(transform({ merkleProofManagers: { items: merkleProofManagers } }))
      }

      throw new Error(`Unexpected indexer query: ${query}`)
    },
    _protocolAddresses: sinon.stub().resolves({
      onOfframpManagerFactory: onOffRampFactory,
      merkleProofManagerFactory: merkleFactory,
    }),
    getClient: sinon.stub().resolves(publicClient),
    _transact: (callback: (ctx: any) => AsyncGenerator<unknown> | Observable<unknown>, centrifugeId: number) => {
      const tx = new Observable<unknown>((subscriber) => {
        ;(async () => {
          try {
            const result = callback({
              publicClient,
              walletClient,
              signingAddress,
              executionAddress: signingAddress,
              chain: {} as any,
              centrifugeId,
              signer: {} as any,
              root,
            })

            if (Symbol.asyncIterator in result) {
              for await (const item of result) {
                subscriber.next(item)
              }
            } else {
              result.subscribe(subscriber)
              return
            }

            subscriber.complete()
          } catch (error) {
            subscriber.error(error)
          }
        })()
      })

      return Object.assign(tx, { centrifugeId })
    },
  }

  const pool = new Pool(root as any, poolId.raw)
  const updateBalanceSheetManagers = sinon
    .stub(pool, 'updateBalanceSheetManagers')
    .returns(of({ type: 'TransactionConfirmed' } as any) as any)

  const poolNetwork = new PoolNetwork(root as any, pool, centId)

  return {
    poolNetwork,
    walletClient,
    updateBalanceSheetManagers,
  }
}

function makeOnOffRampReceipt(manager: `0x${string}`) {
  const topics = encodeEventTopics({
    abi: onOffRampEventAbi,
    eventName: 'DeployOnOfframpManager',
    args: { poolId: poolId.raw, manager },
  })

  const data = encodeAbiParameters([{ type: 'bytes16' }], [scId.raw])

  return {
    status: 'success',
    logs: [
      {
        address: onOffRampFactory,
        topics,
        data,
      },
    ],
  } as any as TransactionReceipt
}

function makeMerkleReceipt(manager: `0x${string}`) {
  const topics = encodeEventTopics({
    abi: merkleEventAbi,
    eventName: 'DeployMerkleProofManager',
    args: { poolId: poolId.raw, manager },
  })

  return {
    status: 'success',
    logs: [
      {
        address: merkleFactory,
        topics,
        data: '0x',
      },
    ],
  } as any as TransactionReceipt
}
