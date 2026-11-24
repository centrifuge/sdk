import type { RegistryLayerRef } from "./abis/registry-chain";
import type { BookAbiMismatch } from "./abis/verify";
import type { Hex } from "viem";
import type { ChainEnvironment, ProtocolVersion } from "./types";

/**
 * A deployment address set failed schema validation at load: a field is
 * missing, malformed, or unexpected. Names the exact field so a bad registry
 * refresh fails loudly at startup instead of surfacing as an undefined address
 * at write time (restructure constraints, rule 8 — replaces the previous
 * silent-delete behaviour).
 */
export class DeploymentVerificationError extends Error {
  /** Dotted path of the offending field, e.g. `mainnet.3.2.2.contracts.hub`. */
  readonly field: string;

  constructor(field: string, reason: string) {
    super(`Deployment verification failed at "${field}": ${reason}`);
    this.name = "DeploymentVerificationError";
    this.field = field;
  }
}

/**
 * No deployment is registered for `(environment, protocolVersion,
 * centrifugeId)`. Callers typically map this to a 4xx.
 */
export class UnknownDeploymentError extends Error {
  constructor(
    readonly environment: ChainEnvironment,
    readonly protocolVersion: ProtocolVersion,
    readonly centrifugeId: number,
  ) {
    super(
      `No deployment registered for environment "${environment}", ` +
        `protocol version "${protocolVersion}", centrifugeId ${centrifugeId}`,
    );
    this.name = "UnknownDeploymentError";
  }
}

/**
 * The default deployment registry cannot be replaced: it is already
 * initialised, or code resolved it before the initialisation. Swapping the
 * registry under live callers would mix two address sets in one process.
 */
export class DefaultDeploymentRegistryLockedError extends Error {
  constructor(reason: string) {
    super(`The default deployment registry ${reason}`);
    this.name = "DefaultDeploymentRegistryLockedError";
  }
}

/** A protocol version with no registered ABI set / registry entry. */
export class UnknownProtocolVersionError extends Error {
  constructor(readonly protocolVersion: ProtocolVersion) {
    super(`Unknown protocol version "${protocolVersion}"`);
    this.name = "UnknownProtocolVersionError";
  }
}

/**
 * No per-pool / per-share-class ABI is bundled under that name for the given
 * protocol version. A caller bug (a typo, or a contract that only exists in
 * another version) — raised instead of handing `encodeFunctionData` an
 * `undefined` ABI, which fails much further from the cause.
 */
export class UnknownInstanceAbiError extends Error {
  constructor(
    readonly protocolVersion: ProtocolVersion,
    readonly contract: string,
  ) {
    super(
      `No instance ABI named "${contract}" is bundled for protocol version ` +
        `"${protocolVersion}"`,
    );
    this.name = "UnknownInstanceAbiError";
  }
}

/**
 * A log could not be decoded: its `topic0` is not registered for the given
 * protocol version. Decoding is version-namespaced by construction — the same
 * topic0 can mean different arguments across versions (restructure
 * constraints, rule 7) — so there is deliberately no version-less lookup to
 * fall back to.
 */
export class EventDecodeError extends Error {
  constructor(
    readonly protocolVersion: ProtocolVersion,
    readonly topic0: string,
    reason: string,
  ) {
    super(
      `Cannot decode event topic0 ${topic0} for protocol version ` +
        `"${protocolVersion}": ${reason}`,
    );
    this.name = "EventDecodeError";
  }
}

/**
 * The pool's protocol version could not be determined. Thrown by the `Reader`
 * when the pools catalogue entry carries no version for the pool, when the
 * projected version is not registered for the pool's chain, when the entry
 * does not list the pool while several versions are deployed on its chain,
 * or when the chain has no deployment at all.
 */
export class ProtocolVersionResolutionError extends Error {
  constructor(
    readonly subject: string,
    reason: string,
  ) {
    super(`Cannot resolve protocol version for ${subject}: ${reason}`);
    this.name = "ProtocolVersionResolutionError";
  }
}

/**
 * A builder was called with arguments that contradict its resolved
 * `ProtocolContext` (e.g. a pool id differing from the one the context was
 * resolved for). Always a caller bug — contexts are resolved per operation
 * and must not be reused across pools.
 */
