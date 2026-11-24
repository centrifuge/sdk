import type { Abi } from "viem";
import type { AbiSet } from "../../types";
import { GENERATED_ABIS_V3_3 } from "@centrifuge/addressbook/abis";
import { ABIS_V3_2 } from "../v3_2";

export { GENERATED_ABIS_V3_3 };

/**
 * The vault-factory ABI the SDK reads `getVault` through on v3.3. The
 * `AsyncVaultFactory` and `SyncDepositVaultFactory` ABIs share that function,
 * so one serves whichever factory a vault is deployed by.
 */
export const VAULT_FACTORY_ABI_V3_3 = GENERATED_ABIS_V3_3.AsyncVaultFactory;

/**
 * Typed v3.3 ABI constants, keyed by contract name. Every contract the
 * registry publishes for v3.3 comes from the address book package, the restriction hooks through
 * `FullRestrictions` (the superset the SDK reads `isMember` and `isFrozen`
 * on); the ERC-20, ERC-6909 and multicall interfaces are the v3.2 objects
 * (`STANDARD_ABIS`). `BalanceSheet` and `VaultRegistry` are gone (folded
 * into `Spoke` and `SpokeRegistry`), and the merkle-proof manager has no v3.3
 * factory, so none of the three appear. `SyncDepositVault` is in
 * `GENERATED_ABIS_V3_3` but kept out of this set and of {@link ALL_ABIS_V3_3}: its
 * `Deposit` shares a topic0 with `AsyncVault.Deposit` under a different
 * argument meaning, so it decodes from its own table.
 */
export const ABIS_V3_3 = {
  Hub: GENERATED_ABIS_V3_3.Hub,
  ShareClassManager: GENERATED_ABIS_V3_3.ShareClassManager,
  BatchRequestManager: GENERATED_ABIS_V3_3.BatchRequestManager,
  BridgeCircuitBreaker: GENERATED_ABIS_V3_3.BridgeCircuitBreaker,
  CircuitBreakerGuard: GENERATED_ABIS_V3_3.CircuitBreakerGuard,
  HubRegistry: GENERATED_ABIS_V3_3.HubRegistry,
  MessageDispatcher: GENERATED_ABIS_V3_3.MessageDispatcher,
  Currency: ABIS_V3_2.Currency,
  ERC6909: ABIS_V3_2.ERC6909,
  RestrictionManager: GENERATED_ABIS_V3_3.FullRestrictions,
  AsyncVault: GENERATED_ABIS_V3_3.AsyncVault,
  Spoke: GENERATED_ABIS_V3_3.Spoke,
  SpokeRegistry: GENERATED_ABIS_V3_3.SpokeRegistry,
  ShareTokenRegistrar: GENERATED_ABIS_V3_3.ShareTokenRegistrar,
  ShareManager: GENERATED_ABIS_V3_3.ShareManager,
  Gateway: GENERATED_ABIS_V3_3.Gateway,
  VaultRouter: GENERATED_ABIS_V3_3.VaultRouter,
  Accounting: GENERATED_ABIS_V3_3.Accounting,
  AccountingToken: GENERATED_ABIS_V3_3.AccountingToken,
  Holdings: GENERATED_ABIS_V3_3.Holdings,
  Valuation: GENERATED_ABIS_V3_3.IdentityValuation,
  SyncManager: GENERATED_ABIS_V3_3.SyncManager,
  AsyncRequests: GENERATED_ABIS_V3_3.AsyncRequestManager,
  MultiAdapter: GENERATED_ABIS_V3_3.MultiAdapter,
  GasService: GENERATED_ABIS_V3_3.GasService,
  Escrow: GENERATED_ABIS_V3_3.Escrow,
  EscrowFactory: GENERATED_ABIS_V3_3.EscrowFactory,
  OnOffRamp: GENERATED_ABIS_V3_3.OnOffRamp,
  OnOffRampFactory: GENERATED_ABIS_V3_3.OnOffRampFactory,
  OnchainPM: GENERATED_ABIS_V3_3.OnchainPM,
  OnchainPMFactory: GENERATED_ABIS_V3_3.OnchainPMFactory,
  OracleValuation: GENERATED_ABIS_V3_3.OracleValuation,
  NAVManager: GENERATED_ABIS_V3_3.NAVManager,
  QueueManager: GENERATED_ABIS_V3_3.QueueManager,
  SnapshotQueue: GENERATED_ABIS_V3_3.SnapshotQueue,
  TokenBridge: GENERATED_ABIS_V3_3.TokenBridge,
  AdapterFailover: GENERATED_ABIS_V3_3.AdapterFailover,
  ScriptHelpers: GENERATED_ABIS_V3_3.ScriptHelpers,
  Multicall: ABIS_V3_2.Multicall,
  Root: GENERATED_ABIS_V3_3.Root,
} as const;

