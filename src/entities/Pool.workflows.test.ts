import { expect } from 'chai'
import { firstValueFrom, of } from 'rxjs'
import sinon from 'sinon'
import { Centrifuge } from '../Centrifuge.js'
import type { HexString } from '../types/index.js'
import type { MarketplaceWorkflow } from '../types/workflow.js'
import { PoolId } from '../utils/types.js'
import { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'

// The workflow-orchestration methods on Pool, stubbed rather than forked. What they get wrong is
// resolution — which chain an entry belongs to, which entries survive a catalog join, whether an
// unknown ref is caught before a policy root is rebuilt — and none of that needs a chain.

const STRATEGIST = '0x1dE2AD292207DB84286111563ced08464A0Cfb3d' as HexString
const OTHER_STRATEGIST = '0x9999999999999999999999999999999999999999' as HexString
const CENT_ID = 1
const OTHER_CENT_ID = 2

const poolId = PoolId.from(CENT_ID, 1)

const catalogEntry = (workflowRef: string, chainId: number, group?: string): MarketplaceWorkflow =>
  ({
    workflowRef,
    name: `Name of ${workflowRef}`,
    template: 't',
    chainId,
    group,
    variables: {},
    workflowId: `0x${'0'.repeat(64)}`,
    version: 1,
    actions: [],
    runtimeVariables: ['amount'],
  }) as unknown as MarketplaceWorkflow

/** A Pool with metadata, catalog, chain-id mapping and active networks all stubbed. */
function makePool(options: {
  entries?: {
    workflowRef: string
    configurableValues?: Record<string, HexString>
    excludedActions?: number[]
    workflowId?: string
    version?: number
  }[]
  strategist?: HexString
  catalog?: MarketplaceWorkflow[]
  /** centrifugeIds the pool is deployed on. */
  networks?: number[]
}) {
  const centrifuge = new Centrifuge({ environment: 'testnet' })
  const pool = new Pool(centrifuge, poolId.raw)

  sinon.stub(pool, 'metadata').returns(
    of({
      workflowPolicies: [
        {
          id: 'group-1',
          strategistAddress: options.strategist ?? STRATEGIST,
          createdAt: '2026-01-01T00:00:00.000Z',
          workflows: (options.entries ?? []).map((entry) => ({
            configurableValues: {},
            addedAt: '2026-01-01T00:00:00.000Z',
            ...entry,
          })),
        },
      ],
    }) as any
  )
  sinon.stub(centrifuge, 'workflowMarketplace').returns(of(options.catalog ?? []) as any)
  // chainId → centrifugeId; the fixtures use chainId 100x the centrifugeId to keep them distinct.
  sinon.stub(centrifuge, 'id').callsFake((chainId: number) => of(chainId / 100) as any)
  sinon
    .stub(pool, 'activeNetworks')
    .returns(of((options.networks ?? [CENT_ID]).map((id) => new PoolNetwork(centrifuge, pool, id))) as any)

  return { centrifuge, pool }
}

describe('entities/Pool workflow orchestration', () => {
  afterEach(() => sinon.restore())

  describe('listWorkflows', () => {
    it('returns nothing for a strategist with no policy', async () => {
      const { pool } = makePool({ entries: [{ workflowRef: 'wf_a' }], catalog: [catalogEntry('wf_a', 100)] })
      expect(await pool.listWorkflows({ strategist: OTHER_STRATEGIST })).to.deep.equal([])
    })

    it('matches the strategist case-insensitively', async () => {
      const { pool } = makePool({ entries: [{ workflowRef: 'wf_a' }], catalog: [catalogEntry('wf_a', 100)] })
      const rows = await pool.listWorkflows({ strategist: STRATEGIST.toLowerCase() as HexString })
      expect(rows.map((row) => row.workflowRef)).to.deep.equal(['wf_a'])
    })

    it('reports each entry with its resolved centrifugeId and runtime variables', async () => {
      const { pool } = makePool({
        entries: [{ workflowRef: 'wf_a' }, { workflowRef: 'wf_b' }],
        catalog: [catalogEntry('wf_a', 100), catalogEntry('wf_b', 200)],
        networks: [CENT_ID, OTHER_CENT_ID],
      })
      const rows = await pool.listWorkflows({ strategist: STRATEGIST })
      expect(rows.map((row) => [row.workflowRef, row.chainId, row.centrifugeId])).to.deep.equal([
        ['wf_a', 100, CENT_ID],
        ['wf_b', 200, OTHER_CENT_ID],
      ])
      expect(rows[0]!.runtimeVariables).to.deep.equal(['amount'])
      expect(rows[0]!.name).to.equal('Name of wf_a')
    })

    it('drops entries the catalog no longer carries', async () => {
      // The catalog is joined by ref, and a ref can go stale across catalog releases. The entry is
      // skipped rather than guessed at — but note the caller sees a SHORTER list, not an error, so a
      // count taken from here is not a count of what the strategist is authorized for.
      const { pool } = makePool({
        entries: [{ workflowRef: 'wf_a' }, { workflowRef: 'wf_gone' }],
        catalog: [catalogEntry('wf_a', 100)],
      })
      expect((await pool.listWorkflows({ strategist: STRATEGIST })).map((row) => row.workflowRef)).to.deep.equal([
        'wf_a',
      ])
    })

    it('drops entries for a chain the pool is not deployed on', async () => {
      const { pool } = makePool({
        entries: [{ workflowRef: 'wf_a' }, { workflowRef: 'wf_elsewhere' }],
        catalog: [catalogEntry('wf_a', 100), catalogEntry('wf_elsewhere', 900)],
        networks: [CENT_ID],
      })
      expect((await pool.listWorkflows({ strategist: STRATEGIST })).map((row) => row.workflowRef)).to.deep.equal([
        'wf_a',
      ])
    })
  })

  describe('planAccountingUpdate', () => {
    it('plans nothing when the strategist has no accounting workflows', async () => {
      // Only `group: 'account'` entries belong in the accounting batch; a position workflow in there
      // would move assets as a side effect of a price update.
      const { pool } = makePool({
        entries: [{ workflowRef: 'wf_position' }],
        catalog: [catalogEntry('wf_position', 100, 'position')],
      })
      expect(await pool.planAccountingUpdate({ strategist: STRATEGIST })).to.deep.equal([])
    })

    it('plans nothing when the strategist has no policy at all', async () => {
      const { pool } = makePool({ entries: [{ workflowRef: 'wf_a' }], catalog: [catalogEntry('wf_a', 100, 'account')] })
      expect(await pool.planAccountingUpdate({ strategist: OTHER_STRATEGIST })).to.deep.equal([])
    })

    it('skips a chain with no OnchainPM deployed', async () => {
      const { pool } = makePool({
        entries: [{ workflowRef: 'wf_account' }],
        catalog: [catalogEntry('wf_account', 100, 'account')],
      })
      sinon.stub(PoolNetwork.prototype, 'onchainPM').returns(of(null) as any)
      expect(await pool.planAccountingUpdate({ strategist: STRATEGIST })).to.deep.equal([])
    })
  })

  describe('addToPolicy / removeFromPolicy', () => {
    it('refuses a workflowRef the catalog does not carry', async () => {
      // Caught before anything is written: a rebuilt root that silently omitted the entry would
      // leave metadata and chain disagreeing about what is whitelisted.
      const { pool } = makePool({ entries: [], catalog: [catalogEntry('wf_a', 100)] })
      let error: Error | undefined
      await pool.addToPolicy({ strategist: STRATEGIST, workflowRef: 'wf_unknown' }).catch((e) => (error = e))
      expect(error?.message).to.match(/not in the marketplace catalog/)
    })

    it('refuses a workflow whose chain the pool is not deployed on', async () => {
      const { pool } = makePool({
        entries: [],
        catalog: [catalogEntry('wf_elsewhere', 900)],
        networks: [CENT_ID],
      })
      let error: Error | undefined
      await pool.removeFromPolicy({ strategist: STRATEGIST, workflowRef: 'wf_elsewhere' }).catch((e) => (error = e))
      expect(error?.message).to.match(/no active network for chain 900/)
    })

    it('refuses when the chain has no OnchainPM to hold the root', async () => {
      const { pool } = makePool({ entries: [], catalog: [catalogEntry('wf_a', 100)] })
      sinon.stub(PoolNetwork.prototype, 'onchainPM').returns(of(null) as any)
      let error: Error | undefined
      await pool.addToPolicy({ strategist: STRATEGIST, workflowRef: 'wf_a' }).catch((e) => (error = e))
      expect(error?.message).to.match(/OnchainPM is not deployed/)
    })
  })

  describe('adapterStatus', () => {
    /** Stubs the indexer and hands back both the recorded query and the mapped result. */
    async function adapterStatusFor(items: unknown[]) {
      const centrifuge = new Centrifuge({ environment: 'testnet' })
      const pool = new Pool(centrifuge, poolId.raw)
      const calls: { query: string; variables: any }[] = []
      sinon.stub(centrifuge as any, '_queryIndexer').callsFake((...args: unknown[]) => {
        calls.push({ query: args[0] as string, variables: args[1] })
        return of({ poolAdapters: { items } }) as any
      })
      return { calls, result: await firstValueFrom(pool.adapterStatus(OTHER_CENT_ID)) }
    }

    it('asks the indexer for this pool on the spoke→hub route', async () => {
      const { calls } = await adapterStatusFor([])
      // `local` is the queried (spoke) chain and `remote` the pool's hub — swapping them silently
      // reports the wrong direction's adapter set.
      expect(calls[0]!.variables).to.deep.equal({
        poolId: poolId.toString(),
        local: String(OTHER_CENT_ID),
        remote: String(CENT_ID),
      })
      expect(calls[0]!.query).to.contain('poolAdapters')
    })

    it('maps each adapter, lower-casing the address and naming an unlinked one', async () => {
      const { result } = await adapterStatusFor([
        {
          adapterAddress: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          isEnabled: true,
          crosschainInProgress: null,
          adapter: { name: 'wormhole' },
        },
        {
          adapterAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          isEnabled: null,
          crosschainInProgress: 'Enabled',
          adapter: null,
        },
      ])
      expect(result).to.deep.equal([
        {
          address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          name: 'wormhole',
          isEnabled: true,
          crosschainInProgress: null,
        },
        // A null `isEnabled` from the indexer is "not enabled", not "unknown" — the in-flight state
        // is carried by `crosschainInProgress` instead.
        {
          address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          name: 'unknown',
          isEnabled: false,
          crosschainInProgress: 'Enabled',
        },
      ])
    })

    it('returns an empty list when the pool has no adapters on that route', async () => {
      expect((await adapterStatusFor([])).result).to.deep.equal([])
    })
  })

  describe('pinned-artifact enforcement', () => {
    // A policy entry records the artifact it was approved against. Resolving by `workflowRef` alone
    // let an unrelated edit re-sign a strategist's whole root over a script nobody reviewed.
    const PINNED_ID = `0x${'1'.repeat(64)}`
    const CATALOG_ID = `0x${'2'.repeat(64)}`

    const withCatalogId = (ref: string, chainId: number, workflowId: string) =>
      ({ ...catalogEntry(ref, chainId), workflowId }) as MarketplaceWorkflow

    it('refuses to list a strategist whose pinned workflowId no longer matches the catalog', async () => {
      const { pool } = makePool({
        entries: [{ workflowRef: 'wf_a', workflowId: PINNED_ID }],
        catalog: [withCatalogId('wf_a', 100, CATALOG_ID)],
      })
      let error: Error | undefined
      await pool.listWorkflows({ strategist: STRATEGIST }).catch((e) => (error = e))
      expect(error?.message).to.match(/changed in the catalog since it was whitelisted/)
    })

    it('refuses when the pinned catalog version has moved', async () => {
      const { pool } = makePool({
        entries: [{ workflowRef: 'wf_a', version: 1 }],
        catalog: [{ ...catalogEntry('wf_a', 100), version: 7 } as MarketplaceWorkflow],
      })
      let error: Error | undefined
      await pool.listWorkflows({ strategist: STRATEGIST }).catch((e) => (error = e))
      expect(error?.message).to.match(/pinned to catalog version 1 .* version 7/)
    })

    it('allows an entry that still matches its pin', async () => {
      const { pool } = makePool({
        entries: [{ workflowRef: 'wf_a', workflowId: PINNED_ID, version: 1 }],
        catalog: [{ ...withCatalogId('wf_a', 100, PINNED_ID), version: 1 } as MarketplaceWorkflow],
      })
      expect((await pool.listWorkflows({ strategist: STRATEGIST })).map((row) => row.workflowRef)).to.deep.equal([
        'wf_a',
      ])
    })

    it('resolves an unpinned legacy entry by name, as before', async () => {
      // Entries written before these fields existed carry no pin; refusing them would strand
      // every policy created before the field.
      const { pool } = makePool({
        entries: [{ workflowRef: 'wf_a' }],
        catalog: [withCatalogId('wf_a', 100, CATALOG_ID)],
      })
      expect((await pool.listWorkflows({ strategist: STRATEGIST })).map((row) => row.workflowRef)).to.deep.equal([
        'wf_a',
      ])
    })

    it('lets an explicit re-pin through for the workflow being changed, but not its neighbours', async () => {
      // `addToPolicy` on a drifted workflow is the deliberate "update" action, so its own pin is
      // not enforced. A NEIGHBOUR that drifted still blocks the edit — the rebuilt root re-signs it.
      const { centrifuge, pool } = makePool({
        entries: [{ workflowRef: 'wf_a' }, { workflowRef: 'wf_b', workflowId: PINNED_ID }],
        catalog: [catalogEntry('wf_a', 100), withCatalogId('wf_b', 100, CATALOG_ID)],
      })
      // Enough of the write path to reach the rebuild loop, which is where the root is built.
      sinon.stub(PoolNetwork.prototype, 'onchainPM').returns(of({ updatePolicy: () => 'policy-tx' }) as any)
      sinon.stub(pool, 'updateMetadata').returns('metadata-tx' as any)
      const batch = sinon.stub(centrifuge, 'batchTransactions').returns('batched' as any)
      const scId = `0x${'0'.repeat(32)}` as HexString

      // Editing the drifted entry itself is the deliberate re-pin: allowed, and it batches.
      expect(await pool.addToPolicy({ strategist: STRATEGIST, workflowRef: 'wf_b', scId })).to.equal('batched')
      expect(batch.calledOnce).to.equal(true)

      // Editing the neighbour is refused: that root would re-authorize the drifted wf_b too.
      let neighbourEdit: Error | undefined
      await pool.addToPolicy({ strategist: STRATEGIST, workflowRef: 'wf_a', scId }).catch((e) => (neighbourEdit = e))
      expect(neighbourEdit?.message).to.match(/changed in the catalog since it was whitelisted/)
      expect(batch.calledOnce).to.equal(true)
    })
  })
})
