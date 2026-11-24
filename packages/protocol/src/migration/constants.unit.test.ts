import { describe, expect, it } from "vitest";
import { BuilderArgumentMismatchError } from "../errors";
import {
  HUB_PHASE,
  hubPhaseName,
  MIGRATION_STEP,
  migrationStepName,
  SPOKE_PHASE,
  spokePhaseName,
} from "./constants";

describe("V33Migration enum ordinals", () => {
  it("follow IV33Migration at v3.3.0-migration-test.2", () => {
    expect(Object.entries(HUB_PHASE)).toEqual([
      ["none", 0],
      ["armed", 1],
      ["hubOnboarded", 2],
      ["activated", 3],
    ]);
    expect(Object.entries(SPOKE_PHASE)).toEqual([
      ["none", 0],
      ["armed", 1],
      ["frozen", 2],
      ["offboarded", 3],
      ["onboarded", 4],
    ]);
    expect(Object.keys(MIGRATION_STEP)).toEqual([
      "arm",
      "freeze",
      "abort",
      "unlinkVaults",
      "rotateAssets",
      "removeManagers",
      "finalizeOffboard",
      "linkTokens",
      "registerVaults",
      "configureVaults",
      "seedEscrow",
      "seedShareQueue",
      "finalizeOnboard",
      "restoreMaxReserves",
      "setupRamps",
      "assertHookManagers",
      "copyAssetPrice",
      "assertSpokeManagers",
      "assertRampConfig",
    ]);
    expect(Object.values(MIGRATION_STEP)).toEqual([...Array(19).keys()]);
  });

  it("name helpers round-trip and refuse unknown ordinals", () => {
    expect(hubPhaseName(HUB_PHASE.hubOnboarded)).toBe("hubOnboarded");
    expect(spokePhaseName(SPOKE_PHASE.offboarded)).toBe("offboarded");
    expect(migrationStepName(MIGRATION_STEP.restoreMaxReserves)).toBe(
      "restoreMaxReserves",
    );
    expect(() => hubPhaseName(4)).toThrow(BuilderArgumentMismatchError);
    expect(() => spokePhaseName(-1)).toThrow(BuilderArgumentMismatchError);
    expect(() => migrationStepName(19)).toThrow(BuilderArgumentMismatchError);
  });
});
