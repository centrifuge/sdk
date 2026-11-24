import type { Address } from "viem";
import type { V33_MIGRATION_ABI_V3_3 } from "@centrifuge/addressbook/abis";

export type V33MigrationAbi = typeof V33_MIGRATION_ABI_V3_3;

export interface MigrationDeploymentInput {
  readonly chainId: number;
  readonly address: string;
  readonly deployBlock: number;
}

export interface MigrationChain {
  readonly centrifugeId: number;
  readonly chainId: number;
  readonly migration: Address;
  readonly deployBlock: number;
  readonly abi: V33MigrationAbi;
}

export interface MigrationContext extends MigrationChain {
  readonly poolId: string;
}
