import { DEFAULT_ABI_SETS, getAbiSet } from "./abis";
import { defaultDeploymentRegistry, type DeploymentRegistry } from "./registry";
import {
  centrifugeIdFromPoolId,
  type AbiSetsByVersion,
  type ChainEnvironment,
  type ProtocolContext,
  type ProtocolVersion,
} from "./types";

/** Sources `resolveProtocolContext` resolves against. All default to the bundled sets. */
export interface ResolveProtocolContextOptions {
  /** Active protocol environment (mirrors the consumer's `CHAIN_ENVIRONMENT`). */
  environment: ChainEnvironment;
  /** Deployment registry override (defaults to the default registry). */
  registry?: DeploymentRegistry;
  /** ABI sets override (defaults to the bundled per-version sets). */
  abiSets?: AbiSetsByVersion;
  /**
   * Resolve against this chain instead of the pool's home (hub) chain.
   *
   * For spoke-side operations: `BalanceSheet.deposit/withdraw` and the
   * per-share-class on/off-ramp managers live on the network the assets are
   * held on, which is not where the pool's Hub is. The pool id still travels
   * on the context (the calldata carries it), so a builder can and does still
   * cross-check its `poolId` argument — only the chain the address set is
   * taken from changes.
   *
   * Omitted for every hub-side operation, which is the default and the common
   * case. Deliberately explicit rather than derived: nothing in a pool id says
   * which spoke an operation targets, so a caller that needs one must name it.
   */
  centrifugeId?: number;
}

/**
 * Resolve everything a builder needs for one pool operation: the target chain
 * (the pool's home chain from the `centrifugeId` encoded in the pool id, or
 * `options.centrifugeId` for a spoke-side operation), the version's verified
 * address set, and the version's ABI set.
 *
 * Resolved once per operation; every builder takes the resolved
 * {@link ProtocolContext}, never a chainId (restructure constraints, rule 1).
 * The caller supplies `protocolVersion` — from the backend's pool projection,
 * or via the `Reader` for local builds (rule 4) — this helper never guesses.
 *
 * Throws `UnknownProtocolVersionError` / `UnknownDeploymentError` when the
 * version or chain is not registered.
 */
export function resolveProtocolContext(
  poolId: string,
  protocolVersion: ProtocolVersion,
  options: ResolveProtocolContextOptions,
): ProtocolContext {
  const registry = options.registry ?? defaultDeploymentRegistry();
  const abiSets = options.abiSets ?? DEFAULT_ABI_SETS;

  const centrifugeId = options.centrifugeId ?? centrifugeIdFromPoolId(poolId);
  const deployment = registry.getDeployment(
    options.environment,
    protocolVersion,
    centrifugeId,
  );

  return {
    poolId,
    protocolVersion,
    centrifugeId,
    chainId: deployment.chainId,
    addresses: deployment.contracts,
    abis: getAbiSet(protocolVersion, abiSets),
  };
}
