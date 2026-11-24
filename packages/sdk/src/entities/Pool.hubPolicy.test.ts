import { ABIS_V3_3 } from '@centrifuge/protocol'
import type { HubPolicyRow, PoolAuthorizationEventRow } from '@centrifuge/queries/core'
import { expect } from 'chai'
import { firstValueFrom, of } from 'rxjs'
import sinon from 'sinon'
import { ContractFunctionRevertedError, encodeFunctionData, getAddress, keccak256, toHex } from 'viem'
import { Centrifuge } from '../Centrifuge.js'
import { stubChain } from '../tests/utils.js'
import { AuthorizationFoldError } from '../errors.js'
import { STD_HUB_POLICY_ABI } from '../utils/stdHubPolicy.js'
import { PoolId } from '../utils/types.js'
import { Pool } from './Pool.js'

// The two public-api queries are answered by a fake data source, and the hub chain by a scripted client. The rows are
// the catalogue's own row types, so a column the queries stop returning fails to compile here.

const HUB = '1'
const SPOKE = '2'
const pool33Id = PoolId.from(1, 33)
const pool32Id = PoolId.from(1, 32)
const HUB_2 = '2'
const pool2Id = PoolId.from(2, 33)
const POOL = pool33Id.toString()
const POLICY_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const
const POLICY_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const
const MANAGER = '0x3333333333333333333333333333333333333333' as const
const UINT128_MAX = (2n ** 128n - 1n).toString()
const VALID_AFTER = 1_000n

const txHash = (block: number, logIndex: number) => keccak256(toHex(`tx:${block}:${logIndex}`))
const authId = (label: string) => keccak256(toHex(label))
const calldata = encodeFunctionData({
  abi: ABIS_V3_3.Hub,
  functionName: 'updateHubManager',
  args: [pool33Id.raw, MANAGER, true],
})

type At = { block: number; logIndex: number }

function eventRow(
  eventKind: string,
  at: At,
  overrides: Partial<PoolAuthorizationEventRow> = {}
): PoolAuthorizationEventRow {
  return {
    centrifugeId: HUB,
    poolId: POOL,
    eventKind,
    sourceAddress: '0x1111111111111111111111111111111111111111',
    targetCentrifugeId: null,
    policy: null,
    caller: MANAGER,
    authId: authId('a'),
    calldata: null,
    validAfter: null,
    createdAt: '2026-11-01T10:00:00.000000+00:00',
    createdAtBlock: at.block,
    createdAtTxHash: txHash(at.block, at.logIndex),
    createdAtLogIndex: at.logIndex,
    ...overrides,
  }
}

const install = (at: At, policy: string | null = POLICY_A, overrides: Partial<PoolAuthorizationEventRow> = {}) =>
  eventRow('HUB_REGISTRY_SET_POLICY', at, { policy, caller: null, authId: null, ...overrides })
const scheduled = (at: At, overrides: Partial<PoolAuthorizationEventRow> = {}) =>
  eventRow('HUB_REGISTRY_AUTHORIZATION_SCHEDULED', at, {
    calldata,
    validAfter: VALID_AFTER.toString(),
    ...overrides,
  })

function policyRow(at: At, overrides: Partial<HubPolicyRow> = {}): HubPolicyRow {
  return {
    centrifugeId: HUB,
    poolId: POOL,
    policy: POLICY_A,
    delay: '86400',
    expiry: '604800',
    escalation: '172800',
    maxAbsolutePriceDelta: '50000000000000000',
    thresholdPerSecond: '3000000000000',
    maxBrmPriceDeviation: UINT128_MAX,
    isRestrictionUpdateInstant: true,
    onchainAccounting: false,
    createdAt: '2026-11-01T10:00:00.000000+00:00',
    createdAtBlock: at.block,
    createdAtTxHash: txHash(at.block, at.logIndex),
    createdAtLogIndex: at.logIndex,
    ...overrides,
  }
}

const FIRST: At = { block: 10, logIndex: 0 }
const live = [install(FIRST), scheduled({ block: 20, logIndex: 0 })]

