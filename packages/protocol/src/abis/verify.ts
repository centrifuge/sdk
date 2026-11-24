import type {
  AddressBook,
  ChainBook,
  NetworkName,
} from "@centrifuge/addressbook";
import type { Abi, Hex } from "viem";
import { describeBookAbiMismatch } from "../errors";
import {
  MIGRATION_ABI_KEY,
  MIGRATION_FACADE_KEY,
} from "../migration/constants";
import { PROTOCOL_VERSION_V3_2, PROTOCOL_VERSION_V3_3 } from "../types";
import {
  ABI_SOURCE_V3_2,
  ABI_SOURCE_V3_3,
  ABI_SOURCE_V33_MIGRATION,
  GENERATED_ABIS_V3_2,
  GENERATED_ABIS_V3_3,
  GENERATED_ABIS_V33_MIGRATION,
} from "@centrifuge/addressbook/abis";
import { abiDigest } from "./digest";
import { ABI_SET_V3_2 } from "./v3_2";
import { ABI_SET_V3_3 } from "./v3_3";

/** Where the address book package folded an ABI set from. */
export interface GeneratedAbiSource {
  readonly network: NetworkName;
  /** The registry head the set was folded from. */
  readonly head: string;
  /** The address book stack whose addresses the set is compared with (`v3.2.0`). */
  readonly stackLabel: string;
}

export interface GeneratedAbis {
  /** Keyed by ABI name; compared with stack addresses whose key is not in `signing`. */
  readonly abis: Readonly<Record<string, Abi>>;
  readonly source: GeneratedAbiSource;
  /**
   * The ABIs the build encodes calls with, keyed by registry key (`hub`). The
   * address of each of these keys must record this ABI's digest, whatever ABI
   * name the book gives it.
   */
  readonly signing?: Readonly<Record<string, Abi>>;
}

/** The address book package's ABI sets, keyed by protocol version. */
export const DEFAULT_GENERATED_ABIS: Readonly<Record<string, GeneratedAbis>> = {
  [PROTOCOL_VERSION_V3_2]: {
    abis: GENERATED_ABIS_V3_2,
    source: ABI_SOURCE_V3_2,
    signing: ABI_SET_V3_2,
  },
  [PROTOCOL_VERSION_V3_3]: {
    abis: GENERATED_ABIS_V3_3,
    source: ABI_SOURCE_V3_3,
    signing: ABI_SET_V3_3,
  },
};

/** Every generated set a loaded address book is checked against: each version's and the v3.3 migration facade's. */
export { describeBookAbiMismatch };

export const SIGNING_GENERATED_ABIS: Readonly<Record<string, GeneratedAbis>> = {
  ...DEFAULT_GENERATED_ABIS,
  [MIGRATION_ABI_KEY]: {
    abis: GENERATED_ABIS_V33_MIGRATION,
    source: ABI_SOURCE_V33_MIGRATION,
    signing: {
      [MIGRATION_FACADE_KEY]: GENERATED_ABIS_V33_MIGRATION.V33Migration,
    },
  },
};

/**
 * A stack address whose book ABI digest differs from the generated ABI it is
 * compared with. `abiName` and `bookDigest` are `null` when the book has no
 * ABI record for an address the build encodes calls to.
 */
export interface BookAbiMismatch {
  readonly network: NetworkName;
  readonly centrifugeId: string;
  readonly chainId: number;
  readonly version: string;
  readonly stack: string;
  readonly contract: string;
  readonly abiName: string | null;
  readonly address: string;
  readonly bookDigest: Hex | null;
  readonly generatedDigest: Hex;
}

export interface BookAbiComparison {
  readonly mismatches: readonly BookAbiMismatch[];
  /** Addresses compared per protocol version; 0 means no network has a stack the set signs with. */
  readonly compared: Readonly<Record<string, number>>;
}

/**
 * Compares the book's ABI digest of every address of the stack each version
 * signs with, on every network and chain. An address under a key of the
 * version's `signing` set is compared with that key's ABI and must carry an
 * ABI record. Any other address is compared with the generated ABI of its book
 * ABI name, and not compared when there is none (hand-written ABIs, manual
 * entries) or it has no ABI record.
 */
