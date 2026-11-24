import type { HexString } from '../types/index.js'
import {
  type ApyMode,
  type AxisFormat,
  type ChartType,
  type ColumnFormat,
  type DataRef,
  type DocumentsBlock,
  type Factsheet,
  type FileType,
  isPoolMetadataV2,
  type KeyFact,
  type KeyFactGroup,
  type KeyFactValue,
  type LayoutItem,
  type LegacyApyMode,
  type LinkTarget,
  type LiveDataset,
  type LiveMetric,
  type PoolMetadata,
  type PoolMetadataV1,
  type PoolMetadataV2,
  type SectionRef,
  type TableBlock,
  type VisibilityGate,
} from '../types/poolMetadata.js'

/* ================================================================================================
 * Migration: legacy (v1) -> v2
 * ============================================================================================== */

/**
 * Legacy APY display modes that the invest app no longer recognizes, mapped to their nearest v2
 * equivalent. `target` becomes the hardcoded `fixed` display; the rolling windows pick the 365-day
 * basis; `automatic` defaults to the 30-day window.
 */
const LEGACY_APY_MODE_MAP: Record<LegacyApyMode, ApyMode> = {
  target: 'fixed',
  '7day': '7d365',
  '30day': '30d365',
  '90day': '90d365',
  automatic: '30d365',
}

function migrateApyMode(apy: ApyMode | LegacyApyMode | null | undefined): ApyMode | null | undefined {
  if (apy == null) return apy
  return LEGACY_APY_MODE_MAP[apy as LegacyApyMode] ?? (apy as ApyMode)
}

function formatMinInvestment(value: number): string {
  return value.toLocaleString('en-US')
}

/** Tolerates legacy docs that omit (or malform) an array field by treating it as empty. */
function asArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : []
}

/**
 * Folds a legacy off-chain `{ headers, data }` holdings blob into a `table` section, preserving
 * every column verbatim (numbers stay numbers, null/undefined -> '', other values stringified +
 * trimmed). Returns null when there are no headers or no data.
 */
function holdingsTableBlock(holdings: PoolMetadataV1['holdings']): TableBlock | null {
  if (!holdings || !Array.isArray(holdings.headers) || holdings.headers.length === 0 || !Array.isArray(holdings.data)) {
    return null
  }
  const { headers, data } = holdings
  return {
    type: 'table',
    id: 'holdings',
    title: 'Holdings',
    headers,
    rows: data.map((row) =>
      headers.map((header) => {
        const value = row[header]
        return typeof value === 'number' ? value : value == null ? '' : String(value).trim()
      })
    ),
  }
}

/** Normalizes an issuer category `type` for matching (case- and separator-insensitive). */
function normalizeCategoryType(type: string): string {
  return type.toLowerCase().replace(/[\s_-]/g, '')
}

/**
 * Issuer-category `type` values (normalized) that migrate into the "Service providers" group, mapped
 * to their v2 display label (the v1 vocabulary differs from v2, e.g. "Sub-Investment Manager" is the
 * v2 "Portfolio Manager"). Anything not listed stays in "Key facts" with its raw label (the seed is
 * ops-editable, so an unmatched type is low-cost). `administrator` is an alias of Fund Administrator.
 */
const SERVICE_PROVIDER_CATEGORIES = new Map<string, string>([
  ['subinvestmentmanager', 'Portfolio Manager'],
  ['custodian', 'Custodian'],
  ['fundadministrator', 'Fund Administrator'],
  ['administrator', 'Fund Administrator'],
  ['auditor', 'Auditor'],
])

/**
 * Issuer-category `type` values (normalized) dropped from the factsheet because they are already
 * represented elsewhere: "Investment Manager" is absorbed by the `Issuer` key fact (from
 * `issuer.name`), so it is not rendered as its own row.
 */
const ABSORBED_CATEGORY_TYPES = new Set(['investmentmanager'])

/** Document links only carry web/IPFS URIs; anything else (e.g. `javascript:`) is dropped. */
function isSafeDocumentUri(uri: string): boolean {
  const scheme = uri.trim().toLowerCase()
  return scheme.startsWith('https://') || scheme.startsWith('ipfs://')
}

/**
 * Builds a `documents` section from the rating report files (a tile per safe-URI report), or null
 * when none have a usable report. Each tile targets the report file directly (`kind: 'file'`).
 */
function ratingDocumentsBlock(poolRatings: PoolMetadataV1['pool']['poolRatings']): DocumentsBlock | null {
  const items = asArray(poolRatings)
    .filter((rating) => rating.reportFile?.uri && isSafeDocumentUri(rating.reportFile.uri))
    .map((rating) => ({
      title: `${rating.agency ?? 'Rating'} rating report`,
      target: { kind: 'file' as const, file: rating.reportFile! },
    }))
  return items.length > 0 ? { type: 'documents', id: 'documents', title: 'Documents', items } : null
}

/**
 * Builds the seed `factsheet` from the legacy display fields. The migration is content-translating:
 * a migrated pool must render the same content, so legacy fields are projected into ordered key
 * facts + body blocks. The output is a sensible, ops-editable seed, not a frozen contract.
 */
