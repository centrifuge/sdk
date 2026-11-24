import { describe, expect, it } from "vitest";
import { encodeEventTopics, type Hex } from "viem";
import {
  ABI_SET_V3_3,
  ABIS_V3_3,
  ALL_ABIS_V3_3,
  DEFAULT_ABI_SETS,
  DEFAULT_EVENT_ABIS,
  DEFAULT_GENERATED_ABIS,
  getAbiSet,
  getContractAbis,
  GENERATED_ABIS_V3_3,
  getInstanceAbi,
} from "./index";
import { decodeProtocolEvent } from "../events";
import {
  UnknownProtocolVersionError,
  UnsupportedForProtocolVersionError,
} from "../errors";
import {
  CONTRACT_SCHEMA_V3_3,
  defaultDeploymentRegistry,
  DEPLOYMENTS_V3_3,
} from "../registry";
import { PROTOCOL_VERSION_V3_2, PROTOCOL_VERSION_V3_3 } from "../types";
import { v3_3TestRegistry } from "../builders/__fixtures__/v3_3-registry";

function hubFunctions(): string[] {
  return (ABIS_V3_3.Hub as readonly { type: string; name?: string }[])
    .filter((item) => item.type === "function")
    .map((item) => item.name ?? "");
}

describe("v3.3 ABI set", () => {
  it('resolves getAbiSet("3.3") to the generated set and keeps "3.1" unknown', () => {
    expect(getAbiSet(PROTOCOL_VERSION_V3_3)).toBe(DEFAULT_ABI_SETS["3.3"]);
    expect(getAbiSet(PROTOCOL_VERSION_V3_3)).toBe(ABI_SET_V3_3);
    expect(() => getAbiSet("3.1")).toThrow(UnknownProtocolVersionError);
  });

  it("keys every ABI-set entry by a registry contract the 3.3 schema knows", () => {
    const schema = new Set([
      ...CONTRACT_SCHEMA_V3_3.required,
      ...CONTRACT_SCHEMA_V3_3.optional,
    ]);
    for (const key of Object.keys(ABI_SET_V3_3)) {
      expect(schema.has(key), key).toBe(true);
    }
  });

  it("drops the contracts v3.3 removed and adds the ones it introduced", () => {
    expect(ABIS_V3_3).not.toHaveProperty("BalanceSheet");
    expect(ABIS_V3_3).not.toHaveProperty("VaultRegistry");
    expect(ABIS_V3_3).not.toHaveProperty("MerkleProofManager");
    for (const added of [
      "SpokeRegistry",
      "ShareTokenRegistrar",
      "ShareManager",
      "TokenBridge",
      "AdapterFailover",
      "BridgeCircuitBreaker",
      "CircuitBreakerGuard",
    ]) {
      expect(ABIS_V3_3).toHaveProperty(added);
    }
    expect(hubFunctions()).toContain("managerCall");
    expect(hubFunctions()).not.toContain("updateContract");
  });

  it("carries the v3.3 Escrow and EscrowFactory and no pool escrow", () => {
    expect(ABIS_V3_3).toHaveProperty("Escrow");
    expect(ABIS_V3_3).toHaveProperty("EscrowFactory");
    expect(ABIS_V3_3).not.toHaveProperty("PoolEscrow");
    expect(ABIS_V3_3).not.toHaveProperty("PoolEscrowFactory");
    expect(ABI_SET_V3_3.escrowFactory).toBe(ABIS_V3_3.EscrowFactory);
    expect(ABI_SET_V3_3).not.toHaveProperty("poolEscrowFactory");
    expect(getInstanceAbi(PROTOCOL_VERSION_V3_3, "poolEscrow")).toBe(
      ABIS_V3_3.Escrow,
    );
  });

  it("keeps SyncDepositVault out of the shared event table", () => {
    expect(ALL_ABIS_V3_3).not.toContain(GENERATED_ABIS_V3_3.SyncDepositVault);
    expect(DEFAULT_EVENT_ABIS[PROTOCOL_VERSION_V3_3]).toBe(ALL_ABIS_V3_3);
  });

  it("resolves instance ABIs by the v3.2 logical names", () => {
    expect(getInstanceAbi(PROTOCOL_VERSION_V3_3, "onOffRampManager")).toBe(
      ABIS_V3_3.OnOffRamp,
    );
    expect(getInstanceAbi(PROTOCOL_VERSION_V3_3, "onchainPM")).toBe(
      ABIS_V3_3.OnchainPM,
    );
  });

  it("is folded from the mainnet registry, whose v3.3 digests equal testnet's", () => {
    const source = DEFAULT_GENERATED_ABIS[PROTOCOL_VERSION_V3_3]!.source;
    expect(source.network).toBe("mainnet");
    expect(source.stackLabel).toBe("v3.3.0");
  });

  it("answers the v3.3 ABIs under the v3.2 contract names", () => {
    const abis = getContractAbis(PROTOCOL_VERSION_V3_3);
    expect(abis.Hub).toBe(ABIS_V3_3.Hub);
    expect(abis.VaultRouter).toBe(ABIS_V3_3.VaultRouter);
    expect(abis.OnOffRampManager).toBe(ABIS_V3_3.OnOffRamp);
    expect(abis.OnOffRampManagerFactory).toBe(ABIS_V3_3.OnOffRampFactory);
    expect(abis.PoolEscrow).toBe(ABIS_V3_3.Escrow);
    expect(abis.PoolEscrowFactory).toBe(ABIS_V3_3.EscrowFactory);
  });

  it("throws on reading a contract v3.3 deleted", () => {
    const abis = getContractAbis(PROTOCOL_VERSION_V3_3);
    expect(() => abis.BalanceSheet).toThrow(UnsupportedForProtocolVersionError);
    expect(() => abis.VaultRegistry).toThrow(
      UnsupportedForProtocolVersionError,
    );
    expect(() => abis.MerkleProofManager).toThrow(
      UnsupportedForProtocolVersionError,
    );
  });

  it("decodes a v3.3 Hub log through the default table under its own version key", () => {
    const topics = encodeEventTopics({
      abi: ABI_SET_V3_3.hub!,
      eventName: "NotifyPool",
      args: { centrifugeId: 2, poolId: 562949953421319n },
    }) as readonly Hex[];
    const decoded = decodeProtocolEvent(PROTOCOL_VERSION_V3_3, {
      topics,
      data: "0x",
    });
    expect(decoded.eventName).toBe("NotifyPool");
    expect(decoded.args).toEqual({ centrifugeId: 2, poolId: 562949953421319n });
  });
});

