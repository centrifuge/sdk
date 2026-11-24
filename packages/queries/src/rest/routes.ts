import type { QueryParams, QueryResult } from "../core/entry";
import type { SdkQueryCatalogue, SdkQueryName } from "../core/sdk-catalogue";
import type {
  EpochInvestOrderRow,
  EpochRedeemOrderRow,
  Hex,
  OrderAsset,
  OrderToken,
  PoolRow,
  VaultRow,
  TokenInstancePositionRow,
  WhitelistedInvestorRow,
} from "../core/sdk-types";
import type { ShareClassInvestor } from "../core/types";

/**
 * One catalogue entry's backend REST route.
 *
 * `path` is the only required half: it turns the entry's *validated* params
 * into a path (plus query string) relative to the adapter's `baseUrl`. The
 * params type comes from the catalogue entry, so a route that reads a field
 * the entry does not declare is a compile error.
 *
 * `decode` exists for the scalar work the shape rule permits (bigint /
 * address normalization). It is NOT a place to reshape or derive fields: each
 * response body is bound to the catalogue entry's result type field for
 * field, and the adapter "maps names only, never converts units or derives
 * fields".
 */
export interface RestRoute<E> {
  /**
   * Path relative to `baseUrl`, query string included. Must not start with a
   * slash — the adapter joins it.
   */
  path: (params: QueryParams<E>) => string;
  /** Optional scalar decoding of the parsed JSON body. */
  decode?: (body: unknown, params: QueryParams<E>) => QueryResult<E>;
  /**
   * A 404 whose `code` this entry's contract treats as an EMPTY ANSWER rather
   * than a failure.
   *
   * Per entry and code-matched on purpose: a blanket "404 means empty" would
   * hide a genuinely broken route, which is why `tokenInstances` keeps failing
   * loud on a 404 (`rest.unit.test.ts` pins it). Only entries whose SDK caller
   * already has a "no such row" answer in its signature may use this — today
   * `crosschainMessage`, whose `queryCrosschainMessage` maps a null row to
   * `undefined`. Without it that entry would throw {@link RestQueryError}
   * where its contract promises `undefined`, and the two transports would
   * disagree about what "no such message" means.
   *
   * `value` must be an immutable empty answer (`null`, not a fresh object a
   * caller could mutate into the shared table).
   */
  absent?: { code: string; value: QueryResult<E> };
}

/**
 * The per-entry route table: catalogue entry name -> REST route.
 *
 * Typed against the catalogue (`SdkQueryName` keys), so a row naming an entry
 * that does not exist fails to compile — which is what keeps this table from
 * drifting away from the catalogue it mirrors.
 *
 * Partial by design: an entry with no row falls back to the graphql adapter,
 * which is what makes backend mode complete from day one and lets a vertical
 * add one row at a time.
 */
export type RestRouteTable = {
  [K in SdkQueryName]?: RestRoute<SdkQueryCatalogue[K]>;
};

/**
 * Which vertical owns each entry's REST route.
 *
 * - `"tokenizations"`, `"holdings"`, `"vaults"`, `"pool-access"`, `"nav"`,
 *   `"investors"`, `"orders"`, `"on-off-ramp"` — the vertical whose endpoints
 *   serve the entry, and which carries its row in {@link REST_ROUTES}. An
 *   entry named here with no row in that table falls back to the graphql
 *   adapter, transparently, and the row is what the vertical still owes.
 * - `"public-api"` — served only by the GraphQL adapter, by decision rather
 *   than by omission: `deployments` is version-keyed registry data that lives
 *   on public-api, and the SDK reads it for display only, since the verified
 *   deployment registry it transacts against ships inside
 *   `@centrifuge/protocol`. `hubSharePricesReport` sits here too: backend
 *   mode delegates it to the graphql adapter per entry, like every unrouted
 *   entry, and the NAV vertical has no hub-series endpoint to route it to.
 *
 * Exhaustive over the catalogue: adding an entry without classifying it is a
 * compile error, so which entries still fall back — and which vertical
 * unblocks each one — can never silently drift from the catalogue.
 */
export type RestRouteOwner =
  | "tokenizations"
  | "holdings"
  | "vaults"
  | "pool-access"
  | "nav"
  | "investors"
  | "orders"
  | "on-off-ramp"
  | "public-api";

export const REST_ROUTE_OWNERS: Record<SdkQueryName, RestRouteOwner> = {
  // Tokenizations: pool and share-token identity.
  blockchains: "tokenizations",
  pools: "tokenizations",
  tokenInstances: "tokenizations",
  // Holdings: assets, holdings and their escrows.
  assetRegistrations: "holdings",
  holdingEscrows: "holdings",
  // Vaults.
  allVaults: "vaults",
  // Pool access: on-chain managers, adapters, crosschain messages.
  poolAdapters: "pool-access",
  poolManagers: "pool-access",
  crosschainMessages: "pool-access",
  crosschainMessage: "pool-access",
  // Migration reads (backend#600): served by public-api by decision, like
  // `deployments`; the per-spoke gate in private-api (#731) reads the same
  // projection through `queries/sql`, not through a route.
  poolMigration: "public-api",
  poolMigrationSteps: "public-api",
  shareManagerCalls: "public-api",
  crosschainMessageRows: "public-api",
  // Policy and authorization reads: no REST endpoint exists for these tables, so they fall back to GraphQL.
  poolAuthorizationEvents: "public-api",
  hubPolicies: "public-api",
  // NAV: the two snapshot-backed reports.
  sharePricesReport: "nav",
  shareYieldsReport: "nav",
  hubSharePricesReport: "public-api",
  // Investors: whitelist, holders, portfolios, statements.
  // Five of the six are routed below. `investorPortfolioSources` is the one
  // that is not, and it is a MISSING endpoint rather than a decision — see
  // the note on it in `REST_ROUTES`.
  whitelistedInvestors: "investors",
  whitelistedInvestor: "investors",
  tokenInstancePositions: "investors",
  tokenInstancePosition: "investors",
  investorPortfolioSources: "investors",
  investorTransactions: "investors",
  // Orders: epoch and per-investor order state.
  epochInvestOrders: "orders",
  closedInvestOrders: "orders",
  epochRedeemOrders: "orders",
  redeemOrdersByEpoch: "orders",
  closedRedeemOrders: "orders",
  investOrderState: "orders",
  redeemOrderState: "orders",
  // Basin: on/off-ramp and merkle-proof managers.
  offRampAddresses: "on-off-ramp",
  onOffRampRelayers: "on-off-ramp",
  onRampAssets: "on-off-ramp",
  merkleProofManagers: "on-off-ramp",
  onOffRampManagers: "on-off-ramp",
  // Stays on public-api by decision: version-keyed registry data.
  deployments: "public-api",
  // Basin (backend#629 Stage 2a). The private-api REST routes that #97 added
  // for these reads are session-authed behind `PoolRolesGuard`, so they are
  // not reachable from the SDK's credential-less surface; these five go to
  // public-api. Stage 3 of that issue adds the authed `/backend` variants.
  basinDebt: "public-api",
  basinDebtChanges: "public-api",
  basinFees: "public-api",
  basinSwaps: "public-api",
  basinRedeemRequests: "public-api",
};

/**
 * The catalogue's page ceiling, restated for the routes that must ask the
 * backend for it explicitly.
 *
 * `sdk-catalogue.ts` caps every paged entry's `limit` at 1000 and the graphql
 * adapter reads `first: 1000`, so an entry that carries no `limit` param — like
 * `pools` — still means "up to 1000 rows". The backend's `GET /pools` defaults
 * to a page of 100 (`pools.dto.ts`), which is the right default for an HTTP
 * caller and the wrong one for this entry: taking it would silently truncate
 * `centrifuge.pools()` at 100 pools where graphql returns 1000. Hence the
 * explicit query param. `rest.unit.test.ts` pins this to the catalogue's own
 * default so the three cannot drift apart.
 */
const CATALOGUE_PAGE_CEILING = 1000;

/**
 * Derive a share class's pool id from its id.
 *
 * A share class id is a bytes16 whose high 8 bytes are the pool id and whose
 * low 8 bytes are the per-pool counter — `ShareClassId.from(poolId, counter)`
 * in `packages/sdk` builds it as `(poolId << 64) + counter` and reads it back
 * as `id >> 64`. The derivation is therefore lossless and needs no lookup,
 * which is what lets the pool-scoped `token-instances` route be served from an
 * entry whose only param is the share class id.
 *
 * `packages/queries` cannot import `packages/sdk` (the dependency runs the
 * other way), so the shift is restated here; a unit test in `packages/sdk`
 * cross-checks it against `ShareClassId.poolId` itself.
 */
export function poolIdFromShareClassId(shareClassId: string): string {
  if (!/^0x[0-9a-fA-F]{32}$/.test(shareClassId)) {
    throw new Error(
      `Cannot derive a pool id from "${shareClassId}": a share class id is a ` +
        `bytes16 hex string (0x + 32 hex digits).`,
    );
  }
  return (BigInt(shareClassId) >> 64n).toString();
}

