import { expect } from 'chai'
import { isObservable, lastValueFrom, Observable, of, toArray } from 'rxjs'
import sinon from 'sinon'
import {
  ContractFunctionRevertedError,
  decodeFunctionData,
  encodeAbiParameters,
  encodeErrorResult,
  encodeEventTopics,
  encodeFunctionData,
  zeroAddress,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { ABI } from '../abi/index.js'
import { Centrifuge } from '../Centrifuge.js'
import { stubChain } from '../tests/utils.js'
import { MessageType } from '../types/transaction.js'
import { toAccountingTokenId } from '../utils/accountingToken.js'
import { addressToBytes32, encode } from '../utils/index.js'
import { makeThenable } from '../utils/rx.js'
import { AssetId, PoolId, ShareClassId } from '../utils/types.js'
import { OnOffRampManager } from './OnOffRampManager.js'
import { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'
import { ShareClass } from './ShareClass.js'

const hubCentrifugeId = 1
const rampCentrifugeId = 13
const hub = '0xcccccccccccccccccccccccccccccccccccccccc'
const hubRegistry = '0x6666666666666666666666666666666666666666'
const spoke = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
const spokeRegistry = '0xffffffffffffffffffffffffffffffffffffffff'
const accountingToken = '0xdddddddddddddddddddddddddddddddddddddddd'
const otherAccountingToken = '0x3333333333333333333333333333333333333333'
const factory = '0x2222222222222222222222222222222222222222'
const usdc = '0x4444444444444444444444444444444444444444'
const receiver = '0x5555555555555555555555555555555555555555'
const relayer = '0x7777777777777777777777777777777777777777'
const signingAddress = '0x1111111111111111111111111111111111111111'
const ramp = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const
const usdcAssetId = AssetId.from(rampCentrifugeId, 1)
const withdrawAccountingAssetId = AssetId.from(rampCentrifugeId, 6)
const depositAccountingAssetId = AssetId.from(rampCentrifugeId, 7)

type Batch = { contract: string; data: `0x${string}`[]; messages: Record<number, { type: number }[]> }
type ReadArgs = { address: string; functionName: string; args?: any[] }

function revert(functionName: string, errorName?: 'UnknownAsset') {
  return new ContractFunctionRevertedError({
    abi: ABI.Spoke,
    functionName,
    data: errorName ? encodeErrorResult({ abi: ABI.Spoke, errorName }) : undefined,
    message: 'execution reverted',
  })
}

function registerAssetLog(assetId: AssetId, tokenId: bigint, address: `0x${string}` = spoke) {
  return {
    address,
    topics: encodeEventTopics({
      abi: ABI.Spoke,
      eventName: 'RegisterAsset',
      args: { assetId: assetId.raw, asset: accountingToken, tokenId },
    }),
    data: encodeAbiParameters(
      [{ type: 'uint16' }, { type: 'string' }, { type: 'string' }, { type: 'uint8' }, { type: 'bool' }],
      [rampCentrifugeId, 'Accounting Token', 'ACC', 6, true]
    ),
  }
}

function createSubject({
  hubChain = hubCentrifugeId,
  spokeVersion = 'v3.2' as 'v3.2' | 'v3.3',
  mode = 'build' as 'build' | 'sign',
  spokeContext = { spoke, onOffRampFactory: factory, accountingToken } as Record<string, unknown>,
  rampAccountingToken = accountingToken as string | Error,
  registered,
  usdcRegistered = true,
  isManager = true,
  assetToIdError,
  registeredIds = [withdrawAccountingAssetId],
  emitRegisterEvent = true,
  spokeReportsRegistration = true,
}: {
  hubChain?: number
  spokeVersion?: 'v3.2' | 'v3.3'
  // 'build' yields the raw hub batch, as buildOnly and batches do; 'sign' sends it.
  mode?: 'build' | 'sign'
  spokeContext?: Record<string, unknown>
  rampAccountingToken?: string | Error
  registered?: Map<bigint, AssetId>
  usdcRegistered?: boolean
  isManager?: boolean
  assetToIdError?: Error
  // The id each successive registration is assigned.
  registeredIds?: AssetId[]
  emitRegisterEvent?: boolean
  spokeReportsRegistration?: boolean
} = {}) {
  const poolId = PoolId.from(hubChain, 15)
  const scId = ShareClassId.from(poolId, 1)
  const withdrawTokenId = toAccountingTokenId(poolId.raw, usdc, false)
  const depositTokenId = toAccountingTokenId(poolId.raw, usdc, true)
  const known =
    registered ??
    new Map([
      [withdrawTokenId, withdrawAccountingAssetId],
      [depositTokenId, depositAccountingAssetId],
    ])

  const client = {
    readContract: sinon.stub().callsFake(async ({ address, functionName, args }: ReadArgs) => {
      if (functionName === 'accountingToken') {
        expect(address).to.equal(ramp)
        if (rampAccountingToken instanceof Error) throw rampAccountingToken
        return rampAccountingToken
      }
      if (functionName === 'manager') {
        expect(address).to.equal(hubRegistry)
        expect(args).to.deep.equal([poolId.raw, signingAddress])
        return isManager
      }
      if (functionName === 'spokeRegistry') {
        expect(address).to.equal(spoke)
        if (spokeVersion === 'v3.2') throw revert('spokeRegistry')
        return spokeRegistry
      }
      expect(address).to.equal(spokeVersion === 'v3.3' ? spokeRegistry : spoke)
      if (functionName === 'idToAsset') {
        expect(args).to.deep.equal([usdcAssetId.raw])
        if (usdcRegistered) return [usdc, 0n]
        if (spokeVersion === 'v3.3') return [zeroAddress, 0n]
        throw revert('idToAsset', 'UnknownAsset')
      }
      if (functionName === 'assetToId') {
        if (assetToIdError) throw assetToIdError
        expect(args![0]).to.equal(accountingToken)
        const id = known.get(args![1])
        if (id) return id.raw
        if (spokeVersion === 'v3.3') return 0n
        throw revert('assetToId', 'UnknownAsset')
      }
      throw new Error(`unexpected eth_call ${functionName}`)
    }),
  }

  let registrations = 0
  const registerAsset = sinon.spy(async function* (
    _ctx: unknown,
    _origin: number,
    _registerOn: number,
    _asset: string,
    tokenId: bigint
  ) {
    const assetId = registeredIds[registrations++]!
    if (spokeReportsRegistration) known.set(tokenId, assetId)
    yield { type: 'TransactionPending', title: 'Register asset' }
    const confirmed = {
      type: 'TransactionConfirmed',
      title: 'Register asset',
      receipt: { transactionHash: '0xabc', logs: emitRegisterEvent ? [registerAssetLog(assetId, tokenId)] : [] },
    }
    yield confirmed
    return confirmed
  })

  const sent: { centrifugeId: number; data: `0x${string}` }[] = []

  const root: any = {
    _query: (_keys: unknown, callback: () => unknown) => callback(),
    _protocolAddresses: sinon
      .stub()
      .callsFake(async (centrifugeId: number) =>
        centrifugeId === rampCentrifugeId ? { hub, hubRegistry, ...spokeContext } : { hub, hubRegistry }
      ),
    getClient: sinon.stub().resolves(client),
    _estimate: sinon.stub().resolves(0n),
    _idToChain: sinon.stub().callsFake(async (centrifugeId: number) => centrifugeId),
    _registerAsset: registerAsset,
    // Mirrors Centrifuge._transact: the callback returns an async generator or an observable.
    _transact: (callback: (ctx: any) => AsyncGenerator<unknown> | Observable<unknown>, centrifugeId: number) => {
      const tx = new Observable<unknown>((subscriber) => {
        const walletClient = {
          getChainId: async () => centrifugeId,
          sendTransaction: async ({ data }: { data: `0x${string}` }) => {
            sent.push({ centrifugeId, data })
            return '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
          },
        }
        const publicClient = {
          getCode: async () => '0x',
          waitForTransactionReceipt: async () => ({ status: 'success', logs: [] }),
        }
        const ctx =
          mode === 'build'
            ? { isBatching: true, isBuilding: true, signingAddress, centrifugeId, root }
            : { isBatching: false, signingAddress, centrifugeId, root, walletClient, publicClient }
        const result = callback(ctx)
        if (isObservable(result)) return result.subscribe(subscriber)
        ;(async () => {
          try {
            for await (const item of result) subscriber.next(item)
            subscriber.complete()
          } catch (error) {
            subscriber.error(error)
          }
        })()
        return undefined
      })
      return Object.assign(tx, { centrifugeId })
    },
  }

  const pool = new Pool(root, poolId.raw)
  const network = new PoolNetwork(root, pool, rampCentrifugeId)
  const shareClass = new ShareClass(root, pool, scId)
  const manager = new OnOffRampManager(root, network, shareClass, ramp)

  const updateContractCall = (payload: `0x${string}`) =>
    encodeFunctionData({
      abi: ABI.Hub,
      functionName: 'updateContract',
      args: [poolId.raw, scId.raw, rampCentrifugeId, addressToBytes32(ramp), payload, 0n, signingAddress],
    })
  const notifyAssetPriceCall = (assetId: AssetId) =>
    encodeFunctionData({
      abi: ABI.Hub,
      functionName: 'notifyAssetPrice',
      args: [poolId.raw, scId.raw, assetId.raw, signingAddress],
    })
  const pricedMessages = {
    [rampCentrifugeId]: [
      { type: MessageType.TrustedContractUpdate, poolId },
      { type: MessageType.NotifyPricePoolPerAsset, poolId },
    ],
  }

  return {
    manager,
    client,
    registerAsset,
    sent,
    poolId,
    withdrawTokenId,
    depositTokenId,
    updateContractCall,
    notifyAssetPriceCall,
    pricedMessages,
  }
}

async function emitted(tx: unknown) {
  return lastValueFrom((tx as Observable<unknown>).pipe(toArray()))
}

async function rejection(tx: unknown) {
  try {
    await emitted(tx)
  } catch (error) {
    return error as Error
  }
  throw new Error('expected the transaction to fail')
}

function reads(client: ReturnType<typeof createSubject>['client']) {
  return client.readContract.getCalls().map((call) => call.args[0].functionName as string)
}

function multicallOf(data: `0x${string}`) {
  return decodeFunctionData({ abi: ABI.Multicall, data }).args![0] as `0x${string}`[]
}

const offrampPayload = encode([2, usdcAssetId.raw, receiver, true])
const onrampPayload = encode([0, usdcAssetId.raw, true])

describe('OnOffRampManager accounting-token price notification', () => {
  afterEach(() => {
    sinon.restore()
  })

  describe('building (buildOnly, batches)', () => {
    it('appends the price of the withdraw accounting token when enabling a receiver', async () => {
      const s = createSubject()

      const items = await emitted(s.manager.setReceiver(usdcAssetId, receiver))

      expect(items).to.have.length(1)
      const batch = items[0] as Batch
      expect(batch.contract).to.equal(hub)
      expect(batch.data).to.deep.equal([
        s.updateContractCall(offrampPayload),
        s.notifyAssetPriceCall(withdrawAccountingAssetId),
      ])
      expect(batch.messages).to.deep.equal(s.pricedMessages)
    })

    it('appends the price of the deposit (liability) accounting token when enabling an onramp asset', async () => {
      const s = createSubject()

      const [batch] = (await emitted(s.manager.setAsset(usdcAssetId))) as Batch[]

      expect(batch!.data).to.deep.equal([
        s.updateContractCall(onrampPayload),
        s.notifyAssetPriceCall(depositAccountingAssetId),
      ])
      const assetToId = s.client.readContract.getCalls().find((call) => call.args[0].functionName === 'assetToId')
      expect(assetToId!.args[0].args).to.deep.equal([accountingToken, s.depositTokenId])
    })

    for (const method of ['setAsset', 'setReceiver'] as const) {
      it(`${method} rejects an unregistered token before building an update without its price`, async () => {
        const s = createSubject({ registered: new Map() })
        const tx =
          method === 'setAsset' ? s.manager.setAsset(usdcAssetId) : s.manager.setReceiver(usdcAssetId, receiver)

        const error = await rejection(tx)

        expect(error.message).to.contain('Register it with registerAsset before building or batching')
        expect(s.registerAsset.called).to.equal(false)
        expect(s.sent).to.have.length(0)
        expect(reads(s.client)).to.not.include('manager')
      })
    }

    it('disabling a receiver and setRelayer send only the trusted call and read nothing', async () => {
      const s = createSubject()

      const [disable] = (await emitted(s.manager.setReceiver(usdcAssetId, receiver, false))) as Batch[]
      const [relay] = (await emitted(s.manager.setRelayer(relayer))) as Batch[]

      expect(disable!.data).to.deep.equal([s.updateContractCall(encode([2, usdcAssetId.raw, receiver, false]))])
      expect(relay!.data).to.deep.equal([s.updateContractCall(encode([1, relayer, true]))])
      expect(s.client.readContract.called).to.equal(false)
    })

    it('sends no price for a legacy ramp, even on a network that lists onOffRampFactory', async () => {
      const s = createSubject({ rampAccountingToken: revert('accountingToken') })

      const [batch] = (await emitted(s.manager.setAsset(usdcAssetId))) as Batch[]

      expect(batch!.data).to.deep.equal([s.updateContractCall(onrampPayload)])
      expect(reads(s.client)).to.deep.equal(['accountingToken'])
    })

    it('prices a new ramp on a network whose deployments list only the legacy factory', async () => {
      const s = createSubject({ spokeContext: { spoke, onOfframpManagerFactory: factory, accountingToken } })

      const [batch] = (await emitted(s.manager.setReceiver(usdcAssetId, receiver))) as Batch[]

      expect(batch!.data).to.deep.equal([
        s.updateContractCall(offrampPayload),
        s.notifyAssetPriceCall(withdrawAccountingAssetId),
      ])
    })

    it('throws when the ramp deposits a token the deployments do not list', async () => {
      const s = createSubject({ rampAccountingToken: otherAccountingToken })

      const error = await rejection(s.manager.setReceiver(usdcAssetId, receiver))

      expect(error.message).to.contain(`deposits accounting token ${otherAccountingToken}`)
    })

    it('propagates a failed ramp read instead of treating the ramp as legacy', async () => {
      const s = createSubject({ rampAccountingToken: new Error('fetch failed') })

      expect((await rejection(s.manager.setAsset(usdcAssetId))).message).to.equal('fetch failed')
    })

    it('propagates a spoke read failure other than UnknownAsset', async () => {
      const s = createSubject({ assetToIdError: new Error('fetch failed') })

      expect((await rejection(s.manager.setReceiver(usdcAssetId, receiver))).message).to.equal('fetch failed')
    })

    it('throws when the ramp asset itself is not registered on the spoke', async () => {
      for (const spokeVersion of ['v3.2', 'v3.3'] as const) {
        const s = createSubject({ spokeVersion, usdcRegistered: false })

        const error = await rejection(s.manager.setAsset(usdcAssetId))

        expect(error.message).to.contain(`Asset ${usdcAssetId.toString()} is not registered on spoke ${spoke}`)
      }
    })
  })

  describe('v3.3 spoke (lookups through its SpokeRegistry)', () => {
    it('prices a registered token read from the registry', async () => {
      const s = createSubject({ spokeVersion: 'v3.3' })

      const [batch] = (await emitted(s.manager.setReceiver(usdcAssetId, receiver))) as Batch[]

      expect(batch!.data).to.deep.equal([
        s.updateContractCall(offrampPayload),
        s.notifyAssetPriceCall(withdrawAccountingAssetId),
      ])
      const lookups = s.client.readContract
        .getCalls()
        .filter((call) => ['idToAsset', 'assetToId'].includes(call.args[0].functionName))
      expect(lookups.map((call) => call.args[0].address)).to.deep.equal([spokeRegistry, spokeRegistry])
    })

    it('treats a zero id as unregistered and registers before pricing', async () => {
      const s = createSubject({ spokeVersion: 'v3.3', mode: 'sign', registered: new Map() })

      await emitted(s.manager.setReceiver(usdcAssetId, receiver))

      expect(s.registerAsset.calledOnce).to.equal(true)
      expect(multicallOf(s.sent.at(-1)!.data)).to.deep.equal([
        s.updateContractCall(offrampPayload),
        s.notifyAssetPriceCall(withdrawAccountingAssetId),
      ])
    })
  })

  describe('signing', () => {
    it('sends one priced hub transaction when the token is registered', async () => {
      const s = createSubject({ mode: 'sign' })

      await emitted(s.manager.setReceiver(usdcAssetId, receiver))

      expect(s.sent).to.have.length(1)
      expect(s.sent[0]!.centrifugeId).to.equal(hubCentrifugeId)
      expect(multicallOf(s.sent[0]!.data)).to.deep.equal([
        s.updateContractCall(offrampPayload),
        s.notifyAssetPriceCall(withdrawAccountingAssetId),
      ])
      expect(s.registerAsset.called).to.equal(false)
    })

    it('registers an unregistered token on the ramp chain first, then prices the id from its receipt', async () => {
      const s = createSubject({ mode: 'sign', registered: new Map() })

      const items = await emitted(s.manager.setReceiver(usdcAssetId, receiver))

      expect(reads(s.client).filter((name) => name === 'manager')).to.have.length(1)
      expect(s.registerAsset.calledOnce).to.equal(true)
      expect(s.registerAsset.firstCall.args.slice(1)).to.deep.equal([
        rampCentrifugeId,
        hubCentrifugeId,
        accountingToken,
        s.withdrawTokenId,
      ])
      expect((s.registerAsset.firstCall.args[0] as { centrifugeId: number }).centrifugeId).to.equal(rampCentrifugeId)
      expect(items.map((item: any) => item.title)).to.deep.equal([
        'Register asset',
        'Register asset',
        'Enable Receiver',
        'Enable Receiver',
        'Enable Receiver',
      ])
      expect(s.sent).to.have.length(1)
      expect(s.sent[0]!.centrifugeId).to.equal(hubCentrifugeId)
      expect(multicallOf(s.sent[0]!.data)).to.deep.equal([
        s.updateContractCall(offrampPayload),
        s.notifyAssetPriceCall(withdrawAccountingAssetId),
      ])
    })

    it('falls back to the spoke when the receipt carries no matching RegisterAsset event', async () => {
      const s = createSubject({ mode: 'sign', registered: new Map(), emitRegisterEvent: false })

      await emitted(s.manager.setReceiver(usdcAssetId, receiver))

      expect(multicallOf(s.sent.at(-1)!.data)[1]).to.equal(s.notifyAssetPriceCall(withdrawAccountingAssetId))
    })

    it('refuses the hub transaction when neither the receipt nor the spoke reports the registration', async () => {
      const s = createSubject({
        mode: 'sign',
        registered: new Map(),
        emitRegisterEvent: false,
        spokeReportsRegistration: false,
      })

      const error = await rejection(s.manager.setReceiver(usdcAssetId, receiver))

      expect(error.message).to.contain('does not report it')
      expect(s.sent).to.have.length(0)
    })

    it('refuses before registering when the signer is not a hub manager', async () => {
      const s = createSubject({ mode: 'sign', registered: new Map(), isManager: false })

      const error = await rejection(s.manager.setAsset(usdcAssetId))

      expect(error.message).to.contain('is not a hub manager')
      expect(s.registerAsset.called).to.equal(false)
      expect(s.sent).to.have.length(0)
    })

    it('keeps the registered id per subscription when the same transaction runs twice at once', async () => {
      const otherId = AssetId.from(rampCentrifugeId, 8)
      const s = createSubject({
        mode: 'sign',
        registered: new Map(),
        registeredIds: [withdrawAccountingAssetId, otherId],
        spokeReportsRegistration: false,
      })
      const tx = s.manager.setReceiver(usdcAssetId, receiver)

      await Promise.all([emitted(tx), emitted(tx)])

      expect(s.registerAsset.callCount).to.equal(2)
      expect(s.sent.map((sent) => multicallOf(sent.data)[1])).to.have.members([
        s.notifyAssetPriceCall(withdrawAccountingAssetId),
        s.notifyAssetPriceCall(otherId),
      ])
    })
  })

  describe('a pool whose hub is on the ramp chain', () => {
    it('registers and prices on that one chain', async () => {
      const s = createSubject({ hubChain: rampCentrifugeId, mode: 'sign', registered: new Map() })

      await emitted(s.manager.setReceiver(usdcAssetId, receiver))

      expect(s.registerAsset.firstCall.args.slice(1, 3)).to.deep.equal([rampCentrifugeId, rampCentrifugeId])
      expect(s.sent).to.have.length(1)
      expect(s.sent[0]!.centrifugeId).to.equal(rampCentrifugeId)
      expect(multicallOf(s.sent[0]!.data)).to.deep.equal([
        s.updateContractCall(offrampPayload),
        s.notifyAssetPriceCall(withdrawAccountingAssetId),
      ])
    })

    it('builds the priced update with its messages addressed to that chain', async () => {
      const s = createSubject({ hubChain: rampCentrifugeId })

      const [batch] = (await emitted(s.manager.setAsset(usdcAssetId))) as Batch[]

      expect(batch!.data).to.deep.equal([
        s.updateContractCall(onrampPayload),
        s.notifyAssetPriceCall(depositAccountingAssetId),
      ])
      expect(batch!.messages).to.deep.equal(s.pricedMessages)
    })
  })

  it('reports a payload that cannot be encoded through the transaction, not when the method is called', async () => {
    const s = createSubject()

    const tx = s.manager.setReceiver(usdcAssetId, 'x'.repeat(40) as `0x${string}`)

    expect((await rejection(tx)).name).to.equal('SizeOverflowError')
  })

  it('keeps the hub chain as the transaction chain', () => {
    const s = createSubject()

    expect(s.manager.setReceiver(usdcAssetId, receiver).centrifugeId).to.equal(hubCentrifugeId)
    expect(s.manager.setAsset(usdcAssetId).centrifugeId).to.equal(hubCentrifugeId)
  })

  it('matches the token ids AccountingToken registered for HYB USDC on X Layer', () => {
    const hybPoolId = 281474976710671n
    const xLayerUsdc = '0xb6ceceab302e2e4948951ee7843fc24e92933061'

    expect(toAccountingTokenId(hybPoolId, xLayerUsdc, false)).to.equal(
      411376139330324476711579443248626800522567278819732540068409441n
    )
    expect(toAccountingTokenId(hybPoolId, xLayerUsdc, true)).to.equal(
      57896044618658509087924822828820665506078240959620804587007611736496633229409n
    )
  })
})

describe('OnOffRampManager through the real Centrifuge buildOnly and batch paths (HYB on X Layer)', () => {
  const hybPoolId = new PoolId(281474976710671n)
  const hybScId = ShareClassId.from(hybPoolId, 1)
  const xLayerUsdc = '0xb6ceceab302e2e4948951ee7843fc24e92933061'
  const xLayerUsdcAssetId = new AssetId(67499859160952759170896452279861249n)
  const withdrawAssetId = new AssetId(67499859160952759170896452279861254n)
  const xLayerRamp = '0x9999999999999999999999999999999999999999'
  const fromAddress = '0x7bf090b97f896fb77e852cc98aa52a8cb7dc02ec'
  // HYB's mainnet deployments as the indexer reports them.
  const xLayerHub = '0xA4A7Bb3831958463b3FE3E27A6a160F764341953'
  const hubDeployments = { hub: xLayerHub, hubRegistry: '0x19f46D8130e610C6C0f0116EA40Fb781dEFaDE93' }
  const xLayerDeployments = {
    ...hubDeployments,
    spoke: '0xEC3582fcDc34078a4B7a8c75a5a3AE46f48525aB',
    accountingToken: '0x15a5D180A4b8da06268260b7B4f89ee7d239B6c5',
    onOffRampFactory: '0x22E2f679669D69b6b6f22CC9C1731035a3Fa0296',
  }

  afterEach(() => sinon.restore())

  function subject(registered: boolean) {
    const centrifuge = new Centrifuge({ environment: 'mainnet' })
    const client = {
      readContract: sinon.stub().callsFake(async ({ functionName, args }: ReadArgs) => {
        if (functionName === 'accountingToken') return '0x15a5D180A4b8da06268260b7B4f89ee7d239B6c5'
        if (functionName === 'spokeRegistry') throw revert('spokeRegistry')
        if (functionName === 'idToAsset') return [xLayerUsdc, 0n]
        if (functionName === 'assetToId') {
          if (!registered) throw revert('assetToId', 'UnknownAsset')
          expect(args![1]).to.equal(toAccountingTokenId(hybPoolId.raw, xLayerUsdc, false))
          return withdrawAssetId.raw
        }
        throw new Error(`unexpected eth_call ${functionName}`)
      }),
    }
    stubChain(centrifuge, client)
    sinon.stub(centrifuge as any, '_estimate').callsFake(() => makeThenable(of(0n)))
    sinon
      .stub(centrifuge as any, '_protocolAddresses')
      .callsFake((centrifugeId: any) =>
        makeThenable(of(centrifugeId === rampCentrifugeId ? xLayerDeployments : hubDeployments))
      )
    const pool = new Pool(centrifuge, hybPoolId.raw)
    const network = new PoolNetwork(centrifuge, pool, rampCentrifugeId)
    const manager = new OnOffRampManager(centrifuge, network, new ShareClass(centrifuge, pool, hybScId), xLayerRamp)
    return { centrifuge, manager }
  }

  function hybUpdateContract(payload: `0x${string}`) {
    return encodeFunctionData({
      abi: ABI.Hub,
      functionName: 'updateContract',
      args: [hybPoolId.raw, hybScId.raw, rampCentrifugeId, addressToBytes32(xLayerRamp), payload, 0n, fromAddress],
    })
  }

  const hybOfframpPayload = encode([2, xLayerUsdcAssetId.raw, receiver, true])

  it('buildOnly returns the priced multicall to the hub', async () => {
    const { centrifuge, manager } = subject(true)

    const built = await centrifuge.buildOnly(manager.setReceiver(xLayerUsdcAssetId, receiver), { fromAddress })

    expect(built.to).to.equal(xLayerHub)
    expect(built.calls.map((call) => call.data)).to.deep.equal([
      hybUpdateContract(hybOfframpPayload),
      encodeFunctionData({
        abi: ABI.Hub,
        functionName: 'notifyAssetPrice',
        args: [hybPoolId.raw, hybScId.raw, withdrawAssetId.raw, fromAddress],
      }),
    ])
    expect(built.messages![rampCentrifugeId]!.map((message) => (message as { type: MessageType }).type)).to.deep.equal([
      MessageType.TrustedContractUpdate,
      MessageType.NotifyPricePoolPerAsset,
    ])
  })

  for (const batch of [false, true]) {
    it(`rejects an unregistered accounting token in ${batch ? 'a batch' : 'buildOnly'}`, async () => {
      const { centrifuge, manager } = subject(false)
      centrifuge.setSigner(privateKeyToAccount(`0x${'ab'.repeat(32)}`))
      const tx = manager.setReceiver(xLayerUsdcAssetId, receiver)

      const error = await centrifuge
        .buildOnly(batch ? centrifuge.batchTransactions('Configure ramp', [manager.setRelayer(relayer), tx]) : tx, {
          fromAddress,
        })
        .then(
          () => undefined,
          (error: Error) => error
        )

      expect(error).to.be.instanceOf(Error)
      expect(error!.message).to.contain('Register it with registerAsset before building or batching')
    })
  }

  it('a batch with setRelayer carries the trusted calls and the price in one multicall', async () => {
    const { centrifuge, manager } = subject(true)
    centrifuge.setSigner(privateKeyToAccount(`0x${'ab'.repeat(32)}`))

    const built = await centrifuge.buildOnly(
      centrifuge.batchTransactions('Configure ramp', [
        manager.setRelayer(relayer),
        manager.setReceiver(xLayerUsdcAssetId, receiver),
      ]),
      { fromAddress }
    )

    expect(built.calls.map((call) => decodeFunctionData({ abi: ABI.Hub, data: call.data }).functionName)).to.deep.equal(
      ['updateContract', 'updateContract', 'notifyAssetPrice']
    )
  })
})
