import { describe, expect, it, vi } from "vitest";
import { catalogue } from "../core/catalogue";
import { sdkCatalogue, type SdkQueryName } from "../core/sdk-catalogue";
import {
  API_V3_DOCUMENTS,
  API_V3_UNWRAP,
  API_V3_VARIABLES,
  apiV3Document,
} from "./api-v3";
import { createGraphqlQueries, UnsupportedQueryError } from "./adapter";
import { blockedEntries, isPublicApiSupported } from "./capabilities";
import { PUBLIC_API_RESOLVERS } from "./public-api";

const entryNames = Object.keys(sdkCatalogue) as SdkQueryName[];

describe("SDK query catalogue", () => {
  it("names every entry consistently with its key", () => {
    for (const name of entryNames) {
      expect(sdkCatalogue[name].name).toBe(name);
    }
  });

  it("covers all 43 catalogue entries", () => {
    // One entry per read the SDK makes. `closedInvestments` and
    // `closedRedemptions` each issue two documents (epoch and per-investor), so
    // they count twice; `Centrifuge._deployments` reads two collections in one
    // document and counts once. A new entry changes this count and gets a
    // resolver and a capability row.
    expect(entryNames).toHaveLength(43);
  });

  it("rejects unknown params on every entry (.strict())", () => {
    for (const name of entryNames) {
      const result = sdkCatalogue[name].params.safeParse({ nope: true });
      expect(result.success, `${name} accepted an unknown key`).toBe(false);
    }
  });

  it("refuses a non-canonical decimal id, like the backend catalogue", () => {
    // Both catalogues spell these three params the same way, so they cannot
    // disagree about which id a caller named. The mechanism is the same on
    // both sides: every consumer of one of these strings either `BigInt`s it
    // or compares it as TEXT, and `BigInt("007")` is `7n` — so a non-canonical
    // spelling answers about a different id rather than failing.
    const tokenId = "0x00010000000000010001000000000001";

    for (const bad of ["007", "01", "00", " 1", ""]) {
      expect(
        sdkCatalogue.poolManagers.params.safeParse({ poolId: bad }).success,
        `poolManagers accepted poolId ${JSON.stringify(bad)}`,
      ).toBe(false);
      expect(
        sdkCatalogue.merkleProofManagers.params.safeParse({
          poolId: bad,
          centrifugeId: "1",
        }).success,
        `merkleProofManagers accepted poolId ${JSON.stringify(bad)}`,
      ).toBe(false);
      expect(
        sdkCatalogue.assetRegistrations.params.safeParse({ centrifugeId: bad })
          .success,
        `assetRegistrations accepted centrifugeId ${JSON.stringify(bad)}`,
      ).toBe(false);
      expect(
        sdkCatalogue.onOffRampManagers.params.safeParse({
          centrifugeId: bad,
          tokenId,
        }).success,
        `onOffRampManagers accepted centrifugeId ${JSON.stringify(bad)}`,
      ).toBe(false);
      expect(
        sdkCatalogue.redeemOrdersByEpoch.params.safeParse({
          tokenId,
          assetId: bad,
          index: 1,
        }).success,
        `redeemOrdersByEpoch accepted assetId ${JSON.stringify(bad)}`,
      ).toBe(false);
      expect(
        sdkCatalogue.epochRedeemOrders.params.safeParse({
          tokenId,
          assetId: bad,
        }).success,
        `epochRedeemOrders accepted assetId ${JSON.stringify(bad)}`,
      ).toBe(false);
    }

    // `"0"` stays valid: `poolIdFromShareClassId` in `rest/routes.ts` derives
    // exactly it from the zero share-class id (`rest.unit.test.ts` pins that),
    // so refusing it would break a derivation the SDK relies on.
    expect(
      sdkCatalogue.poolManagers.params.safeParse({ poolId: "0" }).success,
    ).toBe(true);
  });

  it("documents the name overlap with the backend catalogue instead of colliding", () => {
    // The backend catalogue returns normalized chain_v1 rows; the SDK
    // catalogue returns the api-v3 wire shapes its entities parse. Reconciling
    // them is per-vertical work; this test pins the overlap so a NEW collision
    // cannot appear silently.
    //
    // Deliberately name-only: the two catalogues' params and results evolve
    // independently until they are reconciled, so a backend-side schema change
    // to a shared name (an optional `limit` added to `poolManagers` and
    // `whitelistedInvestors`, say) is a no-op here and must not fail this
    // test. Only a new shared *name* is a signal that needs attention.
    const overlap = Object.keys(catalogue).filter((name) =>
      (entryNames as string[]).includes(name),
    );
    expect(overlap.sort()).toEqual([
      // `blockchains`, `tokenInstances`, `assetRegistrations`,
      // `holdingEscrows` and `onOffRampManagers` exist in the backend
      // catalogue under the frozen SDK result shapes, so these five names
      // overlap *and* agree field for field (asserted at the type level in
      // `catalogue.unit.test.ts`). They are the entries where the
      // reconciliation this test tracks has happened.
      "assetRegistrations",
      // The five Basin reads (backend#629 Stage 2a). The names overlap
      // deliberately: both catalogues describe the same `chain_v1` basin
      // tables, and the SDK RESULT types mirror the backend ones field for
      // field so the two adapters stay comparable.
      //
      // One difference is intentional: the SDK's `basinRedeemRequests` params
      // add optional `redeemer` / `requestId` narrowing that the adapter
      // applies client-side. The RESULT shapes now agree, including the
      // nested `redeemOrder` and `redeemOrderLinkAmbiguous` (Stage 2b).
      "basinDebt",
      "basinDebtChanges",
      "basinFees",
      "basinRedeemRequests",
      "basinSwaps",
      "blockchains",
      // These three exist under the SDK's own names. `poolAdapters` agrees
      // field for field; the two crosschain entries share the name and most of
      // the shape, but their PARAMS deliberately differ — the backend side
      // requires `poolId` (the `@PoolMembers()` scope) where the SDK entry
      // carries an untyped `filter` record and an optional pool.
      "crosschainMessage",
      "crosschainMessages",
      "deployments",
      // The invest mirror of the redeem pair below, with the same split:
      // `epochInvestOrders` agrees field for field, `investOrderState` shares
      // only the name and the params because the backend side is BLOCKED on
      // the corrupted `invest_order.account` column.
      "epochInvestOrders",
      // These two exist under the SDK's own names. `epochRedeemOrders` agrees
      // field for field (asserted at the type level in
      // `catalogue.unit.test.ts`); `redeemOrderState` shares only the name and
      // the params, because the backend side is BLOCKED on the corrupted
      // `redeem_order.account` column and declares `never` as its result until
      // Embrio's decode is fixed.
      "epochRedeemOrders",
      "holdingEscrows",
      "investOrderState",
      "investorTransactions",
      // These four exist under the SDK's own names, all agreeing field for
      // field (asserted at the type level in `catalogue.unit.test.ts`).
      // `onOffRampManagers` is shared with the holdings vertical, which reads
      // the same entry rather than declaring a second one.
      "merkleProofManagers",
      "offRampAddresses",
      "onOffRampManagers",
      "onOffRampRelayers",
      "onRampAssets",
      "poolAdapters",
      "poolManagers",
      "pools",
      "redeemOrderState",
      "tokenInstances",
      "whitelistedInvestors",
    ]);
  });
});

