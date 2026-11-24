import { encodeFunctionData, type Address } from "viem";

import {
  BuilderArgumentMismatchError,
  UnsupportedForProtocolVersionError,
} from "../errors";
import { MessageType, type CrosschainMessage } from "../messages";
import {
  PROTOCOL_VERSION_V3_3,
  type BuiltProtocolCall,
  type ProtocolCall,
  type ProtocolContext,
} from "../types";
import { encodeBatchCalldata } from "./batch";
import { requireAddress, requireBytes16 } from "./create-holding";
import {
  encodeBatchRequestManagerPayload,
  hubManagerCall,
  type BatchRequestManagerPayload,
} from "./manager-call";
import { parseAmount, parseUint128, parseUint256 } from "./money";

/**
 * The centrifugeId encoded in the high 16 bits of a uint128 asset id.
 *
 * Mirrors the SDK's `AssetId.centrifugeId` getter (`id >> 112n`,
 * `packages/sdk/src/utils/types.ts:94`). Structural, so it needs no projection
 * read: the asset id itself says which spoke the asset lives on, which is the
 * network `BatchRequestManager`'s `RequestCallback` is addressed to.
 *
 * `0` means a national currency (`AssetId.isNationalCurrency`), which is not a
 * network. Such an asset never routes a callback anywhere, so it contributes no
 * message — see {@link messageDestinationFor}.
 */
export function centrifugeIdFromAssetId(assetId: string | bigint): number {
  return Number(BigInt(assetId) >> 112n);
}

/**
 * The investor argument of `notifyDeposit` / `notifyRedeem`: a 20-byte address
 * as the protocol's RIGHT-padded `bytes32`.
 *
 * ## The padding direction is the whole point of this function
 *
 * The protocol stores the investor RIGHT-padded — `CastLib.toBytes32(address)`
 * is `bytes32(bytes20(addr))`, which zero-fills the LOW 12 bytes, and its
 * inverse `CastLib.toAddress` is `address(bytes20(addr))` guarded by
 * `require(uint96(uint256(addr)) == 0, PrefixNotZero())`, i.e. the low 12 bytes
 * are ASSERTED zero on chain and the address is the LEADING 20 bytes
 * (`centrifuge-v3/src/misc/libraries/CastLib.sol:18-24`). The SDK's
 * `addressToBytes32` is `address.padEnd(66, "0")`, the same direction.
 *
 * The EVM-word convention is the opposite one (`bytes32(uint256(uint160(addr)))`
 * puts the address in the LOW 20 bytes), and `CastLib` carries that variant too
 * as `toBytes32LeftPadded` / `toAddressLeftPadded` — used only by
 * `LayerZeroAdapter`. Mixing the two is not a cosmetic error: a left-padded
 * value keys a DIFFERENT, empty `UserOrder` in
 * `redeemRequest[poolId][scId][assetId][investor]`, so `notifyRedeem` reverts
 * `NoOrderFound()` (`BatchRequestManager.sol:631`) — or, worse, silently
 * notifies nothing if the order happened to exist. This same convention has now
 * produced two live bugs in two codebases in opposite directions (ours, fixed at
 * `38a86aa`; Embrio's corrupted `chain_v1.redeem_order.account`), which is why
 * the direction is encoded once here with the contract quoted, rather than at
 * each call site.
 *
 * Lowercased, matching the SDK, so a checksummed and an unchecksummed spelling
 * of one investor produce identical calldata.
 */
export function addressToBytes32(value: string, field: string): `0x${string}` {
  const address = requireAddress(value, field);

  return `0x${address.slice(2).toLowerCase()}${"0".repeat(24)}` as `0x${string}`;
}

/**
 * One epoch-aggregate deposit approval — `approveDeposits` for ONE asset and
 * ONE epoch.
 *
 * Single-epoch by construction, not by choice: `approveDeposits` requires
 * `nowDepositEpochId == nowDepositEpoch(...)` (`BatchRequestManager.sol:203`),
 * so exactly one epoch is approvable at a time and a range would be a contract
 * nobody can call.
 */
export interface DepositApproval {
  /** Asset id (uint128 decimal string). */
  readonly assetId: string;
  /**
   * The epoch being approved (uint32 decimal string) — the chain's
   * `nowDepositEpoch` for this `(scId, assetId)`.
   *
   * Explicit and never derived, for the reason `computedAt` and
   * `notifyNetworks` are: the calldata is built once at preview and again at
   * prepare, and an epoch read from mutable state would let the two disagree on
   * `data` — which, unlike `value`, DOES reach dual-channel verification and
   * rejects a legitimate transaction. The chain refuses a stale
   * value with `EpochNotInSequence`, and `private-api` refuses it earlier
   * against the projection, so an epoch that advanced between preview and
   * prepare surfaces as a refusal instead of as different bytes.
   */
  readonly epochId: string;
  /**
   * Assets approved for this epoch, in the ASSET's smallest unit, as a decimal
   * string of the on-chain integer.
   *
   * AGGREGATE, not per investor: the chain bounds it by
   * `pendingDeposit[poolId][scId][assetId]`, a mapping with no investor key, and
   * `_claimDeposit` splits it pro rata later. Never a number — a uint128 does
   * not survive one — and never zero (`ZeroApprovalAmount()` on chain).
   */
  readonly approvedAssetAmount: string;
  /**
   * The asset-per-pool-currency price the approval settles at, as a decimal
   * string of the on-chain `D18` integer (18-decimal fixed point).
   *
   * A DIFFERENT price axis from the `pricePoolPerShare` of {@link ShareIssuance}
   * — this one converts between the asset and the pool currency. Refused when
   * zero: `_claimDeposit` treats a zero `pricePoolPerAsset` as "pay out
   * nothing", so a zero here would approve a real deposit against no value.
   */
  readonly pricePoolPerAsset: string;
}

/**
 * One epoch-aggregate redeem approval — `approveRedeems` for ONE asset and ONE
 * epoch. Single-epoch for the same reason {@link DepositApproval} is
 * (`EpochNotInSequence`, `BatchRequestManager.sol:254`).
 */
export interface RedeemApproval {
  /** Asset id (uint128 decimal string). */
  readonly assetId: string;
  /** See {@link DepositApproval.epochId}; the chain's `nowRedeemEpoch` here. */
  readonly epochId: string;
  /**
   * Shares approved for this epoch, in the SHARE token's smallest unit, as a
   * decimal string.
   *
   * Aggregate, bounded on chain by `pendingRedeem[poolId][scId][assetId]`
   * (`require(approvedShareAmount <= pendingShareAmount, InsufficientPending())`,
   * `BatchRequestManager.sol:269`). `private-api` reads the same ceiling out of
   * the projection first, so an over-approval is a 422 rather than a revert
   * after the signing ceremony.
   */
  readonly approvedShareAmount: string;
  /** See {@link DepositApproval.pricePoolPerAsset}. */
  readonly pricePoolPerAsset: string;
}

