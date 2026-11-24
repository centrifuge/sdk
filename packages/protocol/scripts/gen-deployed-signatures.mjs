#!/usr/bin/env node
/**
 * Snapshots the signatures of the v3.1 contracts that v3.2 chains still run,
 * for the offline drift test (src/abis/deployed-drift.unit.test.ts).
 *
 * The bundled ABIs are the address book package's v3.2 fold, but the env
 * files label many v3.2-deployment contracts `v3.1` (registry/v3_2.ts,
 * CONTRACT_VERSIONS_V3_2): a chain keeps a contract the upgrade did not
 * redeploy. This folds the v3.1 layers of the same registry chain, oldest
 * in-range layer per contract like the package, and keeps only each
 * contract's signatures (abiSignatures), for the v3.2 ABIs this package uses.
 *
 * Usage (network; reads the built package):
 *   pnpm --filter @centrifuge/protocol gen:signatures
 *
 * A `v3.2` label needs no snapshot: it is the version the bundle folds.
 */
import { addressBook } from "@centrifuge/addressbook";
import {
  ABI_SOURCE_V3_2,
  GENERATED_ABIS_V3_2,
} from "@centrifuge/addressbook/abis";
import { DEFAULT_IPFS_GATEWAY } from "@centrifuge/addressbook/pipeline";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const LABEL = "v3.1";
const VERSION_RANGE = { from: "v3.1.0", before: "v3.2.0" };

async function main() {
  const {
    bookHeadRef,
    createLayerFetcher,
    DEFAULT_IPFS_GATEWAYS,
    foldRegistryAbis,
  } = await import("../dist/abis/registry-chain.js");
  const { abiSignatures } = await import("../dist/abis/signatures.js");
  const { USED_ABIS_V3_2, usedAbiNames } = await import("../dist/abis/used.js");

  // The package's set is a superset; only the ABIs this package uses can drift.
  const contracts = usedAbiNames(GENERATED_ABIS_V3_2, USED_ABIS_V3_2);
  const head = bookHeadRef(addressBook.networks[ABI_SOURCE_V3_2.network]);
  const folded = await foldRegistryAbis({
    head,
    contracts,
    versionRange: VERSION_RANGE,
    // The gateway the address book was built from first, as the package does.
    fetchLayer: createLayerFetcher({
      ipfsGateways: [`${DEFAULT_IPFS_GATEWAY}/`, ...DEFAULT_IPFS_GATEWAYS],
    }),
  });

  const snapshot = {
    label: LABEL,
    head,
    versionRange: VERSION_RANGE,
    layers: folded.layers.filter((_, index) =>
      Object.values(folded.origins).includes(index),
    ),
    missing: folded.missing,
    signatures: Object.fromEntries(
      Object.entries(folded.abis)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([contract, abi]) => [contract, abiSignatures(abi)]),
    ),
  };
  const out = resolve(ROOT, "registry-abis", "v3_1.signatures.json");
  writeFileSync(out, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(
    `${LABEL}: ${Object.keys(snapshot.signatures).length} contracts from ` +
      `${folded.layers.length} layer(s)` +
      (folded.missing.length ? `; missing ${folded.missing.join(", ")}` : ""),
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
