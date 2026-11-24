import { z } from "zod";
import { defineQuery, type QueriesFor } from "./entry";
import type {
  AssetRegistration,
  BasinDebt,
  BasinDebtChange,
  BasinFee,
  BasinLinkedRedeemOrder,
  BasinRedeemRequest,
  BasinSwap,
  Blockchain,
  BlockWatermark,
  CrosschainPayload,
  CrosschainPayloadPage,
  Deployment,
  EpochInvestOrder,
  EpochOutstandingInvest,
  EpochOutstandingRedeem,
  EpochRedeemOrder,
  HoldingEscrow,
  HoldingEscrowSnapshot,
  InvestorPosition,
  InvestorTransaction,
  MerkleProofManager,
  OffRampAddress,
  OffRampRelayer,
  OnOffRampManager,
  OnRampAsset,
  Pool,
  PoolAdapter,
  PoolManager,
  ShareClass,
  ShareClassInvestor,
  ShareClassInvestorPage,
  SharePriceSnapshot,
  ShareYieldSnapshot,
  SnapshotWatermark,
  TokenInstance,
  TokenMeta,
  TokenSnapshot,
  Vault,
  WhitelistedInvestor,
} from "./types";

// Every param schema is .strict(): an unknown key is a caller typo and must
// reject loudly instead of being silently dropped (a misspelled filter would
// otherwise silently widen a read).

/**
 * Raw pool id: uint64 as a CANONICAL decimal string — no leading zeros.
 *
 * Canonical for the reason {@link centrifugeIdParam} is, and the failure mode
 * here is INVISIBLE either way it lands. `poolId` reaches `chain_v1` as
 * `BigInt(params.poolId)` and `BigInt("007")` is `7n`, so a `/^\d+$/` gate
 * would let `GET /pools/007` answer about pool 7 without complaint. Where a
 * read filters the id as TEXT instead, the same spelling matches no row and
 * comes back as an empty 200 a caller cannot tell from "this pool has
 * nothing".
 *
 * `"0"` stays valid: it is a representable pool id and
 * `poolIdFromShareClassId(0x00…00)` in `rest/routes.ts` produces exactly it.
 * Only the non-canonical SPELLINGS are refused — refused rather than
 * normalised, because a caller who wrote `"007"` made a typo and rewriting it
 * hides that.
 */
const poolIdParam = z
  .string()
  .regex(
    /^(0|[1-9]\d*)$/,
    "poolId must be a canonical uint64 decimal string (no leading zeros)",
  );

/**
 * Centrifuge network id as chain tables carry it, as a CANONICAL decimal
 * string: no leading zeros, and not `"0"` (centrifugeIds start at 1).
 *
 * Canonical rather than `/^\d+$/`, matching the HTTP DTOs (`basin`,
 * `investors`, `pool-access`, `transactions`) that spell it the same way. Two
 * spellings of one network (`"2"` and `"02"`) defeat any uniqueness check
 * built on the string.
 *
 * It matters HERE because the value reaches `chain_v1` as a TEXT filter:
 * `centrifuge_id = '02'` matches no row, so a non-canonical spelling would
 * come back as a silent empty result rather than an error — an answer
 * indistinguishable from "this network has nothing". Refused rather than
 * normalised: a caller who writes `"02"` has made a typo, and rewriting it
 * hides that.
 */
const centrifugeIdParam = z
  .string()
  .regex(
    /^[1-9]\d*$/,
    "centrifugeId must be a canonical decimal network id (no leading zeros)",
  );

/** Share-class / share-token id: bytes16 hex. */
const tokenIdParam = z
  .string()
  .regex(/^0x[0-9a-fA-F]{32}$/, "tokenId must be a bytes16 hex string");

/**
 * Asset id: uint128 as a CANONICAL decimal string — no leading zeros.
 *
 * Same class and same mechanism as {@link poolIdParam}: every consumer reaches
 * `chain_v1` through `BigInt(params.assetId)`, so `?assetId=07` narrowed an
 * order page to asset 7 while saying 07. Canonical, and `"0"` stays valid.
 */
const assetIdParam = z
  .string()
  .regex(
    /^(0|[1-9]\d*)$/,
    "assetId must be a canonical uint128 decimal string (no leading zeros)",
  );

/** A 20-byte EVM address. */
const addressParam = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "must be a 20-byte hex address");

/**
 * EVM chain id as the Basin tables carry it: an INTEGER column, not the
 * decimal-string ids the hub-side tables use.
 *
 * Typed as a number here because `chain_v1.basin_*.chain_id` is `integer` and
 * the read filters on it as one — and capped at int4 for the same reason: the
 * value is BOUND as an int4 parameter, so a larger one raises a driver error
 * (SQLSTATE 22003) that no Zod filter maps, surfacing as a 500. The string params above are canonical-spelled
 * precisely because they reach the database as TEXT; that hazard does not
 * exist for a value zod has already parsed to a number.
 */
const chainIdParam = z.number().int().positive().max(2147483647);

/**
 * ERC-6909 token id as the Basin tables carry it: a HEX string.
 *
 * Deliberately not {@link tokenIdParam}. A basin's `token_id` is the
 * ERC-6909 id of the credit token, stored as `text` and spelled as hex
 * (`0x0001...0001`), and it is NOT a bytes16 share-class id — it has neither
 * that width nor the `poolId << 64` structure, so `poolIdFromShareClassId`
 * must never be pointed at it. Width is left open because the projection does
 * not fix one; the `0x` prefix and hex alphabet are what a TEXT filter needs
 * to match a row rather than silently miss it.
 */
const basinTokenIdParam = z
  .string()
  .regex(/^0x[0-9a-fA-F]+$/, "basin tokenId must be a hex string");

/**
 * A 32-byte hex value: a transaction hash, or a crosschain payload id (which
 * is a bytes32 message-batch hash, not an address).
 */
const txHashParam = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "must be a 32-byte hex string");

/**
 * A crosschain payload status, spelled as `chain_v1` stores it.
 *
 * The enum is restated rather than derived from the Drizzle `pgEnum` so
 * `core/` keeps its no-I/O, no-schema-import rule; `sql-queries.ts` selects
 * the column directly, and a divergence would surface as a type error there.
 */
const payloadStatusParam = z.enum([
  "Underpaid",
  "InTransit",
  "Delivered",
  "PartiallyFailed",
  "Completed",
]);

/**
 * Which nested sub-trees a crosschain read joins in.
 *
 * Every flag defaults to absent, so the base read is the cheapest one and a
 * caller opts in per join — the same contract `CrosschainMessageIncludes`
 * gives the SDK. Strict, so a misspelled flag is refused rather than silently
 * leaving a sub-tree out of the answer the caller believes they asked for.
 */
const crosschainIncludesParam = z
  .object({
    pool: z.boolean().optional(),
    token: z.boolean().optional(),
    blockchains: z.boolean().optional(),
    innerMessages: z.boolean().optional(),
    adapterParticipations: z.boolean().optional(),
  })
  .strict()
  .default({});