function setup(rows: { events?: PoolAuthorizationEventRow[]; parameters?: HubPolicyRow[] } = {}, now = 0n) {
  const queries: { name: string; vars: unknown }[] = []
  const centrifuge = new Centrifuge({
    environment: 'testnet',
    dataSource: {
      query: (name: string, vars: unknown) => {
        queries.push({ name, vars })
        return of(name === 'poolAuthorizationEvents' ? (rows.events ?? []) : (rows.parameters ?? []))
      },
    } as any,
  })
  sinon.stub(centrifuge as any, '_poolRows').returns(
    of([
      { id: pool33Id.toString(), protocolVersion: '3.3', migrationStatus: 'live' },
      { id: pool32Id.toString(), protocolVersion: '3.2', migrationStatus: 'live' },
      { id: pool2Id.toString(), protocolVersion: '3.3', migrationStatus: 'live' },
    ])
  )
  const readContract = sinon.stub().rejects(new Error('unexpected contract read'))
  const getBlock = sinon.stub().resolves({ number: 1n, timestamp: now })
  stubChain(centrifuge, { readContract, getBlock })
  return { centrifuge, queries, readContract, getBlock, pool: new Pool(centrifuge, pool33Id) }
}

const expiryReads = (readContract: sinon.SinonStub) =>
  readContract.getCalls().map((call) => ({ address: call.args[0].address, functionName: call.args[0].functionName }))

