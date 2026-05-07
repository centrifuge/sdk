import type { MarketplaceWorkflow } from '../types/workflow.js'
import type { WeirollAction, WorkflowDefinition, WorkflowStateSlot } from './weiroll.js'

/**
 * Converts a `MarketplaceWorkflow` (centrifuge/workflows catalog format) into
 * the `WorkflowDefinition` that `buildScript()` expects.
 *
 * - `entry.inputs` → `definition.state`   (InputDefinition → WorkflowStateSlot)
 * - `entry.actions` → `definition.actions` (structurally identical shapes)
 *
 * Throws if any `literal` slot is missing its `value` field.
 */
export function marketplaceToDefinition(entry: MarketplaceWorkflow): WorkflowDefinition {
  const state: WorkflowStateSlot[] = entry.inputs.map((input, i) => {
    if (input.type === 'literal') {
      if (!input.value) {
        throw new Error(
          `marketplaceToDefinition: literal slot ${i} (key "${input.key}") is missing a value`
        )
      }
      return { type: 'literal', value: input.value }
    }
    return { type: input.type, key: input.key }
  })

  return {
    workflowRef: entry.workflowRef,
    actions: entry.actions as WeirollAction[],
    state,
    ...(entry.runtimeVariables ? { runtimeVariables: entry.runtimeVariables } : {}),
  }
}
