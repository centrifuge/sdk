import type { Abi } from "viem";
import {
  UnknownInstanceAbiError,
  UnknownProtocolVersionError,
  UnsupportedForProtocolVersionError,
} from "../errors";
import {
  PROTOCOL_VERSION_V3_2,
  PROTOCOL_VERSION_V3_3,
  type AbiSet,
  type AbiSetsByVersion,
  type ProtocolVersion,
} from "../types";
import {
  ABI_SET_V3_2,
  ABIS_V3_2,
  ALL_ABIS_V3_2,
  INSTANCE_ABI_SET_V3_2,
} from "./v3_2";
import {
  ABI_SET_V3_3,
  ABIS_V3_3,
  ALL_ABIS_V3_3,
  INSTANCE_ABI_SET_V3_3,
} from "./v3_3";

export * from "./v3_2";
export * from "./v3_3";
export {
  GENERATED_ABIS_V33_MIGRATION,
  V33_MIGRATION_ABI_V3_3,
} from "@centrifuge/addressbook/abis";
export * from "./digest";
export * from "./registry-chain";
export * from "./signatures";
export * from "./verify";

/**
 * All bundled ABI sets, keyed by protocol version (restructure constraints,
 * rule 1). Adding a protocol version means adding one `abis/v<version>/`
 * directory and registering it here — nothing else changes.
 */
export const DEFAULT_ABI_SETS: AbiSetsByVersion = {
  [PROTOCOL_VERSION_V3_2]: ABI_SET_V3_2,
  [PROTOCOL_VERSION_V3_3]: ABI_SET_V3_3,
};

/**
 * Per-version event-decode sources: every bundled ABI of the version,
 * including instance ABIs (vault tokens, per-pool managers) that carry no
 * registry address. `defaultEventDecodeTable` builds from these, so decode
 * coverage is version-complete, never limited to registry contracts.
 */
export const DEFAULT_EVENT_ABIS: Readonly<
  Record<ProtocolVersion, readonly Abi[]>
> = {
  [PROTOCOL_VERSION_V3_2]: ALL_ABIS_V3_2,
  [PROTOCOL_VERSION_V3_3]: ALL_ABIS_V3_3,
};

/**
 * Per-version ABIs of contracts deployed per pool or per share class — the
 * on/off-ramp manager, the merkle-proof manager, a vault. They carry no
 * registry address, so they cannot live in the address-keyed {@link AbiSet}
 * (see `INSTANCE_ABI_SET_V3_2`), but a builder still needs them keyed by
 * version.
 */
export const DEFAULT_INSTANCE_ABI_SETS: AbiSetsByVersion = {
  [PROTOCOL_VERSION_V3_2]: INSTANCE_ABI_SET_V3_2,
  [PROTOCOL_VERSION_V3_3]: INSTANCE_ABI_SET_V3_3,
};

/**
 * Resolve the ABI of a per-pool / per-share-class contract for a protocol
 * version. Throws {@link UnknownProtocolVersionError} for a version with no
 * bundled set, and {@link UnknownInstanceAbiError} for an unknown contract name
 * — never `undefined`, which would reach `encodeFunctionData` as a silent
 * "function not found" much further from the cause.
 */
export function getInstanceAbi(
  protocolVersion: ProtocolVersion,
  contract: string,
  abiSets: AbiSetsByVersion = DEFAULT_INSTANCE_ABI_SETS,
): Abi {
  const set = abiSets[protocolVersion];
  if (!set) {
    throw new UnknownProtocolVersionError(protocolVersion);
  }
  const abi = set[contract];
  if (!abi) {
    throw new UnknownInstanceAbiError(protocolVersion, contract);
  }

  return abi;
}

/**
 * The typed, contract-name-keyed ABIs the SDK encodes and reads against
 * (`Hub`, `VaultRouter`, ...), shaped like {@link ABIS_V3_2}. The type is the
 * 3.2 shape on purpose: a later version whose signature differs for one
 * contract is not widened into this type, it branches at the call site or
 * goes through a version-specific builder, so a 3.2-shaped encode can never
 * target a 3.3 pool silently.
 */
