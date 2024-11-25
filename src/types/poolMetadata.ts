export type FileType = { uri: string; mime: string }

export type PoolMetadata = {
  version?: number
  pool: {
    name: string
    icon: FileType | null
    asset: {
      class: 'Public credit' | 'Private credit'
      subClass: string
    }
    investorType: string
    poolStructure: string
    poolFees?: {
      id: number
      name: string
      feePosition: 'Top of waterfall'
      feeType?: string
    }[]
    newInvestmentsStatus?: Record<string, 'closed' | 'request' | 'open'>
    issuer: {
      repName: string
      name: string
      description: string
      email: string
      logo?: FileType | null
      shortDescription: string
      categories: { type: string; value: string; customType?: string }[]
    }
    links: {
      executiveSummary: FileType | null
      forum?: string
      website?: string
    }
    details?: {
      title: string
      body: string
    }[]
    status: 'open' | 'upcoming' | 'hidden'
    listed: boolean
    reports?: {
      author: {
        name: string
        title: string
        avatar: FileType | null
      }
      uri: string
    }[]
    poolRatings?: {
      agency?: string
      value?: string
      reportUrl?: string
      reportFile?: FileType | null
    }[]
  }
  pod?: {
    indexer?: string | null
  }
  tranches: Record<
    string,
    {
      icon?: FileType | null
      minInitialInvestment?: string
      targetAPY?: string // only junior tranche (index: 0) has targetAPY
    }
  >
  loanTemplates?: {
    id: string
    createdAt: string
  }[]
  adminMultisig?: {
    signers: string[]
    threshold: number
  }
  onboarding?: {
    kybRestrictedCountries?: string[]
    kycRestrictedCountries?: string[]
    externalOnboardingUrl?: string
    tranches: { [trancheId: string]: { agreement: FileType | undefined; openForOnboarding: boolean } }
    podReadAccess?: boolean
    taxInfoRequired?: boolean
  }
}
