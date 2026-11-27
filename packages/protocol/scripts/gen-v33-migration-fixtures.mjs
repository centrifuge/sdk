#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { addressBook } from "@centrifuge/addressbook";
import { getAddress } from "viem";
import { resolve } from "node:path";
import {
  listMigrationChains,
  migrationBuilders,
  resolveMigrationContext,
} from "../dist/migration/index.js";

const POOL_ID = "281474976710665";
const SC_ID = "0x00010000000000090001000000000001";
const SC_ID_2 = "0x00010000000000090002000000000001";
const ASSET_ID = ((2n << 112n) + 1n).toString();
const ASSET_ID_2 = ((2n << 112n) + 2n).toString();
const REFUND = getAddress("0x6bcb240d3e1f1c4321ecaffdacb45691dc03be5d");
const USDC = getAddress("0x036cbd53842c5426634e7929541ec2318f3dcf7e");
const VAULT = getAddress("0x19f46d8130e610c6c0f0116ea40fb781defade93");
const FACTORY = getAddress("0xa4a7bb3831958463b3fe3e27a6a160f764341953");
const MANAGER = getAddress("0xd5d2b48a4fdd2ca814c0d6c9d3bbc43d9265679d");
const HOOK = getAddress("0x7fd35f41ce04d57d311eee293173d8528c406fbc");
const RAMP = getAddress("0x9e5bb55ebf25a1afec2aeab98e8c06ce9a262729");
const RAMP_V32 = getAddress("0x1ec1abca8c75d211b282288debf27d9979a33c99");
const ADMIN = getAddress("0x82e1ce3e9b53613cfa52544ffde5152d3b1930ae");
const WHO = `0x${MANAGER.slice(2).toLowerCase()}${"0".repeat(24)}`;

const hub = resolveMigrationContext(POOL_ID, { environment: "testnet" });
const base = listMigrationChains("testnet").find((c) => c.centrifugeId === 2);

const cases = [
  [
    "initiateMigration",
    () => migrationBuilders.initiateMigration(hub, { poolId: POOL_ID }),
  ],
  [
    "installPoolAdapters.hubSide",
    () =>
      migrationBuilders.installPoolAdapters(hub, {
        poolId: POOL_ID,
        centrifugeId: "2",
      }),
  ],
  [
    "relayArm",
    () =>
      migrationBuilders.relayArm(hub, {
        poolId: POOL_ID,
        spokeCentrifugeIds: ["2", "3"],
        refundAddress: REFUND,
      }),
  ],
  [
    "relayFreeze",
    () =>
      migrationBuilders.relayFreeze(hub, {
        poolId: POOL_ID,
        centrifugeId: "2",
        syncReserves: [{ scId: SC_ID, asset: USDC }],
        extraGasLimit: "300000",
        refundAddress: REFUND,
      }),
  ],
  [
    "relayAbort",
    () =>
      migrationBuilders.relayAbort(hub, {
        poolId: POOL_ID,
        centrifugeId: "2",
        extraGasLimit: "0",
        refundAddress: REFUND,
      }),
  ],
  [
    "relayOffboard.firstSlice",
    () =>
      migrationBuilders.relayOffboard(hub, {
        poolId: POOL_ID,
        centrifugeId: "2",
        input: {
          vaults: [{ scId: SC_ID, assetId: ASSET_ID, vault: VAULT }],
          assets: [{ asset: USDC, assetId: ASSET_ID, scIds: [SC_ID, SC_ID_2] }],
          balanceSheetManagers: [MANAGER],
          gatewayManagers: [],
          scIds: [SC_ID, SC_ID_2],
          assetIds: [ASSET_ID],
          unlinkGas: "400000",
          rotateGas: "500000",
          managersGas: "200000",
          finalizeGas: "300000",
          finalize: false,
          totalVaults: "1",
          totalAssets: "1",
          totalManagers: "1",
        },
        refundAddress: REFUND,
      }),
  ],
  [
    "onboardHub",
    () =>
      migrationBuilders.onboardHub(hub, {
        poolId: POOL_ID,
        input: {
          v32Admins: [ADMIN],
          holdings: [
            { scId: SC_ID, assetId: ASSET_ID },
            { scId: SC_ID_2, assetId: ASSET_ID_2 },
          ],
          epochAssetIds: [ASSET_ID],
          grants: [{ centrifugeId: "2", kind: "spoke", who: WHO }],
          noV32Spokes: false,
        },
        refundAddress: REFUND,
      }),
  ],
  [
    "relayOnboardSpoke.finalSlice",
    () =>
      migrationBuilders.relayOnboardSpoke(hub, {
        poolId: POOL_ID,
        centrifugeId: "2",
        input: {
          scIds: [SC_ID],
          seedQueueScIds: [SC_ID],
          registerVaults: [
            {
              scId: SC_ID,
              assetId: ASSET_ID,
              factory: FACTORY,
              vault: VAULT,
              link: true,
            },
          ],
          configureVaults: [],
          assetPrices: [{ scId: SC_ID, assetId: ASSET_ID }],
          ramps: [
            {
              scId: SC_ID,
              instance: RAMP,
              v32Instance: RAMP_V32,
              extraGasLimit: "100000",
              rampAssets: [USDC],
            },
          ],
          rampConfigs: [
            {
              scId: SC_ID,
              instance: RAMP,
              v32Instance: RAMP_V32,
              config: "0x0001",
            },
          ],
          hookManagers: [{ scId: SC_ID, hook: HOOK, managers: [MANAGER] }],
          linkGas: "100000",
          registerGas: "200000",
          configureGas: "0",
          hookManagersGas: "100000",
          assetPriceGas: "100000",
          spokeManagersGas: "100000",
          seedGas: "300000",
          seedQueueGas: "100000",
          finalizeGas: "300000",
          seedEscrow: true,
          finalize: true,
          totalTokens: "1",
          totalRegistered: "1",
          totalConfigured: "0",
          totalRamps: "1",
          totalHookGrants: "1",
          totalShareQueues: "1",
          totalAssetPrices: "1",
          totalRampConfigs: "1",
        },
        refundAddress: REFUND,
      }),
  ],
  [
    "activate",
    () =>
      migrationBuilders.activate(hub, {
        poolId: POOL_ID,
        restoreGas: "250000",
        refundAddress: REFUND,
      }),
  ],
  [
    "forceRelease",
    () => migrationBuilders.forceRelease(hub, { poolId: POOL_ID }),
  ],
  [
    "lock.baseSepolia",
    () => migrationBuilders.lock(base, { allSpokesQuiescent: true }),
  ],
];

const fixtures = cases.map(([name, build]) => {
  const built = build();
  return {
    name,
    to: built.to,
    data: built.data,
    value: built.value.toString(),
    labels: (built.calls ?? []).map((c) => c.label),
  };
});

const out = resolve(
  import.meta.dirname,
  "../src/migration/__fixtures__/v33-migration-builders.fixtures.json",
);
writeFileSync(
  out,
  `${JSON.stringify(
    {
      provenance: `Built against the V33Migration facade of the testnet registry head ${addressBook.networks.testnet.head} (effective v3.3.0); regenerate with scripts/gen-v33-migration-fixtures.mjs after pnpm build.`,
      poolId: POOL_ID,
      hub: {
        centrifugeId: hub.centrifugeId,
        migration: hub.migration,
        deployBlock: hub.deployBlock,
      },
      fixtures,
    },
    null,
    2,
  )}\n`,
);
console.log(`wrote ${fixtures.length} fixtures to ${out}`);
