import { expect } from 'chai'
import { firstValueFrom, of } from 'rxjs'
import sinon from 'sinon'
import { decodeFunctionData } from 'viem'
import { ABI } from '../abi/index.js'
import { Centrifuge } from '../Centrifuge.js'
import type { HexString } from '../types/index.js'
import { PoolId } from '../utils/types.js'
import { OnchainPM, buildPolicyUpdate, generateExecuteProof } from './OnchainPM.js'
import type { PolicyUpdateRequest } from './OnchainPM.js'
import { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'

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

  // ── Instance methods ──────────────────────────────────────────────────────
  //
  // Stubbed rather than forked: what matters is which contract each read targets and how the
  // results combine. `policy` is the root `execute` proves against, and `isAuthorized` is the
  // check a UI uses to decide whether a manager can run anything at all — a wrong target or a
  // silently-true conjunction is exactly the sort of thing that only shows up on-chain.
  describe('instance methods', () => {
    const ACCOUNTING_TOKEN = '0x5555555555555555555555555555555555555555' as HexString
    const ROOT = '0x6666666666666666666666666666666666666666666666666666666666666666' as HexString
    const poolId = PoolId.from(CENTRIFUGE_ID, 1)

    /** An OnchainPM whose chain reads are stubbed; `reads` records every readContract call. */
    function makeOnchainPM(options: { policyRoot?: HexString; isMinter?: boolean; isBsManager?: boolean } = {}) {
      const centrifuge = new Centrifuge({ environment: 'testnet' })
      const reads: any[] = []
      const client = {
        readContract: async (args: any) => {
          reads.push(args)
          if (args.functionName === 'policy') return options.policyRoot ?? ROOT
          if (args.functionName === 'minters') return options.isMinter ?? true
          throw new Error(`unexpected read: ${args.functionName}`)
        },
      }
      sinon.stub(centrifuge, 'getClient').returns(of(client) as any)
      sinon.stub(centrifuge as any, '_protocolAddresses').returns(of({ accountingToken: ACCOUNTING_TOKEN }) as any)

      const pool = new Pool(centrifuge, poolId.raw)
      sinon.stub(pool, 'isBalanceSheetManager').returns(of(options.isBsManager ?? true) as any)
      const network = new PoolNetwork(centrifuge, pool, CENTRIFUGE_ID)
      return { onchainPM: new OnchainPM(centrifuge, network, ONCHAIN_PM), reads }
    }

    afterEach(() => sinon.restore())

    describe('policy', () => {
      it('reads the strategist root off this OnchainPM', async () => {
        const { onchainPM, reads } = makeOnchainPM()
        expect(await firstValueFrom(onchainPM.policy(STRATEGIST))).to.equal(ROOT)
        expect(reads).to.have.length(1)
        expect(reads[0].address).to.equal(ONCHAIN_PM)
        expect(reads[0].functionName).to.equal('policy')
        expect(reads[0].args).to.deep.equal([STRATEGIST])
        expect(reads[0].abi).to.equal(ABI.OnchainPM)
      })

      it('surfaces bytes32(0) for a strategist with no policy', async () => {
        // Not an error state: it is how a disabled strategist reads, and callers branch on it.
        const zero = `0x${'0'.repeat(64)}` as HexString
        const { onchainPM } = makeOnchainPM({ policyRoot: zero })
        expect(await firstValueFrom(onchainPM.policy(STRATEGIST))).to.equal(zero)
      })
    })

    describe('isAuthorized', () => {
      it('requires both the balance-sheet grant and the minter right', async () => {
        const { onchainPM, reads } = makeOnchainPM({ isBsManager: true, isMinter: true })
        expect(await firstValueFrom(onchainPM.isAuthorized())).to.equal(true)
        // The minter check has to hit the accounting token, keyed by pool id and this manager.
        expect(reads[0].address).to.equal(ACCOUNTING_TOKEN)
        expect(reads[0].functionName).to.equal('minters')
        expect(reads[0].args).to.deep.equal([poolId.raw, ONCHAIN_PM])
        expect(reads[0].abi).to.equal(ABI.AccountingToken)
      })

      it('is false when either half is missing', async () => {
        // A partial grant is the state this method exists to expose — reporting it as authorized
        // would send a manager into a workflow that reverts halfway.
        const noMint = makeOnchainPM({ isBsManager: true, isMinter: false })
        expect(await firstValueFrom(noMint.onchainPM.isAuthorized())).to.equal(false)
        sinon.restore()
        const noGrant = makeOnchainPM({ isBsManager: false, isMinter: true })
        expect(await firstValueFrom(noGrant.onchainPM.isAuthorized())).to.equal(false)
      })
    })

    it('does not share cached reads between two OnchainPMs for the same pool and chain', async () => {
      // The base cache key includes the address. Without it, a second instance — a factory redeploy,
      // or an address resolved some other way — would serve the first one's policy root.
      const centrifuge = new Centrifuge({ environment: 'testnet' })
      const roots: Record<string, HexString> = {
        [ONCHAIN_PM.toLowerCase()]: ROOT,
        '0x7777777777777777777777777777777777777777': `0x${'7'.repeat(64)}` as HexString,
      }
      const client = {
        readContract: async (args: any) => roots[(args.address as string).toLowerCase()],
      }
      sinon.stub(centrifuge, 'getClient').returns(of(client) as any)
      const pool = new Pool(centrifuge, poolId.raw)
      const network = new PoolNetwork(centrifuge, pool, CENTRIFUGE_ID)

      const first = new OnchainPM(centrifuge, network, ONCHAIN_PM)
      const second = new OnchainPM(centrifuge, network, '0x7777777777777777777777777777777777777777')
      expect(await firstValueFrom(first.policy(STRATEGIST))).to.equal(ROOT)
      expect(await firstValueFrom(second.policy(STRATEGIST))).to.equal(`0x${'7'.repeat(64)}`)
    })

    it('lower-cases the address it was constructed with', () => {
      const centrifuge = new Centrifuge({ environment: 'testnet' })
      const pool = new Pool(centrifuge, poolId.raw)
      const network = new PoolNetwork(centrifuge, pool, CENTRIFUGE_ID)
      const mixedCase = '0xAbCdEf0123456789AbCdEf0123456789AbCdEf01' as HexString
      expect(new OnchainPM(centrifuge, network, mixedCase).address).to.equal(mixedCase.toLowerCase())
    })
  })
})
