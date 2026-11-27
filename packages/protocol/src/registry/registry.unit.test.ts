import { describe, expect, it } from "vitest";
import { parseAbi } from "viem";
import { DEFAULT_ABI_SETS } from "../abis";
import {
  DeploymentVerificationError,
  UnknownDeploymentError,
  UnknownProtocolVersionError,
} from "../errors";
import {
  PROTOCOL_VERSION_V3_2,
  PROTOCOL_VERSION_V3_3,
  type DeploymentRegistryData,
} from "../types";
import {
  CONTRACT_SCHEMA_V3_2,
  CONTRACT_SCHEMA_V3_3,
  createDeploymentRegistry,
  DEFAULT_DEPLOYMENT_DATA,
  DEPLOYMENTS_V3_2,
  getDeployment,
} from "./index";

describe("deployment registry", () => {
  it("loads the v3.2 address set for mainnet", () => {
    const d = getDeployment("mainnet", PROTOCOL_VERSION_V3_2, 1);
    expect(d.chainId).toBe(1);
    expect(d.name).toBe("ethereum");
    expect(d.contracts.hub).toBe("0xA4A7Bb3831958463b3FE3E27A6a160F764341953");
    expect(d.contracts.hubRegistry).toBe(
      "0x19f46D8130e610C6C0f0116EA40Fb781dEFaDE93",
    );
  });

  it("loads the v3.2 address set for testnet", () => {
    const d = getDeployment("testnet", PROTOCOL_VERSION_V3_2, 1);
    expect(d.chainId).toBe(11155111);
    expect(d.name).toBe("sepolia");
    expect(d.contracts.hub).toBe("0xb2D1EBaEB0007578B09a555F8FB05DaD9150cFDD");
  });

  it("loads the v3.2 address set for Arc mainnet", () => {
    const d = getDeployment("mainnet", PROTOCOL_VERSION_V3_2, 14);
    expect(d.chainId).toBe(5042);
    expect(d.name).toBe("arc");
    expect(d.contracts.root).toBe("0xdc9456e7e20f15029C8231Ec433a20F404b7235E");
    expect(d.contracts.spoke).toBe(
      "0xEC3582fcDc34078a4B7a8c75a5a3AE46f48525aB",
    );
  });

  it("lists Arc's accounting token and OnchainPM factory from its env file", () => {
    const d = getDeployment("mainnet", PROTOCOL_VERSION_V3_2, 14);
    expect(d.contracts.accountingToken).toBe(
      "0x25cD3c315d21251e2D413A0F0B14F2951b218313",
    );
    expect(d.contracts.onchainPMFactory).toBe(
      "0x98d52b248eDB87ebdCAB91bFa3e418343ae0930B",
    );
  });

  it("carries no Wormhole adapter address on any chain of either environment", () => {
    for (const environment of ["mainnet", "testnet"] as const) {
      for (const centrifugeId of Object.keys(
        DEFAULT_DEPLOYMENT_DATA[environment][PROTOCOL_VERSION_V3_2] ?? {},
      ).map(Number)) {
        const d = getDeployment(
          environment,
          PROTOCOL_VERSION_V3_2,
          centrifugeId,
        );
        expect(
          d.contracts.wormholeAdapter,
          `${environment}/${centrifugeId}`,
        ).toBeUndefined();
      }
    }
  });

  it("returns DIFFERENT chains for the same centrifugeId across environments", () => {
    // Mainnet and testnet reuse centrifugeIds for different chains and
    // different hubs — the reason lookups are environment-keyed.
    const main = getDeployment("mainnet", PROTOCOL_VERSION_V3_2, 2);
    const test = getDeployment("testnet", PROTOCOL_VERSION_V3_2, 2);
    expect(main.chainId).not.toBe(test.chainId); // base vs base-sepolia
    expect(main.contracts.hub).not.toBe(test.contracts.hub);
  });

  it("throws UnknownProtocolVersionError for an unregistered version", () => {
    expect(() => getDeployment("mainnet", "0.0", 1)).toThrow(
      UnknownProtocolVersionError,
    );
  });

  it("throws UnknownDeploymentError for an unregistered centrifugeId", () => {
    expect(() => getDeployment("mainnet", PROTOCOL_VERSION_V3_2, 9999)).toThrow(
      UnknownDeploymentError,
    );
    // centrifugeId 4 (plume) exists on mainnet but NOT on testnet.
    expect(() => getDeployment("testnet", PROTOCOL_VERSION_V3_2, 4)).toThrow(
      UnknownDeploymentError,
    );
  });

  describe("fail-loud deployment verification", () => {
    // Clone the real bundled ethereum set and mutate one field, so the only
    // violation in the data is the one under test (the full v3.2 schema has
    // ~40 required contracts).
    function mutatedData(
      mutate: (contracts: Record<string, string>) => void,
    ): DeploymentRegistryData {
      const bundled = DEFAULT_DEPLOYMENT_DATA.mainnet[PROTOCOL_VERSION_V3_2]!;
      const contracts: Record<string, string> = {
        ...bundled[1]!.contracts,
      };
      mutate(contracts);
      return {
        mainnet: {
          [PROTOCOL_VERSION_V3_2]: {
            1: { chainId: 1, name: "ethereum", contracts },
          },
        },
        testnet: { [PROTOCOL_VERSION_V3_2]: {} },
      };
    }

    it("throws naming the field when a required address is missing", () => {
      const data = mutatedData((contracts) => {
        delete contracts.hubRegistry;
      });
      expect(() => createDeploymentRegistry(data)).toThrow(
        DeploymentVerificationError,
      );
      expect(() => createDeploymentRegistry(data)).toThrow(
        /mainnet\.3\.2\.1\.contracts\.hubRegistry/,
      );
    });

    it("tolerates an absent OPTIONAL contract (chain-specific adapters)", () => {
      const data = mutatedData((contracts) => {
        delete contracts.axelarAdapter;
      });
      expect(() => createDeploymentRegistry(data)).not.toThrow();
    });

    it("throws naming the field on a malformed address", () => {
      const data = mutatedData((contracts) => {
        contracts.hub = "0xnot-an-address";
      });
      expect(() => createDeploymentRegistry(data)).toThrow(
        /mainnet\.3\.2\.1\.contracts\.hub/,
      );
    });

    it("throws on an unexpected contract instead of silently dropping it", () => {
      const data = mutatedData((contracts) => {
        contracts.mysteryBox = "0xA4A7Bb3831958463b3FE3E27A6a160F764341953";
      });
      expect(() => createDeploymentRegistry(data)).toThrow(
        /mainnet\.3\.2\.1\.contracts\.mysteryBox/,
      );
    });

    it("throws on a version with no registered ABI set", () => {
      const data: DeploymentRegistryData = {
        mainnet: { "8.8": {} },
        testnet: {},
      };
      expect(() => createDeploymentRegistry(data)).toThrow(
        DeploymentVerificationError,
      );
    });

    it("verifies the bundled data cleanly", () => {
      expect(() => createDeploymentRegistry()).not.toThrow();
    });
  });

  describe("StdHubPolicyFactory", () => {
    const FACTORY = "0x2E62DE7f44Ba4a22BaB773e6c947A57ec515f905";

    function testnetV33(factory: string | undefined): DeploymentRegistryData {
      const bundled = DEFAULT_DEPLOYMENT_DATA.testnet[PROTOCOL_VERSION_V3_3]!;
      const contracts: Record<string, string> = { ...bundled[1]!.contracts };
      delete contracts.stdHubPolicyFactory;
      if (factory) {
        contracts.stdHubPolicyFactory = factory;
      }
      return {
        mainnet: {},
        testnet: {
          [PROTOCOL_VERSION_V3_3]: {
            1: { chainId: 11155111, name: "sepolia", contracts },
          },
        },
      };
    }

    it("is an optional v3.3 contract, since a book release brings it chain by chain", () => {
      expect(CONTRACT_SCHEMA_V3_3.optional).toContain("stdHubPolicyFactory");
      expect(CONTRACT_SCHEMA_V3_3.required).not.toContain(
        "stdHubPolicyFactory",
      );
    });

    it("resolves the address a v3.3 stack lists", () => {
      const registry = createDeploymentRegistry(testnetV33(FACTORY));

      expect(
        registry.getDeployment("testnet", PROTOCOL_VERSION_V3_3, 1).contracts
          .stdHubPolicyFactory,
      ).toBe(FACTORY);
    });

    it("leaves it absent where the stack lists none", () => {
      const registry = createDeploymentRegistry(testnetV33(undefined));

      expect(
        registry.getDeployment("testnet", PROTOCOL_VERSION_V3_3, 1).contracts
          .stdHubPolicyFactory,
      ).toBeUndefined();
    });

    it("refuses a malformed address instead of dropping it", () => {
      expect(() =>
        createDeploymentRegistry(testnetV33("0xnot-an-address")),
      ).toThrow(/testnet\.3\.3\.1\.contracts\.stdHubPolicyFactory/);
    });
  });

  describe("on/off-ramp factories", () => {
    const deployments = Object.entries(DEPLOYMENTS_V3_2).flatMap(
      ([environment, byCentrifugeId]) =>
        Object.entries(byCentrifugeId).map(([centrifugeId, deployment]) => ({
          label: `${environment}/${centrifugeId}`,
          contracts: deployment.contracts,
        })),
    );

    it("lists onOffRampFactory as an optional contract", () => {
      expect(CONTRACT_SCHEMA_V3_2.optional).toContain("onOffRampFactory");
      expect(CONTRACT_SCHEMA_V3_2.required).not.toContain("onOffRampFactory");
    });

    const MAINNET_FACTORY = "0x22E2f679669D69b6b6f22CC9C1731035a3Fa0296";
    const MAINNET_LEGACY_FACTORY = "0x2539e60B0B50D7BD004A09e9D2b7E8c86EB0AaF6";

    it.each([
      [1, "ethereum"],
      [2, "base"],
      [3, "arbitrum"],
      [10, "optimism"],
      [13, "x-layer"],
    ])(
      "lists the shared OnOffRampFactory on mainnet centrifugeId %i (%s)",
      (centrifugeId) => {
        const d = getDeployment("mainnet", PROTOCOL_VERSION_V3_2, centrifugeId);
        expect(d.contracts.onOffRampFactory).toBe(MAINNET_FACTORY);
      },
    );

    it("lists Arc's own OnOffRampFactory and no legacy factory", () => {
      const d = getDeployment("mainnet", PROTOCOL_VERSION_V3_2, 14);
      expect(d.contracts.onOffRampFactory).toBe(
        "0x8352BC2796169e3F05a15022d1fC9E2059762318",
      );
      expect(d.contracts.onOfframpManagerFactory).toBeUndefined();
    });

    it("lists no legacy factory on X Layer", () => {
      const d = getDeployment("mainnet", PROTOCOL_VERSION_V3_2, 13);
      expect(d.contracts.onOfframpManagerFactory).toBeUndefined();
    });

    it.each([1, 2, 3, 10])(
      "lists both factories on mainnet centrifugeId %i",
      (centrifugeId) => {
        const d = getDeployment("mainnet", PROTOCOL_VERSION_V3_2, centrifugeId);
        expect(d.contracts.onOfframpManagerFactory).toBe(
          MAINNET_LEGACY_FACTORY,
        );
        expect(d.contracts.onOffRampFactory).toBe(MAINNET_FACTORY);
      },
    );

    it.each([4, 5, 6, 9, 11, 12])(
      "lists only the legacy factory on mainnet centrifugeId %i",
      (centrifugeId) => {
        const d = getDeployment("mainnet", PROTOCOL_VERSION_V3_2, centrifugeId);
        expect(d.contracts.onOfframpManagerFactory).toBe(
          MAINNET_LEGACY_FACTORY,
        );
        expect(d.contracts.onOffRampFactory).toBeUndefined();
      },
    );

    it.each([1, 2, 3, 9])(
      "lists both factories on testnet centrifugeId %i",
      (centrifugeId) => {
        const d = getDeployment("testnet", PROTOCOL_VERSION_V3_2, centrifugeId);
        expect(d.contracts.onOffRampFactory).toBe(
          "0x6Af53A7f79c32c09C73b745c591058Cdd97457DB",
        );
        expect(d.contracts.onOfframpManagerFactory).toBe(
          "0xAa696bCD0FCeBC186BcCD6de548EB385d57e132B",
        );
      },
    );

    it.each(deployments)(
      "$label lists accountingToken whenever it lists onOffRampFactory",
      ({ contracts }) => {
        if (contracts.onOffRampFactory !== undefined) {
          expect(contracts.accountingToken).toBeDefined();
        }
      },
    );
  });

  describe("version-plurality", () => {
    it("adding a fake v9.9 requires only a registry data set and an ABI set", () => {
      // Simulates the v3.3-style addition: one address set keyed "9.9", one
      // ABI set keyed "9.9". No loader, builder, or consumer code changes.
      const data: DeploymentRegistryData = {
        mainnet: {
          ...DEFAULT_DEPLOYMENT_DATA.mainnet,
          "9.9": {
            1: {
              chainId: 1,
              name: "ethereum",
              contracts: {
                fancyHub: "0x1111111111111111111111111111111111111111",
              },
            },
          },
        },
        testnet: DEFAULT_DEPLOYMENT_DATA.testnet,
      };
      const abiSets = {
        ...DEFAULT_ABI_SETS,
        "9.9": {
          fancyHub: parseAbi(["function poke(uint64 poolId) payable"]),
        },
      };

      const registry = createDeploymentRegistry(data, abiSets);

      // Both versions coexist per chain — never one row per chain.
      expect(registry.versionsForChain("mainnet", 1)).toEqual([
        PROTOCOL_VERSION_V3_2,
        PROTOCOL_VERSION_V3_3,
        "9.9",
      ]);
      expect(
        registry.getDeployment("mainnet", "9.9", 1).contracts.fancyHub,
      ).toBe("0x1111111111111111111111111111111111111111");
      // The v3.2 set is untouched by the addition.
      expect(
        registry.getDeployment("mainnet", PROTOCOL_VERSION_V3_2, 1).contracts
          .hub,
      ).toBe("0xA4A7Bb3831958463b3FE3E27A6a160F764341953");
    });
  });
});
