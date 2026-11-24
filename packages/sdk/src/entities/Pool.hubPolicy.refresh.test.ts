import { ABIS_V3_3 } from '@centrifuge/protocol'
import type { HubPolicyRow, PoolAuthorizationEventRow } from '@centrifuge/queries/core'
import { expect } from 'chai'
import { of } from 'rxjs'
import sinon from 'sinon'
import { encodeFunctionData, keccak256, toHex } from 'viem'
import { Centrifuge } from '../Centrifuge.js'
import { stubChain } from '../tests/utils.js'
import { PoolId } from '../utils/types.js'
import { Pool } from './Pool.js'

// `pool.refreshHubPolicyReads()` clears the cached results of the two reads and of their two indexer queries, and makes
// the subscriptions that are already running fetch again. Clearing the cache alone does not.

const HUB_CHAIN = 2
const poolId = PoolId.from(HUB_CHAIN, 33)
const otherPoolId = PoolId.from(HUB_CHAIN, 34)
const v32PoolId = PoolId.from(HUB_CHAIN, 32)
const POLICY = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const MANAGER = '0x3333333333333333333333333333333333333333'
const INSTALL_TX = keccak256(toHex('install'))

const eventRow = (id: PoolId, overrides: Partial<PoolAuthorizationEventRow>): PoolAuthorizationEventRow => ({
  centrifugeId: String(HUB_CHAIN),
  poolId: id.toString(),
  eventKind: 'HUB_REGISTRY_SET_POLICY',
  sourceAddress: '0x1111111111111111111111111111111111111111',
  targetCentrifugeId: null,
  policy: POLICY,
  caller: null,
  authId: null,
  calldata: null,
  validAfter: null,
  createdAt: '2026-11-01T10:00:00.000000+00:00',
  createdAtBlock: 10,
  createdAtTxHash: INSTALL_TX,
  createdAtLogIndex: 0,
  ...overrides,
})

const parameterRow = (id: PoolId, expiry: string): HubPolicyRow => ({
  centrifugeId: String(HUB_CHAIN),
  poolId: id.toString(),
  policy: POLICY,
  delay: '100',
  expiry,
  escalation: '200',
  maxAbsolutePriceDelta: null,
  thresholdPerSecond: null,
  maxBrmPriceDeviation: null,
  isRestrictionUpdateInstant: null,
  onchainAccounting: null,
  createdAt: '2026-11-01T10:00:00.000000+00:00',
  createdAtBlock: 10,
  createdAtTxHash: INSTALL_TX,
  createdAtLogIndex: 0,
})

const scheduledRow = (id: PoolId): PoolAuthorizationEventRow =>
  eventRow(id, {
    eventKind: 'HUB_REGISTRY_AUTHORIZATION_SCHEDULED',
    policy: null,
    caller: MANAGER,
    authId: keccak256(toHex('auth')),
    calldata: encodeFunctionData({
      abi: ABIS_V3_3.Hub,
      functionName: 'updateHubManager',
      args: [id.raw, MANAGER, true],
    }),
    validAfter: '1000',
    createdAtBlock: 20,
    createdAtTxHash: keccak256(toHex('scheduled')),
  })

/** An indexer whose answer the test changes between reads, and a record of every query it was asked. */
function setup() {
  const queries: { name: string; poolId: string }[] = []
  const index = new Map<string, { events: PoolAuthorizationEventRow[]; expiry: string }>()
  for (const id of [poolId, otherPoolId, v32PoolId]) {
    index.set(id.toString(), { events: [eventRow(id, {})], expiry: '500' })
  }
  const centrifuge = new Centrifuge({
    environment: 'testnet',
    dataSource: {
      query: (name: string, vars: { poolId: string }) => {
        queries.push({ name, poolId: vars.poolId })
        const answer = index.get(vars.poolId)!
        const id = new PoolId(vars.poolId)
        return of(name === 'poolAuthorizationEvents' ? answer.events : [parameterRow(id, answer.expiry)])
      },
    } as any,
  })
  sinon.stub(centrifuge as any, '_poolRows').returns(
    of([
      { id: poolId.toString(), protocolVersion: '3.3', migrationStatus: 'live' },
      { id: otherPoolId.toString(), protocolVersion: '3.3', migrationStatus: 'live' },
      { id: v32PoolId.toString(), protocolVersion: '3.2', migrationStatus: 'live' },
    ])
  )
  stubChain(centrifuge, { getBlock: sinon.stub().resolves({ number: 1n, timestamp: 0n }) })
  return { centrifuge, queries, index }
}

