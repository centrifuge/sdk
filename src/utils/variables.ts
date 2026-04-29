import type { HexString } from '../types/index.js'
import type { PoolMetadata } from '../types/poolMetadata.js'
import type { PoolContext } from './weiroll.js'

// ---------------------------------------------------------------------------
// Magic variable keys
// ---------------------------------------------------------------------------

/**
 * All well-known magic variable keys. Each is prefixed with `$` to
 * distinguish them from protocol-specific manifest variables.
 *
 * Magic variables are resolved automatically by the SDK from pool metadata;
 * they are always pinned (stateBitmap bit = 1).
 */
export const MAGIC_VARIABLE_KEYS = [
  '$executor',
  '$poolEscrow',
  '$onOffRamp',
  '$poolId',
  '$scId',
  '$accountingTokenId',
  '$accountingTokenAssetId',
] as const

export type MagicVariableKey = (typeof MAGIC_VARIABLE_KEYS)[number]

// ---------------------------------------------------------------------------
// MagicVariableContext
// ---------------------------------------------------------------------------

/**
 * Typed inputs required to resolve the SDK's magic variables.
 *
 * All values must be ABI-encoded as 32-byte hex strings so they can be
 * stored directly in the weiroll state array (bytes32 slots).
 *
 * Typical encoding per variable:
 * - addresses (`$executor`, `$poolEscrow`, `$onOffRamp`): left-zero-padded to 32 bytes
 * - `$poolId`: uint64 value encoded as uint256 (32 bytes)
 * - `$scId`: bytes16 value right-zero-padded to 32 bytes
 * - `$accountingTokenId`, `$accountingTokenAssetId`: uint256 (32 bytes)
 */
export interface MagicVariableContext {
  /** Address of the strategist / executor for this pool. */
  executor: HexString
  /** Address of the pool escrow contract. */
  poolEscrow: HexString
  /** Address of the on/off ramp manager for the share class. */
  onOffRamp: HexString
  /** Pool ID (uint64) ABI-encoded as a 32-byte value. */
  poolId: HexString
  /** Share class ID (bytes16) right-zero-padded to 32 bytes. */
  scId: HexString
  /** ERC6909 accounting token ID for the share class, as a 32-byte value. */
  accountingTokenId: HexString
  /** Asset ID of the accounting token, as a 32-byte value. */
  accountingTokenAssetId: HexString
}

// ---------------------------------------------------------------------------
// resolveMagicVariables
// ---------------------------------------------------------------------------

/** Matches exactly 32 bytes ABI-encoded as a 0x-prefixed hex string. */
const BYTES32_RE = /^0x[0-9a-fA-F]{64}$/

function assertBytes32(key: string, value: HexString): void {
  if (!BYTES32_RE.test(value)) {
    throw new Error(
      `resolveMagicVariables: "${key}" must be a 32-byte ABI-encoded hex string (0x + 64 hex chars), got "${value}". ` +
        `Addresses must be left-zero-padded; uint values must be right-aligned to 32 bytes.`
    )
  }
}

/**
 * Builds a `PoolContext` from a typed `MagicVariableContext` by mapping
 * each `$`-prefixed magic variable key to its resolved value.
 *
 * Pass the returned object as `poolContext` in `buildScript()`:
 *
 * ```typescript
 * const poolContext = resolveMagicVariables(ctx)
 * const script = buildScript(workflow, { poolContext, configurableValues })
 * ```
 *
 * @throws if any value is not a valid 32-byte ABI-encoded hex string
 */
export function resolveMagicVariables(context: MagicVariableContext): PoolContext {
  assertBytes32('executor', context.executor)
  assertBytes32('poolEscrow', context.poolEscrow)
  assertBytes32('onOffRamp', context.onOffRamp)
  assertBytes32('poolId', context.poolId)
  assertBytes32('scId', context.scId)
  assertBytes32('accountingTokenId', context.accountingTokenId)
  assertBytes32('accountingTokenAssetId', context.accountingTokenAssetId)

  return {
    $executor: context.executor,
    $poolEscrow: context.poolEscrow,
    $onOffRamp: context.onOffRamp,
    $poolId: context.poolId,
    $scId: context.scId,
    $accountingTokenId: context.accountingTokenId,
    $accountingTokenAssetId: context.accountingTokenAssetId,
  }
}

// ---------------------------------------------------------------------------
// resolveVariableLabel
// ---------------------------------------------------------------------------

/**
 * Returns a human-readable `{ value, label }` pair for a resolved variable.
 *
 * Used by the backend to enrich API responses so the frontend never displays
 * raw on-chain data. Example:
 *
 * ```typescript
 * resolveVariableLabel('$scId', '0x00010000000000010000000000000001', meta)
 * // → { value: '0x000100...', label: 'JTRSY' }
 * ```
 *
 * Label resolution priority:
 * 1. `poolMetadata.addressLabels[value]` — pool-manager-maintained free-form map
 * 2. Key-specific fallbacks (e.g. pool name for `$poolId`)
 * 3. Raw hex string as final fallback
 *
 * Pool managers can register labels for any address or slot value via the
 * `addressLabels` field of the pool metadata to customise what the UI shows.
 */
export function resolveVariableLabel(
  key: string,
  value: HexString,
  poolMetadata: PoolMetadata
): { value: HexString; label: string } {
  const { addressLabels } = poolMetadata

  // Normalised lookup (case-insensitive for addresses)
  const explicit =
    addressLabels?.[value] ??
    addressLabels?.[value.toLowerCase()] ??
    addressLabels?.[value.toUpperCase()]

  if (explicit !== undefined) {
    return { value, label: explicit }
  }

  // Key-specific fallbacks
  switch (key as MagicVariableKey | string) {
    case '$poolId':
      return { value, label: poolMetadata.pool.name }
    default:
      return { value, label: value }
  }
}
