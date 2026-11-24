import { describe, expect, it } from "vitest";
import { decodeFunctionData, getAddress } from "viem";
import { V33_MIGRATION_ABI_V3_3 } from "@centrifuge/addressbook/abis";
import { BuilderArgumentMismatchError } from "../errors";
import { MANAGER_KIND } from "../builders/update-manager";
import fixtures from "./__fixtures__/v33-migration-builders.fixtures.json";
import {
  activate,
  initiateMigration,
  installPoolAdapters,
  lock,
  managerGrantWho,
  migrationBuilders,
  onboardHub,
  relayArm,
  relayFreeze,
  relayOffboard,
  relayOnboardSpoke,
  type OffboardSpokeInput,
  type OnboardSpokeInput,
} from "./builders";
import { listMigrationChains, resolveMigrationContext } from "./context";

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

const hub = resolveMigrationContext(POOL_ID, { environment: "testnet" });
const base = listMigrationChains("testnet").find((c) => c.centrifugeId === 2)!;

const offboardInput: OffboardSpokeInput = {
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
};

const onboardSpokeInput: OnboardSpokeInput = {
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
    { scId: SC_ID, instance: RAMP, v32Instance: RAMP_V32, config: "0x0001" },
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
};

const replay: Record<string, () => ReturnType<typeof initiateMigration>> = {
  initiateMigration: () => initiateMigration(hub, { poolId: POOL_ID }),
  "installPoolAdapters.hubSide": () =>
    installPoolAdapters(hub, { poolId: POOL_ID, centrifugeId: "2" }),
  relayArm: () =>
    relayArm(hub, {
      poolId: POOL_ID,
      spokeCentrifugeIds: ["2", "3"],
      refundAddress: REFUND,
    }),
  relayFreeze: () =>
    relayFreeze(hub, {
      poolId: POOL_ID,
      centrifugeId: "2",
      syncReserves: [{ scId: SC_ID, asset: USDC }],
      extraGasLimit: "300000",
      refundAddress: REFUND,
    }),
  relayAbort: () =>
    migrationBuilders.relayAbort(hub, {
      poolId: POOL_ID,
      centrifugeId: "2",
      extraGasLimit: "0",
      refundAddress: REFUND,
    }),
  "relayOffboard.firstSlice": () =>
    relayOffboard(hub, {
      poolId: POOL_ID,
      centrifugeId: "2",
      input: offboardInput,
      refundAddress: REFUND,
    }),
  onboardHub: () =>
    onboardHub(hub, {
      poolId: POOL_ID,
      input: {
        v32Admins: [ADMIN],
        holdings: [
          { scId: SC_ID, assetId: ASSET_ID },
          { scId: SC_ID_2, assetId: ASSET_ID_2 },
        ],
        epochAssetIds: [ASSET_ID],
        grants: [
          { centrifugeId: "2", kind: "spoke", who: managerGrantWho(MANAGER) },
        ],
        noV32Spokes: false,
      },
      refundAddress: REFUND,
    }),
  "relayOnboardSpoke.finalSlice": () =>
    relayOnboardSpoke(hub, {
      poolId: POOL_ID,
      centrifugeId: "2",
      input: onboardSpokeInput,
      refundAddress: REFUND,
    }),
  activate: () =>
    activate(hub, {
      poolId: POOL_ID,
      restoreGas: "250000",
      refundAddress: REFUND,
    }),
  forceRelease: () => migrationBuilders.forceRelease(hub, { poolId: POOL_ID }),
  "lock.baseSepolia": () => lock(base, { allSpokesQuiescent: true }),
};

function decode(data: `0x${string}`) {
  return decodeFunctionData({ abi: V33_MIGRATION_ABI_V3_3, data });
}

describe("V33Migration builders replay the fixtures built against the testnet facade", () => {
  it("covers every fixture and every builder", () => {
    expect(Object.keys(replay).sort()).toEqual(
      fixtures.fixtures.map((f) => f.name).sort(),
    );
    const covered = new Set(
      fixtures.fixtures.map((f) => f.labels[0]!.replace("V33Migration.", "")),
    );
    for (const name of Object.keys(migrationBuilders)) {
      expect(covered.has(name), name).toBe(true);
    }
  });

  for (const fixture of fixtures.fixtures) {
    it(`replays ${fixture.name}`, () => {
      const built = replay[fixture.name]!();
      expect(built.to).toBe(fixture.to);
      expect(built.data).toBe(fixture.data);
      expect(built.value).toBe(BigInt(fixture.value));
      expect(built.calls?.map((c) => c.label)).toEqual(fixture.labels);
      expect(built.messages).toBeUndefined();
    });
  }

  it("targets the facade at the same address on every testnet chain", () => {
    for (const chain of listMigrationChains("testnet")) {
      expect(chain.migration).toBe(fixtures.hub.migration);
    }
  });
});

