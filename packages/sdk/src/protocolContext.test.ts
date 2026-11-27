import { expect } from 'chai'
import { encodeFunctionData, parseAbi, toHex } from 'viem'
import {
  ABIS_V3_2,
  ABIS_V3_2 as ABI,
  ABIS_V3_3,
  builders,
  createDeploymentRegistry,
  DEFAULT_DEPLOYMENT_DATA,
  DeploymentVerificationError,
  getDeployment,
  resolveProtocolContext,
  type DeploymentRegistryData,
} from '@centrifuge/protocol'
import sinon from 'sinon'
import { BehaviorSubject, concat, defer, firstValueFrom, of, Subject, throwError, type Observable } from 'rxjs'
import type { PoolMigrationRow } from '@centrifuge/queries/core'
import { ApiV3UnsupportedError } from '@centrifuge/queries/graphql'
import { Centrifuge } from './Centrifuge.js'
import { pool32Id, pool33Id, setupV33, STD_HUB_POLICY_FACTORY } from './tests/hubGroup.js'
import { PoolId } from './utils/types.js'

function withProjectedPools(centrifuge: Centrifuge, rows: { id: string; protocolVersion: string | null }[]) {
  sinon.stub(centrifuge as any, '_queryData').callsFake((...args: unknown[]) => {
    const name = args[0]
    if (name !== 'pools') throw new Error(`unexpected catalogue read ${name}`)
    return of(rows.map((row) => ({ ...row, migrationStatus: 'live' })))
  })
}

