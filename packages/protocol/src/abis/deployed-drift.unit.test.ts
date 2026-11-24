import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CONTRACT_VERSIONS_V3_2 } from "../registry";
import type { DeployedContractVersions } from "../types";
import {
  findDeployedAbiDrift,
  registryKeyForAbi,
  type DeployedAbiDrift,
} from "./deployed-drift";
import { abiSignatures } from "./signatures";
import { USED_ABIS_V3_2 } from "./used";
import { GENERATED_ABIS_V3_2 } from "./v3_2";

const V3_1 = JSON.parse(
  readFileSync(
    resolve(__dirname, "../../registry-abis/v3_1.signatures.json"),
    "utf8",
  ),
) as {
  label: string;
  missing: string[];
  signatures: Record<string, string[]>;
};

/**
 * Every chain known to run a contract whose signatures differ from the
 * bundled v3.2 ABI, as `environment:centrifugeId:Contract`. An entry here is
 * a chain a builder of that contract must refuse.
 */
// Empty: the OracleValuation 0xCBdb6EFF… (v3.1 on Plume, Avalanche, BNB,
// HyperEVM, Monad and Pharos; published with the v3.1 ABI on Arc) is excluded
// from the address book (`manual.ts` in `packages/addressbook` of `centrifuge/api-v4`),
// so no v3.2 deployment lists it.
const KNOWN_DRIFT: readonly string[] = [];

/** Bundled ABIs of contracts the v3.2 schema lists no version for, with the reason. */
const UNVERSIONED: Readonly<Record<string, string>> = {
  ScriptHelpers:
    "a deploy helper the v3.2 schema does not list; nothing builds calls to it",
};

/** Every version label any chain records, per registry contract name. */
const RECORDED_LABELS: Readonly<Record<string, ReadonlySet<string>>> = (() => {
  const labels: Record<string, Set<string>> = {};
  for (const byChain of Object.values(CONTRACT_VERSIONS_V3_2)) {
    for (const chain of Object.values(byChain)) {
      for (const [contract, label] of Object.entries(chain)) {
        (labels[contract] ??= new Set()).add(label);
      }
    }
  }
  return labels;
})();

/**
 * Bundled ABIs whose drift is not checked, with the reason. Each runs at a
 * label with no signature snapshot, and the package reads one member of it
 * that every generation carries.
 */
const DRIFT_UNCHECKED: Readonly<Record<string, string>> = {
  Root: "runs at the v3.0 label on six mainnet chains, with no v3.0 snapshot; the package reads `endorsed(address)` alone, which every Root generation answers (checked on Ethereum and Sepolia)",
};

/** The address book package's v3.2 ABIs this package uses; only these can drift. */
const BUNDLED_V3_2 = Object.fromEntries(
  Object.entries(GENERATED_ABIS_V3_2).filter(
    ([name, abi]) => USED_ABIS_V3_2.has(abi) && !(name in DRIFT_UNCHECKED),
  ),
);

const key = (d: DeployedAbiDrift) =>
  `${d.environment}:${d.centrifugeId}:${d.contract}`;

