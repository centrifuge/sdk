import { decodeEventLog, type Hex } from "viem";
import { V33_MIGRATION_ABI_V3_3 } from "@centrifuge/addressbook/abis";

export interface MigrationLog {
  readonly topics: readonly Hex[];
  readonly data: Hex;
}

export function decodeMigrationEvent(log: MigrationLog) {
  return decodeEventLog({
    abi: V33_MIGRATION_ABI_V3_3,
    topics: log.topics as [Hex, ...Hex[]],
    data: log.data,
  });
}

export type DecodedMigrationEvent = ReturnType<typeof decodeMigrationEvent>;
