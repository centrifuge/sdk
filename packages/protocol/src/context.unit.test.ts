import { describe, expect, it } from "vitest";
import { DEFAULT_ABI_SETS, getAbiSet, getInstanceAbi } from "./abis";
import { UnknownDeploymentError, UnknownProtocolVersionError } from "./errors";
import { resolveProtocolContext } from "./context";
import { centrifugeIdFromPoolId, PROTOCOL_VERSION_V3_2 } from "./types";

describe("centrifugeIdFromPoolId", () => {
  it("extracts the centrifugeId from the high 16 bits of a raw pool id", () => {
    // (1n << 48n) + 1n
    expect(centrifugeIdFromPoolId("281474976710657")).toBe(1);
    // (2n << 48n) + 7n
    expect(centrifugeIdFromPoolId("562949953421319")).toBe(2);
  });

  it("accepts a bigint", () => {
    expect(centrifugeIdFromPoolId((3n << 48n) + 9n)).toBe(3);
  });
});

describe("resolveProtocolContext", () => {
  it("resolves the pool's home deployment and version-keyed ABIs once", () => {
    const ctx = resolveProtocolContext(
      "281474976710657",
      PROTOCOL_VERSION_V3_2,
      { environment: "mainnet" },
    );

    expect(ctx.poolId).toBe("281474976710657");
    expect(ctx.protocolVersion).toBe(PROTOCOL_VERSION_V3_2);
    expect(ctx.chainId).toBe(1);
    expect(ctx.addresses.hub).toBe(
      "0xA4A7Bb3831958463b3FE3E27A6a160F764341953",
    );
    expect(ctx.abis.hub).toBeDefined();
    expect(ctx.abis.hubRegistry).toBeDefined();
  });

  it("tracks the environment: the same pool resolves to Sepolia on testnet", () => {
    const ctx = resolveProtocolContext(
      "281474976710657",
      PROTOCOL_VERSION_V3_2,
      { environment: "testnet" },
    );

    expect(ctx.chainId).toBe(11155111);
    expect(ctx.addresses.hub).toBe(
      "0xb2D1EBaEB0007578B09a555F8FB05DaD9150cFDD",
    );
  });

  it("throws for an unknown protocol version", () => {
    expect(() =>
      resolveProtocolContext("281474976710657", "0.0", {
        environment: "mainnet",
      }),
    ).toThrow(UnknownProtocolVersionError);
  });

  it("throws for a pool on an unregistered chain", () => {
    const poolOnUnknownChain = ((9999n << 48n) + 1n).toString();
    expect(() =>
      resolveProtocolContext(poolOnUnknownChain, PROTOCOL_VERSION_V3_2, {
        environment: "mainnet",
      }),
    ).toThrow(UnknownDeploymentError);
  });
});

// Literal strings: `chain_v1.pool.protocol_version` stores "3.2" for the
// deployed stack, and the registry must answer that value as-is.
describe('the deployed stack is keyed "3.2"', () => {
  it('resolves a pool read as "3.2" to the deployed address set', () => {
    expect(PROTOCOL_VERSION_V3_2).toBe("3.2");
    const ctx = resolveProtocolContext("281474976710657", "3.2", {
      environment: "mainnet",
    });

    expect(ctx.protocolVersion).toBe("3.2");
    expect(ctx.addresses.hub).toBe(
      "0xA4A7Bb3831958463b3FE3E27A6a160F764341953",
    );
    expect(getAbiSet("3.2")).toBe(DEFAULT_ABI_SETS["3.2"]);
  });

  it('refuses "3.1" everywhere a version is resolved', () => {
    expect(() => getAbiSet("3.1")).toThrow(UnknownProtocolVersionError);
    expect(() => getInstanceAbi("3.1", "onOffRampManager")).toThrow(
      UnknownProtocolVersionError,
    );
    expect(() =>
      resolveProtocolContext("281474976710657", "3.1", {
        environment: "mainnet",
      }),
    ).toThrow(UnknownProtocolVersionError);
  });
});