describe('Pool.hubExecutionPolicy', () => {
  afterEach(() => sinon.restore())

  it('is null for a pool with no install row', async () => {
    const { pool } = setup({ events: [scheduled({ block: 20, logIndex: 0 })] })

    expect(await firstValueFrom(pool.hubExecutionPolicy())).to.equal(null)
  })

  it('is null when the latest install is the zero address, whatever the earlier ones were', async () => {
    const clear = { block: 30, logIndex: 0 }
    const { pool } = setup({
      events: [install(FIRST), install(clear, ZERO_ADDRESS)],
      parameters: [policyRow(FIRST)],
    })

    expect(await firstValueFrom(pool.hubExecutionPolicy())).to.equal(null)
  })

  it('is null on a v3.2 pool, and asks neither the indexer nor the chain', async () => {
    const { centrifuge, queries, readContract } = setup({ events: [install(FIRST)], parameters: [policyRow(FIRST)] })
    const v32 = new Pool(centrifuge, pool32Id)

    expect(await firstValueFrom(v32.hubExecutionPolicy())).to.equal(null)
    expect(queries).to.deep.equal([])
    expect(readContract.called).to.equal(false)
  })

  it('maps every field of the install’s hub_policy row and reads nothing from the chain', async () => {
    const { pool, queries, readContract } = setup({ events: [install(FIRST)], parameters: [policyRow(FIRST)] })

    const policy = await firstValueFrom(pool.hubExecutionPolicy())

    expect(policy).to.not.equal(null)
    expect(policy).to.include({
      address: POLICY_A,
      installNumber: 1,
      delay: 86400n,
      expiry: 604800n,
      escalation: 172800n,
      maxBrmPriceDeviation: 2n ** 128n - 1n,
      isRestrictionUpdateInstant: true,
      onchainAccounting: false,
    })
    expect(policy?.maxAbsolutePriceDelta?.toBigInt()).to.equal(50000000000000000n)
    expect(policy?.thresholdPerSecond?.toBigInt()).to.equal(3000000000000n)
    expect(readContract.called).to.equal(false)
    expect(queries.map((q) => q.name).sort()).to.deep.equal(['hubPolicies', 'poolAuthorizationEvents'])
    expect(queries.every((q) => (q.vars as any).poolId === POOL)).to.equal(true)
  })

  it('takes the install by block and log index and its parameters by primary key, not the newest hub_policy row', async () => {
    const second = { block: 30, logIndex: 4 }
    const lagging = { block: 40, logIndex: 0 }
    const { pool } = setup({
      // The latest install is POLICY_B at (30, 4); rows arrive out of order.
      events: [install(second, POLICY_B), install(FIRST)],
      parameters: [
        // A hub_policy row of a later log with no install row yet (a reader's two queries straddling a commit).
        policyRow(lagging, { policy: '0xcccccccccccccccccccccccccccccccccccccccc', delay: '1' }),
        policyRow(second, { policy: POLICY_B, delay: '7' }),
        policyRow(FIRST, { delay: '3' }),
      ],
    })

    const policy = await firstValueFrom(pool.hubExecutionPolicy())

    expect(policy).to.include({ address: POLICY_B, installNumber: 2, delay: 7n })
  })

  it('ignores a spoke registry SetPolicy row, which installs nothing on the hub', async () => {
    const spoke = eventRow(
      'SPOKE_REGISTRY_SET_POLICY',
      { block: 50, logIndex: 0 },
      { centrifugeId: SPOKE, policy: ZERO_ADDRESS }
    )
    const { pool } = setup({ events: [install(FIRST), spoke], parameters: [policyRow(FIRST)] })

    expect((await firstValueFrom(pool.hubExecutionPolicy()))?.address).to.equal(POLICY_A)
  })

  it('reads expiry() from the policy contract when the hub_policy row is missing, and leaves every other field null', async () => {
    const { pool, readContract } = setup({ events: [install(FIRST)], parameters: [] })
    readContract.resolves(432000)

    const policy = await firstValueFrom(pool.hubExecutionPolicy())

    expect(policy).to.deep.equal({
      address: POLICY_A,
      installNumber: 1,
      delay: null,
      expiry: 432000n,
      escalation: null,
      maxAbsolutePriceDelta: null,
      thresholdPerSecond: null,
      maxBrmPriceDeviation: null,
      isRestrictionUpdateInstant: null,
      onchainAccounting: null,
    })
    expect(expiryReads(readContract)).to.deep.equal([{ address: POLICY_A, functionName: 'expiry' }])
    expect(readContract.firstCall.args[0].abi).to.equal(STD_HUB_POLICY_ABI)
  })

  it('reads expiry() when the row’s expiry is null, and keeps the row’s other fields', async () => {
    const { pool, readContract } = setup({
      events: [install(FIRST)],
      parameters: [
        policyRow(FIRST, { expiry: null, delay: '0', thresholdPerSecond: '0', isRestrictionUpdateInstant: false }),
      ],
    })
    readContract.resolves(100)

    const policy = await firstValueFrom(pool.hubExecutionPolicy())

    expect(policy?.expiry).to.equal(100n)
    expect(policy?.delay).to.equal(0n)
    expect(policy?.thresholdPerSecond?.toBigInt()).to.equal(0n)
    expect(policy?.isRestrictionUpdateInstant).to.equal(false)
    expect(readContract.callCount).to.equal(1)
  })

  it('never defaults an unpublished parameter to 0 or false', async () => {
    const unpublished = {
      delay: null,
      expiry: null,
      escalation: null,
      maxAbsolutePriceDelta: null,
      thresholdPerSecond: null,
      maxBrmPriceDeviation: null,
      isRestrictionUpdateInstant: null,
      onchainAccounting: null,
    }
    const { pool, readContract } = setup({ events: [install(FIRST)], parameters: [policyRow(FIRST, unpublished)] })
    readContract.resolves(100)

    const policy = await firstValueFrom(pool.hubExecutionPolicy())

    expect(policy).to.deep.include({ ...unpublished, expiry: 100n })
  })

  it('leaves expiry null for a policy that answers no expiry(), without failing', async () => {
    const { pool, readContract } = setup({ events: [install(FIRST)], parameters: [] })
    readContract.rejects(new ContractFunctionRevertedError({ abi: [], functionName: 'expiry' }))

    const policy = await firstValueFrom(pool.hubExecutionPolicy())

    expect(policy?.expiry).to.equal(null)
    expect(policy?.address).to.equal(POLICY_A)
  })

  it('fails on a read error that is not a missing view, rather than reporting an unknown expiry', async () => {
    const { pool, readContract } = setup({ events: [install(FIRST)], parameters: [] })
    readContract.rejects(new Error('rpc unavailable'))

    let error: unknown
    try {
      await firstValueFrom(pool.hubExecutionPolicy())
    } catch (e) {
      error = e
    }

    expect((error as Error).message).to.contain('rpc unavailable')
  })

  it('answers an address of null and every parameter null when the latest install carries no policy address, and reads no expiry()', async () => {
    const { pool, readContract } = setup({
      events: [install(FIRST), install({ block: 30, logIndex: 0 }, null)],
      // Even a parameter row at the install's key is not read: with no address the policy is unknown.
      parameters: [policyRow(FIRST), policyRow({ block: 30, logIndex: 0 }, { policy: null })],
    })

    const policy = await firstValueFrom(pool.hubExecutionPolicy())

    expect(policy).to.deep.equal({
      address: null,
      installNumber: 2,
      delay: null,
      expiry: null,
      escalation: null,
      maxAbsolutePriceDelta: null,
      thresholdPerSecond: null,
      maxBrmPriceDeviation: null,
      isRestrictionUpdateInstant: null,
      onchainAccounting: null,
    })
    expect(readContract.called).to.equal(false)
  })

  it('fails on an install row of another chain than the pool’s hub chain', async () => {
    const { pool } = setup({ events: [install(FIRST, POLICY_A, { centrifugeId: SPOKE })] })

    let error: unknown
    try {
      await firstValueFrom(pool.hubExecutionPolicy())
    } catch (e) {
      error = e
    }

    expect(error).to.be.instanceOf(AuthorizationFoldError)
  })
})

