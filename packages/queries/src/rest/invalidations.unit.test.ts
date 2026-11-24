import { describe, expect, it } from "vitest";
import { sdkCatalogue } from "../core/sdk-catalogue";
import { REST_ROUTES } from "./routes";
import {
  createInvalidationHub,
  INVALIDATION_PAYLOAD_VERSION,
  INVALIDATION_TABLES,
  invalidationTargets,
  matchesVars,
  parseInvalidationFrame,
  type InvalidationFrame,
  type InvalidationTableMap,
} from "./invalidations";

/**
 * The SDK-side half of the invalidation seam: payload validation, the
 * table-to-catalogue-entry mapping, and the fan-out.
 *
 * Every frame below is built from the shape the REAL emitter produces, not the
 * shape that is convenient here: `keys` values are strings because the trigger
 * casts `numeric(78,0)` with `::text`, `index` arrives as `"3"` rather than 3,
 * and the broadcast frame carries NO `keys` because
 * `SseConnectionRegistry.sendInvalidationToPool` strips them from every frame
 * without a `poolId`. Two of the tests below only mean anything because of that
 * last one.
 */

const TOKEN_A = "0x0100000000000000000000000000000a";
const TOKEN_B = "0x0100000000000000000000000000000b";
const POOL_ID = "18446744073709551616";

function frame(overrides: Partial<Record<string, unknown>> = {}): unknown {
  return {
    v: 1,
    table: "chain_v1.epoch_invest_order",
    keys: { tokenId: TOKEN_A, assetId: "42", index: "3" },
    blockNumber: 4242,
    poolId: POOL_ID,
    ...overrides,
  };
}

