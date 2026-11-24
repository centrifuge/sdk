import { describe, expect, it, vi } from "vitest";
import { parseAbi, type Abi } from "viem";
import { RegistryLayerFetchError } from "../errors";
import {
  bookHeadRef,
  createLayerFetcher,
  foldRegistryAbis,
  isWithinRange,
  type RegistryLayer,
  type RegistryLayerRef,
} from "./registry-chain";

const HUB_A = parseAbi(["function a() view returns (uint256)"]) as Abi;
const HUB_B = parseAbi(["function b() view returns (uint256)"]) as Abi;
const SPOKE = parseAbi(["function c() view returns (uint256)"]) as Abi;

function chain(layers: readonly RegistryLayer[]) {
  const cids = layers.map((_, i) => `cid-${i}`);
  const linked = layers.map((layer, i) => ({
    ...layer,
    previousRegistry:
      i + 1 < layers.length
        ? { version: layers[i + 1]!.version, ipfsHash: cids[i + 1] }
        : null,
  }));
  const fetchLayer = vi.fn(async (ref: RegistryLayerRef) => {
    if ("url" in ref) {
      return linked[0]!;
    }
    const index = cids.indexOf(ref.ipfsHash);
    if (index < 0) {
      throw new Error(`unknown layer ${ref.ipfsHash}`);
    }
    return linked[index]!;
  });
  return { fetchLayer, cids };
}

describe("foldRegistryAbis", () => {
  const tip = { url: "https://registry.example" };

  it("takes the newest layer on a version tie only when asked", async () => {
    const layers = [
      { version: null, abis: { Hub: HUB_B } },
      { version: "v3.3.0", abis: { Hub: HUB_A } },
    ];
    const oldest = await foldRegistryAbis({
      head: tip,
      contracts: ["Hub"],
      versionRange: { from: "v3.3.0", before: "v3.4.0" },
      fetchLayer: chain(layers).fetchLayer,
    });
    expect(oldest.abis.Hub).toBe(HUB_A);
    expect(oldest.origins.Hub).toBe(1);
    const newest = await foldRegistryAbis({
      head: tip,
      contracts: ["Hub"],
      versionRange: { from: "v3.3.0", before: "v3.4.0" },
      tieBreak: "newest",
      fetchLayer: chain(layers).fetchLayer,
    });
    expect(newest.abis.Hub).toBe(HUB_B);
    expect(newest.origins.Hub).toBe(0);
  });

  it("takes a contract from the oldest layer of the highest in-range version", async () => {
    const { fetchLayer } = chain([
      { version: null, abis: { Hub: HUB_B, Spoke: SPOKE } },
      { version: "v3.2.0", abis: {} },
      { version: null, abis: { Hub: HUB_A } },
      { version: "v3.2.0", abis: { Hub: HUB_A } },
      { version: "v3.1.0", abis: { Hub: HUB_B, Spoke: HUB_B } },
    ]);

    const folded = await foldRegistryAbis({
      head: tip,
      contracts: ["Hub", "Spoke"],
      versionRange: { from: "v3.2.0", before: "v3.3.0" },
      fetchLayer,
    });

    expect(folded.abis.Hub).toBe(HUB_A);
    expect(folded.origins.Hub).toBe(3);
    expect(folded.abis.Spoke).toBe(SPOKE);
    expect(folded.origins.Spoke).toBe(0);
    expect(folded.missing).toEqual([]);
    expect(folded.layers.map((l) => l.effectiveVersion)).toEqual([
      "v3.2.0",
      "v3.2.0",
      "v3.2.0",
      "v3.2.0",
      "v3.1.0",
    ]);
    expect(fetchLayer).toHaveBeenCalledTimes(5);
  });

  it("prefers a higher in-range version over an older lower one", async () => {
    const { fetchLayer } = chain([
      { version: "v3.2.1", abis: { Hub: HUB_B } },
      { version: "v3.2.0", abis: { Hub: HUB_A } },
    ]);

    const folded = await foldRegistryAbis({
      head: tip,
      contracts: ["Hub"],
      versionRange: { from: "v3.2.0", before: "v3.3.0" },
      fetchLayer,
    });

    expect(folded.abis.Hub).toBe(HUB_B);
    expect(folded.origins.Hub).toBe(0);
  });

  it("skips layers at or above the exclusive upper bound", async () => {
    const { fetchLayer } = chain([
      { version: "v3.3.0", abis: { Hub: HUB_B } },
      { version: "v3.2.0", abis: { Hub: HUB_A } },
    ]);

    const folded = await foldRegistryAbis({
      head: tip,
      contracts: ["Hub"],
      versionRange: { from: "v3.2.0", before: "v3.3.0" },
      fetchLayer,
    });

    expect(folded.abis.Hub).toBe(HUB_A);
  });

  it("reports contracts no in-range layer carries", async () => {
    const { fetchLayer } = chain([
      { version: "v3.2.0", abis: { Hub: HUB_A } },
      { version: "v3.1.0", abis: { Spoke: SPOKE } },
    ]);

    const folded = await foldRegistryAbis({
      head: tip,
      contracts: ["Hub", "Spoke"],
      versionRange: { from: "v3.2.0" },
      fetchLayer,
    });

    expect(folded.missing).toEqual(["Spoke"]);
    expect(fetchLayer).toHaveBeenCalledTimes(2);
  });

  it("takes a contract no in-range layer carries from the nearest older layer when asked", async () => {
    const { fetchLayer } = chain([
      { version: "v3.2.0", abis: { Hub: HUB_A } },
      { version: "v3.1.0", abis: { Hub: HUB_B, Spoke: SPOKE } },
      { version: "v3.0.0", abis: { Spoke: HUB_B } },
    ]);

    const folded = await foldRegistryAbis({
      head: tip,
      contracts: ["Hub", "Spoke"],
      versionRange: { from: "v3.2.0" },
      olderLayerFallback: true,
      fetchLayer,
    });

    expect(folded.abis.Hub).toBe(HUB_A);
    expect(folded.abis.Spoke).toBe(SPOKE);
    expect(folded.origins).toEqual({ Hub: 0, Spoke: 1 });
    expect(folded.belowRange).toEqual(["Spoke"]);
    expect(folded.missing).toEqual([]);
    expect(fetchLayer).toHaveBeenCalledTimes(2);
  });

  it("reports a contract no layer of the chain carries even with the older-layer fallback", async () => {
    const { fetchLayer } = chain([
      { version: "v3.2.0", abis: { Hub: HUB_A } },
      { version: "v3.1.0", abis: {} },
    ]);

    const folded = await foldRegistryAbis({
      head: tip,
      contracts: ["Hub", "Spoke"],
      versionRange: { from: "v3.2.0" },
      olderLayerFallback: true,
      fetchLayer,
    });

    expect(folded.missing).toEqual(["Spoke"]);
    expect(folded.belowRange).toEqual([]);
  });

  it("starts at a content-addressed head and records its CID", async () => {
    const { fetchLayer, cids } = chain([
      { version: "v3.2.0", abis: { Hub: HUB_A } },
    ]);

    const folded = await foldRegistryAbis({
      head: { ipfsHash: cids[0]! },
      contracts: ["Hub"],
      versionRange: { from: "v3.2.0" },
      fetchLayer,
    });

    expect(fetchLayer).toHaveBeenCalledWith({ ipfsHash: "cid-0" });
    expect(folded.layers[0]!.ipfsHash).toBe("cid-0");
    expect(folded.abis.Hub).toBe(HUB_A);
  });

  it("stops at maxDepth", async () => {
    const { fetchLayer } = chain([
      { version: null, abis: {} },
      { version: "v3.2.0", abis: {} },
      { version: null, abis: { Hub: HUB_A } },
    ]);

    const folded = await foldRegistryAbis({
      head: tip,
      contracts: ["Hub"],
      versionRange: { from: "v3.2.0" },
      fetchLayer,
      maxDepth: 2,
    });

    expect(folded.missing).toEqual(["Hub"]);
    expect(fetchLayer).toHaveBeenCalledTimes(2);
  });
});

