import { HexString } from './index.js'

export type FileType = { uri: string; mime: string }

export type MerkleProofPolicy = {
  assetId?: string
  decoder: HexString
  target: HexString
  action?: string
  /** e.g. 'function requestDeposit(uint256 assets, address controller, address owner) returns (uint256)' */
  selector: string
  valueNonZero: boolean
  /** Fixed arguments in their right position, null for strategist inputs.
   * Example for ERC7540.requestDeposit:
   *   "inputs": [
   *     {
   *       "parameter": "assets",
   *       "input": [] // Empty means user can input anything
   *     },
   *     {
   *       "parameter": "controller",
   *       "input": ["address1"] // Only 1 option possible
   *     },
   *     {
   *       "parameter": "owner",
   *       "input": ["address1", "address2"] // Only 2 options possible
   *     }
   *  ]
   */
  inputs: {
    parameter: string
    input: HexString[]
  }[]
  inputCombinations: {
    inputs: (HexString | null)[]
    inputsEncoded: HexString
  }[]
}

export type MerkleProofPolicyInput = Pick<
  MerkleProofPolicy,
  'assetId' | 'target' | 'decoder' | 'action' | 'selector' | 'inputs'
> & {
  valueNonZero?: boolean
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
    underlying?: {
      poolId?: number
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
  holdings?: {
    headers: string[]
    data: Record<string, unknown>[]
  }
  investors?: {
    [shareClassId: string]: {
      address: string
      label?: string
    }[]
  }
  withdrawManagers?: Record<
    string,
    {
      assetAddress: HexString
      chainId: string
      manager: HexString
      label: string
    }[]
  >
}
