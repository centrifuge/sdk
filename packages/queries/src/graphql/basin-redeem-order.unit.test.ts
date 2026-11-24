import { describe, expect, it } from "vitest";
import { PUBLIC_API_RESOLVERS } from "./public-api";

/**
 * The redeem-order link and its ambiguity refusal, against a stubbed
 * executor.
 *
 * These paths are why the flag exists. #617 found the original guard was dead
 * code that handed a GUESSED order to the close-modal "ready to close" gate,
 * and the first version of this adapter reproduced that bug exactly — it
 * compared the warning type against the Postgres spelling
 * (`redeemOrderLinkAmbiguous`) where PostGraphile emits
 * `REDEEM_ORDER_LINK_AMBIGUOUS`, so the flag silently never fired. A live
 * round-trip against an empty database passes either way, so the behaviour is
 * pinned here with the warning actually present.
 */

const BASIN = "0xf08943f817e1f902debc884c7b19ea5764594ac9";
const REDEEMER = "0x7c5ce1a1d50a6cb3da97c9e202b3e7cd8e5b5b6c";
const CTX = { entry: "basinRedeemRequests", dimensionCap: 1000 };

const ORDER = {
  index: 7,
  approvedAt: "2026-01-02T00:00:00.000000+00:00",
  revokedAt: "2026-01-03T00:00:00.000000+00:00",
  claimedAt: "2026-01-04T00:00:00.000000+00:00",
  revokedSharesAmount: "1000",
  revokedAssetsAmount: "2000",
  revokedWithNavPoolPerShare: "654321",
  revokedWithNavAssetPerShare: "123456",
};

function request(overrides: Record<string, unknown> = {}) {
  return {
    basinAddress: BASIN,
    requestId: "req-1",
    centrifugeId: 1,
    poolId: 1,
    tokenId: "0xtok",
    assetId: 42,
    redeemer: REDEEMER,
    state: "INITIATED",
    creditTokenAmount: 100,
    collateralTokenAmountQuoted: 200,
    collateralTokenReturned: null,
    initiatedAt: "2026-01-01T00:00:00.000000+00:00",
    initiatedAtBlock: 1,
    initiatedAtTxHash: "0xb",
    spokeRedeemRequestedAt: null,
    completedAt: null,
    completedAtTxHash: null,
    linkedRedeemOrderIndex: 7,
    redeemOrder: ORDER,
    ...overrides,
  };
}

/**
 * An executor that answers each collection from a fixture and records which
 * documents were issued, so the "skip the second read" case is observable.
 */
function stub(requests: unknown[], warnings: unknown[]) {
  const issued: string[] = [];
  const execute = async (document: string) => {
    issued.push(document);
    if (document.includes("basinReconciliationWarnings")) {
      return {
        basinReconciliationWarnings: {
          totalCount: warnings.length,
          nodes: warnings,
        },
      };
    }
    return {
      basinRedeemRequests: { totalCount: requests.length, nodes: requests },
    };
  };
  return { execute, issued };
}

const resolve = (execute: any, params: Record<string, unknown> = {}) =>
  PUBLIC_API_RESOLVERS.basinRedeemRequests!(
    execute,
    { basinAddress: BASIN, limit: 1000, ...params },
    CTX,
  ) as Promise<any[]>;

