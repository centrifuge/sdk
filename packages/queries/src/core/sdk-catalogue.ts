import { z } from "zod";
import { defineQuery, type QueriesFor } from "./entry";
import type {
  AssetRegistrationRow,
  BasinDebtChangeRow,
  BasinDebtRow,
  BasinFeeRow,
  BasinRedeemRequestRow,
  BasinSwapRow,
  BlockchainRow,
  DeploymentRow,
  EpochInvestOrderRow,
  EpochRedeemOrderRow,
  HoldingEscrowRow,
  HubPolicyRow,
  InvestOrderRow,
  InvestOrderState,
  InvestorPortfolioSources,
  InvestorTransactionsPage,
  MerkleProofManagerRow,
  OffRampAddressRow,
  OffRampRelayerRow,
  OnOffRampManagerRow,
  OnRampAssetRow,
  CrosschainMessageRow,
  PoolAdapterRow,
  PoolAuthorizationEventRow,
  PoolManagerRow,
  PoolMigrationRow,
  PoolMigrationStepRow,
  PoolRow,
  RedeemOrderRow,
  RedeemOrderState,
  ShareManagerCallRow,
  TokenInstancePositionRow,
  TokenInstanceRow,
  VaultRow,
  WhitelistedInvestorsPage,
} from "./sdk-types";

// Every param schema is .strict(): an unknown key is a caller typo and must
// reject loudly rather than silently widening a read.

// The three decimal-id params below are CANONICAL — no leading zeros — for the
// reason `catalogue.ts` spells out on its own `poolIdParam`: every consumer
// turns the string into a `BigInt` or compares it as TEXT, and `BigInt("007")`
// is `7n`, so a non-canonical spelling does not fail, it silently answers
// about a different id. The backend catalogue spells these the same way, so
// the two cannot disagree about which id a caller named.
//
// No live caller can send one: the SDK's `PoolId` / `AssetId` hold a private
// `bigint` and serialise through `BigInt.prototype.toString()`, which cannot
// emit a leading zero, and `poolIdFromShareClassId` in `rest/routes.ts` derives
// its string the same way. `"0"` stays valid — that function produces exactly
// it for the zero share-class id.

/** Raw pool id: uint64 as a canonical decimal string. */
const poolId = z
  .string()
  .regex(
    /^(0|[1-9]\d*)$/,
    "poolId must be a canonical uint64 decimal string (no leading zeros)",
  );

/** Share-class / token id: bytes16 hex. */
const tokenId = z
  .string()
  .regex(/^0x[0-9a-fA-F]{32}$/, "tokenId must be a bytes16 hex string");

/**
 * Network id as the chain tables carry it, as a canonical decimal string.
 * Not `[1-9]\d*` like the backend catalogue's: this one is also the spelling
 * the graphql adapter forwards to public-api, and narrowing the low end is a
 * separate decision from refusing a leading zero.
 */
const centrifugeId = z
  .string()
  .regex(
    /^(0|[1-9]\d*)$/,
    "centrifugeId must be a canonical decimal string (no leading zeros)",
  );

/** Asset id: uint128 as a canonical decimal string. */
const assetId = z
  .string()
  .regex(
    /^(0|[1-9]\d*)$/,
    "assetId must be a canonical uint128 decimal string (no leading zeros)",
  );

const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "must be a 20-byte hex address");

const txHash = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "must be a 32-byte hex hash");

/**
 * Page size ceiling. api-v3 used `limit: 1000` on these reads; the catalogue
 * keeps the same ceiling so a ported entry cannot start returning fewer rows
 * than the SDK saw before.
 */
const limit = z.number().int().positive().max(1000).default(1000);
const offset = z.number().int().nonnegative().default(0);

/**
 * `chain_v1.investor_transaction_type`'s 16 labels — restated here (not
 * imported from `graphql/public-api.ts`'s `INVESTOR_TRANSACTION_TYPES`, which
 * this module must not import: `graphql/*` depends on `core/*`, not the other
 * way around) so `investorTransactions.type` rejects an unrecognised label at
 * the catalogue boundary rather than sending it on to either backend.
 */
