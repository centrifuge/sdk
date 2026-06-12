import { HexString } from './index.js'

export type FileType = { uri: string; mime: string }

/**
 * APY display modes read by the invest app: an indexer yield window (7d/30d/90d/180d) combined
 * with a day-count basis (365/360), optionally compounded (30d only), the windowless modes
 * ttm/ytd/sinceInception, or 'none' to hide APY entirely.
 */
export type ApyMode =
  | '7d365'
  | '7d360'
  | '30d365'
  | '30d360'
  | '30dComp365'
  | '30dComp360'
  | '90d365'
  | '90d360'
  | '180d365'
  | '180d360'
  | 'ttm'
  | 'ytd'
  | 'sinceInception'
  | 'none'

/**
 * @deprecated No longer recognized by the invest app — these fall back to '30d365'. Kept in the
 * union so metadata documents that predate the new vocabulary still type-check when read.
 */
export type LegacyApyMode = 'target' | '7day' | '30day' | '90day' | 'automatic'

export type MerkleProofWorkflow = {
  id: string
  name: string
  template?: string
  category?: string
  iconUrl?: string
  isVerified?: boolean
  actions: MerkleProofTemplateAction[]
  createdAt: string
  updatedAt?: string
}

export type MerkleProofTemplateAction = {
  /** index of the policy in manager.policies[] */
  policyIndex: number
  /** possible inputs for the policy execution, matching input order from policy inputs */
  defaultValues: (HexString | string | number | null)[]
}

export type MerkleProofPolicy = {
  decoder: HexString
  /** hash of the target (Vault, Asset) */
  target: HexString
  /** e.g. Vault */
  targetName?: string
  /** e.g. Request Deposit */
  name?: string
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
    /** Optional label for the input to be displayed in the form */
    label?: string
    input: HexString[]
  }[]
  inputCombinations: {
    inputs: (HexString | null)[]
    inputsEncoded: HexString
  }[]
}

export type MerkleProofPolicyInput = Omit<MerkleProofPolicy, 'inputCombinations' | 'valueNonZero'> & {
  valueNonZero?: boolean
}

export interface WorkflowPolicyEntry {
  workflowRef: string
  /** Per-slot hex values for configurable inputs; keyed by slot key. Empty when no configurable slots. */
  configurableValues: Record<string, HexString>
  /** 0-based indices of catalog actions excluded from the final script. */
  excludedActions?: number[]
  addedAt: string
}

/**
 * A strategist's set of whitelisted workflows on the pool's OnchainPM.
 *
 * The on-chain policy is keyed by (OnchainPM address → strategist) — the
 * OnchainPM is per-pool and `policy[strategist]` holds the Merkle root — so each
 * strategist has exactly one policy per pool. The share class id required by the
 * `Hub.updateContract` routing call is derived at policy-update time rather than
 * stored here.
 */
export interface WorkflowPolicy {
  /** Client-generated UUID; stable across metadata updates. */
  id: string
  description?: string
  /** On-chain strategist address. EOA for now; Safe address when Safe integration lands. */
  strategistAddress: HexString
  workflows: WorkflowPolicyEntry[]
  createdAt: string
  updatedAt?: string
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
    /** Expense ratio in percent, kept as a string, e.g. '0.25' */
    expenseRatio?: string
  }
  shareClasses: Record<
    HexString,
    {
      icon?: FileType | null
      minInitialInvestment?: number | null
      /** Fallback APY in percent, shown while the indexer has no computed yield yet */
      apyPercentage?: number | null
      apy?: ApyMode | LegacyApyMode | null
      /** Weighted average asset maturity in days, e.g. 63.33; row hidden in the invest app when unset */
      weightedAverageMaturity?: number | null
      /** Past year performance in percent, e.g. 4.1; row hidden in the invest app when unset */
      pastYearPerformance?: number | null
      /** 'underlying' for wrapper tokens whose performance track record predates the wrapper */
      pastYearPerformanceSource?: 'fund' | 'underlying' | null
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
  // centrifugeId => strategist => policies
  merkleProofManager?: Record<
    string,
    Record<
      HexString,
      {
        policies: MerkleProofPolicy[]
        workflows?: MerkleProofWorkflow[]
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
  addressLabels?: Record<string, string>
  workflowPolicies?: WorkflowPolicy[]
}