describe("v3.3 address set", () => {
  it("ships the four testnet chains of the layer and nothing on mainnet", () => {
    expect(Object.keys(DEPLOYMENTS_V3_3.mainnet)).toEqual([]);
    expect(
      Object.keys(DEPLOYMENTS_V3_3.testnet)
        .map(Number)
        .sort((a, b) => a - b),
    ).toEqual([1, 2, 3, 9]);
    expect(DEPLOYMENTS_V3_3.testnet[1]!.chainId).toBe(11155111);
    expect(DEPLOYMENTS_V3_3.testnet[9]!.chainId).toBe(998);
  });

  it("derives the schema from the layer: adapters are optional, everything else required", () => {
    expect(CONTRACT_SCHEMA_V3_3.optional).toEqual([
      "axelarAdapter",
      "chainlinkAdapter",
      "hyperlaneAdapter",
    ]);
    expect(CONTRACT_SCHEMA_V3_3.required).toContain("spokeRegistry");
    expect(CONTRACT_SCHEMA_V3_3.required).toContain("shareTokenRegistrar");
    expect(CONTRACT_SCHEMA_V3_3.required).not.toContain("balanceSheet");
  });

  it.each([1, 2, 3, 9])(
    "resolves testnet centrifugeId %i's escrow factory to the book's escrowFactory",
    (centrifugeId) => {
      const contracts = DEPLOYMENTS_V3_3.testnet[centrifugeId]!.contracts;
      expect(contracts.escrowFactory).toBe(
        "0xC77D5fb37fC9E4CC4aa5A8daB27Ad4AF6f09a18b",
      );
      expect(contracts).not.toHaveProperty("poolEscrowFactory");
    },
  );

  it("is wired into the default registry on testnet only, beside 3.2", () => {
    const registry = defaultDeploymentRegistry();
    expect(registry.versionsForChain("testnet", 1)).toEqual([
      PROTOCOL_VERSION_V3_2,
      PROTOCOL_VERSION_V3_3,
    ]);
    expect(registry.versionsForChain("mainnet", 1)).toEqual([
      PROTOCOL_VERSION_V3_2,
    ]);
    expect(() =>
      registry.getDeployment("mainnet", PROTOCOL_VERSION_V3_3, 1),
    ).toThrow(UnknownProtocolVersionError);
  });

  it("serves the 3.3 hub from the address book stack, apart from the 3.2 hub", () => {
    const registry = v3_3TestRegistry();
    const sepolia = registry.getDeployment("testnet", PROTOCOL_VERSION_V3_3, 1);
    expect(sepolia.contracts.hub).toBe(
      DEPLOYMENTS_V3_3.testnet[1]!.contracts.hub,
    );
    expect(sepolia.contracts.hub).not.toBe(
      registry.getDeployment("testnet", PROTOCOL_VERSION_V3_2, 1).contracts.hub,
    );
  });
});
