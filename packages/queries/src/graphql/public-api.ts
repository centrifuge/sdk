import { isWhitelistedAt } from "../core/investor-status";
import { POOL_MIGRATION_ID } from "../core/migration-id";
import type { SdkQueryName } from "../core/sdk-catalogue";
import type {
  AssetDetails,
  BasinLinkedRedeemOrderRow,
  HubPolicyRow,
  InvestOrderRow,
  OrderAsset,
  OrderToken,
  PoolAuthorizationEventRow,
  RedeemOrderRow,
} from "../core/sdk-types";

/**
 * The public-api (PostGraphile v5 over `chain_v1`) adapter.
 *
 * What the server can express (see `capabilities.ts` for the full table):
 * - `condition:` — exact equality per column (`null` included), but ONLY on
 *   columns `IndexBackedFieldsPlugin` leaves filterable. v5 derives the
 *   `Condition` input from the same `attribute:filterBy` behavior the plugin
 *   strips, so a column that is not the leading key of a non-partial btree
 *   index is absent from `condition:` as well as `filter:` — verified by
 *   introspection (`BasinDebtCondition` has no `basinAddress`, and
 *   `HoldingCondition` carries only the four indexed columns). A predicate on
 *   such a column must be applied client-side over an index-bounded set.
 * - `filter:` — `postgraphile-plugin-connection-filter` IS installed, but
 *   `IndexBackedFieldsPlugin` (in `centrifuge/api-v4`)
 *   exposes it, and `orderBy`, only on the leading column of a non-partial
 *   btree index, with the operator allowlist further narrowed to
 *   `connectionFilterAllowedOperators` (equalTo, in, lessThan(OrEqualTo),
 *   greaterThan(OrEqualTo), isNull — no negation, no substring match) plus
 *   the `and` / `or` / `not` combinators. So api-v3's `_not` / `_gt` /
 *   `_contains` / `_ends_with` predicates still have no server-side
 *   equivalent, and `_in` only survives on an indexed column.
 * - Nested relation fields from Drizzle `one()` relations
 *   (`DrizzleVirtualForeignKeysPlugin`); a missing parent resolves to `null`.
 *   Most api-v3 joins still have no such relation and become a second
 *   collection read joined here.
 *
 * A predicate on an unindexed column is applied here over a set bounded by an
 * indexed key, under the dimension cap. Entries whose bounded set is known to
 * exceed the cap on mainnet are deliberately absent so the adapter throws
 * rather than returning a wrong or unbounded result.
 */

/** Executes one GraphQL document against public-api. */
export type GraphqlExecutor = (
  document: string,
  variables?: Record<string, unknown>,
) => Promise<any>;

/**
 * A bounded read is larger than the client-side cap.
 *
 * Two reads hit this: a whole dimension table read to rebuild a relation, and
 * a set bounded by an indexed key that is then narrowed here on an unindexed
 * column. Past the cap either read is truncated, and a truncated read yields
 * `null` where api-v3 returned an object, or drops rows a predicate should
 * have kept — silent corruption of caller-visible data, so it fails loud
 * instead: no truncation, no warn-and-continue.
 *
 * A relation removes the first kind; an index on the narrowed column removes
 * the second.
 */
export class DimensionOverflowError extends Error {
  override name = "DimensionOverflowError";
  readonly entry: string;
  readonly dimension: string;
  readonly cap: number;
  readonly observed: number;

  constructor(entry: string, dimension: string, cap: number, observed: number) {
    super(
      `Query "${entry}" reads "${dimension}" client-side to apply a ` +
        `predicate public-api cannot, but that read holds ${observed} rows ` +
        `and the cap is ${cap}. Past the cap the result would be wrong, not ` +
        `slow, so it is refused. Fix: a relation, or an index on the filtered ` +
        `column (backend#613). See docs/parity/09-sdk-catalogue-public-api.md.`,
    );
    this.entry = entry;
    this.dimension = dimension;
    this.cap = cap;
    this.observed = observed;
  }
}

/**
 * Case-insensitive address comparison.
 *
 * The Basin projection does not normalise `basin_address`, and the backend
 * catalogue's own SQL matches it with `lower()`, so a case difference here
 * must not read as a different basin.
 */
function sameAddress(a: string, b: string): boolean {
  return String(a).toLowerCase() === String(b).toLowerCase();
}

/**
 * Sort a Basin ledger newest-first, breaking ties the way the SQL adapter
 * does: `timestamp`, then `blockNumber`, then `logIndex`, all descending.
 *
 * The tie-break is not cosmetic. Two rows in the same block carry the running
 * `debtAfter` balance in `logIndex` order, so ordering by timestamp alone can
 * present them reversed and make the balance appear to move backwards.
 */
/**
 * `basin_reconciliation_warning.type` as PostGraphile spells it.
 *
 * The Postgres enum value is `redeemOrderLinkAmbiguous`; PostGraphile
 * uppercases enum values into SCREAMING_SNAKE, so the wire spelling is
 * `REDEEM_ORDER_LINK_AMBIGUOUS`. Comparing against the database spelling
 * silently never matches — which is the dead-guard failure this flag exists
 * to prevent, so it is pinned here and asserted against the live schema in
 * `public-api.integration.test.ts`.
 */
const AMBIGUOUS_WARNING_TYPE = "REDEEM_ORDER_LINK_AMBIGUOUS";

/**
 * Whether the projection recorded a `redeemOrderLinkAmbiguous` warning for a
 * basin.
 *
 * Deliberately BASIN-wide rather than per-request, which mirrors the SQL
 * adapter and is over-broad in the safe direction. The only writer —
 * `BasinRedeemRequestService.linkRedeemOrderIfPending` — emits this warning only
 * when two or more open requests match one approval (an approval matching none
 * writes nothing). It cannot name one of them, so it records no request id and
 * passes `basinAddress` alone. The warning therefore means "this BASIN's open
 * requests could not be told apart", and that is what is asked here.
 *
 * The cost is that a request which was itself unambiguous can be marked,
 * costing a caller a refusal it may not have needed. That direction is the
 * safe one; the opposite arms the close-modal gate against the wrong order.
 *
 * Matched on `basin_address` alone, with no chain predicate, because that is
 * what the SQL adapter's `redeemOrderLinkAmbiguous` does and the two must
 * agree. `basinRedeemRequests` carries no `chainId` param to bound it with —
 * `basin_redeem_request` has no `chain_id` column, only `centrifuge_id`,
 * which is a different id space. Addresses are distinct per chain in the
 * deployment catalog (`src/config/basin.ts` in `centrifuge/api-v4`), so a
 * cross-chain collision would need the same basin address deployed twice.
 *
 * Neither `type` nor `basin_address` leads an index on
 * `basin_reconciliation_warning`, so both are narrowed here. The read asks
 * only for `totalCount` of the WHOLE table to decide whether it can be
 * trusted: past the cap it refuses rather than sampling, because a truncated
 * page could miss the one warning that should have suppressed an order.
 */
async function basinLinkAmbiguous(
  exec: GraphqlExecutor,
  basinAddress: string,
  ctx: ResolverContext,
): Promise<boolean> {
  const data = await exec(
    `query ($first: Int!) {
      basinReconciliationWarnings(first: $first) {
        totalCount
        nodes { type basinAddress }
      }
    }`,
    { first: MAX },
  );
  assertDimensionComplete(
    data.basinReconciliationWarnings,
    "basin_reconciliation_warning (type/basinAddress lead no index)",
    ctx,
  );
  return data.basinReconciliationWarnings.nodes.some(
    (row: any) =>
      row.type === AMBIGUOUS_WARNING_TYPE &&
      row.basinAddress != null &&
      sameAddress(row.basinAddress, basinAddress),
  );
}

/**
 * Shape a joined hub redeem order, refusing it when the link is ambiguous.
 *
 * Mirrors the SQL adapter's `toLinkedRedeemOrder` exactly, including the
 * refusal: when the projection could not tell which order is the linked one,
 * the answer is `null` and never a guess. `linkedRedeemOrderIndex` may still
 * be set on the row — what is untrustworthy is the CHOICE of request, not the
 * index itself — so a caller that wants to show "we cannot tell" reads
 * `redeemOrderLinkAmbiguous` rather than inferring from a null order.
 */
function toLinkedRedeemOrder(
  order: any,
  ambiguous: boolean,
): BasinLinkedRedeemOrderRow | null {
  if (ambiguous || order == null || order.index == null) {
    return null;
  }
  // `numeric78` columns arrive as `BigFloat` strings, and a missing one as
  // null. Stringified rather than coerced: these are on-chain amounts and a
  // round trip through `number` would lose precision past 2^53.
  const amount = (value: unknown): string | null =>
    value === null || value === undefined ? null : String(value);
  return {
    index: Number(order.index),
    approvedAt: order.approvedAt ?? null,
    revokedAt: order.revokedAt ?? null,
    claimedAt: order.claimedAt ?? null,
    revokedSharesAmount: amount(order.revokedSharesAmount),
    revokedAssetsAmount: amount(order.revokedAssetsAmount),
    revokedWithNavPoolPerShare: amount(order.revokedWithNavPoolPerShare),
    revokedWithNavAssetPerShare: amount(order.revokedWithNavAssetPerShare),
  };
}

function sortLedgerDescending<T extends Record<string, any>>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      Date.parse(b.timestamp) - Date.parse(a.timestamp) ||
      Number(b.blockNumber) - Number(a.blockNumber) ||
      Number(b.logIndex) - Number(a.logIndex),
  );
}

/**
 * `holding_escrow` rows in the sql adapter's order: `centrifuge_id` (text),
 * `asset_id` (numeric), then `escrow_address` (text).
 */
interface HoldingEscrowSortKeys {
  centrifugeId: string;
  assetId: string;
  escrowAddress: string;
}

function sortHoldingEscrows<T extends HoldingEscrowSortKeys>(rows: T[]): T[] {
  const text = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return [...rows].sort((a, b) => {
    const assetA = BigInt(a.assetId);
    const assetB = BigInt(b.assetId);
    return (
      text(a.centrifugeId, b.centrifugeId) ||
      (assetA < assetB ? -1 : assetA > assetB ? 1 : 0) ||
      text(a.escrowAddress, b.escrowAddress)
    );
  });
}

/**
 * What a resolver needs besides its params: which entry it is (for errors)
 * and the client-join cap.
 */
export interface ResolverContext {
  readonly entry: string;
  readonly dimensionCap: number;
}

type Resolver = (
  exec: GraphqlExecutor,
  params: any,
  ctx: ResolverContext,
) => Promise<unknown>;

/**
 * Default page-size ceiling, mirrored from the api-v3 documents.
 *
 * For an entry's OWN collection this simply reproduces api-v3's `limit: 1000`
 * and is therefore parity-preserving. For the dimension reads the client
 * joins depend on it is a correctness boundary, guarded by
 * {@link DimensionOverflowError}.
 */
export const MAX = 1000;

/**
 * The trigger `DailySnapshotService` stamps on the hub `token_snapshot` row it
 * writes at each UTC day boundary. The other writer,
 * `shareClassManager:UpdatePricePoolPerShare`, adds a row per price update
 * inside the day; api-v3 excludes those with `trigger_ends_with: 'NewPeriod'`
 * and `hubSharePricesReport` keeps the same series here.
 */
export const HUB_PERIOD_TRIGGER = "snapshot:DailySnapshotTrigger";

/**
 * Assert a dimension read was not truncated.
 *
 * `totalCount` comes back alongside `nodes` from PostGraphile's connection,
 * so this costs nothing extra and is unambiguous — unlike inferring
 * truncation from `nodes.length === cap`.
 */
function assertDimensionComplete(
  connection: { totalCount?: number; nodes: unknown[] },
  dimension: string,
  ctx: ResolverContext,
): void {
  const observed = connection.totalCount ?? connection.nodes.length;
  if (observed > ctx.dimensionCap) {
    throw new DimensionOverflowError(
      ctx.entry,
      dimension,
      ctx.dimensionCap,
      observed,
    );
  }
}

/**
 * Read every node of a cursor-paged connection.
 *
 * A pool's authorization log has no bound, so unlike a dimension read this
 * does not stop at the cap: it follows `endCursor` until `hasNextPage` is
 * false, and the cap is only the page size. It pages by cursor rather than by
 * offset like `readEveryPage`, so a row inserted mid-read cannot shift a page
 * into repeating another. A page that claims another page but names no new
 * cursor ends in an error rather than a loop.
 */
