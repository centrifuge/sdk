import { HexString } from './index.js'
import type { ApyMode, Factsheet, LegacyApyMode, PoolMetadata } from './poolMetadata.js'

export type FileType = { uri: string; mime: string }

export type PoolReport = {
  author: {
    name: string
    title: string
    avatar: FileType | null
  }
  uri: string
}
export type ShareClassInput = {
  tokenName: string
  symbolName: string
  minInvestment?: number | null
  apyPercentage?: number | null
  apy?: ApyMode | LegacyApyMode | null
  salt?: string
  defaultAccounts?: PoolMetadata['shareClasses'][HexString]['defaultAccounts']
}

export type IssuerDetail = {
  title: string
  body: string
}

export type PoolMetadataInput = {
  poolStructure: 'revolving'
  assetClass: 'Public credit' | 'Private credit'
  subAssetClass: string
  shareClasses: ShareClassInput[]
  poolName: string
  investorType: string
  poolIcon: FileType
  poolType: 'open' | 'closed'
  issuerName: string
  issuerLogo: FileType
  issuerDescription: string
  website: string
  forum: string
  email: string
  executiveSummary: FileType | null
  details?: IssuerDetail[]
  issuerCategories: { type: string; value: string; description?: string }[]
  poolRatings: {
    agency?: string
    value?: string
    reportUrl?: string
  }[]
  /** v2 factsheet content model (centrifuge/apps-invest#200). */
  factsheet?: Factsheet
  onboardingExperience: string
  underlying?: {
    poolId?: number
  }
  holdings?: {
    headers: string[]
    data: Record<string, unknown>[]
  }
  listed?: boolean
}