// ProtocolContext resolution over the bundled @centrifuge/protocol registry
// (no indexer, no network), calldata parity for the builder, and the
// version-plurality proof (a fake version needs only an address set and an ABI
// set).
describe('protocol context', () => {
  afterEach(() => sinon.restore())

  describe('protocolContext', () => {
    it('resolves a chain-scoped context from the bundled registry (no indexer), at the newest version: v3.3 on mainnet', async () => {
      const centrifuge = new Centrifuge({ environment: 'mainnet' })
      const ctx = await centrifuge.protocolContext(1)

      expect(ctx.protocolVersion).to.equal('3.3')
      expect(ctx.chainId).to.equal(1)
      expect(ctx.centrifugeId).to.equal(1)
      expect(ctx.hub).to.equal('0x85056A78e79E5D17A9b25a09377EaA310f69B743')
      expect(ctx.hubRegistry).to.equal('0xC81236A945503DdA6eCC4E544A5060a554e58745')
      expect(ctx.abis.hub).to.exist
      // Chain-scoped targets carry no pure-builder context (no pool).
      expect(ctx.context).to.equal(undefined)
    })

    it("resolves the mainnet v3.3.0 hub when v3.3 is named, and v3.2's when v3.2 is", async () => {
      const centrifuge = new Centrifuge({ environment: 'mainnet' })
      const v33 = await centrifuge.protocolContext({ centrifugeId: 1, protocolVersion: '3.3' })
      const v32 = await centrifuge.protocolContext({ centrifugeId: 1, protocolVersion: '3.2' })

      expect(v33.hub).to.equal('0x85056A78e79E5D17A9b25a09377EaA310f69B743')
      expect(v32.hub).to.equal('0xA4A7Bb3831958463b3FE3E27A6a160F764341953')
      expect(v32.hubRegistry).to.equal('0x19f46D8130e610C6C0f0116EA40Fb781dEFaDE93')
    })

    it('resolves a pool-scoped context from the version the pools entry projects', async () => {
      const centrifuge = new Centrifuge({ environment: 'mainnet' })
      const poolId = PoolId.from(1, 1)
      withProjectedPools(centrifuge, [{ id: poolId.toString(), protocolVersion: '3.2' }])
      const ctx = await centrifuge.protocolContext(poolId)

      expect(ctx.protocolVersion).to.equal('3.2')
      expect(ctx.hub).to.equal('0xA4A7Bb3831958463b3FE3E27A6a160F764341953')
      expect(ctx.context).to.exist
      expect(ctx.context!.poolId).to.equal(poolId.raw.toString())
      expect(ctx.context!.protocolVersion).to.equal('3.2')
      expect(ctx.context!.chainId).to.equal(1)
      expect(ctx.context!.addresses.hub).to.equal(ctx.hub)
    })

    it('resolves a pool-scoped context from the only deployed version while the pools entry does not know the pool', async () => {
      const centrifuge = new Centrifuge({ environment: 'mainnet' })
      const poolId = PoolId.from(15, 1)
      withProjectedPools(centrifuge, [])
      const ctx = await centrifuge.protocolContext(poolId)

      expect(ctx.protocolVersion).to.equal('3.3')
      expect(ctx.context!.poolId).to.equal(poolId.raw.toString())
    })

    it('refuses a pool-scoped context the pools entry does not know on a mainnet chain serving v3.2 and v3.3', async () => {
      const centrifuge = new Centrifuge({ environment: 'mainnet' })
      withProjectedPools(centrifuge, [])
      let error: unknown
      try {
        await centrifuge.protocolContext(PoolId.from(1, 1))
      } catch (e) {
        error = e
      }
      expect((error as Error).name).to.equal('ProtocolVersionResolutionError')
      expect((error as Error).message).to.contain('refusing to guess')
    })

    it('refuses a pool-scoped context when the pools entry carries no version', async () => {
      const centrifuge = new Centrifuge({ environment: 'mainnet' })
      const poolId = PoolId.from(1, 1)
      withProjectedPools(centrifuge, [{ id: poolId.toString(), protocolVersion: null }])
      let error: unknown
      try {
        await centrifuge.protocolContext(poolId)
      } catch (e) {
        error = e
      }
      expect((error as Error).name).to.equal('ProtocolVersionResolutionError')
      expect((error as Error).message).to.contain('no protocolVersion')
    })

    it('refuses a pool-scoped context when the projected version is not deployed on the chain', async () => {
      const centrifuge = new Centrifuge({ environment: 'mainnet' })
      const poolId = PoolId.from(15, 1)
      withProjectedPools(centrifuge, [{ id: poolId.toString(), protocolVersion: '3.2' }])
      let error: unknown
      try {
        await centrifuge.protocolContext(poolId)
      } catch (e) {
        error = e
      }
      expect((error as Error).name).to.equal('ProtocolVersionResolutionError')
      expect((error as Error).message).to.contain('"3.2" is not deployed')
    })

    it('refuses a spoke-scoped context when the pool version is not deployed on that chain', async () => {
      const centrifuge = new Centrifuge({ environment: 'mainnet' })
      const poolId = PoolId.from(1, 1)
      withProjectedPools(centrifuge, [{ id: poolId.toString(), protocolVersion: '3.2' }])
      let error: unknown
      try {
        await centrifuge.protocolContext({ poolId, centrifugeId: 9999 })
      } catch (e) {
        error = e
      }
      expect((error as Error).name).to.equal('ProtocolVersionResolutionError')
      expect((error as Error).message).to.contain('centrifugeId 9999')
    })

    it('resolves environment-scoped addresses (testnet differs from mainnet)', async () => {
      const mainnet = new Centrifuge({ environment: 'mainnet' })
      const testnet = new Centrifuge({ environment: 'testnet' })
      const [m, t] = await Promise.all([mainnet.protocolContext(1), testnet.protocolContext(1)])
      expect(m.chainId).to.equal(1)
      expect(t.chainId).to.equal(11155111) // sepolia
      expect(m.hub).to.not.equal(t.hub)
    })

    it('accepts an explicit { centrifugeId, protocolVersion } pair', async () => {
      const centrifuge = new Centrifuge({ environment: 'mainnet' })
      const ctx = await centrifuge.protocolContext({ centrifugeId: 2, protocolVersion: '3.2' })
      expect(ctx.chainId).to.equal(8453) // base
      expect(ctx.protocolVersion).to.equal('3.2')
    })

    it('rejects an unknown chain fail-loud', async () => {
      const centrifuge = new Centrifuge({ environment: 'mainnet' })
      let error: unknown
      try {
        await centrifuge.protocolContext(9999)
      } catch (e) {
        error = e
      }
      expect(error).to.be.instanceOf(Error)
      expect((error as Error).message).to.contain('9999')
    })
  })

  describe('adapters', () => {
    it('adapters() leaves wormholeAdapter undefined on every mainnet chain', async () => {
      const centrifuge = new Centrifuge({ environment: 'mainnet' })
      const centrifugeIds = Object.keys(DEFAULT_DEPLOYMENT_DATA.mainnet['3.2'] ?? {}).map(Number)
      expect(centrifugeIds).to.include(1)
      for (const centrifugeId of centrifugeIds) {
        const adapters = await centrifuge.adapters(centrifugeId)
        expect(adapters.wormholeAdapter, `chain ${centrifugeId}`).to.equal(undefined)
      }
      expect((await centrifuge.adapters(1)).axelarAdapter).to.match(/^0x[0-9a-fA-F]{40}$/)
    })

    it('adapters() returns the v3.3 Hyperlane adapter on every testnet chain of the stack', async () => {
      const centrifuge = new Centrifuge({ environment: 'testnet' })
      // The address the v3.3 MultiAdapter lists in its global adapter sets on Sepolia, Base Sepolia
      // and Arbitrum Sepolia: the book's `hyperlaneAdapter`, not its `hyperlaneStandby`.
      const hyperlane = '0x4bECF046078577da8a1b7FAE642183F1BAd1F47F'
      for (const centrifugeId of [1, 2, 3, 9]) {
        const ctx = await centrifuge.protocolContext({ centrifugeId, protocolVersion: '3.3' })
        expect(ctx.hyperlaneAdapter, `chain ${centrifugeId}`).to.equal(hyperlane)
      }
      expect((await centrifuge.adapters(1)).hyperlaneAdapter).to.equal(hyperlane)
    })

    it('a v3.2 context leaves hyperlaneAdapter undefined on every mainnet chain', async () => {
      const centrifuge = new Centrifuge({ environment: 'mainnet' })
      const centrifugeIds = Object.keys(DEFAULT_DEPLOYMENT_DATA.mainnet['3.2'] ?? {}).map(Number)
      for (const centrifugeId of centrifugeIds) {
        const v32 = await centrifuge.protocolContext({ centrifugeId, protocolVersion: '3.2' })
        expect(v32.hyperlaneAdapter, `chain ${centrifugeId}`).to.equal(undefined)
      }
      const testnet = new Centrifuge({ environment: 'testnet' })
      const v32 = await testnet.protocolContext({ centrifugeId: 1, protocolVersion: '3.2' })
      expect(v32.hyperlaneAdapter).to.equal(undefined)
    })
  })

  describe('chain id mapping from the bundled registry', () => {
    it('maps centrifugeId <-> chainId without an indexer', async () => {
      const centrifuge = new Centrifuge({ environment: 'mainnet' })
      expect(await centrifuge._idToChain(2)).to.equal(8453)
      expect(await centrifuge._chainToId(8453)).to.equal(2)
    })

    it('maps testnet ids to testnet chains', async () => {
      const centrifuge = new Centrifuge({ environment: 'testnet' })
      expect(await centrifuge._idToChain(1)).to.equal(11155111)
      expect(await centrifuge._chainToId(84532)).to.equal(2)
    })
  })

  describe('calldata parity: setPoolMetadata builder', () => {
    it('builder output is byte-equal to a direct encode over the SDK Hub ABI', async () => {
      const centrifuge = new Centrifuge({ environment: 'mainnet' })
      const poolId = PoolId.from(1, 42)
      withProjectedPools(centrifuge, [{ id: poolId.toString(), protocolVersion: '3.2' }])
      const cid = 'QmYwAPJzv5CZsnAzt8auVZRn1pfejgFyLrTn3VNbEqLGmq'

      const { context, hub } = await centrifuge.protocolContext(poolId)
      const built = builders.setPoolMetadata(context!, { poolId: poolId.raw.toString(), cid })

      // encodeFunctionData over the SDK's own Hub ABI, independently of the
      // builder and its registry-resolved context.
      const expected = encodeFunctionData({
        abi: ABI.Hub,
        functionName: 'setPoolMetadata',
        args: [poolId.raw, toHex(cid)],
      })

      expect(built.data).to.equal(expected)
      expect(built.to).to.equal(hub)
      expect(built.value).to.equal(0n)
    })
  })

  describe('version plurality (adding a version = one address set + one ABI set)', () => {
    it('a fake v-test version resolves and builds with no loader or consumer changes', () => {
      const V_TEST = 'v-test'
      const abiSets = {
        [V_TEST]: {
          hub: parseAbi(['function setPoolMetadata(uint64 poolId, bytes metadata) payable']),
        },
      }
      const data: DeploymentRegistryData = {
        mainnet: {
          [V_TEST]: {
            1: {
              chainId: 1,
              name: 'ethereum',
              contracts: { hub: '0x1111111111111111111111111111111111111111' },
            },
          },
        },
        testnet: {},
      }
      const registry = createDeploymentRegistry(data, abiSets)

      const poolId = PoolId.from(1, 7)
      const ctx = resolveProtocolContext(poolId.raw.toString(), V_TEST, {
        environment: 'mainnet',
        registry,
        abiSets,
      })

      expect(ctx.protocolVersion).to.equal(V_TEST)
      expect(ctx.addresses.hub).to.equal('0x1111111111111111111111111111111111111111')

      // The same protocol-neutral builder works against the new version.
      const built = builders.setPoolMetadata(ctx, { poolId: poolId.raw.toString(), cid: 'Qm123' })
      expect(built.to).to.equal('0x1111111111111111111111111111111111111111')
      expect(built.data.startsWith('0x')).to.equal(true)
    })
  })

  describe('fail-loud deployment verification', () => {
    it('a mismatched field throws DeploymentVerificationError naming chain, version, field', () => {
      const bundled = getDeployment('mainnet', '3.2', 1)
      const contracts: Record<string, string> = { ...bundled.contracts, hub: 'not-an-address' }
      const data: DeploymentRegistryData = {
        mainnet: { '3.2': { 1: { chainId: 1, name: 'ethereum', contracts } } },
        testnet: { '3.2': {} },
      }
      expect(() => createDeploymentRegistry(data)).to.throw(
        DeploymentVerificationError,
        /mainnet\.3\.2\.1\.contracts\.hub/
      )
    })
  })
})

