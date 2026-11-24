import { parseAbi } from "viem";
import type { Abi } from "viem";
import type { AbiSet } from "../../types";
import { GENERATED_ABIS_V3_2 } from "@centrifuge/addressbook/abis";
import { CURRENCY_ABI_V3_2 } from "./currency.abi";
import { ERC6909_ABI_V3_2 } from "./erc6909.abi";
import { MULTICALL_ABI_V3_2 } from "./multicall.abi";

export { GENERATED_ABIS_V3_2 };

export { CURRENCY_ABI_V3_2, ERC6909_ABI_V3_2, MULTICALL_ABI_V3_2 };

/**
 * Typed v3.2 ABI constants, keyed by contract name — the shape the SDK imports
 * as `ABI`. Every protocol contract is an `as const` registry ABI from the
 * address book package; only the ERC-20, ERC-6909 and multicall interfaces are
 * parsed from hand-written signatures. Both keep viem's type inference at call sites.
 */
export const ABIS_V3_2 = {
  Hub: GENERATED_ABIS_V3_2.Hub,
  ShareClassManager: GENERATED_ABIS_V3_2.ShareClassManager,
  BatchRequestManager: GENERATED_ABIS_V3_2.BatchRequestManager,
  HubRegistry: GENERATED_ABIS_V3_2.HubRegistry,
  MessageDispatcher: GENERATED_ABIS_V3_2.MessageDispatcher,
  Currency: parseAbi(CURRENCY_ABI_V3_2),
  ERC6909: parseAbi(ERC6909_ABI_V3_2),
  RestrictionManager: GENERATED_ABIS_V3_2.FullRestrictions,
  MerkleProofManager: GENERATED_ABIS_V3_2.MerkleProofManager,
  AsyncVault: GENERATED_ABIS_V3_2.AsyncVault,
  Spoke: GENERATED_ABIS_V3_2.Spoke,
  VaultRegistry: GENERATED_ABIS_V3_2.VaultRegistry,
  Gateway: GENERATED_ABIS_V3_2.Gateway,
  VaultRouter: GENERATED_ABIS_V3_2.VaultRouter,
  Accounting: GENERATED_ABIS_V3_2.Accounting,
  AccountingToken: GENERATED_ABIS_V3_2.AccountingToken,
  Holdings: GENERATED_ABIS_V3_2.Holdings,
  Valuation: GENERATED_ABIS_V3_2.IdentityValuation,
  SyncManager: GENERATED_ABIS_V3_2.SyncManager,
  AsyncRequests: GENERATED_ABIS_V3_2.AsyncRequestManager,
  MultiAdapter: GENERATED_ABIS_V3_2.MultiAdapter,
  BalanceSheet: GENERATED_ABIS_V3_2.BalanceSheet,
  GasService: GENERATED_ABIS_V3_2.GasService,
  PoolEscrow: GENERATED_ABIS_V3_2.PoolEscrow,
  PoolEscrowFactory: GENERATED_ABIS_V3_2.PoolEscrowFactory,
  OnOffRampManager: GENERATED_ABIS_V3_2.OnOffRamp,
  OnOffRampManagerFactory: GENERATED_ABIS_V3_2.OnOffRampFactory,
  MerkleProofManagerFactory: GENERATED_ABIS_V3_2.MerkleProofManagerFactory,
  OnchainPM: GENERATED_ABIS_V3_2.OnchainPM,
  OnchainPMFactory: GENERATED_ABIS_V3_2.OnchainPMFactory,
  OracleValuation: GENERATED_ABIS_V3_2.OracleValuation,
  ScriptHelpers: GENERATED_ABIS_V3_2.ScriptHelpers,
  Multicall: parseAbi(MULTICALL_ABI_V3_2),
  Root: GENERATED_ABIS_V3_2.Root,
} as const;

/**
 * Every v3.2 ABI, including instance ABIs (vault tokens, per-pool managers)
 * that carry no registry address. This is the event-decode source for the
 * version: the decode table entry for `"3.2"` is built from exactly these.
 */
export const ALL_ABIS_V3_2: readonly Abi[] = [
  ...Object.values(ABIS_V3_2),
  GENERATED_ABIS_V3_2.NAVManager,
  GENERATED_ABIS_V3_2.QueueManager,
  // The legacy factory's `DeployOnOfframpManager`; `ABIS_V3_2.OnOffRampManagerFactory`
  // is the newer factory, which emits `DeployOnOffRamp`.
  GENERATED_ABIS_V3_2.OnOfframpManagerFactory,
];

/**
 * Parsed v3.2 ABIs of contracts deployed PER POOL OR PER SHARE CLASS, keyed by
 * a stable logical name.
 *
 * Deliberately separate from {@link ABI_SET_V3_2}: these contracts have no
 * registry address (their address is projected in `chain_v1`, or read from the
 * factory that deployed them), and `createDeploymentRegistry` rejects an ABI-set
 * key that is not a schema contract name. A builder encoding a call against one
 * of them resolves the ABI by version through `getInstanceAbi`, so the
 * version-plural rule holds here too (restructure constraints, rule 1).
 */
export const INSTANCE_ABI_SET_V3_2: AbiSet = {
  onOffRampManager: ABIS_V3_2.OnOffRampManager,
  merkleProofManager: ABIS_V3_2.MerkleProofManager,
  onchainPM: ABIS_V3_2.OnchainPM,
  poolEscrow: ABIS_V3_2.PoolEscrow,
  asyncVault: ABIS_V3_2.AsyncVault,
};

/**
 * Parsed v3.2 ABI set, keyed by registry contract name (the same keys the
 * address sets use). Only contracts with both a registry address and a
 * bundled ABI appear here; consistency with the address schema is enforced
 * by `createDeploymentRegistry` (every key here must be a schema contract).
 */
export const ABI_SET_V3_2: AbiSet = {
  hub: ABIS_V3_2.Hub,
  hubRegistry: ABIS_V3_2.HubRegistry,
  shareClassManager: ABIS_V3_2.ShareClassManager,
  batchRequestManager: ABIS_V3_2.BatchRequestManager,
  messageDispatcher: ABIS_V3_2.MessageDispatcher,
  spoke: ABIS_V3_2.Spoke,
  vaultRegistry: ABIS_V3_2.VaultRegistry,
  gateway: ABIS_V3_2.Gateway,
  vaultRouter: ABIS_V3_2.VaultRouter,
  accounting: ABIS_V3_2.Accounting,
  holdings: ABIS_V3_2.Holdings,
  syncManager: ABIS_V3_2.SyncManager,
  asyncRequestManager: ABIS_V3_2.AsyncRequests,
  multiAdapter: ABIS_V3_2.MultiAdapter,
  balanceSheet: ABIS_V3_2.BalanceSheet,
  gasService: ABIS_V3_2.GasService,
  poolEscrowFactory: ABIS_V3_2.PoolEscrowFactory,
  onOfframpManagerFactory: GENERATED_ABIS_V3_2.OnOfframpManagerFactory,
  onOffRampFactory: ABIS_V3_2.OnOffRampManagerFactory,
  merkleProofManagerFactory: ABIS_V3_2.MerkleProofManagerFactory,
  onchainPMFactory: ABIS_V3_2.OnchainPMFactory,
  oracleValuation: ABIS_V3_2.OracleValuation,
  navManager: GENERATED_ABIS_V3_2.NAVManager,
  queueManager: GENERATED_ABIS_V3_2.QueueManager,
  identityValuation: ABIS_V3_2.Valuation,
  accountingToken: ABIS_V3_2.AccountingToken,
};
