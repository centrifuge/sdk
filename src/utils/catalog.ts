import { toFunctionSelector } from 'viem'
import type { HexString } from '../types/index.js'
import type { MarketplaceWorkflow } from '../types/workflow.js'
import { MAGIC_VARIABLE_KEYS } from './variables.js'
import { CALL, UNUSED_SLOT, VALUECALL } from './weiroll.js'
import type { WeirollAction, WorkflowDefinition, WorkflowStateSlot } from './weiroll.js'

const MAGIC_KEY_SET = new Set<string>(MAGIC_VARIABLE_KEYS)

/**
 * Encodes a catalog literal value as a 32-byte ABI-encoded hex string.
 *
 * The catalog stores values in human-readable form:
 * - Decimal integers: "0", "100", "5192296858534827628530496329220097"
 * - Booleans: "true", "false"
 * - Hex addresses (20 bytes): "0x5ba3f068..."
 * - Hex values (any length ≤ 32 bytes): "0x00010000..."
 *
 * All are normalised to 0x-prefixed 32-byte (64 hex char) values by left-padding with zeros,
 * matching Solidity ABI encoding for uint and address types.
 */
function encodeLiteralValue(raw: string): HexString {
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
 * Bare `input: []` values are also treated as runtime inputs when the catalog
 * declares an unambiguous `runtimeVariables` mapping for them.
 *
 * Only the last category is included in runtimeVariables — the UI shows an
 * input field for each of those. Computed slots start as '0x' and are written
 * by the weiroll VM when the producing action runs.
 *
 * Action outputs are set to the corresponding slot index when action.returns is
 * present, and UNUSED_SLOT otherwise.
 */
export function buildWorkflowDefinitionFromCatalog(workflow: MarketplaceWorkflow): WorkflowDefinition {
  // Pre-scan: variables that are return values of some action are computed by
  // the weiroll VM — they must NOT appear as user-filled inputs.
  const computedVarSet = new Set<string>()
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
    if (declaredRuntimeKeys.length === 0) {
      throw new Error(
        `buildWorkflowDefinitionFromCatalog: workflow "${workflow.workflowRef}" has ${bareRuntimeInputs.length} empty non-configurable inputs but declares no runtimeVariables`
      )
    }
    if (declaredRuntimeKeys.length !== bareRuntimeInputs.length) {
      throw new Error(
        `buildWorkflowDefinitionFromCatalog: workflow "${workflow.workflowRef}" declares ${declaredRuntimeKeys.length} runtimeVariables for ${bareRuntimeInputs.length} empty non-configurable inputs`
      )
    }

    bareRuntimeInputs.forEach(({ actionIndex, inputIndex }, idx) => {
      const key = declaredRuntimeKeys[idx]
      if (!key) {
        throw new Error(
          `buildWorkflowDefinitionFromCatalog: workflow "${workflow.workflowRef}" is missing a runtime variable mapping for action ${actionIndex} input ${inputIndex}`
        )
      }
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
      if (
        current &&
        'label' in current &&
        current.label == null &&
        'label' in slot &&
        slot.label != null
      ) {
        stateSlots[existing] = { ...current, label: slot.label } as WorkflowStateSlot
      }
      return existing
    }

    const idx = stateSlots.length
    slotMap.set(canonical, idx)
    stateSlots.push(slot)
    return idx
  }

  function getOrAddVariableSlot(raw: string, label?: string, parameter = ''): number {
    let canonical: string
    let slot: WorkflowStateSlot

    if (raw.startsWith('$')) {
      if (MAGIC_KEY_SET.has(raw)) {
        canonical = `magic:${raw}`
        slot = { type: 'magic', key: raw }
      } else {
        const resolved = workflow.variables[raw.slice(1)]
        if (resolved !== undefined) {
          const encoded = encodeLiteralValue(resolved)
          canonical = `literal:${encoded}`
          slot = { type: 'literal', value: encoded }
        } else {
          // computed (weiroll writes it) or user-supplied — both are runtime slots;
          // the distinction lives in runtimeVariables, not in the slot type
          const key = stripVariablePrefix(raw)
          canonical = `runtime:${key}`
          slot = { type: 'runtime', key, label: fallbackLabel(label, key, parameter), parameter }
        }
      }
    } else {
      const encoded = encodeLiteralValue(raw)
      canonical = `literal:${encoded}`
      slot = { type: 'literal', value: encoded }
    }

    return getOrAddSlot(canonical, slot)
  }

  const actions: WeirollAction[] = workflow.actions.map((action, actionIndex) => {
    if ((action.inputs?.length ?? 0) > 6) {
      throw new Error(
        `buildWorkflowDefinitionFromCatalog: workflow "${workflow.workflowRef}" action ${actionIndex} has ${action.inputs.length} inputs — maximum is 6`
      )
    }
    if (action.optional && action.returns != null) {
      throw new Error(
        `buildWorkflowDefinitionFromCatalog: workflow "${workflow.workflowRef}" action ${actionIndex} is optional but also returns "${action.returns}"`
      )
    }

    const inputs = action.inputs.map((inp, inputIndex) => {
      const values = inp.input ?? []
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
        })
      }

      if (values.length > 1) {
        throw new Error(
          `buildWorkflowDefinitionFromCatalog: workflow "${workflow.workflowRef}" action ${actionIndex} input ${inputIndex} uses ${values.length} values — multi-value inputs are not supported`
        )
      }

      return getOrAddVariableSlot(values[0]!, inp.label, inp.parameter)
    })

    // Claim the output slot now so downstream actions referencing action.returns
    // find the same slot index when they call getOrAddSlot.
    const output = action.returns != null ? getOrAddVariableSlot(action.returns) : UNUSED_SLOT

    const selector = /^0x[0-9a-fA-F]{8}$/.test(action.selector)
      ? (action.selector as HexString)
      : (toFunctionSelector(action.selector) as HexString)

    const rawTarget = action.target
    const target = rawTarget.startsWith('$')
      ? MAGIC_KEY_SET.has(rawTarget)
        ? { type: 'magic' as const, key: rawTarget }
        : ((() => {
            const resolved = workflow.variables[rawTarget.slice(1)]
            if (resolved === undefined) {
              throw new Error(
                `buildWorkflowDefinitionFromCatalog: workflow "${workflow.workflowRef}" action ${actionIndex} target "${rawTarget}" is not a workflow variable or magic variable`
              )
            }
            return resolved as HexString
          })())
      : (rawTarget as HexString)

    return {
      target,
      selector,
      callType: action.valueNonZero ? VALUECALL : CALL,
      inputs,
      output,
      rawMode: action.rawMode,
    }
  })

  // Only variables that are NOT computed by a previous action belong in runtimeVariables.
  // Those are the ones the user must supply before calling execute().
  const runtimeVariables = stateSlots
    .filter(
      (s): s is Extract<WorkflowStateSlot, { type: 'runtime' }> =>
        s.type === 'runtime' && !computedRuntimeKeys.has(s.key)
    )
    .map((s) => s.key)

  return {
    workflowRef: workflow.workflowRef,
    actions,
    state: stateSlots,
    runtimeVariables,
  }
}
