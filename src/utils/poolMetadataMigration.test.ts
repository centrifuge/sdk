import { expect } from 'chai'
import { mockPoolMetadata } from '../tests/mocks/mockPoolMetadata.js'
import { mockPoolMetadataV2 } from '../tests/mocks/mockPoolMetadataV2.js'
import type { PoolMetadataV1, PoolMetadataV2 } from '../types/poolMetadata.js'
import { isPoolMetadataV2 } from '../types/poolMetadata.js'
import { migratePoolMetadataToV2, parsePoolMetadataV2, resolveLinkTarget } from './poolMetadataMigration.js'

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** A legacy fixture with the display fields that drive the factsheet projection. */
function legacyFixture(): PoolMetadataV1 {
  return {
    version: 1,
    pool: {
      name: 'Legacy Pool',
      icon: null,
      asset: { class: 'Public credit', subClass: 'T-Bills' },
      investorType: 'Institutional',
      poolStructure: 'revolving',
      expenseRatio: '0.25',
      newInvestmentsStatus: { '0xabc': 'open' },
      issuer: {
        repName: 'Rep Name',
        name: 'Acme Issuer',
        description: 'A long issuer description.',
        email: 'ops@acme.io',
        logo: null,
        shortDescription: 'Acme',
        categories: [
          { type: 'Investment Manager', value: 'Anemoy Asset Management Ltd.' }, // absorbed by Issuer (dropped)
          { type: 'Sub-Investment Manager', value: 'Janus Henderson Investors' }, // -> Portfolio Manager (SP)
          { type: 'Fund Administrator', value: 'Trident Trust Company (Cayman) Ltd' }, // -> Service providers
          { type: 'Auditor', value: 'MHA Cayman ' }, // -> Service providers (trailing space, trimmed on migrate)
        ],
      },
      links: { executiveSummary: null },
      details: [
        { title: 'Strategy', body: 'We do things.' },
        { title: 'Risks', body: 'Things can go wrong.' },
      ],
      status: 'open',
      listed: true,
      reports: [{ author: { name: 'A', title: 'B', avatar: null }, uri: 'https://x.io/r' }],
      poolRatings: [
        {
          agency: 'Moodys',
          value: 'Aaa',
          reportUrl: 'https://x.io/r1',
          reportFile: { uri: 'ipfs://Qm1', mime: 'application/pdf' },
        },
        { agency: 'S&P', value: 'AAA' },
      ],
    },
    shareClasses: {
      '0x6756e091ae798a8e51e12e27ee8facdf': {
        minInitialInvestment: 2500,
        apy: 'target',
        weightedAverageMaturity: 63,
      },
      '0xda64aae939e4d3a981004619f1709d8f': { apy: '90day' },
    },
    onboarding: {
      kycRestrictedCountries: ['US'],
      kybRestrictedCountries: ['CN'],
      externalOnboardingUrl: 'https://onboard.io',
      shareClasses: {},
      taxInfoRequired: true,
    },
    loanTemplates: [{ id: 'tpl', createdAt: '2024-01-01' }],
    addressLabels: { '0xabc': 'Treasury' },
    workflowPolicies: [],
    withdrawManagers: {
      '0x6756e091ae798a8e51e12e27ee8facdf': [
        { assetAddress: '0xa0b8', chainId: '1', manager: '0x1a3b', label: 'C-AC' },
      ],
    },
  }
}

