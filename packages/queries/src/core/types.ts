/**
 * Result types of the query catalogue.
 *
 * Wire-format conventions, shared by every adapter so results compare 1:1
 * across sql / rest / graphql:
 * - big on-chain numerics travel as decimal strings (never JS numbers);
 * - timestamps travel as ISO-8601 strings (UTC);
 * - identifiers keep the `chain_v1` conventions: `poolId` is the uint64
 *   decimal string, `centrifugeId` the decimal-string network id, `tokenId`
 *   the bytes16 hex share-class id.
 *
 * Each shape answers to a frozen SDK result type in `sdk-types.ts`; the doc
 * comment on each type below names the one it is bound to.
 */

/**
 * Where a pool stands in a protocol-version migration window. Every pool read
 * carries it beside `protocolVersion`.
 */
export type MigrationStatus = "live" | "migrating";

/**
 * One pool. Every pool read carries `protocolVersion` and `migrationStatus`.
 * Columns mode reads `protocol_version` (`3.2` or `3.3`) and `status`
 * (`live` or `migrating`). The default source is still the configured fallback.
 */
export interface Pool {
  poolId: string;
  centrifugeId: string;
  name: string | null;
  /** Pool currency asset id (uint128 decimal string). */
  currency: string | null;
  decimals: number | null;
  /** IPFS metadata pointer as stored on-chain. */
  metadata: string | null;
  isActive: boolean;
  protocolVersion: string;
  migrationStatus: MigrationStatus;
  createdAt: string;
}

/**
 * One supported network.
 *
 * Field for field the frozen SDK shape `BlockchainRow` (`sdk-types.ts`), which
 * is what `Centrifuge.blockchains()` consumes — the REST endpoint serving this
 * entry is a plain mapping for the SDK's `rest` adapter.
 *
 * `chainId` and `centrifugeId` travel as decimal strings, matching the rest of
 * the catalogue's identifier convention (the SDK's entity layer does the
 * `Number()`).
 *
 * `explorer` and `icon` are populated by the chain pipeline's reference-row
 * sync in `centrifuge/api-v4` from static maps mirroring api-v3's `explorerUrls` /
 * `chainIcons`. Both are nullable: chains with no explorer or icon (Pharos)
 * stay `null`, matching v3.
 */
export interface Blockchain {
  explorer: string | null;
  chainId: string;
  centrifugeId: string;
  icon: string | null;
  name: string;
  network: string;
}

/**
 * One share class, as `chain_v1.token` projects it.
 *
 * The share-class-level row, as distinct from {@link TokenInstance}, which is
 * one row PER NETWORK. `totalIssuance` here is the whole share class's supply —
 * the figure `shareClassDetails.totalIssuance` shows in the management app and
 * the denominator a total NAV is divided by to get a price per share.
 *
 * `totalIssuance` and `tokenPrice` are money-shaped decimal strings of the
 * on-chain integers: the sql adapter refuses a null rather than substituting
 * `"0"`. Zero itself is a legitimate projected value — a share class with no
 * investors yet — and is served as such; refusing to DIVIDE by it is a
 * separate decision made on the write path, where the alternative would be a
 * zero share price.
 *
 * `priceComputedAt` is when the projected price was struck on the hub, which is
 * what the write path compares a submitted `computedAt` against. Null until a
 * price has been indexed.
 */
export interface ShareClass {
  /** Share-class id (bytes16 hex). */
  id: string;
  poolId: string;
  /** The hub network the share class lives on; null when not projected. */
  centrifugeId: string | null;
  /** Share token decimals; null when the projection has not recorded them. */
  decimals: number | null;
  /** Total issuance across all networks, in the share token's smallest unit. */
  totalIssuance: string;
  /** Pool-per-share price, 18-decimal fixed point, as a decimal string. */
  tokenPrice: string;
  /** ISO-8601 UTC; null when no price has been indexed yet. */
  priceComputedAt: string | null;
}

/**
 * One share-token instance on one network.
 *
 * Field for field the frozen SDK shape `TokenInstanceRow` (`sdk-types.ts`).
 * `totalIssuance` and `tokenPrice` are decimal strings of the on-chain
 * integers; they are money-shaped, so the sql adapter refuses a null rather
 * than substituting `"0"`.
 */
export interface TokenInstance {
  totalIssuance: string;
  tokenPrice: string;
  address: string;
  centrifugeId: string;
}

/**
 * Asset display metadata as the holding-escrow read joins it.
 *
 * Field for field the frozen SDK shape `HoldingEscrowAsset` (`sdk-types.ts`).
 *
 * `assetTokenId` is the ERC-6909 token id of the asset, `null` for a plain
 * ERC-20. It travels as the column's own value, never coerced: the frozen
 * shape declares it non-null but `chain_v1.asset.asset_token_id` is nullable
 * and public-api emits `?? null` for the same column, so `null` here is
 * byte-identical to what public mode returns (read parity). The
 * `null`-means-ERC-20 mapping to the `uint256 tokenId` calldata argument
 * belongs at the write boundary, where the SDK does it, not here.
 */
export interface HoldingEscrowAssetInfo {
  decimals: number;
  assetTokenId: string | null;
  address: string;
  name: string | null;
  symbol: string | null;
  blockchain: { id: string; centrifugeId: string } | null;
}

/**
 * One holding escrow of a share class — the indexer half of
 * `shareClass.balances()`. One row per (chain, asset, escrow address).
 *
 * Field for field the frozen SDK shape `HoldingEscrowRow` (`sdk-types.ts`).
 * The SDK's `balances()` takes each entry's amount from this row and composes
 * it with two on-chain reads (`Holdings.amount/value/valuation/isLiability`
 * and `Spoke.pricePoolPerAsset`), deriving `value = amount x price`
 * entity-side; the REST endpoint serves this entry and nothing else, so no
 * arithmetic and no RPC happen server-side.
 *
 * `assetAmount` and `assetPrice` are decimal strings of the on-chain integers
 * — money-shaped, so the sql adapter refuses a null rather than substituting
 * `"0"`. `asset` and `holding` are `null` when the joined row is absent or
 * stubbed, exactly as public-api emits them; the SDK filters `asset == null`
 * items out of `balances()`.
 */
export interface HoldingEscrow {
  centrifugeId: string;
  holding: { createdAt: string | null } | null;
  assetId: string;
  /**
   * The escrow holding this balance. One share class can hold one asset in
   * more than one escrow on a chain (a legacy and a v3.3 escrow), so this is
   * part of the row's identity.
   */
  escrowAddress: string;
  assetAmount: string;
  assetPrice: string;
  asset: HoldingEscrowAssetInfo | null;
}

/**
 * Asset display metadata as the asset-registration read joins it.
 *
 * Field for field the frozen SDK shape `AssetDetails` (`sdk-types.ts`). Same
 * `assetTokenId` note as {@link HoldingEscrowAssetInfo}.
 */
export interface AssetInfo {
  centrifugeId: string;
  address: string;
  name: string | null;
  symbol: string | null;
  decimals: number;
  assetTokenId: string | null;
}

/**
 * One asset registration on a hub chain, with its asset joined. Backs
 * `centrifuge.assets(spokeCentrifugeId, hubCentrifugeId)`.
 *
 * Field for field the frozen SDK shape `AssetRegistrationRow`
 * (`sdk-types.ts`). The entry is keyed by the HUB chain's `centrifugeId` (that
 * is what `chain_v1.asset_registration` records); the spoke filter is
 * `asset.centrifugeId`, which the SDK applies entity-side.
 */
export interface AssetRegistration {
  assetId: string;
  asset: AssetInfo | null;
}

/**
 * One deployed on/off-ramp manager of a share class on one network.
 *
 * Field for field the frozen SDK shape `OnOffRampManagerRow`
 * (`sdk-types.ts`). Read by the Holdings writes to validate the
 * manager-sourced `depositHolding` / `withdrawHolding` branch against the
 * projection instead of trusting a caller-supplied contract address.
 */
