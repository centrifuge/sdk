/**
 * Result types of the SDK-facing catalogue.
 *
 * These are the **adapter contract**: every adapter (graphql over public-api,
 * the legacy graphql documents over api-v3, and later `rest`) must return
 * exactly these shapes for a given entry, which is what makes cross-adapter
 * parity testable field for field.
 *
 * The shapes are deliberately the wire shapes the SDK entities already
 * consume, so moving the queries out of `packages/sdk` cannot change a single
 * entity's public output. Where api-v3 delivered a value through a nested
 * relation (`asset { … }`) the field stays in the contract and the public-api
 * adapter reconstructs it with a client-side join.
 *
 * Conventions: big on-chain numerics are strings, timestamps are ISO-8601
 * strings, `poolId` is a uint64 decimal string, `tokenId`/`scId` is the
 * bytes16 hex share-class id, `centrifugeId` is a decimal string.
 */

export type Hex = `0x${string}`;

/** One supported network, as `Centrifuge.blockchains()` consumes it. */
export interface BlockchainRow {
  explorer: string | null;
  chainId: string;
  centrifugeId: string;
  icon: string | null;
  name: string;
  network: string;
}

/** Where a pool stands in a protocol-version migration window. */
export type PoolMigrationStatus = "live" | "migrating";

/**
 * A pool row. The SDK builds `Pool` entities from `id`, and resolves the
 * address and ABI set a write is built against from `protocolVersion`.
 * Both version fields are `null` on a transport that does not project them
 * (api-v3), and the SDK refuses to build against such a pool.
 */
export interface PoolRow {
  id: string;
  protocolVersion: string | null;
  migrationStatus: PoolMigrationStatus | null;
}

/** One deployed address set, keyed by chain and protocol version. */
export interface DeploymentRow {
  centrifugeId: string;
  chainId: string;
  protocolVersion: string | null;
}

/** Asset display metadata, as reached through `assetRegistrations.asset`. */
export interface AssetDetails {
  centrifugeId: string;
  address: Hex;
  name: string;
  symbol: string;
  decimals: number;
  assetTokenId: string | null;
}

/** One asset registration with its (joined) asset. */
export interface AssetRegistrationRow {
  assetId: string;
  asset: AssetDetails | null;
}

/** One share-token instance on a network. */
export interface TokenInstanceRow {
  totalIssuance: string;
  tokenPrice: string;
  address: Hex;
  centrifugeId: string;
}

/** Asset display fields joined onto order rows. */
export interface OrderAsset {
  id?: string;
  decimals: number;
  symbol: string;
  name: string;
  centrifugeId: string;
}

/** Share-token display fields joined onto order rows. */
export interface OrderToken {
  decimals: number;
}

/** One closed (issued) epoch of invest orders. */
export interface EpochInvestOrderRow {
  assetId: string;
  index: number;
  issuedAt: string | null;
  issuedAtTxHash: string | null;
  approvedAt: string | null;
  approvedAtTxHash: string | null;
  issuedSharesAmount: string | null;
  approvedAssetsAmount: string | null;
  issuedWithNavPoolPerShare: string | null;
  issuedWithNavAssetPerShare: string | null;
  asset: OrderAsset | null;
  token: OrderToken | null;
}

/** One investor's invest order within a closed epoch. */
export interface InvestOrderRow {
  account: Hex;
  index: number;
  assetId: string;
  approvedAssetsAmount: string | null;
  approvedAt: string | null;
  approvedAtTxHash: string | null;
  issuedSharesAmount: string | null;
  issuedAt: string | null;
  issuedAtTxHash: string | null;
  issuedWithNavAssetPerShare: string | null;
  issuedWithNavPoolPerShare: string | null;
  claimedAt: string | null;
  claimedAtBlock: number | null;
  createdAtTxHash: string | null;
  asset: OrderAsset | null;
  token: OrderToken | null;
}

/** One closed (revoked) epoch of redeem orders. */
export interface EpochRedeemOrderRow {
  assetId: string;
  index: number;
  revokedAt: string | null;
  approvedAt: string | null;
  approvedSharesAmount: string | null;
  revokedSharesAmount: string | null;
  revokedAssetsAmount: string | null;
  revokedWithNavPoolPerShare: string | null;
  revokedWithNavAssetPerShare: string | null;
  asset: OrderAsset | null;
  token: OrderToken | null;
}