/**
 * One asset's PAGE of share issuances — `issueShares` for a contiguous run of
 * epochs.
 *
 * This is where {@link issueShares}'s explicit pagination lives, and it is
 * forced rather than stylistic. `issueShares` dispatches one paid
 * `RequestCallback` per epoch, and the EFFECTIVE cap on a measured live route
 * is 2,996,000 gas — six `RequestCallback` messages at 487,788 each — against
 * a declared `maxBatchGasLimit` of 10,000,000, while the SDK budgets 42 from
 * the fictional `GAS_LIMIT = 30_000_000n`. So the number of epochs in one
 * transaction is a decision the caller must be able to make and the chain must
 * be able to refuse; deriving it from a constant is how the SDK gets it ~5x
 * wrong.
 *
 * `fromEpochId` is the page OFFSET and `pricesPoolPerShare.length` is the page
 * LIMIT. There is deliberately no "issue every outstanding epoch" form: that
 * shape would make the message count a function of mutable projection state, so
 * preview and prepare could encode different `data`.
 */
export interface ShareIssuance {
  /** Asset id (uint128 decimal string). */
  readonly assetId: string;
  /**
   * The first epoch of the page (uint32 decimal string) — the chain's
   * `nowIssueEpoch`. See {@link DepositApproval.epochId} for why it is explicit.
   */
  readonly fromEpochId: string;
  /**
   * One `D18` pool-per-share price per epoch, in epoch order: entry `i` prices
   * epoch `fromEpochId + i`. Its LENGTH is the page size, so a one-element array
   * issues one epoch.
   *
   * One price per epoch rather than one for the page, because each epoch settled
   * against its own NAV and `_issueShares` stores the price it is given into
   * that epoch's `epochInvestAmounts`. Prices are `D18` decimal strings, never
   * numbers, and a zero is refused: `issueShares` with a zero price issues no
   * shares for a real deposit.
   */
  readonly pricesPoolPerShare: readonly string[];
}

/**
 * One asset's PAGE of share revocations — `revokeShares` for a contiguous run
 * of epochs. Identical shape and identical reasoning to {@link ShareIssuance};
 * see there for why the page is explicit.
 *
 * Note `revokeShares` takes NO amount at all: the revoked share amount is read
 * back out of epoch state (`revokedShareAmount = epochAmounts.approvedShareAmount`,
 * `BatchRequestManager.sol:387`), i.e. exactly what `approveRedeems` set. The
 * price is its only economic input, which is why an approve-then-revoke pair
 * must name the same epochs in the same order.
 */
export interface ShareRevocation {
  /** Asset id (uint128 decimal string). */
  readonly assetId: string;
  /** See {@link ShareIssuance.fromEpochId}; the chain's `nowRevokeEpoch` here. */
  readonly fromEpochId: string;
  /** See {@link ShareIssuance.pricesPoolPerShare}. */
  readonly pricesPoolPerShare: readonly string[];
}

/**
 * One investor's notification — a `notifyDeposit` or `notifyRedeem` call.
 *
 * The RESOLVED form: the caller has already turned a page of the claim list
 * into concrete investors. `private-api` owns that resolution (and, today,
 * refuses it — `chain_v1.redeem_order.account` is projected with the wrong
 * `bytes32` convention), so this package stays pure and complete.
 */
export interface OrderNotification {
  /**
   * The investor's 20-byte address. Encoded as the protocol's RIGHT-padded
   * `bytes32` by {@link addressToBytes32} — read that note before changing
   * anything here.
   */
  readonly investor: string;
  /**
   * `maxClaims`: how many consecutive epochs this notification settles, counted
   * from the investor's `lastUpdate`.
   *
   * The chain defines it as backlog depth — `_maxClaims` is
   * `(pending == 0 || lastUpdate > lastEpoch) ? 0 : lastEpoch - lastUpdate + 1`
   * (`BatchRequestManager.sol:754-761`) — and the SDK passes the currently
   * claimable count PLUS the epochs this same transaction revokes, because those
   * epochs exist by the time the notification runs.
   *
   * Zero is refused: `notifyRedeem` with `maxClaims == 0` claims nothing while
   * paying for a cross-chain message, and a silent zero is exactly the failure
   * mode the corrupted `account` column would produce.
   */
  readonly maxClaims: number;
  /**
   * v3.3 only: the request the notification settles (uint256 decimal string),
   * which replaces the investor as the key `notifyDeposit`/`notifyRedeem` take.
   */
  readonly requestId?: string;
}

/** One asset's page of notifications, already resolved to investors. */
export interface OrderNotifyBatch {
  /** Asset id (uint128 decimal string). */
  readonly assetId: string;
  /**
   * The investors to notify, in the caller's order — which is the order the
   * calldata carries, so the caller's list must itself come from a query with an
   * explicit total `ORDER BY`. At most one entry per investor: two
   * notifications for one investor in one batch make the second a no-op that
   * still pays for a message.
   */
  readonly notifications: readonly OrderNotification[];
}

/** Arguments for {@link approveDeposits}. */
export interface ApproveDepositsArgs {
  /** Raw pool id (uint64 decimal string). Must match `ctx.poolId`. */
  readonly poolId: string;
  /** Share-class id (bytes16 hex). */
  readonly scId: string;
  /** One entry per asset, at least one; an asset may appear at most once. */
  readonly approvals: readonly DepositApproval[];
  /**
   * Where unspent cross-chain gas payment is returned.
   *
   * Required whenever any approval routes a message to another network, and
   * refused when none does. `approveDeposits` dispatches one paid
   * `RequestCallback` to the ASSET's network
   * (`hub.requestCallback{value: msgValue()}`, `BatchRequestManager.sol:250`),
   * except when the asset is on the hub's own chain — see
   * {@link messageDestinationFor}. No default, for the same reason every other
   * builder's has none: the signer is unknown at PREVIEW time and the calldata
   * must be byte-identical at preview, prepare and Fordefi's re-derivation. The
   * zero address is a burn, not a default.
   */
  readonly refundAddress?: string;
}

/** Arguments for {@link approveRedeems}. */
export interface ApproveRedeemsArgs {
  /** Raw pool id (uint64 decimal string). Must match `ctx.poolId`. */
  readonly poolId: string;
  /** Share-class id (bytes16 hex). */
  readonly scId: string;
  /** One entry per asset, at least one; an asset may appear at most once. */
  readonly approvals: readonly RedeemApproval[];
}

/** Arguments for {@link issueShares}. */
export interface IssueSharesArgs {
  /** Raw pool id (uint64 decimal string). Must match `ctx.poolId`. */
  readonly poolId: string;
  /** Share-class id (bytes16 hex). */
  readonly scId: string;
  /** One page per asset, at least one; an asset may appear at most once. */
  readonly issuances: readonly ShareIssuance[];
  /**
   * Optional per-investor `notifyDeposit` tail, one entry per asset.
   *
   * Emitted AFTER every issuance, mirroring the SDK's ordering
   * (`ShareClass.ts:975-1001`, gated on `if (i)`): a notification settles the
   * epochs this transaction just issued, so it must run once they exist. An
   * asset named here must also be issued here — notifying epochs that were not
   * issued would pay for a message that claims nothing.
   */
  readonly notify?: readonly OrderNotifyBatch[];
  /** See {@link ApproveDepositsArgs.refundAddress}. */
  readonly refundAddress?: string;
}

