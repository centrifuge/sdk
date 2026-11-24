import { addressBook } from "@centrifuge/addressbook";
import { describe, expect, it } from "vitest";
import { DEFAULT_ABI_SETS } from "../abis";
import { PROTOCOL_VERSION_V3_2 } from "../types";
import { stackDeployments } from "./address-book";
import { CHAIN_NAMES } from "./chain-names";
import {
  CONTRACT_SCHEMA_V3_2,
  createDeploymentRegistry,
  DEFAULT_DEPLOYMENT_DATA,
  DEFAULT_CONTRACT_SCHEMAS,
  defaultDeploymentRegistry,
  DEPLOYMENTS_V3_3,
} from "./index";

const chainIds = (deployments: Record<number, unknown>) =>
  Object.keys(deployments).map(Number);

const chainsWithStack = (
  environment: "mainnet" | "testnet",
  stackLabel: string,
) =>
  Object.entries(addressBook.networks[environment].chains)
    .filter(([, chain]) => chain.stacks[stackLabel])
    .map(([id]) => Number(id))
    .sort((a, b) => a - b);

describe("deployments read from the address book", () => {
  it("covers every chain the book lists a v3.2 stack for, named from CHAIN_NAMES", () => {
    const { mainnet, testnet } = DEFAULT_DEPLOYMENT_DATA;
    expect(chainIds(mainnet[PROTOCOL_VERSION_V3_2]!)).toEqual(
      chainsWithStack("mainnet", "v3.2.0"),
    );
    expect(chainIds(testnet[PROTOCOL_VERSION_V3_2]!)).toEqual(
      chainsWithStack("testnet", "v3.2.0"),
    );
    for (const [environment, byChain] of [
      ["mainnet", mainnet],
      ["testnet", testnet],
    ] as const) {
      for (const [id, deployment] of Object.entries(
        byChain[PROTOCOL_VERSION_V3_2]!,
      )) {
        expect(deployment.name).toBe(CHAIN_NAMES[environment][Number(id)]);
      }
    }
  });

  it("names every chain the book lists, Robinhood Chain, Linea and ADI included", () => {
    for (const environment of ["mainnet", "testnet"] as const) {
      expect(chainIds(CHAIN_NAMES[environment])).toEqual(
        chainIds(addressBook.networks[environment].chains).sort(
          (a, b) => a - b,
        ),
      );
    }
    expect(CHAIN_NAMES.mainnet[15]).toBe("robinhood-chain");
    expect(CHAIN_NAMES.mainnet[16]).toBe("linea");
    expect(CHAIN_NAMES.mainnet[17]).toBe("adi");
  });

  it("has v3.3 on testnet only", () => {
    expect(chainIds(DEPLOYMENTS_V3_3.mainnet)).toEqual([]);
    expect(chainIds(DEPLOYMENTS_V3_3.testnet)).toEqual([1, 2, 3, 9]);
    expect(Object.keys(DEFAULT_DEPLOYMENT_DATA.mainnet)).toEqual(["3.2"]);
    expect(Object.keys(DEFAULT_DEPLOYMENT_DATA.testnet)).toEqual([
      "3.2",
      "3.3",
    ]);
  });

  it("keeps the chain directory names stable across versions", () => {
    expect(defaultDeploymentRegistry().chains("testnet")).toEqual([
      { centrifugeId: 1, chainId: 11155111, name: "sepolia" },
      { centrifugeId: 2, chainId: 84532, name: "base-sepolia" },
      { centrifugeId: 3, chainId: 421614, name: "arbitrum-sepolia" },
      { centrifugeId: 9, chainId: 998, name: "hyperevm-testnet" },
    ]);
  });

  it("keeps only the names of the schema", () => {
    const schema = { required: ["hub"], optional: ["spoke"] };

    const built = stackDeployments(addressBook, "v3.2.0", schema);

    for (const byChain of Object.values(built)) {
      for (const deployment of Object.values(byChain)) {
        expect(Object.keys(deployment.contracts).sort()).toEqual([
          "hub",
          "spoke",
        ]);
      }
    }
  });

  it("builds nothing for a label no chain of the book has a stack for", () => {
    const built = stackDeployments(addressBook, "v9.9.9", CONTRACT_SCHEMA_V3_2);

    expect(built).toEqual({ mainnet: {}, testnet: {} });
  });

  it("refuses a chain the registry has no name for", () => {
    const { 9: _omitted, ...testnet } = CHAIN_NAMES.testnet;

    expect(() =>
      stackDeployments(
        addressBook,
        "v3.3.0",
        CONTRACT_SCHEMA_V3_2,
        ["mainnet", "testnet"],
        { ...CHAIN_NAMES, testnet },
      ),
    ).toThrow(/testnet\.9\.name.*CHAIN_NAMES/);
  });

  it("fails the registry build, naming the field, when the stack lacks a required name", () => {
    const schema = {
      ...CONTRACT_SCHEMA_V3_2,
      required: [...CONTRACT_SCHEMA_V3_2.required, "noSuchContract"],
    };
    const data = {
      mainnet: {
        [PROTOCOL_VERSION_V3_2]: stackDeployments(addressBook, "v3.2.0", schema)
          .mainnet,
      },
      testnet: {},
    };

    expect(() =>
      createDeploymentRegistry(data, DEFAULT_ABI_SETS, {
        ...DEFAULT_CONTRACT_SCHEMAS,
        [PROTOCOL_VERSION_V3_2]: schema,
      }),
    ).toThrow(/mainnet\.3\.2\.1\.contracts\.noSuchContract/);
  });
});
