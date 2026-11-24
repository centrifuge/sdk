import { describe, expect, it, vi } from "vitest";
import { createGraphqlQueries } from "./adapter";
import { DimensionOverflowError } from "./public-api";
import { PUBLIC_API_CAPABILITIES } from "./capabilities";
import { PUBLIC_API_RESOLVERS } from "./public-api";

/**
 * Cross-adapter parity.
 *
 * The catalogue's whole point is that every adapter returns the same rows for
 * the same underlying data. These tests seed one logical dataset in both wire
 * formats — api-v3's `{ items }` envelope with nested relations, and
 * public-api's `{ nodes }` collections plus separate dimension reads — and
 * assert the two adapters produce deep-equal results.
 *
 * These catch join and shaping errors: a public-api row that reshapes a
 * relation differently from api-v3 fails the deep-equal. They cannot catch a
 * selection set going missing, because a fake transport returns the fixture
 * regardless of what the document selected — that is the job of the
 * selection-set guard at the bottom of this file.
 */

const TOKEN_ID = `0x${"1".repeat(32)}`;
const ASSET_ID = "42";

/** One logical asset, in the fields each side selects. */
const ASSET = {
  id: ASSET_ID,
  centrifugeId: "1",
  address: "0xaaa",
  name: "USD Coin",
  symbol: "USDC",
  decimals: 6,
  assetTokenId: null,
};

/** One logical share token. */
const TOKEN = {
  id: TOKEN_ID,
  name: "Junior",
  symbol: "JUN",
  decimals: 18,
  centrifugeId: "1",
};

/** Route a public-api document to its seeded response by the collection it reads. */
function publicApiExecutor(responses: Record<string, unknown>) {
  return vi.fn(async (document: string) => {
    const matched = Object.keys(responses).find((key) =>
      new RegExp(`\\b${key}\\(`).test(document),
    );
    if (!matched) {
      throw new Error(
        `no seeded public-api response for document:\n${document}`,
      );
    }
    return responses[matched];
  });
}