export interface OnOffRampManager {
  address: string;
  /** Block the manager was deployed in; orders redeployments of one share class. */
  createdAtBlock: number;
}

/**
 * One deployed merkle-proof manager of a pool on one network (issue #34).
 *
 * Field for field the frozen SDK shape `MerkleProofManagerRow`
 * (`sdk-types.ts`). Backs `poolNetwork.merkleProofManager()` and the private
 * `_deployedMerkleProofManagerAddress()` the deploy-and-register flow reads.
 *
 * ## Why the route and the entry keep the projection's name
 *
 * `MerkleProofManager` is also a v3.2 contract name, and a REST resource is
 * named protocol-neutrally rather than after a contract. That convention is
 * applied here to the DATA's name rather than the contract's:
 * `chain_v1.merkle_proof_manager`
 * is Embrio's projection table, `merkleProofManagers` is the frozen catalogue
 * entry the SDK binds to, and `MerkleProofManagerRow` is the frozen result
 * type. Inventing a fourth spelling for the HTTP layer alone would leave the
 * wire name disagreeing with the three names it is derived from, which is the
 * drift the rule exists to prevent. If the contract is ever renamed, the
 * projection and the catalogue rename with it and the route follows.
 */
export interface MerkleProofManager {
  address: string;
}

/**
 * The joined asset of a ramp row: its hub asset id, and nothing else.
 *
 * Deliberately NOT {@link AssetInfo}. The frozen SDK shapes
 * `OffRampAddressRow.asset` and `OnRampAssetRow.asset` declare `{ id }` alone,
 * and the response body is bound to the entry's result type field for field —
 * serving the wider `AssetInfo` here would make the REST body differ from what
 * the graphql adapter returns for the same call, which is the one thing
 * neither adapter may do.
 *
 * `null` when no `chain_v1.asset` row matches the ramp row's
 * `(asset_address, centrifuge_id)`. That is reachable — a ramp configured for
 * an asset the hub has not registered — and the SDK's `receivers()` / `assets()`
 * both read `item.asset!.id`, so a null crashes them. Null is still the honest
 * answer: the graphql adapter returns exactly the same null for the same row
 * (`public-api.integration.test.ts` pins "nulls an orphan"), and manufacturing
 * an id here would turn a projection gap into a wrong `AssetId`.
 */
export interface RampAssetRef {
  id: string;
}

/**
 * One off-ramp receiver of a share class on one network (issue #34).
 *
 * Field for field the frozen SDK shape `OffRampAddressRow` (`sdk-types.ts`);
 * backs `onOffRampManager.receivers()`.
 *
 * `isEnabled` is NOT carried, even though `chain_v1.off_ramp_address` has the
 * column and the parity doc selects it. The frozen shape does not declare it
 * and the SDK's `receivers()` does not read it, so adding it would widen the
 * REST body past what public mode returns for the same call. A caller who wants
 * disabled receivers filtered has to say so as a parameter, which no SDK method
 * asks for today.
 */
export interface OffRampAddress {
  assetAddress: string;
  receiverAddress: string;
  asset: RampAssetRef | null;
}

/**
 * One off-ramp relayer of a share class on one network (issue #34).
 *
 * Field for field the frozen SDK shape `OffRampRelayerRow` (`sdk-types.ts`);
 * backs `onOffRampManager.relayers()`. Here `isEnabled` IS part of the frozen
 * shape — the SDK returns the rows verbatim and the caller decides — so it is
 * carried, unlike on {@link OffRampAddress}.
 */
export interface OffRampRelayer {
  address: string;
  isEnabled: boolean;
}

/**
 * One on-ramp asset of a share class on one network (issue #34).
 *
 * Field for field the frozen SDK shape `OnRampAssetRow` (`sdk-types.ts`);
 * backs `onOffRampManager.assets()` and, through it, `balances()` — which pairs
 * each asset with an RPC `balanceOf` on the manager, entity-side. Only the
 * asset half is projected, because a REST read never touches the chain — so
 * the balance half has no endpoint here at all.
 */
export interface OnRampAsset {
  assetAddress: string;
  asset: RampAssetRef | null;
}

/**
 * Which way a Basin swap moved value, as `chain_v1.basin_swap.direction`
 * records it (the `basin_swap_direction` enum).
 *
 * `OTHER` is CARRIED rather than filtered away. The management app hides it
 * (`useBasinSwaps` drops it client-side), but a projected row the read refuses
 * to return is a row nothing can reconcile against, and the app's filter is a
 * display choice that a second consumer need not share. The entry returns what
 * was projected; the screen decides what to show.
 */
export type BasinSwapDirection =
  | "CREDIT_TO_COLLATERAL"
  | "CREDIT_TO_SWAP"
  | "COLLATERAL_TO_CREDIT"
  | "SWAP_TO_CREDIT"
  | "OTHER";

/**
 * One Basin OTC swap, keyed `(chainId, txHash, logIndex)`.
 *
 * `fee` and `feeBps` are nullable because the projection cannot always resolve
 * the fee that applied: it comes from the static catalog joined to `basin_fee`,
 * and a swap projected before the fee row exists carries neither.
 */
export interface BasinSwap {
  direction: BasinSwapDirection;
  assetIn: string;
  assetOut: string;
  amountIn: string;
  amountOut: string;
  fee: string | null;
  feeBps: string | null;
  sender: string;
  receiver: string;
  txHash: string;
  timestamp: string;
}

/**
 * What kind of change moved a Basin's debt, as
 * `chain_v1.basin_debt_change.type` records it.
 *
 * All six values are carried, including `RATE_UPDATE` (pure interest accrual,
 * no user-facing action) and `CREDIT_TOKEN_TRANSFER` (a credit-balance move with
 * no debt effect). The management app's activity table asks for neither, but
 * the ledger only reconciles as a whole: `debtAfter` on a row is only
 * explicable given the rows before it, so a read that dropped the accrual rows
 * would return a running balance that appears to jump. Narrowing is the
 * caller's to do.
 */
export type BasinDebtChangeType =
  | "SWAP_PAYOUT"
  | "SWAP_REPAYMENT"
  | "REDEMPTION"
  | "TRANSFER_REPAYMENT"
  | "RATE_UPDATE"
  | "CREDIT_TOKEN_TRANSFER";

/**
 * One row of a Basin's debt-change ledger, keyed `(chainId, txHash, logIndex)`.
 *
 * `principalDelta` is signed: positive draws down, negative repays.
 * `debtAfter` is the running balance after this row, which is why the entry
 * returns the ledger unfiltered — see {@link BasinDebtChangeType}.
 */
export interface BasinDebtChange {
  type: BasinDebtChangeType;
  interestAccrued: string;
  principalDelta: string;
  debtAfter: string;
  ratePerSecondRay: string;
  txHash: string;
  timestamp: string;
}

/**
 * One Basin's debt position, keyed `(chainId, basinAddress, tokenId)`.
 *
 * `ssrSeeded` is part of the shape rather than an internal flag: while it is
 * false, `ratePerSecondRay` holds a placeholder and interest is NOT accruing,
 * so a consumer that rendered the rate as fact would show a number the
 * projection does not stand behind. Surfacing it is what lets a caller tell
 * "the rate is 0" from "we do not know the rate yet".
 */
export interface BasinDebt {
  chainId: number;
  basinAddress: string;
  tokenId: string;
  poolId: string;
  debt: string;
  ssrPerSecondRay: string;
  ratePerSecondRay: string;
  ssrSeeded: boolean;
  spreadBps: number;
  pendingCreditTokenAmount: string;
  creditTokenBalance: string;
  lastUpdatedAt: string;
  lastUpdatedAtBlock: number;
}

/** One Basin's fee configuration and collected totals. */
export interface BasinFee {
  chainId: number;
  basinAddress: string;
  tokenId: string;
  poolId: string;
  purchaseFeeBps: string;
  redemptionFeeBps: string;
  minFeeBps: string;
  maxFeeBps: string;
  feesCollectedCredit: string;
  feesCollectedCollateral: string;
  feesCollectedSwap: string;
  lastUpdatedAt: string;
  lastUpdatedAtBlock: number;
}

