import { addressBook } from "@centrifuge/addressbook";
import { V33_MIGRATION_ABI_V3_3 } from "@centrifuge/addressbook/abis";
import type { Hex } from "viem";
import { afterEach, describe, expect, it } from "vitest";
import {
  BuilderArgumentMismatchError,
  DeploymentVerificationError,
  UnknownDeploymentError,
} from "../errors";
import {
  listMigrationChains,
  resolveMigrationChain,
  resolveMigrationContext,
} from "./context";

const SEPOLIA_POOL = "281474976710665";
const MAINNET_HUB_POOL = "281474976710658";

const MAINNET_FACADE = "0x3f1Eb2DC6B31a0f7defE5f39345fC575839D3429";
const TESTNET_FACADE = "0x25f4dA387f8154E78763Cac7e545a776c4D245C6";

/** The Centrifuge ids of `network` whose `v3.3.0` stack carries the facade, read straight off the bundled book. */
function bookFacadeIds(network: "mainnet" | "testnet"): number[] {
  return Object.entries(addressBook.networks[network].chains)
    .filter(([, chain]) => chain.stacks["v3.3.0"]?.["v33Migration"])
    .map(([id]) => Number(id))
    .sort((a, b) => a - b);
}

/** The bundled book's own record of the facade on `centrifugeId`, found without the lookup under test. */
function bookFacadeRecord(
  network: "mainnet" | "testnet",
  centrifugeId: number,
) {
  const chain = addressBook.networks[network].chains[String(centrifugeId)]!;
  const address = chain.stacks["v3.3.0"]!["v33Migration"]!;
  return {
    chainId: chain.chainId,
    address,
    record: chain.addresses[address.toLowerCase() as Hex]!,
  };
}

describe("resolveMigrationChain", () => {
  it("resolves the facade, chain id and deploy block on every mainnet chain whose book stack carries it", () => {
    const ids = bookFacadeIds("mainnet");
    // A pin bump that drops a chain from the facade's stacks fails here.
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 14]);

    for (const centrifugeId of ids) {
      const { chainId, record } = bookFacadeRecord("mainnet", centrifugeId);
      const chain = resolveMigrationChain(centrifugeId, {
        environment: "mainnet",
      });

      expect(chain.centrifugeId, `cid ${centrifugeId}`).toBe(centrifugeId);
      expect(chain.migration, `cid ${centrifugeId}`).toBe(MAINNET_FACADE);
      expect(chain.chainId, `cid ${centrifugeId}`).toBe(chainId);
      expect(chain.deployBlock, `cid ${centrifugeId}`).toBe(record.blockNumber);
      expect(chain.abi).toBe(V33_MIGRATION_ABI_V3_3);
    }
  });

  it("resolves Ethereum and Base mainnet to the chain ids and blocks the book records", () => {
    expect(resolveMigrationChain(1, { environment: "mainnet" })).toMatchObject({
      chainId: 1,
      deployBlock: 26456396,
    });
    expect(resolveMigrationChain(2, { environment: "mainnet" })).toMatchObject({
      chainId: 8453,
      deployBlock: 59945137,
    });
  });

  it.each([
    [1, 11155111, 12146984],
    [2, 84532, 59531765],
    [3, 421614, 329764170],
    [9, 998, 69771116],
  ])(
    "resolves testnet centrifuge id %i to chain %i at block %i",
    (centrifugeId, chainId, deployBlock) => {
      const chain = resolveMigrationChain(centrifugeId, {
        environment: "testnet",
      });

      expect(chain.migration).toBe(TESTNET_FACADE);
      expect(chain.chainId).toBe(chainId);
      expect(chain.deployBlock).toBe(deployBlock);
    },
  );

  it("throws UnknownDeploymentError for a Centrifuge id the book lacks", () => {
    for (const environment of ["mainnet", "testnet"] as const) {
      expect(
        () => resolveMigrationChain(99_999, { environment }),
        environment,
      ).toThrow(UnknownDeploymentError);
    }
    expect(() => resolveMigrationChain(13, { environment: "testnet" })).toThrow(
      UnknownDeploymentError,
    );
  });

  it("throws UnknownDeploymentError, naming the chain, for a chain whose book stack carries no facade", () => {
    for (const centrifugeId of [15, 16, 17]) {
      expect(
        addressBook.networks.mainnet.chains[String(centrifugeId)]?.stacks[
          "v3.3.0"
        ],
        `cid ${centrifugeId} has a v3.3.0 stack`,
      ).toBeDefined();
      expect(() =>
        resolveMigrationChain(centrifugeId, { environment: "mainnet" }),
      ).toThrow(UnknownDeploymentError);
    }
    expect(() => resolveMigrationChain(15, { environment: "mainnet" })).toThrow(
      /environment "mainnet".*centrifugeId 15/,
    );
  });

  it("takes no deployments override", () => {
    const chain = resolveMigrationChain(1, {
      environment: "mainnet",
      // @ts-expect-error the options name an environment and nothing else
      deployments: { mainnet: {}, testnet: {} },
    });

    expect(chain.migration).toBe(MAINNET_FACADE);
  });

  describe("when the book's record of the facade is unusable", () => {
    const { record, address } = bookFacadeRecord("mainnet", 1);
    const addresses = addressBook.networks.mainnet.chains["1"]!.addresses;
    const key = address.toLowerCase() as Hex;
    const { blockNumber, excluded } = record;

    afterEach(() => {
      record.blockNumber = blockNumber;
      record.excluded = excluded;
      addresses[key] = record;
    });

    it("refuses the chain rather than resolve a deploy block of nothing", () => {
      record.blockNumber = null;

      expect(() =>
        resolveMigrationChain(1, { environment: "mainnet" }),
      ).toThrow(/records no block for the migration facade/);
      expect(() => listMigrationChains("mainnet")).toThrow(
        DeploymentVerificationError,
      );
    });

    it("refuses an excluded facade with its own message, not as a missing block", () => {
      record.excluded = "exclude-test";

      expect(() =>
        resolveMigrationChain(1, { environment: "mainnet" }),
      ).toThrow(DeploymentVerificationError);
      expect(() =>
        resolveMigrationChain(1, { environment: "mainnet" }),
      ).toThrow(/excludes the migration facade \(exclude-test\)/);
    });

    it("refuses a stack that lists a facade the book has no record of", () => {
      Reflect.deleteProperty(addresses, key);

      expect(() =>
        resolveMigrationChain(1, { environment: "mainnet" }),
      ).toThrow(/no record of the migration facade/);
    });
  });
});

