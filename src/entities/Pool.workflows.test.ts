import { expect } from 'chai'
import { of } from 'rxjs'
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
  entries?: { workflowRef: string; configurableValues?: Record<string, HexString>; excludedActions?: number[] }[]
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
})