describe('migratePoolMetadataToV2', () => {
  it('stamps version 2', () => {
    expect(migratePoolMetadataToV2(legacyFixture()).version).to.equal(2)
  })

  it('drops fields unused by every consumer', () => {
    const v2 = migratePoolMetadataToV2(legacyFixture()) as unknown as Record<string, unknown>
    const pool = v2.pool as Record<string, unknown>
    expect(pool).to.not.have.property('newInvestmentsStatus')
    expect(pool).to.not.have.property('reports')
    expect(pool).to.not.have.property('details')
    expect(v2).to.not.have.property('loanTemplates')
    const issuer = pool.issuer as Record<string, unknown>
    expect(issuer).to.not.have.property('repName')
    expect(issuer).to.not.have.property('shortDescription')
    expect(issuer).to.not.have.property('description')
    expect(issuer).to.not.have.property('categories')
    expect(issuer).to.deep.equal({ name: 'Acme Issuer', email: 'ops@acme.io', logo: null })
  })

  it('narrows onboarding to restricted-country lists only', () => {
    const v2 = migratePoolMetadataToV2(legacyFixture())
    expect(v2.onboarding).to.deep.equal({ kycRestrictedCountries: ['US'], kybRestrictedCountries: ['CN'] })
  })

  it('maps legacy APY modes', () => {
    const v2 = migratePoolMetadataToV2(legacyFixture())
    expect(v2.shareClasses['0x6756e091ae798a8e51e12e27ee8facdf']!.apy).to.equal('fixed')
    expect(v2.shareClasses['0xda64aae939e4d3a981004619f1709d8f']!.apy).to.equal('90d365')
  })

  it('preserves engine fields verbatim (incl. withdrawManagers)', () => {
    const v2 = migratePoolMetadataToV2(legacyFixture())
    expect(v2.addressLabels).to.deep.equal({ '0xabc': 'Treasury' })
    expect(v2.workflowPolicies).to.deep.equal([])
    expect(v2.withdrawManagers).to.deep.equal({
      '0x6756e091ae798a8e51e12e27ee8facdf': [
        { assetAddress: '0xa0b8', chainId: '1', manager: '0x1a3b', label: 'C-AC' },
      ],
    })
  })

  it('carries pool.links.documents through migration', () => {
    const legacy = legacyFixture()
    legacy.pool.links = {
      executiveSummary: null,
      documents: [{ key: 'tos', label: 'Terms', href: 'https://x.io/tos' }],
    }
    const v2 = migratePoolMetadataToV2(legacy)
    expect(v2.pool.links.documents).to.deep.equal([{ key: 'tos', label: 'Terms', href: 'https://x.io/tos' }])
  })

  it('drops a stray pool.report (singular) non-schema field', () => {
    const legacy = legacyFixture()
    ;(legacy.pool as Record<string, unknown>).report = { author: { name: '', title: '', avatar: null }, url: '' }
    const v2 = migratePoolMetadataToV2(legacy)
    expect(v2.pool).to.not.have.property('report')
  })

  it('trims whitespace from migrated text values', () => {
    // legacyFixture's Auditor value carries a trailing space.
    const serviceProviders = migratePoolMetadataToV2(legacyFixture()).pool.factsheet!.keyFacts.find(
      (g) => g.id === 'service-providers'
    )
    const auditor = serviceProviders!.items.find((i) => i.label === 'Auditor')!
    expect(auditor.value).to.deep.equal({ kind: 'text', text: 'MHA Cayman' })
  })

  it('preserves poolRatings verbatim as a typed field (incl. reportFile)', () => {
    const v2 = migratePoolMetadataToV2(legacyFixture())
    expect(v2.pool.poolRatings).to.deep.equal([
      {
        agency: 'Moodys',
        value: 'Aaa',
        reportUrl: 'https://x.io/r1',
        reportFile: { uri: 'ipfs://Qm1', mime: 'application/pdf' },
      },
      { agency: 'S&P', value: 'AAA' },
    ])
  })

  it('projects a titled "Key facts" group (incl. seeded wallet infra + networks) and a "Service providers" group', () => {
    const { keyFacts } = migratePoolMetadataToV2(legacyFixture()).pool.factsheet!
    expect(keyFacts).to.deep.equal([
      {
        type: 'keyFactGroup',
        id: 'key-facts',
        title: 'Key facts',
        items: [
          { label: 'Issuer', value: { kind: 'text', text: 'Acme Issuer' } },
          { label: 'Asset type', value: { kind: 'text', text: 'Public credit - T-Bills' } },
          { label: 'APY', value: { kind: 'ref', ref: 'apy' } },
          { label: 'Pool structure', value: { kind: 'text', text: 'revolving' } },
          { label: 'Average asset maturity', value: { kind: 'text', text: '63 days' } },
          { label: 'Expense ratio', value: { kind: 'text', text: '0.25%' } },
          { label: 'Min. investment', value: { kind: 'text', text: '2,500' } },
          // Investment Manager is absorbed into Issuer (no row); the other three are service providers.
          { label: 'Wallet infrastructure', value: { kind: 'icons', icons: [{ source: 'app', key: 'fordefi' }] } },
          { label: 'Available networks', value: { kind: 'ref', ref: 'availableNetworks' } },
          { label: 'Ratings', value: { kind: 'ref', ref: 'ratings' } },
        ],
      },
      {
        type: 'keyFactGroup',
        id: 'service-providers',
        title: 'Service providers',
        items: [
          { label: 'Portfolio Manager', value: { kind: 'text', text: 'Janus Henderson Investors' } },
          { label: 'Fund Administrator', value: { kind: 'text', text: 'Trident Trust Company (Cayman) Ltd' } },
          { label: 'Auditor', value: { kind: 'text', text: 'MHA Cayman' } },
        ],
      },
    ])
  })

  it('absorbs the Investment Manager category into the Issuer key fact (drops its own row)', () => {
    const { keyFacts } = migratePoolMetadataToV2(legacyFixture()).pool.factsheet!
    const allItems = keyFacts.flatMap((g) => g.items)
    expect(allItems.filter((i) => i.label === 'Issuer')).to.have.length(1)
    expect(allItems.some((i) => i.value.kind === 'text' && i.value.text === 'Anemoy Asset Management Ltd.')).to.equal(
      false
    )
  })

  it('seeds wallet infrastructure + available networks even with no categories or ratings', () => {
    const legacy = legacyFixture()
    legacy.pool.issuer.categories = []
    legacy.pool.poolRatings = []
    const { keyFacts } = migratePoolMetadataToV2(legacy).pool.factsheet!
    expect(keyFacts).to.have.length(1) // no Service providers group
    const labels = keyFacts[0]!.items.map((i) => i.label)
    expect(labels).to.include('Wallet infrastructure')
    expect(labels).to.include('Available networks')
    expect(labels).to.not.include('Ratings')
  })

  it('migrates cleanly when issuer.categories is absent (real legacy docs omit it)', () => {
    const legacy = legacyFixture()
    delete (legacy.pool.issuer as Record<string, unknown>).categories
    expect(() => migratePoolMetadataToV2(legacy)).to.not.throw()
    const { keyFacts } = migratePoolMetadataToV2(legacy).pool.factsheet!
    expect(keyFacts).to.have.length(1) // Key facts only, no Service providers group
  })

  it('keeps unknown categories in "Key facts" and omits the Service providers group when none match', () => {
    const legacy = legacyFixture()
    legacy.pool.issuer.categories = [{ type: 'Historical default rate', value: '0%' }]
    const { keyFacts } = migratePoolMetadataToV2(legacy).pool.factsheet!
    expect(keyFacts).to.have.length(1)
    expect(keyFacts[0]!.title).to.equal('Key facts')
    expect(keyFacts[0]!.items.some((i) => i.label === 'Historical default rate')).to.equal(true)
  })

  it('matches service-provider category types case- and separator-insensitively', () => {
    const legacy = legacyFixture()
    legacy.pool.issuer.categories = [{ type: 'Fund_Administrator', value: 'Trident Trust' }]
    const groups = migratePoolMetadataToV2(legacy).pool.factsheet!.keyFacts
    const serviceProviders = groups.find((g) => g.id === 'service-providers')
    expect(serviceProviders?.items).to.deep.equal([
      { label: 'Fund Administrator', value: { kind: 'text', text: 'Trident Trust' } },
    ])
  })

  it('projects description and details into body blocks (no Documents block in body)', () => {
    const { body } = migratePoolMetadataToV2(legacyFixture()).pool.factsheet!
    expect(body).to.deep.equal([
      { type: 'text', id: 'overview', title: 'Overview', body: 'A long issuer description.' },
      { type: 'text', id: 'detail-0', title: 'Strategy', body: 'We do things.' },
      { type: 'text', id: 'detail-1', title: 'Risks', body: 'Things can go wrong.' },
      { type: 'section', id: 'performance', ref: 'onchainMetrics' },
    ])
  })

  it('builds the Overview card with logo and a Factsheet linkRef when those source fields exist', () => {
    const legacy = legacyFixture()
    legacy.pool.issuer.logo = { uri: 'ipfs://QmLogo', mime: 'image/png' }
    legacy.pool.links = { executiveSummary: { uri: 'ipfs://QmFactsheet', mime: 'application/pdf' } }
    const overview = migratePoolMetadataToV2(legacy).pool.factsheet!.body.find((b) => b.id === 'overview')
    expect(overview).to.deep.equal({
      type: 'text',
      id: 'overview',
      title: 'Overview',
      body: 'A long issuer description.',
      logo: { uri: 'ipfs://QmLogo', mime: 'image/png' },
      links: [{ label: 'Factsheet', target: { kind: 'linkRef', linkRef: 'executiveSummary' } }],
    })
  })

  it('omits the Overview logo and Factsheet link when their source fields are absent/empty', () => {
    const legacy = legacyFixture()
    legacy.pool.issuer.logo = { uri: '', mime: 'image/png' } // empty uri => treated as absent
    legacy.pool.links = { executiveSummary: null }
    const overview = migratePoolMetadataToV2(legacy).pool.factsheet!.body.find((b) => b.id === 'overview')
    expect(overview).to.deep.equal({
      type: 'text',
      id: 'overview',
      title: 'Overview',
      body: 'A long issuer description.',
    })
  })

  it('builds a Documents tile section (full-width) from rating reports, dropping unsafe URIs', () => {
    const legacy = legacyFixture()
    legacy.pool.poolRatings = [
      { agency: 'Evil', reportFile: { uri: 'javascript:alert(1)', mime: 'text/html' } },
      { agency: 'Fitch', reportFile: { uri: 'https://x.io/r2', mime: 'application/pdf' } },
    ]
    const { body, sections } = migratePoolMetadataToV2(legacy).pool.factsheet!
    expect(body.some((b) => b.id === 'documents')).to.equal(false) // not in the header region
    const documents = sections!.find((s) => s.id === 'documents')
    expect(documents).to.deep.equal({
      type: 'documents',
      id: 'documents',
      title: 'Documents',
      items: [
        {
          title: 'Fitch rating report',
          target: { kind: 'file', file: { uri: 'https://x.io/r2', mime: 'application/pdf' } },
        },
      ],
    })
  })

  it('omits the Documents block entirely when no rating has a safe report URI', () => {
    const legacy = legacyFixture()
    legacy.pool.poolRatings = [{ agency: 'X', reportFile: { uri: 'javascript:alert(1)', mime: 'text/html' } }]
    const { body, sections } = migratePoolMetadataToV2(legacy).pool.factsheet!
    expect(body.some((b) => b.id === 'documents')).to.equal(false)
    expect((sections ?? []).some((s) => s.id === 'documents')).to.equal(false)
  })

  it('omits sections (app renders defaults) when there is no documents block or holdings blob', () => {
    const legacy = legacyFixture()
    legacy.pool.poolRatings = [] // no rating reports => no Documents section
    expect(migratePoolMetadataToV2(legacy).pool.factsheet!.sections).to.equal(undefined)
  })

  it('folds the legacy holdings blob into a table section, faithfully, dropping no column', () => {
    const legacy = legacyFixture()
    legacy.pool.poolRatings = [] // isolate the holdings section
    legacy.holdings = {
      headers: ['Asset', 'ISIN', 'Amount'],
      data: [
        { Asset: 'T-Bill 2026', ISIN: 'US912796RW0', Amount: 1_000_000 },
        { Asset: 'T-Bill 2027', ISIN: null, Amount: '2500000' },
      ],
    }
    const v2 = migratePoolMetadataToV2(legacy)
    expect(v2.pool.factsheet!.sections).to.deep.equal([
      {
        type: 'table',
        id: 'holdings',
        title: 'Holdings',
        headers: ['Asset', 'ISIN', 'Amount'],
        rows: [
          ['T-Bill 2026', 'US912796RW0', 1_000_000], // number stays a number
          ['T-Bill 2027', '', '2500000'], // null -> '', numeric string stays a string
        ],
      },
    ])
    // holdings is no longer a top-level field on the v2 document.
    expect(v2).to.not.have.property('holdings')
  })

  it('skips the holdings table when headers are empty or data is missing', () => {
    const emptyHeaders = legacyFixture()
    emptyHeaders.pool.poolRatings = []
    emptyHeaders.holdings = { headers: [], data: [{ x: 1 }] }
    expect(migratePoolMetadataToV2(emptyHeaders).pool.factsheet!.sections).to.equal(undefined)

    const missingData = legacyFixture()
    missingData.pool.poolRatings = []
    missingData.holdings = { headers: ['A'] } as unknown as PoolMetadataV1['holdings']
    expect(migratePoolMetadataToV2(missingData).pool.factsheet!.sections).to.equal(undefined)
  })

  it('is idempotent and returns v2 input unchanged', () => {
    const once = migratePoolMetadataToV2(legacyFixture())
    const twice = migratePoolMetadataToV2(once)
    expect(twice).to.deep.equal(once)
    expect(migratePoolMetadataToV2(mockPoolMetadataV2)).to.equal(mockPoolMetadataV2)
  })

  it('migrates the shared v1 mock into a valid v2 document', () => {
    const v2 = migratePoolMetadataToV2(mockPoolMetadata)
    expect(isPoolMetadataV2(v2)).to.equal(true)
    expect(() => parsePoolMetadataV2(v2)).to.not.throw()
  })

  describe('intra-v2 upgrade (documents written by an earlier SDK)', () => {
    // The shape an SDK <= 1.16.0 produced: flat keyFacts, chart series/dataRef, top-level holdings.
    const oldV2 = () =>
      ({
        version: 2,
        pool: {
          name: 'Old V2 Pool',
          factsheet: {
            keyFacts: [
              { label: 'Issuer', value: 'Acme' },
              { label: 'APY', valueRef: 'apy' },
            ],
            body: [
              { type: 'chart', id: 'c1', chartType: 'line', series: [{ name: 's', data: [{ x: 1, y: 2 }] }] },
              { type: 'chart', id: 'c2', chartType: 'donut', dataRef: 'apyVsBenchmarks' },
              {
                type: 'tabGroup',
                id: 'tg',
                tabs: [
                  {
                    label: 'T',
                    block: {
                      type: 'chart',
                      id: 'c3',
                      chartType: 'bar',
                      series: [{ name: 's', data: [{ label: 'a', value: 1 }] }],
                    },
                  },
                ],
              },
            ],
          },
        },
        shareClasses: {},
        holdings: { headers: ['A'], data: [{ A: 'x' }] },
      }) as unknown as PoolMetadataV2

    it('upgrades flat keyFacts into a single Key facts group with discriminated values', () => {
      const { keyFacts } = migratePoolMetadataToV2(oldV2()).pool.factsheet!
      expect(keyFacts).to.deep.equal([
        {
          type: 'keyFactGroup',
          id: 'key-facts',
          title: 'Key facts',
          items: [
            { label: 'Issuer', value: { kind: 'text', text: 'Acme' } },
            { label: 'APY', value: { kind: 'ref', ref: 'apy' } },
          ],
        },
      ])
    })

    it('upgrades chart series/dataRef into discriminated data (incl. inside tab groups)', () => {
      const body = migratePoolMetadataToV2(oldV2()).pool.factsheet!.body
      const c1 = body.find((b) => b.id === 'c1') as Record<string, unknown>
      expect(c1.data).to.deep.equal({ kind: 'inline', series: [{ name: 's', data: [{ x: 1, y: 2 }] }] })
      expect(c1).to.not.have.property('series')
      const c2 = body.find((b) => b.id === 'c2') as Record<string, unknown>
      expect(c2.data).to.deep.equal({ kind: 'ref', dataRef: 'apyVsBenchmarks' })
      const tg = body.find((b) => b.id === 'tg') as { tabs: { block: Record<string, unknown> }[] }
      expect(tg.tabs[0]!.block.data).to.deep.equal({
        kind: 'inline',
        series: [{ name: 's', data: [{ label: 'a', value: 1 }] }],
      })
    })

    it('folds a top-level holdings blob into a factsheet table section and removes the top-level field', () => {
      const v2 = migratePoolMetadataToV2(oldV2())
      expect(v2).to.not.have.property('holdings')
      const holdings = v2.pool.factsheet!.sections!.find((s) => s.id === 'holdings')
      expect(holdings).to.deep.equal({
        type: 'table',
        id: 'holdings',
        title: 'Holdings',
        headers: ['A'],
        rows: [['x']],
      })
    })

    it('produces a document that passes the current validator, and is then idempotent', () => {
      const upgraded = migratePoolMetadataToV2(oldV2())
      expect(() => parsePoolMetadataV2(upgraded)).to.not.throw()
      // Already current shape -> returned unchanged (same reference).
      expect(migratePoolMetadataToV2(upgraded)).to.equal(upgraded)
    })
  })
})

