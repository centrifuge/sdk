import {
  decodeEventLog,
  toEventSelector,
  type Abi,
  type AbiEvent,
  type Hex,
} from "viem";
import { DEFAULT_EVENT_ABIS } from "../abis";
import { EventDecodeError, UnknownProtocolVersionError } from "../errors";
import type { ProtocolVersion } from "../types";

/**
 * topic0 -> event definition, namespaced by protocol version. There is
 * deliberately NO global topic0 map: same-named events change signatures
 * across versions, and one event (SyncDepositVault `Deposit`) keeps its topic0
 * while swapping argument meaning — a version-less table would decode it
 * wrongly and silently (restructure constraints, rule 7).
 */
export type EventDecodeTable = Readonly<
  Record<ProtocolVersion, Readonly<Record<Hex, readonly AbiEvent[]>>>
>;

/**
 * One registration unit for {@link createEventDecodeTable}. The version key is
 * required by the type: a topic0 cannot be registered without saying which
 * protocol version it decodes for.
 */
export interface EventTableSource {
  readonly protocolVersion: ProtocolVersion;
  readonly abis: readonly Abi[];
}

/** A decoded protocol event. */
export interface DecodedProtocolEvent {
  readonly eventName: string;
  readonly args: unknown;
}

export function createEventDecodeTable(
  sources: readonly EventTableSource[],
): EventDecodeTable {
  const table: Record<ProtocolVersion, Record<Hex, AbiEvent[]>> = {};

  for (const source of sources) {
    const byTopic = (table[source.protocolVersion] ??= {});

    for (const abi of source.abis) {
      for (const item of abi) {
        if (item.type !== "event") {
          continue;
        }

        const topic0 = toEventSelector(item);
        const candidates = (byTopic[topic0] ??= []);
        if (!candidates.some((existing) => sameLayout(existing, item))) {
          candidates.push(item);
        }
      }
    }
  }

  return table;
}

let defaultTable: EventDecodeTable | undefined;

/**
 * The decode table over the bundled per-version event ABIs (every ABI of the
 * version, instance ABIs included), built lazily.
 */
export function defaultEventDecodeTable(): EventDecodeTable {
  defaultTable ??= createEventDecodeTable(
    Object.entries(DEFAULT_EVENT_ABIS).map(([protocolVersion, abis]) => ({
      protocolVersion,
      abis,
    })),
  );
  return defaultTable;
}

/**
 * Decode a log against the table entry for `(protocolVersion, topics[0])`.
 * The version key is mandatory — there is no version-less decode. Throws
 * {@link UnknownProtocolVersionError} for an unregistered version and
 * {@link EventDecodeError} for an unregistered or undecodable topic0.
 */
export function selectEventLayout(
  candidates: readonly AbiEvent[],
  topics: readonly Hex[],
): AbiEvent | undefined {
  return candidates.find(
    (candidate) => indexedCount(candidate) === topics.length - 1,
  );
}

function indexedCount(event: AbiEvent): number {
  return event.inputs.filter((input) => input.indexed).length;
}

function sameLayout(a: AbiEvent, b: AbiEvent): boolean {
  return (
    a.inputs.length === b.inputs.length &&
    a.inputs.every((input, i) => {
      const other = b.inputs[i];
      return (
        other !== undefined &&
        input.type === other.type &&
        (input.indexed ?? false) === (other.indexed ?? false)
      );
    })
  );
}

export function decodeProtocolEvent(
  protocolVersion: ProtocolVersion,
  log: { readonly topics: readonly Hex[]; readonly data: Hex },
  table: EventDecodeTable = defaultEventDecodeTable(),
): DecodedProtocolEvent {
  const byTopic = table[protocolVersion];
  if (!byTopic) {
    throw new UnknownProtocolVersionError(protocolVersion);
  }

  const topic0 = log.topics[0];
  if (!topic0) {
    throw new EventDecodeError(
      protocolVersion,
      "(none)",
      "log carries no topics (anonymous events are not supported)",
    );
  }

  const candidates = byTopic[topic0];
  if (!candidates) {
    throw new EventDecodeError(
      protocolVersion,
      topic0,
      "no event registered for this topic0 in this version",
    );
  }

  const event = selectEventLayout(candidates, log.topics);
  if (!event) {
    throw new EventDecodeError(
      protocolVersion,
      topic0,
      `no registered "${candidates[0]?.name}" layout carries ` +
        `${log.topics.length - 1} indexed argument(s)`,
    );
  }

  try {
    const decoded = decodeEventLog({
      abi: [event],
      data: log.data,
      topics: log.topics as [Hex, ...Hex[]],
    });

    return { eventName: decoded.eventName, args: decoded.args };
  } catch (cause) {
    throw new EventDecodeError(
      protocolVersion,
      topic0,
      `log data does not match the registered "${event.name}" definition ` +
        `(${cause instanceof Error ? cause.message : String(cause)})`,
    );
  }
}
