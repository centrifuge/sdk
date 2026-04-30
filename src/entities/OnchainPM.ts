import type { SimpleMerkleTree } from '@openzeppelin/merkle-tree'
import { from, switchMap } from 'rxjs'
import { encodeFunctionData, toHex } from 'viem'
import { ABI } from '../abi/index.js'
import type { Centrifuge } from '../Centrifuge.js'
import type { HexString } from '../types/index.js'
import { addressToBytes32, encode } from '../utils/index.js'
import type { Callback } from '../utils/scriptHash.js'
import { wrapTransaction } from '../utils/transaction.js'
import { Entity } from './Entity.js'
import type { PoolNetwork } from './PoolNetwork.js'

export class OnchainPM extends Entity {
  /** Deployed contract address on this chain. */
  address: HexString

  /** @internal */
  constructor(
    _root: Centrifuge,
    public network: PoolNetwork,
    address: HexString
  ) {
    super(_root, ['onchainPM', network.centrifugeId, network.pool.id.toString()])
    this.address = address.toLowerCase() as HexString
  }

  /** Current policy root for the given strategist. `bytes32(0)` means no policy is set. */
  policy(strategist: HexString) {
    return this._query(['policy', strategist.toLowerCase()], () =>
      from(this._root.getClient(this.network.centrifugeId)).pipe(
        switchMap((client) =>
          from(
            client.readContract({
              address: this.address,
              abi: ABI.OnchainPM,
              functionName: 'policy',
              args: [strategist],
            })
          )
        )
      )
    )
  }

  /**
   * Executes a whitelisted weiroll script on-chain.
   *
   * Build the arguments with:
   * - `buildScript()` → `{ commands, state, stateBitmap }`
   * - `fillRuntimeSlots()` → final `state` with runtime values filled in
   * - `generateExecuteProof()` → `proof`
   *
   * @example
   * ```typescript
   * const { commands, state: rawState, stateBitmap } = buildScript(workflow, { poolContext, configurableValues })
   * const state = fillRuntimeSlots(rawState, workflow, { amount: '0x...' })
   * const proof = await generateExecuteProof(computeScriptHash(commands, rawState, stateBitmap, []), allGroupScriptHashes)
   * await onchainPM.execute({ commands, state, stateBitmap, callbacks: [], proof })
   * ```
   */
  execute(params: { commands: HexString[]; state: HexString[]; stateBitmap: bigint; callbacks: Callback[]; proof: HexString[] }) {
    const self = this
    return this._transact(async function* (ctx) {
      yield* wrapTransaction('Execute workflow', ctx, {
        contract: self.address,
        data: encodeFunctionData({
          abi: ABI.OnchainPM,
          functionName: 'execute',
          args: [params.commands, params.state, params.stateBitmap, params.callbacks, params.proof],
        }),
      })
    }, this.network.centrifugeId)
  }

  /**
   * Submits a Hub.updateContract() transaction to update this OnchainPM's
   * policy root for a strategist. Called whenever workflows are added to or
   * removed from a group.
   *
   * Rebuilds the Merkle root from `scriptHashes` and routes the update:
   * Hub → Spoke contractUpdater → OnchainPM.trustedCall()
   *
   * Pass `scriptHashes: []` to set root to bytes32(0), which disables the strategist.
   *
   * The transaction is signed on the hub chain (pool.centrifugeId).
   */
  updatePolicy(params: { scId: HexString; strategist: HexString; scriptHashes: HexString[]; refund?: HexString }) {
    const self = this
    return this._transact(async function* (ctx) {
      const { hub } = await self._root._protocolAddresses(self.network.pool.centrifugeId)
      const { calldata } = await buildPolicyUpdate({
        hub,
        poolId: self.network.pool.id.raw,
        scId: params.scId,
        centrifugeId: self.network.centrifugeId,
        onchainPM: self.address,
        strategist: params.strategist,
        scriptHashes: params.scriptHashes,
        refund: params.refund,
      })
      yield* wrapTransaction('Update workflow policy', ctx, {
        contract: hub,
        data: calldata,
      })
    }, this.network.pool.centrifugeId)
  }
}

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

  // Normalise case before building the Merkle tree so the root is deterministic
  // regardless of whether callers pass checksummed or lowercase hashes.
  const normalizedHashes = scriptHashes.map((h) => h.toLowerCase() as HexString)

  // 1. Build Merkle root over script hashes.
  //    Empty set → bytes32(0) which disables the strategist entirely.
  let root: HexString
  if (normalizedHashes.length === 0) {
    root = toHex(0, { size: 32 })
  } else {
    const { SimpleMerkleTree } = await loadMerkleTree()
    root = SimpleMerkleTree.of(normalizedHashes).root as HexString
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

/**
 * Generates the Merkle inclusion proof required by `OnchainPM.execute()`.
 *
 * Rebuilds the same `SimpleMerkleTree` that `buildPolicyUpdate()` committed
 * on-chain and returns `tree.getProof(index)` for the given `scriptHash`.
 * Pass the result as the `proof` argument:
 *
 * ```typescript
 * const proof = await generateExecuteProof(scriptHash, allGroupScriptHashes)
 * // submit: OnchainPM.execute(commands, filledState, stateBitmap, [], proof)
 * ```
 *
 * For a group with a single workflow the proof is `[]` — the Merkle root is
 * the script hash itself, so no siblings are needed.
 *
 * @throws if `allScriptHashes` is empty (strategist has no whitelisted workflows)
 * @throws if `scriptHash` is not present in `allScriptHashes`
 */
export async function generateExecuteProof(scriptHash: HexString, allScriptHashes: HexString[]): Promise<HexString[]> {
  if (allScriptHashes.length === 0) {
    throw new Error('generateExecuteProof: allScriptHashes is empty — strategist has no whitelisted workflows')
  }

  // Normalise case so proof generation is consistent with buildPolicyUpdate(),
  // which also lowercases before building the tree.
  const normalizedHash = scriptHash.toLowerCase() as HexString
  const normalizedAll = allScriptHashes.map((h) => h.toLowerCase() as HexString)

  const index = normalizedAll.indexOf(normalizedHash)
  if (index === -1) {
    throw new Error(`generateExecuteProof: scriptHash ${scriptHash} not found in allScriptHashes`)
  }

  const { SimpleMerkleTree } = await loadMerkleTree()
  return SimpleMerkleTree.of(normalizedAll).getProof(index) as HexString[]
}

// Dynamic import for CJS/ESM compatibility (same pattern as MerkleProofManager).
async function loadMerkleTree(): Promise<{ SimpleMerkleTree: typeof SimpleMerkleTree }> {
  const mod = await import('@openzeppelin/merkle-tree')
  return (mod.default ?? mod) as { SimpleMerkleTree: typeof SimpleMerkleTree }
}
