import { toFunctionSelector } from 'viem'
import type { HexString } from '../types/index.js'
import type { MarketplaceWorkflow } from '../types/workflow.js'
import { MAGIC_VARIABLE_KEYS } from './variables.js'
import { CALL, UNUSED_SLOT, VALUECALL } from './weiroll.js'
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
    if (/^0x(?:[0-9a-fA-F]{2})*$/.test(raw)) return raw as HexString
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

function configurableKey(actionIndex: number, inputIndex: number): string {
  return `configurable:${actionIndex}:${inputIndex}`
}

function anonymousRuntimeKey(actionIndex: number, inputIndex: number): string {
  return `runtime:${actionIndex}:${inputIndex}`
}

const RAW_CALLDATA_PARAMETER_SET = new Set<string>(['(address,uint256)[]', '(address,address)[]'])
const VARIABLE_LENGTH_PARAMETER_SET = new Set<string>(['bytes'])
const PAYABLE_VALUE_RUNTIME_KEY_PREFIX = '__sdk_payable_value:'

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

function encodeInputSpecifier(parameter: string, slotIndex: number): number {
  if (slotIndex < 0 || slotIndex > 0x7f) {
    throw new Error(`buildWorkflowDefinitionFromCatalog: slot index ${slotIndex} exceeds weiroll limit 127`)
  }

  return isVariableLengthParameter(parameter) ? 0x80 | slotIndex : slotIndex
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
export function buildWorkflowDefinitionFromCatalog(workflow: MarketplaceWorkflow): WorkflowDefinition {
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

  const declaredRuntimeKeys = (workflow.runtimeVariables ?? []).map(stripVariablePrefix)
  const bareRuntimeInputs = workflow.actions.flatMap((action, actionIndex) =>
    action.inputs.flatMap((inp, inputIndex) =>
      !inp.configurable && (inp.input ?? []).length === 0 ? [{ actionIndex, inputIndex }] : []
    )
  )
  const bareRuntimeKeyByInput = new Map<string, string>()

  if (bareRuntimeInputs.length > 0) {
    if (declaredRuntimeKeys.length > 0 && declaredRuntimeKeys.length !== bareRuntimeInputs.length) {
      throw new Error(
        `buildWorkflowDefinitionFromCatalog: workflow "${workflow.workflowRef}" declares ${declaredRuntimeKeys.length} runtimeVariables for ${bareRuntimeInputs.length} empty non-configurable inputs`
      )
    }

    bareRuntimeInputs.forEach(({ actionIndex, inputIndex }, idx) => {
      const key = declaredRuntimeKeys[idx] ?? anonymousRuntimeKey(actionIndex, inputIndex)
      if (MAGIC_KEY_SET.has(`$${key}`)) {
        throw new Error(
          `buildWorkflowDefinitionFromCatalog: workflow "${workflow.workflowRef}" runtime variable "${key}" collides with a magic variable`
        )
      }
      if (workflow.variables[key] !== undefined) {
        throw new Error(
          `buildWorkflowDefinitionFromCatalog: workflow "${workflow.workflowRef}" runtime variable "${key}" collides with a workflow variable`
        )
      }
      if (computedRuntimeKeys.has(key)) {
        throw new Error(
          `buildWorkflowDefinitionFromCatalog: workflow "${workflow.workflowRef}" runtime variable "${key}" collides with an action return`
        )
      }
      bareRuntimeKeyByInput.set(`${actionIndex}:${inputIndex}`, key)
    })
  }

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
      if (MAGIC_KEY_SET.has(raw)) {
        canonical = `magic:${raw}`
        slot = { type: 'magic', key: raw }
      } else {
        const resolved = workflow.variables[raw.slice(1)]
        if (resolved !== undefined) {
          const encoded = encodeLiteralValue(resolved, parameter)
          canonical = `literal:${encoded}`
          slot = { type: 'literal', value: encoded }
        } else {
          // computed (weiroll writes it) or user-supplied — both are runtime slots;
          // the distinction lives in runtimeVariables, not in the slot type
          const key = stripVariablePrefix(raw)
          canonical = `runtime:${key}`
          slot = {
            type: 'runtime',
            key,
            label: fallbackLabel(label, key, parameter),
            parameter,
            ...metadata,
          }
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
    const hasDynamicInput = action.inputs.some((input) => isDynamicAbiParameter(input.parameter))
    const hasComputedDynamicInput = action.inputs.some(
      (input) =>
        isDynamicAbiParameter(input.parameter) &&
        (input.input ?? []).some((value) => computedVarSet.has(value))
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
      if (inp.configurable) {
        if (values.length !== 0) {
          throw new Error(
            `buildWorkflowDefinitionFromCatalog: workflow "${workflow.workflowRef}" action ${actionIndex} input ${inputIndex} is configurable and must use an empty input array`
          )
        }

        const key = configurableKey(actionIndex, inputIndex)
        return getOrAddSlot(`configurable:${key}`, {
          type: 'configurable',
          key,
          label: fallbackLabel(inp.label, key, inp.parameter),
          parameter: inp.parameter,
          ...slotMetadata,
        })
      }

      if (values.length === 0) {
        const runtimeKey = bareRuntimeKeyByInput.get(`${actionIndex}:${inputIndex}`)
        if (!runtimeKey) {
          throw new Error(
            `buildWorkflowDefinitionFromCatalog: workflow "${workflow.workflowRef}" action ${actionIndex} input ${inputIndex} has no value and is not configurable`
          )
        }
        return getOrAddSlot(`runtime:${runtimeKey}`, {
          type: 'runtime',
          key: runtimeKey,
          label: fallbackLabel(inp.label, runtimeKey, inp.parameter),
          parameter: inp.parameter,
          ...slotMetadata,
          ...(declaredRuntimeKeys.length === 0 ? { anonymous: true } : {}),
        })
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
            return returnValueModes.get(action.returns) === 'dynamic' ? 0x80 | outputSlot : outputSlot
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

  return {
    workflowRef: workflow.workflowRef,
    actions,
    state: stateSlots,
    runtimeVariables,
  }
}
