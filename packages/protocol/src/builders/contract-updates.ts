import {
  decodeFunctionData,
  toFunctionSelector,
  type Abi,
  type AbiFunction,
  type Hex,
} from "viem";
import { DEFAULT_ABI_SETS } from "../abis";
import {
  UnknownProtocolVersionError,
  UnsupportedForProtocolVersionError,
} from "../errors";
import type { ProtocolVersion } from "../types";
import { BATCH_ABIS } from "./batch";

/** One `Hub.updateContract` call found in a transaction. */
export interface DecodedContractUpdate {
  /** Position among the transaction's inner calls (0 for a bare call). */
  readonly callIndex: number;
  readonly poolId: string;
  readonly scId: Hex;
  readonly centrifugeId: number;
  readonly target: Hex;
  readonly payload: Hex;
  readonly extraGasLimit: string;
  readonly refundAddress: string;
}

/** Why the bytes could not be read as a list of calls. */
export type ContractUpdateDecodeFailure =
  "undecodable_multicall" | "nested_multicall" | "undecodable_update_contract";

export type ContractUpdateDecoding =
  | { readonly ok: true; readonly updates: readonly DecodedContractUpdate[] }
  | { readonly ok: false; readonly reason: ContractUpdateDecodeFailure };

interface VersionDecoder {
  readonly batch: Abi;
  readonly hub: Abi;
  /** `multicall` and `executeMulticall`: calls that wrap a list of calls. */
  readonly wrappers: ReadonlyMap<string, Abi>;
  /** v3.2 only. */
  readonly updateContract: string | null;
  /** v3.3 only. */
  readonly managerCall: string | null;
}

/** One `Hub.managerCall` found in a transaction (v3.3). */
export interface DecodedManagerCall {
  readonly callIndex: number;
  readonly poolId: string;
  readonly centrifugeId: number;
  readonly target: Hex;
  readonly payload: Hex;
  readonly extraGasLimit: string;
  readonly localValue: string;
  readonly refundAddress: string;
}

export type ManagerCallDecoding =
  | { readonly ok: true; readonly calls: readonly DecodedManagerCall[] }
  | { readonly ok: false; readonly reason: ContractUpdateDecodeFailure };

const decoders = new Map<ProtocolVersion, VersionDecoder>();

function selectorOf(abi: Abi, name: string): string {
  const selector = selectorOfOptional(abi, name);
  if (selector === null) {
    throw new Error(`ABI has no function ${name}`);
  }
  return selector;
}

function selectorOfOptional(abi: Abi, name: string): string | null {
  const item = abi.find(
    (entry): entry is AbiFunction =>
      entry.type === "function" && entry.name === name,
  );
  return item ? toFunctionSelector(item) : null;
}

/**
 * The version's ABIs and selectors, from the same tables the encoders use
 * (`BATCH_ABIS`, `DEFAULT_ABI_SETS`), computed once per version. v3.3 replaces
 * `Hub.updateContract` with `managerCall`, so its port extends this function.
 */
function decoderFor(protocolVersion: ProtocolVersion): VersionDecoder {
  const cached = decoders.get(protocolVersion);
  if (cached) {
    return cached;
  }
  const batch = BATCH_ABIS[protocolVersion];
  const hub = DEFAULT_ABI_SETS[protocolVersion]?.hub;
  if (!batch || !hub) {
    throw new UnknownProtocolVersionError(protocolVersion);
  }
  const decoder: VersionDecoder = {
    batch,
    hub,
    wrappers: new Map([
      [selectorOf(batch, "multicall"), batch],
      [selectorOf(hub, "executeMulticall"), hub],
    ]),
    updateContract: selectorOfOptional(hub, "updateContract"),
    managerCall: selectorOfOptional(hub, "managerCall"),
  };
  decoders.set(protocolVersion, decoder);
  return decoder;
}

/**
 * Every `Hub.updateContract` in the transaction bytes, read with the version's
 * own ABI: the inverse of the builders' encoding. A bare call and a one-level
 * `multicall` or `executeMulticall` are understood; a wrapper that does not
 * decode, a wrapper inside a wrapper, and an `updateContract` that does not
 * decode are reported as a failure, never skipped.
 *
 * @throws UnknownProtocolVersionError when the version has no bundled ABIs.
 */
