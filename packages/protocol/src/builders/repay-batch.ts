import { encodeFunctionData } from "viem";

import { BuilderArgumentMismatchError } from "../errors";
import { batchKeyOf } from "../messages";
import type {
  BuiltProtocolCall,
  ProtocolCall,
  ProtocolContext,
} from "../types";
import { requireAddress } from "./create-holding";
import { requireCentrifugeId } from "./vaults";

/** Arguments for {@link repayBatch}. */
export interface RepayBatchArgs {
  /** Raw pool id (uint64 decimal string). Must match `ctx.poolId`. */
  readonly poolId: string;
  /**
   * Centrifuge id of the network the underpaid batch was addressed TO, as a
   * decimal string. An argument, not the context: `Gateway.repay` is called on
   * the chain the batch was SENT FROM, which is where the gateway recorded the
   * shortfall.
   */
  readonly toCentrifugeId: string;
  /**
   * The exact batch bytes that were underpaid, `0x`-prefixed.
   *
   * The bytes themselves, not their hash. `Gateway.repay` hashes them itself
   * and looks the hash up in `underpaid`, so a batch that differs by one byte
   * repays nothing and reverts `NotUnderpaidBatch` — which is the correct
   * outcome and the reason this argument is not "reconstructed" from a
   * projection here. The caller obtains them from the `UnderpaidBatch` event.
   */
  readonly batch: string;
  /**
   * Where unspent gas payment is returned.
   *
   * Required, with no default, for the same reason every other builder's is:
   * the signer is unknown at PREVIEW time and the calldata must be
   * byte-identical at preview, at prepare and again during Fordefi's
   * dual-channel re-derivation. The zero address is a burn, not a default.
   */
  readonly refundAddress: string;
}

/**
 * Pay the outstanding gas for an underpaid cross-chain batch — pure builder, no
 * I/O.
 *
 * v3.2 encodes one `Gateway.repay(centrifugeId, batch, refund)` on the chain the
 * batch was sent from. Byte-comparable to the SDK's
 * `Centrifuge.repayBatch`.
 *
 * ## Why this action exists at all
 *
 * Underpayment is reachable and, before this, unrecoverable server-side.
 * `MultiAdapter.estimate` returns 0 for a pool whose adapter slot is
 * unconfigured (verified on mainnet: five of twelve live pools have
 * `quorum(2, poolId) == 0`), and paying 0 does not revert — the hub transaction
 * confirms and the message stalls silently. The estimator now refuses a zero
 * fee outright, but a fee that was CORRECT at prepare and short at execution is
 * still possible: the fee is time-varying (0.012% drift measured over ~8h) and
 * a pool's adapter set is mutable via `setAdapters`. `Gateway.underpaid`
 * records the exact shortfall and this is the only call that clears it.
 *
 * ## msg.value is NOT derived from a message manifest
 *
 * Every other builder here declares a `messages` manifest and the caller prices
 * it from the canonical empty payloads. This one deliberately declares none,
 * because the amount owed is not an estimate over hypothetical messages: it is
 * `MultiAdapter.estimate(toCentrifugeId, batch, gasLimit)` over the REAL batch
 * bytes at the `gasLimit` the gateway itself recorded in `underpaid`. Pricing
 * it from empty payloads would produce a plausible number for the wrong bytes.
 * `private-api` reads it through `ChainAdapter.estimateRepayFee` and attaches
 * the result to the outer transaction.
 *
 * ## Tenancy: the batch must belong to the pool named in the path
 *
 * `Gateway.repay` takes NO pool id — the pool is encoded inside the batch — so
 * without a check here a caller holding `tx:prepare` on pool A could have the
 * backend's own Fordefi vault pay pool B's debt. The leading message's `uint64`
 * pool id (bytes 1..9, the same field `MultiAdapter.estimate` resolves the
 * adapter set from) must equal `ctx.poolId`. A GLOBAL batch (pool id 0) is
 * refused too, and that is deliberate rather than an oversight: a global batch
 * is not a pool operation, so no pool-scoped grant can authorize it.
 */
export function repayBatch(
  ctx: ProtocolContext,
  args: RepayBatchArgs,
): BuiltProtocolCall {
  requireSamePool(ctx, args.poolId, "repayBatch");
  const toCentrifugeId = requireCentrifugeId(
    parseCentrifugeId(args.toCentrifugeId, "repayBatch.toCentrifugeId"),
    "repayBatch.toCentrifugeId",
  );
  if (toCentrifugeId === ctx.centrifugeId) {
    throw new BuilderArgumentMismatchError(
      `repayBatch.toCentrifugeId equals the sending network (${toCentrifugeId}); ` +
        "a batch is only ever underpaid on a route to ANOTHER network, so this " +
        "names a batch the gateway cannot be holding.",
    );
  }
  const batch = requireBatchForPool(args.batch, args.poolId);
  const refund = requireAddress(args.refundAddress, "repayBatch.refundAddress");

  const call: ProtocolCall = {
    to: ctx.addresses.gateway,
    data: encodeFunctionData({
      abi: ctx.abis.gateway,
      functionName: "repay",
      args: [toCentrifugeId, batch, refund],
    }),
    // Zero here; the amount owed is attached to the OUTER transaction by
    // `private-api` from `Gateway.underpaid` + `MultiAdapter.estimate`. See the
    // msg.value note above for why no message manifest is declared.
    value: 0n,
    label: `Gateway.repay (underpaid batch on route to network ${toCentrifugeId})`,
  };

  return {
    to: call.to,
    data: call.data,
    value: 0n,
    calls: [call],
  };
}

/**
 * The batch bytes, refused unless their leading message names `poolId`.
 *
 * See the tenancy note on {@link repayBatch}. Also refuses anything shorter
 * than one message header (a type byte plus a `uint64` pool id): `Gateway.repay`
 * would revert `MalformedBatch`, but only after the transaction had been
 * signed, approved and broadcast.
 */
function requireBatchForPool(batch: string, poolId: string): `0x${string}` {
  let key: string;
  try {
    key = batchKeyOf(batch);
  } catch (err) {
    throw new BuilderArgumentMismatchError(
      `repayBatch.batch is not a well-formed cross-chain batch: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const batchPoolId = BigInt(`0x${key}`);
  if (batchPoolId === 0n) {
    throw new BuilderArgumentMismatchError(
      "repayBatch.batch is a GLOBAL batch (pool id 0), which is not a pool " +
        "operation: no pool-scoped grant can authorize paying for it.",
    );
  }
  if (batchPoolId !== BigInt(poolId)) {
    throw new BuilderArgumentMismatchError(
      `repayBatch.batch belongs to pool ${batchPoolId}, not to pool ${poolId}. ` +
        "`Gateway.repay` carries no pool id, so without this check a caller " +
        "authorized on one pool could have another pool's debt paid.",
    );
  }

  return batch.toLowerCase() as `0x${string}`;
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
 * A decimal-string centrifugeId as a number, refusing anything that is not a
 * CANONICAL positive integer literal — restated from `managers.ts` for the same
 * reason it is restated in `members.ts` and `share-price.ts`: the rule belongs
 * next to the argument it guards. `Number("1e3")` is 1000 and `"02"` is the
 * same network as `"2"` under two different strings, so both are refused.
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