describe("api-v3 adapter", () => {
  it("has a document, a variable mapper and an unwrapper for every entry", () => {
    for (const name of entryNames) {
      expect(API_V3_DOCUMENTS[name], `${name} document`).toBeDefined();
      expect(typeof API_V3_VARIABLES[name], `${name} variables`).toBe(
        "function",
      );
      expect(typeof API_V3_UNWRAP[name], `${name} unwrap`).toBe("function");
    }
  });

  it("follows a per-share-class closed-order read's cursor to the last page", async () => {
    const scId = `0x${"1".repeat(32)}`;
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        investOrders: {
          items: [{ account: "0xa" }, { account: "0xb" }],
          pageInfo: { hasNextPage: true, endCursor: "c2" },
        },
      })
      .mockResolvedValueOnce({
        investOrders: {
          items: [{ account: "0xc" }],
          pageInfo: { hasNextPage: false, endCursor: "c3" },
        },
      });
    const query = createGraphqlQueries({ execute, target: "api-v3" });
    const rows = (await query("closedInvestOrders", {
      tokenId: scId,
    })) as any[];
    expect(rows.map((r) => r.account)).toEqual(["0xa", "0xb", "0xc"]);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[0]![1]).toEqual({ scId, after: undefined });
    expect(execute.mock.calls[1]![1]).toEqual({ scId, after: "c2" });
  });

  it("builds the dynamic documents from their call params", () => {
    const positions = apiV3Document("tokenInstancePositions", {
      balanceGt: "1",
      holderAddress: "0xabc",
      centrifugeIds: ["1"],
    });
    expect(positions).toContain("balance_gt: $balance_gt");
    expect(positions).toContain("accountAddress_contains: $holderAddress");
    expect(positions).toContain("centrifugeId_in: $centrifugeIds");

    const minimal = apiV3Document("tokenInstancePositions", {});
    expect(minimal).not.toContain("balance_gt");
    expect(minimal).toContain("accountAddress_not_in: $excludedAddresses");
  });

  it("widens the crosschain payload selection only for requested includes", () => {
    const bare = apiV3Document("crosschainMessages", { include: {} });
    expect(bare).not.toContain("crosschainMessages {");
    const full = apiV3Document("crosschainMessages", {
      include: { innerMessages: true, pool: true },
    });
    expect(full).toContain("pool { id name }");
    expect(full).toContain("crosschainMessages {");
  });

  it("selects createdAtBlock on both on/off-ramp manager documents", async () => {
    expect(apiV3Document("onOffRampManagers", {})).toContain("createdAtBlock");

    const exec = vi.fn().mockResolvedValue({
      onOffRampManagers: {
        nodes: [{ address: "0xabc", createdAtBlock: 7 }],
      },
    });
    await PUBLIC_API_RESOLVERS.onOffRampManagers!(
      exec,
      { tokenId: "0x01", centrifugeId: "1" },
      { entry: "onOffRampManagers", dimensionCap: 1000 },
    );
    expect(exec.mock.calls[0]![0]).toContain("createdAtBlock");
  });

  it("unwraps the api-v3 envelope into the catalogue's result shape", async () => {
    const execute = vi.fn().mockResolvedValue({
      blockchains: {
        items: [{ chainId: "1", centrifugeId: "1", name: "ethereum" }],
      },
    });
    const query = createGraphqlQueries({ execute, target: "api-v3" });
    const result = await query("blockchains", {});
    expect(result).toEqual([
      { chainId: "1", centrifugeId: "1", name: "ethereum" },
    ]);
  });

  it("maps catalogue params onto the historical variable names", async () => {
    const execute = vi
      .fn()
      .mockResolvedValue({ assetRegistrations: { items: [] } });
    const query = createGraphqlQueries({ execute, target: "api-v3" });
    await query("assetRegistrations", { centrifugeId: "2" });
    expect(execute.mock.calls[0]![1]).toEqual({ hubCentId: "2" });
  });

  it("validates params before touching the transport", async () => {
    const execute = vi.fn();
    const query = createGraphqlQueries({ execute, target: "api-v3" });
    await expect(
      query("assetRegistrations", { centrifugeId: "not-a-number" }),
    ).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("public-api adapter", () => {
  it("has a resolver for exactly the entries the capability table calls servable", () => {
    for (const name of entryNames) {
      const hasResolver = Boolean(PUBLIC_API_RESOLVERS[name]);
      expect(hasResolver, `${name} resolver vs capability table`).toBe(
        isPublicApiSupported(name),
      );
    }
  });

  it("serves every catalogue entry: nothing is blocked any more", () => {
    expect(blockedEntries()).toEqual([]);
  });

  it("names the capability and the interim workaround on a typed refusal", () => {
    const error = new UnsupportedQueryError("example", {
      support: "blocked",
      reason: "no table",
      missing: ["table"],
      blockedBy: ["example { … }"],
    });
    expect(error.entry).toBe("example");
    expect(error.missing).toContain("table");
    expect(error.message).toContain("example");
    expect(error.message).toContain("graphqlTarget: 'api-v3'");
    expect(error.message).toContain("default");
  });

  it("pools carries the projected protocol version and migration status", async () => {
    const execute = vi.fn().mockResolvedValue({
      pools: {
        nodes: [
          { id: "281474976710657", protocolVersion: "3.2", status: "live" },
          {
            id: "281474976710658",
            protocolVersion: "3.3",
            status: "migrating",
          },
        ],
      },
    });
    const query = createGraphqlQueries({ execute, target: "public-api" });
    expect(await query("pools", {})).toEqual([
      {
        id: "281474976710657",
        protocolVersion: "3.2",
        migrationStatus: "live",
      },
      {
        id: "281474976710658",
        protocolVersion: "3.3",
        migrationStatus: "migrating",
      },
    ]);
    expect(execute.mock.calls[0]![0]).toContain("protocolVersion status");
  });

  it("pools on api-v3 carries no version: both fields are null", async () => {
    const execute = vi.fn().mockResolvedValue({
      pools: { items: [{ id: "281474976710657", blockchain: { id: "1" } }] },
    });
    const query = createGraphqlQueries({ execute, target: "api-v3" });
    expect(await query("pools", {})).toEqual([
      { id: "281474976710657", protocolVersion: null, migrationStatus: null },
    ]);
  });

  it("deployments serves one row per (chain, registryVersion) as protocolVersion", async () => {
    const execute = vi.fn().mockResolvedValue({
      deployments: {
        nodes: [
          { centrifugeId: "1", chainId: 11155111, registryVersion: "3.2" },
          { centrifugeId: "1", chainId: 11155111, registryVersion: "3.3" },
        ],
      },
    });
    const query = createGraphqlQueries({ execute, target: "public-api" });
    expect(await query("deployments", {})).toEqual([
      { centrifugeId: "1", chainId: "11155111", protocolVersion: "3.2" },
      { centrifugeId: "1", chainId: "11155111", protocolVersion: "3.3" },
    ]);
  });

  it("uses condition/nodes (never the absent filter argument)", async () => {
    const execute = vi.fn().mockResolvedValue({ poolManagers: { nodes: [] } });
    const query = createGraphqlQueries({ execute, target: "public-api" });
    await query("poolManagers", { poolId: "1" });
    const document = execute.mock.calls[0]![0] as string;
    expect(document).toContain("condition:");
    expect(document).toContain("nodes");
    expect(document).not.toContain("filter:");
    expect(document).not.toContain("items");
  });

  it("investorTransactions builds filter/orderBy (never condition), and only when given", async () => {
    const execute = vi.fn().mockResolvedValue({
      investorTransactions: { nodes: [], totalCount: 0 },
    });
    const query = createGraphqlQueries({ execute, target: "public-api" });
    await query("investorTransactions", {
      account: "0xa4a7bb3831958463b3fe3e27a6a160f764341953",
      poolId: "1",
      tokenId: "0x00010000000000010001000000000001",
      type: "SYNC_DEPOSIT",
      createdAtAfter: "2026-01-01T00:00:00Z",
      createdAtBefore: "2026-12-31T00:00:00Z",
      limit: 50,
      offset: 0,
    });
    const [document, variables] = execute.mock.calls[0]!;
    expect(document as string).toContain("filter:");
    expect(document as string).toContain("orderBy: [CREATED_AT_DESC]");
    expect(document as string).not.toContain("condition:");
    const filter = (variables as any).filter;
    expect(filter.account).toEqual({
      equalTo: "0xa4a7bb3831958463b3fe3e27a6a160f764341953",
    });
    expect(filter.poolId).toEqual({ equalTo: "1" });
    expect(filter.tokenId).toEqual({
      equalTo: "0x00010000000000010001000000000001",
    });
    expect(filter.type).toEqual({ equalTo: "SYNC_DEPOSIT" });
    expect(filter.createdAt).toEqual({
      greaterThan: "2026-01-01T00:00:00Z",
      lessThan: "2026-12-31T00:00:00Z",
    });

    // The optional predicates are absent, not present-as-undefined, when the
    // caller does not supply them — an `undefined`-valued key would still
    // serialise into the request body as a JSON `null` filter.
    execute.mockClear();
    await query("investorTransactions", {
      account: "0xa4a7bb3831958463b3fe3e27a6a160f764341953",
      poolId: "1",
      limit: 50,
      offset: 0,
    });
    const bareFilter = (execute.mock.calls[0]![1] as any).filter;
    expect(Object.keys(bareFilter).sort()).toEqual(["account", "poolId"]);
  });

  it("investorTransactions' createdAt range is refused on api-v3 rather than silently dropped", async () => {
    const execute = vi.fn();
    const query = createGraphqlQueries({ execute, target: "api-v3" });
    await expect(
      query("investorTransactions", {
        account: "0xa4a7bb3831958463b3fe3e27a6a160f764341953",
        poolId: "1",
        createdAtAfter: "2026-01-01T00:00:00Z",
        limit: 10,
        offset: 0,
      }),
    ).rejects.toThrow(/api-v3/);
    expect(execute).not.toHaveBeenCalled();
  });

  it("hubSharePricesReport keeps api-v3's NewPeriod predicate and refuses from/to there", async () => {
    const execute = vi
      .fn()
      .mockResolvedValue({ tokenSnapshots: { items: [] } });
    const query = createGraphqlQueries({ execute, target: "api-v3" });
    await query("hubSharePricesReport", {
      tokenIds: ["0x00010000000000010001000000000001"],
    });
    const document = execute.mock.calls[0]![0] as string;
    const variables = execute.mock.calls[0]![1] as any;
    expect(document).toContain("tokenSnapshots(");
    expect(document).not.toContain("tokenInstanceSnapshots");
    expect(variables.filter).toEqual({
      id_in: ["0x00010000000000010001000000000001"],
      trigger_ends_with: "NewPeriod",
    });
    expect(document).toContain("limit: $limit");
    expect(variables.limit).toBe(1000);

    execute.mockClear();
    await query("hubSharePricesReport", {
      tokenIds: ["0x00010000000000010001000000000001"],
      limit: 7,
    });
    expect((execute.mock.calls[0]![1] as any).limit).toBe(7);

    execute.mockClear();
    await expect(
      query("hubSharePricesReport", {
        tokenIds: ["0x00010000000000010001000000000001"],
        from: "2026-01-01T00:00:00Z",
      }),
    ).rejects.toThrow(/api-v3/);
    expect(execute).not.toHaveBeenCalled();
  });

  it("hubSharePricesReport keeps only the day-boundary rows on public-api and counts limit against them", async () => {
    const period = (timestamp: string) => ({
      id: "0x00010000000000010001000000000001",
      timestamp,
      tokenPrice: "1",
      totalIssuance: "1",
      trigger: "snapshot:DailySnapshotTrigger",
    });
    const intraday = (timestamp: string) => ({
      ...period(timestamp),
      trigger: "shareClassManager:UpdatePricePoolPerShare",
    });
    const pages = [
      [
        intraday("2026-05-06T11:00:00.000000+00:00"),
        period("2026-05-06T00:00:00.000000+00:00"),
        intraday("2026-05-05T09:00:00.000000+00:00"),
      ],
      [
        period("2026-05-05T00:00:00.000000+00:00"),
        period("2026-05-04T00:00:00.000000+00:00"),
        period("2026-05-03T00:00:00.000000+00:00"),
      ],
    ];
    const execute = vi.fn(async (_document: string, variables: any) => ({
      tokenSnapshots: {
        totalCount: 6,
        nodes: pages[variables.offset / 3] ?? [],
      },
    }));
    const query = createGraphqlQueries({
      execute,
      target: "public-api",
      dimensionCap: 3,
    });

    const result = (await query("hubSharePricesReport", {
      tokenIds: ["0x00010000000000010001000000000001"],
      limit: 3,
    })) as any;

    expect(result.tokenSnapshots.items.map((r: any) => r.timestamp)).toEqual([
      "2026-05-06T00:00:00.000000+00:00",
      "2026-05-05T00:00:00.000000+00:00",
      "2026-05-04T00:00:00.000000+00:00",
    ]);
    expect(execute).toHaveBeenCalledTimes(2);
    expect((execute.mock.calls[0]![1] as any).first).toBe(3);
    expect((execute.mock.calls[1]![1] as any).offset).toBe(3);
  });

  it("hubSharePricesReport reads hub tokenSnapshots on public-api with an optional bounded filter", async () => {
    const execute = vi
      .fn()
      .mockResolvedValue({ tokenSnapshots: { nodes: [] } });
    const query = createGraphqlQueries({ execute, target: "public-api" });
    await query("hubSharePricesReport", {
      tokenIds: ["0x00010000000000010001000000000001"],
      from: "2026-01-01T00:00:00Z",
      to: "2026-12-31T00:00:00Z",
    });
    const document = execute.mock.calls[0]![0] as string;
    const variables = execute.mock.calls[0]![1] as any;
    expect(document).toContain("tokenSnapshots(");
    expect(document).toContain("trigger");
    expect(variables.filter).toEqual({
      id: { in: ["0x00010000000000010001000000000001"] },
      timestamp: {
        greaterThanOrEqualTo: "2026-01-01T00:00:00Z",
        lessThanOrEqualTo: "2026-12-31T00:00:00Z",
      },
    });

    execute.mockClear();
    await query("hubSharePricesReport", {
      tokenIds: ["0x00010000000000010001000000000001"],
    });
    expect((execute.mock.calls[0]![1] as any).filter).toEqual({
      id: { in: ["0x00010000000000010001000000000001"] },
    });
  });

  it("shareYieldsReport's from/to is refused on api-v3 rather than silently dropped", async () => {
    const execute = vi.fn();
    const query = createGraphqlQueries({ execute, target: "api-v3" });
    await expect(
      query("shareYieldsReport", {
        tokenIds: ["0x00010000000000010001000000000001"],
        yieldFields: ["yieldTtm"],
        from: "2026-01-01T00:00:00Z",
      }),
    ).rejects.toThrow(/api-v3/);
    expect(execute).not.toHaveBeenCalled();
  });

  it("shareYieldsReport builds a bounded filter only when from/to are given", async () => {
    const execute = vi
      .fn()
      .mockResolvedValue({ tokenSnapshots: { nodes: [] } });
    const query = createGraphqlQueries({ execute, target: "public-api" });
    await query("shareYieldsReport", {
      tokenIds: ["0x00010000000000010001000000000001"],
      yieldFields: ["yieldTtm"],
      from: "2026-01-01T00:00:00Z",
      to: "2026-12-31T00:00:00Z",
    });
    const filter = (execute.mock.calls[0]![1] as any).filter;
    expect(filter.timestamp).toEqual({
      greaterThanOrEqualTo: "2026-01-01T00:00:00Z",
      lessThanOrEqualTo: "2026-12-31T00:00:00Z",
    });

    execute.mockClear();
    await query("shareYieldsReport", {
      tokenIds: ["0x00010000000000010001000000000001"],
      yieldFields: ["yieldTtm"],
    });
    expect((execute.mock.calls[0]![1] as any).filter.timestamp).toBeUndefined();
  });

  it("un-mangles PostGraphile's constant-cased vault_status", async () => {
    // PostGraphile v4 renames enum VALUES to constant case, so
    // `chain_v1.vault_status` would reach callers as `LINKED`/`UNLINKED`. The
    // SDK compares against the literals `'Linked'` and `'Unlinked'` —
    // `ShareClass.vaults()` for `includeUnlinked`, `pendingAmounts()` for
    // which vaults count — so neither would ever match on this target, the
    // SDK's DEFAULT. api-v3 and the backend endpoint both serve the mixed-case
    // labels, so this is the spelling all three transports agree on.
    const execute = vi.fn().mockResolvedValue({
      vaults: {
        nodes: [
          {
            id: "0xaaa",
            poolId: "1",
            assetAddress: "0xbbb",
            status: "LINKED",
            assetId: "42",
            centrifugeId: "1",
          },
          {
            id: "0xccc",
            poolId: "1",
            assetAddress: "0xddd",
            status: "UNLINK_IN_PROGRESS",
            assetId: null,
            centrifugeId: "2",
          },
        ],
      },
    });
    const query = createGraphqlQueries({ execute, target: "public-api" });

    const rows = (await query("allVaults", {
      tokenId: `0x${"11".repeat(16)}`,
    })) as any[];

    expect(rows.map((row) => row.status)).toEqual([
      "Linked",
      "UnlinkInProgress",
    ]);
    // The derivation the REST route mirrors: `asset` comes from the vault
    // row's own `assetId` column, and a null one stays null.
    expect(rows.map((row) => row.asset)).toEqual([{ id: "42" }, null]);
  });

  it("refuses an unrecognised vault_status rather than passing it through", async () => {
    // The closed half. Passing an unknown label through is exactly the bug
    // above, so a new enum member has to be mapped rather than silently
    // reaching a caller who compares it against a literal. Without this case a
    // mapping that fell back to the raw value would pass the case above.
    const execute = vi.fn().mockResolvedValue({
      vaults: {
        nodes: [
          {
            id: "0xaaa",
            poolId: "1",
            assetAddress: "0xbbb",
            status: "RELINK_PENDING",
            assetId: "42",
            centrifugeId: "1",
          },
        ],
      },
    });
    const query = createGraphqlQueries({ execute, target: "public-api" });

    await expect(
      query("allVaults", { tokenId: `0x${"11".repeat(16)}` }),
    ).rejects.toThrow(/RELINK_PENDING/);
  });

  it("reads the asset relation through the blockchain in one request", async () => {
    const execute = vi.fn().mockResolvedValue({
      blockchains: {
        nodes: [
          {
            assetRegistrations: {
              nodes: [
                {
                  assetId: "42",
                  centrifugeId: "1",
                  asset: {
                    centrifugeId: "1",
                    address: "0xaaa",
                    name: "USD Coin",
                    symbol: "USDC",
                    decimals: 6,
                    assetTokenId: null,
                  },
                },
              ],
            },
          },
        ],
      },
    });
    const query = createGraphqlQueries({ execute, target: "public-api" });
    const result = (await query("assetRegistrations", {
      centrifugeId: "1",
    })) as any[];
    expect(result).toEqual([
      {
        assetId: "42",
        asset: {
          centrifugeId: "1",
          address: "0xaaa",
          name: "USD Coin",
          symbol: "USDC",
          decimals: 6,
          assetTokenId: null,
        },
      },
    ]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("recovers a dropped relation from the row's own column where one exists", async () => {
    // api-v3 read `blockchain { centrifugeId }`; `token_instance` carries the
    // column itself, so no join is needed and the result shape is unchanged.
    const execute = vi.fn().mockResolvedValue({
      token: {
        tokenInstances: {
          nodes: [
            {
              totalIssuance: "1",
              tokenPrice: "2",
              address: "0xbbb",
              centrifugeId: "1",
            },
          ],
        },
      },
    });
    const query = createGraphqlQueries({ execute, target: "public-api" });
    const result = (await query("tokenInstances", {
      tokenId: `0x${"1".repeat(32)}`,
    })) as any[];
    expect(result[0].centrifugeId).toBe("1");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("picks the epoch client-side over the share class's revoked orders", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        redeemOrders: {
          totalCount: 3,
          nodes: [
            { account: "0x1", assetId: "7", index: 2, claimedAt: null },
            { account: "0x2", assetId: "8", index: 2, claimedAt: null },
            { account: "0x3", assetId: "7", index: 3, claimedAt: null },
          ],
        },
      })
      .mockResolvedValueOnce({ assets: { nodes: [] } })
      .mockResolvedValueOnce({ tokens: { nodes: [] } });
    const query = createGraphqlQueries({ execute, target: "public-api" });
    const result = (await query("redeemOrdersByEpoch", {
      tokenId: `0x${"1".repeat(32)}`,
      assetId: "7",
      index: 2,
    })) as any[];
    expect(result).toHaveLength(1);
    expect(result[0].account).toBe("0x1");
    expect(execute).toHaveBeenCalledTimes(3);
  });

  describe("the policy and authorization reads", () => {
    const POOL_ID = "281474976710657";
    const eventNode = (overrides: Record<string, unknown> = {}) => ({
      centrifugeId: 1,
      poolId: POOL_ID,
      eventKind: "HUB_REGISTRY_AUTHORIZATION_SCHEDULED",
      sourceAddress: "0x1111111111111111111111111111111111111111",
      targetCentrifugeId: null,
      policy: null,
      caller: "0x3333333333333333333333333333333333333333",
      authId: `0x${"a1".repeat(32)}`,
      calldata: "0x095ea7b3",
      validAfter: "281474976710655",
      createdAt: "2026-11-01T10:00:00.000000+00:00",
      createdAtBlock: 100,
      createdAtTxHash: `0x${"b1".repeat(32)}`,
      createdAtLogIndex: 3,
      ...overrides,
    });
    const policyNode = (overrides: Record<string, unknown> = {}) => ({
      centrifugeId: "1",
      poolId: POOL_ID,
      policy: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      delay: "86400",
      expiry: "604800",
      escalation: "172800",
      maxAbsolutePriceDelta: "0",
      thresholdPerSecond: "0",
      maxBrmPriceDeviation: "340282366920938463463374607431768211455",
      isRestrictionUpdateInstant: false,
      onchainAccounting: true,
      createdAt: "2026-11-01T10:00:00.000000+00:00",
      createdAtBlock: 10,
      createdAtTxHash: `0x${"c1".repeat(32)}`,
      createdAtLogIndex: 0,
      ...overrides,
    });

    it("poolAuthorizationEvents follows the cursor until the last page, past the page size", async () => {
      const execute = vi
        .fn()
        .mockResolvedValueOnce({
          poolAuthorizationEvents: {
            pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
            nodes: [
              eventNode({ createdAtLogIndex: 1 }),
              eventNode({ createdAtLogIndex: 2 }),
            ],
          },
        })
        .mockResolvedValueOnce({
          poolAuthorizationEvents: {
            pageInfo: { hasNextPage: false, endCursor: "cursor-2" },
            nodes: [eventNode({ createdAtLogIndex: 3 })],
          },
        });
      const query = createGraphqlQueries({
        execute,
        target: "public-api",
        dimensionCap: 2,
      });

      const rows = (await query("poolAuthorizationEvents", {
        poolId: POOL_ID,
      })) as any[];

      expect(rows.map((row) => row.createdAtLogIndex)).toEqual([1, 2, 3]);
      expect(execute).toHaveBeenCalledTimes(2);
      expect(execute.mock.calls[0]![1]).toEqual({
        poolId: POOL_ID,
        first: 2,
        after: null,
      });
      expect(execute.mock.calls[1]![1]).toEqual({
        poolId: POOL_ID,
        first: 2,
        after: "cursor-1",
      });
    });

    for (const name of ["poolAuthorizationEvents", "hubPolicies"] as const) {
      it(`${name} filters on the pool and orders by primary key, so paging is stable`, async () => {
        const execute = vi.fn().mockResolvedValue({
          [name]: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [],
          },
        });
        const query = createGraphqlQueries({ execute, target: "public-api" });

        await query(name, { poolId: POOL_ID });

        const document = execute.mock.calls[0]![0] as string;
        expect(document).toContain("filter: { poolId: { equalTo: $poolId } }");
        expect(document).toContain("orderBy: PRIMARY_KEY_ASC");
        expect(document).toContain("$poolId: BigFloat!");
      });
    }

    it("poolAuthorizationEvents returns the row as the table has it, nulls staying null", async () => {
      const execute = vi.fn().mockResolvedValue({
        poolAuthorizationEvents: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            eventNode(),
            eventNode({
              eventKind: "HUB_REGISTRY_AUTHORIZATION_CANCELED",
              caller: null,
              calldata: null,
              validAfter: null,
              policy: null,
              targetCentrifugeId: null,
            }),
          ],
        },
      });
      const query = createGraphqlQueries({ execute, target: "public-api" });

      const rows = (await query("poolAuthorizationEvents", {
        poolId: POOL_ID,
      })) as any[];

      expect(rows[0]).toEqual({
        centrifugeId: "1",
        poolId: POOL_ID,
        eventKind: "HUB_REGISTRY_AUTHORIZATION_SCHEDULED",
        sourceAddress: "0x1111111111111111111111111111111111111111",
        targetCentrifugeId: null,
        policy: null,
        caller: "0x3333333333333333333333333333333333333333",
        authId: `0x${"a1".repeat(32)}`,
        calldata: "0x095ea7b3",
        validAfter: "281474976710655",
        createdAt: "2026-11-01T10:00:00.000000+00:00",
        createdAtBlock: 100,
        createdAtTxHash: `0x${"b1".repeat(32)}`,
        createdAtLogIndex: 3,
      });
      expect(rows[1]).toMatchObject({
        caller: null,
        calldata: null,
        validAfter: null,
        policy: null,
      });
    });

    const TOKEN_ID = "0x00010000000000010001000000000001";
    const callNode = (overrides: Record<string, unknown> = {}) => ({
      messageId: `0x${"c1".repeat(32)}`,
      messageIndex: 0,
      poolId: POOL_ID,
      centrifugeId: "2",
      targetAddress: "0xe587b9dc2659d8742447044d964ea3ae72f4a9ad",
      decodedPayload: {
        kind: "Issue",
        scId: TOKEN_ID,
        account: "0x1111111111111111111111111111111111111111",
        shares: "7",
      },
      tokenId: TOKEN_ID,
      account: "0x1111111111111111111111111111111111111111",
      shares: "7",
      createdAt: "2026-11-01T10:00:00.000000+00:00",
      createdAtTxHash: `0x${"d1".repeat(32)}`,
      crosschainMessage: { status: "AWAITING_BATCH_DELIVERY" },
      ...overrides,
    });

    it("shareManagerCalls filters on the share class and the ShareManager kind, and pages past one page", async () => {
      const execute = vi
        .fn()
        .mockResolvedValueOnce({
          managerCalls: {
            pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
            nodes: [
              callNode({ messageIndex: 1 }),
              callNode({ messageIndex: 0 }),
            ],
          },
        })
        .mockResolvedValueOnce({
          managerCalls: {
            pageInfo: { hasNextPage: false, endCursor: "cursor-2" },
            nodes: [
              callNode({
                createdAt: "2026-10-31T10:00:00.000000+00:00",
                messageIndex: 5,
              }),
            ],
          },
        });
      const query = createGraphqlQueries({
        execute,
        target: "public-api",
        dimensionCap: 2,
      });

      const rows = (await query("shareManagerCalls", {
        tokenId: TOKEN_ID,
      })) as any[];

      const document = execute.mock.calls[0]![0] as string;
      expect(document).toContain(
        'filter: { tokenId: { equalTo: $tokenId }, targetKind: { equalTo: "shareManager" } }',
      );
      expect(document).toContain("orderBy: PRIMARY_KEY_ASC");
      expect(execute).toHaveBeenCalledTimes(2);
      expect(execute.mock.calls[1]![1]).toEqual({
        tokenId: TOKEN_ID,
        first: 2,
        after: "cursor-1",
      });
      expect(
        rows.map((row) => [row.createdAt.slice(0, 10), row.messageIndex]),
      ).toEqual([
        ["2026-10-31", 5],
        ["2026-11-01", 0],
        ["2026-11-01", 1],
      ]);
    });

    it("shareManagerCalls maps the kind and the message status to the SDK's labels", async () => {
      const execute = vi.fn().mockResolvedValue({
        managerCalls: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            callNode(),
            callNode({
              decodedPayload: { kind: "Revoke" },
              crosschainMessage: { status: "EXECUTED" },
              shares: 3,
            }),
          ],
        },
      });
      const query = createGraphqlQueries({ execute, target: "public-api" });

      const rows = (await query("shareManagerCalls", {
        tokenId: TOKEN_ID,
      })) as any[];

      expect(rows[0]).toEqual({
        messageId: `0x${"c1".repeat(32)}`,
        messageIndex: 0,
        poolId: POOL_ID,
        centrifugeId: "2",
        targetAddress: "0xe587b9dc2659d8742447044d964ea3ae72f4a9ad",
        kind: "Issue",
        scId: TOKEN_ID,
        account: "0x1111111111111111111111111111111111111111",
        shares: "7",
        createdAt: "2026-11-01T10:00:00.000000+00:00",
        createdAtTxHash: `0x${"d1".repeat(32)}`,
        status: "AwaitingBatchDelivery",
      });
      expect(rows[1]).toMatchObject({
        kind: "Revoke",
        status: "Executed",
        shares: "3",
      });
    });

    it("shareManagerCalls refuses a kind it does not know rather than passing it through", async () => {
      const execute = vi.fn().mockResolvedValue({
        managerCalls: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [callNode({ decodedPayload: { kind: "Burn" } })],
        },
      });
      const query = createGraphqlQueries({ execute, target: "public-api" });

      await expect(
        query("shareManagerCalls", { tokenId: TOKEN_ID }),
      ).rejects.toThrow('share manager call kind "Burn"');
    });

    it("refuses a page that reports another page but no new cursor, rather than looping", async () => {
      const stuck = {
        hubPolicies: {
          pageInfo: { hasNextPage: true, endCursor: "same" },
          nodes: [policyNode()],
        },
      };
      // A third read means the guard did not stop it; the mock then fails by message, not by running forever.
      const execute = vi
        .fn()
        .mockResolvedValueOnce(stuck)
        .mockResolvedValueOnce(stuck)
        .mockRejectedValue(new Error("read past the guard"));
      const query = createGraphqlQueries({ execute, target: "public-api" });

      await expect(query("hubPolicies", { poolId: POOL_ID })).rejects.toThrow(
        "no new cursor",
      );
      expect(execute).toHaveBeenCalledTimes(2);
    });

    it("hubPolicies follows the cursor and keeps zero and false as the values they are", async () => {
      const execute = vi
        .fn()
        .mockResolvedValueOnce({
          hubPolicies: {
            pageInfo: { hasNextPage: true, endCursor: "c" },
            nodes: [policyNode()],
          },
        })
        .mockResolvedValueOnce({
          hubPolicies: {
            pageInfo: { hasNextPage: false, endCursor: "d" },
            nodes: [
              policyNode({
                createdAtLogIndex: 1,
                createdAtTxHash: `0x${"c2".repeat(32)}`,
              }),
            ],
          },
        });
      const query = createGraphqlQueries({
        execute,
        target: "public-api",
        dimensionCap: 1,
      });

      const rows = (await query("hubPolicies", { poolId: POOL_ID })) as any[];

      expect(rows.map((row) => row.createdAtLogIndex)).toEqual([0, 1]);
      expect(rows.every((row) => !("nonce" in row))).toBe(true);
      expect(rows[0]).toMatchObject({
        maxAbsolutePriceDelta: "0",
        thresholdPerSecond: "0",
        isRestrictionUpdateInstant: false,
        maxBrmPriceDeviation: "340282366920938463463374607431768211455",
      });
      expect(execute.mock.calls[1]![1]).toEqual({
        poolId: POOL_ID,
        first: 1,
        after: "c",
      });
    });

    it("hubPolicies keeps an unpublished parameter null, never 0 or false", async () => {
      const unpublished = {
        policy: null,
        delay: null,
        expiry: null,
        escalation: null,
        maxAbsolutePriceDelta: null,
        thresholdPerSecond: null,
        maxBrmPriceDeviation: null,
        isRestrictionUpdateInstant: null,
        onchainAccounting: null,
      };
      const execute = vi.fn().mockResolvedValue({
        hubPolicies: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [policyNode(unpublished)],
        },
      });
      const query = createGraphqlQueries({ execute, target: "public-api" });

      const [row] = (await query("hubPolicies", { poolId: POOL_ID })) as any[];

      expect(row).toMatchObject(unpublished);
    });

    it("rejects a non-canonical pool id and an unknown key on both entries", () => {
      for (const name of ["poolAuthorizationEvents", "hubPolicies"] as const) {
        expect(
          sdkCatalogue[name].params.safeParse({ poolId: "007" }).success,
          name,
        ).toBe(false);
        expect(
          sdkCatalogue[name].params.safeParse({
            poolId: POOL_ID,
            centrifugeId: "1",
          }).success,
          name,
        ).toBe(false);
        expect(
          sdkCatalogue[name].params.safeParse({ poolId: POOL_ID }).success,
          name,
        ).toBe(true);
      }
    });

    it("refuses both on api-v3, which never had the tables", async () => {
      const execute = vi.fn();
      const query = createGraphqlQueries({ execute, target: "api-v3" });

      await expect(
        query("poolAuthorizationEvents", { poolId: POOL_ID }),
      ).rejects.toThrow("api-v3");
      await expect(query("hubPolicies", { poolId: POOL_ID })).rejects.toThrow(
        "api-v3",
      );
      expect(execute).not.toHaveBeenCalled();
    });
  });

  it("reads a per-share-class closed-order set past the page size instead of refusing it", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        investOrders: {
          totalCount: 3,
          nodes: [
            { account: "0x1", assetId: "7" },
            { account: "0x2", assetId: "7" },
          ],
        },
      })
      .mockResolvedValueOnce({
        investOrders: {
          totalCount: 3,
          nodes: [{ account: "0x3", assetId: "7" }],
        },
      })
      .mockResolvedValueOnce({ assets: { totalCount: 0, nodes: [] } })
      .mockResolvedValueOnce({ tokens: { totalCount: 0, nodes: [] } });
    const query = createGraphqlQueries({
      execute,
      target: "public-api",
      dimensionCap: 2,
    });
    const rows = (await query("closedInvestOrders", {
      tokenId: `0x${"1".repeat(32)}`,
    })) as any[];
    expect(rows.map((r) => r.account)).toEqual(["0x1", "0x2", "0x3"]);
    expect(execute.mock.calls[0]![1]).toMatchObject({ first: 2, offset: 0 });
    expect(execute.mock.calls[1]![1]).toMatchObject({ first: 2, offset: 2 });
  });

  it("excludes stub rows from BOTH manager collections", async () => {
    // Both documents carry `isStub: false`, as the `queries/sql` adapter does.
    // Without it on either one, public mode would return unresolved hub
    // INTENTS alongside deployed managers. The live sql-vs-public-api
    // comparison on a seeded stub row covers this too, but it is gated on a
    // reachable endpoint and the divergence is one a caller cannot see (a
    // stub's address looks like any other), so it is pinned here as well.
    //
    // Asserted on the DOCUMENT rather than on filtered output: the filtering
    // happens server-side, so a fake that returned two rows and expected one
    // would only be testing the fake.
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ merkleProofManagers: { nodes: [] } })
      .mockResolvedValueOnce({ onOffRampManagers: { nodes: [] } });
    const query = createGraphqlQueries({ execute, target: "public-api" });

    await query("merkleProofManagers", { poolId: "1", centrifugeId: "2" });
    await query("onOffRampManagers", {
      tokenId: `0x${"1".repeat(32)}`,
      centrifugeId: "2",
    });

    for (const call of execute.mock.calls) {
      expect(call[0] as string).toContain("isStub: false");
    }
  });

  it("carries an integer chainId through as a decimal string", async () => {
    const execute = vi.fn().mockResolvedValue({
      blockchains: {
        nodes: [
          {
            id: "chain-1",
            explorer: null,
            chainId: 1,
            centrifugeId: "1",
            icon: null,
            name: "ethereum",
            network: "mainnet",
          },
        ],
      },
    });
    const query = createGraphqlQueries({ execute, target: "public-api" });
    const result = (await query("blockchains", {})) as any[];
    expect(result).toEqual([
      {
        explorer: null,
        chainId: "1",
        centrifugeId: "1",
        icon: null,
        name: "ethereum",
        network: "mainnet",
      },
    ]);
  });

  it('refuses a row whose chainId is null, naming the row, instead of returning the string "null"', async () => {
    const execute = vi.fn().mockResolvedValue({
      blockchains: {
        nodes: [
          {
            id: "chain-2",
            explorer: null,
            chainId: null,
            centrifugeId: "2",
            icon: null,
            name: "unknown",
            network: "testnet",
          },
        ],
      },
    });
    const query = createGraphqlQueries({ execute, target: "public-api" });
    await expect(query("blockchains", {})).rejects.toThrow(/chain-2/);
    await expect(query("blockchains", {})).rejects.toThrow(/"chainId"/);
  });
});