/**
 * The hub redeem order a Basin redeem request is linked to, joined through
 * `basin_redeem_request.linked_redeem_order_index`.
 *
 * Null on a request whose order does not exist yet, and null when the link is
 * AMBIGUOUS — see {@link BasinRedeemRequest.redeemOrderLinkAmbiguous}.
 */
export interface BasinLinkedRedeemOrder {
  index: number;
  approvedAt: string | null;
  revokedAt: string | null;
  claimedAt: string | null;
  revokedSharesAmount: string | null;
  revokedAssetsAmount: string | null;
  /**
   * Revoked price per share in POOL currency.
   *
   * Distinct from {@link revokedWithNavAssetPerShare}, which is the same
   * revocation priced in the asset. Both are carried; they are not
   * interchangeable.
   */
  revokedWithNavPoolPerShare: string | null;
  revokedWithNavAssetPerShare: string | null;
}

/**
 * How far a Basin redeem request has got, as
 * `chain_v1.basin_redeem_request.state` records it.
 *
 * Two values, not three: the projection carries
 * `spoke_redeem_requested_at` timestamper fields but never moves `state` to a
 * spoke-requested value, so the intermediate stage is read off the timestamp,
 * not the enum.
 */
export type BasinRedeemRequestState = "INITIATED" | "COMPLETED";

/**
 * One Basin redeem request, keyed `(basinAddress, requestId)`, with its linked
 * hub redeem order joined.
 *
 * The link is what api-v3 never populated (api-v3#452), which is why the app
 * read the hub order separately and correlated it by timestamp.
 * `linkedRedeemOrderIndex` now carries it.
 */
export interface BasinRedeemRequest {
  basinAddress: string;
  requestId: string;
  centrifugeId: string;
  poolId: string;
  tokenId: string;
  assetId: string;
  redeemer: string;
  state: BasinRedeemRequestState;
  creditTokenAmount: string;
  collateralTokenAmountQuoted: string;
  collateralTokenReturned: string | null;
  initiatedAt: string;
  initiatedAtBlock: number;
  initiatedAtTxHash: string;
  spokeRedeemRequestedAt: string | null;
  completedAt: string | null;
  completedAtTxHash: string | null;
  linkedRedeemOrderIndex: number | null;
  /**
   * True when the projection recorded a `redeemOrderLinkAmbiguous`
   * reconciliation warning for this request's basin: two or more open requests
   * matched one hub approval, and the projection refused to pick.
   *
   * When true, {@link redeemOrder} is null even though
   * {@link linkedRedeemOrderIndex} may be set — a plausible-looking order is
   * worse than none, because the close-modal gate it feeds would enable a
   * button against the wrong order. The flag travels with the row so the
   * caller can say "we cannot tell" rather than silently showing nothing.
   */
  redeemOrderLinkAmbiguous: boolean;
  redeemOrder: BasinLinkedRedeemOrder | null;
}

/**
 * How a vault settles deposits and redemptions, as `chain_v1.vault.kind`
 * records it (the `vault_kind` enum).
 *
 * Kept as the projection's own three values rather than collapsed to the SDK's
 * `isSyncDeposit` boolean. The boolean is a DERIVED view of this
 * (`Sync`/`SyncDepositAsyncRedeem` -> true, `Async` -> false), the SDK derives
 * it from a `supportsInterface` read, and deriving it here as well would mean
 * two definitions of the same fact. The write path's duplicate rule does apply
 * the derivation, once, in one place.
 */
export type VaultKind = "Async" | "Sync" | "SyncDepositAsyncRedeem";

/** Vault link lifecycle, as `chain_v1.vault.status` records it. */
export type VaultStatus =
  "LinkInProgress" | "UnlinkInProgress" | "Linked" | "Unlinked";

/**
 * One projected vault of a share class on one network (issue #40).
 *
 * The indexer half of the SDK's `vault.details()`, and a superset of the
 * frozen SDK catalogue shape `VaultRow` (`sdk-types.ts`, the `allVaults`
 * entry) so routing `allVaults` onto REST is a plain narrowing.
 *
 * What `vault.details()` composes ON TOP of this, and why none of it is served
 * here (reads never touch the chain server-side):
 *
 * - `isLinked` — `VaultRegistry.vaultDetails().isLinked`. {@link status} is the
 *   projection of the same fact; the boolean is derived entity-side.
 * - `isSyncDeposit` — a `supportsInterface` read. {@link kind} projects it.
 * - `asset` / `share` currency details — ERC-20 reads. {@link Vault.asset}
 *   carries the projected asset; the SHARE token's details belong to the
 *   Tokenizations vertical's `tokenInstances` entry, not here.
 * - `maxDeposit` — `maxReserve - BalanceSheet.availableBalanceOf(...)`, and
 *   the subtrahend is not projected in `chain_v1` at all. It is money-shaped
 *   and derived, so it is neither computed nor stubbed here:
 *   it is simply not part of this entry's shape, and the SDK keeps computing it
 *   from `maxReserve` (served here) plus its own balance-sheet read. Serving
 *   `maxReserve` under the name `maxDeposit` would be a silent money bug.
 */
export interface Vault {
  /** The vault contract's address (`chain_v1.vault.id`). */
  address: string;
  centrifugeId: string;
  poolId: string;
  /** Share-class id (a.k.a. share-token id), bytes16 hex. */
  tokenId: string;
  /** Null until the projection has seen the deploy event's kind. */
  kind: VaultKind | null;
  /** Null until the projection has seen a link/unlink transition. */
  status: VaultStatus | null;
  /** Asset id (uint128 decimal string); null when not yet projected. */
  assetId: string | null;
  /**
   * The investment currency's contract address on this network, as the vault
   * row itself records it. Carried alongside `asset.address` because the SDK's
   * `Vault` entity is constructed from THIS column (`VaultRow.assetAddress`),
   * and the two can legitimately disagree while the asset row is a stub.
   */
  assetAddress: string | null;
  /**
   * Max deposit reserve in the ASSET's smallest unit, as a decimal string of
   * the on-chain integer; null for an async vault, which has no reserve.
   * Money-shaped, so the sql adapter refuses a null on any other kind rather
   * than substituting `"0"` — a reserve of zero means "no deposits accepted",
   * which is a real and very different answer. Scale it with `asset.decimals`.
   */
  maxReserve: string | null;
  /** The vault's request manager contract; null when not yet projected. */
  manager: string | null;
  /** The factory the vault was deployed by; null when not yet projected. */
  factory: string | null;
  /** Joined asset display info; null when the asset row is absent or a stub. */
  asset: VaultAssetInfo | null;
}

/**
 * Asset display metadata as the vault read joins it.
 *
 * {@link AssetInfo} plus the asset's `id`, because the frozen SDK shape
 * `VaultRow` reads `asset.id` to build an `AssetId` and would otherwise have
 * nothing to bind to.
 */
export interface VaultAssetInfo extends AssetInfo {
  /** Asset id (uint128 decimal string). */
  id: string;
}

/**
 * Asset display metadata as the order reads join it (issue #50).
 *
 * Structurally the same as {@link VaultAssetInfo} today, and declared
 * separately because it answers to a different frozen shape: `OrderAsset`
 * (`sdk-types.ts`), read as `asset.id` / `asset.decimals` / `asset.symbol` /
 * `asset.name` / `asset.centrifugeId` by the order entries, where
 * `VaultAssetInfo` answers to `VaultRow["asset"]`. Sharing one interface would
 * mean a field added for a vault silently widened an order response, and vice
 * versa.
 */
export interface OrderAssetInfo extends AssetInfo {
  /** Asset id (uint128 decimal string). */
  id: string;
}