/** Page size with a defensive ceiling; adapters never return unbounded pages. */
const limitParam = z.number().int().positive().max(1000).default(100);

/**
 * Page size for the epoch-shaped order reads.
 *
 * Same ceiling as {@link limitParam} and a DIFFERENT default, deliberately.
 * The SDK catalogue's order entries declare `limit` as `default(1000)` and the
 * graphql adapter asks public-api for `first: 1000`, so a default of 100 here
 * would make backend mode return ten times fewer epochs than public mode for
 * the identical call — the drift `rest/routes.ts` already documents for
 * `pools`. It matters more here than there: the revoke arithmetic walks from
 * the LAST revoked epoch to the last approved one, so a page that silently
 * stops short does not shorten a list, it moves the epoch a write is built
 * against.
 */
const orderLimitParam = z.number().int().positive().max(1000).default(1000);

/**
 * Optional bound for the current-state (whole-table) reads a snapshot diff
 * needs. Separate from {@link limitParam} because those reads are not paged —
 * the consumer asks for its safety cap + 1 so it can DETECT an overrun
 * instead of silently materialising an unbounded result set.
 */
const snapshotLimitParam = z
  .number()
  .int()
  .positive()
  .max(1_000_000)
  .optional();

/**
 * Which of the four investor views a share-class investor page is asking
 * for.
 *
 * Defaults to `"all"` rather than being required: the union is the widest and
 * therefore the safest answer to give a caller who did not narrow, and it is
 * the tab the management app opens on.
 */
const investorStatusParam = z
  .enum(["all", "whitelisted", "frozen", "holder"])
  .default("all");

/**
 * Watermark cursor for ledger-shaped reads: strictly-after `(blockNumber,
 * txHash, logIndex)` in that tuple order, over `chain_v1` rows.
 */
const blockWatermarkParam = z
  .object({
    blockNumber: z.number().int().nonnegative(),
    txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    logIndex: z.number().int().nonnegative(),
  })
  .strict()
  .optional();

/**
 * Watermark cursor for snapshot-shaped reads: strictly-after
 * `(timestamp, triggerBlockNumber, trigger, rowKey)`.
 *
 * The full four-part tuple matches the snapshot tables' primary key. See
 * {@link SnapshotWatermark} for why the leading pair alone is not unique and
 * would drop rows at a page boundary.
 */
const snapshotWatermarkParam = z
  .object({
    /** ISO-8601 timestamp of the last consumed snapshot period. */
    timestamp: z.iso.datetime(),
    triggerBlockNumber: z.number().int().nonnegative(),
    /** The snapshot's trigger discriminator (part of the table's PK). */
    trigger: z.string(),
    /** The row's identity columns as one string; see `SnapshotWatermark`. */
    rowKey: z.string(),
  })
  .strict()
  .optional();

/**
 * The named query catalogue: the foundational reads plus the entries backing
 * the ingestion fetchers. Each vertical extends this catalogue with the
 * entries its endpoints serve.
 */
