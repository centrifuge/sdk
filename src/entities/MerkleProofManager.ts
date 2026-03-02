import type { SimpleMerkleTree } from '@openzeppelin/merkle-tree'
import { firstValueFrom, map, switchMap } from 'rxjs'
import { AbiFunction, encodeFunctionData, encodePacked, keccak256, parseAbiItem, toFunctionSelector, toHex } from 'viem'
import type { PublicClient } from 'viem'
import { ABI } from '../abi/index.js'
import type { Centrifuge } from '../Centrifuge.js'
import { NULL_ADDRESS } from '../constants.js'
import type { HexString } from '../types/index.js'
import { MerkleProofPolicy, MerkleProofPolicyInput, MerkleProofWorkflow } from '../types/poolMetadata.js'
import { MessageType } from '../types/transaction.js'
import { Balance, BigIntWrapper, Price } from '../utils/BigInt.js'
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
        switchMap(async (metadata) => {
          const strategists = metadata?.merkleProofManager?.[this.network.centrifugeId]
          const importedMerkleTree = await import('@openzeppelin/merkle-tree')
          const { SimpleMerkleTree: SimpleMerkleTreeConstructor } = importedMerkleTree.default || importedMerkleTree

          if (!strategists) return []

          return Object.entries(strategists)
            .filter(([_, { policies }]) => policies.length > 0)
            .map(([address, { policies, workflows }]) => ({
              centrifugeId: this.network.centrifugeId,
              address,
              policies,
              workflows: workflows ?? [],
              policyRoot: getMerkleTree(SimpleMerkleTreeConstructor, policies),
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

  addPolicy(
    strategist: HexString,
    newPolicies: MerkleProofPolicyInput[],
    workflowMetadata: {
      id: string
      name: string
      category?: string
      iconUrl?: string
      template?: string
      verificationActions?: WorkflowVerificationAction[]
    },
    options?: {
      simulate: boolean
    }
  ) {
    const self = this
    return this._transact(async function* (ctx) {
      const [{ hub }, id, poolDetails, importedMerkleTree, client] = await Promise.all([
        self._root._protocolAddresses(self.pool.centrifugeId),
        Promise.resolve(self.network.centrifugeId),
        self.pool.details(),
        import('@openzeppelin/merkle-tree'),
        firstValueFrom(self._root.getClient(self.network.centrifugeId)),
      ])

      const { SimpleMerkleTree: SimpleMerkleTreeConstructor } = importedMerkleTree.default || importedMerkleTree
      const { metadata, shareClasses } = poolDetails
      const strategistAddress = strategist.toLowerCase()
      const existingEntry = metadata?.merkleProofManager?.[self.network.centrifugeId]?.[strategistAddress as any]
      const existingPolicies = existingEntry?.policies ?? []
      const existingWorkflows = existingEntry?.workflows ?? []

      const appendedPolicies = await buildPoliciesFromInputs(newPolicies, client)
      const policies = [...existingPolicies, ...appendedPolicies]

      const workflowActions = appendedPolicies.map((policy, index) => {
        const defaultValues = normalizeDefaultValues(
          workflowMetadata.verificationActions?.[index]?.defaultValues,
          policy.inputs.length
        )
        return {
          policyIndex: existingPolicies.length + index,
          defaultValues,
        }
      })
      const createdAt = new Date().toISOString()

      const workflow: MerkleProofWorkflow = {
        id: workflowMetadata.id,
        name: workflowMetadata.name,
        category: workflowMetadata.category,
        iconUrl: workflowMetadata.iconUrl,
        template: workflowMetadata.template,
        createdAt,
        actions: workflowActions,
        isVerified: workflowMetadata.verificationActions
          ? isVerifiedWorkflow(
              {
                ...workflowMetadata,
                createdAt,
                actions: workflowActions,
              },
              policies,
              workflowMetadata.verificationActions
            )
          : false,
      }

      const workflows = [...existingWorkflows, workflow]

      const rootHash =
        policies.length === 0
          ? toHex(0, { size: 32 })
          : (getMerkleTree(SimpleMerkleTreeConstructor, policies).root as HexString)

      const newMetadata = {
        ...metadata,
        merkleProofManager: {
          ...metadata?.merkleProofManager,
          [self.network.centrifugeId]: {
            ...metadata?.merkleProofManager?.[self.network.centrifugeId],
            [strategistAddress]: { policies, workflows },
          },
        },
      }

      const cid = await self._root.config.pinJson(newMetadata)

      yield* wrapTransaction(
        'Add policy',
        ctx,
        {
          contract: hub,
          data: [
            encodeFunctionData({
              abi: ABI.Hub,
              functionName: 'setPoolMetadata',
              args: [self.pool.id.raw, toHex(cid)],
            }),
            encodeFunctionData({
              abi: ABI.Hub,
              functionName: 'updateContract',
              args: [
                self.pool.id.raw,
                shareClasses[0]!.shareClass.id.raw,
                id,
                addressToBytes32(self.address),
                encode([strategist, rootHash]),
                0n,
                ctx.signingAddress,
              ],
            }),
          ],
          messages: { [id]: [MessageType.TrustedContractUpdate] },
        },
        options && { simulate: options.simulate }
      )
    }, this.pool.centrifugeId)
  }

  setPolicies(
    strategist: HexString,
    policyInputs: MerkleProofPolicyInput[],
    options?: {
      simulate: boolean
    }
  ) {
    const self = this
    return this._transact(async function* (ctx) {
      const [{ hub }, id, poolDetails, importedMerkleTree, client] = await Promise.all([
        self._root._protocolAddresses(self.pool.centrifugeId),
        Promise.resolve(self.network.centrifugeId),
        self.pool.details(),
        import('@openzeppelin/merkle-tree'),
        firstValueFrom(self._root.getClient(self.network.centrifugeId)),
      ])

      const { SimpleMerkleTree: SimpleMerkleTreeConstructor } = importedMerkleTree.default || importedMerkleTree
      const { metadata, shareClasses } = poolDetails

      const policies = await buildPoliciesFromInputs(policyInputs, client)

      let rootHash
      if (policies.length === 0) {
        rootHash = toHex(0, { size: 32 })
      } else {
        const tree = getMerkleTree(SimpleMerkleTreeConstructor, policies)

        rootHash = tree.root as HexString
      }

      // Whenever we update, add or delete policies, we also have to clean workflows for particular strategist
      // Otherwise order of policies might impact the actions in template and cause unexpected behavior in workflows
      const newMetadata = {
        ...metadata,
        merkleProofManager: {
          ...metadata?.merkleProofManager,
          [self.network.centrifugeId]: {
            ...metadata?.merkleProofManager?.[self.network.centrifugeId],
            [strategist.toLowerCase()]: { workflows: [], policies: policies satisfies MerkleProofPolicy[] },
          },
        },
      }

      const cid = await self._root.config.pinJson(newMetadata)

      yield* wrapTransaction(
        'Set policies',
        ctx,
        {
          contract: hub,
          data: [
            encodeFunctionData({
              abi: ABI.Hub,
              functionName: 'setPoolMetadata',
              args: [self.pool.id.raw, toHex(cid)],
            }),
            encodeFunctionData({
              abi: ABI.Hub,
              functionName: 'updateContract',
              args: [
                self.pool.id.raw,
                shareClasses[0]!.shareClass.id.raw,
                id,
                addressToBytes32(self.address),
                encode([strategist, rootHash]),
                0n,
                ctx.signingAddress,
              ],
            }),
          ],
          messages: { [id]: [{ type: MessageType.TrustedContractUpdate, poolId: self.pool.id }] },
        },
        options && { simulate: options.simulate }
      )
    }, this.pool.centrifugeId)
  }

  /**
   * Disable strategist.
   * @param strategist - The strategist address to disable
   */
  disableStrategist(strategist: HexString) {
    return this.setPolicies(strategist, [])
  }

  execute(
    calls: {
      policy: MerkleProofPolicy
      inputs: (string | number | bigint | Balance | Price)[]
      value?: bigint
    }[],
    options?: {
      simulate: boolean
    }
  ) {
    const self = this
    return this._transact(async function* (ctx) {
      const [metadata, importedMerkleTree] = await Promise.all([
        self.pool.metadata(),
        import('@openzeppelin/merkle-tree'),
      ])

      const { SimpleMerkleTree: SimpleMerkleTreeConstructor } = importedMerkleTree.default || importedMerkleTree

      const policiesForStrategist =
        metadata?.merkleProofManager?.[self.network.centrifugeId]?.[ctx.signingAddress.toLowerCase() as any]?.policies

      if (!policiesForStrategist) {
        throw new Error(
          `No policies found for strategist "${ctx.signingAddress}" on centrifuge network "${self.network.centrifugeId}"`
        )
      }

      const tree = getMerkleTree(SimpleMerkleTreeConstructor, policiesForStrategist)

      const formattedCalls = calls.map((call) => {
        const { policy, inputs, value } = call

        const abi = parseAbiItem(policy.selector)

        const args = inputs.map((value) => {
          return value instanceof BigIntWrapper ? value.toBigInt() : value
        })

        const argsEncoded = policy.inputCombinations.find((ic) =>
          ic.inputs.every((input, i) => input === null || inputs[i] === input)
        )?.inputsEncoded

        if (!argsEncoded) {
          throw new Error(`No encoded args found for policy with selector "${policy.selector}" and inputs [${inputs}]`)
        }

        const proof = getMerkleProof(tree, policy, argsEncoded)

        const targetData = encodeFunctionData({
          abi: [abi],
          functionName: (abi as any).name,
          args,
        })

        return {
          decoder: policy.decoder,
          target: policy.target,
          targetData,
          value: value ?? 0n,
          proof,
        }
      })

      yield* wrapTransaction(
        'Execute calls',
        ctx,
        {
          contract: self.address,
          data: encodeFunctionData({
            abi: ABI.MerkleProofManager,
            functionName: 'execute',
            args: [formattedCalls],
          }),
          value: calls.reduce((acc, call) => acc + (call.value ?? 0n), 0n),
        },
        options && { simulate: options.simulate }
      )
    }, this.network.centrifugeId)
  }
}

export function toHashedPolicyLeaf(policy: MerkleProofPolicy, argsEncoded: HexString): HexString {
  return keccak256(
    encodePacked(
      ['address', 'address', 'bool', 'bytes4', 'bytes'],
      [policy.decoder, policy.target, policy.valueNonZero, toFunctionSelector(policy.selector), argsEncoded]
    )
  )
}

export function getMerkleTree(MerkleTreeConstructor: typeof SimpleMerkleTree, policies: MerkleProofPolicy[]) {
  const leaves = policies.flatMap((policy) =>
    policy.inputCombinations.map(({ inputsEncoded }) => toHashedPolicyLeaf(policy, inputsEncoded))
  )

  return MerkleTreeConstructor.of(leaves)
}

export function getMerkleProof(tree: SimpleMerkleTree, leaf: MerkleProofPolicy, argsEncoded: HexString) {
  return tree.getProof(toHashedPolicyLeaf(leaf, argsEncoded)) as HexString[]
}

export function generateCombinations(inputs: MerkleProofPolicyInput['inputs']) {
  if (inputs.length === 0) throw new Error('No inputs provided for generating combinations')

  function combine(index: number, current: (HexString | null)[][]) {
    if (index >= inputs.length) return current

    const nextInput = inputs[index]?.input
    if (!nextInput) {
      return []
    }
    const options = nextInput.length > 0 ? nextInput : [null]
    const newCombinations = []

    for (const combination of current) {
      for (const option of options) {
        newCombinations.push([...combination, option])
      }
    }

    return combine(index + 1, newCombinations)
  }

  return combine(0, [[]])
}

function defaultValueForAbiType(type: string): unknown {
  if (type === 'address') {
    return NULL_ADDRESS
  } else if (type.includes('int')) {
    return 0
  } else if (type === 'bytes') {
    return '0x'
  } else if (type === 'bool') {
    return false
  } else if (type === 'string') {
    return ''
  } else if (type.startsWith('bytes')) {
    return toHex(0, { size: parseInt(type.slice(5)) })
  } else if (type.includes('[')) {
    return []
  }
  throw new Error(`Unsupported type "${type}"`)
}

async function getEncodedArgs(
  policy: MerkleProofPolicyInput,
  policyCombinations: (HexString | null)[][],
  client: PublicClient
) {
  const abi = parseAbiItem(policy.selector) as AbiFunction
  return Promise.all(
    policyCombinations.map(async (pc) => {
      const args = pc.map((arg, i) => {
        if (arg !== null) return arg
        const { type } = abi.inputs[i] || {}
        if (!type) {
          throw new Error(`No type found for argument ${i} in abi item "${policy.selector}"`)
        }
        return defaultValueForAbiType(type)
      })

      abi.outputs = [
        {
          name: 'addressesFound',
          type: 'bytes',
          internalType: 'bytes',
        },
      ]

      const encoded = await client.readContract({
        address: policy.decoder,
        abi: [abi],
        functionName: abi.name,
        args,
      })

      return encoded as HexString
    })
  )
}

async function buildPoliciesFromInputs(policyInputs: MerkleProofPolicyInput[], client: PublicClient) {
  return Promise.all(
    policyInputs.map(async (input) => {
      const policyCombinations = generateCombinations(input.inputs)
      const argsEncoded = await getEncodedArgs(input, policyCombinations, client)
      return {
        ...input,
        valueNonZero: input.valueNonZero ?? false,
        inputCombinations: policyCombinations.map((inputs, i) => ({
          inputs,
          inputsEncoded: argsEncoded[i]!,
        })),
      } satisfies MerkleProofPolicy
    })
  )
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

export function isVerifiedWorkflow(
  workflow: MerkleProofWorkflow,
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

    const workflowPolicyComparable = normalizePolicyForVerification(storedPolicy)
    const canonicalPolicyComparable = normalizePolicyForVerification(canonicalAction.policy)
    if (JSON.stringify(workflowPolicyComparable) !== JSON.stringify(canonicalPolicyComparable)) return false

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
