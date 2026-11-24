import type { Abi, Address } from "viem";
import type { MessageManifest } from "./messages";

/**
 * Protocol environment. Mainnet and testnet reuse the same `centrifugeId`s for
 * *different* chains (e.g. centrifugeId 2 is Base mainnet `8453` AND Base
 * Sepolia `84532`), and contract addresses differ per environment, so every
 * registry lookup is environment-scoped.
 */
export type ChainEnvironment = "mainnet" | "testnet";

/**
 * A protocol version tag, e.g. `"3.2"`. Deliberately an open string, not a
 * closed union: adding a protocol version must require touching only
 * `registry/` (one address set) and `abis/` (one ABI set) — never a type that
 * every consumer imports (restructure constraints, rule 1).
 */
export type ProtocolVersion = string;

/** The currently deployed protocol version. */
export const PROTOCOL_VERSION_V3_2: ProtocolVersion = "3.2";

/** The next protocol version: published for testnet, not yet wired into the default registry. */
export const PROTOCOL_VERSION_V3_3: ProtocolVersion = "3.3";

/**
 * Contract addresses for one deployment, keyed by contract name (`hub`,
 * `hubRegistry`, ...). The key set is version-defined: a deployment must carry
 * exactly one address per contract in its version's {@link AbiSet} — validated
 * fail-loud at load (see `DeploymentVerificationError`).
 */
export type AddressSet = Readonly<Record<string, Address>>;

/** Parsed contract ABIs for one protocol version, keyed by contract name. */
export type AbiSet = Readonly<Record<string, Abi>>;

/** ABI sets keyed by protocol version (restructure constraints, rule 1). */
export type AbiSetsByVersion = Readonly<Record<ProtocolVersion, AbiSet>>;

/**
 * The contract-name schema one protocol version's address sets are validated
 * against. `required` contracts must be present on every chain; `optional`
 * ones may be absent (chain-specific adapters, environment-specific escrows).
 * Any field outside `required ∪ optional` is rejected fail-loud — never
 * dropped (restructure constraints, rule 8).
 */
export interface ContractSchema {
  readonly required: readonly string[];
  readonly optional: readonly string[];
}

/** Contract schemas keyed by protocol version. */
export type ContractSchemasByVersion = Readonly<
  Record<ProtocolVersion, ContractSchema>
>;

/** A single chain's verified deployment of one protocol version. */
export interface Deployment {
  /** EVM chain id. */
  readonly chainId: number;
  /** Human-readable chain name (for logs and display). */
  readonly name: string;
  /** Verified contract addresses, keyed by contract name. */
  readonly contracts: AddressSet;
}

/**
 * Raw (unverified) deployment entry as the registry data holds it: read from
 * the address book's stacks, or supplied directly to
 * `createDeploymentRegistry`. Addresses are plain strings until that function
 * validates them.
 */
export interface DeploymentInput {
  readonly chainId: number;
  readonly name: string;
  readonly contracts: Readonly<Record<string, string>>;
}

/**
 * Registry data keyed by `(chainEnvironment, protocolVersion, centrifugeId)`.
 * Deployments are never one row per chain: the natural key includes the
 * protocol version, because two protocol stacks run in parallel on every chain
 * during a migration window.
 */
export type DeploymentRegistryData = Readonly<
  Record<
    ChainEnvironment,
    Readonly<Record<ProtocolVersion, Readonly<Record<number, DeploymentInput>>>>
  >
>;

/**
 * The contract version label each chain runs (`"v3.1"`), keyed by
 * environment, `centrifugeId`, then registry contract name. One protocol
 * version's address set can mix contract versions: a chain keeps a contract
 * the upgrade did not redeploy.
 */
export type DeployedContractVersions = Readonly<
  Record<
    ChainEnvironment,
    Readonly<Record<number, Readonly<Record<string, string>>>>
  >
>;

/**
 * Everything a builder needs to encode a call for one pool, resolved once per
 * operation by `resolveProtocolContext`. Builders take a resolved context,
 * never a chainId alone (restructure constraints, rule 1).
 *
 * `chainId` is carried alongside the spec-defined fields so consumers can map
 * a built call onto a transport envelope (`RawTx.chainId`) without
 * re-resolving the deployment.
 *
 * `centrifugeId` is the chain this context RESOLVED TO, which is the pool's
 * home chain for a hub-side operation and the target spoke for a spoke-side one
 * (`resolveProtocolContext`'s `centrifugeId` option — BalanceSheet and the
 * on/off-ramp managers are not on the hub). Read it from here rather than
 * deriving it from `poolId` via {@link centrifugeIdFromPoolId}: the two agree
 * only for hub-side operations, and using the derived value for a spoke deposit
 * would label the transaction with the wrong network.
 */