/** One investor's redeem order within a closed epoch. */
export interface RedeemOrderRow {
  account: Hex;
  index: number;
  assetId: string;
  approvedSharesAmount: string | null;
  approvedAt: string | null;
  revokedAssetsAmount: string | null;
  revokedAt: string | null;
  revokedWithNavAssetPerShare: string | null;
  revokedWithNavPoolPerShare: string | null;
  claimedAt: string | null;
  claimedAtBlock: number | null;
  asset: OrderAsset | null;
  token: OrderToken | null;
}

/** Asset metadata as reached through `holdingEscrows.asset`. */
export interface HoldingEscrowAsset {
  decimals: number;
  assetTokenId: string;
  address: Hex;
  name: string;
  symbol: string;
  blockchain: { id: string; centrifugeId: string };
}

/** One holding escrow of a share class. */
export interface HoldingEscrowRow {
  centrifugeId: string;
  holding: { createdAt: string | null };
  assetId: string;
  escrowAddress: Hex;
  assetAmount: string;
  assetPrice: string;
  asset: HoldingEscrowAsset;
}

/** Outstanding (not yet approved) invest amounts per asset. */
export interface EpochOutstandingInvestRow {
  assetId: string;
  poolId: string;
  tokenId: string;
  pendingAssetsAmount: string;
  createdAtTxHash?: string | null;
  updatedAtTxHash?: string | null;
  asset: { decimals: number; centrifugeId: string };
}

/** Per-investor queued/pending invest amounts. */
export interface PendingInvestOrderRow {
  account: Hex;
  assetId: string;
  tokenId: string;
  queuedAssetsAmount: string;
  pendingAssetsAmount: string;
}

/** Open (not yet issued) invest orders. */
export interface OpenInvestOrderRow {
  account: Hex;
  assetId: string;
  tokenId: string;
  index: number;
  approvedAt: string | null;
  approvedAtTxHash?: string | null;
  approvedAssetsAmount: string;
  issuedAt: string | null;
  issuedSharesAmount: string;
  claimedAt: string | null;
  claimedSharesAmount: string;
  createdAtTxHash?: string | null;
  asset: { decimals: number; centrifugeId: string };
}

/** Epoch-level invest order state used by the orders view. */
export interface EpochInvestOrderStateRow {
  poolId: string;
  tokenId: string;
  assetId: string;
  index: number;
  approvedAt: string | null;
  approvedAtTxHash?: string | null;
  approvedAssetsAmount: string;
  issuedAt: string | null;
  issuedAtTxHash?: string | null;
  issuedSharesAmount: string;
  token: OrderToken;
  asset: { decimals: number; centrifugeId: string };
}

/** The four collections backing `ShareClass._investOrders()`. */
export interface InvestOrderState {
  epochOutstandingInvests: EpochOutstandingInvestRow[];
  epochInvestOrders: EpochInvestOrderStateRow[];
  pendingInvestOrders: PendingInvestOrderRow[];
  investOrders: OpenInvestOrderRow[];
}

/** Outstanding (not yet approved) redeem amounts per asset. */
export interface EpochOutstandingRedeemRow {
  assetId: string;
  poolId: string;
  tokenId: string;
  pendingSharesAmount: string;
  createdAtTxHash?: string | null;
  updatedAtTxHash?: string | null;
  asset: { decimals: number; centrifugeId: string };
  token: { decimals: number; centrifugeId: string };
}

/** Per-investor queued/pending redeem amounts. */
export interface PendingRedeemOrderRow {
  account: Hex;
  assetId: string;
  tokenId: string;
  queuedSharesAmount: string;
  pendingSharesAmount: string;
  createdAtTxHash?: string | null;
  updatedAtTxHash?: string | null;
}

/** Open (not yet revoked) redeem orders. */
export interface OpenRedeemOrderRow {
  account: Hex;
  assetId: string;
  tokenId: string;
  index: number;
  approvedAt: string | null;
  approvedSharesAmount: string;
  revokedAt: string | null;
  revokedSharesAmount: string;
  revokedAssetsAmount: string;
  claimedAt: string | null;
  claimedAssetsAmount: string;
  asset: { decimals: number; centrifugeId: string };
  token: OrderToken;
}

/** Epoch-level redeem order state used by the orders view. */
export interface EpochRedeemOrderStateRow {
  poolId: string;
  tokenId: string;
  assetId: string;
  index: number;
  approvedAt: string | null;
  approvedAtTxHash?: string | null;
  approvedSharesAmount: string;
  revokedAt: string | null;
  revokedAtTxHash?: string | null;
  revokedSharesAmount: string;
  revokedAssetsAmount: string;
  createdAtTxHash?: string | null;
  token: OrderToken;
  asset: { decimals: number; centrifugeId: string };
}

