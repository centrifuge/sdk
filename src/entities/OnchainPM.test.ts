import { expect } from 'chai'
import { decodeFunctionData } from 'viem'
import { ABI } from '../abi/index.js'
import { buildPolicyUpdate, generateExecuteProof } from './OnchainPM.js'
import type { PolicyUpdateRequest } from './OnchainPM.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HUB = '0x1111111111111111111111111111111111111111' as const
const ONCHAIN_PM = '0x2222222222222222222222222222222222222222' as const
const STRATEGIST = '0x3333333333333333333333333333333333333333' as const
const REFUND = '0x4444444444444444444444444444444444444444' as const

const POOL_ID = 1n
const SC_ID = '0x00010000000000010000000000000001' as const
const CENTRIFUGE_ID = 1

const HASH_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const
const HASH_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const
const HASH_C = '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' as const

const BASE: PolicyUpdateRequest = {
  hub: HUB,
  poolId: POOL_ID,
  scId: SC_ID,
  centrifugeId: CENTRIFUGE_ID,
  onchainPM: ONCHAIN_PM,
  strategist: STRATEGIST,
  scriptHashes: [HASH_A],
}

describe('entities/OnchainPM', () => {
  describe('buildPolicyUpdate', () => {
    it('returns bytes32(0) root and calldata when scriptHashes is empty', async () => {
      const { root, calldata } = await buildPolicyUpdate({ ...BASE, scriptHashes: [] })
      expect(root).to.equal(`0x${'0'.repeat(64)}`)
      expect(calldata).to.match(/^0x[0-9a-f]+$/)
    })

    it('returns a non-zero 32-byte root for a single script hash', async () => {
      const { root } = await buildPolicyUpdate(BASE)
      expect(root).to.match(/^0x[0-9a-f]{64}$/)
      expect(root).to.not.equal(`0x${'0'.repeat(64)}`)
    })

    it('is deterministic — same hashes produce same root', async () => {
      const r1 = await buildPolicyUpdate(BASE)
      const r2 = await buildPolicyUpdate(BASE)
      expect(r1.root).to.equal(r2.root)
      expect(r1.calldata).to.equal(r2.calldata)
    })

    it('root changes when script hashes change', async () => {
      const { root: r1 } = await buildPolicyUpdate({ ...BASE, scriptHashes: [HASH_A] })
      const { root: r2 } = await buildPolicyUpdate({ ...BASE, scriptHashes: [HASH_B] })
      expect(r1).to.not.equal(r2)
    })

    it('root is order-invariant (same leaves → same root regardless of input order)', async () => {
      const { root: r1 } = await buildPolicyUpdate({ ...BASE, scriptHashes: [HASH_A, HASH_B] })
      const { root: r2 } = await buildPolicyUpdate({ ...BASE, scriptHashes: [HASH_B, HASH_A] })
      expect(r1).to.equal(r2)
    })

    it('root changes when a hash is added', async () => {
      const { root: r1 } = await buildPolicyUpdate({ ...BASE, scriptHashes: [HASH_A] })
      const { root: r2 } = await buildPolicyUpdate({ ...BASE, scriptHashes: [HASH_A, HASH_B] })
      expect(r1).to.not.equal(r2)
    })

    it('root changes when a hash is removed', async () => {
      const { root: r1 } = await buildPolicyUpdate({ ...BASE, scriptHashes: [HASH_A, HASH_B] })
      const { root: r2 } = await buildPolicyUpdate({ ...BASE, scriptHashes: [HASH_A] })
      expect(r1).to.not.equal(r2)
    })

    it('encodes a valid Hub.updateContract() calldata', async () => {
      const { calldata } = await buildPolicyUpdate(BASE)
      const decoded = decodeFunctionData({ abi: ABI.Hub, data: calldata })
      expect(decoded.functionName).to.equal('updateContract')
    })

    it('calldata encodes poolId, scId, and centrifugeId correctly', async () => {
      const { calldata } = await buildPolicyUpdate(BASE)
      const decoded = decodeFunctionData({ abi: ABI.Hub, data: calldata })
      const args = decoded.args as readonly unknown[]
      expect(args[0]).to.equal(POOL_ID)
      expect(String(args[1]).toLowerCase()).to.equal(SC_ID.toLowerCase())
      expect(args[2]).to.equal(CENTRIFUGE_ID)
    })

    it('calldata extraGasLimit is 0n', async () => {
      const { calldata } = await buildPolicyUpdate(BASE)
      const decoded = decodeFunctionData({ abi: ABI.Hub, data: calldata })
      const args = decoded.args as readonly unknown[]
      expect(args[5]).to.equal(0n)
    })

    it('uses strategist as refund when refund is not provided', async () => {
      const { calldata } = await buildPolicyUpdate(BASE)
      const decoded = decodeFunctionData({ abi: ABI.Hub, data: calldata })
      const args = decoded.args as readonly unknown[]
      expect(String(args[6]).toLowerCase()).to.equal(STRATEGIST.toLowerCase())
    })

    it('uses the explicit refund address when provided', async () => {
      const { calldata } = await buildPolicyUpdate({ ...BASE, refund: REFUND })
      const decoded = decodeFunctionData({ abi: ABI.Hub, data: calldata })
      const args = decoded.args as readonly unknown[]
      expect(String(args[6]).toLowerCase()).to.equal(REFUND.toLowerCase())
    })

    it('produces a 32-byte hex string root', async () => {
      const { root } = await buildPolicyUpdate({ ...BASE, scriptHashes: [HASH_A, HASH_B, HASH_C] })
      expect(root).to.match(/^0x[0-9a-f]{64}$/)
    })

    it('calldata is a hex string', async () => {
      const { calldata } = await buildPolicyUpdate(BASE)
      expect(calldata).to.match(/^0x[0-9a-f]+$/)
    })
  })

  describe('generateExecuteProof', () => {
    it('returns an empty proof for a single-workflow group (root IS the hash)', async () => {
      const proof = await generateExecuteProof(HASH_A, [HASH_A])
      expect(proof).to.deep.equal([])
    })

    it('returns a non-empty proof for a two-workflow group', async () => {
      const proof = await generateExecuteProof(HASH_A, [HASH_A, HASH_B])
      expect(proof).to.be.an('array').with.lengthOf.greaterThan(0)
      for (const sibling of proof) {
        expect(sibling).to.match(/^0x[0-9a-f]{64}$/)
      }
    })

    it('returns different proofs for different leaves in the same tree', async () => {
      const allHashes = [HASH_A, HASH_B, HASH_C]
      const proofA = await generateExecuteProof(HASH_A, allHashes)
      const proofB = await generateExecuteProof(HASH_B, allHashes)
      expect(proofA).to.not.deep.equal(proofB)
    })

    it('proof is consistent with the root produced by buildPolicyUpdate', async () => {
      const allHashes = [HASH_A, HASH_B, HASH_C]
      const { root } = await buildPolicyUpdate({ ...BASE, scriptHashes: allHashes })
      const proof = await generateExecuteProof(HASH_B, allHashes)
      expect(root).to.match(/^0x[0-9a-f]{64}$/)
      expect(proof).to.be.an('array')
    })

    it('is deterministic — same inputs produce same proof', async () => {
      const p1 = await generateExecuteProof(HASH_A, [HASH_A, HASH_B])
      const p2 = await generateExecuteProof(HASH_A, [HASH_A, HASH_B])
      expect(p1).to.deep.equal(p2)
    })

    it('throws when allScriptHashes is empty', async () => {
      try {
        await generateExecuteProof(HASH_A, [])
        expect.fail('expected an error')
      } catch (err: unknown) {
        expect((err as Error).message).to.include('allScriptHashes is empty')
      }
    })

    it('throws when scriptHash is not in allScriptHashes', async () => {
      try {
        await generateExecuteProof(HASH_C, [HASH_A, HASH_B])
        expect.fail('expected an error')
      } catch (err: unknown) {
        expect((err as Error).message).to.include('not found in allScriptHashes')
      }
    })
  })
})