/**
 * Narrow `GET /pools` rows to the `pools` entry's declared result type.
 *
 * The endpoint deliberately over-serves this route: one body shape backs both
 * `centrifuge.pools()` (which reads `id`) and the app's multi-pool details
 * case (which reads the rest of the projected columns) in one round trip. The
 * catalogue entry declares `PoolRow { id }`, and a caller must not be able to
 * tell which adapter served them — graphql returns `id` and nothing else — so
 * the extra columns are dropped here.
 *
 * This is not the reshaping the shape rule forbids: no field is renamed, no
 * unit converted, no value derived. It only discards fields the entry does
 * not declare.
 */
function toPoolRows(body: unknown): PoolRow[] {
  if (!Array.isArray(body)) {
    throw new Error(
      `GET /pools must answer with an array; got ${typeof body}. The "pools" ` +
        `entry declares PoolRow[].`,
    );
  }
  return body.map((row) => {
    const { id, protocolVersion, migrationStatus } = (row ?? {}) as {
      id?: unknown;
      protocolVersion?: unknown;
      migrationStatus?: unknown;
    };
    if (typeof id !== "string") {
      // Loud beats plausible: a pool id is an identity, and `String(undefined)`
      // would hand the caller a `Pool` entity for pool "undefined".
      throw new Error(
        `GET /pools returned a row without a string \`id\`: ` +
          `${JSON.stringify(row)}.`,
      );
    }
    return {
      id,
      protocolVersion:
        typeof protocolVersion === "string" ? protocolVersion : null,
      migrationStatus:
        migrationStatus === "live" || migrationStatus === "migrating"
          ? migrationStatus
          : null,
    };
  });
}

/**
 * The Orders endpoints' path prefix for one share class.
 *
 * Pool-scoped even though every order entry is keyed by `tokenId` alone,
 * because `PoolRolesGuard` reads the pool id out of the PATH — the same reason
 * the Basin and `tokenInstances` rows carry one. The derivation is lossless
 * (see {@link poolIdFromShareClassId}) and the endpoint re-checks the pairing
 * against the projection server-side, answering 404 `SHARE_CLASS_NOT_FOUND`
 * when the share class is not that pool's. So this decides which URL to call,
 * not who may read it.
 */
function ordersPath(tokenId: string): string {
  return (
    `pools/${poolIdFromShareClassId(tokenId)}` +
    `/share-classes/${tokenId}/orders`
  );
}

/**
 * Unwrap the Orders list envelope.
 *
 * `GET .../orders` answers `{ items, protocolVersion, migrationStatus }`:
 * every pool-shaped response carries the version fields, while each ROW is
 * bound field for field to the catalogue entry's type — so they ride on the
 * envelope and the rows stay exactly the entry's shape. This is the unwrap,
 * and it is loud about a body that is not that envelope — a silent `[]` there
 * would read as "this share class has no orders".
 */
function orderItems(body: unknown, entry: string): unknown[] {
  const items = (body as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) {
    throw new Error(
      `The orders endpoint must answer with an \`items\` array for the ` +
        `"${entry}" entry; got ${JSON.stringify(body)?.slice(0, 200)}.`,
    );
  }
  return items;
}

/**
 * Project `GET /pools/:poolId/vaults` onto the frozen `VaultRow` shape.
 *
 * The endpoint serves `PublicVault`, a deliberate superset: it also
 * carries `tokenId`, `kind`, `manager`, `factory`, `maxReserve` and a joined
 * `asset` object with the display fields. None of the six is declared by the
 * `allVaults` entry, so all six are dropped here — the same discarding
 * {@link toPoolRows} and {@link toOrderAsset} do, and not the reshaping the
 * shape rule forbids: no field is renamed, no unit converted, no value
 * derived.
 *
 * ## `asset` comes from `assetId`, not from the joined `asset` object
 *
 * This is the one choice in the projection and it is made for read parity. The
 * entry declares `asset: { id }`, and the graphql adapter builds it from the
 * VAULT ROW's own `assetId` column (`public-api.ts`: `row.assetId != null ?
 * { id: String(row.assetId) } : null`). The REST body carries that same column
 * as `assetId`, plus a `asset` object joined from `chain_v1.asset` **with
 * `is_stub = false`**. The two disagree in exactly one case — a non-stub vault
 * whose asset row is a stub or missing — where `assetId` is set and `asset` is
 * `null`. Reading the joined object would then hand back `asset: null` where
 * graphql hands back `{ id }`, and `ShareClass._allVaults()` turns that into a
 * TypeError instead of an `AssetId`. So the same column feeds both adapters.
 *
 * Loud on a body that is not an array of rows: a silent `[]` would read as
 * "this share class has no vaults", which is a real and very different
 * answer, and it is the answer `poolNetwork.vaults()` puts in front of an
 * operator deciding whether to deploy one.
 */
function toVaultRows(body: unknown): VaultRow[] {
  if (!Array.isArray(body)) {
    throw new Error(
      "GET /pools/:poolId/vaults must answer with an array; got " +
        `${typeof body}. The "allVaults" entry declares VaultRow[].`,
    );
  }
  return body.map((item) => {
    const row = item as Record<string, unknown>;
    const assetId = row.assetId;
    return {
      address: row.address as VaultRow["address"],
      poolId: row.poolId as string,
      assetAddress: row.assetAddress as VaultRow["assetAddress"],
      status: row.status as string,
      // Widened by the frozen shape, which types this non-null while both
      // transports can produce `null`; passed through untouched, exactly as
      // the graphql adapter does. `_allVaults()` fails on it either way.
      asset: (assetId == null
        ? null
        : { id: String(assetId) }) as VaultRow["asset"],
      centrifugeId: row.centrifugeId as string,
    };
  });
}

/**
 * Narrow the endpoint's joined asset to the frozen `OrderAsset` shape.
 *
 * The endpoint over-serves: `chain_v1.asset` also carries `address` and
 * `assetTokenId`, which no order entry declares. Dropping them here is the
 * same discarding {@link toPoolRows} does and not the reshaping the shape
 * rule forbids — no field is renamed, no unit converted, no value derived.
 * A caller must not be able to tell which adapter served them, and public-api
 * returns only the declared fields.
 *
 * `name` / `symbol` are passed through as they arrive. `chain_v1` types them
 * nullable and the frozen shape does not, which is a widening the adapter
 * passes through untouched — the same allowance the Basin rows take for
 * addresses. They are display-only here (the SDK puts them straight into
 * `asset: { symbol, name, decimals }`), so a null renders blank rather than
 * mispricing anything; `decimals`, which IS a scale, is refused by the sql
 * adapter rather than defaulted, and the whole object arrives `null` when the
 * join found no usable row.
 */
function toOrderAsset(value: unknown): OrderAsset | null {
  if (value === null || value === undefined) {
    return null;
  }
  const row = value as Record<string, unknown>;
  return {
    id: row.id as string,
    decimals: row.decimals as number,
    symbol: row.symbol as string,
    name: row.name as string,
    centrifugeId: row.centrifugeId as string,
  };
}

/** Narrow the endpoint's joined share token to the frozen `OrderToken`. */
function toOrderToken(value: unknown): OrderToken | null {
  if (value === null || value === undefined) {
    return null;
  }
  return { decimals: (value as { decimals: number }).decimals };
}

/**
 * Project the endpoint's invest-epoch row onto `EpochInvestOrderRow`.
 *
 * The endpoint serves `EpochInvestOrder`, a superset: it additionally carries
 * `poolId`, `tokenId` and `createdAtTxHash`, added on the invest side
 * precisely so this endpoint's row shape would not depend on `?side=`. None of
 * the three is declared by the frozen SDK shape, so they are dropped here.
 */
function toEpochInvestOrderRows(body: unknown): EpochInvestOrderRow[] {
  return orderItems(body, "epochInvestOrders").map((item) => {
    const row = item as Record<string, unknown>;
    return {
      assetId: row.assetId as string,
      index: row.index as number,
      issuedAt: row.issuedAt as string | null,
      issuedAtTxHash: row.issuedAtTxHash as string | null,
      approvedAt: row.approvedAt as string | null,
      approvedAtTxHash: row.approvedAtTxHash as string | null,
      issuedSharesAmount: row.issuedSharesAmount as string | null,
      approvedAssetsAmount: row.approvedAssetsAmount as string | null,
      issuedWithNavPoolPerShare: row.issuedWithNavPoolPerShare as string | null,
      issuedWithNavAssetPerShare: row.issuedWithNavAssetPerShare as
        string | null,
      asset: toOrderAsset(row.asset),
      token: toOrderToken(row.token),
    };
  });
}

/** Project the endpoint's redeem-epoch row onto `EpochRedeemOrderRow`. */
function toEpochRedeemOrderRows(body: unknown): EpochRedeemOrderRow[] {
  return orderItems(body, "epochRedeemOrders").map((item) => {
    const row = item as Record<string, unknown>;
    return {
      assetId: row.assetId as string,
      index: row.index as number,
      revokedAt: row.revokedAt as string | null,
      approvedAt: row.approvedAt as string | null,
      approvedSharesAmount: row.approvedSharesAmount as string | null,
      revokedSharesAmount: row.revokedSharesAmount as string | null,
      revokedAssetsAmount: row.revokedAssetsAmount as string | null,
      revokedWithNavPoolPerShare: row.revokedWithNavPoolPerShare as
        string | null,
      revokedWithNavAssetPerShare: row.revokedWithNavAssetPerShare as
        string | null,
      asset: toOrderAsset(row.asset),
      token: toOrderToken(row.token),
    };
  });
}