describe("bookHeadRef", () => {
  it("fetches a verified head by its CID", () => {
    expect(bookHeadRef({ head: "bafkreiexample", verified: true })).toEqual({
      ipfsHash: "bafkreiexample",
    });
  });

  it("fetches a head that is not content-addressed from its URL", () => {
    expect(
      bookHeadRef({
        head: "https://registry.example/head.json",
        verified: false,
      }),
    ).toEqual({ url: "https://registry.example/head.json" });
  });
});

describe("isWithinRange", () => {
  it("requires a semver version", () => {
    expect(isWithinRange(null, {})).toBe(false);
    expect(isWithinRange("3", {})).toBe(false);
    expect(isWithinRange("v3.1", {})).toBe(false);
    expect(isWithinRange("4eecc7a749d9a461c5681092b84bd937585c4832", {})).toBe(
      false,
    );
    expect(isWithinRange("v3.2.0", {})).toBe(true);
  });

  it("is inclusive below and exclusive above", () => {
    const range = { from: "v3.2.0", before: "v3.3.0" };
    expect(isWithinRange("v3.1.9", range)).toBe(false);
    expect(isWithinRange("v3.2.0", range)).toBe(true);
    expect(isWithinRange("v3.2.7", range)).toBe(true);
    expect(isWithinRange("v3.3.0-rc2", range)).toBe(false);
    expect(isWithinRange("v3.3.0", range)).toBe(false);
  });
});

describe("createLayerFetcher", () => {
  const layer: RegistryLayer = { version: "v3.2.0", abis: {} };

  it("fetches the tip by URL and IPFS layers through the gateways in order", async () => {
    const fetch = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === "https://registry.example") {
        return new Response(JSON.stringify(layer));
      }
      if (String(url).startsWith("https://gw-1/")) {
        return new Response("rate limited", { status: 429 });
      }
      return new Response(JSON.stringify(layer));
    });
    const fetchLayer = createLayerFetcher({
      fetch: fetch as typeof globalThis.fetch,
      ipfsGateways: ["https://gw-1/", "https://gw-2/"],
    });

    await expect(
      fetchLayer({ url: "https://registry.example" }),
    ).resolves.toEqual(layer);
    await expect(fetchLayer({ ipfsHash: "cid" })).resolves.toEqual(layer);
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      "https://registry.example",
      "https://gw-1/cid",
      "https://gw-2/cid",
    ]);
  });

  it("throws RegistryLayerFetchError naming every failed gateway", async () => {
    const fetch = vi.fn(async () => new Response("nope", { status: 403 }));
    const fetchLayer = createLayerFetcher({
      fetch: fetch as typeof globalThis.fetch,
      ipfsGateways: ["https://gw-1/", "https://gw-2/"],
    });

    const error = await fetchLayer({ ipfsHash: "cid" }).catch((e) => e);
    expect(error).toBeInstanceOf(RegistryLayerFetchError);
    expect(error.failures).toHaveLength(2);
    expect(error.message).toContain("https://gw-2/cid: HTTP 403");
  });
});