describe('parsePoolMetadataV2', () => {
  it('accepts the v2 mock exercising every block type', () => {
    expect(() => parsePoolMetadataV2(mockPoolMetadataV2)).to.not.throw()
  })

  it('returns the input narrowed to v2', () => {
    expect(parsePoolMetadataV2(mockPoolMetadataV2)).to.equal(mockPoolMetadataV2)
  })

  it('rejects a non-v2 version', () => {
    expect(() => parsePoolMetadataV2({ version: 1, pool: { name: 'x' } })).to.throw(/pool metadata v2/)
  })

  it('rejects a missing pool name', () => {
    expect(() => parsePoolMetadataV2({ version: 2, pool: {} })).to.throw(/pool.name/)
  })

  it('rejects a chart whose data has an invalid kind', () => {
    const bad = clone(mockPoolMetadataV2)
    const chart = bad.pool.factsheet!.body.find((b) => b.id === 'inline-chart') as Record<string, unknown>
    chart.data = { kind: 'live' }
    expect(() => parsePoolMetadataV2(bad)).to.throw(/data has an invalid kind/)
  })

  it('rejects a chart missing its data object', () => {
    const bad = clone(mockPoolMetadataV2)
    const chart = bad.pool.factsheet!.body.find((b) => b.id === 'inline-chart') as Record<string, unknown>
    delete chart.data
    expect(() => parsePoolMetadataV2(bad)).to.throw(/data must be an object/)
  })

  it('rejects an unknown section ref (closed, SDK-enforced registry)', () => {
    const bad = clone(mockPoolMetadataV2)
    const section = bad.pool.factsheet!.body.find((b) => b.id === 'performance') as Record<string, unknown>
    section.ref = 'someFutureSection'
    expect(() => parsePoolMetadataV2(bad)).to.throw(/section ref/)
  })

  it('rejects columnVisibility not aligned to headers', () => {
    const bad = clone(mockPoolMetadataV2)
    const table = bad.pool.factsheet!.body.find((b) => b.id === 'fees') as Record<string, unknown>
    table.columnVisibility = ['public']
    expect(() => parsePoolMetadataV2(bad)).to.throw(/columnVisibility/)
  })

  it('rejects an invalid visibility value', () => {
    const bad = clone(mockPoolMetadataV2)
    bad.pool.factsheet!.keyFacts[0]!.visibility = 'secret' as never
    expect(() => parsePoolMetadataV2(bad)).to.throw(/visibility/)
  })

  it('accepts string subtitles on a block, a key-fact group and a tab block', () => {
    const ok = clone(mockPoolMetadataV2)
    ;(ok.pool.factsheet!.body[0] as Record<string, unknown>).subtitle = 'A block subtitle'
    ok.pool.factsheet!.keyFacts[0]!.subtitle = 'A group subtitle'
    const tabGroup = ok.pool.factsheet!.body.find((b) => b.id === 'tabs') as { tabs: { block: Record<string, unknown> }[] }
    tabGroup.tabs[0]!.block.subtitle = 'A tab subtitle'
    expect(() => parsePoolMetadataV2(ok)).to.not.throw()
  })

  it('rejects a non-string subtitle on a block', () => {
    const bad = clone(mockPoolMetadataV2)
    ;(bad.pool.factsheet!.body[0] as Record<string, unknown>).subtitle = 123
    expect(() => parsePoolMetadataV2(bad)).to.throw(/subtitle/)
  })

  it('rejects a non-string subtitle on a key-fact group', () => {
    const bad = clone(mockPoolMetadataV2)
    ;(bad.pool.factsheet!.keyFacts[0] as Record<string, unknown>).subtitle = 123
    expect(() => parsePoolMetadataV2(bad)).to.throw(/subtitle/)
  })

  it('rejects a non-string subtitle inside a tab block', () => {
    const bad = clone(mockPoolMetadataV2)
    const tabGroup = bad.pool.factsheet!.body.find((b) => b.id === 'tabs') as { tabs: { block: Record<string, unknown> }[] }
    tabGroup.tabs[0]!.block.subtitle = 123
    expect(() => parsePoolMetadataV2(bad)).to.throw(/subtitle/)
  })

  it('rejects a non-string title on a block', () => {
    const bad = clone(mockPoolMetadataV2)
    ;(bad.pool.factsheet!.body[0] as Record<string, unknown>).title = 123
    expect(() => parsePoolMetadataV2(bad)).to.throw(/title/)
  })

  it('rejects a block missing its id', () => {
    const bad = clone(mockPoolMetadataV2)
    delete (bad.pool.factsheet!.body[0] as Record<string, unknown>).id
    expect(() => parsePoolMetadataV2(bad)).to.throw(/\.id/)
  })

  it('rejects an unknown block type', () => {
    const bad = clone(mockPoolMetadataV2)
    ;(bad.pool.factsheet!.body[0] as Record<string, unknown>).type = 'video'
    expect(() => parsePoolMetadataV2(bad)).to.throw(/unknown block type/)
  })

  it('rejects an unknown chart data.dataRef (closed, SDK-enforced registry)', () => {
    const bad = clone(mockPoolMetadataV2)
    const chart = bad.pool.factsheet!.body.find((b) => b.id === 'live-chart') as Record<string, unknown>
    chart.data = { kind: 'ref', dataRef: 'someFutureDataset' }
    expect(() => parsePoolMetadataV2(bad)).to.throw(/data.dataRef is invalid/)
  })

  it('rejects an unknown live-table indexer metric (closed, SDK-enforced registry)', () => {
    const bad = clone(mockPoolMetadataV2)
    const live = bad.pool.factsheet!.body.find((b) => b.id === 'monthly') as { columns: Record<string, unknown>[] }
    live.columns[1]!.metric = 'someFutureMetric'
    expect(() => parsePoolMetadataV2(bad)).to.throw(/indexer metric/)
  })

  it('rejects a columns block in the body region (sections-only)', () => {
    const bad = clone(mockPoolMetadataV2)
    bad.pool.factsheet!.body.push({ type: 'columns', id: 'cols-in-body', left: [], right: [] } as never)
    expect(() => parsePoolMetadataV2(bad)).to.throw(/sections region/)
  })

  it('rejects a nested columns block inside a column', () => {
    const bad = clone(mockPoolMetadataV2)
    const cols = bad.pool.factsheet!.sections!.find((b) => b.id === 'risk') as { left: Record<string, unknown>[] }
    cols.left.push({ type: 'columns', id: 'nested', left: [], right: [] })
    expect(() => parsePoolMetadataV2(bad)).to.throw(/nested/)
  })

  it('rejects an app-owned section ref inside a column', () => {
    const bad = clone(mockPoolMetadataV2)
    const cols = bad.pool.factsheet!.sections!.find((b) => b.id === 'risk') as { right: Record<string, unknown>[] }
    cols.right.push({ type: 'section', id: 'sc', ref: 'smartContracts' })
    expect(() => parsePoolMetadataV2(bad)).to.throw(/section refs are not allowed inside a column/)
  })

  it('rejects an invalid columns ratio', () => {
    const bad = clone(mockPoolMetadataV2)
    const cols = bad.pool.factsheet!.sections!.find((b) => b.id === 'risk') as Record<string, unknown>
    cols.ratio = '5:1'
    expect(() => parsePoolMetadataV2(bad)).to.throw(/ratio/)
  })

  it('rejects an invalid kpiGroup variant', () => {
    const bad = clone(mockPoolMetadataV2)
    const kpi = bad.pool.factsheet!.body.find((b) => b.id === 'kpis') as Record<string, unknown>
    kpi.variant = 'fancy'
    expect(() => parsePoolMetadataV2(bad)).to.throw(/variant/)
  })

  it('rejects a non-string kpiGroup item delta', () => {
    const bad = clone(mockPoolMetadataV2)
    const kpi = bad.pool.factsheet!.body.find((b) => b.id === 'kpis') as { items: Record<string, unknown>[] }
    kpi.items[0]!.delta = 123
    expect(() => parsePoolMetadataV2(bad)).to.throw(/delta/)
  })

  it('rejects a non-string kpiGroup item secondary', () => {
    const bad = clone(mockPoolMetadataV2)
    const kpi = bad.pool.factsheet!.body.find((b) => b.id === 'kpis') as { items: Record<string, unknown>[] }
    kpi.items[0]!.secondary = 123
    expect(() => parsePoolMetadataV2(bad)).to.throw(/secondary/)
  })

  it('tolerates a pool with no factsheet', () => {
    const minimal: PoolMetadataV2 = {
      version: 2,
      pool: { ...mockPoolMetadataV2.pool, factsheet: undefined },
      shareClasses: {},
    }
    expect(() => parsePoolMetadataV2(minimal)).to.not.throw()
  })

  it('rejects a flat KeyFact[] right column (groups only, no back-compat)', () => {
    const bad = clone(mockPoolMetadataV2)
    bad.pool.factsheet!.keyFacts = [{ label: 'Issuer', value: { kind: 'text', text: 'x' } }] as never
    expect(() => parsePoolMetadataV2(bad)).to.throw(/keyFacts\[0\].type must be 'keyFactGroup'/)
  })

  it('rejects a key fact whose value has an unknown kind', () => {
    const bad = clone(mockPoolMetadataV2)
    bad.pool.factsheet!.keyFacts[0]!.items[0]!.value = { kind: 'live' } as never
    expect(() => parsePoolMetadataV2(bad)).to.throw(/value has an invalid kind/)
  })

  it('rejects an unknown KeyFactValue ref (closed, SDK-enforced registry)', () => {
    const bad = clone(mockPoolMetadataV2)
    bad.pool.factsheet!.keyFacts[0]!.items[0]!.value = { kind: 'ref', ref: 'someFutureRef' } as never
    expect(() => parsePoolMetadataV2(bad)).to.throw(/value.ref is invalid/)
  })

  it('accepts the known KeyFactValue refs apy and availableNetworks', () => {
    const ok = clone(mockPoolMetadataV2)
    ok.pool.factsheet!.keyFacts[0]!.items[0]!.value = { kind: 'ref', ref: 'availableNetworks' }
    expect(() => parsePoolMetadataV2(ok)).to.not.throw()
  })

  it('rejects an icons key fact with a malformed IconRef', () => {
    const bad = clone(mockPoolMetadataV2)
    bad.pool.factsheet!.keyFacts[1]!.items[0]!.value = { kind: 'icons', icons: [{ source: 'nope' }] } as never
    expect(() => parsePoolMetadataV2(bad)).to.throw(/icons\[0\] has an invalid source/)
  })

  it('accepts both app and metadata IconRefs (app icon key is shape-validated)', () => {
    const ok = clone(mockPoolMetadataV2)
    ok.pool.factsheet!.keyFacts[1]!.items[0]!.value = {
      kind: 'icons',
      icons: [
        { source: 'app', key: 'any-future-icon', label: 'X' },
        { source: 'metadata', file: { uri: 'ipfs://Qm', mime: 'image/svg+xml' } },
      ],
    }
    expect(() => parsePoolMetadataV2(ok)).to.not.throw()
  })

  it('rejects a key fact group missing items', () => {
    const bad = clone(mockPoolMetadataV2)
    delete (bad.pool.factsheet!.keyFacts[0] as Record<string, unknown>).items
    expect(() => parsePoolMetadataV2(bad)).to.throw(/keyFacts\[0\].items must be an array/)
  })

  // --- #482: geo-restrictions, documents/accordion blocks, link targets, combined visibility ---

  it('accepts geo-restricted visibility (single + combined) and a valid geoRestrictions list', () => {
    expect(() => parsePoolMetadataV2(mockPoolMetadataV2)).to.not.throw()
  })

  it('accepts geo-restricted elements even when pool.geoRestrictions is absent (nothing restricted)', () => {
    const doc = clone(mockPoolMetadataV2)
    delete (doc.pool as Record<string, unknown>).geoRestrictions
    expect(() => parsePoolMetadataV2(doc)).to.not.throw()
  })

  it('rejects geoRestrictions regions that are not ISO 3166-1 alpha-2', () => {
    const bad = clone(mockPoolMetadataV2)
    bad.pool.geoRestrictions = { regions: ['US', 'USA'] }
    expect(() => parsePoolMetadataV2(bad)).to.throw(/geoRestrictions.regions\[1\] must be an ISO 3166-1 alpha-2 code/)
  })

  it('rejects an invalid visibility scalar', () => {
    const bad = clone(mockPoolMetadataV2)
    bad.pool.factsheet!.keyFacts[0]!.visibility = 'continent-blocked' as never
    expect(() => parsePoolMetadataV2(bad)).to.throw(/visibility/)
  })

  it('rejects a visibility array containing a non-gate (public/hidden or unknown)', () => {
    const bad = clone(mockPoolMetadataV2)
    bad.pool.factsheet!.keyFacts[0]!.visibility = ['whitelisted', 'public'] as never
    expect(() => parsePoolMetadataV2(bad)).to.throw(/invalid visibility gate/)
  })

  it('rejects a visibility array with duplicate gates', () => {
    const bad = clone(mockPoolMetadataV2)
    bad.pool.factsheet!.keyFacts[0]!.visibility = ['whitelisted', 'whitelisted'] as never
    expect(() => parsePoolMetadataV2(bad)).to.throw(/duplicate visibility gate/)
  })

  it('rejects an empty visibility array', () => {
    const bad = clone(mockPoolMetadataV2)
    bad.pool.factsheet!.keyFacts[0]!.visibility = [] as never
    expect(() => parsePoolMetadataV2(bad)).to.throw(/visibility array must not be empty/)
  })

  it('rejects a link target with an unknown kind', () => {
    const bad = clone(mockPoolMetadataV2)
    const docs = bad.pool.factsheet!.body.find((b) => b.id === 'docs') as { items: Record<string, unknown>[] }
    docs.items[0]!.target = { kind: 'mailto', mailto: 'x@y.z' }
    expect(() => parsePoolMetadataV2(bad)).to.throw(/target has an invalid kind/)
  })

  it('rejects a documents item missing its target', () => {
    const bad = clone(mockPoolMetadataV2)
    const docs = bad.pool.factsheet!.body.find((b) => b.id === 'docs') as { items: Record<string, unknown>[] }
    delete docs.items[0]!.target
    expect(() => parsePoolMetadataV2(bad)).to.throw(/items\[0\].target must be an object/)
  })

  it('rejects an accordion item whose inner block is not a leaf type', () => {
    const bad = clone(mockPoolMetadataV2)
    const accordion = bad.pool.factsheet!.body.find((b) => b.id === 'details-accordion') as {
      items: { block: Record<string, unknown> }[]
    }
    accordion.items[0]!.block = { type: 'documents', id: 'nope', items: [] }
    expect(() => parsePoolMetadataV2(bad)).to.throw(/block has an invalid type/)
  })

  it('rejects an accordion item with a non-boolean defaultOpen', () => {
    const bad = clone(mockPoolMetadataV2)
    const accordion = bad.pool.factsheet!.body.find((b) => b.id === 'details-accordion') as {
      items: Record<string, unknown>[]
    }
    accordion.items[0]!.defaultOpen = 'yes'
    expect(() => parsePoolMetadataV2(bad)).to.throw(/defaultOpen must be a boolean/)
  })

  it('rejects an overview text-block link with a malformed target', () => {
    const bad = clone(mockPoolMetadataV2)
    const overview = bad.pool.factsheet!.body.find((b) => b.id === 'overview') as {
      links: { target: unknown }[]
    }
    overview.links[0]!.target = { kind: 'linkRef' } // missing linkRef string
    expect(() => parsePoolMetadataV2(bad)).to.throw(/linkRef must be a string/)
  })

  // --- pool.links.documents (reusable named documents) ---

  it('accepts pool.links.documents (file and href docs)', () => {
    expect(() => parsePoolMetadataV2(mockPoolMetadataV2)).to.not.throw()
  })

  it('rejects a link document setting both file and href', () => {
    const bad = clone(mockPoolMetadataV2)
    bad.pool.links!.documents = [
      { key: 'x', label: 'X', file: { uri: 'ipfs://Q', mime: 'application/pdf' }, href: 'https://x.io' },
    ]
    expect(() => parsePoolMetadataV2(bad)).to.throw(/exactly one of `file` or `href`/)
  })

  it('rejects a link document setting neither file nor href', () => {
    const bad = clone(mockPoolMetadataV2)
    bad.pool.links!.documents = [{ key: 'x', label: 'X' } as never]
    expect(() => parsePoolMetadataV2(bad)).to.throw(/exactly one of `file` or `href`/)
  })

  it('rejects duplicate link-document keys', () => {
    const bad = clone(mockPoolMetadataV2)
    bad.pool.links!.documents = [
      { key: 'dup', label: 'A', href: 'https://a.io' },
      { key: 'dup', label: 'B', href: 'https://b.io' },
    ]
    expect(() => parsePoolMetadataV2(bad)).to.throw(/is duplicated/)
  })

  it('rejects a link-document key colliding with a built-in', () => {
    const bad = clone(mockPoolMetadataV2)
    bad.pool.links!.documents = [{ key: 'website', label: 'W', href: 'https://w.io' }]
    expect(() => parsePoolMetadataV2(bad)).to.throw(/collides with a built-in/)
  })

  it('rejects a link document with an empty key', () => {
    const bad = clone(mockPoolMetadataV2)
    bad.pool.links!.documents = [{ key: '', label: 'X', href: 'https://x.io' }]
    expect(() => parsePoolMetadataV2(bad)).to.throw(/key must be a non-empty string/)
  })
})

