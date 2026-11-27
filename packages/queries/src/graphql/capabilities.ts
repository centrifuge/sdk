/**
 * Per-entry public-api support table.
 *
 * The SDK's reads historically ran against api-v3 (Ponder GraphQL), whose
 * filter language has operator suffixes (`_not`, `_in`, `_gt`, `_contains`,
 * `_ends_with`) and auto-generated nested relation fields (`asset { … }`,
 * `blockchain { … }`).
 *
 * public-api is PostGraphile v5 over `chain_v1`, with
 * `postgraphile-plugin-connection-filter` installed. That means:
 * - **`filter:` exists, but only on index-backed columns.**
 *   `IndexBackedFieldsPlugin` (in `centrifuge/api-v4`)
 *   strips `filter`/`filterBy`/`orderBy` from every column that is not the
 *   leading column of a non-partial btree index, so an entry's predicate is
 *   only expressible once its columns carry the right index — see
 *   `docs/parity/09-sdk-catalogue-public-api.md` for the current list of
 *   index-backed columns and why. `filterBy` is the behaviour behind
 *   `condition:`, so an unindexed column has no `condition:` field either.
 * - **The operator set is deliberately narrow even where a column IS
 *   index-backed** — `connectionFilterAllowedOperators` in
 *   `centrifuge/api-v4`'s `graphile.config.ts` allows only `equalTo`, `in`,
 *   `lessThan(OrEqualTo)`, `greaterThan(OrEqualTo)` and `isNull`. There is no
 *   negation and no substring match, so api-v3's `_not` / `_contains` /
 *   `_ends_with` predicates have no equivalent regardless of indexing —
 *   adding one of those operators is a plugin/allowlist change, not an index
 *   change, and is out of scope for the index-backed entries below.
 * - **No nested relation fields beyond a Drizzle `one()`.**
 *   `DrizzleVirtualForeignKeysPlugin` derives some relation traversals from
 *   the schema's own `relations()` declarations, but most api-v3 joins still
 *   have no FK/smart-comment counterpart, so they become a second collection
 *   read plus a client-side join here.
 * - `numeric78` columns serialize as `BigFloat` strings;
 * - collections are `entity(first, offset, condition, filter, orderBy) { nodes … }`.
 *
 * Each catalogue entry therefore lands in one of three states. The table is
 * the deliverable that tells the public-api owners exactly which capability
 * unblocks which entry — nothing here silently degrades a read.
 *
 * **Client-join dimension cap.** Where an entry's join key is not (yet)
 * index-backed on the dimension table it joins against, the joins that
 * replace api-v3's relations read a whole dimension table (`assets`,
 * `tokens`, `adapters`, `blockchains`) and index it in memory, capped at
 * `PUBLIC_API_DIMENSION_CAP` (1000) rows. Past the cap a truncated read would
 * make rows outside the page join to nothing — `null` where a real value
 * exists — so the adapter throws `DimensionOverflowError` instead. Declaring
 * FK/smart-comment relations (or, per entry, index-backing the join key and
 * rewriting the join as a server-side `filter: { id: { in: [...] } }`) turns
 * these joins into server-side predicates and removes the whole-table reads
 * entirely.
 */

/** How well public-api can serve one catalogue entry today. */
export type EntrySupport =
  /** Expressible directly: `condition:` equality plus column selections. */
  | "ported"
  /**
   * Expressible, but one or more api-v3 nested relations become extra
   * collection reads joined in the adapter. Correct and bounded — the join
   * keys are already constrained by the entry's own condition.
   */
  | "ported-with-client-join"
  /**
   * Not expressible without a public-api capability that does not exist yet.
   * The adapter throws for these instead of returning a partial result.
   */
  | "blocked";