/** Arguments for {@link revokeShares}. */
export interface RevokeSharesArgs {
  /** Raw pool id (uint64 decimal string). Must match `ctx.poolId`. */
  readonly poolId: string;
  /** Share-class id (bytes16 hex). */
  readonly scId: string;
  /** One page per asset, at least one; an asset may appear at most once. */
  readonly revocations: readonly ShareRevocation[];
  /**
   * Optional per-investor `notifyRedeem` tail. See
   * {@link IssueSharesArgs.notify}; the redeem mirror of it, and the half that
   * `chain_v1.redeem_order.account` currently blocks.
   */
  readonly notify?: readonly OrderNotifyBatch[];
  /** See {@link ApproveDepositsArgs.refundAddress}. */
  readonly refundAddress?: string;
}

/** Arguments for {@link issueSharesDirect} and {@link revokeSharesDirect}. */
export interface DirectShareArgs {
  /** Raw pool id (uint64 decimal string). Must match `ctx.poolId`. */
  readonly poolId: string;
  /** Share-class id (bytes16 hex). */
  readonly scId: string;
  /**
   * Whose position changes: the recipient of an issuance, or the holder whose
   * shares are revoked.
   *
   * A plain 20-byte `address`, NOT a `bytes32` — `BalanceSheet.issue` and
   * `transferSharesFrom` take addresses, unlike the `bytes32 investor` of the
   * batch path. And caller-supplied rather than projection-derived, which is
   * what keeps these two actions clear of the corrupted `account` column: a
   * direct issuance names its recipient because an operator chose them, not
   * because a query found them.
   */
  readonly address: string;
  /**
   * Shares to issue or revoke, in the SHARE token's smallest unit, as a decimal
   * string of the on-chain integer.
   *
   * The SHARE count, already converted. The SDK accepts a pool-currency AMOUNT
   * and divides by the price (`shares = amount * 10^price.decimals / price`,
   * `BalanceSheet.ts:204-210`); the backend takes the shares directly so the
   * calldata carries no division the caller cannot see. `private-api` records
   * the caller's own inputs in `metadata.args` either way.
   */
  readonly shares: string;
  /**
   * The `D18` pool-per-share price to value the movement at, as a decimal
   * string.
   *
   * Written with `overridePricePoolPerShare` immediately before the movement and
   * cleared with `resetPricePoolPerShare` immediately after. Both use TRANSIENT
   * storage (`TransientStorageLib.tstore`, `BalanceSheet.sol:266-274`), so the
   * override only exists inside this transaction — which is why all three calls
   * must be one multicall and why the reset is not optional housekeeping.
   */
  readonly pricePoolPerShare: string;
}

/** Arguments for {@link revokeSharesDirect}. */
export interface RevokeSharesDirectArgs extends DirectShareArgs {
  /**
   * The address the shares are moved to before being burned — and therefore the
   * address that must SIGN this transaction.
   *
   * `BalanceSheet.revoke` burns from `msgSender()`
   * (`token.authTransferFrom(msgSender(), msgSender(), address(this), shares)`,
   * `BalanceSheet.sol:176`), so revoking somebody else's shares is a two-step
   * multicall: `transferSharesFrom(holder -> custodian)` and then the burn. The
   * SDK passes its own `ctx.signingAddress` for the custodian; the backend
   * cannot, because the signer is unknown at PREVIEW time and the calldata must
   * be byte-identical at preview and prepare.
   *
   * So it is explicit, with no default — and unlike `refundAddress`, a wrong
   * value here does not merely misroute a refund: the shares land somewhere the
   * signer does not control and the burn reverts on an insufficient balance,
   * before any value moves. On the Fordefi route this is the pool's vault
   * address. `private-api` refuses a custodian that is not the resolved signer
   * where it can tell.
   */
  readonly custodianAddress: string;
}

/**
 * `BatchRequestManager.approveDeposits` per asset, batched — pure builder, no
 * I/O (issue #50).
 *
 * ## Why this is its own action rather than half of one
 *
 * The SDK exposes `approveDepositsAndIssueShares(assets)` and discriminates the
 * two legs by which KEYS an entry carries (`'approveAssetAmount' in asset` vs
 * `'issuePricePerShare' in asset`, `ShareClass.ts:908/940`). The action
 * vocabulary deliberately does not mirror that: approving and issuing are
 * different operations with different arguments,
 * different blast radii and — measured here — different message counts, and a
 * presence-discriminated union is a shape in which "both" and "neither" are
 * both expressible. The v3.2 builders still batch through the same contract, so
 * nothing is lost on the wire.
 *
 * ## Hub-side, spoke-side effect
 *
 * The transaction is sent to `BatchRequestManager` on the pool's HOME chain.
 * These four functions live on `BatchRequestManager` and not on `Hub`
 * (`centrifuge-v3` commit `2add77913`), which carries only the generic
 * `requestCallback` relay they call into. Each approval
 * dispatches one `RequestCallback` addressed to the ASSET's network.
 */
export function approveDeposits(
  ctx: ProtocolContext,
  args: ApproveDepositsArgs,
): BuiltProtocolCall {
  requireSamePool(ctx, args.poolId, "approveDeposits");
  const poolId = BigInt(args.poolId);
  const scId = requireBytes16(args.scId, "approveDeposits.scId");
  const entries = requireEntries(
    args.approvals,
    "approveDeposits.approvals",
    (approval) => approval.assetId,
  );

  const to = orderTarget(ctx, "approveDeposits");

  // Pass 1: validate every entry and collect the destinations. Two passes
  // rather than one because whether a `refundAddress` is required at all
  // depends on the WHOLE payload — an approval set whose every asset is local
  // dispatches nothing — and `refund` is a calldata argument, so it has to be
  // known before anything is encoded.
  const parsed = entries.map((approval, index) => {
    const field = `approveDeposits.approvals[${index}]`;

    return {
      rawAssetId: approval.assetId,
      rawEpochId: approval.epochId,
      assetId: parseUint128(approval.assetId, `${field}.assetId`),
      epochId: parseEpochId(approval.epochId, `${field}.epochId`),
      amount: parseAmount(
        approval.approvedAssetAmount,
        `${field}.approvedAssetAmount`,
      ),
      price: parseAmount(
        approval.pricePoolPerAsset,
        `${field}.pricePoolPerAsset`,
      ),
      destination: messageDestinationFor(ctx, approval.assetId),
    };
  });

  const destinations = parsed
    .map((approval) => approval.destination)
    .filter((destination): destination is number => destination !== null);
  const refund = resolveRefund(
    args.refundAddress,
    destinations,
    "approveDeposits",
  );

  // Pass 2: encode.
  const calls: ProtocolCall[] = parsed.map((approval) =>
    ctx.protocolVersion === PROTOCOL_VERSION_V3_3
      ? managerCall(
          ctx,
          {
            kind: "approveDeposits",
            scId,
            assetId: approval.rawAssetId,
            epochId: approval.rawEpochId,
            approvedAssetAmount: approval.amount.toString(),
            pricePoolPerAsset: approval.price.toString(),
            refundAddress: refund,
          },
          refund,
          `BatchRequestManager.approveDeposits (asset ${approval.rawAssetId}, epoch ${approval.rawEpochId})`,
        )
      : {
          to,
          data: encodeFunctionData({
            abi: ctx.abis.batchRequestManager,
            functionName: "approveDeposits",
            args: [
              poolId,
              scId,
              approval.assetId,
              approval.epochId,
              approval.amount,
              approval.price,
              refund,
            ],
          }),
          value: 0n,
          label: `BatchRequestManager.approveDeposits (asset ${approval.rawAssetId}, epoch ${approval.rawEpochId})`,
        },
  );

  const messages: Record<number, CrosschainMessage[]> = {};
  for (const destination of destinations) {
    pushMessage(messages, destination, args.poolId);
  }

  return batched(ctx, to, calls, messages);
}

