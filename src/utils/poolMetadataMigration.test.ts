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
          { type: 'Trustee', value: 'Acme Trust' },
          { type: 'Auditor', value: 'Acme Audit' },
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

  it('strips reportFile from kept poolRatings', () => {
    const v2 = migratePoolMetadataToV2(legacyFixture())
    expect(v2.pool.poolRatings).to.deep.equal([
      { agency: 'Moodys', value: 'Aaa', reportUrl: 'https://x.io/r1' },
      { agency: 'S&P', value: 'AAA' },
    ])
  })

  it('projects key facts in order, including valueRef apy and categories', () => {
    const { keyFacts } = migratePoolMetadataToV2(legacyFixture()).pool.factsheet!
    expect(keyFacts).to.deep.equal([
      { label: 'Issuer', value: 'Acme Issuer' },
      { label: 'Asset type', value: 'Public credit - T-Bills' },
      { label: 'APY', valueRef: 'apy' },
      { label: 'Pool structure', value: 'revolving' },
      { label: 'Average asset maturity', value: '63 days' },
      { label: 'Expense ratio', value: '0.25%' },
      { label: 'Min. investment', value: '2,500' },
      { label: 'Trustee', value: 'Acme Trust' },
      { label: 'Auditor', value: 'Acme Audit' },
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

  it('omits sections so the app renders defaults', () => {
    expect(migratePoolMetadataToV2(legacyFixture()).pool.factsheet!.sections).to.equal(undefined)
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

  it('rejects a chart with both series and dataRef', () => {
    const bad = clone(mockPoolMetadataV2)
    const chart = bad.pool.factsheet!.body.find((b) => b.id === 'live-chart') as Record<string, unknown>
    chart.series = [{ name: 's', data: [{ label: 'a', value: 1 }] }]
    expect(() => parsePoolMetadataV2(bad)).to.throw(/exactly one of/)
  })

  it('rejects a chart with neither series nor dataRef', () => {
    const bad = clone(mockPoolMetadataV2)
    const chart = bad.pool.factsheet!.body.find((b) => b.id === 'inline-chart') as Record<string, unknown>
    delete chart.series
    expect(() => parsePoolMetadataV2(bad)).to.throw(/exactly one of/)
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

  it('rejects an unknown chart dataRef (closed, SDK-enforced registry)', () => {
    const bad = clone(mockPoolMetadataV2)
    const chart = bad.pool.factsheet!.body.find((b) => b.id === 'live-chart') as Record<string, unknown>
    chart.dataRef = 'someFutureDataset'
    expect(() => parsePoolMetadataV2(bad)).to.throw(/dataRef is invalid/)
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
})