/**
 * The `decode` of an order route whose endpoint refuses today: refuse too.
 *
 * Five of the seven order entries land on a route that answers 503
 * `NOT_YET_PROJECTED`, so the adapter raises `RestQueryError` first and this
 * decode is unreachable. It exists so it stays unreachable by ACCIDENT
 * rather than by luck: the failure mode to design against is not the refusal,
 * it is the day the endpoint starts answering 200 and the adapter quietly
 * hands the response ENVELOPE back as the entry's result type. Omitting
 * `decode` is exactly that outcome.
 *
 * So whoever unblocks a route has to come here and write the projection
 * against whatever the endpoint then serves, with the entry's frozen result
 * type in front of them.
 */
function refuseUnprojectedDecode(entry: string, why: string): never {
  throw new Error(
    `The "${entry}" entry has a backend route but nothing to decode yet: ` +
      `${why} Reaching this code means that endpoint started serving a body. ` +
      `Write this projection against the entry's frozen result type — do not ` +
      `pass the response envelope through as the entry's shape, and do not ` +
      `delete this throw without replacing it.`,
  );
}

/** Why the three per-investor closed-order routes refuse. */
const PER_INVESTOR_REFUSAL =
  "GET .../orders?granularity=investor answers 503 NOT_YET_PROJECTED " +
  "because chain_v1.invest_order.account and chain_v1.redeem_order.account " +
  "carry the wrong bytes32 address convention (measured: 323/323 redeem " +
  "rows; 463/499 invest rows, 463/463 of the async ones), and the backend " +
  "catalogue has no per-investor closed-order entry at all — only the " +
  "aggregate half of each side is projected.";

/** Why the two composite routes refuse. */
const COMPOSITE_REFUSAL =
  "GET .../orders/state answers 503 NOT_YET_PROJECTED: two of this entry's " +
  "four collections are per-investor and read the same wrongly-decoded " +
  "`account`, and `_investOrders()` / `_redeemOrders()` derive their " +
  "outstanding totals from exactly those two — so serving the aggregate " +
  'halves and emptying these would read as "no investor has an open order". ' +
  "One Embrio decode fix unblocks both sides.";

/**
 * The 23 yield columns `GET .../nav/yields` serves on every row.
 *
 * Restated here rather than imported from `core/types.ts`'s `ShareYields`: this
 * is the CLOSED set the route is allowed to project onto, and it exists so an
 * unknown `yieldFields` entry is refused (see {@link toShareYieldRows}) instead
 * of quietly becoming `undefined` in the report.
 */
const SERVED_YIELD_FIELDS = new Set([
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
]);

/**
 * The pool a NAV series belongs to, and the `scId` narrowing (if any), from the
 * share-class id set the two report entries carry.
 *
 * The entries are keyed by `tokenIds` alone while the NAV routes are
 * pool-scoped (`PoolRolesGuard` reads the pool id out of the PATH). The
 * derivation is lossless — see {@link poolIdFromShareClassId} — so it decides
 * which URL to call, not who may read it, and the endpoint re-checks the
 * pairing against the projection (404 `SHARE_CLASS_NOT_FOUND`).
 *
 * Three shapes, and the reason for each:
 *
 * - **One id** -> `?scId=`. The endpoint's single-id narrowing, which is
 *   `pool.reports.sharePrices({ shareClassId })`.
 * - **Several ids** -> no `scId`, so the endpoint answers for the whole pool.
 *   There is deliberately no multi-id form, because no SDK call shape wants a
 *   proper subset of more than one, and the only several-id caller is the
 *   unfiltered report, whose set IS the pool's share classes. A proper subset
 *   of two or more is narrowed back by {@link filterByTokenIds} so the row SET
 *   still matches what graphql would return for the same call — at the cost
 *   that the endpoint's page cap is applied to the pool before the narrowing,
 *   which no SDK caller can reach today.
 * - **Zero ids** -> refused. There is no "no share classes" form of a
 *   pool-scoped route, and no pool id to derive; answering the pool-wide URL
 *   would turn "tell me about nothing" into the whole pool's price history.
 */
function navSeriesScope(
  entry: string,
  tokenIds: readonly string[],
): { poolId: string; scId?: string } {
  const first = tokenIds[0];
  if (first === undefined) {
    throw new Error(
      `The "${entry}" entry was called with an empty \`tokenIds\` set. ` +
        `GET /pools/:poolId/nav/... is pool-scoped and there is no pool id to ` +
        `derive from an empty set, so this cannot be answered; asking for the ` +
        `pool would return every share class the caller did not ask about. ` +
        `A pool with no share classes has no price or yield series.`,
    );
  }

  const poolId = poolIdFromShareClassId(first);
  for (const tokenId of tokenIds) {
    const other = poolIdFromShareClassId(tokenId);
    if (other !== poolId) {
      throw new Error(
        `The "${entry}" entry was given share class ids from more than one ` +
          `pool (${first} is pool ${poolId}, ${tokenId} is pool ${other}). ` +
          `The endpoint is scoped to ONE pool and gated on it, so there is no ` +
          `URL that spans both — and picking either would silently drop the ` +
          `other pool's rows from the report.`,
      );
    }
  }

  return tokenIds.length === 1 ? { poolId, scId: first } : { poolId };
}

/** `GET /pools/:poolId/nav/{prices,yields}` for one report entry's params. */
function navSeriesPath(
  entry: string,
  segment: "prices" | "yields",
  tokenIds: readonly string[],
  limit: number,
): string {
  const { poolId, scId } = navSeriesScope(entry, tokenIds);
  const query = new URLSearchParams({ limit: String(limit) });
  if (scId !== undefined) {
    query.set("scId", scId);
  }
  return `pools/${poolId}/nav/${segment}?${query.toString()}`;
}

/**
 * Unwrap the NAV series `{ items }` envelope, loudly.
 *
 * Same envelope and the same reason as the Orders lists: a paged read answers
 * `{ items, total? }` while each ROW is bound field for field to the entry's
 * result type. A body that is not that envelope raises rather than yielding
 * `[]`, because an empty price series reads as "this share class was never
 * valued" — which for a NAV page is a real and very different answer.
 */
function navItems(body: unknown, entry: string): unknown[] {
  const items = (body as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) {
    throw new Error(
      `The NAV series endpoint must answer with an \`items\` array for the ` +
        `"${entry}" entry; got ${JSON.stringify(body)?.slice(0, 200)}.`,
    );
  }
  return items;
}

/** Keep only rows for the share classes the entry actually asked about. */
function filterByTokenIds<T>(
  rows: T[],
  tokenIds: readonly string[],
  idOf: (row: T) => unknown,
): T[] {
  if (tokenIds.length <= 1) {
    // One id travelled as `?scId=`, so the endpoint narrowed already; zero is
    // refused before a request is made.
    return rows;
  }
  const wanted = new Set(tokenIds.map((id) => id.toLowerCase()));
  return rows.filter((row) => wanted.has(String(idOf(row)).toLowerCase()));
}

/**
 * Project `GET /pools/:poolId/nav/yields` rows onto the columns the caller's
 * `yieldFields` names.
 *
 * The SDK's graphql document is built field by field from `yieldFields`, so
 * that parameter decides the row SHAPE on the graphql adapter. The endpoint
 * serves all 23 columns unconditionally and deliberately — a response whose
 * shape depends on the request is what binding the body field for field to
 * the entry's result type does not allow — so the narrowing happens here, and
 * read parity holds for any `yieldFields` a caller passes rather than only
 * for the full set the SDK happens to send.
 *
 * A field the endpoint does not serve is REFUSED, not dropped: on the graphql
 * side an unknown column is a document error, and passing it through as an
 * absent field would make a typo look like "this window has no figure yet" —
 * which is a real value here (`yieldTtm` is null for a share class younger than
 * a year) and therefore indistinguishable.
 */
function toShareYieldRows(
  body: unknown,
  tokenIds: readonly string[],
  yieldFields: readonly string[],
): unknown[] {
  for (const field of yieldFields) {
    if (!SERVED_YIELD_FIELDS.has(field)) {
      throw new Error(
        `The "shareYieldsReport" entry asked for yield field "${field}", ` +
          `which GET /pools/:poolId/nav/yields does not serve. Dropping it ` +
          `would make a typo indistinguishable from a window that genuinely ` +
          `has no figure yet (both arrive as an absent field).`,
      );
    }
  }

  const rows = navItems(body, "shareYieldsReport").map((item) => {
    const row = item as Record<string, unknown>;
    const projected: Record<string, unknown> = {
      id: row.id,
      timestamp: row.timestamp,
    };
    for (const field of yieldFields) {
      projected[field] = row[field] ?? null;
    }
    return projected;
  });

  return filterByTokenIds(rows, tokenIds, (row) => (row as { id: unknown }).id);
}

/**
 * The Investors endpoints' path prefix for one share class.
 *
 * Pool-scoped for the same reason {@link ordersPath} is: `PoolRolesGuard`
 * reads the pool id out of the PATH, and every investor entry is keyed by the
 * share-token id alone. The derivation is lossless (see
 * {@link poolIdFromShareClassId}) and the endpoint re-checks the pairing
 * against the projection, answering 404 `SHARE_CLASS_NOT_FOUND` for another
 * pool's share class.
 */
function investorsPath(tokenId: string): string {
  return (
    `pools/${poolIdFromShareClassId(tokenId)}` +
    `/share-classes/${tokenId}/investors`
  );
}

