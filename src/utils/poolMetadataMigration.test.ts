import { expect } from 'chai'
import { mockPoolMetadata } from '../tests/mocks/mockPoolMetadata.js'
import { mockPoolMetadataV2 } from '../tests/mocks/mockPoolMetadataV2.js'
import type { PoolMetadataV1, PoolMetadataV2 } from '../types/poolMetadata.js'
import { isPoolMetadataV2 } from '../types/poolMetadata.js'
import { migratePoolMetadataToV2, parsePoolMetadataV2 } from './poolMetadataMigration.js'

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
          { type: 'Portfolio Manager', value: 'Janus Henderson Investors' }, // manager role -> Key facts
          { type: 'Custodian', value: 'J.P. Morgan' }, // -> Service providers
          { type: 'Auditor', value: 'MHA Cayman' }, // -> Service providers
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

  it('preserves engine fields verbatim', () => {
    const v2 = migratePoolMetadataToV2(legacyFixture())
    expect(v2.addressLabels).to.deep.equal({ '0xabc': 'Treasury' })
    expect(v2.workflowPolicies).to.deep.equal([])
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
          // 'Portfolio Manager' is a manager role, kept in Key facts.
          { label: 'Portfolio Manager', value: { kind: 'text', text: 'Janus Henderson Investors' } },
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
          { label: 'Custodian', value: { kind: 'text', text: 'J.P. Morgan' } },
          { label: 'Auditor', value: { kind: 'text', text: 'MHA Cayman' } },
        ],
      },
    ])
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

  it('projects description, details and rating reports into body blocks', () => {
    const { body } = migratePoolMetadataToV2(legacyFixture()).pool.factsheet!
    expect(body).to.deep.equal([
      { type: 'text', id: 'overview', title: 'Overview', body: 'A long issuer description.' },
      { type: 'text', id: 'detail-0', title: 'Strategy', body: 'We do things.' },
      { type: 'text', id: 'detail-1', title: 'Risks', body: 'Things can go wrong.' },
      { type: 'text', id: 'documents', title: 'Documents', body: '- [Moodys rating report](ipfs://Qm1)' },
      { type: 'section', id: 'performance', ref: 'onchainMetrics' },
    ])
  })

  it('drops unsafe document URI schemes and escapes the rating label', () => {
    const legacy = legacyFixture()
    legacy.pool.poolRatings = [
      { agency: 'Evil [x](javascript:alert(1))', reportFile: { uri: 'javascript:alert(1)', mime: 'text/html' } },
      { agency: 'Fitch', reportFile: { uri: 'https://x.io/r2', mime: 'application/pdf' } },
    ]
    const documents = migratePoolMetadataToV2(legacy).pool.factsheet!.body.find((b) => b.id === 'documents')
    expect(documents).to.deep.equal({
      type: 'text',
      id: 'documents',
      title: 'Documents',
      body: '- [Fitch rating report](https://x.io/r2)',
    })
  })

  it('omits the Documents block entirely when no rating has a safe URI', () => {
    const legacy = legacyFixture()
    legacy.pool.poolRatings = [{ agency: 'X', reportFile: { uri: 'javascript:alert(1)', mime: 'text/html' } }]
    const documents = migratePoolMetadataToV2(legacy).pool.factsheet!.body.find((b) => b.id === 'documents')
    expect(documents).to.equal(undefined)
  })

  it('omits sections (app renders defaults) when there is no holdings blob', () => {
    expect(migratePoolMetadataToV2(legacyFixture()).pool.factsheet!.sections).to.equal(undefined)
  })

  it('folds the legacy holdings blob into a table section, faithfully, dropping no column', () => {
    const legacy = legacyFixture()
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
    emptyHeaders.holdings = { headers: [], data: [{ x: 1 }] }
    expect(migratePoolMetadataToV2(emptyHeaders).pool.factsheet!.sections).to.equal(undefined)

    const missingData = legacyFixture()
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
})
