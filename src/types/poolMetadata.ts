import { HexString } from './index.js'

export type FileType = { uri: string; mime: string }

/**
 * APY display modes read by the invest app: an indexer yield window (7d/30d/90d/180d) combined
 * with a day-count basis (365/360), optionally compounded (30d only), the windowless modes
 * ttm/ytd/sinceInception, 'fixed' to display the hardcoded apyPercentage as the APY, or 'none'
 * to hide APY entirely.
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
  | 'fixed'
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

/**
 * Legacy ("current state") pool metadata: the flat shape written by all pools to date. Any document
 * with no `version` or `version < 2` is legacy and read as `PoolMetadataV1`. New writes are
 * `PoolMetadataV2`; the management app migrates legacy pools forward before editing.
 */
export type PoolMetadataV1 = {
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
      /**
       * Free-text tooltip shown by the invest app alongside the APY; used with apy: 'fixed' to
       * explain the hardcoded apyPercentage (e.g. "Target APY set by the fund manager").
       */
      apyTooltip?: string | null
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

/* ------------------------------------------------------------------------------------------------
 * Pool metadata v2 — the flexible, ordered factsheet content model (centrifuge/apps-invest#200).
 *
 * The metadata only *lays out* the fund-detail page. The invest app owns live data (indexer
 * queries behind closed `dataRef`/`LiveMetric`/`LiveDataset`/`SectionRef` keys), the section
 * renderers, and the visibility resolver. Adding a key here is additive; the app self-blanks
 * references it does not recognize.
 * ---------------------------------------------------------------------------------------------- */

/**
 * Access gating for any block, key fact, column, or kpi item. Default `'public'`. Resolved app-side
 * against the connected wallet's share-class (transfer-hook) membership. Presentational only — never
 * a substitute for on-chain access control.
 * - `public`      — rendered for everyone.
 * - `whitelisted` — full content only for a whitelisted wallet; otherwise blurred behind an
 *                   app-owned overlay that keeps its layout footprint (no reflow on connect).
 * - `hidden`      — never rendered, for anyone (not laid out).
 */
export type Visibility = 'public' | 'whitelisted' | 'hidden'

/**
 * Constrained Markdown subset (paragraphs, hard newlines, `-`/`*` and `1.` lists, `**bold**`,
 * `_italic_`, `[text](url)`). Raw HTML is stripped; sanitized by the reader on render.
 */
export type RichText = string

export type ChartType = 'line' | 'area' | 'bar' | 'donut'
export type AxisFormat = 'number' | 'percent' | 'currency'

/**
 * Live-chart datasets whose config is authored in metadata but whose data the app fetches live.
 *
 * PROVISIONAL, app-owned registry, expected to grow/change (centrifuge/apps-invest#200). The listed
 * keys are current placeholders; the metadata only *references* a key and the app resolves it,
 * blanking any it does not recognize. The `(string & {})` makes the type open: a future key never
 * needs an SDK release, and readers must tolerate unknown values (never reject the document).
 */
export type DataRef = 'apyVsBenchmarks' | 'maturityDistribution' | (string & {})

/**
 * App-owned section units rendered by the invest app (structure + content + data).
 * EXTENDABLE (additive), not a permanently closed set — more refs are expected. Current mapping:
 * `onchainMetrics` = performance charts, `smartContracts` = addresses & smart contracts.
 */
export type SectionRef = 'onchainMetrics' | 'smartContracts' | (string & {})

/**
 * App-owned indexer query/aggregation registry referenced by `liveTable` columns.
 * PROVISIONAL placeholder set (centrifuge/apps-invest#200): each key is its own query and the set
 * is expected to split into more granular, per-series / per-date-pair keys (e.g. `monthlyReturn` is
 * not yet defined). Open by design — see {@link DataRef}.
 */
export type LiveMetric = 'tokenPrice' | 'nav' | 'apy30d' | 'navChange' | 'monthlyReturn' | (string & {})

/**
 * App-owned dataset (row dimension) for `liveTable`. PROVISIONAL, expected to grow — open by
 * design, see {@link DataRef}.
 */
export type LiveDataset = 'monthlySummary' | (string & {})

export type ColumnFormat = 'text' | 'number' | 'percent' | 'currency'

export type ChartSeries = {
  name: string
  /** Optional brand override; defaults to the theme palette. */
  color?: string
  /** Categorical (bar/donut): `{ label, value }`; xy (line/area): `{ x, y }`. */
  data: Array<{ label: string; value: number } | { x: string | number; y: number }>
}

/**
 * A right-column key fact. `value` is static text; `valueRef: 'apy'` instead resolves live from
 * `shareClasses[scId].apy` (+ `apyTooltip`). The `valueRef` set is closed and grows additively.
 */
export type KeyFact = {
  label: string
  value?: string
  valueRef?: 'apy'
  tooltip?: string
  href?: string
  visibility?: Visibility
}

type BlockBase = { id: string; title?: string; visibility?: Visibility }

export type TextBlock = BlockBase & { type: 'text'; body: RichText }

export type TableBlock = BlockBase & {
  type: 'table'
  headers: string[]
  rows: Array<Array<string | number>>
  /** Optional, index-aligned to `headers`; per-column gating for static tables. */
  columnVisibility?: Visibility[]
  caption?: string
  asOf?: string
}

export type ChartBlock = BlockBase & {
  type: 'chart'
  chartType: ChartType
  /** Inline metadata-supplied data ... */
  series?: ChartSeries[]
  /** ... or an app/indexer-computed dataset (mutually exclusive with `series`). */
  dataRef?: DataRef
  stacked?: boolean
  legend?: boolean
  xAxis?: { label?: string; type?: 'category' | 'time' | 'number' }
  yAxis?: { label?: string; format?: AxisFormat; currency?: string }
  asOf?: string
  sourceNote?: string
}

export type ImageBlock = BlockBase & { type: 'image'; file: FileType; alt?: string; caption?: string }

export type KpiGroupBlock = BlockBase & {
  type: 'kpiGroup'
  columns?: 1 | 2 | 3 | 4
  items: Array<{
    label: string
    value: string
    tooltip?: string
    trend?: 'up' | 'down' | 'neutral'
    visibility?: Visibility
  }>
}

/** A metadata-authored column over an app-defined live dataset. */
export type LiveColumn = {
  /** Issuer-authored label + order. */
  header: string
  format?: ColumnFormat
  visibility?: Visibility
} & (
  | { source: 'indexer'; metric: LiveMetric }
  | { source: 'hardcoded'; key: string }
  | { source: 'static'; values: Array<string | number> }
)

export type LiveTableBlock = BlockBase & {
  type: 'liveTable'
  /** App owns the row dimension (e.g. recent months) + available metrics. */
  dataRef: LiveDataset
  columns: LiveColumn[]
  caption?: string
  asOf?: string
}

/** Tabs hold a leaf block only (no nested section/tabGroup) to keep nesting bounded. */
export type TabBlock = TextBlock | TableBlock | ChartBlock | KpiGroupBlock

export type TabGroupBlock = BlockBase & {
  type: 'tabGroup'
  tabs: Array<{ label: string; block: TabBlock }>
}

export type ContentBlock =
  | TextBlock
  | TableBlock
  | ChartBlock
  | ImageBlock
  | KpiGroupBlock
  | TabGroupBlock
  | LiveTableBlock

/** A pointer to one of the closed, app-owned section units. */
export type SectionRefBlock = {
  type: 'section'
  id: string
  ref: SectionRef
  /** Optional label override; the app supplies a sensible default. */
  title?: string
  visibility?: Visibility
}

export type LayoutItem = ContentBlock | SectionRefBlock

export type Factsheet = {
  /** Top region, left column, ordered (authored blocks + app section refs e.g. `onchainMetrics`). */
  body: LayoutItem[]
  /** Top region, right column, ordered. */
  keyFacts: KeyFact[]
  /** Full-width region below, ordered. Omit to let the app render its default sections. */
  sections?: LayoutItem[]
}

/** A pool rating without the unused `reportFile` PDF (migrated into a Documents block in v2). */
export type PoolRatingV2 = {
  agency?: string
  value?: string
  reportUrl?: string
}

/**
 * Versioned, factsheet-aware pool metadata. Drops fields unused by every consumer
 * (`newInvestmentsStatus`, `loanTemplates`, `reports`, `issuer.repName/shortDescription`, onboarding
 * extras) and folds the legacy display fields (`details`, `issuer.description/categories`,
 * `poolRatings[].reportFile`) into `pool.factsheet`. Engine fields (`shareClasses`,
 * `merkleProofManager`, `holdings`, `addressLabels`, `workflowPolicies`) are preserved verbatim.
 */
export type PoolMetadataV2 = {
  version: 2
  pool: Omit<PoolMetadataV1['pool'], 'newInvestmentsStatus' | 'reports' | 'details' | 'issuer' | 'poolRatings'> & {
    issuer: Pick<PoolMetadataV1['pool']['issuer'], 'name' | 'email' | 'logo'>
    poolRatings?: PoolRatingV2[]
    factsheet?: Factsheet
  }
  shareClasses: PoolMetadataV1['shareClasses']
  merkleProofManager?: PoolMetadataV1['merkleProofManager']
  onboarding?: {
    kycRestrictedCountries?: string[]
    kybRestrictedCountries?: string[]
  }
  holdings?: PoolMetadataV1['holdings']
  addressLabels?: PoolMetadataV1['addressLabels']
  workflowPolicies?: PoolMetadataV1['workflowPolicies']
}

/**
 * Public alias usable for either shape. Reads of common fields (`pool.name`, `shareClasses`,
 * `addressLabels`, `onboarding`, `holdings`, …) are valid without narrowing; discriminate on
 * `version` (or use {@link isPoolMetadataV2}) before touching v2-only fields like `pool.factsheet`.
 */
export type PoolMetadata = PoolMetadataV1 | PoolMetadataV2

export function isPoolMetadataV2(metadata: PoolMetadata): metadata is PoolMetadataV2 {
  return metadata.version === 2
}

/** A document with no `version` or `version < 2` is legacy and must be migrated before editing. */
export function isLegacyPoolMetadata(metadata: { version?: number }): boolean {
  return metadata.version == null || metadata.version < 2
}
