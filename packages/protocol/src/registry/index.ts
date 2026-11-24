import {
  addressBook,
  bookIdOf,
  type AddressBook,
} from "@centrifuge/addressbook";
import { loadAddressBook } from "@centrifuge/addressbook/load";
import { isAddress, type Address, type Hex } from "viem";
import { DEFAULT_ABI_SETS } from "../abis";
import { abiDigest } from "../abis/digest";
import {
  compareBookAbis,
  SIGNING_GENERATED_ABIS,
  uncomparedBookAbiNames,
} from "../abis/verify";
import {
  AddressBookAbiMismatchError,
  DefaultDeploymentRegistryLockedError,
  DeployedContractVersionError,
  DeploymentVerificationError,
  UnknownDeploymentError,
  UnknownProtocolVersionError,
} from "../errors";
import {
  PROTOCOL_VERSION_V3_2,
  PROTOCOL_VERSION_V3_3,
  type AbiSetsByVersion,
  type AddressSet,
  type ChainEnvironment,
  type ContractSchema,
  type ContractSchemasByVersion,
  type Deployment,
  type DeploymentInput,
  type DeploymentRegistryData,
  type ProtocolVersion,
} from "../types";
import {
  ENVIRONMENTS,
  environmentsWithStack,
  stackDeployments,
  type DeploymentsByEnvironment,
  type UnnamedChainNamer,
} from "./address-book";
import { CHAIN_NAMES } from "./chain-names";
import {
  CONTRACT_SCHEMA_V3_2,
  CONTRACT_VERSIONS_V3_2,
  STACK_LABEL_V3_2,
} from "./v3_2";
import { CONTRACT_SCHEMA_V3_3, STACK_LABEL_V3_3 } from "./v3_3";

export { addressBook, bookIdOf, loadAddressBook };
export type {
  AddressBook,
  AddressDifference,
  BookLog,
  LoadedAddressBook,
  LoadOptions,
  LoadSource,
} from "@centrifuge/addressbook";

export { CONTRACT_SCHEMA_V3_2, CONTRACT_SCHEMA_V3_3, CONTRACT_VERSIONS_V3_2 };

/**
 * Bundled contract schemas keyed by protocol version. A version listed here
 * validates its address sets against the schema's required/optional split;
 * a version without a schema entry falls back to its ABI-set key set (all
 * required), preserving the strict exact-match behavior for minimal sets.
 */
export const DEFAULT_CONTRACT_SCHEMAS: ContractSchemasByVersion = {
  [PROTOCOL_VERSION_V3_2]: CONTRACT_SCHEMA_V3_2,
  [PROTOCOL_VERSION_V3_3]: CONTRACT_SCHEMA_V3_3,
};

/**
 * The versions the registry serves and where, whatever stacks a book carries:
 * a stack for a version in an environment not listed here is ignored. Adding an
 * environment is a hand edit and changes behaviour, because chain-scoped
 * resolution answers the newest version on a chain: serving v3.3 on mainnet
 * moves every pool-less mainnet flow to v3.3, as it does on testnet.
 */
const SERVED_VERSIONS: readonly {
  readonly version: ProtocolVersion;
  readonly stackLabel: string;
  readonly schema: ContractSchema;
  readonly environments: readonly ChainEnvironment[];
}[] = [
  {
    version: PROTOCOL_VERSION_V3_2,
    stackLabel: STACK_LABEL_V3_2,
    schema: CONTRACT_SCHEMA_V3_2,
    environments: ENVIRONMENTS,
  },
  {
    version: PROTOCOL_VERSION_V3_3,
    stackLabel: STACK_LABEL_V3_3,
    schema: CONTRACT_SCHEMA_V3_3,
    environments: ["testnet"],
  },
];

/** Options of the functions that build a registry from an address book. */
export type AddressBookRegistryOptions = {
  /** Where the warnings about a loaded book go; `console.warn` when omitted. */
  warn?: (message: string) => void;
  /** The network whose stacks must match the generated ABIs; both when omitted. */
  network?: ChainEnvironment;
};

/** Whether `book` carries the baked book's `bookId`. */
export function isBakedAddressBook(book: AddressBook): boolean {
  return book.bookId === addressBook.bookId;
}

