import type { SimpleMerkleTree } from '@openzeppelin/merkle-tree'
import { map } from 'rxjs'
import { encodeFunctionData, encodePacked, keccak256, parseAbiItem, toFunctionSelector, toHex } from 'viem'
import { ABI } from '../abi/index.js'
import type { Centrifuge } from '../Centrifuge.js'
import type { HexString } from '../types/index.js'
import { MerkleProofPolicy } from '../types/poolMetadata.js'
import { MessageType } from '../types/transaction.js'
import { Balance, BigIntWrapper, Price } from '../utils/BigInt.js'
import { addressToBytes32 } from '../utils/index.js'
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
    return this._query(null, () =>
      this.pool
        .metadata()
        .pipe(map((metadata) => metadata?.merkleProofManager?.[this.chainId]?.[strategist.toLowerCase() as any] ?? []))
    )
  }

  setPolicies(strategist: HexString, policies: MerkleProofPolicy[]) {
    const self = this
    return this._transact(async function* (ctx) {
      const [{ hub }, id, poolDetails, { SimpleMerkleTree: SimpleMerkleTreeConstructor }] = await Promise.all([
        self._root._protocolAddresses(self.pool.chainId),
        self._root.id(self.chainId),
        self.pool.details(),
        import('@openzeppelin/merkle-tree'),
      ])
      const { metadata, shareClasses } = poolDetails

      async function getEncodedAddresses(policy: MerkleProofPolicy) {
        const abi = parseAbiItem(policy.abi)
        // abi.inputs
      }

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
            [strategist.toLowerCase()]: { policies },
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
              encodePacked(
                ['uint8', 'bytes32', 'bytes32'],
                [/* UpdateContractType.Policy */ 4, addressToBytes32(strategist), rootHash]
              ),
              0n,
            ],
          }),
        ],
        messages: { [id]: [MessageType.UpdateContract] },
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

        const abi = parseAbiItem(policy.abi)
        console.log('abi', abi)
        const args: (string | number | bigint)[] = [...policy.addresses] as any
        inputs.forEach((value, i) => {
          const argIndex = policy.strategistInputs[i]!
          args[argIndex] = value instanceof BigIntWrapper ? value.toBigInt() : value
        })

        const proof = getMerkleProof(tree, policy)

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

export function toHashedPolicyLeaf(policy: MerkleProofPolicy): HexString {
  return keccak256(
    encodePacked(
      ['address', 'address', 'bool', 'bytes4', 'bytes'],
      [policy.decoder, policy.target, policy.valueNonZero, toFunctionSelector(policy.abi), policy.addressesEncoded]
    )
  )
}

export function getMerkleTree(MerkleTreeConstructor: typeof SimpleMerkleTree, policies: MerkleProofPolicy[]) {
  const leaves = policies.map(toHashedPolicyLeaf)

  return MerkleTreeConstructor.of(leaves)
}

export function getMerkleProof(tree: SimpleMerkleTree, leaf: MerkleProofPolicy) {
  return tree.getProof(toHashedPolicyLeaf(leaf)) as HexString[]
}
