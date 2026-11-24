import { encodeFunctionData } from "viem";

import { BuilderArgumentMismatchError } from "../errors";
import { MessageType, type CrosschainMessage } from "../messages";
import type {
  BuiltProtocolCall,
  ProtocolCall,
  ProtocolContext,
} from "../types";
import { encodeBatchCalldata } from "./batch";
import { requireAddress, requireBytes16 } from "./create-holding";
import { parseAmount, parseUint64 } from "./money";
import { requireCentrifugeId } from "./vaults";

/** Arguments for {@link updateSharePrice}. */
export interface UpdateSharePriceArgs {
  /** Raw pool id (uint64 decimal string). Must match `ctx.poolId`. */
  readonly poolId: string;
  /** Share-class id (bytes16 hex). */
  readonly scId: string;
  /**
   * The new pool-per-share price as a decimal string of the on-chain `D18`
   * integer — 18-decimal fixed point, so `"1045513765272640000"` is 1.04551…
   *
   * Never a number and never a float: a `D18` price is a uint128, `Number`
   * cannot hold one, and a price rounded on the way in is a wrong NAV for every
   * holder of the share class. Zero is refused (see {@link parseAmount}): the
   * chain would accept it and every spoke would then report the share class as
   * worthless.
   */
  readonly pricePerShare: string;
  /**
   * When the price was struck, as unix SECONDS in a decimal string.
   *
   * Required, with no default. The SDK defaults it to `now - 60s`, and this
   * builder cannot: a value derived from the clock differs between the preview
   * build and the prepare build, and the calldata must be byte-identical across
   * both (the same reason `refundAddress` has no default). The caller supplies
   * the exact timestamp, so preview and prepare agree by construction.
   *
   * The chain refuses a future value —
   * `require(computedAt <= block.timestamp, CannotSetFuturePrice())` in
   * `ShareClassManager.updateSharePrice` — and imposes no other rule; it does
   * NOT require the value to advance, so a backdated correction is legal on
   * chain. The caller-side guards live in `private-api`, which can read the
   * currently projected `computedAt`.
   */
  readonly computedAt: string;
  /**
   * The networks to propagate the new price to, as decimal-string
   * `centrifugeId`s. May be empty for a share class that lives only on the hub.
   *
   * Explicit rather than derived, again for calldata determinism: the SDK reads
   * the pool's active networks over RPC at build time, and a set read from
   * mutable state would let preview and prepare emit different batches. The
   * caller resolves the set against the projection and is refused if it does
   * not match, which turns a silent difference into a 422.
   */
  readonly notifyNetworks: readonly string[];
  /**
   * Where unspent cross-chain gas payment is returned, required iff
   * {@link notifyNetworks} is non-empty. See
   * `DeployVaultArgs.refundAddress` for why it has no default.
   */
  readonly refundAddress?: string;
}

/**
 * Set a share class's pool-per-share price and propagate it — pure builder, no
 * I/O (issue #44).
 *
 * v3.2 encodes it as one `Hub.updateSharePrice(poolId, scId, price,
 * computedAt)` followed by one
 * `Hub.notifySharePrice(poolId, scId, centrifugeId, refund)` per named network,
 * batched. Byte-comparable to the SDK's `ShareClass.updateSharePrice`.
 *
 * ## Call order: the price first, then the notifications
 *
 * Load-bearing, not cosmetic. `Hub.notifySharePrice` does not carry a price
 * argument — it READS the stored price back out of the `ShareClassManager` and
 * sends whatever it finds. Emitting a notification before the update would
 * broadcast the OLD price to every spoke and leave them stale until the next
 * update, and nothing downstream would report an error. The order within the
 * notifications is the caller's array order, preserved exactly, so the batch is
 * a deterministic function of the payload.
 *
 * ## msg.value
 *
 * This builder is the one that mixes both cases, and the distinction is pinned
 * by a test rather than left to a reader:
 *
 * - `Hub.updateSharePrice` is `payable` in the ABI but dispatches no
 *   cross-chain message — it writes hub state and calls the fee hook — so its
 *   zero is CORRECT, not a placeholder. An action with no `notifyNetworks`
 *   therefore declares an EMPTY manifest and costs zero wei.
 * - `Hub.notifySharePrice` is payable AND dispatches
 *   `NotifyPricePoolPerShare` (`sender.sendNotifyPricePoolPerShare{value:
 *   msgValue()}` in `Hub.sol`), so each named network contributes one message
 *   to the manifest, keyed by that network. `private-api` prices the manifest
 *   and attaches the total to the outer transaction; this builder stays pure.
 */
