#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { argv } from "node:process";
import { getAddress } from "viem";

const CONTRACT = "v33Migration";
const ABI = "V33Migration";
const ENVIRONMENTS = ["mainnet", "testnet"];
const CID = /^(baf[a-z2-7]{20,}|Qm[1-9A-HJ-NP-Za-km-z]{44})$/;

function parseArgs() {
  const args = argv.slice(2);
  const layers = [];
  let out;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--layer") layers.push(args[++i]);
    else if (args[i] === "--out") out = resolve(args[++i]);
    else throw new Error(`Unknown argument "${args[i]}"`);
  }
  if (layers.length === 0) {
    throw new Error("--layer <cid or path> is required, once per environment");
  }
  out ??= resolve(import.meta.dirname, "../src/migration/deployments.ts");
  return { layers, out };
}

async function readLayer(source) {
  if (CID.test(source)) {
    const { createLayerFetcher } =
      await import("../dist/abis/registry-chain.js");
    return createLayerFetcher()({ ipfsHash: source });
  }
  return JSON.parse(readFileSync(resolve(source), "utf8"));
}

function layerCid(source) {
  return CID.test(source) ? source : null;
}

async function assertBundledAbi(source, layer) {
  const { abiDigest } = await import("../dist/abis/digest.js");
  const { V33_MIGRATION_ABI_V3_3 } =
    await import("@centrifuge/addressbook/abis");
  const abi = layer.abis?.[ABI];
  if (!abi) {
    throw new Error(`${source}: the layer carries no ${ABI} ABI`);
  }
  const expected = abiDigest(V33_MIGRATION_ABI_V3_3);
  const actual = abiDigest(abi);
  if (expected !== actual) {
    throw new Error(
      `${source}: ${ABI} ABI digest ${actual} differs from the bundled ${expected}; bump the @centrifuge/addressbook pin to a release that carries it first`,
    );
  }
}

function chainsOf(source, layer) {
  const chains = {};
  for (const [chainKey, chain] of Object.entries(layer.chains ?? {})) {
    const { chainId, centrifugeId } = chain.network ?? {};
    if (!Number.isInteger(chainId) || !Number.isInteger(centrifugeId)) {
      throw new Error(
        `${source} chain ${chainKey}: network.chainId/centrifugeId missing`,
      );
    }
    const entry = chain.contracts?.[CONTRACT];
    if (!entry?.address || !Number.isInteger(entry.blockNumber)) {
      throw new Error(
        `${source} chain ${chainKey}: contracts.${CONTRACT} needs address and blockNumber`,
      );
    }
    if (chains[centrifugeId] !== undefined) {
      throw new Error(`${source}: centrifugeId ${centrifugeId} appears twice`);
    }
    chains[centrifugeId] = {
      chainId,
      address: getAddress(entry.address),
      deployBlock: entry.blockNumber,
    };
  }
  if (Object.keys(chains).length === 0) {
    throw new Error(`${source}: no chain carries ${CONTRACT}`);
  }
  return chains;
}

async function current() {
  try {
    const { V33_MIGRATION_DEPLOYMENTS, V33_MIGRATION_DEPLOYMENTS_SOURCE } =
      await import("../dist/migration/deployments.js");
    return {
      deployments: V33_MIGRATION_DEPLOYMENTS,
      sources: V33_MIGRATION_DEPLOYMENTS_SOURCE,
    };
  } catch {
    return { deployments: { mainnet: {}, testnet: {} }, sources: {} };
  }
}

async function main() {
  const { layers, out } = parseArgs();
  const kept = await current();
  const byEnv = {
    mainnet: { ...kept.deployments.mainnet },
    testnet: { ...kept.deployments.testnet },
  };
  const sources = {
    mainnet: kept.sources.mainnet ?? null,
    testnet: kept.sources.testnet ?? null,
  };
  const written = [];
  for (const source of layers) {
    const layer = await readLayer(source);
    const environment = layer.network;
    if (!ENVIRONMENTS.includes(environment)) {
      throw new Error(`${source}: unknown network "${environment}"`);
    }
    if (written.includes(environment)) {
      throw new Error(`${source}: ${environment} was already given`);
    }
    await assertBundledAbi(source, layer);
    byEnv[environment] = chainsOf(source, layer);
    sources[environment] = layerCid(source);
    written.push(environment);
  }

  const indent = (value) =>
    JSON.stringify(value, null, 2).replace(/\n/g, "\n  ");
  const lines = [
    "// AUTO-GENERATED FILE — do not edit by hand.",
    "// Regenerate with (then run prettier; only the Generated line differs):",
    `//   node packages/protocol/scripts/gen-migration-deployments.mjs ${layers.map((l) => `--layer ${l}`).join(" ")}`,
    "//   pnpm exec prettier --write packages/protocol/src/migration/deployments.ts",
    `// Sources: ${ENVIRONMENTS.map((e) => `${e} ${sources[e] ?? "none"}`).join(", ")}`,
    `// Generated: ${new Date().toISOString()}`,
    "",
    'import type { ChainEnvironment } from "../types";',
    'import type { MigrationDeploymentInput } from "./types";',
    "",
    "export const V33_MIGRATION_DEPLOYMENTS_SOURCE: Readonly<",
    "  Record<ChainEnvironment, string | null>",
    `> = ${indent(sources)};`,
    "",
    "export const V33_MIGRATION_DEPLOYMENTS: Readonly<",
    "  Record<ChainEnvironment, Readonly<Record<number, MigrationDeploymentInput>>>",
    "> = {",
    `  mainnet: ${indent(byEnv.mainnet)},`,
    `  testnet: ${indent(byEnv.testnet)},`,
    "};",
    "",
  ];
  writeFileSync(out, lines.join("\n"));
  console.log(
    `migration deployments: wrote ${written.join(", ")}; kept ${ENVIRONMENTS.filter((e) => !written.includes(e)).join(", ") || "nothing"}; ${out}`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
