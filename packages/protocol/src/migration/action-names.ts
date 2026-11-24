import { BuilderArgumentMismatchError } from "../errors";
import {
  isAllowed,
  isBridgeAllowed,
  isMigrationAction,
  MIGRATION_ACTION,
  refused,
  type GateAnswer,
  type GateOptions,
  type MigrationAction,
} from "./gate";
import { SPOKE_GATE_STATE, type SpokeGateState } from "./gate-state";

export interface NamedActionOptions extends GateOptions {
  readonly destinationState?: SpokeGateState;
}

const BY_NAME = new Map<string, MigrationAction>([
  ["requestDeposit", MIGRATION_ACTION.investorRequest],
  ["requestRedeem", MIGRATION_ACTION.investorRequest],
  ["lockDepositRequest", MIGRATION_ACTION.investorRequest],
  ["enableLockDepositRequest", MIGRATION_ACTION.investorRequest],
  ["executeLockedDepositRequest", MIGRATION_ACTION.investorRequest],
  ["erc7540_requestDeposit", MIGRATION_ACTION.investorRequest],
  ["erc7540_requestRedeem", MIGRATION_ACTION.investorRequest],
  ["cancelDepositRequest", MIGRATION_ACTION.investorCancel],
  ["cancelRedeemRequest", MIGRATION_ACTION.investorCancel],
  ["unlockDepositRequest", MIGRATION_ACTION.investorCancel],
  ["claimDeposit", MIGRATION_ACTION.investorClaim],
  ["claimRedeem", MIGRATION_ACTION.investorClaim],
  ["erc7540_claimDeposit", MIGRATION_ACTION.investorClaim],
  ["erc7540_claimRedeem", MIGRATION_ACTION.investorClaim],
  ["crosschainTransferShares", MIGRATION_ACTION.bridgeOut],
  ["approveDeposits", MIGRATION_ACTION.settlement],
  ["approveRedeems", MIGRATION_ACTION.settlement],
  ["issueShares", MIGRATION_ACTION.settlement],
  ["revokeShares", MIGRATION_ACTION.settlement],
  ["issueSharesDirect", MIGRATION_ACTION.settlement],
  ["revokeSharesDirect", MIGRATION_ACTION.settlement],
  ["forceCancelDepositRequest", MIGRATION_ACTION.settlement],
  ["forceCancelRedeemRequest", MIGRATION_ACTION.settlement],
  ["notifyOrderClaims", MIGRATION_ACTION.notify],
  ["notifyDeposit", MIGRATION_ACTION.notify],
  ["notifyRedeem", MIGRATION_ACTION.notify],
  ["notifyShareClass", MIGRATION_ACTION.spokeConfiguration],
  ["updateSharePrice", MIGRATION_ACTION.hubPrice],
  ["updateMember", MIGRATION_ACTION.investorRestriction],
  ["freezeMember", MIGRATION_ACTION.investorRestriction],
  ["unfreezeMember", MIGRATION_ACTION.investorRestriction],
  ["deployVault", MIGRATION_ACTION.spokeConfiguration],
  ["updateVault", MIGRATION_ACTION.spokeConfiguration],
  ["updateVaults", MIGRATION_ACTION.spokeConfiguration],
  ["updateManager", MIGRATION_ACTION.spokeConfiguration],
  ["updatePoolManagers", MIGRATION_ACTION.spokeConfiguration],
  ["updateBalanceSheetManagers", MIGRATION_ACTION.spokeConfiguration],
  ["registerOnOffRamp", MIGRATION_ACTION.spokeConfiguration],
]);

export const MIGRATION_ACTION_BY_NAME: ReadonlyMap<string, MigrationAction> =
  BY_NAME;

export const UNMAPPED_BUILDER_ACTIONS: readonly string[] = [
  "setPoolMetadata",
  "createHolding",
  "depositHolding",
  "withdrawHolding",
  "hubManagerCall",
  "shareManagerCall",
  "repayBatch",
];

export function migrationActionOf(actionName: string): MigrationAction | null {
  if (isMigrationAction(actionName)) {
    return actionName;
  }
  return BY_NAME.get(actionName) ?? null;
}

function requireBridgeOptions(
  actionName: string,
  options: NamedActionOptions,
): { spokeIsHubChain: boolean; destinationState: SpokeGateState } {
  if (options.spokeIsHubChain === undefined) {
    throw new BuilderArgumentMismatchError(
      `${actionName} needs spokeIsHubChain: the hub chain's spoke and a remote spoke have different rows`,
    );
  }
  if (options.destinationState === undefined) {
    throw new BuilderArgumentMismatchError(
      `${actionName} needs destinationState: a bridge is gated at both ends`,
    );
  }
  return {
    spokeIsHubChain: options.spokeIsHubChain,
    destinationState: options.destinationState,
  };
}

export function isActionAllowed(
  state: SpokeGateState | null,
  actionName: string,
  options: NamedActionOptions = {},
): GateAnswer {
  const action = migrationActionOf(actionName);
  const bridge =
    action === MIGRATION_ACTION.bridgeOut
      ? requireBridgeOptions(actionName, options)
      : null;
  if (state === null) {
    return { allowed: true };
  }
  if (action === null) {
    return state === SPOKE_GATE_STATE.live
      ? { allowed: true }
      : refused(state, actionName, "?", options);
  }
  if (bridge === null) {
    return isAllowed(state, action, options);
  }
  return isBridgeAllowed(
    { state, isHubChain: bridge.spokeIsHubChain },
    { state: bridge.destinationState },
  );
}
