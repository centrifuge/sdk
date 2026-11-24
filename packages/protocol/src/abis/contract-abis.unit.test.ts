import { describe, expect, it } from "vitest";
import {
  ABIS_V3_2,
  CONTRACT_ABIS_BY_VERSION,
  getContractAbis,
  STANDARD_ABIS,
} from "./index";
import { UnknownProtocolVersionError } from "../errors";
import { PROTOCOL_VERSION_V3_2 } from "../types";

describe("getContractAbis", () => {
  it("answers the typed set of a registered version", () => {
    expect(getContractAbis(PROTOCOL_VERSION_V3_2)).toBe(ABIS_V3_2);
    expect(CONTRACT_ABIS_BY_VERSION[PROTOCOL_VERSION_V3_2]).toBe(ABIS_V3_2);
  });

  it("throws for a version with no bundled set", () => {
    expect(() => getContractAbis("9.9")).toThrow(UnknownProtocolVersionError);
  });
});

describe("STANDARD_ABIS", () => {
  it("carries only the version-independent interfaces", () => {
    expect(Object.keys(STANDARD_ABIS).sort()).toEqual([
      "Currency",
      "ERC6909",
      "Multicall",
    ]);
  });
});
