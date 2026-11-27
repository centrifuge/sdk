import { addressBook } from "@centrifuge/addressbook";
import {
  ABI_SOURCE_V3_2,
  ABI_SOURCE_V3_3,
  ABI_SOURCE_V33_MIGRATION,
  GENERATED_ABIS_V3_2,
  GENERATED_ABIS_V3_3,
  GENERATED_ABIS_V33_MIGRATION,
} from "@centrifuge/addressbook/abis";
import type { Abi, Hex } from "viem";
import { describe, expect, it } from "vitest";
import { USED_ABIS_V3_2, USED_ABIS_V3_3, usedAbiNames } from "./used";

/** The ABI names the book's records carry in `source`'s stack, on every chain of its network. */
function abiNamesCarriedByStack(source: {
  network: "mainnet" | "testnet";
  stackLabel: string;
}): Set<string> {
  const { chains } = addressBook.networks[source.network];
  const names = Object.values(chains).flatMap((chain) =>
    Object.values(chain.stacks[source.stackLabel] ?? {}).map(
      (address) => chain.addresses[address.toLowerCase() as Hex]?.abi?.name,
    ),
  );
  return new Set(names.filter((name) => name !== undefined));
}

/** The ABIs of `abis` this package uses that no record of the set's stack carries. */
function usedWithoutRecord(
  abis: Readonly<Record<string, Abi>>,
  source: { network: "mainnet" | "testnet"; stackLabel: string },
  used: ReadonlySet<Abi>,
): string[] {
  const carried = abiNamesCarriedByStack(source);
  return usedAbiNames(abis, used).filter((name) => !carried.has(name));
}

// A contract no record names is taken from a layer by its name, so no digest in the book checks
// it against what the chain runs; each one this package uses is reviewed and listed here.
describe("address book ABI sets", () => {
  it.each([
    [
      "v3_2",
      usedWithoutRecord(GENERATED_ABIS_V3_2, ABI_SOURCE_V3_2, USED_ABIS_V3_2),
      [
        "AsyncVault",
        "MerkleProofManager",
        "OnOffRamp",
        "OnchainPM",
        "PoolEscrow",
      ],
    ],
    [
      "v3_3",
      usedWithoutRecord(GENERATED_ABIS_V3_3, ABI_SOURCE_V3_3, USED_ABIS_V3_3),
      ["AsyncVault", "Escrow", "OnOffRamp", "OnchainPM"],
    ],
    [
      "v33_migration",
      usedWithoutRecord(
        GENERATED_ABIS_V33_MIGRATION,
        ABI_SOURCE_V33_MIGRATION,
        new Set(Object.values(GENERATED_ABIS_V33_MIGRATION)),
      ),
      [],
    ],
  ])(
    "%s uses only the reviewed ABIs that no record of its stack carries",
    (_set, actual, expected) => {
      expect(actual).toEqual(expected);
    },
  );

  // The review above matches by identity, so a set borrowing the other version's object would
  // escape it.
  it("takes no protocol ABI of one version into the other version's sets", () => {
    expect(usedAbiNames(GENERATED_ABIS_V3_2, USED_ABIS_V3_3)).toEqual([]);
    expect(usedAbiNames(GENERATED_ABIS_V3_3, USED_ABIS_V3_2)).toEqual([]);
  });
});
