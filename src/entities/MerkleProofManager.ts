import type { SimpleMerkleTree } from '@openzeppelin/merkle-tree'
import { map } from 'rxjs'
import { AbiFunction, encodeFunctionData, encodePacked, keccak256, parseAbiItem, toFunctionSelector, toHex } from 'viem'
import { ABI } from '../abi/index.js'
import type { Centrifuge } from '../Centrifuge.js'
import { NULL_ADDRESS } from '../constants.js'
import type { HexString } from '../types/index.js'
import { MerkleProofPolicy, MerkleProofPolicyInput } from '../types/poolMetadata.js'
import { MessageType } from '../types/transaction.js'
import { Balance, BigIntWrapper, Price } from '../utils/BigInt.js'
import { addressToBytes32, encode } from '../utils/index.js'
import { wrapTransaction } from '../utils/transaction.js'
import { Entity } from './Entity.js'
import type { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'

/**
 * Query and interact with a Merkle Proof Manager.
 */
export class MerkleProofManager extends Entity {
  pool: Pool
  chainId: number

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
    super(_root, ['merkleProofManager', network.chainId, network.pool.id.toString()])
    this.chainId = network.chainId
    this.pool = network.pool
    this.address = address.toLowerCase() as HexString
  }

  policies(strategist: HexString) {
    return this._query(['policies', strategist.toLowerCase()], () =>
      this.pool
        .metadata()
        .pipe(map((metadata) => metadata?.merkleProofManager?.[this.chainId]?.[strategist.toLowerCase() as any] ?? []))
    )
  }

  setPolicies(strategist: HexString, policyInputs: MerkleProofPolicyInput[]) {
    const self = this
    return this._transact(async function* (ctx) {
      const [{ hub }, id, poolDetails, { SimpleMerkleTree: SimpleMerkleTreeConstructor }] = await Promise.all([
        self._root._protocolAddresses(self.pool.chainId),
        self._root.id(self.chainId),
        self.pool.details(),
        import('@openzeppelin/merkle-tree'),
      ])
      const { metadata, shareClasses } = poolDetails
      const client = self._root.getClient(self.chainId)

      // Get the encoded args from chain by calling the decoder contract.
      async function getEncodedArgs(policy: MerkleProofPolicyInput, policyCombinations: (string | null)[][]) {
        const abi = parseAbiItem(policy.selector) as AbiFunction
        return Promise.all(
          policyCombinations.map(async (pc) => {
            const args = pc.map((arg, i) => {
              if (arg !== null) return arg
              const { type } = abi.inputs[i] || {}
              if (!type) {
                throw new Error(
                  `No type found for argument ${i} in abi item "${policy.selector}, inputs: ${policy.inputs}"`
                )
              }
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
              throw new Error(`Unsupported type "${type}" for abi item "${policy.selector}"`)
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

            return encoded as any as HexString
          })
        )
      }

      const policies = await Promise.all(
        policyInputs.map(async (input) => {
          const policyCombinations = generateCombinations(input.inputs)
          const argsEncoded = await getEncodedArgs(input, policyCombinations)
          return {
            ...input,
            assetId: input.assetId?.toString(),
            valueNonZero: input.valueNonZero ?? false,
            inputCombinations: policyCombinations.map((inputs, i) => ({
              inputs,
              inputsEncoded: argsEncoded[i]!,
            })),
          } satisfies MerkleProofPolicy
        })
      )

      let rootHash
      if (policies.length === 0) {
        rootHash = toHex(0, { size: 32 })
      } else {
        const tree = getMerkleTree(SimpleMerkleTreeConstructor, policies)

        rootHash = tree.root as HexString
      }

      const newMetadata = {
        ...metadata,
        merkleProofManager: {
          ...metadata?.merkleProofManager,
          [self.chainId]: {
            ...metadata?.merkleProofManager?.[self.chainId],
            [strategist.toLowerCase()]: { policies: policies satisfies MerkleProofPolicy[] },
          },
        },
      }

      const cid = await self._root.config.pinJson(newMetadata)

      yield* wrapTransaction('Set policies', ctx, {
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
      })
    }, this.pool.chainId)
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
    }[]
  ) {
    const self = this
    return this._transact(async function* (ctx) {
      const [metadata, { SimpleMerkleTree: SimpleMerkleTreeConstructor }] = await Promise.all([
        self.pool.metadata(),
        import('@openzeppelin/merkle-tree'),
      ])

      const policiesForStrategist =
        metadata?.merkleProofManager?.[self.chainId]?.[ctx.signingAddress.toLowerCase() as any]?.policies

      if (!policiesForStrategist) {
        throw new Error(`No policies found for strategist "${ctx.signingAddress}" on chain "${self.chainId}"`)
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

      yield* wrapTransaction('Execute calls', ctx, {
        contract: self.address,
        data: encodeFunctionData({
          abi: ABI.MerkleProofManager,
          functionName: 'execute',
          args: [formattedCalls],
        }),
        value: calls.reduce((acc, call) => acc + (call.value ?? 0n), 0n),
      })
    }, this.chainId)
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