const investorTransactionType = z.enum([
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
]);

/** ISO-8601 UTC instant, as every timestamp in this catalogue travels. */
const isoDateTime = z.string().datetime({ offset: true });

/**
 * EVM chain id as the Basin tables carry it: an INTEGER column, not the
 * decimal-string ids the hub-side tables use.
 *
 * Typed as a number and capped at int4 for the same reason the backend
 * catalogue's `chainIdParam` is: `chain_v1.basin_*.chain_id` is `integer` and
 * the read filters on it as one, so a larger value reaches the driver as an
 * out-of-range int4 rather than failing validation here.
 */
const basinChainId = z.number().int().positive().max(2147483647);

/**
 * ERC-6909 token id as the Basin tables carry it: a HEX string.
 *
 * Deliberately not {@link tokenId}. A basin's `token_id` is the ERC-6909 id
 * of the credit token, stored as `text` and spelled as hex (`0x0001...0001`),
 * and it is NOT a bytes16 share-class id — it has neither that width nor the
 * `poolId << 64` structure, so `poolIdFromShareClassId` must never be pointed
 * at it. Width is left open because the projection does not fix one.
 */
const basinTokenId = z
  .string()
  .regex(/^0x[0-9a-fA-F]+$/, "basin tokenId must be a hex string");

/**
 * Page ceiling for the two Basin ledger reads.
 *
 * Same ceiling as {@link limit}, restated so the intent is explicit: the
 * api-v3 queries these replace asked for `limit: 1000`, and a smaller default
 * would silently return a fraction of an activity table with nothing in the
 * response to distinguish that from "this basin has only these rows".
 */
const basinLedgerLimit = z.number().int().positive().max(1000).default(1000);

/**
 * The SDK-facing named query catalogue: the 30 reads `packages/sdk` consumes.
 *
 * Each entry's result type is the wire shape the entity consumes (see
 * `sdk-types.ts`), so every adapter — the public-api graphql adapter, the
 * legacy api-v3 documents, and `rest` — is interchangeable and testable field
 * for field. No GraphQL document lives in `packages/sdk`.
 *
 * Separate from the backend `catalogue` on purpose: several names exist in
 * both with genuinely different result contracts (the backend entries return
 * normalized `chain_v1` rows, the SDK entries return the api-v3 wire shapes
 * its entities parse). `sdk-catalogue.unit.test.ts` asserts the overlap so it
 * stays visible instead of drifting silently.
 */
