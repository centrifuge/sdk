import { addressBook, bookIdOf } from "@centrifuge/addressbook";
import type { AddressBook } from "@centrifuge/addressbook";
import { getAddress, type Hex } from "viem";
import { describe, expect, it, vi } from "vitest";
import { DeploymentVerificationError } from "../errors";
import { PROTOCOL_VERSION_V3_2, PROTOCOL_VERSION_V3_3 } from "../types";
import {
  DEFAULT_DEPLOYMENT_DATA,
  defaultDeploymentRegistry,
  deploymentDataFromAddressBook,
  deploymentRegistryFromAddressBook,
  deploymentsFromAddressBook,
  assertBookKeepsChainIds,
  unservedStacks,
} from "./index";

const NEW_HUB = "0x1111111111111111111111111111111111111111" as const;

/**
 * The baked book with one network's chain 1 hub moved in the `v3.2.0` stack,
 * recorded with the baked Hub's ABI and `bookId` recomputed, as `build-book`
 * writes it.
 */
function bookWithHub(
  network: "mainnet" | "testnet",
  hub: typeof NEW_HUB,
): AddressBook {
  const book = structuredClone(addressBook);
  const chain = book.networks[network].chains["1"]!;
  const stack = chain.stacks["v3.2.0"]!;
  chain.addresses[hub.toLowerCase() as Hex] =
    chain.addresses[stack.hub!.toLowerCase() as Hex]!;
  stack.hub = hub;
  return { ...book, bookId: bookIdOf(book) };
}

/** The baked book with every `v3.3.0` stack removed and `bookId` recomputed. */
function bookWithoutV33(): AddressBook {
  const book = structuredClone(addressBook);
  for (const network of Object.values(book.networks)) {
    for (const chain of Object.values(network.chains)) {
      delete chain.stacks["v3.3.0"];
    }
  }
  return { ...book, bookId: bookIdOf(book) };
}

describe("deploymentDataFromAddressBook", () => {
  it("reads the baked book into the default data", () => {
    expect(deploymentDataFromAddressBook(addressBook)).toEqual(
      DEFAULT_DEPLOYMENT_DATA,
    );
  });

  it("serves an address the book moved, checksummed", () => {
    const data = deploymentDataFromAddressBook(bookWithHub("testnet", NEW_HUB));

    expect(data.testnet![PROTOCOL_VERSION_V3_2]![1]!.contracts.hub).toBe(
      getAddress(NEW_HUB),
    );
    expect(data.mainnet![PROTOCOL_VERSION_V3_2]![1]!.contracts.hub).toBe(
      DEFAULT_DEPLOYMENT_DATA.mainnet![PROTOCOL_VERSION_V3_2]![1]!.contracts
        .hub,
    );
  });

  it("leaves out a version no chain of an environment has a stack for", () => {
    const data = deploymentDataFromAddressBook(bookWithoutV33());

    expect(Object.keys(data.testnet!)).toEqual([PROTOCOL_VERSION_V3_2]);
    expect(Object.keys(data.testnet!)).not.toContain(PROTOCOL_VERSION_V3_3);
  });

  it("refuses a book none of whose stacks is a served version", () => {
    const book = structuredClone(addressBook);
    for (const network of Object.values(book.networks)) {
      for (const chain of Object.values(network.chains)) {
        chain.stacks = {};
      }
    }

    expect(() => deploymentDataFromAddressBook(book)).toThrow(
      DeploymentVerificationError,
    );
  });
});

/** The baked book with the testnet v3.3.0 stack of chain 1 also on mainnet chain 1. */
function bookWithMainnetV33(): AddressBook {
  const book = structuredClone(addressBook);
  book.networks.mainnet.chains["1"]!.stacks["v3.3.0"] =
    book.networks.testnet.chains["1"]!.stacks["v3.3.0"]!;
  return book;
}

const UNNAMED_CHAIN_ID = 990_001;

