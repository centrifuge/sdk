import { PoolMetadataV2 } from '../../types/poolMetadata.js'

/**
 * A v2 fixture exercising every content block type, a `liveTable`, a `section` ref, a
 * `valueRef: 'apy'` key fact, and `visibility` at block / key-fact / column granularity.
 */
export const mockPoolMetadataV2: PoolMetadataV2 = {
  version: 2,
  pool: {
    name: 'Fake Pool',
    icon: {
      uri: 'ipfs://QmVxA2MaBMUsZMgxBcfg5VdrF4FJAVW26U9s3mY9oH7wMs',
      mime: 'image/svg+xml',
    },
    asset: {
      class: 'Private credit',
      subClass: 'Fake Subclass',
    },
    issuer: {
      name: 'Fake Issuer',
      email: 'fake@issuer.com',
      logo: {
        uri: 'ipfs://QmZB95usKnoSHEwG9s61gYWqgxbYyq7NAdo24XEowqJtFS',
        mime: 'image/png',
      },
    },
    links: {
      executiveSummary: {
        uri: 'ipfs://QmRQqb11SnqpSHwPcsgmgGWCv8GKfALgX53KLbvf6iur5Y',
        mime: 'application/pdf',
      },
      forum: 'https://gov.centrifuge.io/tag/newsilver',
      website: 'https://newsilver.com',
      documents: [
        { key: 'prospectus', label: 'Prospectus', file: { uri: 'ipfs://QmProspectusDoc', mime: 'application/pdf' } },
        { key: 'termsOfService', label: 'Terms of Service', href: 'https://example.com/tos' },
      ],
    },
    status: 'open',
    listed: true,
    poolFees: [
      {
        name: 'Protocol fee (Private Credit & Securities)',
        id: 3,
        feePosition: 'Top of waterfall',
        feeType: 'fixed',
      },
    ],
    investorType: 'Fake Investor Type',
    poolStructure: 'Fake Structure',
    poolRatings: [
      {
        agency: 'Fake Agency',
        value: 'AAA',
        reportUrl: 'https://example.com/rating',
        reportFile: { uri: 'ipfs://QmRatingReport', mime: 'application/pdf' },
      },
    ],
    geoRestrictions: { regions: ['US', 'KP'] },
    factsheet: {
      keyFacts: [
        {
          type: 'keyFactGroup',
          id: 'overview-facts',
          title: 'Overview',
          items: [
            { label: 'Issuer', value: { kind: 'text', text: 'Fake Issuer' } },
            { label: 'Asset type', value: { kind: 'text', text: 'Private credit - Fake Subclass' } },
            { label: 'APY', value: { kind: 'ref', ref: 'apy' }, tooltip: 'Net of fees' },
            { label: 'Networks', value: { kind: 'ref', ref: 'availableNetworks' } },
            { label: 'Ratings', value: { kind: 'ref', ref: 'ratings' } },
          ],
        },
        {
          type: 'keyFactGroup',
          id: 'trust-facts',
          items: [
            {
              label: 'Custody',
              value: {
                kind: 'icons',
                icons: [
                  { source: 'app', key: 'fordefi', label: 'Fordefi' },
                  { source: 'metadata', file: { uri: 'ipfs://QmRatingIcon', mime: 'image/svg+xml' }, alt: 'Moody’s' },
                ],
              },
            },
            { label: 'Secret fact', value: { kind: 'text', text: 'hidden value' }, visibility: 'whitelisted' },
            // Combined gates: shown only to a whitelisted wallet in an allowed region.
            {
              label: 'Restricted yield',
              value: { kind: 'text', text: '12%' },
              visibility: ['whitelisted', 'geo-restricted'],
            },
          ],
        },
      ],
      body: [
        {
          type: 'text',
          id: 'overview',
          title: 'Overview',
          body: 'Fake **overview** with a [link](https://x.io).',
          logo: { uri: 'ipfs://QmBrandLogo', mime: 'image/svg+xml' },
          background: '#0b1f3a',
          links: [
            { label: 'Factsheet', target: { kind: 'linkRef', linkRef: 'executiveSummary' } },
            { label: 'Website', target: { kind: 'href', href: 'https://newsilver.com' } },
          ],
        },
        {
          type: 'table',
          id: 'fees',
          title: 'Fees',
          headers: ['Name', 'Amount'],
          rows: [
            ['Management', '0.5%'],
            ['Performance', '10%'],
          ],
          columnVisibility: ['public', 'whitelisted'],
          caption: 'Fee schedule',
        },
        {
          type: 'chart',
          id: 'inline-chart',
          title: 'Allocation',
          chartType: 'donut',
          data: {
            kind: 'inline',
            series: [
              {
                name: 'Allocation',
                data: [
                  { label: 'Cash', value: 40 },
                  { label: 'Loans', value: 60 },
                ],
              },
            ],
          },
          legend: true,
        },
        {
          type: 'chart',
          id: 'live-chart',
          title: 'APY vs benchmarks',
          chartType: 'line',
          data: { kind: 'ref', dataRef: 'apyVsBenchmarks' },
          xAxis: { label: 'Date', type: 'time' },
          yAxis: { label: 'APY', format: 'percent' },
        },
        {
          type: 'image',
          id: 'diagram',
          file: { uri: 'ipfs://QmFakeImage', mime: 'image/png' },
          alt: 'Structure diagram',
        },
        {
          type: 'kpiGroup',
          id: 'kpis',
          columns: 3,
          items: [
            { label: 'TVL', value: '$10M' },
            { label: 'Investors', value: '120', trend: 'up' },
            { label: 'Hidden KPI', value: 'secret', visibility: 'hidden' },
          ],
        },
        {
          type: 'tabGroup',
          id: 'tabs',
          tabs: [
            { label: 'Summary', block: { type: 'text', id: 'tab-summary', body: 'Tab body text.' } },
            {
              label: 'Numbers',
              block: { type: 'kpiGroup', id: 'tab-kpis', items: [{ label: 'NAV', value: '$1.02' }] },
            },
          ],
        },
        {
          type: 'liveTable',
          id: 'monthly',
          title: 'Monthly summary',
          dataRef: 'monthlySummary',
          columns: [
            { header: 'Month', source: 'static', values: ['Jan', 'Feb', 'Mar'] },
            { header: 'Token price', source: 'indexer', metric: 'tokenPrice', format: 'currency' },
            { header: 'NAV', source: 'indexer', metric: 'nav', format: 'currency', visibility: 'whitelisted' },
            { header: 'Note', source: 'hardcoded', key: 'note' },
          ],
          caption: 'Recent months',
        },
        {
          type: 'documents',
          id: 'docs',
          title: 'Documents',
          items: [
            { title: 'Fact Sheet', target: { kind: 'linkRef', linkRef: 'executiveSummary' } },
            {
              title: 'Prospectus',
              target: { kind: 'file', file: { uri: 'ipfs://QmProspectus', mime: 'application/pdf' } },
            },
            { title: 'Terms', target: { kind: 'href', href: 'https://example.com/terms' } },
          ],
        },
        {
          type: 'accordion',
          id: 'details-accordion',
          title: 'Details',
          items: [
            {
              title: 'Overview',
              defaultOpen: true,
              block: { type: 'text', id: 'acc-overview', body: 'Accordion text.' },
            },
            {
              title: 'Characteristics',
              block: { type: 'kpiGroup', id: 'acc-kpis', items: [{ label: 'Duration', value: '0.2y' }] },
            },
          ],
        },
        {
          type: 'text',
          id: 'geo-note',
          title: 'Regional note',
          body: 'Shown only outside restricted regions.',
          visibility: 'geo-restricted',
        },
        { type: 'section', id: 'performance', ref: 'onchainMetrics' },
      ],
      sections: [
        {
          type: 'table',
          id: 'holdings',
          title: 'Holdings',
          headers: ['Asset', 'ISIN', 'Amount'],
          rows: [
            ['T-Bill 2026', 'US912796RW0', 1_000_000],
            ['T-Bill 2027', '', 2_500_000],
          ],
        },
        { type: 'section', id: 'contracts', ref: 'smartContracts', visibility: 'public' },
      ],
    },
  },
  shareClasses: {
    '0x6756e091ae798a8e51e12e27ee8facdf': {
      minInitialInvestment: 2500,
      apyPercentage: 16,
      apy: 'fixed',
    },
    '0xda64aae939e4d3a981004619f1709d8f': {
      minInitialInvestment: 5000,
      apy: '30d365',
    },
  },
  onboarding: {
    kycRestrictedCountries: [],
    kybRestrictedCountries: [],
  },
}