describe('resolveLinkTarget', () => {
  const links = mockPoolMetadataV2.pool.links

  it('resolves inline file and href targets', () => {
    expect(
      resolveLinkTarget(links, { kind: 'file', file: { uri: 'ipfs://Q', mime: 'application/pdf' } })
    ).to.deep.equal({
      file: { uri: 'ipfs://Q', mime: 'application/pdf' },
    })
    expect(resolveLinkTarget(links, { kind: 'href', href: 'https://x.io' })).to.deep.equal({ href: 'https://x.io' })
  })

  it('resolves built-in linkRefs (executiveSummary -> file, website/forum -> url)', () => {
    expect(resolveLinkTarget(links, { kind: 'linkRef', linkRef: 'executiveSummary' })).to.deep.equal({
      file: links.executiveSummary,
    })
    expect(resolveLinkTarget(links, { kind: 'linkRef', linkRef: 'website' })).to.deep.equal({
      href: 'https://newsilver.com',
    })
    expect(resolveLinkTarget(links, { kind: 'linkRef', linkRef: 'forum' })).to.deep.equal({
      href: 'https://gov.centrifuge.io/tag/newsilver',
    })
  })

  it('resolves named documents by key (file or href)', () => {
    expect(resolveLinkTarget(links, { kind: 'linkRef', linkRef: 'prospectus' })).to.deep.equal({
      file: { uri: 'ipfs://QmProspectusDoc', mime: 'application/pdf' },
    })
    expect(resolveLinkTarget(links, { kind: 'linkRef', linkRef: 'termsOfService' })).to.deep.equal({
      href: 'https://example.com/tos',
    })
  })

  it('returns null for an unknown linkRef or missing links', () => {
    expect(resolveLinkTarget(links, { kind: 'linkRef', linkRef: 'nope' })).to.equal(null)
    expect(resolveLinkTarget(undefined, { kind: 'linkRef', linkRef: 'website' })).to.equal(null)
  })
})
