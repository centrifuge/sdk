import { toFunctionSelector } from 'viem'
import type { HexString } from '../types/index.js'
import type {
  CatalogAction,
  CatalogActionInput,
  CatalogTemplate,
  CatalogVariable,
  MarketplaceWorkflow,
} from '../types/workflow.js'
import { MAGIC_VARIABLE_KEYS } from './variables.js'
import { CALL, MAX_STATE_SLOTS, UNUSED_SLOT, VALUECALL } from './weiroll.js'
import type { WeirollAction, WorkflowDefinition, WorkflowStateSlot } from './weiroll.js'

const MAGIC_KEY_SET = new Set<string>(MAGIC_VARIABLE_KEYS)

/**
 * Encodes a catalog literal value for weiroll state.
 *
 * The catalog stores values in human-readable form:
 * - Decimal integers: "0", "100", "5192296858534827628530496329220097"
 * - Booleans: "true", "false"
 * - Hex addresses (20 bytes): "0x5ba3f068..."
 * - Hex values (any length ≤ 32 bytes): "0x00010000..."
 * - Dynamic bytes: "0x63637470..."
 *
 * Static values are normalised to 0x-prefixed 32-byte values by left-padding with zeros,
 * matching Solidity ABI encoding for uint and address types. Dynamic bytes are preserved as
 * raw bytes because weiroll stores state as `bytes[]`.
 */
function encodeLiteralValue(raw: string, parameter = ''): HexString {
  if (parameter === 'bytes') {
    if (/^0x(?:[0-9a-fA-F]{2})*$/.test(raw)) {
      // A `bytes` state slot consumed via the weiroll 0x80 variable-length input specifier must
      // hold the INNER ABI encoding of the value — a 32-byte length word followed by the data
      // padded to a multiple of 32 bytes — because the VM copies the slot verbatim into the
      // calldata tail (it does NOT prepend the length). Storing the raw bytes left the length
      // word out, so a non-empty literal (e.g. CCTP's forwarding hook data) decoded as a garbage
      // length and reverted. Empty bytes naturally encode to a single 32-byte zero word
      // (length 0), which also satisfies weiroll's "non-zero multiple of 32 bytes" requirement.
      const dataHex = raw.slice(2)
      const lengthWord = (dataHex.length / 2).toString(16).padStart(64, '0')
      const paddedData = dataHex.length === 0 ? '' : dataHex.padEnd(Math.ceil(dataHex.length / 64) * 64, '0')
      return `0x${lengthWord}${paddedData}` as HexString
    }
    throw new Error(`buildWorkflowDefinitionFromCatalog: unsupported bytes literal "${raw}"`)
  }

  if (raw === 'true') return `0x${'0'.repeat(63)}1` as HexString
  if (raw === 'false') return `0x${'0'.repeat(64)}` as HexString
  if (/^\d+$/.test(raw)) return `0x${BigInt(raw).toString(16).padStart(64, '0')}` as HexString
  if (/^0x[0-9a-fA-F]+$/.test(raw)) {
    const body = raw.slice(2)
    if (body.length > 64) {
      throw new Error(`buildWorkflowDefinitionFromCatalog: hex literal "${raw}" exceeds 32 bytes`)
    }
    return `0x${body.padStart(64, '0')}` as HexString
  }

  throw new Error(`buildWorkflowDefinitionFromCatalog: unsupported literal "${raw}"`)
}

function stripVariablePrefix(raw: string): string {
  return raw.startsWith('$') ? raw.slice(1) : raw
}

function fallbackLabel(label: string | undefined, key: string, parameter: string): string {
  return label?.trim() || key || parameter
}

const RAW_CALLDATA_PARAMETER_SET = new Set<string>(['(address,uint256)[]', '(address,address)[]'])
const VARIABLE_LENGTH_PARAMETER_SET = new Set<string>(['bytes'])
const PAYABLE_VALUE_RUNTIME_KEY_PREFIX = '__sdk_payable_value:'

export interface BuildWorkflowDefinitionFromCatalogOptions {
  templates?: Record<string, CatalogTemplate>
}

function buildPayableValueRuntimeKey(actionIndex: number): string {
  return `${PAYABLE_VALUE_RUNTIME_KEY_PREFIX}${actionIndex}`
}

function isVariableLengthParameter(parameter: string): boolean {
  return VARIABLE_LENGTH_PARAMETER_SET.has(parameter)
}