describe('stdHubPolicyFactory on the context', () => {
  afterEach(() => sinon.restore())

  it("is the address the hub chain's v3.3 stack lists, for a v3.3 pool", async () => {
    const { centrifuge } = setupV33({}, [], { stdHubPolicyFactory: STD_HUB_POLICY_FACTORY })

    const ctx = await centrifuge.protocolContext(pool33Id)

    expect(ctx.stdHubPolicyFactory).to.equal(STD_HUB_POLICY_FACTORY)
  })

  it('comes with the book’s ABI for it, keyed by its registry name', async () => {
    const { centrifuge } = setupV33({}, [], { stdHubPolicyFactory: STD_HUB_POLICY_FACTORY })

    const ctx = await centrifuge.protocolContext(pool33Id)

    expect(ctx.abis.stdHubPolicyFactory).to.equal(ABIS_V3_3.StdHubPolicyFactory)
  })

  it('is absent where the stack lists none, and the context still resolves', async () => {
    const { centrifuge } = setupV33({}, [], { stdHubPolicyFactory: null })

    const ctx = await centrifuge.protocolContext(pool33Id)

    expect(ctx.protocolVersion).to.equal('3.3')
    expect(ctx.stdHubPolicyFactory).to.equal(undefined)
  })

  it('is absent from a v3.2 pool, whose stack never lists it', async () => {
    const { centrifuge } = setupV33({}, [], { stdHubPolicyFactory: STD_HUB_POLICY_FACTORY })

    const ctx = await centrifuge.protocolContext(pool32Id)

    expect(ctx.protocolVersion).to.equal('3.2')
    expect(ctx.stdHubPolicyFactory).to.equal(undefined)
  })
})

