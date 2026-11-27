import type { Address } from "viem";
import type { V33_MIGRATION_ABI_V3_3 } from "@centrifuge/addressbook/abis";

export type V33MigrationAbi = typeof V33_MIGRATION_ABI_V3_3;

export interface MigrationChain {
  readonly centrifugeId: number;
  readonly chainId: number;
  readonly migration: Address;
  /** The block the address book records for the facade: a lower bound for log scans, not the block of its deploy transaction. */
  readonly deployBlock: number;
  readonly abi: V33MigrationAbi;
}

export interface MigrationContext extends MigrationChain {
  readonly poolId: string;
}