/**
 * `BatchRequestManager.approveRedeems` per asset, batched — pure builder, no
 * I/O (issue #50).
 *
 * ## The one order action that costs NOTHING, and it is not an oversight
 *
 * `approveRedeems` is the only one of the four that dispatches no cross-chain
 * message: its body ends at `emit ApproveRedeems(...)` with no
 * `hub.requestCallback` anywhere (`BatchRequestManager.sol:262-283`), and it is
 * correspondingly the only one with no `refund` parameter. So this builder
 * declares an EMPTY manifest and a zero `msg.value`, and that zero is the
 * positive statement `updatePoolManagers` and an un-notified `updateSharePrice`
 * make — not a placeholder, and not something for `private-api` to price.
 *
 * Worth stating loudly because the function IS `payable` and the temptation is
 * to attach a fee anyway: `BatchRequestManager` is `Auth, BatchedMulticall,
 * IBatchRequestManager` with no `receive` and no recovery path, so wei sent to a
 * standalone `approveRedeems` is STRANDED in the contract. Over-paying is not
 * merely wasteful here, it is unrecoverable.
 */
export function approveRedeems(
  ctx: ProtocolContext,
  args: ApproveRedeemsArgs,
): BuiltProtocolCall {
  requireSamePool(ctx, args.poolId, "approveRedeems");
  const poolId = BigInt(args.poolId);
  const scId = requireBytes16(args.scId, "approveRedeems.scId");
  const entries = requireEntries(
    args.approvals,
    "approveRedeems.approvals",
    (approval) => approval.assetId,
  );
  const to = orderTarget(ctx, "approveRedeems");

  const calls: ProtocolCall[] = entries.map((approval, index) => {
    const field = `approveRedeems.approvals[${index}]`;
    const label = `BatchRequestManager.approveRedeems (asset ${approval.assetId}, epoch ${approval.epochId})`;
    if (ctx.protocolVersion === PROTOCOL_VERSION_V3_3) {
      return managerCall(
        ctx,
        {
          kind: "approveRedeems",
          scId,
          assetId: approval.assetId,
          epochId: approval.epochId,
          approvedShareAmount: parseAmount(
            approval.approvedShareAmount,
            `${field}.approvedShareAmount`,
          ).toString(),
          pricePoolPerAsset: parseAmount(
            approval.pricePoolPerAsset,
            `${field}.pricePoolPerAsset`,
          ).toString(),
        },
        ZERO_ADDRESS,
        label,
      );
    }

    return {
      to,
      data: encodeFunctionData({
        abi: ctx.abis.batchRequestManager,
        functionName: "approveRedeems",
        args: [
          poolId,
          scId,
          parseUint128(approval.assetId, `${field}.assetId`),
          parseEpochId(approval.epochId, `${field}.epochId`),
          parseAmount(
            approval.approvedShareAmount,
            `${field}.approvedShareAmount`,
          ),
          parseAmount(approval.pricePoolPerAsset, `${field}.pricePoolPerAsset`),
        ],
      }),
      value: 0n,
      label: `BatchRequestManager.approveRedeems (asset ${approval.assetId}, epoch ${approval.epochId})`,
    };
  });

  // Empty manifest, deliberately: see the note above. `private-api` skips the
  // estimator entirely for an empty manifest, so this action never reaches
  // `ZeroBridgeFeeError`.
  return batched(ctx, to, calls, {});
}

/**
 * `BatchRequestManager.issueShares` per epoch, plus an optional per-investor
 * `notifyDeposit` tail, batched — pure builder, no I/O (issue #50).
 *
 * ## Call order is load-bearing
 *
 * Every issuance first, then every notification — the SDK's order
 * (`ShareClass.ts:954-1001`) and the only correct one: a notification settles
 * epochs from the investor's `lastUpdate` forward, and `maxClaims` counts the
 * epochs this transaction issues, so a notification emitted before them would
 * claim epochs that do not exist yet and revert `IssuanceRequired()`.
 *
 * ## msg.value inside a multicall
 *
 * Every inner call carries zero and the whole fee sits on the OUTER
 * transaction. That is the protocol's own rule, not a convenience:
 * `BatchedMulticall.msgValue()` returns `0` whenever `_sender != address(0)`,
 * i.e. for every call made through `multicall`, and the full `msg.value` is paid
 * once up front into `gateway.withBatch{value: msg.value}`
 * (`BatchedMulticall.sol:33-54`). So a batch of N callbacks needs ONE
 * `msg.value` sized for N messages, which is exactly what the manifest below
 * describes.
 */
export function issueShares(
  ctx: ProtocolContext,
  args: IssueSharesArgs,
): BuiltProtocolCall {
  return buildEpochPages(ctx, {
    builder: "issueShares",
    functionName: "issueShares",
    notifyFunctionName: "notifyDeposit",
    poolId: args.poolId,
    scId: args.scId,
    pages: requireEntries(
      args.issuances,
      "issueShares.issuances",
      (issuance) => issuance.assetId,
    ),
    pagesField: "issueShares.issuances",
    notify: args.notify,
    refundAddress: args.refundAddress,
  });
}

/**
 * `BatchRequestManager.revokeShares` per epoch, plus an optional per-investor
 * `notifyRedeem` tail, batched — pure builder, no I/O (issue #50).
 *
 * The redeem mirror of {@link issueShares}, with the same ordering rule (a
 * notification before its revocation reverts `RevocationRequired()`) and the
 * same explicit epoch page. `revokeShares` carries no amount: the shares
 * revoked are whatever `approveRedeems` approved for that epoch, so the price is
 * the only economic input and an approve/revoke pair must name the same epochs.
 */
export function revokeShares(
  ctx: ProtocolContext,
  args: RevokeSharesArgs,
): BuiltProtocolCall {
  return buildEpochPages(ctx, {
    builder: "revokeShares",
    functionName: "revokeShares",
    notifyFunctionName: "notifyRedeem",
    poolId: args.poolId,
    scId: args.scId,
    pages: requireEntries(
      args.revocations,
      "revokeShares.revocations",
      (revocation) => revocation.assetId,
    ),
    pagesField: "revokeShares.revocations",
    notify: args.notify,
    refundAddress: args.refundAddress,
  });
}

