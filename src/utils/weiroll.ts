import { encodeAbiParameters, keccak256 } from 'viem'
import type { HexString } from '../types/index.js'

// ---------------------------------------------------------------------------
// Call type flags (lower 2 bits of the flags byte)
// ---------------------------------------------------------------------------

/** State-changing call. */
export const CALL = 0x01 as const
/** Read-only call. */
export const STATICCALL = 0x02 as const
/** ETH-value call — ETH amount is taken from state[0]. */
export const VALUECALL = 0x03 as const

/** Raw calldata mode — set in the flags byte to bypass ABI encoding. */
export const FLAG_RAW = 0x20 as const

/** Sentinel value for unused input slots or a discarded return value. */
export const UNUSED_SLOT = 0xff as const

/** Maximum number of state slots (stateBitmap is uint128). */
const MAX_STATE_SLOTS = 128

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WeirollCallType = typeof CALL | typeof STATICCALL | typeof VALUECALL

/** A single step in a weiroll script. */
export interface WeirollAction {
  /** 20-byte target contract address. */
  target: HexString
  /** 4-byte function selector (e.g. `0x12345678`). */
  selector: HexString
  callType: WeirollCallType
  /**
   * Up to 6 state-slot indices for the call's inputs.
   * Automatically padded with UNUSED_SLOT (0xFF) to length 6.
   */
  inputs: number[]
  /** State slot to write the return value into, or UNUSED_SLOT to discard. */
  output: number
  /** When true, sets FLAG_RAW — use for manually ABI-encoded calldata. */
  rawMode?: boolean
}

/**
 * Describes the initial value of a single state slot.
 *
 * - `literal`      — fixed ABI-encoded value, pinned at whitelist time
 * - `magic`        — resolved from PoolContext by key
 * - `configurable` — resolved from configurableValues by key
 * - `runtime`      — placeholder filled at execution time (not pinned)
 */
export type WorkflowStateSlot =
  | { type: 'literal'; value: HexString }
  | { type: 'magic'; key: string }
  | { type: 'configurable'; key: string }
  | { type: 'runtime'; key: string }

/** The full description of a workflow: its actions and initial state layout. */
export interface WorkflowDefinition {
  /** Stable identifier for the workflow (matches the catalog ref). */
  workflowRef: string
  actions: WeirollAction[]
  state: WorkflowStateSlot[]
}

/**
 * Protocol-level values available for magic variable resolution.
 * All values must already be ABI-encoded (e.g. uint256 as a 32-byte hex).
 */
export type PoolContext = Record<string, HexString>

export interface ScriptResult {
  /** ABI-encoded bytes32 command words, one per action. */
  commands: HexString[]
  /** ABI-encoded slot values. Runtime slots are empty (`0x`). */
  state: HexString[]
  /**
   * uint128 where bit i = 1 means state[i] is pinned (known at whitelist time).
   * Bit i = 0 means runtime — the executor fills the slot at call time.
   */
  stateBitmap: bigint
}

// ---------------------------------------------------------------------------
// encodeCommand
// ---------------------------------------------------------------------------

/**
 * Packs a single weiroll command into a 32-byte word.
 *
 * Bit layout (from MSB):
 * ```
 * bits [255:224]  selector  (bytes4)  — function selector
 * bits [223:216]  flags     (uint8)   — callType | FLAG_RAW
 * bits [215:168]  inputs    (bytes6)  — 6 × 1-byte slot indices, MSB first
 * bits [167:160]  output    (uint8)   — slot index or UNUSED_SLOT
 * bits [159:0]    target    (address) — 20-byte contract address
 * ```
 *
 * Equivalent Solidity expression:
 * ```solidity
 * (uint256(uint32(selector)) << 224) | (flags << 216) | (indices << 168) | (output << 160) | uint160(target)
 * ```
 */
