import { addressBook, stackAddresses } from "@centrifuge/addressbook";
import type { AddressRecord } from "@centrifuge/addressbook";
import { V33_MIGRATION_ABI_V3_3 } from "@centrifuge/addressbook/abis";
import type { Address } from "viem";
import { parseUint64 } from "../builders/money";
import { DeploymentVerificationError, UnknownDeploymentError } from "../errors";
import { STACK_LABEL_V3_3 } from "../registry/v3_3";
import { centrifugeIdFromPoolId, type ChainEnvironment } from "../types";
import { MIGRATION_ABI_KEY, MIGRATION_FACADE_KEY } from "./constants";
import type { MigrationChain, MigrationContext } from "./types";

export interface ResolveMigrationChainOptions {
  environment: ChainEnvironment;
}

export interface ResolveMigrationContextOptions extends ResolveMigrationChainOptions {
  centrifugeId?: number;
}

function bookedFacade(
  environment: ChainEnvironment,
  centrifugeId: number,
):
  | { chainId: number; address: Address; record: AddressRecord | undefined }
  | undefined {
  const chain = addressBook.networks[environment].chains[String(centrifugeId)];
  // `stackAddresses` throws a plain Error for a chain the book lacks, and callers
  // take only `UnknownDeploymentError` to mean "no facade on this chain".
  if (!chain) {
    return undefined;
  }
  const address = stackAddresses(environment, centrifugeId, STACK_LABEL_V3_3)[
    MIGRATION_FACADE_KEY
  ];
  return address === undefined
    ? undefined
    : {
        chainId: chain.chainId,
        address,
        record: chain.addresses[address.toLowerCase() as Address],
      };
}

/**
 * The facade on `centrifugeId`: its address, the chain's EVM id and the block
 * the book records for it. Read from the bundled address book's `v3.3.0` stack,
 * never from a book a caller supplies: the migration runs on the canonical
 * deployments only.
 *
 * @throws {UnknownDeploymentError} When the book has no such chain or its
 *   `v3.3.0` stack lists no facade.
 * @throws {DeploymentVerificationError} When the book has no record of the
 *   facade, excludes it while its stack still lists it, or records no block.
 */
export function resolveMigrationChain(
  centrifugeId: number,
  options: ResolveMigrationChainOptions,
): MigrationChain {
  const { environment } = options;
  const facade = bookedFacade(environment, centrifugeId);
  if (!facade) {
    throw new UnknownDeploymentError(
      environment,
      MIGRATION_ABI_KEY,
      centrifugeId,
    );
  }
  return {
    centrifugeId,
    chainId: facade.chainId,
    migration: facade.address,
    deployBlock: recordedBlock(environment, centrifugeId, facade.record),
    abi: V33_MIGRATION_ABI_V3_3,
  };
}

function recordedBlock(
  environment: ChainEnvironment,
  centrifugeId: number,
  record: AddressRecord | undefined,
): number {
  const field = `${environment}.${centrifugeId}.${MIGRATION_FACADE_KEY}`;
  if (record === undefined) {
    throw new DeploymentVerificationError(
      field,
      "the address book has no record of the migration facade",
    );
  }
  if (record.excluded !== null) {
    throw new DeploymentVerificationError(
      field,
      `the address book excludes the migration facade (${record.excluded}) but its ${STACK_LABEL_V3_3} stack still lists it`,
    );
  }
  if (record.blockNumber === null) {
    throw new DeploymentVerificationError(
      `${field}.blockNumber`,
      "the address book records no block for the migration facade",
    );
  }
  return record.blockNumber;
}

export function resolveMigrationContext(
  poolId: string,
  options: ResolveMigrationContextOptions,
): MigrationContext {
  parseUint64(poolId, "resolveMigrationContext.poolId");
  const centrifugeId = options.centrifugeId ?? centrifugeIdFromPoolId(poolId);
  return { poolId, ...resolveMigrationChain(centrifugeId, options) };
}

/** The chains of `environment` whose book stack lists the facade, in Centrifuge id order. */
export function listMigrationChains(
  environment: ChainEnvironment,
): readonly MigrationChain[] {
  return Object.keys(addressBook.networks[environment].chains)
    .map(Number)
    .sort((a, b) => a - b)
    .filter(
      (centrifugeId) => bookedFacade(environment, centrifugeId) !== undefined,
    )
    .map((centrifugeId) =>
      resolveMigrationChain(centrifugeId, { environment }),
    );
}