/**
 * `BalanceSheet.multicall([override, issue, reset])` on the SPOKE — pure
 * builder, no I/O (issue #50).
 *
 * Mint shares straight into a named address at a named price, bypassing the
 * epoch machinery entirely. Byte-comparable to the SDK's `BalanceSheet.issue`.
 *
 * ## Spoke-side, and the only order action that is
 *
 * `BalanceSheet` lives on the spoke, so the context resolves to
 * `action.centrifugeId` rather than to the pool's home chain — the same shape as
 * the holding transfers, and the opposite of the four epoch actions above.
 *
 * ## Zero msg.value, and this one IS verified rather than assumed
 *
 * `BalanceSheet.issue` dispatches nothing. It mutates `queuedShares[poolId][scId]`
 * and mints the token locally (`BalanceSheet.sol:136-153`); the spoke→hub
 * `UpdateShares` message goes out later, from a SEPARATE `submitQueuedShares`
 * call (`BalanceSheet.sol:209-230`) that the queue manager or an operator
 * triggers. So the empty manifest here is a statement about the contract, not an
 * omission — and the same reading applies to the SDK, whose `issue` bypasses
 * `wrapTransaction` and therefore attaches no fee either.
 *
 * The three calls must be ONE multicall: `overridePricePoolPerShare` writes to
 * TRANSIENT storage, so the price it sets exists only for the remainder of this
 * transaction.
 */
export function issueSharesDirect(
  ctx: ProtocolContext,
  args: DirectShareArgs,
): BuiltProtocolCall {
  requireSamePool(ctx, args.poolId, "issueSharesDirect");
  refuseDirectOnV3_3(ctx, "issueSharesDirect");
  const poolId = BigInt(args.poolId);
  const scId = requireBytes16(args.scId, "issueSharesDirect.scId");
  const to = requireAddress(args.address, "issueSharesDirect.address");
  const shares = parseAmount(args.shares, "issueSharesDirect.shares");
  const price = parseAmount(
    args.pricePoolPerShare,
    "issueSharesDirect.pricePoolPerShare",
  );
  const balanceSheet = balanceSheetAddress(ctx, "issueSharesDirect");

  const calls: ProtocolCall[] = [
    balanceSheetCall(
      ctx,
      balanceSheet,
      "overridePricePoolPerShare",
      [poolId, scId, price],
      "BalanceSheet.overridePricePoolPerShare",
    ),
    balanceSheetCall(
      ctx,
      balanceSheet,
      "issue",
      [poolId, scId, to, shares],
      `BalanceSheet.issue (${shares} shares to ${to})`,
    ),
    balanceSheetCall(
      ctx,
      balanceSheet,
      "resetPricePoolPerShare",
      [poolId, scId],
      "BalanceSheet.resetPricePoolPerShare",
    ),
  ];

  return batched(ctx, balanceSheet, calls, {});
}

/**
 * `BalanceSheet.multicall([transferSharesFrom, override, revoke, reset])` on
 * the SPOKE — pure builder, no I/O (issue #50).
 *
 * Burn a named holder's shares at a named price. Byte-comparable to the SDK's
 * `BalanceSheet.revoke`, including the four-call shape and its order.
 *
 * ## Why the transfer leg exists
 *
 * `BalanceSheet.revoke` burns from `msgSender()` and takes no holder argument
 * (`BalanceSheet.sol:156-172`), so revoking somebody else's position means
 * moving the shares to the signer first. That is what
 * {@link RevokeSharesDirectArgs.custodianAddress} names, and why it is required
 * with no default — read that note: it must be the signing address, and a
 * mismatch reverts on an insufficient balance rather than misbehaving quietly.
 *
 * Zero `msg.value` for the same verified reason as {@link issueSharesDirect}:
 * `revoke` only mutates `queuedShares` and burns locally.
 */
export function revokeSharesDirect(
  ctx: ProtocolContext,
  args: RevokeSharesDirectArgs,
): BuiltProtocolCall {
  requireSamePool(ctx, args.poolId, "revokeSharesDirect");
  refuseDirectOnV3_3(ctx, "revokeSharesDirect");
  const poolId = BigInt(args.poolId);
  const scId = requireBytes16(args.scId, "revokeSharesDirect.scId");
  const holder = requireAddress(args.address, "revokeSharesDirect.address");
  const custodian = requireAddress(
    args.custodianAddress,
    "revokeSharesDirect.custodianAddress",
  );
  const shares = parseAmount(args.shares, "revokeSharesDirect.shares");
  const price = parseAmount(
    args.pricePoolPerShare,
    "revokeSharesDirect.pricePoolPerShare",
  );
  const balanceSheet = balanceSheetAddress(ctx, "revokeSharesDirect");

  const calls: ProtocolCall[] = [
    balanceSheetCall(
      ctx,
      balanceSheet,
      "transferSharesFrom",
      [poolId, scId, holder, holder, custodian, shares],
      `BalanceSheet.transferSharesFrom (${shares} shares ${holder} -> ${custodian})`,
    ),
    balanceSheetCall(
      ctx,
      balanceSheet,
      "overridePricePoolPerShare",
      [poolId, scId, price],
      "BalanceSheet.overridePricePoolPerShare",
    ),
    balanceSheetCall(
      ctx,
      balanceSheet,
      "revoke",
      [poolId, scId, shares],
      `BalanceSheet.revoke (${shares} shares)`,
    ),
    balanceSheetCall(
      ctx,
      balanceSheet,
      "resetPricePoolPerShare",
      [poolId, scId],
      "BalanceSheet.resetPricePoolPerShare",
    ),
  ];

  return batched(ctx, balanceSheet, calls, {});
}

/** Arguments for {@link notifyOrderClaims}. */
export interface NotifyOrderClaimsArgs {
  /** Raw pool id (uint64 decimal string). Must match `ctx.poolId`. */
  readonly poolId: string;
  readonly scId: string;
  readonly kind: "deposit" | "redeem";
  readonly notify: readonly OrderNotifyBatch[];
  readonly refundAddress?: string;
}

/**
 * `BatchRequestManager.notifyDeposit` / `notifyRedeem` on their own, batched on
 * the manager: on v3.3 they cannot ride in the same batch as the issue or
 * revoke they settle, which now go through `Hub.managerCall`.
 */