describe("bundled v3.2 ABIs against the versions chains run", () => {
  it("drift only where listed", () => {
    const drift = findDeployedAbiDrift({
      bundled: BUNDLED_V3_2,
      bundledVersion: "v3.2",
      versions: CONTRACT_VERSIONS_V3_2,
      signatures: { [V3_1.label]: V3_1.signatures },
    });

    expect(drift.map(key).sort()).toEqual([...KNOWN_DRIFT].sort());
  });

  it("the v3.1 OracleValuation differs by the feeder re-keying plus v3.2 additions", () => {
    const [plume] = findDeployedAbiDrift({
      bundled: { OracleValuation: GENERATED_ABIS_V3_2.OracleValuation },
      bundledVersion: "v3.2",
      versions: {
        mainnet: { 4: { oracleValuation: "v3.1" } },
        testnet: {},
      },
      signatures: { [V3_1.label]: V3_1.signatures },
    });

    expect(plume?.missing).toEqual([
      "error NotAuthorized()",
      "event UpdateFeeder(uint64 indexed,uint16 indexed,bytes32 indexed,bool)",
      "function LOCAL()",
      "function contractUpdater()",
      "function feeder(uint64,uint16,bytes32)",
      "function untrustedCall(uint64,bytes16,bytes,uint16,bytes32)",
      "function updateFeeder(uint64,uint16,bytes32,bool)",
    ]);
    expect(plume?.extra).toEqual([
      "event UpdateFeeder(uint64 indexed,address indexed,bool)",
      "function feeder(uint64,address)",
      "function updateFeeder(uint64,address,bool)",
    ]);
  });

  it("an unchecked ABI still carries the one member the package reads", () => {
    expect(abiSignatures(GENERATED_ABIS_V3_2.Root)).toContain(
      "function endorsed(address)",
    );
  });

  it("every bundled ABI resolves to a contract the chains record a version for", () => {
    for (const contract of Object.keys(BUNDLED_V3_2)) {
      if (contract in UNVERSIONED) {
        continue;
      }
      expect(RECORDED_LABELS, contract).toHaveProperty(
        registryKeyForAbi(contract),
      );
    }
  });

  it("the v3.1 snapshot covers every bundled ABI a chain runs at another label", () => {
    const runElsewhere = Object.keys(BUNDLED_V3_2).filter((contract) =>
      [...(RECORDED_LABELS[registryKeyForAbi(contract)] ?? [])].some(
        (label) => label !== "v3.2",
      ),
    );

    expect(V3_1.missing.filter((c) => runElsewhere.includes(c))).toEqual([]);
    expect(Object.keys(V3_1.signatures)).toEqual(
      expect.arrayContaining(runElsewhere),
    );
  });
});

describe("findDeployedAbiDrift", () => {
  const bundled = { OracleValuation: GENERATED_ABIS_V3_2.OracleValuation };
  const versions = (label: string): DeployedContractVersions => ({
    mainnet: { 1: { oracleValuation: "v3.2" }, 7: { oracleValuation: label } },
    testnet: {},
  });

  it("reports an unlisted chain running a different signature", () => {
    const drift = findDeployedAbiDrift({
      bundled,
      bundledVersion: "v3.2",
      versions: versions("v3.1"),
      signatures: { "v3.1": V3_1.signatures },
    });

    expect(drift.map(key)).toEqual(["mainnet:7:OracleValuation"]);
    expect(drift[0]?.deployedVersion).toBe("v3.1");
  });

  it("passes another label whose signatures match", () => {
    const drift = findDeployedAbiDrift({
      bundled,
      bundledVersion: "v3.2",
      versions: versions("v3.2-rc"),
      signatures: {
        "v3.2-rc": {
          OracleValuation: abiSignatures(GENERATED_ABIS_V3_2.OracleValuation),
        },
      },
    });

    expect(drift).toEqual([]);
  });

  it("throws for a label with no signature snapshot", () => {
    expect(() =>
      findDeployedAbiDrift({
        bundled,
        bundledVersion: "v3.2",
        versions: versions("v3.0"),
        signatures: { "v3.1": V3_1.signatures },
      }),
    ).toThrow(
      "mainnet centrifugeId 7 runs OracleValuation v3.0, which has no signature snapshot",
    );
  });
});

describe("abiSignatures", () => {
  it("canonicalises tuples and marks indexed event inputs", () => {
    expect(
      abiSignatures([
        {
          type: "function",
          name: "f",
          stateMutability: "nonpayable",
          inputs: [
            {
              name: "t",
              type: "tuple[]",
              components: [
                { name: "a", type: "uint8" },
                { name: "b", type: "bytes32[]" },
              ],
            },
          ],
          outputs: [{ name: "", type: "uint256" }],
        },
        {
          type: "event",
          name: "E",
          anonymous: false,
          inputs: [
            { name: "a", type: "uint64", indexed: true },
            { name: "b", type: "bool", indexed: false },
          ],
        },
        { type: "error", name: "X", inputs: [] },
        { type: "constructor", stateMutability: "nonpayable", inputs: [] },
      ]),
    ).toEqual([
      "error X()",
      "event E(uint64 indexed,bool)",
      "function f((uint8,bytes32[])[])",
    ]);
  });
});
