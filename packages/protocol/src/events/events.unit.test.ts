import { describe, expect, it } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  parseAbi,
  toEventSelector,
  type Hex,
} from "viem";
import { ABI_SET_V3_2 } from "../abis";
import { EventDecodeError, UnknownProtocolVersionError } from "../errors";
import { PROTOCOL_VERSION_V3_2 } from "../types";
import { createEventDecodeTable, decodeProtocolEvent } from "./index";

/**
 * Encode a real v3.2 Hub log (`NotifyPool`) to round-trip through the decode
 * table. Both args are indexed, so the data segment is empty.
 */
function notifyPoolLog(): { topics: readonly Hex[]; data: Hex } {
  // `encodeEventTopics` types its result as (Hex | Hex[] | null)[] to cover
  // filter-style inputs; fully-specified args always produce plain topics.
  const topics = encodeEventTopics({
    abi: ABI_SET_V3_2.hub,
    eventName: "NotifyPool",
    args: { centrifugeId: 2, poolId: 562949953421319n },
  }) as readonly Hex[];
  return { topics, data: "0x" };
}

describe("version-namespaced event decoding", () => {
  it("round-trips a v3.2 Hub log through the default table", () => {
    const decoded = decodeProtocolEvent(PROTOCOL_VERSION_V3_2, notifyPoolLog());

    expect(decoded.eventName).toBe("NotifyPool");
    expect(decoded.args).toEqual({
      centrifugeId: 2,
      poolId: 562949953421319n,
    });
  });

  it("refuses to decode without a registered version key — no global table", () => {
    expect(() => decodeProtocolEvent("0.0", notifyPoolLog())).toThrow(
      UnknownProtocolVersionError,
    );
  });

  it("throws EventDecodeError for a topic0 not registered in the version", () => {
    const topics = encodeEventTopics({
      abi: parseAbi(["event SomethingElse(uint64 indexed poolId)"]),
      eventName: "SomethingElse",
      args: { poolId: 1n },
    }) as readonly Hex[];

    expect(() =>
      decodeProtocolEvent(PROTOCOL_VERSION_V3_2, { topics, data: "0x" }),
    ).toThrow(EventDecodeError);
  });

  it("keys registrations by version: the SAME topic0 can carry different definitions per version", () => {
    // Same event signature (same topic0), different indexed layout — the
    // SyncDepositVault `Deposit` situation: topic0 survives a version bump
    // while argument meaning moves. A global table could hold only one.
    const v1 = parseAbi([
      "event Deposit(address indexed sender, uint256 assets)",
    ]);
    const v2 = parseAbi([
      "event Deposit(address sender, uint256 indexed assets)",
    ]);

    const table = createEventDecodeTable([
      { protocolVersion: "1.0", abis: [v1] },
      { protocolVersion: "2.0", abis: [v2] },
    ]);

    // v1-encoded bytes: indexed sender in topics[1], assets in data.
    const log = {
      topics: encodeEventTopics({
        abi: v1,
        eventName: "Deposit",
        args: { sender: "0xA4A7Bb3831958463b3FE3E27A6a160F764341953" },
      }) as readonly Hex[],
      data: encodeAbiParameters([{ type: "uint256" }], [42n]),
    };

    const decodedV1 = decodeProtocolEvent("1.0", log, table);
    expect(decodedV1.args).toEqual({
      sender: "0xA4A7Bb3831958463b3FE3E27A6a160F764341953",
      assets: 42n,
    });

    // The identical bytes decode to something ELSE under v2's definition —
    // the version key, not the topic0, decides which decoder applies. This is
    // exactly the silent mis-decode a global topic0 table would produce.
    const decodedV2 = decodeProtocolEvent("2.0", log, table);
    expect(decodedV2.args).not.toEqual(decodedV1.args);
  });

  it("keeps every indexed layout of one topic0 within a version and picks by topic count", () => {
    const indexedWhat = parseAbi([
      "event File(bytes32 indexed what, address data)",
    ]);
    const plainWhat = parseAbi(["event File(bytes32 what, address addr)"]);
    const table = createEventDecodeTable([
      { protocolVersion: "1.0", abis: [indexedWhat, plainWhat] },
    ]);
    const what =
      "0x6761746577617900000000000000000000000000000000000000000000000000";
    const addr = "0xA4A7Bb3831958463b3FE3E27A6a160F764341953";

    const indexedLog = {
      topics: encodeEventTopics({
        abi: indexedWhat,
        eventName: "File",
        args: { what },
      }) as readonly Hex[],
      data: encodeAbiParameters([{ type: "address" }], [addr]),
    };
    expect(decodeProtocolEvent("1.0", indexedLog, table).args).toEqual({
      what,
      data: addr,
    });

    const plainLog = {
      topics: encodeEventTopics({
        abi: plainWhat,
        eventName: "File",
      }) as readonly Hex[],
      data: encodeAbiParameters(
        [{ type: "bytes32" }, { type: "address" }],
        [what, addr],
      ),
    };
    expect(decodeProtocolEvent("1.0", plainLog, table).args).toEqual({
      what,
      addr,
    });
  });

  it("throws when no registered layout matches the log's topic count", () => {
    const abi = parseAbi(["event File(bytes32 indexed what, address data)"]);
    const table = createEventDecodeTable([
      { protocolVersion: "1.0", abis: [abi] },
    ]);
    const topics = encodeEventTopics({
      abi,
      eventName: "File",
      args: { what: `0x${"11".repeat(32)}` },
    }) as readonly Hex[];

    expect(() =>
      decodeProtocolEvent("1.0", { topics: [topics[0]!], data: "0x" }, table),
    ).toThrow(EventDecodeError);
  });

  it("computes topic0 from the event definition", () => {
    const table = createEventDecodeTable([
      { protocolVersion: PROTOCOL_VERSION_V3_2, abis: [ABI_SET_V3_2.hub] },
    ]);
    const notifyPoolTopic0 = toEventSelector(
      "event NotifyPool(uint16 indexed centrifugeId, uint64 indexed poolId)",
    );

    expect(table[PROTOCOL_VERSION_V3_2][notifyPoolTopic0]).toBeDefined();
  });
});
