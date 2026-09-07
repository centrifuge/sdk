import { SimpleMerkleTree } from '@openzeppelin/merkle-tree'
import { expect } from 'chai'
import { encodePacked, keccak256, toFunctionSelector } from 'viem'
import type { MerkleProofPolicy } from '../types/poolMetadata.js'
import { getMerkleProof, getMerkleTree, normalizeDefaultValues, toHashedPolicyLeaf } from './MerkleProofManager.js'

// Pure helpers, split out from MerkleProofManager.test.ts so they run in the unit job — that file
// needs a Tenderly fork, and a leaf-construction regression should not wait on a fork to surface.

const DECODER = '0x1111111111111111111111111111111111111111' as const
const TARGET = '0x2222222222222222222222222222222222222222' as const
const OTHER_TARGET = '0x3333333333333333333333333333333333333333' as const

const SELECTOR = 'function requestDeposit(uint256 assets, address controller, address owner)'
const ARGS_A = `0x${'a'.repeat(64)}` as const
const ARGS_B = `0x${'b'.repeat(64)}` as const

const policy = (overrides: Partial<MerkleProofPolicy> = {}): MerkleProofPolicy =>
  ({
    decoder: DECODER,
    target: TARGET,
    valueNonZero: false,
    selector: SELECTOR,
    inputs: [],
    inputCombinations: [{ inputs: [], inputsEncoded: ARGS_A }],
    ...overrides,
  }) as MerkleProofPolicy

describe('entities/MerkleProofManager helpers', () => {
  describe('toHashedPolicyLeaf', () => {
    it('hashes decoder, target, value flag, selector and encoded args', () => {
      // Spelled out rather than snapshotted: this leaf is what the on-chain proof is checked
      // against, so the field order and packing are the contract.
      const expected = keccak256(
        encodePacked(
          ['address', 'address', 'bool', 'bytes4', 'bytes'],
          [DECODER, TARGET, false, toFunctionSelector(SELECTOR), ARGS_A]
        )
      )
      expect(toHashedPolicyLeaf(policy(), ARGS_A)).to.equal(expected)
    })

    it('is deterministic', () => {
      expect(toHashedPolicyLeaf(policy(), ARGS_A)).to.equal(toHashedPolicyLeaf(policy(), ARGS_A))
    })

    it('changes with every field that constrains the call', () => {
      const base = toHashedPolicyLeaf(policy(), ARGS_A)
      expect(toHashedPolicyLeaf(policy({ target: OTHER_TARGET }), ARGS_A)).to.not.equal(base)
      expect(toHashedPolicyLeaf(policy({ decoder: OTHER_TARGET }), ARGS_A)).to.not.equal(base)
      expect(toHashedPolicyLeaf(policy({ valueNonZero: true }), ARGS_A)).to.not.equal(base)
      expect(toHashedPolicyLeaf(policy({ selector: 'function redeem(uint256)' }), ARGS_A)).to.not.equal(base)
      // Different arguments must be a different leaf, or one approval covers both.
      expect(toHashedPolicyLeaf(policy(), ARGS_B)).to.not.equal(base)
    })
  })

  describe('getMerkleTree', () => {
    it('builds one leaf per input combination across all policies', () => {
      const tree = getMerkleTree(SimpleMerkleTree, [
        policy({
          inputCombinations: [
            { inputs: [], inputsEncoded: ARGS_A },
            { inputs: [], inputsEncoded: ARGS_B },
          ],
        }),
        policy({ target: OTHER_TARGET }),
      ])
      expect(tree.length).to.equal(3)
      expect(tree.root).to.match(/^0x[0-9a-f]{64}$/)
    })

    it('produces the same root regardless of policy order', () => {
      // SimpleMerkleTree.of sorts its leaves, and the app must not depend on metadata ordering.
      const a = policy()
      const b = policy({ target: OTHER_TARGET })
      expect(getMerkleTree(SimpleMerkleTree, [a, b]).root).to.equal(getMerkleTree(SimpleMerkleTree, [b, a]).root)
    })
  })

  describe('getMerkleProof', () => {
    it('returns a proof that verifies against the tree root', () => {
      const a = policy()
      const b = policy({ target: OTHER_TARGET })
      const tree = getMerkleTree(SimpleMerkleTree, [a, b])
      const proof = getMerkleProof(tree, a, ARGS_A)
      expect(proof).to.have.length.greaterThan(0)
      expect(SimpleMerkleTree.verify(tree.root, toHashedPolicyLeaf(a, ARGS_A), proof)).to.equal(true)
    })

    it('returns an empty proof for a single-leaf tree', () => {
      const only = policy()
      const tree = getMerkleTree(SimpleMerkleTree, [only])
      expect(getMerkleProof(tree, only, ARGS_A)).to.deep.equal([])
    })

    it('throws for a leaf that is not in the tree', () => {
      const tree = getMerkleTree(SimpleMerkleTree, [policy()])
      expect(() => getMerkleProof(tree, policy({ target: OTHER_TARGET }), ARGS_A)).to.throw()
    })
  })

  describe('normalizeDefaultValues', () => {
    it('pads to the expected length with nulls', () => {
      expect(normalizeDefaultValues(['0x1'], 3)).to.deep.equal(['0x1', null, null])
    })

    it('truncates values beyond the expected length', () => {
      // A stored default per input that no longer exists would otherwise shift every later input.
      expect(normalizeDefaultValues(['0x1', '0x2', '0x3'], 2)).to.deep.equal(['0x1', '0x2'])
    })

    it('handles undefined defaults and a zero length', () => {
      expect(normalizeDefaultValues(undefined, 2)).to.deep.equal([null, null])
      expect(normalizeDefaultValues(['0x1'], 0)).to.deep.equal([])
    })

    it('preserves falsy-but-real values', () => {
      expect(normalizeDefaultValues([0, ''], 2)).to.deep.equal([0, ''])
    })
  })
})
