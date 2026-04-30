import type { WorkflowManifest } from '../types/workflow.js'
import type { WeirollAction, WorkflowDefinition, WorkflowStateSlot } from './weiroll.js'

/**
 * Converts a `WorkflowManifest` (centrifuge/workflows catalog format) into
 * the `WorkflowDefinition` that `buildScript()` expects.
 *
 * - `manifest.inputs` → `definition.state`   (InputDefinition → WorkflowStateSlot)
 * - `manifest.actions` → `definition.actions` (structurally identical shapes)
 *
 * Throws if any `literal` slot is missing its `value` field.
 */
export function manifestToDefinition(manifest: WorkflowManifest): WorkflowDefinition {
  const state: WorkflowStateSlot[] = manifest.inputs.map((input, i) => {
    if (input.type === 'literal') {
      if (!input.value) {
        throw new Error(
          `manifestToDefinition: literal slot ${i} (key "${input.key}") is missing a value`
        )
      }
      return { type: 'literal', value: input.value }
    }
    return { type: input.type, key: input.key }
  })

  return {
    workflowRef: manifest.workflowRef,
    actions: manifest.actions as WeirollAction[],
    state,
  }
}
