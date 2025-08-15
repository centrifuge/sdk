import { HexString } from './index.js'

export type FileType = { uri: string; mime: string }

export type MerkleProofPolicy = {
  assetId: string
  decoder: HexString
  target: HexString
  targetName?: string
  /** e.g. 'function requestDeposit(uint256 assets, address controller, address owner) returns (uint256)' */
  abi: string
  valueNonZero: boolean
  /** Fixed arguments in their right position. Example for ERC7540.requestDeposit: [null, controller, owner] */
  addresses: (HexString | string | null)[]
  /** To avoid reading the decoder whenever we want to build the merkle tree */
  addressesEncoded: HexString
  /**
   * Indices of dynamic arguments which will be interleaved with the fixed arguments when executing.
   * Example for ERC7540.requestDeposit would be [0], refers to the 0th param `uint256 assets`
   */
  strategistInputs: number[]
}
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
  shareClasses: Record<
    HexString,
    {
      icon?: FileType | null
      minInitialInvestment?: number | null
      apyPercentage?: number | null
      apy?: 'target' | '7day' | '30day' | '90day' | 'ytd' | 'sinceInception' | 'automatic' | null
      defaultAccounts?: {
        asset?: number
        equity?: number
        gain?: number
        loss?: number
        expense?: number
        liability?: number
      }
    }
  >
  // chainId => strategist => policies
  merkleProofManager?: Record<
    string,
    Record<
      HexString,
      {
        policies: MerkleProofPolicy[]
      }
    >
  >
  loanTemplates?: {
    id: string
    createdAt: string
  }[]
  onboarding?: {
    kybRestrictedCountries?: string[]
    kycRestrictedCountries?: string[]
    externalOnboardingUrl?: string
    shareClasses: { [scId: string]: { agreement: FileType | undefined; openForOnboarding: boolean } }
    taxInfoRequired?: boolean
  }
}