async function readAllPages<Node>(
  exec: GraphqlExecutor,
  field: string,
  document: string,
  variables: Record<string, unknown>,
  pageSize: number,
): Promise<Node[]> {
  const nodes: Node[] = [];
  let after: string | null = null;
  for (;;) {
    const data = await exec(document, {
      ...variables,
      first: pageSize,
      after,
    });
    const page = data[field];
    nodes.push(...page.nodes);
    if (!page.pageInfo.hasNextPage) {
      return nodes;
    }
    if (!page.pageInfo.endCursor || page.pageInfo.endCursor === after) {
      throw new Error(`${field} reports another page but no new cursor`);
    }
    after = page.pageInfo.endCursor;
  }
}

/** Plain string order, for ISO timestamps. */
const compareStrings = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

/** A nullable column as the wire gave it: null stays null, never "null". */
const nullableString = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);

/**
 * The adapter primary key as a map key: address, network, and generation tag.
 *
 * The address half is lowercased because `chain_v1` stores checksummed and
 * plain hex in different columns; the network half is not, because a
 * centrifugeId is a decimal string and `String(1)` is the only spelling either
 * side produces. Written as a function so the two call sites cannot drift into
 * building the key differently, which would silently stop the join matching.
 */
function adapterKey(
  address: string,
  centrifugeId: string,
  registryVersion: string,
): string {
  return `${address.toLowerCase()}|${centrifugeId}|${registryVersion}`;
}

/**
 * A GraphQL enum value public-api spells in SCREAMING_SNAKE, as the form the
 * catalogue's result types (and the SDK's declared unions) actually use.
 *
 * PostGraphile renames every Postgres enum label to SCREAMING_SNAKE_CASE, so
 * `chain_v1`'s `Enabled` reaches a caller as `ENABLED` and `CanNotManage` as
 * `CAN_NOT_MANAGE`. The projection's own spelling is what
 * `packages/queries/src/core/types.ts` declares
 * ({@link ../core/types.ts | `ManagerCrosschainProgress`},
 * `AdapterCrosschainProgress`), what `queries/sql` serves, what the backend's
 * REST body carries, and what the SDK's `ManagerProgress` / `AdapterProgress`
 * unions in `packages/sdk/src/entities/Pool.ts` declare. So the conversion
 * goes graphql -> projection, never the other way: three of the four sides
 * already agree.
 *
 * An unrecognised label THROWS rather than being passed through. The SDK casts
 * these with `as ManagerProgress`, so a value outside the union would be
 * accepted silently by the compiler and compared against literals that can
 * never match — a `crosschainInProgress` that is neither null nor either known
 * state would read as "a change is in flight, of an unknown kind", which is
 * exactly the plausible-wrong-value the fail-loud rule exists for.
 */
function fromGraphqlEnum<T extends string>(
  value: unknown,
  spellings: ReadonlyMap<string, T>,
  field: string,
): T | null {
  if (value === null || value === undefined) {
    return null;
  }
  // A `Map`, not an object literal, and not for taste: `{ ... }[String(value)]`
  // walks the prototype chain, so a server answering `"toString"` or
  // `"constructor"` would produce a DEFINED lookup and this function would
  // return a function as the enum value instead of throwing.
  const mapped = spellings.get(String(value));
  if (mapped === undefined) {
    throw new Error(
      `public-api returned ${JSON.stringify(value)} for \`${field}\`, which ` +
        `is not one of ${[...spellings.keys()].join(", ")}. The projection's ` +
        `own spelling is ${[...spellings.values()].join(" / ")}; a value ` +
        `outside that set cannot be normalised and must not be passed ` +
        `through, because the SDK casts this field into a closed union.`,
    );
  }
  return mapped;
}

/** `chain_v1.pool_adapter_crosschain_in_progress`, as PostGraphile spells it. */
const ADAPTER_PROGRESS = new Map([
  ["ENABLED", "Enabled"],
  ["DISABLED", "Disabled"],
] as const);

/** `chain_v1.pool_manager_crosschain_in_progress`, as PostGraphile spells it. */
const MANAGER_PROGRESS = new Map([
  ["CAN_MANAGE", "CanManage"],
  ["CAN_NOT_MANAGE", "CanNotManage"],
] as const);

function toAdapterProgress(value: unknown): "Enabled" | "Disabled" | null {
  return fromGraphqlEnum(
    value,
    ADAPTER_PROGRESS,
    "poolAdapters.crosschainInProgress",
  );
}

function toManagerProgress(
  value: unknown,
): "CanManage" | "CanNotManage" | null {
  return fromGraphqlEnum(
    value,
    MANAGER_PROGRESS,
    "poolManagers.crosschainInProgress",
  );
}

/**
 * `chain_v1.investor_transaction_type`, as PostGraphile spells it — which for
 * this enum is exactly as `chain_v1` spells it.
 *
 * The identity map is deliberate, not an oversight. PostGraphile v4 renames
 * Postgres enum VALUES to constant case, which mangles the mixed-case enums
 * (`vault_status`'s `Linked`, `pool_manager_crosschain_in_progress`'s
 * `CanNotManage`) and needs the explicit maps further down this file. This
 * enum is declared CONSTANT CASE already
 * (`packages/public-db/src/schema/chain.ts` in `centrifuge/api-v4`), so the rename is a no-op:
 * introspecting the live schema returns `DEPOSIT_REQUEST_UPDATED` and the
 * column holds `DEPOSIT_REQUEST_UPDATED`. There is nothing to un-mangle, and
 * inventing a mapping would repeat the injective-inverse mistake the other two
 * maps avoid.
 *
 * What is worth having is the CLOSED set. `InvestorTransactionRow.type` is a
 * bare `string` that `Investor.transactions()` passes straight to the caller,
 * which renders it; an unrecognised label would reach a UI switch and fall
 * through to a blank row. So the labels are pinned here, mapped to themselves,
 * and an unknown one throws — the same rule the two renaming maps apply.
 */
const INVESTOR_TRANSACTION_TYPES = new Map(
  [
    "DEPOSIT_REQUEST_UPDATED",
    "REDEEM_REQUEST_UPDATED",
    "DEPOSIT_REQUEST_CANCELLED",
    "REDEEM_REQUEST_CANCELLED",
    "DEPOSIT_REQUEST_EXECUTED",
    "REDEEM_REQUEST_EXECUTED",
    "DEPOSIT_CLAIMABLE",
    "REDEEM_CLAIMABLE",
    "DEPOSIT_CLAIMED",
    "REDEEM_CLAIMED",
    "SYNC_DEPOSIT",
    "SYNC_REDEEM",
    "TRANSFER_IN",
    "TRANSFER_OUT",
    "TRANSFER_MINT",
    "TRANSFER_BURN",
  ].map((label) => [label, label] as const),
);

/**
 * One `investorTransaction.type`, checked against the projection's own set.
 *
 * Non-null on the column, so unlike the two progress enums a `null` here is a
 * broken read rather than "no value" and is refused with the rest.
 */
function toInvestorTransactionType(value: unknown): string {
  const mapped = fromGraphqlEnum(
    value,
    INVESTOR_TRANSACTION_TYPES,
    "investorTransactions.type",
  );
  if (mapped === null) {
    throw new Error(
      "public-api returned no `type` for an investorTransactions row; " +
        "`chain_v1.investor_transaction.type` is NOT NULL, so an absent value " +
        "means the selection or the projection is broken, not that the " +
        "transaction has no kind.",
    );
  }
  return mapped;
}

/**
 * `chain_v1.token_snapshot`'s 23 yield columns, restated here (not imported
 * from `core/types.ts`'s `ShareYields`) so this is the CLOSED set a caller's
 * `shareYieldsReport.yieldFields` may select — the same set `rest/routes.ts`
 * restates as `SERVED_YIELD_FIELDS` for the REST transport. An unknown field
 * is refused before it reaches the document: interpolating a caller-chosen
 * string into a GraphQL selection set is otherwise a document-injection
 * surface, and a typo would fail as an opaque GraphQL validation error
 * instead of naming the field.
 */
