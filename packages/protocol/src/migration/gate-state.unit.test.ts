import { describe, expect, it } from "vitest";
import { BuilderArgumentMismatchError } from "../errors";
import { HUB_PHASE, MIGRATION_STEP } from "./constants";
import {
  countedFreezeGeneration,
  deriveSpokeGateState,
  OFFBOARD_STEPS,
  SPOKE_GATE_STATE,
  SPOKE_GATE_STATES,
} from "./gate-state";

const {
  arm,
  freeze,
  abort,
  unlinkVaults,
  rotateAssets,
  finalizeOffboard,
  linkTokens,
} = MIGRATION_STEP;

function armed(
  relayedSteps: readonly number[],
  abortedGeneration: number | null = null,
) {
  return deriveSpokeGateState({
    hubPhase: HUB_PHASE.armed,
    relayedSteps,
    abortedGeneration,
  });
}

describe("deriveSpokeGateState", () => {
  it("lists the six states in order and the four offboard steps", () => {
    expect(SPOKE_GATE_STATES).toEqual(["P1", "P2", "P3", "P4", "P5", "P6"]);
    expect(OFFBOARD_STEPS).toEqual([3, 4, 5, 6]);
  });

  it("answers null before the hub is armed", () => {
    expect(
      deriveSpokeGateState({ hubPhase: HUB_PHASE.none, relayedSteps: [] }),
    ).toBeNull();
  });

  it("is started while only the arm was relayed", () => {
    expect(armed([])).toBe(SPOKE_GATE_STATE.started);
    expect(armed([arm])).toBe(SPOKE_GATE_STATE.started);
  });

  it("is freeze sent from the relayed freeze, back to started once that generation aborted", () => {
    expect(armed([arm, freeze])).toBe(SPOKE_GATE_STATE.freezeSent);
    expect(armed([arm, freeze, abort])).toBe(SPOKE_GATE_STATE.freezeSent);
    expect(armed([arm, freeze, abort], 1)).toBe(SPOKE_GATE_STATE.started);
    expect(armed([arm, freeze, abort, freeze], 1)).toBe(
      SPOKE_GATE_STATE.freezeSent,
    );
    expect(armed([arm, freeze, abort, freeze, abort], 2)).toBe(
      SPOKE_GATE_STATE.started,
    );
  });

  it("is offboard sent from the first offboard step, whatever the slice or generation", () => {
    for (const step of [unlinkVaults, rotateAssets, finalizeOffboard]) {
      expect(armed([arm, freeze, step])).toBe(SPOKE_GATE_STATE.offboardSent);
    }
    expect(armed([arm, unlinkVaults])).toBe(SPOKE_GATE_STATE.offboardSent);
    expect(armed([arm, freeze, unlinkVaults, unlinkVaults, rotateAssets])).toBe(
      SPOKE_GATE_STATE.offboardSent,
    );
  });

  it("leaves offboard sent only on an abort at or above the step's generation", () => {
    expect(armed([arm, freeze, unlinkVaults], 1)).toBe(
      SPOKE_GATE_STATE.started,
    );
    expect(armed([arm, freeze, abort, freeze, unlinkVaults], 1)).toBe(
      SPOKE_GATE_STATE.offboardSent,
    );
    expect(armed([arm, freeze, abort, freeze, unlinkVaults], 2)).toBe(
      SPOKE_GATE_STATE.started,
    );
    expect(armed([arm, freeze, unlinkVaults, abort, freeze], 1)).toBe(
      SPOKE_GATE_STATE.freezeSent,
    );
  });

  it("follows the hub past the point of no return", () => {
    expect(
      deriveSpokeGateState({
        hubPhase: HUB_PHASE.hubOnboarded,
        relayedSteps: [arm, freeze, unlinkVaults, finalizeOffboard],
      }),
    ).toBe(SPOKE_GATE_STATE.hubOnboarded);
    expect(
      deriveSpokeGateState({
        hubPhase: HUB_PHASE.activated,
        relayedSteps: [linkTokens],
      }),
    ).toBe(SPOKE_GATE_STATE.activatedNotRestored);
    expect(
      deriveSpokeGateState({
        hubPhase: HUB_PHASE.activated,
        relayedSteps: [linkTokens],
        maxReservesRestored: true,
      }),
    ).toBe(SPOKE_GATE_STATE.live);
  });

  it("checks the counted generation against the facade's when given", () => {
    expect(
      deriveSpokeGateState({
        hubPhase: HUB_PHASE.armed,
        relayedSteps: [arm, freeze, abort, freeze],
        abortedGeneration: 1,
        expectedFreezeGeneration: 2,
      }),
    ).toBe(SPOKE_GATE_STATE.freezeSent);
    expect(() =>
      deriveSpokeGateState({
        hubPhase: HUB_PHASE.armed,
        relayedSteps: [arm, freeze],
        expectedFreezeGeneration: 2,
      }),
    ).toThrow(BuilderArgumentMismatchError);
    expect(
      countedFreezeGeneration([arm, freeze, abort, freeze, unlinkVaults]),
    ).toBe(2);
  });

  it("refuses unknown ordinals and a negative abort generation", () => {
    expect(() => armed([99])).toThrow(BuilderArgumentMismatchError);
    expect(() =>
      deriveSpokeGateState({ hubPhase: 7, relayedSteps: [] }),
    ).toThrow(BuilderArgumentMismatchError);
    expect(() => armed([freeze], -1)).toThrow(BuilderArgumentMismatchError);
    expect(() => armed([freeze], 1.5)).toThrow(BuilderArgumentMismatchError);
    expect(() =>
      deriveSpokeGateState({
        hubPhase: HUB_PHASE.activated,
        relayedSteps: [99],
      }),
    ).toThrow(BuilderArgumentMismatchError);
    expect(() =>
      deriveSpokeGateState({
        hubPhase: HUB_PHASE.hubOnboarded,
        relayedSteps: [],
        abortedGeneration: -2,
      }),
    ).toThrow(BuilderArgumentMismatchError);
  });
});