/**
 * Share-token display metadata as the order reads join it (issue #50).
 *
 * Covers both frozen shapes the SDK's order entries carry: `OrderToken`
 * (`{ decimals }`, on `epochRedeemOrders` and `epochInvestOrders`) and the
 * `{ decimals, centrifugeId }` that `EpochOutstandingRedeemRow.token` declares.
 *
 * The whole object is `null` when `chain_v1.token` has no usable row, rather
 * than being served with a missing `decimals`: the SDK scales every amount in
 * these reads with `token.decimals` (`new Balance(pendingSharesAmount,
 * item.token.decimals)`), so a defaulted or absent scale is a silent money bug
 * of exactly the kind that is never allowed — the same reason
 * {@link AssetInfo} is nulled whole rather than partially filled.
 */
export interface OrderTokenInfo {
  /** Share-class id (bytes16 hex) — `chain_v1.token.id`. */
  id: string;
  /** Share-token decimals; the scale every amount in these reads carries. */
  decimals: number;
  centrifugeId: string;
}

/**
 * Outstanding (not yet approved) invest amounts for one `(share class, asset)`
 * pair — `chain_v1.epoch_outstanding_invest` (issue #50).
 *
 * The epoch-level totals the deposit write path measures an approval against:
 * `approveDeposits` may not approve more than what is pending
 * (`BatchRequestManager.approveDeposits`, `src/vaults/BatchRequestManager.sol`:
 * `require(approvedAssetAmount <= pendingAssetAmount, InsufficientPending())`),
 * and this row is the projection of that ceiling. Its absence is why
 * `buildApproveDeposits` had no server-side ceiling where `buildApproveRedeems`
 * has one.
 *
 * A superset of the frozen SDK shape `EpochOutstandingInvestRow`
 * (`sdk-types.ts`), which is the `investOrderState.epochOutstandingInvests`
 * collection. Carrying `queuedAssetsAmount` as well is the same deliberate
 * over-serving {@link EpochOutstandingRedeem} does.
 *
 * ## Why there is no `token`, where the redeem row has one
 *
 * The one place the mirror of the redeem family deliberately stops. Both
 * amounts here are ASSET-denominated (`pendingDeposit` is an asset total, and
 * the frozen `EpochOutstandingInvestRow` accordingly declares `asset` and no
 * `token`),
 * whereas {@link EpochOutstandingRedeem}'s amounts are SHARE-denominated and
 * `token.decimals` is their scale. Carrying a share-token `decimals` on a row
 * whose every amount is in asset units would put the wrong scale within reach
 * of a consumer, which is the money bug that refusing to stub anything
 * money-shaped exists to prevent — the same argument that nulls
 * {@link OrderTokenInfo} whole rather than defaulting its `decimals`. Scale
 * both amounts with `asset.decimals`.
 *
 * Both amounts are money-shaped: decimal strings of the on-chain integer, and
 * the sql adapter refuses a null rather than substituting `"0"`.
 */
export interface EpochOutstandingInvest {
  poolId: string;
  /** Share-class id (bytes16 hex). */
  tokenId: string;
  /** Asset id (uint128 decimal string). */
  assetId: string;
  /** Assets requested and not yet approved, in the ASSET's smallest unit. */
  pendingAssetsAmount: string;
  /** Assets queued behind an unclaimed epoch, same unit. */
  queuedAssetsAmount: string;
  createdAtTxHash: string;
  updatedAtTxHash: string;
  /** Joined asset display info; null when the asset row is absent or a stub. */
  asset: OrderAssetInfo | null;
}

/**
 * One invest EPOCH of a share class and asset — `chain_v1.epoch_invest_order`
 * (issue #50).
 *
 * The aggregate, per-epoch half of the invest family: one row per
 * `(tokenId, assetId, index)`, carrying what was approved and what was
 * subsequently issued. It names no investor, which is why this entry serves
 * while {@link catalogue.investOrderState} does not — see the catalogue entries
 * for the corrupted `account` column that blocks the per-investor half.
 *
 * A superset of BOTH frozen SDK shapes over this table: `EpochInvestOrderRow`
 * (the standalone `epochInvestOrders` entry) and `EpochInvestOrderStateRow`
 * (the `investOrderState.epochInvestOrders` collection), exactly as
 * {@link EpochRedeemOrder} covers both of its own.
 *
 * `createdAtTxHash` is carried although neither frozen invest shape reads it
 * (`EpochRedeemOrderStateRow` does read it, so the redeem type has it): one
 * endpoint serves both sides via `?side=invest|redeem`, and a field
 * present on one side and absent on the other would make that response shape
 * depend on the side rather than only its amounts.
 *
 * `approved_pool_amount` and `approved_percentage_of_total_pending` are
 * deliberately NOT carried, mirroring the redeem type's omission of
 * `revoked_pool_amount`: no frozen shape reads them, and the percentage is a
 * projection-internal allocation key (`APPROVAL_SCALE` = 1e21, not a D18) that
 * would be mistaken for a price at the display edge.
 *
 * Every amount is money-shaped: a decimal string of the on-chain integer, and
 * the sql adapter refuses a null rather than substituting `"0"`.
 * `issuedWithNav*PerShare` are 18-decimal fixed-point prices, not amounts,
 * and are refused on the same terms — a price of zero issues shares for
 * nothing.
 */
export interface EpochInvestOrder {
  poolId: string;
  /** Share-class id (bytes16 hex). */
  tokenId: string;
  /** Asset id (uint128 decimal string). */
  assetId: string;
  /** Invest epoch index; `1` is the first approved async epoch. */
  index: number;
  /** ISO-8601 UTC, or null while the epoch is still open. */
  approvedAt: string | null;
  approvedAtTxHash: string | null;
  /** Assets approved in this epoch, in the ASSET's smallest unit. */
  approvedAssetsAmount: string;
  /** ISO-8601 UTC, or null while the epoch is approved but not yet issued. */
  issuedAt: string | null;
  issuedAtTxHash: string | null;
  /** Shares issued for them, in the SHARE token's smallest unit. */
  issuedSharesAmount: string;
  /** Pool-per-share price the issuance settled at, 18-decimal fixed point. */
  issuedWithNavPoolPerShare: string;
  /** Asset-per-share price the issuance settled at, 18-decimal fixed point. */
  issuedWithNavAssetPerShare: string;
  createdAtTxHash: string;
  /** Joined asset display info; null when the asset row is absent or a stub. */
  asset: OrderAssetInfo | null;
  /** Joined share-token display info; null when the token row is unusable. */
  token: OrderTokenInfo | null;
}

/**
 * Outstanding (approved-in-waiting) redeem amounts for one
 * `(share class, asset)` pair — `chain_v1.epoch_outstanding_redeem`
 * (issue #50).
 *
 * The epoch-level totals the redeem write path measures an approval against:
 * `approveRedeems` may not approve more than what is pending
 * (`BatchRequestManager.approveRedeems`: `require(approvedShareAmount <=
 * pendingShareAmount, InsufficientPending())`), and this row is the projection
 * of that ceiling.
 *
 * A superset of the frozen SDK shape `EpochOutstandingRedeemRow`
 * (`sdk-types.ts`), which is the `redeemOrderState.epochOutstandingRedeems`
 * collection. Carrying `queuedSharesAmount` as well is deliberate
 * over-serving, exactly as `GET /pools` over-serves the `pools` entry: the
 * queued total is the other half of the same panel and the column is right
 * there, so fetching it separately would be a second round trip for one
 * number.
 *
 * Both amounts are money-shaped: decimal strings of the on-chain integer,
 * scaled by `token.decimals`, and the sql adapter refuses a null rather than
 * substituting `"0"`.
 */
export interface EpochOutstandingRedeem {
  poolId: string;
  /** Share-class id (bytes16 hex). */
  tokenId: string;
  /** Asset id (uint128 decimal string). */
  assetId: string;
  /** Shares requested and not yet approved, in the share token's smallest unit. */
  pendingSharesAmount: string;
  /** Shares queued behind an unclaimed epoch, same unit. */
  queuedSharesAmount: string;
  createdAtTxHash: string;
  updatedAtTxHash: string;
  /** Joined asset display info; null when the asset row is absent or a stub. */
  asset: OrderAssetInfo | null;
  /** Joined share-token display info; null when the token row is unusable. */
  token: OrderTokenInfo | null;
}