/**
 * Refuses a book other than the baked one when, in its `v3.2.0` or `v3.3.0`
 * stack on `options.network` (both networks when omitted), the address of a
 * registry key this build encodes calls with (the v3.3 migration facade
 * included) records no ABI or an ABI digest other than that key's ABI, or
 * another address records a digest other than the generated ABI of its
 * `abi.name`. Warns once listing the ABI names of the remaining addresses,
 * which nothing compared. The baked book is held to the generated ABIs by a
 * unit test. Throws {@link AddressBookAbiMismatchError} listing every mismatch.
 */
export function assertBookAbisMatchBuild(
  book: AddressBook,
  options: AddressBookRegistryOptions = {},
): void {
  if (isBakedAddressBook(book)) {
    return;
  }
  const networks = options.network ? [options.network] : undefined;
  const { mismatches } = compareBookAbis(
    book,
    SIGNING_GENERATED_ABIS,
    networks,
  );
  if (mismatches.length > 0) {
    throw new AddressBookAbiMismatchError(book.bookId, mismatches);
  }
  const uncompared = Object.entries(
    uncomparedBookAbiNames(book, SIGNING_GENERATED_ABIS, networks),
  );
  if (uncompared.length > 0) {
    // eslint-disable-next-line no-console -- this package has no logger; a caller with one passes `warn`
    (options.warn ?? console.warn)(
      `address book ABIs with no bundled ABI are not checked against the build: ${uncompared
        .map(([stack, names]) => `${stack}: ${names.join(", ")}`)
        .join("; ")}`,
    );
  }
}

/**
 * Names each chain of a loaded book that `CHAIN_NAMES` lacks as
 * `chain-<chainId>`, and records it. The baked book gets no namer: a chain it
 * carries without a row is a release defect and fails the build. A new chain
 * in a registry head therefore needs no code release. The baked-book
 * exemption relies on every loader verifying a book's content against its
 * `bookId`.
 */
function namerForLoadedBook(book: AddressBook): {
  nameUnnamed?: UnnamedChainNamer;
  named: Set<string>;
} {
  const named = new Set<string>();
  if (isBakedAddressBook(book)) {
    return { named };
  }
  const nameUnnamed: UnnamedChainNamer = (
    environment,
    centrifugeId,
    chainId,
  ) => {
    const name = `chain-${chainId}`;
    named.add(`${environment}.${centrifugeId} as ${name}`);
    return name;
  };
  return { nameUnnamed, named };
}

/**
 * Registry data for any address book, keyed by `(chainEnvironment,
 * protocolVersion, centrifugeId)`: the book's stack of each version served in
 * each environment. An environment lists a version only when one of its chains
 * has a stack for it.
 *
 * Reads no environment and does not touch the default registry. A chain of a
 * book other than the baked one that has no entry in `CHAIN_NAMES` is named
 * `chain-<chainId>`, and one warning lists those chains.
 * Throws {@link DeploymentVerificationError} when no served stack is in the
 * book, and when a chain of the baked book has no entry in `CHAIN_NAMES`.
 */
export function deploymentDataFromAddressBook(
  book: AddressBook,
  options: AddressBookRegistryOptions = {},
): DeploymentRegistryData {
  const data: Record<
    ChainEnvironment,
    Record<ProtocolVersion, Record<number, DeploymentInput>>
  > = { mainnet: {}, testnet: {} };
  const { nameUnnamed, named } = namerForLoadedBook(book);

  for (const { version, stackLabel, schema, environments } of SERVED_VERSIONS) {
    const built = stackDeployments(
      book,
      stackLabel,
      schema,
      environments,
      CHAIN_NAMES,
      nameUnnamed,
    );
    for (const environment of environments) {
      if (Object.keys(built[environment]).length > 0) {
        data[environment][version] = built[environment];
      }
    }
  }

  const served = Object.values(data).some(
    (byVersion) => Object.keys(byVersion).length > 0,
  );
  if (!served) {
    throw new DeploymentVerificationError(
      "addressBook",
      `no chain of the book has a stack for a served version (${SERVED_VERSIONS.map(
        ({ stackLabel }) => stackLabel,
      ).join(", ")})`,
    );
  }
  if (named.size > 0) {
    // eslint-disable-next-line no-console -- this package has no logger; a caller with one passes `warn`
    (options.warn ?? console.warn)(
      `address book chains with no CHAIN_NAMES row are named by their EVM chain id: ${[...named].join(", ")}`,
    );
  }
  return data;
}

/**
 * The stacks `book` carries for a version the registry does not serve in that
 * environment (`{ environment: "mainnet", stackLabel: "v3.3.0" }`). The
 * registry ignores them; a caller that loaded the book reports them.
 */
