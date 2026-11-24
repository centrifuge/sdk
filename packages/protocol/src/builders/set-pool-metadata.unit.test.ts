import { describe, expect, it } from "vitest";
import { parseAbi } from "viem";
import { DEFAULT_ABI_SETS } from "../abis";
import { resolveProtocolContext } from "../context";
import { BuilderArgumentMismatchError } from "../errors";
import { createDeploymentRegistry, DEFAULT_DEPLOYMENT_DATA } from "../registry";
import { PROTOCOL_VERSION_V3_2 } from "../types";
import { builders, setPoolMetadata } from "./index";
import fixtures from "./__fixtures__/update-pool-metadata.fixtures.json";

/**
 * Builder calldata must be **byte-equal** to the SDK's output for the same
 * inputs. The fixtures were captured once from the SDK's exact encoding path
 * (`encodeFunctionData(ABI.Hub, "setPoolMetadata", [poolId.raw, toHex(cid)])`)
 * and are the same cases `apps/private-api`'s `EvmTxBuilder` is tested
 * against — proving the retired native builder and this one agree byte for
 * byte. The SDK is never imported at runtime.
 */
describe("builders.setPoolMetadata", () => {
  it.each(fixtures)(
    "encodes byte-equal calldata to the SDK ($name)",
    ({ poolId, cid, expectedData }) => {
      const ctx = resolveProtocolContext(poolId, PROTOCOL_VERSION_V3_2, {
        environment: "mainnet",
      });

      const built = builders.setPoolMetadata(ctx, { poolId, cid });

      expect(built.data).toBe(expectedData);
      expect(built.to).toBe(ctx.addresses.hub);
      expect(built.value).toBe(0n);
      expect(built.calls).toEqual([
        {
          to: ctx.addresses.hub,
          data: expectedData,
          value: 0n,
          label: "Hub.setPoolMetadata",
        },
      ]);
    },
  );

  it("throws on a pool id that does not match the resolved context", () => {
    const ctx = resolveProtocolContext(
      "281474976710657",
      PROTOCOL_VERSION_V3_2,
      { environment: "mainnet" },
    );

    expect(() =>
      setPoolMetadata(ctx, { poolId: "562949953421319", cid: "Qm..." }),
    ).toThrow(BuilderArgumentMismatchError);
    expect(() =>
      setPoolMetadata(ctx, { poolId: "562949953421319", cid: "Qm..." }),
    ).toThrow(/pool id mismatch/);
  });

  it("builds unchanged against a context of a NEW protocol version", () => {
    // A fake v9.9 whose hub keeps the setPoolMetadata signature: only a
    // registry data set and an ABI set are added — the builder is untouched
    // and produces the same bytes for the same inputs.
    const abiSets = {
      ...DEFAULT_ABI_SETS,
      "9.9": {
        hub: parseAbi([
          "function setPoolMetadata(uint64 poolId, bytes metadata) payable",
        ]),
        hubRegistry: parseAbi([
          "function manager(uint64 poolId, address who) view returns (bool)",
        ]),
      },
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
                hubRegistry: "0x3333333333333333333333333333333333333333",
              },
            },
          },
        },
        testnet: DEFAULT_DEPLOYMENT_DATA.testnet,
      },
      abiSets,
    );

    const [fixture] = fixtures;
    const ctx = resolveProtocolContext(fixture.poolId, "9.9", {
      environment: "mainnet",
      registry,
      abiSets,
    });

    const built = setPoolMetadata(ctx, {
      poolId: fixture.poolId,
      cid: fixture.cid,
    });

    expect(built.data).toBe(fixture.expectedData);
    expect(built.to).toBe("0x2222222222222222222222222222222222222222");
  });
});
