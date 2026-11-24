import { describe, expect, it } from "vitest";
import { centrifugeIdFromPoolId, poolIdFromShareClassId } from "./types";

/**
 * The two id derivations. Both are load-bearing for authorization rather than
 * convenience: `poolIdFromShareClassId` is what lets a write path refuse a
 * share class belonging to another pool without a projection round trip, so a
 * silently wrong answer here would defeat a tenancy check rather than produce a
 * visible error.
 */
describe("centrifugeIdFromPoolId", () => {
  it("reads the high 16 bits of a uint64 pool id", () => {
    // Pool 1 on centrifugeId 1: (1 << 48) | 1.
    expect(centrifugeIdFromPoolId("281474976710657")).toBe(1);
    expect(centrifugeIdFromPoolId(281474976710657n)).toBe(1);
  });

  it("accepts a decimal string and a bigint identically", () => {
    const raw = (2n << 48n) | 7n;
    expect(centrifugeIdFromPoolId(raw)).toBe(
      centrifugeIdFromPoolId(raw.toString()),
    );
  });
});

describe("poolIdFromShareClassId", () => {
  it("reads the high 64 bits of a bytes16 share class id", () => {
    // High 64 bits are the pool id 281474976710657, low 64 the index.
    expect(poolIdFromShareClassId("0x00010000000000010001000000000001")).toBe(
      "281474976710657",
    );
  });

  it("ignores the low 64 bits, so every share class of a pool agrees", () => {
    const first = poolIdFromShareClassId("0x00010000000000010000000000000001");
    const second = poolIdFromShareClassId("0x00010000000000010000000000000002");
    expect(first).toBe(second);
  });

  it("distinguishes two pools that differ only in the high bits", () => {
    // The case a tenancy check exists for: same share class index, other pool.
    expect(
      poolIdFromShareClassId("0x00010000000000020001000000000001"),
    ).not.toBe(poolIdFromShareClassId("0x00010000000000010001000000000001"));
  });

  it("matches the shift `packages/queries` restates independently", () => {
    // `packages/queries/src/rest/routes.ts` cannot import this package, so it
    // repeats the shift. If the two ever diverge, a read and a write would
    // disagree about which pool a share class belongs to.
    const scId = "0x00050000000000030002000000000004";
    expect(poolIdFromShareClassId(scId)).toBe((BigInt(scId) >> 64n).toString());
  });

  it("throws on a short id rather than deriving a plausible pool", () => {
    // Returning 0 here would read as "pool 0", which a comparison might accept.
    expect(() => poolIdFromShareClassId("0xdeadbeef")).toThrow(
      /Cannot derive a pool id/,
    );
  });

  it("throws on a bytes32 id, which is a different width and not a share class", () => {
    expect(() =>
      poolIdFromShareClassId(
        "0x0001000000000001000100000000000100010000000000010001000000000001",
      ),
    ).toThrow(/Cannot derive a pool id/);
  });

  it("throws on an unprefixed or non-hex value", () => {
    expect(() =>
      poolIdFromShareClassId("00010000000000010001000000000001"),
    ).toThrow(/Cannot derive a pool id/);
    expect(() =>
      poolIdFromShareClassId("0x0001000000000001000100000000000z"),
    ).toThrow(/Cannot derive a pool id/);
  });
});