/** A public-api capability an entry is waiting on. */
export type MissingCapability =
  /**
   * A target column is not (yet) the leading column of a non-partial btree
   * index, so `IndexBackedFieldsPlugin` strips `filter`/`orderBy` from it
   * even though `connection-filter` itself is installed. Unblocked by adding
   * the index (a `public-db` migration), not by a plugin change.
   */
  | "connection-filter"
  /**
   * The column IS index-backed, but the predicate needs an operator outside
   * `connectionFilterAllowedOperators` (e.g. `endsWith`, `notIn`). Unblocked
   * by widening the operator allowlist in `centrifuge/api-v4`'s `graphile.config.ts`,
   * not by an index.
   */
  | "filter-operator"
  /** FK constraints or smart comments so relations are generated. */
  | "relations"
  /** A table/view that does not exist in `chain_v1` at all. */
  | "table"
  /** Pool `status` and `protocol_version`. Provenance stamps stay separate. */
  | "version-projection"
  /** A btree index on the column; `filter` and `condition` are index-backed. */
  | "index";

export interface EntryCapability {
  readonly support: EntrySupport;
  /** Why, in one line — shown in the thrown error for blocked entries. */
  readonly reason: string;
  /** Capabilities required to move this entry to `ported`. */
  readonly missing?: readonly MissingCapability[];
  /** The api-v3 predicates/relations that do not survive the move. */
  readonly blockedBy?: readonly string[];
}

/**
 * Support state of every catalogue entry the SDK reads through.
 *
 * Entries absent from this map are backend-only (the `sql` adapter's own
 * entries) and are not served over public-api by the SDK.
 */
