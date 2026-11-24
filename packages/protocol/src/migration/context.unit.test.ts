import { describe, expect, it } from "vitest";
import {
  BuilderArgumentMismatchError,
  UnknownDeploymentError,
} from "../errors";
import { V33_MIGRATION_ABI_V3_3 } from "@centrifuge/addressbook/abis";
import {
  listMigrationChains,
  resolveMigrationChain,
  resolveMigrationContext,
} from "./context";
import {
  V33_MIGRATION_DEPLOYMENTS,
  V33_MIGRATION_DEPLOYMENTS_SOURCE,
} from "./deployments";
import { ABI_SOURCE_V33_MIGRATION } from "@centrifuge/addressbook/abis";

const SEPOLIA_POOL = "281474976710665";

describe("resolveMigrationContext", () => {
  it("resolves the pool's hub chain from the pool id", () => {
    const ctx = resolveMigrationContext(SEPOLIA_POOL, {
      environment: "testnet",
    });
    expect(ctx.poolId).toBe(SEPOLIA_POOL);
    expect(ctx.centrifugeId).toBe(1);
    expect(ctx.chainId).toBe(11155111);
    expect(ctx.migration).toBe("0x25f4dA387f8154E78763Cac7e545a776c4D245C6");
    expect(ctx.deployBlock).toBe(12146984);
    expect(ctx.abi).toBe(V33_MIGRATION_ABI_V3_3);
  });

  it("resolves a spoke chain when one is named", () => {
    const ctx = resolveMigrationContext(SEPOLIA_POOL, {
      environment: "testnet",
      centrifugeId: 3,
    });
    expect(ctx.chainId).toBe(421614);
    expect(ctx.deployBlock).toBe(329764170);
  });

  it("throws for a chain or environment without the migration contract", () => {
    expect(() =>
      resolveMigrationContext(SEPOLIA_POOL, { environment: "mainnet" }),
    ).toThrow(UnknownDeploymentError);
    expect(() => resolveMigrationChain(13, { environment: "testnet" })).toThrow(
      UnknownDeploymentError,
    );
  });

  it("refuses a pool id that is not a canonical uint64", () => {
    for (const bad of ["", "abc", "01", "18446744073709551616"]) {
      expect(() =>
        resolveMigrationContext(bad, { environment: "testnet" }),
      ).toThrow(BuilderArgumentMismatchError);
    }
  });

  it("accepts a deployments override", () => {
    const ctx = resolveMigrationContext(SEPOLIA_POOL, {
      environment: "mainnet",
      deployments: {
        mainnet: {
          1: {
            chainId: 1,
            address: "0x3af8225b934091b08689b4144b07f92b04c6bf86",
            deployBlock: 1,
          },
        },
        testnet: {},
      },
    });
    expect(ctx.chainId).toBe(1);
    expect(ctx.migration).toBe("0x3AF8225b934091B08689b4144b07F92B04C6bf86");
  });
});

describe("listMigrationChains", () => {
  it("lists the four testnet chains in centrifuge id order, one address, a deploy block each", () => {
    const chains = listMigrationChains("testnet");
    expect(chains.map((c) => c.centrifugeId)).toEqual([1, 2, 3, 9]);
    expect(chains.map((c) => c.chainId)).toEqual([
      11155111, 84532, 421614, 998,
    ]);
    expect(new Set(chains.map((c) => c.migration)).size).toBe(1);
    for (const chain of chains) {
      expect(chain.deployBlock).toBeGreaterThan(0);
    }
    expect(listMigrationChains("mainnet")).toEqual([]);
    expect(Object.keys(V33_MIGRATION_DEPLOYMENTS.mainnet)).toEqual([]);
    expect(
      listMigrationChains("mainnet", {
        testnet: V33_MIGRATION_DEPLOYMENTS.testnet,
      } as typeof V33_MIGRATION_DEPLOYMENTS),
    ).toEqual([]);
  });

  it("comes from the same registry head as the facade ABI", () => {
    expect(V33_MIGRATION_DEPLOYMENTS_SOURCE.testnet).toBe(
      ABI_SOURCE_V33_MIGRATION.layers[0]!.ipfsHash,
    );
    expect(V33_MIGRATION_DEPLOYMENTS_SOURCE.mainnet).toBeNull();
  });
});
