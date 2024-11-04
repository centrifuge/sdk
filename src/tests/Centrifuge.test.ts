import { expect } from 'chai'
import { combineLatest, defer, filter, firstValueFrom, last, Observable, of, Subject, take, tap } from 'rxjs'
import sinon from 'sinon'
import { parseEther } from 'viem'
import type { OperationConfirmedStatus } from '../types/transaction.js'
import { context } from './setup.js'

describe('Centrifuge', () => {
  let clock: sinon.SinonFakeTimers

  beforeEach(() => {
    clock = sinon.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    clock.restore()
  })

  it('should be connected to sepolia', async () => {
    const client = context.centrifuge.getClient()
    expect(client?.chain.id).to.equal(11155111)
    const chains = context.centrifuge.chains
    expect(chains).to.include(11155111)
  })

  it('should fetch a pool by id', async function () {
    const pool = await context.centrifuge.pool('4139607887')
    expect(pool).to.exist
  })

  describe('Queries', () => {
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
      const query1 = context.centrifuge._query(null, () =>
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

    it("should invalidate the cache when there's no subscribers for a while on an infinite observable", async () => {
      const subject = new Subject()
      const query1 = context.centrifuge._query(null, () => subject)
      setTimeout(() => subject.next(1), 10)
      const value1 = await query1
      setTimeout(() => subject.next(2), 10)
      const value2 = await query1
      clock.tick(60_000)
      setTimeout(() => subject.next(3), 10)
      const value3 = await query1
      expect(value1).to.equal(1)
      expect(value2).to.equal(1)
      expect(value3).to.equal(3)
    })

    it('should invalidate the cache after a timeout when a finite observable completes', async () => {
      let value = 0
      const query1 = context.centrifuge._query(null, () => defer(() => lazy(++value)), { valueCacheTime: 1 })
      const value1 = await query1
      const value2 = await query1
      clock.tick(60_000)
      const value3 = await query1
      expect(value1).to.equal(1)
      expect(value2).to.equal(1)
      expect(value3).to.equal(2)
    })

    it("shouldn't cache the latest value when `cache` is `false`", async () => {
      let value = 0
      const query1 = context.centrifuge._query(
        null,
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

    it("shouldn't reset the cache with a longer `observableCacheTime`", async () => {
      let value = 0
      const query1 = context.centrifuge._query(null, () => defer(() => lazy(++value)), {
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
      const query1 = context.centrifuge._query(null, () => defer(() => lazy(++value)), { valueCacheTime: 1 })
      let lastValue: number | null = null
      const subscription = query1.subscribe((next) => {
        console.log('query1 next', next)
        lastValue = next
      })
      await query1
      clock.tick(500_000)

      console.log('gonna await ')
      const value2 = await query1
      console.log('value2', value2)
      expect(value2).to.equal(2)
      expect(lastValue).to.equal(2)
      subscription.unsubscribe()
    })
  })
})

function lazy<T>(value: T) {
  return new Promise<T>((res) => setTimeout(() => res(value), 10))
}
