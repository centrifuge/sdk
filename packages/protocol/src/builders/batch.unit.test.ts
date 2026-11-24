import { describe, expect, it } from "vitest";
import { encodeFunctionData } from "viem";
import { ABIS_V3_2 } from "../abis/v3_2";
import {
  BuilderArgumentMismatchError,
  UnknownProtocolVersionError,
} from "../errors";
import { PROTOCOL_VERSION_V3_2 } from "../types";
import { encodeBatchCalldata } from "./batch";

const CALL_A = `0x${"aa".repeat(36)}` as const;
const CALL_B = `0x${"bb".repeat(36)}` as const;

describe("encodeBatchCalldata", () => {
  it("sends a single call verbatim, with no multicall wrapper", () => {
    // Matches the SDK's `encodeBatchCalldata`. Wrapping a lone call would
    // change the bytes for every single-call action and break the per-version
    // parity fixtures.
    expect(encodeBatchCalldata(PROTOCOL_VERSION_V3_2, [CALL_A])).toBe(CALL_A);
  });

  it("wraps two or more calls in multicall(bytes[])", () => {
    expect(encodeBatchCalldata(PROTOCOL_VERSION_V3_2, [CALL_A, CALL_B])).toBe(
      encodeFunctionData({
        abi: ABIS_V3_2.Multicall,
        functionName: "multicall",
        args: [[CALL_A, CALL_B]],
      }),
    );
  });

  it("refuses an empty batch", () => {
    expect(() => encodeBatchCalldata(PROTOCOL_VERSION_V3_2, [])).toThrow(
      BuilderArgumentMismatchError,
    );
  });

  it("refuses a protocol version with no bundled multicall fragment", () => {
    // Version-keyed by construction (restructure constraints, rule 1): adding
    // a version means adding one entry here, never a silent global default.
    expect(() => encodeBatchCalldata("9.9", [CALL_A, CALL_B])).toThrow(
      UnknownProtocolVersionError,
    );
  });
});
