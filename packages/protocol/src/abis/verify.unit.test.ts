import {
  addressBook,
  type AddressBook,
  type AddressRecord,
} from "@centrifuge/addressbook";
import { describe, expect, it } from "vitest";
import { parseAbi, type Abi, type Hex } from "viem";
import { abiDigest } from "./digest";
import {
  compareBookAbis,
  DEFAULT_GENERATED_ABIS,
  describeBookAbiMismatch,
  type GeneratedAbis,
} from "./verify";

const HUB = parseAbi(["function a() view returns (uint256)"]) as Abi;
const HUB_EDITED = parseAbi(["function a() view returns (uint128)"]) as Abi;
const HUB_ADDRESS = "0x1111111111111111111111111111111111111111";
const MULTICALL_ADDRESS = "0x2222222222222222222222222222222222222222";
const MANUAL_ADDRESS = "0x3333333333333333333333333333333333333333";

function record(abi: { name: string; digest: Hex } | null): AddressRecord {
  return {
    contract: "hub",
    blockNumber: 1,
    endBlock: null,
    layer: null,
    version: "v9.9.0",
    abiVersion: "v9_9",
    abi,
    origin: "registry",
    excluded: null,
  };
}

/** A book with one mainnet chain whose `v9.9.0` stack holds a hub, a multicall and a manual entry. */
function bookWithHubDigest(digest: Hex, hubAbiName = "Hub"): AddressBook {
  const network = (chains: AddressBook["networks"]["mainnet"]["chains"]) => ({
    head: "bafkreiexample",
    verified: true,
    layers: [],
    chains,
  });
  return {
    bookSerial: 1,
    bookId: "0".repeat(64),
    libraryVersion: "0.0.0",
    manualAbis: {},
    networks: {
      mainnet: network({
        "7": {
          chainId: 77,
          addresses: {
            [HUB_ADDRESS]: record({ name: hubAbiName, digest }),
            [MULTICALL_ADDRESS]: record({ name: "Multicall", digest: "0x01" }),
            [MANUAL_ADDRESS]: record(null),
          },
          current: {},
          stacks: {
            "v9.9.0": {
              hub: HUB_ADDRESS,
              multicall: MULTICALL_ADDRESS,
              manual: MANUAL_ADDRESS,
            },
          },
        },
      }),
      testnet: network({}),
    },
  };
}

const generated = (
  abis: Readonly<Record<string, Abi>>,
  stackLabel = "v9.9.0",
  signing?: Readonly<Record<string, Abi>>,
): Readonly<Record<string, GeneratedAbis>> => ({
  "9.9": {
    abis,
    source: {
      network: "mainnet",
      head: "bafkreiexample",
      stackLabel,
    },
    signing,
  },
});

describe("the generated ABIs against the bundled address book", () => {
  it("match the digest of every stack address that signs with them", () => {
    const { mismatches, compared } = compareBookAbis(addressBook);

    expect(mismatches.map(describeBookAbiMismatch)).toEqual([]);
    for (const version of Object.keys(DEFAULT_GENERATED_ABIS)) {
      expect(compared[version], version).toBeGreaterThan(0);
    }
  });

  it.each(Object.entries(DEFAULT_GENERATED_ABIS))(
    "generated %s from the head the bundled book pins",
    (_version, { source }) => {
      expect(source.head).toBe(addressBook.networks[source.network].head);
    },
  );

  it("fails naming network, chain, version and contract when one byte of the ABI the build encodes hub with changes", () => {
    const hub = JSON.stringify(DEFAULT_GENERATED_ABIS["3.2"]!.signing!["hub"]);
    const edited = hub.replace('"name":"poolId"', '"name":"poolIe"');
    expect(edited).not.toBe(hub);
    const withEditedHub = {
      ...DEFAULT_GENERATED_ABIS,
      "3.2": {
        ...DEFAULT_GENERATED_ABIS["3.2"]!,
        signing: {
          ...DEFAULT_GENERATED_ABIS["3.2"]!.signing,
          hub: JSON.parse(edited) as Abi,
        },
      },
    };

    const { mismatches } = compareBookAbis(addressBook, withEditedHub);

    expect(mismatches.length).toBeGreaterThan(0);
    expect(
      mismatches.every((m) => m.version === "3.2" && m.abiName === "Hub"),
    ).toBe(true);
    const [first] = mismatches;
    expect(describeBookAbiMismatch(first!)).toBe(
      `${first!.network} centrifugeId ${first!.centrifugeId} (chain ${first!.chainId}), ` +
        `protocol 3.2 stack v3.2.0, hub (Hub) at ${first!.address}: ` +
        `book ${first!.bookDigest}, generated ${abiDigest(JSON.parse(edited) as Abi)}`,
    );
  });
});