const YIELD_FIELDS = new Set([
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
 * A caller-selected yield field name, checked against {@link YIELD_FIELDS}
 * and re-spelled onto PostGraphile's actual field name via a GraphQL alias.
 *
 * PostGraphile capitalizes a lowercase `d` immediately after a digit
 * (`yield1d` -> `yield1D`, `yield30dComp360` -> `yield30DComp360`; verified
 * live against the schema) — `yieldTtm`/`yieldSinceInception`/`yieldYtd`
 * have no such boundary and pass through unchanged. The alias
 * (`<name>: <wireName>`) means the response always carries the caller's own
 * spelling, so the resolver never has to un-mangle it a second time.
 */
function yieldFieldSelection(field: string): string {
  if (!YIELD_FIELDS.has(field)) {
    throw new Error(
      `The "shareYieldsReport" entry asked for yield field ` +
        `${JSON.stringify(field)}, which chain_v1.token_snapshot does not ` +
        `carry. Refusing rather than interpolating an unrecognised field ` +
        `into the document.`,
    );
  }
  const wireName = field.replace(/(\d)d/g, "$1D");
  return wireName === field ? field : `${field}: ${wireName}`;
}

/** Fetch the `assets` lookup once and index it by id. */
async function assetsById(
  exec: GraphqlExecutor,
  ids: readonly string[],
  ctx: ResolverContext,
): Promise<Map<string, any>> {
  if (ids.length === 0) {
    return new Map();
  }
  // No `id_in` predicate exists, so the lookup table is read whole and
  // `totalCount` proves it was not truncated (see assertDimensionComplete).
  const data = await exec(
    `query ($first: Int!) {
      assets(first: $first) {
        totalCount
        nodes { id centrifugeId address name symbol decimals assetTokenId isStub }
      }
    }`,
    { first: ctx.dimensionCap },
  );
  assertDimensionComplete(data.assets, "assets", ctx);
  const wanted = new Set(ids);
  const index = new Map<string, any>();
  for (const row of data.assets.nodes) {
    if (wanted.has(String(row.id))) {
      index.set(String(row.id), row);
    }
  }
  return index;
}

/**
 * Fetch the `assets` lookup and index it by `(centrifugeId, address)`.
 *
 * The on/off-ramp rows carry only `assetAddress` — there is no `assetId`
 * column on them — so the asset id api-v3 delivered through
 * `asset { id }` has to be recovered by address within the same chain.
 */
async function assetsByAddress(
  exec: GraphqlExecutor,
  centrifugeId: string,
  ctx: ResolverContext,
): Promise<Map<string, any>> {
  const data = await exec(
    `query ($first: Int!, $centrifugeId: String!) {
      assets(first: $first, condition: { centrifugeId: $centrifugeId }) {
        totalCount
        nodes { id centrifugeId address }
      }
    }`,
    { first: ctx.dimensionCap, centrifugeId },
  );
  assertDimensionComplete(data.assets, "assets", ctx);
  const index = new Map<string, any>();
  for (const row of data.assets.nodes) {
    index.set(String(row.address).toLowerCase(), row);
  }
  return index;
}

/** Fetch the `tokens` lookup once and index it by id. */
async function tokensById(
  exec: GraphqlExecutor,
  ids: readonly string[],
  ctx: ResolverContext,
): Promise<Map<string, any>> {
  if (ids.length === 0) {
    return new Map();
  }
  const data = await exec(
    `query ($first: Int!) {
      tokens(first: $first) {
        totalCount
        nodes { id name symbol decimals centrifugeId isStub }
      }
    }`,
    { first: ctx.dimensionCap },
  );
  assertDimensionComplete(data.tokens, "tokens", ctx);
  const wanted = new Set(ids);
  const index = new Map<string, any>();
  for (const row of data.tokens.nodes) {
    if (wanted.has(String(row.id))) {
      index.set(String(row.id), row);
    }
  }
  return index;
}

/**
 * Read a field a joined row must carry, failing loud when it is absent.
 *
 * Absence can only mean the dimension read's selection set drifted away from
 * its consumer; coercing it (`String(undefined)` -> `"undefined"`, `?? ""`)
 * would hand the SDK a value api-v3 never returned.
 */
function requireField(row: any, field: string, source: string): any {
  const value = row[field];
  if (value === null || value === undefined) {
    throw new Error(
      `public-api ${source} row ${String(row.id)} is missing "${field}"; ` +
        "the dimension read's selection set is out of sync with its consumer",
    );
  }
  return value;
}

/**
 * PostGraphile's spelling of `chain_v1.vault_status` -> the projection's.
 *
 * PostGraphile v4 renames every Postgres enum VALUE to constant case, so the
 * `vault_status` labels `Linked` / `Unlinked` / `LinkInProgress` /
 * `UnlinkInProgress` reach a caller as `LINKED` / `UNLINKED` /
 * `LINK_IN_PROGRESS` / `UNLINK_IN_PROGRESS`. Nothing else in the pipeline does
 * that: the column stores the mixed-case labels, the `queries/sql` adapter
 * returns them verbatim, the backend endpoint serialises them verbatim, api-v3
 * serves them verbatim (checked against `https://api.centrifuge.io`:
 * `Linked` / `Unlinked`), and `core/types.ts` declares `VaultStatus` as the
 * mixed-case union.
 *
 * ## What the mangled spelling would do to a caller
 *
 * The SDK compares the value against string literals — `ShareClass.vaults()`
 * drops a vault whose `status` is `'Unlinked'` unless `includeUnlinked`, and
 * `pendingAmounts()` keeps only `'Linked'`. Against `LINKED`/`UNLINKED`
 * NEITHER comparison matches, so on this target — the SDK's DEFAULT
 * `graphqlTarget` — `includeUnlinked: false` would return unlinked vaults and
 * `pendingAmounts()` would see zero linked ones. Both are plausible wrong
 * values rather than failures, which is why they are caught by the live
 * sql-vs-public-api parity suite rather than by a caller.
 *
 * Mapped explicitly and CLOSED rather than un-mangled algorithmically.
 * Constant case is not injective — `LINK_IN_PROGRESS` could come back as
 * `LinkInProgress` or `LinkInprogress` — and an unrecognised label passed
 * through is exactly the failure being fixed, so a new enum member has to be
 * added here rather than silently reaching a caller in the wrong spelling.
 */
const VAULT_STATUS_BY_POSTGRAPHILE_NAME: Readonly<Record<string, string>> = {
  LINKED: "Linked",
  UNLINKED: "Unlinked",
  LINK_IN_PROGRESS: "LinkInProgress",
  UNLINK_IN_PROGRESS: "UnlinkInProgress",
};

function vaultStatusFromPostgraphile(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const mapped = VAULT_STATUS_BY_POSTGRAPHILE_NAME[String(value)];
  if (mapped === undefined) {
    throw new Error(
      `public-api returned vault status "${String(value)}", which is not a ` +
        "known chain_v1.vault_status label. The SDK compares this value " +
        "against the literals 'Linked' and 'Unlinked', so passing an " +
        "unrecognised spelling through would silently change which vaults " +
        "ShareClass.vaults() and pendingAmounts() return. Add the label to " +
        "VAULT_STATUS_BY_POSTGRAPHILE_NAME.",
    );
  }
  return mapped;
}

/** Shape an `assets` row into the nested `asset { … }` order rows carried. */
function toOrderAsset(row: any | undefined): OrderAsset | null {
  if (!row) {
    return null;
  }
  return {
    id: String(row.id),
    decimals: Number(requireField(row, "decimals", "assets")),
    symbol: row.symbol,
    name: row.name,
    centrifugeId: String(requireField(row, "centrifugeId", "assets")),
  };
}

/**
 * The `{ decimals, centrifugeId }` sub-object api-v3 delivered through
 * `asset { decimals centrifugeId }` / `token { decimals centrifugeId }`.
 *
 * Fails loud on an absent field rather than coercing it: a missing value here
 * can only mean the dimension read's selection set drifted, and silently
 * handing the SDK `""` or `0` is exactly the class of parity break this
 * adapter must not introduce.
 */
function toShortRef(
  row: any,
  source: string,
): { decimals: number; centrifugeId: string } {
  return {
    decimals: Number(requireField(row, "decimals", source)),
    centrifugeId: String(requireField(row, "centrifugeId", source)),
  };
}

function toOrderToken(row: any | undefined): OrderToken | null {
  if (!row) {
    return null;
  }
  return { decimals: Number(row.decimals) };
}

function toAssetDetails(row: any | undefined): AssetDetails | null {
  if (!row) {
    return null;
  }
  return {
    centrifugeId: String(requireField(row, "centrifugeId", "assets")),
    address: row.address,
    name: row.name,
    symbol: row.symbol,
    decimals: Number(row.decimals),
    assetTokenId: row.assetTokenId ?? null,
  };
}

/**
 * A STUB dimension row reads as ABSENT.
 *
 * `chain_v1` writes a placeholder row when a projection references an entity it
 * has not indexed yet: `is_stub = true`, a synthetic `symbol`, a null `name`
 * and, crucially, a `decimals` nobody measured. The order reads feed exactly
 * that field into `new Balance(revokedAssetsAmount, asset.decimals)`, so
 * serving a stub hands the SDK a FABRICATED SCALE and misprices a redemption
 * by however many orders of magnitude the placeholder is out. Nothing
 * money-shaped may be stubbed.
 *
 * The sql adapter refuses it too — the order reads join
 * `AND asset.is_stub = false` / `AND token.is_stub = false` — so both
 * transports answer `asset: null` and the SDK renders an unknown asset.
 * Without this the two would disagree on a money-shaped field for the same
 * row; `rest/order-read-parity.integration.test.ts` compares them against a
 * seeded stub.
 *
 * Applied HERE rather than inside `assetsById` / `tokensById`: those two are
 * shared dimension reads and other verticals' entries have their own answer to
 * a stub. This is the order family's, and it matches the endpoint the order
 * entries are routed onto.
 */
function usableDimensionRow(row: any | undefined): any | undefined {
  return row === undefined || row.isStub === true ? undefined : row;
}

const PAYLOAD_STATUS_BY_POSTGRAPHILE_NAME: Readonly<Record<string, string>> = {
  UNDERPAID: "Underpaid",
  IN_TRANSIT: "InTransit",
  DELIVERED: "Delivered",
  PARTIALLY_FAILED: "PartiallyFailed",
  COMPLETED: "Completed",
};

/** `decodedPayload.kind` of a ShareManager call, as the handlers write it. */
const SHARE_MANAGER_CALL_KIND_BY_NAME: Readonly<Record<string, string>> = {
  Issue: "Issue",
  Revoke: "Revoke",
};

const MESSAGE_STATUS_BY_POSTGRAPHILE_NAME: Readonly<Record<string, string>> = {
  UNSENT: "Unsent",
  AWAITING_BATCH_DELIVERY: "AwaitingBatchDelivery",
  FAILED: "Failed",
  EXECUTED: "Executed",
  CLEARED: "Cleared",
};

function enumFromPostgraphile(
  map: Readonly<Record<string, string>>,
  value: unknown,
  column: string,
): string {
  const mapped = map[String(value)];
  if (mapped === undefined) {
    throw new Error(
      `public-api returned ${column} "${String(value)}", which is not a known label`,
    );
  }
  return mapped;
}

function enumToPostgraphile(
  map: Readonly<Record<string, string>>,
  value: unknown,
  column: string,
): string {
  const entry = Object.entries(map).find(([, label]) => label === value);
  if (!entry) {
    throw new Error(`"${String(value)}" is not a known ${column} label`);
  }
  return entry[0];
}

const POSITION_ORDER_BY: Readonly<Record<string, string>> = {
  balance: "BALANCE",
  accountAddress: "ACCOUNT_ADDRESS",
  centrifugeId: "CENTRIFUGE_ID",
};

const PAYLOAD_FIELDS = `id index poolId tokenId fromCentrifugeId toCentrifugeId status rawData
  gasLimit gasPrice createdAt deliveredAt completedAt createdAtTxHash deliveredAtTxHash`;

function payloadSelection(include: Record<string, boolean>): string {
  return [
    PAYLOAD_FIELDS,
    include.pool && "pool { id name }",
    include.token && "token { name symbol }",
    include.blockchains &&
      "fromBlockchain { id centrifugeId network } toBlockchain { id centrifugeId network }",
    include.innerMessages &&
      `crosschainMessages { nodes { id index poolId tokenId payloadId payloadIndex
        fromCentrifugeId toCentrifugeId messageType status rawData data failReason
        createdAt executedAt executedAtTxHash } }`,
    include.adapterParticipations &&
      `adapterParticipations { nodes { centrifugeId fromCentrifugeId toCentrifugeId
        type side gasPaid timestamp transactionHash adapter { address name centrifugeId } } }`,
  ]
    .filter(Boolean)
    .join("\n");
}

function payloadFilter(where: Record<string, unknown>) {
  const { poolId, fromCentrifugeId, toCentrifugeId, status, status_in } = where;
  const statuses = status_in ?? (status === undefined ? undefined : [status]);
  return {
    ...(poolId !== undefined ? { poolId: { equalTo: String(poolId) } } : {}),
    ...(fromCentrifugeId !== undefined
      ? { fromCentrifugeId: { equalTo: String(fromCentrifugeId) } }
      : {}),
    ...(toCentrifugeId !== undefined
      ? { toCentrifugeId: { equalTo: String(toCentrifugeId) } }
      : {}),
    ...(Array.isArray(statuses)
      ? {
          status: {
            in: statuses.map((value) =>
              enumToPostgraphile(
                PAYLOAD_STATUS_BY_POSTGRAPHILE_NAME,
                value,
                "crosschain payload status",
              ),
            ),
          },
        }
      : {}),
  };
}

function toPayload(row: any) {
  const { crosschainMessages, adapterParticipations, ...payload } = row;
  return {
    ...payload,
    status: enumFromPostgraphile(
      PAYLOAD_STATUS_BY_POSTGRAPHILE_NAME,
      payload.status,
      "crosschain payload status",
    ),
    ...(crosschainMessages
      ? {
          crosschainMessages: {
            items: crosschainMessages.nodes.map((message: any) => ({
              ...message,
              status: enumFromPostgraphile(
                MESSAGE_STATUS_BY_POSTGRAPHILE_NAME,
                message.status,
                "crosschain message status",
              ),
            })),
          },
        }
      : {}),
    ...(adapterParticipations
      ? {
          adapterParticipations: {
            items: [...adapterParticipations.nodes].sort(
              (a: any, b: any) =>
                Date.parse(a.timestamp) - Date.parse(b.timestamp),
            ),
          },
        }
      : {}),
  };
}

/** Join `asset` and `token` onto a set of order rows. */
async function joinOrderRefs<T extends { assetId: string }>(
  exec: GraphqlExecutor,
  rows: T[],
  tokenId: string,
  ctx: ResolverContext,
): Promise<(T & { asset: OrderAsset | null; token: OrderToken | null })[]> {
  const assets = await assetsById(
    exec,
    rows.map((r) => String(r.assetId)),
    ctx,
  );
  const tokens = await tokensById(exec, [tokenId], ctx);
  const token = toOrderToken(usableDimensionRow(tokens.get(tokenId)));
  return rows.map((row) => ({
    ...row,
    asset: toOrderAsset(usableDimensionRow(assets.get(String(row.assetId)))),
    token,
  }));
}

/** Read a connection whole, `first` rows at a time, until `totalCount`. */
async function readEveryPage(
  page: (
    first: number,
    offset: number,
  ) => Promise<{ totalCount: number; nodes: any[] }>,
  ctx: ResolverContext,
): Promise<any[]> {
  const nodes: any[] = [];
  for (;;) {
    const data = await page(ctx.dimensionCap, nodes.length);
    nodes.push(...data.nodes);
    if (nodes.length >= data.totalCount || data.nodes.length === 0) {
      return nodes;
    }
  }
}

/** Every issued invest order of a share class, refs not yet joined. */
function issuedInvestOrderRows(
  exec: GraphqlExecutor,
  tokenId: string,
  ctx: ResolverContext,
): Promise<any[]> {
  return readEveryPage(
    async (first, offset) =>
      (
        await exec(
          `query ($first: Int!, $offset: Int!, $tokenId: String!) {
      investOrders(
        first: $first
        offset: $offset
        condition: { tokenId: $tokenId }
        filter: { issuedAt: { isNull: false } }
      ) {
        totalCount
        nodes {
          account
          index
          assetId
          approvedAssetsAmount
          approvedAt
          approvedAtTxHash
          issuedSharesAmount
          issuedAt
          issuedAtTxHash
          issuedWithNavAssetPerShare
          issuedWithNavPoolPerShare
          claimedAt
          claimedAtBlock
          createdAtTxHash
        }
      }
    }`,
          { first, offset, tokenId },
        )
      ).investOrders,
    ctx,
  );
}

/** Every issued invest order of a share class, refs joined once. */
async function closedInvestOrdersOf(
  exec: GraphqlExecutor,
  tokenId: string,
  ctx: ResolverContext,
): Promise<InvestOrderRow[]> {
  const rows = await issuedInvestOrderRows(exec, tokenId, ctx);
  return joinOrderRefs(exec, rows, tokenId, ctx);
}

/** Every revoked redeem order of a share class, refs not yet joined. */
function revokedRedeemOrderRows(
  exec: GraphqlExecutor,
  tokenId: string,
  ctx: ResolverContext,
): Promise<any[]> {
  return readEveryPage(
    async (first, offset) =>
      (
        await exec(
          `query ($first: Int!, $offset: Int!, $tokenId: String!) {
      redeemOrders(
        first: $first
        offset: $offset
        condition: { tokenId: $tokenId }
        filter: { revokedAt: { isNull: false } }
      ) {
        totalCount
        nodes {
          account
          index
          assetId
          approvedSharesAmount
          approvedAt
          revokedAssetsAmount
          revokedAt
          revokedWithNavAssetPerShare
          revokedWithNavPoolPerShare
          claimedAt
          claimedAtBlock
        }
      }
    }`,
          { first, offset, tokenId },
        )
      ).redeemOrders,
    ctx,
  );
}

/** Every revoked redeem order of a share class, refs joined once. */
async function closedRedeemOrdersOf(
  exec: GraphqlExecutor,
  tokenId: string,
  ctx: ResolverContext,
): Promise<RedeemOrderRow[]> {
  const rows = await revokedRedeemOrderRows(exec, tokenId, ctx);
  return joinOrderRefs(exec, rows, tokenId, ctx);
}

/**
 * Resolvers for every entry public-api can serve today. An entry missing from
 * this map is `blocked` in `capabilities.ts`.
 */
export const PUBLIC_API_RESOLVERS: Partial<Record<SdkQueryName, Resolver>> = {
  blockchains: async (exec) => {
    const data = await exec(
      `query ($first: Int!) {
        blockchains(first: $first) {
          nodes { id explorer chainId centrifugeId icon name network }
        }
      }`,
      { first: MAX },
    );
    // `chain_v1.blockchain.chain_id` is an `integer` column, so PostGraphile
    // hands it back as a GraphQL Int — but the frozen shape declares
    // `chainId: string` (every identifier in this catalogue travels as a
    // decimal string) and the sql adapter returns one. Without this the same
    // row read through REST and through graphql would differ by scalar type,
    // which is exactly what a caller must not be able to observe; the read
    // parity suite compares the two.
    //
    // The column is also nullable, and `String(null)` is `"null"` — a value
    // that reads as a real chain id to every caller downstream. Coercing a
    // missing value into a plausible-looking one is worse than surfacing
    // nothing: a caller must never observe a value the database does not
    // hold, so this fails loud through the same helper other joins here use.
    // `id` is selected only to name the row in that failure; the frozen shape
    // has no `id` field, so it is read here and never spread into the result.
    return data.blockchains.nodes.map((row: any) => ({
      explorer: row.explorer,
      chainId: String(requireField(row, "chainId", "blockchains")),
      centrifugeId: row.centrifugeId,
      icon: row.icon,
      name: row.name,
      network: row.network,
    }));
  },

  // api-v3 selected a nested `blockchain { id }` the SDK never read; the dead
  // selection is dropped rather than reproduced with a join.
  pools: async (exec) => {
    const data = await exec(
      `query ($first: Int!) {
        pools(first: $first, condition: { isStub: false }) {
          nodes { id protocolVersion status }
        }
      }`,
      { first: MAX },
    );
    return data.pools.nodes.map((row: any) => ({
      id: row.id,
      protocolVersion: row.protocolVersion ?? null,
      migrationStatus: row.status ?? null,
    }));
  },

  deployments: async (exec) => {
    const data = await exec(
      `query ($first: Int!) {
        deployments(first: $first) {
          nodes { centrifugeId chainId registryVersion }
        }
      }`,
      { first: MAX },
    );
    return data.deployments.nodes.map((row: any) => ({
      centrifugeId: String(row.centrifugeId),
      chainId: String(row.chainId),
      protocolVersion: row.registryVersion ?? null,
    }));
  },

  assetRegistrations: async (exec, p) => {
    const data = await exec(
      `query ($first: Int!, $centrifugeId: String!) {
        blockchains(condition: { centrifugeId: $centrifugeId }) {
          nodes {
            assetRegistrations(first: $first) {
              nodes {
                assetId
                centrifugeId
                asset { centrifugeId address name symbol decimals assetTokenId }
              }
            }
          }
        }
      }`,
      { first: MAX, centrifugeId: p.centrifugeId },
    );
    return data.blockchains.nodes.flatMap((chain: any) =>
      chain.assetRegistrations.nodes.map((row: any) => ({
        assetId: String(row.assetId),
        asset: row.asset
          ? toAssetDetails({
              ...row.asset,
              centrifugeId: row.asset.centrifugeId ?? row.centrifugeId,
            })
          : null,
      })),
    );
  },

  // `token_instance` carries its own `centrifugeId`, so api-v3's
  // `blockchain { centrifugeId }` traversal is not needed at all.
  tokenInstances: async (exec, p) => {
    const data = await exec(
      `query ($first: Int!, $tokenId: String!) {
        token(id: $tokenId) {
          tokenInstances(first: $first) {
            nodes { totalIssuance tokenPrice address centrifugeId }
          }
        }
      }`,
      { first: MAX, tokenId: p.tokenId },
    );
    return data.token?.tokenInstances.nodes ?? [];
  },

  epochInvestOrders: async (exec, p, ctx) => {
    const data = await exec(
      `query ($first: Int!, $tokenId: String!) {
        epochInvestOrders(first: $first, condition: { tokenId: $tokenId }) {
          nodes {
            assetId
            index
            issuedAt
            issuedAtTxHash
            approvedAt
            approvedAtTxHash
            issuedSharesAmount
            approvedAssetsAmount
            issuedWithNavPoolPerShare
            issuedWithNavAssetPerShare
          }
        }
      }`,
      { first: p.limit ?? MAX, tokenId: p.tokenId },
    );
    return joinOrderRefs(exec, data.epochInvestOrders.nodes, p.tokenId, ctx);
  },

  closedInvestOrders: async (exec, p, ctx) =>
    closedInvestOrdersOf(exec, p.tokenId, ctx),

  epochRedeemOrders: async (exec, p, ctx) => {
    const data = await exec(
      `query ($first: Int!, $condition: EpochRedeemOrderCondition!) {
        epochRedeemOrders(first: $first, condition: $condition) {
          nodes {
            assetId
            index
            revokedAt
            approvedAt
            approvedSharesAmount
            revokedSharesAmount
            revokedAssetsAmount
            revokedWithNavPoolPerShare
            revokedWithNavAssetPerShare
          }
        }
      }`,
      {
        first: p.limit ?? MAX,
        condition: {
          tokenId: p.tokenId,
          ...(p.assetId !== undefined ? { assetId: p.assetId } : {}),
          ...(p.index !== undefined ? { index: p.index } : {}),
        },
      },
    );
    return joinOrderRefs(exec, data.epochRedeemOrders.nodes, p.tokenId, ctx);
  },

  closedRedeemOrders: async (exec, p, ctx) =>
    closedRedeemOrdersOf(exec, p.tokenId, ctx),

  redeemOrdersByEpoch: async (exec, p, ctx) => {
    const epoch = (await revokedRedeemOrderRows(exec, p.tokenId, ctx)).filter(
      (r) =>
        String(r.assetId) === p.assetId &&
        r.index === p.index &&
        (!p.onlyUnclaimed || r.claimedAt === null),
    );
    return joinOrderRefs(exec, epoch.slice(0, p.limit ?? MAX), p.tokenId, ctx);
  },

  // api-v3 traversed two relation levels here (`holding { createdAt }` and
  // `asset { … blockchain { … } }`); both become joined reads. Rows are sorted
  // client-side into the sql adapter's order (centrifugeId, assetId,
  // escrowAddress): `orderBy` only reaches btree-leading columns.
  holdingEscrows: async (exec, p, ctx) => {
    const data = await exec(
      `query ($first: Int!, $tokenId: String!) {
        holdingEscrows(first: $first, condition: { tokenId: $tokenId }) {
          totalCount
          nodes { centrifugeId assetId escrowAddress assetAmount assetPrice }
        }
        holdings(first: $first, condition: { tokenId: $tokenId }) {
          totalCount
          nodes { assetId createdAt }
        }
        blockchains(first: $first) {
          totalCount
          nodes { id centrifugeId }
        }
      }`,
      { first: ctx.dimensionCap, tokenId: p.tokenId },
    );
    // A capped page would drop an escrow balance (absent, not zero) or a
    // holding (`balances()` would then price the asset at 1): refuse instead.
    assertDimensionComplete(data.holdingEscrows, "holdingEscrows", ctx);
    assertDimensionComplete(data.holdings, "holdings", ctx);
    assertDimensionComplete(data.blockchains, "blockchains", ctx);
    const rows = sortHoldingEscrows(data.holdingEscrows.nodes);
    const assets = await assetsById(
      exec,
      rows.map((r: any) => String(r.assetId)),
      ctx,
    );
    const holdingByAsset = new Map<string, any>(
      data.holdings.nodes.map((h: any) => [String(h.assetId), h]),
    );
    const chainByCentrifugeId = new Map<string, any>(
      data.blockchains.nodes.map((b: any) => [String(b.centrifugeId), b]),
    );
    return rows.map((row: any) => {
      const asset = assets.get(String(row.assetId));
      const chain = asset
        ? chainByCentrifugeId.get(String(asset.centrifugeId))
        : undefined;
      return {
        centrifugeId: String(row.centrifugeId),
        holding: holdingByAsset.has(String(row.assetId))
          ? {
              createdAt:
                holdingByAsset.get(String(row.assetId)).createdAt ?? null,
            }
          : null,
        assetId: String(row.assetId),
        escrowAddress: row.escrowAddress,
        assetAmount: row.assetAmount,
        assetPrice: row.assetPrice,
        asset: asset
          ? {
              decimals: Number(asset.decimals),
              assetTokenId: asset.assetTokenId ?? null,
              address: asset.address,
              name: asset.name,
              symbol: asset.symbol,
              blockchain: chain
                ? {
                    id: String(chain.id),
                    centrifugeId: String(chain.centrifugeId),
                  }
                : null,
            }
          : null,
      };
    });
  },

  // `issuedAt: null` is a plain equality, so `condition` expresses it.
  investOrderState: async (exec, p, ctx) => {
    const data = await exec(
      `query ($first: Int!, $tokenId: String!) {
        epochOutstandingInvests(first: $first, condition: { tokenId: $tokenId }) {
          nodes { assetId poolId tokenId pendingAssetsAmount createdAtTxHash updatedAtTxHash }
        }
        epochInvestOrders(first: $first, condition: { tokenId: $tokenId }) {
          nodes {
            poolId tokenId assetId index
            approvedAt approvedAtTxHash approvedAssetsAmount
            issuedAt issuedAtTxHash issuedSharesAmount
          }
        }
        pendingInvestOrders(first: $first, condition: { tokenId: $tokenId }) {
          nodes { account assetId tokenId queuedAssetsAmount pendingAssetsAmount }
        }
        investOrders(first: $first, condition: { tokenId: $tokenId, issuedAt: null }) {
          nodes {
            account assetId tokenId index
            approvedAt approvedAtTxHash approvedAssetsAmount
            issuedAt issuedSharesAmount claimedAt claimedSharesAmount createdAtTxHash
          }
        }
      }`,
      { first: p.limit ?? MAX, tokenId: p.tokenId },
    );

    const allAssetIds = [
      ...data.epochOutstandingInvests.nodes,
      ...data.epochInvestOrders.nodes,
      ...data.investOrders.nodes,
    ].map((r: any) => String(r.assetId));
    const assets = await assetsById(exec, allAssetIds, ctx);
    const tokens = await tokensById(exec, [p.tokenId], ctx);
    const token = toOrderToken(tokens.get(p.tokenId));
    const shortAsset = (assetId: string) => {
      const row = assets.get(String(assetId));
      return row ? toShortRef(row, "assets") : null;
    };

    return {
      epochOutstandingInvests: data.epochOutstandingInvests.nodes.map(
        (r: any) => ({
          ...r,
          asset: shortAsset(r.assetId),
        }),
      ),
      epochInvestOrders: data.epochInvestOrders.nodes.map((r: any) => ({
        ...r,
        token,
        asset: shortAsset(r.assetId),
      })),
      pendingInvestOrders: data.pendingInvestOrders.nodes,
      investOrders: data.investOrders.nodes.map((r: any) => ({
        ...r,
        asset: shortAsset(r.assetId),
      })),
    };
  },

  redeemOrderState: async (exec, p, ctx) => {
    const data = await exec(
      `query ($first: Int!, $tokenId: String!) {
        epochOutstandingRedeems(first: $first, condition: { tokenId: $tokenId }) {
          nodes { assetId poolId tokenId pendingSharesAmount createdAtTxHash updatedAtTxHash }
        }
        epochRedeemOrders(first: $first, condition: { tokenId: $tokenId }) {
          nodes {
            poolId tokenId assetId index
            approvedAt approvedAtTxHash approvedSharesAmount
            revokedAt revokedAtTxHash revokedSharesAmount revokedAssetsAmount createdAtTxHash
          }
        }
        pendingRedeemOrders(first: $first, condition: { tokenId: $tokenId }) {
          nodes {
            account assetId tokenId queuedSharesAmount pendingSharesAmount
            createdAtTxHash updatedAtTxHash
          }
        }
        redeemOrders(first: $first, condition: { tokenId: $tokenId, revokedAt: null }) {
          nodes {
            account assetId tokenId index
            approvedAt approvedSharesAmount
            revokedAt revokedSharesAmount revokedAssetsAmount
            claimedAt claimedAssetsAmount
          }
        }
      }`,
      { first: p.limit ?? MAX, tokenId: p.tokenId },
    );

    const allAssetIds = [
      ...data.epochOutstandingRedeems.nodes,
      ...data.epochRedeemOrders.nodes,
      ...data.redeemOrders.nodes,
    ].map((r: any) => String(r.assetId));
    const assets = await assetsById(exec, allAssetIds, ctx);
    const tokens = await tokensById(exec, [p.tokenId], ctx);
    const tokenRow = tokens.get(p.tokenId);
    const token = toOrderToken(tokenRow);
    const shortAsset = (assetId: string) => {
      const row = assets.get(String(assetId));
      return row ? toShortRef(row, "assets") : null;
    };
    const shortToken = tokenRow ? toShortRef(tokenRow, "tokens") : null;

    return {
      epochOutstandingRedeems: data.epochOutstandingRedeems.nodes.map(
        (r: any) => ({
          ...r,
          asset: shortAsset(r.assetId),
          token: shortToken,
        }),
      ),
      epochRedeemOrders: data.epochRedeemOrders.nodes.map((r: any) => ({
        ...r,
        token,
        asset: shortAsset(r.assetId),
      })),
      pendingRedeemOrders: data.pendingRedeemOrders.nodes,
      redeemOrders: data.redeemOrders.nodes.map((r: any) => ({
        ...r,
        asset: shortAsset(r.assetId),
        token,
      })),
    };
  },

  // `vault` carries its own `assetId` and `centrifugeId`, so api-v3's
  // `asset { id }` and `blockchain { centrifugeId }` traversals collapse to
  // the row's own columns. `status` needs {@link vaultStatusFromPostgraphile}.
  allVaults: async (exec, p) => {
    const data = await exec(
      `query ($first: Int!, $tokenId: String!) {
        vaults(first: $first, condition: { tokenId: $tokenId, isStub: false }) {
          nodes { id poolId assetAddress status assetId centrifugeId }
        }
      }`,
      { first: MAX, tokenId: p.tokenId },
    );
    return data.vaults.nodes.map((row: any) => ({
      address: row.id,
      poolId: String(row.poolId),
      assetAddress: row.assetAddress,
      status: vaultStatusFromPostgraphile(row.status),
      asset: row.assetId != null ? { id: String(row.assetId) } : null,
      centrifugeId: String(row.centrifugeId),
    }));
  },

  /**
   * A page of the share class's LIVE whitelist entries.
   *
   * "Every row whose `validUntil` is in the future", not every whitelist row,
   * on both adapters: `?status=whitelisted` is the only filter the backend
   * endpoint offers, and read parity has to hold between the two transports.
   * That is also the set the entry's one consumer wants —
   * `ShareClass.whitelistedHolders()` feeds the client's Whitelisted tab,
   * which applies `isWhitelisted === true` on top of the query.
   *
   * The filter runs client-side because `condition:` is exact equality and
   * public-api has no `validUntil_gt`. That is only correct over a COMPLETE
   * set, so the whole share class's whitelist is read at the dimension cap and
   * the page is cut here; past the cap the read throws rather than paging over
   * a partial set, which would drop live members off the end.
   */
  whitelistedInvestors: async (exec, p, ctx) => {
    const data = await exec(
      `query ($first: Int!, $tokenId: String!) {
        whitelistedInvestors(first: $first, condition: { tokenId: $tokenId }) {
          nodes { accountAddress centrifugeId createdAt isFrozen validUntil }
          totalCount
        }
      }`,
      { first: ctx.dimensionCap, tokenId: p.tokenId },
    );
    assertDimensionComplete(
      data.whitelistedInvestors,
      "whitelistedInvestors",
      ctx,
    );
    const live = data.whitelistedInvestors.nodes
      .map((row: any) => ({
        ...row,
        isWhitelisted: isWhitelistedAt(row.validUntil),
      }))
      .filter((row: any) => row.isWhitelisted);
    return {
      items: live.slice(p.offset, p.offset + p.limit),
      // The size of the FILTERED set, matching `ShareClassInvestorPage.total`,
      // which counts the rows the same `status` filter matched. A table count
      // here would label the Whitelisted tab with the number of rows that ever
      // existed.
      totalCount: live.length,
    };
  },

  whitelistedInvestor: async (exec, p) => {
    const data = await exec(
      `query ($tokenId: String!, $centrifugeId: String!, $accountAddress: String!) {
        whitelistedInvestor(
          tokenId: $tokenId
          centrifugeId: $centrifugeId
          accountAddress: $accountAddress
        ) {
          accountAddress
          centrifugeId
          createdAt
          isFrozen
          validUntil
        }
      }`,
      {
        tokenId: p.tokenId,
        centrifugeId: p.centrifugeId,
        accountAddress: p.accountAddress,
      },
    );
    const row = data.whitelistedInvestor;
    // Unlike the list, the single-row read is NOT narrowed to live entries: its
    // caller asks about one address it already has, and "whitelisted until last
    // month" is a different answer from "never whitelisted" — `holders()` reads
    // `createdAt` and `isFrozen` off an expired row. The flag says which it is.
    return row === null || row === undefined
      ? null
      : { ...row, isWhitelisted: isWhitelistedAt(row.validUntil) };
  },

  tokenInstancePosition: async (exec, p) => {
    const data = await exec(
      `query ($accountAddress: String!, $centrifugeId: String!, $tokenId: String!) {
        tokenInstancePosition(
          tokenId: $tokenId
          centrifugeId: $centrifugeId
          accountAddress: $accountAddress
        ) {
          accountAddress
          balance
          centrifugeId
          createdAt
          isFrozen
          tokenId
          updatedAt
        }
      }`,
      {
        accountAddress: p.accountAddress,
        centrifugeId: p.centrifugeId,
        tokenId: p.tokenId,
      },
    );
    return data.tokenInstancePosition ?? null;
  },

  offRampAddresses: async (exec, p) => {
    const data = await exec(
      `query ($first: Int!, $tokenId: String!) {
        offRampAddresses(first: $first, condition: { tokenId: $tokenId }) {
          nodes { centrifugeId assetAddress receiverAddress asset { id } }
        }
      }`,
      { first: MAX, tokenId: p.tokenId },
    );
    return data.offRampAddresses.nodes
      .filter((row: any) => String(row.centrifugeId) === p.centrifugeId)
      .map((row: any) => ({
        assetAddress: row.assetAddress,
        receiverAddress: row.receiverAddress,
        asset: row.asset ? { id: String(row.asset.id) } : null,
      }));
  },

  onOffRampRelayers: async (exec, p) => {
    const data = await exec(
      `query ($first: Int!, $tokenId: String!, $centrifugeId: String!) {
        offrampRelayers(
          first: $first
          condition: { tokenId: $tokenId, centrifugeId: $centrifugeId }
        ) {
          nodes { address isEnabled }
        }
      }`,
      { first: MAX, tokenId: p.tokenId, centrifugeId: p.centrifugeId },
    );
    return data.offrampRelayers.nodes;
  },

  onRampAssets: async (exec, p, ctx) => {
    const data = await exec(
      `query ($first: Int!, $tokenId: String!, $centrifugeId: String!) {
        onRampAssets(
          first: $first
          condition: { tokenId: $tokenId, centrifugeId: $centrifugeId }
        ) {
          nodes { assetAddress }
        }
      }`,
      { first: MAX, tokenId: p.tokenId, centrifugeId: p.centrifugeId },
    );
    const rows = data.onRampAssets.nodes;
    const byAddress = rows.length
      ? await assetsByAddress(exec, p.centrifugeId, ctx)
      : new Map();
    return rows.map((row: any) => {
      const asset = byAddress.get(String(row.assetAddress).toLowerCase());
      return {
        assetAddress: row.assetAddress,
        asset: asset ? { id: String(asset.id) } : null,
      };
    });
  },

  investorPortfolioSources: async (exec, p) => {
    const data = await exec(
      `query ($first: Int!) {
        vaults(first: $first, condition: { isStub: false }) {
          nodes { assetAddress centrifugeId }
        }
        tokenInstances(first: $first) { nodes { address centrifugeId } }
      }`,
      { first: p.limit ?? MAX },
    );
    return {
      vaults: data.vaults.nodes,
      tokenInstances: data.tokenInstances.nodes,
    };
  },

  /**
   * `account`/`poolId`/`tokenId`/`type` are index-backed leading columns
   * (`investor_transaction_account_idx` etc.), so the whole predicate moves
   * onto `filter:` instead of `condition:` — which is what lets
   * `createdAt` join it as a range rather than only an exact match.
   * `orderBy: [CREATED_AT_DESC]` is unconditional (not caller-configurable):
   * a transaction history page reads newest-first on both targets, and
   * nothing before this ordered on any column at all.
   */
  investorTransactions: async (exec, p, ctx) => {
    const filter: Record<string, unknown> = {
      account: { equalTo: p.account },
      poolId: { equalTo: p.poolId },
    };
    if (p.tokenId !== undefined) {
      filter.tokenId = { equalTo: p.tokenId };
    }
    if (p.type !== undefined) {
      filter.type = { equalTo: p.type };
    }
    if (p.createdAtAfter !== undefined || p.createdAtBefore !== undefined) {
      filter.createdAt = {
        ...(p.createdAtAfter !== undefined
          ? { greaterThan: p.createdAtAfter }
          : {}),
        ...(p.createdAtBefore !== undefined
          ? { lessThan: p.createdAtBefore }
          : {}),
      };
    }
    const data = await exec(
      `query ($first: Int!, $offset: Int!, $filter: InvestorTransactionFilter!) {
        investorTransactions(
          first: $first
          offset: $offset
          filter: $filter
          orderBy: [CREATED_AT_DESC]
        ) {
          nodes {
            account createdAt type createdAtTxHash currencyAmount
            currencyAssetId tokenId tokenAmount tokenPrice centrifugeId poolId
          }
          totalCount
        }
      }`,
      { first: p.limit, offset: p.offset, filter },
    );
    const rows = data.investorTransactions.nodes;
    const assets = await assetsById(
      exec,
      rows.map((r: any) => String(r.currencyAssetId)),
      ctx,
    );
    const tokens = await tokensById(
      exec,
      rows.map((r: any) => String(r.tokenId)),
      ctx,
    );
    return {
      items: rows.map((row: any) => {
        const asset = assets.get(String(row.currencyAssetId));
        const token = tokens.get(String(row.tokenId));
        return {
          account: row.account,
          createdAt: row.createdAt,
          type: toInvestorTransactionType(row.type),
          // api-v3 exposed this as `txHash`; on chain_v1 the creating
          // transaction is `createdAtTxHash`. Same value, renamed column.
          txHash: row.createdAtTxHash,
          currencyAmount: row.currencyAmount,
          currencyAsset: asset
            ? {
                decimals: Number(asset.decimals),
                symbol: asset.symbol,
                id: String(asset.id),
                address: asset.address,
              }
            : null,
          token: token
            ? {
                name: token.name,
                symbol: token.symbol,
                decimals: String(token.decimals),
              }
            : null,
          tokenAmount: row.tokenAmount,
          tokenPrice: row.tokenPrice,
          centrifugeId: String(row.centrifugeId),
          poolId: String(row.poolId),
        };
      }),
      totalCount: data.investorTransactions.totalCount,
    };
  },

  tokenInstancePositions: async (exec, p, ctx) => {
    const orderBy = POSITION_ORDER_BY[p.orderBy];
    if (!orderBy) {
      throw new Error(`tokenInstancePositions cannot order by "${p.orderBy}"`);
    }
    const document = `query ($first: Int!, $offset: Int!, $filter: TokenInstancePositionFilter!, $orderBy: [TokenInstancePositionsOrderBy!]!) {
      tokenInstancePositions(first: $first, offset: $offset, filter: $filter, orderBy: $orderBy) {
        totalCount
        nodes { accountAddress balance centrifugeId createdAt isFrozen tokenId updatedAt }
      }
    }`;
    const variables = {
      first: ctx.dimensionCap,
      filter: {
        tokenId: { equalTo: p.tokenId },
        // Protocol holders (escrows, vaults) have positions too; a holders
        // list is investors only.
        holderKind: { equalTo: "INVESTOR" },
        ...(p.balanceGt !== undefined
          ? { balance: { greaterThan: p.balanceGt } }
          : {}),
        ...(p.centrifugeIds ? { centrifugeId: { in: p.centrifugeIds } } : {}),
      },
      orderBy: [`${orderBy}_${p.orderDirection.toUpperCase()}`],
    };
    const rows: any[] = [];
    for (let offset = 0; ; offset += ctx.dimensionCap) {
      const data = await exec(document, { ...variables, offset });
      rows.push(...data.tokenInstancePositions.nodes);
      if (rows.length >= data.tokenInstancePositions.totalCount) {
        break;
      }
    }
    const excluded = new Set(
      p.excludedAddresses.map((a: string) => a.toLowerCase()),
    );
    const needle = p.holderAddress?.toLowerCase();
    const matches = rows.filter((row) => {
      const address = String(row.accountAddress).toLowerCase();
      return !excluded.has(address) && (!needle || address.includes(needle));
    });
    return {
      items: matches.slice(p.offset, p.offset + p.limit),
      totalCount: matches.length,
    };
  },

  crosschainMessages: async (exec, p, ctx) => {
    const { createdAtTxHash, ...where } = p.filter;
    const data = await exec(
      `query ($first: Int!, $before: Cursor, $after: Cursor, $filter: CrosschainPayloadFilter!) {
        crosschainPayloads(first: $first, before: $before, after: $after, filter: $filter, orderBy: PRIMARY_KEY_DESC) {
          totalCount
          pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
          nodes { ${payloadSelection(p.include)} }
        }
      }`,
      {
        first: createdAtTxHash ? ctx.dimensionCap : p.limit,
        before: p.before,
        after: p.after,
        filter: payloadFilter(where),
      },
    );
    const connection = data.crosschainPayloads;
    if (!createdAtTxHash) {
      return {
        items: connection.nodes.map(toPayload),
        totalCount: connection.totalCount,
        pageInfo: connection.pageInfo,
      };
    }
    assertDimensionComplete(connection, "crosschainPayloads", ctx);
    const txHash = String(createdAtTxHash).toLowerCase();
    const matches = connection.nodes.filter(
      (row: any) => String(row.createdAtTxHash).toLowerCase() === txHash,
    );
    return {
      items: matches.slice(0, p.limit).map(toPayload),
      totalCount: matches.length,
      pageInfo: {
        hasNextPage: false,
        hasPreviousPage: false,
        startCursor: null,
        endCursor: null,
      },
    };
  },

  poolMigration: async (exec, p, ctx) => {
    const data = await exec(
      `query ($first: Int!, $poolId: BigFloat!) {
        poolMigrations(first: $first, condition: { poolId: $poolId }) {
          totalCount
          nodes {
            migrationId poolId targetVersion hubPhase operator startedAt
            spokePhases(first: $first) {
              totalCount
              nodes { centrifugeId phase freezeGeneration }
            }
          }
        }
      }`,
      { first: ctx.dimensionCap, poolId: p.poolId },
    );
    assertDimensionComplete(data.poolMigrations, "poolMigrations", ctx);
    const row = data.poolMigrations.nodes.find(
      (candidate: any) => candidate.migrationId === POOL_MIGRATION_ID,
    );
    if (!row) {
      return null;
    }
    assertDimensionComplete(row.spokePhases, "spokePhases", ctx);
    return {
      migrationId: String(row.migrationId),
      poolId: String(row.poolId),
      targetVersion: String(row.targetVersion),
      hubPhase: String(row.hubPhase),
      operator: row.operator,
      startedAt: row.startedAt,
      spokes: row.spokePhases.nodes
        .map((spoke: any) => ({
          centrifugeId: String(spoke.centrifugeId),
          phase: String(spoke.phase),
          freezeGeneration: String(spoke.freezeGeneration),
        }))
        .sort(
          (a: any, b: any) => Number(a.centrifugeId) - Number(b.centrifugeId),
        ),
    };
  },

  poolMigrationSteps: async (exec, p, ctx) => {
    const data = await exec(
      `query ($first: Int!, $poolId: BigFloat!) {
        poolMigrationSteps(first: $first, condition: { poolId: $poolId }) {
          totalCount
          nodes {
            chainId transactionHash logIndex migrationId poolId centrifugeId
            step payloadHash gatewayMessageHash hasGatewayPrepareMessage
            isSameChainStep createdAt createdAtBlock
          }
        }
      }`,
      { first: ctx.dimensionCap, poolId: p.poolId },
    );
    assertDimensionComplete(data.poolMigrationSteps, "poolMigrationSteps", ctx);
    return data.poolMigrationSteps.nodes
      .filter(
        (row: any) =>
          row.migrationId === POOL_MIGRATION_ID &&
          (p.centrifugeId === undefined ||
            String(row.centrifugeId) === p.centrifugeId),
      )
      .map((row: any) => ({
        chainId: String(row.chainId),
        transactionHash: row.transactionHash,
        logIndex: Number(row.logIndex),
        migrationId: String(row.migrationId),
        poolId: String(row.poolId),
        centrifugeId: String(row.centrifugeId),
        step: Number(row.step),
        payloadHash: row.payloadHash,
        gatewayMessageHash: row.gatewayMessageHash,
        hasGatewayPrepareMessage: Boolean(row.hasGatewayPrepareMessage),
        isSameChainStep: Boolean(row.isSameChainStep),
        createdAt: row.createdAt,
        createdAtBlock: Number(row.createdAtBlock),
      }))
      .sort(
        (a: any, b: any) =>
          a.createdAtBlock - b.createdAtBlock || a.logIndex - b.logIndex,
      );
  },

  poolAuthorizationEvents: async (exec, p, ctx) => {
    const nodes = await readAllPages<PoolAuthorizationEventRow>(
      exec,
      "poolAuthorizationEvents",
      `query ($first: Int!, $after: Cursor, $poolId: BigFloat!) {
        poolAuthorizationEvents(
          first: $first, after: $after,
          filter: { poolId: { equalTo: $poolId } }, orderBy: PRIMARY_KEY_ASC
        ) {
          pageInfo { hasNextPage endCursor }
          nodes {
            centrifugeId poolId eventKind sourceAddress targetCentrifugeId
            policy caller authId calldata validAfter createdAt createdAtBlock
            createdAtTxHash createdAtLogIndex
          }
        }
      }`,
      { poolId: p.poolId },
      ctx.dimensionCap,
    );
    return nodes.map((row) => ({
      centrifugeId: String(row.centrifugeId),
      poolId: String(row.poolId),
      eventKind: String(row.eventKind),
      sourceAddress: row.sourceAddress,
      targetCentrifugeId: nullableString(row.targetCentrifugeId),
      policy: nullableString(row.policy),
      caller: nullableString(row.caller),
      authId: nullableString(row.authId),
      calldata: nullableString(row.calldata),
      validAfter: nullableString(row.validAfter),
      createdAt: row.createdAt,
      createdAtBlock: Number(row.createdAtBlock),
      createdAtTxHash: row.createdAtTxHash,
      createdAtLogIndex: Number(row.createdAtLogIndex),
    }));
  },

  hubPolicies: async (exec, p, ctx) => {
    const nodes = await readAllPages<HubPolicyRow>(
      exec,
      "hubPolicies",
      `query ($first: Int!, $after: Cursor, $poolId: BigFloat!) {
        hubPolicies(
          first: $first, after: $after,
          filter: { poolId: { equalTo: $poolId } }, orderBy: PRIMARY_KEY_ASC
        ) {
          pageInfo { hasNextPage endCursor }
          nodes {
            centrifugeId poolId policy delay expiry escalation
            maxAbsolutePriceDelta thresholdPerSecond maxBrmPriceDeviation
            isRestrictionUpdateInstant onchainAccounting createdAt
            createdAtBlock createdAtTxHash createdAtLogIndex
          }
        }
      }`,
      { poolId: p.poolId },
      ctx.dimensionCap,
    );
    // A null parameter was not published. It stays null: coercing it to 0 or
    // false would turn an unknown guard into a real one.
    return nodes.map((row) => ({
      centrifugeId: String(row.centrifugeId),
      poolId: String(row.poolId),
      policy: nullableString(row.policy),
      delay: nullableString(row.delay),
      expiry: nullableString(row.expiry),
      escalation: nullableString(row.escalation),
      maxAbsolutePriceDelta: nullableString(row.maxAbsolutePriceDelta),
      thresholdPerSecond: nullableString(row.thresholdPerSecond),
      maxBrmPriceDeviation: nullableString(row.maxBrmPriceDeviation),
      isRestrictionUpdateInstant: row.isRestrictionUpdateInstant ?? null,
      onchainAccounting: row.onchainAccounting ?? null,
      createdAt: row.createdAt,
      createdAtBlock: Number(row.createdAtBlock),
      createdAtTxHash: row.createdAtTxHash,
      createdAtLogIndex: Number(row.createdAtLogIndex),
    }));
  },

  shareManagerCalls: async (exec, p, ctx) => {
    type ManagerCallNode = {
      messageId: string;
      messageIndex: number | string;
      poolId: string | number;
      centrifugeId: string | number;
      targetAddress: string;
      decodedPayload: { kind?: string } | null;
      tokenId: string;
      account: string;
      shares: string | number;
      createdAt: string;
      createdAtTxHash: string;
      crosschainMessage: { status: string } | null;
    };
    const nodes = await readAllPages<ManagerCallNode>(
      exec,
      "managerCalls",
      `query ($first: Int!, $after: Cursor, $tokenId: String!) {
        managerCalls(
          first: $first, after: $after,
          filter: { tokenId: { equalTo: $tokenId }, targetKind: { equalTo: "shareManager" } },
          orderBy: PRIMARY_KEY_ASC
        ) {
          pageInfo { hasNextPage endCursor }
          nodes {
            messageId messageIndex poolId centrifugeId targetAddress
            decodedPayload tokenId account shares createdAt createdAtTxHash
            crosschainMessage { status }
          }
        }
      }`,
      { tokenId: p.tokenId },
      ctx.dimensionCap,
    );
    return nodes
      .map((row) => ({
        messageId: row.messageId,
        messageIndex: Number(row.messageIndex),
        poolId: String(row.poolId),
        centrifugeId: String(row.centrifugeId),
        targetAddress: row.targetAddress,
        kind: enumFromPostgraphile(
          SHARE_MANAGER_CALL_KIND_BY_NAME,
          row.decodedPayload?.kind,
          "share manager call kind",
        ),
        scId: row.tokenId,
        account: row.account,
        shares: String(row.shares),
        createdAt: row.createdAt,
        createdAtTxHash: row.createdAtTxHash,
        status: enumFromPostgraphile(
          MESSAGE_STATUS_BY_POSTGRAPHILE_NAME,
          row.crosschainMessage?.status,
          "crosschain message status",
        ),
      }))
      .sort(
        (a, b) =>
          compareStrings(a.createdAt, b.createdAt) ||
          a.messageIndex - b.messageIndex,
      );
  },
  crosschainMessageRows: async (exec, p, ctx) => {
    const data = await exec(
      `query ($first: Int!, $ids: [String!]!) {
        crosschainMessages(first: $first, filter: { id: { in: $ids } }) {
          totalCount
          nodes {
            id index poolId fromCentrifugeId toCentrifugeId messageType status
            failReason executedAt executedAtTxHash failedAt clearedAt
            crosschainPayload { status }
          }
        }
      }`,
      {
        first: ctx.dimensionCap,
        ids: (p.ids as string[]).map((id) => id.toLowerCase()),
      },
    );
    assertDimensionComplete(data.crosschainMessages, "crosschainMessages", ctx);
    return data.crosschainMessages.nodes
      .map((row: any) => ({
        id: row.id,
        index: Number(row.index),
        poolId:
          row.poolId === null || row.poolId === undefined
            ? null
            : String(row.poolId),
        fromCentrifugeId: String(row.fromCentrifugeId),
        toCentrifugeId: String(row.toCentrifugeId),
        messageType: String(row.messageType),
        status: enumFromPostgraphile(
          MESSAGE_STATUS_BY_POSTGRAPHILE_NAME,
          row.status,
          "crosschain_message.status",
        ),
        payloadStatus: row.crosschainPayload
          ? enumFromPostgraphile(
              PAYLOAD_STATUS_BY_POSTGRAPHILE_NAME,
              row.crosschainPayload.status,
              "crosschain_payload.status",
            )
          : null,
        failReason: row.failReason ?? null,
        executedAt: row.executedAt ?? null,
        executedAtTxHash: row.executedAtTxHash ?? null,
        failedAt: row.failedAt ?? null,
        clearedAt: row.clearedAt ?? null,
      }))
      .sort(
        (a: any, b: any) =>
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) || a.index - b.index,
      );
  },

  crosschainMessage: async (exec, p) => {
    const data = await exec(
      `query ($id: String!, $index: Int!) {
        crosschainPayload(id: $id, index: $index) { ${payloadSelection(p.include)} }
      }`,
      { id: p.id, index: p.index },
    );
    return data.crosschainPayload ? toPayload(data.crosschainPayload) : null;
  },

  /**
   * Per-network share-price snapshots, newest first, for a set of token ids.
   *
   * `tokenId` already leads `token_instance_snapshot`'s primary key, and
   * `timestamp` is now index-backed by
   * `token_instance_snapshot_timestamp_idx` (backend#613), so both the filter
   * and the ordering are server-side — no dimension cap, no client sort.
   * api-v3's `trigger_ends_with: 'NewPeriod'` is dropped rather than
   * replicated: `DailySnapshotService` is the only writer of these snapshots,
   * so every row is a period boundary. It stamps a chain's own rows
   * `snapshot:DailySnapshotTrigger` and the rows carried for a chain behind
   * the boundary `snapshot:DailySnapshotTrigger:carried` (backend#871); a
   * filter on `trigger` would drop the carried rows and leave the per-network
   * sum short by a chain.
   */
  sharePricesReport: async (exec, p) => {
    const data = await exec(
      `query ($filter: TokenInstanceSnapshotFilter!, $first: Int!) {
        tokenInstanceSnapshots(
          filter: $filter
          orderBy: [TIMESTAMP_DESC]
          first: $first
        ) {
          nodes { tokenId timestamp totalIssuance tokenPrice triggerChainId }
        }
      }`,
      { filter: { tokenId: { in: p.tokenIds } }, first: p.limit },
    );
    return {
      tokenInstanceSnapshots: { items: data.tokenInstanceSnapshots.nodes },
    };
  },

  hubSharePricesReport: async (exec, p, ctx) => {
    const filter: Record<string, unknown> = { id: { in: p.tokenIds } };
    if (p.from !== undefined || p.to !== undefined) {
      filter.timestamp = {
        ...(p.from !== undefined ? { greaterThanOrEqualTo: p.from } : {}),
        ...(p.to !== undefined ? { lessThanOrEqualTo: p.to } : {}),
      };
    }
    const document = `query ($filter: TokenSnapshotFilter!, $first: Int!, $offset: Int!) {
      tokenSnapshots(
        filter: $filter
        orderBy: [TIMESTAMP_DESC]
        first: $first
        offset: $offset
      ) {
        totalCount
        nodes { id timestamp tokenPrice totalIssuance trigger }
      }
    }`;
    const items: any[] = [];
    let scanned = 0;
    for (let offset = 0; ; offset += ctx.dimensionCap) {
      const data = await exec(document, {
        filter,
        first: ctx.dimensionCap,
        offset,
      });
      const { nodes, totalCount } = data.tokenSnapshots;
      scanned += nodes.length;
      for (const row of nodes) {
        if (row.trigger !== HUB_PERIOD_TRIGGER) {
          continue;
        }
        items.push(row);
        if (items.length >= p.limit) {
          return { tokenSnapshots: { items } };
        }
      }
      if (nodes.length === 0 || scanned >= totalCount) {
        break;
      }
    }
    return { tokenSnapshots: { items } };
  },

  /**
   * Share-class-level yield snapshots, newest first, for a set of token ids.
   *
   * Mirrors api-v3's `buildShareYieldsDocument`: `id: { in: tokenIds }` needs
   * `id` filterable, which it already is — `id` leads `token_snapshot`'s
   * primary key — and newest-first ordering needs `timestamp` filterable and
   * sortable, which it is now that `token_snapshot_timestamp_idx` gives
   * `timestamp` its own leading non-partial btree (it only trailed `id` in
   * the existing composite index before).
   *
   * Returns the SAME envelope api-v3 does (`tokenSnapshots.items`): this
   * entry's result type is `unknown` and, unlike `api-v3`'s target, nothing
   * unwraps a public-api resolver's return value again downstream (see
   * `adapter.ts`), so the two targets have to agree on the shape here rather
   * than at a shared unwrap step.
   *
   * `from`/`to` bound `timestamp` inclusively via `greaterThanOrEqualTo` /
   * `lessThanOrEqualTo` — both index-backed operators once `timestamp` leads
   * its own btree, same as the `orderBy` above. Each yield field is aliased
   * through {@link yieldFieldSelection} onto PostGraphile's actual wire
   * spelling (`yield1D`, not `yield1d`).
   */
  shareYieldsReport: async (exec, p) => {
    const fields = (p.yieldFields as string[]).map(yieldFieldSelection);
    const filter: Record<string, unknown> = { id: { in: p.tokenIds } };
    if (p.from !== undefined || p.to !== undefined) {
      filter.timestamp = {
        ...(p.from !== undefined ? { greaterThanOrEqualTo: p.from } : {}),
        ...(p.to !== undefined ? { lessThanOrEqualTo: p.to } : {}),
      };
    }
    const data = await exec(
      `query ($filter: TokenSnapshotFilter!, $first: Int!) {
        tokenSnapshots(
          filter: $filter
          orderBy: [TIMESTAMP_DESC]
          first: $first
        ) {
          nodes {
            id
            timestamp
            ${fields.join("\n            ")}
          }
        }
      }`,
      { filter, first: p.limit },
    );
    return {
      tokenSnapshots: { items: data.tokenSnapshots.nodes },
    };
  },

  poolAdapters: async (exec, p, ctx) => {
    const data = await exec(
      `query ($first: Int!, $poolId: BigFloat!, $local: String!, $remote: String!) {
        poolAdapters(
          first: $first
          condition: { poolId: $poolId, localCentrifugeId: $local, remoteCentrifugeId: $remote }
        ) {
          nodes { adapterAddress isEnabled crosschainInProgress updatedByRegistryVersion }
        }
        adapters(first: $first) {
          totalCount
          nodes { address centrifugeId registryVersion name }
        }
      }`,
      {
        first: ctx.dimensionCap,
        poolId: p.poolId,
        local: p.localCentrifugeId,
        remote: p.remoteCentrifugeId,
      },
    );
    assertDimensionComplete(data.adapters, "adapters", ctx);
    // Keyed on the relation `chain_v1` declares: address, chain, and the
    // generation that last wrote the pool-adapter row. Address and chain
    // alone match every generation that kept the address.
    const byAddressAndNetwork = new Map<string, any>(
      data.adapters.nodes.map((a: any) => [
        adapterKey(
          String(a.address),
          String(a.centrifugeId),
          String(a.registryVersion),
        ),
        a,
      ]),
    );
    return data.poolAdapters.nodes.map((row: any) => {
      const adapter = byAddressAndNetwork.get(
        adapterKey(
          String(row.adapterAddress),
          String(p.localCentrifugeId),
          String(row.updatedByRegistryVersion ?? ""),
        ),
      );
      return {
        adapterAddress: row.adapterAddress,
        isEnabled: row.isEnabled,
        crosschainInProgress: toAdapterProgress(row.crosschainInProgress),
        // `{ name: null }` is an adapter row on this chain and generation
        // with no reference name. `null` is no adapter row for that key.
        // The sql adapter makes the same distinction.
        adapter: adapter ? { name: adapter.name ?? null } : null,
      };
    });
  },

  poolManagers: async (exec, p) => {
    const data = await exec(
      `query ($first: Int!, $poolId: BigFloat!) {
        poolManagers(first: $first, condition: { poolId: $poolId }) {
          nodes {
            isHubManager isBalancesheetManager crosschainInProgress
            address centrifugeId poolId
          }
        }
      }`,
      { first: MAX, poolId: p.poolId },
    );
    // Every other field passes through untouched; only the enum label is
    // renamed, because PostGraphile spells it SCREAMING_SNAKE and the SDK's
    // `ManagerProgress` union does not.
    return data.poolManagers.nodes.map((row: Record<string, unknown>) => ({
      ...row,
      crosschainInProgress: toManagerProgress(row.crosschainInProgress),
    }));
  },

  /**
   * `isStub: false` is load-bearing here, and easy to drop.
   *
   * `chain_v1.merkle_proof_manager.is_stub` marks an unresolved hub intent — a
   * manager the hub has signalled and the spoke has not yet deployed. The
   * `queries/sql` adapter filters it and so does the backend endpoint, so
   * without this predicate public mode would serve intents alongside deployed
   * managers while the other two transports served only deployments; a live
   * sql-vs-public-api comparison on a seeded stub row is what catches that
   * (`sql/basin-read-parity.integration.test.ts`).
   *
   * What an intent would do here, not merely what it is:
   * `merkleProofManagers` feeds
   * `PoolNetwork._deployedMerkleProofManagerAddress()`, so a stub could be
   * handed to `merkleProofManager()` as the entity every policy write
   * addresses its `Hub.updateContract` to, and to
   * `deployMerkleProofManager()` as a reason to SKIP the deploy and register a
   * contract that does not exist as a balance-sheet manager — a plausible
   * wrong address rather than a failure.
   *
   * The api-v3 document (`graphql/api-v3.ts`) omits the filter and is CORRECT
   * to: `is_stub` is an Embrio `chain_v1` concept, and Ponder's own
   * `merkle_proof_manager` / `on_off_ramp_manager` tables have no such column
   * (`centrifuge-api-v3`, `ponder.schema.ts` — `MerkleProofManagerColumns` and
   * `OnOffRampManagerColumns` are `address`, `centrifugeId`, `poolId`, a
   * `tokenId` on the latter, and the audit columns). Checked rather than left
   * open, so nobody "finishes the job" by adding a condition on a field that
   * does not exist.
   */
  merkleProofManagers: async (exec, p) => {
    const data = await exec(
      `query ($first: Int!, $poolId: BigFloat!, $centrifugeId: String!) {
        merkleProofManagers(
          first: $first
          condition: { poolId: $poolId, centrifugeId: $centrifugeId, isStub: false }
        ) {
          nodes { address }
        }
      }`,
      { first: MAX, poolId: p.poolId, centrifugeId: p.centrifugeId },
    );
    return data.merkleProofManagers.nodes;
  },

  onOffRampManagers: async (exec, p) => {
    const data = await exec(
      `query ($first: Int!, $tokenId: String!, $centrifugeId: String!) {
        onOffRampManagers(
          first: $first
          condition: { tokenId: $tokenId, centrifugeId: $centrifugeId, isStub: false }
        ) {
          nodes { address createdAtBlock }
        }
      }`,
      { first: MAX, tokenId: p.tokenId, centrifugeId: p.centrifugeId },
    );
    return data.onOffRampManagers.nodes;
  },

  // ------------------------------------------------------------------ Basin
  //
  // `basin_debt` and `basin_fee` are keyed `(chain_id, basin_address,
  // token_id)`, so `basin_address` is the key's SECOND column, leads no index,
  // and `IndexBackedFieldsPlugin` strips it from `filter` AND `condition`.
  // Both reads therefore narrow on `(chainId, tokenId)` and VERIFY
  // `basinAddress` against the row that comes back, rather than returning a
  // row the caller did not ask for. The pair identifies at most one row for
  // every basin deployed today (one basin per chain, see
  // `src/config/basin.ts` in `centrifuge/api-v4`); if that ever stops
  // holding, the verification turns a wrong row into `null` rather than a
  // silent substitution.

  basinDebt: async (exec, p) => {
    const data = await exec(
      `query ($chainId: Int!, $tokenId: String!) {
        basinDebts(first: 1, condition: { chainId: $chainId, tokenId: $tokenId }) {
          nodes {
            chainId basinAddress tokenId poolId debt
            ssrPerSecondRay ratePerSecondRay ssrSeeded spreadBps
            pendingCreditTokenAmount creditTokenBalance
            lastUpdatedAt lastUpdatedAtBlock
          }
        }
      }`,
      { chainId: p.chainId, tokenId: p.tokenId },
    );
    const row = data.basinDebts.nodes[0];
    if (!row || !sameAddress(row.basinAddress, p.basinAddress)) {
      return null;
    }
    return {
      chainId: Number(row.chainId),
      basinAddress: row.basinAddress,
      tokenId: row.tokenId,
      poolId: String(row.poolId),
      debt: String(row.debt),
      ssrPerSecondRay: String(row.ssrPerSecondRay),
      ratePerSecondRay: String(row.ratePerSecondRay),
      ssrSeeded: row.ssrSeeded,
      spreadBps: Number(row.spreadBps),
      pendingCreditTokenAmount: String(row.pendingCreditTokenAmount),
      creditTokenBalance: String(row.creditTokenBalance),
      lastUpdatedAt: row.lastUpdatedAt,
      lastUpdatedAtBlock: Number(row.lastUpdatedAtBlock),
    };
  },

  basinFees: async (exec, p) => {
    const data = await exec(
      `query ($chainId: Int!, $tokenId: String!) {
        basinFees(first: 1, condition: { chainId: $chainId, tokenId: $tokenId }) {
          nodes {
            chainId basinAddress tokenId poolId
            purchaseFeeBps redemptionFeeBps minFeeBps maxFeeBps
            feesCollectedCredit feesCollectedCollateral feesCollectedSwap
            lastUpdatedAt lastUpdatedAtBlock
          }
        }
      }`,
      { chainId: p.chainId, tokenId: p.tokenId },
    );
    const row = data.basinFees.nodes[0];
    if (!row || !sameAddress(row.basinAddress, p.basinAddress)) {
      return null;
    }
    return {
      chainId: Number(row.chainId),
      basinAddress: row.basinAddress,
      tokenId: row.tokenId,
      poolId: String(row.poolId),
      purchaseFeeBps: String(row.purchaseFeeBps),
      redemptionFeeBps: String(row.redemptionFeeBps),
      minFeeBps: String(row.minFeeBps),
      maxFeeBps: String(row.maxFeeBps),
      feesCollectedCredit: String(row.feesCollectedCredit),
      feesCollectedCollateral: String(row.feesCollectedCollateral),
      feesCollectedSwap: String(row.feesCollectedSwap),
      lastUpdatedAt: row.lastUpdatedAt,
      lastUpdatedAtBlock: Number(row.lastUpdatedAtBlock),
    };
  },

  // Ordered server-side on `TIMESTAMP_DESC`: `basin_debt_change_timestamp_idx`
  // (backend#633) makes `timestamp` a leading btree column, so
  // `IndexBackedFieldsPlugin` exposes the ordering. The tie-break on
  // block/log index is still applied here — `orderBy` cannot express it, and
  // two rows in one block carry the running `debtAfter` in `logIndex` order,
  // so ordering by timestamp alone can present them reversed and make the
  // balance appear to move backwards.
  basinDebtChanges: async (exec, p) => {
    const data = await exec(
      `query ($first: Int!, $chainId: Int!, $basinAddress: String!, $tokenId: String!) {
        basinDebtChanges(
          first: $first
          condition: { chainId: $chainId, basinAddress: $basinAddress, tokenId: $tokenId }
          orderBy: [TIMESTAMP_DESC]
        ) {
          nodes {
            type interestAccrued principalDelta debtAfter ratePerSecondRay
            txHash timestamp blockNumber logIndex
          }
        }
      }`,
      {
        first: p.limit,
        chainId: p.chainId,
        basinAddress: p.basinAddress,
        tokenId: p.tokenId,
      },
    );
    return sortLedgerDescending(data.basinDebtChanges.nodes).map(
      (row: any) => ({
        type: row.type,
        interestAccrued: String(row.interestAccrued),
        principalDelta: String(row.principalDelta),
        debtAfter: String(row.debtAfter),
        ratePerSecondRay: String(row.ratePerSecondRay),
        txHash: row.txHash,
        timestamp: row.timestamp,
      }),
    );
  },

  // `basin_swap` DOES carry `TIMESTAMP_*` (backend#613), so this one orders
  // server-side. The tie-break on block/log index is still applied here:
  // `orderBy` cannot express it, and two swaps in one block would otherwise
  // come back in an arbitrary order.
  basinSwaps: async (exec, p) => {
    const data = await exec(
      `query ($first: Int!, $chainId: Int!, $basinAddress: String!, $tokenId: String!) {
        basinSwaps(
          first: $first
          condition: { chainId: $chainId, basinAddress: $basinAddress, tokenId: $tokenId }
          orderBy: [TIMESTAMP_DESC]
        ) {
          nodes {
            direction assetIn assetOut amountIn amountOut fee feeBps
            sender receiver txHash timestamp blockNumber logIndex
          }
        }
      }`,
      {
        first: p.limit,
        chainId: p.chainId,
        basinAddress: p.basinAddress,
        tokenId: p.tokenId,
      },
    );
    return sortLedgerDescending(data.basinSwaps.nodes).map((row: any) => ({
      direction: row.direction,
      assetIn: row.assetIn,
      assetOut: row.assetOut,
      amountIn: String(row.amountIn),
      amountOut: String(row.amountOut),
      fee: row.fee === null ? null : String(row.fee),
      feeBps: row.feeBps === null ? null : String(row.feeBps),
      sender: row.sender,
      receiver: row.receiver,
      txHash: row.txHash,
      timestamp: row.timestamp,
    }));
  },

  // The nested `redeemOrder` comes from the Drizzle `one()` relation on
  // `linked_redeem_order_index`, which `DrizzleVirtualForeignKeysPlugin`
  // exposes as a field. It joins `redeemer` to `redeem_order.account` with
  // EXACT equality, where the SQL adapter matches `lower()` on both sides.
  // Safe because both are written through `normalizeAddress`
  // (`projections/basin/redeem.ts`, `projections/orders/shared.ts`), so both
  // are lowercase in the projection. If that ever stopped holding this would
  // resolve null — a MISSING order, not a wrong one, which is the direction
  // the ambiguity contract already treats as "cannot tell".
  //
  // The join also depends on `redeem_order.account` being a correctly decoded
  // address, which it historically was not: the column was projected with the
  // wrong bytes32 padding and `docs/api/basin-reads.md` recorded 323/323
  // mainnet rows corrupted. Re-checked against api-v3 mainnet on 2026-10-07:
  // 467/467 `redeemOrders` and 765/765 `investOrders` are well-formed 20-byte
  // addresses, none matching the old `0x` + 16 hex + 24 zeros signature, so the
  // decode is fixed and backfilled there and this relation resolves.
  //
  // Scoped to api-v3 deliberately: `catalogue.ts` blocks `investOrderState` and
  // `redeemOrderClaims` on the same bug measured on the V4 indexer, which is a
  // different projection and is not reachable from this repo. Those stay
  // blocked. If the close-modal gate ever stops enabling against live data this
  // column is still the first thing to check — it fails CLOSED, so the symptom
  // is a missing order rather than a wrong one.
  // Ordered server-side on `INITIATED_AT_DESC` (backend#633 makes
  // `initiated_at` a leading btree column), with `requestId` as a tie-break
  // applied here since `orderBy` cannot express a second key.
  //
  // `first` stays at the cap rather than `p.limit`, and the overflow guard
  // stays: `redeemer` and `requestId` lead no index, so they are narrowed
  // HERE. Asking the server for `p.limit` rows first would take the newest N
  // and then filter them, dropping matching rows that sit outside that page —
  // a silently short answer. The read is therefore bounded by the basin and
  // refuses past the cap.
  basinRedeemRequests: async (exec, p, ctx) => {
    const data = await exec(
      `query ($first: Int!, $basinAddress: String!) {
        basinRedeemRequests(
          first: $first
          condition: { basinAddress: $basinAddress }
          orderBy: [INITIATED_AT_DESC]
        ) {
          totalCount
          nodes {
            basinAddress requestId centrifugeId poolId tokenId assetId
            redeemer state creditTokenAmount collateralTokenAmountQuoted
            collateralTokenReturned initiatedAt initiatedAtBlock
            initiatedAtTxHash spokeRedeemRequestedAt completedAt
            completedAtTxHash linkedRedeemOrderIndex
            redeemOrder {
              index approvedAt revokedAt claimedAt
              revokedSharesAmount revokedAssetsAmount
              revokedWithNavPoolPerShare revokedWithNavAssetPerShare
            }
          }
        }
      }`,
      { first: MAX, basinAddress: p.basinAddress },
    );
    assertDimensionComplete(
      data.basinRedeemRequests,
      "basin_redeem_request (redeemer/requestId are narrowed client-side)",
      ctx,
    );

    // Only ask about ambiguity when a row could actually be affected. The
    // flag exists to SUPPRESS a linked order, so a page where nothing is
    // linked has nothing to suppress — and skipping the read there means the
    // common case costs one round trip, and a basin with no links cannot be
    // failed by an overflow on a table it does not depend on.
    const anyLinked = data.basinRedeemRequests.nodes.some(
      (row: any) => row.linkedRedeemOrderIndex != null,
    );
    const ambiguous = anyLinked
      ? await basinLinkAmbiguous(exec, p.basinAddress, ctx)
      : false;

    return data.basinRedeemRequests.nodes
      .filter(
        (row: any) =>
          (p.redeemer === undefined || sameAddress(row.redeemer, p.redeemer)) &&
          (p.requestId === undefined || String(row.requestId) === p.requestId),
      )
      .sort(
        (a: any, b: any) =>
          Date.parse(b.initiatedAt) - Date.parse(a.initiatedAt) ||
          Number(b.requestId) - Number(a.requestId),
      )
      .slice(0, p.limit)
      .map((row: any) => ({
        basinAddress: row.basinAddress,
        requestId: String(row.requestId),
        centrifugeId: String(row.centrifugeId),
        poolId: String(row.poolId),
        tokenId: row.tokenId,
        assetId: String(row.assetId),
        redeemer: row.redeemer,
        state: row.state,
        creditTokenAmount: String(row.creditTokenAmount),
        collateralTokenAmountQuoted: String(row.collateralTokenAmountQuoted),
        collateralTokenReturned:
          row.collateralTokenReturned === null
            ? null
            : String(row.collateralTokenReturned),
        initiatedAt: row.initiatedAt,
        initiatedAtBlock: Number(row.initiatedAtBlock),
        initiatedAtTxHash: row.initiatedAtTxHash,
        spokeRedeemRequestedAt: row.spokeRedeemRequestedAt,
        completedAt: row.completedAt,
        completedAtTxHash: row.completedAtTxHash,
        linkedRedeemOrderIndex:
          row.linkedRedeemOrderIndex === null
            ? null
            : Number(row.linkedRedeemOrderIndex),
        redeemOrderLinkAmbiguous: ambiguous,
        redeemOrder: toLinkedRedeemOrder(row.redeemOrder, ambiguous),
      }));
  },
};
