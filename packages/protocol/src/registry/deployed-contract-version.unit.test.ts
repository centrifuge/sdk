import {
  addressBook,
  bookIdOf,
  type AddressBook,
} from "@centrifuge/addressbook";
import type { Hex } from "viem";
import { describe, expect, it } from "vitest";
import { DEFAULT_ABI_SETS } from "../abis";
import { abiDigest } from "../abis/digest";
import { ABIS_V3_2 } from "../abis/v3_2";
import { ABIS_V3_3 } from "../abis/v3_3";
import { DeployedContractVersionError } from "../errors";
import { PROTOCOL_VERSION_V3_2, PROTOCOL_VERSION_V3_3 } from "../types";
import {
  assertDeployedContractVersion,
  CONTRACT_VERSIONS_V3_2,
  DEPLOYMENTS_V3_2,
} from "./index";

const V3_2_DIGEST = abiDigest(ABIS_V3_2.OracleValuation);
const FOREIGN_DIGEST: Hex = `0x${"ab".repeat(32)}`;
const NEW_ORACLE = "0x4444444444444444444444444444444444444444";

const feeder = (
  centrifugeId: number,
  protocolVersion = PROTOCOL_VERSION_V3_2,
) => ({
  operation: "Pool.updateOracleValuationFeeder",
  environment: "mainnet" as const,
  protocolVersion,
  centrifugeId,
  contract: "oracleValuation",
});

/** The bundled book with `edit` applied to mainnet chain 1 and `bookId` recomputed. */
function bookWithChain1(
  edit: (chain: AddressBook["networks"]["mainnet"]["chains"][string]) => void,
): AddressBook {
  const book = structuredClone(addressBook);
  edit(book.networks.mainnet.chains["1"]!);
  return { ...book, bookId: bookIdOf(book) };
}

function refusal(run: () => void): DeployedContractVersionError {
  try {
    run();
  } catch (error) {
    if (error instanceof DeployedContractVersionError) {
      return error;
    }
    throw error;
  }
  throw new Error("the call was accepted");
}

describe("assertDeployedContractVersion against the bundled book", () => {
  it.each([1, 2, 3, 10, 13])(
    "accepts OracleValuation on mainnet centrifugeId %i, whose record carries the v3.2 digest",
    (centrifugeId) => {
      expect(() =>
        assertDeployedContractVersion(feeder(centrifugeId)),
      ).not.toThrow();
    },
  );

  it.each([4, 5, 6, 9, 11, 12, 14])(
    "refuses OracleValuation on mainnet centrifugeId %i, where the book excludes it",
    (centrifugeId) => {
      const error = refusal(() =>
        assertDeployedContractVersion(feeder(centrifugeId)),
      );

      expect(error).toMatchObject({
        centrifugeId,
        contract: "oracleValuation",
        address: null,
        bookDigest: null,
        buildDigest: V3_2_DIGEST,
      });
    },
  );

  it("names the operation, chain, contract, address and both digests", () => {
    const error = refusal(() => assertDeployedContractVersion(feeder(4)));

    expect(error).toMatchObject({
      operation: "Pool.updateOracleValuationFeeder",
      environment: "mainnet",
      centrifugeId: 4,
      chainName: "plume",
      contract: "oracleValuation",
      protocolVersion: "3.2",
    });
    expect(error.message).toBe(
      "Pool.updateOracleValuationFeeder is not available on mainnet centrifugeId 4 (plume): " +
        "the address book records oracleValuation at no address with ABI digest none, " +
        `not the protocol 3.2 ABI this build encodes calls with (${V3_2_DIGEST})`,
    );
  });

  it("accepts a v3.3 call on mainnet, whose book v3.3.0 record carries the v3.3 digest", () => {
    const stack = addressBook.networks.mainnet.chains["1"]!.stacks["v3.3.0"]!;
    const address = stack.oracleValuation!.toLowerCase() as Hex;
    expect(
      addressBook.networks.mainnet.chains["1"]!.addresses[address]!.abi?.digest,
    ).toBe(abiDigest(ABIS_V3_3.OracleValuation));

    expect(() =>
      assertDeployedContractVersion(feeder(1, PROTOCOL_VERSION_V3_3)),
    ).not.toThrow();
  });

  it("refuses a call for a protocol version the registry does not serve, though an ABI is built for it", () => {
    const error = refusal(() =>
      assertDeployedContractVersion(feeder(1, "9.9"), addressBook, {
        ...DEFAULT_ABI_SETS,
        "9.9": { oracleValuation: ABIS_V3_3.OracleValuation },
      }),
    );

    expect(error).toMatchObject({ served: false, address: null });
    expect(error.message).toBe(
      "Pool.updateOracleValuationFeeder is not available on mainnet centrifugeId 1 (ethereum): " +
        "protocol 9.9 is not served on mainnet",
    );
  });

  it("names the book, not the served versions, when a served version's stack lists no such contract", () => {
    const book = bookWithChain1((chain) => {
      delete chain.stacks["v3.2.0"]!.oracleValuation;
    });

    const error = refusal(() => assertDeployedContractVersion(feeder(1), book));

    expect(error).toMatchObject({ served: true, address: null });
    expect(error.message).toMatch(/records oracleValuation at no address/);
  });

  it("accepts a v3.3 call on testnet, where v3.3 is served", () => {
    expect(() =>
      assertDeployedContractVersion({
        ...feeder(1, PROTOCOL_VERSION_V3_3),
        environment: "testnet",
      }),
    ).not.toThrow();
  });
});