/**
 * Refuse a parameter the entry declares and the endpoint cannot express.
 *
 * Dropping it is not an option and never has been on this table: a filter that
 * silently disappears serves the UNNARROWED list to a caller who believes it
 * was narrowed — the same rule {@link crosschainFilterQuery} applies to an
 * unknown crosschain filter key, and the endpoint's own `.strict()` DTO applies
 * from the other side.
 */
function refuseUnsupportedFilter(
  entry: string,
  parameter: string,
  detail: string,
): never {
  throw new Error(
    `The "${entry}" entry was given \`${parameter}\`, which GET ` +
      `/pools/:poolId/share-classes/:scId/investors does not accept. ` +
      `${detail} Dropping it would serve the unnarrowed list as if it had ` +
      `been narrowed. Add the parameter to the endpoint (and to this table) ` +
      `instead.`,
  );
}

/**
 * Unwrap the investors page and project each merged row onto one of the two
 * frozen SDK row shapes.
 *
 * `ShareClassInvestor` is a documented SUPERSET of `WhitelistedInvestorRow` and
 * `TokenInstancePositionRow` (`core/types.ts` carries the field-for-field
 * table), produced by a FULL OUTER JOIN of the two source tables. So this
 * discards fields the entry does not declare and renames the two `createdAt`s
 * the merge had to disambiguate — the same discarding {@link toPoolRows} does,
 * not the reshaping the shape rule forbids: no unit is converted and no value
 * derived.
 */
function investorPage(body: unknown, entry: string): ShareClassInvestor[] {
  const items = (body as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) {
    throw new Error(
      `The investors endpoint must answer with an \`items\` array for the ` +
        `"${entry}" entry; got ${JSON.stringify(body)?.slice(0, 200)}.`,
    );
  }
  return items as ShareClassInvestor[];
}

/** The `total` beside {@link investorPage}'s items — the FILTERED count. */
function investorTotal(body: unknown, entry: string): number {
  const total = (body as { total?: unknown } | null)?.total;
  if (typeof total !== "number") {
    throw new Error(
      `The investors endpoint must answer with a numeric \`total\` for the ` +
        `"${entry}" entry; got ${JSON.stringify(total)}. A missing count ` +
        `would page the caller off the end of a list it thinks is complete.`,
    );
  }
  return total;
}

/** The whitelist half of a merged row, or `null` when there is none. */
function toWhitelistedInvestorRow(
  row: ShareClassInvestor,
): WhitelistedInvestorRow | null {
  // `whitelistedAt` is `whitelisted_investor.created_at`, which is NOT NULL, so
  // a null here means the full outer join produced this row from the POSITION
  // side alone — an address that holds shares and was never whitelisted. The
  // entry's contract for that is `null` (public-api returns no row), and
  // synthesising one with `validUntil: null` would report an address as a
  // lapsed member when nothing about it was ever written.
  if (row.whitelistedAt === null) {
    return null;
  }
  return {
    accountAddress: row.accountAddress as Hex,
    centrifugeId: row.centrifugeId,
    createdAt: row.whitelistedAt,
    isFrozen: row.isFrozen,
    // `whitelisted_investor.valid_until` IS nullable, and `isWhitelisted` is
    // already false for a null (the endpoint evaluates `x is not null and
    // x > now()`).
    // The frozen shape types it non-null, so an empty string is the only
    // spelling available; `isWhitelistedAt("")` is false on the graphql side
    // too, so the two adapters agree on what it means.
    validUntil: row.validUntil ?? "",
    isWhitelisted: row.isWhitelisted,
  };
}

/** The position half of a merged row, or `null` when there is none. */
function toTokenInstancePositionRow(
  row: ShareClassInvestor,
): TokenInstancePositionRow | null {
  // Same test on the position side: `token_instance_position.created_at` is NOT
  // NULL, so a null is the whitelist-only arm of the outer join. `balance`
  // cannot stand in for it — a projected null balance is a real state the
  // endpoint passes through rather than defaulting to "0", because nothing
  // money-shaped may be stubbed.
  if (row.positionCreatedAt === null || row.balance === null) {
    return null;
  }
  return {
    accountAddress: row.accountAddress as Hex,
    balance: row.balance,
    centrifugeId: row.centrifugeId,
    createdAt: row.positionCreatedAt,
    // The one field where the two adapters can differ, stated rather than
    // discovered: the endpoint serves the RESOLVED flag (`coalesce(whitelist,
    // position, false)`), public-api serves the position's own column. They
    // differ only when an address has rows in both tables that disagree, and
    // both in-SDK consumers (`holders()`, `whitelistedHolders()`) apply exactly
    // this precedence themselves — `whitelistData?.isFrozen ?? position
    // .isFrozen` — so the resolved value is the one they were computing.
    isFrozen: row.isFrozen,
    tokenId: row.tokenId,
    updatedAt: row.positionUpdatedAt ?? row.positionCreatedAt,
  };
}

/**
 * The `include` flags a crosschain read opted into, as the endpoint's
 * comma-separated `?include=` parameter. `undefined` when nothing was asked
 * for, so the base read carries no parameter at all.
 *
 * Order is the caller's `include` key order rather than sorted: the endpoint
 * treats the value as a set, and sorting would make the URL differ from the
 * caller's request for no benefit.
 */
function includeParam(include: Record<string, boolean>): string | undefined {
  const flags = Object.entries(include)
    .filter(([, on]) => on)
    .map(([flag]) => flag);
  return flags.length === 0 ? undefined : flags.join(",");
}

/**
 * Which filter keys the crosschain list endpoint understands, and how each
 * maps onto its query string.
 *
 * The entry's `filter` is an untyped record — `buildWhere` in
 * `entities/crosschainMessages.ts` assembles it, api-v3 style, and the
 * catalogue could not describe it without freezing api-v3's operator suffixes
 * into the contract. So the mapping is explicit and CLOSED: an unrecognised
 * key throws rather than being dropped, because a dropped filter serves the
 * unnarrowed list to a caller who believes it was narrowed. That is the same
 * rule the endpoint's own `.strict()` DTO applies from the other side.
 */
const CROSSCHAIN_FILTER_KEYS = new Set([
  "poolId",
  "fromCentrifugeId",
  "toCentrifugeId",
  "status",
  "status_in",
  "createdAtTxHash",
]);

/**
 * Split the entry's `filter` into the path's pool id and the endpoint's query
 * string.
 *
 * The pool id is not a filter here, it is the authorization scope: the
 * endpoint is `GET /pools/:poolId/crosschain-messages`, gated `@PoolMembers()`
 * on that path segment. `centrifuge.crosschainMessages()` can be called with
 * no pool at all — across every pool in the protocol — and no role authorises
 * that, so an unscoped call is refused loudly instead of being answered for
 * one arbitrary pool. `Pool.crosschainMessages()`, which is what the
 * management app uses, always sets it.
 */
function crosschainFilterQuery(filter: Record<string, unknown>): {
  poolId: string;
  query: URLSearchParams;
} {
  const unknownKeys = Object.keys(filter).filter(
    (key) => !CROSSCHAIN_FILTER_KEYS.has(key),
  );
  if (unknownKeys.length > 0) {
    throw new Error(
      `The "crosschainMessages" entry was given filter key(s) ` +
        `${unknownKeys.join(", ")}, which GET ` +
        `/pools/:poolId/crosschain-messages does not accept. Dropping a ` +
        `filter would serve the unnarrowed list as if it had been narrowed. ` +
        `Add the parameter to the endpoint (and to this table) instead.`,
    );
  }

  const poolId = filter.poolId;
  if (typeof poolId !== "string" || !/^\d+$/.test(poolId)) {
    throw new Error(
      `The "crosschainMessages" entry needs \`filter.poolId\` in backend ` +
        `mode: GET /pools/:poolId/crosschain-messages is gated on the pool in ` +
        `its path (@PoolMembers), and the unscoped every-pool variant of this ` +
        `read has no endpoint because no role authorises it. Use ` +
        `\`pool.crosschainMessages(filter)\`, which sets it. ` +
        `Got ${JSON.stringify(poolId)}.`,
    );
  }

  const query = new URLSearchParams();
  for (const key of ["fromCentrifugeId", "toCentrifugeId", "createdAtTxHash"]) {
    const value = filter[key];
    if (value !== undefined) {
      query.set(key, String(value));
    }
  }
  // api-v3 spelled a single status `status` and a set `status_in`; the endpoint
  // takes one comma-separated `status` for both, and the sql adapter's `IN`
  // covers the single case at no cost.
  const statuses = filter.status_in ?? filter.status;
  if (statuses !== undefined) {
    query.set(
      "status",
      Array.isArray(statuses)
        ? statuses.map(String).join(",")
        : String(statuses),
    );
  }
  return { poolId, query };
}

