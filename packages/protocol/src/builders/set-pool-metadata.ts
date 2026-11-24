import { encodeFunctionData, stringToHex } from "viem";
import { BuilderArgumentMismatchError } from "../errors";
import type { BuiltProtocolCall, ProtocolContext } from "../types";

/** Arguments for {@link setPoolMetadata}. */
export interface SetPoolMetadataArgs {
  /** Raw pool id (uint64 decimal string). Must match `ctx.poolId`. */
  readonly poolId: string;
  /** Pre-pinned IPFS CID of the pool metadata JSON. */
  readonly cid: string;
}

/**
 * `Hub.setPoolMetadata(poolId, toHex(cid))` — pure builder, no I/O.
 *
 * The metadata JSON is pinned to IPFS by the caller; `cid` arrives pre-pinned
 * and is encoded as `bytes` via its UTF-8 hex, byte-identical to the SDK's
 * `toHex(cid)` (fixture-tested against captured SDK bytes).
 *
 * `setPoolMetadata` is non-payable — no ETH is ever sent with this call.
 */
export function setPoolMetadata(
  ctx: ProtocolContext,
  args: SetPoolMetadataArgs,
): BuiltProtocolCall {
  if (args.poolId !== ctx.poolId) {
    throw new BuilderArgumentMismatchError(
      `setPoolMetadata pool id mismatch: context resolved for pool ` +
        `${ctx.poolId}, args carry pool ${args.poolId}`,
    );
  }

  const data = encodeFunctionData({
    abi: ctx.abis.hub,
    functionName: "setPoolMetadata",
    args: [BigInt(args.poolId), stringToHex(args.cid)],
  });

  const to = ctx.addresses.hub;
  // Zero, and no message manifest: `Hub.setPoolMetadata` writes hub
  // state and dispatches no cross-chain message, so there is nothing to
  // estimate. Declaring no manifest is the same statement as declaring an empty
  // one — "nothing to pay for" — and both are the correct answer here rather
  // than a placeholder.
  const value = 0n;

  return {
    to,
    data,
    value,
    calls: [{ to, data, value, label: "Hub.setPoolMetadata" }],
  };
}
