import { toFunctionSelector } from 'viem'
import type { AbiParameter } from 'viem'
import type { HexString } from '../types/index.js'
import type {
  CatalogAction,
  CatalogActionInput,
  CatalogTemplate,
  CatalogVariable,
  MarketplaceWorkflow,
} from '../types/workflow.js'
import { MAGIC_VARIABLE_KEYS } from './variables.js'
import { checkDuplicateWorkflowIds, validateCatalogWorkflow } from './workflowRules.js'
import type { CatalogWorkflowEntry, RuleViolation } from './workflowRules.js'
import {
  CALL,
  MAX_STATE_SLOTS,
  UNUSED_SLOT,
  VALUECALL,
  encodeVariableLengthValue,
  getWorkflowAbiParameter,
} from './weiroll.js'
import type { WeirollAction, WorkflowDefinition, WorkflowStateSlot } from './weiroll.js'

const MAGIC_KEY_SET = new Set<string>(MAGIC_VARIABLE_KEYS)

/**
 * Walks a JSON-parsed catalog literal against its ABI parameter, converting to what
 * viem's encoder expects.
 *
 * JSON has no integer type wide enough for `uint256` and no tuple type at all, so the
 * catalog writes numbers as decimal strings and structs as positional arrays. This maps
 * both onto viem's shape (bigint, and an array per tuple) and leaves addresses, bools and
 * hex strings alone. Anything the ABI type doesn't admit falls through to viem, which
 * gives a better error than a guess here would.
 */