export function notifyOrderClaims(
  ctx: ProtocolContext,
  args: NotifyOrderClaimsArgs,
): BuiltProtocolCall {
  const builder = "notifyOrderClaims";
  requireSamePool(ctx, args.poolId, builder);
  const poolId = BigInt(args.poolId);
  const scId = requireBytes16(args.scId, `${builder}.scId`);
  const to = managerAddress(ctx, builder);
  const functionName =
    args.kind === "deposit" ? "notifyDeposit" : "notifyRedeem";
  if (args.notify.length === 0) {
    throw new BuilderArgumentMismatchError(
      `${builder}.notify is empty: a transaction that notifies nobody still ` +
        "costs a signature.",
    );
  }
  const batches = args.notify.map((batch, index) => {
    const field = `${builder}.notify[${index}]`;
    if (batch.notifications.length === 0) {
      throw new BuilderArgumentMismatchError(
        `${field}.notifications is empty. Name the investors or omit the entry.`,
      );
    }
    requireNoDuplicates(
      batch.notifications.map((notification) =>
        notification.investor.toLowerCase(),
      ),
      `${field}.notifications`,
      "investor",
    );
    return {
      assetId: parseUint128(batch.assetId, `${field}.assetId`),
      rawAssetId: batch.assetId,
      destination: messageDestinationFor(ctx, batch.assetId),
      notifications: batch.notifications.map((notification, entry) => ({
        key: notificationKey(
          ctx,
          notification,
          `${field}.notifications[${entry}]`,
        ),
        maxClaims: parseMaxClaims(
          notification.maxClaims,
          `${field}.notifications[${entry}].maxClaims`,
        ),
        label: notification.requestId ?? notification.investor,
      })),
    };
  });
  requireNoDuplicates(
    batches.map((batch) => batch.assetId.toString()),
    `${builder}.notify`,
    "asset",
  );
  const destinations: number[] = [];
  for (const batch of batches) {
    if (batch.destination !== null) {
      destinations.push(
        ...batch.notifications.map(() => batch.destination as number),
      );
    }
  }
  const refund = resolveRefund(args.refundAddress, destinations, builder);
  const calls: ProtocolCall[] = batches.flatMap((batch) =>
    batch.notifications.map((notification) => ({
      to,
      data: encodeFunctionData({
        abi: ctx.abis.batchRequestManager,
        functionName,
        args: [
          poolId,
          scId,
          batch.assetId,
          notification.key,
          notification.maxClaims,
          refund,
        ],
      }),
      value: 0n,
      label: `BatchRequestManager.${functionName} (asset ${batch.rawAssetId}, ${notification.label})`,
    })),
  );
  const messages: Record<number, CrosschainMessage[]> = {};
  for (const destination of destinations) {
    pushMessage(messages, destination, args.poolId);
  }
  return batched(ctx, to, calls, messages);
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

/**
 * The shared body of {@link issueShares} and {@link revokeShares}: one
 * epoch-paged manager call per epoch, then the notification tail.
 *
 * One helper rather than two near-identical functions, because the two differ
 * only in a function name — and a divergence between them (an ordering, a
 * duplicate rule, a refund requirement) would be a real bug that reading them
 * side by side would not catch.
 */
function buildEpochPages(
  ctx: ProtocolContext,
  input: {
    builder: string;
    functionName: "issueShares" | "revokeShares";
    notifyFunctionName: "notifyDeposit" | "notifyRedeem";
    poolId: string;
    scId: string;
    pages: readonly (ShareIssuance | ShareRevocation)[];
    pagesField: string;
    notify: readonly OrderNotifyBatch[] | undefined;
    refundAddress: string | undefined;
  },
): BuiltProtocolCall {
  requireSamePool(ctx, input.poolId, input.builder);
  if (
    ctx.protocolVersion === PROTOCOL_VERSION_V3_3 &&
    input.notify !== undefined &&
    input.notify.length > 0
  ) {
    throw new UnsupportedForProtocolVersionError(
      `${input.builder}.notify`,
      ctx.protocolVersion,
      "issue and revoke go through Hub.managerCall while notifications stay " +
        "direct BatchRequestManager calls, so they cannot share one batch; " +
        "build the notifications with notifyOrderClaims",
    );
  }
  const poolId = BigInt(input.poolId);
  const scId = requireBytes16(input.scId, `${input.builder}.scId`);
  const to = orderTarget(ctx, input.builder);

  // Pass 1: validate everything and collect the destinations, so `refund` is
  // resolved once and the "is a refund needed at all" question is answered from
  // the whole payload rather than per entry.
  const paged = input.pages.map((page, index) => {
    const field = `${input.pagesField}[${index}]`;
    if (page.pricesPoolPerShare.length === 0) {
      throw new BuilderArgumentMismatchError(
        `${field}.pricesPoolPerShare is empty. The page size IS the number of ` +
          "epochs this transaction acts on, so an empty page asks for a " +
          "transaction that costs a signature and does nothing.",
      );
    }

    return {
      assetId: parseUint128(page.assetId, `${field}.assetId`),
      rawAssetId: page.assetId,
      fromEpochId: parseEpochId(page.fromEpochId, `${field}.fromEpochId`),
      prices: page.pricesPoolPerShare.map((price, epochOffset) =>
        parseAmount(price, `${field}.pricesPoolPerShare[${epochOffset}]`),
      ),
      destination: messageDestinationFor(ctx, page.assetId),
    };
  });

  const notifyBatches = (input.notify ?? []).map((batch, index) => {
    const field = `${input.builder}.notify[${index}]`;
    if (batch.notifications.length === 0) {
      throw new BuilderArgumentMismatchError(
        `${field}.notifications is empty. Name the investors or omit the ` +
          "entry; an empty page is not a request for none.",
      );
    }
    const page = paged.find(
      (candidate) => candidate.rawAssetId === batch.assetId,
    );
    if (page === undefined) {
      // Refused rather than tolerated: `maxClaims` counts the epochs THIS
      // transaction settles, so a notification for an asset that is not being
      // issued or revoked here claims epochs that do not exist and reverts
      // `IssuanceRequired()` / `RevocationRequired()` after the signing
      // ceremony.
      throw new BuilderArgumentMismatchError(
        `${field}.assetId ${JSON.stringify(batch.assetId)} is not among the ` +
          `assets ${input.pagesField} names. A notification settles the epochs ` +
          "this transaction acts on, so it cannot stand alone.",
      );
    }
    requireNoDuplicates(
      batch.notifications.map((notification) =>
        notification.investor.toLowerCase(),
      ),
      `${field}.notifications`,
      "investor",
    );

    return {
      assetId: page.assetId,
      destination: page.destination,
      notifications: batch.notifications.map((notification, entry) => ({
        investor: addressToBytes32(
          notification.investor,
          `${field}.notifications[${entry}].investor`,
        ),
        key: notificationKey(
          ctx,
          notification,
          `${field}.notifications[${entry}]`,
        ),
        maxClaims: parseMaxClaims(
          notification.maxClaims,
          `${field}.notifications[${entry}].maxClaims`,
        ),
      })),
    };
  });
  requireNoDuplicates(
    notifyBatches.map((batch) => batch.assetId.toString()),
    `${input.builder}.notify`,
    "asset",
  );

  const destinations: number[] = [];
  for (const page of paged) {
    if (page.destination !== null) {
      // One message per EPOCH, not per asset: each `issueShares` /
      // `revokeShares` call dispatches its own `RequestCallback`.
      destinations.push(...page.prices.map(() => page.destination as number));
    }
  }
  for (const batch of notifyBatches) {
    if (batch.destination !== null) {
      destinations.push(
        ...batch.notifications.map(() => batch.destination as number),
      );
    }
  }
  const refund = resolveRefund(
    input.refundAddress,
    destinations,
    input.builder,
  );

  // Pass 2: encode. Issuances first, then notifications — see the builders'
  // ordering notes.
  const calls: ProtocolCall[] = [];
  for (const page of paged) {
    for (const [epochOffset, price] of page.prices.entries()) {
      const epochId = page.fromEpochId + BigInt(epochOffset);
      requireEpochId(epochId, `${input.pagesField} epoch ${epochId}`);
      const label = `BatchRequestManager.${input.functionName} (asset ${page.rawAssetId}, epoch ${epochId})`;
      if (ctx.protocolVersion === PROTOCOL_VERSION_V3_3) {
        calls.push(
          managerCall(
            ctx,
            {
              kind: input.functionName,
              scId,
              assetId: page.rawAssetId,
              epochId: epochId.toString(),
              pricePoolPerShare: price.toString(),
              refundAddress: refund,
            },
            refund,
            label,
          ),
        );
        continue;
      }
      calls.push({
        to,
        data: encodeFunctionData({
          abi: ctx.abis.batchRequestManager,
          functionName: input.functionName,
          args: [
            poolId,
            scId,
            page.assetId,
            epochId,
            price,
            // `extraGasLimit`, hardcoded zero to match the SDK
            // (`ShareClass.ts:961`, `:1144`) byte for byte. It buys headroom for
            // the spoke's execution of the callback; a non-zero value here would
            // break the per-version parity fixtures without any caller asking
            // for it.
            0n,
            refund,
          ],
        }),
        value: 0n,
        label,
      });
    }
  }
  for (const batch of notifyBatches) {
    for (const notification of batch.notifications) {
      calls.push({
        to: managerAddress(ctx, input.builder),
        data: encodeFunctionData({
          abi: ctx.abis.batchRequestManager,
          functionName: input.notifyFunctionName,
          args: [
            poolId,
            scId,
            batch.assetId,
            notification.key,
            notification.maxClaims,
            refund,
          ],
        }),
        value: 0n,
        label: `BatchRequestManager.${input.notifyFunctionName} (asset ${batch.assetId}, investor ${notification.investor})`,
      });
    }
  }

  const messages: Record<number, CrosschainMessage[]> = {};
  for (const destination of destinations) {
    pushMessage(messages, destination, input.poolId);
  }

  return batched(ctx, to, calls, messages);
}

/**
 * The network one asset's `RequestCallback` is addressed to, or `null` when the
 * call dispatches nothing at all.
 *
 * Two cases return `null`, and both matter for the fee:
 *
 * - The asset lives on the SENDING chain. `MessageDispatcher.sendRequestCallback`
 *   short-circuits `if (assetId.centrifugeId() == localCentrifugeId)` by calling
 *   `spoke.requestCallback` directly and refunding
 *   (`MessageDispatcher.sol:666-668`) — no bridge, no fee.
 * - The asset is a national currency (`centrifugeId == 0`), which is not a
 *   network.
 *
 * Declaring a message for either would be worse than wasteful. `private-api`
 * prices every declared destination through `estimateBridgeFee`, which REFUSES a
 * zero (`ZeroBridgeFeeError` → 422 `BRIDGE_FEE_UNCONFIGURED`) because a zero fee
 * on a real route confirms the transaction and stalls the message. A
 * self-addressed route has no adapter set and estimates to zero legitimately, so
 * declaring it would turn a correct free transaction into a 422.
 *
 * The SDK does NOT make this distinction — `addMessageForEnabledTarget` keys on
 * `asset.assetId.centrifugeId` unconditionally (`ShareClass.ts:930`) and then
 * pays whatever `_estimate` returns, which for a local asset is zero. The two
 * paths agree on the AMOUNT (zero) and differ on whether zero is an error, which
 * is only safe as long as the local case never reaches the estimator. Hence this
 * function.
 */
function messageDestinationFor(
  ctx: ProtocolContext,
  assetId: string,
): number | null {
  const destination = centrifugeIdFromAssetId(assetId);
  if (destination === 0 || destination === ctx.centrifugeId) {
    return null;
  }
  if (destination > 0xffff) {
    throw new BuilderArgumentMismatchError(
      `assetId ${assetId} encodes centrifugeId ${destination}, which is not a ` +
        "uint16 network id",
    );
  }

  return destination;
}

/** Append one `RequestCallback` to a destination's manifest entry. */
function pushMessage(
  messages: Record<number, CrosschainMessage[]>,
  destination: number,
  poolId: string,
): void {
  const entry = messages[destination];
  const message: CrosschainMessage = {
    type: MessageType.RequestCallback,
    poolId,
  };
  if (entry === undefined) {
    messages[destination] = [message];
  } else {
    entry.push(message);
  }
}

/**
 * The refund address, required iff any message leaves this chain and refused
 * otherwise.
 *
 * Symmetric with `updateSharePrice`: supplying one for a transaction that
 * dispatches nothing suggests there is unspent gas to return when there is not,
 * and omitting one for a transaction that does means the payment has nowhere to
 * go. When nothing is dispatched the zero address is passed on the wire, because
 * the contract argument is not optional — but a CALLER may not choose it.
 */
function resolveRefund(
  refundAddress: string | undefined,
  destinations: readonly number[],
  builder: string,
): Address {
  if (destinations.length === 0) {
    if (refundAddress !== undefined) {
      throw new BuilderArgumentMismatchError(
        `${builder}.refundAddress was supplied but every named asset lives on ` +
          "the sending chain, so no cross-chain message is dispatched and " +
          "there is no unspent gas payment to return.",
      );
    }

    return ZERO_ADDRESS;
  }
  if (refundAddress === undefined) {
    throw new BuilderArgumentMismatchError(
      `${builder}.refundAddress is required: this transaction dispatches ` +
        `${destinations.length} paid cross-chain message(s) and the unspent ` +
        "payment needs a destination. The zero address is a burn, not a " +
        "default.",
    );
  }

  return requireAddress(refundAddress, `${builder}.refundAddress`);
}

/**
 * The `refund` argument for a transaction that dispatches nothing.
 *
 * Inert rather than a burn, and that is checked rather than assumed:
 * `BatchRequestManager` forwards it to `hub.requestCallback`, which for a local
 * asset reaches `MessageDispatcher._refund(refund)` — and that function is
 * `if (msg.value > 0) { payable(refund).call{value: msg.value}("") }`. A
 * transaction with no declared destination attaches zero, so the guard is false
 * and the zero address is never called.
 *
 * Two adjacent cases, both fine for the same reason. A MIXED batch (one local
 * asset, one remote) carries a real refund address because
 * {@link resolveRefund} sees a non-empty destination list. And inside a
 * `multicall`, `BatchedMulticall.msgValue()` returns 0 for EVERY inner call —
 * the whole `msg.value` is paid once up front into `gateway.withBatch` — so an
 * inner `_refund` is a no-op by construction whatever address it holds.
 *
 * Deliberately not reachable from a caller: {@link resolveRefund} refuses a
 * supplied address when nothing is dispatched, so this constant is the only way
 * the zero address can appear here.
 */
const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";

/**
 * v3.2 calls the hub-local `BatchRequestManager` directly; v3.3 routes the
 * same actions through `Hub.managerCall` with a `fromHub` payload, so the
 * batch is sent to the `Hub`. Notifications stay direct calls on both.
 */
function orderTarget(ctx: ProtocolContext, builder: string): Address {
  return ctx.protocolVersion === PROTOCOL_VERSION_V3_3
    ? ctx.addresses.hub
    : managerAddress(ctx, builder);
}

function managerCall(
  ctx: ProtocolContext,
  payload: BatchRequestManagerPayload,
  refund: Address,
  label: string,
): ProtocolCall {
  const built = hubManagerCall(ctx, {
    poolId: ctx.poolId,
    centrifugeId: String(ctx.centrifugeId),
    target: managerAddress(ctx, label),
    payload: encodeBatchRequestManagerPayload(payload),
    label: `Hub.managerCall (${label})`,
    refundAddress: refund,
  });
  return built.calls![0]!;
}

/** The notification key: the investor on v3.2, the request id on v3.3. */
function notificationKey(
  ctx: ProtocolContext,
  notification: OrderNotification,
  field: string,
): `0x${string}` | bigint {
  if (ctx.protocolVersion === PROTOCOL_VERSION_V3_3) {
    if (notification.requestId === undefined) {
      throw new BuilderArgumentMismatchError(
        `${field}.requestId is required on protocol v3.3: notifyDeposit and ` +
          "notifyRedeem settle a request, not an investor.",
      );
    }
    return parseUint256(notification.requestId, `${field}.requestId`);
  }
  if (notification.requestId !== undefined) {
    throw new BuilderArgumentMismatchError(
      `${field}.requestId was supplied but protocol ${ctx.protocolVersion} ` +
        "keys notifications by investor.",
    );
  }
  return addressToBytes32(notification.investor, `${field}.investor`);
}

function refuseDirectOnV3_3(ctx: ProtocolContext, builder: string): void {
  if (ctx.protocolVersion === PROTOCOL_VERSION_V3_3) {
    throw new UnsupportedForProtocolVersionError(
      builder,
      ctx.protocolVersion,
      "overridePricePoolPerShare and resetPricePoolPerShare were removed " +
        "with no replacement, so a direct issue or revoke cannot pin a price",
    );
  }
}

/** `BatchRequestManager`'s address for this version, refused when absent. */
function managerAddress(ctx: ProtocolContext, builder: string): Address {
  return requireRegistryAddress(ctx, "batchRequestManager", builder);
}

/** `BalanceSheet`'s address for this version, refused when absent. */
function balanceSheetAddress(ctx: ProtocolContext, builder: string): Address {
  return requireRegistryAddress(ctx, "balanceSheet", builder);
}

/**
 * A contract address from the resolved address set, refused by name when
 * absent.
 *
 * `AddressSet` is `Record<string, Address>`, so a name this version's deployment
 * does not carry reads as `undefined` — which `encodeFunctionData` would encode
 * as a malformed `to`, producing calldata addressed nowhere. Restated from
 * `vaults.ts`'s `requireSpokeAddress` for the same reason that one is: the rule
 * belongs beside the lookup it guards.
 */
function requireRegistryAddress(
  ctx: ProtocolContext,
  contract: string,
  builder: string,
): Address {
  const address = ctx.addresses[contract];
  if (address === undefined) {
    throw new BuilderArgumentMismatchError(
      `${builder}: no "${contract}" address is registered for centrifugeId ` +
        `${ctx.centrifugeId} on protocol version ${ctx.protocolVersion}`,
    );
  }

  return address;
}

/** Encode one `BalanceSheet` call on the spoke. */
function balanceSheetCall(
  ctx: ProtocolContext,
  to: Address,
  functionName: string,
  args: readonly unknown[],
  label: string,
): ProtocolCall {
  return {
    to,
    data: encodeFunctionData({
      abi: ctx.abis.balanceSheet,
      functionName,
      args,
    }),
    value: 0n,
    label,
  };
}

/**
 * Wrap the built calls into the `BuiltProtocolCall` envelope: one call verbatim,
 * two or more as `multicall(bytes[])`, `calls` carrying the decode labels onto
 * `RawTx.metadata.innerCalls`.
 *
 * Same shape as the vault, manager and share-price wrappers, and restated for
 * the same reason: it closes over nothing, and a shared helper would only hide
 * which builders batch.
 */
function batched(
  ctx: ProtocolContext,
  to: Address,
  calls: readonly ProtocolCall[],
  messages: Record<number, readonly CrosschainMessage[]>,
): BuiltProtocolCall {
  return {
    to,
    data: encodeBatchCalldata(
      ctx.protocolVersion,
      calls.map((call) => call.data),
      {
        alwaysBatch:
          ctx.protocolVersion === PROTOCOL_VERSION_V3_3 &&
          to === ctx.addresses.hub,
      },
    ),
    value: 0n,
    calls,
    ...(ctx.protocolVersion === PROTOCOL_VERSION_V3_3 ? {} : { messages }),
  };
}

/** A context and an argument must agree on which pool is being operated on. */
function requireSamePool(
  ctx: ProtocolContext,
  poolId: string,
  builder: string,
): void {
  if (poolId !== ctx.poolId) {
    throw new BuilderArgumentMismatchError(
      `${builder} pool id mismatch: context resolved for pool ${ctx.poolId}, ` +
        `args carry pool ${poolId}`,
    );
  }
}

/** Inclusive upper bound of a Solidity `uint32`. */
const UINT32_MAX = (1n << 32n) - 1n;

/**
 * An epoch id as the `uint32` the chain takes.
 *
 * Epoch `0` is refused: `nowDepositEpoch` is `maxIndex + 1`, so the first
 * approvable epoch is `1` and a zero names an epoch the chain answers with
 * `EpochNotFound()` — after the signature.
 */
function parseEpochId(value: string, field: string): bigint {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new BuilderArgumentMismatchError(
      `${field} ${JSON.stringify(value)} is not a canonical positive uint32 ` +
        "epoch id (epochs are 1-based, so 0 is never valid)",
    );
  }

  return requireEpochId(BigInt(value), field);
}