export class BuilderArgumentMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BuilderArgumentMismatchError";
  }
}

/**
 * A builder was asked to encode a call the resolved protocol version does not
 * have: the function was removed, replaced by another entry point, or has not
 * been ported yet. The typed refusal every v3.3 write must raise instead of
 * encoding another version's calldata.
 */
export class UnsupportedForProtocolVersionError extends UnknownProtocolVersionError {
  constructor(
    readonly builder: string,
    protocolVersion: ProtocolVersion,
    reason: string,
  ) {
    super(protocolVersion);
    this.message = `${builder} is not available on protocol version ${protocolVersion}: ${reason}`;
    this.name = "UnsupportedForProtocolVersionError";
  }
}

export class RegistryLayerFetchError extends Error {
  constructor(
    readonly ref: RegistryLayerRef,
    readonly failures: readonly string[],
  ) {
    super(
      `Could not fetch registry layer ${"url" in ref ? ref.url : ref.ipfsHash}:\n` +
        failures.map((failure) => `  ${failure}`).join("\n"),
    );
    this.name = "RegistryLayerFetchError";
  }
}

/**
 * The active address book does not record, for the contract a build targets on
 * this chain, the ABI digest of the ABI the build encodes the call with: no
 * address, no ABI record, or another digest. The calldata may then revert
 * there, so nothing is signed; there is no per-chain ABI override. `served` is
 * false when the registry does not serve `protocolVersion` in `environment` at
 * all; the book is not read then, so `address` and `bookDigest` are null.
 */
export class DeployedContractVersionError extends Error {
  constructor(
    readonly operation: string,
    readonly environment: ChainEnvironment,
    readonly centrifugeId: number,
    readonly chainName: string | null,
    readonly contract: string,
    readonly protocolVersion: ProtocolVersion,
    readonly address: string | null,
    readonly bookDigest: Hex | null,
    readonly buildDigest: Hex,
    readonly served: boolean = true,
  ) {
    const chain = `${environment} centrifugeId ${centrifugeId}${chainName ? ` (${chainName})` : ""}`;
    super(
      served
        ? `${operation} is not available on ${chain}: the address book records ${contract} at ` +
            `${address ?? "no address"} with ABI digest ${bookDigest ?? "none"}, not the protocol ` +
            `${protocolVersion} ABI this build encodes calls with (${buildDigest})`
        : `${operation} is not available on ${chain}: protocol ${protocolVersion} is not served on ${environment}`,
    );
    this.name = "DeployedContractVersionError";
  }
}

/** One line naming where the digests differ and both digests. */
export function describeBookAbiMismatch(mismatch: BookAbiMismatch): string {
  const { network, centrifugeId, chainId, version, stack, contract } = mismatch;
  const abiName = mismatch.abiName ?? "no ABI record";
  return (
    `${network} centrifugeId ${centrifugeId} (chain ${chainId}), ` +
    `protocol ${version} stack ${stack}, ${contract} (${abiName}) at ${mismatch.address}: ` +
    `book ${mismatch.bookDigest ?? "none"}, generated ${mismatch.generatedDigest}`
  );
}

/**
 * A loaded address book records, for an address this build signs with, an ABI
 * digest other than the ABI built into the release, or no ABI record at all.
 */
export class AddressBookAbiMismatchError extends Error {
  constructor(
    readonly bookId: string,
    readonly mismatches: readonly BookAbiMismatch[],
  ) {
    const count = mismatches.length;
    const addresses = count === 1 ? "1 address" : `${count} addresses`;
    super(
      `The address book ${bookId} is refused: the ABI digest of ${addresses} differs from the ABI ` +
        `built into this release, so calls would be encoded with the wrong ABI. Use the bundled ` +
        "address book, or build the book from the registry heads the bundled book pins. A build " +
        "of your own can instead pin the @centrifuge/addressbook release the book was built " +
        "with, which ships that book's ABIs.\n" +
        mismatches.map((m) => `  ${describeBookAbiMismatch(m)}`).join("\n"),
    );
    this.name = "AddressBookAbiMismatchError";
  }
}