describe("V33Migration builders decode back to their arguments", () => {
  it("relayFreeze carries the sync reserve keys and the gas limit", () => {
    const decoded = decode(replay.relayFreeze!().data);
    expect(decoded.functionName).toBe("relayFreeze");
    const [poolId, centrifugeId, input, extraGas, refund] =
      decoded.args as unknown as [
        bigint,
        number,
        { syncReserves: readonly { scId: string; asset: string }[] },
        bigint,
        string,
      ];
    expect(poolId).toBe(BigInt(POOL_ID));
    expect(centrifugeId).toBe(2);
    expect(input.syncReserves).toEqual([{ scId: SC_ID, asset: USDC }]);
    expect(extraGas).toBe(300000n);
    expect(refund).toBe(REFUND);
  });

  it("activate always installs the bridge circuit breaker", () => {
    const decoded = decode(replay.activate!().data);
    expect(decoded.functionName).toBe("activate");
    const [, input] = decoded.args as unknown as [
      bigint,
      { restoreGas: bigint; installBridgeCircuitBreaker: boolean },
    ];
    expect(input).toEqual({
      restoreGas: 250000n,
      installBridgeCircuitBreaker: true,
    });
  });

  it("onboardHub encodes a spoke manager grant with the hub ManagerKind ordinal", () => {
    const decoded = decode(replay.onboardHub!().data);
    const [, input] = decoded.args as unknown as [
      bigint,
      {
        grants: readonly { centrifugeId: number; kind: number; who: string }[];
      },
    ];
    expect(input.grants).toEqual([
      {
        centrifugeId: 2,
        kind: MANAGER_KIND.spoke,
        who: managerGrantWho(MANAGER),
      },
    ]);
  });

  it("relayOffboard and relayOnboardSpoke carry their slice totals as uint32", () => {
    const offboard = decode(replay["relayOffboard.firstSlice"]!().data);
    const [, , offboardInputDecoded] = offboard.args as unknown as [
      bigint,
      number,
      { totalVaults: number; finalize: boolean; scIds: readonly string[] },
    ];
    expect(offboardInputDecoded.totalVaults).toBe(1);
    expect(offboardInputDecoded.finalize).toBe(false);
    expect(offboardInputDecoded.scIds).toEqual([SC_ID, SC_ID_2]);

    const onboard = decode(replay["relayOnboardSpoke.finalSlice"]!().data);
    const [, , onboardInputDecoded] = onboard.args as unknown as [
      bigint,
      number,
      {
        totalRampConfigs: number;
        seedEscrow: boolean;
        rampConfigs: readonly { config: string }[];
      },
    ];
    expect(onboardInputDecoded.totalRampConfigs).toBe(1);
    expect(onboardInputDecoded.seedEscrow).toBe(true);
    expect(onboardInputDecoded.rampConfigs[0]!.config).toBe("0x0001");
  });

  it("lock takes the chain, not a pool", () => {
    const decoded = decode(replay["lock.baseSepolia"]!().data);
    expect(decoded.functionName).toBe("lock");
    expect(decoded.args).toEqual([true]);
    expect(replay["lock.baseSepolia"]!().to).toBe(base.migration);
  });
});

