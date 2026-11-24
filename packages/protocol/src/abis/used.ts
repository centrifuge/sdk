import type { Abi } from "viem";
import { ABI_SET_V3_2, ALL_ABIS_V3_2, INSTANCE_ABI_SET_V3_2 } from "./v3_2";
import { ABI_SET_V3_3, ALL_ABIS_V3_3, INSTANCE_ABI_SET_V3_3 } from "./v3_3";

// The address book package's sets carry every ABI its layers publish; these are the ones this
// package signs, reads or decodes with, matched by identity.
export const USED_ABIS_V3_2: ReadonlySet<Abi> = new Set([
  ...ALL_ABIS_V3_2,
  ...Object.values(ABI_SET_V3_2),
  ...Object.values(INSTANCE_ABI_SET_V3_2),
]);

export const USED_ABIS_V3_3: ReadonlySet<Abi> = new Set([
  ...ALL_ABIS_V3_3,
  ...Object.values(ABI_SET_V3_3),
  ...Object.values(INSTANCE_ABI_SET_V3_3),
]);

/** The names in `abis` whose ABI is in `used`, sorted. */
export function usedAbiNames(
  abis: Readonly<Record<string, Abi>>,
  used: ReadonlySet<Abi>,
): string[] {
  return Object.entries(abis)
    .filter(([, abi]) => used.has(abi))
    .map(([name]) => name)
    .sort();
}