/** An epoch id, refused when it would wrap the chain's `uint32`. */
function requireEpochId(value: bigint, field: string): bigint {
  if (value > UINT32_MAX) {
    throw new BuilderArgumentMismatchError(
      `${field} ${value} exceeds uint32. Refusing to encode a value that ` +
        "would wrap on chain.",
    );
  }

  return value;
}

/**
 * `maxClaims` as the `uint32` the chain takes, refusing zero.
 *
 * A number here rather than a decimal string, unlike every amount: `maxClaims`
 * is a small count, not money, and it comes from a `COUNT(*)` rather than from a
 * caller's form field. Zero is refused because it is the exact shape the
 * corrupted `account` column would produce — a filter that matches no row
 * answers `0`, and a `notifyRedeem` with `maxClaims == 0` claims nothing while
 * paying for a message. A silent zero would not fail; it would ship.
 */
function parseMaxClaims(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0 || BigInt(value) > UINT32_MAX) {
    throw new BuilderArgumentMismatchError(
      `${field} ${value} is not a positive uint32. A zero claim count would ` +
        "pay for a cross-chain message that settles nothing.",
    );
  }

  return value;
}

/**
 * The entries of a per-asset list, refused when empty or when an asset repeats.
 *
 * A repeated asset is refused rather than merged: the second call for one asset
 * would either revert `EpochNotInSequence` (the first already advanced the
 * epoch) or pay for a duplicate cross-chain message, and which of the two it is
 * depends on ordering. Compared on the RAW id string, which the DTO has already
 * canonicalised, so `"1"` and `"01"` cannot both be present.
 */
function requireEntries<T>(
  entries: readonly T[],
  field: string,
  assetIdOf: (entry: T) => string,
): readonly T[] {
  if (entries.length === 0) {
    throw new BuilderArgumentMismatchError(
      `${field} is empty. Refusing to encode a transaction that costs a ` +
        "signature, a policy evaluation and gas while doing nothing.",
    );
  }
  requireNoDuplicates(entries.map(assetIdOf), field, "asset");

  return entries;
}

/** Every key at most once, refused by name on the first repeat. */
function requireNoDuplicates(
  keys: readonly string[],
  field: string,
  noun: string,
): void {
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) {
      throw new BuilderArgumentMismatchError(
        `${field} names ${noun} ${JSON.stringify(key)} twice. The second ` +
          "entry would either revert or pay for a duplicate cross-chain " +
          "message, and which one depends on ordering.",
      );
    }
    seen.add(key);
  }
}
