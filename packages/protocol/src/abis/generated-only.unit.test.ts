import { describe, expect, it } from "vitest";
import type { Abi } from "viem";
import type { AbiSet } from "../types";
import { BATCH_ABIS } from "../builders/batch";
import { STANDARD_ABIS } from "./index";
import {
  ABI_SET_V3_2,
  ABIS_V3_2,
  ALL_ABIS_V3_2,
  GENERATED_ABIS_V3_2,
  INSTANCE_ABI_SET_V3_2,
} from "./v3_2";
import {
  ABI_SET_V3_3,
  ABIS_V3_3,
  ALL_ABIS_V3_3,
  GENERATED_ABIS_V3_3,
  INSTANCE_ABI_SET_V3_3,
  VAULT_FACTORY_ABI_V3_3,
} from "./v3_3";
import { GENERATED_ABIS_V33_MIGRATION } from "@centrifuge/addressbook/abis";

const GENERATED: ReadonlySet<unknown> = new Set([
  ...Object.values(GENERATED_ABIS_V3_2),
  ...Object.values(GENERATED_ABIS_V3_3),
  ...Object.values(GENERATED_ABIS_V33_MIGRATION),
]);

/**
 * The only hand-written ABIs, matched by identity: ERC-20, ERC-6909 and
 * Multicall3 are not protocol contracts, and the registry publishes no ABI for
 * them. Any other ABI comes from `GENERATED_ABIS_*`, so the address book's
 * per-address digests can be compared with it.
 */
const STANDARD: ReadonlySet<unknown> = new Set(Object.values(STANDARD_ABIS));

function handWrittenEntries(
  name: string,
  entries: Readonly<Record<string, Abi | readonly unknown[]>>,
): string[] {
  return Object.entries(entries)
    .filter(([, abi]) => !GENERATED.has(abi) && !STANDARD.has(abi))
    .map(([key]) => `${name}.${key}`);
}

describe("protocol ABIs", () => {
  it.each([
    ["ABIS_V3_2", ABIS_V3_2],
    ["ABIS_V3_3", ABIS_V3_3],
    ["ABI_SET_V3_2", ABI_SET_V3_2],
    ["ABI_SET_V3_3", ABI_SET_V3_3],
    ["INSTANCE_ABI_SET_V3_2", INSTANCE_ABI_SET_V3_2],
    ["INSTANCE_ABI_SET_V3_3", INSTANCE_ABI_SET_V3_3],
    ["ALL_ABIS_V3_2", { ...ALL_ABIS_V3_2 }],
    ["ALL_ABIS_V3_3", { ...ALL_ABIS_V3_3 }],
    ["BATCH_ABIS", BATCH_ABIS],
  ] as [string, AbiSet][])(
    "%s holds only generated ABIs and the standard interfaces",
    (name, set) => {
      expect(handWrittenEntries(name, set)).toEqual([]);
    },
  );

  it("reads a v3.3 vault factory through a generated ABI both factories share getVault with", () => {
    expect(GENERATED.has(VAULT_FACTORY_ABI_V3_3)).toBe(true);
    const getVault = (abi: Abi) =>
      abi.find((item) => item.type === "function" && item.name === "getVault");
    expect(getVault(GENERATED_ABIS_V3_3.SyncDepositVaultFactory)).toEqual(
      getVault(GENERATED_ABIS_V3_3.AsyncVaultFactory),
    );
  });
});
