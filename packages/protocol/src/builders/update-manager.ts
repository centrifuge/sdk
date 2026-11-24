import { encodeFunctionData } from "viem";
import { BuilderArgumentMismatchError } from "../errors";
import { PROTOCOL_VERSION_V3_3 } from "../types";
import type { BuiltProtocolCall, ProtocolContext } from "../types";
import { requireAddress } from "./create-holding";
import { parseCentrifugeId, requireVersion } from "./manager-call";
import { addressToBytes32, requireCentrifugeId } from "./vaults";

/** `Hub.updateManager`'s `ManagerKind` (`MessageLib.sol` at v3.3.0). `spoke` is what v3.2 called the balance-sheet manager. */
export const MANAGER_KIND = {
  adapter: 0,
  gateway: 1,
  spoke: 2,
  bridger: 3,
} as const;

export type ManagerKindName = keyof typeof MANAGER_KIND;

/** Arguments for {@link updateManager}. */
export interface UpdateManagerArgs {
  /** Raw pool id (uint64 decimal string). Must match `ctx.poolId`. */
  readonly poolId: string;
  /** Centrifuge id of the network whose manager mapping changes, as a decimal string. */
  readonly centrifugeId: string;
  readonly kind: ManagerKindName;
  readonly address: string;
  readonly canManage: boolean;
  readonly refundAddress: string;
}

/**
 * `Hub.updateManager(poolId, centrifugeId, kind, who, canManage, refund)`: the
 * v3.3 entry point that replaces `updateBalanceSheetManager` and
 * `updateGatewayManager`. Refuses a context on another version.
 */
export function updateManager(
  ctx: ProtocolContext,
  args: UpdateManagerArgs,
): BuiltProtocolCall {
  requireVersion(ctx, PROTOCOL_VERSION_V3_3, "updateManager");
  if (args.poolId !== ctx.poolId) {
    throw new BuilderArgumentMismatchError(
      `updateManager pool id mismatch: context resolved for pool ` +
        `${ctx.poolId}, args carry pool ${args.poolId}`,
    );
  }
  const poolId = BigInt(args.poolId);
  const centrifugeId = requireCentrifugeId(
    parseCentrifugeId(args.centrifugeId, "updateManager.centrifugeId"),
    "updateManager.centrifugeId",
  );
  const who = requireAddress(args.address, "updateManager.address");
  const refund = requireAddress(
    args.refundAddress,
    "updateManager.refundAddress",
  );
  const kind = MANAGER_KIND[args.kind];
  if (kind === undefined) {
    throw new BuilderArgumentMismatchError(
      `updateManager.kind ${JSON.stringify(args.kind)} is not one of ` +
        `${Object.keys(MANAGER_KIND).join(", ")}`,
    );
  }
  const to = ctx.addresses.hub;
  const data = encodeFunctionData({
    abi: ctx.abis.hub,
    functionName: "updateManager",
    args: [
      poolId,
      centrifugeId,
      kind,
      addressToBytes32(who),
      args.canManage,
      refund,
    ],
  });
  const value = 0n;
  return {
    to,
    data,
    value,
    calls: [
      {
        to,
        data,
        value,
        label:
          `Hub.updateManager (${args.canManage ? "grant" : "revoke"} ${args.kind} ` +
          `to ${who} on network ${centrifugeId})`,
      },
    ],
  };
}