export interface ProtocolContext {
  /** Raw pool id (uint64 decimal string). */
  readonly poolId: string;
  /** The protocol version this pool lives on. */
  readonly protocolVersion: ProtocolVersion;
  /** Centrifuge id of the chain this context resolved to. */
  readonly centrifugeId: number;
  /** EVM chain id of the chain this context resolved to. */
  readonly chainId: number;
  /** Verified contract addresses for `(environment, version, centrifugeId)`. */
  readonly addresses: AddressSet;
  /** Parsed ABIs for `protocolVersion`. */
  readonly abis: AbiSet;
}

/** One inner call of a built protocol operation. */
export interface ProtocolCall {
  readonly to: Address;
  readonly data: `0x${string}`;
  readonly value: bigint;
  /** Human-readable label (e.g. `"Hub.setPoolMetadata"`) for decode surfaces. */
  readonly label?: string;
}

/**
 * The result of a pure protocol builder: `(ctx, args) -> { to, data, value,
 * calls?, messages? }`. Batching (multicall) is a builder concern; `calls`
 * describes the decoded inner operations and maps onto
 * `RawTx.metadata.innerCalls`.
 */
export interface BuiltProtocolCall {
  readonly to: Address;
  readonly data: `0x${string}`;
  /**
   * Value this package can compute PURELY, which for every current builder is
   * zero: the only value a pool action attaches is the crosschain gas payment,
   * and that needs a chain read. Declare {@link messages} instead — the caller
   * prices the manifest and adds the fee on top of this.
   */
  readonly value: bigint;
  readonly calls?: readonly ProtocolCall[];
  /**
   * The cross-chain messages this call dispatches, keyed by destination
   * `centrifugeId` — absent or empty when it dispatches none.
   *
   * This is the pure half of the crosschain fee: which messages go where is a
   * function of the builder's arguments and belongs next to the
   * calldata that causes them, while what they COST is a chain read and belongs
   * in `private-api`. Mirrors the SDK's `wrapTransaction({ messages })` shape,
   * so both paths sum the same per-destination estimates.
   *
   * An absent manifest and an empty one mean the same thing and are both
   * correct answers — `updatePoolManagers` and `Hub.updateSharePrice` are
   * `payable` in the ABI yet dispatch nothing, so their zero value is right
   * rather than a placeholder.
   */
  readonly messages?: MessageManifest;
}

/**
 * The `centrifugeId` encoded in the high 16 bits of a raw pool id (uint64).
 * Mirrors the SDK's `PoolId.centrifugeId` getter (`id >> 48n`).
 *
 * Note: `centrifugeId` alone is environment-agnostic; the same id maps to
 * different chains per environment, so resolution always needs the active
 * environment too.
 */
export function centrifugeIdFromPoolId(rawPoolId: string | bigint): number {
  return Number(BigInt(rawPoolId) >> 48n);
}

/**
 * The raw pool id encoded in the high 64 bits of a share class id (bytes16),
 * as a decimal string. Mirrors the SDK's `ShareClassId.poolId` getter.
 *
 * This exists so a write path can answer "does this share class belong to the
 * pool the caller is authorized for?" structurally, without a projection round
 * trip — and therefore without depending on the projection being complete.
 * `packages/queries` restates the same shift in `src/rest/routes.ts` because it
 * cannot import this package; an SDK unit test cross-checks that copy against
 * `ShareClassId.poolId` itself.
 *
 * Throws on anything that is not a bytes16 hex string rather than returning a
 * plausible id: a silently wrong pool id here would defeat a tenancy check.
 */
export function poolIdFromShareClassId(shareClassId: string): string {
  if (!/^0x[0-9a-fA-F]{32}$/.test(shareClassId)) {
    throw new Error(
      `Cannot derive a pool id from "${shareClassId}": a share class id is a ` +
        `bytes16 hex string (0x + 32 hex digits).`,
    );
  }

  return (BigInt(shareClassId) >> 64n).toString();
}