/** Records what a subscription emits, and waits for an emission the test expects. */
function listen<T>(read: { subscribe(next: (value: T) => void): { unsubscribe(): void } }) {
  const values: T[] = []
  const subscription = read.subscribe((value) => values.push(value))
  const until = async (count: number) => {
    for (let waited = 0; values.length < count && waited < 1_000; waited += 5) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
  return { values, until, stop: () => subscription.unsubscribe() }
}

describe('pool.refreshHubPolicyReads', () => {
  afterEach(() => sinon.restore())

  it('makes a running pool.authorizations() subscription fetch again and emit the new rows', async () => {
    const { centrifuge, queries, index } = setup()
    const pool = new Pool(centrifuge, poolId)
    const live = listen(pool.authorizations())
    await live.until(1)

    index.get(poolId.toString())!.events.push(scheduledRow(poolId))
    pool.refreshHubPolicyReads()
    await live.until(2)
    live.stop()

    expect(live.values.map((list) => list.items.length)).to.deep.equal([0, 1])
    expect(queries.map((query) => query.name).sort()).to.deep.equal([
      'hubPolicies',
      'hubPolicies',
      'poolAuthorizationEvents',
      'poolAuthorizationEvents',
    ])
  })

  it('makes a running pool.hubExecutionPolicy() subscription fetch again and emit the new parameters', async () => {
    const { centrifuge, index } = setup()
    const pool = new Pool(centrifuge, poolId)
    const live = listen(pool.hubExecutionPolicy())
    await live.until(1)

    index.get(poolId.toString())!.expiry = '900'
    pool.refreshHubPolicyReads()
    await live.until(2)
    live.stop()

    expect(live.values.map((policy) => policy?.expiry)).to.deep.equal([500n, 900n])
  })

  it('does not refresh a running subscription when the cache is cleared without it', async () => {
    const { centrifuge, queries } = setup()
    const pool = new Pool(centrifuge, poolId)
    const live = listen(pool.authorizations())
    await live.until(1)

    for (const keys of [
      ['pool', poolId.toString(), 'authorizations'],
      ['poolAuthorizationEvents', { poolId: poolId.toString() }],
      ['hubPolicies', { poolId: poolId.toString() }],
    ]) {
      centrifuge.clearQueryCache(keys)
    }
    await new Promise((resolve) => setTimeout(resolve, 30))
    live.stop()

    expect(live.values).to.have.length(1)
    expect(queries).to.have.length(2)
  })

  it('clears the two indexer queries before the reads cached on top of them, and nothing else', () => {
    const { centrifuge } = setup()
    const signals: unknown[] = []
    centrifuge.queryInvalidations$.subscribe((signal) => signals.push(signal.keys))
    const id = poolId.toString()

    new Pool(centrifuge, poolId).refreshHubPolicyReads()

    expect(signals).to.deep.equal([
      ['poolAuthorizationEvents', { poolId: id }],
      ['hubPolicies', { poolId: id }],
      ['pool', id, 'authorizations'],
      ['pool', id, 'hubExecutionPolicy'],
    ])
  })

  it('refreshes the pool it is called on and no other pool', async () => {
    const { centrifuge, queries } = setup()
    const pool = new Pool(centrifuge, poolId)
    const other = listen(new Pool(centrifuge, otherPoolId).authorizations())
    const live = listen(pool.authorizations())
    await Promise.all([other.until(1), live.until(1)])

    pool.refreshHubPolicyReads()
    await live.until(2)
    live.stop()
    other.stop()

    expect(other.values).to.have.length(1)
    expect(queries.filter((query) => query.poolId === otherPoolId.toString())).to.have.length(2)
    expect(queries.filter((query) => query.poolId === poolId.toString())).to.have.length(4)
  })

  it('serves a read made after it from the fetched rows, with no further fetch', async () => {
    const { centrifuge, queries, index } = setup()
    const pool = new Pool(centrifuge, poolId)
    const live = listen(pool.authorizations())
    await live.until(1)

    index.get(poolId.toString())!.events.push(scheduledRow(poolId))
    pool.refreshHubPolicyReads()
    await live.until(2)
    const afterRefresh = queries.length
    const next = await new Promise<number>((resolve) => {
      const reread = pool.authorizations().subscribe((list) => {
        resolve(list.items.length)
        reread.unsubscribe()
      })
    })
    live.stop()

    expect(next).to.equal(1)
    expect(queries).to.have.length(afterRefresh)
  })

  it('answers a v3.2 pool with no query', async () => {
    const { centrifuge, queries } = setup()
    const pool = new Pool(centrifuge, v32PoolId)
    const live = listen(pool.authorizations())
    await live.until(1)

    pool.refreshHubPolicyReads()
    await live.until(2)
    live.stop()

    expect(live.values.map((list) => list.items.length)).to.deep.equal([0, 0])
    expect(queries).to.deep.equal([])
  })
})