function coerceAbiValue(parameter: AbiParameter, value: unknown): unknown {
  const { type } = parameter

  if (type.endsWith('[]')) {
    if (!Array.isArray(value)) {
      throw new Error(`coerceAbiValue: expected an array for "${type}", got ${typeof value}`)
    }
    const element = { ...parameter, type: type.slice(0, -2) } as AbiParameter
    return value.map((entry) => coerceAbiValue(element, entry))
  }

  if (type === 'tuple') {
    const components = (parameter as { components?: readonly AbiParameter[] }).components ?? []
    if (!Array.isArray(value)) {
      throw new Error(`coerceAbiValue: expected an array of ${components.length} components for a tuple`)
    }
    if (value.length !== components.length) {
      throw new Error(`coerceAbiValue: tuple expects ${components.length} components, got ${value.length}`)
    }
    return components.map((component, i) => coerceAbiValue(component, value[i]))
  }

  if (/^u?int(\d+)?$/.test(type)) {
    if (typeof value === 'bigint') return value
    if (typeof value === 'number' || typeof value === 'string') return BigInt(value)
    throw new Error(`coerceAbiValue: cannot read "${String(value)}" as ${type}`)
  }

  if (type === 'bool') {
    if (typeof value === 'boolean') return value
    if (value === 'true') return true
    if (value === 'false') return false
    throw new Error(`coerceAbiValue: cannot read "${String(value)}" as bool`)
  }

  return value
}

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

  // Any other dynamic parameter — `string`, `uint256[]`, a tuple array — is stored in the
  // same inner ABI form as `bytes` above and consumed through the same 0x80 specifier. The
  // catalog spells the value as JSON, which is the only readable way to write a list of
  // structs; integers arrive as decimal strings so a value past 2^53 survives the round trip.
  if (parameter !== '' && isVariableLengthParameter(parameter)) {
    const abiParameter = getWorkflowAbiParameter(parameter)
    let parsed: unknown
    if (parameter === 'string') {
      // A bare string is the natural spelling and is not valid JSON; accept both so a
      // catalog can quote it or not.
      parsed = raw.startsWith('"') ? (JSON.parse(raw) as unknown) : raw
    } else {
      try {
        parsed = JSON.parse(raw) as unknown
      } catch {
        throw new Error(`buildWorkflowDefinitionFromCatalog: literal for "${parameter}" is not valid JSON: "${raw}"`)
      }
    }
    try {
      return encodeVariableLengthValue(parameter, coerceAbiValue(abiParameter, parsed))
    } catch (cause) {
      throw new Error(`buildWorkflowDefinitionFromCatalog: cannot encode literal "${raw}" as "${parameter}"`, { cause })
    }
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

/**
 * Tuple-array parameters that still compile to FLAG_RAW, for hash stability only.
 *
 * Every dynamic ABI type can go through the VM's 0x80 variable-length specifier — see
 * `isVariableLengthParameter`. These two got a FLAG_RAW encoding before that was
 * understood, and they appear in the published catalog (the guard actions'
 * `allowancePairs` and `slippageAssets`). Re-encoding them would change their script
 * hashes, hence the Merkle root, hence a policy re-set by every hub manager — for no
 * behavioural gain, since both are pinned or configurable in every workflow that uses
 * them and neither needs a runtime source.
 *
 * So they are grandfathered, not endorsed. Nothing should be added here; a new dynamic
 * parameter gets the 0x80 path. The set is removable in a major, at the cost of that
 * one re-set.
 *
 * @deprecated Grandfathered for script-hash stability. Do not extend.
 */
const LEGACY_RAW_CALLDATA_PARAMETER_SET = new Set<string>(['(address,uint256)[]', '(address,address)[]'])
const PAYABLE_VALUE_RUNTIME_KEY_PREFIX = '__sdk_payable_value:'

export interface BuildWorkflowDefinitionFromCatalogOptions {
  templates?: Record<string, CatalogTemplate>
}

function buildPayableValueRuntimeKey(actionIndex: number): string {
  return `${PAYABLE_VALUE_RUNTIME_KEY_PREFIX}${actionIndex}`
}

/**
 * Rejects catalog-supplied names in the SDK's own reserved namespace.
 *
 * `__sdk_payable_value:<i>` keys back the implicit `msg.value` slot of a `valueNonZero`
 * action and are filled from a fee quote rather than by the user. A catalog variable with
 * the same name would canonicalize onto that slot, so a quote would silently land in an
 * ordinary argument — on a path whose proof still validates.
 */
function assertNotReservedVariableName(workflowRef: string, name: string, description: string): void {
  if (name.startsWith(PAYABLE_VALUE_RUNTIME_KEY_PREFIX)) {
    throw new Error(
      `buildWorkflowDefinitionFromCatalog: workflow "${workflowRef}" ${description} "${name}" uses the reserved "${PAYABLE_VALUE_RUNTIME_KEY_PREFIX}" prefix`
    )
  }
}

/**
 * Whether a parameter can be passed through the VM's 0x80 variable-length input specifier.
 *
 * True for every dynamic ABI type, which is the point: the VM copies the state slot
 * verbatim into the calldata tail and writes a head offset pointing at it, and it does
 * that without knowing the type. ABI tail encodings are position-independent — every
 * offset inside one is relative to a point inside the blob — so a slot holding the INNER
 * encoding of any dynamic value relocates correctly. `bytes` was never special here; it
 * was just the only type the encoder had been taught.
 *
 * That matters beyond tidiness. The alternative path, FLAG_RAW, packs the whole call
 * including its 4-byte selector into one state slot, which is why a runtime source is
 * refused there: an unpinned FLAG_RAW slot hands the strategist an arbitrary selector
 * against a pinned target while the Merkle proof still verifies (audit #18). The 0x80
 * path keeps the selector in the hashed command word, so the strategist varies one
 * argument's bytes and never the function — which makes runtime tuple arrays expressible
 * and safe, where before they were simply rejected.
 *
 * The legacy set is excluded only to keep published script hashes stable.
 */
function isVariableLengthParameter(parameter: string): boolean {
  return isDynamicAbiParameter(parameter) && !LEGACY_RAW_CALLDATA_PARAMETER_SET.has(parameter)
}

function isDynamicArrayParameter(parameter: string): boolean {
  return /\[\]/.test(parameter)
}

function isDynamicAbiParameter(parameter: string): boolean {
  return (
    parameter === 'bytes' ||
    parameter === 'string' ||
    isDynamicArrayParameter(parameter) ||
    LEGACY_RAW_CALLDATA_PARAMETER_SET.has(parameter)
  )
}

/**
 * Groups ABI types that may share one weiroll state slot.
 *
 * A slot is a single left-padded 32-byte word, so differing widths within one family read
 * back consistently — `$amount` declared `uint128` at one call site and `uint256` at another
 * is the same number, and a `bytes16` share-class id read as `bytes32` is the same
 * high-order bytes. Crossing families is not: an `address` reinterpreted as a `uint256`, or a
 * `bytes32` as an `address`, is one strategist-controlled word driving two unrelated
 * meanings, which is what makes the reviewed type a poor guide to the executed one.
 *
 * `null` means the type must match exactly (bool, string, bytes, arrays, tuples). The
 * `[1-9]\d*` width forms reject non-canonical spellings such as `uint08`.
 */
function parameterFamily(parameter: string): string | null {
  const numeric = /^(u?int)([1-9]\d*)?$/.exec(parameter)
  if (numeric) {
    const bits = numeric[2] ? Number(numeric[2]) : 256
    return bits % 8 === 0 && bits <= 256 ? numeric[1]! : null
  }

  const fixedBytes = /^bytes([1-9]\d*)$/.exec(parameter)
  return fixedBytes && Number(fixedBytes[1]) <= 32 ? 'bytesN' : null
}

function isCompatibleParameterReuse(a: string, b: string): boolean {
  if (a === b) return true
  const familyA = parameterFamily(a)
  return familyA !== null && familyA === parameterFamily(b)
}

function requiresRawCalldataParameter(parameter: string): boolean {
  return LEGACY_RAW_CALLDATA_PARAMETER_SET.has(parameter)
}

function mapTemplateReference(value: string, variableMap: Record<string, string>): string {
  if (!value.startsWith('$')) return value
  return variableMap[value.slice(1)] ?? value
}

/**
 * The variables a nested callback may resolve from.
 *
 * A value reaches a child only through the parent's `useTemplate.map`, and only for names the child
 * declares as `param` (bound by its caller) or `pinned`. A child's `configurable` and `runtime`
 * names are never filled from the enclosing scope: those belong to the hub manager and the
 * strategist respectively, and inheriting a parent value for them is exactly how a colliding outer
 * key used to pin a catalog-chosen literal into callback bytes that the review surface does not
 * expand. A map entry targeting one is rejected rather than ignored — no published catalog binds
 * one, and a binding that silently does nothing is worse than a rejected catalog.
 *
 * Keyed by the *parent-side* name, because `applyUseTemplateMap` rewrites the child's `$childName`
 * references to whatever the map points at. A mapped inline literal needs no entry at all (the
 * rewrite substitutes it directly); a mapped `$reference` needs the parent's value for that name,
 * and gets one only if the parent pinned it. When the parent didn't — the name is itself `runtime`
 * or `configurable` up there — nothing is inherited and the child compiles its own slot under that
 * key, which then receives the same value, by key, at fill time. Keying this way also composes: a
 * callback-of-callback resolves through each layer's map in turn.
 */
function childScopeVariables(
  parentVariables: Record<string, string>,
  template: CatalogTemplate,
  useTemplateMap: Record<string, string>,
  describe: string
): Record<string, string> {
  const childKinds = new Map((template.variables ?? []).map((variable) => [variable.name, variable.kind]))
  const scope: Record<string, string> = {}

  for (const [childName, boundValue] of Object.entries(useTemplateMap)) {
    const kind = childKinds.get(childName)
    if (kind === 'configurable' || kind === 'runtime') {
      throw new Error(
        `buildWorkflowDefinitionFromCatalog: ${describe} binds "${childName}" through useTemplate.map, ` +
          `but the callback template declares it ${kind} — that value is set by ` +
          `${kind === 'configurable' ? 'the hub manager at policy creation' : 'the strategist at execution'}, ` +
          `not by the enclosing workflow`
      )
    }
    if (kind !== 'param' && kind !== 'pinned') continue
    if (!boundValue.startsWith('$')) continue

    const parentName = boundValue.slice(1)
    const parentValue = parentVariables[parentName]
    if (parentValue !== undefined) scope[parentName] = parentValue
  }

  return scope
}

function applyUseTemplateMap(actions: CatalogAction[], variableMap: Record<string, string>): CatalogAction[] {
  return actions.map((action) => ({
    ...action,
    target: mapTemplateReference(action.target, variableMap),
    inputs: action.inputs.map((input) => ({
      ...input,
      input: (input.input ?? []).map((value) => mapTemplateReference(value, variableMap)),
      // A nested callback's own bindings are references in this scope too. Rebinding only `input`
      // and `target` stopped at the first `useTemplate` layer, so a callback-of-callback resolved
      // its map against the wrong scope and bound different values than the layer above intended.
      ...(input.useTemplate
        ? {
            useTemplate: {
              ...input.useTemplate,
              map: Object.fromEntries(
                Object.entries(input.useTemplate.map ?? {}).map(([key, value]) => [
                  key,
                  mapTemplateReference(value, variableMap),
                ])
              ),
            },
          }
        : {}),
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
  const ruleCache = new Map<string, RuleViolation[]>()

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

    // The authoring rules from centrifuge/workflows' validate.ts. That validator only ever
    // sees catalogs the repo built; this catalog arrived over the network, so re-check the
    // rules whose violation would let a manager approve a workflow that does not describe
    // what executes. `ruleCache` keeps the template half to one run per template — the
    // mainnet catalog is 1336 workflows over 18 templates — which is what keeps this under a
    // millisecond for the whole catalog.
    const violations = validateCatalogWorkflow(w as CatalogWorkflowEntry, templates, ruleCache)
    if (violations[0]) {
      throw new Error(`marketplace catalog: ${violations[0].message}`)
    }

    workflows.push(w)
  }

  const duplicates = checkDuplicateWorkflowIds(workflows as CatalogWorkflowEntry[])
  if (duplicates[0]) {
    throw new Error(`marketplace catalog: ${duplicates[0].message}`)
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

  // Tagged variable kinds (explicit-input-kinds format): every $variable an input references
  // is declared with a kind. pinned values come in via workflow.variables; configurable/runtime
  // are classified from the kind here. Magic and `returns` names are implicit (not declared).
  const kindByName = new Map<string, CatalogVariable['kind']>()
  for (const v of templates[workflow.template]?.variables ?? []) {
    assertNotReservedVariableName(workflow.workflowRef, v.name, `template "${workflow.template}" variable`)
    kindByName.set(v.name, v.kind)
  }
  for (const key of Object.keys(workflow.variables)) {
    assertNotReservedVariableName(workflow.workflowRef, key, 'workflow variable')
  }

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
    assertNotReservedVariableName(workflow.workflowRef, stripVariablePrefix(action.returns), `action ${index} return`)
    computedVarSet.add(action.returns)
  }
  const computedRuntimeKeys = new Set([...computedVarSet].map(stripVariablePrefix))

  const slotMap = new Map<string, number>()
  const stateSlots: WorkflowStateSlot[] = []

  function getOrAddSlot(canonical: string, slot: WorkflowStateSlot): number {
    const existing = slotMap.get(canonical)
    if (existing !== undefined) {
      const current = stateSlots[existing]!
      // A weiroll state slot is one untyped 32-byte word, so reuse is only safe when every use
      // agrees on what that word means: one strategist-controlled value must not be reviewed
      // and rendered as a uint256 and then consumed downstream as an address. Slot type and
      // `system` need no check here — every canonical key is namespaced by its slot type, and
      // the only system slots are keyed `runtime:__sdk_payable_value:<action>`, which is unique
      // per action and which assertNotReservedVariableName keeps catalog data out of.
      const currentParameter = 'parameter' in current ? current.parameter : undefined
      const slotParameter = 'parameter' in slot ? slot.parameter : undefined
      if (currentParameter && slotParameter && !isCompatibleParameterReuse(currentParameter, slotParameter)) {
        throw new Error(
          `buildWorkflowDefinitionFromCatalog: workflow "${workflow.workflowRef}" slot "${canonical}" is reused with incompatible parameter types "${currentParameter}" and "${slotParameter}"`
        )
      }
      if ('label' in current && current.label == null && 'label' in slot && slot.label != null) {
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

  /**
   * Allocates the single `rawcalldata` state slot a FLAG_RAW action reads its calldata from.
   *
   * The slot holds the whole call — 4-byte selector included — so it is only safe when every
   * source is known at whitelist time and the assembled blob is therefore pinned in the state
   * bitmap. A `runtime` source leaves the slot unpinned and empty at build time (see
   * `buildScript`), which hands whoever assembles the execute calldata an arbitrary selector
   * against the pinned target while the Merkle proof still verifies. `bytes`/`string` inputs
   * avoid this entirely by going through the VM's 0x80 variable-length specifier, which keeps
   * the selector in the hashed command word; only non-variable-length dynamic types (tuple
   * arrays) reach FLAG_RAW, and those must be pinned or configurable.
   */
  function buildRawCalldataSlot(
    actionIndex: number,
    action: CatalogAction,
    selector: HexString,
    inputSlots: number[]
  ): number {
    for (const [index, sourceIndex] of inputSlots.entries()) {
      const sourceType = stateSlots[sourceIndex]?.type
      if (sourceType === 'runtime' || sourceType === 'rawcalldata') {
        throw new Error(
          `buildWorkflowDefinitionFromCatalog: workflow "${workflow.workflowRef}" action ${actionIndex} input ${index} ("${action.inputs[index]?.parameter}") is a ${sourceType} source for raw calldata assembly — the assembled slot would carry an unhashed selector; make it pinned or configurable`
        )
      }
    }

    return getOrAddSlot(`rawcalldata:${actionIndex}`, {
      type: 'rawcalldata',
      selector,
      parameterTypes: action.inputs.map((input) => input.parameter),
      sourceSlots: inputSlots,
      actionName: action.name ?? action.selector,
      actionIndex,
    })
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
    const rawCalldataAction = action.returns == null && hasDynamicInput && !hasComputedDynamicInput

    // A FLAG_RAW action passes one pre-assembled calldata blob, so its 4-byte selector lives in
    // the state slot rather than in the (hashed) command word. Pairing that with `valueNonZero`
    // puts the forwarded ETH in a second unpinned slot: one proof would then authorize both an
    // arbitrary selector and an arbitrary value against the pinned target.
    if (rawCalldataAction && action.valueNonZero === true) {
      throw new Error(
        `buildWorkflowDefinitionFromCatalog: workflow "${workflow.workflowRef}" action ${actionIndex} combines raw calldata assembly with valueNonZero`
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

        // The child's scope is its own: only the values the parent passes through
        // `useTemplate.map`, and only for names the child declares as `pinned`. Spreading the
        // parent workflow (and with it `workflow.variables`) let a colliding outer key resolve a
        // child slot to a pinned literal ahead of the kind the child declared — so a
        // `configurable` value the hub manager believes they are setting, or a `runtime` value the
        // strategist supplies, was silently replaced by whatever the catalog author wrote, inside
        // callback bytes that the review surface does not expand.
        const childVariables = childScopeVariables(
          workflow.variables ?? {},
          template,
          inp.useTemplate.map ?? {},
          `workflow "${workflow.workflowRef}" action ${actionIndex} input ${inputIndex}`
        )

        const templateWorkflow: MarketplaceWorkflow = {
          workflowRef: `${workflow.workflowRef}:${templateName}:${actionIndex}:${inputIndex}`,
          name: `${workflow.name} callback`,
          template: templateName,
          category: workflow.category,
          group: workflow.group,
          chainId: workflow.chainId,
          workspace: workflow.workspace,
          version: workflow.version,
          workflowId: '',
          templates,
          variables: childVariables,
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

    const inputs = [
      ...(payableValueSlot != null ? [payableValueSlot] : []),
      ...(rawCalldataAction
        ? [buildRawCalldataSlot(actionIndex, action, selector, inputSlots)]
        : action.inputs.map((input, index) => encodeInputSpecifier(input.parameter, inputSlots[index]!))),
    ]

    return {
      target,
      selector,
      callType: action.valueNonZero ? VALUECALL : CALL,
      inputs,
      output,
      rawMode: rawCalldataAction || undefined,
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
