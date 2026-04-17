import { concat, encodeAbiParameters, encodePacked, keccak256 } from 'viem'
import type { HexString } from '../types/index.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Pre/post execution hook committed to alongside the script. */
export interface Callback {
  /** Expected script hash for the callback, from a nested computeScriptHash() call. */
  hash: HexString
  /** Expected msg.sender when executeCallback() is invoked. */
  caller: HexString
}

// ---------------------------------------------------------------------------
// computeScriptHash
// ---------------------------------------------------------------------------

/**
 * Offline reimplementation of `OnchainPM.computeScriptHash()`.
 *
 * Avoids a live RPC call so scripts can be built and hashed without a running
 * node. Matches the on-chain `pure` function exactly:
 *
 * ```solidity
 * keccak256(abi.encodePacked(
 *   keccak256(abi.encodePacked(commands)),
 *   _hashBitmapSlots(state, stateBitmap),
 *   stateBitmap,      // uint128 — 16 bytes packed
 *   state.length,     // uint256 — 32 bytes packed
 *   keccak256(abi.encode(callbacks))
 * ))
 * ```
 *
 * **Key property**: state slots whose bitmap bit is 0 (runtime) are excluded
 * from the hash. Runtime values can therefore change at execution time without
 * invalidating the Merkle proof.
 *
 * Pass `callbacks = []` for standard (non-callback) workflows.
 */
export function computeScriptHash(
  commands: HexString[],
  state: HexString[],
  stateBitmap: bigint,
  callbacks: Callback[]
): HexString {
  // 1. keccak256(abi.encodePacked(commands))
  //    Each command is bytes32; packed = raw concatenation, no length prefix.
  const commandsHash = keccak256(commands.length > 0 ? concat(commands) : '0x')

  // 2. _hashBitmapSlots(state, stateBitmap)
  //    Only pinned slots (bitmap bit = 1) contribute to this hash.
  const bitmapSlotsHash = hashBitmapSlots(state, stateBitmap)

  // 3. keccak256(abi.encode(callbacks))
  //    abi.encode of an empty Callback[] is a well-defined 64-byte constant.
  const callbacksHash = keccak256(
    encodeAbiParameters(
      [
        {
          type: 'tuple[]',
          components: [
            { name: 'hash', type: 'bytes32' },
            { name: 'caller', type: 'address' },
          ],
        },
      ],
      [callbacks.map((c) => ({ hash: c.hash, caller: c.caller }))]
    )
  )

  // Final: keccak256(abi.encodePacked(commandsHash, bitmapSlotsHash, stateBitmap, state.length, callbacksHash))
  return keccak256(
    encodePacked(
      ['bytes32', 'bytes32', 'uint128', 'uint256', 'bytes32'],
      [commandsHash, bitmapSlotsHash, stateBitmap, BigInt(state.length), callbacksHash]
    )
  ) as HexString
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Replicates `OnchainPM._hashBitmapSlots`.
 *
 * For each state[i] where bit i is set in stateBitmap:
 *   1. Hash state[i] individually with keccak256
 * Then hash the resulting array of hashes with keccak256(abi.encodePacked(hashes)).
 */
function hashBitmapSlots(state: HexString[], stateBitmap: bigint): HexString {
  const pinnedHashes: HexString[] = []
  for (const [i, slot] of state.entries()) {
    if ((stateBitmap >> BigInt(i)) & 1n) {
      pinnedHashes.push(keccak256(slot))
    }
  }
  return keccak256(pinnedHashes.length > 0 ? concat(pinnedHashes) : '0x')
}
