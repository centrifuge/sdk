import { parseAbiItem } from 'viem'
import type { AbiParameter } from 'viem'
import { MAGIC_VARIABLE_KEYS } from './variables.js'
import type { CatalogAction, CatalogTemplate, CatalogVariable } from '../types/workflow.js'

/**
 * The authoring rules from `centrifuge/workflows`' `src/validate.ts`, applied to catalog
 * data the SDK did not build.
 *
 * That validator runs offline, over the repo's own files, before a catalog is published — so
 * it can only vouch for catalogs it built. The SDK re-derives the same workflows at ingest
 * time from JSON fetched over the network, and a manager signs a policy root over the result.
 * Every rule here is one whose violation makes the reviewed workflow a poor description of
 * the executed one, which is exactly what a policy signature is supposed to rule out.
 *
 * These are pure functions of `(workflow, template)` — no filesystem, no network — so
 * `centrifuge/workflows` consumes them too rather than keeping a second copy.
 */

/**
 * Implicitly available to every template; resolved by the SDK at policy-creation time.
 *
 * Derived from the same list `buildWorkflowDefinitionFromCatalog` classifies against, so a
 * name cannot be magic to the compiler and undeclared to these rules at once.
 */
export const MAGIC_VARIABLE_NAMES = new Set(MAGIC_VARIABLE_KEYS.map((key) => key.slice(1)))

/** The action shape the selector rule reads — `selector` is untrusted, so not typed as present. */
export interface SelectorAction {
  name?: string
  selector?: unknown
  inputs?: { parameter: string }[]
}

/** Action shape for value-level input rules: the parameter plus what was pinned into it. */
export interface SelectorActionWithInputs {
  name?: string
  selector?: unknown
  inputs?: { parameter: string; label?: string; input?: unknown[] }[]
}

/** The template shape the taint walk reads. Structural, so an authoring template fits too. */
export interface TaintTemplate {
  id?: string
  actions?: unknown[]
  variables?: CatalogVariable[]
}

/** The template shape the workflow-level rules read. */
export interface DeclaringTemplate {
  variables?: CatalogVariable[]
}

/** One rule violation. `rule` is a stable slug so callers can filter or group. */
export interface RuleViolation {
  rule: string
  message: string
}

// ---------------------------------------------------------------------------
// Selector parsing
// ---------------------------------------------------------------------------

/** Renders a parsed ABI parameter back to its canonical type string. */
function renderParameter(parameter: AbiParameter): string {
  if (!parameter.type.startsWith('tuple')) return parameter.type
  const components = (parameter as { components: readonly AbiParameter[] }).components
  // `tuple`, `tuple[]`, `tuple[3]` — keep whatever array suffix followed the word.
  return `(${components.map(renderParameter).join(',')})${parameter.type.slice('tuple'.length)}`
}

/**
 * Flattens one selector parameter to the inputs a template declares for it.
 *
 * Templates flatten tuple *structs* into individual inputs, so `(uint256,address)` is two.
 * Tuple *arrays* stay atomic — `(address,uint256)[]` is a single ABI-encoded value in one
 * slot — as do ordinary arrays.
 */
function flattenParameter(parameter: AbiParameter): string[] {
  if (parameter.type !== 'tuple') return [renderParameter(parameter)]
  const components = (parameter as { components: readonly AbiParameter[] }).components
  return components.flatMap(flattenParameter)
}

/**
 * The ordered parameter types a human-readable selector declares, after tuple flattening.
 *
 * `null` when the selector is malformed. This is the list an action's `inputs[].parameter`
 * sequence must match exactly — same types, same order.
 */
