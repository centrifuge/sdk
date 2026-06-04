import type { HexString } from './index.js'

// ---------------------------------------------------------------------------
// Marketplace types
//
// These types describe the workflow format published in the centrifuge/workflows
// marketplace catalog (IPFS). SDK utilities such as buildScript() accept these types.
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
  /**
   * When true, pool managers may exclude this action when adding the workflow
   * to a group. The action must have output = 0xFF (no downstream dependency).
   */
  optional?: boolean
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

/** A single input descriptor on a catalog action (human-readable form). */
export interface CatalogActionInput {
  parameter: string
  label?: string
  /** Each element is a `$variable` reference or an inline literal. Empty only with useTemplate. */
  input: string[]
  useTemplate?: {
    template: string
    map?: Record<string, string>
  }
}

/** A contract call step as represented in the IPFS catalog (human-readable form). */
export interface CatalogAction {
  target: string
  targetName?: string
  name?: string
  selector: string
  valueNonZero?: boolean
  rawMode?: boolean
  optional?: boolean
  inputs: CatalogActionInput[]
  returns?: string
}

/**
 * A runtime input declaration. The legacy form is a bare variable name; the
 * object form (centrifuge/workflows #84) additionally links an amount input to
 * its denominating `token` (for decimals/symbol) and the `source` holder address
 * whose balance bounds the max. `token`/`source` are `$`-references to declared,
 * magic, or runtime variables.
 */
export type RuntimeVariable = string | { name: string; token?: string; source?: string }

/** Normalize a {@link RuntimeVariable} to its bare-or-`$`-prefixed name. */
export function runtimeVariableName(variable: RuntimeVariable): string {
  return typeof variable === 'string' ? variable : variable.name
}

/**
 * A declared template variable (explicit-input-kinds tagged format). Every action input
 * references a `$variable` (or inline literal); the variable carries its trust `kind`:
 *  - `pinned`       — value fixed at generation time, provided per-workflow (addresses, ids)
 *  - `configurable` — value set by the hub manager at policy creation, immutable after
 *  - `param`        — bound by a caller's use.map (use-only templates; resolved away when inlined)
 *  - `runtime`      — supplied by the strategist per execution (adversarial)
 * `token`/`source` are runtime-only UI hints. Magic ($onchainPM, $poolId, …) and `returns`
 * names are implicit and not declared here.
 */
export interface CatalogVariable {
  name: string
  kind: 'pinned' | 'configurable' | 'param' | 'runtime'
  token?: string
  source?: string
}

/** A reusable action template from the marketplace catalog. */
export interface CatalogTemplate {
  actions: CatalogAction[]
  variables?: CatalogVariable[]
  id?: string
}

/**
 * A workflow entry returned by `centrifuge.workflowMarketplace()`.
 * Parsed from the IPFS catalog envelope `{ templates, workflows, ... }`.
 * Template actions are resolved and attached under `actions`.
 *
 * `useTemplate` entries (callback scripts) are filtered out automatically.
 */
export interface MarketplaceWorkflow {
  /** Stable identifier for the workflow (catalog `id` field). */
  workflowRef: string
  /** Display name shown in the UI. */
  name: string
  /** Name of the template this workflow uses (e.g. `"erc7540_account"`). */
  template: string
  /** UI grouping category (e.g. `"Centrifuge"`). */
  category?: string
  /** Logical group within the template (e.g. `"account"`). */
  group?: string
  /** EVM chain ID this workflow is deployed on. */
  chainId: number
  /** URL of the workflow icon image. */
  iconUrl?: string
  /** Pre-set contract address variables for this workflow instance. */
  variables: Record<string, string>
  /** Pre-computed keccak256 script hash for this workflow configuration. */
  workflowId: string
  /** Catalog version number. */
  version: number
  /** Deployment environment (e.g. `"testnet"`). */
  workspace?: string
  /** When present, this is a callback script — filtered out by the SDK. */
  useTemplate?: string
  /** Template registry from the source catalog, used for nested callback compilation. */
  templates?: Record<string, CatalogTemplate>
  /** Human-readable contract call steps resolved from the template. */
  actions: CatalogAction[]
  /** Runtime inputs supplied by the executor when the workflow runs (names only). */
  runtimeVariables?: string[]
  /**
   * Full runtime input declarations, preserving the optional `token`/`source`
   * links from the object form. Aligned 1:1 with `runtimeVariables` by name.
   */
  runtimeVariableEntries?: RuntimeVariable[]
}