/**
 * The baked book with testnet chain 1 copied under a centrifugeId `CHAIN_NAMES`
 * has no row for, and `bookId` recomputed as `build-book` writes it.
 */
function bookWithUnnamedChain(): AddressBook {
  const book = structuredClone(addressBook);
  book.networks.testnet.chains["99"] = {
    ...structuredClone(book.networks.testnet.chains["1"]!),
    chainId: UNNAMED_CHAIN_ID,
  };
  return { ...book, bookId: bookIdOf(book) };
}

describe("a chain without a CHAIN_NAMES row", () => {
  it("is named after its EVM chain id in a loaded book, with one warning", () => {
    const warn = vi.fn();

    const { registry } = deploymentsFromAddressBook(bookWithUnnamedChain(), {
      warn,
    });

    expect(
      registry.getDeployment("testnet", PROTOCOL_VERSION_V3_2, 99).name,
    ).toBe(`chain-${UNNAMED_CHAIN_ID}`);
    const chainWarnings = warn.mock.calls
      .map(([message]) => String(message))
      .filter((message) => message.includes("CHAIN_NAMES"));
    expect(chainWarnings).toHaveLength(1);
    expect(chainWarnings[0]).toMatch(
      new RegExp(`testnet\\.99 as chain-${UNNAMED_CHAIN_ID}`),
    );
  });

  it("does not warn about chain names for a loaded book whose chains all have a row", () => {
    const warn = vi.fn();

    deploymentsFromAddressBook(bookWithHub("testnet", NEW_HUB), { warn });

    const messages = warn.mock.calls.map(([message]) => String(message));
    expect(messages.filter((m) => m.includes("CHAIN_NAMES"))).toEqual([]);
  });

  it("still fails the build of a book that carries the baked bookId", () => {
    const book = { ...bookWithUnnamedChain(), bookId: addressBook.bookId };

    expect(() => deploymentDataFromAddressBook(book)).toThrow(
      /testnet\.99\.name.*CHAIN_NAMES/,
    );
  });
});

describe("served versions", () => {
  it("serves only v3.2 on mainnet from a book that carries a mainnet v3.3.0 stack", () => {
    const book = bookWithMainnetV33();

    const data = deploymentDataFromAddressBook(book);
    const registry = deploymentRegistryFromAddressBook(book);

    expect(Object.keys(data.mainnet!)).toEqual([PROTOCOL_VERSION_V3_2]);
    expect(registry.versionsForChain("mainnet", 1)).toEqual([
      PROTOCOL_VERSION_V3_2,
    ]);
    expect(Object.keys(data.testnet!)).toEqual([
      PROTOCOL_VERSION_V3_2,
      PROTOCOL_VERSION_V3_3,
    ]);
  });

  it("reports the stacks it ignores", () => {
    expect(unservedStacks(bookWithMainnetV33())).toEqual([
      { environment: "mainnet", stackLabel: "v3.3.0" },
    ]);
    expect(unservedStacks(addressBook)).toEqual([
      { environment: "mainnet", stackLabel: "v3.3.0" },
    ]);
  });
});

describe("assertBookKeepsChainIds", () => {
  it("accepts the baked book", () => {
    expect(() => assertBookKeepsChainIds(addressBook)).not.toThrow();
  });

  it("refuses a book that moves a chain to another EVM chain id", () => {
    const book = structuredClone(addressBook);
    book.networks.mainnet.chains["1"]!.chainId = 56;

    expect(() => assertBookKeepsChainIds(book)).toThrow(
      /mainnet\.1\.chainId.*from EVM chain 1 to 56/,
    );
  });

  it("accepts a chain the baked book does not have", () => {
    const book = structuredClone(addressBook);
    book.networks.testnet.chains["77"] = {
      ...structuredClone(book.networks.testnet.chains["1"]!),
      chainId: 777_777,
    };

    expect(() => assertBookKeepsChainIds(book)).not.toThrow();
  });

  it("refuses a book in which two centrifugeIds share an EVM chain id", () => {
    const book = structuredClone(addressBook);
    const ethereum = book.networks.mainnet.chains["1"]!;
    book.networks.mainnet.chains["77"] = structuredClone(ethereum);

    expect(() => assertBookKeepsChainIds(book)).toThrow(
      new RegExp(
        `mainnet\\.77\\.chainId.*EVM chain ${ethereum.chainId}.*centrifugeId 1`,
      ),
    );
  });
});