export function parseSelectorParameters(selector: string): string[] | null {
  try {
    const item = parseAbiItem(selector)
    if (item.type !== 'function') return null
    return item.inputs.flatMap(flattenParameter)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Per-action rules
// ---------------------------------------------------------------------------

/**
 * The action's declared inputs must match its selector's parameters in count, type and order.
 *
 * The selector is what the target actually decodes; `inputs[].parameter` is what a reviewer
 * reads and what the SDK encodes. Where they disagree, the manager approves one argument
 * schema and the chain executes another — visible `Guard`, `Refund` or `Max slippage` fields
 * that the selected function never consumes, or a field rendered as a `uint256` that lands in
 * an `address` position.
 */
/**
 * An `address`-typed input must carry something address-shaped.
 *
 * A literal in an address slot is pinned at publish time and never reviewed against the ABI, so a
 * malformed one — a short hex string, a decimal, a 32-byte word that isn't a left-padded address —
 * encodes as a different account than the catalog appears to name. `checkActionSelectorSchema`
 * proves the *types* line up with the selector; this proves the pinned *values* do.
 *
 * `$references` are not resolved here: their values arrive per workflow (`pinned`), per policy
 * (`configurable`) or per execution (`runtime`), and the encoder rejects a non-address at that
 * point. Only literals are decidable from the template alone.
 *
 * Ported from centrifuge/workflows' `checkAddressInputs`, which could only vouch for catalogs that
 * repo built — this runs on every catalog the SDK ingests.
 */
export function checkAddressLiterals(
  action: SelectorActionWithInputs,
  describe: string,
  /**
   * A workflow's `variables`, when checking in workflow context. A `$reference` that resolves here
   * is a value the catalog pinned, so it is as decidable as an inline literal — this is what
   * catches a token id or a uint256 amount wired into an address slot.
   */
  variables?: Record<string, string>
): RuleViolation[] {
  const violations: RuleViolation[] = []

  for (const [index, input] of (action.inputs ?? []).entries()) {
    if (!isAddressParameter(input.parameter)) continue
    const raw = input.input?.[0]
    if (typeof raw !== 'string' || raw === '') continue

    let value = raw
    let via = ''
    if (raw.startsWith('$')) {
      const name = raw.slice(1)
      const resolved = variables?.[name]
      // Unresolved references get their values per policy or per execution, and the encoder
      // rejects a non-address there; only a pinned value is decidable now.
      if (typeof resolved !== 'string' || resolved.startsWith('$')) continue
      value = resolved
      via = ` via ${raw}`
    }

    if (!isAddressLikeLiteral(value)) {
      violations.push({
        rule: 'address-literal',
        message: `${describe} input ${index} ("${input.label ?? input.parameter}") is an address parameter with a non-address value${via}: "${value}"`,
      })
    }
  }

  return violations
}

/** `address`, and the tuple-array forms whose members are addresses. */
function isAddressParameter(parameter: string): boolean {
  return parameter === 'address' || parameter === 'address[]'
}

/** A 20-byte address, or a left-padded 32-byte word carrying one. */
function isAddressLikeLiteral(value: string): boolean {
  if (/^0x[0-9a-fA-F]{40}$/.test(value)) return true
  return /^0x0{24}[0-9a-fA-F]{40}$/.test(value)
}

export function checkActionSelectorSchema(action: SelectorAction, describe: string): RuleViolation[] {
  const selector = action.selector

  if (typeof selector !== 'string' || !selector.startsWith('function ')) {
    return [{ rule: 'selector-format', message: `${describe} selector must start with "function ": "${selector}"` }]
  }

  const expected = parseSelectorParameters(selector)
  if (expected === null) {
    return [{ rule: 'selector-format', message: `${describe} has a malformed selector: "${selector}"` }]
  }

  const actual = (action.inputs ?? []).map((input) => input.parameter)

  if (expected.length !== actual.length) {
    return [
      {
        rule: 'selector-arity',
        message: `${describe} selector "${selector}" expects ${expected.length} input(s) after tuple flattening but action provides ${actual.length}`,
      },
    ]
  }

  const violations: RuleViolation[] = []
  for (const [index, type] of expected.entries()) {
    if (normalizeType(actual[index]) !== normalizeType(type)) {
      violations.push({
        rule: 'selector-parameter-type',
        message: `${describe} input ${index} declares "${actual[index]}" but selector "${selector}" decodes "${type}" in that position`,
      })
    }
  }
  return violations
}

function normalizeType(parameter: string | undefined): string {
  return (parameter ?? '').replace(/\s+/g, '')
}

// ---------------------------------------------------------------------------
// Raw-calldata taint
// ---------------------------------------------------------------------------

/**
 * A `bytes` argument must never derive from a strategist-supplied value.
 *
 * A `bytes` payload is what callback-capable targets interpret as nested actions or a
 * forwarded call — `requestFlashLoan(...,bytes)` being the shape that matters. Letting a
 * runtime variable reach one hands the strategist a second script that no reviewer saw and
 * no hash covers. Taint follows `returns`, so a value laundered through an intermediate
 * action is still tainted.
 *
 * `runtimeBytesAck` opts a single input out, for targets that validate the bytes
 * cryptographically (a CCTP attestation) — the acknowledgement text says why.
 *
 * `resolveUse` exists for authoring-time templates, whose `use` entries are separate
 * templates that taint crosses through a `map`. Compiled catalog templates have those
 * inlined already, so the SDK passes nothing.
 */
export function checkRawCalldataTaint(
  template: TaintTemplate,
  options: {
    describe: (action: CatalogAction) => string
    resolveUse?: (entry: unknown) => { template: TaintTemplate; map: Record<string, string>; returns?: string } | null
  }
): RuleViolation[] {
  const violations: RuleViolation[] = []
  const visiting = new Set<string>()

  /** Returns whether this template's final output is tainted. */
  function walk(current: TaintTemplate, seeded: Set<string>): boolean {
    const id = current.id ?? ''
    if (id && visiting.has(id)) return false
    if (id) visiting.add(id)

    const tainted = new Set<string>([
      ...seeded,
      ...(current.variables ?? []).filter((v) => v.kind === 'runtime').map((v) => v.name),
    ])
    const isTainted = (reference: unknown): boolean =>
      typeof reference === 'string' && reference.startsWith('$') && tainted.has(reference.slice(1))

    let lastOutputTainted = false

    for (const entry of current.actions ?? []) {
      const use = options.resolveUse?.(entry) ?? null
      if (use) {
        const childSeed = new Set<string>()
        for (const [name, value] of Object.entries(use.map)) {
          if (isTainted(value)) childSeed.add(name)
        }
        const childTainted = walk(use.template, childSeed)
        if (use.returns?.startsWith('$')) {
          if (childTainted) tainted.add(use.returns.slice(1))
          lastOutputTainted = childTainted
        } else {
          lastOutputTainted = false
        }
        continue
      }

      const action = entry as CatalogAction
      const inputs = action.inputs ?? []
      const inputsTainted = inputs.some((input) => (input.input ?? []).some(isTainted))

      for (const input of inputs) {
        if (input.parameter !== 'bytes' || input.useTemplate || input.runtimeBytesAck) continue
        for (const reference of input.input ?? []) {
          if (!isTainted(reference)) continue
          violations.push({
            rule: 'raw-calldata-taint',
            message: `${options.describe(action)} routes strategist-controlled value ${reference} into a raw-calldata bytes payload (${action.selector ?? '(use)'}) — a bytes argument must derive only from pinned/configurable values or on-chain returns, never (directly or via a helper) from a runtime variable; make it configurable, or add runtimeBytesAck if the target validates the content`,
          })
        }
      }

      if (action.returns?.startsWith('$')) {
        if (inputsTainted) tainted.add(action.returns.slice(1))
        lastOutputTainted = inputsTainted
      } else {
        lastOutputTainted = false
      }
    }

    if (id) visiting.delete(id)
    return lastOutputTainted
  }

  walk(template, new Set())
  return violations
}

/**
 * An action `returns` name must not shadow a declared template variable.
 *
 * The output and the declared slot share one weiroll index, so the action overwrites a
 * manager-pinned `configurable` value after the Merkle proof was built over the benign
 * pre-state, and later actions read something the manager never approved.
 */
/** @internal Composed by `checkTemplateTaintRules`; not part of the published API. */
export function checkReturnsDoNotShadow(template: TaintTemplate, describe: (index: number) => string): RuleViolation[] {
  const declared = new Set((template.variables ?? []).map((variable) => variable.name))
  const violations: RuleViolation[] = []

  for (const [index, entry] of (template.actions ?? []).entries()) {
    const returns = (entry as CatalogAction).returns
    if (!returns?.startsWith('$')) continue
    if (declared.has(returns.slice(1))) {
      violations.push({
        rule: 'returns-shadows-variable',
        message: `${describe(index)} return "${returns}" shadows a declared template variable`,
      })
    }
  }

  return violations
}

/**
 * An input must not reference a value some later action returns.
 *
 * A forward reference compiles to a slot that is neither pinned in the script hash nor
 * surfaced as a runtime input — invisible in review, still fillable by anyone assembling the
 * execute calldata. The read also precedes the write, so it is broken on its own terms.
 */
/** @internal Composed by `checkTemplateTaintRules`; not part of the published API. */
export function checkNoForwardReferences(
  template: TaintTemplate,
  describe: (actionIndex: number, inputIndex: number) => string
): RuleViolation[] {
  const actions = (template.actions ?? []) as CatalogAction[]
  const returnedAt = new Map<string, number>()
  for (const [index, action] of actions.entries()) {
    if (action.returns?.startsWith('$') && !returnedAt.has(action.returns)) returnedAt.set(action.returns, index)
  }

  const violations: RuleViolation[] = []
  for (const [actionIndex, action] of actions.entries()) {
    for (const [inputIndex, input] of (action.inputs ?? []).entries()) {
      for (const value of input.input ?? []) {
        const producedAt = returnedAt.get(value)
        if (producedAt !== undefined && producedAt >= actionIndex) {
          violations.push({
            rule: 'forward-reference',
            message: `${describe(actionIndex, inputIndex)} references "${value}" before the action that returns it`,
          })
        }
      }
    }
  }

  return violations
}

/**
 * `rawMode` is not part of the authoring schema in centrifuge/workflows.
 *
 * Whether an action needs FLAG_RAW calldata assembly is derived from its input types, not
 * declared — a catalog carrying the field is reaching for that path deliberately.
 */
/** @internal Composed by `checkTemplateTaintRules`; not part of the published API. */
export function checkNoDeclaredRawMode(template: TaintTemplate, describe: (index: number) => string): RuleViolation[] {
  const violations: RuleViolation[] = []
  for (const [index, entry] of (template.actions ?? []).entries()) {
    // Read off the raw entry, not CatalogAction: `rawMode` is deliberately absent from that
    // type because the authoring schema has no such field. This rule is what enforces it.
    if ((entry as Record<string, unknown>).rawMode !== undefined) {
      violations.push({
        rule: 'declared-raw-mode',
        message: `${describe(index)} sets "rawMode" — raw calldata assembly is derived from the input types, not declared`,
      })
    }
  }
  return violations
}

// ---------------------------------------------------------------------------
// Workflow-level rules
// ---------------------------------------------------------------------------

/** The shape both repos share: a catalog workflow entry. */
export interface CatalogWorkflowEntry {
  id?: string
  workflowRef?: string
  template?: string
  variables?: Record<string, string>
  useTemplate?: unknown
}

function workflowIdOf(workflow: CatalogWorkflowEntry): string {
  return workflow.id ?? workflow.workflowRef ?? '(unnamed)'
}

/**
 * A template declaring `param` variables is use-only and must never back a top-level workflow.
 *
 * `param` means "the caller binds this", so nothing pins the value: the compiler falls back to
 * treating each unbound one as a strategist runtime slot. Surfaced as a workflow, an
 * `erc20_approve` helper becomes an approval whose spender and amount the strategist chooses,
 * and `bs_withdraw` becomes a withdrawal to an address of their choosing — over assets the
 * OnchainPM holds.
 */
export function checkTemplateIsNotUseOnly(
  workflow: CatalogWorkflowEntry,
  template: DeclaringTemplate | undefined
): RuleViolation[] {
  if (!template) return []
  const params = (template.variables ?? []).filter((v) => v.kind === 'param').map((v) => v.name)
  if (params.length === 0) return []

  return [
    {
      rule: 'param-template-use-only',
      message: `workflow "${workflowIdOf(workflow)}" references template "${workflow.template}" which declares param variable(s) ${params.map((p) => `"${p}"`).join(', ')} — param templates are use-only and cannot be emitted as workflows`,
    },
  ]
}

/**
 * A workflow may fill `pinned` variables and nothing else.
 *
 * `configurable` is the hub manager's to set at policy creation and `runtime` is the
 * strategist's at execution; a workflow supplying either silently overrides a value the
 * reviewer expects to control later. An undeclared key is generator/template drift.
 */
export function checkWorkflowVariableKinds(
  workflow: CatalogWorkflowEntry,
  template: DeclaringTemplate | undefined
): RuleViolation[] {
  if (!template) return []

  const violations: RuleViolation[] = []
  const declared = template.variables ?? []
  const provided = workflow.variables ?? {}
  const id = workflowIdOf(workflow)

  for (const variable of declared) {
    if (variable.kind !== 'pinned') continue
    if (!(variable.name in provided)) {
      violations.push({
        rule: 'missing-pinned-variable',
        message: `workflow "${id}" is missing required template variable "${variable.name}"`,
      })
    }
  }

  for (const name of Object.keys(provided)) {
    const variable = declared.find((v) => v.name === name)
    if (!variable) {
      if (!MAGIC_VARIABLE_NAMES.has(name)) {
        violations.push({
          rule: 'undeclared-workflow-variable',
          message: `workflow "${id}" provides "${name}" which template "${workflow.template}" does not declare`,
        })
      }
    } else if (variable.kind === 'configurable' || variable.kind === 'runtime') {
      const setBy =
        variable.kind === 'configurable' ? 'the hub manager at policy creation' : 'the strategist at execution'
      violations.push({
        rule: 'workflow-overrides-variable',
        message: `workflow "${id}" provides "${name}" which is a ${variable.kind} variable — set by ${setBy}, not the workflow`,
      })
    }
  }

  return violations
}

/**
 * Workflow ids must be unique within a catalog.
 *
 * Policy metadata joins on the id alone, and the display, root-building and proof paths
 * resolve it differently (`Map` last-wins against `find()` first-wins). A duplicate therefore
 * lets one policy row show a benign workflow while the root binds a different script.
 */
export function checkDuplicateWorkflowIds(workflows: CatalogWorkflowEntry[]): RuleViolation[] {
  const violations: RuleViolation[] = []
  const seen = new Set<string>()

  for (const workflow of workflows) {
    if (workflow.useTemplate) continue
    const id = workflowIdOf(workflow)
    if (seen.has(id)) {
      violations.push({ rule: 'duplicate-workflow-id', message: `duplicate workflow id "${id}"` })
    }
    seen.add(id)
  }

  return violations
}

// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------

/**
 * Every shared rule, applied to one catalog workflow and the template backing it.
 *
 * Returns violations rather than throwing so a caller reporting a whole catalog can collect
 * them all; `parseMarketplaceCatalog` throws on the first.
 */
/**
 * Every rule that depends only on the template, keyed so it runs once per template rather
 * than once per workflow. The mainnet catalog is 1336 workflows over 18 distinct templates.
 *
 * Messages name the action, not the workflow — the caller prefixes the workflow it was
 * reached from, so one cached result serves every workflow sharing the template.
 */
function templateViolations(templateName: string, template: CatalogTemplate): RuleViolation[] {
  const describeAction = (index: number) => {
    const action = template.actions?.[index]
    return `template "${templateName}" action ${index} ("${action?.name ?? action?.selector}")`
  }

  const violations: RuleViolation[] = [
    ...checkNoDeclaredRawMode(template, describeAction),
    ...checkReturnsDoNotShadow(template, describeAction),
    ...checkNoForwardReferences(
      template,
      (actionIndex, inputIndex) => `${describeAction(actionIndex)} input ${inputIndex}`
    ),
    ...checkRawCalldataTaint(template, {
      describe: (action) => `template "${templateName}" action "${action.name ?? action.selector}"`,
    }),
  ]

  for (const [index, action] of (template.actions ?? []).entries()) {
    violations.push(...checkActionSelectorSchema(action, describeAction(index)))
    violations.push(...checkAddressLiterals(action as SelectorActionWithInputs, describeAction(index)))
  }

  return violations
}

/**
 * Every shared rule, applied to one catalog workflow and the template backing it.
 *
 * Returns violations rather than throwing so a caller reporting a whole catalog can collect
 * them all; `parseMarketplaceCatalog` throws on the first.
 *
 * `cache` memoizes the template half across a catalog. Pass one per catalog; omit it for a
 * one-off check.
 */
export function validateCatalogWorkflow(
  workflow: CatalogWorkflowEntry,
  templates: Record<string, CatalogTemplate>,
  cache?: Map<string, RuleViolation[]>
): RuleViolation[] {
  const templateName = workflow.template
  const template = templateName ? templates[templateName] : undefined

  const violations: RuleViolation[] = [
    ...checkTemplateIsNotUseOnly(workflow, template),
    ...checkWorkflowVariableKinds(workflow, template),
  ]

  // Every template this workflow can execute, not just the one it names. A callback template
  // reached through `useTemplate` compiles into the workflow's hashed script and runs on-chain, so
  // leaving it unchecked exempted exactly the material the review surface already hides. In the
  // published catalogs that is most of them: 59 of 77 mainnet templates are reachable only this way.
  for (const name of reachableTemplates(templateName, templates)) {
    const reached = templates[name]
    if (!reached) continue
    let cached = cache?.get(name)
    if (cached === undefined) {
      cached = templateViolations(name, reached)
      cache?.set(name, cached)
    }
    violations.push(...cached)
  }

  if (template && templateName) {
    for (const [index, action] of (template.actions ?? []).entries()) {
      violations.push(
        ...checkAddressLiterals(
          action as SelectorActionWithInputs,
          `workflow "${workflowIdOf(workflow)}" action ${index}`,
          (workflow.variables ?? {}) as Record<string, string>
        )
      )
    }
  }

  return violations
}

/** The named template plus every template reachable from it through `useTemplate`, transitively. */
function reachableTemplates(root: string | undefined, templates: Record<string, CatalogTemplate>): string[] {
  if (!root) return []
  const seen = new Set<string>()
  const queue = [root]

  while (queue.length) {
    const name = queue.shift()!
    if (seen.has(name)) continue
    seen.add(name)
    for (const action of templates[name]?.actions ?? []) {
      for (const input of (action as CatalogAction).inputs ?? []) {
        const nested = input.useTemplate?.template
        if (nested && !seen.has(nested)) queue.push(nested)
      }
    }
  }

  return [...seen]
}