export function encodeCommand(
  selector: HexString, // 4 bytes
  flags: number, // 1 byte: callType | optional FLAG_RAW
  inputs: number[], // up to 6 slot indices (padded to 6 with UNUSED_SLOT)
  output: number, // slot index or UNUSED_SLOT
  target: HexString // 20-byte address
): HexString {
  if (inputs.length > 6) {
    throw new Error(`encodeCommand: inputs length ${inputs.length} exceeds maximum of 6`)
  }

  // Pad to exactly 6 input indices
  const paddedInputs = inputs.slice()
  while (paddedInputs.length < 6) {
    paddedInputs.push(UNUSED_SLOT)
  }

  // selector as uint32 (top 4 bytes)
  const sel = BigInt(selector)

  // flags as uint8
  const f = BigInt(flags & 0xff)

  // Pack 6 input indices into a uint48, MSB = inputs[0]
  let indicesBig = 0n
  for (const idx of paddedInputs) {
    indicesBig = (indicesBig << 8n) | BigInt((idx ?? UNUSED_SLOT) & 0xff)
  }

  // output as uint8
  const out = BigInt(output & 0xff)

  // target as uint160
  const addr = BigInt(target)

  const word = (sel << 224n) | (f << 216n) | (indicesBig << 168n) | (out << 160n) | addr

  return `0x${word.toString(16).padStart(64, '0')}` as HexString
}

// ---------------------------------------------------------------------------
// buildScript
// ---------------------------------------------------------------------------

/**
 * Builds the weiroll commands array and initial state from a workflow
 * definition, resolving magic variables and configurable values.
 *
 * State slots classified as `literal`, `magic`, or `configurable` are pinned:
 * their bit in `stateBitmap` is set to 1 and the resolved value is placed in
 * `state[i]`. Slots classified as `runtime` are left empty (`0x`) with their
 * bit set to 0 — the executor fills them at call time.
 *
 * @throws if a magic variable key is absent from `poolContext`
 * @throws if a configurable key is absent from `configurableValues`
 * @throws if the workflow has more than 128 state slots
 */
export function buildScript(
  workflow: WorkflowDefinition,
  context: {
    poolContext: PoolContext
    configurableValues: Record<string, HexString>
  }
): ScriptResult {
  const { poolContext, configurableValues } = context

  if (workflow.state.length > MAX_STATE_SLOTS) {
    throw new Error(
      `buildScript: workflow "${workflow.workflowRef}" has ${workflow.state.length} state slots — maximum is ${MAX_STATE_SLOTS}`
    )
  }

  const state: HexString[] = []
  let stateBitmap = 0n

  for (let i = 0; i < workflow.state.length; i++) {
    const slot = workflow.state[i]!

    if (slot.type === 'literal') {
      state.push(slot.value)
      stateBitmap |= 1n << BigInt(i)
    } else if (slot.type === 'magic') {
      const value = poolContext[slot.key]
      if (value === undefined) {
        throw new Error(`buildScript: magic variable "${slot.key}" not found in pool context`)
      }
      state.push(value)
      stateBitmap |= 1n << BigInt(i)
    } else if (slot.type === 'configurable') {
      const value = configurableValues[slot.key]
      if (value === undefined) {
        throw new Error(`buildScript: configurable value "${slot.key}" not provided`)
      }
      state.push(value)
      stateBitmap |= 1n << BigInt(i)
    } else {
      // runtime — placeholder, bit stays 0
      state.push('0x' as HexString)
    }
  }

  const commands = workflow.actions.map((action) => {
    const flags = action.callType | (action.rawMode ? FLAG_RAW : 0)
    return encodeCommand(action.selector, flags, action.inputs, action.output, action.target)
  })

  return { commands, state, stateBitmap }
}

// ---------------------------------------------------------------------------
// computeScriptHash
// ---------------------------------------------------------------------------

/**
 * Hashes the fully-resolved script into a stable `bytes32` identifier.
 *
 * The hash covers all inputs that define the script's behaviour:
 * commands, state, stateBitmap, and optional hooks.
 *
 * ```solidity
 * keccak256(abi.encode(commands, state, stateBitmap, hooks))
 * ```
 *
 * @param commands  - bytes32[] of packed command words
 * @param state     - bytes[] of ABI-encoded slot values
 * @param stateBitmap - uint128 pin bitmap
 * @param hooks     - bytes32[] of optional hook identifiers (pass [] if unused)
 */
export function computeScriptHash(
  commands: HexString[],
  state: HexString[],
  stateBitmap: bigint,
  hooks: HexString[] = []
): HexString {
  const encoded = encodeAbiParameters(
    [
      { type: 'bytes32[]', name: 'commands' },
      { type: 'bytes[]', name: 'state' },
      { type: 'uint128', name: 'stateBitmap' },
      { type: 'bytes32[]', name: 'hooks' },
    ],
    [commands, state, stateBitmap, hooks]
  )
  return keccak256(encoded) as HexString
}
