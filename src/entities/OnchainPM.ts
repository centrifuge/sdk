import type { SimpleMerkleTree } from '@openzeppelin/merkle-tree'
import { encodeFunctionData, toHex } from 'viem'
import { ABI } from '../abi/index.js'
import type { HexString } from '../types/index.js'
import { addressToBytes32, encode } from '../utils/index.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PolicyUpdateRequest {
  /** Hub contract address for the target chain. */
  hub: HexString
  /** Pool ID (uint64). */
  poolId: bigint
  /** Share class ID (bytes16). */
  scId: HexString
  /** Chain centrifuge ID (uint16). */
  centrifugeId: number
  /** OnchainPM contract address to update. */
  onchainPM: HexString
  /** Strategist Safe multisig address. */
  strategist: HexString
  /**
   * Script hashes — one per whitelisted workflow, computed via
   * `computeScriptHash(commands, state, stateBitmap, [])`.
   *
   * Pass an empty array to disable the strategist (sets root to `bytes32(0)`).
   */
  scriptHashes: HexString[]
  /**
   * Address that receives the cross-chain gas refund.
   * Defaults to `strategist` when omitted.
   */
  refund?: HexString
}

export interface PolicyUpdateResult {
  /** New Merkle root. `bytes32(0)` means the strategist is disabled. */
  root: HexString
  /**
   * ABI-encoded `Hub.updateContract()` calldata.
   * Set this as the `data` field of a transaction sent to `hub`.
   */
  calldata: HexString
}

// ---------------------------------------------------------------------------
// buildPolicyUpdate
// ---------------------------------------------------------------------------

/**
 * Builds an unsigned `Hub.updateContract()` call to update an OnchainPM
 * strategist's policy root.
 *
 * The Merkle root is computed over `scriptHashes` using `SimpleMerkleTree`
 * (order-invariant, compatible with `MerkleProofLib` on-chain). Routing:
 *
 * ```
 * Hub.updateContract()
 *   → Spoke contractUpdater.trustedCall()
 *   → OnchainPM.trustedCall()
 *   → policy[strategist] = newRoot
 * ```
 *
 * **Usage** (BE calls this whenever workflows are added to / removed from a group):
 *
 * ```typescript
 * const { root, calldata } = await buildPolicyUpdate({
 *   hub, poolId, scId, centrifugeId, onchainPM, strategist,
 *   scriptHashes: workflows.map(w => computeScriptHash(w.commands, w.state, w.stateBitmap, [])),
 * })
 * // Return calldata + hub to FE → Hub manager (Safe) signs and executes
 * ```
 */
export async function buildPolicyUpdate(req: PolicyUpdateRequest): Promise<PolicyUpdateResult> {
  const { poolId, scId, centrifugeId, onchainPM, strategist, scriptHashes, refund } = req

  // 1. Build Merkle root over script hashes.
  //    Empty set → bytes32(0) which disables the strategist entirely.
  let root: HexString
  if (scriptHashes.length === 0) {
    root = toHex(0, { size: 32 })
  } else {
    const { SimpleMerkleTree } = await loadMerkleTree()
    root = SimpleMerkleTree.of(scriptHashes).root as HexString
  }

  // 2. Payload: strategist address (right-padded, Centrifuge cross-chain encoding) + new root.
  const payload = encode([strategist, root])

  // 3. Encode Hub.updateContract() call.
  //    - target: OnchainPM address (right-padded to bytes32)
  //    - extraGasLimit: 0 (covered by Hub's default gas estimate)
  //    - refund: receives unused cross-chain gas; defaults to strategist
  const calldata = encodeFunctionData({
    abi: ABI.Hub,
    functionName: 'updateContract',
    args: [poolId, scId, centrifugeId, addressToBytes32(onchainPM), payload, 0n, refund ?? strategist],
  })

  return { root, calldata }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// Dynamic import for CJS/ESM compatibility (same pattern as MerkleProofManager).
async function loadMerkleTree(): Promise<{ SimpleMerkleTree: typeof SimpleMerkleTree }> {
  const mod = await import('@openzeppelin/merkle-tree')
  return (mod.default ?? mod) as { SimpleMerkleTree: typeof SimpleMerkleTree }
}
