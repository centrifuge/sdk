import { map, switchMap } from 'rxjs';
import { encodeFunctionData, encodePacked, keccak256, parseAbiItem, toFunctionSelector, toHex } from 'viem';
import { ABI } from '../abi/index.js';
import { NULL_ADDRESS } from '../constants.js';
import { MessageType } from '../types/transaction.js';
import { BigIntWrapper } from '../utils/BigInt.js';
import { addressToBytes32 } from '../utils/index.js';
import { wrapTransaction } from '../utils/transaction.js';
import { Entity } from './Entity.js';
/**
 * Query and interact with a Merkle Proof Manager.
 */
export class MerkleProofManager extends Entity {
    network;
    pool;
    chainId;
    /**
     * The contract address of the Merkle Proof Manager.
     */
    address;
    /** @internal */
    constructor(_root, network, address) {
        super(_root, ['merkleProofManager', network.chainId, network.pool.id.toString()]);
        this.network = network;
        this.chainId = network.chainId;
        this.pool = network.pool;
        this.address = address.toLowerCase();
    }
    policiesAndTemplates(strategist) {
        return this._query(['policiesAndTemplates', strategist.toLowerCase()], () => this.pool
            .metadata()
            .pipe(map((metadata) => metadata?.merkleProofManager?.[this.chainId]?.[strategist.toLowerCase()] ?? [])));
    }
    strategists() {
        return this._query(['strategists'], () => this.pool.metadata().pipe(switchMap(async (metadata) => {
            const strategists = metadata?.merkleProofManager?.[this.chainId];
            const importedMerkleTree = await import('@openzeppelin/merkle-tree');
            const { SimpleMerkleTree: SimpleMerkleTreeConstructor } = importedMerkleTree.default || importedMerkleTree;
            if (!strategists)
                return [];
            return Object.entries(strategists)
                .filter(([_, { policies }]) => policies.length > 0)
                .map(([address, { policies, templates }]) => ({
                chainId: this.chainId,
                address,
                policies,
                templates: templates ?? [],
                policyRoot: getMerkleTree(SimpleMerkleTreeConstructor, policies),
            }));
        })));
    }
    setTemplates(strategist, templates) {
        const self = this;
        return this._transact(async function* (ctx) {
            const [{ hub }, poolDetails] = await Promise.all([
                self._root._protocolAddresses(self.pool.chainId),
                self.pool.details(),
            ]);
            const { metadata } = poolDetails;
            const policies = metadata?.merkleProofManager?.[self.chainId]?.[strategist.toLowerCase()]?.policies || [];
            const newMetadata = {
                ...metadata,
                merkleProofManager: {
                    ...metadata?.merkleProofManager,
                    [self.chainId]: {
                        ...metadata?.merkleProofManager?.[self.chainId],
                        [strategist.toLowerCase()]: { policies, templates: templates },
                    },
                },
            };
            const cid = await self._root.config.pinJson(newMetadata);
            yield* wrapTransaction('Set metadata templates', ctx, {
                contract: hub,
                data: [
                    encodeFunctionData({
                        abi: ABI.Hub,
                        functionName: 'setPoolMetadata',
                        args: [self.pool.id.raw, toHex(cid)],
                    }),
                ],
            });
        }, this.pool.chainId);
    }
    setPolicies(strategist, policyInputs, options) {
        const self = this;
        return this._transact(async function* (ctx) {
            const [{ hub }, id, poolDetails, importedMerkleTree] = await Promise.all([
                self._root._protocolAddresses(self.pool.chainId),
                self._root.id(self.chainId),
                self.pool.details(),
                import('@openzeppelin/merkle-tree'),
            ]);
            const { SimpleMerkleTree: SimpleMerkleTreeConstructor } = importedMerkleTree.default || importedMerkleTree;
            const { metadata, shareClasses } = poolDetails;
            const client = self._root.getClient(self.chainId);
            // Get the encoded args from chain by calling the decoder contract.
            async function getEncodedArgs(policy, policyCombinations) {
                const abi = parseAbiItem(policy.selector);
                return Promise.all(policyCombinations.map(async (pc) => {
                    const args = pc.map((arg, i) => {
                        if (arg !== null)
                            return arg;
                        const { type } = abi.inputs[i] || {};
                        if (!type) {
                            throw new Error(`No type found for argument ${i} in abi item "${policy.selector}, inputs: ${policy.inputs}"`);
                        }
                        if (type === 'address') {
                            return NULL_ADDRESS;
                        }
                        else if (type.includes('int')) {
                            return 0;
                        }
                        else if (type === 'bytes') {
                            return '0x';
                        }
                        else if (type === 'bool') {
                            return false;
                        }
                        else if (type === 'string') {
                            return '';
                        }
                        else if (type.startsWith('bytes')) {
                            return toHex(0, { size: parseInt(type.slice(5)) });
                        }
                        else if (type.includes('[')) {
                            return [];
                        }
                        throw new Error(`Unsupported type "${type}" for abi item "${policy.selector}"`);
                    });
                    abi.outputs = [
                        {
                            name: 'addressesFound',
                            type: 'bytes',
                            internalType: 'bytes',
                        },
                    ];
                    const encoded = await client.readContract({
                        address: policy.decoder,
                        abi: [abi],
                        functionName: abi.name,
                        args,
                    });
                    return encoded;
                }));
            }
            const policies = await Promise.all(policyInputs.map(async (input) => {
                const policyCombinations = generateCombinations(input.inputs);
                const argsEncoded = await getEncodedArgs(input, policyCombinations);
                return {
                    ...input,
                    valueNonZero: input.valueNonZero ?? false,
                    inputCombinations: policyCombinations.map((inputs, i) => ({
                        inputs,
                        inputsEncoded: argsEncoded[i],
                    })),
                };
            }));
            let rootHash;
            if (policies.length === 0) {
                rootHash = toHex(0, { size: 32 });
            }
            else {
                const tree = getMerkleTree(SimpleMerkleTreeConstructor, policies);
                rootHash = tree.root;
            }
            const templates = metadata?.merkleProofManager?.[self.chainId]?.[strategist.toLowerCase()]?.templates || [];
            const newMetadata = {
                ...metadata,
                merkleProofManager: {
                    ...metadata?.merkleProofManager,
                    [self.chainId]: {
                        ...metadata?.merkleProofManager?.[self.chainId],
                        [strategist.toLowerCase()]: { templates, policies: policies },
                    },
                },
            };
            const cid = await self._root.config.pinJson(newMetadata);
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
                            shareClasses[0].shareClass.id.raw,
                            id,
                            addressToBytes32(self.address),
                            encodePacked(['uint8', 'bytes32', 'bytes32'], [/* UpdateContractType.Policy */ 4, addressToBytes32(strategist), rootHash]),
                            0n,
                        ],
                    }),
                ],
                messages: { [id]: [MessageType.UpdateContract] },
            }, options && { simulate: options.simulate });
        }, this.pool.chainId);
    }
    /**
     * Disable strategist.
     * @param strategist - The strategist address to disable
     */
    disableStrategist(strategist) {
        return this.setPolicies(strategist, []);
    }
    execute(calls, options) {
        const self = this;
        return this._transact(async function* (ctx) {
            const [metadata, importedMerkleTree] = await Promise.all([
                self.pool.metadata(),
                import('@openzeppelin/merkle-tree'),
            ]);
            const { SimpleMerkleTree: SimpleMerkleTreeConstructor } = importedMerkleTree.default || importedMerkleTree;
            const policiesForStrategist = metadata?.merkleProofManager?.[self.chainId]?.[ctx.signingAddress.toLowerCase()]?.policies;
            if (!policiesForStrategist) {
                throw new Error(`No policies found for strategist "${ctx.signingAddress}" on chain "${self.chainId}"`);
            }
            const tree = getMerkleTree(SimpleMerkleTreeConstructor, policiesForStrategist);
            const formattedCalls = calls.map((call) => {
                const { policy, inputs, value } = call;
                const abi = parseAbiItem(policy.selector);
                const args = inputs.map((value) => {
                    return value instanceof BigIntWrapper ? value.toBigInt() : value;
                });
                const argsEncoded = policy.inputCombinations.find((ic) => ic.inputs.every((input, i) => input === null || inputs[i] === input))?.inputsEncoded;
                if (!argsEncoded) {
                    throw new Error(`No encoded args found for policy with selector "${policy.selector}" and inputs [${inputs}]`);
                }
                const proof = getMerkleProof(tree, policy, argsEncoded);
                const targetData = encodeFunctionData({
                    abi: [abi],
                    functionName: abi.name,
                    args,
                });
                return {
                    decoder: policy.decoder,
                    target: policy.target,
                    targetData,
                    value: value ?? 0n,
                    proof,
                };
            });
            yield* wrapTransaction('Execute calls', ctx, {
                contract: self.address,
                data: encodeFunctionData({
                    abi: ABI.MerkleProofManager,
                    functionName: 'execute',
                    args: [formattedCalls],
                }),
                value: calls.reduce((acc, call) => acc + (call.value ?? 0n), 0n),
            }, options && { simulate: options.simulate });
        }, this.chainId);
    }
}
export function toHashedPolicyLeaf(policy, argsEncoded) {
    return keccak256(encodePacked(['address', 'address', 'bool', 'bytes4', 'bytes'], [policy.decoder, policy.target, policy.valueNonZero, toFunctionSelector(policy.selector), argsEncoded]));
}
export function getMerkleTree(MerkleTreeConstructor, policies) {
    const leaves = policies.flatMap((policy) => policy.inputCombinations.map(({ inputsEncoded }) => toHashedPolicyLeaf(policy, inputsEncoded)));
    return MerkleTreeConstructor.of(leaves);
}
export function getMerkleProof(tree, leaf, argsEncoded) {
    return tree.getProof(toHashedPolicyLeaf(leaf, argsEncoded));
}
export function generateCombinations(inputs) {
    if (inputs.length === 0)
        throw new Error('No inputs provided for generating combinations');
    function combine(index, current) {
        if (index >= inputs.length)
            return current;
        const nextInput = inputs[index]?.input;
        if (!nextInput) {
            return [];
        }
        const options = nextInput.length > 0 ? nextInput : [null];
        const newCombinations = [];
        for (const combination of current) {
            for (const option of options) {
                newCombinations.push([...combination, option]);
            }
        }
        return combine(index + 1, newCombinations);
    }
    return combine(0, [[]]);
}
//# sourceMappingURL=MerkleProofManager.js.map