import { describe, expect, it } from "vitest";
import { parseAbi } from "viem";
import { abiDigest, canonicalAbiJson } from "./digest";
import { GENERATED_ABIS_V3_2 } from "./v3_2";

describe("abiDigest", () => {
  const abi = parseAbi([
    "event NotifyPool(uint16 indexed centrifugeId, uint64 indexed poolId)",
    "function createPool(uint64 poolId, address admin, uint128 currency) payable",
  ]);

  it("matches the digest the address book computes for the shared vector", () => {
    const vector = JSON.parse(
      '[{"name":"NotifyPool","type":"event","inputs":[{"type":"uint16","indexed":true,"name":"centrifugeId"},{"name":"poolId","indexed":true,"type":"uint64"}],"anonymous":false},{"type":"function","stateMutability":"payable","name":"createPool","outputs":[],"inputs":[{"name":"poolId","type":"uint64"},{"type":"address","name":"admin"},{"name":"currency","type":"uint128"}]}]',
    );

    expect(abiDigest(vector)).toBe(
      "0xf890bd15ebd9ce81229b556822ac3de66bdb12f7a970a8cc96246c3d97c3aeca",
    );
  });

  it("is a sha256 hex string", () => {
    expect(abiDigest(abi)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("ignores object key order", () => {
    const reordered = JSON.parse(
      JSON.stringify(abi, (_key, value) =>
        value !== null && typeof value === "object" && !Array.isArray(value)
          ? Object.fromEntries(Object.entries(value).reverse())
          : value,
      ),
    );

    expect(canonicalAbiJson(reordered)).toBe(canonicalAbiJson(abi));
    expect(abiDigest(reordered)).toBe(abiDigest(abi));
  });

  it("changes when an item changes or moves", () => {
    const renamed = parseAbi([
      "event NotifyPool(uint16 indexed centrifugeId, uint64 indexed pool)",
      "function createPool(uint64 poolId, address admin, uint128 currency) payable",
    ]);
    const reversed = [...abi].reverse();

    expect(abiDigest(renamed)).not.toBe(abiDigest(abi));
    expect(abiDigest(reversed)).not.toBe(abiDigest(abi));
  });

  it("digests every generated v3.2 ABI", () => {
    for (const abi of Object.values(GENERATED_ABIS_V3_2)) {
      expect(abiDigest(abi)).toMatch(/^0x[0-9a-f]{64}$/);
    }
  });
});
