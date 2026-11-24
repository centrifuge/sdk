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
import { STACK_LABEL_V3_3 } from "./v3_3";

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

/**
 * The addresses to hold against `current`: the newest served version, or the
 * chain's v3.3.0 stack where the registry does not serve v3.3 in that
 * environment yet (mainnet), since `current` is the book's newest stack.
 */
function comparedAddresses(
  registry: DeploymentRegistry,
  environment: ChainEnvironment,
  centrifugeId: number,
) {
  const served = servedAddresses(registry, environment, centrifugeId);
  const stack =
    addressBook.networks[environment].chains[String(centrifugeId)]?.stacks[
      STACK_LABEL_V3_3
    ];
  if (!stack || served?.version === PROTOCOL_VERSION_V3_3) {
    return served;
  }
  const schema = DEFAULT_CONTRACT_SCHEMAS[PROTOCOL_VERSION_V3_3]!;
  const names = new Set([...schema.required, ...schema.optional]);
  return {
    version: PROTOCOL_VERSION_V3_3,
    names,
    contracts: Object.fromEntries(
      Object.entries(stack)
        .filter(([name]) => names.has(name))
        .map(([name, address]) => [name, getAddress(address)]),
    ),
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
    "%s %i: the schema names of the newest served version, or of an unserved v3.3.0 stack, equal the book's current addresses",
    (environment, centrifugeId) => {
      const served = comparedAddresses(
        defaultDeploymentRegistry(),
        environment,
        centrifugeId,
      );
      expect(
        served,
        `${environment} ${centrifugeId}: the book lists this chain, the registry serves no version of it and it has no v3.3.0 stack; see ${DOC}`,
      ).toBeDefined();

      expect(
        divergences(served!, currentAddresses(environment, centrifugeId)),
        `${environment} ${centrifugeId}: the registry reads stacks, the book's manual entries change only current addresses; decide which is right, see ${DOC}`,
      ).toEqual([]);
    },
  );

  /** Chains whose `current` is an unserved v3.3.0 stack, so the test above does not see the served v3.2 set. */
  const servingV32BelowCurrent = chains.filter(
    ([environment, centrifugeId]) => {
      const served = servedAddresses(
        defaultDeploymentRegistry(),
        environment,
        centrifugeId,
      );
      return (
        served?.version === PROTOCOL_VERSION_V3_2 &&
        addressBook.networks[environment].chains[String(centrifugeId)]?.stacks[
          STACK_LABEL_V3_3
        ] !== undefined
      );
    },
  );

  it("finds the mainnet chains that serve v3.2 below a v3.3.0 current", () => {
    expect(
      servingV32BelowCurrent.map(([environment]) => environment),
    ).toContain("mainnet");
  });

  it.each(servingV32BelowCurrent)(
    "%s %i: the served v3.2 addresses equal the book's v3.2.0 stack",
    (environment, centrifugeId) => {
      const served = servedAddresses(
        defaultDeploymentRegistry(),
        environment,
        centrifugeId,
      )!;
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