export const sdkCatalogue = {
  /** All supported networks. */
  blockchains: defineQuery<BlockchainRow[]>()(
    "blockchains",
    z.object({}).strict(),
  ),

  /**
   * Pools with their protocol version and migration status; the SDK builds
   * `Pool` entities from the ids and resolves each pool's address set from
   * its version.
   */
  pools: defineQuery<PoolRow[]>()("pools", z.object({}).strict()),

  /** Asset registrations on a hub chain, with the registered asset joined. */
  assetRegistrations: defineQuery<AssetRegistrationRow[]>()(
    "assetRegistrations",
    z.object({ centrifugeId }).strict(),
  ),

  /**
   * Deployed address sets, one row per `(chain, protocolVersion)`.
   * Informational only — the SDK transacts against the bundled
   * `@centrifuge/protocol` registry.
   */
  deployments: defineQuery<DeploymentRow[]>()(
    "deployments",
    z.object({}).strict(),
  ),

  /** Share-token instances of one share class, one row per network. */
  tokenInstances: defineQuery<TokenInstanceRow[]>()(
    "tokenInstances",
    z.object({ tokenId }).strict(),
  ),

  /** Closed (issued) invest epochs of a share class. */
  epochInvestOrders: defineQuery<EpochInvestOrderRow[]>()(
    "epochInvestOrders",
    z.object({ tokenId, limit }).strict(),
  ),

  /** Closed (revoked) redeem epochs of a share class. */
  epochRedeemOrders: defineQuery<EpochRedeemOrderRow[]>()(
    "epochRedeemOrders",
    z
      .object({
        tokenId,
        assetId: assetId.optional(),
        index: z.number().int().optional(),
        limit,
      })
      .strict(),
  ),

  /** The investors of one closed redeem epoch. */
  redeemOrdersByEpoch: defineQuery<RedeemOrderRow[]>()(
    "redeemOrdersByEpoch",
    z
      .object({
        tokenId,
        assetId,
        index: z.number().int(),
        onlyUnclaimed: z.boolean().default(false),
        limit,
      })
      .strict(),
  ),

  /**
   * Every closed (issued) invest order of a share class, refs joined once.
   * The SDK groups them against the epochs by `(assetId, approvedAtTxHash)`,
   * so a share class with N epochs costs one read, not N.
   */
  closedInvestOrders: defineQuery<InvestOrderRow[]>()(
    "closedInvestOrders",
    z.object({ tokenId }).strict(),
  ),

  /**
   * Every closed (revoked) redeem order of a share class, refs joined once.
   * The SDK groups them against the epochs by `(assetId, index)`.
   */
  closedRedeemOrders: defineQuery<RedeemOrderRow[]>()(
    "closedRedeemOrders",
    z.object({ tokenId }).strict(),
  ),

  /** Holding escrows of a share class, with holding and asset joined. */
  holdingEscrows: defineQuery<HoldingEscrowRow[]>()(
    "holdingEscrows",
    z.object({ tokenId }).strict(),
  ),

  /** The four collections backing the invest-orders view. */
  investOrderState: defineQuery<InvestOrderState>()(
    "investOrderState",
    z.object({ tokenId, limit }).strict(),
  ),

  /** The four collections backing the redeem-orders view. */
  redeemOrderState: defineQuery<RedeemOrderState>()(
    "redeemOrderState",
    z.object({ tokenId, limit }).strict(),
  ),

  /** Every vault of a share class. */
  allVaults: defineQuery<VaultRow[]>()(
    "allVaults",
    z.object({ tokenId }).strict(),
  ),

  /**
   * A page of share-token positions (the holders list). Investors only:
   * positions of protocol holders (escrows, vaults) are left out.
   *
   * Carries no `pageInfo` and no piggy-backed `assets` lookup, for the
   * reasons {@link WhitelistedInvestorsPage} spells out: no backend endpoint
   * can serve either honestly, and an empty `assets` answer falls through to a
   * hardcoded 18 decimals at the display edge.
   */
  tokenInstancePositions: defineQuery<{
    items: TokenInstancePositionRow[];
    totalCount: number;
  }>()(
    "tokenInstancePositions",
    z
      .object({
        tokenId,
        excludedAddresses: z.array(address),
        balanceGt: z.string().regex(/^\d+$/).optional(),
        holderAddress: z.string().optional(),
        centrifugeIds: z.array(centrifugeId).optional(),
        orderBy: z.string().default("balance"),
        orderDirection: z.enum(["asc", "desc"]).default("desc"),
        limit,
        offset,
      })
      .strict(),
  ),

  /** A page of whitelist entries of a share class. */
  whitelistedInvestors: defineQuery<WhitelistedInvestorsPage>()(
    "whitelistedInvestors",
    z.object({ tokenId, limit, offset }).strict(),
  ),

  /** One whitelist entry, or null. */
  whitelistedInvestor: defineQuery<
    WhitelistedInvestorsPage["items"][number] | null
  >()(
    "whitelistedInvestor",
    z.object({ tokenId, centrifugeId, accountAddress: address }).strict(),
  ),

  /** One share-token position, or null. */
  tokenInstancePosition: defineQuery<TokenInstancePositionRow | null>()(
    "tokenInstancePosition",
    z.object({ tokenId, centrifugeId, accountAddress: address }).strict(),
  ),

  /** Off-ramp receiver addresses of a share class on one network. */
  offRampAddresses: defineQuery<OffRampAddressRow[]>()(
    "offRampAddresses",
    z.object({ tokenId, centrifugeId }).strict(),
  ),

  /** Off-ramp relayers of a share class on one network. */
  onOffRampRelayers: defineQuery<OffRampRelayerRow[]>()(
    "onOffRampRelayers",
    z.object({ tokenId, centrifugeId }).strict(),
  ),

  /** On-ramp assets of a share class on one network. */
  onRampAssets: defineQuery<OnRampAssetRow[]>()(
    "onRampAssets",
    z.object({ tokenId, centrifugeId }).strict(),
  ),

  /** The two collections `Investor.portfolio()` pairs to find positions. */
  investorPortfolioSources: defineQuery<InvestorPortfolioSources>()(
    "investorPortfolioSources",
    z.object({ limit }).strict(),
  ),

  /**
   * A page of one investor's transactions in a pool, newest first
   * (`created_at` descending on both targets).
   *
   * `tokenId` and `type` are plain equality filters — safe on both targets,
   * since an unfiltered field is simply absent from api-v3's `where` object
   * rather than passed as `null` (see `API_V3_VARIABLES.investorTransactions`).
   * `createdAtAfter` / `createdAtBefore` are `public-api`-only: api-v3's
   * Ponder-generated comparison-operator suffixes for this column
   * (`created_at_gt` and its inclusive/exclusive semantics) are not verified
   * against the live deployment from this repo, and guessing them here would
   * risk exactly the silent-wrong-result class this adapter exists to avoid
   * — see the throw in `API_V3_VARIABLES.investorTransactions`.
   */
  investorTransactions: defineQuery<InvestorTransactionsPage>()(
    "investorTransactions",
    z
      .object({
        account: address,
        poolId,
        limit,
        offset,
        tokenId: tokenId.optional(),
        type: investorTransactionType.optional(),
        createdAtAfter: isoDateTime.optional(),
        createdAtBefore: isoDateTime.optional(),
      })
      .strict(),
  ),

  /** Pool adapters configured between two networks. */
  poolAdapters: defineQuery<PoolAdapterRow[]>()(
    "poolAdapters",
    z
      .object({
        poolId,
        localCentrifugeId: centrifugeId,
        remoteCentrifugeId: centrifugeId,
      })
      .strict(),
  ),

  /** On-chain manager rows of a pool. */
  poolManagers: defineQuery<PoolManagerRow[]>()(
    "poolManagers",
    z.object({ poolId }).strict(),
  ),

  /** The v3.2 to v3.3 migration of a pool with its spokes; null when never armed. */
  poolMigration: defineQuery<PoolMigrationRow | null>()(
    "poolMigration",
    z.object({ poolId }).strict(),
  ),

  /** The hub's relayed migration steps of a pool, in hub log order. */
  poolMigrationSteps: defineQuery<PoolMigrationStepRow[]>()(
    "poolMigrationSteps",
    z.object({ poolId, centrifugeId: centrifugeId.optional() }).strict(),
  ),

  /**
   * Every policy and authorization log of a pool, all kinds and chains. The
   * reader picks the kinds it needs; one chain's rows order by block, then log
   * index.
   */
  poolAuthorizationEvents: defineQuery<PoolAuthorizationEventRow[]>()(
    "poolAuthorizationEvents",
    z.object({ poolId }).strict(),
  ),

  /** Every hub policy row of a pool: the parameters a `SetPolicy` log installed. */
  hubPolicies: defineQuery<HubPolicyRow[]>()(
    "hubPolicies",
    z.object({ poolId }).strict(),
  ),

  /** The share class's issues and revokes the hub sent to a remote `ShareManager` (registry name `shareManager`), each with its message's status. */
  shareManagerCalls: defineQuery<ShareManagerCallRow[]>()(
    "shareManagerCalls",
    z.object({ tokenId }).strict(),
  ),

  /** Inner cross-chain messages by message id, every index of each id. */
  crosschainMessageRows: defineQuery<CrosschainMessageRow[]>()(
    "crosschainMessageRows",
    z.object({ ids: z.array(txHash).nonempty().max(1000) }).strict(),
  ),

  /** Deployed merkle proof managers of a pool on one network. */
  merkleProofManagers: defineQuery<MerkleProofManagerRow[]>()(
    "merkleProofManagers",
    z.object({ poolId, centrifugeId }).strict(),
  ),

  /** Deployed on/off-ramp managers of a share class on one network. */
  onOffRampManagers: defineQuery<OnOffRampManagerRow[]>()(
    "onOffRampManagers",
    z.object({ centrifugeId, tokenId }).strict(),
  ),

  /**
   * A page of crosschain payloads. The caller chooses which nested message
   * sub-tree to include, which is why this cannot be a fixed document.
   */
  crosschainMessages: defineQuery<unknown>()(
    "crosschainMessages",
    z
      .object({
        filter: z.record(z.string(), z.unknown()),
        limit,
        before: z.string().optional(),
        after: z.string().optional(),
        include: z.record(z.string(), z.boolean()).default({}),
      })
      .strict(),
  ),

  /**
   * One crosschain payload with a caller-chosen nested selection.
   *
   * `poolId` is OPTIONAL and additive: the backend read is pool-scoped
   * because it is gated `@PoolMembers()` on the pool in the path, so the REST
   * route needs a pool id that `(id, index)` alone cannot supply. It is not
   * required, because `centrifuge.crosschainMessage(id, index)` — the only
   * caller — is a root-level method with no pool in hand. Without one the REST
   * route refuses loudly rather than guessing a pool; see `rest/routes.ts`. A
   * `pool.crosschainMessage(...)` shortcut mirroring
   * `pool.crosschainMessages()` is what would supply it.
   */
  crosschainMessage: defineQuery<unknown>()(
    "crosschainMessage",
    z
      .object({
        poolId: poolId.optional(),
        id: z.string(),
        index: z.number(),
        include: z.record(z.string(), z.boolean()).default({}),
      })
      .strict(),
  ),

  /** Share-price snapshots backing the share prices report. */
  sharePricesReport: defineQuery<unknown>()(
    "sharePricesReport",
    z.object({ tokenIds: z.array(tokenId), limit }).strict(),
  ),

  /**
   * Share-yield snapshots backing the share yields report, newest first.
   *
   * `from` / `to` bound `timestamp` inclusively — same params, same meaning,
   * as {@link catalogue.shareYieldSnapshots} on the sibling backend
   * catalogue, which reads the same `token_snapshot` table over `queries/sql`.
   * `public-api`-only: `greaterThanOrEqualTo`/`lessThanOrEqualTo` are verified
   * connection-filter operators there, but api-v3's Ponder suffix spelling
   * for an inclusive bound on this column is not verified against the live
   * deployment from this repo — see the throw in
   * `API_V3_VARIABLES.shareYieldsReport`.
   */
  shareYieldsReport: defineQuery<unknown>()(
    "shareYieldsReport",
    z
      .object({
        tokenIds: z.array(tokenId),
        yieldFields: z.array(z.string()),
        limit,
        from: isoDateTime.optional(),
        to: isoDateTime.optional(),
      })
      .strict(),
  ),

  hubSharePricesReport: defineQuery<unknown>()(
    "hubSharePricesReport",
    z
      .object({
        tokenIds: z.array(tokenId),
        limit,
        from: isoDateTime.optional(),
        to: isoDateTime.optional(),
      })
      .strict(),
  ),

  /**
   * One Basin's debt position, or null when nothing has touched it yet.
   *
   * Null rather than an error: a basin with no projected debt is a real
   * state, and the caller's signature already has to handle it.
   *
   * `basinAddress` is NOT a server-side predicate on public-api. It is the
   * second column of `basin_debt`'s primary key, so it leads no index and
   * `IndexBackedFieldsPlugin` strips it from both `filter` and `condition`.
   * The adapter narrows on `(chainId, tokenId)` — which identifies at most one
   * row for every basin deployed today — and verifies `basinAddress` against
   * the row it gets back. See the Stage 1 note on #629.
   */
  basinDebt: defineQuery<BasinDebtRow | null>()(
    "basinDebt",
    z
      .object({
        chainId: basinChainId,
        basinAddress: address,
        tokenId: basinTokenId,
      })
      .strict(),
  ),

  /**
   * One Basin's debt-change ledger, newest first.
   *
   * Returned UNFILTERED by `type`, unlike the api-v3 query it replaces (which
   * asked for four of the six). `debtAfter` is a running balance, so the rows
   * only reconcile as a whole — dropping the accrual rows would hand a caller
   * a series that appears to jump. See {@link BasinDebtChangeType}.
   */
  basinDebtChanges: defineQuery<BasinDebtChangeRow[]>()(
    "basinDebtChanges",
    z
      .object({
        chainId: basinChainId,
        basinAddress: address,
        tokenId: basinTokenId,
        limit: basinLedgerLimit,
      })
      .strict(),
  ),

  /**
   * One Basin's fee configuration and collected totals, or null when unknown.
   *
   * `basinAddress` is verified client-side for the same reason as
   * {@link sdkCatalogue.basinDebt} — `basin_fee` has the same primary key.
   */
  basinFees: defineQuery<BasinFeeRow | null>()(
    "basinFees",
    z
      .object({
        chainId: basinChainId,
        basinAddress: address,
        tokenId: basinTokenId,
      })
      .strict(),
  ),

  /**
   * One Basin's OTC swaps, newest first.
   *
   * `OTHER`-direction swaps are INCLUDED, for the same reason the debt-change
   * ledger is unfiltered: the projection recorded them, and which directions a
   * screen shows is a display choice. See {@link BasinSwapDirection}.
   */
  basinSwaps: defineQuery<BasinSwapRow[]>()(
    "basinSwaps",
    z
      .object({
        chainId: basinChainId,
        basinAddress: address,
        tokenId: basinTokenId,
        limit: basinLedgerLimit,
      })
      .strict(),
  ),

  /**
   * One Basin's redeem requests, newest first.
   *
   * Only `basinAddress` is a server-side predicate: it leads
   * `basin_redeem_request`'s primary key, while `redeemer` and `requestId`
   * lead no index and are therefore narrowed client-side over the
   * basin-bounded set, under the dimension cap.
   *
   * The linked hub redeem order IS joined, through the Drizzle `one()`
   * relation on `linkedRedeemOrderIndex` that `virtual-foreign-keys.ts` turns
   * into a PostGraphile smart tag. It is null when the order does not exist
   * yet, and null when the link is ambiguous — in which case
   * `redeemOrderLinkAmbiguous` is true and the caller should say "we cannot
   * tell" rather than treat a missing order as "no order".
   */
  basinRedeemRequests: defineQuery<BasinRedeemRequestRow[]>()(
    "basinRedeemRequests",
    z
      .object({
        basinAddress: address,
        redeemer: address.optional(),
        requestId: z.string().optional(),
        limit: basinLedgerLimit,
      })
      .strict(),
  ),
} as const;

/** The SDK catalogue's entry map type. */
export type SdkQueryCatalogue = typeof sdkCatalogue;

/** All SDK catalogue entry names. */
export type SdkQueryName = keyof SdkQueryCatalogue;

/** The adapter interface the SDK catalogue induces. */
export type SdkQueries = QueriesFor<SdkQueryCatalogue>;
