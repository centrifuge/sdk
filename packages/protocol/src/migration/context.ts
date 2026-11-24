import { getAddress } from "viem";
import { V33_MIGRATION_ABI_V3_3 } from "@centrifuge/addressbook/abis";
import { parseUint64 } from "../builders/money";
import { UnknownDeploymentError } from "../errors";
import { centrifugeIdFromPoolId, type ChainEnvironment } from "../types";
import { MIGRATION_ABI_KEY } from "./constants";
import { V33_MIGRATION_DEPLOYMENTS } from "./deployments";
import type {
  MigrationChain,
  MigrationContext,
  MigrationDeploymentInput,
} from "./types";

export type MigrationDeployments = Readonly<
  Record<ChainEnvironment, Readonly<Record<number, MigrationDeploymentInput>>>
>;

export interface ResolveMigrationChainOptions {
  environment: ChainEnvironment;
  deployments?: MigrationDeployments;
}

export interface ResolveMigrationContextOptions extends ResolveMigrationChainOptions {
  centrifugeId?: number;
}

export function resolveMigrationChain(
  centrifugeId: number,
  options: ResolveMigrationChainOptions,
): MigrationChain {
  const deployments = options.deployments ?? V33_MIGRATION_DEPLOYMENTS;
  const deployment = deployments[options.environment]?.[centrifugeId];
  if (!deployment) {
    throw new UnknownDeploymentError(
      options.environment,
      MIGRATION_ABI_KEY,
      centrifugeId,
    );
  }
  return {
    centrifugeId,
    chainId: deployment.chainId,
    migration: getAddress(deployment.address),
    deployBlock: deployment.deployBlock,
    abi: V33_MIGRATION_ABI_V3_3,
  };
}

export function resolveMigrationContext(
  poolId: string,
  options: ResolveMigrationContextOptions,
): MigrationContext {
  parseUint64(poolId, "resolveMigrationContext.poolId");
  const centrifugeId = options.centrifugeId ?? centrifugeIdFromPoolId(poolId);
  return { poolId, ...resolveMigrationChain(centrifugeId, options) };
}

export function listMigrationChains(
  environment: ChainEnvironment,
  deployments: MigrationDeployments = V33_MIGRATION_DEPLOYMENTS,
): readonly MigrationChain[] {
  return Object.keys(deployments[environment] ?? {})
    .map(Number)
    .sort((a, b) => a - b)
    .map((centrifugeId) =>
      resolveMigrationChain(centrifugeId, { environment, deployments }),
    );
}