function isDynamicArrayParameter(parameter: string): boolean {
  return /\[\]/.test(parameter)
}

function isDynamicAbiParameter(parameter: string): boolean {
  return (
    parameter === 'bytes' ||
    parameter === 'string' ||
    isDynamicArrayParameter(parameter) ||
    RAW_CALLDATA_PARAMETER_SET.has(parameter)
  )
}

function requiresRawCalldataParameter(parameter: string): boolean {
  return isDynamicAbiParameter(parameter) && !isVariableLengthParameter(parameter)
}

function mapTemplateReference(value: string, variableMap: Record<string, string>): string {
  if (!value.startsWith('$')) return value
  return variableMap[value.slice(1)] ?? value
}

function applyUseTemplateMap(actions: CatalogAction[], variableMap: Record<string, string>): CatalogAction[] {
  return actions.map((action) => ({
    ...action,
    target: mapTemplateReference(action.target, variableMap),
    inputs: action.inputs.map((input) => ({
      ...input,
      input: (input.input ?? []).map((value) => mapTemplateReference(value, variableMap)),
    })),
  }))
}

function encodeInputSpecifier(parameter: string, slotIndex: number): number {
  if (slotIndex < 0 || slotIndex > 0x7f) {
    throw new Error(`buildWorkflowDefinitionFromCatalog: slot index ${slotIndex} exceeds weiroll limit 127`)
  }

  return isVariableLengthParameter(parameter) ? 0x80 | slotIndex : slotIndex
}

// The 0x80 high bit marks a variable-length slot, so the index itself must fit in 7 bits.
// Output specifiers share that constraint with inputs (encodeInputSpecifier above) — validate
// it symmetrically here instead of relying solely on the aggregate slot-count check in
// buildScript(), so the precondition is explicit at every encode site.
function encodeOutputSpecifier(slotIndex: number, dynamic: boolean): number {
  if (slotIndex < 0 || slotIndex > 0x7f) {
    throw new Error(`buildWorkflowDefinitionFromCatalog: output slot index ${slotIndex} exceeds weiroll limit 127`)
  }

  return dynamic ? 0x80 | slotIndex : slotIndex
}

function inferReturnValueModes(workflow: MarketplaceWorkflow): Map<string, 'static' | 'dynamic'> {
  const returnModes = new Map<string, 'static' | 'dynamic'>()

  for (const action of workflow.actions) {
    if (!action.returns) continue

    const observedModes = new Set<'static' | 'dynamic'>()

    for (const downstreamAction of workflow.actions) {
      if (downstreamAction.target === action.returns) {
        observedModes.add('static')
      }

      for (const input of downstreamAction.inputs) {
        if ((input.input ?? []).includes(action.returns)) {
          observedModes.add(isVariableLengthParameter(input.parameter) ? 'dynamic' : 'static')
        }
      }
    }

    if (observedModes.size === 0) {
      const selector = action.selector.trim()
      if (selector.startsWith('function encode') || selector === 'function bytesConcat(bytes,bytes)') {
        observedModes.add('dynamic')
      } else {
        observedModes.add('static')
      }
    }

    if (observedModes.size > 1) {
      throw new Error(
        `buildWorkflowDefinitionFromCatalog: workflow "${workflow.workflowRef}" return "${action.returns}" is used as both a static and dynamic value`
      )
    }

    returnModes.set(action.returns, [...observedModes][0]!)
  }

  return returnModes
}

/** Validated, structurally-sound view of a fetched marketplace catalog. */
export interface ParsedMarketplaceCatalog {
  templates: Record<string, CatalogTemplate>
  workflows: Record<string, unknown>[]
}

const WORKFLOW_ID_RE = /^(0x)?[0-9a-fA-F]{64}$/

/**
 * Validates the shape of a raw marketplace catalog before it is mapped into
 * `MarketplaceWorkflow[]`.
 *
 * The catalog is untrusted data fetched over the network (IPFS gateway), so we fail
 * loudly on structural problems rather than coercing with `as any` and silently
 * producing malformed workflows. A workflow that references a missing template, or
 * carries a non-object `variables` map or a malformed `workflowId`, is a tampering /
 * integrity signal — surfacing it here prevents a manager from later being shown (and
 * signing a policy for) a workflow the SDK could not faithfully reconstruct.
 *
 * Accepts either `{ templates, workflows }` or a bare `workflows` array (the two shapes
 * the SDK already supports). Callback entries (`useTemplate` present) are passed through
 * without per-field checks since the caller filters them out.
 */
