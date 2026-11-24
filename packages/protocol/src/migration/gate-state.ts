import { BuilderArgumentMismatchError } from "../errors";
import { hubPhaseName, MIGRATION_STEP, migrationStepName } from "./constants";

export const SPOKE_GATE_STATE = {
  started: "P1",
  freezeSent: "P2",
  offboardSent: "P3",
  hubOnboarded: "P4",
  activatedNotRestored: "P5",
  live: "P6",
} as const;

export type SpokeGateState =
  (typeof SPOKE_GATE_STATE)[keyof typeof SPOKE_GATE_STATE];

export const SPOKE_GATE_STATES: readonly SpokeGateState[] =
  Object.values(SPOKE_GATE_STATE);

export const OFFBOARD_STEPS: readonly number[] = [
  MIGRATION_STEP.unlinkVaults,
  MIGRATION_STEP.rotateAssets,
  MIGRATION_STEP.removeManagers,
  MIGRATION_STEP.finalizeOffboard,
];

export interface SpokeGateInput {
  readonly hubPhase: number;
  readonly relayedSteps: readonly number[];
  readonly abortedGeneration?: number | null;
  readonly expectedFreezeGeneration?: number | null;
  readonly maxReservesRestored?: boolean;
}

export function countedFreezeGeneration(
  relayedSteps: readonly number[],
): number {
  return relayedSteps.filter((step) => step === MIGRATION_STEP.freeze).length;
}

const NO_ABORT = -1;

function abortedGenerationOf(input: SpokeGateInput): number {
  const aborted = input.abortedGeneration;
  if (aborted === undefined || aborted === null) {
    return NO_ABORT;
  }
  if (!Number.isInteger(aborted) || aborted < 0) {
    throw new BuilderArgumentMismatchError(
      `abortedGeneration ${String(aborted)} is not a non-negative integer`,
    );
  }
  return aborted;
}

export function deriveSpokeGateState(
  input: SpokeGateInput,
): SpokeGateState | null {
  const aborted = abortedGenerationOf(input);
  for (const step of input.relayedSteps) {
    migrationStepName(step);
  }
  const expected = input.expectedFreezeGeneration;
  if (expected !== undefined && expected !== null) {
    const counted = countedFreezeGeneration(input.relayedSteps);
    if (counted !== expected) {
      throw new BuilderArgumentMismatchError(
        `relayedSteps count ${counted} Freeze relays but the facade's freezeGeneration is ${expected}; the step history is incomplete`,
      );
    }
  }
  switch (hubPhaseName(input.hubPhase)) {
    case "none":
      return null;
    case "armed":
      return armedState(input.relayedSteps, aborted);
    case "hubOnboarded":
      return SPOKE_GATE_STATE.hubOnboarded;
    case "activated":
      return input.maxReservesRestored
        ? SPOKE_GATE_STATE.live
        : SPOKE_GATE_STATE.activatedNotRestored;
  }
}

function armedState(
  relayedSteps: readonly number[],
  aborted: number,
): SpokeGateState {
  let generation = 0;
  let freezeSent = false;
  let offboardSent = false;
  for (const step of relayedSteps) {
    if (step === MIGRATION_STEP.freeze) {
      generation += 1;
      freezeSent = generation > aborted;
    } else if (OFFBOARD_STEPS.includes(step) && generation > aborted) {
      offboardSent = true;
    }
  }
  if (offboardSent) {
    return SPOKE_GATE_STATE.offboardSent;
  }
  if (freezeSent) {
    return SPOKE_GATE_STATE.freezeSent;
  }
  return SPOKE_GATE_STATE.started;
}
