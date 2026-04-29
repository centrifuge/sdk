import type { WorkflowManifest } from '../types/workflow.js'
import type { WeirollAction, WorkflowDefinition, WorkflowStateSlot } from './weiroll.js'

/**
 * The catalog version this SDK release accepts.
 *
 * When the centrifuge/workflows catalog publishes a new release that introduces
 * breaking changes, bump this constant and release a new SDK version. This
 * ensures that a compromised or unrecognised catalog cannot be silently
 * processed — the SDK and the catalog must be updated together.
 */
export const SUPPORTED_CATALOG_VERSION = 'v1'

/**
 * Converts a `WorkflowManifest` (centrifuge/workflows catalog format) into
 * the `WorkflowDefinition` that `buildScript()` expects.
 *
 * - `manifest.inputs` → `definition.state`   (InputDefinition → WorkflowStateSlot)
 * - `manifest.actions` → `definition.actions` (structurally identical shapes)
 *
 * Throws if `manifest.catalogVersion` does not match `SUPPORTED_CATALOG_VERSION`.
 * Throws if any `literal` slot is missing its `value` field.
 */
export function manifestToDefinition(manifest: WorkflowManifest): WorkflowDefinition {
  if (manifest.catalogVersion !== SUPPORTED_CATALOG_VERSION) {
    throw new Error(
      `manifestToDefinition: unsupported catalog version "${manifest.catalogVersion}" — SDK requires "${SUPPORTED_CATALOG_VERSION}". Update the SDK to accept this catalog release.`
    )
  }

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
