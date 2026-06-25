import type { HexString } from '../types/index.js'
import {
  type ApyMode,
  type AxisFormat,
  type ChartType,
  type ColumnFormat,
  type DataRef,
  type Factsheet,
  isPoolMetadataV2,
  type KeyFact,
  type KeyFactGroup,
  type LayoutItem,
  type LegacyApyMode,
  type LiveDataset,
  type LiveMetric,
  type PoolMetadata,
  type PoolMetadataV1,
  type PoolMetadataV2,
  type SectionRef,
  type Visibility,
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

/** Escapes markdown link-breaking characters so an issuer-supplied label can't alter the link. */
function escapeMarkdownText(text: string): string {
  return text.replace(/[\\[\]()]/g, '\\$&').replace(/\s+/g, ' ')
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

  const text = (value: string): KeyFact['value'] => ({ kind: 'text', text: value })

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

  // Issuer categories are split: known service-provider roles go into a "Service providers" group,
  // everything else stays in "Key facts". Matching is case/separator-insensitive; an unknown type
  // falls back to "Key facts" (the seed is ops-editable, so a miss is low-cost).
  const serviceProviderItems: KeyFact[] = []
  for (const category of issuer.categories) {
    const key = normalizeCategoryType(category.type)
    if (ABSORBED_CATEGORY_TYPES.has(key)) continue // e.g. Investment Manager -> the Issuer key fact
    const label = SERVICE_PROVIDER_CATEGORIES.get(key)
    if (label) {
      serviceProviderItems.push({ label, value: text(category.value) })
    } else {
      keyFactItems.push({ label: category.type, value: text(category.value) })
    }
  }

  // Seeded for every migrated pool (app-derived, no v1 source): the wallet infrastructure icon and
  // the live "available networks" ref. Both are ops-editable afterwards.
  keyFactItems.push({
    label: 'Wallet infrastructure',
    value: { kind: 'icons', icons: [{ source: 'app', key: 'fordefi' }] },
  })
  keyFactItems.push({ label: 'Available networks', value: { kind: 'ref', ref: 'availableNetworks' } })

  // Ratings render via the `ratings` ref widget, reading the typed `poolRatings` field verbatim
  // (agency/value/reportUrl/reportFile). The data is not duplicated into the key fact.
  if ((poolRatings ?? []).length > 0) {
    keyFactItems.push({ label: 'Ratings', value: { kind: 'ref', ref: 'ratings' } })
  }

  // The right column is groups only. Seed a titled "Key facts" group, plus a "Service providers"
  // group when any category matched.
  const keyFacts: KeyFactGroup[] = [{ type: 'keyFactGroup', id: 'key-facts', title: 'Key facts', items: keyFactItems }]
  if (serviceProviderItems.length > 0) {
    keyFacts.push({
      type: 'keyFactGroup',
      id: 'service-providers',
      title: 'Service providers',
      items: serviceProviderItems,
    })
  }

  const body: LayoutItem[] = []
  if (issuer.description) {
    body.push({ type: 'text', id: 'overview', title: 'Overview', body: issuer.description })
  }
  ;(details ?? []).forEach((detail, index) => {
    body.push({ type: 'text', id: `detail-${index}`, title: detail.title, body: detail.body })
  })
  // Ratings reports are surfaced two ways: a Documents body block (markdown links to the report
  // PDFs) and the `ratings` key-fact ref pill above. Both read the same typed `poolRatings` field.
  const ratingsWithReports = (poolRatings ?? []).filter(
    (rating) => rating.reportFile?.uri && isSafeDocumentUri(rating.reportFile.uri)
  )
  if (ratingsWithReports.length > 0) {
    body.push({
      type: 'text',
      id: 'documents',
      title: 'Documents',
      body: ratingsWithReports
        .map(
          (rating) => `- [${escapeMarkdownText(rating.agency ?? 'Rating')} rating report](${rating.reportFile!.uri})`
        )
        .join('\n'),
    })
  }
  body.push({ type: 'section', id: 'performance', ref: 'onchainMetrics' })

  // Legacy off-chain `holdings` ({ headers, data }) is folded into the factsheet as a `table`
  // section, faithfully (no column dropped). Skipped entirely when there are no headers or no data.
  const sections: LayoutItem[] = []
  if (holdings && holdings.headers.length > 0 && holdings.data) {
    const { headers, data } = holdings
    sections.push({
      type: 'table',
      id: 'holdings',
      title: 'Holdings',
      headers,
      rows: data.map((row) =>
        headers.map((header) => {
          const value = row[header]
          return typeof value === 'number' ? value : value == null ? '' : String(value)
        })
      ),
    })
  }

  // `sections` is omitted (so the invest app renders its defaults) unless we have a holdings table.
  return sections.length > 0 ? { body, keyFacts, sections } : { body, keyFacts }
}

/**
 * Pure, idempotent legacy -> v2 migration. Performs no IPFS/network access so it stays
 * unit-testable. Returns the input unchanged when it is already v2.
 *
 * - Strips fields unused by every consumer (`newInvestmentsStatus`, `reports`, `loanTemplates`,
 *   `issuer.repName/shortDescription`, onboarding extras) and reshapes `issuer`. `poolRatings` is
 *   preserved verbatim as a typed field (surfaced via the `ratings` key-fact ref).
 * - Maps legacy APY modes across `shareClasses[*].apy`.
 * - Projects the legacy display fields into `pool.factsheet`, and folds the off-chain `holdings`
 *   blob into a `table` section (`id: 'holdings'`); `holdings` is not carried as a top-level field.
 */
export function migratePoolMetadataToV2(legacy: PoolMetadata): PoolMetadataV2 {
  if (isPoolMetadataV2(legacy)) return legacy

  const { pool, shareClasses, onboarding, merkleProofManager, holdings, addressLabels, workflowPolicies } = legacy
  const { issuer, poolRatings, ...restPool } = pool
  // Explicitly drop fields that v2 does not carry.
  delete (restPool as Record<string, unknown>).newInvestmentsStatus
  delete (restPool as Record<string, unknown>).reports
  delete (restPool as Record<string, unknown>).details

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
  }
}