describe('contract ABIs on the context', () => {
  afterEach(() => sinon.restore())

  it('exposes the typed ABI set of the resolved version', async () => {
    const centrifuge = new Centrifuge({ environment: 'mainnet' })
    const v33 = await centrifuge.protocolContext(1)
    const v32 = await centrifuge.protocolContext({ centrifugeId: 1, protocolVersion: '3.2' })
    expect((v33.contractAbis.Hub as unknown) === ABIS_V3_3.Hub, 'v3.3 Hub ABI').to.equal(true)
    expect(v32.contractAbis).to.equal(ABIS_V3_2)
    expect(v32.contractAbis.Hub).to.equal(ABI.Hub)
  })

  it('resolves a spoke-side context from the pool version with the spoke address set', async () => {
    const centrifuge = new Centrifuge({ environment: 'mainnet' })
    const poolId = PoolId.from(1, 1)
    withProjectedPools(centrifuge, [{ id: poolId.toString(), protocolVersion: '3.2' }])
    const spoke = await centrifuge.protocolContext({ poolId, centrifugeId: 2 })
    const hub = await centrifuge.protocolContext(poolId)
    expect(spoke.chainId).to.equal(8453)
    expect(spoke.protocolVersion).to.equal('3.2')
    expect(spoke.context!.centrifugeId).to.equal(2)
    expect(hub.chainId).to.equal(1)
  })
})