describe('Pool.authorizations', () => {
  afterEach(() => sinon.restore())

  it('is empty on a v3.2 pool, and asks neither the indexer nor the chain', async () => {
    const { centrifuge, queries, getBlock } = setup({ events: live, parameters: [policyRow(FIRST)] })

    const list = await firstValueFrom(new Pool(centrifuge, pool32Id).authorizations())

    expect(list).to.deep.equal({ items: [], skipped: [] })
    expect(queries).to.deep.equal([])
    expect(getBlock.called).to.equal(false)
  })

  it('reads no chain state for a pool with no scheduling row', async () => {
    const { pool, centrifuge, getBlock } = setup({ events: [install(FIRST)], parameters: [policyRow(FIRST)] })

    expect(await firstValueFrom(pool.authorizations())).to.deep.equal({ items: [], skipped: [] })
    expect((centrifuge.getClient as unknown as sinon.SinonStub).called).to.equal(false)
    expect(getBlock.called).to.equal(false)
  })

  it('judges an authorization against the hub chain’s latest block timestamp', async () => {
    const parameters = [policyRow(FIRST, { expiry: '100' })]
    const statusAt = async (now: bigint) => {
      const { pool } = setup({ events: live, parameters }, now)
      return (await firstValueFrom(pool.authorizations())).items[0]?.status
    }

    expect(await statusAt(VALID_AFTER - 1n)).to.equal('scheduled')
    expect(await statusAt(VALID_AFTER)).to.equal('matured')
    expect(await statusAt(VALID_AFTER + 100n)).to.equal('matured')
    expect(await statusAt(VALID_AFTER + 101n)).to.equal('expired')
  })

  it('returns the folded item with the scheduled calldata and its function name', async () => {
    const { pool } = setup({ events: live, parameters: [policyRow(FIRST, { expiry: '100' })] }, VALID_AFTER)

    const { items, skipped } = await firstValueFrom(pool.authorizations())

    expect(skipped).to.deep.equal([])
    expect(items).to.deep.equal([
      {
        runId: `${txHash(20, 0)}:0`,
        authId: authId('a'),
        data: calldata,
        functionName: 'updateHubManager',
        args: { poolId: pool33Id.raw, who: getAddress(MANAGER), canManage: true },
        caller: MANAGER,
        scheduledAt: 1793527200n,
        validAfter: VALID_AFTER,
        expiresAt: VALID_AFTER + 100n,
        status: 'matured',
        txHash: txHash(20, 0),
        executedAt: null,
        executedTxHash: null,
        canceledAt: null,
        canceledTxHash: null,
      },
    ])
  })

  it('reads no expiry() when the rows give it', async () => {
    const { pool, readContract } = setup({ events: live, parameters: [policyRow(FIRST)] }, VALID_AFTER)

    await firstValueFrom(pool.authorizations())

    expect(readContract.called).to.equal(false)
  })

  it('reads expiry() once per policy whose row gives none, and judges with it', async () => {
    const second = { block: 30, logIndex: 0 }
    const { pool, readContract } = setup(
      {
        events: [
          install(FIRST),
          install(second, POLICY_B),
          install({ block: 31, logIndex: 0 }, POLICY_B),
          scheduled({ block: 40, logIndex: 0 }),
        ],
        parameters: [policyRow(FIRST, { expiry: '500' })],
      },
      VALID_AFTER + 301n
    )
    readContract.resolves(300)

    const { items } = await firstValueFrom(pool.authorizations())

    // POLICY_B is installed twice and read once; POLICY_A's row gives its expiry.
    expect(expiryReads(readContract)).to.deep.equal([{ address: POLICY_B, functionName: 'expiry' }])
    expect(items[0]).to.include({ status: 'expired', expiresAt: VALID_AFTER + 300n })
  })

  it('shows an item as undetermined, not failed, when the policy answers no expiry()', async () => {
    const { pool, readContract } = setup({ events: live, parameters: [] }, VALID_AFTER + 5n)
    readContract.rejects(new ContractFunctionRevertedError({ abi: [], functionName: 'expiry' }))

    const { items } = await firstValueFrom(pool.authorizations())

    expect(items[0]).to.include({ status: 'undetermined', expiresAt: null })
  })

  it('matches a parameter row to its install by primary key', async () => {
    const otherLog = policyRow(FIRST, { createdAtTxHash: txHash(99, 99), expiry: '1' })
    const { pool, readContract } = setup({ events: live, parameters: [otherLog] }, VALID_AFTER)
    readContract.resolves(250)

    const { items } = await firstValueFrom(pool.authorizations())

    expect(items[0]?.expiresAt).to.equal(VALID_AFTER + 250n)
    expect(readContract.callCount).to.equal(1)
  })

  it('names the ids its rows could not judge in skipped', async () => {
    const early = scheduled({ block: 5, logIndex: 0 }, { authId: authId('early') })
    const { pool } = setup({ events: [early, ...live], parameters: [policyRow(FIRST)] })

    const { items, skipped } = await firstValueFrom(pool.authorizations())

    expect(items).to.have.length(1)
    expect(skipped).to.deep.equal([{ authId: authId('early'), reason: 'installMissing' }])
  })

  it('fails on broken rows: another pool’s row', async () => {
    const { pool } = setup({
      events: [...live, scheduled({ block: 25, logIndex: 0 }, { poolId: '999', authId: authId('b') })],
    })

    let error: unknown
    try {
      await firstValueFrom(pool.authorizations())
    } catch (e) {
      error = e
    }

    expect(error).to.be.instanceOf(AuthorizationFoldError)
  })
})