/** The four collections backing `ShareClass._redeemOrders()`. */
export interface RedeemOrderState {
  epochOutstandingRedeems: EpochOutstandingRedeemRow[];
  epochRedeemOrders: EpochRedeemOrderStateRow[];
  pendingRedeemOrders: PendingRedeemOrderRow[];
  redeemOrders: OpenRedeemOrderRow[];
}

/** One vault of a share class, as `ShareClass._allVaults()` consumes it. */
export interface VaultRow {
  address: Hex;
  poolId: string;
  assetAddress: Hex;
  status: string;
  asset: { id: string };
  centrifugeId: string;
}

/** One whitelist entry of a share class. */
export interface WhitelistedInvestorRow {
  accountAddress: Hex;
  centrifugeId: string;
  createdAt: string;
  isFrozen: boolean;
  validUntil: string;
  /**
   * Whether the membership is live: a whitelist row exists AND its
   * {@link validUntil} is in the future.
   *
   * Carried on the row rather than derived by the caller, and that is the
   * point of the field. A caller cannot derive it safely from
   * {@link validUntil} alone: api-v3 spells that value as SECONDS since epoch
   * and public-api as a timestamp string, so
   * `parseInt(validUntil, 10) > Date.now()` compares seconds against
   * milliseconds on one target and yields the YEAR (`parseInt("2027-…")`) on
   * the other — permanently false either way, which empties the client's
   * Whitelisted tab.
   *
   * In backend mode this is the boolean the endpoint evaluates in Postgres
   * against `now()`, the same expression its `?status=whitelisted` filter
   * uses, so the flag and the page can never disagree. On the graphql adapters
   * it is derived from `validUntil` by {@link isWhitelistedAt}, which parses
   * both spellings and throws on a third.
   */
  isWhitelisted: boolean;
}

/** Cursor page info, mirrored from the api-v3 page shape. */
export interface PageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor: string | null;
  endCursor: string | null;
}

/**
 * A page of whitelist entries.
 *
 * Deliberately carries no `pageInfo` and no piggy-backed global `assets`
 * lookup, because no backend endpoint can serve either honestly:
 *
 * - an `assets` sub-tree here would be the WHOLE `assets` table (capped, and
 *   `null`-joining past the cap), read only so `whitelistedHolders()` could
 *   find the decimals of the asset an investor has an outstanding subscription
 *   in. The investors endpoint serves investors, not assets, so a REST route
 *   could only answer `[]` — and `[]` falls through to a hardcoded `?? 18`,
 *   i.e. a USDC amount rendered at 18 decimals. The entity takes those
 *   decimals from the order rows it already reads, where the asset is joined
 *   per order.
 * - `pageInfo` is CURSOR-shaped and every consumer pages by `limit`/`offset`;
 *   the endpoint answers `{ items, total }` and has no cursors to serve. The
 *   entity synthesises the envelope from the page bounds it passed in, so both
 *   adapters agree instead of one inventing cursors the other cannot produce.
 */
export interface WhitelistedInvestorsPage {
  items: WhitelistedInvestorRow[];
  totalCount: number;
}

/** One investor's position in a share token on one network. */
export interface TokenInstancePositionRow {
  accountAddress: Hex;
  balance: string;
  centrifugeId: string;
  createdAt: string;
  isFrozen: boolean;
  tokenId: string;
  updatedAt: string;
}

/** An off-ramp receiver address with its (joined) asset id. */
export interface OffRampAddressRow {
  assetAddress: Hex;
  receiverAddress: Hex;
  asset: { id: string } | null;
}

/** An off-ramp relayer. */
export interface OffRampRelayerRow {
  address: Hex;
  isEnabled: boolean;
}

/** An on-ramp asset with its (joined) asset id. */
export interface OnRampAssetRow {
  assetAddress: Hex;
  asset: { id: string } | null;
}

/** The two collections `Investor.portfolio()` pairs to find positions. */
export interface InvestorPortfolioSources {
  vaults: { assetAddress: Hex; centrifugeId: string }[];
  tokenInstances: { address: Hex; centrifugeId: string }[];
}

/** One investor transaction with its joined display metadata. */
export interface InvestorTransactionRow {
  account: Hex;
  createdAt: string;
  type: string;
  txHash: Hex;
  currencyAmount: string;
  currencyAsset: {
    decimals: number;
    symbol: string;
    id: string;
    address: string;
  } | null;
  token: { name: string; symbol: string; decimals: string } | null;
  tokenAmount: string | null;
  tokenPrice: string | null;
  centrifugeId: string;
  poolId: string;
}