/**
 * One redeem EPOCH of a share class and asset —
 * `chain_v1.epoch_redeem_order` (issue #50).
 *
 * The aggregate, per-epoch half of the redeem family: one row per
 * `(tokenId, assetId, index)`, carrying what was approved and what was
 * subsequently revoked. It names no investor, which is why this entry serves
 * while `redeemOrderState` does not — see the catalogue entries for the
 * corrupted `account` column that blocks the per-investor half.
 *
 * A superset of BOTH frozen SDK shapes over this table: `EpochRedeemOrderRow`
 * (the standalone `epochRedeemOrders` entry) and `EpochRedeemOrderStateRow`
 * (the `redeemOrderState.epochRedeemOrders` collection). The two differ only in
 * which columns they select, so one backend shape covers both and routing the
 * order entries onto REST is a narrowing in each direction.
 *
 * Every amount is money-shaped: a decimal string of the on-chain integer, and
 * the sql adapter refuses a null rather than substituting `"0"`.
 * `revokedWithNav*PerShare` are 18-decimal fixed-point prices, not amounts,
 * and are refused on the same terms — a price of zero revokes shares for
 * nothing.
 */
export interface EpochRedeemOrder {
  poolId: string;
  /** Share-class id (bytes16 hex). */
  tokenId: string;
  /** Asset id (uint128 decimal string). */
  assetId: string;
  /** Redeem epoch index; `1` is the first approved epoch. */
  index: number;
  /** ISO-8601 UTC, or null while the epoch is still open. */
  approvedAt: string | null;
  approvedAtTxHash: string | null;
  /** Shares approved in this epoch, in the share token's smallest unit. */
  approvedSharesAmount: string;
  /** ISO-8601 UTC, or null while the epoch is approved but not yet revoked. */
  revokedAt: string | null;
  revokedAtTxHash: string | null;
  /** Shares revoked (burned) in this epoch, same unit. */
  revokedSharesAmount: string;
  /** Assets paid out for them, in the ASSET's smallest unit. */
  revokedAssetsAmount: string;
  /** Pool-per-share price the revoke settled at, 18-decimal fixed point. */
  revokedWithNavPoolPerShare: string;
  /** Asset-per-share price the revoke settled at, 18-decimal fixed point. */
  revokedWithNavAssetPerShare: string;
  createdAtTxHash: string;
  /** Joined asset display info; null when the asset row is absent or a stub. */
  asset: OrderAssetInfo | null;
  /** Joined share-token display info; null when the token row is unusable. */
  token: OrderTokenInfo | null;
}

/**
 * One deployed address set. The natural key is `(centrifugeId,
 * protocolVersion)` — during a migration window every chain carries one row
 * per protocol version, never one row per chain.
 *
 * `contracts` is keyed by contract name and shape-compatible with
 * `@centrifuge/protocol`'s `AddressSet`; the type is declared structurally
 * here because this package may not import `@centrifuge/protocol`.
 */
export interface Deployment {
  centrifugeId: number;
  chainId: number;
  protocolVersion: string;
  contracts: Readonly<Record<string, string>>;
}

/**
 * In-flight state of a cross-chain balance-sheet manager grant or revoke: the
 * TARGET state signalled on the hub but not yet acknowledged by the spoke.
 * `null` means settled — there is no change in transit.
 *
 * Kept as its own type rather than a bare string so the two values cannot be
 * confused with the live `isBalancesheetManager` flag: an in-transit
 * `"CanManage"` is explicitly NOT yet a manager, and an authorization decision
 * that read it as one would grant balance-sheet authority a spoke has not
 * accepted.
 *
 * The values are the `chain_v1.pool_manager_crosschain_in_progress` Postgres
 * enum verbatim, which is also what the SDK's `ManagerProgress` declares.
 *
 * PostGraphile renames the Postgres label to `CAN_MANAGE` /
 * `CAN_NOT_MANAGE`, so public-api serves a spelling this union does not
 * declare. The graphql adapter normalises it back on the way out
 * (`graphql/public-api.ts` `toManagerProgress`) and throws on a label it does
 * not know, because three of the four sides — the projection, the REST body
 * and the SDK's declared union — already agree on THIS spelling. Passing the
 * screaming-snake form through would be silent, since the SDK casts with
 * `as ManagerProgress` (`entities/Pool.ts`) rather than validating.
 * `poolAdapters.crosschainInProgress` (`Enabled` / `Disabled`) is normalised
 * the same way for the same reason.
 */
export type ManagerCrosschainProgress = "CanManage" | "CanNotManage";

/**
 * One on-chain manager row for a pool (hub / balance-sheet flags).
 *
 * One row per `(centrifugeId, poolId, address)`. A row with BOTH flags false is
 * a real and common projection state — a manager whose grants were all revoked
 * — and is returned as-is rather than filtered: the read endpoint serves the
 * projected rows and consumers filter by the flag they care about, which is
 * what `pool.poolManagers()` (`isHubManager`) and `pool.balanceSheetManagers()`
 * (`isBalancesheetManager`) do entity-side.
 */
export interface PoolManager {
  centrifugeId: string;
  poolId: string;
  address: string;
  isHubManager: boolean;
  isBalancesheetManager: boolean;
  /**
   * A cross-chain balance-sheet grant/revoke triggered on the hub and not yet
   * confirmed on the spoke; `null` once settled.
   *
   * Distinct from `isBalancesheetManager`, which is the CONFIRMED state. The
   * SDK's `balanceSheetManagerStatus()` surfaces both so an operator can see a
   * change in transit, while `isBalanceSheetManager()` — the actual
   * authorization check — reads only the confirmed flag.
   */
  crosschainInProgress: ManagerCrosschainProgress | null;
}

/**
 * In-flight state of a pool-adapter enable/disable: the TARGET state signalled
 * on the hub but not yet acknowledged by the spoke. `null` means settled.
 *
 * The values are the `chain_v1.pool_adapter_crosschain_in_progress` Postgres
 * enum verbatim, and — unlike {@link ManagerCrosschainProgress} — they are
 * ALSO exactly what the SDK's `AdapterProgress` declares
 * (`'Enabled' | 'Disabled' | null`, `entities/Pool.ts`). There is no
 * projection-vs-SDK divergence on this field.
 *
 * PostGraphile renames the label to `ENABLED` / `DISABLED`, so
 * `graphql/public-api.ts` `poolAdapters` normalises it back to this spelling
 * (`toAdapterProgress`) and throws on a label it does not know. Passing the
 * screaming-snake form through would be silent: the SDK casts with
 * `as AdapterProgress` rather than validating, nothing compares against the
 * literal (`Pool.adapterStatus` only passes it through), and all 368 live
 * mainnet rows hold `null` — so a divergence here would
 * surface only once a route actually enabled an adapter.
 */
export type AdapterCrosschainProgress = "Enabled" | "Disabled";

/**
 * One pool-adapter row: an adapter configured for a pool on one
 * `(local -> remote)` network route (issue #42).
 *
 * Field for field the SDK's frozen `PoolAdapterRow` (`sdk-types.ts`), which is
 * what `Pool.adapterStatus(centrifugeId)` maps into `AdapterStatus` —
 * `address` from `adapterAddress`, `name` from `adapter?.name ?? 'unknown'`,
 * and the two state fields straight through. The route's three params
 * (`poolId`, `localCentrifugeId`, `remoteCentrifugeId`) are deliberately NOT
 * repeated in the body: they are the caller's own input, the frozen row does
 * not declare them, and the body is bound to that row field for field.
 *
 * `Pool.adapters(centrifugeId)` is NOT backed by this entry. It is a
 * `MultiAdapter` CONTRACT read, and a REST read never touches the chain, so
 * it has nothing to bind to here — the same call `pool.details()` makes. The
 * two answer
 * different questions on purpose: `adapters()` reports what the hub was told,
 * `adapterStatus()` what the spoke has confirmed.
 */