describe('Pool policy reads on a hub that is not chain 1', () => {
  afterEach(() => sinon.restore())

  const pool2Hub = { centrifugeId: HUB_2, poolId: pool2Id.toString() }
  const at2 = (block: number, logIndex = 0) => ({ block, logIndex })
  const requested = (centrifuge: Centrifuge) => (centrifuge.getClient as unknown as sinon.SinonStub).args

  it('reads expiry() for hubExecutionPolicy() from the hub chain’s client', async () => {
    const { centrifuge, readContract } = setup({
      events: [install(at2(10), POLICY_A, pool2Hub)],
      parameters: [],
    })
    readContract.resolves(100)

    await firstValueFrom(new Pool(centrifuge, pool2Id).hubExecutionPolicy())

    expect(requested(centrifuge)).to.deep.equal([[2]])
  })

  it('reads the block timestamp and expiry() for authorizations() from the hub chain’s client only', async () => {
    const { centrifuge, readContract } = setup({
      events: [install(at2(10), POLICY_A, pool2Hub), scheduled(at2(20), pool2Hub)],
      parameters: [],
    })
    readContract.resolves(100)

    await firstValueFrom(new Pool(centrifuge, pool2Id).authorizations())

    expect(requested(centrifuge).length).to.be.greaterThan(0)
    expect(requested(centrifuge).every((args: unknown[]) => args[0] === 2)).to.equal(true)
  })

  it('makes authorizations() fail when the hub chain’s block cannot be read, instead of judging at time zero', async () => {
    const { pool, getBlock } = setup({ events: live, parameters: [policyRow(FIRST)] })
    getBlock.rejects(new Error('block unavailable'))

    let error: unknown
    try {
      await firstValueFrom(pool.authorizations())
    } catch (e) {
      error = e
    }

    expect((error as Error).message).to.contain('block unavailable')
  })
})