export function unservedStacks(
  book: AddressBook,
): { environment: ChainEnvironment; stackLabel: string }[] {
  return SERVED_VERSIONS.flatMap(({ stackLabel, environments }) =>
    environmentsWithStack(book, stackLabel)
      .filter((environment) => !environments.includes(environment))
      .map((environment) => ({ environment, stackLabel })),
  );
}

/**
 * Refuses a book that moves a chain of the baked book to another EVM chain id,
 * or gives two chains of one environment the same EVM chain id. The book's own
 * differences report addresses, not ids; a transaction built for the wrong
 * chain id signs for another network, and a shared one makes the
 * chain-id-to-centrifugeId lookup pick either chain.
 */
export function assertBookKeepsChainIds(book: AddressBook): void {
  for (const environment of ENVIRONMENTS) {
    const bakedChains = addressBook.networks[environment].chains;
    const centrifugeIdByChainId = new Map<number, string>();
    for (const [id, chain] of Object.entries(
      book.networks[environment].chains,
    )) {
      const bakedChainId = bakedChains[id]?.chainId;
      if (bakedChainId !== undefined && bakedChainId !== chain.chainId) {
        throw new DeploymentVerificationError(
          `${environment}.${id}.chainId`,
          `the book moves this chain from EVM chain ${bakedChainId} to ${chain.chainId}`,
        );
      }
      const sharedWith = centrifugeIdByChainId.get(chain.chainId);
      if (sharedWith !== undefined) {
        throw new DeploymentVerificationError(
          `${environment}.${id}.chainId`,
          `EVM chain ${chain.chainId} is already centrifugeId ${sharedWith} in this book`,
        );
      }
      centrifugeIdByChainId.set(chain.chainId, id);
    }
  }
}

/**
 * A read-only object built by `build` on its first property access, so that
 * importing ABIs, builders or errors never builds the baked registry data. A
 * `build` that throws throws again on every access.
 */
function builtOnFirstAccess<T extends object>(build: () => T): T {
  let built: T | undefined;
  const target = () => (built ??= build());
  const readOnly = () => false;
  return new Proxy({} as T, {
    get: (_, key) => Reflect.get(target(), key),
    has: (_, key) => Reflect.has(target(), key),
    ownKeys: () => Reflect.ownKeys(target()),
    // A proxy may not report a property as non-configurable when its own
    // (empty) target lacks it.
    getOwnPropertyDescriptor: (_, key) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(target(), key);
      return descriptor && { ...descriptor, configurable: true };
    },
    set: readOnly,
    defineProperty: readOnly,
    deleteProperty: readOnly,
  });
}

function buildDefaultDeploymentData(): DeploymentRegistryData {
  const data = deploymentDataFromAddressBook(addressBook);
  for (const { version, stackLabel, environments } of SERVED_VERSIONS) {
    for (const environment of environments) {
      if (data[environment]?.[version] === undefined) {
        throw new DeploymentVerificationError(
          `${environment}.${version}`,
          `the baked address book has no ${stackLabel} stack for this environment`,
        );
      }
    }
  }
  return data;
}

/**
 * Registry data of the baked address book, built on first lookup. Every served
 * version must have a stack in the baked book for every environment it is
 * served in: a mistyped stack label would otherwise build an empty registry.
 */
export const DEFAULT_DEPLOYMENT_DATA: DeploymentRegistryData =
  builtOnFirstAccess(buildDefaultDeploymentData);

const bakedDeployments = (version: ProtocolVersion): DeploymentsByEnvironment =>
  builtOnFirstAccess(() => ({
    mainnet: DEFAULT_DEPLOYMENT_DATA.mainnet?.[version] ?? {},
    testnet: DEFAULT_DEPLOYMENT_DATA.testnet?.[version] ?? {},
  }));

/** The baked book's v3.2 deployments. Code outside the SDK that must follow unsafe mode resolves through the default registry. */
export const DEPLOYMENTS_V3_2 = bakedDeployments(PROTOCOL_VERSION_V3_2);
/** The baked book's v3.3 deployments; empty for mainnet. See {@link DEPLOYMENTS_V3_2}. */
export const DEPLOYMENTS_V3_3 = bakedDeployments(PROTOCOL_VERSION_V3_3);