describe("parseInvalidationFrame", () => {
  it("accepts the wire shape the backend documents", () => {
    const parsed = parseInvalidationFrame(frame());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.frame.table).toBe("chain_v1.epoch_invest_order");
    expect(parsed.frame.keys).toEqual({
      tokenId: TOKEN_A,
      assetId: "42",
      index: "3",
    });
    expect(parsed.frame.blockNumber).toBe(4242);
    expect(parsed.frame.poolId).toBe(POOL_ID);
  });

  it("accepts a broadcast frame, which carries no keys and no poolId", () => {
    // Not a hypothetical: the registry builds exactly this payload for a
    // pool-less invalidation. A schema requiring `keys` would drop all of them.
    const parsed = parseInvalidationFrame({
      v: 1,
      table: "chain_v1.epoch_invest_order",
      blockNumber: 1,
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.frame.keys).toBeUndefined();
    expect(parsed.frame.poolId).toBeUndefined();
  });

  it("accepts a null poolId, which is what a SQL emitter without json_strip_nulls sends", () => {
    const parsed = parseInvalidationFrame(frame({ poolId: null }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.frame.poolId).toBeUndefined();
  });

  it("ignores unknown fields, because emitter and SDK deploy separately", () => {
    const parsed = parseInvalidationFrame(frame({ shard: "eu-1" }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect("shard" in parsed.frame).toBe(false);
  });

  it("rejects any version but 1, rather than reading v2 under a v1 contract", () => {
    expect(INVALIDATION_PAYLOAD_VERSION).toBe(1);
    for (const v of [2, 0, "1", undefined, null]) {
      const parsed = parseInvalidationFrame(frame({ v }));
      expect(parsed.ok, `v=${JSON.stringify(v)}`).toBe(false);
      if (parsed.ok) {
        return;
      }
      expect(parsed.reason).toContain("unsupported payload version");
    }
  });

  it("rejects a numeric key value instead of accepting a rounded id", () => {
    // `numeric(78,0)` above 2^53 loses digits through JSON.parse. A dropped
    // frame costs one poll interval; a rounded id invalidates a cache key that
    // never existed and leaves the real one stale forever.
    const parsed = parseInvalidationFrame(
      frame({ keys: { tokenId: TOKEN_A, assetId: 18446744073709551616 } }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      return;
    }
    expect(parsed.reason).toContain('key "assetId" is not a string');
  });

  it("rejects a malformed table, a bad blockNumber, an empty poolId and a non-object", () => {
    const cases: [unknown, string][] = [
      [frame({ table: "epoch_invest_order" }), "schema-qualified"],
      [frame({ table: 7 }), "schema-qualified"],
      [frame({ blockNumber: -1 }), "non-negative integer"],
      [frame({ blockNumber: "4242" }), "non-negative integer"],
      [frame({ blockNumber: 1.5 }), "non-negative integer"],
      [frame({ poolId: "" }), "non-empty string"],
      [frame({ keys: ["tokenId"] }), "`keys` is not an object"],
      ["not-a-frame", "not an object"],
      [null, "not an object"],
      [[], "not an object"],
    ];
    for (const [raw, expected] of cases) {
      const parsed = parseInvalidationFrame(raw);
      expect(parsed.ok, JSON.stringify(raw)).toBe(false);
      if (parsed.ok) {
        return;
      }
      expect(parsed.reason, JSON.stringify(raw)).toContain(expected);
    }
  });
});

describe("INVALIDATION_TABLES", () => {
  it("names only real catalogue entries, all of them served over REST", () => {
    // The type makes a nonexistent entry a compile error; this is the runtime
    // half, plus the property that gives the mapping its point: an invalidation
    // for an entry still served by graphql would trigger a refetch that the
    // push seam has no bearing on.
    for (const rows of Object.values(INVALIDATION_TABLES)) {
      for (const row of rows) {
        expect(sdkCatalogue[row.entry], row.entry).toBeDefined();
        expect(
          REST_ROUTES[row.entry],
          `${row.entry} has a REST route`,
        ).toBeDefined();
      }
    }
  });

  it("names only key variables the entry actually takes", () => {
    // The compile-time guarantee, checked at runtime too: `keyVars` must be
    // params of the entry, or a match could never fire.
    for (const rows of Object.values(INVALIDATION_TABLES)) {
      for (const row of rows) {
        const shape = (
          sdkCatalogue[row.entry].params as unknown as {
            shape: Record<string, unknown>;
          }
        ).shape;
        for (const key of row.keyVars) {
          expect(shape[key], `${row.entry}.${key}`).toBeDefined();
        }
      }
    }
  });

  it("covers the four Orders projection tables and nothing else", () => {
    expect(Object.keys(INVALIDATION_TABLES).sort()).toEqual([
      "chain_v1.epoch_invest_order",
      "chain_v1.epoch_redeem_order",
      "chain_v1.invest_order",
      "chain_v1.redeem_order",
    ]);
  });
});

describe("invalidationTargets", () => {
  const parsed = (raw: unknown): InvalidationFrame => {
    const result = parseInvalidationFrame(raw);
    if (!result.ok) {
      throw new Error(`fixture is not a valid frame: ${result.reason}`);
    }
    return result.frame;
  };

  it("turns { table, keys } into (name, vars) for every mapped entry", () => {
    expect(invalidationTargets(parsed(frame()))).toEqual([
      { name: "epochInvestOrders", vars: { tokenId: TOKEN_A } },
      { name: "investOrderState", vars: { tokenId: TOKEN_A } },
    ]);
  });

  it("carries only the key variables the entry declares", () => {
    const targets = invalidationTargets(
      parsed(
        frame({
          table: "chain_v1.redeem_order",
          keys: {
            tokenId: TOKEN_A,
            assetId: "42",
            index: "3",
            // In the frame because it is in the primary key; never matched on,
            // because no order entry takes an account and `chain_v1.account`
            // carries the wrong bytes32 decode.
            account: "0xdeadbeef",
          },
        }),
      ),
    );
    expect(targets).toEqual([
      {
        name: "redeemOrdersByEpoch",
        vars: { tokenId: TOKEN_A, assetId: "42", index: "3" },
      },
      { name: "closedRedeemOrders", vars: { tokenId: TOKEN_A } },
      { name: "redeemOrderState", vars: { tokenId: TOKEN_A } },
    ]);
  });

  it("degrades to coarse vars when the emitter collapsed the key set", () => {
    // The listener substitutes `{ count: "<n>" }` for an oversized key set.
    // Matching nothing means matching every subscription of the entry, which is
    // the correct reading of "something in this table changed".
    const targets = invalidationTargets(
      parsed(frame({ keys: { count: "204" } })),
    );
    expect(targets).toEqual([
      { name: "epochInvestOrders", vars: {} },
      { name: "investOrderState", vars: {} },
    ]);
  });

  it("ignores an unmapped table rather than throwing", () => {
    expect(
      invalidationTargets(parsed(frame({ table: "chain_v1.holding" }))),
    ).toEqual([]);
    expect(
      invalidationTargets(
        parsed(frame({ table: "chain_v1.table_from_the_future" })),
      ),
    ).toEqual([]);
  });
});

describe("matchesVars", () => {
  it("matches a broader subscription than the frame's identity", () => {
    // The list for a token contains the row that changed.
    expect(
      matchesVars(
        { tokenId: TOKEN_A, limit: 1000 },
        { tokenId: TOKEN_A, assetId: "42" },
      ),
    ).toBe(true);
  });

  it("excludes only on a disagreement", () => {
    expect(matchesVars({ tokenId: TOKEN_B }, { tokenId: TOKEN_A })).toBe(false);
    expect(
      matchesVars({ assetId: "7" }, { tokenId: TOKEN_A, assetId: "42" }),
    ).toBe(false);
  });

  it("compares as strings, because the wire has no numbers", () => {
    expect(matchesVars({ index: 3 }, { index: "3" })).toBe(true);
    expect(matchesVars({ index: 4 }, { index: "3" })).toBe(false);
  });

  it("treats an absent or undefined variable as unconstrained", () => {
    expect(matchesVars({}, { tokenId: TOKEN_A })).toBe(true);
    expect(matchesVars({ tokenId: undefined }, { tokenId: TOKEN_A })).toBe(
      true,
    );
    expect(matchesVars({ tokenId: null }, { tokenId: TOKEN_A })).toBe(true);
  });

  it("matches everything when the target carries no identity", () => {
    expect(matchesVars({ tokenId: TOKEN_B, limit: 5 }, {})).toBe(true);
  });
});

describe("createInvalidationHub", () => {
  it("notifies exactly the subscriptions whose keys the frame names", () => {
    const hub = createInvalidationHub();
    const hits: string[] = [];
    hub.subscribe("epochInvestOrders", { tokenId: TOKEN_A, limit: 1000 }, () =>
      hits.push("A"),
    );
    hub.subscribe("epochInvestOrders", { tokenId: TOKEN_B, limit: 1000 }, () =>
      hits.push("B"),
    );
    hub.subscribe("investOrderState", { tokenId: TOKEN_A, limit: 1000 }, () =>
      hits.push("state-A"),
    );
    hub.subscribe("epochRedeemOrders", { tokenId: TOKEN_A, limit: 1000 }, () =>
      hits.push("redeem-A"),
    );

    const result = hub.dispatch(frame());

    expect(hits.sort()).toEqual(["A", "state-A"]);
    expect(result.notified).toBe(2);
    expect(result.ignored).toBeUndefined();
    expect(result.failed).toBe(0);
  });

  it("notifies ten subscribers over three keys exactly once each", () => {
    // The fan-out case. Ten subscriptions, three distinct `(name, vars)`
    // keys, one frame per key: each subscription must be notified exactly once
    // by the frame for ITS key and not at all by the other two.
    const hub = createInvalidationHub();
    const tokens = [TOKEN_A, TOKEN_B, "0x0100000000000000000000000000000c"];
    const counts = new Array(10).fill(0);
    for (let i = 0; i < 10; i++) {
      const tokenId = tokens[i % 3]!;
      hub.subscribe("epochInvestOrders", { tokenId, limit: 1000 }, () => {
        counts[i]++;
      });
    }
    expect(hub.size).toBe(10);

    for (const tokenId of tokens) {
      const result = hub.dispatch(frame({ keys: { tokenId } }));
      // 4 subscribers on tokens[0], 3 each on the other two.
      expect(result.notified).toBe(tokenId === tokens[0] ? 4 : 3);
    }

    expect(counts).toEqual(new Array(10).fill(1));
  });

  it("notifies a subscription once even when two mapping rows select it", () => {
    // `investOrderState` is mapped from both invest tables; a table whose rows
    // listed an entry twice would be the same shape. The affected set is
    // collected before anything is called, so the subscription refetches once.
    const twice: InvalidationTableMap = {
      "chain_v1.epoch_invest_order": [
        { entry: "investOrderState", keyVars: ["tokenId"] },
        { entry: "investOrderState", keyVars: [] },
      ],
    };
    const hub = createInvalidationHub(twice);
    let calls = 0;
    hub.subscribe("investOrderState", { tokenId: TOKEN_A }, () => {
      calls++;
    });

    const result = hub.dispatch(frame());

    expect(calls).toBe(1);
    expect(result.targets).toHaveLength(2);
    expect(result.notified).toBe(1);
  });

  it("ignores an unknown table without notifying or throwing", () => {
    const hub = createInvalidationHub();
    let calls = 0;
    hub.subscribe("epochInvestOrders", { tokenId: TOKEN_A }, () => {
      calls++;
    });

    const result = hub.dispatch(
      frame({ table: "chain_v1.brand_new_projection" }),
    );

    expect(calls).toBe(0);
    expect(result.notified).toBe(0);
    expect(result.ignored).toContain("no catalogue entry is mapped");
  });

  it("ignores an invalid payload without notifying or throwing", () => {
    const hub = createInvalidationHub();
    let calls = 0;
    hub.subscribe("epochInvestOrders", { tokenId: TOKEN_A }, () => {
      calls++;
    });

    expect(hub.dispatch(frame({ v: 2 })).ignored).toContain(
      "unsupported payload version",
    );
    expect(hub.dispatch("garbage").ignored).toContain("not an object");
    expect(hub.dispatch(undefined).ignored).toContain("not an object");
    expect(calls).toBe(0);
  });

  it("survives a throwing listener and still notifies the others", () => {
    const hub = createInvalidationHub();
    let good = 0;
    hub.subscribe("epochInvestOrders", { tokenId: TOKEN_A }, () => {
      throw new Error("subscriber blew up");
    });
    hub.subscribe("investOrderState", { tokenId: TOKEN_A }, () => {
      good++;
    });

    const result = hub.dispatch(frame());

    expect(good).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.notified).toBe(1);
  });

  it("stops notifying after unsubscribe, and tolerates a double unsubscribe", () => {
    const hub = createInvalidationHub();
    let calls = 0;
    const off = hub.subscribe("epochInvestOrders", { tokenId: TOKEN_A }, () => {
      calls++;
    });
    hub.dispatch(frame());
    expect(calls).toBe(1);

    off();
    off();
    expect(hub.size).toBe(0);

    hub.dispatch(frame());
    expect(calls).toBe(1);
  });
});