describe('spoke version during a pool migration', () => {
  afterEach(() => sinon.restore())

  const HUB = 1
  const SPOKE = 2
  const poolId = PoolId.from(HUB, 1)

  function migrationRow(spokes: { centrifugeId: number; phase: string }[]): PoolMigrationRow {
    return {
      migrationId: '3.2->3.3',
      poolId: poolId.toString(),
      targetVersion: '3.3',
      hubPhase: 'Activated',
      operator: '0x1111111111111111111111111111111111111111',
      startedAt: '2026-11-01T00:00:00.000Z',
      spokes: spokes.map((s) => ({ centrifugeId: String(s.centrifugeId), phase: s.phase, freezeGeneration: '1' })),
    }
  }

  function withMigration(
    poolVersion: string,
    migration: Observable<PoolMigrationRow | null>,
    config: { indexerPollingInterval?: number } = {}
  ) {
    const centrifuge = new Centrifuge({ environment: 'testnet', ...config })
    const reads: string[] = []
    sinon.stub(centrifuge as any, '_queryData').callsFake((...args: unknown[]) => {
      const name = args[0] as string
      reads.push(name)
      if (name === 'pools')
        return of([{ id: poolId.toString(), protocolVersion: poolVersion, migrationStatus: 'live' }])
      if (name === 'poolMigration') return migration
      throw new Error(`unexpected catalogue read ${name}`)
    })
    return { centrifuge, reads }
  }

  async function errorOf(promise: PromiseLike<unknown>) {
    try {
      await promise
    } catch (e) {
      return e as Error
    }
    throw new Error('expected a rejection')
  }

  it('resolves v3.2 for a spoke still offboarded after the hub activated, and v3.3 for the hub chain', async () => {
    const { centrifuge } = withMigration('3.3', of(migrationRow([{ centrifugeId: SPOKE, phase: 'Offboarded' }])))
    const spoke = await centrifuge.protocolContext({ poolId, centrifugeId: SPOKE })
    const hub = await centrifuge.protocolContext(poolId)
    expect(spoke.protocolVersion).to.equal('3.2')
    expect(spoke.context!.protocolVersion).to.equal('3.2')
    expect(hub.protocolVersion).to.equal('3.3')
  })

  it('re-emits v3.3 on the same subscription once the spoke row reads Onboarded', async () => {
    const row$ = new BehaviorSubject(migrationRow([{ centrifugeId: SPOKE, phase: 'Offboarded' }]))
    const { centrifuge } = withMigration('3.3', row$)
    const versions: string[] = []
    const sub = centrifuge.protocolContext({ poolId, centrifugeId: SPOKE }).subscribe((ctx) => {
      versions.push(ctx.protocolVersion)
    })
    await firstValueFrom(centrifuge.protocolContext({ poolId, centrifugeId: SPOKE }))
    row$.next(migrationRow([{ centrifugeId: SPOKE, phase: 'Onboarded' }]))
    await new Promise((resolve) => setTimeout(resolve, 0))
    sub.unsubscribe()
    expect(versions).to.deep.equal(['3.2', '3.3'])
  })

  it('stops reading the migration once the spoke onboarded, so a later failed poll does not end its context', async () => {
    const row$ = new Subject<PoolMigrationRow | null>()
    const { centrifuge } = withMigration('3.3', row$)
    const versions: string[] = []
    const errors: unknown[] = []
    const sub = centrifuge.protocolContext({ poolId, centrifugeId: SPOKE }).subscribe({
      next: (ctx) => versions.push(ctx.protocolVersion),
      error: (e) => errors.push(e),
    })
    while (!row$.observed) await new Promise((resolve) => setTimeout(resolve, 0))
    row$.next(migrationRow([{ centrifugeId: SPOKE, phase: 'Offboarded' }]))
    await new Promise((resolve) => setTimeout(resolve, 0))
    row$.next(migrationRow([{ centrifugeId: SPOKE, phase: 'Onboarded' }]))
    await new Promise((resolve) => setTimeout(resolve, 0))
    row$.error(new Error('indexer 502'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    sub.unsubscribe()
    expect(versions).to.deep.equal(['3.2', '3.3'])
    expect(errors).to.deep.equal([])
    expect(row$.observed).to.equal(false)
  })

  it('keeps the last answer through a failed poll before Onboarded and retries after one poll interval', async () => {
    let polls = 0
    const migration$ = defer(() => {
      polls += 1
      return polls === 1
        ? concat(
            of(migrationRow([{ centrifugeId: SPOKE, phase: 'Offboarded' }])),
            throwError(() => new Error('indexer 502'))
          )
        : of(migrationRow([{ centrifugeId: SPOKE, phase: 'Onboarded' }]))
    })
    const { centrifuge } = withMigration('3.3', migration$, { indexerPollingInterval: 5 })
    const versions: string[] = []
    const errors: unknown[] = []
    const sub = centrifuge.protocolContext({ poolId, centrifugeId: SPOKE }).subscribe({
      next: (ctx) => versions.push(ctx.protocolVersion),
      error: (e) => errors.push(e),
    })
    while (versions.length < 2 && errors.length === 0) await new Promise((resolve) => setTimeout(resolve, 5))
    sub.unsubscribe()
    expect(errors).to.deep.equal([])
    expect(versions).to.deep.equal(['3.2', '3.3'])
    expect(polls).to.equal(2)
  })

  it('resolves the pool version when the migration targets another version', async () => {
    const row = { ...migrationRow([{ centrifugeId: SPOKE, phase: 'Offboarded' }]), targetVersion: '3.4' }
    const { centrifuge } = withMigration('3.3', of(row))
    expect((await centrifuge.protocolContext({ poolId, centrifugeId: SPOKE })).protocolVersion).to.equal('3.3')
  })

  it('names an unknown spoke phase instead of reporting the migration as unreadable', async () => {
    const { centrifuge } = withMigration('3.3', of(migrationRow([{ centrifugeId: SPOKE, phase: 'Sideboarded' }])))
    const error = await errorOf(centrifuge.protocolContext({ poolId, centrifugeId: SPOKE }))
    expect(error.name).to.equal('ProtocolVersionResolutionError')
    expect(error.message).to.contain('unknown spoke phase "Sideboarded"')
    expect(error.message).to.not.contain('could not be read')
  })

  it('treats a spoke row that never armed as not onboarded', async () => {
    const { centrifuge } = withMigration('3.3', of(migrationRow([{ centrifugeId: SPOKE, phase: 'None' }])))
    const spoke = await centrifuge.protocolContext({ poolId, centrifugeId: SPOKE })
    expect(spoke.protocolVersion).to.equal('3.2')
  })

  it('resolves the pool version for a chain the migration has no spoke row for', async () => {
    const { centrifuge } = withMigration('3.3', of(migrationRow([{ centrifugeId: 3, phase: 'Offboarded' }])))
    const spoke = await centrifuge.protocolContext({ poolId, centrifugeId: SPOKE })
    expect(spoke.protocolVersion).to.equal('3.3')
  })

  it('keeps the hub chain on the pool version even when it has an unfinished spoke row of its own', async () => {
    const { centrifuge, reads } = withMigration('3.3', of(migrationRow([{ centrifugeId: HUB, phase: 'Offboarded' }])))
    const hub = await centrifuge.protocolContext({ poolId, centrifugeId: HUB })
    expect(hub.protocolVersion).to.equal('3.3')
    expect(reads).to.not.include('poolMigration')
  })

  it('does not read the migration for a pool that still reads v3.2', async () => {
    const { centrifuge, reads } = withMigration(
      '3.2',
      throwError(() => new Error('must not be read'))
    )
    const spoke = await centrifuge.protocolContext({ poolId, centrifugeId: SPOKE })
    expect(spoke.protocolVersion).to.equal('3.2')
    expect(reads).to.not.include('poolMigration')
  })

  it('refuses a v3.3 spoke context whose migration cannot be read, naming the read', async () => {
    const { centrifuge } = withMigration(
      '3.3',
      throwError(() => new Error('indexer 502'))
    )
    const error = await errorOf(centrifuge.protocolContext({ poolId, centrifugeId: SPOKE }))
    expect(error.name).to.equal('ProtocolVersionResolutionError')
    expect(error.message).to.contain('its migration could not be read')
    expect(error.message).to.contain('indexer 502')
  })

  it('resolves the pool version on an api-v3 source, which has no migration projection', async () => {
    const { centrifuge } = withMigration(
      '3.3',
      throwError(() => new ApiV3UnsupportedError())
    )
    const spoke = await centrifuge.protocolContext({ poolId, centrifugeId: SPOKE })
    expect(spoke.protocolVersion).to.equal('3.3')
  })
})
