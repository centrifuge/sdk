import { expect } from 'chai'
import { combineLatest, defer, firstValueFrom, interval, map, of, Subject, take, tap, toArray } from 'rxjs'
import sinon from 'sinon'
import { createClient, custom } from 'viem'
import { Centrifuge } from './Centrifuge.js'
import { currencies } from './config/protocol.js'
import { context } from './tests/setup.js'
import { Balance } from './utils/BigInt.js'
import { doSignMessage, doTransaction } from './utils/transaction.js'
import { AssetId, PoolId } from './utils/types.js'

const chainId = 11155111
const poolId = PoolId.from(1, 1)
const assetId = AssetId.from(1, 1)
const asset = currencies[chainId]![0]!

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
    const client = context.centrifuge.getClient(chainId)
    expect(client?.chain.id).to.equal(chainId)
    const chains = context.centrifuge.chains
    expect(chains).to.include(chainId)
  })

  it('should fetch protocol addresses for the demo chain (sepolia)', async () => {
    const expectedContractKeys = [
      'root',
      'adminSafe',
      'guardian',
      'gasService',
      'gateway',
      'messageProcessor',
      'messageDispatcher',
      'hubRegistry',
      'accounting',
      'holdings',
      'shareClassManager',
      'hub',
      'identityValuation',
      'poolEscrowFactory',
      'routerEscrow',
      'globalEscrow',
      'freezeOnlyHook',
      'redemptionRestrictionsHook',
      'fullRestrictionsHook',
      'tokenFactory',
      'asyncRequestManager',
      'syncRequestManager',
      'asyncVaultFactory',
      'syncDepositVaultFactory',
      'poolManager',
      'vaultRouter',
      'currencies',
    ]

    const centrifuge = new Centrifuge({ environment: 'demo' })
    const chainId = centrifuge.config.defaultChain

    const result = await centrifuge._protocolAddresses(chainId)

    expect(result).to.be.an('object')
    expect(Object.keys(result)).to.be.eql(expectedContractKeys)
    expect(result.currencies).to.be.an('array')
  })

  describe('Queries', () => {
    it('should fetch a pool by id', async () => {
      const pool = await context.centrifuge.pool(poolId)
      expect(pool).to.exist
    })

    it('should fetch a currency', async () => {
      const currency = await context.centrifuge.currency(asset, chainId)
      expect(currency.decimals).to.equal(6)
      expect(currency.symbol).to.equal('USDC')
      expect(currency.name).to.equal('USD Coin')
      expect(currency.chainId).to.equal(chainId)
      expect(currency.address.toLowerCase()).to.equal(asset.toLowerCase())
      expect(currency.supportsPermit).to.be.true
    })

    it('should fetch the asset decimals', async () => {
      const decimals = await context.centrifuge.assetDecimals(assetId, 11155111)
      expect(decimals).to.equal(6)
    })

    it('should estimate the gas for a bridge transaction', async () => {
      const estimate = await context.centrifuge._estimate(chainId, { chainId })
      expect(typeof estimate).to.equal('bigint')

      const estimate2 = await context.centrifuge._estimate(chainId, { centId: 2 })
      expect(typeof estimate2).to.equal('bigint')
    })

    it('should fetch the value of an asset in relation to another one', async () => {
      const quote = await context.centrifuge._getQuote(
        (await context.centrifuge._protocolAddresses(chainId)).identityValuation,
        Balance.fromFloat(100, 6),
        assetId,
        AssetId.fromIso(840),
        chainId
      )
      expect(quote).to.instanceOf(Balance)
      expect(quote.decimals).to.equal(18)
      expect(quote.toFloat()).to.equal(100)
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
      const value3 = await firstValueFrom(query1)
      expect(subscribedTimes).to.equal(1)
      expect(value1).to.equal(1)
      expect(value2).to.equal(1)
      expect(value3).to.equal(1)
    })

    it("should't cache the value when no keys are passed", async () => {
      let value = 0
      const query = context.centrifuge._query(null, () => defer(() => lazy(++value)))
      const value1 = await query
      const value2 = await query
      expect(value1).to.equal(1)
      expect(value2).to.equal(2)
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

    it('should invalidate the cache when a finite observable completes, when given a `valueCacheTime`', async () => {
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
      const centrifuge = new Centrifuge({ environment: 'demo', cache: false })
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

    it('should push new data for new subscribers to old subscribers', async () => {
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

    it('should update dependant queries with values from dependencies', async () => {
      let i = 0
      const query1 = context.centrifuge._query([Math.random()], () => of(++i), { valueCacheTime: 120 })
      const query2 = context.centrifuge._query([Math.random()], () => query1.pipe(map((v1) => v1 * 10)))
      const value1 = await query2
      clock.tick(150_000)
      const value3 = await query2
      expect(value1).to.equal(10)
      expect(value3).to.equal(20)
    })

    it('should recreate the shared observable when the cached value is expired', async () => {
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
      const centrifuge = new Centrifuge({ environment: 'demo' })
      const tUSD = '0x8503b4452Bf6238cC76CdbEE223b46d7196b1c93'
      const user = '0x423420Ae467df6e90291fd0252c0A8a637C1e03f'
      await centrifuge.balance(tUSD, user, chainId)
      // One call to get the metadata, one to get the balance, and one to poll events
      expect(fetchSpy.getCalls().length).to.equal(3)
    })
  })

  describe('Transact', () => {
    it('should throw when no account is selected', async () => {
      const cent = new Centrifuge({
        environment: 'demo',
      })
      cent.setSigner(mockProvider({ accounts: [] }))
      const tx = cent._transact('Test', async () => '0x1' as const, chainId)
      let error
      try {
        await firstValueFrom(tx)
      } catch (e) {
        error = e
      }
      expect(error).to.instanceOf(Error)
    })

    it('should try to switch chains when the signer is connected to a different one', async () => {
      const cent = new Centrifuge({
        environment: 'demo',
      })
      const signer = mockProvider({ chainId: 1 })
      const spy = sinon.spy(signer, 'request')
      cent.setSigner(signer)
      const tx = cent._transact('Test', async () => '0x1' as const, chainId)
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
        environment: 'demo',
      })
      cent.setSigner(mockProvider())

      const tx = cent._transact('Test', async () => '0x1' as const, chainId)
      const status: any = await firstValueFrom(tx)
      expect(status.type).to.equal('SigningTransaction')
      expect(status.title).to.equal('Test')
    })

    it('should emit status updates', async () => {
      const cent = new Centrifuge({
        environment: 'demo',
      })
      cent.setSigner(mockProvider())
      const publicClient: any = createClient({ transport: custom(mockProvider()) }).extend(() => ({
        waitForTransactionReceipt: async () => ({}),
      }))
      const tx = cent._transactSequence(() => doTransaction('Test', publicClient, async () => '0x1'), chainId)
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
        environment: 'demo',
      })
      cent.setSigner(mockProvider())
      const publicClient: any = createClient({ transport: custom(mockProvider()) }).extend(() => ({
        waitForTransactionReceipt: async () => ({}),
      }))
      const tx = cent._transactSequence(async function* () {
        yield* doSignMessage('Sign Permit', async () => '0x1')
        yield* doTransaction('Test', publicClient, async () => '0x2')
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