describe("assertDeployedContractVersion against a loaded book", () => {
  it("accepts an OracleValuation at a new address whose record carries the v3.2 digest", () => {
    const book = bookWithChain1((chain) => {
      chain.stacks["v3.2.0"]!.oracleValuation = NEW_ORACLE;
      chain.addresses[NEW_ORACLE] = {
        abi: { name: "OracleValuation", digest: V3_2_DIGEST },
      } as never;
    });

    expect(() => assertDeployedContractVersion(feeder(1), book)).not.toThrow();
  });

  it("refuses a chain whose stack lists no OracleValuation", () => {
    const book = bookWithChain1((chain) => {
      delete chain.stacks["v3.2.0"]!.oracleValuation;
    });

    const error = refusal(() => assertDeployedContractVersion(feeder(1), book));

    expect(error).toMatchObject({ address: null, bookDigest: null });
  });

  it("refuses an OracleValuation whose address has no ABI record", () => {
    const book = bookWithChain1((chain) => {
      const address = chain.stacks["v3.2.0"]!.oracleValuation!;
      chain.addresses[address.toLowerCase() as Hex]!.abi = null;
    });

    const error = refusal(() => assertDeployedContractVersion(feeder(1), book));

    expect(error.bookDigest).toBeNull();
    expect(error.address).toBe(
      DEPLOYMENTS_V3_2.mainnet[1]!.contracts.oracleValuation!.toLowerCase(),
    );
  });

  it("refuses an OracleValuation whose record carries a foreign digest, naming both digests", () => {
    const book = bookWithChain1((chain) => {
      const address = chain.stacks["v3.2.0"]!.oracleValuation!;
      chain.addresses[address.toLowerCase() as Hex]!.abi = {
        name: "OracleValuation",
        digest: FOREIGN_DIGEST,
      };
    });

    const error = refusal(() => assertDeployedContractVersion(feeder(1), book));

    expect(error).toMatchObject({
      bookDigest: FOREIGN_DIGEST,
      buildDigest: V3_2_DIGEST,
    });
    expect(error.message).toContain(
      `with ABI digest ${FOREIGN_DIGEST}, not the protocol 3.2 ABI this build encodes calls with (${V3_2_DIGEST})`,
    );
  });
});

describe("CONTRACT_VERSIONS_V3_2", () => {
  it.each(["mainnet", "testnet"] as const)(
    "labels exactly the %s v3.2 contracts, chain by chain",
    (environment) => {
      const labelled = CONTRACT_VERSIONS_V3_2[environment];
      const deployed = DEPLOYMENTS_V3_2[environment];

      expect(Object.keys(labelled).sort()).toEqual(
        Object.keys(deployed).sort(),
      );
      for (const [centrifugeId, deployment] of Object.entries(deployed)) {
        expect(Object.keys(labelled[Number(centrifugeId)]!).sort()).toEqual(
          Object.keys(deployment.contracts).sort(),
        );
      }
    },
  );
});