/**
 * Every v3.3 ABI the `"3.3"` event-decode table is built from, instance
 * ABIs included.
 */
export const ALL_ABIS_V3_3: readonly Abi[] = [...Object.values(ABIS_V3_3)];

/**
 * v3.3 ABIs of contracts deployed per pool or per share class, keyed by the
 * same logical names v3.2 uses so a builder resolves them by version alone.
 */
export const INSTANCE_ABI_SET_V3_3: AbiSet = {
  onOffRampManager: ABIS_V3_3.OnOffRamp,
  onchainPM: ABIS_V3_3.OnchainPM,
  // v3.3 calls the per-pool escrow `Escrow`; the key stays v3.2's logical name.
  poolEscrow: ABIS_V3_3.Escrow,
  asyncVault: ABIS_V3_3.AsyncVault,
};

/**
 * v3.3 ABI set keyed by registry contract name; every key is a
 * `CONTRACT_SCHEMA_V3_3` contract, enforced by `createDeploymentRegistry`.
 */
export const ABI_SET_V3_3: AbiSet = {
  hub: ABIS_V3_3.Hub,
  hubRegistry: ABIS_V3_3.HubRegistry,
  shareClassManager: ABIS_V3_3.ShareClassManager,
  batchRequestManager: ABIS_V3_3.BatchRequestManager,
  bridgeCircuitBreaker: ABIS_V3_3.BridgeCircuitBreaker,
  circuitBreakerGuard: ABIS_V3_3.CircuitBreakerGuard,
  messageDispatcher: ABIS_V3_3.MessageDispatcher,
  spoke: ABIS_V3_3.Spoke,
  spokeRegistry: ABIS_V3_3.SpokeRegistry,
  shareTokenRegistrar: ABIS_V3_3.ShareTokenRegistrar,
  shareManager: ABIS_V3_3.ShareManager,
  gateway: ABIS_V3_3.Gateway,
  vaultRouter: ABIS_V3_3.VaultRouter,
  accounting: ABIS_V3_3.Accounting,
  holdings: ABIS_V3_3.Holdings,
  syncManager: ABIS_V3_3.SyncManager,
  asyncRequestManager: ABIS_V3_3.AsyncRequests,
  multiAdapter: ABIS_V3_3.MultiAdapter,
  gasService: ABIS_V3_3.GasService,
  escrowFactory: ABIS_V3_3.EscrowFactory,
  onOffRampFactory: ABIS_V3_3.OnOffRampFactory,
  onchainPMFactory: ABIS_V3_3.OnchainPMFactory,
  oracleValuation: ABIS_V3_3.OracleValuation,
  navManager: ABIS_V3_3.NAVManager,
  queueManager: ABIS_V3_3.QueueManager,
  snapshotQueue: ABIS_V3_3.SnapshotQueue,
  identityValuation: ABIS_V3_3.Valuation,
  accountingToken: ABIS_V3_3.AccountingToken,
  tokenBridge: ABIS_V3_3.TokenBridge,
  adapterFailover: ABIS_V3_3.AdapterFailover,
  // The SDK reads `getVault` from both (`VAULT_FACTORY_ABI_V3_3`) and signs
  // the vault address it predicts.
  asyncVaultFactory: GENERATED_ABIS_V3_3.AsyncVaultFactory,
  syncDepositVaultFactory: GENERATED_ABIS_V3_3.SyncDepositVaultFactory,
};