function buildFactsheet(
  pool: PoolMetadataV1['pool'],
  shareClasses: PoolMetadataV1['shareClasses'],
  holdings: PoolMetadataV1['holdings']
): Factsheet {
  const { issuer, asset, poolStructure, expenseRatio, details, poolRatings } = pool
  const firstShareClass = Object.values(shareClasses)[0]

  // Trim text key-fact values (issuer/category strings sometimes carry stray whitespace).
  const text = (value: string): KeyFact['value'] => ({ kind: 'text', text: value.trim() })

  const keyFactItems: KeyFact[] = [
    { label: 'Issuer', value: text(issuer.name) },
    { label: 'Asset type', value: text(`${asset.class} - ${asset.subClass}`) },
    { label: 'APY', value: { kind: 'ref', ref: 'apy' } },
    { label: 'Pool structure', value: text(poolStructure) },
  ]

  const weightedAverageMaturity = firstShareClass?.weightedAverageMaturity
  if (weightedAverageMaturity != null) {
    keyFactItems.push({ label: 'Average asset maturity', value: text(`${weightedAverageMaturity} days`) })
  }
  if (expenseRatio != null && expenseRatio !== '') {
    keyFactItems.push({ label: 'Expense ratio', value: text(`${expenseRatio}%`) })
  }
  const minInitialInvestment = firstShareClass?.minInitialInvestment
  if (minInitialInvestment != null) {
    keyFactItems.push({ label: 'Min. investment', value: text(formatMinInvestment(minInitialInvestment)) })
  }

  const serviceProviderItems: KeyFact[] = []
  for (const category of asArray(issuer.categories)) {
    const key = normalizeCategoryType(category.type)
    if (ABSORBED_CATEGORY_TYPES.has(key)) continue
    const label = SERVICE_PROVIDER_CATEGORIES.get(key)
    if (label) {
      serviceProviderItems.push({ label, value: text(category.value) })
    } else {
      keyFactItems.push({ label: category.type, value: text(category.value) })
    }
  }

  // Seeded unconditionally because v1 has no source field for either: the app derives the deployed
  // chains, and wallet infrastructure is currently Fordefi for all pools. Ops can edit/remove after.
  keyFactItems.push({
    label: 'Wallet infrastructure',
    value: { kind: 'icons', icons: [{ source: 'app', key: 'fordefi' }] },
  })
  keyFactItems.push({ label: 'Available networks', value: { kind: 'ref', ref: 'availableNetworks' } })

  if (asArray(poolRatings).length > 0) {
    keyFactItems.push({ label: 'Ratings', value: { kind: 'ref', ref: 'ratings' } })
  }

  // Right column is groups only (no bare key facts). The "Service providers" group is added only
  // when at least one category mapped to it.
  const keyFacts: KeyFactGroup[] = [{ type: 'keyFactGroup', id: 'key-facts', title: 'Key facts', items: keyFactItems }]
  if (serviceProviderItems.length > 0) {
    keyFacts.push({
      type: 'keyFactGroup',
      id: 'service-providers',
      title: 'Service providers',
      items: serviceProviderItems,
    })
  }

  const body: Factsheet['body'] = []
  if (issuer.description) {
    // Overview card: logo and the "Factsheet" link button are added only when their source field
    // exists, so a missing logo / executiveSummary degrades to a plain card (never a broken one).
    // The Factsheet link references the typed `links.executiveSummary` rather than copying its URI.
    body.push({
      type: 'text',
      id: 'overview',
      title: 'Overview',
      body: issuer.description,
      ...(issuer.logo?.uri ? { logo: issuer.logo } : {}),
      ...(pool.links?.executiveSummary?.uri
        ? { links: [{ label: 'Factsheet', target: { kind: 'linkRef', linkRef: 'executiveSummary' } }] }
        : {}),
    })
  }
  asArray(details).forEach((detail, index) => {
    body.push({ type: 'text', id: `detail-${index}`, title: detail.title, body: detail.body })
  })
  body.push({ type: 'section', id: 'performance', ref: 'onchainMetrics' })

  // Full-width region. Rating reports become a `documents` tile block (ratings are also surfaced
  // as the `ratings` key-fact ref pill above; both read the same typed `poolRatings`). `sections` is
  // omitted (so the invest app renders its defaults) only when there is neither a documents block
  // nor a holdings table.
  const sections: LayoutItem[] = []
  const documentsBlock = ratingDocumentsBlock(poolRatings)
  if (documentsBlock) sections.push(documentsBlock)
  const holdingsBlock = holdingsTableBlock(holdings)
  if (holdingsBlock) sections.push(holdingsBlock)
  return sections.length > 0 ? { body, keyFacts, sections } : { body, keyFacts }
}

/**
 * Pure, idempotent legacy -> v2 migration. Performs no IPFS/network access so it stays
 * unit-testable. A document already at the current v2 shape is returned unchanged; a v2 document
 * written by an earlier SDK is normalized forward via {@link upgradeLegacyV2}.
 *
 * - Strips fields unused by every consumer (`newInvestmentsStatus`, `reports`, `loanTemplates`,
 *   `issuer.repName/shortDescription`, onboarding extras) and reshapes `issuer`. `poolRatings` is
 *   preserved verbatim as a typed field (surfaced via the `ratings` key-fact ref).
 * - Maps legacy APY modes across `shareClasses[*].apy`.
 * - Projects the legacy display fields into `pool.factsheet`, and folds the off-chain `holdings`
 *   blob into a `table` section (`id: 'holdings'`); `holdings` is not carried as a top-level field.
 */
