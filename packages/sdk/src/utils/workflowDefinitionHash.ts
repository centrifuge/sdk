import { keccak256, toHex } from 'viem'
import type { HexString } from '../types/index.js'
import type { MarketplaceWorkflow } from '../types/workflow.js'
import { buildWorkflowDefinitionFromCatalog } from './catalog.js'
import type { WeirollTarget, WorkflowDefinition, WorkflowStateSlot } from './weiroll.js'

export function workflowDefinitionHash(workflow: MarketplaceWorkflow): HexString {
  return keccak256(toHex(JSON.stringify(definitionShape(buildWorkflowDefinitionFromCatalog(workflow)))))
}

function definitionShape(definition: WorkflowDefinition): unknown {
  return {
    actions: definition.actions.map((action) => ({
      target: targetShape(action.target),
      selector: action.selector.toLowerCase(),
      callType: action.callType,
      inputs: action.inputs,
      output: action.output,
      rawMode: action.rawMode ?? false,
    })),
    state: definition.state.map(slotShape),
  }
}

function targetShape(target: WeirollTarget): unknown {
  return typeof target === 'string' ? target.toLowerCase() : { magic: target.key }
}

function slotShape(slot: WorkflowStateSlot): unknown {
  switch (slot.type) {
    case 'literal':
      return { type: slot.type, value: slot.value.toLowerCase() }
    case 'magic':
      return { type: slot.type, key: slot.key }
    case 'configurable':
    case 'runtime':
      return { type: slot.type, key: slot.key, system: slot.system ?? null }
    case 'rawcalldata':
      return {
        type: slot.type,
        selector: slot.selector.toLowerCase(),
        parameterTypes: slot.parameterTypes,
        sourceSlots: slot.sourceSlots,
      }
    case 'template':
      return { type: slot.type, workflow: definitionShape(slot.workflow) }
  }
}
