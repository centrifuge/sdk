import { BuilderArgumentMismatchError } from "../errors";
import { PROTOCOL_VERSION_V3_3 } from "../types";

export const MIGRATION_ID = "3.2->3.3";

export const MIGRATION_ABI_KEY = `${PROTOCOL_VERSION_V3_3}-migration`;

/** The registry key of the facade in the address book's `v3.3.0` stack. */
export const MIGRATION_FACADE_KEY = "v33Migration";

export const HUB_PHASE = {
  none: 0,
  armed: 1,
  hubOnboarded: 2,
  activated: 3,
} as const;

export const SPOKE_PHASE = {
  none: 0,
  armed: 1,
  frozen: 2,
  offboarded: 3,
  onboarded: 4,
} as const;

export const MIGRATION_STEP = {
  arm: 0,
  freeze: 1,
  abort: 2,
  unlinkVaults: 3,
  rotateAssets: 4,
  removeManagers: 5,
  finalizeOffboard: 6,
  linkTokens: 7,
  registerVaults: 8,
  configureVaults: 9,
  seedEscrow: 10,
  seedShareQueue: 11,
  finalizeOnboard: 12,
  restoreMaxReserves: 13,
  setupRamps: 14,
  assertHookManagers: 15,
  copyAssetPrice: 16,
  assertSpokeManagers: 17,
  assertRampConfig: 18,
} as const;

export type HubPhaseName = keyof typeof HUB_PHASE;
export type SpokePhaseName = keyof typeof SPOKE_PHASE;
export type MigrationStepName = keyof typeof MIGRATION_STEP;

function nameOf<T extends Record<string, number>>(
  table: T,
  value: number,
  label: string,
): keyof T {
  for (const [name, ordinal] of Object.entries(table)) {
    if (ordinal === value) {
      return name as keyof T;
    }
  }
  throw new BuilderArgumentMismatchError(
    `${label} ${value} is not a known ordinal`,
  );
}

export function hubPhaseName(value: number): HubPhaseName {
  return nameOf(HUB_PHASE, value, "hubPhase");
}

export function spokePhaseName(value: number): SpokePhaseName {
  return nameOf(SPOKE_PHASE, value, "spokePhase");
}

export function migrationStepName(value: number): MigrationStepName {
  return nameOf(MIGRATION_STEP, value, "migrationStep");
}
