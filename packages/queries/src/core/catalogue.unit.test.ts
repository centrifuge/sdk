import { describe, expect, it } from "vitest";
import { catalogue, type QueryName } from "./catalogue";
import type {
  AssetDetails,
  AssetRegistrationRow,
  BlockchainRow,
  EpochInvestOrderRow,
  EpochInvestOrderStateRow,
  EpochOutstandingInvestRow,
  EpochOutstandingRedeemRow,
  EpochRedeemOrderRow,
  EpochRedeemOrderStateRow,
  HoldingEscrowAsset,
  HoldingEscrowRow,
  MerkleProofManagerRow,
  OffRampAddressRow,
  OffRampRelayerRow,
  OnOffRampManagerRow,
  OnRampAssetRow,
  OrderAsset,
  OrderToken,
  PoolAdapterRow,
  TokenInstanceRow,
  VaultRow,
} from "./sdk-types";
import type {
  AssetInfo,
  AssetRegistration,
  Blockchain,
  EpochInvestOrder,
  EpochOutstandingInvest,
  EpochOutstandingRedeem,
  EpochRedeemOrder,
  HoldingEscrow,
  HoldingEscrowAssetInfo,
  MerkleProofManager,
  OffRampAddress,
  OffRampRelayer,
  OnOffRampManager,
  OnRampAsset,
  RampAssetRef,
  OrderAssetInfo,
  OrderTokenInfo,
  PoolAdapter,
  TokenInstance,
  Vault,
  VaultAssetInfo,
} from "./types";

/** True only when the two key sets are identical in both directions. */
type SameKeys<A, B> = [keyof A] extends [keyof B]
  ? [keyof B] extends [keyof A]
    ? true
    : false
  : false;

/**
 * The shape rule for the Tokenizations reads: the backend result types those
 * endpoints serve are the frozen SDK catalogue shapes field for field, so the
 * SDK's `rest` adapter stays a plain mapping.
 *
 * Compile-time, because a drifted field is a type error here rather than a
 * silent wire-shape change. Key sets only: the frozen shapes narrow addresses
 * to `0x${string}` while `chain_v1` hands back `string`, and that widening is
 * the one difference the adapter is allowed to normalize (`RestRoute.decode`).
 */
const _blockchainKeysMatchSdk: SameKeys<Blockchain, BlockchainRow> = true;
const _tokenInstanceKeysMatchSdk: SameKeys<TokenInstance, TokenInstanceRow> =
  true;

/**
 * Holdings, same rule and same reason. Nested shapes are asserted too
 * (`asset`, the joined asset details): the drift that would break the SDK's
 * `rest` adapter is just as likely one level down, and `SameKeys` only sees
 * the level it is given.
 */
const _holdingEscrowKeysMatchSdk: SameKeys<HoldingEscrow, HoldingEscrowRow> =
  true;
const _holdingEscrowAssetKeysMatchSdk: SameKeys<
  HoldingEscrowAssetInfo,
  HoldingEscrowAsset
> = true;
const _assetRegistrationKeysMatchSdk: SameKeys<
  AssetRegistration,
  AssetRegistrationRow
> = true;
const _assetInfoKeysMatchSdk: SameKeys<AssetInfo, AssetDetails> = true;
const _onOffRampManagerKeysMatchSdk: SameKeys<
  OnOffRampManager,
  OnOffRampManagerRow
> = true;

/**
 * Basin, same rule and same reason. `SameKeys` rather than `HasKeysOf`
 * for all four: none of these endpoints over-serves its entry the way `GET
 * /pools` and `GET .../vaults` do, so an extra field on either side is drift.
 *
 * The nested `asset` shape is asserted too. That is where the drift would
 * actually be tempting — `chain_v1` has a whole asset row to hand and the
 * joined shape declares only `{ id }` — and `SameKeys` only sees the level it
 * is given.
 */
const _merkleProofManagerKeysMatchSdk: SameKeys<
  MerkleProofManager,
  MerkleProofManagerRow
> = true;
const _offRampAddressKeysMatchSdk: SameKeys<OffRampAddress, OffRampAddressRow> =
  true;
const _offRampRelayerKeysMatchSdk: SameKeys<OffRampRelayer, OffRampRelayerRow> =
  true;
const _onRampAssetKeysMatchSdk: SameKeys<OnRampAsset, OnRampAssetRow> = true;
const _rampAssetRefKeysMatchSdk: SameKeys<
  RampAssetRef,
  NonNullable<OnRampAssetRow["asset"]>
> = true;
const _rampAssetRefKeysMatchOffRamp: SameKeys<
  RampAssetRef,
  NonNullable<OffRampAddressRow["asset"]>
> = true;

/** True when `A` declares at least every key of `B`. */
type HasKeysOf<A, B> = [keyof B] extends [keyof A] ? true : false;

/**
 * Vaults. Deliberately a SUPERSET assertion rather than `SameKeys`.
 *
 * The frozen `VaultRow` is the minimum the SDK's `ShareClass._allVaults()`
 * reads (`address`, `poolId`, `assetAddress`, `status`, `asset.id`,
 * `centrifugeId`); `GET /pools/:poolId/vaults` over-serves it with the rest of
 * the projected vault columns, exactly as `GET /pools` over-serves the `pools`
 * entry, so one round trip backs both `poolNetwork.vaults(scId)` and the
 * network-list view. The SDK's rest route drops what the entry does not
 * declare (`RestRoute.decode`) — dropping undeclared fields is not the
 * reshaping the shape rule forbids; renaming, unit-converting or deriving
 * would be.
 *
 * The direction that matters is the one asserted: a field REMOVED from the
 * backend shape breaks the `allVaults` route, and this is a compile error for
 * it.
 */
const _vaultCoversSdkRow: HasKeysOf<Vault, VaultRow> = true;
const _vaultAssetCoversSdkRow: HasKeysOf<VaultAssetInfo, VaultRow["asset"]> =
  true;

