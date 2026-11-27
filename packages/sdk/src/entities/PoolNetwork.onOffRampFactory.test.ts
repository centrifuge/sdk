import { stubProjectedPools } from '../tests/utils.js'
import { ABIS_V3_2 } from '@centrifuge/protocol'
import { expect } from 'chai'
import { lastValueFrom, Observable, of } from 'rxjs'
import sinon from 'sinon'
import { encodeAbiParameters, encodeEventTopics, parseAbi } from 'viem'
import type { TransactionReceipt } from 'viem'
import { Centrifuge } from '../Centrifuge.js'
import { SAFE_PROXY_BYTECODE } from '../constants.js'
import type { HexString } from '../types/index.js'
import { PoolId, ShareClassId } from '../utils/types.js'
import { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'

const centId = 1
const poolId = PoolId.from(centId, 1)
const scId = ShareClassId.from(poolId, 1)
const signingAddress = '0x1111111111111111111111111111111111111111'
const legacyFactory = '0x2222222222222222222222222222222222222222'
const newFactory = '0x2222222222222222222222222222222222222299'
const accountingToken = '0x4444444444444444444444444444444444444444'
const deployedManager = '0x5555555555555555555555555555555555555555'
const noFactory = /neither onOffRampFactory nor onOfframpManagerFactory is deployed/

// Signatures as declared in the protocol's IOnOffRampFactory and the legacy
// IOnOfframpManagerFactory, independent of the SDK's bundled ABI.
const deployEventAbi = parseAbi([
  'event DeployOnOfframpManager(uint64 indexed poolId, bytes16 scId, address indexed manager)',
  'event DeployOnOffRamp(uint64 indexed poolId, bytes16 scId, address indexed manager)',
])

type DeployEventName = 'DeployOnOfframpManager' | 'DeployOnOffRamp'
type Factories = { onOffRampFactory?: HexString; onOfframpManagerFactory?: HexString; accountingToken?: HexString }

function deployReceipt(emitter: HexString, eventName: DeployEventName) {
  return {
    status: 'success',
    logs: [
      {
        address: emitter,
        topics: encodeEventTopics({
          abi: deployEventAbi,
          eventName,
          args: { poolId: poolId.raw, manager: deployedManager },
        }),
        data: encodeAbiParameters([{ type: 'bytes16' }], [scId.raw]),
      },
    ],
  } as any as TransactionReceipt
}

/** Fake clients plus a `_transact` that drives the flow's generator against them. */
function fakeChain({
  receipt = { status: 'success', logs: [] } as any as TransactionReceipt,
  isSafeWallet = false,
  simulateResult = '0x6666666666666666666666666666666666666666' as HexString,
} = {}) {
  // The first getCode read is the Safe check; later reads stay on the plain receipt path.
  const getCode = sinon.stub().resolves('0x')
  if (isSafeWallet) getCode.onFirstCall().resolves(SAFE_PROXY_BYTECODE)
  const publicClient = {
    getCode,
    waitForTransactionReceipt: sinon.stub().resolves(receipt),
    simulateContract: sinon.stub().resolves({ result: simulateResult }),
  }
  const walletClient = {
    writeContract: sinon.stub().resolves('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
  }

  function transact(callback: (ctx: any) => AsyncGenerator<unknown>, centrifugeId: number) {
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
  }

  return { publicClient, walletClient, transact }
}

/** A PoolNetwork over a stubbed root whose `protocolContext` lists `factories`. */
function subject(factories: Factories, chainOptions: Parameters<typeof fakeChain>[0] = {}) {
  const chain = fakeChain(chainOptions)
  const protocolContext = sinon.stub().resolves({ ...factories, contractAbis: ABIS_V3_2, protocolVersion: '3.2' })
  const root = {
    _query: (_keys: unknown, callback: () => unknown) => callback(),
    _queryData: (name: string, _variables: unknown, transform?: (rows: unknown) => unknown) => {
      if (name === 'onOffRampManagers') return of(transform ? transform([]) : [])
      throw new Error(`Unexpected query: ${name}`)
    },
    protocolContext,
    _routesToBackend: () => false,
    getClient: sinon.stub().resolves(chain.publicClient),
    _transact: chain.transact,
  }

  const pool = new Pool(root as any, poolId.raw)
  const poolNetwork = new PoolNetwork(root as any, pool, centId)
  const register = sinon
    .stub(poolNetwork, 'registerOnOffRampManagerAsBSManager')
    .returns(of({ type: 'TransactionConfirmed' } as any) as any)

  return { ...chain, poolNetwork, protocolContext, register }
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
  lastValueFrom(poolNetwork.deployOnOfframpManager(scId) as unknown as Observable<any>)
const deployAndRegister = (poolNetwork: PoolNetwork) =>
  lastValueFrom(poolNetwork.deployAndRegisterOnOffRampManager(scId) as unknown as Observable<any>)

describe('PoolNetwork on/off-ramp factory resolution', () => {
  afterEach(() => {
    sinon.restore()
  })

  describe('deployOnOfframpManager', () => {
    it('deploys through onOffRampFactory when only it is listed', async () => {
      const { poolNetwork, walletClient } = subject(
        { onOffRampFactory: newFactory },
        { receipt: deployReceipt(newFactory, 'DeployOnOffRamp') }
      )

      expect(await deploy(poolNetwork)).to.deep.equal({ type: 'DeployedOnOfframpManager', address: deployedManager })
      expect(walletClient.writeContract.firstCall.args[0].address).to.equal(newFactory)
    })

    it('deploys through the legacy factory when only it is listed', async () => {
      const { poolNetwork, walletClient } = subject(
        { onOfframpManagerFactory: legacyFactory },
        { receipt: deployReceipt(legacyFactory, 'DeployOnOfframpManager') }
      )

      expect(await deploy(poolNetwork)).to.deep.equal({ type: 'DeployedOnOfframpManager', address: deployedManager })
      expect(walletClient.writeContract.firstCall.args[0].address).to.equal(legacyFactory)
    })

    it('prefers onOffRampFactory when both are listed', async () => {
      const { poolNetwork, walletClient } = subject(
        { onOffRampFactory: newFactory, onOfframpManagerFactory: legacyFactory },
        { receipt: deployReceipt(newFactory, 'DeployOnOffRamp') }
      )

      await deploy(poolNetwork)

      expect(walletClient.writeContract.firstCall.args[0].address).to.equal(newFactory)
    })

    it('throws before writing when neither factory is listed', async () => {
      const { poolNetwork, walletClient } = subject({})

      expect((await captureError(() => deploy(poolNetwork)))?.message).to.match(noFactory)
      expect(walletClient.writeContract.called).to.equal(false)
    })

    it('ignores a deploy event emitted by a contract other than the resolved factory', async () => {
      const { poolNetwork } = subject(
        { onOffRampFactory: newFactory },
        { receipt: deployReceipt(legacyFactory, 'DeployOnOffRamp') }
      )

      expect((await captureError(() => deploy(poolNetwork)))?.message).to.equal(
        'DeployOnOfframpManager event not found'
      )
    })
  })

  describe('computeOnOffRampManagerAddress', () => {
    for (const [label, factories, expected] of [
      ['onOffRampFactory when only it is listed', { onOffRampFactory: newFactory }, newFactory],
      ['the legacy factory when only it is listed', { onOfframpManagerFactory: legacyFactory }, legacyFactory],
      [
        'onOffRampFactory when both are listed',
        { onOffRampFactory: newFactory, onOfframpManagerFactory: legacyFactory },
        newFactory,
      ],
    ] as const) {
      it(`simulates against ${label}`, async () => {
        const { poolNetwork, publicClient } = subject(factories, { simulateResult: deployedManager })

        expect(await poolNetwork.computeOnOffRampManagerAddress(scId)).to.equal(deployedManager)
        expect(publicClient.simulateContract.firstCall.args[0].address).to.equal(expected)
      })
    }

    it('throws before simulating when neither factory is listed', async () => {
      const { poolNetwork, publicClient } = subject({})

      const error = await captureError(() => poolNetwork.computeOnOffRampManagerAddress(scId))

      expect(error?.message).to.match(noFactory)
      expect(publicClient.simulateContract.called).to.equal(false)
    })
  })

  describe('deployAndRegisterOnOffRampManager', () => {
    for (const [eventName, factories, emitter] of [
      ['DeployOnOffRamp', { onOffRampFactory: newFactory, accountingToken }, newFactory],
      ['DeployOnOfframpManager', { onOfframpManagerFactory: legacyFactory }, legacyFactory],
    ] as const) {
      it(`registers the manager read from a ${eventName} receipt`, async () => {
        const { poolNetwork, register } = subject(factories, {
          receipt: deployReceipt(emitter, eventName),
        })

        await deployAndRegister(poolNetwork)

        expect(register.firstCall.args).to.deep.equal([deployedManager, scId])
      })
    }

    it('ignores a deploy event emitted by a contract other than the resolved factory', async () => {
      const { poolNetwork, register } = subject(
        { onOffRampFactory: newFactory, accountingToken },
        { receipt: deployReceipt(legacyFactory, 'DeployOnOffRamp') }
      )

      const error = await captureError(() => deployAndRegister(poolNetwork))

      expect(error?.message).to.equal('DeployOnOfframpManager event not found')
      expect(register.called).to.equal(false)
    })

    it('throws before writing when neither factory is listed', async () => {
      const { poolNetwork, walletClient } = subject({})

      expect((await captureError(() => deployAndRegister(poolNetwork)))?.message).to.match(noFactory)
      expect(walletClient.writeContract.called).to.equal(false)
    })

    for (const [label, factories, expected, eventName] of [
      ['onOffRampFactory', { onOffRampFactory: newFactory, accountingToken }, newFactory, 'DeployOnOffRamp'],
      ['the legacy factory', { onOfframpManagerFactory: legacyFactory }, legacyFactory, 'DeployOnOfframpManager'],
    ] as const) {
      it(`on a Safe, precomputes and writes against ${label}, resolving the same factory for both`, async () => {
        const { poolNetwork, publicClient, walletClient, protocolContext, register } = subject(factories, {
          isSafeWallet: true,
          simulateResult: deployedManager,
          receipt: deployReceipt(expected, eventName),
        })

        await deployAndRegister(poolNetwork)

        expect(publicClient.simulateContract.firstCall.args[0].address).to.equal(expected)
        expect(walletClient.writeContract.firstCall.args[0].address).to.equal(expected)
        // The pre-check reads the pool's and the network's entries; the deploy step reads the network's once.
        expect(protocolContext.callCount).to.equal(3)
        expect(register.firstCall.args).to.deep.equal([deployedManager, scId])
      })
    }

    it('on a Safe, registers nothing when the simulated address is not the one the receipt deployed', async () => {
      const simulated = '0x7777777777777777777777777777777777777777'
      const { poolNetwork, register } = subject(
        { onOffRampFactory: newFactory, accountingToken },
        { isSafeWallet: true, simulateResult: simulated, receipt: deployReceipt(newFactory, 'DeployOnOffRamp') }
      )

      const error = await captureError(() => deployAndRegister(poolNetwork))

      expect(error?.message).to.contain(deployedManager)
      expect(error?.message).to.contain(simulated)
      expect(error?.message).to.contain('no roles were granted')
      expect(register.called).to.equal(false)
    })

    it('on a Safe, registers nothing when the receipt carries no deploy event', async () => {
      const { poolNetwork, register } = subject(
        { onOffRampFactory: newFactory, accountingToken },
        { isSafeWallet: true, simulateResult: deployedManager }
      )

      const error = await captureError(() => deployAndRegister(poolNetwork))

      expect(error?.message).to.equal('DeployOnOfframpManager event not found')
      expect(register.called).to.equal(false)
    })
  })
})

describe('PoolNetwork on/off-ramp factory source', () => {
  const evil = '0xE000000000000000000000000000000000000BAD'

  afterEach(() => {
    sinon.restore()
  })

  /** A real mainnet Centrifuge whose indexer reports an unlisted address in both factory fields. */
  function mainnetSubject(centrifugeId: number) {
    const centrifuge = new Centrifuge({ environment: 'mainnet' })
    const evilRow = { centrifugeId, chainId: 1, onOffRampFactory: evil, onOfframpManagerFactory: evil }
    const fetch = sinon
      .stub(globalThis, 'fetch')
      .resolves(
        new Response(JSON.stringify({ data: { deployments: { items: [evilRow] }, blockchains: { items: [] } } }))
      )
    sinon.stub(centrifuge, '_queryData').returns(of([evilRow]) as any)
    stubProjectedPools(centrifuge, [PoolId.from(centrifugeId, 1)])
    const chain = fakeChain({ receipt: { status: 'success', logs: [] } as any as TransactionReceipt })
    sinon.stub(centrifuge, '_transact').callsFake(chain.transact as any)

    const poolNetwork = new PoolNetwork(
      centrifuge,
      new Pool(centrifuge, PoolId.from(centrifugeId, 1).raw),
      centrifugeId
    )
    return { ...chain, fetch, poolNetwork }
  }

  for (const [label, centrifugeId, listed] of [
    ['legacy factory on Plume', 4, '0x2539e60B0B50D7BD004A09e9D2b7E8c86EB0AaF6'],
    ['onOffRampFactory on X Layer', 13, '0x22E2f679669D69b6b6f22CC9C1731035a3Fa0296'],
  ] as const) {
    it(`deploys through the registry-listed ${label}, never an indexer-reported address`, async () => {
      const { poolNetwork, walletClient, fetch } = mainnetSubject(centrifugeId)

      // The receipt carries no deploy event, so the flow fails after the write.
      await captureError(() => lastValueFrom(poolNetwork.deployOnOfframpManager(scId) as unknown as Observable<any>))

      expect(walletClient.writeContract.callCount).to.equal(1)
      expect(walletClient.writeContract.firstCall.args[0].address).to.equal(listed)
      expect(fetch.called).to.equal(false)
    })
  }
})

describe('PoolNetwork.onOfframpManager', () => {
  it('memoizes the query per share class', () => {
    const centrifuge = new Centrifuge({ environment: 'testnet' })
    const pn = new PoolNetwork(centrifuge, new Pool(centrifuge, poolId.raw), centId)
    const otherScId = ShareClassId.from(poolId, 2)

    expect(pn.onOfframpManager(scId)).to.equal(pn.onOfframpManager(scId))
    expect(pn.onOfframpManager(scId)).to.not.equal(pn.onOfframpManager(otherScId))
  })
})
