import type { SimpleMerkleTree } from '@openzeppelin/merkle-tree';
import type { HexString } from '../types/index.js';
import { MerkleProofPolicy, MerkleProofPolicyInput } from '../types/poolMetadata.js';
import { Balance, Price } from '../utils/BigInt.js';
import { Entity } from './Entity.js';
import type { Pool } from './Pool.js';
import { PoolNetwork } from './PoolNetwork.js';
/**
 * Query and interact with a Merkle Proof Manager.
 */
export declare class MerkleProofManager extends Entity {
    network: PoolNetwork;
    pool: Pool;
    chainId: number;
    /**
     * The contract address of the Merkle Proof Manager.
     */
    address: HexString;
    policies(strategist: HexString): import("../index.js").Query<never[] | {
        policies: MerkleProofPolicy[];
    }>;
    strategists(): import("../index.js").Query<{
        chainId: number;
        address: string;
        policies: MerkleProofPolicy[];
        policyRoot: SimpleMerkleTree;
    }[]>;
    setPolicies(strategist: HexString, policyInputs: MerkleProofPolicyInput[], options?: {
        simulate: boolean;
    }): import("../types/transaction.js").Transaction;
    /**
     * Disable strategist.
     * @param strategist - The strategist address to disable
     */
    disableStrategist(strategist: HexString): import("../types/transaction.js").Transaction;
    execute(calls: {
        policy: MerkleProofPolicy;
        inputs: (string | number | bigint | Balance | Price)[];
        value?: bigint;
    }[], options?: {
        simulate: boolean;
    }): import("../types/transaction.js").Transaction;
}
export declare function toHashedPolicyLeaf(policy: MerkleProofPolicy, argsEncoded: HexString): HexString;
export declare function getMerkleTree(MerkleTreeConstructor: typeof SimpleMerkleTree, policies: MerkleProofPolicy[]): SimpleMerkleTree;
export declare function getMerkleProof(tree: SimpleMerkleTree, leaf: MerkleProofPolicy, argsEncoded: HexString): HexString[];
export declare function generateCombinations(inputs: MerkleProofPolicyInput['inputs']): (`0x${string}` | null)[][];
//# sourceMappingURL=MerkleProofManager.d.ts.map