describe("V33Migration builders refuse bad arguments", () => {
  it("refuses a pool id that differs from the context", () => {
    expect(() => initiateMigration(hub, { poolId: "281474976710666" })).toThrow(
      BuilderArgumentMismatchError,
    );
  });

  it("refuses a spoke id outside uint16 or non-canonical", () => {
    for (const bad of ["0", "65536", "02", "x"]) {
      expect(() =>
        installPoolAdapters(hub, { poolId: POOL_ID, centrifugeId: bad }),
      ).toThrow(BuilderArgumentMismatchError);
    }
  });

  it("refuses a spoke listed twice in relayArm", () => {
    expect(() =>
      relayArm(hub, {
        poolId: POOL_ID,
        spokeCentrifugeIds: ["2", "2"],
        refundAddress: REFUND,
      }),
    ).toThrow(BuilderArgumentMismatchError);
  });

  it("refuses a slice total above uint32 and a malformed share class id", () => {
    expect(() =>
      relayOffboard(hub, {
        poolId: POOL_ID,
        centrifugeId: "2",
        input: { ...offboardInput, totalVaults: "4294967296" },
        refundAddress: REFUND,
      }),
    ).toThrow(BuilderArgumentMismatchError);
    expect(() =>
      relayOffboard(hub, {
        poolId: POOL_ID,
        centrifugeId: "2",
        input: { ...offboardInput, scIds: ["0x01"] },
        refundAddress: REFUND,
      }),
    ).toThrow(BuilderArgumentMismatchError);
  });

  it("refuses a grant whose who is not bytes32 and a ramp config that is not hex", () => {
    expect(() =>
      onboardHub(hub, {
        poolId: POOL_ID,
        input: {
          v32Admins: [],
          holdings: [],
          epochAssetIds: [],
          grants: [{ centrifugeId: "2", kind: "spoke", who: MANAGER }],
          noV32Spokes: true,
        },
        refundAddress: REFUND,
      }),
    ).toThrow(BuilderArgumentMismatchError);
    expect(() =>
      relayOnboardSpoke(hub, {
        poolId: POOL_ID,
        centrifugeId: "2",
        input: {
          ...onboardSpokeInput,
          rampConfigs: [
            {
              scId: SC_ID,
              instance: RAMP,
              v32Instance: RAMP_V32,
              config: "0x1",
            },
          ],
        },
        refundAddress: REFUND,
      }),
    ).toThrow(BuilderArgumentMismatchError);
  });

  it("refuses a manager grant kind the hub does not know", () => {
    expect(() =>
      onboardHub(hub, {
        poolId: POOL_ID,
        input: {
          v32Admins: [],
          holdings: [],
          epochAssetIds: [],
          grants: [
            {
              centrifugeId: "2",
              kind: "hub" as unknown as "spoke",
              who: managerGrantWho(MANAGER),
            },
          ],
          noV32Spokes: true,
        },
        refundAddress: REFUND,
      }),
    ).toThrow(BuilderArgumentMismatchError);
  });

  it("forwards a caller-priced value on payable steps and refuses it elsewhere", () => {
    const priced = relayArm(hub, {
      poolId: POOL_ID,
      spokeCentrifugeIds: ["2", "3"],
      refundAddress: REFUND,
      value: "123456789",
    });
    expect(priced.value).toBe(123456789n);
    expect(priced.calls?.[0]?.value).toBe(123456789n);
    expect(priced.data).toBe(replay.relayArm!().data);
    expect(() =>
      activate(hub, {
        poolId: POOL_ID,
        restoreGas: "1",
        refundAddress: REFUND,
        value: "-1",
      }),
    ).toThrow(BuilderArgumentMismatchError);
    expect(
      "value" in (initiateMigration(hub, { poolId: POOL_ID }).calls?.[0] ?? {}),
    ).toBe(true);
    expect(initiateMigration(hub, { poolId: POOL_ID }).value).toBe(0n);
  });

  it("refuses a lane from a chain to itself", () => {
    expect(() =>
      installPoolAdapters(hub, { poolId: POOL_ID, centrifugeId: "1" }),
    ).toThrow(BuilderArgumentMismatchError);
    expect(
      installPoolAdapters(hub, { poolId: POOL_ID, centrifugeId: "2" }).to,
    ).toBe(hub.migration);
  });

  it("refuses a hub step on a context resolved to a spoke chain", () => {
    const spokeCtx = resolveMigrationContext(POOL_ID, {
      environment: "testnet",
      centrifugeId: 2,
    });
    expect(() =>
      relayArm(spokeCtx, {
        poolId: POOL_ID,
        spokeCentrifugeIds: ["2"],
        refundAddress: REFUND,
      }),
    ).toThrow(BuilderArgumentMismatchError);
    expect(() =>
      activate(spokeCtx, {
        poolId: POOL_ID,
        restoreGas: "1",
        refundAddress: REFUND,
      }),
    ).toThrow(BuilderArgumentMismatchError);
    expect(
      installPoolAdapters(spokeCtx, { poolId: POOL_ID, centrifugeId: "1" }).to,
    ).toBe(spokeCtx.migration);
  });

  it("refuses an unchecksummed refund address", () => {
    expect(() =>
      activate(hub, {
        poolId: POOL_ID,
        restoreGas: "1",
        refundAddress: "0x6Bcb240d3e1f1C4321ECAFFDacB45691DC03bE5d",
      }),
    ).toThrow(BuilderArgumentMismatchError);
  });
});
