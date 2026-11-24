import { BuilderArgumentMismatchError } from "../errors";
import { parseCentrifugeId } from "../builders/manager-call";
import { parseUint64 } from "../builders/money";
import { requireCentrifugeId, requireSamePool } from "../builders/vaults";
import { centrifugeIdFromPoolId } from "../types";
import type { MigrationContext } from "./types";

export function requirePool(
  ctx: MigrationContext,
  poolId: string,
  builder: string,
): bigint {
  requireSamePool(ctx, poolId, builder);
  return parseUint64(poolId, `${builder}.poolId`);
}

export function requireHubChain(ctx: MigrationContext, builder: string): void {
  const hubCentrifugeId = centrifugeIdFromPoolId(ctx.poolId);
  if (ctx.centrifugeId !== hubCentrifugeId) {
    throw new BuilderArgumentMismatchError(
      `${builder} is sent on the pool's hub chain ${hubCentrifugeId}; ` +
        `the context resolved to chain ${ctx.centrifugeId}`,
    );
  }
}

export function parseSpokeId(value: string, field: string): number {
  return requireCentrifugeId(parseCentrifugeId(value, field), field);
}

export function requireUnique(values: readonly string[], field: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) {
      throw new BuilderArgumentMismatchError(
        `${field} lists ${JSON.stringify(value)} more than once`,
      );
    }
    seen.add(key);
  }
}
