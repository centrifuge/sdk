import { PoolMetadata } from '../../types/poolMetadata.js'

export const mockPoolMetadata: PoolMetadata = {
  version: 1,
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
      repName: '',
      description: 'Fake Description',
      email: 'fake@issuer.com',
      logo: {
        uri: 'ipfs://QmZB95usKnoSHEwG9s61gYWqgxbYyq7NAdo24XEowqJtFS',
        mime: 'image/png',
      },
      shortDescription: 'Fake Short Description',
      categories: [
        {
          type: 'trustee',
          value: 'Fake Trustee',
          customType: '',
        },
        {
          type: 'historicalDefaultRate',
          value: '0',
          customType: '',
        },
      ],
    },
    links: {
      executiveSummary: {
        uri: 'ipfs://QmRQqb11SnqpSHwPcsgmgGWCv8GKfALgX53KLbvf6iur5Y',
        mime: 'application/pdf',
      },
      forum: 'https://gov.centrifuge.io/tag/newsilver',
      website: 'https://newsilver.com',
    },
    details: [],
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
    reports: [
      {
        author: {
          avatar: null,
          name: 'Fake Author',
          title: 'Fake Title',
        },
        uri: 'https://gov.centrifuge.io/t/fake-report',
      },
    ],
    investorType: 'Fake Investor Type',
    poolStructure: 'Fake Structure',
    poolRatings: [],
  },
  shareClasses: {
    '0x6756e091ae798a8e51e12e27ee8facdf': {
      minInitialInvestment: 2500,
      apyPercentage: 16,
      apy: 'target',
    },
    '0xda64aae939e4d3a981004619f1709d8f': {
      minInitialInvestment: 5000,
      apy: 'target',
    },
  },
  onboarding: {
    shareClasses: {
      '0x6756e091ae798a8e51e12e27ee8facdf': {
        agreement: {
          uri: 'https://ipfs.centrifuge.io/ipfs/QmNbrzAHKKYtPCoY6g4WfxXnuWRdMdWRXm64LfQz5sYHAw',
          mime: 'application/pdf',
        },
        openForOnboarding: false,
      },
      '0xda64aae939e4d3a981004619f1709d8f': {
        agreement: {
          uri: 'https://ipfs.centrifuge.io/ipfs/QmV3cXT38k45VeEYXQRfRPDza1wLf5pnjxy79D2RudMUrG',
          mime: 'application/pdf',
        },
        openForOnboarding: true,
      },
    },
    kycRestrictedCountries: [],
    kybRestrictedCountries: [],
    taxInfoRequired: true,
  },
  loanTemplates: [
    {
      id: 'QmZ1FUqhaUxaRRT3czJJSseLZ1GqCFoQfgszRQybWkBTs1',
      createdAt: '2024-07-03T17:12:11.404Z',
    },
  ],
}
