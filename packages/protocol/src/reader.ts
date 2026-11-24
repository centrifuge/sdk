import type { Abi, Address } from "viem";
import { DEFAULT_ABI_SETS, getAbiSet } from "./abis";
import { ProtocolVersionResolutionError } from "./errors";
import { defaultDeploymentRegistry, type DeploymentRegistry } from "./registry";
import {
  centrifugeIdFromPoolId,
  type AbiSetsByVersion,
  type ChainEnvironment,
  type ProtocolVersion,
} from "./types";

/**
 * The minimal read-client contract the {@link Reader} needs — structurally
 * compatible with a viem `PublicClient`, so any viem client (or a thin stub in
 * tests) satisfies it without this package prescribing transports.
 */
export interface ContractReadClient {
  readContract(parameters: {
    address: Address;
    abi: Abi;
    functionName: string;
    args?: readonly unknown[];
  }): Promise<unknown>;
}

/**
 * Minimal contract-read surface shared by the SDK's `LocalBuild` and the
 * backend. Both transaction strategies resolve the pool's version before
 * building: `LocalBuild` resolves it through this interface, and the backend
 * private-api resolves it from its projection instead, but the contract lives
 * here so both sides share it.
 */
export interface Reader {
  /**
   * The protocol version the pool lives on. Never hard-wire a caller to one
   * address set — resolve, then build. A pool the pools catalogue entry does
   * not know yet (indexer lag after creation) resolves to the only version
   * deployed on its chain, and throws `ProtocolVersionResolutionError` while
   * several are deployed; an entry that carries no version always throws.
   */
  poolProtocolVersion(poolId: string): Promise<ProtocolVersion>;

  /**
   * The newest protocol version deployed on one chain, for pool-less flows
   * (asset registration, pool creation, spoke-side deployments): every new
   * pool is created on the newest deployed version. Throws
   * `ProtocolVersionResolutionError` when the chain has no deployment.
   */
  chainProtocolVersion(centrifugeId: number): Promise<ProtocolVersion>;

  /**
   * Advisory preflight: is `who` a registered hub manager of the pool?
   * Reads `HubRegistry.manager(poolId, who)` on the pool's home chain.
   */
  isPoolManager(
    poolId: string,
    who: Address,
    protocolVersion?: ProtocolVersion,
  ): Promise<boolean>;
}

/** Construction options for {@link createReader}. */
export interface CreateReaderOptions {
  /** Active protocol environment. */
  environment: ChainEnvironment;
  /** Read client for an EVM chain id (viem `readContract` under the hood). */
  getClient: (chainId: number) => ContractReadClient;
  /**
   * The pool's projected protocol version, as the pools catalogue entry
   * carries it (`PoolRow.protocolVersion`): `null` when the transport does
   * not project one, `undefined` when the pool is unknown.
   */
  poolVersionSource: (poolId: string) => Promise<string | null | undefined>;
  /** Deployment registry override (defaults to the default registry). */
  registry?: DeploymentRegistry;
  /** ABI sets override (defaults to the bundled per-version sets). */
  abiSets?: AbiSetsByVersion;
}

/** Numeric, segment-wise order of version tags, so `"3.10"` sorts after `"3.9"`. */
export function compareProtocolVersions(
  a: ProtocolVersion,
  b: ProtocolVersion,
): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

/**
 * Default {@link Reader} over the deployment registry and viem-style read
 * clients.
 *
 * `poolProtocolVersion` reads the version the indexer projected for the pool
 * and checks it is registered for the pool's chain; a pool without a
 * projected version, or with one the registry does not know, throws
 * {@link ProtocolVersionResolutionError} rather than defaulting. A pool the
 * entry does not list at all resolves to the chain's only deployed version
 * and throws once a second one is deployed.
 * `chainProtocolVersion` answers the newest version deployed on the chain,
 * which is where every new pool is created.
 */
export function createReader(options: CreateReaderOptions): Reader {
  const registry = options.registry ?? defaultDeploymentRegistry();
  const abiSets = options.abiSets ?? DEFAULT_ABI_SETS;

  function deployedVersions(
    centrifugeId: number,
    subject: string,
  ): readonly ProtocolVersion[] {
    const versions = registry.versionsForChain(
      options.environment,
      centrifugeId,
    );
    if (versions.length === 0) {
      throw new ProtocolVersionResolutionError(
        subject,
        `no protocol version is deployed for centrifugeId ${centrifugeId} ` +
          `on ${options.environment}`,
      );
    }
    return versions;
  }

  async function poolProtocolVersion(poolId: string): Promise<ProtocolVersion> {
    const centrifugeId = centrifugeIdFromPoolId(poolId);
    const deployed = deployedVersions(centrifugeId, `pool ${poolId}`);
    const projected = await options.poolVersionSource(poolId);

    if (projected === undefined) {
      if (deployed.length === 1) {
        return deployed[0];
      }
      throw new ProtocolVersionResolutionError(
        `pool ${poolId}`,
        "the pool is not in the pools catalogue entry and " +
          `${deployed.length} protocol versions (${deployed.join(", ")}) ` +
          `are deployed for centrifugeId ${centrifugeId} on ` +
          `${options.environment}; refusing to guess`,
      );
    }
    if (projected === null || projected === "") {
      throw new ProtocolVersionResolutionError(
        `pool ${poolId}`,
        "the pools catalogue entry carries no protocolVersion for it on this " +
          "transport; refusing to default to a registered version",
      );
    }
    if (!deployed.includes(projected)) {
      throw new ProtocolVersionResolutionError(
        `pool ${poolId}`,
        `the projected protocol version "${projected}" is not deployed for ` +
          `centrifugeId ${centrifugeId} on ${options.environment} ` +
          `(registered: ${deployed.join(", ")})`,
      );
    }
    return projected;
  }

  return {
    poolProtocolVersion,

    async chainProtocolVersion(centrifugeId) {
      const deployed = deployedVersions(
        centrifugeId,
        `centrifugeId ${centrifugeId}`,
      );
      return deployed.reduce((newest, candidate) =>
        compareProtocolVersions(candidate, newest) > 0 ? candidate : newest,
      );
    },

    async isPoolManager(poolId, who, protocolVersion) {
      const version = protocolVersion ?? (await poolProtocolVersion(poolId));
      const centrifugeId = centrifugeIdFromPoolId(poolId);
      const deployment = registry.getDeployment(
        options.environment,
        version,
        centrifugeId,
      );

      const result = await options.getClient(deployment.chainId).readContract({
        address: deployment.contracts.hubRegistry,
        abi: getAbiSet(version, abiSets).hubRegistry,
        functionName: "manager",
        args: [BigInt(poolId), who],
      });

      return result === true;
    },
  };
}