describe('Pool policy reads cache expiry() per chain and policy', () => {
  afterEach(() => sinon.restore())

  const requestedChains = (centrifuge: Centrifuge) =>
    (centrifuge.getClient as unknown as sinon.SinonStub).args.map((args: unknown[]) => args[0])

  const withScheduling = [install(FIRST), scheduled({ block: 20, logIndex: 0 })]

  it('reads a policy’s expiry() once for two different reads of the pool', async () => {
    const { pool, readContract } = setup({ events: withScheduling, parameters: [] })
    readContract.resolves(100)

    await firstValueFrom(pool.hubExecutionPolicy())
    await firstValueFrom(pool.authorizations())

    expect(readContract.callCount).to.equal(1)
  })

  it('does not cache a failed read, and caches the answer of the next one', async () => {
    const { pool, readContract } = setup({ events: withScheduling, parameters: [] })
    readContract.onFirstCall().rejects(new Error('rpc unavailable')).onSecondCall().resolves(100)

    let error: unknown
    try {
      await firstValueFrom(pool.hubExecutionPolicy())
    } catch (e) {
      error = e
    }
    const policy = await firstValueFrom(pool.hubExecutionPolicy())
    await firstValueFrom(pool.authorizations())

    expect((error as Error).message).to.contain('rpc unavailable')
    expect(policy?.expiry).to.equal(100n)
    expect(readContract.callCount).to.equal(2)
  })

  it('caches a policy that answers no expiry() as unknown', async () => {
    const { pool, readContract } = setup({ events: withScheduling, parameters: [] })
    readContract.rejects(new ContractFunctionRevertedError({ abi: [], functionName: 'expiry' }))

    await firstValueFrom(pool.hubExecutionPolicy())
    await firstValueFrom(pool.authorizations())

    expect(readContract.callCount).to.equal(1)
  })

  it('keeps one answer per chain for the same policy address', async () => {
    const rows = { events: [install(FIRST)], parameters: [] as HubPolicyRow[] }
    const { centrifuge, pool, readContract } = setup(rows)
    readContract.callsFake(async () => (requestedChains(centrifuge).at(-1) === 2 ? 200 : 100))
    const onChain1 = await firstValueFrom(pool.hubExecutionPolicy())

    rows.events = [install({ block: 10, logIndex: 0 }, POLICY_A, { centrifugeId: HUB_2, poolId: pool2Id.toString() })]
    const onChain2 = await firstValueFrom(new Pool(centrifuge, pool2Id).hubExecutionPolicy())

    expect([onChain1?.expiry, onChain2?.expiry]).to.deep.equal([100n, 200n])
    expect(readContract.callCount).to.equal(2)
  })

  it('keeps one answer per policy address', async () => {
    const rows = { events: withScheduling, parameters: [] as HubPolicyRow[] }
    const { centrifuge, pool, readContract } = setup(rows)
    readContract.callsFake(async ({ address }: { address: string }) => (address === POLICY_A ? 100 : 200))
    const first = await firstValueFrom(pool.hubExecutionPolicy())

    // A new install of another policy, read through a query that was not cached under the first answer.
    rows.events = [...withScheduling, install({ block: 30, logIndex: 0 }, POLICY_B)]
    for (const prefix of [['poolAuthorizationEvents'], ['hubPolicies'], ['pool', POOL, 'hubExecutionPolicy']]) {
      centrifuge.clearQueryCache(prefix)
    }
    const second = await firstValueFrom(pool.hubExecutionPolicy())

    expect([first?.expiry, second?.expiry]).to.deep.equal([100n, 200n])
    expect(readContract.getCalls().map((call) => call.args[0].address)).to.deep.equal([POLICY_A, POLICY_B])
  })
})

describe('Pool.authorizations reads an expiry() only where it matters', () => {
  afterEach(() => sinon.restore())

  it('reads the latest install’s policy and not an earlier one the rows give no expiry for', async () => {
    const second = { block: 30, logIndex: 0 }
    const { pool, readContract } = setup(
      {
        events: [install(FIRST), install(second, POLICY_B), scheduled({ block: 40, logIndex: 0 })],
        parameters: [],
      },
      VALID_AFTER
    )
    readContract.resolves(300)

    await firstValueFrom(pool.authorizations())

    expect(readContract.getCalls().map((call) => call.args[0].address)).to.deep.equal([POLICY_B])
  })

  it('reads nothing when the latest install’s row gives the expiry, though an earlier one lacks it', async () => {
    const second = { block: 30, logIndex: 0 }
    const { pool, readContract } = setup(
      {
        events: [install(FIRST), install(second, POLICY_B), scheduled({ block: 40, logIndex: 0 })],
        parameters: [policyRow(second, { policy: POLICY_B, expiry: '500' })],
      },
      VALID_AFTER
    )

    const { items } = await firstValueFrom(pool.authorizations())

    expect(readContract.called).to.equal(false)
    expect(items[0]?.expiresAt).to.equal(VALID_AFTER + 500n)
  })
})
