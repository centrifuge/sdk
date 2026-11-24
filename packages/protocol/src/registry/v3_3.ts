import type { ContractSchema } from "../types";

/** The address book stack this version's deployments are read from. */
export const STACK_LABEL_V3_3 = "v3.3.0";

/**
 * v3.3.0 contract-name schema, maintained by hand: `required` contracts
 * exist on every chain with a `v3.3.0` stack, `optional` ones on some. Names
 * outside it are filtered from the book's stack; a missing required name
 * throws `DeploymentVerificationError` when the registry is validated.
 */
export const CONTRACT_SCHEMA_V3_3: ContractSchema = {
  required: [
    "accounting",
    "accountingToken",
    "adapterFailover",
    "approvalGuard",
    "asyncRequestManager",
    "asyncVaultFactory",
    "batchRequestManager",
    "bridgeCircuitBreaker",
    "circuitBreakerGuard",
    "envoy",
    "escrowFactory",
    "flashLoanHelper",
    "freelyTransferableHook",
    "freezeOnlyHook",
    "fullRestrictionsHook",
    "gasService",
    "gateway",
    "holdings",
    "hub",
    "hubHandler",
    "hubRegistry",
    "identityValuation",
    "layerZeroAdapter",
    "messageDispatcher",
    "messageProcessor",
    "multiAdapter",
    "navManager",
    "onOffRampFactory",
    "onchainPMFactory",
    "opsGuardian",
    "oracleValuation",
    "protocolGuardian",
    "queueManager",
    "redemptionRestrictionsHook",
    "refundEscrowFactory",
    "root",
    "scriptHelpers",
    "shareClassManager",
    "shareManager",
    "shareTokenRegistrar",
    "simplePriceManager",
    "slippageGuard",
    "snapshotQueue",
    "spoke",
    "spokeHandler",
    "spokeRegistry",
    "subsidyManager",
    "syncDepositVaultFactory",
    "syncManager",
    "tokenBridge",
    "vaultRouter",
  ],
  optional: ["axelarAdapter", "chainlinkAdapter", "hyperlaneAdapter"],
};
