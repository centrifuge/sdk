import type { Abi } from "viem";
import { RegistryLayerFetchError } from "../errors";

export interface RegistryLayer {
  readonly version: string | null;
  readonly deploymentInfo?: { readonly gitCommit?: string };
  readonly previousRegistry?: {
    readonly version?: string | null;
    readonly ipfsHash?: string | null;
  } | null;
  readonly abis?: Readonly<Record<string, Abi>>;
}

export type RegistryLayerRef =
  { readonly url: string } | { readonly ipfsHash: string };

export interface RegistryLayerProvenance {
  readonly version: string | null;
  readonly effectiveVersion: string | null;
  readonly ipfsHash: string | null;
  readonly gitCommit: string | null;
}

export interface RegistryVersionRange {
  readonly from?: string;
  readonly before?: string;
}

export type FetchRegistryLayer = (
  ref: RegistryLayerRef,
) => Promise<RegistryLayer>;

export type RegistryTieBreak = "oldest" | "newest";

export interface FoldRegistryAbisOptions {
  /** The layer the walk starts at; its `previousRegistry` links lead down. */
  readonly head: RegistryLayerRef;
  readonly contracts: readonly string[];
  readonly versionRange: RegistryVersionRange;
  readonly tieBreak?: RegistryTieBreak;
  /**
   * Takes a contract no in-range layer carries from the nearest layer below the
   * range that does: a contract a release did not redeploy keeps the ABI it was
   * last published with, as the address book records it. Below the range the
   * first layer reached on the walk down, the newest, wins; `tieBreak` does not apply.
   */
  readonly olderLayerFallback?: boolean;
  readonly fetchLayer?: FetchRegistryLayer;
  readonly maxDepth?: number;
}

export interface FoldedRegistryAbis {
  readonly abis: Readonly<Record<string, Abi>>;
  readonly origins: Readonly<Record<string, number>>;
  readonly layers: readonly RegistryLayerProvenance[];
  /** Contracts taken from a layer below the version range (`olderLayerFallback`). */
  readonly belowRange: readonly string[];
  readonly missing: readonly string[];
}

/** What a network of the address book pins: a CID, or the URL of a head that is not content-addressed. */
export interface BookHead {
  readonly head: string;
  readonly verified: boolean;
}

/** The ref a book network's pinned head is fetched by. */
export function bookHeadRef({ head, verified }: BookHead): RegistryLayerRef {
  return verified ? { ipfsHash: head } : { url: head };
}

export const DEFAULT_IPFS_GATEWAYS: readonly string[] = [
  "https://gateway.pinata.cloud/ipfs/",
  "https://ipfs.io/ipfs/",
  "https://dweb.link/ipfs/",
  "https://w3s.link/ipfs/",
  "https://4everland.io/ipfs/",
];

const DEFAULT_CHAIN_DEPTH = 25;

export interface CreateLayerFetcherOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly ipfsGateways?: readonly string[];
  readonly timeoutMs?: number;
}

export function createLayerFetcher({
  fetch = globalThis.fetch,
  ipfsGateways = DEFAULT_IPFS_GATEWAYS,
  timeoutMs = 20_000,
}: CreateLayerFetcherOptions = {}): FetchRegistryLayer {
  const fetchJson = async (url: string): Promise<RegistryLayer> => {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return (await response.json()) as RegistryLayer;
  };

  return async (ref) => {
    const urls =
      "url" in ref
        ? [ref.url]
        : ipfsGateways.map((gateway) => `${gateway}${ref.ipfsHash}`);
    const failures: string[] = [];
    for (const url of urls) {
      try {
        return await fetchJson(url);
      } catch (error) {
        failures.push(`${url}: ${(error as Error).message}`);
      }
    }
    throw new RegistryLayerFetchError(ref, failures);
  };
}

type Semver = readonly [number, number, number];

function parseSemver(version: string | null | undefined): Semver | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version ?? "");
  return match && [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemver(a: Semver, b: Semver): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) {
      return a[i] < b[i] ? -1 : 1;
    }
  }
  return 0;
}

export function isWithinRange(
  version: string | null,
  range: RegistryVersionRange,
): boolean {
  const parsed = parseSemver(version);
  const from = parseSemver(range.from);
  const before = parseSemver(range.before);
  return (
    parsed !== null &&
    (from === null || compareSemver(parsed, from) >= 0) &&
    (before === null || compareSemver(parsed, before) < 0)
  );
}

type PickedAbis = Map<string, { abi: Abi; version: Semver; layer: number }>;

/** Keeps, per contract, the in-range ABI of the highest version (ties broken by `tieBreak`). */
function pickInRange(
  picked: PickedAbis,
  layer: RegistryLayer,
  {
    contracts,
    semver,
    index,
    tieBreak,
  }: {
    contracts: readonly string[];
    semver: Semver;
    index: number;
    tieBreak: RegistryTieBreak;
  },
): void {
  for (const contract of contracts) {
    const abi = layer.abis?.[contract];
    if (!abi) {
      continue;
    }
    const current = picked.get(contract);
    const order = current ? compareSemver(semver, current.version) : 1;
    if (order > 0 || (order === 0 && tieBreak === "oldest")) {
      picked.set(contract, { abi, version: semver, layer: index });
    }
  }
}

export async function foldRegistryAbis({
  head,
  contracts,
  versionRange,
  tieBreak = "oldest",
  olderLayerFallback = false,
  fetchLayer = createLayerFetcher(),
  maxDepth = DEFAULT_CHAIN_DEPTH,
}: FoldRegistryAbisOptions): Promise<FoldedRegistryAbis> {
  const from = parseSemver(versionRange.from);
  const layers: RegistryLayerProvenance[] = [];
  const picked: PickedAbis = new Map();
  const belowRange = new Map<string, { abi: Abi; layer: number }>();
  const unpicked = () =>
    contracts.filter((c) => !picked.has(c) && !belowRange.has(c));

  let ref: RegistryLayerRef | null = head;
  while (ref && layers.length < maxDepth) {
    const layer: RegistryLayer = await fetchLayer(ref);
    const effectiveVersion =
      layer.version ?? layer.previousRegistry?.version ?? null;
    const index = layers.length;
    layers.push({
      version: layer.version,
      effectiveVersion,
      ipfsHash: "ipfsHash" in ref ? ref.ipfsHash : null,
      gitCommit: layer.deploymentInfo?.gitCommit ?? null,
    });

    const semver = parseSemver(effectiveVersion);
    if (semver && from && compareSemver(semver, from) < 0) {
      if (!olderLayerFallback) {
        break;
      }
      for (const contract of unpicked()) {
        const abi = layer.abis?.[contract];
        if (abi) {
          belowRange.set(contract, { abi, layer: index });
        }
      }
      if (unpicked().length === 0) {
        break;
      }
    } else if (semver && isWithinRange(effectiveVersion, versionRange)) {
      pickInRange(picked, layer, { contracts, semver, index, tieBreak });
    }

    const previous = layer.previousRegistry?.ipfsHash;
    ref = previous ? { ipfsHash: previous } : null;
  }

  const all = [...picked, ...belowRange];
  return {
    abis: Object.fromEntries(all.map(([c, { abi }]) => [c, abi])),
    origins: Object.fromEntries(all.map(([c, { layer }]) => [c, layer])),
    layers,
    belowRange: [...belowRange.keys()],
    missing: unpicked(),
  };
}