/* ================================================================================================
 * Validation: hand-rolled structural checks (mirrors src/utils/catalog.ts; no zod dependency)
 * ============================================================================================== */

// All enums below are validated as closed sets. The app-owned live-data key registries
// (`dataRef` / `LiveMetric` / `LiveDataset`) and `section.ref` are PROVISIONAL and expected to grow
// (see centrifuge/apps-invest#200), but the SDK is the alignment point: an unknown key is rejected
// on WRITE so the management app, SDK, and invest app stay in sync (adding a key ships in an SDK
// release). The read path does not validate, so a newer document never breaks an older reader.
const VISIBILITIES = new Set<Visibility>(['public', 'whitelisted', 'hidden'])
const CHART_TYPES = new Set<ChartType>(['line', 'area', 'bar', 'donut'])
const AXIS_FORMATS = new Set<AxisFormat>(['number', 'percent', 'currency'])
const XAXIS_TYPES = new Set(['category', 'time', 'number'])
const DATA_REFS = new Set<DataRef>(['apyVsBenchmarks', 'maturityDistribution'])
const SECTION_REFS = new Set<SectionRef>(['onchainMetrics', 'smartContracts'])
const LIVE_METRICS = new Set<LiveMetric>(['tokenPrice', 'nav', 'apy30d', 'navChange', 'monthlyReturn'])
const LIVE_DATASETS = new Set<LiveDataset>(['monthlySummary'])
const KEY_FACT_REFS = new Set(['apy', 'availableNetworks', 'ratings'])
const COLUMN_FORMATS = new Set<ColumnFormat>(['text', 'number', 'percent', 'currency'])
const CONTENT_BLOCK_TYPES = new Set(['text', 'table', 'chart', 'image', 'kpiGroup', 'tabGroup', 'liveTable'])
const TAB_BLOCK_TYPES = new Set(['text', 'table', 'chart', 'kpiGroup'])
const KPI_TRENDS = new Set(['up', 'down', 'neutral'])

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
  if (typeof value !== 'string' || !VISIBILITIES.has(value as Visibility)) {
    fail(`${where} has invalid visibility "${String(value)}"`)
  }
}

function isPrimitiveCell(value: unknown): value is string | number {
  return typeof value === 'string' || typeof value === 'number'
}

function validateFile(value: unknown, where: string): void {
  if (!isObject(value)) fail(`${where} must be a file object`)
  assertString(value.uri, `${where}.uri`)
  assertString(value.mime, `${where}.mime`)
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
      if (!Array.isArray(block.items)) fail(`${where}.items must be an array`)
      block.items.forEach((item, index) => {
        if (!isObject(item)) fail(`${where}.items[${index}] must be an object`)
        assertString(item.label, `${where}.items[${index}].label`)
        assertString(item.value, `${where}.items[${index}].value`)
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
        if (!isObject(tab.block)) fail(`${where}.tabs[${index}].block must be an object`)
        const tabBlock = tab.block
        if (typeof tabBlock.type !== 'string' || !TAB_BLOCK_TYPES.has(tabBlock.type)) {
          fail(`${where}.tabs[${index}].block has an invalid type "${String(tabBlock.type)}"`)
        }
        assertString(tabBlock.id, `${where}.tabs[${index}].block.id`)
        validateContentBlock(tabBlock, tabBlock.type, `${where}.tabs[${index}].block`)
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
    default:
      fail(`${where} has an unknown block type "${type}"`)
  }
}

function validateLayoutItem(item: unknown, where: string): void {
  if (!isObject(item)) fail(`${where} must be an object`)
  if (typeof item.type !== 'string') fail(`${where} is missing a string \`type\``)
  assertString(item.id, `${where}.id`)
  assertVisibility(item.visibility, where)

  if (item.type === 'section') {
    if (typeof item.ref !== 'string' || !SECTION_REFS.has(item.ref as SectionRef)) {
      fail(`${where} has an invalid section ref "${String(item.ref)}"`)
    }
    return
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
    factsheet.sections.forEach((item, index) => validateLayoutItem(item, `pool.factsheet.sections[${index}]`))
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
  if (raw.pool.factsheet !== undefined) validateFactsheet(raw.pool.factsheet)
  return raw as PoolMetadataV2
}
