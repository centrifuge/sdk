import {
  addressBook,
  bookIdOf,
  type AddressBook,
} from "@centrifuge/addressbook";
import type { Hex } from "viem";
import { describe, expect, it, vi } from "vitest";
import { abiDigest } from "../abis/digest";
import { ABI_SET_V3_2 } from "../abis/v3_2";
import { describeBookAbiMismatch } from "../abis/verify";
import { AddressBookAbiMismatchError } from "../errors";
import {
  assertBookAbisMatchBuild,
  deploymentRegistryFromAddressBook,
  deploymentsFromAddressBook,
} from "./index";

const FOREIGN_DIGEST: Hex = `0x${"ab".repeat(32)}`;

/** The bundled book with `edit` applied to a copy and `bookId` recomputed, as `build-book` would write it. */
function bookWith(edit: (book: AddressBook) => void): AddressBook {
  const book = structuredClone(addressBook);
  edit(book);
  return { ...book, bookId: bookIdOf(book) };
}

/** Gives the record of `contract` in `network` chain 1's `v3.2.0` stack another ABI digest. */
function withMainnetDigest(
  contract: string,
  digest: Hex,
  network: "mainnet" | "testnet" = "mainnet",
) {
  return (book: AddressBook) => {
    const chain = book.networks[network].chains["1"]!;
    const address = chain.stacks["v3.2.0"]![contract]!;
    const record = chain.addresses[address.toLowerCase() as Hex]!;
    record.abi = { name: record.abi!.name, digest };
  };
}

/** Sets the ABI record of `contract` in `network` chain 1's `v3.2.0` stack; `null` removes it. */
function withMainnetAbi(
  contract: string,
  abi: (current: { name: string; digest: Hex }) => {
    name: string;
    digest: Hex;
  } | null,
  network: "mainnet" | "testnet" = "mainnet",
) {
  return (book: AddressBook) => {
    const chain = book.networks[network].chains["1"]!;
    const address = chain.stacks["v3.2.0"]![contract]!;
    const record = chain.addresses[address.toLowerCase() as Hex]!;
    record.abi = abi(record.abi!);
  };
}

/** Renames the ABI of `contract` in `network` chain 1's `v3.2.0` stack to one no ABI set has. */
function withMainnetAbiName(
  contract: string,
  name: string,
  network: "mainnet" | "testnet" = "mainnet",
) {
  return withMainnetAbi(contract, ({ digest }) => ({ name, digest }), network);
}

function refusal(
  book: AddressBook,
  check: (book: AddressBook) => unknown = (b) =>
    assertBookAbisMatchBuild(b, { warn: () => {} }),
): AddressBookAbiMismatchError {
  try {
    check(book);
  } catch (error) {
    if (error instanceof AddressBookAbiMismatchError) {
      return error;
    }
    throw error;
  }
  throw new Error("the book was accepted");
}