export function migratePoolMetadataToV2(legacy: PoolMetadata): PoolMetadataV2 {
  if (isPoolMetadataV2(legacy)) return upgradeLegacyV2(legacy)

  const {
    pool,
    shareClasses,
    onboarding,
    merkleProofManager,
    holdings,
    addressLabels,
    workflowPolicies,
    withdrawManagers,
  } = legacy
  const { issuer, poolRatings, ...restPool } = pool
  // Explicitly drop fields that v2 does not carry. `report` (singular) and `poolStatus` are stray
  // non-schema fields seen in some legacy documents (the real fields are `reports` and `status`).
  delete (restPool as Record<string, unknown>).newInvestmentsStatus
  delete (restPool as Record<string, unknown>).reports
  delete (restPool as Record<string, unknown>).details
  delete (restPool as Record<string, unknown>).report
  delete (restPool as Record<string, unknown>).poolStatus

  const migratedShareClasses: PoolMetadataV2['shareClasses'] = {}
  for (const [scId, shareClass] of Object.entries(shareClasses)) {
    migratedShareClasses[scId as HexString] = { ...shareClass, apy: migrateApyMode(shareClass.apy) }
  }

  return {
    version: 2,
    pool: {
      ...restPool,
      issuer: { name: issuer.name, email: issuer.email, logo: issuer.logo },
      // `poolRatings` stays a typed field verbatim (incl. reportFile); surfaced via the `ratings`
      // key-fact ref. `holdings` is folded into the factsheet and not carried as a top-level field.
      poolRatings,
      factsheet: buildFactsheet(pool, shareClasses, holdings),
    },
    shareClasses: migratedShareClasses,
    ...(merkleProofManager !== undefined ? { merkleProofManager } : {}),
    ...(onboarding !== undefined
      ? {
          onboarding: {
            kycRestrictedCountries: onboarding.kycRestrictedCountries,
            kybRestrictedCountries: onboarding.kybRestrictedCountries,
          },
        }
      : {}),
    ...(addressLabels !== undefined ? { addressLabels } : {}),
    ...(workflowPolicies !== undefined ? { workflowPolicies } : {}),
    ...(withdrawManagers !== undefined ? { withdrawManagers } : {}),
  }
}

/* ================================================================================================
 * Intra-v2 upgrade: normalize a v2 document written by an earlier SDK to the current v2 shape
 * ============================================================================================== */

function isKeyFactGroup(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as Record<string, unknown>).type === 'keyFactGroup'
}

/** Converts an earlier-SDK flat KeyFact (`{ value?: string; valueRef?: 'apy' }`) to the discriminated shape. */
function upgradeKeyFact(old: Record<string, unknown>): KeyFact {
  const { value, valueRef, ...rest } = old
  let next: KeyFactValue
  if (valueRef === 'apy') next = { kind: 'ref', ref: 'apy' }
  else if (value !== null && typeof value === 'object' && 'kind' in (value as object)) next = value as KeyFactValue
  else next = { kind: 'text', text: typeof value === 'string' ? value : '' }
  return { ...(rest as Omit<KeyFact, 'value'>), value: next }
}

/** True if `item` is (or, for a tabGroup, contains) a chart still using the `series`/`dataRef` shape. */
function hasLegacyChart(item: unknown): boolean {
  if (typeof item !== 'object' || item === null) return false
  const block = item as Record<string, unknown>
  if (block.type === 'chart') {
    return block.data === undefined && (block.series !== undefined || block.dataRef !== undefined)
  }
  if (block.type === 'tabGroup' && Array.isArray(block.tabs)) {
    return block.tabs.some((tab) => hasLegacyChart((tab as Record<string, unknown>)?.block))
  }
  return false
}

/** Converts an earlier-SDK chart block (`series?`/`dataRef?`) to the discriminated `data` field, in place. */
function upgradeChartBlockInPlace(block: Record<string, unknown>): void {
  if (block.type === 'chart' && block.data === undefined) {
    if (Array.isArray(block.series)) block.data = { kind: 'inline', series: block.series }
    else if (typeof block.dataRef === 'string') block.data = { kind: 'ref', dataRef: block.dataRef }
    delete block.series
    delete block.dataRef
  }
  if (block.type === 'tabGroup' && Array.isArray(block.tabs)) {
    for (const tab of block.tabs) {
      const inner = (tab as Record<string, unknown>)?.block
      if (inner && typeof inner === 'object') upgradeChartBlockInPlace(inner as Record<string, unknown>)
    }
  }
}

/**
 * Normalizes a document already at `version: 2` but written by an earlier SDK whose v2 shape differs:
 * a flat `keyFacts: KeyFact[]` (now `KeyFactGroup[]`), chart blocks with `series`/`dataRef` (now a
 * discriminated `data`), and a top-level `holdings` blob (now a factsheet `table` section). Without
 * this, `update()` would re-validate such a document against the current validator and throw, with no
 * upgrade path. Returns the input unchanged (same reference) when it is already the current shape.
 */