describe("compareBookAbis", () => {
  it("passes a stack whose generated ABIs match", () => {
    const result = compareBookAbis(
      bookWithHubDigest(abiDigest(HUB)),
      generated({ Hub: HUB }),
    );

    expect(result.mismatches).toEqual([]);
    expect(result.compared).toEqual({ "9.9": 1 });
  });

  it("reports the network, chain, stack, contract, address and both digests of a mismatch", () => {
    const { mismatches } = compareBookAbis(
      bookWithHubDigest(abiDigest(HUB)),
      generated({ Hub: HUB_EDITED }),
    );

    expect(mismatches).toEqual([
      {
        network: "mainnet",
        centrifugeId: "7",
        chainId: 77,
        version: "9.9",
        stack: "v9.9.0",
        contract: "hub",
        abiName: "Hub",
        address: HUB_ADDRESS,
        bookDigest: abiDigest(HUB),
        generatedDigest: abiDigest(HUB_EDITED),
      },
    ]);
  });

  it("describes a mismatch in one line naming where it is and both digests", () => {
    const [mismatch] = compareBookAbis(
      bookWithHubDigest(abiDigest(HUB)),
      generated({ Hub: HUB_EDITED }),
    ).mismatches;

    expect(describeBookAbiMismatch(mismatch!)).toBe(
      `mainnet centrifugeId 7 (chain 77), protocol 9.9 stack v9.9.0, hub (Hub) at ${HUB_ADDRESS}: ` +
        `book ${abiDigest(HUB)}, generated ${abiDigest(HUB_EDITED)}`,
    );
  });

  it("does not compare an address whose ABI is hand-written or unknown to the book", () => {
    const { compared } = compareBookAbis(
      bookWithHubDigest(abiDigest(HUB)),
      generated({ Hub: HUB }),
    );

    expect(compared["9.9"]).toBe(1);
  });

  it("compares a signing key with its ABI whatever ABI name the book records", () => {
    const book = bookWithHubDigest(abiDigest(HUB_EDITED), "Hub2");

    const { mismatches, compared } = compareBookAbis(
      book,
      generated({ Hub: HUB_EDITED }, "v9.9.0", { hub: HUB }),
    );

    expect(compared["9.9"]).toBe(1);
    expect(mismatches).toMatchObject([
      {
        contract: "hub",
        abiName: "Hub2",
        bookDigest: abiDigest(HUB_EDITED),
        generatedDigest: abiDigest(HUB),
      },
    ]);
  });

  it("reports a signing key whose address has no ABI record", () => {
    const { mismatches } = compareBookAbis(
      bookWithHubDigest(abiDigest(HUB)),
      generated({}, "v9.9.0", { manual: HUB }),
    );

    expect(mismatches).toMatchObject([
      { contract: "manual", abiName: null, bookDigest: null },
    ]);
    expect(describeBookAbiMismatch(mismatches[0]!)).toBe(
      `mainnet centrifugeId 7 (chain 77), protocol 9.9 stack v9.9.0, manual (no ABI record) at ${MANUAL_ADDRESS}: ` +
        `book none, generated ${abiDigest(HUB)}`,
    );
  });

  it("counts no comparison for a generated version no network has a stack for", () => {
    const { compared, mismatches } = compareBookAbis(
      bookWithHubDigest(abiDigest(HUB)),
      generated({ Hub: HUB_EDITED }, "v9.8.0"),
    );

    expect(compared).toEqual({ "9.9": 0 });
    expect(mismatches).toEqual([]);
  });
});