describe("basinRedeemRequests: linked order and ambiguity", () => {
  it("joins the order when no warning exists", async () => {
    const { execute } = stub([request()], []);
    const [row] = await resolve(execute);

    expect(row.redeemOrderLinkAmbiguous).toBe(false);
    expect(row.redeemOrder).toEqual({
      index: 7,
      approvedAt: ORDER.approvedAt,
      revokedAt: ORDER.revokedAt,
      claimedAt: ORDER.claimedAt,
      revokedSharesAmount: "1000",
      revokedAssetsAmount: "2000",
      revokedWithNavPoolPerShare: "654321",
      revokedWithNavAssetPerShare: "123456",
    });
  });

  it("carries claimedAt, which is what the close gate turns on", async () => {
    // apps-management's `isRedeemClaimable` requires a non-null `claimedAt`.
    // Before backend#655 the field was absent from this row, so the app ran a
    // second direct api-v4 query to get it.
    const { execute } = stub([request()], []);
    const [row] = await resolve(execute);
    expect(row.redeemOrder.claimedAt).toBe(ORDER.claimedAt);
  });

  it("keeps the pool- and asset-priced revocations apart", async () => {
    // Two different prices for one revocation. Collapsing them would misprice
    // the close-modal summary with a plausible-looking number.
    const { execute } = stub([request()], []);
    const [row] = await resolve(execute);
    expect(row.redeemOrder.revokedWithNavPoolPerShare).toBe("654321");
    expect(row.redeemOrder.revokedWithNavAssetPerShare).toBe("123456");
  });

  it("maps absent amounts to null rather than zero", async () => {
    // A null amount means "not revoked yet"; zero means "revoked for nothing".
    // Defaulting the first to the second would read as a real revocation.
    const { execute } = stub(
      [
        request({
          redeemOrder: {
            ...ORDER,
            claimedAt: null,
            revokedSharesAmount: null,
            revokedAssetsAmount: null,
            revokedWithNavPoolPerShare: null,
          },
        }),
      ],
      [],
    );
    const [row] = await resolve(execute);
    expect(row.redeemOrder.claimedAt).toBe(null);
    expect(row.redeemOrder.revokedSharesAmount).toBe(null);
    expect(row.redeemOrder.revokedAssetsAmount).toBe(null);
    expect(row.redeemOrder.revokedWithNavPoolPerShare).toBe(null);
  });

  it("suppresses the order when the basin has an ambiguity warning", async () => {
    const { execute } = stub(
      [request()],
      [{ type: "REDEEM_ORDER_LINK_AMBIGUOUS", basinAddress: BASIN }],
    );
    const [row] = await resolve(execute);

    expect(row.redeemOrderLinkAmbiguous).toBe(true);
    // Refused, not guessed — this is the #617 failure. The WHOLE order is
    // withheld, including `claimedAt`, so an ambiguous link cannot satisfy
    // the close gate by leaking the one field it turns on.
    expect(row.redeemOrder).toBe(null);
    // The index still travels, so a caller can tell "we cannot tell" from
    // "no order yet". Both show `redeemOrder: null`.
    expect(row.linkedRedeemOrderIndex).toBe(7);
  });

  it("matches the warning's basin address case-insensitively", async () => {
    const { execute } = stub(
      [request()],
      [
        {
          type: "REDEEM_ORDER_LINK_AMBIGUOUS",
          basinAddress: BASIN.toUpperCase().replace("0X", "0x"),
        },
      ],
    );
    const [row] = await resolve(execute);
    expect(row.redeemOrderLinkAmbiguous).toBe(true);
  });

  it("ignores warnings of another type, and other basins' warnings", async () => {
    const { execute } = stub(
      [request()],
      [
        { type: "COMPLETE_ORPHAN", basinAddress: BASIN },
        {
          type: "REDEEM_ORDER_LINK_AMBIGUOUS",
          basinAddress: "0x1111111111111111111111111111111111111111",
        },
        { type: "REDEEM_ORDER_LINK_AMBIGUOUS", basinAddress: null },
      ],
    );
    const [row] = await resolve(execute);

    expect(row.redeemOrderLinkAmbiguous).toBe(false);
    expect(row.redeemOrder).not.toBe(null);
  });

  it("reports no order, unambiguously, when the relation did not resolve", async () => {
    // What a `redeemer` / `redeem_order.account` case mismatch would produce:
    // the relation joins on EXACT equality, so it yields null. Distinct from
    // the ambiguous case above, which is why the flag is a separate field.
    const { execute } = stub(
      [request({ redeemOrder: null, linkedRedeemOrderIndex: 7 })],
      [],
    );
    const [row] = await resolve(execute);

    expect(row.redeemOrder).toBe(null);
    expect(row.redeemOrderLinkAmbiguous).toBe(false);
    expect(row.linkedRedeemOrderIndex).toBe(7);
  });

  it("skips the warning read when no row carries a link", async () => {
    const { execute, issued } = stub(
      [request({ linkedRedeemOrderIndex: null, redeemOrder: null })],
      [{ type: "REDEEM_ORDER_LINK_AMBIGUOUS", basinAddress: BASIN }],
    );
    const [row] = await resolve(execute);

    expect(issued.some((d) => d.includes("basinReconciliationWarnings"))).toBe(
      false,
    );
    expect(row.redeemOrderLinkAmbiguous).toBe(false);
    expect(row.redeemOrder).toBe(null);
  });

  it("refuses rather than sampling when the warning table exceeds the cap", async () => {
    const { execute } = stub([request()], []);
    const overflowing = async (document: string) => {
      const data: any = await execute(document);
      if (data.basinReconciliationWarnings) {
        data.basinReconciliationWarnings.totalCount = 5000;
      }
      return data;
    };
    // A truncated page could miss the one warning that should have
    // suppressed an order, so the read refuses instead.
    await expect(resolve(overflowing)).rejects.toThrow(/cap/i);
  });
});