export interface AssertDeployedContractVersionOptions {
  /** What is being built, for the error (`Pool.updateOracleValuationFeeder`). */
  readonly operation: string;
  readonly environment: ChainEnvironment;
  readonly protocolVersion: ProtocolVersion;
  readonly centrifugeId: number;
  /** Registry contract name (`oracleValuation`). */
  readonly contract: string;
}

/**
 * Refuses a build unless `book`, the active address book (the bundled one when
 * omitted), records for `contract` on this chain the ABI digest of the ABI the
 * build encodes the call with: the `protocolVersion` ABI set's entry for
 * `contract`. The address may be any; the digest decides whether the calldata
 * fits. Throws {@link DeployedContractVersionError} when the registry does not
 * serve `protocolVersion` in `environment`, the chain's stack lists no such
 * contract, its address has no ABI record, or the digest differs.
 */
export function assertDeployedContractVersion(
  options: AssertDeployedContractVersionOptions,
  book: AddressBook = addressBook,
  abiSets: AbiSetsByVersion = DEFAULT_ABI_SETS,
): void {
  const { operation, environment, protocolVersion, centrifugeId, contract } =
    options;
  const abi = abiSets[protocolVersion]?.[contract];
  if (!abi) {
    throw new Error(
      `No protocol ${protocolVersion} ABI is built for ${contract}, so ${operation} cannot be checked`,
    );
  }
  const buildDigest = abiDigest(abi);
  const stackLabel = servedStackLabel(protocolVersion, environment);
  const { address, bookDigest } = stackLabel
    ? bookAbiRecord(book, stackLabel, options)
    : { address: null, bookDigest: null };
  if (stackLabel && bookDigest === buildDigest) {
    return;
  }
  throw new DeployedContractVersionError(
    operation,
    environment,
    centrifugeId,
    CHAIN_NAMES[environment]?.[centrifugeId] ?? null,
    contract,
    protocolVersion,
    address,
    bookDigest,
    buildDigest,
    stackLabel !== undefined,
  );
}

/** The stack label of `protocolVersion` when the registry serves it in `environment`. */
function servedStackLabel(
  protocolVersion: ProtocolVersion,
  environment: ChainEnvironment,
): string | undefined {
  return SERVED_VERSIONS.find(
    ({ version, environments }) =>
      version === protocolVersion && environments.includes(environment),
  )?.stackLabel;
}

/** The address `book` lists for the contract on the chain's stack of that version, and its ABI digest. */
function bookAbiRecord(
  book: AddressBook,
  stackLabel: string,
  { environment, centrifugeId, contract }: AssertDeployedContractVersionOptions,
): { address: string | null; bookDigest: Hex | null } {
  const chain = book.networks[environment]?.chains[String(centrifugeId)];
  const address = chain?.stacks[stackLabel]?.[contract] ?? null;
  if (!address) {
    return { address: null, bookDigest: null };
  }
  const record = chain?.addresses[address.toLowerCase() as Hex];
  return { address, bookDigest: record?.abi?.digest ?? null };
}

/**
 * Validated, version-plural deployment registry. Every lookup is keyed by
 * `(environment, protocolVersion, centrifugeId)` — deployments are never one
 * row per chain, and there is deliberately no lookup keyed by chainId or
 * centrifugeId alone (the SDK's `_protocolAddresses(centrifugeId)` shape does
 * not survive the move).
 */
export interface DeploymentRegistry {
  /**
   * The deployment for `(environment, protocolVersion, centrifugeId)`.
   * Throws {@link UnknownProtocolVersionError} for an unregistered version and
   * {@link UnknownDeploymentError} for an unregistered chain.
   */
  getDeployment(
    environment: ChainEnvironment,
    protocolVersion: ProtocolVersion,
    centrifugeId: number,
  ): Deployment;

  /** All protocol versions registered for an environment. */
  versions(environment: ChainEnvironment): readonly ProtocolVersion[];

  /**
   * The protocol versions deployed on one chain of an environment. During a
   * migration window this returns more than one entry per chain.
   */
  versionsForChain(
    environment: ChainEnvironment,
    centrifugeId: number,
  ): readonly ProtocolVersion[];

  /**
   * Every chain known to an environment, across all versions (deduped by
   * `centrifugeId`). The `centrifugeId <-> chainId` mapping is
   * version-independent, so this is the environment's chain directory —
   * usable for id mapping without resolving a protocol version.
   */
  chains(
    environment: ChainEnvironment,
  ): readonly { centrifugeId: number; chainId: number; name: string }[];
}

