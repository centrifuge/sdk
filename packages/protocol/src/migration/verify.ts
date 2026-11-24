import type { AddressBook } from "@centrifuge/addressbook";
import type { Abi } from "viem";
import {
  ABI_SOURCE_V33_MIGRATION,
  GENERATED_ABIS_V33_MIGRATION,
} from "@centrifuge/addressbook/abis";
import { compareBookAbis, type BookAbiComparison } from "../abis/verify";
import { MIGRATION_ABI_KEY, MIGRATION_FACADE_KEY } from "./constants";

/**
 * Compares the bundled `V33Migration` facade ABI with the book's digest for
 * the `v33Migration` address of every chain's v3.3.0 stack. Counts and
 * mismatches are keyed by `MIGRATION_ABI_KEY`.
 */
export function compareMigrationAbi(
  book: AddressBook,
  abis: Readonly<Record<string, Abi>> = GENERATED_ABIS_V33_MIGRATION,
): BookAbiComparison {
  const facade = abis["V33Migration"];
  return compareBookAbis(book, {
    [MIGRATION_ABI_KEY]: {
      abis,
      source: ABI_SOURCE_V33_MIGRATION,
      signing: facade ? { [MIGRATION_FACADE_KEY]: facade } : {},
    },
  });
}
