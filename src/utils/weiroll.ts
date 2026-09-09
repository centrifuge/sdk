import { concat, decodeAbiParameters, encodeAbiParameters, parseAbiParameter } from 'viem'
import type { AbiParameter } from 'viem'
import type { HexString } from '../types/index.js'

// ---------------------------------------------------------------------------
// Call type flags (lower 2 bits of the flags byte)
// ---------------------------------------------------------------------------

/** State-changing call. */
export const CALL = 0x01 as const
/** Read-only call. */
export const STATICCALL = 0x02 as const
/** ETH-value call — ETH amount is taken from the first input specifier's state slot. */
export const VALUECALL = 0x03 as const

/** Raw calldata mode — set in the flags byte to bypass ABI encoding. */
export const FLAG_RAW = 0x20 as const
/** Extended command mode — the next command word contains up to 32 input specifiers. */
export const FLAG_EXTENDED_COMMAND = 0x40 as const

/** Sentinel value for unused input slots or a discarded return value. */
export const UNUSED_SLOT = 0xff as const
const IDX_VALUE_MASK = 0x7f as const

/** Maximum number of state slots (stateBitmap is uint128). */
export const MAX_STATE_SLOTS = 128
const MAX_COMMAND_INPUT_SPECIFIERS = 32
const EMPTY_BYTES = '0x' as HexString

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WeirollCallType = typeof CALL | typeof STATICCALL | typeof VALUECALL
export type WeirollTarget = HexString | { type: 'magic'; key: string }

