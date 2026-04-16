import { map, switchMap } from 'rxjs'
import { encodeFunctionData, toHex } from 'viem'
import { ABI } from '../abi/index.js'
import type { Centrifuge } from '../Centrifuge.js'
import type { HexString } from '../types/index.js'
import { MerkleProofPolicy, MerkleProofPolicyInput, MerkleProofWorkflow } from '../types/poolMetadata.js'
import { MessageType } from '../types/transaction.js'
import { addressToBytes32, encode } from '../utils/index.js'
import { wrapTransaction } from '../utils/transaction.js'
import { Entity } from './Entity.js'
import type { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'

export type WorkflowDefaultValue = HexString | string | number | null

export type WorkflowVerificationAction = {
  policy: MerkleProofPolicyInput
  defaultValues: WorkflowDefaultValue[]
}

/**
 * Query and interact with a Merkle Proof Manager.
 */
export class MerkleProofManager extends Entity {
  pool: Pool

  /**
   * The contract address of the Merkle Proof Manager.
   */
  address: HexString
  /** @internal */
  constructor(
    _root: Centrifuge,
    public network: PoolNetwork,
    address: HexString
  ) {
    super(_root, ['merkleProofManager', network.centrifugeId, network.pool.id.toString()])
    this.pool = network.pool
    this.address = address.toLowerCase() as HexString
  }

  policiesAndWorkflows(strategist: HexString) {
    return this._query(['policiesAndWorkflows', strategist.toLowerCase()], () =>
      this.pool
        .metadata()
        .pipe(
          map(
            (metadata) =>
              metadata?.merkleProofManager?.[this.network.centrifugeId]?.[strategist.toLowerCase() as any] ?? []
          )
        )
    )
  }

  strategists() {
    return this._query(['strategists'], () =>
      this.pool.metadata().pipe(
        map((metadata) => {
          const strategists = metadata?.merkleProofManager?.[this.network.centrifugeId]

          if (!strategists) return []

          return Object.entries(strategists)
            .filter(([_, { policies }]) => policies.length > 0)
            .map(([address, { policies, workflows }]) => ({
              centrifugeId: this.network.centrifugeId,
              address,
              policies,
              workflows: workflows ?? [],
            }))
        })
      )
    )
  }

  setWorkflows(
    strategist: HexString,
    workflows: MerkleProofWorkflow[],
    verificationSources?: Record<string, { actions: WorkflowVerificationAction[] }>
  ) {
    const self = this
    return this._transact(async function* (ctx) {
      const [{ hub }, poolDetails] = await Promise.all([
        self._root._protocolAddresses(self.pool.centrifugeId),
        self.pool.details(),
      ])

      const { metadata } = poolDetails
      const policies =
        metadata?.merkleProofManager?.[self.network.centrifugeId]?.[strategist.toLowerCase() as any]?.policies || []
      const normalizedWorkflows = workflows.map((workflow) => ({
        ...workflow,
        actions: normalizeWorkflowActions(workflow.actions, policies),
      }))
      const workflowsWithVerification = normalizedWorkflows.map((workflow) => {
        if (!verificationSources) return workflow

        const verificationSource = workflow.template ? verificationSources[workflow.template] : undefined
        return {
          ...workflow,
          isVerified: verificationSource ? isVerifiedWorkflow(workflow, policies, verificationSource.actions) : false,
        }
      })

      const newMetadata = {
        ...metadata,
        merkleProofManager: {
          ...metadata?.merkleProofManager,
          [self.network.centrifugeId]: {
            ...metadata?.merkleProofManager?.[self.network.centrifugeId],
            [strategist.toLowerCase()]: {
              policies,
              workflows: workflowsWithVerification satisfies MerkleProofWorkflow[],
            },
          },
        },
      }

      const cid = await self._root.config.pinJson(newMetadata)

      yield* wrapTransaction('Set metadata workflows', ctx, {
        contract: hub,
        data: [
          encodeFunctionData({
            abi: ABI.Hub,
            functionName: 'setPoolMetadata',
            args: [self.pool.id.raw, toHex(cid)],
          }),
        ],
      })
    }, this.pool.centrifugeId)
  }

  addWorkflow(
    strategist: HexString,
    workflowMetadata: {
      id: string
      name: string
      category?: string
      iconUrl?: string
      template?: string
      verificationActions: WorkflowVerificationAction[]
    },
    options?: {
      simulate: boolean
    }
  ) {
    const self = this
    return this._transact(async function* (ctx) {
      const [{ hub }, poolDetails] = await Promise.all([
        self._root._protocolAddresses(self.pool.centrifugeId),
        self.pool.details(),
      ])

      const { metadata } = poolDetails
      const strategistAddress = strategist.toLowerCase()
      const existingEntry = metadata?.merkleProofManager?.[self.network.centrifugeId]?.[strategistAddress as any]
      const existingPolicies = existingEntry?.policies ?? []
      const existingWorkflows = existingEntry?.workflows ?? []
      const verificationActions = workflowMetadata.verificationActions
      const policyIndices = findWorkflowPolicyIndices(existingPolicies, verificationActions)

      if (!policyIndices) {
        throw new Error(
          `Workflow "${workflowMetadata.template ?? workflowMetadata.name}" requires policies that do not exist for strategist "${strategistAddress}"`
        )
      }

      const duplicateWorkflow = existingWorkflows.find((workflow) =>
        isDuplicateWorkflow(workflow, existingPolicies, workflowMetadata.template, verificationActions)
      )

      if (duplicateWorkflow) {
        throw new Error(
          `Workflow "${workflowMetadata.template ?? workflowMetadata.name}" already exists for strategist "${strategistAddress}"`
        )
      }

      const createdAt = new Date().toISOString()
      const actions = policyIndices.map((policyIndex, index) => ({
        policyIndex,
        defaultValues: normalizeDefaultValues(
          verificationActions[index]?.defaultValues,
          existingPolicies[policyIndex]!.inputs.length
        ),
      }))

      const workflow: MerkleProofWorkflow = {
        id: workflowMetadata.id,
        name: workflowMetadata.name,
        category: workflowMetadata.category,
        iconUrl: workflowMetadata.iconUrl,
        template: workflowMetadata.template,
        createdAt,
        actions,
        isVerified: isVerifiedWorkflow(
          {
            ...workflowMetadata,
            createdAt,
            actions,
          },
          existingPolicies,
          verificationActions
        ),
      }

      const newMetadata = {
        ...metadata,
        merkleProofManager: {
          ...metadata?.merkleProofManager,
          [self.network.centrifugeId]: {
            ...metadata?.merkleProofManager?.[self.network.centrifugeId],
            [strategistAddress]: {
              policies: existingPolicies,
              workflows: [...existingWorkflows, workflow] satisfies MerkleProofWorkflow[],
            },
          },
        },
      }

      const cid = await self._root.config.pinJson(newMetadata)

      yield* wrapTransaction('Add workflow', ctx, {
        contract: hub,
        data: [
          encodeFunctionData({
            abi: ABI.Hub,
            functionName: 'setPoolMetadata',
            args: [self.pool.id.raw, toHex(cid)],
          }),
        ],
      })
    }, this.pool.centrifugeId)
  }

}

function normalizeAddress(value: HexString | string) {
  return value.toLowerCase()
}

function normalizePolicyForVerification(policy: MerkleProofPolicy | MerkleProofPolicyInput) {
  return {
    decoder: normalizeAddress(policy.decoder),
    target: normalizeAddress(policy.target),
    selector: policy.selector,
    valueNonZero: policy.valueNonZero ?? false,
    inputs: policy.inputs.map((input) => ({
      parameter: input.parameter,
      label: input.label,
      input: input.input.map((value) => normalizeAddress(value)),
    })),
  }
}

export function normalizeDefaultValues(
  defaultValues: ReadonlyArray<WorkflowDefaultValue> | undefined,
  expectedLength: number
): WorkflowDefaultValue[] {
  return Array.from({ length: expectedLength }, (_, index) => defaultValues?.[index] ?? null)
}

function normalizeWorkflowActions(actions: MerkleProofWorkflow['actions'], policies: MerkleProofPolicy[]) {
  return actions.map((action) => {
    const policy = policies[action.policyIndex]
    if (!policy) return action

    return {
      ...action,
      defaultValues: normalizeDefaultValues(action.defaultValues, policy.inputs.length),
    }
  })
}

export function findWorkflowPolicyIndices(
  allPolicies: MerkleProofPolicy[],
  canonicalActions: WorkflowVerificationAction[]
): number[] | null {
  const policyIndices: number[] = []

  for (const action of canonicalActions) {
    const policyIndex = allPolicies.findIndex((policy) => arePoliciesEquivalent(policy, action.policy))
    if (policyIndex < 0) return null
    policyIndices.push(policyIndex)
  }

  return policyIndices
}

export function isVerifiedWorkflow(
  workflow: MerkleProofWorkflow,
  allPolicies: MerkleProofPolicy[],
  canonicalActions: WorkflowVerificationAction[]
) {
  return workflowMatchesActions(workflow, allPolicies, canonicalActions)
}

function workflowMatchesActions(
  workflow: Pick<MerkleProofWorkflow, 'actions'>,
  allPolicies: MerkleProofPolicy[],
  canonicalActions: WorkflowVerificationAction[]
) {
  if (workflow.actions.length !== canonicalActions.length) return false

  for (let index = 0; index < workflow.actions.length; index++) {
    const workflowAction = workflow.actions[index]
    const canonicalAction = canonicalActions[index]
    if (!workflowAction || !canonicalAction) return false

    const storedPolicy = allPolicies[workflowAction.policyIndex]
    if (!storedPolicy) return false

    if (!arePoliciesEquivalent(storedPolicy, canonicalAction.policy)) return false

    const expectedLength = storedPolicy.inputs.length
    if (
      workflowAction.defaultValues.length !== expectedLength ||
      canonicalAction.defaultValues.length !== expectedLength
    ) {
      return false
    }

    const normalizedWorkflowDefaults = normalizeDefaultValues(workflowAction.defaultValues, expectedLength)
    const normalizedCanonicalDefaults = normalizeDefaultValues(canonicalAction.defaultValues, expectedLength)

    for (let valueIndex = 0; valueIndex < expectedLength; valueIndex++) {
      if (normalizedWorkflowDefaults[valueIndex] !== normalizedCanonicalDefaults[valueIndex]) {
        return false
      }
    }
  }

  return true
}

function arePoliciesEquivalent(
  leftPolicy: MerkleProofPolicy | MerkleProofPolicyInput,
  rightPolicy: MerkleProofPolicy | MerkleProofPolicyInput
) {
  return JSON.stringify(normalizePolicyForVerification(leftPolicy)) === JSON.stringify(normalizePolicyForVerification(rightPolicy))
}

function isDuplicateWorkflow(
  workflow: MerkleProofWorkflow,
  allPolicies: MerkleProofPolicy[],
  template: string | undefined,
  canonicalActions: WorkflowVerificationAction[]
) {
  if (template && workflow.template !== template) return false

  return workflowMatchesActions(workflow, allPolicies, canonicalActions)
}
