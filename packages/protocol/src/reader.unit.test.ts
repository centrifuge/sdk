import { describe, expect, it, vi } from "vitest";
import { parseAbi } from "viem";
import { DEFAULT_ABI_SETS } from "./abis";
import { ProtocolVersionResolutionError } from "./errors";
import {
  compareProtocolVersions,
  createReader,
  type ContractReadClient,
  type CreateReaderOptions,
} from "./reader";
import { createDeploymentRegistry, DEFAULT_DEPLOYMENT_DATA } from "./registry";
import { PROTOCOL_VERSION_V3_2, PROTOCOL_VERSION_V3_3 } from "./types";

const ETH_POOL = "281474976710657"; // (1n << 48n) + 1n -> centrifugeId 1
const V33_ONLY_CHAIN = 15;
const V33_ONLY_POOL = ((BigInt(V33_ONLY_CHAIN) << 48n) + 1n).toString();

function stubClient(result: unknown): ContractReadClient {
  return { readContract: vi.fn().mockResolvedValue(result) };
}

const projected = (version: string | null | undefined) => async () => version;

function twoVersionRegistry() {
  const abiSets = {
    ...DEFAULT_ABI_SETS,
    "9.9": { hub: parseAbi(["function poke() payable"]) },
  };
  const registry = createDeploymentRegistry(
    {
      mainnet: {
        ...DEFAULT_DEPLOYMENT_DATA.mainnet,
        "9.9": {
          1: {
            chainId: 1,
            name: "ethereum",
            contracts: {
              hub: "0x2222222222222222222222222222222222222222",
            },
          },
        },
      },
      testnet: DEFAULT_DEPLOYMENT_DATA.testnet,
    },
    abiSets,
  );
  return { registry, abiSets };
}

function reader(overrides: Partial<CreateReaderOptions> = {}) {
  return createReader({
    environment: "mainnet",
    getClient: () => stubClient(true),
    poolVersionSource: projected(PROTOCOL_VERSION_V3_2),
    ...overrides,
  });
}

describe("compareProtocolVersions", () => {
  it("orders version tags numerically per segment", () => {
    expect(["3.10", "3.2", "3.3"].sort(compareProtocolVersions)).toEqual([
      "3.2",
      "3.3",
      "3.10",
    ]);
  });
});

describe("Reader.poolProtocolVersion", () => {
  it("answers the version the pools entry projects for the pool: 3.2 for a mainnet pool on a chain that also serves 3.3", async () => {
    await expect(reader().poolProtocolVersion(ETH_POOL)).resolves.toBe(
      PROTOCOL_VERSION_V3_2,
    );
  });

  it("picks the projected version when two are deployed on the chain", async () => {
    const { registry, abiSets } = twoVersionRegistry();
    const onOld = reader({
      registry,
      abiSets,
      poolVersionSource: projected("3.2"),
    });
    const onNew = reader({
      registry,
      abiSets,
      poolVersionSource: projected("9.9"),
    });

    await expect(onOld.poolProtocolVersion(ETH_POOL)).resolves.toBe("3.2");
    await expect(onNew.poolProtocolVersion(ETH_POOL)).resolves.toBe("9.9");
  });

  it("refuses a pool whose entry carries no version instead of defaulting", async () => {
    await expect(
      reader({ poolVersionSource: projected(null) }).poolProtocolVersion(
        ETH_POOL,
      ),
    ).rejects.toThrow(/no protocolVersion/);
  });

  it("answers the only deployed version for a pool the pools entry does not know yet", async () => {
    await expect(
      reader({ poolVersionSource: projected(undefined) }).poolProtocolVersion(
        V33_ONLY_POOL,
      ),
    ).resolves.toBe(PROTOCOL_VERSION_V3_3);
  });

  it("refuses a pool the pools entry does not know on a mainnet chain serving v3.2 and v3.3", async () => {
    const unknownPool = reader({ poolVersionSource: projected(undefined) });
    await expect(unknownPool.poolProtocolVersion(ETH_POOL)).rejects.toThrow(
      ProtocolVersionResolutionError,
    );
    await expect(unknownPool.poolProtocolVersion(ETH_POOL)).rejects.toThrow(
      /not in the pools catalogue entry and 2 protocol versions/,
    );
  });

  it("refuses a projected version that is not deployed on the pool's chain", async () => {
    await expect(
      reader({ poolVersionSource: projected("3.2") }).poolProtocolVersion(
        V33_ONLY_POOL,
      ),
    ).rejects.toThrow(ProtocolVersionResolutionError);
    await expect(
      reader({ poolVersionSource: projected("3.2") }).poolProtocolVersion(
        V33_ONLY_POOL,
      ),
    ).rejects.toThrow(/"3.2" is not deployed/);
  });

  it("fails loud when the pool's chain is not in the registry", async () => {
    // centrifugeId 4 (plume) is mainnet-only.
    const plumePool = ((4n << 48n) + 1n).toString();
    await expect(
      reader({ environment: "testnet" }).poolProtocolVersion(plumePool),
    ).rejects.toThrow(ProtocolVersionResolutionError);
  });
});

describe("Reader.chainProtocolVersion", () => {
  it("answers the only deployed version", async () => {
    await expect(reader().chainProtocolVersion(V33_ONLY_CHAIN)).resolves.toBe(
      PROTOCOL_VERSION_V3_3,
    );
  });

  it("answers v3.3 on mainnet Ethereum, the newer of its two versions", async () => {
    await expect(reader().chainProtocolVersion(1)).resolves.toBe(
      PROTOCOL_VERSION_V3_3,
    );
  });

  it("answers the newest version when two are deployed", async () => {
    const { registry, abiSets } = twoVersionRegistry();
    await expect(
      reader({ registry, abiSets }).chainProtocolVersion(1),
    ).resolves.toBe("9.9");
  });

  it("fails loud for a chain with no deployment", async () => {
    await expect(reader().chainProtocolVersion(9999)).rejects.toThrow(
      ProtocolVersionResolutionError,
    );
  });
});

describe("Reader.isPoolManager", () => {
  it("reads HubRegistry.manager on the pool's home chain for the preflight", async () => {
    const client = stubClient(true);
    const getClient = vi.fn().mockReturnValue(client);
    const sut = reader({ getClient });

    await expect(
      sut.isPoolManager(ETH_POOL, "0xA4A7Bb3831958463b3FE3E27A6a160F764341953"),
    ).resolves.toBe(true);

    expect(getClient).toHaveBeenCalledWith(1);
    expect(client.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: "0x19f46D8130e610C6C0f0116EA40Fb781dEFaDE93",
        functionName: "manager",
        args: [BigInt(ETH_POOL), "0xA4A7Bb3831958463b3FE3E27A6a160F764341953"],
      }),
    );
  });

  it("returns false for a non-true read result", async () => {
    await expect(
      reader({ getClient: () => stubClient(false) }).isPoolManager(
        ETH_POOL,
        "0xA4A7Bb3831958463b3FE3E27A6a160F764341953",
      ),
    ).resolves.toBe(false);
  });
});