/** A single step in a weiroll script. */
export interface WeirollAction {
  /** 20-byte target contract address. */
  target: WeirollTarget
  /** 4-byte function selector (e.g. `0x12345678`). */
  selector: HexString
  callType: WeirollCallType
  /**
   * Weiroll input specifiers for the call's inputs.
   * Fixed-length arguments use the state slot index directly.
   * Variable-length arguments set the high bit and store the state slot index in
   * the low 7 bits.
   */
  inputs: number[]
  /** Weiroll output specifier, or UNUSED_SLOT to discard. */
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
  | {
      type: 'configurable'
      key: string
      label?: string
      parameter?: string
      actionName?: string
      actionIndex?: number
      inputIndex?: number
      anonymous?: boolean
      system?: 'payableValue'
    }
  | {
      type: 'rawcalldata'
      selector: HexString
      parameterTypes: string[]
      sourceSlots: number[]
      actionName?: string
      actionIndex?: number
    }
  | {
      type: 'template'
      workflow: WorkflowDefinition
      label?: string
      actionName?: string
      actionIndex?: number
      inputIndex?: number
    }
  | {
      type: 'runtime'
      key: string
      label?: string
      parameter?: string
      actionName?: string
      actionIndex?: number
      inputIndex?: number
      anonymous?: boolean
      system?: 'payableValue'
    }

/** The full description of a workflow: its actions and initial state layout. */
export interface WorkflowDefinition {
  /** Stable identifier for the workflow (matches the catalog ref). */
  workflowRef: string
  actions: WeirollAction[]
  state: WorkflowStateSlot[]
  /**
   * Named runtime variables required at execution time. Copied from
   * MarketplaceWorkflow. One input per entry; the value is written into every
   * state slot whose key matches, enforcing a single value across multiple uses.
   */
  runtimeVariables?: string[]
}

/**
 * Protocol-level values available for magic variable resolution.
 * All values must already be ABI-encoded (e.g. uint256 as a 32-byte hex).
 */
export type PoolContext = Record<string, HexString>

export interface ScriptResult {
  /** ABI-encoded bytes32 command words, one per action. */
  commands: HexString[]
  /** ABI-encoded state slot values. Runtime slots are initialized to empty bytes. */
  state: HexString[]
  /**
   * uint128 where bit i = 1 means state[i] is pinned (known at whitelist time).
   * Bit i = 0 means runtime — the executor fills the slot at call time.
   */
  stateBitmap: bigint
}

/**
 * Fills runtime state slots with execution-time values.
 *
 * `buildScript()` initializes runtime slots to empty bytes. Before calling
 * `OnchainPM.execute()`, the strategist must fill each runtime slot with the
 * concrete value for this particular execution.
 *
 * Returns a copy of `state` with each runtime slot replaced by the
 * corresponding value from `runtimeValues` (keyed by the slot's `key` field).
 *
 * @throws if any required runtime variable in `workflow.runtimeVariables` has no
 * corresponding entry in `runtimeValues`
 *
 * @example
 * ```typescript
 * const { commands, state, stateBitmap } = buildScript(workflow, { poolContext, configurableValues })
 * const filledState = fillRuntimeSlots(state, workflow, { amount: '0x000...0de0b6b3a7640000' })
 * // submit OnchainPM.execute(commands, filledState, stateBitmap, [], proof)
 * ```
 */
export function fillRuntimeSlots(
  state: HexString[],
  workflow: WorkflowDefinition,
  runtimeValues: Record<string, HexString>
): HexString[] {
  if (workflow.runtimeVariables) {
    const missing = workflow.runtimeVariables.filter((key) => runtimeValues[key] === undefined)
    if (missing.length > 0) {
      throw new Error(`fillRuntimeSlots: missing runtime values for: ${missing.map((k) => `"${k}"`).join(', ')}`)
    }
  }

  // Only the declared runtime variables — plus the system slots the SDK fills itself, which
  // are deliberately kept out of runtimeVariables — may be written. Accepting any other key
  // would let a caller populate a slot the review surface never showed, which is how a
  // workflow ends up executing with values nobody approved. Runs whether or not the
  // definition declares `runtimeVariables`: a definition assembled outside
  // buildWorkflowDefinitionFromCatalog is exactly the case worth checking, and it falls back
  // to the slots that actually exist so a hand-built definition still fills its own state.
  const runtimeSlots = workflow.state.filter(
    (slot): slot is Extract<WorkflowStateSlot, { type: 'runtime' }> => slot.type === 'runtime'
  )
  const writable = new Set(workflow.runtimeVariables ?? runtimeSlots.map((slot) => slot.key))
  for (const slot of runtimeSlots) {
    if (slot.system !== undefined) writable.add(slot.key)
  }
  const unexpected = Object.keys(runtimeValues).filter((key) => !writable.has(key))
  if (unexpected.length > 0) {
    throw new Error(`fillRuntimeSlots: unexpected runtime values for: ${unexpected.map((k) => `"${k}"`).join(', ')}`)
  }

  const nextState = state.map((slot, i) => {
    const def = workflow.state[i]
    if (!def || def.type !== 'runtime') return slot

    const value = runtimeValues[def.key]
    if (value === undefined) return slot

    // A variable-length slot is copied verbatim into the calldata tail, so the VM requires
    // its length be a multiple of 32 and the caller is the one who built it — via
    // encodeVariableLengthValue, or by hand. Catching a malformed blob here names the
    // variable and its type; letting it through surfaces as a bare revert from execute()
    // with nothing to point at. Static slots are one word and viem's encoders already
    // guarantee that, so only the dynamic ones need saying.
    if (def.parameter !== undefined && isDynamicAbiType(def.parameter)) {
      const byteLength = (value.length - 2) / 2
      if (byteLength === 0 || byteLength % 32 !== 0) {
        throw new Error(
          `fillRuntimeSlots: runtime value for "${def.key}" (${def.parameter}) is ${byteLength} bytes — a variable-length slot must be a non-zero multiple of 32. Encode it with encodeVariableLengthValue().`
        )
      }
    }

    return value
  })

  for (let i = 0; i < workflow.state.length; i++) {
    const def = workflow.state[i]
    if (!def || def.type !== 'rawcalldata') continue
    nextState[i] = assembleRawCalldataSlot(nextState, workflow, def)
  }

  return nextState
}

/**
 * Whether an ABI type is dynamic — i.e. encoded as an offset into the tail rather than
 * inline in the head, and therefore passed through the VM's 0x80 variable-length specifier.
 *
 * This is the ABI's own rule, applied to the parsed type: `bytes` and `string` are dynamic;
 * an unbounded array is dynamic; a fixed-size array is dynamic iff its element is; a tuple
 * is dynamic iff any component is.
 *
 * It replaces two different string heuristics that disagreed with each other and with the
 * ABI. `catalog.ts` tested `/\[\]/` anywhere in the string and `weiroll.ts` tested
 * `endsWith('[]')`, so a dynamic tuple like Morpho Midnight's `Offer` — which contains a
 * `[]` but ends in `)` — was marked variable-length by one and skipped by the other's
 * well-formedness guard, failing at execution instead of at build time. Worse, a dynamic
 * tuple with no array member at all, `(address,bytes)`, matched neither: it was classified
 * static and encoded as a single 32-byte word where an offset and tail belong, silently
 * producing calldata for a different call than the one reviewed.
 */
export function isDynamicAbiType(parameter: string): boolean {
  let parsed: AbiParameter
  try {
    parsed = getWorkflowAbiParameter(parameter)
  } catch {
    // Unparseable types are the catalog's problem, not this predicate's; treating one as
    // static keeps the old behaviour rather than throwing from a classification helper.
    return false
  }
  return isDynamicParsedAbiType(parsed)
}

function isDynamicParsedAbiType(parameter: AbiParameter): boolean {
  const { type } = parameter

  if (type === 'bytes' || type === 'string') return true

  const array = /^(.*)\[(\d*)\]$/.exec(type)
  if (array) {
    // Unbounded: dynamic regardless of element. Fixed-size: dynamic iff the element is.
    if (array[2] === '') return true
    return isDynamicParsedAbiType({ ...parameter, type: array[1]! } as AbiParameter)
  }

  if (type === 'tuple') {
    const components = (parameter as { components?: readonly AbiParameter[] }).components ?? []
    return components.some(isDynamicParsedAbiType)
  }

  return false
}

const abiParameterCache = new Map<string, AbiParameter>()

/**
 * Resolves a catalog parameter string to a viem `AbiParameter`.
 *
 * This used to hardcode the only two tuple arrays anyone had needed, and fall through to
 * `{ type: parameter }` for everything else — which silently produced an invalid parameter
 * for any other tuple shape, since `"(address,uint256,uint256,address)[]"` is not an ABI
 * type name. `parseAbiParameter` handles the whole grammar and reproduces both former
 * hardcoded entries exactly (asserted in weiroll.test.ts), so the substitution is
 * behaviour-preserving for existing catalogs and correct for new ones.
 *
 * Cached because it is called per input per encode, and parsing is pure.
 */
export function getWorkflowAbiParameter(parameter: string): AbiParameter {
  const cached = abiParameterCache.get(parameter)
  if (cached) return cached

  let parsed: AbiParameter
  try {
    parsed = parseAbiParameter(parameter) as AbiParameter
  } catch (cause) {
    throw new Error(`getWorkflowAbiParameter: cannot parse ABI parameter "${parameter}"`, { cause })
  }
  abiParameterCache.set(parameter, parsed)
  return parsed
}

/**
 * Encodes a dynamic value into the form a variable-length (0x80) state slot must hold.
 *
 * The VM copies the slot verbatim into the calldata tail and writes a head offset pointing
 * at it, so the slot must contain the value's INNER encoding — what ABI encoding produces
 * *after* the leading offset word. `encodeAbiParameters` gives the standalone form
 * `[offset][inner]`; dropping the first 32 bytes leaves exactly `[inner]`, which is
 * position-independent and therefore relocatable to wherever the VM lands it.
 *
 * The result is always a non-zero multiple of 32 bytes, which is what the VM requires:
 * a dynamic array is `[length][elements…]`, and `bytes`/`string` are `[length][padded data]`.
 */
export function encodeVariableLengthValue(parameter: string, value: unknown): HexString {
  const standalone = encodeAbiParameters([getWorkflowAbiParameter(parameter)], [value])
  const inner = `0x${standalone.slice(66)}` as HexString

  // Belt and braces: a slot the VM rejects should fail here, where the parameter and value
  // are still in hand, rather than as an opaque revert inside execute().
  if ((inner.length - 2) % 64 !== 0) {
    throw new Error(
      `encodeVariableLengthValue: encoding of "${parameter}" is ${(inner.length - 2) / 2} bytes, not a multiple of 32`
    )
  }
  return inner
}

function decodeWorkflowValue(parameter: string, encodedValue: HexString, sourceSlot?: WorkflowStateSlot): unknown {
  if (parameter === 'bytes' && sourceSlot?.type === 'literal') {
    // Literal `bytes` slots are stored in the inner ABI form [length][padded data] (see
    // encodeLiteralValue). Recover the raw value so the rawcalldata assembler can re-encode it.
    const length = Number(BigInt(`0x${encodedValue.slice(2, 66)}`))
    return `0x${encodedValue.slice(66, 66 + length * 2)}` as HexString
  }

  if (parameter === 'bytes') {
    try {
      const [decoded] = decodeAbiParameters([getWorkflowAbiParameter(parameter)], encodedValue)
      return decoded
    } catch {
      return encodedValue
    }
  }

  const [decoded] = decodeAbiParameters([getWorkflowAbiParameter(parameter)], encodedValue)
  return decoded
}

function canAssembleRawCalldataAtBuildTime(workflow: WorkflowDefinition, sourceSlots: number[]): boolean {
  return sourceSlots.every((sourceIndex) => {
    const sourceSlot = workflow.state[sourceIndex]
    if (!sourceSlot) {
      throw new Error(`buildScript: raw calldata source slot ${sourceIndex} is out of range`)
    }
    return sourceSlot.type !== 'runtime' && sourceSlot.type !== 'rawcalldata'
  })
}

function assertRawCalldataSlotIsSupported(
  workflow: WorkflowDefinition,
  slot: Extract<WorkflowStateSlot, { type: 'rawcalldata' }>
) {
  for (const sourceIndex of slot.sourceSlots) {
    const sourceSlot = workflow.state[sourceIndex]
    if (!sourceSlot) {
      throw new Error(
        `buildScript: workflow "${workflow.workflowRef}" raw calldata source slot ${sourceIndex} is out of range`
      )
    }

    if (sourceSlot.type === 'rawcalldata') {
      throw new Error(
        `buildScript: workflow "${workflow.workflowRef}" raw calldata action ${slot.actionIndex ?? '?'} cannot depend on another raw calldata slot`
      )
    }

    if (sourceSlot.type === 'runtime' && !(workflow.runtimeVariables ?? []).includes(sourceSlot.key)) {
      throw new Error(
        `buildScript: workflow "${workflow.workflowRef}" raw calldata action ${slot.actionIndex ?? '?'} depends on computed runtime slot "${sourceSlot.key}", which cannot be assembled off-chain`
      )
    }
  }
}

function assembleRawCalldataSlot(
  state: HexString[],
  workflow: WorkflowDefinition,
  slot: Extract<WorkflowStateSlot, { type: 'rawcalldata' }>
): HexString {
  assertRawCalldataSlotIsSupported(workflow, slot)

  if (slot.sourceSlots.length !== slot.parameterTypes.length) {
    throw new Error(
      `buildScript: workflow "${workflow.workflowRef}" raw calldata action ${slot.actionIndex ?? '?'} has ${slot.sourceSlots.length} source slots for ${slot.parameterTypes.length} parameters`
    )
  }

  const decodedValues = slot.sourceSlots.map((sourceIndex, parameterIndex) => {
    const encodedValue = state[sourceIndex]
    if (encodedValue == null) {
      throw new Error(
        `buildScript: workflow "${workflow.workflowRef}" raw calldata source slot ${sourceIndex} is missing`
      )
    }

    const parameter = slot.parameterTypes[parameterIndex]!
    const sourceSlot = workflow.state[sourceIndex]
    const emptyBytesLiteral = parameter === 'bytes' && sourceSlot?.type === 'literal'

    if (encodedValue === EMPTY_BYTES && !emptyBytesLiteral) {
      const runtimeKey = sourceSlot && sourceSlot.type === 'runtime' ? sourceSlot.key : `slot ${sourceIndex}`
      throw new Error(
        `buildScript: workflow "${workflow.workflowRef}" raw calldata action ${slot.actionIndex ?? '?'} is missing value for "${runtimeKey}"`
      )
    }

    return decodeWorkflowValue(parameter, encodedValue, sourceSlot)
  })

  const encodedArgs = encodeAbiParameters(slot.parameterTypes.map(getWorkflowAbiParameter), decodedValues)
  return concat([slot.selector, encodedArgs]) as HexString
}

function encodeCallbackScript(script: ScriptResult): HexString {
  // weiroll's CommandBuilder copies state[idx] verbatim into the parent's
  // calldata at the bytes-input offset, without writing a length-prefix word.
  // For the receiver's `bytes calldata` parameter to decode correctly, the
  // state slot must already begin with the 32-byte length word — i.e. it must
  // be the abi-encoded bytes representation, not just the inner payload.
  //
  // Wrap the abi-encoded callback tuple with a length prefix so that
  //   bytes-input encoding produced by CommandBuilder = [length][tuple bytes]
  // and the receiver (FlashLoanHelper.executeOperation, or any other
  // callback dispatcher) can `abi.decode(params, ...)` directly.
  const tuple = encodeAbiParameters(
    [{ type: 'bytes32[]' }, { type: 'bytes[]' }, { type: 'uint128' }],
    [script.commands, script.state, script.stateBitmap]
  )
  const tupleBytes = (tuple.length - 2) / 2
  const lengthWord = tupleBytes.toString(16).padStart(64, '0')
  return `0x${lengthWord}${tuple.slice(2)}` as HexString
}

function buildTemplateSlot(
  workflow: WorkflowDefinition,
  slot: Extract<WorkflowStateSlot, { type: 'template' }>,
  context: {
    poolContext: PoolContext
    configurableValues: Record<string, HexString>
  }
): HexString {
  if ((slot.workflow.runtimeVariables ?? []).length > 0) {
    throw new Error(
      `buildScript: workflow "${workflow.workflowRef}" template callback "${slot.workflow.workflowRef}" has runtime variables and cannot be pinned`
    )
  }

  return encodeCallbackScript(buildScript(slot.workflow, context))
}

function decodeAddressTarget(value: HexString, key: string): HexString {
  if (/^0x[0-9a-fA-F]{40}$/.test(value)) {
    return value.toLowerCase() as HexString
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(
      `buildScript: magic target "${key}" must resolve to an address or left-padded bytes32 address, got "${value}"`
    )
  }

  const body = value.slice(2)
  const prefix = body.slice(0, 24)
  if (!/^0{24}$/i.test(prefix)) {
    throw new Error(`buildScript: magic target "${key}" is not a left-padded address: "${value}"`)
  }

  return `0x${body.slice(24).toLowerCase()}` as HexString
}

function encodeIndicesWord(inputs: number[]): HexString {
  if (inputs.length > MAX_COMMAND_INPUT_SPECIFIERS) {
    throw new Error(
      `encodeCommandWords: inputs length ${inputs.length} exceeds maximum of ${MAX_COMMAND_INPUT_SPECIFIERS}`
    )
  }

  const paddedInputs = inputs.slice()
  while (paddedInputs.length < MAX_COMMAND_INPUT_SPECIFIERS) {
    paddedInputs.push(UNUSED_SLOT)
  }

  let word = 0n
  for (const idx of paddedInputs) {
    word = (word << 8n) | BigInt(idx & 0xff)
  }

  return `0x${word.toString(16).padStart(64, '0')}` as HexString
}

function encodeCommandWords(
  selector: HexString,
  flags: number,
  inputs: number[],
  output: number,
  target: HexString
): HexString[] {
  if (inputs.length <= 6) {
    return [encodeCommand(selector, flags, inputs, output, target)]
  }

  return [encodeCommand(selector, flags | FLAG_EXTENDED_COMMAND, [], output, target), encodeIndicesWord(inputs)]
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
 * bits [215:168]  inputs    (bytes6)  — 6 × 1-byte input specifiers, MSB first
 * bits [167:160]  output    (uint8)   — output specifier or UNUSED_SLOT
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
  inputs: number[], // up to 6 weiroll input specifiers (padded to 6 with UNUSED_SLOT)
  output: number, // output specifier or UNUSED_SLOT
  target: HexString // 20-byte address
): HexString {
  if (inputs.length > 6) {
    throw new Error(`encodeCommand: inputs length ${inputs.length} exceeds maximum of 6`)
  }
  if (!/^0x[0-9a-fA-F]{8}$/.test(selector)) {
    throw new Error(`encodeCommand: selector must be a 4-byte hex string (0x + 8 hex chars), got "${selector}"`)
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(target)) {
    throw new Error(`encodeCommand: target must be a 20-byte address (0x + 40 hex chars), got "${target}"`)
  }
  for (const idx of inputs) {
    if (idx < 0 || idx > 0xff) {
      throw new Error(`encodeCommand: input specifier ${idx} out of range — must be 0–255`)
    }
  }
  if (output < 0 || output > 0xff) {
    throw new Error(`encodeCommand: output specifier ${output} out of range — must be 0–255`)
  }

  // Pad to exactly 6 input specifiers
  const paddedInputs = inputs.slice()
  while (paddedInputs.length < 6) {
    paddedInputs.push(UNUSED_SLOT)
  }

  // selector as uint32 (top 4 bytes)
  const sel = BigInt(selector)

  // flags as uint8
  const f = BigInt(flags & 0xff)

  // Pack 6 input specifiers into a uint48, MSB = inputs[0]
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
 * `state[i]`. Slots classified as `runtime` are initialized to empty bytes
 * with their bit set to 0 — the executor fills them at call time.
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
    } else if (slot.type === 'rawcalldata') {
      // A raw-calldata slot that cannot be assembled now stays unpinned, which means the caller
      // supplies the entire call — selector included — against a pinned target, with the Merkle
      // proof still valid. buildWorkflowDefinitionFromCatalog rejects runtime sources for these
      // slots; fail here too so a definition assembled by any other route cannot reach execute.
      if (!canAssembleRawCalldataAtBuildTime(workflow, slot.sourceSlots)) {
        throw new Error(
          `buildScript: workflow "${workflow.workflowRef}" raw calldata slot ${i} (action ${slot.actionIndex ?? '?'}) depends on a runtime value — the assembled calldata could not be pinned in the state bitmap`
        )
      }
      state.push(assembleRawCalldataSlot(state, workflow, slot))
      stateBitmap |= 1n << BigInt(i)
    } else if (slot.type === 'template') {
      state.push(buildTemplateSlot(workflow, slot, context))
      stateBitmap |= 1n << BigInt(i)
    } else {
      // runtime — placeholder, bit stays 0
      state.push(EMPTY_BYTES)
    }
  }

  const commands = workflow.actions.flatMap((action) => {
    const target =
      typeof action.target === 'string'
        ? action.target
        : (() => {
            const value = poolContext[action.target.key]
            if (value === undefined) {
              throw new Error(`buildScript: magic target "${action.target.key}" not found in pool context`)
            }
            return decodeAddressTarget(value, action.target.key)
          })()
    const flags = action.callType | (action.rawMode ? FLAG_RAW : 0)
    return encodeCommandWords(action.selector, flags, action.inputs, action.output, target)
  })

  return { commands, state, stateBitmap }
}
