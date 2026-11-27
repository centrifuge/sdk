import { describe, expect, it } from "vitest";
import type { ChainEnvironment, DeploymentInput } from "../types";
import { EXPECTED_DIFFERENCES } from "./__fixtures__/address-book-differences";
import {
  PRE_ADDRESSBOOK_DEPLOYMENTS_V3_2,
  PRE_ADDRESSBOOK_DEPLOYMENTS_V3_3,
} from "./__fixtures__/pre-addressbook-deployments";
import { DEPLOYMENTS_V3_2, DEPLOYMENTS_V3_3 } from "./index";

type Deployments = Readonly<
  Record<ChainEnvironment, Readonly<Record<number, DeploymentInput>>>
>;

/** `environment version centrifugeId field` to value, for one version's data. */
function flatten(version: string, deployments: Deployments) {
  const rows = new Map<string, string>();
  for (const environment of ["mainnet", "testnet"] as const) {
    for (const [centrifugeId, deployment] of Object.entries(
      deployments[environment],
    )) {
      const key = (field: string) =>
        `${environment} ${version} ${centrifugeId} ${field}`;
      rows.set(key("chainId"), String(deployment.chainId));
      rows.set(key("chainName"), deployment.name);
      for (const [name, address] of Object.entries(deployment.contracts)) {
        rows.set(key(name), address);
      }
    }
  }
  return rows;
}

function compareRows(a: string, b: string): number {
  const [ea, va, ca, fa] = a.split(" ");
  const [eb, vb, cb, fb] = b.split(" ");
  return (
    ea!.localeCompare(eb!) ||
    va!.localeCompare(vb!) ||
    Number(ca) - Number(cb) ||
    (fa! < fb! ? -1 : fa! > fb! ? 1 : 0)
  );
}

function differences(): string[] {
  const pairs: [string, Deployments, Deployments][] = [
    ["3.2", PRE_ADDRESSBOOK_DEPLOYMENTS_V3_2, DEPLOYMENTS_V3_2],
    ["3.3", PRE_ADDRESSBOOK_DEPLOYMENTS_V3_3, DEPLOYMENTS_V3_3],
  ];
  return pairs
    .flatMap(([version, before, after]) => {
      const was = flatten(version, before);
      const now = flatten(version, after);
      return [...new Set([...was.keys(), ...now.keys()])]
        .filter((key) => was.get(key) !== now.get(key))
        .map((key) => `${key} ${was.get(key) ?? "-"} ${now.get(key) ?? "-"}`);
    })
    .sort(compareRows);
}

describe("registry addresses against the data committed before the address book", () => {
  it("differ exactly by the committed list", () => {
    expect(differences()).toEqual(EXPECTED_DIFFERENCES);
  });

  it("commits the list sorted, without duplicates", () => {
    expect([...EXPECTED_DIFFERENCES].sort(compareRows)).toEqual(
      EXPECTED_DIFFERENCES,
    );
    expect(new Set(EXPECTED_DIFFERENCES).size).toBe(
      EXPECTED_DIFFERENCES.length,
    );
  });

  it("summarises per section", () => {
    const count = (prefix: string) =>
      EXPECTED_DIFFERENCES.filter((row) => row.startsWith(prefix)).length;
    expect({
      mainnet32: count("mainnet 3.2 "),
      testnet32: count("testnet 3.2 "),
      testnet33: count("testnet 3.3 "),
      mainnet33: count("mainnet 3.3 "),
    }).toEqual({ mainnet32: 11, testnet32: 5, testnet33: 218, mainnet33: 847 });
  });
});
