import { PoolMetadata } from '../../types/poolMetadata.js'

export const mockPoolMetadata: PoolMetadata = {
  version: 1,
  pool: {
    name: 'New Silver Series 3',
    icon: {
      uri: 'ipfs://QmVxA2MaBMUsZMgxBcfg5VdrF4FJAVW26U9s3mY9oH7wMs',
      mime: 'image/svg+xml',
    },
    asset: {
      class: 'Private credit',
      subClass: 'Residential real estate',
    },
    issuer: {
      name: 'NS Pool 3 LLC',
      repName: 'Kirill Bensonoff',
      description:
        'Founded in 2018, New Silver is a technology enabled non-bank lender primarily focused on financing residential real estate investments in the United States. Loans are for commercial use only, and are secured by the subject property. Funds are typically used for purchase and construction of single family or small multi-family developments. Typical loan term is 12-24 months.\n',
      email: 'investors@newsilver.com',
      logo: {
        uri: 'ipfs://QmZB95usKnoSHEwG9s61gYWqgxbYyq7NAdo24XEowqJtFS',
        mime: 'image/png',
      },
      shortDescription: 'A US tech-enabled non-bank lender, offers 12-24 month loans for US real estate investors',
      categories: [
        {
          type: 'trustee',
          value: 'Ankura Trust ',
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
          name: 'Fang Zhang',
          title: 'Member of the Centrifuge Credit Group',
        },
        uri: 'https://gov.centrifuge.io/t/pop-report-new-silver-ns3/5869',
      },
    ],
    investorType: 'Qualified US and non-US investors',
    poolStructure: 'Revolving',
    poolRatings: [],
  },
  pod: {
    indexer: 'https://pod-centrifuge.k-f.dev',
  },
  tranches: {
    '0x6756e091ae798a8e51e12e27ee8facdf': {
      minInitialInvestment: '25000000000',
      targetAPY: '16',
    },
    '0xda64aae939e4d3a981004619f1709d8f': {
      minInitialInvestment: '5000000000',
    },
  },
  adminMultisig: {
    signers: [
      '5F3quVAnmP1uc2v5zLyXLH3JxNLzXeHXDg5j9ScrvbvHGuJW',
      '5FpnSw6TPjnebvxiQfainnoS5k8gC9h7F2AyQmbVyy6RhM9E',
      '5GqHmRkfWnKrCgoR2yfdqgsgvQj9X4rfMb7jgP4Lca1f39s9',
    ],
    threshold: 2,
  },
  onboarding: {
    tranches: {
      '0x6756e091ae798a8e51e12e27ee8facdf': {
        agreement: {
          uri: 'https://centrifuge.mypinata.cloud/ipfs/QmNbrzAHKKYtPCoY6g4WfxXnuWRdMdWRXm64LfQz5sYHAw',
          mime: 'application/pdf',
        },
        openForOnboarding: false,
      },
      '0xda64aae939e4d3a981004619f1709d8f': {
        agreement: {
          uri: 'https://centrifuge.mypinata.cloud/ipfs/QmV3cXT38k45VeEYXQRfRPDza1wLf5pnjxy79D2RudMUrG',
          mime: 'application/pdf',
        },
        openForOnboarding: true,
      },
    },
    kycRestrictedCountries: [],
    kybRestrictedCountries: [],
    podReadAccess: false,
    taxInfoRequired: true,
  },
  loanTemplates: [
    {
      id: 'QmZ1FUqhaUxaRRT3czJJSseLZ1GqCFoQfgszRQybWkBTs1',
      createdAt: '2024-07-03T17:12:11.404Z',
    },
  ],
}