describe("cross-adapter parity: client-join entries", () => {
  it("redeemOrderState — epochOutstandingRedeems.token carries the real centrifugeId", async () => {
    // The regression this covers: the `tokens` dimension read omitted
    // `centrifugeId`, so public-api returned "" where api-v3 returned "1".
    const outstanding = {
      assetId: ASSET_ID,
      poolId: "1",
      tokenId: TOKEN_ID,
      pendingSharesAmount: "5",
      createdAtTxHash: null,
      updatedAtTxHash: null,
    };

    const apiV3 = createGraphqlQueries({
      target: "api-v3",
      execute: async () => ({
        epochOutstandingRedeems: {
          items: [
            {
              ...outstanding,
              asset: {
                decimals: ASSET.decimals,
                centrifugeId: ASSET.centrifugeId,
              },
              token: {
                decimals: TOKEN.decimals,
                centrifugeId: TOKEN.centrifugeId,
              },
            },
          ],
        },
        epochRedeemOrders: { items: [] },
        pendingRedeemOrders: { items: [] },
        redeemOrders: { items: [] },
      }),
    });

    const publicApi = createGraphqlQueries({
      target: "public-api",
      execute: publicApiExecutor({
        epochOutstandingRedeems: {
          epochOutstandingRedeems: { nodes: [outstanding] },
          epochRedeemOrders: { nodes: [] },
          pendingRedeemOrders: { nodes: [] },
          redeemOrders: { nodes: [] },
        },
        assets: { assets: { nodes: [ASSET] } },
        tokens: { tokens: { nodes: [TOKEN] } },
      }),
    });

    const params = { tokenId: TOKEN_ID };
    const fromV3 = (await apiV3("redeemOrderState", params)) as any;
    const fromPublic = (await publicApi("redeemOrderState", params)) as any;

    expect(fromPublic.epochOutstandingRedeems[0].token).toEqual(
      fromV3.epochOutstandingRedeems[0].token,
    );
    expect(fromPublic.epochOutstandingRedeems[0].token.centrifugeId).toBe("1");
    expect(fromPublic).toEqual(fromV3);
  });

  it("investOrderState — asset refs match the api-v3 nested selection", async () => {
    const epochOrder = {
      poolId: "1",
      tokenId: TOKEN_ID,
      assetId: ASSET_ID,
      index: 3,
      approvedAt: "2026-01-01T00:00:00Z",
      approvedAtTxHash: null,
      approvedAssetsAmount: "10",
      issuedAt: null,
      issuedAtTxHash: null,
      issuedSharesAmount: "0",
    };

    const apiV3 = createGraphqlQueries({
      target: "api-v3",
      execute: async () => ({
        epochOutstandingInvests: { items: [] },
        epochInvestOrders: {
          items: [
            {
              ...epochOrder,
              token: { decimals: TOKEN.decimals },
              asset: {
                decimals: ASSET.decimals,
                centrifugeId: ASSET.centrifugeId,
              },
            },
          ],
        },
        pendingInvestOrders: { items: [] },
        investOrders: { items: [] },
      }),
    });

    const publicApi = createGraphqlQueries({
      target: "public-api",
      execute: publicApiExecutor({
        epochOutstandingInvests: {
          epochOutstandingInvests: { nodes: [] },
          epochInvestOrders: { nodes: [epochOrder] },
          pendingInvestOrders: { nodes: [] },
          investOrders: { nodes: [] },
        },
        assets: { assets: { nodes: [ASSET] } },
        tokens: { tokens: { nodes: [TOKEN] } },
      }),
    });

    const params = { tokenId: TOKEN_ID };
    expect(await publicApi("investOrderState", params)).toEqual(
      await apiV3("investOrderState", params),
    );
  });

  it("assetRegistrations — the joined asset equals api-v3's nested asset", async () => {
    const apiV3 = createGraphqlQueries({
      target: "api-v3",
      execute: async () => ({
        assetRegistrations: {
          items: [
            {
              assetId: ASSET_ID,
              asset: {
                centrifugeId: ASSET.centrifugeId,
                address: ASSET.address,
                name: ASSET.name,
                symbol: ASSET.symbol,
                decimals: ASSET.decimals,
                assetTokenId: ASSET.assetTokenId,
              },
            },
          ],
        },
      }),
    });

    const publicApi = createGraphqlQueries({
      target: "public-api",
      execute: publicApiExecutor({
        blockchains: {
          blockchains: {
            nodes: [
              {
                assetRegistrations: {
                  nodes: [
                    { assetId: ASSET_ID, centrifugeId: "1", asset: ASSET },
                  ],
                },
              },
            ],
          },
        },
      }),
    });

    const params = { centrifugeId: "1" };
    expect(await publicApi("assetRegistrations", params)).toEqual(
      await apiV3("assetRegistrations", params),
    );
  });
});