/**
 * The shipped route table.
 *
 * One row per catalogue entry the backend can serve today; everything else
 * falls back to graphql, transparently. {@link REST_ROUTE_OWNERS} records who
 * owns each still-missing row. Pass `routes` to `createRestQueries` to stage a
 * route ahead of the table (that is also how the mechanism is tested).
 *
 * The tokenizations vertical routes the three entries the backend serves. The
 * other two SDK methods in that vertical are deliberately absent, and neither
 * is a missing row here:
 *
 * - `pool.details()` composes metadata (IPFS), share classes and the pool
 *   currency from contract reads; it consumes no catalogue entry at all, in
 *   either mode, so `GET /pools/:poolId` has nothing to bind to.
 * - `pool.isPoolManager(address)` filters the `poolManagers` entry, which is
 *   the pool-access vertical's row (tokenizations ships `manager-status`, not
 *   `GET .../managers`).
 *
 * `shareClass.pendingAmounts()` is likewise not here: it is money-shaped and
 * composed entity-side from four entries owned by the holdings, vaults and
 * orders verticals, and nothing money-shaped is stubbed.
 *
 * The holdings vertical routes the two entries the backend serves. The rest of
 * that vertical's read list consumes NO catalogue entry in either mode, so
 * none of it is a missing row here:
 *
 * - `shareClass._holding()` and `shareClass._assetPrice()` are RPC contract
 *   reads (`Holdings.amount/value/valuation/isLiability` plus the six account
 *   ids, and `Spoke.pricePoolPerAsset`). `shareClass.balances()` composes them
 *   with `holdingEscrows`, whose rows carry each escrow's amount, and derives
 *   `value = amount x price` entity-side; reads never touch the chain
 *   server-side, so that half stays in the SDK in both modes.
 * - `pool.getEscrowAddress()` / `pool._escrow()` is one `escrow(poolId)` call
 *   on the pool version's escrow factory.
 * - `centrifuge.valuations(centrifugeId)` reads `identityValuation` out of the
 *   bundled `@centrifuge/protocol` registry. The backend's `GET /valuations`
 *   exists so a REST caller can discover the same set and so the backend can
 *   refuse an unregistered `valuationAddress` (422 `UNKNOWN_VALUATION`), but
 *   the SDK already reads the verified registry rather than an endpoint, and
 *   there is no catalogue entry to bind a route to.
 */
