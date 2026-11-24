import { describe, expect, it } from "vitest";
import { sdkCatalogue, type SdkQueryName } from "../core/sdk-catalogue";
import {
  createRestQueries,
  RestQueryError,
  RestRouteMissingError,
  toSdkQueries,
} from "./adapter";
import {
  poolIdFromShareClassId,
  REST_ROUTE_OWNERS,
  REST_ROUTES,
  type RestRouteTable,
} from "./routes";

const BASE_URL = "https://backend.example/api";

/** A fetch stub that records calls and answers from a scripted queue. */
function stubFetch(
  answer: (url: string, init?: RequestInit) => Response | Promise<Response>,
) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = (async (input: any, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return await answer(String(input), init);
  }) as unknown as typeof fetch;
  return { fetch: fetchImpl, calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("rest route table", () => {
  it("ships exactly the entries the backend has endpoints for", () => {
    expect(Object.keys(REST_ROUTES).sort()).toEqual([
      // Vaults: the vertical's ONLY catalogue-consuming read. Everything
      // else on its read list is contract reads, and `vault.investment()`
      // consumes no catalogue entry in either mode.
      "allVaults",
      // Holdings: both of the vertical's catalogue-consuming reads. The rest
      // of its read list is RPC and the bundled protocol registry, so there
      // is nothing else to route.
      "assetRegistrations",
      // Tokenizations.
      "blockchains",
      // Orders: all seven of the vertical's catalogue-consuming reads, here
      // and below. Two SERVE (the epoch-level lists) and five land on a route
      // that answers 503 NOT_YET_PROJECTED — which is the point rather than a
      // compromise: the alternative is the CORRUPTED investor address
      // public-api carries, and that value is who a `notifyRedeem` would
      // credit. The two per-share-class rows (apps-management#1420) refuse
      // like the per-epoch ones.
      "closedInvestOrders",
      "closedRedeemOrders",
      // Pool access: all four of the vertical's catalogue-consuming reads.
      "crosschainMessage",
      "crosschainMessages",
      // Orders, continued (see the two per-share-class rows above).
      "epochInvestOrders",
      "epochRedeemOrders",
      // Holdings: `shareClass.balances()`'s indexer half.
      "holdingEscrows",
      "investOrderState",
      // Investors: five of the vertical's six. The sixth,
      // `investorPortfolioSources`, is a MISSING endpoint — the GLOBAL,
      // pool-less address catalogue `Investor.portfolio()` pairs with an
      // on-chain `balanceOf` has nothing on the private-api surface to bind
      // to, because every vault and token-instance route is pool-scoped for
      // the role guard.
      "investorTransactions",
      // Basin: all five of the vertical's catalogue-consuming reads; every
      // catalogue entry an app consumes needs a backend route.
      "merkleProofManagers",
      "offRampAddresses",
      "onOffRampManagers",
      "onOffRampRelayers",
      "onRampAssets",
      "poolAdapters",
      "poolManagers",
      "pools",
      "redeemOrderState",
      "redeemOrdersByEpoch",
      // NAV: both of the vertical's catalogue-consuming reads. The rest of
      // its read list is contract reads (`_metrics`, `valuation`,
      // `pool.currency`, `pool.decimals`) or the already-routed
      // `tokenInstances`.
      "sharePricesReport",
      "shareYieldsReport",
      "tokenInstancePosition",
      "tokenInstancePositions",
      "tokenInstances",
      "whitelistedInvestor",
      "whitelistedInvestors",
    ]);
  });

  it("leaves no pool-access entry on the graphql fallback", () => {
    // All four pool-access entries are routed to REST. The rest of that
    // vertical's read list consumes no catalogue entry in either mode:
    // `Pool.adapters()` and `Centrifuge.adapters()`/`globalAdapters()` are
    // `MultiAdapter` CONTRACT reads, which a REST read may not do because
    // reads never touch the chain, and `isPoolManager()` /
    // `isBalanceSheetManager()` /
    // `balanceSheetManagers()` / `balanceSheetManagerStatus()` are entity-side
    // filters over `poolManagers` itself.
    const owned = (Object.keys(REST_ROUTE_OWNERS) as SdkQueryName[]).filter(
      (name) => REST_ROUTE_OWNERS[name] === "pool-access",
    );
    expect(owned.sort()).toEqual([
      "crosschainMessage",
      "crosschainMessages",
      "poolAdapters",
      "poolManagers",
    ]);
    for (const name of owned) {
      expect(REST_ROUTES, `${name} still falls back to graphql`).toHaveProperty(
        name,
      );
    }
  });

  it("routes poolManagers at the path the backend serves, with no query string", () => {
    // No filter travels: the entry declares `{ poolId }` and nothing else, and
    // the endpoint's DTO is strict-empty, so an invented parameter is refused
    // rather than ignored. Sending one would also narrow the REST body
    // relative to the graphql body for the same catalogue call.
    expect(REST_ROUTES.poolManagers!.path({ poolId: "281474976710657" })).toBe(
      "pools/281474976710657/managers",
    );
  });

  it("does not map poolManagers' 404 onto an empty list", () => {
    // `[]` is a REAL answer for this entry — a pool mid-projection with no
    // manager rows yet — so `absent` would make "this pool does not exist"
    // indistinguishable from "nobody manages it", and `pool.isPoolManager()`
    // would keep answering a confident `false` about a pool that is not there.
    expect(REST_ROUTES.poolManagers!.absent).toBe(undefined);
  });

  it("leaves no holdings entry on the graphql fallback", () => {
    // Both holdings entries are routed to REST. Same rule as the orders and
    // Basin verticals: an entry with an owner and no {@link REST_ROUTES} row
    // is a route the backend still owes, not a decision to serve it from
    // graphql — only `public-api` means that. Inverted (drop either row) this
    // goes red.
    const owned = (Object.keys(REST_ROUTE_OWNERS) as SdkQueryName[]).filter(
      (name) => REST_ROUTE_OWNERS[name] === "holdings",
    );
    expect(owned.sort()).toEqual(["assetRegistrations", "holdingEscrows"]);
    for (const name of owned) {
      expect(REST_ROUTES, `${name} still falls back to graphql`).toHaveProperty(
        name,
      );
    }
  });

  it("leaves no vaults entry on the graphql fallback", () => {
    // One entry, so the rule is trivially satisfied — but the assertion that
    // matters is the FIRST one: it pins that `allVaults` is the whole of the
    // vertical's catalogue surface. If a later change gives `vault.details()`
    // or `vault.investment()` an entry of its own, this goes red and whoever
    // adds it has to decide where it is served from rather than inheriting a
    // silent fallback.
    const owned = (Object.keys(REST_ROUTE_OWNERS) as SdkQueryName[]).filter(
      (name) => REST_ROUTE_OWNERS[name] === "vaults",
    );
    expect(owned).toEqual(["allVaults"]);
    for (const name of owned) {
      expect(REST_ROUTES, `${name} still falls back to graphql`).toHaveProperty(
        name,
      );
    }
  });

  it("leaves no NAV entry on the graphql fallback", () => {
    // Both NAV entries need a route, and here the rule is not a formality:
    // "leave them on graphql" is not an available answer, because public-api —
    // the SDK's DEFAULT graphql target — cannot serve either one
    // (`capabilities.ts` marks both `blocked` on the missing
    // `connection-filter` plugin), so without a route both raise
    // `UnsupportedQueryError`. The first assertion also pins that these two
    // are the whole of the vertical's catalogue surface.
    const owned = (Object.keys(REST_ROUTE_OWNERS) as SdkQueryName[]).filter(
      (name) => REST_ROUTE_OWNERS[name] === "nav",
    );
    expect(owned.sort()).toEqual(["sharePricesReport", "shareYieldsReport"]);
    for (const name of owned) {
      expect(REST_ROUTES, `${name} still falls back to graphql`).toHaveProperty(
        name,
      );
    }
  });

  it("leaves no Basin entry on the graphql fallback", () => {
    // The binding rule, as a test rather than as prose: an entry owned by a
    // vertical and missing its {@link REST_ROUTES} row is a route the backend
    // still owes, not a decision to serve it from graphql. Inverted (drop any
    // one of the five rows) this goes red, which is the point — the list
    // above would too, but this one names the rule.
    const owned = (Object.keys(REST_ROUTE_OWNERS) as SdkQueryName[]).filter(
      (name) => REST_ROUTE_OWNERS[name] === "on-off-ramp",
    );
    expect(owned.length).toBe(5);
    for (const name of owned) {
      expect(REST_ROUTES, `${name} still falls back to graphql`).toHaveProperty(
        name,
      );
    }
  });

  it("leaves no orders entry on the graphql fallback", () => {
    // Six of the eight land on a route that REFUSES, and that still satisfies
    // the rule: the rule is about where an entry is SERVED FROM, and "leave it
    // on graphql" is not an available answer when the graphql answer contains
    // a corrupted investor address.
    const owned = (Object.keys(REST_ROUTE_OWNERS) as SdkQueryName[]).filter(
      (name) => REST_ROUTE_OWNERS[name] === "orders",
    );
    expect(owned.sort()).toEqual([
      "closedInvestOrders",
      "closedRedeemOrders",
      "epochInvestOrders",
      "epochRedeemOrders",
      "investOrderState",
      "redeemOrderState",
      "redeemOrdersByEpoch",
    ]);
    for (const name of owned) {
      expect(REST_ROUTES, `${name} still falls back to graphql`).toHaveProperty(
        name,
      );
    }
  });

  it("leaves only the missing investors endpoint on the graphql fallback", () => {
    // Five of the six are routed to REST. `investorPortfolioSources` is the
    // exception and it is NOT a decision: it is the GLOBAL catalogue of every
    // vault asset address and every share token address across every pool,
    // which
    // `Investor.portfolio()` pairs with an on-chain `balanceOf`. Every
    // private-api route that could serve those addresses is pool-scoped,
    // because `PoolRolesGuard` reads the pool out of the path, so there is
    // nothing to bind a route to. Named here so the day the backend ships
    // one, this test says so.
    const owned = (Object.keys(REST_ROUTE_OWNERS) as SdkQueryName[]).filter(
      (name) => REST_ROUTE_OWNERS[name] === "investors",
    );
    expect(owned.sort()).toEqual([
      "investorPortfolioSources",
      "investorTransactions",
      "tokenInstancePosition",
      "tokenInstancePositions",
      "whitelistedInvestor",
      "whitelistedInvestors",
    ]);
    for (const name of owned) {
      if (name === "investorPortfolioSources") {
        expect(REST_ROUTES).not.toHaveProperty(name);
        continue;
      }
      expect(REST_ROUTES, `${name} still falls back to graphql`).toHaveProperty(
        name,
      );
    }
  });

  it("scopes every investor route to the pool the guard authorises on", () => {
    const tokenId = "0x00010000000000060000000000000001";
    const poolId = poolIdFromShareClassId(tokenId);
    const address = "0x1111111111111111111111111111111111111111";
    const prefix = `pools/${poolId}/share-classes/${tokenId}/investors`;

    expect(
      REST_ROUTES.whitelistedInvestors?.path({ tokenId, limit: 20, offset: 0 }),
    ).toBe(`${prefix}?status=whitelisted&limit=20&offset=0`);
    expect(
      REST_ROUTES.whitelistedInvestor?.path({
        tokenId,
        centrifugeId: "2",
        accountAddress: address,
      }),
    ).toBe(`${prefix}/${address}?centrifugeId=2`);
    expect(
      REST_ROUTES.tokenInstancePosition?.path({
        tokenId,
        centrifugeId: "2",
        accountAddress: address,
      }),
    ).toBe(`${prefix}/${address}?centrifugeId=2`);
    // The transactions route is pool-scoped WITHOUT a share class: its entry
    // is keyed by (account, poolId), and a `GET /investors/:address?poolId=`
    // shape cannot be used because the guard reads `req.params.poolId` and
    // nothing else.
    expect(
      REST_ROUTES.investorTransactions?.path({
        account: address,
        poolId: "281474976710657",
        limit: 10,
        offset: 20,
      }),
    ).toBe(
      `pools/281474976710657/investors/${address}/transactions` +
        `?limit=10&offset=20`,
    );
  });

  it("asks the holders route for holders, and refuses the filters it cannot express", () => {
    const tokenId = "0x00010000000000060000000000000001";
    const base = {
      tokenId,
      excludedAddresses: [] as string[],
      orderBy: "balance",
      orderDirection: "desc" as const,
      limit: 20,
      offset: 0,
    };
    const path = REST_ROUTES.tokenInstancePositions!.path;

    expect(path(base)).toContain("status=holder");
    // The exclusion list reaches SQL, where it has to be: filtering a returned
    // page would make `total` wrong and hand back short pages.
    expect(
      path({
        ...base,
        excludedAddresses: [
          "0x2222222222222222222222222222222222222222",
          "0x3333333333333333333333333333333333333333",
        ],
      }),
    ).toContain(
      "excludeAddresses=0x2222222222222222222222222222222222222222" +
        "%2C0x3333333333333333333333333333333333333333",
    );
    // A single network narrows server-side; a proper subset of several cannot
    // be expressed and is REFUSED rather than dropped — a dropped filter
    // serves the unnarrowed list to a caller who believes it was narrowed.
    expect(path({ ...base, centrifugeIds: ["2"] })).toContain("centrifugeId=2");
    expect(() => path({ ...base, centrifugeIds: ["2", "3"] })).toThrow(
      /centrifugeIds/,
    );
    // `balance_gt: 0` IS `status=holder`; any other threshold is not.
    expect(() => path({ ...base, balanceGt: "0" })).not.toThrow();
    expect(() => path({ ...base, balanceGt: "1" })).toThrow(/balance_gt/);
    expect(() => path({ ...base, holderAddress: "0xdead" })).toThrow(
      /holderAddress/,
    );
    expect(() => path({ ...base, orderBy: "createdAt" })).toThrow(/orderBy/);
    expect(() => path({ ...base, orderDirection: "asc" })).toThrow(/orderBy/);
  });

  it("projects each half out of the merged investor row, and null when that half is absent", () => {
    // `ShareClassInvestor` is a FULL OUTER JOIN of the two source tables, so an
    // address in only one of them still produces a row. Each entry must answer
    // `null` for the half that is not there rather than synthesise one:
    // `validUntil: null` on an address that was never whitelisted would read as
    // a lapsed membership, and `balance: "0"` on one that never held would read
    // as an investor who sold out.
    const whitelistOnly = {
      tokenId: "0x00010000000000060000000000000001",
      centrifugeId: "2",
      accountAddress: "0x1111111111111111111111111111111111111111",
      isWhitelisted: true,
      isFrozen: false,
      isHolder: false,
      validUntil: "2030-01-01T00:00:00.000Z",
      whitelistedAt: "2026-01-01T00:00:00.000Z",
      balance: null,
      decimals: null,
      positionCreatedAt: null,
      positionUpdatedAt: null,
    };
    const positionOnly = {
      ...whitelistOnly,
      isWhitelisted: false,
      isHolder: true,
      validUntil: null,
      whitelistedAt: null,
      balance: "1000",
      decimals: 6,
      positionCreatedAt: "2026-02-01T00:00:00.000Z",
      positionUpdatedAt: "2026-03-01T00:00:00.000Z",
    };

    expect(
      REST_ROUTES.whitelistedInvestor!.decode!(whitelistOnly, {} as any),
    ).toEqual({
      accountAddress: whitelistOnly.accountAddress,
      centrifugeId: "2",
      createdAt: whitelistOnly.whitelistedAt,
      isFrozen: false,
      validUntil: whitelistOnly.validUntil,
      isWhitelisted: true,
    });
    expect(
      REST_ROUTES.tokenInstancePosition!.decode!(whitelistOnly, {} as any),
    ).toBe(null);
    expect(
      REST_ROUTES.whitelistedInvestor!.decode!(positionOnly, {} as any),
    ).toBe(null);
    expect(
      REST_ROUTES.tokenInstancePosition!.decode!(positionOnly, {} as any),
    ).toEqual({
      accountAddress: positionOnly.accountAddress,
      balance: "1000",
      centrifugeId: "2",
      createdAt: positionOnly.positionCreatedAt,
      isFrozen: false,
      tokenId: positionOnly.tokenId,
      updatedAt: positionOnly.positionUpdatedAt,
    });

    // The list decodes drop the other half's rows and keep the endpoint's
    // FILTERED count, which is what the client's tab label shows.
    expect(
      REST_ROUTES.whitelistedInvestors!.decode!(
        { items: [whitelistOnly, positionOnly], total: 7 },
        {} as any,
      ),
    ).toEqual({
      items: [
        {
          accountAddress: whitelistOnly.accountAddress,
          centrifugeId: "2",
          createdAt: whitelistOnly.whitelistedAt,
          isFrozen: false,
          validUntil: whitelistOnly.validUntil,
          isWhitelisted: true,
        },
      ],
      totalCount: 7,
    });
    expect(
      (
        REST_ROUTES.tokenInstancePositions!.decode!(
          { items: [whitelistOnly, positionOnly], total: 7 },
          {} as any,
        ) as { items: unknown[]; totalCount: number }
      ).items,
    ).toHaveLength(1);
  });

  it("maps only the per-address 404 to an empty answer", () => {
    // Both single-row entries declare `| null`, so their contract already has
    // a "no such row" answer and `absent` keeps both transports answering it.
    // The LIST entries get none: an empty page is the real answer for a share
    // class nobody has subscribed to yet, so folding a pool-level 404 into it
    // would make "this pool does not exist" read as "this fund has no
    // investors".
    expect(REST_ROUTES.whitelistedInvestor!.absent).toEqual({
      code: "INVESTOR_NOT_FOUND",
      value: null,
    });
    expect(REST_ROUTES.tokenInstancePosition!.absent).toEqual({
      code: "INVESTOR_NOT_FOUND",
      value: null,
    });
    expect(REST_ROUTES.whitelistedInvestors!.absent).toBe(undefined);
    expect(REST_ROUTES.tokenInstancePositions!.absent).toBe(undefined);
    expect(REST_ROUTES.investorTransactions!.absent).toBe(undefined);
  });

  it("refuses to decode the blocked transactions route rather than pass its envelope through", () => {
    // The endpoint answers 503, so the adapter raises first and this decode is
    // unreachable — by design rather than by luck. The failure to design
    // against is the day it starts answering 200 and the adapter hands the
    // response envelope back as the entry's result type.
    expect(() =>
      REST_ROUTES.investorTransactions!.decode!({ items: [] }, {} as any),
    ).toThrow(/investor_transaction\.account/);
  });

  it("scopes every order route to the pool the guard authorises on", () => {
    // Same rule as the Basin rows: every order entry is keyed by `tokenId`
    // alone, and `PoolRolesGuard` reads the pool id out of the PATH, so the
    // route has to carry the pool the share class belongs to. The endpoint
    // re-checks the pairing server-side and answers 404 for another pool's
    // scId, which is why deriving it here is safe.
    const tokenId = "0x00010000000000060000000000000001";
    const poolId = poolIdFromShareClassId(tokenId);
    const prefix = `pools/${poolId}/share-classes/${tokenId}/orders`;

    expect(REST_ROUTES.epochInvestOrders?.path({ tokenId, limit: 1000 })).toBe(
      `${prefix}?state=closed&side=invest&granularity=epoch&limit=1000`,
    );
    expect(REST_ROUTES.epochRedeemOrders?.path({ tokenId, limit: 1000 })).toBe(
      `${prefix}?state=closed&side=redeem&granularity=epoch&limit=1000`,
    );
    expect(REST_ROUTES.investOrderState?.path({ tokenId, limit: 1000 })).toBe(
      `${prefix}/state?side=invest`,
    );
    expect(REST_ROUTES.redeemOrderState?.path({ tokenId, limit: 1000 })).toBe(
      `${prefix}/state?side=redeem`,
    );
  });

  it("carries the redeem side's per-investor join key and never the invest side's", () => {
    // The redeem side joins per-investor rows to their epoch by index. The
    // invest side's key is `approvedAtTxHash` (sync investments all carry
    // index 0), and no catalogue entry sends it any more: the invest side is
    // read whole per share class. A route that carried it here would produce
    // a URL the endpoint refuses as 422, so the absence is pinned.
    const tokenId = "0x00010000000000060000000000000001";
    const assetId = "5192296858534827628530496329220097";

    const redeem = REST_ROUTES.redeemOrdersByEpoch?.path({
      tokenId,
      assetId,
      index: 3,
      onlyUnclaimed: true,
      limit: 1000,
    });
    expect(redeem).toContain("granularity=investor");
    expect(redeem).toContain("index=3");
    expect(redeem).toContain("onlyUnclaimed=true");
    expect(redeem).not.toContain("approvedAtTxHash");

    // `onlyUnclaimed=false` must survive as the word `false`: the endpoint
    // spells the flag exactly, because `z.coerce.boolean()` makes every
    // non-empty string true and this flag decides whether already-notified
    // investors are dropped from a batch.
    expect(
      REST_ROUTES.redeemOrdersByEpoch?.path({
        tokenId,
        assetId,
        index: 3,
        onlyUnclaimed: false,
        limit: 1000,
      }),
    ).toContain("onlyUnclaimed=false");
  });

  it("passes the epoch reads' optional narrowing through, and nothing else", () => {
    const tokenId = "0x00010000000000060000000000000001";
    const assetId = "5192296858534827628530496329220097";

    expect(
      REST_ROUTES.epochRedeemOrders?.path({
        tokenId,
        assetId,
        index: 2,
        limit: 500,
      }),
    ).toBe(
      `pools/${poolIdFromShareClassId(tokenId)}/share-classes/${tokenId}` +
        `/orders?state=closed&side=redeem&granularity=epoch&limit=500` +
        `&assetId=${assetId}&index=2`,
    );
  });

  it("routes the per-share-class closed-order reads at granularity=investor without a limit", () => {
    const tokenId = "0x00010000000000010001000000000001";
    expect(REST_ROUTES.closedInvestOrders?.path({ tokenId })).toBe(
      `pools/${poolIdFromShareClassId(tokenId)}/share-classes/${tokenId}` +
        `/orders?state=closed&side=invest&granularity=investor`,
    );
    expect(REST_ROUTES.closedRedeemOrders?.path({ tokenId })).toBe(
      `pools/${poolIdFromShareClassId(tokenId)}/share-classes/${tokenId}` +
        `/orders?state=closed&side=redeem&granularity=investor`,
    );
  });

  it("refuses to build an order path from a share class id it cannot parse", () => {
    for (const route of [
      REST_ROUTES.epochInvestOrders,
      REST_ROUTES.epochRedeemOrders,
      REST_ROUTES.closedInvestOrders,
      REST_ROUTES.closedRedeemOrders,
      REST_ROUTES.investOrderState,
      REST_ROUTES.redeemOrderState,
    ]) {
      expect(() =>
        route?.path({ tokenId: "not-a-share-class", limit: 1000 } as never),
      ).toThrow(/share class id/);
    }
  });

  it("never lets an unprojected order entry decode a body silently", () => {
    // The failure mode to design against is not the 503, it is the day the
    // endpoint answers 200 and the adapter hands the response ENVELOPE back as
    // the entry's result type. Omitting `decode` would do exactly that, so the
    // five refusing rows carry one that throws.
    for (const name of [
      "redeemOrdersByEpoch",
      "closedInvestOrders",
      "closedRedeemOrders",
      "investOrderState",
      "redeemOrderState",
    ] as const) {
      const decode = REST_ROUTES[name]?.decode;
      expect(decode, `${name} has no decode`).toBeDefined();
      expect(() => decode?.({ items: [] } as never, {} as never)).toThrow(
        new RegExp(name),
      );
    }
  });

  it("unwraps the orders envelope and drops what the entry does not declare", () => {
    // The endpoint answers `{ items, protocolVersion, migrationStatus }`: a
    // pool-shaped response carries the version fields and each ROW is bound
    // field for field, so they ride on the envelope. A caller must not be able
    // to tell which adapter served them, and public-api
    // returns only the declared fields — so `poolId`, `tokenId`,
    // `createdAtTxHash` and the asset's `address` are discarded here.
    const decoded = REST_ROUTES.epochRedeemOrders?.decode?.(
      {
        protocolVersion: "3.2",
        migrationStatus: "live",
        items: [
          {
            poolId: "281474976710657",
            tokenId: "0x00010000000000060000000000000001",
            assetId: "42",
            index: 1,
            approvedAt: "2026-02-01T00:00:00.000Z",
            approvedAtTxHash: `0x${"ab".repeat(32)}`,
            approvedSharesAmount: "500000",
            revokedAt: "2026-03-01T00:00:00.000Z",
            revokedAtTxHash: `0x${"cd".repeat(32)}`,
            revokedSharesAmount: "500000",
            revokedAssetsAmount: "550000",
            revokedWithNavPoolPerShare: "1100000000000000000",
            revokedWithNavAssetPerShare: "1050000000000000000",
            createdAtTxHash: `0x${"ab".repeat(32)}`,
            asset: {
              id: "42",
              centrifugeId: "1",
              address: `0x${"aa".repeat(20)}`,
              name: "USD Coin",
              symbol: "USDC",
              decimals: 6,
              assetTokenId: null,
            },
            token: {
              id: "0x00010000000000060000000000000001",
              decimals: 18,
              centrifugeId: "1",
            },
          },
        ],
      } as never,
      {} as never,
    );

    expect(decoded).toHaveLength(1);
    const row = decoded![0]!;
    expect(Object.keys(row).sort()).toEqual(
      [
        "approvedAt",
        "approvedSharesAmount",
        "asset",
        "index",
        "revokedAssetsAmount",
        "revokedAt",
        "revokedSharesAmount",
        "revokedWithNavAssetPerShare",
        "revokedWithNavPoolPerShare",
        "token",
        "assetId",
      ].sort(),
    );
    expect(Object.keys(row.asset!).sort()).toEqual([
      "centrifugeId",
      "decimals",
      "id",
      "name",
      "symbol",
    ]);
    expect(Object.keys(row.token!)).toEqual(["decimals"]);
  });

  it("maps every order field to its OWN name, not a neighbour's", () => {
    // The hole a key-set assertion leaves open, closed deterministically.
    // Mapping `revokedAssetsAmount` from `row.revokedSharesAmount` keeps the
    // key set correct and silently swaps two money figures denominated in
    // DIFFERENT units — assets against shares. So every source field carries
    // its own name as its value, and every target must read back its own name.
    // Nothing about the mapper is assumed: the expectation is generated from
    // the field list, so a cross-wiring is a mismatch rather than a matching
    // pair of mistakes.
    const scalarFields = {
      epochInvestOrders: [
        "assetId",
        "issuedAt",
        "issuedAtTxHash",
        "approvedAt",
        "approvedAtTxHash",
        "issuedSharesAmount",
        "approvedAssetsAmount",
        "issuedWithNavPoolPerShare",
        "issuedWithNavAssetPerShare",
      ],
      epochRedeemOrders: [
        "assetId",
        "revokedAt",
        "approvedAt",
        "approvedSharesAmount",
        "revokedSharesAmount",
        "revokedAssetsAmount",
        "revokedWithNavPoolPerShare",
        "revokedWithNavAssetPerShare",
      ],
    } as const;

    for (const [entry, fields] of Object.entries(scalarFields) as [
      keyof typeof scalarFields,
      readonly string[],
    ][]) {
      // Every field of the ENDPOINT's row, each holding its own name. The
      // union of both sides' fields is sent, so a mapper reading the other
      // side's column would find a value and still be caught.
      const source: Record<string, unknown> = { index: 7 };
      for (const list of Object.values(scalarFields)) {
        for (const field of list) {
          source[field] = field;
        }
      }
      source.poolId = "poolId";
      source.tokenId = "tokenId";
      source.createdAtTxHash = "createdAtTxHash";
      source.asset = {
        id: "id",
        centrifugeId: "centrifugeId",
        address: "address",
        name: "name",
        symbol: "symbol",
        decimals: 6,
        assetTokenId: null,
      };
      source.token = { id: "id", decimals: 18, centrifugeId: "centrifugeId" };

      const rows = REST_ROUTES[entry]?.decode?.(
        { items: [source] } as never,
        {} as never,
      ) as unknown as Record<string, unknown>[];

      expect(rows, entry).toHaveLength(1);
      for (const field of fields) {
        expect(rows[0]![field], `${entry}.${field}`).toBe(field);
      }
      expect(rows[0]!.index, `${entry}.index`).toBe(7);
      expect(rows[0]!.asset, `${entry}.asset`).toEqual({
        id: "id",
        centrifugeId: "centrifugeId",
        name: "name",
        symbol: "symbol",
        decimals: 6,
      });
      expect(rows[0]!.token, `${entry}.token`).toEqual({ decimals: 18 });
    }
  });

  it("keeps a null asset or token null, rather than an object of undefineds", () => {
    // The sql adapter nulls the whole join when the row is unusable, because
    // `decimals` is the SCALE every amount in these reads carries and a
    // guessed 18 would misprice a redemption by twelve orders of magnitude. A
    // decode that built `{ decimals: undefined }` would undo that.
    const rows = REST_ROUTES.epochInvestOrders?.decode?.(
      {
        items: [{ assetId: "42", index: 1, asset: null, token: null }],
      } as never,
      {} as never,
    ) as unknown as Record<string, unknown>[];

    expect(rows[0]!.asset).toBeNull();
    expect(rows[0]!.token).toBeNull();
  });

  it("refuses an orders body that is not the envelope", () => {
    // A bare array, or a 200 with no `items`, must not silently become an
    // empty page — that would read as "this share class has no orders".
    for (const body of [[], null, { rows: [] }, "nope"]) {
      expect(() =>
        REST_ROUTES.epochInvestOrders?.decode?.(body as never, {} as never),
      ).toThrow(/items/);
    }
  });

  it("scopes every Basin route to the pool the guard authorises on", () => {
    // `PoolRolesGuard` reads the pool id out of the PATH, so a route whose
    // entry is keyed by `tokenId` alone still has to carry one. A row that
    // dropped the pool segment would produce a URL no endpoint serves — a 404
    // rather than a leak — but it would also be the shape a future
    // "simplification" reaches for, so the pairing is pinned here.
    const tokenId = "0x00010000000000060000000000000001";
    const poolId = poolIdFromShareClassId(tokenId);

    expect(
      REST_ROUTES.merkleProofManagers?.path({ poolId, centrifugeId: "11" }),
    ).toBe(`basin/pools/${poolId}/merkle-proof-managers?centrifugeId=11`);
    expect(
      REST_ROUTES.onOffRampManagers?.path({ tokenId, centrifugeId: "11" }),
    ).toBe(
      `basin/pools/${poolId}/share-classes/${tokenId}` +
        `/on-off-ramp-managers?centrifugeId=11`,
    );
    expect(
      REST_ROUTES.offRampAddresses?.path({ tokenId, centrifugeId: "1" }),
    ).toBe(
      `basin/pools/${poolId}/share-classes/${tokenId}` +
        `/off-ramp-addresses?centrifugeId=1`,
    );
    expect(
      REST_ROUTES.onOffRampRelayers?.path({ tokenId, centrifugeId: "1" }),
    ).toBe(
      `basin/pools/${poolId}/share-classes/${tokenId}/relayers?centrifugeId=1`,
    );
    expect(REST_ROUTES.onRampAssets?.path({ tokenId, centrifugeId: "2" })).toBe(
      `basin/pools/${poolId}/share-classes/${tokenId}` +
        `/on-ramp-assets?centrifugeId=2`,
    );
  });

  it("refuses to build a Basin path from a share class id it cannot parse", () => {
    // The derivation decides which URL to call. A malformed id must throw
    // rather than interpolate `NaN` into a path and read an arbitrary pool.
    for (const route of [
      REST_ROUTES.onOffRampManagers,
      REST_ROUTES.offRampAddresses,
      REST_ROUTES.onOffRampRelayers,
      REST_ROUTES.onRampAssets,
    ]) {
      expect(() =>
        route?.path({ tokenId: "not-a-share-class", centrifugeId: "1" }),
      ).toThrow(/share class id/);
    }
  });

  it("never routes an entry that stays on public-api by decision", () => {
    // `deployments` is version-keyed registry data public-api owns
    // permanently, not a row waiting for a vertical.
    for (const name of Object.keys(REST_ROUTES) as SdkQueryName[]) {
      expect(
        REST_ROUTE_OWNERS[name],
        `${name} is routed but owned by public-api`,
      ).not.toBe("public-api");
    }
  });

  it("classifies every catalogue entry's route owner, and nothing else", () => {
    const entries = Object.keys(sdkCatalogue).sort();
    expect(Object.keys(REST_ROUTE_OWNERS).sort()).toEqual(entries);
  });

  it("only names real catalogue entries in the route table", () => {
    for (const name of Object.keys(REST_ROUTES)) {
      expect(sdkCatalogue).toHaveProperty(name);
    }
  });
});

describe("createRestQueries fallback", () => {
  it("delegates an unrouted entry to the graphql fallback, untouched", async () => {
    const { fetch: fetchImpl, calls } = stubFetch(() => json({}));
    const seen: { name: string; params: unknown }[] = [];
    const query = createRestQueries({
      baseUrl: BASE_URL,
      transport: { fetch: fetchImpl },
      routes: {},
      fallback: async (name, params) => {
        seen.push({ name, params });
        return [{ id: "from-graphql" }];
      },
    });

    const result = await query("pools", {});

    expect(result).toEqual([{ id: "from-graphql" }]);
    expect(seen).toEqual([{ name: "pools", params: {} }]);
    // No REST request went out for an unrouted entry.
    expect(calls).toEqual([]);
  });

  it("hands the fallback the caller's raw params, unvalidated", async () => {
    // `investorTransactions` has required params. The rest adapter must not
    // validate them on the fallback path: the fallback adapter owns that, and
    // validating twice would reject params one adapter accepts and the other
    // does not.
    const seen: unknown[] = [];
    const query = createRestQueries({
      baseUrl: BASE_URL,
      transport: { fetch: stubFetch(() => json({})).fetch },
      routes: {},
      fallback: async (_name, params) => {
        seen.push(params);
        return null;
      },
    });

    await query("investorTransactions", { nonsense: true });

    expect(seen).toEqual([{ nonsense: true }]);
  });

  it("throws RestRouteMissingError when there is no route and no fallback", async () => {
    const query = createRestQueries({
      baseUrl: BASE_URL,
      transport: { fetch: stubFetch(() => json({})).fetch },
      routes: {},
    });

    await expect(query("pools", {})).rejects.toBeInstanceOf(
      RestRouteMissingError,
    );
  });

  it("rejects an unknown catalogue entry name", async () => {
    const query = createRestQueries({
      baseUrl: BASE_URL,
      transport: { fetch: stubFetch(() => json({})).fetch },
      fallback: async () => null,
    });

    await expect(query("nopeNotAnEntry" as SdkQueryName, {})).rejects.toThrow(
      /Unknown query catalogue entry/,
    );
  });
});

describe("createRestQueries routed entries", () => {
  // A staged route, exactly the shape a vertical will add.
  const routes: RestRouteTable = {
    poolManagers: { path: (params) => `pools/${params.poolId}/managers` },
    pools: { path: () => "pools" },
  };

  it("GETs the routed path against baseUrl and returns the body as-is", async () => {
    const body = [
      {
        centrifugeId: "1",
        poolId: "281474976710657",
        address: "0xA4A7Bb3831958463b3FE3E27A6a160F764341953",
        isHubManager: true,
        isBalancesheetManager: false,
      },
    ];
    const { fetch: fetchImpl, calls } = stubFetch(() => json(body));
    const query = createRestQueries({
      baseUrl: BASE_URL,
      transport: { fetch: fetchImpl },
      routes,
      fallback: async () => {
        throw new Error("fallback must not be used for a routed entry");
      },
    });

    const result = await query("poolManagers", { poolId: "281474976710657" });

    expect(result).toEqual(body);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      "https://backend.example/api/pools/281474976710657/managers",
    );
    expect(calls[0]!.init?.method).toBe("GET");
  });

  it("joins baseUrl and path without doubling the slash", async () => {
    const { fetch: fetchImpl, calls } = stubFetch(() => json([]));
    const query = createRestQueries({
      baseUrl: "https://backend.example/api/",
      transport: { fetch: fetchImpl },
      routes: { pools: { path: () => "/pools" } },
    });

    await query("pools", {});

    expect(calls[0]!.url).toBe("https://backend.example/api/pools");
  });

  it("validates params against the catalogue before building the path", async () => {
    const { fetch: fetchImpl, calls } = stubFetch(() => json([]));
    const query = createRestQueries({
      baseUrl: BASE_URL,
      transport: { fetch: fetchImpl },
      routes,
    });

    // `poolId` must be a uint64 decimal string; the entry's schema is strict.
    await expect(
      query("poolManagers", { poolId: "not-a-pool" }),
    ).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it("sends no cookie, credential or CSRF header of its own", async () => {
    const { fetch: fetchImpl, calls } = stubFetch(() => json([]));
    const query = createRestQueries({
      baseUrl: BASE_URL,
      transport: { fetch: fetchImpl },
      routes,
    });

    await query("pools", {});

    const init = calls[0]!.init as RequestInit & { credentials?: string };
    expect(init.credentials).toBeUndefined();
    const headers = init.headers as Record<string, string>;
    expect(Object.keys(headers)).toEqual(["Accept"]);
  });

  it("fails loud on a routed entry's HTTP error instead of falling back", async () => {
    let fallbackCalls = 0;
    const { fetch: fetchImpl } = stubFetch(() =>
      json({ error: "not_found", code: "POOL_NOT_FOUND" }, 404),
    );
    const query = createRestQueries({
      baseUrl: BASE_URL,
      transport: { fetch: fetchImpl },
      routes,
      fallback: async () => {
        fallbackCalls++;
        return [];
      },
    });

    let error: unknown;
    try {
      await query("poolManagers", { poolId: "281474976710657" });
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(RestQueryError);
    expect((error as RestQueryError).status).toBe(404);
    expect((error as RestQueryError).code).toBe("POOL_NOT_FOUND");
    expect((error as RestQueryError).entry).toBe("poolManagers");
    // A broken route is a broken migration — it must not be masked.
    expect(fallbackCalls).toBe(0);
  });

  it("applies a route's decode hook to the parsed body", async () => {
    const row = {
      isHubManager: true,
      isBalancesheetManager: false,
      crosschainInProgress: null,
      address: "0xA4A7BB3831958463B3FE3E27A6A160F764341953",
      centrifugeId: "1",
      poolId: "281474976710657",
    } as const;
    const { fetch: fetchImpl } = stubFetch(() => json([row]));
    const query = createRestQueries({
      baseUrl: BASE_URL,
      transport: { fetch: fetchImpl },
      routes: {
        poolManagers: {
          path: (params) => `pools/${params.poolId}/managers`,
          // `decode` is typed to the entry's result type: a body that is not
          // assignable to `PoolManagerRow[]` cannot be returned from here,
          // which is the compile-time half of the shape rule. Address casing
          // is the kind of scalar normalization the shape rule permits.
          decode: (body) =>
            (body as (typeof row)[]).map((r) => ({
              ...r,
              address: r.address.toLowerCase() as `0x${string}`,
            })),
        },
      },
    });

    const result = await query("poolManagers", { poolId: "281474976710657" });

    expect(result).toEqual([
      { ...row, address: "0xa4a7bb3831958463b3fe3e27a6a160f764341953" },
    ]);
  });
});

describe("Tokenizations routes (the shipped table)", () => {
  /** The share class id the integration suite seeds for pool A. */
  const TOKEN_ID = "0x00010000000000010001000000000001";
  const POOL_A = "281474976710657";

  function shipped(
    answer: (url: string) => Response,
    fallback?: (name: SdkQueryName) => Promise<unknown>,
  ) {
    const { fetch: fetchImpl, calls } = stubFetch(answer);
    const query = createRestQueries({
      baseUrl: BASE_URL,
      transport: { fetch: fetchImpl },
      // No `routes` override: this exercises REST_ROUTES as it ships.
      fallback:
        fallback ??
        (async (name) => {
          throw new Error(`unexpected fallback for ${name}`);
        }),
    });
    return { query, calls };
  }

  it("derives a share class's pool id from its high 8 bytes", () => {
    // Cross-checked against `ShareClassId.poolId` in packages/sdk
    // (src/data/restRoutes.test.ts); these are the pairs the suite seeds.
    expect(poolIdFromShareClassId(TOKEN_ID)).toBe(POOL_A);
    expect(poolIdFromShareClassId("0x00020000000000070001000000000001")).toBe(
      "562949953421319",
    );
    // Counter beyond 1: only the low 8 bytes change.
    expect(poolIdFromShareClassId("0x0001000000000001000000000000002a")).toBe(
      POOL_A,
    );
    expect(poolIdFromShareClassId(`0x${"0".repeat(32)}`)).toBe("0");
  });

  it("refuses to derive a pool id from something that is not a bytes16", () => {
    expect(() => poolIdFromShareClassId("0x1234")).toThrow(/bytes16/);
    expect(() => poolIdFromShareClassId(POOL_A)).toThrow(/bytes16/);
  });

  it("routes tokenInstances under the pool the share class belongs to", async () => {
    const { query, calls } = shipped(() => json([]));

    await query("tokenInstances", { tokenId: TOKEN_ID });

    expect(calls[0]!.url).toBe(
      `${BASE_URL}/pools/${POOL_A}/share-classes/${TOKEN_ID}/token-instances`,
    );
  });

  it("routes blockchains to the unscoped reference read", async () => {
    const { query, calls } = shipped(() => json([]));

    await query("blockchains", {});

    expect(calls[0]!.url).toBe(`${BASE_URL}/blockchains`);
  });

  it("asks GET /pools for the catalogue's page ceiling, not the route's default", async () => {
    // `GET /pools` defaults to 100 rows; this entry means "up to 1000", the
    // same as the graphql adapter's `first`. Pinned against the catalogue's
    // own default so the two cannot drift.
    const catalogueCeiling = sdkCatalogue.epochInvestOrders.params.parse({
      tokenId: TOKEN_ID,
    }).limit;
    const { query, calls } = shipped(() => json([]));

    await query("pools", {});

    expect(calls[0]!.url).toBe(`${BASE_URL}/pools?limit=${catalogueCeiling}`);
  });

  it("narrows GET /pools rows to the entry's declared PoolRow shape", async () => {
    // The endpoint over-serves this route on purpose (one round trip also
    // feeds the app's multi-pool details case). The caller must not be able to
    // tell this adapter from graphql, which returns `id` and nothing else.
    const { query } = shipped(() =>
      json([
        {
          id: POOL_A,
          centrifugeId: "1",
          name: "Pool A",
          currency: "42",
          decimals: 6,
          metadata: "QmPoolA",
          isActive: true,
          protocolVersion: "3.2",
          migrationStatus: "live",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ]),
    );

    expect(await query("pools", {})).toEqual([
      { id: POOL_A, protocolVersion: "3.2", migrationStatus: "live" },
    ]);
  });

  it("refuses a GET /pools row without a string id", async () => {
    const { query } = shipped(() => json([{ poolId: POOL_A }]));

    await expect(query("pools", {})).rejects.toThrow(/string `id`/);
  });

  it("keeps unflipped entries on the graphql fallback", async () => {
    const seen: SdkQueryName[] = [];
    const { query, calls } = shipped(
      () => json([]),
      async (name) => {
        seen.push(name);
        return [];
      },
    );

    // The two entries with no REST route, and why each has none.
    //
    // `investorPortfolioSources` is unrouted because the backend is SHORT an
    // endpoint: it is the global, pool-less catalogue of every vault asset and
    // share-token address, and every private-api route that could serve it is
    // pool-scoped, since `PoolRolesGuard` reads the pool out of the PATH. It
    // stays a fallback until the backend grows an unscoped address catalogue.
    // `deployments` is public-api's own and never gets one.
    await query("investorPortfolioSources", {});
    await query("deployments", {});

    expect(seen).toEqual(["investorPortfolioSources", "deployments"]);
    expect(calls).toEqual([]);
  });

  it("maps the validation pipe's 422 (issues, no code) to VALIDATION_FAILED", async () => {
    // This backend answers 422, NOT 400, for a malformed request: the shared
    // ZodValidationPipe throws UnprocessableEntityException with
    // `{ error: "validation_failed", issues: [...] }` and no `code`.
    let fallbackCalls = 0;
    const { query } = shipped(
      () =>
        json(
          {
            error: "validation_failed",
            issues: [{ path: "scId", message: "scId must be a bytes16 hex" }],
          },
          422,
        ),
      async () => {
        fallbackCalls++;
        return [];
      },
    );

    let error: unknown;
    try {
      await query("tokenInstances", { tokenId: TOKEN_ID });
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(RestQueryError);
    expect((error as RestQueryError).status).toBe(422);
    expect((error as RestQueryError).code).toBe("VALIDATION_FAILED");
    expect((error as RestQueryError).message).toContain("validation_failed");
    expect(fallbackCalls).toBe(0);
  });

  it("prefers the backend's own code over the issues fallback", async () => {
    const { query } = shipped(() =>
      json(
        { error: "not_found", code: "SHARE_CLASS_NOT_FOUND", issues: [] },
        404,
      ),
    );

    await expect(
      query("tokenInstances", { tokenId: TOKEN_ID }),
    ).rejects.toMatchObject({ code: "SHARE_CLASS_NOT_FOUND", status: 404 });
  });

  it("does not fall back when a ROUTED entry fails", async () => {
    let fallbackCalls = 0;
    const { query } = shipped(
      () => json({ error: "internal_server_error" }, 500),
      async () => {
        fallbackCalls++;
        return [{ id: "from-graphql" }];
      },
    );

    await expect(query("pools", {})).rejects.toBeInstanceOf(RestQueryError);
    expect(fallbackCalls).toBe(0);
  });
});

describe("Holdings routes", () => {
  /** The share class the integration suite seeds for pool A. */
  const TOKEN_ID = "0x00010000000000010001000000000001";
  const POOL_A = "281474976710657";

  function shipped(answer: (url: string) => Response) {
    const { fetch: fetchImpl, calls } = stubFetch(answer);
    const query = createRestQueries({
      baseUrl: BASE_URL,
      transport: { fetch: fetchImpl },
      // No `routes` override: this exercises REST_ROUTES as it ships.
      fallback: async (name) => {
        throw new Error(`unexpected fallback for ${name}`);
      },
    });
    return { query, calls };
  }

  it("scopes the holdings read to the pool the guard authorises on", async () => {
    // `holdingEscrows` is keyed by share class alone and `PoolRolesGuard`
    // reads the pool id out of the PATH, so the row derives it. A URL without
    // the pool segment is a 404 rather than a leak, but it is also the shape a
    // "simplification" reaches for, so the pairing is pinned.
    const { query, calls } = shipped(() => json([]));

    await query("holdingEscrows", { tokenId: TOKEN_ID });

    expect(calls[0]!.url).toBe(
      `${BASE_URL}/pools/${POOL_A}/holdings?scId=${TOKEN_ID}`,
    );
  });

  it("refuses to build the holdings path from an unparseable share class id", () => {
    expect(() =>
      REST_ROUTES.holdingEscrows?.path({ tokenId: "not-a-share-class" }),
    ).toThrow(/share class id/);
  });

  it("routes assetRegistrations by the HUB chain, and sends no spoke filter", async () => {
    // `GET /assets` also accepts `spokeId`, and sending it would be wrong
    // here: `Centrifuge.assets()` filters on `asset.centrifugeId`
    // entity-side in BOTH modes, so a server-side narrowing would make the
    // REST body a subset of the graphql body for the same catalogue call —
    // exactly the difference read parity forbids.
    const { query, calls } = shipped(() => json([]));

    await query("assetRegistrations", { centrifugeId: "2" });

    expect(calls[0]!.url).toBe(`${BASE_URL}/assets?hubId=2`);
    expect(calls[0]!.url).not.toContain("spokeId");
  });

  it("passes both bodies through untouched: neither entry has a decode", async () => {
    // The endpoints serve `HoldingEscrow` / `AssetRegistration`, declared
    // field for field against the frozen SDK shapes, so the adapter maps
    // names only. A `decode` appearing here would mean somebody started
    // reshaping a body the shape rule binds.
    expect(REST_ROUTES.holdingEscrows?.decode).toBe(undefined);
    expect(REST_ROUTES.assetRegistrations?.decode).toBe(undefined);

    const escrowRow = {
      centrifugeId: "1",
      holding: { createdAt: "2026-01-01T00:00:00.000Z" },
      assetId: "42",
      escrowAddress: `0x${"cd".repeat(20)}`,
      assetAmount: "1000000",
      assetPrice: "1000000000000000000",
      asset: {
        decimals: 6,
        assetTokenId: null,
        address: `0x${"ab".repeat(20)}`,
        name: "USD Coin",
        symbol: "USDC",
        blockchain: { id: "11155111", centrifugeId: "1" },
      },
    };
    const registrationRow = { assetId: "42", asset: null };
    const { query } = shipped((url) =>
      url.includes("/holdings") ? json([escrowRow]) : json([registrationRow]),
    );

    expect(await query("holdingEscrows", { tokenId: TOKEN_ID })).toEqual([
      escrowRow,
    ]);
    expect(await query("assetRegistrations", { centrifugeId: "1" })).toEqual([
      registrationRow,
    ]);
  });

  it("keeps SHARE_CLASS_NOT_FOUND loud rather than reading it as no holdings", async () => {
    // The one deliberate refusal on this route, and the reason it has no
    // `absent` mapping: the SAME 404 code covers "no such share class" and
    // "another pool's share class", so mapping it to `[]` would turn a
    // refused cross-tenant probe into "this share class holds nothing" —
    // which is a real and different answer. `balances()` returns
    // an array and has no "no such row" answer in its signature.
    const { query } = shipped(() =>
      json({ error: "not_found", code: "SHARE_CLASS_NOT_FOUND" }, 404),
    );

    let error: unknown;
    try {
      await query("holdingEscrows", { tokenId: TOKEN_ID });
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(RestQueryError);
    expect((error as RestQueryError).status).toBe(404);
    expect((error as RestQueryError).code).toBe("SHARE_CLASS_NOT_FOUND");
    expect(REST_ROUTES.holdingEscrows?.absent).toBe(undefined);
  });

  it("still distinguishes an empty share class from a missing one", async () => {
    // The other half of the case above: `[]` from a 200 is a real answer and
    // must stay one. Without this, "always throw on the holdings route" would
    // pass the test above.
    const { query } = shipped(() => json([]));

    expect(await query("holdingEscrows", { tokenId: TOKEN_ID })).toEqual([]);
    expect(await query("assetRegistrations", { centrifugeId: "9999" })).toEqual(
      [],
    );
  });
});

describe("Vaults route", () => {
  const TOKEN_ID = "0x00010000000000010001000000000001";
  const POOL_A = "281474976710657";
  const VAULT = `0x${"11".repeat(20)}`;
  const ASSET_ADDRESS = `0x${"22".repeat(20)}`;

  /** One `PublicVault` as the vaults controller serialises it. */
  function publicVault(over: Record<string, unknown> = {}) {
    return {
      address: VAULT,
      centrifugeId: "2",
      poolId: POOL_A,
      tokenId: TOKEN_ID,
      kind: "Async",
      status: "Linked",
      assetId: "42",
      assetAddress: ASSET_ADDRESS,
      maxReserve: "1000000",
      manager: `0x${"33".repeat(20)}`,
      factory: `0x${"44".repeat(20)}`,
      asset: {
        id: "42",
        centrifugeId: "2",
        address: ASSET_ADDRESS,
        name: "USD Coin",
        symbol: "USDC",
        decimals: 6,
        assetTokenId: null,
      },
      ...over,
    };
  }

  function shipped(answer: (url: string) => Response) {
    const { fetch: fetchImpl, calls } = stubFetch(answer);
    const query = createRestQueries({
      baseUrl: BASE_URL,
      transport: { fetch: fetchImpl },
      // No `routes` override: this exercises REST_ROUTES as it ships.
      fallback: async (name) => {
        throw new Error(`unexpected fallback for ${name}`);
      },
    });
    return { query, calls };
  }

  it("scopes the vault read to the pool the guard authorises on", async () => {
    // Same pairing as the holdings row: the entry carries only the share class
    // id, `PoolRolesGuard` reads the pool out of the PATH, and the derivation
    // decides which URL to call rather than who may read it.
    const { query, calls } = shipped(() => json([]));

    await query("allVaults", { tokenId: TOKEN_ID });

    expect(calls[0]!.url).toBe(
      `${BASE_URL}/pools/${POOL_A}/vaults?scId=${TOKEN_ID}`,
    );
  });

  it("sends no centrifugeId filter, although the endpoint accepts one", async () => {
    // `shareClass.vaults(centrifugeId)` filters entity-side in BOTH modes and
    // the catalogue entry declares no such parameter, so a server-side
    // narrowing would make the REST body a subset of the graphql body for the
    // same catalogue call.
    const { query, calls } = shipped(() => json([]));

    await query("allVaults", { tokenId: TOKEN_ID });

    expect(calls[0]!.url).not.toContain("centrifugeId");
  });

  it("refuses to build the vault path from an unparseable share class id", () => {
    expect(() =>
      REST_ROUTES.allVaults?.path({ tokenId: "not-a-share-class" }),
    ).toThrow(/share class id/);
  });

  it("narrows PublicVault to the six fields the entry declares", async () => {
    const { query } = shipped(() => json([publicVault()]));

    expect(await query("allVaults", { tokenId: TOKEN_ID })).toEqual([
      {
        address: VAULT,
        poolId: POOL_A,
        assetAddress: ASSET_ADDRESS,
        status: "Linked",
        asset: { id: "42" },
        centrifugeId: "2",
      },
    ]);
  });

  it("builds `asset` from the vault row's assetId, not from the joined asset", async () => {
    // The one choice in the projection, and the case for it. `GET
    // /pools/:poolId/vaults` joins `chain_v1.asset` on `is_stub = false`, so a
    // non-stub vault pointing at a stub asset arrives with `assetId` set and
    // `asset: null`. The graphql adapter derives `{ id }` from the vault row's
    // OWN `assetId` column, so reading the joined object here would return
    // `null` where public-api returns `{ id: "42" }` — and
    // `ShareClass._allVaults()` turns that into a TypeError rather than an
    // AssetId. Inverted (read `row.asset.id`) this case goes red.
    const { query } = shipped(() =>
      json([publicVault({ asset: null, assetId: "42" })]),
    );

    const rows = (await query("allVaults", { tokenId: TOKEN_ID })) as {
      asset: unknown;
    }[];

    expect(rows[0]!.asset).toEqual({ id: "42" });
  });

  it("passes a genuinely unprojected asset through as null, as graphql does", async () => {
    // The other half: `assetId: null` is the projection saying it has not seen
    // the vault's asset yet, and public-api answers `asset: null` for it. The
    // adapter must not invent an id — without this case, "always emit { id }"
    // would pass the case above.
    const { query } = shipped(() =>
      json([publicVault({ assetId: null, asset: null })]),
    );

    const rows = (await query("allVaults", { tokenId: TOKEN_ID })) as {
      asset: unknown;
    }[];

    expect(rows[0]!.asset).toBe(null);
  });

  it("refuses a body that is not an array of vault rows", async () => {
    // A silent `[]` here would read as "this share class has no vaults", which
    // is what an operator uses to decide whether to deploy one.
    const { query } = shipped(() => json({ items: [publicVault()] }));

    await expect(query("allVaults", { tokenId: TOKEN_ID })).rejects.toThrow(
      /must answer with an array/,
    );
  });

  it("keeps SHARE_CLASS_NOT_FOUND loud rather than reading it as no vaults", async () => {
    // Same rule as the holdings row: one 404 code covers "no such share class"
    // and "another pool's share class", so an `absent` mapping would turn a
    // refused cross-tenant probe into an empty vault list.
    const { query } = shipped(() =>
      json({ error: "not_found", code: "SHARE_CLASS_NOT_FOUND" }, 404),
    );

    let error: unknown;
    try {
      await query("allVaults", { tokenId: TOKEN_ID });
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(RestQueryError);
    expect((error as RestQueryError).status).toBe(404);
    expect((error as RestQueryError).code).toBe("SHARE_CLASS_NOT_FOUND");
    expect(REST_ROUTES.allVaults?.absent).toBe(undefined);
  });

  it("still reads a 200 empty list as a share class with no vaults", async () => {
    const { query } = shipped(() => json([]));

    expect(await query("allVaults", { tokenId: TOKEN_ID })).toEqual([]);
  });
});

describe("NAV routes", () => {
  const POOL_A = "281474976710657";
  const SC_A1 = "0x00010000000000010001000000000001";
  const SC_A2 = "0x00010000000000010001000000000002";
  /** Another POOL's share class, for the cross-pool refusal. */
  const SC_B1 = "0x00020000000000070001000000000001";
  /** Every yield column the endpoint serves; the set the SDK asks for. */
  const YIELD_FIELDS = [
    "yield1d",
    "yield1d360",
    "yield1d365",
    "yield7d",
    "yield7d360",
    "yield7d365",
    "yield15d",
    "yield15d360",
    "yield15d365",
    "yield30d",
    "yield30d360",
    "yield30d365",
    "yield90d",
    "yield90d360",
    "yield90d365",
    "yield180d",
    "yield180d360",
    "yield180d365",
    "yield30dComp360",
    "yield30dComp365",
    "yieldTtm",
    "yieldSinceInception",
    "yieldYtd",
  ];

  /** One `SharePriceSnapshot` as the NAV controller serialises it. */
  function priceRow(over: Record<string, unknown> = {}) {
    return {
      tokenId: SC_A1,
      timestamp: "2026-01-02T00:00:00.000Z",
      totalIssuance: "110",
      tokenPrice: "1100000000000000000",
      triggerChainId: "11155111",
      ...over,
    };
  }

  /** One `ShareYieldSnapshot`, all 23 columns present as the endpoint sends. */
  function yieldRow(over: Record<string, unknown> = {}) {
    const row: Record<string, unknown> = {
      id: SC_A1,
      timestamp: "2026-01-02T00:00:00.000Z",
    };
    for (const field of YIELD_FIELDS) {
      row[field] = null;
    }
    return { ...row, yield1d: "550000000000000000000000000", ...over };
  }

  function shipped(answer: (url: string) => Response) {
    const { fetch: fetchImpl, calls } = stubFetch(answer);
    const query = createRestQueries({
      baseUrl: BASE_URL,
      transport: { fetch: fetchImpl },
      // No `routes` override: this exercises REST_ROUTES as it ships.
      fallback: async (name) => {
        throw new Error(`unexpected fallback for ${name}`);
      },
    });
    return { query, calls };
  }

  it("narrows to one share class with ?scId when the entry names one", async () => {
    const { query, calls } = shipped(() => json({ items: [] }));

    await query("sharePricesReport", { tokenIds: [SC_A1] });

    expect(calls[0]!.url).toBe(
      `${BASE_URL}/pools/${POOL_A}/nav/prices?limit=1000&scId=${SC_A1}`,
    );
  });

  it("asks for the whole pool when the entry names several share classes", async () => {
    // The endpoint has no multi-id form, on purpose. The only several-id
    // caller is
    // the unfiltered report, whose set IS the pool's share classes.
    const { query, calls } = shipped(() => json({ items: [] }));

    await query("shareYieldsReport", {
      tokenIds: [SC_A1, SC_A2],
      yieldFields: YIELD_FIELDS,
    });

    expect(calls[0]!.url).toBe(
      `${BASE_URL}/pools/${POOL_A}/nav/yields?limit=1000`,
    );
  });

  it("sends the catalogue's page ceiling, not the endpoint's default of 100", async () => {
    // Same trap as `pools`: the endpoint's DTO defaults `limit` to 100 and
    // these entries mean "up to 1000", which is what the SDK's api-v3 document
    // asks for. Taking the endpoint's default would silently truncate a NAV
    // chart to its last 100 rows.
    const { query, calls } = shipped(() => json({ items: [] }));

    await query("sharePricesReport", { tokenIds: [SC_A1] });

    expect(calls[0]!.url).toContain("limit=1000");
  });

  it("refuses an empty tokenIds set instead of asking for the whole pool", async () => {
    const { query, calls } = shipped(() => json({ items: [] }));

    await expect(query("sharePricesReport", { tokenIds: [] })).rejects.toThrow(
      /empty `tokenIds` set/,
    );
    // And nothing went out: the pool-wide URL would have answered with every
    // share class the caller did not ask about.
    expect(calls).toEqual([]);
  });

  it("refuses share class ids from two different pools", async () => {
    const { query, calls } = shipped(() => json({ items: [] }));

    await expect(
      query("sharePricesReport", { tokenIds: [SC_A1, SC_B1] }),
    ).rejects.toThrow(/more than one pool/);
    expect(calls).toEqual([]);
  });

  it("re-wraps the { items } envelope into the shape _process consumes", async () => {
    const { query } = shipped(() => json({ items: [priceRow()] }));

    expect(await query("sharePricesReport", { tokenIds: [SC_A1] })).toEqual({
      tokenInstanceSnapshots: { items: [priceRow()] },
    });
  });

  it("fails loud on a body that is not the { items } envelope", async () => {
    // A bare array is the shape the vaults and holdings routes use, so this is
    // the realistic mistake. Passing it through would hand `_process` a
    // `tokenInstanceSnapshots.items` of `undefined` and throw somewhere far
    // away; a silent `[]` would read as "this share class was never valued".
    const { query } = shipped(() => json([priceRow()]));

    await expect(
      query("sharePricesReport", { tokenIds: [SC_A1] }),
    ).rejects.toBeInstanceOf(RestQueryError);
  });

  it("keeps only the share classes the entry asked about", async () => {
    // Reachable only for a proper subset of two or more, which no SDK caller
    // produces — but an unrequested share class in a NAV report is a wrong
    // number, so the row set is narrowed rather than trusted.
    const { query } = shipped(() =>
      json({ items: [priceRow(), priceRow({ tokenId: SC_A2 })] }),
    );

    const result = (await query("sharePricesReport", {
      tokenIds: [SC_A1, SC_A2],
    })) as { tokenInstanceSnapshots: { items: { tokenId: string }[] } };
    expect(result.tokenInstanceSnapshots.items).toHaveLength(2);

    const { query: narrowed } = shipped(() =>
      json({ items: [priceRow(), priceRow({ tokenId: SC_A2 })] }),
    );
    // A pool with a third share class the caller did not name.
    const subset = (await narrowed("sharePricesReport", {
      tokenIds: [SC_A1, "0x00010000000000010001000000000003"],
    })) as { tokenInstanceSnapshots: { items: { tokenId: string }[] } };
    expect(
      subset.tokenInstanceSnapshots.items.map((row) => row.tokenId),
    ).toEqual([SC_A1]);
  });

  it("projects the yield rows onto the fields the caller named", async () => {
    // The graphql document is built field by field from `yieldFields`, so that
    // parameter decides the row shape there. The endpoint serves all 23
    // columns unconditionally, so the narrowing has to happen here for read
    // parity to hold for any `yieldFields`.
    const { query } = shipped(() => json({ items: [yieldRow()] }));

    expect(
      await query("shareYieldsReport", {
        tokenIds: [SC_A1],
        yieldFields: ["yield1d", "yieldTtm"],
      }),
    ).toEqual({
      tokenSnapshots: {
        items: [
          {
            id: SC_A1,
            timestamp: "2026-01-02T00:00:00.000Z",
            yield1d: "550000000000000000000000000",
            yieldTtm: null,
          },
        ],
      },
    });
  });

  it("refuses a yield field the endpoint does not serve", async () => {
    // Dropping it would make a typo indistinguishable from a window that has
    // genuinely produced no figure yet — both arrive as an absent field, and
    // the absent case is real (`yieldTtm` on a share class younger than a
    // year).
    const { query } = shipped(() => json({ items: [yieldRow()] }));

    await expect(
      query("shareYieldsReport", {
        tokenIds: [SC_A1],
        yieldFields: ["yield1d", "yield45d"],
      }),
    ).rejects.toThrow(/yield45d/);
  });

  it("sends no groupBy, from or to: the entries declare none", async () => {
    // The endpoint refuses `?groupBy` with 422 rather than ignoring it,
    // because the SDK sums the per-network rows into a daily total FIRST and
    // groups the totals second. The catalogue entries carry no window either,
    // so the route must not invent one.
    const { query, calls } = shipped(() => json({ items: [] }));

    await query("sharePricesReport", { tokenIds: [SC_A1] });

    expect(calls[0]!.url).not.toContain("groupBy");
    expect(calls[0]!.url).not.toContain("from=");
    expect(calls[0]!.url).not.toContain("to=");
  });

  it("does not fall back when the NAV series route fails", async () => {
    // Both entries are `blocked` on public-api, so a fallback here would not
    // even reach data — it would throw `UnsupportedQueryError` and disguise a
    // broken route as a capability gap.
    const { query } = shipped(() =>
      json({ error: "not_found", code: "POOL_NOT_FOUND" }, 404),
    );

    await expect(
      query("sharePricesReport", { tokenIds: [SC_A1] }),
    ).rejects.toMatchObject({ code: "POOL_NOT_FOUND", status: 404 });
  });
});

describe("Pool access routes", () => {
  const POOL_A = "281474976710657";
  const PAYLOAD = `0x${"a1".repeat(32)}`;

  function shipped(answer: (url: string) => Response) {
    const { fetch: fetchImpl, calls } = stubFetch(answer);
    const query = createRestQueries({
      baseUrl: BASE_URL,
      transport: { fetch: fetchImpl },
      // No `routes` override: this exercises REST_ROUTES as it ships.
      fallback: async (name) => {
        throw new Error(`unexpected fallback for ${name}`);
      },
    });
    return { query, calls };
  }

  it("routes poolAdapters with the whole (pool, local, remote) route key", async () => {
    const { query, calls } = shipped(() => json([]));

    await query("poolAdapters", {
      poolId: POOL_A,
      localCentrifugeId: "1",
      remoteCentrifugeId: "2",
    });

    expect(calls[0]!.url).toBe(
      `${BASE_URL}/pools/${POOL_A}/adapters` +
        `?localCentrifugeId=1&remoteCentrifugeId=2`,
    );
  });

  it("lifts the pool out of crosschainMessages' filter and into the path", async () => {
    // The pool is the `@PoolMembers()` scope, not a filter — the endpoint reads
    // it from the path segment, which is the only place the guard looks.
    const { query, calls } = shipped(() =>
      json({ items: [], totalCount: 0, pageInfo: {} }),
    );

    await query("crosschainMessages", {
      filter: { poolId: POOL_A },
      limit: 50,
      include: {},
    });

    expect(calls[0]!.url).toBe(
      `${BASE_URL}/pools/${POOL_A}/crosschain-messages?limit=50`,
    );
  });

  it("maps every filter key the endpoint accepts, `status_in` included", async () => {
    const { query, calls } = shipped(() =>
      json({ items: [], totalCount: 0, pageInfo: {} }),
    );

    await query("crosschainMessages", {
      filter: {
        poolId: POOL_A,
        fromCentrifugeId: "1",
        toCentrifugeId: "2",
        // api-v3's set-predicate spelling, which `buildWhere` produces for
        // `status: ['InTransit', 'Underpaid']`.
        status_in: ["InTransit", "Underpaid"],
        createdAtTxHash: `0x${"22".repeat(32)}`,
      },
      limit: 10,
      after: "cursor-a",
      include: { innerMessages: true, pool: true },
    });

    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe(`/api/pools/${POOL_A}/crosschain-messages`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      fromCentrifugeId: "1",
      toCentrifugeId: "2",
      createdAtTxHash: `0x${"22".repeat(32)}`,
      status: "InTransit,Underpaid",
      limit: "10",
      after: "cursor-a",
      include: "innerMessages,pool",
    });
  });

  it("maps a single `status` too, since the endpoint takes one parameter for both", async () => {
    const { query, calls } = shipped(() =>
      json({ items: [], totalCount: 0, pageInfo: {} }),
    );

    await query("crosschainMessages", {
      filter: { poolId: POOL_A, status: "Completed" },
      limit: 100,
      include: {},
    });

    expect(new URL(calls[0]!.url).searchParams.get("status")).toBe("Completed");
  });

  it("refuses an unscoped crosschainMessages read instead of picking a pool", async () => {
    // `centrifuge.crosschainMessages()` spans every pool, and no role
    // authorises that. Answering it for one arbitrary pool would be worse than
    // refusing: the caller would believe they had seen everything.
    const { query, calls } = shipped(() => json({}));

    await expect(
      query("crosschainMessages", { filter: {}, limit: 100, include: {} }),
    ).rejects.toThrow(/needs `filter.poolId`/);
    expect(calls).toHaveLength(0);
  });

  it("refuses an unrecognised filter key rather than dropping it", async () => {
    // A dropped filter serves the unnarrowed list to a caller who believes it
    // was narrowed — the same failure the endpoint's `.strict()` DTO refuses
    // from the other side.
    const { query } = shipped(() => json({}));

    await expect(
      query("crosschainMessages", {
        filter: { poolId: POOL_A, status_not: "Completed" },
        limit: 100,
        include: {},
      }),
    ).rejects.toThrow(/status_not/);
  });

  it("routes the single crosschainMessage read by (pool, id, index)", async () => {
    const { query, calls } = shipped(() => json({ id: PAYLOAD, index: 0 }));

    await query("crosschainMessage", {
      poolId: POOL_A,
      id: PAYLOAD,
      index: 3,
      include: { adapterParticipations: true },
    });

    expect(calls[0]!.url).toBe(
      `${BASE_URL}/pools/${POOL_A}/crosschain-messages/${PAYLOAD}` +
        `?index=3&include=adapterParticipations`,
    );
  });

  it("refuses a single crosschainMessage read with no pool", async () => {
    // `(id, index)` is the payload key but not an authorization scope, so the
    // caller has to be pool-scoped.
    const { query, calls } = shipped(() => json({}));

    await expect(
      query("crosschainMessage", { id: PAYLOAD, index: 0, include: {} }),
    ).rejects.toThrow(/needs a `poolId`/);
    expect(calls).toHaveLength(0);
  });

  it("reads CROSSCHAIN_MESSAGE_NOT_FOUND as null, not as a failure", async () => {
    // The entry's contract already has a "no such message" answer
    // (`queryCrosschainMessage` maps a null row to `undefined`), so this
    // route must not turn it into a thrown error.
    const { query } = shipped(() =>
      json({ error: "not_found", code: "CROSSCHAIN_MESSAGE_NOT_FOUND" }, 404),
    );

    await expect(
      query("crosschainMessage", {
        poolId: POOL_A,
        id: PAYLOAD,
        index: 0,
        include: {},
      }),
    ).resolves.toBeNull();
  });

  it("still fails loud on the OTHER 404 that route can answer", async () => {
    // `POOL_NOT_FOUND` is not an empty answer, it is a bad request: the caller
    // asked about a pool with no projected row. Swallowing it as `null` would
    // report "no such message" for every message in that pool.
    const { query } = shipped(() =>
      json({ error: "not_found", code: "POOL_NOT_FOUND" }, 404),
    );

    await expect(
      query("crosschainMessage", {
        poolId: POOL_A,
        id: PAYLOAD,
        index: 0,
        include: {},
      }),
    ).rejects.toMatchObject({ code: "POOL_NOT_FOUND", status: 404 });
  });

  it("does not read the absent code as empty on a non-404", async () => {
    // Both the status and the code must match, or a 500 that happened to carry
    // the code would be swallowed as "no such message".
    const { query } = shipped(() =>
      json({ error: "boom", code: "CROSSCHAIN_MESSAGE_NOT_FOUND" }, 500),
    );

    await expect(
      query("crosschainMessage", {
        poolId: POOL_A,
        id: PAYLOAD,
        index: 0,
        include: {},
      }),
    ).rejects.toBeInstanceOf(RestQueryError);
  });

  it("keeps a 404 loud for an entry with no `absent` mapping", async () => {
    // The reason `absent` is per entry and not a blanket rule: an unknown
    // share class must stay a broken-migration signal.
    const { query } = shipped(() =>
      json({ error: "not_found", code: "SHARE_CLASS_NOT_FOUND" }, 404),
    );

    await expect(
      query("tokenInstances", {
        tokenId: "0x00010000000000010001000000000001",
      }),
    ).rejects.toBeInstanceOf(RestQueryError);
  });
});

describe("a REST-served entry's failure matrix", () => {
  /**
   * Every way a route can misbehave must arrive as one catchable type, name
   * the entry and the url, and never reach the fallback. A caller reading 30
   * entries cannot be asked to also catch SyntaxError, TypeError and whatever
   * a `decode` threw.
   */
  function shipped(answer: (url: string) => Response | Promise<Response>): {
    query: ReturnType<typeof createRestQueries>;
    fallbacks: number;
  } {
    const box = { fallbacks: 0 };
    const query = createRestQueries({
      baseUrl: BASE_URL,
      transport: { fetch: stubFetch(answer).fetch },
      fallback: async () => {
        box.fallbacks++;
        return [{ id: "from-graphql" }];
      },
    });
    return {
      query,
      get fallbacks() {
        return box.fallbacks;
      },
    };
  }

  const STATUS_CASES: {
    label: string;
    status: number;
    body: unknown;
    code?: string;
  }[] = [
    {
      label: "409 conflict",
      status: 409,
      body: { error: "conflict", code: "CONCURRENT_MODIFICATION" },
      code: "CONCURRENT_MODIFICATION",
    },
    {
      // A read whose projection has not landed answers 503 NOT_YET_PROJECTED
      // rather than 200 with empty data. That is a routine answer as verticals
      // land, so it must reach the caller as a typed, code-carrying error and
      // never as an empty list.
      label: "503 NOT_YET_PROJECTED (the stub convention)",
      status: 503,
      body: {
        error: "service_unavailable",
        code: "NOT_YET_PROJECTED",
      },
      code: "NOT_YET_PROJECTED",
    },
    {
      label: "429 throttled with no code",
      status: 429,
      body: { error: "too_many_requests" },
      code: undefined,
    },
  ];

  for (const testCase of STATUS_CASES) {
    it(`maps ${testCase.label} to RestQueryError without falling back`, async () => {
      const harness = shipped(() => json(testCase.body, testCase.status));

      let error: unknown;
      try {
        await harness.query("blockchains", {});
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(RestQueryError);
      expect((error as RestQueryError).status).toBe(testCase.status);
      expect((error as RestQueryError).code).toBe(testCase.code);
      expect((error as RestQueryError).entry).toBe("blockchains");
      expect((error as RestQueryError).url).toBe(`${BASE_URL}/blockchains`);
      expect((error as RestQueryError).message).toContain("blockchains");
      expect(harness.fallbacks).toBe(0);
    });
  }

  it("wraps a 200 whose body is not JSON, keeping the parse error as cause", async () => {
    const harness = shipped(
      () =>
        new Response("<html>gateway</html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        }),
    );

    let error: unknown;
    try {
      await harness.query("blockchains", {});
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(RestQueryError);
    expect((error as RestQueryError).status).toBe(200);
    expect((error as RestQueryError).message).toContain("not JSON");
    expect((error as Error).cause).toBeInstanceOf(Error);
    expect(harness.fallbacks).toBe(0);
  });

  it("wraps a 200 whose body the entry's decode rejects", async () => {
    // `pools` decodes: a row without a string `id` is refused there, and that
    // refusal must reach the caller as a route failure, not as a bare Error.
    const harness = shipped(() => json([{ poolId: "281474976710657" }]));

    let error: unknown;
    try {
      await harness.query("pools", {});
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(RestQueryError);
    expect((error as RestQueryError).entry).toBe("pools");
    expect((error as RestQueryError).message).toContain("result type");
    expect(((error as Error).cause as Error).message).toContain("string `id`");
    expect(harness.fallbacks).toBe(0);
  });

  it("wraps a transport that never produced a response", async () => {
    // Connection refused, DNS failure, abort: no HTTP status exists, so the
    // error reports status 0 rather than inventing one.
    const refused = new TypeError("fetch failed: ECONNREFUSED 127.0.0.1:5099");
    const harness = shipped(() => {
      throw refused;
    });

    let error: unknown;
    try {
      await harness.query("blockchains", {});
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(RestQueryError);
    expect((error as RestQueryError).status).toBe(0);
    expect((error as RestQueryError).message).toContain("before any response");
    expect((error as Error).cause).toBe(refused);
    expect(harness.fallbacks).toBe(0);
  });
});

describe("toSdkQueries", () => {
  it("exposes one method per catalogue entry (the QueriesFor shape)", async () => {
    const query = createRestQueries({
      baseUrl: BASE_URL,
      transport: { fetch: stubFetch(() => json([])).fetch },
      routes: { pools: { path: () => "pools" } },
      fallback: async () => "fell-back",
    });
    const queries = toSdkQueries(query);

    expect(Object.keys(queries).sort()).toEqual(
      Object.keys(sdkCatalogue).sort(),
    );
    expect(await queries.pools({})).toEqual([]);
    expect(await queries.blockchains({})).toBe("fell-back");
  });
});