describe("assertBookAbisMatchBuild", () => {
  it("refuses a loaded book whose Hub digest differs from the generated Hub, naming it and both digests", () => {
    const book = bookWith(withMainnetDigest("hub", FOREIGN_DIGEST));

    const error = refusal(book);

    expect(error.bookId).toBe(book.bookId);
    expect(error.mismatches).toHaveLength(1);
    const [mismatch] = error.mismatches;
    expect(mismatch).toMatchObject({
      network: "mainnet",
      centrifugeId: "1",
      version: "3.2",
      stack: "v3.2.0",
      contract: "hub",
      abiName: "Hub",
      bookDigest: FOREIGN_DIGEST,
    });
    expect(error.message).toContain(describeBookAbiMismatch(mismatch!));
    expect(error.message).toContain(book.bookId);
  });

  it("lists every mismatch in one error", () => {
    const book = bookWith((draft) => {
      withMainnetDigest("hub", FOREIGN_DIGEST)(draft);
      withMainnetDigest("spoke", FOREIGN_DIGEST)(draft);
    });

    const error = refusal(book);

    expect(error.mismatches.map((m) => m.abiName).sort()).toEqual([
      "Hub",
      "Spoke",
    ]);
  });

  it("refuses a foreign digest on a contract the build never calls, since the address book release carries its ABI", () => {
    const book = bookWith(withMainnetDigest("tokenFactory", FOREIGN_DIGEST));

    const error = refusal(book);

    // Mainnet's v3.3.0 stack keeps the v3.2 TokenFactory, so both versions compare that address.
    expect(
      error.mismatches.map((m) => [m.version, m.contract, m.abiName]).sort(),
    ).toEqual([
      ["3.2", "tokenFactory", "TokenFactory"],
      ["3.3", "tokenFactory", "TokenFactory"],
    ]);
  });

  it("refuses a hub recorded under another ABI name, comparing it with the Hub ABI the build encodes with", () => {
    const book = bookWith(
      withMainnetAbi("hub", () => ({ name: "Hub2", digest: FOREIGN_DIGEST })),
    );

    const error = refusal(book);

    expect(error.mismatches).toHaveLength(1);
    const [mismatch] = error.mismatches;
    expect(mismatch).toMatchObject({
      network: "mainnet",
      centrifugeId: "1",
      version: "3.2",
      stack: "v3.2.0",
      contract: "hub",
      abiName: "Hub2",
      bookDigest: FOREIGN_DIGEST,
      generatedDigest: abiDigest(ABI_SET_V3_2["hub"]!),
    });
    expect(error.message).toContain(
      `hub (Hub2) at ${mismatch!.address}: book ${FOREIGN_DIGEST}, generated ${abiDigest(ABI_SET_V3_2["hub"]!)}`,
    );
  });

  it("refuses a hub whose address has no ABI record, naming the missing digest", () => {
    const book = bookWith(withMainnetAbi("hub", () => null));

    const error = refusal(book);

    expect(error.mismatches).toHaveLength(1);
    const [mismatch] = error.mismatches;
    expect(mismatch).toMatchObject({
      network: "mainnet",
      centrifugeId: "1",
      version: "3.2",
      contract: "hub",
      abiName: null,
      bookDigest: null,
      generatedDigest: abiDigest(ABI_SET_V3_2["hub"]!),
    });
    expect(error.message).toContain(
      `hub (no ABI record) at ${mismatch!.address}: book none, generated ${abiDigest(ABI_SET_V3_2["hub"]!)}`,
    );
  });

  it("accepts a hub recorded under another ABI name when its digest is the Hub ABI the build encodes with", () => {
    const book = bookWith(withMainnetAbiName("hub", "Hub2"));

    expect(() =>
      assertBookAbisMatchBuild(book, { warn: () => {} }),
    ).not.toThrow();
  });

  it("refuses a V33Migration facade with no ABI record", () => {
    const book = bookWith((draft) => {
      const chain = Object.values(draft.networks.testnet.chains).find(
        (candidate) => candidate.stacks["v3.3.0"]?.["v33Migration"],
      )!;
      const address = chain.stacks["v3.3.0"]!["v33Migration"]!;
      chain.addresses[address.toLowerCase() as Hex]!.abi = null;
    });

    const error = refusal(book);

    expect(
      error.mismatches.map((m) => [m.version, m.contract, m.abiName]),
    ).toEqual([["3.3-migration", "v33Migration", null]]);
  });

  it("refuses a V33Migration facade whose digest differs from the generated facade", () => {
    const book = bookWith((draft) => {
      const chain = Object.values(draft.networks.testnet.chains).find(
        (candidate) => candidate.stacks["v3.3.0"]?.["v33Migration"],
      )!;
      const address = chain.stacks["v3.3.0"]!["v33Migration"]!;
      const record = chain.addresses[address.toLowerCase() as Hex]!;
      record.abi = { name: "V33Migration", digest: FOREIGN_DIGEST };
    });

    const error = refusal(book);

    expect(error.mismatches.map((m) => m.abiName)).toEqual(["V33Migration"]);
  });

  it.each(["asyncVaultFactory", "syncDepositVaultFactory"])(
    "refuses a v3.3 %s recorded under another ABI name with a foreign digest",
    (contract) => {
      const book = bookWith((draft) => {
        const chain = Object.values(draft.networks.testnet.chains).find(
          (candidate) => candidate.stacks["v3.3.0"]?.[contract],
        )!;
        const address = chain.stacks["v3.3.0"]![contract]!;
        chain.addresses[address.toLowerCase() as Hex]!.abi = {
          name: "VaultFactoryV2",
          digest: FOREIGN_DIGEST,
        };
      });

      const error = refusal(book);

      expect(
        error.mismatches.map((m) => [m.version, m.contract, m.abiName]),
      ).toEqual([["3.3", contract, "VaultFactoryV2"]]);
    },
  );

  it("compares only the network the process serves when one is given", () => {
    const book = bookWith(withMainnetDigest("hub", FOREIGN_DIGEST, "testnet"));

    expect(() =>
      assertBookAbisMatchBuild(book, { network: "mainnet", warn: () => {} }),
    ).not.toThrow();
    expect(
      refusal(book, (b) =>
        assertBookAbisMatchBuild(b, { network: "testnet", warn: () => {} }),
      ).mismatches.map((m) => m.network),
    ).toEqual(["testnet"]);
  });

  it("lists only the served network's ABI names in the warning", () => {
    const warn = vi.fn();
    const book = bookWith((draft) => {
      withMainnetAbiName("root", "MainnetRootFromTheFuture")(draft);
      withMainnetAbiName("root", "TestnetRootFromTheFuture", "testnet")(draft);
    });

    assertBookAbisMatchBuild(book, { network: "testnet", warn });

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toMatch(/\bTestnetRootFromTheFuture\b/);
    expect(warn.mock.calls[0]![0]).not.toMatch(/MainnetRootFromTheFuture/);
  });

  it("runs inside the registry builders, so no caller can build a registry without it", () => {
    const book = bookWith(withMainnetDigest("hub", FOREIGN_DIGEST));
    const options = { network: "mainnet" as const, warn: () => {} };

    expect(
      refusal(book, (b) => deploymentsFromAddressBook(b, options)),
    ).toBeInstanceOf(AddressBookAbiMismatchError);
    expect(
      refusal(book, (b) => deploymentRegistryFromAddressBook(b, options)),
    ).toBeInstanceOf(AddressBookAbiMismatchError);
  });

  it("names the fix in the error: the bundled book, or the address book release the book was built with", () => {
    const error = refusal(bookWith(withMainnetDigest("hub", FOREIGN_DIGEST)));

    expect(error.message).toMatch(
      /the ABI digest of 1 address differs from the ABI built into this release/,
    );
    expect(error.message).toMatch(/wrong ABI/);
    expect(error.message).toMatch(/bundled address book/);
    expect(error.message).toMatch(/pin the @centrifuge\/addressbook release/);
  });

  it("does not check the bundled book", () => {
    const warn = vi.fn();
    const sameIdOtherContent = structuredClone(addressBook);
    withMainnetDigest("hub", FOREIGN_DIGEST)(sameIdOtherContent);

    expect(() =>
      assertBookAbisMatchBuild(sameIdOtherContent, { warn }),
    ).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });

  it("loads a book whose digests match and warns once, listing the ABI names of keys the build does not encode with", () => {
    const warn = vi.fn();
    const book = bookWith((draft) => {
      withMainnetAbiName("root", "RootFromTheFuture")(draft);
      withMainnetAbiName("hub", "HubFromTheFuture")(draft);
    });

    assertBookAbisMatchBuild(book, { warn });

    expect(warn).toHaveBeenCalledOnce();
    const [message] = warn.mock.calls[0] as [string];
    expect(message).toMatch(/v3\.2\.0: .*\bRootFromTheFuture\b/);
    expect(message).not.toMatch(/HubFromTheFuture/);
    expect(message).not.toMatch(/\bHub\b,/);
    expect(message).not.toMatch(/\bV33Migration\b/);
  });

  it("warns through console.warn when no warn is passed", () => {
    const consoleWarn = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    try {
      assertBookAbisMatchBuild(bookWith(withMainnetAbiName("root", "Other")));

      expect(consoleWarn).toHaveBeenCalledOnce();
    } finally {
      consoleWarn.mockRestore();
    }
  });
});