/**
 * Build a {@link DeploymentRegistry} from raw registry data, schema-validating
 * every address set up front. Each version's contract-name schema is its
 * {@link ContractSchema} (required/optional split, from `schemas`); a version
 * without a schema entry uses its ABI set's key set (all required), so
 * addresses and ABIs cannot drift apart silently. For versions carrying both,
 * every ABI-set key must be a schema contract name.
 *
 * Fail-loud by design: a missing required
 * field, malformed address, or unexpected field throws
 * {@link DeploymentVerificationError} naming the field. No code path deletes
 * or defaults a field — under two parallel protocol stacks a silent field
 * drop becomes an undefined address at write time.
 */
export function createDeploymentRegistry(
  data: DeploymentRegistryData = DEFAULT_DEPLOYMENT_DATA,
  abiSets: AbiSetsByVersion = DEFAULT_ABI_SETS,
  schemas: ContractSchemasByVersion = DEFAULT_CONTRACT_SCHEMAS,
): DeploymentRegistry {
  const verified = verifyRegistryData(data, abiSets, schemas);

  return {
    getDeployment(environment, protocolVersion, centrifugeId) {
      const byVersion = verified[environment];
      const byChain = byVersion?.[protocolVersion];
      if (!byChain) {
        throw new UnknownProtocolVersionError(protocolVersion);
      }

      const deployment = byChain[centrifugeId];
      if (!deployment) {
        throw new UnknownDeploymentError(
          environment,
          protocolVersion,
          centrifugeId,
        );
      }

      return deployment;
    },

    versions(environment) {
      return Object.keys(verified[environment] ?? {});
    },

    versionsForChain(environment, centrifugeId) {
      const byVersion = verified[environment] ?? {};
      return Object.entries(byVersion)
        .filter(([, byChain]) => byChain[centrifugeId] !== undefined)
        .map(([version]) => version);
    },

    chains(environment) {
      const byVersion = verified[environment] ?? {};
      const byCentrifugeId = new Map<
        number,
        { centrifugeId: number; chainId: number; name: string }
      >();
      for (const byChain of Object.values(byVersion)) {
        for (const [centrifugeId, deployment] of Object.entries(byChain)) {
          byCentrifugeId.set(Number(centrifugeId), {
            centrifugeId: Number(centrifugeId),
            chainId: deployment.chainId,
            name: deployment.name,
          });
        }
      }
      return [...byCentrifugeId.values()].sort(
        (a, b) => a.centrifugeId - b.centrifugeId,
      );
    },
  };
}

/**
 * A {@link DeploymentRegistry} over any address book, validated like the
 * default one, with the registry data it was built from. Throws when
 * {@link assertBookKeepsChainIds} refuses the book's chain ids,
 * {@link assertBookAbisMatchBuild} its ABI digests on `options.network`, or
 * the book fails {@link deploymentDataFromAddressBook}.
 */
export function deploymentsFromAddressBook(
  book: AddressBook,
  options: AddressBookRegistryOptions = {},
): {
  registry: DeploymentRegistry;
  data: DeploymentRegistryData;
} {
  assertBookKeepsChainIds(book);
  assertBookAbisMatchBuild(book, options);
  const data = deploymentDataFromAddressBook(book, options);
  return { registry: createDeploymentRegistry(data), data };
}

/** The registry of {@link deploymentsFromAddressBook}. */
export function deploymentRegistryFromAddressBook(
  book: AddressBook,
  options: AddressBookRegistryOptions = {},
): DeploymentRegistry {
  return deploymentsFromAddressBook(book, options).registry;
}

let defaultRegistry: DeploymentRegistry | undefined;
let defaultRegistryInitialized = false;

/**
 * Makes `registry` the one {@link defaultDeploymentRegistry} returns. Callable
 * once, before anything resolves the default; a later call, or a call after
 * the default was used, throws {@link DefaultDeploymentRegistryLockedError}.
 */
export function initializeDefaultDeploymentRegistry(
  registry: DeploymentRegistry,
): void {
  if (defaultRegistryInitialized) {
    throw new DefaultDeploymentRegistryLockedError("is already initialised");
  }
  if (defaultRegistry !== undefined) {
    throw new DefaultDeploymentRegistryLockedError(
      "is already in use: it was resolved before it was initialised",
    );
  }
  defaultRegistry = registry;
  defaultRegistryInitialized = true;
}

/**
 * The default registry: the one passed to
 * {@link initializeDefaultDeploymentRegistry}, else one over the baked book.
 * The baked book's data is built, and its chain names, stack labels, addresses
 * and schemas checked, on first use.
 */