export interface PoolAdapter {
  /** The adapter contract address as `chain_v1` stores it. */
  adapterAddress: string;
  /** Confirmed live on the route. Never null — the column is `NOT NULL`. */
  isEnabled: boolean;
  /** See {@link AdapterCrosschainProgress}; `null` once settled. */
  crosschainInProgress: AdapterCrosschainProgress | null;
  /**
   * The joined `chain_v1.adapter` row, or `null` when the pool-adapter row has
   * no adapter row on its LOCAL network.
   *
   * Joined on address, local chain, and the pool-adapter update tag, so at most one row
   * can match and the join cannot multiply rows.
   *
   * `name` is null when the generation's deployment did not name that address
   * and no later event filled it in. Joining on the address alone would borrow
   * a name from another chain or another generation.
   */
  adapter: { name: string | null } | null;
}

/**
 * Status of a cross-chain message envelope (`chain_v1.crosschain_payload`).
 *
 * The `chain_v1.crosschain_payload_status` Postgres enum verbatim, which is
 * also exactly what the SDK's `CrosschainMessageStatus` declares. Same parity
 * note as {@link AdapterCrosschainProgress}: PostGraphile spells these
 * `UNDERPAID` / `IN_TRANSIT` / `DELIVERED` / `PARTIALLY_FAILED` / `COMPLETED`
 * (introspected live), so public mode and backend mode disagree on
 * casing — but public mode cannot serve this entry at all today
 * (`capabilities.ts`: `support: "blocked"`), so the divergence has no live
 * reader.
 */
export type CrosschainPayloadStatus =
  "Underpaid" | "InTransit" | "Delivered" | "PartiallyFailed" | "Completed";

/**
 * Status of ONE inner message inside a payload
 * (`chain_v1.crosschain_message_status`). Same casing note as
 * {@link CrosschainPayloadStatus} (`AWAITING_BATCH_DELIVERY` on PostGraphile).
 */
export type CrosschainMessageStatus =
  "Unsent" | "AwaitingBatchDelivery" | "Failed" | "Executed" | "Cleared";

/** Which nested sub-trees a crosschain read should join in. */
export interface CrosschainIncludes {
  pool?: boolean;
  token?: boolean;
  blockchains?: boolean;
  innerMessages?: boolean;
  adapterParticipations?: boolean;
}

/** A network reference on a crosschain payload (`include.blockchains`). */
export interface CrosschainBlockchainRef {
  id: string;
  centrifugeId: string;
  network: string;
}

/** One inner message of a payload (`include.innerMessages`). */
export interface CrosschainInnerMessage {
  id: string;
  index: number;
  poolId: string | null;
  tokenId: string | null;
  payloadId: string | null;
  payloadIndex: number | null;
  fromCentrifugeId: string;
  toCentrifugeId: string;
  messageType: string;
  status: CrosschainMessageStatus;
  /** `NOT NULL` in `chain_v1`; the SDK's own type widens it, this does not. */
  rawData: string;
  /** Decoded message body as the projection stored it (`jsonb`). */
  data: unknown;
  failReason: string | null;
  /** ISO-8601 UTC. */
  createdAt: string;
  /** ISO-8601 UTC; null while unexecuted. */
  executedAt: string | null;
  executedAtTxHash: string | null;
}

/** One adapter's participation in a payload (`include.adapterParticipations`). */
export interface CrosschainAdapterParticipation {
  centrifugeId: string;
  fromCentrifugeId: string;
  toCentrifugeId: string;
  type: "PAYLOAD" | "PROOF";
  side: "SEND" | "HANDLE";
  /** Gas paid, decimal string of the on-chain integer; null when unrecorded. */
  gasPaid: string | null;
  /** ISO-8601 UTC. */
  timestamp: string;
  transactionHash: string;
  /**
   * The joined `chain_v1.adapter` row, on address, chain, and the participation
   * update tag. Same reference-catalogue coverage note as
   * {@link PoolAdapter.adapter}.
   */
  adapter: {
    address: string;
    name: string | null;
    centrifugeId: string;
  } | null;
}

/**
 * One cross-chain message envelope: a `chain_v1.crosschain_payload` row with
 * the caller-chosen joins (issue #42).
 *
 * ## Why the nesting looks like this
 *
 * The two collection joins are served as `{ items: [...] }` under the keys
 * `crosschainMessages` and `adapterParticipations`, which reads oddly for a
 * fresh REST body. It is deliberate: the body is bound to the shape the SDK
 * entity consumes field for field so the `rest` adapter stays a plain mapping,
 * and `packages/sdk/src/entities/crosschainMessages.ts` (`CrosschainPayloadRaw`
 * / `toMessage`) reads exactly these keys at exactly this depth. Renaming
 * `crosschainMessages` to `innerMessages` or flattening `{ items }` would move
 * structural work into the adapter, which the binding forbids.
 *
 * A key is ABSENT (not null) when its `include` flag is unset, which is what
 * `toMessage` reads as `undefined`.
 *
 * ## Timestamps are ISO-8601, not epoch millis
 *
 * Per this file's wire convention and every other catalogue entry. api-v3
 * serves the same six fields as epoch MILLISECONDS in a decimal string
 * (`'1773411360000'` in `Centrifuge.test.ts`), so a consumer of both
 * transports needs `new Date(raw.createdAt)` here and cannot reuse
 * `new Date(Number(raw.createdAt))`. Serving epoch-millis here instead would
 * give one entry a second timestamp convention forever. A consumer that gets
 * it wrong fails visibly rather than quietly: `Number(iso)` is `NaN`, which
 * renders as `Invalid Date` instead of a plausible wrong one, and the mapping
 * is pinned by a test on this side.
 */
export interface CrosschainPayload {
  /** Payload id (bytes32 hex). Unique only together with {@link index}. */
  id: string;
  index: number;
  poolId: string | null;
  tokenId: string | null;
  fromCentrifugeId: string;
  toCentrifugeId: string;
  status: CrosschainPayloadStatus;
  /** `NOT NULL` in `chain_v1`; the SDK's own type widens it, this does not. */
  rawData: string;
  /** Decimal string of the on-chain integer. */
  gasLimit: string | null;
  /** Decimal string of the on-chain integer. */
  gasPrice: string | null;
  /** ISO-8601 UTC. */
  createdAt: string;
  /** ISO-8601 UTC; null while undelivered. */
  deliveredAt: string | null;
  /** ISO-8601 UTC; null while incomplete. */
  completedAt: string | null;
  /** `NOT NULL` in `chain_v1` — a payload always has a source transaction. */
  createdAtTxHash: string;
  /** Null until the payload is delivered (172 of 8500 on mainnet). */
  deliveredAtTxHash: string | null;
  pool?: { id: string; name: string | null } | null;
  token?: { name: string | null; symbol: string | null } | null;
  fromBlockchain?: CrosschainBlockchainRef | null;
  toBlockchain?: CrosschainBlockchainRef | null;
  /** Inner messages. Ponder's relation name, kept — see the type docblock. */
  crosschainMessages?: { items: CrosschainInnerMessage[] };
  adapterParticipations?: { items: CrosschainAdapterParticipation[] };
}

/**
 * Relay-style page cursors over the crosschain payload list.
 *
 * The cursor is an opaque base64url encoding of the total sort key
 * `(created_at, id, index)`; see `sql/sql-queries.ts` for the codec. Opaque
 * because it is a keyset position, not a row identity: a caller who took it
 * apart would build a query the endpoint does not promise to keep answering.
 */
export interface CrosschainPageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor: string | null;
  endCursor: string | null;
}

/**
 * A page of cross-chain payloads, shaped as `queryCrosschainMessages`
 * consumes it (`{ items, totalCount, pageInfo }`).
 *
 * `totalCount` counts every row matching the FILTER, not the page — the same
 * meaning api-v3 gave it, and what a "1 of 84" pager needs.
 */