export function compareBookAbis(
  book: AddressBook,
  generated: Readonly<Record<string, GeneratedAbis>> = DEFAULT_GENERATED_ABIS,
  networks: readonly NetworkName[] = BOOK_NETWORKS,
): BookAbiComparison {
  const mismatches: BookAbiMismatch[] = [];
  const compared: Record<string, number> = {};
  for (const [version, set] of Object.entries(generated)) {
    const digestOf = buildDigestLookup(set);
    const found = stackRecords(book, set.source.stackLabel, networks).flatMap(
      (entry) => {
        const generatedDigest = digestOf(entry);
        return generatedDigest ? [{ ...entry, version, generatedDigest }] : [];
      },
    );
    compared[version] = found.length;
    mismatches.push(
      ...found.filter((entry) => entry.generatedDigest !== entry.bookDigest),
    );
  }
  return { mismatches, compared };
}

type StackRecord = Omit<BookAbiMismatch, "version" | "generatedDigest">;

/** The digest a stack record is compared with in `set`, or `undefined` when it is not compared. */
function buildDigestLookup(
  set: GeneratedAbis,
): (entry: StackRecord) => Hex | undefined {
  const byKey = digestsOf(set.signing ?? {});
  const byName = digestsOf(set.abis);
  return ({ contract, abiName }) => {
    if (byKey.has(contract)) {
      return byKey.get(contract);
    }
    return abiName === null ? undefined : byName.get(abiName);
  };
}

function digestsOf(abis: Readonly<Record<string, Abi>>): Map<string, Hex> {
  return new Map(
    Object.entries(abis).map(([name, abi]) => [name, abiDigest(abi)]),
  );
}

const BOOK_NETWORKS: readonly NetworkName[] = ["mainnet", "testnet"];

/** Every address of `stack` on each of `networks`, with its ABI record when it has one. */
function stackRecords(
  book: AddressBook,
  stack: string,
  networks: readonly NetworkName[],
): StackRecord[] {
  return networks.flatMap((network) =>
    Object.entries(book.networks[network].chains).flatMap(
      ([centrifugeId, chain]) =>
        chainStackRecords(network, centrifugeId, chain, stack),
    ),
  );
}

function chainStackRecords(
  network: NetworkName,
  centrifugeId: string,
  chain: ChainBook,
  stack: string,
): StackRecord[] {
  return Object.entries(chain.stacks[stack] ?? {}).map(
    ([contract, address]) => {
      const abi = chain.addresses[address.toLowerCase() as Hex]?.abi;
      return {
        network,
        centrifugeId,
        chainId: chain.chainId,
        stack,
        contract,
        abiName: abi?.name ?? null,
        address,
        bookDigest: abi?.digest ?? null,
      };
    },
  );
}

/**
 * Per stack label, the ABI names that the stack's addresses on `networks`
 * record under a key no set signs with and that no generated set of that stack
 * has, so nothing compares their digests. Each name once, sorted.
 */
export function uncomparedBookAbiNames(
  book: AddressBook,
  generated: Readonly<Record<string, GeneratedAbis>> = SIGNING_GENERATED_ABIS,
  networks: readonly NetworkName[] = BOOK_NETWORKS,
): Record<string, string[]> {
  const uncompared: Record<string, string[]> = {};
  for (const [stack, { keys, names }] of comparedPerStack(generated)) {
    const unknown = stackRecords(book, stack, networks)
      .filter(({ contract }) => !keys.has(contract))
      .flatMap(({ abiName }) => (abiName === null ? [] : [abiName]))
      .filter((name) => !names.has(name));
    if (unknown.length > 0) {
      uncompared[stack] = [...new Set(unknown)].sort();
    }
  }
  return uncompared;
}

/** Per stack label, the registry keys and the ABI names some set of that stack compares. */
function comparedPerStack(
  generated: Readonly<Record<string, GeneratedAbis>>,
): Map<string, { keys: Set<string>; names: Set<string> }> {
  const perStack = new Map<string, { keys: Set<string>; names: Set<string> }>();
  for (const { abis, source, signing } of Object.values(generated)) {
    const stack = source.stackLabel;
    const compared = perStack.get(stack) ?? {
      keys: new Set(),
      names: new Set(),
    };
    Object.keys(signing ?? {}).forEach((key) => compared.keys.add(key));
    Object.keys(abis).forEach((name) => compared.names.add(name));
    perStack.set(stack, compared);
  }
  return perStack;
}
