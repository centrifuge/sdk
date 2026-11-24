import { describe, expect, it } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  parseAbi,
  parseEventLogs,
  toEventSelector,
  toFunctionSelector,
} from "viem";
import { ABI_SET_V3_2, ABIS_V3_2, ALL_ABIS_V3_2 } from "./index";

const factory = "0x22E2f679669D69b6b6f22CC9C1731035a3Fa0296";
const manager = "0x5555555555555555555555555555555555555555";
const poolId = 281474976710657n;
const scId = "0x00010000000000010000000000000001";

// Signatures as declared in the protocol's IOnOffRampFactory and the legacy
// IOnOfframpManagerFactory.
const protocolEvents = parseAbi([
  "event DeployOnOffRamp(uint64 indexed poolId, bytes16 scId, address indexed manager)",
  "event DeployOnOfframpManager(uint64 indexed poolId, bytes16 scId, address indexed manager)",
]);

function deployLog(eventName: "DeployOnOffRamp" | "DeployOnOfframpManager") {
  return {
    address: factory,
    topics: encodeEventTopics({
      abi: protocolEvents,
      eventName,
      args: { poolId, manager },
    }),
    data: encodeAbiParameters([{ type: "bytes16" }], [scId]),
  } as never;
}

const FACTORY_ABI = {
  DeployOnOffRamp: ABI_SET_V3_2.onOffRampFactory!,
  DeployOnOfframpManager: ABI_SET_V3_2.onOfframpManagerFactory!,
} as const;

describe("on/off-ramp factory ABIs", () => {
  it("give both registry factory names the same newManager selector", () => {
    expect(ABI_SET_V3_2.onOffRampFactory).toBe(
      ABIS_V3_2.OnOffRampManagerFactory,
    );
    for (const abi of Object.values(FACTORY_ABI)) {
      const newManager = abi.find(
        (item) => item.type === "function" && item.name === "newManager",
      );
      expect(toFunctionSelector(newManager as never)).toBe(
        toFunctionSelector("newManager(uint64,bytes16)"),
      );
    }
  });

  it.each(["DeployOnOffRamp", "DeployOnOfframpManager"] as const)(
    "decode a %s log to its manager address through the v3.2 event ABIs",
    (eventName) => {
      expect(ALL_ABIS_V3_2).toContain(FACTORY_ABI[eventName]);
      const [event] = parseEventLogs({
        abi: FACTORY_ABI[eventName],
        logs: [deployLog(eventName)],
      }) as {
        eventName: string;
        topics: readonly string[];
        args: Record<string, unknown>;
      }[];
      expect(event?.eventName).toBe(eventName);
      expect(event?.topics[0]).toBe(
        toEventSelector(`${eventName}(uint64,bytes16,address)`),
      );
      expect(event?.args.manager).toBe(manager);
      expect(event?.args.scId).toBe(scId);
    },
  );
});
