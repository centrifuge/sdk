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
      /**
       * Reusable named documents authored once and referenced anywhere in the factsheet via a
       * {@link LinkTarget} `{ kind: 'linkRef', linkRef: key }`. See {@link LinkDocument}.
       */
      documents?: LinkDocument[]
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
  /** Per-share-class withdraw addresses, keyed by share class id. Engine config, carried verbatim. */
  withdrawManagers?: Record<HexString, WithdrawManager[]>
}

/** A configured withdraw destination for a share class on a given chain/asset. */
export type WithdrawManager = {
  assetAddress: HexString
  chainId: string
  manager: HexString
  label?: string
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
 * A single audience gate applied to an element. Presentational only, resolved app-side; never a
 * substitute for on-chain / compliance access control.
 * - `whitelisted`    — passes only for a wallet in the share class's transfer-hook allowlist;
 *                      otherwise blurred behind an app-owned overlay that keeps its layout footprint.
 * - `geo-restricted` — passes only when the user's region is NOT in `pool.geoRestrictions.regions`
 *                      (with no such list, nothing is restricted).
 */
export type VisibilityGate = 'whitelisted' | 'geo-restricted'

/**
 * Access gating for any block, key fact, column, or kpi item. Default `'public'`.
 * - `'public'` (or absent) — rendered for everyone.
 * - `'hidden'`             — never rendered, for anyone (not laid out).
 * - a single {@link VisibilityGate} or an **array of gates** — rendered only when ALL listed gates
 *   pass (AND). e.g. `['whitelisted', 'geo-restricted']` = a whitelisted wallet in an allowed
 *   region. `'public'`/`'hidden'` may not appear inside the array. When several gates fail, the app
 *   shows the most restrictive overlay (geo before whitelist).
 */
export type Visibility = 'public' | 'hidden' | VisibilityGate | VisibilityGate[]

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
 * Closed, app-owned registry — the SDK is the alignment point. The current values are PROVISIONAL
 * placeholders and the set is expected to grow (centrifuge/apps-invest#200), but growth is
 * deliberately gated: the SDK rejects unknown keys on write, so adding a key is a coordinated change
 * across the management app, SDK, and invest app (and ships in an SDK release). Reads are not
 * validated, so a newer document never breaks an older reader. The metadata only references a key;
 * the app resolves it.
 */
export type DataRef = 'apyVsBenchmarks' | 'maturityDistribution'

/**
 * App-owned section units rendered by the invest app (structure + content + data). Closed and
 * SDK-validated on write; expected to grow additively via coordinated SDK releases (see
 * {@link DataRef}). Current mapping: `onchainMetrics` = performance charts, `smartContracts` =
 * addresses & smart contracts.
 */
export type SectionRef = 'onchainMetrics' | 'smartContracts'

/**
 * App-owned indexer query/aggregation registry referenced by `liveTable` columns. Closed and
 * SDK-validated on write. The current keys are PROVISIONAL: each is its own query and the set is
 * expected to split into more granular per-series / per-date-pair keys (`monthlyReturn` is not yet
 * defined). Adding or renaming a key is a coordinated SDK release — see {@link DataRef}.
 */
export type LiveMetric = 'tokenPrice' | 'nav' | 'apy30d' | 'navChange' | 'monthlyReturn'

/**
 * App-owned dataset (row dimension) for `liveTable`. Closed and SDK-validated on write; grows via
 * coordinated SDK releases — see {@link DataRef}.
 */
export type LiveDataset = 'monthlySummary'

export type ColumnFormat = 'text' | 'number' | 'percent' | 'currency'

export type ChartSeries = {
  name: string
  /** Optional brand override; defaults to the theme palette. */
  color?: string
  /** Categorical (bar/donut): `{ label, value }`; xy (line/area): `{ x, y }`. */
  data: Array<{ label: string; value: number } | { x: string | number; y: number }>
}

/**
 * An icon, optionally with a label (renders as an icon, or an icon+text pill when `label` is set).
 * - `source: 'metadata'` carries the image inline (issuer-supplied).
 * - `source: 'app'` references an app-owned icon by `key` (e.g. `'fordefi'`, `'moodys'`). The icon
 *   `key` registry is app-owned; it is not yet enumerated, so the SDK validates it as a string only.
 */
export type IconRef =
  | { source: 'metadata'; file: FileType; alt?: string; label?: string }
  | { source: 'app'; key: string; label?: string }

/**
 * A key fact's value, discriminated by `kind` so there is no value/valueRef/icons precedence
 * ambiguity. Exactly one kind applies:
 * - `text`  — static text.
 * - `icons` — author-chosen icons (each may carry a label).
 * - `ref`   — app-owned widget that reads existing data (an indexer query or a typed metadata
 *             field) and renders it. The `ref` set is closed and SDK-validated on write (extended
 *             via a coordinated SDK release, see {@link DataRef}). `'apy'` renders formatted APY
 *             (via the app's `usePoolApy`); `'availableNetworks'` renders the token's deployed
 *             chains with the app's built-in network icons; `'ratings'` renders the typed
 *             `pool.poolRatings` field as icon+text pills with per-rating links (`agency` → icon,
 *             `value` → label, `reportUrl`/`reportFile` → link). None of these produce `IconRef[]`.
 */
export type KeyFactValue =
  | { kind: 'text'; text: string }
  | { kind: 'icons'; icons: IconRef[] }
  | { kind: 'ref'; ref: 'apy' | 'availableNetworks' | 'ratings' }

/** A right-column key fact. Its value is a single discriminated {@link KeyFactValue}. */
export type KeyFact = {
  label: string
  value: KeyFactValue
  tooltip?: string
  href?: string
  visibility?: Visibility
}

/**
 * A titled right-column group of key facts. Every key fact lives inside a group; there are no
 * top-level bare key facts. An untitled group renders as ungrouped rows.
 */
export type KeyFactGroup = {
  type: 'keyFactGroup'
  id: string
  title?: string
  /** Optional secondary header rendered under {@link KeyFactGroup.title} (muted sub-heading). */
  subtitle?: string
  visibility?: Visibility
  items: KeyFact[]
}

/**
 * Common fields on every content block. `title` is the primary header; `subtitle` is an optional
 * secondary header rendered directly under it (muted sub-heading), e.g. title "Exposure breakdowns"
 * with subtitle "Underlying fund (CGUHY I)".
 */
type BlockBase = { id: string; title?: string; subtitle?: string; visibility?: Visibility }

/**
 * A single link destination, discriminated by `kind` (no competing-optional ambiguity):
 * - `file`    — an inline IPFS asset.
 * - `href`    — an inline URL.
 * - `linkRef` — a key in the typed `pool.links` (e.g. `'executiveSummary'`, `'website'`), so the
 *               URL/file has a single source of truth. The app resolves it; an unknown key hides
 *               the tile/button (graceful read).
 */
export type LinkTarget =
  | { kind: 'file'; file: FileType }
  | { kind: 'href'; href: string }
  | { kind: 'linkRef'; linkRef: string }

/**
 * A reusable named document on `pool.links.documents`, referenced from a {@link LinkTarget} via
 * `{ kind: 'linkRef', linkRef: key }`. Carries exactly one of `file` or `href`.
 */
export type LinkDocument = {
  /** Unique slug a `linkRef` points at; must not collide with `executiveSummary`/`website`/`forum`. */
  key: string
  label: string
  file?: FileType | null
  href?: string
}

export type TextBlock = BlockBase & {
  type: 'text'
  body: RichText
  /** Overview-card extras (all optional): a brand logo, a card background, and link buttons. */
  logo?: FileType
  /** Theme token or hex color for the card background. */
  background?: string
  links?: Array<{ label: string; target: LinkTarget }>
}

export type TableBlock = BlockBase & {
  type: 'table'
  headers: string[]
  rows: Array<Array<string | number>>
  /** Optional, index-aligned to `headers`; per-column gating for static tables. */
  columnVisibility?: Visibility[]
  caption?: string
  asOf?: string
}

/**
 * A chart's data source, discriminated by `kind` (no inline-vs-live ambiguity):
 * - `inline` — metadata-supplied series.
 * - `ref`    — an app/indexer-computed dataset, referenced by a closed, SDK-validated {@link DataRef}.
 */
export type ChartData = { kind: 'inline'; series: ChartSeries[] } | { kind: 'ref'; dataRef: DataRef }

export type ChartBlock = BlockBase & {
  type: 'chart'
  chartType: ChartType
  data: ChartData
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

/** A tile list (doc icon + title) opening each item's {@link LinkTarget}, e.g. a "Fact Sheet" tile. */
export type DocumentsBlock = BlockBase & {
  type: 'documents'
  items: Array<{ title: string; target: LinkTarget }>
}

/** A collapsible stack (accordion UX). Each item holds a {@link TabBlock} leaf, like `tabGroup` tabs. */
export type AccordionBlock = BlockBase & {
  type: 'accordion'
  items: Array<{ title: string; block: TabBlock; defaultOpen?: boolean }>
}

export type ContentBlock =
  | TextBlock
  | TableBlock
  | ChartBlock
  | ImageBlock
  | KpiGroupBlock
  | TabGroupBlock
  | LiveTableBlock
  | DocumentsBlock
  | AccordionBlock

/** A pointer to one of the closed, app-owned section units. */
export type SectionRefBlock = {
  type: 'section'
  id: string
  ref: SectionRef
  /** Optional label override; the app supplies a sensible default. */
  title?: string
  /** Optional secondary header rendered under {@link SectionRefBlock.title} (muted sub-heading). */
  subtitle?: string
  visibility?: Visibility
}

export type LayoutItem = ContentBlock | SectionRefBlock

export type Factsheet = {
  /** Top region, left column, ordered (authored blocks + app section refs e.g. `onchainMetrics`). */
  body: LayoutItem[]
  /** Top region, right column, ordered groups of key facts (groups only, no bare key facts). */
  keyFacts: KeyFactGroup[]
  /** Full-width region below, ordered. Omit to let the app render its default sections. */
  sections?: LayoutItem[]
}

/**
 * A pool rating, kept as a typed field in v2 (the single source of truth for ratings). The
 * `ratings` {@link KeyFactValue} `ref` widget renders this verbatim: `agency` → icon, `value` →
 * label, `reportUrl`/`reportFile` → the per-rating link.
 */
export type PoolRatingV2 = {
  agency?: string
  value?: string
  reportUrl?: string
  reportFile?: FileType | null
}

/**
 * Versioned, factsheet-aware pool metadata. Drops fields unused by every consumer
 * (`newInvestmentsStatus`, `loanTemplates`, `reports`, `issuer.repName/shortDescription`, onboarding
 * extras) and folds the legacy display fields (`details`, `issuer.description/categories`) and the
 * off-chain `holdings` blob (into a `table` section) into `pool.factsheet`. `poolRatings` stays a
 * typed field (surfaced via the `ratings` key-fact ref). Engine fields (`shareClasses`,
 * `merkleProofManager`, `addressLabels`, `workflowPolicies`, `withdrawManagers`) are preserved
 * verbatim.
 */
export type PoolMetadataV2 = {
  version: 2
  pool: Omit<PoolMetadataV1['pool'], 'newInvestmentsStatus' | 'reports' | 'details' | 'issuer' | 'poolRatings'> & {
    issuer: Pick<PoolMetadataV1['pool']['issuer'], 'name' | 'email' | 'logo'>
    poolRatings?: PoolRatingV2[]
    factsheet?: Factsheet
    /**
     * Single pool-level restricted-regions list (ISO 3166-1 alpha-2 codes, e.g. `'US'`). Every
     * `geo-restricted` element is gated against it. Presentational only; not compliance/access control.
     */
    geoRestrictions?: { regions: string[] }
  }
  shareClasses: PoolMetadataV1['shareClasses']
  merkleProofManager?: PoolMetadataV1['merkleProofManager']
  onboarding?: {
    kycRestrictedCountries?: string[]
    kybRestrictedCountries?: string[]
  }
  addressLabels?: PoolMetadataV1['addressLabels']
  workflowPolicies?: PoolMetadataV1['workflowPolicies']
  withdrawManagers?: PoolMetadataV1['withdrawManagers']
}

/**
 * Public alias usable for either shape. Reads of common fields (`pool.name`, `shareClasses`,
 * `addressLabels`, `onboarding`, …) are valid without narrowing; discriminate on `version` (or use
 * {@link isPoolMetadataV2}) before touching v2-only fields like `pool.factsheet`. Note `holdings`
 * exists only on {@link PoolMetadataV1}; in v2 it lives in `pool.factsheet` as a `table` section.
 */
export type PoolMetadata = PoolMetadataV1 | PoolMetadataV2

export function isPoolMetadataV2(metadata: PoolMetadata): metadata is PoolMetadataV2 {
  return metadata.version === 2
}

/** A document with no `version` or `version < 2` is legacy and must be migrated before editing. */
export function isLegacyPoolMetadata(metadata: { version?: number }): boolean {
  return metadata.version == null || metadata.version < 2
}