export interface CrosschainPayloadPage {
  items: CrosschainPayload[];
  totalCount: number;
  pageInfo: CrosschainPageInfo;
}

/** One whitelist entry of a share class, with its identity columns. */
export interface WhitelistedInvestor {
  centrifugeId: string;
  poolId: string;
  tokenId: string;
  accountAddress: string;
  isFrozen: boolean;
  /** ISO timestamp; null means no expiry recorded. */
  validUntil: string | null;
}

/**
 * The four investor views the Investors vertical filters by.
 *
 * Named after what the client's tabs mean, not after a column: `holder` is a
 * projected POSITION with a non-zero balance, which is a different question
 * from `whitelisted` (a live restriction-hook membership) and from `frozen`
 * (the resolved frozen flag). `all` is the union of the two source tables and
 * is therefore a superset of the other three — the property `useGetInvestors`
 * had to be fixed to preserve client-side.
 */
export type ShareClassInvestorStatus =
  "all" | "whitelisted" | "frozen" | "holder";

/**
 * One investor of one share class on one network: the merged whitelist ×
 * position row.
 *
 * ONE row per `(tokenId, centrifugeId, accountAddress)` — the shared primary
 * key of `chain_v1.whitelisted_investor` and `chain_v1.token_instance_position`
 * — produced by a FULL OUTER JOIN, so an address present in only one of the two
 * tables is still a row. That join is the point of the endpoint: the SDK's
 * `ShareClass.holders()` issues one `_whitelistedInvestor` query PER position in
 * the page, and `whitelistedHolders()` one `_tokenInstancePosition` per
 * whitelist entry.
 *
 * The row is a SUPERSET of the two frozen SDK row types it merges
 * (`WhitelistedInvestorRow`, `TokenInstancePositionRow` in `sdk-types.ts`), so
 * either one can be projected out of it with no arithmetic:
 *
 * | SDK field                              | here                |
 * | -------------------------------------- | ------------------- |
 * | `WhitelistedInvestorRow.accountAddress` | `accountAddress`    |
 * | `WhitelistedInvestorRow.createdAt`      | `whitelistedAt`     |
 * | `WhitelistedInvestorRow.validUntil`     | `validUntil`        |
 * | `TokenInstancePositionRow.balance`      | `balance`           |
 * | `TokenInstancePositionRow.createdAt`    | `positionCreatedAt` |
 * | `TokenInstancePositionRow.updatedAt`    | `positionUpdatedAt` |
 *
 * The two `createdAt`s are renamed because they are different events — when the
 * address was whitelisted, and when it first held a share — and a merged row
 * cannot carry both under one name. `holders()` currently reads the whitelist
 * one and substitutes `''` when there is no whitelist row; `null` here says the
 * same thing without pretending it is a timestamp.
 */
export interface ShareClassInvestor {
  /** Share-class (share-token) id, bytes16 hex, lowercase. */
  tokenId: string;
  /** The network this row is about, as a decimal string. */
  centrifugeId: string;
  /** The investor's address, lowercase — `chain_v1` stores it lowercased. */
  accountAddress: string;
  /**
   * A whitelist row exists AND its `valid_until` is in the future, evaluated
   * in Postgres against `now()`.
   *
   * Computed server-side because the status filter needs it in the WHERE
   * clause, and served alongside `validUntil` so a consumer can still see the
   * instant the decision rests on. The SDK computes the same predicate as
   * `parseInt(validUntil, 10) > Date.now()`, which compares api-v3's
   * SECONDS-since-epoch string against MILLISECONDS — a consumer must read
   * this boolean rather than port that comparison to an ISO string, where
   * `parseInt` yields the year.
   */
  isWhitelisted: boolean;
  /**
   * The whitelist row's `is_frozen` when there is one, otherwise the
   * position's.
   *
   * The SDK's own precedence (`whitelistData?.isFrozen ?? position.isFrozen` in
   * `ShareClass.holders()`), reproduced rather than re-invented. The two columns
   * are written by different projections and can disagree; the whitelist row is
   * the restriction hook's own record, so it wins.
   */
  isFrozen: boolean;
  /** A position row exists and its balance is greater than zero. */
  isHolder: boolean;
  /** Whitelist expiry, ISO-8601 UTC; null when there is no whitelist row. */
  validUntil: string | null;
  /** When the whitelist row was projected, ISO-8601; null without one. */
  whitelistedAt: string | null;
  /**
   * Share-token balance in the token's smallest unit, as a decimal string;
   * null when there is no position row.
   *
   * Money-shaped, so it travels as the on-chain integer with {@link decimals}
   * beside it, and a projected null is passed through rather than defaulted
   * to `"0"` — `"0"` would report a holder who sold out where the projection
   * simply has no row.
   */
  balance: string | null;
  /** Share-token decimals for {@link balance}; null when not projected. */
  decimals: number | null;
  /** When the position row was first projected, ISO-8601; null without one. */
  positionCreatedAt: string | null;
  /** When the position row last changed, ISO-8601; null without one. */
  positionUpdatedAt: string | null;
}

/**
 * One page of {@link ShareClassInvestor} rows plus the size of the filtered
 * set.
 *
 * `total` counts the rows the SAME `status` filter matches, not the table: the
 * client's tabs show "Whitelisted (12)" beside "All (30)", and a count that
 * ignored the filter would label every tab with the same number. It is worth
 * the second query here — unlike on the NAV series, where nothing reads
 * it — because a share class has hundreds of investors, not hundreds of
 * thousands, and the count is the figure on screen.
 */
export interface ShareClassInvestorPage {
  items: ShareClassInvestor[];
  total: number;
}

/**
 * One projected share-token position of one investor, with the share class it
 * belongs to.
 *
 * The pool-wide pivot of {@link ShareClassInvestor}: same table, keyed by
 * address instead of by share class, so an investor-detail page is one read
 * rather than one per share class.
 *
 * NOT `Investor.portfolio()`, and the difference is deliberate. The SDK's
 * portfolio pairs a global address catalogue (`investorPortfolioSources`) with
 * an on-chain `balanceOf` per entry and includes the investor's ASSET balances
 * (the USDC they hold, not only the shares). `chain_v1` projects neither the
 * asset balances nor anything the backend may read over RPC, so this
 * serves the half the projection actually knows and says so in its name.
 */
export interface InvestorPosition {
  /** Share-class (share-token) id, bytes16 hex, lowercase. */
  tokenId: string;
  /** The network the position is held on, as a decimal string. */
  centrifugeId: string;
  /** The investor's address, lowercase. */
  accountAddress: string;
  /**
   * Balance in the share token's smallest unit, as a decimal string.
   *
   * Money-shaped: a projected null is refused rather than defaulted — see
   * {@link ShareClassInvestor.balance}.
   */
  balance: string;
  /** Share-token decimals for {@link balance}; null when not projected. */
  decimals: number | null;
  /** The position's own frozen flag (`token_instance_position.is_frozen`). */
  isFrozen: boolean;
  /** When the position last changed, ISO-8601. */
  updatedAt: string;
}

/** One investor transaction (ledger row backing ingestion + statements). */
export interface InvestorTransaction {
  poolId: string;
  centrifugeId: string;
  type: string;
  account: string;
  tokenId: string;
  epochIndex: number | null;
  tokenAmount: string | null;
  currencyAmount: string | null;
  tokenPrice: string | null;
  transactionFee: string | null;
  fromAccount: string | null;
  toAccount: string | null;
  fromCentrifugeId: string | null;
  toCentrifugeId: string | null;
  createdAt: string;
  createdAtBlock: number;
  createdAtTxHash: string;
  createdAtLogIndex: number;
  /** Joined currency-asset display info; null when the asset is unknown. */
  currencyAsset: { decimals: number; symbol: string | null } | null;
  /** Joined share-token display info; null when the token is unknown. */
  token: { decimals: number | null } | null;
}

