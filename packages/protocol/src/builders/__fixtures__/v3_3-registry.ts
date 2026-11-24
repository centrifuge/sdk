import { resolveProtocolContext } from "../../context";
import { defaultDeploymentRegistry } from "../../registry";
import { PROTOCOL_VERSION_V3_3 } from "../../types";
import type { ProtocolContext } from "../../types";

/** Sepolia and Base Sepolia, the first two chains of the v3.3 testnet layer. */
export const V3_3_HUB_CENTRIFUGE_ID = 1;
export const V3_3_SPOKE_CENTRIFUGE_ID = 2;

/** Pool 1 on Sepolia: `(1n << 48n) + 1n`. */
export const V3_3_POOL_ID = "281474976710657";

/** The bundled registry, which carries the v3.3 testnet deployments. */
export function v3_3TestRegistry() {
  return defaultDeploymentRegistry();
}

export function resolveV3_3TestContext(
  poolId: string = V3_3_POOL_ID,
  centrifugeId?: number,
): ProtocolContext {
  return resolveProtocolContext(poolId, PROTOCOL_VERSION_V3_3, {
    environment: "testnet",
    registry: v3_3TestRegistry(),
    centrifugeId,
  });
}
