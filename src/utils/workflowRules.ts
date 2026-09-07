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

/** Implicitly available to every template; resolved by the SDK at policy-creation time. */
export const MAGIC_VARIABLE_NAMES = new Set(['onchainPM', 'onOffRamp', 'poolEscrow', 'poolId', 'scId'])

/** One rule violation. `rule` is a stable slug so callers can filter or group. */
export interface RuleViolation {
  rule: string
  message: string
}

// ---------------------------------------------------------------------------
// Selector parsing
// ---------------------------------------------------------------------------

/** Splits `a,(b,c),d` into `["a", "(b,c)", "d"]`, ignoring commas inside parentheses. */
function splitTopLevel(input: string): string[] {
  const parts: string[] = []
  let depth = 0
  let buffer = ''
  for (const char of input) {
    if (char === '(') {
      depth++
      buffer += char
    } else if (char === ')') {
      depth--
      buffer += char
    } else if (char === ',' && depth === 0) {
      parts.push(buffer.trim())
      buffer = ''
    } else {
      buffer += char
    }
  }
  if (buffer.trim()) parts.push(buffer.trim())
  return parts
}

/**
 * The flattened leaf types of one selector parameter.
 *
 * Templates flatten tuple *structs* into individual inputs, so `(uint256,address)` is two
 * inputs. Tuple *arrays* stay atomic — `(address,uint256)[]` is a single ABI-encoded value
 * in one slot — as do ordinary arrays.
 */
function flattenParameter(parameter: string): string[] {
  const trimmed = parameter.trim()
  if (!trimmed.startsWith('(')) return [trimmed]

  let depth = 0
  let closeIndex = -1
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === '(') depth++
    else if (trimmed[i] === ')') {
      depth--
      if (depth === 0) {
        closeIndex = i
        break
      }
    }
  }
  if (closeIndex === -1) return [trimmed]
  if (
    trimmed
      .slice(closeIndex + 1)
      .trim()
      .startsWith('[')
  )
    return [trimmed]

  return splitTopLevel(trimmed.slice(1, closeIndex)).flatMap(flattenParameter)
}

/**
 * The ordered parameter types a human-readable selector declares, after tuple flattening.
 *
 * `null` when the selector is malformed. This is the list an action's `inputs[].parameter`
 * sequence must match exactly — same types, same order.
 */
export function parseSelectorParameters(selector: string): string[] | null {
  const open = selector.indexOf('(')
  if (open < 0) return null

  let depth = 0
  let close = -1
  for (let i = open; i < selector.length; i++) {
    if (selector[i] === '(') depth++
    else if (selector[i] === ')') {
      depth--
      if (depth === 0) {
        close = i
        break
      }
    }
  }
  if (close < 0) return null

  const inner = selector.slice(open + 1, close).trim()
  if (inner === '') return []
  return splitTopLevel(inner).flatMap(flattenParameter)
}

/** How many inputs a selector expects after tuple flattening, or `null` if malformed. */
export function expectedInputCount(selector: string): number | null {
  return parseSelectorParameters(selector)?.length ?? null
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
export function checkActionSelectorSchema(action: CatalogAction, describe: string): RuleViolation[] {
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
export function checkRawCalldataTaint<T extends { id?: string; actions?: unknown[]; variables?: CatalogVariable[] }>(
  template: T,
  options: {
    describe: (action: CatalogAction) => string
    resolveUse?: (entry: unknown) => { template: T; map: Record<string, string>; returns?: string } | null
  }
): RuleViolation[] {
  const violations: RuleViolation[] = []
  const visiting = new Set<string>()

  /** Returns whether this template's final output is tainted. */
  function walk(current: T, seeded: Set<string>): boolean {
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
  template: CatalogTemplate | undefined
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
  template: CatalogTemplate | undefined
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
export function validateCatalogWorkflow(
  workflow: CatalogWorkflowEntry,
  templates: Record<string, CatalogTemplate>
): RuleViolation[] {
  const template = workflow.template ? templates[workflow.template] : undefined
  const id = workflowIdOf(workflow)

  const violations: RuleViolation[] = [
    ...checkTemplateIsNotUseOnly(workflow, template),
    ...checkWorkflowVariableKinds(workflow, template),
  ]

  if (template) {
    for (const [index, action] of (template.actions ?? []).entries()) {
      const describe = `workflow "${id}" action ${index} ("${action.name ?? action.selector}")`
      violations.push(...checkActionSelectorSchema(action, describe))
    }
    violations.push(
      ...checkRawCalldataTaint(template, {
        describe: (action) => `workflow "${id}" action "${action.name ?? action.selector}"`,
      })
    )
  }

  return violations
}