describe("dimension reads select every field their consumers use", () => {
  // This is the guard that actually catches selection drift, and it is not
  // redundant with the parity tests above: a fake transport returns whatever
  // the fixture holds regardless of the document's selection set, so a
  // parity test cannot see a field going missing from a selection. Verified
  // by reverting the `tokens` selection — the parity tests stayed green and
  // only this test failed.
  //
  // So the two layers cover different failures: parity covers join and
  // shaping logic, this covers the selection sets those joins depend on.
  const DIMENSION_CONSUMED_FIELDS: Record<string, readonly string[]> = {
    // toOrderAsset / toAssetDetails / toShortRef / holdingEscrows / investorTransactions
    assets: [
      "id",
      "centrifugeId",
      "address",
      "name",
      "symbol",
      "decimals",
      "assetTokenId",
    ],
    // toOrderToken / toShortRef / investorTransactions
    tokens: ["id", "name", "symbol", "decimals", "centrifugeId"],
  };

  it("captures the assets and tokens selections and checks them", async () => {
    const documents: string[] = [];
    const execute = vi.fn(async (document: string) => {
      documents.push(document);
      if (/\bassets\(/.test(document)) {
        return { assets: { nodes: [] } };
      }
      if (/\btokens\(/.test(document)) {
        return { tokens: { nodes: [] } };
      }
      return {
        epochOutstandingRedeems: { nodes: [{ assetId: ASSET_ID }] },
        epochRedeemOrders: { nodes: [] },
        pendingRedeemOrders: { nodes: [] },
        redeemOrders: { nodes: [] },
      };
    });

    const query = createGraphqlQueries({ target: "public-api", execute });
    await query("redeemOrderState", { tokenId: TOKEN_ID });

    for (const [dimension, fields] of Object.entries(
      DIMENSION_CONSUMED_FIELDS,
    )) {
      const document = documents.find((d) =>
        new RegExp(`\\b${dimension}\\(`).test(d),
      );
      expect(
        document,
        `${dimension} dimension read was never issued`,
      ).toBeTruthy();
      for (const field of fields) {
        expect(
          new RegExp(`\\b${field}\\b`).test(document!),
          `${dimension} selection is missing "${field}", which a consumer reads`,
        ).toBe(true);
      }
    }
  });
});

describe("capability table stays in sync with the resolvers", () => {
  it("lists every client-join entry as having a resolver", () => {
    const clientJoin = Object.entries(PUBLIC_API_CAPABILITIES)
      .filter(([, c]) => c.support === "ported-with-client-join")
      .map(([name]) => name);
    // `whitelistedInvestors` is one of the 16: narrowing it to live
    // memberships needs `validUntil > now()`, which `condition:` cannot
    // express, so the predicate runs client-side over the bounded set.
    //
    // Three of the 16 are Basin (backend#629): `basinDebt` and `basinFees`
    // verify `basinAddress` against the returned row because it is the second
    // column of their primary key and so leads no index, and
    // `basinRedeemRequests` narrows `redeemer` / `requestId` the same way.
    //
    // Two of the 16 are the per-share-class closed-order reads
    // (apps-management#1420): the whole set is one read, the join is the
    // same `asset`/`token` join the per-epoch entries do. They retired
    // `investOrdersByEpoch`, which was the seventeenth.
    expect(clientJoin.length).toBe(16);
    for (const name of clientJoin) {
      expect(
        Boolean(
          PUBLIC_API_RESOLVERS[name as keyof typeof PUBLIC_API_RESOLVERS],
        ),
        `${name} is client-join but has no resolver`,
      ).toBe(true);
    }
  });
});

describe("dimension-read cap is a correctness boundary, not a truncation", () => {
  /**
   * The client joins must read a whole dimension table because public-api has
   * no `filter:`. Past the cap the read would be truncated and any row whose
   * dimension counterpart fell outside the page would join to nothing —
   * yielding `null` where a real value exists, indistinguishable from a
   * genuinely absent row. So it fails loud.
   *
   * The cap is injected here rather than seeded past: what is being tested is
   * the guard, not Postgres.
   */
  function executorWithAssetCount(totalCount: number, nodes: unknown[]) {
    return vi.fn(async (document: string) => {
      if (/\bassets\(/.test(document)) {
        return { assets: { totalCount, nodes } };
      }
      if (/\btokens\(/.test(document)) {
        return { tokens: { totalCount: 1, nodes: [TOKEN] } };
      }
      return {
        epochInvestOrders: { nodes: [{ assetId: ASSET_ID, index: 1 }] },
      };
    });
  }

  it("throws DimensionOverflowError naming entry, table, cap and observed count", async () => {
    const execute = executorWithAssetCount(3, [ASSET]);
    const query = createGraphqlQueries({
      target: "public-api",
      execute,
      dimensionCap: 2,
    });

    const error = (await query("epochInvestOrders", {
      tokenId: TOKEN_ID,
    }).catch((e) => e)) as DimensionOverflowError;

    expect(error).toBeInstanceOf(DimensionOverflowError);
    expect(error.entry).toBe("epochInvestOrders");
    expect(error.dimension).toBe("assets");
    expect(error.cap).toBe(2);
    expect(error.observed).toBe(3);
    // Points at the same unblocking item as the blocked entries.
    expect(error.message).toContain("index");
    expect(error.message).toContain("cannot");
  });

  it("does not truncate: no partial result is returned on overflow", async () => {
    const execute = executorWithAssetCount(5000, [ASSET]);
    const query = createGraphqlQueries({
      target: "public-api",
      execute,
      dimensionCap: 1000,
    });
    await expect(
      query("epochInvestOrders", { tokenId: TOKEN_ID }),
    ).rejects.toThrow(DimensionOverflowError);
  });

  it("is unaffected at the cap boundary (observed === cap)", async () => {
    const execute = executorWithAssetCount(2, [ASSET]);
    const query = createGraphqlQueries({
      target: "public-api",
      execute,
      dimensionCap: 2,
    });
    const rows = (await query("epochInvestOrders", {
      tokenId: TOKEN_ID,
    })) as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].asset).not.toBeNull();
  });

  it("guards the tokens dimension too", async () => {
    const execute = vi.fn(async (document: string) => {
      if (/\btokens\(/.test(document)) {
        return { tokens: { totalCount: 99, nodes: [TOKEN] } };
      }
      if (/\bassets\(/.test(document)) {
        return { assets: { totalCount: 1, nodes: [ASSET] } };
      }
      return {
        epochOutstandingRedeems: { nodes: [{ assetId: ASSET_ID }] },
        epochRedeemOrders: { nodes: [] },
        pendingRedeemOrders: { nodes: [] },
        redeemOrders: { nodes: [] },
      };
    });
    const query = createGraphqlQueries({
      target: "public-api",
      execute,
      dimensionCap: 10,
    });
    const error = (await query("redeemOrderState", {
      tokenId: TOKEN_ID,
    }).catch((e) => e)) as DimensionOverflowError;
    expect(error).toBeInstanceOf(DimensionOverflowError);
    expect(error.dimension).toBe("tokens");
    expect(error.entry).toBe("redeemOrderState");
  });

  it("guards the adapters dimension in poolAdapters", async () => {
    const execute = vi.fn(async () => ({
      poolAdapters: { nodes: [{ adapterAddress: "0xaaa" }] },
      adapters: { totalCount: 40, nodes: [] },
    }));
    const query = createGraphqlQueries({
      target: "public-api",
      execute,
      dimensionCap: 5,
    });
    const error = (await query("poolAdapters", {
      poolId: "1",
      localCentrifugeId: "1",
      remoteCentrifugeId: "2",
    }).catch((e) => e)) as DimensionOverflowError;
    expect(error).toBeInstanceOf(DimensionOverflowError);
    expect(error.dimension).toBe("adapters");
  });
});

/**
 * The two places the pool-access graphql reads have to correct public-api.
 *
 * Both fixtures are shapes a LIVE public-api produces, not shapes that were
 * convenient to write. Probed against the PostGraphile schema on
 * :5055 over the seeded `chain_v1`:
 *
 * ```
 * poolAdapters.nodes[1].crosschainInProgress === "ENABLED"
 * poolManagers.nodes[0].crosschainInProgress === "CAN_NOT_MANAGE"
 * adapters.nodes  === [
 *   { address: "0x5555…", centrifugeId: "1", name: "axelar"   },
 *   { address: "0x6666…", centrifugeId: "1", name: null       },
 *   { address: "0x7777…", centrifugeId: "2", name: "wormhole" },
 * ]
 * ```
 *
 * `sql/pool-access-read-parity.integration.test.ts` checks the same two claims
 * against that live endpoint; these run everywhere and are the ones that go red
 * fast.
 */
describe("the poolAdapters adapter-name join", () => {
  /**
   * Named on network 1, and configured on the (1 -> 2) route.
   *
   * Deliberately carries LETTERS, and a different case on each side of the
   * join: the reference catalogue spells it checksummed, the `poolAdapters`
   * row spells it lowercase. That is what `chain_v1` actually serves — the two
   * spellings live in different columns, which is the whole reason
   * {@link adapterKey} lowercases the address half.
   *
   * All-numeric hex addresses (`0x5555…`) would make `.toLowerCase()` a
   * literal no-op on every input, so this suite would stay green with the
   * normalisation deleted: it would cover the PAIRING half of the composite
   * key and not the CASE-NORMALISATION half.
   */
  const LOCAL_NAMED_CHECKSUMMED = "0xaAbB5555555555555555555555555555555555bB";
  /** The same adapter as `chain_v1`'s `pool_adapter.adapter_address` spells it. */
  const LOCAL_NAMED = LOCAL_NAMED_CHECKSUMMED.toLowerCase();
  /** An adapter ROW on network 1 with no reference name. */
  const LOCAL_UNNAMED = "0x6666666666666666666666666666666666666666";
  /** Named `wormhole` on network 2 — and NOT on network 1. */
  const FOREIGN = "0x7777777777777777777777777777777777777777";

  /**
   * The pool-adapter stamp these rows join on. A second generation of the
   * same address (`3.3`, named `other`) sits in `ADAPTERS` so a join that
   * drops the generation picks the wrong name.
   */
  const GENERATION = "";

  const ADAPTERS = {
    totalCount: 4,
    nodes: [
      {
        address: LOCAL_NAMED_CHECKSUMMED,
        centrifugeId: "1",
        registryVersion: GENERATION,
        name: "axelar",
      },
      {
        address: LOCAL_NAMED_CHECKSUMMED,
        centrifugeId: "1",
        registryVersion: "3.3",
        name: "other",
      },
      {
        address: LOCAL_UNNAMED,
        centrifugeId: "1",
        registryVersion: GENERATION,
        name: null,
      },
      {
        address: FOREIGN,
        centrifugeId: "2",
        registryVersion: GENERATION,
        name: "wormhole",
      },
    ],
  };

  const ROUTE = {
    poolId: "281474976710657",
    localCentrifugeId: "1",
    remoteCentrifugeId: "2",
  };

  function publicApi(nodes: unknown[]) {
    return createGraphqlQueries({
      target: "public-api",
      execute: async () => ({
        poolAdapters: { nodes },
        adapters: ADAPTERS,
      }),
    });
  }

  it("never borrows a name from the same address on another network", async () => {
    // The defect, stated as its symptom: FOREIGN is configured on the (1 -> 2)
    // route, so its LOCAL network is 1 — where it has no adapter row at all.
    // The address-only join found its network-2 row and served `wormhole`.
    const rows = (await publicApi([
      {
        adapterAddress: FOREIGN,
        isEnabled: true,
        crosschainInProgress: null,
        updatedByRegistryVersion: GENERATION,
      },
    ])("poolAdapters", ROUTE)) as any[];

    expect(rows).toHaveLength(1);
    expect(rows[0].adapter).toBeNull();
  });

  it("still resolves the name when the adapter IS local, in both directions", async () => {
    // Not vacuous: the same address that resolved to `null` above resolves to
    // its own name on the route whose local network is 2. That is the composite
    // key working rather than the join being switched off.
    const forward = (await publicApi([
      {
        adapterAddress: LOCAL_NAMED,
        isEnabled: true,
        crosschainInProgress: null,
        updatedByRegistryVersion: GENERATION,
      },
    ])("poolAdapters", ROUTE)) as any[];
    expect(forward[0].adapter).toEqual({ name: "axelar" });

    const reversed = (await publicApi([
      {
        adapterAddress: FOREIGN,
        isEnabled: true,
        crosschainInProgress: null,
        updatedByRegistryVersion: GENERATION,
      },
    ])("poolAdapters", {
      ...ROUTE,
      localCentrifugeId: "2",
      remoteCentrifugeId: "1",
    })) as any[];
    expect(reversed[0].adapter).toEqual({ name: "wormhole" });
  });

  it("does not borrow a name from another generation of the same address", async () => {
    const rows = (await publicApi([
      {
        adapterAddress: LOCAL_NAMED,
        isEnabled: true,
        crosschainInProgress: null,
        updatedByRegistryVersion: "3.3",
      },
      {
        adapterAddress: LOCAL_NAMED,
        isEnabled: true,
        crosschainInProgress: null,
        updatedByRegistryVersion: "3.2",
      },
    ])("poolAdapters", ROUTE)) as any[];

    expect(rows[0].adapter).toEqual({ name: "other" });
    expect(rows[1].adapter).toBeNull();
  });

  it("distinguishes 'no adapter row' from 'a row with no name'", async () => {
    // `{ name: null }` is an adapter row on this chain and generation with no
    // reference name. `null` is no adapter row for that key. Collapsing them
    // hides a missing row behind a blank name.
    const rows = (await publicApi([
      {
        adapterAddress: LOCAL_UNNAMED,
        isEnabled: false,
        crosschainInProgress: null,
        updatedByRegistryVersion: GENERATION,
      },
      {
        adapterAddress: FOREIGN,
        isEnabled: true,
        crosschainInProgress: null,
        updatedByRegistryVersion: GENERATION,
      },
    ])("poolAdapters", ROUTE)) as any[];

    expect(rows[0].adapter).toEqual({ name: null });
    expect(rows[1].adapter).toBeNull();
  });

  it("agrees with api-v3, whose nested relation carries the right key by construction", async () => {
    // api-v3 (Ponder) selects `adapter { name }` as a real relation, so it
    // cannot make this mistake. That makes it the independent oracle for the
    // client join: if the two disagree, the client join is wrong.
    const apiV3 = createGraphqlQueries({
      target: "api-v3",
      execute: async () => ({
        poolAdapters: {
          items: [
            {
              adapterAddress: FOREIGN,
              isEnabled: true,
              crosschainInProgress: null,
              adapter: null,
            },
          ],
        },
      }),
    });

    expect(
      await publicApi([
        {
          adapterAddress: FOREIGN,
          isEnabled: true,
          crosschainInProgress: null,
          updatedByRegistryVersion: GENERATION,
        },
      ])("poolAdapters", ROUTE),
    ).toEqual(await apiV3("poolAdapters", ROUTE));
  });

  it("normalises the crosschainInProgress enum to the projection's spelling", async () => {
    const rows = (await publicApi([
      {
        adapterAddress: LOCAL_NAMED,
        isEnabled: false,
        crosschainInProgress: "ENABLED",
        updatedByRegistryVersion: GENERATION,
      },
      {
        adapterAddress: LOCAL_UNNAMED,
        isEnabled: true,
        crosschainInProgress: "DISABLED",
        updatedByRegistryVersion: GENERATION,
      },
      {
        adapterAddress: FOREIGN,
        isEnabled: true,
        crosschainInProgress: null,
        updatedByRegistryVersion: GENERATION,
      },
    ])("poolAdapters", ROUTE)) as any[];

    // What `AdapterCrosschainProgress` (core/types.ts) and the SDK's
    // `AdapterProgress` both declare, and what `queries/sql` serves.
    expect(rows.map((row) => row.crosschainInProgress)).toEqual([
      "Enabled",
      "Disabled",
      null,
    ]);
  });

  it("throws on an enum label it does not know, rather than passing it through", async () => {
    // The SDK casts this field with `as AdapterProgress`, so an unmapped value
    // would be accepted by the compiler and compared against literals it can
    // never match — "a change is in flight, of an unknown kind".
    await expect(
      publicApi([
        {
          adapterAddress: LOCAL_NAMED,
          isEnabled: true,
          crosschainInProgress: "PENDING",
        },
      ])("poolAdapters", ROUTE),
    ).rejects.toThrow(/poolAdapters\.crosschainInProgress/);
  });

  it("throws on an Object.prototype key too", async () => {
    // The reason the lookup is a `Map` rather than an object literal. With
    // `{ ENABLED: … }[String(value)]` this case returns `Function` — a defined
    // value, so the throw above never fires and `crosschainInProgress` becomes
    // a function — a plausible-looking value rather than a refusal, reached by
    // an unlikely input rather than a likely one.
    for (const label of ["toString", "constructor", "hasOwnProperty"]) {
      await expect(
        publicApi([
          {
            adapterAddress: LOCAL_NAMED,
            isEnabled: true,
            crosschainInProgress: label,
          },
        ])("poolAdapters", ROUTE),
        label,
      ).rejects.toThrow(/poolAdapters\.crosschainInProgress/);
    }
  });
});

describe("the poolManagers enum spelling", () => {
  const ROW = {
    isHubManager: false,
    isBalancesheetManager: true,
    address: "0x19f46D8130e610C6C0f0116EA40Fb781dEFaDE93",
    centrifugeId: "2",
    poolId: "562949953421319",
  };

  function publicApi(nodes: unknown[]) {
    return createGraphqlQueries({
      target: "public-api",
      execute: async () => ({ poolManagers: { nodes } }),
    });
  }

  it("normalises CAN_MANAGE / CAN_NOT_MANAGE and leaves everything else alone", async () => {
    const rows = (await publicApi([
      { ...ROW, crosschainInProgress: "CAN_NOT_MANAGE" },
      { ...ROW, crosschainInProgress: "CAN_MANAGE" },
      { ...ROW, crosschainInProgress: null },
    ])("poolManagers", { poolId: ROW.poolId })) as any[];

    expect(rows.map((row) => row.crosschainInProgress)).toEqual([
      "CanNotManage",
      "CanManage",
      null,
    ]);
    // Every other field is passed through untouched — the address keeps its
    // stored casing, and `centrifugeId` / `poolId` stay strings.
    expect(rows[2]).toEqual({ ...ROW, crosschainInProgress: null });
  });

  it("agrees with api-v3, which serves the projection's spelling directly", async () => {
    const apiV3 = createGraphqlQueries({
      target: "api-v3",
      execute: async () => ({
        poolManagers: {
          items: [{ ...ROW, crosschainInProgress: "CanNotManage" }],
        },
      }),
    });

    expect(
      await publicApi([{ ...ROW, crosschainInProgress: "CAN_NOT_MANAGE" }])(
        "poolManagers",
        { poolId: ROW.poolId },
      ),
    ).toEqual(await apiV3("poolManagers", { poolId: ROW.poolId }));
  });

  it("throws on an unknown label — including the projection's own spelling", async () => {
    // Deliberately the PROJECTION's spelling, which PostGraphile does not
    // produce. The normalisation is one-directional on purpose: the day
    // public-api starts serving `CanNotManage` verbatim, this fails loudly and
    // someone deletes the mapping, rather than the adapter quietly accepting
    // two spellings and hiding that the two sides had converged.
    await expect(
      publicApi([{ ...ROW, crosschainInProgress: "CanNotManage" }])(
        "poolManagers",
        { poolId: ROW.poolId },
      ),
    ).rejects.toThrow(/poolManagers\.crosschainInProgress/);
  });
});

describe("public-api holdingEscrows", () => {
  const LEGACY = `0x${"a".repeat(40)}`;
  const CURRENT = `0x${"1".repeat(40)}`;

  function executor(over: {
    escrows?: { totalCount: number; nodes: unknown[] };
    holdings?: { totalCount: number; nodes: unknown[] };
  }) {
    return vi.fn(async (document: string) => {
      if (/\bassets\(/.test(document)) {
        return { assets: { totalCount: 1, nodes: [ASSET] } };
      }
      return {
        holdingEscrows: over.escrows ?? { totalCount: 0, nodes: [] },
        holdings: over.holdings ?? { totalCount: 0, nodes: [] },
        blockchains: { totalCount: 0, nodes: [] },
      };
    });
  }

  function escrow(assetId: string, escrowAddress: string) {
    return {
      centrifugeId: "1",
      assetId,
      escrowAddress,
      assetAmount: "1",
      assetPrice: "1",
    };
  }

  it("orders rows by centrifugeId, numeric assetId, then escrowAddress", async () => {
    const nodes = [
      escrow("100", CURRENT),
      escrow(ASSET_ID, LEGACY),
      escrow(ASSET_ID, CURRENT),
    ];
    const query = createGraphqlQueries({
      target: "public-api",
      execute: executor({ escrows: { totalCount: 3, nodes } }),
    });

    const rows = (await query("holdingEscrows", {
      tokenId: TOKEN_ID,
    })) as any[];

    expect(rows.map((r) => [r.assetId, r.escrowAddress])).toEqual([
      [ASSET_ID, CURRENT],
      [ASSET_ID, LEGACY],
      ["100", CURRENT],
    ]);
  });

  it("refuses a capped holdingEscrows page instead of dropping an escrow", async () => {
    const query = createGraphqlQueries({
      target: "public-api",
      execute: executor({
        escrows: { totalCount: 3, nodes: [escrow(ASSET_ID, CURRENT)] },
      }),
      dimensionCap: 2,
    });

    const error = (await query("holdingEscrows", {
      tokenId: TOKEN_ID,
    }).catch((e) => e)) as DimensionOverflowError;

    expect(error).toBeInstanceOf(DimensionOverflowError);
    expect(error.dimension).toBe("holdingEscrows");
  });

  it("refuses a capped holdings page instead of nulling a holding", async () => {
    const query = createGraphqlQueries({
      target: "public-api",
      execute: executor({
        escrows: { totalCount: 1, nodes: [escrow(ASSET_ID, CURRENT)] },
        holdings: { totalCount: 3, nodes: [] },
      }),
      dimensionCap: 2,
    });

    const error = (await query("holdingEscrows", {
      tokenId: TOKEN_ID,
    }).catch((e) => e)) as DimensionOverflowError;

    expect(error).toBeInstanceOf(DimensionOverflowError);
    expect(error.dimension).toBe("holdings");
  });
});