/** One share-token snapshot row (price + trigger provenance). */
export interface TokenSnapshot {
  /** Token id (bytes16) — the pool id lives in its first 8 bytes. */
  id: string;
  timestamp: string;
  trigger: string;
  triggerBlockNumber: number;
  triggerTxHash: string | null;
  tokenPrice: string | null;
  tokenPriceComputedAt: string | null;
}

/**
 * One PER-NETWORK share-price snapshot row (issue #44).
 *
 * Field for field the row shape `pool.reports.sharePrices()` consumes — the
 * `sharePricesReport` entry of the SDK catalogue, whose api-v3 document selects
 * exactly `tokenId, timestamp, totalIssuance, tokenPrice, triggerChainId` from
 * `tokenInstanceSnapshots`. Nothing is added and nothing is aggregated here.
 *
 * ## Why the rows are raw and not the report
 *
 * `PoolSharePricesReport._process` is not a formatter: it dedupes to one row
 * per `(date, tokenId, chain)` keeping the largest issuance, SUMS issuance
 * across networks for the daily total, picks the price from the chain with the
 * largest issuance, and only then applies `groupBy`. That is money arithmetic
 * over a multi-network series — verified live on mainnet, where one share class
 * carries rows for centrifugeIds 1, 2, 3, 5, 6 and 11 on the same day and a
 * different subset of them on the next.
 *
 * Serving the aggregated report would give `totalIssuance` two definitions, one
 * here and one in the entity, and public mode (which computes it entity-side
 * from the same raw rows) would be free to disagree with backend mode. So the
 * REST endpoint serves this entry and the entity keeps doing the arithmetic —
 * which is also what makes the SDK's `rest` adapter a plain mapping.
 *
 * ## Timestamp format
 *
 * ISO-8601 UTC, per this file's convention and per what public-api returns for
 * the same column. It deliberately does NOT match api-v3's millisecond-epoch
 * decimal string. Both spellings reach the SDK's `snapshotDay`
 * (`entities/Reports/utils.ts`), which accepts either; a consumer that parses
 * only the epoch form gets `NaN` from an ISO string and so fails loudly
 * rather than producing a wrong date. Serving the epoch form here instead
 * would break read parity the day public-api serves this entry, because
 * PostGraphile returns the same ISO string this adapter does.
 *
 * `totalIssuance` and `tokenPrice` are decimal strings of the on-chain
 * integers, and money-shaped: the sql adapter refuses a null rather than
 * substituting `"0"`.
 */
export interface SharePriceSnapshot {
  /** Share-class id (bytes16 hex). */
  tokenId: string;
  /** Snapshot period boundary, ISO-8601 UTC. */
  timestamp: string;
  /** Issuance ON THIS NETWORK, in the share token's smallest unit. */
  totalIssuance: string;
  /** Pool-per-share price, 18-decimal fixed point, as a decimal string. */
  tokenPrice: string;
  /** EVM chain id the snapshot was triggered on (`chain_v1.trigger_chain_id`). */
  triggerChainId: string;
}

/**
 * The trailing-window return figures `chain_v1.token_snapshot` carries
 * (issue #44).
 *
 * Every field is a Ray (1e27 fixed point) decimal string, or `null`. Null is
 * the honest value, not a stub: a share class younger than the window has no
 * figure for it (`yieldTtm` and `yieldYtd` are null on live mainnet rows today),
 * and the SDK's `rayPercent` maps null to `undefined` so the field is simply
 * absent from the report. That is not the money-shaped stub the adapter
 * refuses — a yield is a reported derivative of the price series, not an
 * amount anyone transacts on, and unlike a balance its absence is
 * distinguishable from zero because the wire carries `null` rather than
 * `"0"`.
 *
 * Field names are the projection's own (`yield30dComp360`, `yieldTtm`, …),
 * which is also what the frozen SDK `ShareYields` shape declares, so the `rest`
 * adapter maps names only.
 */
export interface ShareYields {
  yield1d: string | null;
  yield1d360: string | null;
  yield1d365: string | null;
  yield7d: string | null;
  yield7d360: string | null;
  yield7d365: string | null;
  yield15d: string | null;
  yield15d360: string | null;
  yield15d365: string | null;
  yield30d: string | null;
  yield30d360: string | null;
  yield30d365: string | null;
  yield90d: string | null;
  yield90d360: string | null;
  yield90d365: string | null;
  yield180d: string | null;
  yield180d360: string | null;
  yield180d365: string | null;
  yield30dComp360: string | null;
  yield30dComp365: string | null;
  yieldTtm: string | null;
  yieldSinceInception: string | null;
  yieldYtd: string | null;
}

/**
 * One SHARE-CLASS-level yield snapshot row (issue #44).
 *
 * Field for field the row shape `pool.reports.shareYields()` consumes — `id`
 * plus `timestamp` plus the yield columns, which is exactly what the SDK's
 * `buildShareYieldsDocument` selects.
 *
 * A different table from {@link SharePriceSnapshot}, and deliberately so:
 * yields live on the share-class-level `token_snapshot`, not the per-network
 * `token_instance_snapshot`, and they are written on price-update events
 * (`shareClassManager:UpdatePricePoolPerShare:*`) as well as on the daily
 * boundary. Verified live: 5938 of 9986 mainnet `token_snapshot` rows are daily
 * boundaries and the remaining 4048 are price updates, while all 14523
 * `token_instance_snapshot` rows are daily boundaries.
 *
 * Rows are returned newest-first, which the SDK's `_process` depends on: it
 * keeps the FIRST row it sees for a `(date, id)` pair as that day's figure.
 *
 * Same ISO-8601 timestamp note as {@link SharePriceSnapshot}.
 */
export interface ShareYieldSnapshot extends ShareYields {
  /** Share-class id (bytes16 hex) — the SDK's `YieldRow.id`. */
  id: string;
  /** Snapshot timestamp, ISO-8601 UTC. */
  timestamp: string;
}

/** One holding-escrow snapshot row (asset price + trigger provenance). */
export interface HoldingEscrowSnapshot {
  tokenId: string;
  assetId: string;
  escrowAddress: string;
  timestamp: string;
  trigger: string;
  triggerBlockNumber: number;
  triggerTxHash: string | null;
  assetPrice: string | null;
}

/**
 * The highest `(createdAtBlock, createdAtTxHash, createdAtLogIndex)` tuple of
 * a ledger table — the ingestion watermark head. Null when the table is
 * empty. Consumers compare their stored cursor against this to detect a
 * projection rebuild (cursor ahead of head -> reset).
 */
export interface BlockWatermark {
  blockNumber: number;
  txHash: string;
  logIndex: number;
}

/**
 * The highest `(timestamp, triggerBlockNumber, trigger, rowKey)` tuple of a
 * snapshot table.
 *
 * All four components are load-bearing, because the first two are NOT unique:
 * both snapshot tables key on `(<identity...>, timestamp, trigger_block_number,
 * trigger)`, and a daily NewPeriod run writes one row per identity sharing an
 * identical timestamp and block. A cursor over `(timestamp, triggerBlockNumber)`
 * alone therefore cannot address a position *inside* such a group, so a page
 * boundary falling within one would silently skip its remaining rows.
 *
 * `rowKey` is the table's identity columns rendered as a single string, so the
 * one watermark shape spans tables whose identity differs — `id` for
 * `token_snapshot`, `(tokenId, assetId, escrowAddress)` for
 * `holding_escrow_snapshot`. It is
 * compared lexicographically, and the SQL adapter orders by the same expression
 * it is built from, so the cursor order and the scan order agree by
 * construction.
 */
export interface SnapshotWatermark {
  timestamp: string;
  triggerBlockNumber: number;
  trigger: string;
  rowKey: string;
}

/** Share-token display metadata (ingestion token-meta cache). */
export interface TokenMeta {
  id: string;
  poolId: string;
  centrifugeId: string | null;
  symbol: string | null;
}
