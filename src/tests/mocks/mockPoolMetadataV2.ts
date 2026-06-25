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
    poolRatings: [{ agency: 'Fake Agency', value: 'AAA', reportUrl: 'https://example.com/rating' }],
    factsheet: {
      keyFacts: [
        { label: 'Issuer', value: 'Fake Issuer' },
        { label: 'Asset type', value: 'Private credit - Fake Subclass' },
        { label: 'APY', valueRef: 'apy', tooltip: 'Net of fees' },
        { label: 'Secret fact', value: 'hidden value', visibility: 'whitelisted' },
      ],
      body: [
        { type: 'text', id: 'overview', title: 'Overview', body: 'Fake **overview** with a [link](https://x.io).' },
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
          series: [
            {
              name: 'Allocation',
              data: [
                { label: 'Cash', value: 40 },
                { label: 'Loans', value: 60 },
              ],
            },
          ],
          legend: true,
        },
        {
          type: 'chart',
          id: 'live-chart',
          title: 'APY vs benchmarks',
          chartType: 'line',
          dataRef: 'apyVsBenchmarks',
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