/**
 * The redeem-order reads, same superset rule.
 *
 * `EpochRedeemOrder` has to cover BOTH frozen shapes over
 * `chain_v1.epoch_redeem_order` — the standalone `epochRedeemOrders` entry and
 * the `redeemOrderState.epochRedeemOrders` collection — because the two select
 * different column sets from one table and both are routed onto this one
 * backend read. A field dropped from either direction is a compile error here.
 */
const _epochRedeemOrderCoversSdkRow: HasKeysOf<
  EpochRedeemOrder,
  EpochRedeemOrderRow
> = true;
const _epochRedeemOrderCoversSdkStateRow: HasKeysOf<
  EpochRedeemOrder,
  EpochRedeemOrderStateRow
> = true;
const _epochOutstandingRedeemCoversSdkRow: HasKeysOf<
  EpochOutstandingRedeem,
  EpochOutstandingRedeemRow
> = true;
/**
 * The joined shapes, one level down — the same reason holdings asserts its
 * nested
 * asset. `OrderAssetInfo` answers to `OrderAsset` (the standalone entry, which
 * reads `asset.id`) and `OrderTokenInfo` to both `OrderToken` (`{ decimals }`)
 * and the wider `{ decimals, centrifugeId }` the outstanding row declares.
 */
const _orderAssetCoversSdkRow: HasKeysOf<OrderAssetInfo, OrderAsset> = true;
const _orderTokenCoversSdkRow: HasKeysOf<OrderTokenInfo, OrderToken> = true;
const _orderTokenCoversOutstandingRow: HasKeysOf<
  OrderTokenInfo,
  EpochOutstandingRedeemRow["token"]
> = true;

/**
 * The invest-order reads, the mirror of the block above.
 *
 * `EpochInvestOrder` covers BOTH frozen shapes over
 * `chain_v1.epoch_invest_order` for the same reason its redeem twin does: the
 * standalone entry and the `investOrderState.epochInvestOrders` collection
 * select different column sets from one table.
 *
 * Note what is deliberately NOT asserted: there is no
 * `_orderTokenCoversInvestOutstandingRow`. `EpochOutstandingInvestRow` declares
 * no `token`, because every amount on that row is asset-denominated — see
 * {@link EpochOutstandingInvest} for why carrying a share-token `decimals`
 * there would put the wrong scale within reach.
 */
const _epochInvestOrderCoversSdkRow: HasKeysOf<
  EpochInvestOrder,
  EpochInvestOrderRow
> = true;
const _epochInvestOrderCoversSdkStateRow: HasKeysOf<
  EpochInvestOrder,
  EpochInvestOrderStateRow
> = true;
const _epochOutstandingInvestCoversSdkRow: HasKeysOf<
  EpochOutstandingInvest,
  EpochOutstandingInvestRow
> = true;
const _orderAssetCoversInvestOutstandingRow: HasKeysOf<
  OrderAssetInfo,
  EpochOutstandingInvestRow["asset"]
> = true;

/**
 * Pool access. `SameKeys`, not a superset: `GET /pools/:poolId/adapters`
 * serves the frozen `PoolAdapterRow` and NOTHING else — the route's three
 * params are the caller's own input, so repeating them in the body would be
 * the only extra field and it would earn nothing.
 *
 * The nested join is asserted too, for the same reason holdings asserts its
 * asset.
 */
const _poolAdapterKeysMatchSdk: SameKeys<PoolAdapter, PoolAdapterRow> = true;
const _poolAdapterJoinKeysMatchSdk: SameKeys<
  NonNullable<PoolAdapter["adapter"]>,
  NonNullable<PoolAdapterRow["adapter"]>
> = true;