function upgradeLegacyV2(doc: PoolMetadataV2): PoolMetadataV2 {
  const raw = doc as unknown as Record<string, unknown>
  const pool = (raw.pool ?? {}) as Record<string, unknown>
  const factsheet = pool.factsheet as Record<string, unknown> | undefined
  const keyFacts = factsheet?.keyFacts
  const layoutItems = [...asArray(factsheet?.body as unknown[]), ...asArray(factsheet?.sections as unknown[])]

  const needsKeyFactUpgrade = Array.isArray(keyFacts) && keyFacts.some((item) => !isKeyFactGroup(item))
  const needsHoldingsFold = raw.holdings != null
  const needsChartUpgrade = layoutItems.some(hasLegacyChart)
  if (!needsKeyFactUpgrade && !needsHoldingsFold && !needsChartUpgrade) return doc

  const next = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>
  const nextPool = next.pool as Record<string, unknown>
  const nextFactsheet = nextPool.factsheet as Record<string, unknown> | undefined

  if (nextFactsheet) {
    if (needsKeyFactUpgrade) {
      // Wrap the flat list into one titled "Key facts" group, converting each item's value.
      const items = (nextFactsheet.keyFacts as Record<string, unknown>[]).map(upgradeKeyFact)
      nextFactsheet.keyFacts = [{ type: 'keyFactGroup', id: 'key-facts', title: 'Key facts', items }]
    }
    if (needsChartUpgrade) {
      for (const item of [
        ...asArray(nextFactsheet.body as unknown[]),
        ...asArray(nextFactsheet.sections as unknown[]),
      ]) {
        if (item && typeof item === 'object') upgradeChartBlockInPlace(item as Record<string, unknown>)
      }
    }
  }

  if (needsHoldingsFold) {
    const holdingsBlock = holdingsTableBlock(raw.holdings as PoolMetadataV1['holdings'])
    delete next.holdings
    if (holdingsBlock && nextFactsheet) {
      nextFactsheet.sections = [...asArray(nextFactsheet.sections as LayoutItem[]), holdingsBlock]
    }
  }

  return next as unknown as PoolMetadataV2
}

/* ================================================================================================
 * Validation: hand-rolled structural checks (mirrors src/utils/catalog.ts; no zod dependency)
 * ============================================================================================== */

// All enums below are validated as closed sets. The app-owned live-data key registries
// (`dataRef` / `LiveMetric` / `LiveDataset`) and `section.ref` are PROVISIONAL and expected to grow
// (see centrifuge/apps-invest#200), but the SDK is the alignment point: an unknown key is rejected
// on WRITE so the management app, SDK, and invest app stay in sync (adding a key ships in an SDK
// release). The read path does not validate, so a newer document never breaks an older reader.
const VISIBILITY_SCALARS = new Set(['public', 'hidden', 'whitelisted', 'geo-restricted'])
const VISIBILITY_GATES = new Set<VisibilityGate>(['whitelisted', 'geo-restricted'])
const REGION_CODE_RE = /^[A-Za-z]{2}$/
const CHART_TYPES = new Set<ChartType>(['line', 'area', 'bar', 'donut'])
const AXIS_FORMATS = new Set<AxisFormat>(['number', 'percent', 'currency'])
const XAXIS_TYPES = new Set(['category', 'time', 'number'])
const DATA_REFS = new Set<DataRef>(['apyVsBenchmarks', 'maturityDistribution'])
const SECTION_REFS = new Set<SectionRef>(['onchainMetrics', 'smartContracts'])
const LIVE_METRICS = new Set<LiveMetric>(['tokenPrice', 'nav', 'apy30d', 'navChange', 'monthlyReturn'])
const LIVE_DATASETS = new Set<LiveDataset>(['monthlySummary'])
const KEY_FACT_REFS = new Set(['apy', 'availableNetworks', 'ratings'])
const COLUMN_FORMATS = new Set<ColumnFormat>(['text', 'number', 'percent', 'currency'])
const CONTENT_BLOCK_TYPES = new Set([
  'text',
  'table',
  'chart',
  'image',
  'kpiGroup',
  'tabGroup',
  'liveTable',
  'documents',
  'accordion',
  'columns',
])
const TAB_BLOCK_TYPES = new Set(['text', 'table', 'chart', 'kpiGroup'])
const KPI_TRENDS = new Set(['up', 'down', 'neutral'])
const KPI_VARIANTS = new Set(['plain', 'boxed', 'cards'])
const COLUMN_RATIOS = new Set(['1:1', '3:2', '2:1', '2:3', '1:2'])