export function parseMarketplaceCatalog(raw: unknown): ParsedMarketplaceCatalog {
  if (raw === null || typeof raw !== 'object') {
    throw new Error('marketplace catalog: expected a JSON object or array')
  }

  const obj = raw as Record<string, unknown>
  const templatesRaw = Array.isArray(raw) ? {} : (obj.templates ?? {})
  if (templatesRaw === null || typeof templatesRaw !== 'object' || Array.isArray(templatesRaw)) {
    throw new Error('marketplace catalog: `templates` must be an object')
  }

  const workflowsRaw = Array.isArray(raw) ? raw : (obj.workflows ?? [])
  if (!Array.isArray(workflowsRaw)) {
    throw new Error('marketplace catalog: `workflows` must be an array')
  }

  const templates = templatesRaw as Record<string, CatalogTemplate>
  const workflows: Record<string, unknown>[] = []

  for (let i = 0; i < workflowsRaw.length; i++) {
    const entry = workflowsRaw[i]
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`marketplace catalog: workflow at index ${i} must be an object`)
    }
    const w = entry as Record<string, unknown>

    // Callback templates are filtered out by the caller; skip per-field integrity checks.
    if (w.useTemplate) {
      workflows.push(w)
      continue
    }

    const ref = w.id ?? w.workflowRef
    if (typeof ref !== 'string' || ref.length === 0) {
      throw new Error(`marketplace catalog: workflow at index ${i} is missing a string id/workflowRef`)
    }
    if (typeof w.template !== 'string' || !(w.template in templates)) {
      throw new Error(`marketplace catalog: workflow "${ref}" references unknown template "${String(w.template)}"`)
    }
    if (
      w.variables !== undefined &&
      (w.variables === null || typeof w.variables !== 'object' || Array.isArray(w.variables))
    ) {
      throw new Error(`marketplace catalog: workflow "${ref}" has a non-object \`variables\` field`)
    }
    if (w.workflowId !== undefined && w.workflowId !== null && w.workflowId !== '') {
      if (typeof w.workflowId !== 'string' || !WORKFLOW_ID_RE.test(w.workflowId)) {
        throw new Error(`marketplace catalog: workflow "${ref}" has an invalid workflowId (expected 32-byte hex)`)
      }
    }

    workflows.push(w)
  }

  return { templates, workflows }
}

/**
 * Converts a MarketplaceWorkflow (from the IPFS catalog) into a WorkflowDefinition
 * that can be passed to buildScript().
 *
 * Slot classification for each $variable:
 *   - in workflow.variables (strip $)  → literal  (resolved, pinned in bitmap)
 *   - in MAGIC_VARIABLE_KEYS           → magic    (resolved from poolContext)
 *   - appears as action.returns        → runtime  (computed by weiroll during execution)
 *   - anything else                    → runtime  (filled by user before execution)
 *
 * Bare `input: []` values are treated as runtime inputs too:
 *   - use catalog `runtimeVariables` when the mapping is unambiguous
 *   - otherwise synthesize a per-input runtime key so the FE can ask the user
 *     for the missing values explicitly
 *
 * Only the last category is included in runtimeVariables — the UI shows an
 * input field for each of those. Computed slots start as empty bytes and are written
 * by the weiroll VM when the producing action runs.
 *
 * Action outputs are set to the corresponding slot index when action.returns is
 * present, and UNUSED_SLOT otherwise.
 */
