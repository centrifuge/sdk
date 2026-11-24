import { parseUint64, parseUint128 } from "../builders/money";
import { centrifugeIdFromAssetId } from "../builders/orders";
import { requireCentrifugeId } from "../builders/vaults";
import { centrifugeIdFromPoolId } from "../types";

export interface ActionTarget {
  readonly poolId: string;
  readonly assetId?: string;
  readonly centrifugeId?: number;
}

export function spokeOfAction(target: ActionTarget): number {
  const poolId = parseUint64(target.poolId, "spokeOfAction.poolId");
  if (target.assetId !== undefined) {
    return requireCentrifugeId(
      centrifugeIdFromAssetId(
        parseUint128(target.assetId, "spokeOfAction.assetId"),
      ),
      "spokeOfAction.assetId",
    );
  }
  if (target.centrifugeId !== undefined) {
    return requireCentrifugeId(
      target.centrifugeId,
      "spokeOfAction.centrifugeId",
    );
  }
  return requireCentrifugeId(
    centrifugeIdFromPoolId(poolId),
    "spokeOfAction.poolId",
  );
}