describe("query catalogue (core)", () => {
  it("the tokenizations result types carry exactly the frozen SDK fields", () => {
    // Runtime companion to the type-level assertions above, so the check is
    // visible in the suite output and not only to `tsc`.
    expect(_blockchainKeysMatchSdk).toBe(true);
    expect(_tokenInstanceKeysMatchSdk).toBe(true);
  });

  it("the holdings result types carry exactly the frozen SDK fields", () => {
    expect(_holdingEscrowKeysMatchSdk).toBe(true);
    expect(_holdingEscrowAssetKeysMatchSdk).toBe(true);
    expect(_assetRegistrationKeysMatchSdk).toBe(true);
    expect(_assetInfoKeysMatchSdk).toBe(true);
    expect(_onOffRampManagerKeysMatchSdk).toBe(true);
  });

  it("the vault result type covers every frozen SDK field", () => {
    expect(_vaultCoversSdkRow).toBe(true);
    expect(_vaultAssetCoversSdkRow).toBe(true);
  });

  it("the redeem-order result types cover every frozen SDK field", () => {
    expect(_epochRedeemOrderCoversSdkRow).toBe(true);
    expect(_epochRedeemOrderCoversSdkStateRow).toBe(true);
    expect(_epochOutstandingRedeemCoversSdkRow).toBe(true);
    expect(_orderAssetCoversSdkRow).toBe(true);
    expect(_orderTokenCoversSdkRow).toBe(true);
    expect(_orderTokenCoversOutstandingRow).toBe(true);
  });

  it("the invest-order result types cover every frozen SDK field", () => {
    expect(_epochInvestOrderCoversSdkRow).toBe(true);
    expect(_epochInvestOrderCoversSdkStateRow).toBe(true);
    expect(_epochOutstandingInvestCoversSdkRow).toBe(true);
    expect(_orderAssetCoversInvestOutstandingRow).toBe(true);
  });

  it("the pool-adapter result type carries exactly the frozen SDK fields", () => {
    expect(_poolAdapterKeysMatchSdk).toBe(true);
    expect(_poolAdapterJoinKeysMatchSdk).toBe(true);
  });

  it("the Basin result types carry exactly the frozen SDK fields", () => {
    expect(_merkleProofManagerKeysMatchSdk).toBe(true);
    expect(_offRampAddressKeysMatchSdk).toBe(true);
    expect(_offRampRelayerKeysMatchSdk).toBe(true);
    expect(_onRampAssetKeysMatchSdk).toBe(true);
    expect(_rampAssetRefKeysMatchSdk).toBe(true);
    expect(_rampAssetRefKeysMatchOffRamp).toBe(true);
  });

  it("poolAdapters requires the whole (pool, local, remote) route key", () => {
    // An adapter set means nothing without the direction it governs, so none
    // of the three is optional — a partial key would silently answer for one
    // route while the caller believed they asked about another.
    const params = {
      poolId: "281474976710657",
      localCentrifugeId: "1",
      remoteCentrifugeId: "2",
    };
    expect(catalogue.poolAdapters.params.parse(params)).toEqual(params);
    for (const missing of Object.keys(params)) {
      expect(() =>
        catalogue.poolAdapters.params.parse(
          Object.fromEntries(
            Object.entries(params).filter(([key]) => key !== missing),
          ),
        ),
      ).toThrow();
    }
    expect(() =>
      catalogue.poolAdapters.params.parse({ ...params, isEnabled: true }),
    ).toThrow();
  });

  it("crosschainMessages requires a pool and refuses both cursors at once", () => {
    // `poolId` is the `@PoolMembers()` scope, not a filter: there is no role
    // that authorises the unscoped, every-pool variant of this read.
    expect(() => catalogue.crosschainMessages.params.parse({})).toThrow();
    expect(
      catalogue.crosschainMessages.params.parse({ poolId: "281474976710657" }),
    ).toEqual({
      poolId: "281474976710657",
      limit: 100,
      include: {},
    });
    // Accepting both would silently apply one and drop the other.
    expect(() =>
      catalogue.crosschainMessages.params.parse({
        poolId: "281474976710657",
        before: "abc",
        after: "def",
      }),
    ).toThrow();
    expect(() =>
      catalogue.crosschainMessages.params.parse({
        poolId: "281474976710657",
        status: ["IN_TRANSIT"],
      }),
    ).toThrow();
    expect(
      catalogue.crosschainMessages.params.parse({
        poolId: "281474976710657",
        status: ["InTransit", "Underpaid"],
      }).status,
    ).toEqual(["InTransit", "Underpaid"]);
    // An empty status array is "match nothing" spelled as "match anything" —
    // refused so the two cannot be confused.
    expect(() =>
      catalogue.crosschainMessages.params.parse({
        poolId: "281474976710657",
        status: [],
      }),
    ).toThrow();
    expect(() =>
      catalogue.crosschainMessages.params.parse({
        poolId: "281474976710657",
        include: { innerMesages: true },
      }),
    ).toThrow();
  });

  it("crosschainMessage requires the pool scope and the whole payload key", () => {
    const id = `0x${"ab".repeat(32)}`;
    expect(
      catalogue.crosschainMessage.params.parse({
        poolId: "281474976710657",
        id,
        index: 0,
      }),
    ).toEqual({ poolId: "281474976710657", id, index: 0, include: {} });
    // `index` is part of the declared primary key, so it cannot default —
    // even though every mainnet payload is index 0 today.
    expect(() =>
      catalogue.crosschainMessage.params.parse({
        poolId: "281474976710657",
        id,
      }),
    ).toThrow();
    expect(() =>
      catalogue.crosschainMessage.params.parse({ id, index: 0 }),
    ).toThrow();
    // A 20-byte address is not a payload id.
    expect(() =>
      catalogue.crosschainMessage.params.parse({
        poolId: "281474976710657",
        id: `0x${"ab".repeat(20)}`,
        index: 0,
      }),
    ).toThrow();
  });

  it("every entry's name matches its catalogue key", () => {
    for (const [key, entry] of Object.entries(catalogue)) {
      expect(entry.name).toBe(key);
    }
  });

  it("validates pool params: rejects a non-decimal pool id", () => {
    expect(() => catalogue.pool.params.parse({ poolId: "0xabc" })).toThrow();
    expect(() => catalogue.pool.params.parse({})).toThrow();
    expect(catalogue.pool.params.parse({ poolId: "281474976710657" })).toEqual({
      poolId: "281474976710657",
    });
  });

  it("applies the default page size and caps it", () => {
    expect(catalogue.pools.params.parse({}).limit).toBe(100);
    expect(catalogue.pools.params.parse({}).offset).toBe(0);
    expect(() =>
      catalogue.investorTransactions.params.parse({ limit: 100000 }),
    ).toThrow();
  });

  it("validates the block watermark tuple", () => {
    const good = catalogue.investorTransactions.params.parse({
      after: { blockNumber: 10, txHash: `0x${"ab".repeat(32)}`, logIndex: 0 },
    });
    expect(good.after?.blockNumber).toBe(10);

    expect(() =>
      catalogue.investorTransactions.params.parse({
        after: { blockNumber: -1, txHash: `0x${"ab".repeat(32)}`, logIndex: 0 },
      }),
    ).toThrow();
    expect(() =>
      catalogue.investorTransactions.params.parse({
        after: { blockNumber: 1, txHash: "0x123", logIndex: 0 },
      }),
    ).toThrow();
  });

  it("validates the snapshot watermark tuple", () => {
    const good = catalogue.tokenSnapshots.params.parse({
      after: {
        timestamp: "2026-01-01T00:00:00.000Z",
        triggerBlockNumber: 5,
        trigger: "NewPeriod",
        rowKey: "token-1",
      },
    });
    expect(good.after?.triggerBlockNumber).toBe(5);
    expect(good.after?.rowKey).toBe("token-1");

    expect(() =>
      catalogue.tokenSnapshots.params.parse({
        after: {
          timestamp: "not-a-date",
          triggerBlockNumber: 5,
          trigger: "NewPeriod",
          rowKey: "token-1",
        },
      }),
    ).toThrow();
  });

  it("rejects a snapshot watermark missing the identity legs", () => {
    // The leading (timestamp, triggerBlockNumber) pair is NOT unique, so a
    // two-part cursor cannot address a position inside a NewPeriod group.
    // Rejecting it here is what forces the fetcher to restart rather than
    // silently skip the rest of the group.
    expect(() =>
      catalogue.tokenSnapshots.params.parse({
        after: { timestamp: "2026-01-01T00:00:00.000Z", triggerBlockNumber: 5 },
      }),
    ).toThrow();
  });

  it("tokensById requires a non-empty id list", () => {
    expect(() => catalogue.tokensById.params.parse({ ids: [] })).toThrow();
  });

  it("rejects unknown parameter keys on every entry (strict schemas)", () => {
    // A misspelled filter must reject loudly, never silently widen a read.
    expect(() =>
      catalogue.pool.params.parse({ poolId: "1", poolID: "2" }),
    ).toThrow();
    expect(() => catalogue.pools.params.parse({ isActiv: true })).toThrow();
    expect(() => catalogue.deployments.params.parse({ chainId: 1 })).toThrow();
    expect(() =>
      catalogue.investorTransactions.params.parse({
        after: {
          blockNumber: 1,
          txHash: `0x${"ab".repeat(32)}`,
          logIndex: 0,
          extra: true,
        },
      }),
    ).toThrow();
    expect(() =>
      catalogue.tokenSnapshots.params.parse({ unknown: 1 }),
    ).toThrow();
  });

  it("covers every catalogue entry, reads and table heads", () => {
    const names: QueryName[] = [
      "pool",
      "pools",
      "deployments",
      "poolManagers",
      "whitelistedInvestors",
      "investorTransactions",
      "tokenSnapshots",
      "holdingEscrowSnapshots",
      "tokensById",
      // Tokenizations: the two entries with their own REST routes.
      "blockchains",
      "tokenInstances",
      // Holdings: the two routed reads, plus the manager projection the
      // manager-sourced deposit/withdraw branch validates against.
      "holdingEscrows",
      "assetRegistrations",
      "onOffRampManagers",
      // Vaults: the vault list `allVaults` is routed onto, plus the blocked
      // per-investor investment entry (contract real, source missing).
      "vaults",
      "vaultInvestment",
      // NAV: the raw snapshot rows behind the two pool reports, plus
      // the share-class row the price WRITE path divides a total NAV by.
      "shareClass",
      "sharePriceSnapshots",
      "shareYieldSnapshots",
      // Investors: the merged whitelist x position views `holders()` /
      // `whitelistedHolders()` are routed onto, the pool-scoped positions
      // read, and the blocked transaction history (its source column is
      // projected with the wrong bytes32 address convention).
      "shareClassInvestors",
      "shareClassInvestor",
      "investorPositions",
      "poolInvestorTransactions",
      // Orders (redeem reads): the two aggregate entries that serve, and the
      // two per-investor ones that refuse because `account` is projected with
      // the wrong bytes32 convention. `allVaults` is NOT here — the `vaults`
      // entry already covers it (see its doc comment).
      "epochOutstandingRedeem",
      "epochRedeemOrders",
      "redeemOrderState",
      "redeemOrderClaims",
      // Orders (invest reads): the mirror, same split — two aggregate serve and
      // two per-investor ones refuse, on `invest_order.account` /
      // `pending_invest_order.account` rather than the redeem pair. Both sides
      // wait on ONE Embrio decode fix.
      "epochOutstandingInvest",
      "epochInvestOrders",
      "investOrderState",
      "investOrderClaims",
      // Pool access: the adapter route state behind `pool.adapterStatus()`
      // and the two crosschain payload reads. All three are pool-scoped, which
      // for the crosschain pair is an authorization boundary rather than a
      // filter.
      "poolAdapters",
      "crosschainMessages",
      "crosschainMessage",
      // Basin: the four remaining catalogue-consuming reads of the vertical
      // (`onOffRampManagers` is listed under holdings, above). The vertical's
      // other eleven reads consume no entry in either mode — contract reads
      // over RPC and IPFS-composed workflow metadata — so they have nothing to
      // bind to here; see `basin.controller.ts`.
      "merkleProofManagers",
      "offRampAddresses",
      "onOffRampRelayers",
      "onRampAssets",
      // Basin: the six Grove/Basin reads the management app moved off api-v3's
      // raw GraphQL (apps-gobal-epic-and-issues#97). Distinct from the four
      // above, which are the on/off-ramp manager configuration.
      "basinDebt",
      "basinDebtChanges",
      "basinFees",
      "basinSwaps",
      "basinRedeemRequests",
      "basinRedeemOrder",
      // Table heads, for projection-rebuild detection.
      "investorTransactionsHead",
      "tokenSnapshotsHead",
      "holdingEscrowSnapshotsHead",
    ];
    expect(Object.keys(catalogue).sort()).toEqual([...names].sort());
  });

  it("bounds the whole-table snapshot reads with an optional limit", () => {
    // The snapshot-diff consumers pass their safety cap + 1 so an overrun is
    // detectable without materialising an unbounded result set.
    expect(catalogue.poolManagers.params.parse({ limit: 100_001 }).limit).toBe(
      100_001,
    );
    expect(
      catalogue.whitelistedInvestors.params.parse({}).limit,
    ).toBeUndefined();
    expect(() => catalogue.poolManagers.params.parse({ limit: 0 })).toThrow();
    expect(() =>
      catalogue.whitelistedInvestors.params.parse({ limit: 2_000_000 }),
    ).toThrow();
  });

  it("blockchains takes no parameters and rejects any", () => {
    expect(catalogue.blockchains.params.parse({})).toEqual({});
    expect(() =>
      catalogue.blockchains.params.parse({ centrifugeId: "1" }),
    ).toThrow();
  });

  it("vaults requires a bytes16 token id and takes an optional network", () => {
    const tokenId = "0x00010000000000010001000000000001";
    expect(catalogue.vaults.params.parse({ tokenId })).toEqual({ tokenId });
    expect(
      catalogue.vaults.params.parse({ tokenId, centrifugeId: "2" }),
    ).toEqual({ tokenId, centrifugeId: "2" });
    expect(() => catalogue.vaults.params.parse({})).toThrow();
    expect(() => catalogue.vaults.params.parse({ tokenId: "0xabc" })).toThrow();
    // No page bound: a share class has a handful of vaults and the SDK reads
    // the whole set, so a `limit` would only be a way to truncate it.
    expect(() =>
      catalogue.vaults.params.parse({ tokenId, limit: 10 }),
    ).toThrow();
  });

  it("vaultInvestment validates both addresses even though it is blocked", () => {
    const vaultAddress = "0x19f46D8130e610C6C0f0116EA40Fb781dEFaDE93";
    const investorAddress = "0x000000000000000000000000000000000000dEaD";
    expect(
      catalogue.vaultInvestment.params.parse({ vaultAddress, investorAddress }),
    ).toEqual({ vaultAddress, investorAddress });
    // The contract is real even while the source is missing, so a caller typo
    // is still a caller error and not masked by the gap.
    expect(() =>
      catalogue.vaultInvestment.params.parse({
        vaultAddress: "0xnothex",
        investorAddress,
      }),
    ).toThrow();
    expect(() =>
      catalogue.vaultInvestment.params.parse({ vaultAddress }),
    ).toThrow();
  });

  it("shareClassInvestors defaults to the widest status and refuses an invented one", () => {
    const tokenId = "0x00010000000000010001000000000001";
    // `all` by default: the union is the safest answer to a caller who did not
    // narrow, and it is the tab the management app opens on.
    expect(catalogue.shareClassInvestors.params.parse({ tokenId })).toEqual({
      tokenId,
      status: "all",
      excludedAddresses: [],
      limit: 100,
      offset: 0,
    });
    // A misspelled status must be a 422, never a silent widening to `all` —
    // a caller who asked for `frozen` and got everyone would act on it.
    expect(() =>
      catalogue.shareClassInvestors.params.parse({ tokenId, status: "active" }),
    ).toThrow();
    expect(() =>
      catalogue.shareClassInvestors.params.parse({ tokenId, limit: 1001 }),
    ).toThrow();
    expect(() =>
      catalogue.shareClassInvestors.params.parse({ tokenId, offset: -1 }),
    ).toThrow();
    // The exclusion list is addresses, not arbitrary strings: a typo'd entry
    // would silently exclude nobody and list a protocol account as an investor.
    expect(() =>
      catalogue.shareClassInvestors.params.parse({
        tokenId,
        excludedAddresses: ["0xnope"],
      }),
    ).toThrow();
  });

  it("shareClassInvestor requires the full (tokenId, centrifugeId, address) key", () => {
    const tokenId = "0x00010000000000010001000000000001";
    const accountAddress = "0x000000000000000000000000000000000000dEaD";
    expect(
      catalogue.shareClassInvestor.params.parse({
        tokenId,
        centrifugeId: "1",
        accountAddress,
      }),
    ).toEqual({ tokenId, centrifugeId: "1", accountAddress });
    // The three columns are the table's primary key; dropping the network
    // would make the read ambiguous for an address that holds on two chains.
    expect(() =>
      catalogue.shareClassInvestor.params.parse({ tokenId, accountAddress }),
    ).toThrow();
    expect(() =>
      catalogue.shareClassInvestor.params.parse({
        tokenId,
        centrifugeId: "1",
        accountAddress: "0xnothex",
      }),
    ).toThrow();
  });

  it("investorPositions is pool-scoped and paged", () => {
    const accountAddress = "0x000000000000000000000000000000000000dEaD";
    expect(
      catalogue.investorPositions.params.parse({
        poolId: "281474976710657",
        accountAddress,
      }),
    ).toEqual({
      poolId: "281474976710657",
      accountAddress,
      limit: 100,
      offset: 0,
    });
    // Pool-scoped, always: `token_instance_position` carries no pool id, so
    // dropping the scope would return the address's holdings in every pool.
    expect(() =>
      catalogue.investorPositions.params.parse({ accountAddress }),
    ).toThrow();
  });

  it("poolInvestorTransactions validates its params even though it is blocked", () => {
    const accountAddress = "0x000000000000000000000000000000000000dEaD";
    expect(
      catalogue.poolInvestorTransactions.params.parse({
        poolId: "281474976710657",
        accountAddress,
      }),
    ).toEqual({
      poolId: "281474976710657",
      accountAddress,
      limit: 100,
      offset: 0,
    });
    // Same rule as `vaultInvestment`: the contract is real while the source is
    // unusable, so a caller typo is still a caller error.
    expect(() =>
      catalogue.poolInvestorTransactions.params.parse({
        poolId: "281474976710657",
        accountAddress: "0xnothex",
      }),
    ).toThrow();
  });

  it("epochOutstandingInvest takes a token id and an optional asset", () => {
    const tokenId = "0x00010000000000010001000000000001";
    expect(catalogue.epochOutstandingInvest.params.parse({ tokenId })).toEqual({
      tokenId,
    });
    // The real mainnet asset id, spelled as `chain_v1` stores it. Kept as a
    // STRING through the whole path: `numeric(78,0)` does not survive JSON —
    // `row_to_json` emits a bare number and this value parses to 5.19e+33.
    expect(
      catalogue.epochOutstandingInvest.params.parse({
        tokenId,
        assetId: "5192296858534827628530496329220097",
      }),
    ).toEqual({ tokenId, assetId: "5192296858534827628530496329220097" });
    expect(() => catalogue.epochOutstandingInvest.params.parse({})).toThrow();
    expect(() =>
      catalogue.epochOutstandingInvest.params.parse({
        tokenId,
        assetId: "0x1",
      }),
    ).toThrow();
    // One row per asset of the share class: a page bound could only truncate
    // the set the approval ceiling is read from.
    expect(() =>
      catalogue.epochOutstandingInvest.params.parse({ tokenId, limit: 10 }),
    ).toThrow();
  });

  it("epochInvestOrders accepts a NON-POSITIVE epoch index, unlike the redeem entry", () => {
    const tokenId = "0x00010000000000010001000000000001";
    expect(catalogue.epochInvestOrders.params.parse({ tokenId })).toEqual({
      tokenId,
      limit: 1000,
      offset: 0,
    });
    // The one place the invest entry deliberately diverges from its redeem
    // mirror, measured rather than assumed: `applySyncDepositMutation` numbers
    // SYNC
    // epochs `-count`, so `chain_v1.epoch_invest_order.index` runs down to -9
    // on live v4 mainnet (36 of 465 rows) while
    // `epoch_redeem_order.index` starts at 1. Copying the redeem entry's
    // `nonnegative()` would reject a legitimate filter for a sync epoch.
    expect(
      catalogue.epochInvestOrders.params.parse({ tokenId, index: -9 }).index,
    ).toBe(-9);
    expect(
      catalogue.epochInvestOrders.params.parse({ tokenId, index: 0 }).index,
    ).toBe(0);
    // Still an INTEGER: a fractional index is a caller error either way.
    expect(() =>
      catalogue.epochInvestOrders.params.parse({ tokenId, index: -1.5 }),
    ).toThrow();
    expect(() =>
      catalogue.epochInvestOrders.params.parse({ tokenId, limit: 1001 }),
    ).toThrow();
  });

  it("investOrderState validates its params even though it is blocked", () => {
    const tokenId = "0x00010000000000010001000000000001";
    expect(catalogue.investOrderState.params.parse({ tokenId })).toEqual({
      tokenId,
      limit: 1000,
    });
    expect(() =>
      catalogue.investOrderState.params.parse({ tokenId: "0xabc" }),
    ).toThrow();
  });

  it("investOrderClaims requires the full (tokenId, assetId, address) key", () => {
    const tokenId = "0x00010000000000010001000000000001";
    const accountAddress = "0x000000000000000000000000000000000000dEaD";
    const assetId = "5192296858534827628530496329220097";
    expect(
      catalogue.investOrderClaims.params.parse({
        tokenId,
        assetId,
        accountAddress,
      }),
    ).toEqual({ tokenId, assetId, accountAddress });
    // The contract's own key is `(poolId, scId, investor, assetId)`; dropping
    // the asset would count another asset's backlog into this one's maxClaims.
    expect(() =>
      catalogue.investOrderClaims.params.parse({ tokenId, accountAddress }),
    ).toThrow();
    expect(() =>
      catalogue.investOrderClaims.params.parse({
        tokenId,
        assetId,
        accountAddress: "0xnothex",
      }),
    ).toThrow();
  });

  it("epochOutstandingRedeem takes a token id and an optional asset", () => {
    const tokenId = "0x00010000000000010001000000000001";
    expect(catalogue.epochOutstandingRedeem.params.parse({ tokenId })).toEqual({
      tokenId,
    });
    expect(
      catalogue.epochOutstandingRedeem.params.parse({
        tokenId,
        assetId: "5192296858534827628530496329220097",
      }),
    ).toEqual({ tokenId, assetId: "5192296858534827628530496329220097" });
    expect(() => catalogue.epochOutstandingRedeem.params.parse({})).toThrow();
    // uint128 decimal, never hex: `chain_v1` stores asset ids numerically and
    // a hex id would silently match nothing.
    expect(() =>
      catalogue.epochOutstandingRedeem.params.parse({
        tokenId,
        assetId: "0x1",
      }),
    ).toThrow();
    // One row per asset of the share class: a page bound could only truncate
    // the set the approval ceiling is read from.
    expect(() =>
      catalogue.epochOutstandingRedeem.params.parse({ tokenId, limit: 10 }),
    ).toThrow();
  });

  it("epochRedeemOrders defaults to the SDK's page size, not the backend's", () => {
    const tokenId = "0x00010000000000010001000000000001";
    // 1000, matching `sdkCatalogue.epochRedeemOrders` and the graphql
    // adapter's `first: 1000`. A default of 100 would make backend mode return
    // ten times fewer epochs than public mode for the same call, and the
    // revoke arithmetic walks epochs — a short page moves the epoch a write is
    // built against, it does not merely shorten a list.
    expect(catalogue.epochRedeemOrders.params.parse({ tokenId })).toEqual({
      tokenId,
      limit: 1000,
      offset: 0,
    });
    expect(
      catalogue.epochRedeemOrders.params.parse({ tokenId, index: 0 }).index,
    ).toBe(0);
    expect(() =>
      catalogue.epochRedeemOrders.params.parse({ tokenId, limit: 1001 }),
    ).toThrow();
    expect(() =>
      catalogue.epochRedeemOrders.params.parse({ tokenId, index: -1 }),
    ).toThrow();
    expect(() =>
      catalogue.epochRedeemOrders.params.parse({ tokenId, index: 1.5 }),
    ).toThrow();
  });

  it("redeemOrderState validates its params even though it is blocked", () => {
    const tokenId = "0x00010000000000010001000000000001";
    expect(catalogue.redeemOrderState.params.parse({ tokenId })).toEqual({
      tokenId,
      limit: 1000,
    });
    // Same rule as `vaultInvestment` and `poolInvestorTransactions`: the
    // contract is real while the source is unusable.
    expect(() =>
      catalogue.redeemOrderState.params.parse({ tokenId: "0xabc" }),
    ).toThrow();
  });

  it("redeemOrderClaims requires the full (tokenId, assetId, address) key", () => {
    const tokenId = "0x00010000000000010001000000000001";
    const accountAddress = "0x000000000000000000000000000000000000dEaD";
    const assetId = "5192296858534827628530496329220097";
    expect(
      catalogue.redeemOrderClaims.params.parse({
        tokenId,
        assetId,
        accountAddress,
      }),
    ).toEqual({ tokenId, assetId, accountAddress });
    // The contract's own key is `(poolId, scId, investor, assetId)`; dropping
    // the asset would count another asset's backlog into this one's maxClaims.
    expect(() =>
      catalogue.redeemOrderClaims.params.parse({ tokenId, accountAddress }),
    ).toThrow();
    expect(() =>
      catalogue.redeemOrderClaims.params.parse({
        tokenId,
        assetId,
        accountAddress: "0xnothex",
      }),
    ).toThrow();
  });

  it("tokenInstances requires a bytes16 hex token id", () => {
    const tokenId = "0x00010000000000010001000000000001";
    expect(catalogue.tokenInstances.params.parse({ tokenId })).toEqual({
      tokenId,
    });
    expect(() => catalogue.tokenInstances.params.parse({})).toThrow();
    expect(() =>
      catalogue.tokenInstances.params.parse({ tokenId: "0xabc" }),
    ).toThrow();
    expect(() =>
      catalogue.tokenInstances.params.parse({ tokenId, limit: 10 }),
    ).toThrow();
  });

  it("holdingEscrows requires a bytes16 hex token id and takes no page bound", () => {
    const tokenId = "0x00010000000000010001000000000001";
    expect(catalogue.holdingEscrows.params.parse({ tokenId })).toEqual({
      tokenId,
    });
    expect(() => catalogue.holdingEscrows.params.parse({})).toThrow();
    expect(() =>
      catalogue.holdingEscrows.params.parse({ tokenId: "0xabc" }),
    ).toThrow();
    // A page bound would let a truncated read drop a holding from a balance
    // sheet without saying so.
    expect(() =>
      catalogue.holdingEscrows.params.parse({ tokenId, limit: 10 }),
    ).toThrow();
  });

  it("assetRegistrations requires the hub centrifugeId", () => {
    expect(
      catalogue.assetRegistrations.params.parse({ centrifugeId: "1" }),
    ).toEqual({ centrifugeId: "1" });
    expect(() => catalogue.assetRegistrations.params.parse({})).toThrow();
    // The spoke filter is `asset.centrifugeId`, applied entity-side — not a
    // parameter of this entry.
    expect(() =>
      catalogue.assetRegistrations.params.parse({
        centrifugeId: "1",
        spokeId: "2",
      }),
    ).toThrow();
    expect(() =>
      catalogue.assetRegistrations.params.parse({ centrifugeId: "0x1" }),
    ).toThrow();
  });

  it("refuses a non-canonical centrifugeId on every entry that takes one", () => {
    // `centrifuge_id` is filtered as TEXT in `chain_v1`, so `'02'` and `'007'`
    // match no row: a plain digit run here would produce a silently empty
    // result, which a caller cannot tell from "this network has nothing". The
    // HTTP DTOs one layer up answer it the same way — refuse rather than
    // normalise, because a caller who wrote `"02"` made a typo and rewriting
    // it hides that from the audit row.
    const tokenId = "0x00010000000000010001000000000001";

    for (const centrifugeId of ["02", "007", "0", "00", "+1", " 1", "1 ", ""]) {
      expect(
        catalogue.assetRegistrations.params.safeParse({ centrifugeId }).success,
      ).toBe(false);
      expect(
        catalogue.vaults.params.safeParse({ tokenId, centrifugeId }).success,
      ).toBe(false);
      expect(
        catalogue.onOffRampManagers.params.safeParse({ tokenId, centrifugeId })
          .success,
      ).toBe(false);
    }

    // The canonical spellings still pass, multi-digit included: the param
    // constrains the SPELLING, not the numeric range.
    for (const centrifugeId of ["1", "2", "247", "65535"]) {
      expect(
        catalogue.assetRegistrations.params.parse({ centrifugeId }),
      ).toEqual({ centrifugeId });
    }
  });

  it("aliases a leading-zero id onto a different one, which is why it is refused", () => {
    // The mechanism, pinned rather than described. Every `poolId` and `assetId`
    // in `sql-queries.ts` reaches `chain_v1` through `BigInt(params.x)`, and
    // `BigInt` accepts leading zeros silently. Unrefused, `/pools/007` is
    // neither an error nor an empty result — it is pool 7's answer under pool
    // 007's
    // URL. If this assertion ever fails, the reasoning behind the regexes below
    // has changed and they should be re-argued rather than kept out of habit.
    expect(BigInt("007")).toBe(7n);
    expect(BigInt("0")).toBe(0n);
  });

  it("refuses a non-canonical poolId on every entry that takes one", () => {
    const tokenId = "0x00010000000000010001000000000001";
    const poolIdOnly = ["pool", "merkleProofManagers"] as const;

    for (const poolId of ["007", "01", "00", "0007", "+1", " 1", "1 ", ""]) {
      for (const entry of poolIdOnly) {
        expect(catalogue[entry].params.safeParse({ poolId }).success).toBe(
          false,
        );
      }
      // Optional and array-shaped occurrences count too: `pools` takes an
      // `ids` array and `poolManagers` an optional filter, and an unchecked id
      // inside either is the same alias one level down.
      expect(catalogue.pools.params.safeParse({ ids: [poolId] }).success).toBe(
        false,
      );
      expect(catalogue.poolManagers.params.safeParse({ poolId }).success).toBe(
        false,
      );
      expect(
        catalogue.sharePriceSnapshots.params.safeParse({ poolId, tokenId })
          .success,
      ).toBe(false);
      expect(
        catalogue.crosschainMessages.params.safeParse({ poolId }).success,
      ).toBe(false);
      expect(
        catalogue.poolAdapters.params.safeParse({
          poolId,
          localCentrifugeId: "1",
          remoteCentrifugeId: "2",
        }).success,
      ).toBe(false);
    }

    // `"0"` is NOT a leading-zero spelling and stays valid: it is a
    // representable pool id, and `poolIdFromShareClassId` in `rest/routes.ts`
    // produces exactly it for the zero share-class id. Refusing it would break
    // that derivation for no stated reason.
    for (const poolId of ["0", "1", "281474976710657"]) {
      expect(catalogue.pool.params.parse({ poolId })).toEqual({ poolId });
    }
  });

  it("refuses a non-canonical assetId on every entry that takes one", () => {
    const tokenId = "0x00010000000000010001000000000001";
    const accountAddress = `0x${"11".repeat(20)}`;

    for (const assetId of ["007", "01", "00", "+1", " 1", ""]) {
      expect(
        catalogue.epochOutstandingInvest.params.safeParse({ tokenId, assetId })
          .success,
      ).toBe(false);
      expect(
        catalogue.epochInvestOrders.params.safeParse({ tokenId, assetId })
          .success,
      ).toBe(false);
      expect(
        catalogue.epochOutstandingRedeem.params.safeParse({ tokenId, assetId })
          .success,
      ).toBe(false);
      expect(
        catalogue.epochRedeemOrders.params.safeParse({ tokenId, assetId })
          .success,
      ).toBe(false);
      expect(
        catalogue.investOrderClaims.params.safeParse({
          tokenId,
          assetId,
          accountAddress,
        }).success,
      ).toBe(false);
      expect(
        catalogue.redeemOrderClaims.params.safeParse({
          tokenId,
          assetId,
          accountAddress,
        }).success,
      ).toBe(false);
    }

    for (const assetId of [
      "0",
      "42",
      "340282366920938463463374607431768211455",
    ]) {
      expect(
        catalogue.epochInvestOrders.params.parse({ tokenId, assetId }),
      ).toMatchObject({ assetId });
    }
  });

  it("tokensById takes token ids, not any non-empty string", () => {
    // A looser `z.string().min(1)` would let `ids: ["oops"]` parse and come
    // back empty. Every caller passes a DTO-validated bytes16, so the strict
    // spelling costs nothing and says what the entry means.
    expect(
      catalogue.tokensById.params.safeParse({ ids: ["oops"] }).success,
    ).toBe(false);
    expect(catalogue.tokensById.params.safeParse({ ids: [] }).success).toBe(
      false,
    );

    const ids = ["0x00010000000000010001000000000001"];
    expect(catalogue.tokensById.params.parse({ ids })).toEqual({ ids });
  });

  it("deployments takes a centrifugeId spelled like every other entry's", () => {
    // Modelled as a canonical string like every other `centrifugeId` param,
    // so a caller reads the shape rather than remembering that one entry
    // wants `1` and not `"1"`.
    expect(catalogue.deployments.params.parse({ centrifugeId: "1" })).toEqual({
      centrifugeId: "1",
    });
    expect(
      catalogue.deployments.params.safeParse({ centrifugeId: 1 }).success,
    ).toBe(false);
    expect(
      catalogue.deployments.params.safeParse({ centrifugeId: "01" }).success,
    ).toBe(false);
    // Still optional, which is the only shape a live caller uses today
    // (`get-whitelisting-support.use-case.ts` passes `protocolVersion` alone).
    expect(
      catalogue.deployments.params.parse({ protocolVersion: "3.2" }),
    ).toEqual({ protocolVersion: "3.2" });
  });

  it("onOffRampManagers requires both the token id and the network", () => {
    const tokenId = "0x00010000000000010001000000000001";
    expect(
      catalogue.onOffRampManagers.params.parse({ tokenId, centrifugeId: "2" }),
    ).toEqual({ tokenId, centrifugeId: "2" });
    expect(() =>
      catalogue.onOffRampManagers.params.parse({ tokenId }),
    ).toThrow();
    expect(() =>
      catalogue.onOffRampManagers.params.parse({ centrifugeId: "2" }),
    ).toThrow();
  });

  it("merkleProofManagers is keyed by the POOL, not the share class", () => {
    // The distinction is the reason this entry needs its own route shape: a
    // merkle-proof manager authorises strategist workflows for a whole pool on
    // one spoke, so `chain_v1.merkle_proof_manager` carries `pool_id` and no
    // `token_id`. Passing a share class id here must reject rather than be
    // ignored, which would widen the read to the whole pool silently.
    expect(
      catalogue.merkleProofManagers.params.parse({
        poolId: "281474976710662",
        centrifugeId: "1",
      }),
    ).toEqual({ poolId: "281474976710662", centrifugeId: "1" });
    expect(() =>
      catalogue.merkleProofManagers.params.parse({ poolId: "1" }),
    ).toThrow();
    expect(() =>
      catalogue.merkleProofManagers.params.parse({ centrifugeId: "1" }),
    ).toThrow();
    expect(() =>
      catalogue.merkleProofManagers.params.parse({
        poolId: "1",
        centrifugeId: "1",
        tokenId: "0x00010000000000010001000000000001",
      }),
    ).toThrow();
    // A pool id is a uint64 DECIMAL string here, as every other entry spells
    // it; hex would silently read a different pool.
    expect(() =>
      catalogue.merkleProofManagers.params.parse({
        poolId: "0x1",
        centrifugeId: "1",
      }),
    ).toThrow();
  });

  it("the three ramp entries all require the token id and the network", () => {
    const tokenId = "0x00010000000000060000000000000001";
    for (const entry of [
      catalogue.offRampAddresses,
      catalogue.onOffRampRelayers,
      catalogue.onRampAssets,
    ]) {
      expect(entry.params.parse({ tokenId, centrifugeId: "11" })).toEqual({
        tokenId,
        centrifugeId: "11",
      });
      // No "every network" variant: a ramp configuration is per-spoke, and a
      // merged list would mix two spokes' receivers into one set.
      expect(() => entry.params.parse({ tokenId })).toThrow();
      expect(() => entry.params.parse({ centrifugeId: "11" })).toThrow();
      // `is_enabled` is a column, not a parameter — the frozen shapes do not
      // declare it and the SDK does not filter on it, so accepting it here
      // would let a caller narrow a read that public mode cannot narrow.
      expect(() =>
        entry.params.parse({ tokenId, centrifugeId: "11", isEnabled: true }),
      ).toThrow();
      // A bytes16 share class id, not a bytes32 and not a pool id.
      expect(() =>
        entry.params.parse({
          tokenId: `0x${"11".repeat(32)}`,
          centrifugeId: "11",
        }),
      ).toThrow();
    }
  });

  it("the head entries take no parameters and reject any", () => {
    expect(catalogue.investorTransactionsHead.params.parse({})).toEqual({});
    expect(() =>
      catalogue.tokenSnapshotsHead.params.parse({ limit: 1 }),
    ).toThrow();
    expect(() =>
      catalogue.holdingEscrowSnapshotsHead.params.parse({ after: {} }),
    ).toThrow();
  });
});
