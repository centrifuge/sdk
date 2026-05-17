import type { HexString } from '../types/index.js'
import type { MarketplaceWorkflow } from '../types/workflow.js'
import { MAGIC_VARIABLE_KEYS } from './variables.js'
import { CALL, UNUSED_SLOT, VALUECALL } from './weiroll.js'
import type { WeirollAction, WorkflowDefinition, WorkflowStateSlot } from './weiroll.js'

const MAGIC_KEY_SET = new Set<string>(MAGIC_VARIABLE_KEYS)

/**
 * Converts a MarketplaceWorkflow (from the IPFS catalog) into a WorkflowDefinition
 * that can be passed to buildScript().
 *
 * Variable references in action inputs (e.g. `$shareToken`) are resolved from
 * workflow.variables. Magic variable keys (e.g. `$executor`, `$poolId`) become
 * magic-type slots and are resolved from poolContext by buildScript().
 *
 * State slots are assigned in first-use order across all action inputs.
 * All action outputs are set to UNUSED_SLOT — return values are not tracked.
 */
export function buildWorkflowDefinitionFromCatalog(workflow: MarketplaceWorkflow): WorkflowDefinition {
  const slotMap = new Map<string, number>()
  const stateSlots: WorkflowStateSlot[] = []

  function getOrAddSlot(raw: string): number {
    let canonical: string
    let slot: WorkflowStateSlot

    if (raw.startsWith('$')) {
      if (MAGIC_KEY_SET.has(raw)) {
        canonical = raw
        slot = { type: 'magic', key: raw }
      } else {
        const resolved = (workflow.variables[raw] ?? raw) as HexString
        canonical = resolved
        slot = { type: 'literal', value: resolved }
      }
    } else {
      canonical = raw
      slot = { type: 'literal', value: raw as HexString }
    }

    const existing = slotMap.get(canonical)
    if (existing !== undefined) return existing

    const idx = stateSlots.length
    slotMap.set(canonical, idx)
    stateSlots.push(slot)
    return idx
  }

  const actions: WeirollAction[] = workflow.actions.map((action) => {
    const inputs = action.inputs.map((inp) => getOrAddSlot(inp.input?.[0] ?? '0x'))

    return {
      target: action.target as HexString,
      selector: action.selector as HexString,
      callType: action.valueNonZero ? VALUECALL : CALL,
      inputs,
      output: UNUSED_SLOT,
    }
  })

  return {
    workflowRef: workflow.workflowRef,
    actions,
    state: stateSlots,
  }
}
