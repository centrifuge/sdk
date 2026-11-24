import {
  ABI_SOURCE_V3_2,
  ABI_SOURCE_V3_3,
  ABI_SOURCE_V33_MIGRATION,
  GENERATED_ABIS_V3_2,
  GENERATED_ABIS_V3_3,
  GENERATED_ABIS_V33_MIGRATION,
} from "@centrifuge/addressbook/abis";
import type { Abi } from "viem";
import { describe, expect, it } from "vitest";
import { USED_ABIS_V3_2, USED_ABIS_V3_3, usedAbiNames } from "./used";

/** The ABIs of `abis` this package uses that the package folded from below the set's range. */
function usedBelowRange(
  abis: Readonly<Record<string, Abi>>,
  belowRange: readonly string[],
  used: ReadonlySet<Abi>,
): string[] {
  return usedAbiNames(abis, used).filter((name) => belowRange.includes(name));
}

// A contract taken from a layer older than its version range signs with an ABI that release
// never published; each one this package uses is reviewed and listed here.
describe("address book ABI sets", () => {
  it.each([
    [
      "v3_2",
      usedBelowRange(
        GENERATED_ABIS_V3_2,
        ABI_SOURCE_V3_2.belowRange,
        USED_ABIS_V3_2,
      ),
      ["MerkleProofManager", "MerkleProofManagerFactory"],
    ],
    [
      "v3_3",
      usedBelowRange(
        GENERATED_ABIS_V3_3,
        ABI_SOURCE_V3_3.belowRange,
        USED_ABIS_V3_3,
      ),
      [],
    ],
    [
      "v33_migration",
      usedBelowRange(
        GENERATED_ABIS_V33_MIGRATION,
        ABI_SOURCE_V33_MIGRATION.belowRange,
        new Set(Object.values(GENERATED_ABIS_V33_MIGRATION)),
      ),
      [],
    ],
  ])(
    "%s uses only the reviewed contracts from below its range",
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