describe("deploymentRegistryFromAddressBook", () => {
  it("refuses a book that moves a baked chain to another EVM chain id", () => {
    const book = structuredClone(addressBook);
    book.networks.testnet.chains["1"]!.chainId = 56;

    expect(() => deploymentRegistryFromAddressBook(book)).toThrow(
      /testnet\.1\.chainId/,
    );
  });

  it("resolves the book's address, not the baked one", () => {
    const registry = deploymentRegistryFromAddressBook(
      bookWithHub("mainnet", NEW_HUB),
    );

    expect(
      registry.getDeployment("mainnet", PROTOCOL_VERSION_V3_2, 1).contracts.hub,
    ).toBe(getAddress(NEW_HUB));
    expect(
      defaultDeploymentRegistry().getDeployment(
        "mainnet",
        PROTOCOL_VERSION_V3_2,
        1,
      ).contracts.hub,
    ).not.toBe(getAddress(NEW_HUB));
  });
});

describe("deploymentsFromAddressBook", () => {
  it("returns the registry with the data it was built from", () => {
    const book = bookWithHub("mainnet", NEW_HUB);

    const { registry, data } = deploymentsFromAddressBook(book);

    expect(data).toEqual(deploymentDataFromAddressBook(book));
    expect(
      registry.getDeployment("mainnet", PROTOCOL_VERSION_V3_2, 1).contracts.hub,
    ).toBe(data.mainnet![PROTOCOL_VERSION_V3_2]![1]!.contracts.hub);
  });

  it("refuses a book whose chain ids assertBookKeepsChainIds refuses", () => {
    const book = structuredClone(addressBook);
    book.networks.testnet.chains["1"]!.chainId = 56;

    expect(() => deploymentsFromAddressBook(book)).toThrow(
      /testnet\.1\.chainId/,
    );
  });
});

describe("initializeDefaultDeploymentRegistry", () => {
  /** A fresh module graph, so the singleton starts unset. */
  async function freshRegistryModule() {
    vi.resetModules();
    return await import("./index");
  }

  it("makes the registry it is given the default", async () => {
    const registry = await freshRegistryModule();
    const custom = registry.deploymentRegistryFromAddressBook(
      bookWithHub("mainnet", NEW_HUB),
    );

    registry.initializeDefaultDeploymentRegistry(custom);

    expect(registry.defaultDeploymentRegistry()).toBe(custom);
    expect(
      registry.getDeployment("mainnet", PROTOCOL_VERSION_V3_2, 1).contracts.hub,
    ).toBe(getAddress(NEW_HUB));
  });

  it("refuses a second initialisation", async () => {
    const registry = await freshRegistryModule();
    const custom = registry.deploymentRegistryFromAddressBook(addressBook);
    registry.initializeDefaultDeploymentRegistry(custom);

    expect(() => registry.initializeDefaultDeploymentRegistry(custom)).toThrow(
      /already initialised/,
    );
    expect(registry.defaultDeploymentRegistry()).toBe(custom);
  });

  it("refuses an initialisation after the default was used", async () => {
    const registry = await freshRegistryModule();
    const used = registry.defaultDeploymentRegistry();

    expect(() =>
      registry.initializeDefaultDeploymentRegistry(
        registry.deploymentRegistryFromAddressBook(addressBook),
      ),
    ).toThrow(/already in use/);
    expect(registry.defaultDeploymentRegistry()).toBe(used);
  });
});