describe("resolveMigrationContext", () => {
  it("resolves the pool's hub chain from the pool id", () => {
    const ctx = resolveMigrationContext(SEPOLIA_POOL, {
      environment: "testnet",
    });
    expect(ctx.poolId).toBe(SEPOLIA_POOL);
    expect(ctx.centrifugeId).toBe(1);
    expect(ctx.chainId).toBe(11155111);
    expect(ctx.migration).toBe(TESTNET_FACADE);
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

  it("resolves a mainnet pool's hub chain and a mainnet spoke", () => {
    const hub = resolveMigrationContext(MAINNET_HUB_POOL, {
      environment: "mainnet",
    });
    expect(hub).toMatchObject({
      poolId: MAINNET_HUB_POOL,
      centrifugeId: 1,
      chainId: 1,
      migration: MAINNET_FACADE,
      deployBlock: 26456396,
    });

    const spoke = resolveMigrationContext(MAINNET_HUB_POOL, {
      environment: "mainnet",
      centrifugeId: 3,
    });
    expect(spoke).toMatchObject({ centrifugeId: 3, chainId: 42161 });
  });

  it("throws for a chain without the migration contract", () => {
    expect(() =>
      resolveMigrationContext(SEPOLIA_POOL, {
        environment: "mainnet",
        centrifugeId: 15,
      }),
    ).toThrow(UnknownDeploymentError);
    expect(() =>
      resolveMigrationContext(SEPOLIA_POOL, {
        environment: "testnet",
        centrifugeId: 13,
      }),
    ).toThrow(UnknownDeploymentError);
  });

  it("refuses a pool id that is not a canonical uint64", () => {
    for (const bad of ["", "abc", "01", "18446744073709551616"]) {
      expect(() =>
        resolveMigrationContext(bad, { environment: "testnet" }),
      ).toThrow(BuilderArgumentMismatchError);
    }
  });
});

describe("listMigrationChains", () => {
  it("lists the four testnet chains in centrifuge id order, one address, a deploy block each", () => {
    const chains = listMigrationChains("testnet");
    expect(chains.map((c) => c.centrifugeId)).toEqual([1, 2, 3, 9]);
    expect(chains.map((c) => c.chainId)).toEqual([
      11155111, 84532, 421614, 998,
    ]);
    expect(chains.map((c) => c.deployBlock)).toEqual([
      12146984, 59531765, 329764170, 69771116,
    ]);
    expect(new Set(chains.map((c) => c.migration))).toEqual(
      new Set([TESTNET_FACADE]),
    );
  });

  it("lists exactly the mainnet chains whose book stack carries the facade, in centrifuge id order", () => {
    const chains = listMigrationChains("mainnet");

    expect(chains.map((c) => c.centrifugeId)).toEqual(bookFacadeIds("mainnet"));
    expect(chains.length).toBeGreaterThan(0);
    expect(chains.map((c) => c.centrifugeId)).not.toContain(15);
    expect(new Set(chains.map((c) => c.migration))).toEqual(
      new Set([MAINNET_FACADE]),
    );
    for (const chain of chains) {
      expect(chain.deployBlock).toBeGreaterThan(0);
    }
  });
});