export function defaultDeploymentRegistry(): DeploymentRegistry {
  defaultRegistry ??= createDeploymentRegistry();
  return defaultRegistry;
}

/**
 * Convenience lookup against the default registry. See
 * {@link DeploymentRegistry.getDeployment} for the error contract.
 */
export function getDeployment(
  environment: ChainEnvironment,
  protocolVersion: ProtocolVersion,
  centrifugeId: number,
): Deployment {
  return defaultDeploymentRegistry().getDeployment(
    environment,
    protocolVersion,
    centrifugeId,
  );
}

type VerifiedData = Record<
  ChainEnvironment,
  Record<ProtocolVersion, Record<number, Deployment>>
>;

function verifyRegistryData(
  data: DeploymentRegistryData,
  abiSets: AbiSetsByVersion,
  schemas: ContractSchemasByVersion,
): VerifiedData {
  const verified: VerifiedData = { mainnet: {}, testnet: {} };

  for (const environment of Object.keys(data) as ChainEnvironment[]) {
    if (environment !== "mainnet" && environment !== "testnet") {
      throw new DeploymentVerificationError(
        environment,
        "unknown chain environment (expected mainnet or testnet)",
      );
    }

    for (const [version, byChain] of Object.entries(data[environment])) {
      const schema = resolveSchema(environment, version, schemas, abiSets);

      // ABI/schema consistency: an ABI without an address slot can never be
      // called through a resolved context.
      const abiSet = abiSets[version];
      if (abiSet) {
        const known = new Set([...schema.required, ...schema.optional]);
        for (const contractName of Object.keys(abiSet)) {
          if (!known.has(contractName)) {
            throw new DeploymentVerificationError(
              `${environment}.${version}.abis.${contractName}`,
              "ABI set contract is not part of this version's contract schema",
            );
          }
        }
      }

      verified[environment][version] = {};

      for (const [centrifugeId, input] of Object.entries(byChain)) {
        const path = `${environment}.${version}.${centrifugeId}`;
        verified[environment][version][Number(centrifugeId)] = verifyDeployment(
          path,
          input,
          schema,
        );
      }
    }
  }

  return verified;
}

function resolveSchema(
  environment: ChainEnvironment,
  version: ProtocolVersion,
  schemas: ContractSchemasByVersion,
  abiSets: AbiSetsByVersion,
): ContractSchema {
  const schema = schemas[version];
  if (schema) {
    return schema;
  }

  const abiSet = abiSets[version];
  if (!abiSet) {
    throw new DeploymentVerificationError(
      `${environment}.${version}`,
      "no contract schema and no ABI set registered for this protocol version",
    );
  }

  return { required: Object.keys(abiSet), optional: [] };
}

function verifyDeployment(
  path: string,
  input: DeploymentInput,
  schema: ContractSchema,
): Deployment {
  if (!Number.isInteger(input.chainId) || input.chainId <= 0) {
    throw new DeploymentVerificationError(
      `${path}.chainId`,
      `expected a positive integer EVM chain id, got ${String(input.chainId)}`,
    );
  }
  if (typeof input.name !== "string" || input.name.length === 0) {
    throw new DeploymentVerificationError(
      `${path}.name`,
      "expected a non-empty chain name",
    );
  }
  if (input.contracts === null || typeof input.contracts !== "object") {
    throw new DeploymentVerificationError(
      `${path}.contracts`,
      "expected an address set object",
    );
  }

  const contracts: Record<string, Address> = {};
  for (const contractName of schema.required) {
    const field = `${path}.contracts.${contractName}`;
    if (input.contracts[contractName] === undefined) {
      throw new DeploymentVerificationError(
        field,
        "missing contract address required by this version's contract schema",
      );
    }
  }

  const known = new Set([...schema.required, ...schema.optional]);
  for (const [contractName, address] of Object.entries(input.contracts)) {
    const field = `${path}.contracts.${contractName}`;
    if (!known.has(contractName)) {
      throw new DeploymentVerificationError(
        field,
        "unexpected contract not present in this version's contract schema",
      );
    }
    if (!isAddress(address)) {
      throw new DeploymentVerificationError(
        field,
        `"${address}" is not a valid (checksummed) EVM address`,
      );
    }
    contracts[contractName] = address;
  }

  const addressSet: AddressSet = contracts;
  return { chainId: input.chainId, name: input.name, contracts: addressSet };
}