/** A page of investor transactions. */
export interface InvestorTransactionsPage {
  items: InvestorTransactionRow[];
  totalCount: number;
}

/** One pool adapter with its (joined) adapter name. */
export interface PoolAdapterRow {
  adapterAddress: Hex;
  isEnabled: boolean | null;
  crosschainInProgress: string | null;
  adapter: { name: string } | null;
}

/** One on-chain pool manager row. */
export interface PoolManagerRow {
  isHubManager: boolean;
  isBalancesheetManager: boolean;
  crosschainInProgress: string | null;
  address: Hex;
  centrifugeId: string;
  poolId: string;
}

/** A deployed merkle proof manager. */
export interface MerkleProofManagerRow {
  address: Hex;
}

/** A deployed on/off-ramp manager. */
export interface OnOffRampManagerRow {
  address: Hex;
  createdAtBlock: number;
}

/**
 * The Basin enums are the SAME values the backend catalogue carries, so they
 * are re-exported from `./types` rather than restated. A second spelling
 * could drift from the projection's, and both catalogues describe one set of
 * `chain_v1` columns.
 */
export type {
  BasinDebtChangeType,
  BasinRedeemRequestState,
  BasinSwapDirection,
} from "./types";
import type {
  BasinDebtChangeType,
  BasinRedeemRequestState,
  BasinSwapDirection,
  CrosschainMessageStatus,
  CrosschainPayloadStatus,
} from "./types";

/**
 * One Basin's debt position, keyed `(chainId, basinAddress, tokenId)`.
 *
 * `ssrSeeded` is part of the shape rather than an internal flag: while it is
 * false, `ratePerSecondRay` holds a placeholder and interest is NOT accruing,
 * so a consumer that rendered the rate as fact would show a number the
 * projection does not stand behind. Surfacing it is what lets a caller tell
 * "the rate is 0" from "we do not know the rate yet".
 */