export const catalogue = {
  /** One pool by id; null when unknown (stub rows are never returned). */
  pool: defineQuery<Pool | null>()(
    "pool",
    z.object({ poolId: poolIdParam }).strict(),
  ),

  /** Pools, optionally filtered; stub rows are never returned. */
  pools: defineQuery<Pool[]>()(
    "pools",
    z
      .object({
        ids: z.array(poolIdParam).nonempty().optional(),
        centrifugeId: centrifugeIdParam.optional(),
        isActive: z.boolean().optional(),
        limit: limitParam,
        offset: z.number().int().nonnegative().default(0),
      })
      .strict(),
  ),

  /**
   * Every supported network; backs `centrifuge.blockchains()`.
   * Static-ish reference data, so no filter and no page bound.
   */
  blockchains: defineQuery<Blockchain[]>()(
    "blockchains",
    z.object({}).strict(),
  ),

  /**
   * One share class by id; null when unknown or stubbed.
   *
   * The share-class-level row — supply, scale and last price — as opposed to
   * `tokenInstances`, which is one row per network. Read by the NavPage WRITE
   * path: a total NAV becomes a price per share only by dividing by this
   * issuance at this scale, and a submitted `computedAt` is only legal measured
   * against this `priceComputedAt`.
   *
   * Separate from `tokensById` rather than a widening of it: that entry is the
   * ingestion layer's display-metadata cache (`id`, `poolId`, `centrifugeId`,
   * `symbol`) and is read per BATCH of ids on every poll. Adding money columns
   * to it would put a fail-loud money check on the hot ingestion path, where a
   * single null row would stall the poller rather than one request.
   */
  shareClass: defineQuery<ShareClass | null>()(
    "shareClass",
    z.object({ tokenId: tokenIdParam }).strict(),
  ),

  /**
   * Share-token instances of one share class, one row per network; backs
   * the per-network token reads of the Tokenizations vertical.
   */
  tokenInstances: defineQuery<TokenInstance[]>()(
    "tokenInstances",
    z.object({ tokenId: tokenIdParam }).strict(),
  ),

  /**
   * Holding escrows of one share class, with the holding and asset joined —
   * the indexer half of `shareClass.balances()`.
   *
   * No page bound: a share class holds a handful of assets, and the SDK's
   * `balances()` reads the whole set to compose one view — a truncated page
   * would silently drop a holding from a balance sheet.
   */
  holdingEscrows: defineQuery<HoldingEscrow[]>()(
    "holdingEscrows",
    z.object({ tokenId: tokenIdParam }).strict(),
  ),

  /**
   * Asset registrations on one HUB chain, with the registered asset joined;
   * backs `centrifuge.assets(spokeCentrifugeId, hubCentrifugeId)`.
   *
   * `centrifugeId` is the hub chain — that is the column
   * `chain_v1.asset_registration` carries. Filtering to the spoke chain the
   * assets live on is `asset.centrifugeId`, which the SDK applies entity-side.
   */
  assetRegistrations: defineQuery<AssetRegistration[]>()(
    "assetRegistrations",
    z.object({ centrifugeId: centrifugeIdParam }).strict(),
  ),

  /**
   * Deployed on/off-ramp managers of one share class on one network.
   *
   * Used by the Holdings writes: the manager-sourced deposit/withdraw branch
   * validates its target contract against this projection rather than
   * encoding a caller-supplied address.
   */
  onOffRampManagers: defineQuery<OnOffRampManager[]>()(
    "onOffRampManagers",
    z
      .object({ tokenId: tokenIdParam, centrifugeId: centrifugeIdParam })
      .strict(),
  ),

  /**
   * Deployed merkle-proof managers of one pool on one network (issue #34);
   * the entry the SDK's `merkleProofManagers` is routed onto.
   *
   * Pool-keyed, not share-class-keyed: a merkle-proof manager authorises
   * strategist workflows for a whole pool on one spoke, which is why
   * `chain_v1.merkle_proof_manager` carries `pool_id` and no `token_id`.
   *
   * `is_stub = false`, the filter the graphql adapter applies and the parity
   * doc documents (`docs/parity/03-on-off-ramp.md`): a stub row is an
   * unresolved HUB intent, not a deployed manager, and returning one would
   * hand the deploy-and-register flow an address that does not exist on the
   * spoke yet.
   *
   * No page bound, for the same reason `onOffRampManagers` has none: a pool
   * has at most a handful per network (zero or one across all of mainnet
   * today), and the SDK reads the whole set to pick ONE address out of it, so
   * a truncated page would silently change which manager it picks.
   */
  merkleProofManagers: defineQuery<MerkleProofManager[]>()(
    "merkleProofManagers",
    z.object({ poolId: poolIdParam, centrifugeId: centrifugeIdParam }).strict(),
  ),

  /**
   * Off-ramp receivers of one share class on one network, with the hub asset
   * id joined; the entry the SDK's `offRampAddresses` is routed onto.
   *
   * Backs `onOffRampManager.receivers()`. Disabled receivers are INCLUDED:
   * `is_enabled` is not part of the frozen shape and the SDK does not filter
   * on it, so filtering here would make the REST body a subset of what public
   * mode returns for the same call.
   */
  offRampAddresses: defineQuery<OffRampAddress[]>()(
    "offRampAddresses",
    z
      .object({ tokenId: tokenIdParam, centrifugeId: centrifugeIdParam })
      .strict(),
  ),

  /**
   * Off-ramp relayers of one share class on one network; the entry the SDK's
   * `onOffRampRelayers` is routed onto.
   *
   * The name mismatch with its table is deliberate: the frozen catalogue entry
   * is `onOffRampRelayers` while the projection table is
   * `chain_v1.offramp_relayer`. Renaming either would break a frozen contract
   * on one side or Embrio's schema on the other.
   */
  onOffRampRelayers: defineQuery<OffRampRelayer[]>()(
    "onOffRampRelayers",
    z
      .object({ tokenId: tokenIdParam, centrifugeId: centrifugeIdParam })
      .strict(),
  ),

  /**
   * On-ramp assets of one share class on one network, with the hub asset id
   * joined; the entry the SDK's `onRampAssets` is routed onto.
   *
   * Backs `onOffRampManager.assets()`. Disabled assets are INCLUDED, same
   * reasoning as `offRampAddresses`.
   */
  onRampAssets: defineQuery<OnRampAsset[]>()(
    "onRampAssets",
    z
      .object({ tokenId: tokenIdParam, centrifugeId: centrifugeIdParam })
      .strict(),
  ),

  /**
   * One Basin's debt position on one chain.
   *
   * Keyed by the projection's full primary key `(chainId, basinAddress,
   * tokenId)` and answering a SINGLE row, where the api-v3 read it replaces
   * returned every basin's debt and let the caller filter. Moving the filter
   * server-side is the point: the app matched on all three components anyway,
   * and a read that ships every basin to find one is a cross-tenant leak
   * waiting for a second consumer.
   *
   * Null when no row exists, rather than an error — a basin with no projected
   * debt is a real state (nothing has touched it yet), and the caller's
   * signature already has to handle it.
   */
  basinDebt: defineQuery<BasinDebt | null>()(
    "basinDebt",
    z
      .object({
        chainId: chainIdParam,
        basinAddress: addressParam,
        tokenId: basinTokenIdParam,
      })
      .strict(),
  ),

  /**
   * One Basin's debt-change ledger, newest first.
   *
   * Returned UNFILTERED by `type`, unlike the api-v3 query it replaces (which
   * asked for four of the six). `debtAfter` is a running balance, so the rows
   * only reconcile as a whole — dropping the accrual rows would hand a caller
   * a series that appears to jump. The management app keeps its own display
   * filter; see {@link BasinDebtChangeType}.
   */
  basinDebtChanges: defineQuery<BasinDebtChange[]>()(
    "basinDebtChanges",
    z
      .object({
        chainId: chainIdParam,
        basinAddress: addressParam,
        tokenId: basinTokenIdParam,
        limit: orderLimitParam,
      })
      .strict(),
  ),

  /** One Basin's fee configuration and collected totals; null when unknown. */
  basinFees: defineQuery<BasinFee | null>()(
    "basinFees",
    z
      .object({
        chainId: chainIdParam,
        basinAddress: addressParam,
        tokenId: basinTokenIdParam,
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
  basinSwaps: defineQuery<BasinSwap[]>()(
    "basinSwaps",
    z
      .object({
        chainId: chainIdParam,
        basinAddress: addressParam,
        tokenId: basinTokenIdParam,
        limit: orderLimitParam,
      })
      .strict(),
  ),

  /**
   * One Basin's redeem requests for one redeemer, each with its linked hub
   * redeem order joined through `linked_redeem_order_index`.
   *
   * The join is what makes {@link catalogue.basinRedeemOrder} unnecessary for
   * the common case: api-v3 never populated the link (api-v3#452), so the app
   * had to read the hub order separately and correlate it by timestamp.
   *
   * A request whose link is ambiguous comes back with `redeemOrder: null` and
   * `redeemOrderLinkAmbiguous: true` rather than a guessed order — see
   * {@link BasinRedeemRequest.redeemOrderLinkAmbiguous}.
   */
  basinRedeemRequests: defineQuery<BasinRedeemRequest[]>()(
    "basinRedeemRequests",
    z
      .object({
        basinAddress: addressParam,
        /**
         * Narrow to one redeemer. Optional because the endpoint's tenancy
         * check needs to resolve a request's pool WITHOUT knowing whose it is
         * — see `resolveBasinRequestScope`. The management app always passes
         * it.
         */
        redeemer: addressParam.optional(),
        /** Narrow to one request, for the same reason. */
        requestId: z.string().min(1).optional(),
        limit: orderLimitParam,
      })
      .strict(),
  ),

  /**
   * The hub redeem order linked to ONE Basin redeem request; null when the
   * request has no order yet, or when the link is ambiguous.
   *
   * Separate from {@link catalogue.basinRedeemRequests} because the close-modal
   * gate re-reads just this one order on a short interval while a redemption is
   * in flight, and re-fetching the whole request list to refresh one order is
   * the read the app is moving away from.
   */
  basinRedeemOrder: defineQuery<BasinLinkedRedeemOrder | null>()(
    "basinRedeemOrder",
    z
      .object({ basinAddress: addressParam, requestId: z.string().min(1) })
      .strict(),
  ),

  /**
   * Vaults of one share class, optionally narrowed to one network, with the
   * asset joined — the indexer half of `vault.details()`, and the entry the
   * SDK's `allVaults` is routed onto.
   *
   * No page bound, for the same reason `holdingEscrows` has none: a share
   * class has a handful of vaults and the SDK reads the whole set to compose
   * one view, so a truncated page would silently hide a vault from a network
   * list.
   *
   * Unlinked vaults are INCLUDED. `ShareClass.vaults(centrifugeId,
   * includeUnlinked)` filters them entity-side and the link/unlink write path
   * needs to see them (an unlinked vault is exactly what `link` targets), so
   * filtering server-side would make the REST body differ from what public
   * mode returns for the same call (read parity).
   *
   * This entry is reused rather than duplicated under the SDK's own name:
   * `ShareClass._allVaults()` reads `address`, `poolId`,
   * `assetAddress`, `status`, `asset.id` and `centrifugeId` off every vault of
   * a share class with no network filter, which is exactly this entry called
   * without `centrifugeId`. `catalogue.unit.test.ts` pins the coverage at
   * compile time (`HasKeysOf<Vault, VaultRow>`). A second entry would be two
   * spellings of one read, free to drift.
   */
  vaults: defineQuery<Vault[]>()(
    "vaults",
    z
      .object({
        tokenId: tokenIdParam,
        centrifugeId: centrifugeIdParam.optional(),
      })
      .strict(),
  ),

  /**
   * One investor's position in one vault.
   *
   * BLOCKED, not stubbed: `chain_v1` projects nothing this read could be
   * served from, and every field of `vault.investment(address)` is
   * money-shaped (`maxDeposit`, the four `claimable*`, the two `pending*`),
   * so neither a fabricated row nor an opt-in fallback is allowed.
   * The sql adapter therefore always fails loud with
   * `ProjectionUnavailableError` -> 503 `NOT_YET_PROJECTED`, which the SDK maps
   * to a typed error so an app renders "not available yet" rather than "no
   * position".
   *
   * The entry exists anyway — the contract is real, only the source is
   * missing — so the swap is a one-line change. The result type is
   * `never` on purpose — there is no honest shape to freeze yet, and declaring
   * a plausible one would invite a consumer to bind to fields that may not be
   * what the projection eventually carries.
   *
   * TODO(indexer-gap): vaults.vaultInvestment — unblock when the per-investor
   * vault position is projected. `chain_v1.vault_invest_order` /
   * `vault_redeem_order` carry requested/claimable ORDER amounts, which are a
   * different quantity from the vault's contract-read investment state and
   * belong to the Orders vertical; serving them under these
   * names would be the same class of silent money bug as serving
   * `holding_escrow.asset_amount` as `availableBalanceOf`.
   */
  vaultInvestment: defineQuery<never>()(
    "vaultInvestment",
    z
      .object({
        vaultAddress: addressParam,
        investorAddress: addressParam,
      })
      .strict(),
  ),

  /**
   * Outstanding (not yet approved) invest totals of one share class, one row
   * per asset (issue #50).
   *
   * The mirror of {@link catalogue.epochOutstandingRedeem}, and the entry that
   * gives `approveDeposits` the server-side ceiling it did not have: the chain
   * bounds the approval with
   * `require(approvedAssetAmount <= pendingAssetAmount, InsufficientPending())`
   * (`BatchRequestManager.approveDeposits`), which without this projection
   * reverted after the signing ceremony where `approveRedeems` answered 422.
   *
   * `assetId` narrows to one asset, optional for the same reason the redeem
   * entry's is: the approvals panel shows every asset of the share class at
   * once, which is one row per asset and therefore bounded by the pool's asset
   * set — hence no page bound.
   *
   * Serves normally: `chain_v1.epoch_outstanding_invest` is keyed
   * `(token_id, asset_id)` and names no investor, so it is untouched by the
   * corrupted `account` column that blocks {@link catalogue.investOrderState}.
   */
  epochOutstandingInvest: defineQuery<EpochOutstandingInvest[]>()(
    "epochOutstandingInvest",
    z
      .object({ tokenId: tokenIdParam, assetId: assetIdParam.optional() })
      .strict(),
  ),

  /**
   * Invest EPOCHS of one share class — the approve/issue history, one row per
   * `(asset, index)` (issue #50).
   *
   * The aggregate half of the invest family, and the entry both
   * `epochInvestOrders` and the `investOrderState.epochInvestOrders`
   * collection are routed onto (see {@link EpochInvestOrder} for why one shape
   * covers both).
   *
   * Rows come back in a TOTAL order — `(assetId, index)`, which is the whole
   * primary key once `tokenId` is fixed. Non-negotiable for this family for the
   * reason spelled out on {@link catalogue.epochRedeemOrders}: the consuming
   * action takes a PREFIX of an order list, and unlike `value`, a `data`
   * mismatch between preview and prepare reaches dual-channel verification and
   * rejects a legitimate transaction.
   *
   * Note `index` may be zero or negative in live data: `chain_v1.invest_order`
   * and `epoch_invest_order` carry SYNC deposits at index `0` and below (36 of
   * 499 live mainnet `investOrders` rows), which settle atomically and never
   * pass through `approveDeposits`. Hence the param is a
   * plain integer rather than `nonnegative()`, where the redeem entry's is
   * bounded — filtering those out here would hide rows that exist.
   *
   * Serves normally: `chain_v1.epoch_invest_order` names no investor.
   */
  epochInvestOrders: defineQuery<EpochInvestOrder[]>()(
    "epochInvestOrders",
    z
      .object({
        tokenId: tokenIdParam,
        assetId: assetIdParam.optional(),
        index: z.number().int().optional(),
        limit: orderLimitParam,
        offset: z.number().int().nonnegative().default(0),
      })
      .strict(),
  ),

  /**
   * The four collections behind `ShareClass._investOrders()` (issue #50).
   *
   * BLOCKED, not stubbed, for exactly the reason
   * {@link catalogue.redeemOrderState} is: the column is there and its CONTENTS
   * are wrong. Two of the four collections (`pendingInvestOrders`,
   * `investOrders`) are per-investor and carry `account`, which
   * `chain_v1.invest_order` and `chain_v1.pending_invest_order` project with the
   * LEFT-padded `bytes32` convention against a protocol that RIGHT-pads
   * (`addressToBytes32` = `padEnd(66, "0")`; `CastLib.toAddress` is
   * `address(bytes20(addr))` guarded by
   * `require(uint96(uint256(addr)) == 0, PrefixNotZero())`, so the address is
   * the LEADING 20 bytes). What survives is `0x` + the address's last 8 bytes
   * + 12 zero bytes.
   *
   * Measured on the live v4 mainnet indexer, and it is worse than
   * the redeem side rather than better: `investOrders.account` 463 of 499 rows
   * and `pendingInvestOrders.account` 2 of 2. The 36 rows that survive
   * uncorrupted are exactly the SYNC deposits (`index <= 0`), projected from a
   * different event that carries a plain address — so 463 of 463 async rows,
   * which are the only ones `approveDeposits` / `issueShares` / `notifyDeposit`
   * ever touch, are corrupted.
   *
   * Serving the two aggregate collections and emptying the other two is not
   * an option, on the same grounds as the redeem composite: `_investOrders`
   * derives `outstandingInvests` from exactly the two per-investor
   * collections, so an empty pair reads as "no investor has an open deposit".
   * The composite therefore fails whole; its aggregate halves are their own
   * entries and DO serve ({@link catalogue.epochInvestOrders},
   * {@link catalogue.epochOutstandingInvest}).
   *
   * There is deliberately no local repair: no decode patch, no compensating
   * transform, no re-derivation from event logs, no RPC read. Any of those
   * would put a second, divergent address convention in the codebase. The fix
   * is Embrio's decode, and it is the SAME fix that unblocks the redeem
   * family — one decode, two families.
   *
   * TODO(indexer-gap): orders.investOrderState — unblock when
   * `chain_v1.invest_order.account` / `chain_v1.pending_invest_order.account`
   * are re-derived with the right-padded `bytes32` convention and backfilled
   * (Embrio; no ticket filed yet, tracked as issue #50).
   */
  investOrderState: defineQuery<never>()(
    "investOrderState",
    z.object({ tokenId: tokenIdParam, limit: orderLimitParam }).strict(),
  ),

  /**
   * `maxDepositClaims` for one investor on one `(share class, asset)` — how
   * many issued invest epochs are waiting to be notified (issue #50).
   *
   * The mirror of {@link catalogue.redeemOrderClaims}, and derivable for the
   * same reason: `BatchRequestManager._maxClaims`
   * (`src/vaults/BatchRequestManager.sol:754-761`) is ONE function serving both
   * `maxDepositClaims` (:733-741) and `maxRedeemClaims` (:744-752) — the deposit
   * side only substitutes `epochId[...].issue` for `.revoke` — and
   * `_claimDeposit` (:499-568) settles `userOrder.lastUpdate` and then
   * increments it (:565) exactly as `_claimRedeem` does (:687). So claimed
   * epochs are a prefix and issued-unclaimed ones the contiguous suffix, and
   * their COUNT is the window's width. The derivation itself is
   * {@link deriveMaxDepositClaims} in the sql adapter.
   *
   * BLOCKED for the same reason as {@link catalogue.investOrderState}, and one
   * step worse in the same way `redeemOrderClaims` is: this entry does not
   * merely RETURN the corrupted `account`, it FILTERS on it. A real 20-byte
   * address matches no async row, so the derivation would answer `0` for every
   * investor — "nothing to claim" — which is a legitimate answer for almost all
   * of them (498 of 499 live rows are fully claimed) and therefore invisible.
   * `0` is also action-driving: it is the `maxClaims` argument of
   * `notifyDeposit`, so a silent zero does not fail, it ships a batch that
   * claims nothing.
   *
   * The entry exists anyway — the contract is real, only the source is
   * missing — so serving it is a one-line change.
   *
   * TODO(indexer-gap): orders.investOrderClaims — unblock when
   * `chain_v1.invest_order.account` is re-derived with the right-padded
   * `bytes32` convention and backfilled (Embrio; tracked as issue #50).
   */
  investOrderClaims: defineQuery<never>()(
    "investOrderClaims",
    z
      .object({
        tokenId: tokenIdParam,
        assetId: assetIdParam,
        accountAddress: addressParam,
      })
      .strict(),
  ),

  /**
   * Outstanding (not yet approved) redeem totals of one share class, one row
   * per asset (issue #50).
   *
   * The ceiling `approveRedeems` is validated against
   * (`require(approvedShareAmount <= pendingShareAmount)`), so the write path
   * reads it before building an approval rather than trusting the amount a
   * caller sent.
   *
   * `assetId` narrows to one asset. Optional because the approvals panel shows
   * every asset of the share class at once, which is one row per asset and
   * therefore bounded by the pool's asset set — hence no page bound, for the
   * same reason `holdingEscrows` has none.
   *
   * Serves normally: `chain_v1.epoch_outstanding_redeem` is keyed
   * `(token_id, asset_id)` and names no investor, so it is untouched by the
   * corrupted `account` column that blocks {@link catalogue.redeemOrderState}.
   */
  epochOutstandingRedeem: defineQuery<EpochOutstandingRedeem[]>()(
    "epochOutstandingRedeem",
    z
      .object({ tokenId: tokenIdParam, assetId: assetIdParam.optional() })
      .strict(),
  ),

  /**
   * Redeem EPOCHS of one share class — the approve/revoke history, one row per
   * `(asset, index)` (issue #50).
   *
   * The aggregate half of the redeem family, and the entry both
   * `epochRedeemOrders` and the `redeemOrderState.epochRedeemOrders`
   * collection are routed onto (see {@link EpochRedeemOrder} for why one shape
   * covers both).
   *
   * Rows come back in a TOTAL order — `(assetId, index)`, which is the whole
   * primary key once `tokenId` is fixed. Non-negotiable for this family, and
   * not merely tidiness: `approveRedeemsAndRevokeShares` consumes a PREFIX of
   * an order list (`assetOrders?.slice(0, claims)`, `ShareClass.ts:1161`), so
   * an indexer-ordered result makes preview and prepare encode different
   * calldata — and unlike `value`, a `data` mismatch reaches dual-channel
   * verification and rejects a legitimate transaction.
   *
   * Serves normally: `chain_v1.epoch_redeem_order` names no investor.
   */
  epochRedeemOrders: defineQuery<EpochRedeemOrder[]>()(
    "epochRedeemOrders",
    z
      .object({
        tokenId: tokenIdParam,
        assetId: assetIdParam.optional(),
        index: z.number().int().nonnegative().optional(),
        limit: orderLimitParam,
        offset: z.number().int().nonnegative().default(0),
      })
      .strict(),
  ),

  /**
   * The four collections behind `ShareClass._redeemOrders()` (issue #50).
   *
   * BLOCKED, not stubbed, and for the same reason as
   * {@link catalogue.poolInvestorTransactions}: the column is there and its
   * CONTENTS are wrong. Two of the four collections
   * (`pendingRedeemOrders`, `redeemOrders`) are per-investor and carry
   * `account`, which `chain_v1.redeem_order` and
   * `chain_v1.pending_redeem_order` project with the LEFT-padded `bytes32`
   * convention against a protocol that RIGHT-pads (`addressToBytes32` =
   * `padEnd(66, "0")`; `CastLib.toAddress` is `address(bytes20(addr))` guarded
   * by `require(uint96(uint256(addr)) == 0, PrefixNotZero())`, so the address
   * is the LEADING 20 bytes). What survives is `0x` + the address's last 8
   * bytes + 12 zero bytes. Measured on the live v4 mainnet indexer:
   * `redeemOrders.account` 323 / 323 rows, `pendingRedeemOrders.account`
   * 3 / 3.
   *
   * Serving the two aggregate collections and emptying the other two is not
   * an option: `_redeemOrders` derives `outstandingRedeems` from exactly the
   * two per-investor collections, so an empty pair reads as "no investor has
   * an open redemption" — exactly the plausible-looking answer a missing
   * projection must never be given. The composite therefore fails whole. Its
   * aggregate halves are their own entries and DO serve
   * ({@link catalogue.epochRedeemOrders},
   * {@link catalogue.epochOutstandingRedeem}).
   *
   * There is deliberately no local repair: no decode patch, no compensating
   * transform, no re-derivation from event logs, no RPC read. The fix is
   * Embrio's decode; a second address convention on this side would have to be
   * unpicked when theirs lands. This repo's own projection already uses the
   * right one — `normalizeAddress` in the handlers (now in `centrifuge/api-v4`) takes
   * `slice(0, 42)`, the leading 20 bytes.
   *
   * The result type is `never` for the same reason `vaultInvestment`'s is:
   * there is no honest shape to freeze while the source is untrustworthy.
   *
   * TODO(indexer-gap): orders.redeemOrderState — unblock when
   * `chain_v1.redeem_order.account` / `chain_v1.pending_redeem_order.account`
   * are re-derived with the right-padded `bytes32` convention and backfilled
   * (Embrio; no ticket filed yet, tracked as issue #50).
   */
  redeemOrderState: defineQuery<never>()(
    "redeemOrderState",
    z.object({ tokenId: tokenIdParam, limit: orderLimitParam }).strict(),
  ),

  /**
   * `maxRedeemClaims` for one investor on one `(share class, asset)` — how many
   * revoked redeem epochs are waiting to be notified (issue #50).
   *
   * The last apparent RPC dependency of the orders write path, and it
   * is derivable: the contract defines the value as backlog depth
   * (`BatchRequestManager._maxClaims`, `revoke - lastUpdate + 1`) and
   * `notifyRedeem` claims strictly forward from `lastUpdate`, so the unclaimed
   * epochs are a contiguous suffix and their COUNT is the same number. The
   * derivation itself is {@link deriveMaxRedeemClaims} in the sql adapter,
   * where it is documented in full and exercised against live mainnet rows.
   *
   * BLOCKED for the same reason as {@link catalogue.redeemOrderState}, and one
   * step worse: this entry does not merely RETURN the corrupted `account`, it
   * FILTERS on it. A real 20-byte address matches no row, so the derivation
   * would answer `0` for every investor — "nothing to claim" — which is a
   * legitimate answer for most of them and therefore invisible. `0` is also
   * action-driving: it is the `maxClaims` argument of `notifyRedeem`, so a
   * silent zero does not fail, it ships a batch that claims nothing.
   *
   * The entry exists anyway — the contract is real, only the source is
   * missing — so serving it is a one-line change.
   *
   * TODO(indexer-gap): orders.redeemOrderClaims — unblock when
   * `chain_v1.redeem_order.account` is re-derived with the right-padded
   * `bytes32` convention and backfilled (Embrio; tracked as issue #50).
   */
  redeemOrderClaims: defineQuery<never>()(
    "redeemOrderClaims",
    z
      .object({
        tokenId: tokenIdParam,
        assetId: assetIdParam,
        accountAddress: addressParam,
      })
      .strict(),
  ),

  /**
   * Deployed address sets keyed `(centrifugeId, protocolVersion)`: during a
   * migration window a chain returns one row per protocol version, never one
   * row per chain.
   *
   * `centrifugeId` is {@link centrifugeIdParam} like every other entry's, so
   * every `centrifugeId` param in this catalogue asks for the same canonical
   * string and a caller reads the shape rather than remembering which entry is
   * different. The `Deployment` ROW still declares `centrifugeId: number` —
   * that shape is frozen and `chain_v1.deployment.centrifuge_id` is TEXT that
   * `readDeploymentTable` parses — so the injected branch does the `String()`
   * conversion.
   */
  deployments: defineQuery<Deployment[]>()(
    "deployments",
    z
      .object({
        centrifugeId: centrifugeIdParam.optional(),
        protocolVersion: z.string().min(1).optional(),
      })
      .strict(),
  ),

  /**
   * On-chain pool managers; full table when no filter (snapshot-diff base).
   *
   * Two consumers with deliberately different filters: the ingestion snapshot
   * differ reads the whole table (`{ limit }`), and
   * `GET /pools/:poolId/managers` reads one pool (`{ poolId }`) — the entry
   * the SDK's `poolManagers` is routed onto.
   *
   * Rows are returned unfiltered by role: `isHubManager` and
   * `isBalancesheetManager` are both served and both may be false (a manager
   * whose grants were revoked). The SDK filters entity-side —
   * `pool.poolManagers()` on `isHubManager`, `pool.balanceSheetManagers()` on
   * `isBalancesheetManager` — from this one read, so filtering here would break
   * three other entity methods to serve one.
   */
  poolManagers: defineQuery<PoolManager[]>()(
    "poolManagers",
    z
      .object({ poolId: poolIdParam.optional(), limit: snapshotLimitParam })
      .strict(),
  ),

  /**
   * Pool adapters configured on one `(local -> remote)` network route: the
   * rows behind `pool.adapterStatus()`, and the entry the SDK's `poolAdapters`
   * is routed onto.
   *
   * All three params are required, mirroring the SDK entry: the route IS the
   * key here — an adapter set means nothing without knowing which direction it
   * governs — and a "just this pool" variant would return one pool's rows for
   * every network pair at once, which no consumer asks for and which the
   * ordering guarantee below could not keep stable across pages.
   */
  poolAdapters: defineQuery<PoolAdapter[]>()(
    "poolAdapters",
    z
      .object({
        poolId: poolIdParam,
        localCentrifugeId: centrifugeIdParam,
        remoteCentrifugeId: centrifugeIdParam,
      })
      .strict(),
  ),

  /**
   * A page of one pool's cross-chain message envelopes, newest first: backs
   * `pool.crosschainMessages()`, and the entry the SDK's `crosschainMessages`
   * is routed onto.
   *
   * `poolId` is REQUIRED, unlike the SDK entry whose `filter.poolId` is
   * optional. That is an authorization boundary, not an omission: the read is
   * gated `@PoolMembers()` on the pool in the path, and there is no role that
   * would authorise the unscoped `centrifuge.crosschainMessages()` variant —
   * it spans every pool. See `rest/routes.ts` for what an unscoped call does.
   *
   * Cursor-paged rather than offset-paged, because the SDK entry declares
   * `before` / `after` and the list is append-heavy: an offset page shifts
   * under the caller every time a new payload lands. `before` and `after` are
   * mutually exclusive — accepting both would silently apply one and ignore
   * the other.
   */
  crosschainMessages: defineQuery<CrosschainPayloadPage>()(
    "crosschainMessages",
    z
      .object({
        poolId: poolIdParam,
        fromCentrifugeId: centrifugeIdParam.optional(),
        toCentrifugeId: centrifugeIdParam.optional(),
        /** Empty means "any status"; a set matches api-v3's `status_in`. */
        status: z.array(payloadStatusParam).nonempty().optional(),
        createdAtTxHash: txHashParam.optional(),
        limit: limitParam,
        before: z.string().min(1).optional(),
        after: z.string().min(1).optional(),
        include: crosschainIncludesParam,
      })
      .strict()
      .refine((params) => !(params.before && params.after), {
        message: "before and after are mutually exclusive",
        path: ["before"],
      }),
  ),

  /**
   * One cross-chain message envelope of a pool: backs
   * `centrifuge.crosschainMessage(id, index)`, and the entry the SDK's
   * `crosschainMessage` is routed onto.
   *
   * `(id, index)` is the `chain_v1.crosschain_payload` primary key. `index` is
   * required even though every mainnet payload is index 0 today (`index`
   * defaults to 0 and 0 of 8500 ids carry a second one, measured live):
   * defaulting it would silently answer about a different row the day the
   * projection writes one.
   *
   * `poolId` is the authorization scope, and a payload that exists under a
   * DIFFERENT pool reads as absent here rather than as forbidden — no
   * cross-pool existence oracle. 163 of the 8500 mainnet payloads carry a null
   * `pool_id` (protocol-level messages) and are unreachable through any pool
   * path by the same rule.
   */
  crosschainMessage: defineQuery<CrosschainPayload | null>()(
    "crosschainMessage",
    z
      .object({
        poolId: poolIdParam,
        id: txHashParam,
        index: z.number().int().nonnegative(),
        include: crosschainIncludesParam,
      })
      .strict(),
  ),

  /**
   * Per-network share-price snapshots of one pool's share classes, newest
   * first: the raw rows behind `pool.reports.sharePrices()`, and the entry the
   * SDK's `sharePricesReport` is routed onto.
   *
   * Keyed by POOL, not by a share-class id set: the REST route is pool-scoped
   * and the SDK's own filter is a single optional `shareClassId`, so
   * "every share class of the pool" and "exactly this one" are the only two
   * shapes any consumer asks for. `tokenId` narrows to one; omitted, the read
   * covers the pool.
   *
   * No trigger filter, and its absence is a decision rather than an omission.
   * The api-v3 document narrows this read with `trigger_ends_with: "NewPeriod"`,
   * but `chain_v1.token_instance_snapshot` has exactly ONE writer —
   * `DailySnapshotService` (now in `centrifuge/api-v4`) — so every row is
   * already a period boundary. It spells the trigger two ways: a chain's own
   * rows carry `snapshot:DailySnapshotTrigger`, and the rows it writes for a
   * chain still behind the boundary carry
   * `snapshot:DailySnapshotTrigger:carried` (backend#871). A filter on either
   * spelling drops the other and leaves the per-network sum short by a chain,
   * so no reader of this table may filter on `trigger`.
   *
   * `from` / `to` bound the series inclusively on `timestamp`. They are a WHERE
   * clause and nothing more — there is deliberately no `groupBy` here, because
   * grouping in the SDK happens AFTER the per-network rows are summed into a
   * daily total, so a server-side grouping of raw rows would not be the same
   * operation (see {@link SharePriceSnapshot}).
   */
  sharePriceSnapshots: defineQuery<SharePriceSnapshot[]>()(
    "sharePriceSnapshots",
    z
      .object({
        poolId: poolIdParam,
        tokenId: tokenIdParam.optional(),
        from: z.iso.datetime().optional(),
        to: z.iso.datetime().optional(),
        limit: limitParam,
        offset: z.number().int().nonnegative().default(0),
      })
      .strict(),
  ),

  /**
   * Share-class-level yield snapshots of one pool, newest first: the raw rows
   * behind `pool.reports.shareYields()`, and the entry the SDK's
   * `shareYieldsReport` is routed onto.
   *
   * Same params as {@link catalogue.sharePriceSnapshots} and a different
   * table: yields are projected onto the share-class-level `token_snapshot`,
   * which is written both on the daily boundary and on every price update. No
   * trigger filter here either — and here that matches the SDK's own document,
   * which applies none.
   *
   * There is no `yieldFields` param. The SDK catalogue has one because its
   * graphql document is built field by field; a column list is a projection
   * detail of that transport, and letting a caller choose columns over REST
   * would mean a response whose shape depends on the request, which binding
   * the body field for field to the entry's result type does not allow.
   */
  shareYieldSnapshots: defineQuery<ShareYieldSnapshot[]>()(
    "shareYieldSnapshots",
    z
      .object({
        poolId: poolIdParam,
        tokenId: tokenIdParam.optional(),
        from: z.iso.datetime().optional(),
        to: z.iso.datetime().optional(),
        limit: limitParam,
        offset: z.number().int().nonnegative().default(0),
      })
      .strict(),
  ),

  /** Whitelist entries; full table when no filter (snapshot-diff base). */
  whitelistedInvestors: defineQuery<WhitelistedInvestor[]>()(
    "whitelistedInvestors",
    z
      .object({ poolId: poolIdParam.optional(), limit: snapshotLimitParam })
      .strict(),
  ),

  /**
   * One page of the merged whitelist × position view of a share class's
   * investors: the entry `GET
   * /pools/:poolId/share-classes/:scId/investors` serves, and the one
   * `holders()` / `whitelistedHolders()` are routed onto.
   *
   * The FULL OUTER JOIN and the `status` filter are the deliverable, not a
   * convenience. `useGetInvestors` assembles the same four views client-side
   * from two observables, and `ShareClass.holders()` then fires one
   * `_whitelistedInvestor` query per row of the page — an N+1 over the network
   * that this entry answers in one statement, with the filter applied BEFORE
   * the page bound so a page of "frozen" is a page of frozen investors rather
   * than whatever survives filtering an arbitrary page.
   *
   * `centrifugeId` narrows to one network. Optional because the client's
   * network chips are multi-select and default to all; a caller that wants a
   * proper subset of more than one filters the (bounded) result, which is what
   * `useGetInvestors` does today.
   *
   * `excludedAddresses` drops protocol-owned accounts from the list, and it is
   * a caller input rather than something derived here on purpose. The SDK's
   * `_tokenInstancePositions` supplies exactly this set — `balanceSheet`,
   * `asyncRequestManager`, `syncManager` and the pool escrow — from the protocol
   * context it already holds, and deriving a second definition of
   * "protocol-owned" from the registry plus `chain_v1.escrow` would let the two
   * disagree about who counts as an investor.
   *
   * It has to be applied HERE and not after the page, which is the whole reason
   * the parameter exists: filtering a returned page would make `total` wrong and
   * hand back short pages. Positions of protocol holders are left out by their
   * `holder_kind` as well; the exclusion still matters for the whitelist side,
   * which carries no kind.
   *
   * `total` is the size of the FILTERED set — see {@link ShareClassInvestorPage}.
   */
  shareClassInvestors: defineQuery<ShareClassInvestorPage>()(
    "shareClassInvestors",
    z
      .object({
        tokenId: tokenIdParam,
        status: investorStatusParam,
        centrifugeId: centrifugeIdParam.optional(),
        excludedAddresses: z.array(addressParam).max(50).default([]),
        limit: limitParam,
        offset: z.number().int().nonnegative().default(0),
      })
      .strict(),
  ),

  /**
   * One investor of one share class on one network, or null.
   *
   * The membership detail behind `GET
   * /pools/:poolId/share-classes/:scId/investors/:address`, and the projection
   * half of the SDK's `ShareClass.member(address, centrifugeId)`.
   *
   * It is only the projection half: `member()` reads
   * `RestrictionManager.isMember(share, user)` over RPC, and a REST read
   * never touches the chain. What `chain_v1` records is the restriction update
   * the indexer OBSERVED, which is the same fact one block later. The SDK
   * keeps the on-chain read where a caller needs the authoritative answer (it
   * is the gate the transfer hook itself applies) and uses this for the
   * list-shaped views, where 200 RPC calls are not an option.
   */
  shareClassInvestor: defineQuery<ShareClassInvestor | null>()(
    "shareClassInvestor",
    z
      .object({
        tokenId: tokenIdParam,
        centrifugeId: centrifugeIdParam,
        accountAddress: addressParam,
      })
      .strict(),
  ),

  /**
   * One investor's projected share-token positions across every share class of
   * one pool.
   *
   * Deliberately NOT named `portfolio`: see {@link InvestorPosition} for what
   * the SDK's `Investor.portfolio()` additionally covers and why this endpoint
   * cannot.
   */
  investorPositions: defineQuery<InvestorPosition[]>()(
    "investorPositions",
    z
      .object({
        poolId: poolIdParam,
        accountAddress: addressParam,
        limit: limitParam,
        offset: z.number().int().nonnegative().default(0),
      })
      .strict(),
  ),

  /**
   * One investor's transaction history in one pool — `Investor.transactions()`
   * / `allTransactions()`.
   *
   * BLOCKED, not stubbed, and for a reason that is not a missing column: the
   * column is there and its CONTENTS are wrong. `chain_v1.investor_transaction`
   * derives `account` and `to_account` from a `bytes32` that the protocol
   * RIGHT-pads (`addressToBytes32` = `padEnd(66, "0")`; the spoke decodes with
   * `CastLib.toAddress`, which is `address(bytes20(addr))` guarded by
   * `require(uint96(uint256(addr)) == 0, PrefixNotZero())`, i.e. the address is
   * the LEADING 20 bytes). The v4 indexer decoded it with the LEFT-padded
   * convention and kept the low 8, so those rows carry
   * `0x` + 16 hex digits + 24 zeros. Measured on the live v4 mainnet indexer,
   * full table: `account` 46 / 410655 rows, `to_account` 92 / 410655 rows;
   * `from_account` 0 / 410655.
   *
   * That is worse for a read than a missing table, which is why it fails loud
   * rather than serving. This entry FILTERS on `account`, so a corrupted row can
   * never match a real address: the affected investors would get a silently
   * SHORT history, and everyone else a correct one — indistinguishable, per
   * investor, from having made no transfers. A `TRANSFER_OUT` whose `to_account`
   * is corrupt would name a counterparty that does not exist.
   *
   * There is deliberately no local repair. The fix belongs to the indexer
   * (Embrio): decoding here would put a second, divergent address convention in
   * the codebase, and re-deriving from logs or over RPC would make a REST read
   * touch the chain. Note that this repo's OWN projection is already
   * correct — the handlers' `normalizeAddress` (now in `centrifuge/api-v4`) takes
   * `slice(0, 42)`, the leading 20 bytes — so unblocking this is a backfill
   * on their side and a one-line change here.
   *
   * The result type is `never` for the same reason `vaultInvestment`'s is:
   * there is no honest shape to freeze while the source is untrustworthy.
   *
   * TODO(indexer-gap): investors.poolInvestorTransactions — unblock when
   * `chain_v1.investor_transaction.account` / `.to_account` are re-derived with
   * the right-padded `bytes32` convention and backfilled (Embrio; no ticket
   * filed yet, tracked as issue #46).
   */
  poolInvestorTransactions: defineQuery<never>()(
    "poolInvestorTransactions",
    z
      .object({
        poolId: poolIdParam,
        accountAddress: addressParam,
        limit: limitParam,
        offset: z.number().int().nonnegative().default(0),
      })
      .strict(),
  ),

  /**
   * Investor transactions strictly after the watermark, ordered by
   * `(createdAtBlock, createdAtTxHash, createdAtLogIndex)`. Rows of protocol
   * holders (`holder_kind = 'PROTOCOL'`) are left out.
   */
  investorTransactions: defineQuery<InvestorTransaction[]>()(
    "investorTransactions",
    z.object({ after: blockWatermarkParam, limit: limitParam }).strict(),
  ),

  /**
   * Token snapshots strictly after the watermark, ordered by
   * `(timestamp, triggerBlockNumber)`.
   */
  tokenSnapshots: defineQuery<TokenSnapshot[]>()(
    "tokenSnapshots",
    z.object({ after: snapshotWatermarkParam, limit: limitParam }).strict(),
  ),

  /**
   * Holding-escrow snapshots strictly after the watermark, ordered by
   * `(timestamp, triggerBlockNumber)`.
   */
  holdingEscrowSnapshots: defineQuery<HoldingEscrowSnapshot[]>()(
    "holdingEscrowSnapshots",
    z.object({ after: snapshotWatermarkParam, limit: limitParam }).strict(),
  ),

  /**
   * Share-token display metadata by token ids (ingestion meta cache).
   *
   * `ids` is `tokenIdParam` rather than any non-empty string, which is what
   * this entry means: every caller passes a share-class id straight from a
   * DTO's bytes16 regex (`list-share-class-holdings`,
   * `list-share-class-vaults`, `list-share-class-token-instances`, and the
   * basin reads). A looser spelling would let `ids: ["oops"]` return an empty
   * list instead of refusing.
   */
  tokensById: defineQuery<TokenMeta[]>()(
    "tokensById",
    z.object({ ids: z.array(tokenIdParam).nonempty() }).strict(),
  ),

  /**
   * The table head of `investorTransactions` (highest watermark tuple), or
   * null when empty. Backs projection-rebuild detection: a stored
   * cursor AHEAD of this head means chain_v1 was rebuilt shorter, so the
   * consumer resets to null and relies on ingest idempotency.
   */
  investorTransactionsHead: defineQuery<BlockWatermark | null>()(
    "investorTransactionsHead",
    z.object({}).strict(),
  ),

  /** The table head of `tokenSnapshots`; null when empty (see above). */
  tokenSnapshotsHead: defineQuery<SnapshotWatermark | null>()(
    "tokenSnapshotsHead",
    z.object({}).strict(),
  ),

  /** The table head of `holdingEscrowSnapshots`; null when empty (see above). */
  holdingEscrowSnapshotsHead: defineQuery<SnapshotWatermark | null>()(
    "holdingEscrowSnapshotsHead",
    z.object({}).strict(),
  ),
} as const;

/** The catalogue's entry map type. */
export type QueryCatalogue = typeof catalogue;

/** All catalogue entry names. */
export type QueryName = keyof QueryCatalogue;

/**
 * The adapter interface every data source implements: one async method per
 * catalogue entry (sql over `chain_v1` here; rest and graphql on the SDK
 * side).
 */
export type Queries = QueriesFor<QueryCatalogue>;