describe("public-api crosschainMessageRows", () => {
  const node = (overrides: Record<string, unknown> = {}) => ({
    id: `0x${"c1".repeat(32)}`,
    index: 0,
    poolId: "281474976710657",
    fromCentrifugeId: "1",
    toCentrifugeId: "2",
    messageType: "ManagerCallFromHub",
    status: "AWAITING_BATCH_DELIVERY",
    failReason: null,
    executedAt: null,
    executedAtTxHash: null,
    failedAt: null,
    clearedAt: null,
    crosschainPayload: { status: "UNDERPAID" },
    ...overrides,
  });

  it("reads the status of the batch each message travels in, null while the message is unlinked", async () => {
    const execute = vi.fn().mockResolvedValue({
      crosschainMessages: {
        totalCount: 2,
        nodes: [node({ index: 1, crosschainPayload: null }), node()],
      },
    });
    const query = createGraphqlQueries({ execute, target: "public-api" });

    const rows = (await query("crosschainMessageRows", {
      ids: [`0x${"C1".repeat(32)}`],
    })) as any[];

    const document = execute.mock.calls[0]![0] as string;
    expect(document).toContain("crosschainPayload { status }");
    expect(execute.mock.calls[0]![1]).toMatchObject({
      ids: [`0x${"c1".repeat(32)}`],
    });
    expect(
      rows.map((row) => [row.index, row.status, row.payloadStatus]),
    ).toEqual([
      [0, "AwaitingBatchDelivery", "Underpaid"],
      [1, "AwaitingBatchDelivery", null],
    ]);
  });

  it("refuses a payload status it does not know rather than passing it through", async () => {
    const execute = vi.fn().mockResolvedValue({
      crosschainMessages: {
        totalCount: 1,
        nodes: [node({ crosschainPayload: { status: "LOST" } })],
      },
    });
    const query = createGraphqlQueries({ execute, target: "public-api" });

    await expect(
      query("crosschainMessageRows", { ids: [`0x${"c1".repeat(32)}`] }),
    ).rejects.toThrow('crosschain_payload.status "LOST"');
  });
});