function fail(message: string): never {
  throw new Error(`pool metadata v2: ${message}`)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertString(value: unknown, where: string): asserts value is string {
  if (typeof value !== 'string') fail(`${where} must be a string`)
}

function assertVisibility(value: unknown, where: string): void {
  if (value === undefined) return
  if (typeof value === 'string') {
    if (!VISIBILITY_SCALARS.has(value)) fail(`${where} has invalid visibility "${value}"`)
    return
  }
  // An array combines gates with AND. `public`/`hidden` are scalars, never array members.
  if (Array.isArray(value)) {
    if (value.length === 0) fail(`${where} visibility array must not be empty`)
    const seen = new Set<string>()
    value.forEach((gate) => {
      if (typeof gate !== 'string' || !VISIBILITY_GATES.has(gate as VisibilityGate)) {
        fail(`${where} has an invalid visibility gate "${String(gate)}"`)
      }
      if (seen.has(gate)) fail(`${where} has a duplicate visibility gate "${gate}"`)
      seen.add(gate)
    })
    return
  }
  fail(`${where} has invalid visibility "${String(value)}"`)
}

function isPrimitiveCell(value: unknown): value is string | number {
  return typeof value === 'string' || typeof value === 'number'
}

function validateFile(value: unknown, where: string): void {
  if (!isObject(value)) fail(`${where} must be a file object`)
  assertString(value.uri, `${where}.uri`)
  assertString(value.mime, `${where}.mime`)
}

const BUILTIN_LINK_KEYS = new Set(['executiveSummary', 'website', 'forum'])

function validateLinkDocuments(documents: unknown): void {
  if (!Array.isArray(documents)) fail('`pool.links.documents` must be an array')
  const seen = new Set<string>()
  documents.forEach((doc, index) => {
    const where = `pool.links.documents[${index}]`
    if (!isObject(doc)) fail(`${where} must be an object`)
    if (typeof doc.key !== 'string' || doc.key.length === 0) fail(`${where}.key must be a non-empty string`)
    if (typeof doc.label !== 'string' || doc.label.length === 0) fail(`${where}.label must be a non-empty string`)
    // Exactly one of file (object) or non-empty href. A null file counts as absent.
    const hasFile = isObject(doc.file)
    const hasHref = typeof doc.href === 'string' && doc.href.length > 0
    if (hasFile === hasHref) fail(`${where} must set exactly one of \`file\` or \`href\``)
    if (hasFile) validateFile(doc.file, `${where}.file`)
    // Built-ins resolve first, so a colliding key would be ambiguous (unreachable).
    if (BUILTIN_LINK_KEYS.has(doc.key)) fail(`${where}.key "${doc.key}" collides with a built-in link key`)
    if (seen.has(doc.key)) fail(`${where}.key "${doc.key}" is duplicated`)
    seen.add(doc.key)
  })
}

function validateLinkTarget(value: unknown, where: string): void {
  if (!isObject(value)) fail(`${where} must be an object`)
  switch (value.kind) {
    case 'file':
      validateFile(value.file, `${where}.file`)
      break
    case 'href':
      assertString(value.href, `${where}.href`)
      break
    case 'linkRef':
      // Resolved app-side against the typed `pool.links`; an unknown key hides the link (lenient).
      assertString(value.linkRef, `${where}.linkRef`)
      break
    default:
      fail(`${where} has an invalid kind "${String(value.kind)}"`)
  }
}

function validateIconRef(value: unknown, where: string): void {
  if (!isObject(value)) fail(`${where} must be an object`)
  if (value.label !== undefined) assertString(value.label, `${where}.label`)
  switch (value.source) {
    case 'metadata':
      validateFile(value.file, `${where}.file`)
      if (value.alt !== undefined) assertString(value.alt, `${where}.alt`)
      break
    case 'app':
      // The app-owned icon-key registry is not yet enumerated, so validate shape (string) only.
      assertString(value.key, `${where}.key`)
      break
    default:
      fail(`${where} has an invalid source "${String(value.source)}"`)
  }
}

function validateKeyFactValue(value: unknown, where: string): void {
  if (!isObject(value)) fail(`${where} must be an object`)
  switch (value.kind) {
    case 'text':
      assertString(value.text, `${where}.text`)
      break
    case 'icons':
      if (!Array.isArray(value.icons)) fail(`${where}.icons must be an array`)
      value.icons.forEach((icon, index) => validateIconRef(icon, `${where}.icons[${index}]`))
      break
    case 'ref':
      // Closed, SDK-enforced registry (extended via a coordinated SDK release).
      if (typeof value.ref !== 'string' || !KEY_FACT_REFS.has(value.ref)) {
        fail(`${where}.ref is invalid (unknown ref "${String(value.ref)}")`)
      }
      break
    default:
      fail(`${where} has an invalid kind "${String(value.kind)}"`)
  }
}

function validateKeyFact(value: unknown, where: string): void {
  if (!isObject(value)) fail(`${where} must be an object`)
  assertString(value.label, `${where}.label`)
  validateKeyFactValue(value.value, `${where}.value`)
  if (value.tooltip !== undefined) assertString(value.tooltip, `${where}.tooltip`)
  if (value.href !== undefined) assertString(value.href, `${where}.href`)
  assertVisibility(value.visibility, where)
}

function validateKeyFactGroup(value: unknown, where: string): void {
  if (!isObject(value)) fail(`${where} must be an object`)
  if (value.type !== 'keyFactGroup') fail(`${where}.type must be 'keyFactGroup'`)
  assertString(value.id, `${where}.id`)
  if (value.title !== undefined) assertString(value.title, `${where}.title`)
  if (value.subtitle !== undefined) assertString(value.subtitle, `${where}.subtitle`)
  assertVisibility(value.visibility, where)
  if (!Array.isArray(value.items)) fail(`${where}.items must be an array`)
  value.items.forEach((item, index) => validateKeyFact(item, `${where}.items[${index}]`))
}

function validateChartSeries(value: unknown, where: string): void {
  if (!isObject(value)) fail(`${where} must be an object`)
  assertString(value.name, `${where}.name`)
  if (value.color !== undefined) assertString(value.color, `${where}.color`)
  if (!Array.isArray(value.data)) fail(`${where}.data must be an array`)
  value.data.forEach((point, index) => {
    if (!isObject(point)) fail(`${where}.data[${index}] must be an object`)
    const isCategorical = typeof point.value === 'number' && typeof point.label === 'string'
    const isXy = (typeof point.x === 'string' || typeof point.x === 'number') && typeof point.y === 'number'
    if (!isCategorical && !isXy) fail(`${where}.data[${index}] must be {label,value} or {x,y}`)
  })
}

function validateLiveColumn(value: unknown, where: string): void {
  if (!isObject(value)) fail(`${where} must be an object`)
  assertString(value.header, `${where}.header`)
  if (
    value.format !== undefined &&
    (typeof value.format !== 'string' || !COLUMN_FORMATS.has(value.format as ColumnFormat))
  ) {
    fail(`${where}.format is invalid`)
  }
  assertVisibility(value.visibility, where)
  switch (value.source) {
    case 'indexer':
      if (typeof value.metric !== 'string' || !LIVE_METRICS.has(value.metric as LiveMetric)) {
        fail(`${where} has an invalid indexer metric "${String(value.metric)}"`)
      }
      break
    case 'hardcoded':
      assertString(value.key, `${where}.key`)
      break
    case 'static':
      if (!Array.isArray(value.values) || !value.values.every(isPrimitiveCell)) {
        fail(`${where}.values must be an array of strings/numbers`)
      }
      break
    default:
      fail(`${where} has an invalid source "${String(value.source)}"`)
  }
}

function validateContentBlock(block: Record<string, unknown>, type: string, where: string): void {
  switch (type) {
    case 'text':
      assertString(block.body, `${where}.body`)
      // Optional Overview-card extras.
      if (block.logo !== undefined) validateFile(block.logo, `${where}.logo`)
      if (block.background !== undefined) assertString(block.background, `${where}.background`)
      if (block.links !== undefined) {
        if (!Array.isArray(block.links)) fail(`${where}.links must be an array`)
        block.links.forEach((link, index) => {
          if (!isObject(link)) fail(`${where}.links[${index}] must be an object`)
          assertString(link.label, `${where}.links[${index}].label`)
          validateLinkTarget(link.target, `${where}.links[${index}].target`)
        })
      }
      break
    case 'table': {
      if (!Array.isArray(block.headers) || !block.headers.every((h) => typeof h === 'string')) {
        fail(`${where}.headers must be an array of strings`)
      }
      if (!Array.isArray(block.rows) || !block.rows.every((row) => Array.isArray(row) && row.every(isPrimitiveCell))) {
        fail(`${where}.rows must be an array of string/number arrays`)
      }
      if (block.columnVisibility !== undefined) {
        if (!Array.isArray(block.columnVisibility)) fail(`${where}.columnVisibility must be an array`)
        if (block.columnVisibility.length !== block.headers.length) {
          fail(`${where}.columnVisibility length must match headers length`)
        }
        block.columnVisibility.forEach((v, index) => assertVisibility(v, `${where}.columnVisibility[${index}]`))
      }
      break
    }
    case 'chart': {
      if (typeof block.chartType !== 'string' || !CHART_TYPES.has(block.chartType as ChartType)) {
        fail(`${where}.chartType is invalid`)
      }
      // Data source is a single discriminated `data` (inline series XOR app/indexer dataRef).
      if (!isObject(block.data)) fail(`${where}.data must be an object`)
      switch (block.data.kind) {
        case 'inline':
          if (!Array.isArray(block.data.series)) fail(`${where}.data.series must be an array`)
          block.data.series.forEach((s, index) => validateChartSeries(s, `${where}.data.series[${index}]`))
          break
        case 'ref':
          // Closed, SDK-enforced registry (extended via a coordinated SDK release).
          if (typeof block.data.dataRef !== 'string' || !DATA_REFS.has(block.data.dataRef as DataRef)) {
            fail(`${where}.data.dataRef is invalid (unknown key "${String(block.data.dataRef)}")`)
          }
          break
        default:
          fail(`${where}.data has an invalid kind "${String(block.data.kind)}"`)
      }
      if (isObject(block.xAxis) && block.xAxis.type !== undefined && !XAXIS_TYPES.has(block.xAxis.type as string)) {
        fail(`${where}.xAxis.type is invalid`)
      }
      if (
        isObject(block.yAxis) &&
        block.yAxis.format !== undefined &&
        !AXIS_FORMATS.has(block.yAxis.format as AxisFormat)
      ) {
        fail(`${where}.yAxis.format is invalid`)
      }
      break
    }
    case 'image':
      validateFile(block.file, `${where}.file`)
      break
    case 'kpiGroup': {
      if (block.columns !== undefined && ![1, 2, 3, 4].includes(block.columns as number)) {
        fail(`${where}.columns must be 1, 2, 3 or 4`)
      }
      if (block.variant !== undefined && !KPI_VARIANTS.has(block.variant as string)) {
        fail(`${where}.variant must be one of plain, boxed, cards`)
      }
      if (!Array.isArray(block.items)) fail(`${where}.items must be an array`)
      block.items.forEach((item, index) => {
        if (!isObject(item)) fail(`${where}.items[${index}] must be an object`)
        assertString(item.label, `${where}.items[${index}].label`)
        assertString(item.value, `${where}.items[${index}].value`)
        if (item.delta !== undefined) assertString(item.delta, `${where}.items[${index}].delta`)
        if (item.secondary !== undefined) assertString(item.secondary, `${where}.items[${index}].secondary`)
        if (item.trend !== undefined && !KPI_TRENDS.has(item.trend as string)) {
          fail(`${where}.items[${index}].trend is invalid`)
        }
        assertVisibility(item.visibility, `${where}.items[${index}]`)
      })
      break
    }
    case 'tabGroup': {
      if (!Array.isArray(block.tabs)) fail(`${where}.tabs must be an array`)
      block.tabs.forEach((tab, index) => {
        if (!isObject(tab)) fail(`${where}.tabs[${index}] must be an object`)
        assertString(tab.label, `${where}.tabs[${index}].label`)
        validateTabBlock(tab.block, `${where}.tabs[${index}].block`)
      })
      break
    }
    case 'liveTable': {
      if (typeof block.dataRef !== 'string' || !LIVE_DATASETS.has(block.dataRef as LiveDataset)) {
        fail(`${where}.dataRef is invalid (unknown dataset "${String(block.dataRef)}")`)
      }
      if (!Array.isArray(block.columns)) fail(`${where}.columns must be an array`)
      block.columns.forEach((column, index) => validateLiveColumn(column, `${where}.columns[${index}]`))
      break
    }
    case 'documents': {
      if (!Array.isArray(block.items)) fail(`${where}.items must be an array`)
      block.items.forEach((item, index) => {
        if (!isObject(item)) fail(`${where}.items[${index}] must be an object`)
        assertString(item.title, `${where}.items[${index}].title`)
        validateLinkTarget(item.target, `${where}.items[${index}].target`)
      })
      break
    }
    case 'accordion': {
      if (!Array.isArray(block.items)) fail(`${where}.items must be an array`)
      block.items.forEach((item, index) => {
        if (!isObject(item)) fail(`${where}.items[${index}] must be an object`)
        assertString(item.title, `${where}.items[${index}].title`)
        if (item.defaultOpen !== undefined && typeof item.defaultOpen !== 'boolean') {
          fail(`${where}.items[${index}].defaultOpen must be a boolean`)
        }
        validateTabBlock(item.block, `${where}.items[${index}].block`)
      })
      break
    }
    case 'columns': {
      if (block.ratio !== undefined && !COLUMN_RATIOS.has(block.ratio as string)) {
        fail(`${where}.ratio is invalid (expected one of 1:1, 3:2, 2:1, 2:3, 1:2)`)
      }
      for (const side of ['left', 'right'] as const) {
        if (!Array.isArray(block[side])) fail(`${where}.${side} must be an array`)
        ;(block[side] as unknown[]).forEach((child, index) => validateColumnChild(child, `${where}.${side}[${index}]`))
      }
      break
    }
    default:
      fail(`${where} has an unknown block type "${type}"`)
  }
}

/** Validates the envelope every layout/column block shares: id, optional title/subtitle, visibility. */
function validateBlockEnvelope(value: Record<string, unknown>, where: string): void {
  assertString(value.id, `${where}.id`)
  if (value.title !== undefined) assertString(value.title, `${where}.title`)
  if (value.subtitle !== undefined) assertString(value.subtitle, `${where}.subtitle`)
  assertVisibility(value.visibility, where)
}

/**
 * Validates a child of a {@link ColumnsBlock} column: any content block except a nested `columns`,
 * plus `keyFactGroup`. App-owned `section` refs are not allowed (they stay full-width).
 */
function validateColumnChild(value: unknown, where: string): void {
  if (!isObject(value)) fail(`${where} must be an object`)
  if (typeof value.type !== 'string') fail(`${where} is missing a string \`type\``)
  if (value.type === 'keyFactGroup') {
    validateKeyFactGroup(value, where)
    return
  }
  if (value.type === 'section') fail(`${where}: app-owned section refs are not allowed inside a column`)
  if (value.type === 'columns') fail(`${where}: columns cannot be nested`)
  if (!CONTENT_BLOCK_TYPES.has(value.type)) fail(`${where} has an unknown block type "${String(value.type)}"`)
  validateBlockEnvelope(value, where)
  validateContentBlock(value, value.type, where)
}

/** Validates a leaf block nested in a `tabGroup` tab or `accordion` item (the {@link TabBlock} set). */
function validateTabBlock(value: unknown, where: string): void {
  if (!isObject(value)) fail(`${where} must be an object`)
  if (typeof value.type !== 'string' || !TAB_BLOCK_TYPES.has(value.type)) {
    fail(`${where} has an invalid type "${String(value.type)}"`)
  }
  assertString(value.id, `${where}.id`)
  if (value.title !== undefined) assertString(value.title, `${where}.title`)
  if (value.subtitle !== undefined) assertString(value.subtitle, `${where}.subtitle`)
  validateContentBlock(value, value.type, where)
}

/**
 * `allowColumns` is true only for the full-width `sections` region. The top `body` is already a
 * two-column layout, so a `columns` block there is rejected.
 */
function validateLayoutItem(item: unknown, where: string, allowColumns = false): void {
  if (!isObject(item)) fail(`${where} must be an object`)
  if (typeof item.type !== 'string') fail(`${where} is missing a string \`type\``)
  validateBlockEnvelope(item, where)

  if (item.type === 'section') {
    if (typeof item.ref !== 'string' || !SECTION_REFS.has(item.ref as SectionRef)) {
      fail(`${where} has an invalid section ref "${String(item.ref)}"`)
    }
    return
  }
  if (item.type === 'columns' && !allowColumns) {
    fail(`${where}: a 'columns' block is only allowed in the full-width sections region`)
  }
  if (!CONTENT_BLOCK_TYPES.has(item.type)) {
    fail(`${where} has an unknown block type "${item.type}"`)
  }
  validateContentBlock(item, item.type, where)
}

function validateFactsheet(factsheet: unknown): void {
  if (!isObject(factsheet)) fail('`pool.factsheet` must be an object')
  if (!Array.isArray(factsheet.body)) fail('`pool.factsheet.body` must be an array')
  factsheet.body.forEach((item, index) => validateLayoutItem(item, `pool.factsheet.body[${index}]`))
  if (!Array.isArray(factsheet.keyFacts)) fail('`pool.factsheet.keyFacts` must be an array')
  factsheet.keyFacts.forEach((group, index) => validateKeyFactGroup(group, `pool.factsheet.keyFacts[${index}]`))
  if (factsheet.sections !== undefined) {
    if (!Array.isArray(factsheet.sections)) fail('`pool.factsheet.sections` must be an array')
    factsheet.sections.forEach((item, index) => validateLayoutItem(item, `pool.factsheet.sections[${index}]`, true))
  }
}

/**
 * Hand-rolled structural validator for v2 pool metadata, in the style of
 * {@link parseMarketplaceCatalog}. Validates the discriminant (`version === 2`), `pool.name`, and
 * the full `pool.factsheet` content model (the layout the SDK is responsible for). Engine fields
 * (`shareClasses`, `workflowPolicies`, `addressLabels`, …) are passed through
 * unchecked here — they are validated where they are consumed (e.g. workflows via
 * {@link parseMarketplaceCatalog}). Throws `pool metadata v2: …` on the first malformed field;
 * tolerates missing optionals (visibility defaults to `'public'` app-side). Returns the input
 * narrowed to {@link PoolMetadataV2} on success.
 */
export function parsePoolMetadataV2(raw: unknown): PoolMetadataV2 {
  if (!isObject(raw)) fail('expected a JSON object')
  if (raw.version !== 2) fail(`expected version 2, got ${String(raw.version)}`)
  if (!isObject(raw.pool)) fail('`pool` must be an object')
  assertString(raw.pool.name, '`pool.name`')
  if (raw.pool.geoRestrictions !== undefined) validateGeoRestrictions(raw.pool.geoRestrictions)
  if (isObject(raw.pool.links) && raw.pool.links.documents !== undefined) {
    validateLinkDocuments(raw.pool.links.documents)
  }
  if (raw.pool.factsheet !== undefined) validateFactsheet(raw.pool.factsheet)
  return raw as PoolMetadataV2
}

/**
 * Resolves a {@link LinkTarget} to a `{ href }` or `{ file }` against a pool's `links`. `linkRef`
 * checks the built-in keys first (`executiveSummary` -> file, `website`/`forum` -> url), then
 * `links.documents` by `key`. Returns `null` on no match (callers self-blank; never throw). Shared
 * so the SDK and the invest app resolve references identically.
 */
export function resolveLinkTarget(
  links: PoolMetadataV1['pool']['links'] | undefined,
  target: LinkTarget
): { href?: string; file?: FileType } | null {
  switch (target.kind) {
    case 'file':
      return { file: target.file }
    case 'href':
      return { href: target.href }
    case 'linkRef': {
      const key = target.linkRef
      if (key === 'executiveSummary') return links?.executiveSummary ? { file: links.executiveSummary } : null
      if (key === 'website') return links?.website ? { href: links.website } : null
      if (key === 'forum') return links?.forum ? { href: links.forum } : null
      const doc = links?.documents?.find((d) => d.key === key)
      if (!doc) return null
      if (doc.file) return { file: doc.file }
      if (doc.href) return { href: doc.href }
      return null
    }
    default:
      return null
  }
}

/** Validates `pool.geoRestrictions.regions` as ISO 3166-1 alpha-2 codes (format only, strict on write). */
function validateGeoRestrictions(geoRestrictions: unknown): void {
  if (!isObject(geoRestrictions)) fail('`pool.geoRestrictions` must be an object')
  if (!Array.isArray(geoRestrictions.regions)) fail('`pool.geoRestrictions.regions` must be an array')
  geoRestrictions.regions.forEach((region, index) => {
    if (typeof region !== 'string' || !REGION_CODE_RE.test(region)) {
      fail(`pool.geoRestrictions.regions[${index}] must be an ISO 3166-1 alpha-2 code, got "${String(region)}"`)
    }
  })
}