export function buildWorkflowDefinitionFromCatalog(
  workflow: MarketplaceWorkflow,
  options: BuildWorkflowDefinitionFromCatalogOptions = {}
): WorkflowDefinition {
  const templates = options.templates ?? workflow.templates ?? {}

  // Pre-scan: variables that are return values of some action are computed by
  // the weiroll VM — they must NOT appear as user-filled inputs.
  const computedVarSet = new Set<string>()
  const returnValueModes = inferReturnValueModes(workflow)
  for (const [index, action] of workflow.actions.entries()) {
    if (action.returns == null) continue
    if (!action.returns.startsWith('$')) {
      throw new Error(
        `buildWorkflowDefinitionFromCatalog: workflow "${workflow.workflowRef}" action ${index} return "${action.returns}" must start with "$"`
      )
    }
    if (computedVarSet.has(action.returns)) {
      throw new Error(
        `buildWorkflowDefinitionFromCatalog: workflow "${workflow.workflowRef}" action ${index} duplicates return "${action.returns}"`
      )
    }
    if (MAGIC_KEY_SET.has(action.returns)) {
      throw new Error(
        `buildWorkflowDefinitionFromCatalog: workflow "${workflow.workflowRef}" action ${index} return "${action.returns}" collides with a magic variable`
      )
    }
    if (workflow.variables[stripVariablePrefix(action.returns)] !== undefined) {
      throw new Error(
        `buildWorkflowDefinitionFromCatalog: workflow "${workflow.workflowRef}" action ${index} return "${action.returns}" collides with a workflow variable`
      )
    }
    computedVarSet.add(action.returns)
  }
  const computedRuntimeKeys = new Set([...computedVarSet].map(stripVariablePrefix))

  // Tagged variable kinds (explicit-input-kinds format): every $variable an input references
  // is declared with a kind. pinned values come in via workflow.variables; configurable/runtime
  // are classified from the kind here. Magic and `returns` names are implicit (not declared).
  const kindByName = new Map<string, CatalogVariable['kind']>()
  for (const v of templates[workflow.template]?.variables ?? []) kindByName.set(v.name, v.kind)

  const slotMap = new Map<string, number>()
  const stateSlots: WorkflowStateSlot[] = []

  function getOrAddSlot(canonical: string, slot: WorkflowStateSlot): number {
    const existing = slotMap.get(canonical)
    if (existing !== undefined) {
      const current = stateSlots[existing]
      if (current && 'label' in current && current.label == null && 'label' in slot && slot.label != null) {
        stateSlots[existing] = { ...current, label: slot.label } as WorkflowStateSlot
      }
      return existing
    }

    const idx = stateSlots.length
    slotMap.set(canonical, idx)
    stateSlots.push(slot)
    return idx
  }

  function getOrAddVariableSlot(
    raw: string,
    label?: string,
    parameter = '',
    metadata?: {
      actionName?: string
      actionIndex?: number
      inputIndex?: number
      anonymous?: boolean
    }
  ): number {
    let canonical: string
    let slot: WorkflowStateSlot

    if (raw.startsWith('$')) {
      const key = stripVariablePrefix(raw)
      const kind = kindByName.get(key)
      if (MAGIC_KEY_SET.has(raw)) {
        canonical = `magic:${raw}`
        slot = { type: 'magic', key: raw }
      } else if (workflow.variables[key] !== undefined) {
        // pinned: value provided per-workflow, baked in at whitelist time.
        const encoded = encodeLiteralValue(workflow.variables[key]!, parameter)
        canonical = `literal:${encoded}`
        slot = { type: 'literal', value: encoded }
      } else if (kind === 'pinned') {
        throw new Error(
          `buildWorkflowDefinitionFromCatalog: workflow "${workflow.workflowRef}" pinned variable "${key}" has no value in workflow.variables`
        )
      } else if (kind === 'configurable') {
        // hub-manager-set at policy creation; one slot per configurable variable (keyed by name).
        canonical = `configurable:${key}`
        slot = { type: 'configurable', key, label: fallbackLabel(label, key, parameter), parameter, ...metadata }
      } else {
        // kind === 'runtime' (strategist) or a computed `returns` (written by the VM). Both are
        // runtime slots; computed ones are excluded from the user-facing runtimeVariables below.
        canonical = `runtime:${key}`
        slot = {
          type: 'runtime',
          key,
          label: fallbackLabel(label, key, parameter),
          parameter,
          ...metadata,
        }
      }
    } else {
      const encoded = encodeLiteralValue(raw, parameter)
      canonical = `literal:${encoded}`
      slot = { type: 'literal', value: encoded }
    }

    return getOrAddSlot(canonical, slot)
  }

  const actions: WeirollAction[] = workflow.actions.map((action, actionIndex) => {
    if (action.optional && action.returns != null) {
      throw new Error(
        `buildWorkflowDefinitionFromCatalog: workflow "${workflow.workflowRef}" action ${actionIndex} is optional but also returns "${action.returns}"`
      )
    }

    const selector = /^0x[0-9a-fA-F]{8}$/.test(action.selector)
      ? (action.selector as HexString)
      : (toFunctionSelector(action.selector) as HexString)
    // An input needs raw calldata assembly if it is dynamic AND its value is not
    // already pinned in its own state slot at build time.  For `bytes`/`string`
    // parameters, the weiroll VM's 0x80 input-specifier handles dynamic length
    // correctly without FLAG_RAW, so we only require raw calldata when the value
    // is NOT known at build time (i.e. not a declared variable or configurable).
    const hasDynamicInput = action.inputs.some((input) => {
      if (!isDynamicAbiParameter(input.parameter)) return false
      if (input.useTemplate) return false
      // Variable-length parameters (`bytes`/`string`) are ALWAYS encoded via the weiroll VM's
      // 0x80 variable-length input specifier — for every source (literal, configurable, computed
      // return, AND runtime). That path keeps the call's 4-byte selector in the (hashed) command
      // word, so the strategist can vary only the argument value, never the function. Only
      // non-variable-length dynamic types (e.g. tuple arrays) can't be spliced per-input and need
      // FLAG_RAW assembly. Routing runtime `bytes` to FLAG_RAW (as before) handed the strategist
      // the whole calldata blob including the selector — see audit #18 / SECURITY.md §11.
      return !isVariableLengthParameter(input.parameter)
    })
    const hasComputedDynamicInput = action.inputs.some(
      (input) =>
        isDynamicAbiParameter(input.parameter) && (input.input ?? []).some((value) => computedVarSet.has(value))
    )
    const hasRawCalldataOnlyInput = action.inputs.some((input) => requiresRawCalldataParameter(input.parameter))
    const rawCalldataAction =
      action.rawMode === true || (action.returns == null && hasDynamicInput && !hasComputedDynamicInput)

    if (rawCalldataAction && action.returns != null) {
      throw new Error(
        `buildWorkflowDefinitionFromCatalog: workflow "${workflow.workflowRef}" action ${actionIndex} uses raw calldata assembly and cannot return a value`
      )
    }

    if (action.returns != null && hasRawCalldataOnlyInput) {
      throw new Error(
        `buildWorkflowDefinitionFromCatalog: workflow "${workflow.workflowRef}" action ${actionIndex} uses dynamic calldata input that cannot return a value`
      )
    }

    if (hasRawCalldataOnlyInput && hasComputedDynamicInput) {
      throw new Error(
        `buildWorkflowDefinitionFromCatalog: workflow "${workflow.workflowRef}" action ${actionIndex} uses dynamic calldata input from a computed value, which cannot be assembled off-chain`
      )
    }

    const inputSlots = action.inputs.map((inp, inputIndex) => {
      const values = inp.input ?? []
      const slotMetadata = {
        actionName: action.name ?? action.selector,
        actionIndex,
        inputIndex,
      }
      if (inp.useTemplate) {
        if (inp.parameter !== 'bytes') {
          throw new Error(
            `buildWorkflowDefinitionFromCatalog: workflow "${workflow.workflowRef}" action ${actionIndex} input ${inputIndex} uses useTemplate on non-bytes parameter "${inp.parameter}"`
          )
        }
        if (values.length !== 0) {
          throw new Error(
            `buildWorkflowDefinitionFromCatalog: workflow "${workflow.workflowRef}" action ${actionIndex} input ${inputIndex} uses useTemplate and must use an empty input array`
          )
        }

        const templateName = inp.useTemplate.template
        const template = templates[templateName]
        if (!template) {
          throw new Error(
            `buildWorkflowDefinitionFromCatalog: workflow "${workflow.workflowRef}" action ${actionIndex} input ${inputIndex} references missing template "${templateName}"`
          )
        }

        const templateWorkflow: MarketplaceWorkflow = {
          ...workflow,
          workflowRef: `${workflow.workflowRef}:${templateName}:${actionIndex}:${inputIndex}`,
          name: `${workflow.name} callback`,
          template: templateName,
          workflowId: '',
          templates,
          actions: applyUseTemplateMap(template.actions, inp.useTemplate.map ?? {}),
          runtimeVariables: (template.variables ?? []).filter((v) => v.kind === 'runtime').map((v) => v.name),
        }
        const templateDefinition = buildWorkflowDefinitionFromCatalog(templateWorkflow, { templates })
        return getOrAddSlot(`template:${actionIndex}:${inputIndex}:${templateName}`, {
          type: 'template',
          workflow: templateDefinition,
          label: fallbackLabel(inp.label, templateName, inp.parameter),
          ...slotMetadata,
        })
      }
      if (values.length === 0) {
        // No anonymous/empty slots in the tagged format — a value is a $variable or a literal,
        // and a strategist value is a declared `runtime` variable. Empty is only for useTemplate.
        throw new Error(
          `buildWorkflowDefinitionFromCatalog: workflow "${workflow.workflowRef}" action ${actionIndex} input ${inputIndex} has an empty input — reference a $variable or literal (useTemplate is the only empty case)`
        )
      }

      if (values.length > 1) {
        throw new Error(
          `buildWorkflowDefinitionFromCatalog: workflow "${workflow.workflowRef}" action ${actionIndex} input ${inputIndex} uses ${values.length} values — multi-value inputs are not supported`
        )
      }

      return getOrAddVariableSlot(values[0]!, inp.label, inp.parameter, slotMetadata)
    })

    // Claim the output slot now so downstream actions referencing action.returns
    // find the same slot index when they call getOrAddSlot.
    const output =
      action.returns != null
        ? (() => {
            const outputSlot = getOrAddVariableSlot(action.returns)
            return encodeOutputSpecifier(outputSlot, returnValueModes.get(action.returns) === 'dynamic')
          })()
        : UNUSED_SLOT

    const rawTarget = action.target
    const target = rawTarget.startsWith('$')
      ? MAGIC_KEY_SET.has(rawTarget)
        ? { type: 'magic' as const, key: rawTarget }
        : (() => {
            const resolved = workflow.variables[rawTarget.slice(1)]
            if (resolved === undefined) {
              throw new Error(
                `buildWorkflowDefinitionFromCatalog: workflow "${workflow.workflowRef}" action ${actionIndex} target "${rawTarget}" is not a workflow variable or magic variable`
              )
            }
            return resolved as HexString
          })()
      : (rawTarget as HexString)

    const payableValueSlot =
      action.valueNonZero === true
        ? getOrAddSlot(`runtime:${buildPayableValueRuntimeKey(actionIndex)}`, {
            type: 'runtime',
            key: buildPayableValueRuntimeKey(actionIndex),
            parameter: 'uint256',
            actionName: action.name ?? action.selector,
            actionIndex,
            inputIndex: -1,
            system: 'payableValue',
          })
        : null

    const inputs = rawCalldataAction
      ? [
          ...(payableValueSlot != null ? [payableValueSlot] : []),
          getOrAddSlot(`rawcalldata:${actionIndex}`, {
            type: 'rawcalldata',
            selector,
            parameterTypes: action.inputs.map((input) => input.parameter),
            sourceSlots: inputSlots,
            actionName: action.name ?? action.selector,
            actionIndex,
          }),
        ]
      : [
          ...(payableValueSlot != null ? [payableValueSlot] : []),
          ...action.inputs.map((input, index) => encodeInputSpecifier(input.parameter, inputSlots[index]!)),
        ]

    return {
      target,
      selector,
      callType: action.valueNonZero ? VALUECALL : CALL,
      inputs,
      output: rawCalldataAction ? UNUSED_SLOT : output,
      rawMode: rawCalldataAction || action.rawMode,
    }
  })

  // Only variables that are NOT computed by a previous action belong in runtimeVariables.
  // Those are the ones the user must supply before calling execute().
  const runtimeVariables = stateSlots
    .filter(
      (s): s is Extract<WorkflowStateSlot, { type: 'runtime' }> =>
        s.type === 'runtime' && !computedRuntimeKeys.has(s.key) && s.system !== 'payableValue'
    )
    .map((s) => s.key)

  // Defense-in-depth: weiroll slot indices must fit in 7 bits and the stateBitmap is a
  // uint128, so a definition can hold at most MAX_STATE_SLOTS slots. buildScript() enforces
  // the same bound, but assert it here too so a catalog that over-allocates fails at
  // build-from-catalog time with a catalog-specific message rather than later.
  if (stateSlots.length > MAX_STATE_SLOTS) {
    throw new Error(
      `buildWorkflowDefinitionFromCatalog: workflow "${workflow.workflowRef}" has ${stateSlots.length} state slots — maximum is ${MAX_STATE_SLOTS}`
    )
  }

  return {
    workflowRef: workflow.workflowRef,
    actions,
    state: stateSlots,
    runtimeVariables,
  }
}