export interface BasinDebtRow {
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

/**
 * One row of a Basin's debt-change ledger, keyed `(chainId, txHash, logIndex)`.
 *
 * `principalDelta` is signed: positive draws down, negative repays.
 * `debtAfter` is the running balance after this row — see
 * {@link BasinDebtChangeType} for why the ledger is returned unfiltered.
 */
export interface BasinDebtChangeRow {
  type: BasinDebtChangeType;
  interestAccrued: string;
  principalDelta: string;
  debtAfter: string;
  ratePerSecondRay: string;
  txHash: string;
  timestamp: string;
}

/** One Basin's fee configuration and collected totals. */
export interface BasinFeeRow {
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
 * One Basin OTC swap.
 *
 * `OTHER`-direction swaps are INCLUDED, for the same reason the debt-change
 * ledger is unfiltered: the projection recorded them, and which directions a
 * screen shows is a display choice.
 */
export interface BasinSwapRow {
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
 * One Basin redeem request, keyed `(basinAddress, requestId)`, with its
 * linked hub redeem order joined.
 */
export interface BasinRedeemRequestRow {
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
   * reconciliation warning for this request's BASIN: more than one open
   * request could be the linked one, and the projection refused to pick.
   *
   * When true, {@link redeemOrder} is null even though
   * {@link linkedRedeemOrderIndex} may be set — a plausible-looking order is
   * worse than none, because the close-modal gate it feeds would enable a
   * button against the wrong order. The flag travels with the row so a caller
   * can say "we cannot tell" rather than silently showing nothing.
   */
  redeemOrderLinkAmbiguous: boolean;
  redeemOrder: BasinLinkedRedeemOrderRow | null;
}

/**
 * The hub redeem order a Basin redeem request is linked to, joined through
 * `basin_redeem_request.linked_redeem_order_index`.
 *
 * Null on a request whose order does not exist yet, and null when the link is
 * AMBIGUOUS — see {@link BasinRedeemRequestRow.redeemOrderLinkAmbiguous}.
 */
export interface BasinLinkedRedeemOrderRow {
  index: number;
  approvedAt: string | null;
  revokedAt: string | null;
  /** Null until the hub claim lands. The close gate turns on this field. */
  claimedAt: string | null;
  revokedSharesAmount: string | null;
  revokedAssetsAmount: string | null;
  /**
   * Revoked price per share in POOL currency — distinct from
   * {@link revokedWithNavAssetPerShare}, the same revocation priced in the
   * asset. Both are carried; they are not interchangeable.
   */
  revokedWithNavPoolPerShare: string | null;
  revokedWithNavAssetPerShare: string | null;
}

/** One spoke of a pool migration, as `pool_migration_spoke` projects it. */
export interface PoolMigrationSpokeRow {
  centrifugeId: string;
  phase: string;
  /** uint32 as a decimal string; `"0"` until the first freeze. */
  freezeGeneration: string;
}

/** The hub row of a pool migration with its spokes; null when the pool never armed. */
export interface PoolMigrationRow {
  migrationId: string;
  poolId: string;
  targetVersion: string;
  hubPhase: string;
  operator: Hex;
  startedAt: string;
  spokes: PoolMigrationSpokeRow[];
}

/** One hub `StepRelayed` of a pool migration, in hub log order. */
export interface PoolMigrationStepRow {
  chainId: string;
  transactionHash: Hex;
  logIndex: number;
  migrationId: string;
  poolId: string;
  centrifugeId: string;
  step: number;
  payloadHash: Hex;
  gatewayMessageHash: Hex;
  hasGatewayPrepareMessage: boolean;
  isSameChainStep: boolean;
  createdAt: string;
  createdAtBlock: number;
}

/**
 * One `chain_v1.pool_authorization_event` row: a policy or authorization log of
 * HubRegistry, Hub or SpokeRegistry. `eventKind` is the enum label as served
 * (`HUB_REGISTRY_SET_POLICY`, `HUB_REGISTRY_AUTHORIZATION_SCHEDULED`, ...); a
 * column the event does not carry is null.
 *
 * `centrifugeId` is the emitting chain. `createdAtBlock` and
 * `createdAtLogIndex` order one chain's rows (block, then log index); rows of
 * different chains have no common order. The primary key is
 * `(centrifugeId, createdAtTxHash, createdAtLogIndex)`.
 */
export interface PoolAuthorizationEventRow {
  centrifugeId: string;
  poolId: string;
  eventKind: string;
  sourceAddress: Hex;
  targetCentrifugeId: string | null;
  /**
   * The installed policy (lower-case address, the zero address clears it) on a
   * `SetPolicy` row; the bytes32 word as emitted on `HUB_SET_SPOKE_POLICY`.
   * Null on a log that carries none, which is unknown.
   */
  policy: string | null;
  caller: Hex | null;
  authId: Hex | null;
  calldata: Hex | null;
  /** uint48 unix seconds as a decimal string, as emitted (not the block time). */
  validAfter: string | null;
  createdAt: string;
  createdAtBlock: number;
  createdAtTxHash: Hex;
  createdAtLogIndex: number;
}

/**
 * One `chain_v1.hub_policy` row: the policy a HubRegistry `SetPolicy` installed
 * and the parameters the indexer read from the policy contract. It has the
 * same primary key `(centrifugeId, createdAtTxHash, createdAtLogIndex)` as the
 * `HUB_REGISTRY_SET_POLICY` event row of that log.
 *
 * A null parameter was not published: it is unknown, never 0 or false. The
 * numerics are decimal strings (`delay`, `expiry` and `escalation` in seconds;
 * the three guards as the policy contract stores them).
 */
export interface HubPolicyRow {
  centrifugeId: string;
  poolId: string;
  policy: string | null;
  delay: string | null;
  expiry: string | null;
  escalation: string | null;
  maxAbsolutePriceDelta: string | null;
  thresholdPerSecond: string | null;
  maxBrmPriceDeviation: string | null;
  isRestrictionUpdateInstant: boolean | null;
  onchainAccounting: boolean | null;
  createdAt: string;
  createdAtBlock: number;
  createdAtTxHash: Hex;
  createdAtLogIndex: number;
}

/** One `crosschain_message` row by message id, the inner message of a payload. */
export interface CrosschainMessageRow {
  id: Hex;
  index: number;
  poolId: string | null;
  fromCentrifugeId: string;
  toCentrifugeId: string;
  messageType: string;
  status: CrosschainMessageStatus;
  /** The status of the batch the message travels in; null while the message is not linked to one. */
  payloadStatus: CrosschainPayloadStatus | null;
  failReason: string | null;
  executedAt: string | null;
  executedAtTxHash: Hex | null;
  failedAt: string | null;
  clearedAt: string | null;
}

/** One hub manager call to a remote `ShareManager`, with the status of the message it travels in. */
export interface ShareManagerCallRow {
  messageId: Hex;
  messageIndex: number;
  poolId: string;
  centrifugeId: string;
  targetAddress: Hex;
  kind: "Issue" | "Revoke";
  scId: Hex;
  account: Hex;
  shares: string;
  createdAt: string;
  createdAtTxHash: Hex;
  status: CrosschainMessageStatus;
}