export function updateSharePrice(
  ctx: ProtocolContext,
  args: UpdateSharePriceArgs,
): BuiltProtocolCall {
  requireSamePool(ctx, args.poolId, "updateSharePrice");
  const poolId = BigInt(args.poolId);
  const scId = requireBytes16(args.scId, "updateSharePrice.scId");
  const price = parseAmount(
    args.pricePerShare,
    "updateSharePrice.pricePerShare",
  );
  const computedAt = parseUint64(
    args.computedAt,
    "updateSharePrice.computedAt",
  );

  const calls: ProtocolCall[] = [
    // Hub-local, no message dispatched: zero value is correct here.
    hubCall(
      ctx,
      "updateSharePrice",
      [poolId, scId, price, computedAt],
      "Hub.updateSharePrice",
    ),
  ];
  const messages: Record<number, CrosschainMessage[]> = {};

  if (args.notifyNetworks.length > 0) {
    const refund = requireAddress(
      requireRefundAddress(args.refundAddress),
      "updateSharePrice.refundAddress",
    );

    // Validate and PARSE every network before deduplicating, so the duplicate
    // rule compares ids as the chain understands them rather than as the caller
    // spelled them: `"2"` and `"02"` are one network numerically and two
    // strings textually, and a textual key would let one batch pay for the same
    // cross-chain message twice.
    const parsed = args.notifyNetworks.map((value, index) =>
      requireCentrifugeId(
        parseCentrifugeId(value, `updateSharePrice.notifyNetworks[${index}]`),
        `updateSharePrice.notifyNetworks[${index}]`,
      ),
    );
    requireNoDuplicates(parsed);

    for (const centrifugeId of parsed) {
      calls.push(
        hubCall(
          ctx,
          "notifySharePrice",
          [poolId, scId, centrifugeId, refund],
          `Hub.notifySharePrice (network ${centrifugeId})`,
        ),
      );
      // One message per network, keyed by that network: the fee is charged per
      // ROUTE, so a price notified to three spokes is three estimates, not one
      // multiplied by three.
      messages[centrifugeId] = [
        { type: MessageType.NotifyPricePoolPerShare, poolId: args.poolId },
      ];
    }
  } else if (args.refundAddress !== undefined) {
    throw new BuilderArgumentMismatchError(
      "updateSharePrice.refundAddress was supplied but no network is being " +
        "notified. `Hub.updateSharePrice` dispatches no cross-chain message, " +
        "so there is no unspent gas payment to return and accepting the " +
        "address would suggest otherwise.",
    );
  }

  return batched(ctx, calls, messages);
}

/** Encode one `Hub` call on the pool's home chain. */
function hubCall(
  ctx: ProtocolContext,
  functionName: string,
  args: readonly unknown[],
  label: string,
): ProtocolCall {
  return {
    to: ctx.addresses.hub,
    data: encodeFunctionData({ abi: ctx.abis.hub, functionName, args }),
    // Zero per INNER call. `updateSharePrice` dispatches no message and needs
    // none; `notifySharePrice` does, and its fee is attached to the OUTER
    // transaction from the message manifest — the same place the SDK's
    // `wrapTransaction` attaches it.
    value: 0n,
    label,
  };
}

/**
 * Wrap the built calls into the `BuiltProtocolCall` envelope: one call is sent
 * verbatim, two or more as `multicall(bytes[])`, and `calls` carries the
 * per-call decode labels onto `RawTx.metadata.innerCalls`.
 *
 * `messages` is the cross-chain manifest the caller prices; an empty
 * object means the action dispatches nothing, which for this builder is the
 * no-notification case.
 *
 * Same shape as the vault and manager builders' wrappers, restated for the same
 * reason: it closes over nothing, and a shared helper would only hide which
 * builders batch.
 */
function batched(
  ctx: ProtocolContext,
  calls: readonly ProtocolCall[],
  messages: Record<number, readonly CrosschainMessage[]>,
): BuiltProtocolCall {
  return {
    to: ctx.addresses.hub,
    data: encodeBatchCalldata(
      ctx.protocolVersion,
      calls.map((call) => call.data),
    ),
    value: 0n,
    calls,
    messages,
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

/**
 * The refund address, refused when absent while a notification is being sent.
 *
 * Not defaulted to the zero address: the refund is where unspent cross-chain
 * gas goes, so a zero address is a burn rather than an absent option.
 */
function requireRefundAddress(value: string | undefined): string {
  if (value === undefined) {
    throw new BuilderArgumentMismatchError(
      "updateSharePrice.refundAddress is required when notifyNetworks is " +
        "non-empty: `Hub.notifySharePrice` is a paid cross-chain send and the " +
        "unspent payment needs a destination. The zero address is a burn, not " +
        "a default.",
    );
  }
  return value;
}

/**
 * A decimal-string centrifugeId as a number, refusing anything that is not a
 * CANONICAL positive integer literal.
 *
 * Restated from `managers.ts` rather than shared, because the two argue the
 * same point about different arguments and the reasoning belongs next to the
 * call it guards: `Number("1e3")` is 1000 and `Number(" 1")` is 1, either of
 * which would send a paid cross-chain message to a network the caller did not
 * name; and `"02"` parses to the same 2 as `"2"`, so a batch carrying both
 * would pay twice to notify one network while a textual duplicate check saw two
 * distinct keys.
 */
function parseCentrifugeId(value: string, field: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new BuilderArgumentMismatchError(
      `${field} ${JSON.stringify(value)} is not a canonical decimal ` +
        "centrifugeId (no leading zeros)",
    );
  }
  return Number(value);
}

/**
 * One network at most once. A repeated network buys a second identical
 * cross-chain message — paid for, and indistinguishable in the audit row from a
 * deliberate one — so it is refused rather than silently collapsed.
 */
function requireNoDuplicates(centrifugeIds: readonly number[]): void {
  const seen = new Set<number>();
  for (const centrifugeId of centrifugeIds) {
    if (seen.has(centrifugeId)) {
      throw new BuilderArgumentMismatchError(
        `updateSharePrice.notifyNetworks names network ${centrifugeId} ` +
          "twice; the second notification would pay for a duplicate " +
          "cross-chain message carrying the same price.",
      );
    }
    seen.add(centrifugeId);
  }
}