export const PUBLIC_API_CAPABILITIES = {
  // ---------------------------------------------------------------- ported
  blockchains: {
    support: "ported",
    reason: "plain collection; no predicate and no relation",
  },
  pools: {
    support: "ported",
    reason:
      "plain collection; api-v3 selected a nested `blockchain { id }` that the " +
      "SDK never read, so the dead selection is simply dropped",
  },
  tokenInstances: {
    support: "ported",
    reason:
      "`tokenId` is not filterable on `tokenInstances`; the read goes through " +
      "`token(id) { tokenInstances }`. `token_instance` carries its own " +
      "`centrifugeId` column",
  },
  whitelistedInvestor: {
    support: "ported",
    reason:
      "single-row read via " +
      "`whitelistedInvestorByTokenIdAndCentrifugeIdAndAccountAddress`",
  },
  tokenInstancePosition: {
    support: "ported",
    reason:
      "single-row read via " +
      "`tokenInstancePositionByAccountAddressAndCentrifugeIdAndTokenId`",
  },
  poolManagers: {
    support: "ported",
    reason: "`condition: { poolId }`",
  },
  merkleProofManagers: {
    support: "ported",
    reason: "`condition: { poolId, centrifugeId }`",
  },
  onOffRampManagers: {
    support: "ported",
    reason: "`condition: { poolId, centrifugeId, tokenId }`",
  },
  onOffRampRelayers: {
    support: "ported",
    reason: "`condition: { centrifugeId, tokenId }`; no relation selected",
  },
  investorPortfolioSources: {
    support: "ported",
    reason:
      "two unfiltered collections (`vaults`, `tokenInstances`); the SDK does " +
      "the pairing itself already",
  },

  // ------------------------------------------------ ported-with-client-join
  assetRegistrations: {
    support: "ported",
    reason:
      "`centrifugeId` is not filterable on `assetRegistrations`; the read goes " +
      "through `blockchains(condition: { centrifugeId }) { assetRegistrations }` " +
      "and `asset { … }` is a relation",
  },
  epochInvestOrders: {
    support: "ported-with-client-join",
    reason:
      "`condition: { tokenId }` works; nested `asset`/`token` become `assets` " +
      "and `tokens` reads joined on `assetId`/`tokenId`",
    missing: ["relations"],
    blockedBy: ["asset { … }", "token { decimals }"],
  },
  closedInvestOrders: {
    support: "ported-with-client-join",
    reason:
      "`condition: { tokenId }` plus `filter: { issuedAt: { isNull: false } }` " +
      "is the whole read; nested `asset`/`token` become joined reads, once per " +
      "call rather than once per epoch",
    missing: ["relations"],
    blockedBy: ["asset { … }", "token { decimals }"],
  },
  epochRedeemOrders: {
    support: "ported-with-client-join",
    reason:
      "`condition: { tokenId, assetId?, index? }` works; nested `asset`/`token` " +
      "become joined reads",
    missing: ["relations"],
    blockedBy: ["asset { … }", "token { decimals }"],
  },
  redeemOrdersByEpoch: {
    support: "ported-with-client-join",
    reason:
      "`condition: { tokenId }` plus `filter: { revokedAt: { isNull: false } }` " +
      "bounds the read to the share class's revoked orders; `assetId`, `index` " +
      "and `claimedAt` are not indexed, so the epoch is picked client-side over " +
      "that capped set, and the nested `asset`/`token` are joined reads",
    missing: ["index"],
    blockedBy: ["assetId: $assetId", "index: $index", "claimedAt: null"],
  },
  closedRedeemOrders: {
    support: "ported-with-client-join",
    reason:
      "`condition: { tokenId }` plus `filter: { revokedAt: { isNull: false } }` " +
      "is the whole read; nested `asset`/`token` become joined reads, once per " +
      "call rather than once per epoch",
    missing: ["relations"],
    blockedBy: ["asset { … }", "token { decimals }"],
  },
  holdingEscrows: {
    support: "ported-with-client-join",
    reason:
      "`condition: { tokenId }` works; api-v3 traversed two relation levels " +
      "(`holding { createdAt }` and `asset { … blockchain { … } }`), which " +
      "become `holdings` and `assets` reads joined client-side",
    missing: ["relations"],
    blockedBy: ["holding { createdAt }", "asset { … blockchain { … } }"],
  },
  investOrderState: {
    support: "ported-with-client-join",
    reason:
      "four collections each on `condition: { tokenId }` " +
      "(`epochOutstandingInvests`, `epochInvestOrders`, `pendingInvestOrders`, " +
      "`investOrders` with `issuedAt: null`, which `condition` expresses " +
      "natively); nested `asset`/`token` become joined reads",
    missing: ["relations"],
    blockedBy: ["asset { decimals centrifugeId }", "token { decimals }"],
  },
  redeemOrderState: {
    support: "ported-with-client-join",
    reason:
      "same four-collection shape as `investOrderState` on the redeem side",
    missing: ["relations"],
    blockedBy: ["asset { decimals centrifugeId }", "token { decimals }"],
  },
  allVaults: {
    support: "ported-with-client-join",
    reason:
      "`condition: { tokenId }` works; api-v3 read `asset { id }` and " +
      "`blockchain { centrifugeId }`, both of which `vault` carries as its own " +
      "`assetId` / `centrifugeId` columns",
    missing: ["relations"],
    blockedBy: ["asset { id }", "blockchain { centrifugeId }"],
  },
  offRampAddresses: {
    support: "ported",
    reason:
      "`condition: { tokenId }` bounds the read; `centrifugeId` is not indexed " +
      "and is applied client-side over the share class's rows. `asset { id }` " +
      "is a relation",
    missing: ["index"],
    blockedBy: ["centrifugeId: $centrifugeId"],
  },
  onRampAssets: {
    support: "ported-with-client-join",
    reason:
      "`condition: { centrifugeId, tokenId }` works; nested `asset { id }` is " +
      "recovered from the row's own `assetId`",
    missing: ["relations"],
    blockedBy: ["asset { id }"],
  },
  whitelistedInvestors: {
    support: "ported-with-client-join",
    reason:
      "`condition: { tokenId }` bounds the read to one share class; the " +
      "entry is narrowed to LIVE memberships to match the backend's " +
      "`?status=whitelisted`, and `validUntil > now()` is an operator " +
      "predicate `condition:` cannot express — so it becomes a client-side " +
      "filter over the bounded set, and the page is cut after it. Bounded " +
      "rather than unbounded, but it does mean the whole share class's " +
      "whitelist has to fit under the dimension cap, or the read throws " +
      "instead of paging over a partial set",
    missing: ["connection-filter"],
    blockedBy: ["validUntil_gt: now"],
  },
  investorTransactions: {
    support: "ported-with-client-join",
    reason:
      "`filter: { account, poolId, tokenId?, type?, createdAt? }` plus " +
      "`orderBy: [CREATED_AT_DESC]` works — all four are index-backed leading " +
      "columns (backend#613). Before this, `account` did not lead its own " +
      "index, so the read could only be bounded by `poolId`; on mainnet four " +
      "pools hold more than the 1000-row cap (one holds 411k), so paging one " +
      "account client-side over that set was wrong above the cap rather than " +
      "just slow. `createdAtAfter`/`createdAtBefore` are public-api-only " +
      "(api-v3's operator spelling for this column is unverified, see " +
      "`graphql/api-v3.ts`); the nested `currencyAsset { … }` and `token { … }` " +
      "become `assets` and `tokens` reads joined on the row's own ids",
    missing: ["relations"],
    blockedBy: ["currencyAsset { … }", "token { … }"],
  },
  poolAdapters: {
    support: "ported-with-client-join",
    reason:
      "`condition: { poolId, localCentrifugeId, remoteCentrifugeId }` works; " +
      "the nested `adapter { name }` becomes an `adapters` read joined on " +
      "`(adapterAddress, localCentrifugeId, updatedByRegistryVersion)`, the " +
      "key `chain_v1` declares. Joining on the address alone would make an " +
      "adapter deployed at the same address on two chains, or two generations " +
      "of one chain, borrow the other row's name",
    missing: ["relations"],
    blockedBy: ["adapter { name }"],
  },

  poolMigration: {
    support: "ported",
    reason:
      "`poolMigrations(condition: { poolId })` with the `spokePhases` relation " +
      "`DrizzleVirtualForeignKeysPlugin` derives from `pool_migration_spoke`'s " +
      "`migration` relation; the migration id is matched client-side because " +
      "`migration_id` trails `pool_id` in the index (backend#600)",
  },
  poolMigrationSteps: {
    support: "ported",
    reason:
      "`poolMigrationSteps(condition: { poolId })`, every row of the pool under " +
      "the cap, ordered client-side by block and log index because the only " +
      "index leads with `pool_id` (backend#600)",
  },
  poolAuthorizationEvents: {
    support: "ported",
    reason:
      "`poolAuthorizationEvents(filter: { poolId })`, paged by cursor until " +
      "`hasNextPage` is false: the pool's log is unbounded, so the read never " +
      "stops at the dimension cap. Ordered by primary key; the reader orders " +
      "one chain's rows by block and log index",
  },
  hubPolicies: {
    support: "ported",
    reason:
      "`hubPolicies(filter: { poolId })`, paged by cursor until `hasNextPage` " +
      "is false, ordered by primary key like `poolAuthorizationEvents`",
  },
  shareManagerCalls: {
    support: "ported",
    reason:
      "`managerCalls(filter: { tokenId, targetKind })`, paged by cursor until " +
      "`hasNextPage` is false: both columns lead a btree index, and the message " +
      "status is the `crosschainMessage` relation (centrifuge/api-v4#62)",
  },
  crosschainMessageRows: {
    support: "ported",
    reason:
      "`crosschainMessages(filter: { id: { in } })`: `crosschain_message_id_idx` " +
      "leads with `id`, so the inner messages of a message id are one " +
      "index-backed read (backend#600); `crosschainPayload { status }` rides " +
      "the message's payload relation (backend#986)",
  },
  deployments: {
    support: "ported",
    reason:
      "`deployments { centrifugeId chainId registryVersion }` (backend#352), one " +
      "row per `(chain, registryVersion)`; `registryVersion` is served as " +
      "`protocolVersion`. Informational only — the SDK transacts against the " +
      "bundled @centrifuge/protocol registry.",
  },

  // --------------------------------------------------------------- blocked
  // TODO(public-api-gap): tokenInstancePositions — unblock when
  // postgraphile-plugin-connection-filter lands; it also removes the
  // client-join whole-table dimension reads and their cap
  // (see docs/parity/09-sdk-catalogue-public-api.md).
  tokenInstancePositions: {
    support: "ported",
    reason:
      "`filter` covers `tokenId`, `balance: { greaterThan }` and " +
      "`centrifugeId: { in }` with index-backed `orderBy`; the share class's " +
      "positions are paged through the server in full, and the address " +
      "exclusion and the `holderAddress` substring search are applied " +
      "client-side over that complete set. Negation is not used: " +
      "`connectionFilterLogicalOperators` is nominally off in " +
      "`centrifuge/api-v4` even though the plugin ignores it (backend#572)",
    blockedBy: [
      "accountAddress_not_in: $excludedAddresses",
      "accountAddress_contains: $holderAddress",
    ],
  },
  // TODO(public-api-gap): crosschainMessages — unblock when
  // postgraphile-plugin-connection-filter and FK-or-smart-comment relations
  // land; connection-filter also removes the client-join whole-table
  // dimension reads and their cap
  // (see docs/parity/09-sdk-catalogue-public-api.md).
  crosschainMessages: {
    support: "ported",
    reason:
      "`filter` covers `poolId`, `fromCentrifugeId`, `toCentrifugeId` and " +
      "`status: { in }`, cursors map onto `before`/`after`, and the include " +
      "sub-tree is relations. `createdAt` is not an `orderBy` column, so the " +
      "page is primary-key ordered; `createdAtTxHash` is not indexed and is " +
      "applied client-side over the capped set",
    missing: ["index"],
    blockedBy: ['orderBy: "createdAt"', "createdAtTxHash: $createdAtTxHash"],
  },
  // TODO(public-api-gap): crosschainMessage — unblock when
  // FK-or-smart-comment relations land (see docs/parity/09-sdk-catalogue-public-api.md).
  crosschainMessage: {
    support: "ported",
    reason:
      "`crosschainPayload(id, index)` with the include sub-tree as relations",
  },
  sharePricesReport: {
    support: "ported",
    reason:
      "`filter: { tokenId: { in } } }` plus `orderBy: [TIMESTAMP_DESC]` — " +
      "`tokenId` already leads `token_instance_snapshot`'s primary key, and " +
      "`timestamp` is now index-backed by " +
      "`token_instance_snapshot_timestamp_idx` (backend#613). api-v3's " +
      "`trigger_ends_with: 'NewPeriod'` is dropped rather than replicated: " +
      "the only writer of `token_instance_snapshot` is " +
      "`DailySnapshotService`, which stamps every row " +
      "`snapshot:DailySnapshotTrigger`, so every row already satisfies it",
  },
  shareYieldsReport: {
    support: "ported",
    reason:
      "`filter: { id: { in } }` plus `orderBy: [TIMESTAMP_DESC]` — `id` " +
      "already leads `token_snapshot`'s primary key, and `timestamp` is now " +
      "index-backed by `token_snapshot_timestamp_idx` (backend#613). Yield " +
      "columns are aliased from PostGraphile's spelling (a digit followed by " +
      "`d` capitalizes, e.g. `yield1D`) back onto api-v3's `yield1d`",
  },

  hubSharePricesReport: {
    support: "ported",
    reason:
      "`filter: { id: { in } }` plus `orderBy: [TIMESTAMP_DESC]` on " +
      "`tokenSnapshots`, the same columns `shareYieldsReport` filters and " +
      "sorts on, with the optional `timestamp` bounds. `trigger` is not " +
      "filterable, so the adapter scans newest-first and keeps the " +
      "`snapshot:DailySnapshotTrigger` rows until `limit` of them are " +
      "collected: the same day-boundary series api-v3's " +
      "`trigger_ends_with: 'NewPeriod'` selects, with `limit` meaning the " +
      "same number of rows on both targets",
  },
  sharePriceUpdates: {
    support: "ported",
    reason:
      "`filter: { id: { equalTo }, timestamp: { greaterThanOrEqualTo, " +
      "lessThanOrEqualTo } }` plus `orderBy: PRIMARY_KEY_ASC` on " +
      "`tokenSnapshots`, paged by cursor until the last page; the primary " +
      "key leads with `timestamp`, so one share class comes back oldest " +
      "first. `trigger` is not filterable, so every row of the range is " +
      "returned with its `trigger` and the caller keeps the rows of the " +
      "trigger it wants",
  },

  // ------------------------------------------------------------------ Basin
  // All five narrow on an index-backed key and then finish the predicate
  // here. `basin_debt` / `basin_fee` carry `basinAddress` in the ROW, so the
  // adapter verifies it rather than guessing; `basin_redeem_request` bounds on
  // `basinAddress` (its primary key's leading column) and narrows the rest.
  basinDebt: {
    support: "ported-with-client-join",
    reason:
      "`condition: { chainId, tokenId }` — `basin_address` is the SECOND " +
      "column of `basin_debt`'s primary key, so it leads no index and " +
      "`IndexBackedFieldsPlugin` strips it from `filter` AND `condition`. " +
      "The pair identifies at most one row for every basin deployed today, " +
      "and the adapter verifies the row's `basinAddress` against the " +
      "parameter rather than returning a row the caller did not ask for",
  },
  basinDebtChanges: {
    support: "ported",
    reason:
      "`condition: { chainId, basinAddress, tokenId }` plus " +
      "`orderBy: [TIMESTAMP_DESC]` — `basin_address` leads " +
      "`basin_debt_change_basin_timestamp_idx`, `token_id` leads " +
      "`basin_debt_change_token_id_idx` (backend#628) and `timestamp` leads " +
      "`basin_debt_change_timestamp_idx` (backend#633). The block/log-index " +
      "tie-break is applied in the adapter: `orderBy` takes one key, and two " +
      "rows in one block carry the running `debt_after` in `log_index` order",
  },
  basinFees: {
    support: "ported-with-client-join",
    reason:
      "same shape as `basinDebt`: `basin_fee` has the same primary key, so " +
      "`basinAddress` is verified against the returned row rather than " +
      "filtered server-side",
  },
  basinSwaps: {
    support: "ported",
    reason:
      "`condition: { chainId, basinAddress, tokenId }` plus " +
      "`orderBy: [TIMESTAMP_DESC, BLOCK_NUMBER_DESC, LOG_INDEX_DESC]` — " +
      "`basin_address` leads `basin_swap_basin_timestamp_idx`, `timestamp` " +
      "leads `basin_swap_timestamp_idx` (backend#613) and `token_id` leads " +
      "`basin_swap_token_id_idx` (backend#628)",
  },
  basinRedeemRequests: {
    support: "ported-with-client-join",
    reason:
      "`condition: { basinAddress }` plus `orderBy: [INITIATED_AT_DESC]` — " +
      "`basin_address` leads the primary key and `initiated_at` leads " +
      "`basin_redeem_request_initiated_at_idx` (backend#633). `redeemer` and " +
      "`requestId` lead no index, so they are narrowed here over the " +
      "basin-bounded set under the dimension cap. " +
      "The linked hub redeem order IS joined, via the Drizzle `one()` " +
      "relation on `linked_redeem_order_index` that " +
      "`DrizzleVirtualForeignKeysPlugin` exposes as a nested field. The " +
      "ambiguity flag is a second read of `basin_reconciliation_warning` " +
      "bounded by chain and narrowed here, since neither `type` nor " +
      "`basin_address` leads an index (backend#629 Stage 2b)",
  },
} as const satisfies Record<string, EntryCapability>;

/** Names of every entry the SDK reads through the graphql adapter. */
export type SdkGraphqlEntryName = keyof typeof PUBLIC_API_CAPABILITIES;

/** Whether public-api can serve an entry today. */
export function isPublicApiSupported(name: SdkGraphqlEntryName): boolean {
  const capability: EntryCapability = PUBLIC_API_CAPABILITIES[name];
  return capability.support !== "blocked";
}

/** Every entry still waiting on a public-api capability, with the reason. */
export function blockedEntries(): {
  name: SdkGraphqlEntryName;
  capability: EntryCapability;
}[] {
  return (
    Object.entries(PUBLIC_API_CAPABILITIES) as [
      SdkGraphqlEntryName,
      EntryCapability,
    ][]
  )
    .filter(
      ([, capability]: [string, EntryCapability]) =>
        capability.support === "blocked",
    )
    .map(([name, capability]) => ({ name, capability }));
}
