import { BuilderArgumentMismatchError } from "../errors";
import { SPOKE_GATE_STATES, type SpokeGateState } from "./gate-state";

export const MIGRATION_ACTION = {
  investorRequest: "investorRequest",
  investorCancel: "investorCancel",
  syncDeposit: "syncDeposit",
  investorClaim: "investorClaim",
  bridgeOut: "bridgeOut",
  bridgeToward: "bridgeToward",
  settlement: "settlement",
  notify: "notify",
  hubPrice: "hubPrice",
  investorRestriction: "investorRestriction",
  spokeConfiguration: "spokeConfiguration",
  bridgerGrant: "bridgerGrant",
  poolConfiguration: "poolConfiguration",
  shareTransfer: "shareTransfer",
} as const;

export type MigrationAction =
  (typeof MIGRATION_ACTION)[keyof typeof MIGRATION_ACTION];

export const MIGRATION_ACTIONS: readonly MigrationAction[] =
  Object.values(MIGRATION_ACTION);

export type GateVerdict = "A" | "R" | "C" | "-" | "?";

export const POOL_MIGRATING = "POOL_MIGRATING";

export interface GateOptions {
  readonly spokeIsHubChain?: boolean;
}

export type GateAnswer =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly code: typeof POOL_MIGRATING;
      readonly state: SpokeGateState;
      readonly action: string;
      readonly verdict: GateVerdict;
      readonly reason: string;
      readonly allowedActions: readonly MigrationAction[];
    };

type Row = readonly [
  GateVerdict,
  GateVerdict,
  GateVerdict,
  GateVerdict,
  GateVerdict,
  GateVerdict,
];

const BRIDGE_OUT_HUB_CHAIN: Row = ["A", "R", "R", "R", "R", "A"];

const TABLE: Readonly<Record<MigrationAction, Row>> = {
  investorRequest: ["A", "R", "C", "C", "R", "A"],
  investorCancel: ["A", "R", "C", "C", "R", "A"],
  syncDeposit: ["A", "R", "C", "C", "C", "A"],
  investorClaim: ["A", "A", "R", "C", "C", "A"],
  bridgeOut: ["A", "A", "C", "C", "C", "A"],
  bridgeToward: ["A", "A", "R", "R", "R", "A"],
  settlement: ["A", "A", "R", "C", "R", "A"],
  notify: ["A", "A", "R", "R", "R", "A"],
  hubPrice: ["A", "A", "A", "C", "A", "A"],
  investorRestriction: ["A", "A", "A", "C", "A", "A"],
  spokeConfiguration: ["R", "R", "R", "C", "R", "A"],
  bridgerGrant: ["-", "-", "-", "-", "R", "A"],
  poolConfiguration: ["-", "-", "-", "-", "A", "A"],
  shareTransfer: ["A", "A", "A", "A", "A", "A"],
};

export function isMigrationAction(value: string): value is MigrationAction {
  return (MIGRATION_ACTIONS as readonly string[]).includes(value);
}

function rowOf(action: MigrationAction, options: GateOptions): Row {
  if (!isMigrationAction(action)) {
    throw new BuilderArgumentMismatchError(
      `${String(action)} is not a migration gate action`,
    );
  }
  if (action !== MIGRATION_ACTION.bridgeOut) {
    return TABLE[action];
  }
  if (options.spokeIsHubChain === undefined) {
    throw new BuilderArgumentMismatchError(
      "bridgeOut needs spokeIsHubChain: the hub chain's spoke and a remote spoke have different rows",
    );
  }
  return options.spokeIsHubChain ? BRIDGE_OUT_HUB_CHAIN : TABLE[action];
}

export function gateVerdict(
  state: SpokeGateState,
  action: MigrationAction,
  options: GateOptions = {},
): GateVerdict {
  const verdict = rowOf(action, options)[SPOKE_GATE_STATES.indexOf(state)];
  if (verdict === undefined) {
    throw new BuilderArgumentMismatchError(
      `${String(state)} is not a spoke gate state`,
    );
  }
  return verdict;
}

export function allowedActionsIn(
  state: SpokeGateState,
  options: GateOptions = {},
): readonly MigrationAction[] {
  return MIGRATION_ACTIONS.filter(
    (action) =>
      (action !== MIGRATION_ACTION.bridgeOut ||
        options.spokeIsHubChain !== undefined) &&
      gateVerdict(state, action, options) === "A",
  );
}

const REASONS: Readonly<Record<Exclude<GateVerdict, "A">, string>> = {
  R: "the migration state refuses this action",
  C: "the chain would refuse this action in this migration state",
  "-": "this action does not exist on the protocol version the spoke runs in this state",
  "?": "this action has no row in the migration gate table; a migrating pool refuses it until one is decided",
};

export function refused(
  state: SpokeGateState,
  action: string,
  verdict: Exclude<GateVerdict, "A">,
  options: GateOptions = {},
): GateAnswer {
  return {
    allowed: false,
    code: POOL_MIGRATING,
    state,
    action,
    verdict,
    reason: REASONS[verdict],
    allowedActions: allowedActionsIn(state, options),
  };
}

export function isAllowed(
  state: SpokeGateState | null,
  action: MigrationAction,
  options: GateOptions = {},
): GateAnswer {
  if (state === null) {
    return { allowed: true };
  }
  const verdict = gateVerdict(state, action, options);
  if (verdict === "A") {
    return { allowed: true };
  }
  return refused(state, action, verdict, options);
}

export interface BridgeSource {
  readonly state: SpokeGateState | null;
  readonly isHubChain?: boolean;
}

export interface BridgeDestination {
  readonly state: SpokeGateState | null;
}

export function isBridgeAllowed(
  source: BridgeSource,
  destination: BridgeDestination,
): GateAnswer {
  const out = isAllowed(source.state, MIGRATION_ACTION.bridgeOut, {
    spokeIsHubChain: source.isHubChain,
  });
  if (!out.allowed) {
    return out;
  }
  return isAllowed(destination.state, MIGRATION_ACTION.bridgeToward);
}
