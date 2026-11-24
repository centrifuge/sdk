import type { Abi } from "viem";
import type { ChainEnvironment, DeployedContractVersions } from "../types";
import { abiSignatures } from "./signatures";

/**
 * Registry contract name of each bundled ABI whose name is not the
 * lower-camel form of the ABI name. A per-pool contract (a vault, a pool
 * escrow) has no registry address, so it resolves to the factory that
 * deploys it: the factory's version is the version it deploys.
 */
const REGISTRY_KEY_OVERRIDES: Readonly<Record<string, string>> = {
  AsyncVault: "asyncVaultFactory",
  FullRestrictions: "fullRestrictionsHook",
  MerkleProofManager: "merkleProofManagerFactory",
  NAVManager: "navManager",
  OnOffRamp: "onOffRampFactory",
  OnOfframpManager: "onOfframpManagerFactory",
  OnchainPM: "onchainPMFactory",
  PoolEscrow: "poolEscrowFactory",
};

/** The registry contract name the deployed version of a bundled ABI is recorded under. */
export function registryKeyForAbi(contract: string): string {
  return (
    REGISTRY_KEY_OVERRIDES[contract] ??
    `${contract.charAt(0).toLowerCase()}${contract.slice(1)}`
  );
}

/** One chain whose deployed contract does not carry the bundled signatures. */
export interface DeployedAbiDrift {
  readonly environment: ChainEnvironment;
  readonly centrifugeId: number;
  /** Bundled ABI name, e.g. `OracleValuation`. */
  readonly contract: string;
  /** The version label the chain runs, e.g. `v3.1`. */
  readonly deployedVersion: string;
  /** Bundled signatures the deployed contract does not have. */
  readonly missing: readonly string[];
  /** Deployed signatures the bundle does not have. */
  readonly extra: readonly string[];
}

export interface FindDeployedAbiDriftOptions {
  /** The bundled ABIs, keyed by ABI name. */
  readonly bundled: Readonly<Record<string, Abi>>;
  /** The label the bundle was folded from (`v3.2`): a contract labelled so matches by construction. */
  readonly bundledVersion: string;
  /** What each chain runs (`CONTRACT_VERSIONS_V3_2`). */
  readonly versions: DeployedContractVersions;
  /** Signatures per other label, then per ABI name (`registry-abis/v3_1.signatures.json`). */
  readonly signatures: Readonly<
    Record<string, Readonly<Record<string, readonly string[]>>>
  >;
}

/**
 * Compare every bundled ABI with the signatures of the version each chain
 * runs, and return every chain/contract pair that differs. Signatures only
 * (see {@link abiSignatures}): a semantic change behind an identical
 * signature is not drift here.
 *
 * Throws when a chain runs a label with no signature snapshot for that
 * contract: an unknown version is a refresh to make, not a match to assume.
 */
export function findDeployedAbiDrift({
  bundled,
  bundledVersion,
  versions,
  signatures,
}: FindDeployedAbiDriftOptions): DeployedAbiDrift[] {
  const drift: DeployedAbiDrift[] = [];
  for (const environment of Object.keys(versions) as ChainEnvironment[]) {
    for (const [cid, chain] of Object.entries(versions[environment])) {
      for (const [contract, abi] of Object.entries(bundled)) {
        const deployedVersion = chain[registryKeyForAbi(contract)];
        if (
          deployedVersion === undefined ||
          deployedVersion === bundledVersion
        ) {
          continue;
        }
        const deployed = signatures[deployedVersion]?.[contract];
        if (!deployed) {
          throw new Error(
            `${environment} centrifugeId ${cid} runs ${contract} ${deployedVersion}, ` +
              `which has no signature snapshot`,
          );
        }
        const ours = abiSignatures(abi);
        const missing = ours.filter((s) => !deployed.includes(s));
        const extra = deployed.filter((s) => !ours.includes(s));
        if (missing.length || extra.length) {
          drift.push({
            environment,
            centrifugeId: Number(cid),
            contract,
            deployedVersion,
            missing,
            extra,
          });
        }
      }
    }
  }
  return drift;
}