export function decodeContractUpdates(
  protocolVersion: ProtocolVersion,
  data: Hex,
): ContractUpdateDecoding {
  const { hub, wrappers, updateContract } = decoderFor(protocolVersion);
  if (updateContract === null) {
    throw new UnsupportedForProtocolVersionError(
      "decodeContractUpdates",
      protocolVersion,
      "Hub.updateContract was replaced by Hub.managerCall; use decodeManagerCalls",
    );
  }
  const selectorIn = (call: Hex) => call.slice(0, 10).toLowerCase();

  let calls: readonly Hex[] = [data];
  const outer = wrappers.get(selectorIn(data));
  if (outer) {
    try {
      const decoded = decodeFunctionData({ abi: outer, data });
      const inner = decoded.args?.[0] as readonly Hex[] | undefined;
      if (inner === undefined) {
        return { ok: false, reason: "undecodable_multicall" };
      }
      calls = inner;
    } catch {
      return { ok: false, reason: "undecodable_multicall" };
    }
  }

  const updates: DecodedContractUpdate[] = [];
  for (const [callIndex, call] of calls.entries()) {
    const selector = selectorIn(call);
    if (wrappers.has(selector)) {
      return { ok: false, reason: "nested_multicall" };
    }
    if (selector !== updateContract) {
      continue;
    }
    try {
      const decoded = decodeFunctionData({ abi: hub, data: call });
      const [poolId, scId, centrifugeId, target, payload, gasLimit, refund] =
        decoded.args as readonly [
          bigint,
          Hex,
          number,
          Hex,
          Hex,
          bigint,
          string,
        ];
      updates.push({
        callIndex,
        poolId: poolId.toString(),
        scId,
        centrifugeId,
        target,
        payload,
        extraGasLimit: gasLimit.toString(),
        refundAddress: refund,
      });
    } catch {
      return { ok: false, reason: "undecodable_update_contract" };
    }
  }
  return { ok: true, updates };
}

/**
 * Every `Hub.managerCall` in the transaction bytes, read with the version's
 * own ABI: the v3.3 counterpart of {@link decodeContractUpdates}, with the
 * same wrapper rules.
 */
export function decodeManagerCalls(
  protocolVersion: ProtocolVersion,
  data: Hex,
): ManagerCallDecoding {
  const { hub, wrappers, managerCall } = decoderFor(protocolVersion);
  if (managerCall === null) {
    throw new UnsupportedForProtocolVersionError(
      "decodeManagerCalls",
      protocolVersion,
      "Hub.managerCall does not exist; use decodeContractUpdates",
    );
  }
  const selectorIn = (call: Hex) => call.slice(0, 10).toLowerCase();
  let calls: readonly Hex[] = [data];
  const outer = wrappers.get(selectorIn(data));
  if (outer) {
    try {
      const decoded = decodeFunctionData({ abi: outer, data });
      const inner = decoded.args?.[0] as readonly Hex[] | undefined;
      if (inner === undefined) {
        return { ok: false, reason: "undecodable_multicall" };
      }
      calls = inner;
    } catch {
      return { ok: false, reason: "undecodable_multicall" };
    }
  }
  const found: DecodedManagerCall[] = [];
  for (const [callIndex, call] of calls.entries()) {
    const selector = selectorIn(call);
    if (wrappers.has(selector)) {
      return { ok: false, reason: "nested_multicall" };
    }
    if (selector !== managerCall) {
      continue;
    }
    try {
      const decoded = decodeFunctionData({ abi: hub, data: call });
      const [
        poolId,
        centrifugeId,
        target,
        payload,
        gasLimit,
        localValue,
        refund,
      ] = decoded.args as readonly [
        bigint,
        number,
        Hex,
        Hex,
        bigint,
        bigint,
        string,
      ];
      found.push({
        callIndex,
        poolId: poolId.toString(),
        centrifugeId,
        target,
        payload,
        extraGasLimit: gasLimit.toString(),
        localValue: localValue.toString(),
        refundAddress: refund,
      });
    } catch {
      return { ok: false, reason: "undecodable_update_contract" };
    }
  }
  return { ok: true, calls: found };
}
