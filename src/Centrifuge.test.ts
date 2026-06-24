import { expect } from 'chai'
import { combineLatest, defer, firstValueFrom, interval, map, of, Subject, take, tap, toArray } from 'rxjs'
import sinon from 'sinon'
import { createClient, custom } from 'viem'
import { ABI } from './abi/index.js'
import { Centrifuge } from './Centrifuge.js'
import { Pool } from './entities/Pool.js'
import { context } from './tests/setup.js'
import { randomAddress } from './tests/utils.js'
import { ProtocolContracts } from './types/index.js'
import { MessageType } from './types/transaction.js'
import { doSignMessage, doTransaction } from './utils/transaction.js'
import { AssetId, PoolId } from './utils/types.js'

const chainId = 11155111
const centId = 1
const poolId = PoolId.from(1, 1)
const assetId = AssetId.from(1, 1)
const poolManager = '0x423420Ae467df6e90291fd0252c0A8a637C1e03f'

const someErc20 = '0x3aaaa86458d576BafCB1B7eD290434F0696dA65c'

const publicClient: any = createClient({ transport: custom(mockProvider()) }).extend(() => ({
  waitForTransactionReceipt: async () => ({}),
  getCode: async () => undefined,
}))

describe('Centrifuge', () => {
  let clock: sinon.SinonFakeTimers

  beforeEach(() => {
    clock = sinon.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    clock.restore()
    sinon.restore()
  })

  it('should be connected to sepolia', async () => {
    const centId = await context.centrifuge.id(chainId)
    const client = await context.centrifuge.getClient(centId)
    expect(client?.chain.id).to.equal(chainId)
    const chains = context.centrifuge.chains
    expect(chains).to.include(chainId)
  })

  it('should fetch protocol addresses for the demo chain (sepolia)', async () => {
    const expectedContractKeys = [
      'root',
      'gasService',
      'gateway',
      'multiAdapter',
      'messageProcessor',
      'messageDispatcher',
      'hubRegistry',
      'accounting',
      'holdings',
      'shareClassManager',
      'hub',
      'identityValuation',
      'poolEscrowFactory',
      'globalEscrow',
      'freezeOnlyHook',
      'redemptionRestrictionsHook',
      'fullRestrictionsHook',
      'freelyTransferableHook',
      'tokenFactory',
      'asyncRequestManager',
      'syncManager',
      'asyncVaultFactory',
      'syncDepositVaultFactory',
      'spoke',
      'vaultRouter',
      'balanceSheet',
    ] satisfies (keyof ProtocolContracts)[]

    const result = await context.centrifuge._protocolAddresses(centId)

    for (const key of expectedContractKeys) {
      expect(result[key].startsWith('0x'), `Expected key ${key} to be a contract address`).to.be.true
    }
  })

  describe('Queries', () => {
    it('should fetch a pool by id', async () => {
      const pool = await context.centrifuge.pool(poolId)
      expect(pool).to.exist
    })

    it('should fetch a currency', async () => {
      const currency = await context.centrifuge.currency(someErc20, centId)
      expect(currency.decimals).to.equal(6)
      expect(currency.symbol).to.equal('USDC')
      expect(currency.name).to.equal('USD Coin')
      expect(currency.centrifugeId).to.equal(centId)
      expect(currency.address.toLowerCase()).to.equal(someErc20.toLowerCase())
      expect(currency.supportsPermit).to.be.true
    })

    it('should fetch assets', async () => {
      const assets = await context.centrifuge.assets(chainId)
      expect(assets).to.be.an('array')
      expect(assets.length).to.be.greaterThan(0)
      expect(assets[0]!.id.centrifugeId).to.equal(1)
      expect(assets[0]!.name).to.be.a('string')
      expect(assets[0]!.symbol).to.be.a('string')
    })

    it('should fetch the asset decimals', async () => {
      const decimals = await context.centrifuge._assetDecimals(assetId, 11155111)
      expect(decimals).to.equal(6)
    })

    it('should estimate the gas for a bridge transaction', async () => {
      const estimate = await context.centrifuge._estimate(centId, centId, { type: MessageType.NotifyPool, poolId })
      expect(estimate).to.equal(0n)

      const estimate2 = await context.centrifuge._estimate(centId, 2, { type: MessageType.NotifyPool, poolId })
      expect(typeof estimate2).to.equal('bigint')
    })

    it('should validate maxBatchGasLimit before estimating bridge fee', async () => {
      const centrifuge = new Centrifuge({ environment: 'testnet' })
      const readContract = sinon.stub()
      const gasService = randomAddress()
      const multiAdapter = randomAddress()

      readContract.withArgs(sinon.match({ functionName: 'messageOverallGasLimit' })).resolves(120n)
      readContract.withArgs(sinon.match({ functionName: 'maxBatchGasLimit' })).resolves(300n)
      readContract.withArgs(sinon.match({ functionName: 'estimate' })).resolves(777n)

      sinon.stub(centrifuge as any, '_protocolAddresses').returns(
        of({
          gasService,
          multiAdapter,
        } as any)
      )
      sinon.stub(centrifuge as any, 'getClient').returns(
        of({
          readContract,
        } as any)
      )

      const estimate = await centrifuge._estimate(1, 2, [
        { type: MessageType.NotifyPool, poolId },
        { type: MessageType.NotifyShareClass, poolId },
      ])
      expect(estimate).to.equal(1165n)
      expect(
        readContract.calledWithMatch({
          functionName: 'estimate',
          args: sinon.match((args: unknown) => {
            return Array.isArray(args) && args[0] === 2 && typeof args[1] === 'string' && args[2] === 240n
          }),
        })
      ).to.equal(true)
    })

    it('should throw when estimated batch gas exceeds maxBatchGasLimit', async () => {
      const centrifuge = new Centrifuge({ environment: 'testnet' })
      const readContract = sinon.stub()

      readContract.withArgs(sinon.match({ functionName: 'messageOverallGasLimit' })).resolves(200n)
      readContract.withArgs(sinon.match({ functionName: 'maxBatchGasLimit' })).resolves(300n)

      sinon.stub(centrifuge as any, '_protocolAddresses').returns(
        of({
          gasService: randomAddress(),
          multiAdapter: randomAddress(),
        } as any)
      )
      sinon.stub(centrifuge as any, 'getClient').returns(
        of({
          readContract,
        } as any)
      )

      try {
        await centrifuge._estimate(1, 2, [
          { type: MessageType.NotifyPool, poolId },
          { type: MessageType.NotifyShareClass, poolId },
        ])
        expect.fail('Expected _estimate to throw when maxBatchGasLimit is exceeded')
      } catch (error) {
        expect((error as Error).message).to.equal('Batch gas 400 exceeds limit 300 for chain 2')
      }
    })
  })

  describe('Cross-chain adapters and messages', () => {
    const adapterA = '0xAAaa0000000000000000000000000000000000aa'
    const adapterB = '0xBBbb0000000000000000000000000000000000bb'

    function stubMultiAdapter(centrifuge: Centrifuge, quorum: number, threshold: number, adapters: string[]) {
      const readContract = sinon.stub().callsFake(async ({ functionName, args }: any) => {
        if (functionName === 'quorum') return quorum
        if (functionName === 'threshold') return threshold
        if (functionName === 'adapters') return adapters[Number(args[2])]
        throw new Error(`unexpected functionName: ${functionName}`)
      })
      sinon.stub(centrifuge as any, '_protocolAddresses').returns(of({ multiAdapter: randomAddress() } as any))
      sinon.stub(centrifuge as any, 'getClient').returns(of({ readContract } as any))
    }

    it('globalAdapters reads the MultiAdapter pool-0 slot and returns adapters + threshold', async () => {
      const centrifuge = new Centrifuge({ environment: 'testnet' })
      stubMultiAdapter(centrifuge, 2, 1, [adapterA, adapterB])

      const result = await centrifuge.globalAdapters(1, 2)
      expect(result.adapters).to.deep.equal([adapterA.toLowerCase(), adapterB.toLowerCase()])
      expect(result.threshold).to.equal(1)
    })

    it('pool.adapters reads the MultiAdapter pool-specific slot via the same path', async () => {
      const centrifuge = new Centrifuge({ environment: 'testnet' })
      stubMultiAdapter(centrifuge, 1, 1, [adapterA])
      const pool = new Pool(centrifuge, poolId.raw)

      const result = await pool.adapters(2)
      expect(result.adapters).to.deep.equal([adapterA.toLowerCase()])
      expect(result.threshold).to.equal(1)
    })

    function basePayload(overrides: Partial<Record<string, unknown>> = {}) {
      return {
        id: '0xabc',
        index: 0,
        fromCentrifugeId: '1',
        toCentrifugeId: '2',
        poolId: poolId.raw.toString(),
        tokenId: null,
        status: 'InTransit',
        rawData: null,
        gasLimit: '246355',
        gasPrice: '1200014',
        createdAt: '1773411360000',
        deliveredAt: null,
        completedAt: null,
        preparedAtTxHash: '0xprepared',
        deliveredAtTxHash: null,
        ...overrides,
      }
    }

    const samplePageInfo = { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null }

    it('pool.crosschainMessages maps payloads, returns pageInfo, and applies status + cursor filter', async () => {
      const centrifuge = new Centrifuge({ environment: 'testnet' })
      const queryIndexer = sinon.stub(centrifuge as any, '_queryIndexer').returns(
        of({
          crosschainPayloads: {
            totalCount: 2,
            pageInfo: { hasNextPage: true, hasPreviousPage: false, startCursor: 'a', endCursor: 'b' },
            items: [
              basePayload(),
              basePayload({
                id: '0xdef',
                index: 1,
                toCentrifugeId: '3',
                tokenId: '0xtoken',
                status: 'Completed',
                gasLimit: null,
                gasPrice: null,
                deliveredAt: '1773411400000',
                completedAt: '1773411500000',
              }),
            ],
          },
        })
      )
      const pool = new Pool(centrifuge, poolId.raw)

      const result = await pool.crosschainMessages({
        status: ['InTransit', 'Underpaid'],
        fromCentrifugeId: 1,
        after: 'cursor-x',
        limit: 10,
      })
      expect(result.totalCount).to.equal(2)
      expect(result.pageInfo).to.deep.equal({
        hasNextPage: true,
        hasPreviousPage: false,
        startCursor: 'a',
        endCursor: 'b',
      })
      expect(result.items).to.have.length(2)
      expect(result.items[0]!.fromCentrifugeId).to.equal(1)
      expect(result.items[0]!.toCentrifugeId).to.equal(2)
      expect(result.items[0]!.gasLimit).to.equal(246355n)
      expect(result.items[0]!.createdAt).to.be.instanceOf(Date)
      expect(result.items[0]!.deliveredAt).to.equal(undefined)
      // Joins not requested -> undefined.
      expect(result.items[0]!.pool).to.equal(undefined)
      expect(result.items[0]!.innerMessages).to.equal(undefined)
      expect(result.items[1]!.gasLimit).to.equal(undefined)
      expect(result.items[1]!.deliveredAt).to.be.instanceOf(Date)

      const [, vars] = queryIndexer.firstCall.args as [string, Record<string, unknown>]
      expect(vars.filter).to.deep.equal({
        poolId: poolId.raw.toString(),
        fromCentrifugeId: '1',
        status_in: ['InTransit', 'Underpaid'],
      })
      expect(vars.limit).to.equal(10)
      expect(vars.after).to.equal('cursor-x')
    })

    it('pool.crosschainMessages requests joined fields and maps them when `include` is set', async () => {
      const centrifuge = new Centrifuge({ environment: 'testnet' })
      const queryIndexer = sinon.stub(centrifuge as any, '_queryIndexer').returns(
        of({
          crosschainPayloads: {
            totalCount: 1,
            pageInfo: samplePageInfo,
            items: [
              basePayload({
                pool: { id: poolId.raw.toString(), name: 'Foo Pool' },
                token: { name: 'Foo Share', symbol: 'FOO' },
                fromBlockchain: { id: '11155111', centrifugeId: '1', network: 'sepolia' },
                toBlockchain: { id: '84532', centrifugeId: '2', network: 'base-sepolia' },
                crosschainMessages: {
                  items: [
                    {
                      id: '0xmsg',
                      index: 0,
                      poolId: poolId.raw.toString(),
                      tokenId: null,
                      payloadId: '0xabc',
                      payloadIndex: 0,
                      fromCentrifugeId: '1',
                      toCentrifugeId: '2',
                      messageType: 'NotifyPool',
                      status: 'AwaitingBatchDelivery',
                      rawData: '0xdeadbeef',
                      data: { foo: 1 },
                      failReason: null,
                      createdAt: '1773411360000',
                      executedAt: null,
                      executedAtTxHash: null,
                    },
                  ],
                },
                adapterParticipations: {
                  items: [
                    {
                      centrifugeId: '1',
                      fromCentrifugeId: '1',
                      toCentrifugeId: '2',
                      type: 'PAYLOAD',
                      side: 'SEND',
                      gasPaid: '123',
                      timestamp: '1773411360000',
                      transactionHash: '0xtx',
                      adapter: { address: '0xadapter', name: 'Axelar', centrifugeId: '1' },
                    },
                  ],
                },
              }),
            ],
          },
        })
      )
      const pool = new Pool(centrifuge, poolId.raw)

      const result = await pool.crosschainMessages({
        include: { pool: true, token: true, blockchains: true, innerMessages: true, adapterParticipations: true },
      })
      const m = result.items[0]!
      expect(m.pool).to.deep.equal({ id: poolId.raw.toString(), name: 'Foo Pool' })
      expect(m.token).to.deep.equal({ name: 'Foo Share', symbol: 'FOO' })
      expect(m.fromBlockchain).to.deep.equal({ id: '11155111', centrifugeId: 1, network: 'sepolia' })
      expect(m.toBlockchain?.network).to.equal('base-sepolia')
      expect(m.innerMessages).to.have.length(1)
      expect(m.innerMessages![0]!.messageType).to.equal('NotifyPool')
      expect(m.innerMessages![0]!.data).to.deep.equal({ foo: 1 })
      expect(m.adapterParticipations).to.have.length(1)
      expect(m.adapterParticipations![0]!.gasPaid).to.equal(123n)
      expect(m.adapterParticipations![0]!.adapter?.name).to.equal('Axelar')

      // The selection must include all join fragments.
      const [query] = queryIndexer.firstCall.args as [string]
      expect(query).to.match(/pool \{ id name \}/)
      expect(query).to.match(/crosschainMessages \{/)
      expect(query).to.match(/adapterParticipations\(orderBy/)
    })

    it('centrifuge.crosschainMessages encodes `preparedAtTxHash` filter and is not pool-scoped', async () => {
      const centrifuge = new Centrifuge({ environment: 'testnet' })
      const queryIndexer = sinon.stub(centrifuge as any, '_queryIndexer').returns(
        of({ crosschainPayloads: { totalCount: 0, pageInfo: samplePageInfo, items: [] } })
      )

      await centrifuge.crosschainMessages({ preparedAtTxHash: '0xbatchtx' })

      const [, vars] = queryIndexer.firstCall.args as [string, Record<string, unknown>]
      const filter = vars.filter as Record<string, unknown>
      expect(filter).to.deep.equal({ preparedAtTxHash: '0xbatchtx' })
      expect(filter.poolId).to.equal(undefined)
    })

    it('centrifuge.crosschainMessage reads a single payload by (id, index) and defaults to all joins', async () => {
      const centrifuge = new Centrifuge({ environment: 'testnet' })
      const queryIndexer = sinon.stub(centrifuge as any, '_queryIndexer').returns(
        of({
          crosschainPayload: basePayload({
            pool: { id: poolId.raw.toString(), name: 'Foo' },
            token: null,
            fromBlockchain: null,
            toBlockchain: null,
            crosschainMessages: { items: [] },
            adapterParticipations: { items: [] },
          }),
        })
      )

      const message = await centrifuge.crosschainMessage('0xabc' as `0x${string}`, 0)
      expect(message?.id).to.equal('0xabc')
      expect(message?.pool?.name).to.equal('Foo')

      const [query, vars] = queryIndexer.firstCall.args as [string, Record<string, unknown>]
      expect(vars).to.deep.equal({ id: '0xabc', index: 0 })
      // Default include = all joins, so the query selects them.
      expect(query).to.match(/crosschainMessages \{/)
      expect(query).to.match(/adapterParticipations\(orderBy/)
    })

    it('centrifuge.crosschainMessage returns undefined when the indexer has no record', async () => {
      const centrifuge = new Centrifuge({ environment: 'testnet' })
      sinon.stub(centrifuge as any, '_queryIndexer').returns(of({ crosschainPayload: null }))
      const message = await centrifuge.crosschainMessage('0xmissing' as `0x${string}`, 0)
      expect(message).to.equal(undefined)
    })
  })

  describe('Query', () => {
    it('should return the first value when awaited', async () => {
      const value = await context.centrifuge._query(null, () => of(1, 2, 3))
      expect(value).to.equal(1)
    })

    it('should memoize the observable by key', async () => {
      const object1 = {}
      const object2 = {}
      let secondObservableCalled = false
      const query1 = context.centrifuge._query(['key'], () => of(object1))
      const query2 = context.centrifuge._query(['key'], () =>
        of(object2).pipe(tap(() => (secondObservableCalled = true)))
      )
      const value1 = await query1
      const value2 = await query2
      expect(query1).to.equal(query2)
      expect(value1).to.equal(value2)
      expect(value1).to.equal(object1)
      expect(secondObservableCalled).to.equal(false)
    })

    it("should't memoize observables with different keys", async () => {
      const object1 = {}
      const object2 = {}
      const query1 = context.centrifuge._query(['key', 1], () => of(object1))
      const query2 = context.centrifuge._query(['key', 2], () => of(object2))
      const value1 = await query1
      const value2 = await query2
      expect(query1).to.not.equal(query2)
      expect(value1).to.equal(object1)
      expect(value2).to.equal(object2)
    })

    it("should't memoize the observable when no keys are passed", async () => {
      const object1 = {}
      const object2 = {}
      const query1 = context.centrifuge._query(null, () => of(object1))
      const query2 = context.centrifuge._query(null, () => of(object2))
      const value1 = await query1
      const value2 = await query2
      expect(query1).to.not.equal(query2)
      expect(value1).to.equal(object1)
      expect(value2).to.equal(object2)
    })

    it('should cache the latest value by default', async () => {
      let subscribedTimes = 0
      const query1 = context.centrifuge._query([Math.random()], () =>
        defer(() => {
          subscribedTimes++
          return lazy(1)
        })
      )
      const value1 = await query1
      const value2 = await query1
      clock.tick(60_000)
      const value3 = await firstValueFrom(query1)
      expect(subscribedTimes).to.equal(1)
      expect(value1).to.equal(1)
      expect(value2).to.equal(1)
      expect(value3).to.equal(1)
    })

    it("should invalidate the cache when there's no subscribers for a while on an infinite observable", async () => {
      const subject = new Subject()
      const query1 = context.centrifuge._query([Math.random()], () => subject)
      setTimeout(() => subject.next(1), 10)
      const value1 = await query1
      setTimeout(() => subject.next(2), 10)
      const value2 = await query1
      clock.tick(10)
      const value3 = await query1
      clock.tick(60_000)
      setTimeout(() => subject.next(3), 10)
      const value4 = await query1
      expect(value1).to.equal(1)
      expect(value2).to.equal(1)
      expect(value3).to.equal(2)
      expect(value4).to.equal(3)
    })

    // Skipped because `valueCacheTime` is not working and not used atm
    it.skip('should invalidate the cache when a finite observable completes, when given a `valueCacheTime`', async () => {
      let value = 0
      const query1 = context.centrifuge._query([Math.random()], () => defer(() => lazy(++value)), { valueCacheTime: 1 })
      const value1 = await query1
      const value2 = await query1
      clock.tick(1_000)
      const value3 = await query1
      expect(value1).to.equal(1)
      expect(value2).to.equal(1)
      expect(value3).to.equal(2)
    })

    it("shouldn't cache the latest value when `cache` is `false` on the query", async () => {
      let value = 0
      const query1 = context.centrifuge._query(
        [Math.random()],
        () =>
          defer(() => {
            value++
            return lazy(value)
          }),
        { cache: false }
      )
      const value1 = await query1
      const value2 = await query1
      const value3 = await firstValueFrom(query1)
      expect(value1).to.equal(1)
      expect(value2).to.equal(2)
      expect(value3).to.equal(3)
    })

    it("shouldn't cache the latest value when `cache` is `false` on the Centrifuge instance", async () => {
      const centrifuge = new Centrifuge({ environment: 'testnet', cache: false })
      let value = 0
      const query1 = centrifuge._query([Math.random()], () =>
        defer(() => {
          value++
          return lazy(value)
        })
      )
      const value1 = await query1
      const value2 = await query1
      const value3 = await firstValueFrom(query1)
      expect(value1).to.equal(1)
      expect(value2).to.equal(2)
      expect(value3).to.equal(3)
    })

    it("shouldn't reset the cache with a longer `observableCacheTime`", async () => {
      let value = 0
      const query1 = context.centrifuge._query([Math.random()], () => defer(() => lazy(++value)), {
        observableCacheTime: Infinity,
      })
      const value1 = await query1
      clock.tick(1_000_000_000)
      const value2 = await query1
      expect(value1).to.equal(1)
      expect(value2).to.equal(1)
    })

    // Skipped because `valueCacheTime` is not working and not used atm
    it.skip('should push new data for new subscribers to old subscribers', async () => {
      let value = 0
      const query1 = context.centrifuge._query([Math.random()], () => defer(() => lazy(++value)), { valueCacheTime: 1 })
      let lastValue: number | null = null
      const subscription = query1.subscribe((next) => (lastValue = next))
      await query1
      clock.tick(60_000)
      const value2 = await query1
      expect(value2).to.equal(2)
      expect(lastValue).to.equal(2)
      subscription.unsubscribe()
    })

    it('should cache nested queries', async () => {
      const query1 = context.centrifuge._query([Math.random()], () => interval(50).pipe(map((i) => i + 1)))
      const query2 = context.centrifuge._query([Math.random()], () => interval(50).pipe(map((i) => (i + 1) * 2)))
      const query3 = context.centrifuge._query(null, () =>
        combineLatest([query1, query2]).pipe(map(([v1, v2]) => v1 + v2))
      )
      const value1 = await query3
      const value2 = await query3
      clock.tick(50)
      const value3 = await query3
      expect(value1).to.equal(3)
      expect(value2).to.equal(3)
      expect(value3).to.equal(6)
    })

    // Skipped because `valueCacheTime` is not working and not used atm
    it.skip('should update dependant queries with values from dependencies', async () => {
      let i = 0
      const query1 = context.centrifuge._query([Math.random()], () => of(++i), { valueCacheTime: 120 })
      const query2 = context.centrifuge._query([Math.random()], () => query1.pipe(map((v1) => v1 * 10)))
      const value1 = await query2
      clock.tick(150_000)
      const value3 = await query2
      expect(value1).to.equal(10)
      expect(value3).to.equal(20)
    })

    // Skipped because `valueCacheTime` is not working and not used atm
    it.skip('should recreate the shared observable when the cached value is expired', async () => {
      let i = 0
      const query1 = context.centrifuge._query(
        [Math.random()],
        () =>
          defer(async function* () {
            yield await lazy(`${++i}-A`)
            yield await lazy(`${i}-B`, 5000)
          }),
        { valueCacheTime: 1 }
      )
      let lastValue = ''
      const subscription1 = query1.subscribe((next) => (lastValue = next))
      const value1 = await query1
      clock.tick(2_000)
      const value2 = await query1
      expect(value1).to.equal('1-A')
      expect(value2).to.equal('2-A')
      expect(lastValue).to.equal('2-A')
      subscription1.unsubscribe()
    })

    it('should batch calls', async () => {
      const fetchSpy = sinon.spy(globalThis, 'fetch')
      const centrifuge = new Centrifuge({ environment: 'testnet' })
      const tUSD = '0x8503b4452Bf6238cC76CdbEE223b46d7196b1c93'
      const user = '0x423420Ae467df6e90291fd0252c0A8a637C1e03f'
      await centrifuge.balance(tUSD, user, centId)
      // One call to get the metadata, one to get the balance, and one to poll events
      expect(fetchSpy.getCalls().length).to.equal(3)
    })
  })

  describe('Transact', () => {
    it('should throw when no account is selected', async () => {
      const cent = new Centrifuge({
        environment: 'testnet',
      })
      cent.setSigner(mockProvider({ accounts: [] }))

      const tx = cent._transact(async function* (ctx) {
        yield* doTransaction('Test', { ...ctx, publicClient }, async () => '0x1')
      }, centId)
      let error
      try {
        await tx
      } catch (e) {
        error = e
      }
      expect(error).to.instanceOf(Error)
    })

    it('should try to switch chains when the signer is connected to a different one', async () => {
      const cent = new Centrifuge({
        environment: 'testnet',
      })
      const signer = mockProvider({ chainId: 1 })
      const spy = sinon.spy(signer, 'request')
      cent.setSigner(signer)

      const tx = cent._transact(async function* (ctx) {
        yield* doTransaction('Test', { ...ctx, publicClient }, async () => '0x1')
      }, centId)

      const statuses: any = await firstValueFrom(tx.pipe(take(2), toArray()))
      expect(statuses[0]).to.eql({
        type: 'SwitchingChain',
        chainId,
      })
      expect(spy.thirdCall.args[0].method).to.equal('wallet_switchEthereumChain')
      expect(Number(spy.thirdCall.args[0].params[0].chainId)).to.equal(chainId)
    })

    it("shouldn't try to switch chains when the signer is connected to the right chain", async () => {
      const cent = new Centrifuge({
        environment: 'testnet',
      })
      cent.setSigner(mockProvider())

      const tx = cent._transact(async function* (ctx) {
        yield* doTransaction('Test', { ...ctx, publicClient }, async () => '0x1')
      }, chainId)

      const status: any = await firstValueFrom(tx)
      expect(status.type).to.equal('SigningTransaction')
      expect(status.title).to.equal('Test')
    })

    it('should emit status updates', async () => {
      const cent = new Centrifuge({
        environment: 'testnet',
      })
      cent.setSigner(mockProvider())
      const publicClient: any = createClient({ transport: custom(mockProvider()) }).extend(() => ({
        waitForTransactionReceipt: async () => ({}),
        getCode: async () => undefined,
      }))
      const tx = cent._transact((ctx) => doTransaction('Test', { ...ctx, publicClient }, async () => '0x1'), chainId)
      const statuses = await firstValueFrom(tx.pipe(toArray()))
      expect(statuses).to.eql([
        { id: (statuses[0] as any).id, type: 'SigningTransaction', title: 'Test' },
        { id: (statuses[0] as any).id, type: 'TransactionPending', title: 'Test', hash: '0x1' },
        {
          id: (statuses[0] as any).id,
          type: 'TransactionConfirmed',
          title: 'Test',
          hash: '0x1',
          receipt: {},
        },
      ])
    })

    it('should emit status updates for a sequence of transactions', async () => {
      const cent = new Centrifuge({
        environment: 'testnet',
      })
      cent.setSigner(mockProvider())
      const tx = cent._transact(async function* (ctx) {
        yield* doSignMessage('Sign Permit', async () => '0x1')
        yield* doTransaction('Test', { ...ctx, publicClient }, async () => '0x2')
      }, chainId)
      const statuses = await firstValueFrom(tx.pipe(toArray()))
      expect(statuses).to.eql([
        {
          id: (statuses[0] as any).id,
          type: 'SigningMessage',
          title: 'Sign Permit',
        },
        {
          id: (statuses[0] as any).id,
          type: 'SignedMessage',
          signed: '0x1',
          title: 'Sign Permit',
        },
        { id: (statuses[2] as any).id, type: 'SigningTransaction', title: 'Test' },
        { id: (statuses[2] as any).id, type: 'TransactionPending', title: 'Test', hash: '0x2' },
        {
          id: (statuses[2] as any).id,
          type: 'TransactionConfirmed',
          title: 'Test',
          hash: '0x2',
          receipt: {},
        },
      ])
    })
  })

  describe('Batch', () => {
    it('can batch transactions', async () => {
      const { centrifuge } = context
      const pool = new Pool(centrifuge, poolId.raw)

      context.tenderlyFork.impersonateAddress = poolManager
      context.centrifuge.setSigner(context.tenderlyFork.signer)

      const newManager = randomAddress()
      const newManager2 = randomAddress()
      const centId = await context.centrifuge.id(chainId)
      const result = await context.centrifuge._experimental_batch('Test', [
        pool.updatePoolManagers([{ address: newManager, canManage: true }]),
        pool.updateBalanceSheetManagers([{ centrifugeId: centId, address: newManager2, canManage: true }]),
      ])
      expect(result.type).to.equal('TransactionConfirmed')
      expect((result as any).title).to.equal('Test')

      const [{ hubRegistry, balanceSheet }, client] = await Promise.all([
        context.centrifuge._protocolAddresses(centId),
        firstValueFrom(context.centrifuge.getClient(centId)),
      ])

      const isNewManager = await client.readContract({
        address: hubRegistry,
        abi: ABI.HubRegistry,
        functionName: 'manager',
        args: [poolId.raw, newManager],
      })

      const isNewManager2 = await client.readContract({
        address: balanceSheet,
        abi: ABI.BalanceSheet,
        functionName: 'manager',
        args: [poolId.raw, newManager2],
      })
      expect(isNewManager).to.be.true
      expect(isNewManager2).to.be.true
    })
  })

  describe('Transactions', () => {
    it('should repay an underpaid batch using the returned gasLimit and buffered estimate', async () => {
      const centrifuge = new Centrifuge({ environment: 'testnet' })
      const gateway = randomAddress()
      const multiAdapter = randomAddress()
      const signingAddress = randomAddress()
      const batch = '0x1234'
      const readContract = sinon.stub()
      const writeContract = sinon.stub().resolves('0x1')

      readContract.withArgs(sinon.match({ functionName: 'underpaid' })).resolves([1200n, 2n])
      readContract.withArgs(sinon.match({ functionName: 'estimate' })).resolves(100n)

      sinon.stub(centrifuge as any, '_protocolAddresses').resolves({
        gateway,
        multiAdapter,
      })
      sinon.stub(centrifuge as any, 'getClient').resolves({
        readContract,
      })
      sinon.stub(centrifuge as any, '_transact').callsFake((callback: any) =>
        callback({
          signingAddress,
          walletClient: { writeContract },
          publicClient: {
            getCode: sinon.stub().resolves(undefined),
            waitForTransactionReceipt: sinon.stub().resolves({ status: 'success' }),
          },
        })
      )

      expect(
        readContract.calledWithMatch({
          address: multiAdapter,
          functionName: 'estimate',
          args: [2, batch, 1200n],
        })
      ).to.equal(true)
      expect(
        writeContract.calledWithMatch({
          address: gateway,
          functionName: 'repay',
          args: [2, batch, signingAddress],
          value: 155n,
        })
      ).to.equal(true)
    })

    it('should register an asset', async () => {
      const centrifuge = new Centrifuge({
        environment: 'testnet',
        rpcUrls: {
          11155111: context.tenderlyFork.rpcUrl,
        },
      })

      const assetAddress = '0x86eb50b22dd226fe5d1f0753a40e247fd711ad6e'
      context.tenderlyFork.impersonateAddress = poolManager
      centrifuge.setSigner(context.tenderlyFork.signer)

      const result = await centrifuge.registerAsset(centId, centId, assetAddress)
      expect(result.type).to.equal('TransactionConfirmed')
    })

    it('should create a pool', async () => {
      const { opsGuardian } = await context.centrifuge._protocolAddresses(chainId)
      const centrifugeWithPin = new Centrifuge({
        environment: 'testnet',
        pinJson: async () => {
          return 'abc'
        },
        rpcUrls: {
          11155111: context.tenderlyFork.rpcUrl,
        },
      })

      await context.tenderlyFork.fundAccountEth(opsGuardian, 10n ** 18n)

      context.tenderlyFork.impersonateAddress = opsGuardian
      centrifugeWithPin.setSigner(context.tenderlyFork.signer)

      const result = await centrifugeWithPin.createPool(
        {
          assetClass: 'Public credit',
          subAssetClass: 'Test Subclass',
          poolName: 'Test Pool',
          poolIcon: { uri: '', mime: '' },
          investorType: 'Retail',
          poolStructure: 'revolving',
          poolType: 'open',
          issuerName: 'Test Issuer',
          issuerLogo: { uri: '', mime: '' },
          issuerDescription: 'Test Description',
          website: '',
          forum: '',
          email: '',
          executiveSummary: null,
          details: [],
          issuerCategories: [],
          poolRatings: [],
          listed: false,
          onboardingExperience: 'default',
          shareClasses: [
            {
              tokenName: 'Test Token',
              symbolName: 'TST',
              minInvestment: 1000,
              apyPercentage: 5,
              apy: 'target',
              defaultAccounts: {
                asset: 1000,
                equity: 1001,
                gain: 1001,
                loss: 1001,
                expense: 1002,
                liability: 1001,
              },
            },
          ],
        },
        840,
        chainId
      )

      expect(result.type).to.equal('TransactionConfirmed')
    })
  })
})

function lazy<T>(value: T, t = 10) {
  return new Promise<T>((res) => setTimeout(() => res(value), t))
}

function mockProvider({ chainId = 11155111, accounts = ['0x2'] } = {}) {
  return {
    async request({ method }: any) {
      switch (method) {
        case 'eth_accounts':
          return accounts
        case 'eth_chainId':
          return chainId
        case 'wallet_switchEthereumChain':
          return true
      }
      throw new Error(`Unknown method ${method}`)
    },
  }
}