export const REST_ROUTES: RestRouteTable = {
  // Tokenizations.
  blockchains: { path: () => "blockchains" },
  pools: {
    path: () => `pools?limit=${CATALOGUE_PAGE_CEILING}`,
    decode: (body) => toPoolRows(body),
  },
  tokenInstances: {
    path: ({ tokenId }) =>
      `pools/${poolIdFromShareClassId(tokenId)}/share-classes/${tokenId}` +
      `/token-instances`,
  },

  // Holdings. Both of the vertical's catalogue-consuming reads are routed
  // here: every catalogue entry an app consumes needs a backend route, so
  // leaving either one on graphql is not an option.
  //
  // Neither needs a `decode`. `HoldingEscrow` and `AssetRegistration` in
  // `core/types.ts` are declared field for field against the frozen SDK shapes
  // `HoldingEscrowRow` and `AssetRegistrationRow` (`core/sdk-types.ts`), the
  // endpoints serve those types verbatim from the `queries/sql` adapter, and
  // the only divergence is the nullability WIDENING the frozen shapes already
  // tolerate (`asset`, `holding`, `name`, `symbol`, `blockchain` are nullable
  // in `chain_v1` and public-api emits the same nulls). No field is renamed,
  // no unit converted, no value derived.
  //
  // How each route answers an absent subject:
  //
  // - `holdingEscrows` gets a 404 `SHARE_CLASS_NOT_FOUND` for an unknown or
  //   foreign share class, and the adapter throws it. No `absent` mapping,
  //   required rather than optional: the same code covers "no such share
  //   class" and "another pool's share class", so mapping it to an empty
  //   answer would turn a refused cross-tenant probe into a silent `[]` for a
  //   caller who then reads "this share class holds nothing".
  //   `shareClass.balances()` returns an array and has no "no such row"
  //   answer in its signature, so it may not use `absent` anyway.
  // - `assetRegistrations` has no 404 at all. `GET /assets` is
  //   authenticated-only with no pool in its path (the position
  //   `GET /blockchains` is in) and answers `[]` for a hub chain with no
  //   registrations, which is the honest answer for that case.
  //
  // Neither read is money-shaped ARITHMETIC, but `assetAmount` and
  // `assetPrice` ARE money: the sql adapter refuses a null on both rather than
  // substituting "0", so a projection gap fails loud here too instead of
  // pricing a holding at zero.
  holdingEscrows: {
    // `shareClass.balances()`'s indexer half. Pool-scoped for the same reason
    // the Basin and `tokenInstances` rows are: `PoolRolesGuard` reads the pool
    // id out of the PATH, and this entry carries only the share class id. The
    // derivation is lossless (see {@link poolIdFromShareClassId}) and the
    // endpoint re-checks the pairing against the projection server-side, so it
    // decides which URL to call, not who may read it.
    //
    // `scId` travels as a query parameter rather than as a path segment
    // because that is the shape the endpoint has (`GET /pools/:poolId/holdings
    // ?scId=`), and it is required — there is deliberately no "all share
    // classes of the pool" form, since the frozen row shape carries no share
    // class id and a merged list would be ambiguous.
    //
    // No `centrifugeId` filter is sent even though `balances(centrifugeId?)`
    // takes one: that filter is applied entity-side, and narrowing
    // server-side would make the REST body differ from what the graphql
    // adapter returns for the same catalogue call.
    path: ({ tokenId }) =>
      `pools/${poolIdFromShareClassId(tokenId)}/holdings?scId=${tokenId}`,
  },
  assetRegistrations: {
    // `centrifuge.assets(spokeCentrifugeId, hubCentrifugeId)`. The catalogue
    // entry is keyed by the HUB chain — that is the column
    // `chain_v1.asset_registration` carries and the only parameter the entry
    // declares.
    //
    // `spokeId` is deliberately NOT sent, although the endpoint accepts it.
    // `Centrifuge.assets()` filters on `asset.centrifugeId` entity-side in
    // both modes; sending the server-side filter as well would narrow the REST
    // body relative to the graphql body for the same catalogue call, which is
    // exactly the difference read parity forbids. The endpoint offers it for
    // direct REST consumers (the app before the SDK swap, Postman), not for
    // this adapter.
    path: ({ centrifugeId }) => `assets?hubId=${centrifugeId}`,
  },

  // Vaults. `allVaults` is the vertical's ONLY catalogue-consuming read, so
  // this one row empties the `vaults` column of REST_ROUTE_OWNERS.
  // Everything else on the vaults read list is RPC:
  //
  // - `vault.details()` composes `isLinked` (VaultRegistry.vaultDetails),
  //   `isSyncDeposit` (supportsInterface), the asset and share ERC-20s,
  //   `SyncManager.maxReserve` and `BalanceSheet.availableBalanceOf`, then
  //   derives `maxDeposit = maxReserve - availableBalance`. Reads never touch
  //   the chain server-side, so that composition stays in the SDK in both
  //   modes. The endpoint serves the projected halves (`status`, `kind`,
  //   `maxReserve`) on this same route and deliberately does NOT serve
  //   `maxDeposit`: `availableBalanceOf` is not projected at all, and serving
  //   `maxReserve` under the name `maxDeposit` would be a silent money bug.
  // - `vault.isLinked()`, `poolNetwork.isActive()` — one contract read each.
  // - `poolNetwork.details()`, `poolNetwork.vaults()`, `poolNetwork.vault()`,
  //   `poolNetwork._vaultsByShareClass()`, `shareClass.vaults()` all compose
  //   this entry with contract reads; none consumes an entry of its own.
  //
  // And `vault.investment(address)` has a route (`GET /pools/:poolId/vaults/
  // :vaultAddress/investment`) that answers 503 NOT_YET_PROJECTED permanently
  // today — every field is money-shaped and `chain_v1` projects none of it — but
  // it has NO catalogue entry in either mode: the SDK reads the whole thing over
  // RPC. There is nothing here to bind that route to, which is why the invest
  // app's most-used per-address read cannot be routed here at all — not even
  // to a refusal.
  //
  // `is_stub = false` is applied by both transports, so both answer the same
  // row set. Two places where the two still differ:
  //
  //  - An unknown or foreign share class gets a 404 `SHARE_CLASS_NOT_FOUND`
  //    here, which the adapter throws, while public-api answers `[]`. No
  //    `absent` mapping, for the reason `holdingEscrows` states: the same code
  //    covers "no such share class" and "another pool's share class", so
  //    mapping it to an empty answer would turn a refused cross-tenant probe
  //    into "this share class has no vaults". `_allVaults()` returns an array
  //    and has no "no such row" answer in its signature, so it may not use
  //    `absent` anyway.
  //  - Row ORDER: the sql adapter orders explicitly by
  //    `(centrifugeId, assetId, id)` where public-api returns api-v3's default
  //    order. Nothing keys off it — `poolNetwork.vault(scId, asset)` finds by
  //    asset address and `linkVaults` by vault address — but
  //    `pendingAmounts().byVault` and the vault lists the management app
  //    renders come out in a different sequence per transport.
  //
  // `status` is the field to be careful with, because `shareClass.vaults()`
  // filters on the literal `'Unlinked'` and `pendingAmounts()` on `'Linked'`.
  // `chain_v1.vault_status` holds
  // `LinkInProgress | UnlinkInProgress | Linked | Unlinked`; the sql adapter
  // and this route carry those labels through untouched, and api-v3 serves the
  // same spelling. PostGraphile does not: it renames enum values to constant
  // case, so public-api would serve `LINKED` / `UNLINKED`, which matches
  // neither literal and would make `includeUnlinked: false` return unlinked
  // vaults while `pendingAmounts()` saw none. That is why the graphql adapter
  // normalises the spelling back (`graphql/public-api.ts`,
  // `vaultStatusFromPostgraphile`) and
  // `sql/vaults-read-parity.integration.test.ts` compares the two transports
  // label for label.
  allVaults: {
    // Pool-scoped for the same reason the holdings and Basin rows are:
    // `PoolRolesGuard` reads the pool id out of the PATH, and this entry
    // carries only the share class id. The derivation is lossless (see
    // {@link poolIdFromShareClassId}) and the endpoint re-checks the pairing
    // against the projection server-side, so it decides which URL to call, not
    // who may read it. Both vault reads are `@Public()` on the
    // unauthenticated read surface, and the 404-for-another-pool's-scId holds
    // there too.
    //
    // No `centrifugeId` filter is sent even though the endpoint accepts one and
    // `shareClass.vaults(centrifugeId)` takes one: the catalogue entry does not
    // declare the parameter, the graphql adapter cannot narrow on it, and the
    // filtering happens entity-side. Sending it would make the REST body differ
    // from the graphql body for the same catalogue call, which is exactly the
    // difference read parity forbids.
    //
    // Unlinked vaults are always included, in both transports: neither the
    // entry nor either adapter filters on `status`, and `vaults()`'s
    // `includeUnlinked` is applied entity-side. The link path needs to see them.
    path: ({ tokenId }) =>
      `pools/${poolIdFromShareClassId(tokenId)}/vaults?scId=${tokenId}`,
    decode: (body) => toVaultRows(body),
  },

  // Pool access. All four of the vertical's catalogue-consuming reads are
  // here, so no entry in this vertical falls back to graphql.
  //
  // The rest of the pool-access read list consumes NO catalogue entry in
  // either mode, so none of it is a missing row: `Pool.adapters()` and
  // `Centrifuge.adapters()`/`globalAdapters()` are `MultiAdapter` CONTRACT
  // reads (`_readMultiAdapter`), which a REST read may not do because reads
  // never touch the chain server-side; and `isPoolManager()`,
  // `isBalanceSheetManager()`, `balanceSheetManagers()` and
  // `balanceSheetManagerStatus()` are entity-side filters over `poolManagers`,
  // which is why the endpoint serves the whole projected row rather than any
  // one method's filtered shape.
  poolManagers: {
    // `Pool._managers()`, which four entity methods filter. The endpoint takes
    // no query parameters at all — the entry declares `{ poolId }` and nothing
    // else, and every consumer narrows entity-side, so a server-side filter
    // would make the REST body differ from what public mode returns for the
    // same catalogue call. Its DTO is strict-empty, so an invented one is
    // refused rather than ignored.
    //
    // Two things a caller of `poolManagers()` / `isPoolManager()` must know:
    //
    // - A pool the caller cannot read raises rather than answering `[]`: 403
    //   for a pool the caller holds no role on (including any unknown pool —
    //   `PoolRolesGuard` runs before existence is checked, deliberately: no
    //   validity oracle ahead of authorization), and 404 `POOL_NOT_FOUND` for
    //   a pool the caller MAY read that `chain_v1` has no row for. There is
    //   deliberately no `absent` mapping for either: `[]` is a REAL answer
    //   here (a live pool mid-projection with no manager rows yet), so folding
    //   the 404 into it would make "this pool does not exist"
    //   indistinguishable from "nobody manages it", and `isPoolManager()`
    //   would answer a confident `false` about a pool that is not there.
    // - `crosschainInProgress` arrives PascalCase (`CanNotManage`) from this
    //   endpoint. PostGraphile would spell it `CAN_NOT_MANAGE`, so the graphql
    //   adapter normalises to the projection's spelling and both adapters
    //   answer the same label — see `graphql/public-api.ts`.
    path: ({ poolId }) => `pools/${poolId}/managers`,
  },
  poolAdapters: {
    path: ({ poolId, localCentrifugeId, remoteCentrifugeId }) =>
      `pools/${poolId}/adapters?localCentrifugeId=${localCentrifugeId}` +
      `&remoteCentrifugeId=${remoteCentrifugeId}`,
  },
  crosschainMessages: {
    path: (params) => {
      const { poolId, query } = crosschainFilterQuery(params.filter);
      query.set("limit", String(params.limit));
      if (params.before !== undefined) {
        query.set("before", params.before);
      }
      if (params.after !== undefined) {
        query.set("after", params.after);
      }
      const include = includeParam(params.include);
      if (include !== undefined) {
        query.set("include", include);
      }
      return `pools/${poolId}/crosschain-messages?${query.toString()}`;
    },
  },
  crosschainMessage: {
    path: ({ poolId, id, index, include }) => {
      if (poolId === undefined) {
        throw new Error(
          `The "crosschainMessage" entry needs a \`poolId\` in backend mode: ` +
            `GET /pools/:poolId/crosschain-messages/:id is gated on the pool ` +
            `in its path (@PoolMembers), so there is no unscoped endpoint to ` +
            `read payload ${id}#${index} from. ` +
            `\`centrifuge.crosschainMessage(id, index)\` does not carry one; ` +
            `use a pool-scoped caller, mirroring ` +
            `\`pool.crosschainMessages()\`. Refusing rather than guessing a ` +
            `pool: guessing would either 404 confusingly or read a pool the ` +
            `caller may hold no role on.`,
        );
      }
      const query = new URLSearchParams({ index: String(index) });
      const flags = includeParam(include);
      if (flags !== undefined) {
        query.set("include", flags);
      }
      return `pools/${poolId}/crosschain-messages/${id}?${query.toString()}`;
    },
    // `queryCrosschainMessage` maps a null row to `undefined`, so the entry's
    // contract already has a "no such message" answer; the backend spells it
    // 404 `CROSSCHAIN_MESSAGE_NOT_FOUND`, the same code it gives a payload
    // that belongs to another pool (no cross-pool existence oracle). Mapping
    // it here keeps both transports answering `undefined`; see
    // `RestRoute.absent`.
    absent: { code: "CROSSCHAIN_MESSAGE_NOT_FOUND", value: null },
  },

  // NAV. Both of the vertical's catalogue-consuming reads are routed here —
  // every catalogue entry an app consumes needs a backend route — and the two
  // back one screen.
  //
  // Everything else on the NAV read list consumes NO catalogue entry, in
  // either mode, so none of it is a missing row here:
  //
  // - `shareClass.navPerNetwork()` consumes `tokenInstances`, which is the
  //   tokenizations vertical's row and has its own route.
  // - `shareClass._metrics()` is two `ShareClassManager` contract reads
  //   (`totalIssuance`, `pricePoolPerShare`) and `shareClass.valuation()` one
  //   `SyncManager.valuation`. Reads never touch the chain server-side, so
  //   both stay in the SDK in both modes.
  // - `pool.currency()` and `pool.decimals()` are `HubRegistry` reads composed
  //   with the bundled national-currency table. Same rule, same outcome.
  //
  // ## The rows are RAW, and that is a decision rather than a shortcut
  //
  // `GET .../nav/prices` serves per-network snapshot rows, not the report.
  // `PoolSharePricesReport._process` is not a formatter: it dedupes to one row
  // per `(date, tokenId, chain)`, SUMS issuance across networks, and takes the
  // price from the chain with the largest issuance. Computing that server-side
  // would give `totalIssuance` two definitions — one here, one in the entity —
  // and let backend mode disagree with public mode about a NAV. That is also
  // why the endpoint refuses `?groupBy` with 422 rather than ignoring it: the
  // SDK groups the daily TOTALS, so grouping raw per-network rows is a
  // different operation with different numbers.
  //
  // ## There is no graphql fallback for these two
  //
  // Both entries are `support: "blocked"` on public-api (`capabilities.ts`:
  // `connection-filter` is not installed, so neither `tokenId_in` nor
  // `trigger_ends_with` can be expressed), and public-api is the SDK's DEFAULT
  // `graphqlTarget`. Without a route here both reads raise
  // `UnsupportedQueryError` before issuing a request — in backend mode and in
  // default public mode alike — and answer only under an explicit
  // `graphqlTarget: 'api-v3'`.
  //
  // ## Two timestamp spellings reach the same consumer
  //
  // This endpoint serves `timestamp` as ISO-8601 UTC (this catalogue's
  // convention, and what public-api returns for the same `timestamptz`); the
  // api-v3 document serves a millisecond-epoch decimal string. Both reach
  // `Reports/utils.ts`'s `snapshotDay`, which accepts either and refuses
  // anything it cannot place on a specific UTC day, INCLUDING an offset-less
  // datetime (which `new Date` would read in the local zone and could bucket
  // on the wrong day). A parse of the ISO form as `Number(...)` yields `NaN`
  // and throws `RangeError: Invalid time value`, so a consumer that handles
  // only the epoch form fails loudly instead of misdating a NAV.
  //
  // ## Row order and the trigger predicate
  //
  // Both endpoints order `timestamp DESC` with the rest of the primary key as a
  // total tiebreak. Load-bearing for yields, where `_process` keeps the FIRST
  // row per `(date, id)`; irrelevant for prices, which dedupe by largest
  // issuance. The api-v3 document additionally narrows prices with
  // `trigger_ends_with: "NewPeriod"` while the sql adapter applies no trigger
  // filter — a deliberate difference recorded on
  // `catalogue.sharePriceSnapshots`: `chain_v1.token_instance_snapshot` has
  // exactly one writer and every row is already a period boundary (14523 of
  // 14523 on mainnet), so re-encoding the predicate as a `LIKE`
  // over a trigger string would be a guess that silently drops rows the day
  // the projection spells one differently.
  //
  // Neither read is money-shaped ARITHMETIC here, but `totalIssuance` and
  // `tokenPrice` ARE money: the sql adapter refuses a null on both rather than
  // substituting "0", because a zero share price propagated to a spoke marks
  // every holder's position worthless.
  sharePricesReport: {
    path: ({ tokenIds, limit }) =>
      navSeriesPath("sharePricesReport", "prices", tokenIds, limit),
    // The endpoint's row IS `SharePriceSnapshot`, declared field for field
    // against what the SDK's api-v3 document selects (`tokenId`, `timestamp`,
    // `totalIssuance`, `tokenPrice`, `triggerChainId`), so nothing is renamed,
    // converted or derived — only the `{ items }` envelope is re-wrapped into
    // the `{ tokenInstanceSnapshots: { items } }` shape `_process` consumes,
    // which is the same envelope the api-v3 adapter passes through.
    decode: (body, { tokenIds }) => ({
      tokenInstanceSnapshots: {
        items: filterByTokenIds(
          navItems(body, "sharePricesReport"),
          tokenIds,
          (row) => (row as { tokenId: unknown }).tokenId,
        ),
      },
    }),
  },
  shareYieldsReport: {
    path: ({ tokenIds, limit }) =>
      navSeriesPath("shareYieldsReport", "yields", tokenIds, limit),
    decode: (body, { tokenIds, yieldFields }) => ({
      tokenSnapshots: { items: toShareYieldRows(body, tokenIds, yieldFields) },
    }),
  },

  // Investors. Five of the vertical's six catalogue-consuming reads are here.
  // The sixth, `investorPortfolioSources`, has NO endpoint:
  // it is the GLOBAL catalogue of every vault asset address and every share
  // token address, across every pool, which `Investor.portfolio()` pairs with
  // an on-chain `balanceOf` per entry. Nothing on the private-api surface
  // serves an unscoped, pool-less address list — `GET /pools/:poolId/vaults`
  // and `GET .../token-instances` are both pool-scoped, because
  // `PoolRolesGuard` reads the pool out of the path — so there is no route to
  // bind and none can be added from this side. Every catalogue entry an app
  // consumes needs a backend route, so this is a MISSING endpoint rather than
  // a decision to serve the entry from graphql: it is owned by `investors` in
  // {@link REST_ROUTE_OWNERS} with no row here, which is a route the backend
  // still owes.
  // TODO(backend-gap): investorPortfolioSources — unblock when the backend
  // ships an unscoped address catalogue for `Investor.portfolio()`.
  //
  // Four of the five land on ONE endpoint, `GET
  // /pools/:poolId/share-classes/:scId/investors`, which is a FULL OUTER JOIN
  // of `chain_v1.whitelisted_investor` and `chain_v1.token_instance_position`.
  // Its row is a documented superset of both frozen SDK shapes, so each entry
  // projects its own half out (see {@link toWhitelistedInvestorRow}); an
  // address present in only one table yields `null` on the other side rather
  // than a half-invented row.
  //
  // What each of the five answers:
  //
  // - `tokenInstancePositions` serves rows. It is `blocked` on public-api
  //   (four operator predicates `condition:` cannot express), so without this
  //   route `shareClass.holders()` raises `UnsupportedQueryError` on the
  //   default graphql target.
  // - `whitelistedInvestors` serves the LIVE whitelist rows only, and their
  //   `isWhitelisted` is the same Postgres predicate that selected them, so
  //   page and flag cannot disagree. The graphql adapter applies the same
  //   narrowing so the two transports return the same set;
  //   `whitelistedHolders()` is the only consumer and its client tab shows
  //   exactly that set.
  // - `whitelistedInvestor` / `tokenInstancePosition` serve one row or `null`
  //   for an address the projection has never seen — see `absent` below.
  // - `investorTransactions` raises `RestQueryError` carrying
  //   `NOT_YET_PROJECTED`. It filters on
  //   `chain_v1.investor_transaction.account`, one of Embrio's mis-decoded
  //   bytes32 columns (46 of 410691 rows on `account`, 92 on `to_account`,
  //   measured on live v4 mainnet), and the value is
  //   action-driving — it is whose statement this is. Same refusal, and same
  //   reason, as the six per-investor order rows.
  //
  // None of the four investor reads gets an `absent` mapping for the pool-level
  // 404s, and that is the `poolManagers` reasoning applied here: an empty page
  // is the REAL answer for a live share class nobody has subscribed to yet, so
  // folding `POOL_NOT_FOUND` / `SHARE_CLASS_NOT_FOUND` into it would make "this
  // pool does not exist" read as "this fund has no investors". `PoolRolesGuard`
  // runs before existence is checked, so an unknown pool is a 403 and only a
  // pool the caller MAY read reaches the 404 at all.
  whitelistedInvestors: {
    // `?status=whitelisted` is the endpoint's "a whitelist row exists AND its
    // valid_until is in the future", evaluated in Postgres against `now()` —
    // the same expression that fills this entry's `isWhitelisted`, so the page
    // and the flag cannot disagree.
    //
    // There is deliberately no `?centrifugeId` and no `?excludeAddresses`: the
    // entry declares neither, and sending a server-side filter the graphql
    // adapter does not apply is exactly the difference read parity forbids.
    path: ({ tokenId, limit, offset }) =>
      `${investorsPath(tokenId)}?status=whitelisted` +
      `&limit=${limit}&offset=${offset}`,
    decode: (body) => {
      const rows = investorPage(body, "whitelistedInvestors")
        .map(toWhitelistedInvestorRow)
        .filter((row): row is WhitelistedInvestorRow => row !== null);
      return {
        items: rows,
        totalCount: investorTotal(body, "whitelistedInvestors"),
      };
    },
  },
  tokenInstancePositions: {
    path: ({
      tokenId,
      excludedAddresses,
      balanceGt,
      holderAddress,
      centrifugeIds,
      orderBy,
      orderDirection,
      limit,
      offset,
    }) => {
      // `status=holder` is "a position row with a NON-ZERO balance". It is
      // the closest of the endpoint's four statuses and the only defensible
      // one: `all` is the union of both tables, so it would hand back
      // whitelist-only rows whose `balance` is null, and
      // `TokenInstancePositionRow.balance` is not nullable — serving those
      // would mean inventing a "0" for an investor whose position was never
      // projected, which is exactly the money-shaped stub that is never
      // allowed. The cost, stated: a position row that has fallen to zero (an
      // investor who sold out completely) is in api-v3's answer and not in
      // this one.
      const query = new URLSearchParams({
        status: "holder",
        limit: String(limit),
        offset: String(offset),
      });
      if (excludedAddresses.length > 0) {
        query.set("excludeAddresses", excludedAddresses.join(","));
      }
      if (balanceGt !== undefined && BigInt(balanceGt) !== 0n) {
        refuseUnsupportedFilter(
          "tokenInstancePositions",
          `filter.balance_gt = ${balanceGt}`,
          "Its `?status=holder` is the fixed predicate `balance > 0`; there " +
            "is no threshold parameter.",
        );
      }
      if (holderAddress !== undefined && holderAddress !== "") {
        refuseUnsupportedFilter(
          "tokenInstancePositions",
          "filter.holderAddress",
          "api-v3 matched it as a SUBSTRING (`accountAddress_contains`), and " +
            "the endpoint has no address filter on the list route at all — " +
            "its per-address route needs an exact address and a network.",
        );
      }
      if (centrifugeIds !== undefined && centrifugeIds.length > 0) {
        if (centrifugeIds.length > 1) {
          refuseUnsupportedFilter(
            "tokenInstancePositions",
            `filter.centrifugeIds = [${centrifugeIds.join(", ")}]`,
            "The endpoint takes a single `?centrifugeId`; a proper subset of " +
              "more than one network cannot be expressed.",
          );
        }
        query.set("centrifugeId", centrifugeIds[0]!);
      }
      if (orderBy !== "balance" || orderDirection !== "desc") {
        refuseUnsupportedFilter(
          "tokenInstancePositions",
          `orderBy/orderDirection = ${orderBy}/${orderDirection}`,
          "The endpoint's order is fixed and total (`balance` desc, then " +
            "address, then network) so that two identical requests return " +
            "identical pages; there is no sort parameter.",
        );
      }
      return `${investorsPath(tokenId)}?${query.toString()}`;
    },
    decode: (body) => {
      const rows = investorPage(body, "tokenInstancePositions")
        .map(toTokenInstancePositionRow)
        .filter((row): row is TokenInstancePositionRow => row !== null);
      return {
        items: rows,
        totalCount: investorTotal(body, "tokenInstancePositions"),
      };
    },
  },
  whitelistedInvestor: {
    path: ({ tokenId, centrifugeId, accountAddress }) =>
      `${investorsPath(tokenId)}/${accountAddress}` +
      `?centrifugeId=${centrifugeId}`,
    decode: (body) => toWhitelistedInvestorRow(body as ShareClassInvestor),
    // Both single-row entries declare `| null`, so their contract already has
    // a "no such row" answer and `absent` is legitimate — the
    // `crosschainMessage` precedent. Without it an address the projection has
    // never seen would raise `RestQueryError` instead of answering `null`, and
    // `holders()` calls this per row of its page and treats `null` as "not
    // whitelisted".
    absent: { code: "INVESTOR_NOT_FOUND", value: null },
  },
  tokenInstancePosition: {
    path: ({ tokenId, centrifugeId, accountAddress }) =>
      `${investorsPath(tokenId)}/${accountAddress}` +
      `?centrifugeId=${centrifugeId}`,
    decode: (body) => toTokenInstancePositionRow(body as ShareClassInvestor),
    absent: { code: "INVESTOR_NOT_FOUND", value: null },
  },
  investorTransactions: {
    // `Investor.transactions()` / `allTransactions()`. Pool-scoped in the path
    // for the guard, which a `GET /investors/:address?poolId=` shape could
    // not be: `PoolRolesGuard` reads `req.params.poolId`, so a
    // pool in the query string would deny every non-admin caller.
    path: ({ account, poolId, limit, offset }) =>
      `pools/${poolId}/investors/${account}` +
      `/transactions?limit=${limit}&offset=${offset}`,
    decode: () =>
      refuseUnprojectedDecode(
        "investorTransactions",
        "GET /pools/:poolId/investors/:address/transactions answers 503 " +
          "NOT_YET_PROJECTED: it FILTERS on " +
          "`chain_v1.investor_transaction.account`, which carries Embrio's " +
          "wrong bytes32 decode (46 of 410691 rows on `account` and 92 on " +
          "`to_account` match the corruption signature, measured on live " +
          "v4 mainnet). A filter on a corrupted column returns the " +
          "wrong statement for the wrong investor, silently.",
      ),
  },

  // Orders. All eight of the vertical's catalogue-consuming reads are routed
  // here, for the same reason the Basin five are — every catalogue entry an
  // app consumes needs a backend route — and six of the eight land on an
  // endpoint that REFUSES, which is the point rather than a compromise.
  //
  // What each row lands on:
  //
  // - `epochInvestOrders` / `epochRedeemOrders` -> the unified list at
  //   `granularity=epoch`, which SERVES from `chain_v1.epoch_{invest,redeem}_
  //   order` in the explicit total `(asset_id, index)` order the endpoint
  //   promises. These are the two rows that make backend mode usable for the
  //   closed-orders view.
  // - `redeemOrdersByEpoch` and the per-share-class `closedInvestOrders` /
  //   `closedRedeemOrders` -> the same list at `granularity=investor`, which
  //   answers 503 `NOT_YET_PROJECTED`.
  // - `investOrderState` / `redeemOrderState` -> `GET .../orders/state`, also
  //   503. They are four-collection COMPOSITES, not row lists, which is why
  //   they need their own route and why the list's parameters cannot serve
  //   them.
  //
  // The two epoch rows serve the same rows as public-api. The five
  // per-investor rows refuse instead, because the `account` they would carry
  // is the CORRUPTED address (measured: 323/323 on redeems, 463/499 on
  // invests and 463/463 of the async ones) and `closedInvestments()` /
  // `closedRedemptions()` put that value straight into `investor` — it is who
  // a `notifyRedeem` would credit. Leaving those six on graphql is not an
  // option either: every catalogue entry an app consumes needs a backend
  // route, and the graphql answer carries the same corrupted address.
  //
  // The cost, stated rather than buried: `closedInvestments()` and
  // `closedRedemptions()` return no data in backend mode until Embrio's
  // decode lands.
  //
  // Every route is pool-scoped even though every order entry is keyed by
  // `tokenId` alone; see {@link ordersPath}. `limit` is always explicit on the
  // list rows that take one (the two per-share-class rows want the whole set
  // and take none), for
  // the reason {@link CATALOGUE_PAGE_CEILING} spells out for `pools`: the
  // endpoint's own default page is 100 and these entries mean "up to the
  // catalogue ceiling".
  epochInvestOrders: {
    path: ({ tokenId, limit }) =>
      `${ordersPath(tokenId)}?state=closed&side=invest` +
      `&granularity=epoch&limit=${limit}`,
    decode: (body) => toEpochInvestOrderRows(body),
  },
  epochRedeemOrders: {
    path: ({ tokenId, assetId, index, limit }) => {
      const query = new URLSearchParams({
        state: "closed",
        side: "redeem",
        granularity: "epoch",
        limit: String(limit),
      });
      if (assetId !== undefined) {
        query.set("assetId", assetId);
      }
      if (index !== undefined) {
        query.set("index", String(index));
      }
      return `${ordersPath(tokenId)}?${query.toString()}`;
    },
    decode: (body) => toEpochRedeemOrderRows(body),
  },
  redeemOrdersByEpoch: {
    path: ({ tokenId, assetId, index, onlyUnclaimed, limit }) => {
      const query = new URLSearchParams({
        state: "closed",
        side: "redeem",
        granularity: "investor",
        assetId,
        index: String(index),
        onlyUnclaimed: String(onlyUnclaimed),
        limit: String(limit),
      });
      return `${ordersPath(tokenId)}?${query.toString()}`;
    },
    decode: () =>
      refuseUnprojectedDecode("redeemOrdersByEpoch", PER_INVESTOR_REFUSAL),
  },
  closedInvestOrders: {
    path: ({ tokenId }) => {
      const query = new URLSearchParams({
        state: "closed",
        side: "invest",
        granularity: "investor",
      });
      return `${ordersPath(tokenId)}?${query.toString()}`;
    },
    decode: () =>
      refuseUnprojectedDecode("closedInvestOrders", PER_INVESTOR_REFUSAL),
  },
  closedRedeemOrders: {
    path: ({ tokenId }) => {
      const query = new URLSearchParams({
        state: "closed",
        side: "redeem",
        granularity: "investor",
      });
      return `${ordersPath(tokenId)}?${query.toString()}`;
    },
    decode: () =>
      refuseUnprojectedDecode("closedRedeemOrders", PER_INVESTOR_REFUSAL),
  },
  investOrderState: {
    path: ({ tokenId }) => `${ordersPath(tokenId)}/state?side=invest`,
    decode: () =>
      refuseUnprojectedDecode("investOrderState", COMPOSITE_REFUSAL),
  },
  redeemOrderState: {
    path: ({ tokenId }) => `${ordersPath(tokenId)}/state?side=redeem`,
    decode: () =>
      refuseUnprojectedDecode("redeemOrderState", COMPOSITE_REFUSAL),
  },

  // Basin. All five of the vertical's catalogue-consuming reads are routed
  // here: every catalogue entry an app consumes needs a backend route, and the
  // five back one screen of the management app.
  //
  // Every route is pool-scoped even where its entry is not, because
  // `PoolRolesGuard` reads the pool id out of the PATH. An entry keyed by
  // `tokenId` alone would have nothing for the guard to authorise, so the
  // share-class routes carry the pool the id belongs to and the endpoint
  // re-derives and re-checks the pairing against the projection server-side —
  // the `token-instances` precedent, and the reason the derivation below is
  // safe rather than trusted: it decides which URL to call, not who may read
  // it.
  //
  // None of the five needs a `decode`. The frozen row types narrow addresses
  // to `0x${string}` where `chain_v1` hands back `string`, which is the one
  // widening the adapter is allowed to pass through untouched (see the
  // `RestRoute.decode` note), and no field is renamed, unit-converted or
  // derived.
  //
  // None of the five gets an `absent` either. An unknown or foreign share
  // class answers 404 `SHARE_CLASS_NOT_FOUND` and the adapter throws it, so
  // `_findDeployedOnOffRampManagerAddress()` raises rather than answering a
  // plausible `null`. That is what `tokenInstances` does for the same 404, and
  // it is required here: the same code covers "no such share class" and
  // "another pool's share class", so mapping it to an empty answer would turn
  // a refused cross-tenant probe into a silent `[]`. Only an entry whose SDK
  // caller already has a "no such row" answer in its signature may use
  // `absent`, and all five of these return arrays.
  merkleProofManagers: {
    path: ({ poolId, centrifugeId }) =>
      `basin/pools/${poolId}/merkle-proof-managers` +
      `?centrifugeId=${centrifugeId}`,
  },
  onOffRampManagers: {
    path: ({ tokenId, centrifugeId }) =>
      `basin/pools/${poolIdFromShareClassId(tokenId)}` +
      `/share-classes/${tokenId}/on-off-ramp-managers` +
      `?centrifugeId=${centrifugeId}`,
  },
  offRampAddresses: {
    path: ({ tokenId, centrifugeId }) =>
      `basin/pools/${poolIdFromShareClassId(tokenId)}` +
      `/share-classes/${tokenId}/off-ramp-addresses` +
      `?centrifugeId=${centrifugeId}`,
  },
  onOffRampRelayers: {
    path: ({ tokenId, centrifugeId }) =>
      `basin/pools/${poolIdFromShareClassId(tokenId)}` +
      `/share-classes/${tokenId}/relayers` +
      `?centrifugeId=${centrifugeId}`,
  },
  onRampAssets: {
    path: ({ tokenId, centrifugeId }) =>
      `basin/pools/${poolIdFromShareClassId(tokenId)}` +
      `/share-classes/${tokenId}/on-ramp-assets` +
      `?centrifugeId=${centrifugeId}`,
  },
};