export type ContractAbis = typeof ABIS_V3_2;

/** Typed v3.3 contract ABIs, keyed by contract name. */
export type ContractAbisV3_3 = typeof ABIS_V3_3;

/** v3.2 contract names whose v3.3 contract was renamed with the same surface the SDK uses. */
const RENAMED_IN_V3_3: Readonly<Record<string, keyof ContractAbisV3_3>> = {
  OnOffRampManager: "OnOffRamp",
  OnOffRampManagerFactory: "OnOffRampFactory",
  PoolEscrow: "Escrow",
  PoolEscrowFactory: "EscrowFactory",
};

/**
 * The v3.3 ABIs under the v3.2 contract names, for the SDK call sites whose
 * call is the same on both versions (vault requests, reads, notify messages).
 *
 * Typed as {@link ContractAbis} so those sites stay version-neutral, and that
 * type is a promise only about the call sites that did not change. A call
 * v3.3 removed or re-shaped branches on the version before it encodes and
 * goes through a builder or {@link ABIS_V3_3}. Reading a contract v3.3
 * deleted (`BalanceSheet`, `VaultRegistry`, the merkle-proof manager) throws
 * {@link UnsupportedForProtocolVersionError}, so a missed site fails at the
 * read instead of encoding against nothing.
 */
const CONTRACT_ABIS_V3_3_BY_V3_2_NAME: ContractAbis = (() => {
  const view: Record<string, unknown> = {};
  for (const name of Object.keys(ABIS_V3_2)) {
    const v3_3Name = RENAMED_IN_V3_3[name] ?? name;
    if (v3_3Name in ABIS_V3_3) {
      view[name] = ABIS_V3_3[v3_3Name as keyof ContractAbisV3_3];
    } else {
      Object.defineProperty(view, name, {
        enumerable: false,
        get() {
          throw new UnsupportedForProtocolVersionError(
            `ContractAbis.${name}`,
            PROTOCOL_VERSION_V3_3,
            `${name} does not exist on protocol v3.3`,
          );
        },
      });
    }
  }
  return Object.freeze(view) as unknown as ContractAbis;
})();

/** Typed contract ABIs keyed by protocol version. */
export const CONTRACT_ABIS_BY_VERSION: Readonly<
  Record<ProtocolVersion, ContractAbis>
> = {
  [PROTOCOL_VERSION_V3_2]: ABIS_V3_2,
  [PROTOCOL_VERSION_V3_3]: CONTRACT_ABIS_V3_3_BY_V3_2_NAME,
};

/**
 * Resolve the typed contract ABIs for a protocol version. Throws
 * {@link UnknownProtocolVersionError} for a version with no bundled set.
 */
export function getContractAbis(
  protocolVersion: ProtocolVersion,
  abis: Readonly<
    Record<ProtocolVersion, ContractAbis>
  > = CONTRACT_ABIS_BY_VERSION,
): ContractAbis {
  const set = abis[protocolVersion];
  if (!set) {
    throw new UnknownProtocolVersionError(protocolVersion);
  }
  return set;
}

/**
 * Interfaces that are not protocol contracts and do not change with the
 * protocol version: ERC-20 (`Currency`), ERC-6909 and the `multicall(bytes[])`
 * fragment every batching contract shares. Resolved without a protocol
 * context, since there is no version to resolve.
 */
export const STANDARD_ABIS = {
  Currency: ABIS_V3_2.Currency,
  ERC6909: ABIS_V3_2.ERC6909,
  Multicall: ABIS_V3_2.Multicall,
} as const;

/**
 * Resolve the ABI set for a protocol version. Throws
 * {@link UnknownProtocolVersionError} for a version with no bundled set.
 */
export function getAbiSet(
  protocolVersion: ProtocolVersion,
  abiSets: AbiSetsByVersion = DEFAULT_ABI_SETS,
): AbiSet {
  const set = abiSets[protocolVersion];
  if (!set) {
    throw new UnknownProtocolVersionError(protocolVersion);
  }

  return set;
}
