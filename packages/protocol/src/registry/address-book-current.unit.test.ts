import { addressBook, currentAddresses } from "@centrifuge/addressbook";
import { getAddress } from "viem";
import { describe, expect, it } from "vitest";
import { compareProtocolVersions } from "../reader";
import {
  PROTOCOL_VERSION_V3_2,
  PROTOCOL_VERSION_V3_3,
  type ChainEnvironment,
} from "../types";
import {
  createDeploymentRegistry,
  DEFAULT_CONTRACT_SCHEMAS,
  defaultDeploymentRegistry,
  type DeploymentRegistry,
} from "./index";
import { STACK_LABEL_V3_2 } from "./v3_2";

const DOC = "docs/architecture/protocol-deployment-addresses.md";

/**
 * The addresses the registry serves on a chain: its newest served version.
 * Older versions on a chain (testnet v3.2) are covered by the difference
 * test, not by this one.
 */
function servedAddresses(
  registry: DeploymentRegistry,
  environment: ChainEnvironment,
  centrifugeId: number,
) {
  const version = registry
    .versionsForChain(environment, centrifugeId)
    .reduce<string | undefined>(
      (newest, candidate) =>
        newest === undefined || compareProtocolVersions(candidate, newest) > 0
          ? candidate
          : newest,
      undefined,
    );
  if (version === undefined) {
    return undefined;
  }
  const schema = DEFAULT_CONTRACT_SCHEMAS[version]!;
  return {
    version,
    names: new Set([...schema.required, ...schema.optional]),
    contracts: registry.getDeployment(environment, version, centrifugeId)
      .contracts,
  };
}

/** Names whose served address differs from `current`, as `name: served != current`. */
function divergences(
  served: NonNullable<ReturnType<typeof servedAddresses>>,
  current: Readonly<Record<string, string>>,
) {
  const expected = Object.fromEntries(
    Object.entries(current).filter(([name]) => served.names.has(name)),
  );
  const names = new Set([
    ...Object.keys(expected),
    ...Object.keys(served.contracts),
  ]);
  return [...names]
    .filter((name) => served.contracts[name] !== expected[name])
    .sort()
    .map((name) => `${name}: ${served.contracts[name]} != ${expected[name]}`);
}

describe("registry addresses against the book's current addresses", () => {
  const chains = (["mainnet", "testnet"] as const).flatMap((environment) =>
    Object.keys(addressBook.networks[environment].chains).map(
      (id) => [environment, Number(id)] as const,
    ),
  );

  it.each(chains)(
    "%s %i: the schema names of the newest served version equal the book's current addresses",
    (environment, centrifugeId) => {
      const served = servedAddresses(
        defaultDeploymentRegistry(),
        environment,
        centrifugeId,
      );
      expect(
        served,
        `${environment} ${centrifugeId}: the book lists this chain and the registry serves no version of it; see ${DOC}`,
      ).toBeDefined();

      expect(
        divergences(served!, currentAddresses(environment, centrifugeId)),
        `${environment} ${centrifugeId}: the registry reads stacks, the book's manual entries change only current addresses; decide which is right, see ${DOC}`,
      ).toEqual([]);
    },
  );

  /** Chains serving v3.2 below v3.3, so the test above does not see the served v3.2 set. */
  const servingV32BelowV33 = chains.filter(([environment, centrifugeId]) =>
    [PROTOCOL_VERSION_V3_2, PROTOCOL_VERSION_V3_3].every((version) =>
      defaultDeploymentRegistry()
        .versionsForChain(environment, centrifugeId)
        .includes(version),
    ),
  );

  it("finds chains on both networks that serve v3.2 below v3.3", () => {
    expect(
      new Set(servingV32BelowV33.map(([environment]) => environment)),
    ).toEqual(new Set(["mainnet", "testnet"]));
  });

  it.each(servingV32BelowV33)(
    "%s %i: the served v3.2 addresses equal the book's v3.2.0 stack",
    (environment, centrifugeId) => {
      const schema = DEFAULT_CONTRACT_SCHEMAS[PROTOCOL_VERSION_V3_2]!;
      const served = {
        version: PROTOCOL_VERSION_V3_2,
        names: new Set([...schema.required, ...schema.optional]),
        contracts: defaultDeploymentRegistry().getDeployment(
          environment,
          PROTOCOL_VERSION_V3_2,
          centrifugeId,
        ).contracts,
      };
      const stack =
        addressBook.networks[environment].chains[String(centrifugeId)]!.stacks[
          STACK_LABEL_V3_2
        ]!;
      const book = Object.fromEntries(
        Object.entries(stack).map(([name, address]) => [
          name,
          getAddress(address),
        ]),
      );

      expect(
        divergences(served, book),
        `${environment} ${centrifugeId}: the registry serves other v3.2 addresses than the book's v3.2.0 stack; see ${DOC}`,
      ).toEqual([]);
    },
  );

  it("serves no version of a chain a registry has no data for", () => {
    const empty = createDeploymentRegistry({ mainnet: {}, testnet: {} });

    expect(servedAddresses(empty, "mainnet", 1)).toBeUndefined();
  });

  it("reports an address that differs from the current one", () => {
    const served = servedAddresses(defaultDeploymentRegistry(), "testnet", 1)!;
    const current = {
      ...currentAddresses("testnet", 1),
      hub: "0x0000000000000000000000000000000000000001",
    };

    expect(divergences(served, current)).toEqual([
      `hub: ${served.contracts.hub} != 0x0000000000000000000000000000000000000001`,
    ]);
  });

  it("reports a name that is current but not served", () => {
    const served = servedAddresses(defaultDeploymentRegistry(), "testnet", 1)!;
    const { hub: _dropped, ...contracts } = served.contracts;

    expect(
      divergences({ ...served, contracts }, currentAddresses("testnet", 1)),
    ).toEqual([`hub: undefined != ${served.contracts.hub}`]);
  });
});
