import type { HexString } from './index.js'

// ---------------------------------------------------------------------------
// Manifest types — shared between SDK utilities and the backend
//
// These types describe the workflow format stored in the DB (imported from
// the centrifuge/workflows repo). The backend returns them to the frontend
// via GET /workflows. SDK utilities such as buildScript() accept these types
// so that the backend can call them without a serialization mismatch.
// ---------------------------------------------------------------------------

/**
 * A single contract call step in the workflow.
 * Maps 1:1 to WeirollAction used by buildScript().
 */
export interface ActionDefinition {
  /** 20-byte target contract address. */
  target: HexString
  /** 4-byte function selector (e.g. `0x12345678`). */
  selector: HexString
  /** Call type: 1 = CALL, 2 = STATICCALL, 3 = VALUECALL. */
  callType: 1 | 2 | 3
  /** Up to 6 state-slot indices for the call's inputs. */
  inputs: number[]
  /** State slot to write the return value into, or 0xFF to discard. */
  output: number
  /** When true, sets FLAG_RAW — use for manually ABI-encoded calldata. */
  rawMode?: boolean
}

/**
 * Describes a single state slot in the workflow's initial state.
 *
 * - `literal`      — fixed value, pinned at whitelist time
 * - `magic`        — resolved from PoolContext by key (e.g. `poolId`, `hubAddress`)
 * - `configurable` — value supplied by the pool manager at configuration time
 * - `runtime`      — placeholder filled at execution time (not pinned in hash)
 *
 * The `configurable` flag marks inputs that pool managers can adjust (e.g.
 * slippage tolerance). It is orthogonal to `type` and present on any slot
 * that should be surfaced in configuration UIs.
 */
export interface InputDefinition {
  /** Stable identifier for this slot (referenced by key in magic/configurable/runtime slots). */
  key: string
  type: 'literal' | 'magic' | 'configurable' | 'runtime'
  /** ABI-encoded initial value. Required when type = 'literal'. */
  value?: HexString
  /** Human-readable label shown in configuration UIs. */
  label?: string
  /** Whether this input is surfaced as a user-configurable parameter. */
  configurable?: boolean
}

/**
 * A workflow manifest — the top-level document stored in the DB and
 * returned by the backend's workflow catalog endpoints.
 *
 * `useTemplate` is present on callback workflows (nested scripts committed
 * alongside the parent). The backend filters these out before returning
 * results to the frontend.
 */
export interface WorkflowManifest {
  /** Stable identifier for the workflow (matches the catalog ref). */
  workflowRef: string
  /**
   * Catalog file version — must match `SUPPORTED_CATALOG_VERSION` in the SDK.
   * `manifestToDefinition()` throws if this does not match, preventing use of
   * an unrecognised or potentially compromised catalog release.
   */
  catalogVersion: string
  /** Display name shown in the UI. */
  name: string
  /** Name of the contract template this workflow targets (e.g. `"onchain-pm"`). */
  template: string
  /** Semver version string (e.g. `"1.0.0"`). */
  version: string
  /** EVM chain ID this workflow is deployed on. */
  chainId: number
  /** Ordered list of contract calls. */
  actions: ActionDefinition[]
  /** Ordered list of state slots matching the weiroll state array. */
  inputs: InputDefinition[]
  /**
   * When present, this workflow is a callback script to be used alongside
   * the workflow identified by this ref. The backend excludes these from
   * the catalog returned to the frontend.
   */
  useTemplate?: string
}
