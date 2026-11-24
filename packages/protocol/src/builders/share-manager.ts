import { BuilderArgumentMismatchError } from "../errors";
import { PROTOCOL_VERSION_V3_3 } from "../types";
import type { BuiltProtocolCall, ProtocolContext } from "../types";
import { requireAddress, requireBytes16 } from "./create-holding";
import {
  encodeShareManagerPayload,
  hubManagerCall,
  requireVersion,
  SHARE_MANAGER_CALL,
} from "./manager-call";

/**
 * Extra gas a `Revoke` relayed to a remote spoke carries: the `GasService` base estimate for
 * `ManagerCallFromHub` does not cover the pull, approve and burn `ShareManager` runs
 * (protocol `SHARE_REVOKE_EXTRA_GAS`). A fixed value keeps the calldata identical on a re-run.
 */
export const SHARE_REVOKE_EXTRA_GAS = 300_000n;

/** Arguments for {@link shareManagerCall}. */
export interface ShareManagerCallArgs {
  /** Raw pool id (uint64 decimal string). Must match both contexts' `poolId`. */
  readonly poolId: string;
  readonly scId: string;
  readonly kind: keyof typeof SHARE_MANAGER_CALL;
  /** Recipient of an issuance, or the holder whose shares are revoked. */
  readonly account: string;
  /** Share count in the share token's smallest unit (uint128 decimal string). */
  readonly shares: string;
  readonly refundAddress: string;
  /** Extra gas for the remote execution; defaults to 0. */
  readonly extraGasLimit?: string;
}

/**
 * `Hub.managerCall` to the spoke's `ShareManager`: the v3.3 direct issue and
 * revoke, driven from the hub.
 *
 * v3.3 removed `overridePricePoolPerShare`, so the v3.2 spoke-signed
 * `issueSharesDirect` / `revokeSharesDirect` no longer exist. `ShareManager`
 * is the protocol's replacement for holdings tracked outside the protocol:
 * it is a spoke manager, and every operation reaches it as a hub manager call,
 * so the hub policy applies and no wallet on the spoke holds issue or revoke
 * rights. `Spoke.issue` and `Spoke.revoke` take no price; the share price
 * reaches the hub with the queued share update, which is why there is nothing
 * to pin.
 *
 * Revoke pulls the shares from `account` itself (`transferSharesFrom`), so no
 * custodian address exists on this path.
 *
 * `ShareManager` must already be a spoke manager of the pool on that chain
 * (`updateManager`, kind `spoke`), or `Spoke.issue` reverts with `NotManager`
 * on the spoke after the message was paid for. The caller checks that; this
 * builder is pure.
 *
 * Dispatches one `ManagerCallFromHub` message to `spoke.centrifugeId`.
 */
export function shareManagerCall(
  hub: ProtocolContext,
  spoke: ProtocolContext,
  args: ShareManagerCallArgs,
): BuiltProtocolCall {
  requireVersion(hub, PROTOCOL_VERSION_V3_3, "shareManagerCall");
  if (spoke.protocolVersion !== hub.protocolVersion) {
    throw new BuilderArgumentMismatchError(
      `shareManagerCall: hub context is on ${hub.protocolVersion}, spoke ` +
        `context on ${spoke.protocolVersion}`,
    );
  }
  if (spoke.poolId !== args.poolId) {
    throw new BuilderArgumentMismatchError(
      `shareManagerCall.spoke pool id mismatch: context resolved for pool ` +
        `${spoke.poolId}, args carry pool ${args.poolId}`,
    );
  }
  const shareManager = spoke.addresses.shareManager;
  if (shareManager === undefined) {
    throw new BuilderArgumentMismatchError(
      `shareManagerCall: no "shareManager" address is registered for ` +
        `centrifugeId ${spoke.centrifugeId} on protocol version ` +
        `${spoke.protocolVersion}`,
    );
  }
  const scId = requireBytes16(args.scId, "shareManagerCall.scId");
  const account = requireAddress(args.account, "shareManagerCall.account");

  return hubManagerCall(hub, {
    poolId: args.poolId,
    centrifugeId: String(spoke.centrifugeId),
    target: requireAddress(shareManager, "shareManagerCall.spoke.shareManager"),
    payload: encodeShareManagerPayload(
      { kind: args.kind, scId, account, shares: args.shares },
      "shareManagerCall",
    ),
    label: `ShareManager.${args.kind} (${args.shares} shares, ${account})`,
    refundAddress: args.refundAddress,
    ...(args.extraGasLimit !== undefined
      ? { extraGasLimit: args.extraGasLimit }
      : {}),
  });
}
