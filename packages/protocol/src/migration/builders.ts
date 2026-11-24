import { encodeFunctionData, type Address, type Hex } from "viem";
import {
  requireAddress,
  requireBytes16,
  requireBytes32,
  requireHex,
} from "../builders/create-holding";
import { BuilderArgumentMismatchError } from "../errors";
import { parseUint32, parseUint128, parseUint256 } from "../builders/money";
import { MANAGER_KIND } from "../builders/update-manager";
import { addressToBytes32 } from "../builders/vaults";
import type { BuiltProtocolCall } from "../types";
import {
  parseSpokeId,
  requireHubChain,
  requirePool,
  requireUnique,
} from "./args";
import type { MigrationChain, MigrationContext } from "./types";

export interface SyncReserveKey {
  readonly scId: string;
  readonly asset: string;
}

export interface VaultKey {
  readonly scId: string;
  readonly assetId: string;
  readonly vault: string;
}

export interface RotateAsset {
  readonly asset: string;
  readonly assetId: string;
  readonly scIds: readonly string[];
}

export interface OffboardSpokeInput {
  readonly vaults: readonly VaultKey[];
  readonly assets: readonly RotateAsset[];
  readonly balanceSheetManagers: readonly string[];
  readonly gatewayManagers: readonly string[];
  readonly scIds: readonly string[];
  readonly assetIds: readonly string[];
  readonly unlinkGas: string;
  readonly rotateGas: string;
  readonly managersGas: string;
  readonly finalizeGas: string;
  readonly finalize: boolean;
  readonly totalVaults: string;
  readonly totalAssets: string;
  readonly totalManagers: string;
}

export interface HoldingSeed {
  readonly scId: string;
  readonly assetId: string;
}

export interface ManagerGrant {
  readonly centrifugeId: string;
  readonly kind: "spoke";
  readonly who: string;
}

export interface OnboardHubInput {
  readonly v32Admins: readonly string[];
  readonly holdings: readonly HoldingSeed[];
  readonly epochAssetIds: readonly string[];
  readonly grants: readonly ManagerGrant[];
  readonly noV32Spokes: boolean;
}

export interface VaultSeed {
  readonly scId: string;
  readonly assetId: string;
  readonly factory: string;
  readonly vault: string;
  readonly link: boolean;
}

export interface AssetPriceKey {
  readonly scId: string;
  readonly assetId: string;
}

export interface RampSeed {
  readonly scId: string;
  readonly instance: string;
  readonly v32Instance: string;
  readonly extraGasLimit: string;
  readonly rampAssets: readonly string[];
}

export interface RampConfigSeed {
  readonly scId: string;
  readonly instance: string;
  readonly v32Instance: string;
  readonly config: string;
}

export interface HookManagerSeed {
  readonly scId: string;
  readonly hook: string;
  readonly managers: readonly string[];
}

export interface OnboardSpokeInput {
  readonly scIds: readonly string[];
  readonly seedQueueScIds: readonly string[];
  readonly registerVaults: readonly VaultSeed[];
  readonly configureVaults: readonly VaultSeed[];
  readonly assetPrices: readonly AssetPriceKey[];
  readonly ramps: readonly RampSeed[];
  readonly rampConfigs: readonly RampConfigSeed[];
  readonly hookManagers: readonly HookManagerSeed[];
  readonly linkGas: string;
  readonly registerGas: string;
  readonly configureGas: string;
  readonly hookManagersGas: string;
  readonly assetPriceGas: string;
  readonly spokeManagersGas: string;
  readonly seedGas: string;
  readonly seedQueueGas: string;
  readonly finalizeGas: string;
  readonly seedEscrow: boolean;
  readonly finalize: boolean;
  readonly totalTokens: string;
  readonly totalRegistered: string;
  readonly totalConfigured: string;
  readonly totalRamps: string;
  readonly totalHookGrants: string;
  readonly totalShareQueues: string;
  readonly totalAssetPrices: string;
  readonly totalRampConfigs: string;
}

export interface PoolArgs {
  readonly poolId: string;
}

export interface PayableArgs extends PoolArgs {
  readonly value?: string;
}

export interface InstallPoolAdaptersArgs extends PoolArgs {
  readonly centrifugeId: string;
}

export interface RelayArmArgs extends PayableArgs {
  readonly spokeCentrifugeIds: readonly string[];
  readonly refundAddress: string;
}

export interface RelayFreezeArgs extends PayableArgs {
  readonly centrifugeId: string;
  readonly syncReserves: readonly SyncReserveKey[];
  readonly extraGasLimit: string;
  readonly refundAddress: string;
}

export interface RelayAbortArgs extends PayableArgs {
  readonly centrifugeId: string;
  readonly extraGasLimit: string;
  readonly refundAddress: string;
}

export interface RelayOffboardArgs extends PayableArgs {
  readonly centrifugeId: string;
  readonly input: OffboardSpokeInput;
  readonly refundAddress: string;
}

export interface OnboardHubArgs extends PayableArgs {
  readonly input: OnboardHubInput;
  readonly refundAddress: string;
}

export interface RelayOnboardSpokeArgs extends PayableArgs {
  readonly centrifugeId: string;
  readonly input: OnboardSpokeInput;
  readonly refundAddress: string;
}

export interface ActivateArgs extends PayableArgs {
  readonly restoreGas: string;
  readonly refundAddress: string;
}

export interface LockArgs {
  readonly allSpokesQuiescent: boolean;
}

function built(
  chain: MigrationChain,
  data: Hex,
  label: string,
  value = 0n,
): BuiltProtocolCall {
  const to = chain.migration;
  return { to, data, value, calls: [{ to, data, value, label }] };
}

function payable(args: PayableArgs, builder: string): bigint {
  return parseUint256(args.value ?? "0", `${builder}.value`);
}

function scIds(values: readonly string[], field: string): readonly Hex[] {
  return values.map((value, i) => requireBytes16(value, `${field}[${i}]`));
}

function addresses(
  values: readonly string[],
  field: string,
): readonly Address[] {
  return values.map((value, i) => requireAddress(value, `${field}[${i}]`));
}

function assetIds(values: readonly string[], field: string): readonly bigint[] {
  return values.map((value, i) => parseUint128(value, `${field}[${i}]`));
}

function syncReserveKeys(values: readonly SyncReserveKey[], field: string) {
  return values.map((key, i) => ({
    scId: requireBytes16(key.scId, `${field}[${i}].scId`),
    asset: requireAddress(key.asset, `${field}[${i}].asset`),
  }));
}

function vaultSeeds(values: readonly VaultSeed[], field: string) {
  return values.map((seed, i) => ({
    scId: requireBytes16(seed.scId, `${field}[${i}].scId`),
    assetId: parseUint128(seed.assetId, `${field}[${i}].assetId`),
    factory: requireAddress(seed.factory, `${field}[${i}].factory`),
    vault: requireAddress(seed.vault, `${field}[${i}].vault`),
    link: seed.link,
  }));
}

function offboardSpokeInput(input: OffboardSpokeInput, field: string) {
  return {
    vaults: input.vaults.map((key, i) => ({
      scId: requireBytes16(key.scId, `${field}.vaults[${i}].scId`),
      assetId: parseUint128(key.assetId, `${field}.vaults[${i}].assetId`),
      vault: requireAddress(key.vault, `${field}.vaults[${i}].vault`),
    })),
    assets: input.assets.map((asset, i) => ({
      asset: requireAddress(asset.asset, `${field}.assets[${i}].asset`),
      assetId: parseUint128(asset.assetId, `${field}.assets[${i}].assetId`),
      scIds: scIds(asset.scIds, `${field}.assets[${i}].scIds`),
    })),
    balanceSheetManagers: addresses(
      input.balanceSheetManagers,
      `${field}.balanceSheetManagers`,
    ),
    gatewayManagers: addresses(
      input.gatewayManagers,
      `${field}.gatewayManagers`,
    ),
    scIds: scIds(input.scIds, `${field}.scIds`),
    assetIds: assetIds(input.assetIds, `${field}.assetIds`),
    unlinkGas: parseUint128(input.unlinkGas, `${field}.unlinkGas`),
    rotateGas: parseUint128(input.rotateGas, `${field}.rotateGas`),
    managersGas: parseUint128(input.managersGas, `${field}.managersGas`),
    finalizeGas: parseUint128(input.finalizeGas, `${field}.finalizeGas`),
    finalize: input.finalize,
    totalVaults: parseUint32(input.totalVaults, `${field}.totalVaults`),
    totalAssets: parseUint32(input.totalAssets, `${field}.totalAssets`),
    totalManagers: parseUint32(input.totalManagers, `${field}.totalManagers`),
  };
}

function managerKind(kind: string, field: string): number {
  if (kind !== "spoke") {
    throw new BuilderArgumentMismatchError(
      `${field} ${JSON.stringify(kind)} is not a kind onboardHub grants; only spoke is`,
    );
  }
  return MANAGER_KIND.spoke;
}

function onboardHubInput(input: OnboardHubInput, field: string) {
  return {
    v32Admins: addresses(input.v32Admins, `${field}.v32Admins`),
    holdings: input.holdings.map((seed, i) => ({
      scId: requireBytes16(seed.scId, `${field}.holdings[${i}].scId`),
      assetId: parseUint128(seed.assetId, `${field}.holdings[${i}].assetId`),
    })),
    epochAssetIds: assetIds(input.epochAssetIds, `${field}.epochAssetIds`),
    grants: input.grants.map((grant, i) => ({
      centrifugeId: parseSpokeId(
        grant.centrifugeId,
        `${field}.grants[${i}].centrifugeId`,
      ),
      kind: managerKind(grant.kind, `${field}.grants[${i}].kind`),
      who: requireBytes32(grant.who, `${field}.grants[${i}].who`),
    })),
    noV32Spokes: input.noV32Spokes,
  };
}

function onboardSpokeInput(input: OnboardSpokeInput, field: string) {
  return {
    scIds: scIds(input.scIds, `${field}.scIds`),
    seedQueueScIds: scIds(input.seedQueueScIds, `${field}.seedQueueScIds`),
    registerVaults: vaultSeeds(input.registerVaults, `${field}.registerVaults`),
    configureVaults: vaultSeeds(
      input.configureVaults,
      `${field}.configureVaults`,
    ),
    assetPrices: input.assetPrices.map((key, i) => ({
      scId: requireBytes16(key.scId, `${field}.assetPrices[${i}].scId`),
      assetId: parseUint128(key.assetId, `${field}.assetPrices[${i}].assetId`),
    })),
    ramps: input.ramps.map((ramp, i) => ({
      scId: requireBytes16(ramp.scId, `${field}.ramps[${i}].scId`),
      instance: requireAddress(ramp.instance, `${field}.ramps[${i}].instance`),
      v32Instance: requireAddress(
        ramp.v32Instance,
        `${field}.ramps[${i}].v32Instance`,
      ),
      extraGasLimit: parseUint128(
        ramp.extraGasLimit,
        `${field}.ramps[${i}].extraGasLimit`,
      ),
      rampAssets: addresses(ramp.rampAssets, `${field}.ramps[${i}].rampAssets`),
    })),
    rampConfigs: input.rampConfigs.map((ramp, i) => ({
      scId: requireBytes16(ramp.scId, `${field}.rampConfigs[${i}].scId`),
      instance: requireAddress(
        ramp.instance,
        `${field}.rampConfigs[${i}].instance`,
      ),
      v32Instance: requireAddress(
        ramp.v32Instance,
        `${field}.rampConfigs[${i}].v32Instance`,
      ),
      config: requireHex(ramp.config, `${field}.rampConfigs[${i}].config`),
    })),
    hookManagers: input.hookManagers.map((seed, i) => ({
      scId: requireBytes16(seed.scId, `${field}.hookManagers[${i}].scId`),
      hook: requireAddress(seed.hook, `${field}.hookManagers[${i}].hook`),
      managers: addresses(
        seed.managers,
        `${field}.hookManagers[${i}].managers`,
      ),
    })),
    linkGas: parseUint128(input.linkGas, `${field}.linkGas`),
    registerGas: parseUint128(input.registerGas, `${field}.registerGas`),
    configureGas: parseUint128(input.configureGas, `${field}.configureGas`),
    hookManagersGas: parseUint128(
      input.hookManagersGas,
      `${field}.hookManagersGas`,
    ),
    assetPriceGas: parseUint128(input.assetPriceGas, `${field}.assetPriceGas`),
    spokeManagersGas: parseUint128(
      input.spokeManagersGas,
      `${field}.spokeManagersGas`,
    ),
    seedGas: parseUint128(input.seedGas, `${field}.seedGas`),
    seedQueueGas: parseUint128(input.seedQueueGas, `${field}.seedQueueGas`),
    finalizeGas: parseUint128(input.finalizeGas, `${field}.finalizeGas`),
    seedEscrow: input.seedEscrow,
    finalize: input.finalize,
    totalTokens: parseUint32(input.totalTokens, `${field}.totalTokens`),
    totalRegistered: parseUint32(
      input.totalRegistered,
      `${field}.totalRegistered`,
    ),
    totalConfigured: parseUint32(
      input.totalConfigured,
      `${field}.totalConfigured`,
    ),
    totalRamps: parseUint32(input.totalRamps, `${field}.totalRamps`),
    totalHookGrants: parseUint32(
      input.totalHookGrants,
      `${field}.totalHookGrants`,
    ),
    totalShareQueues: parseUint32(
      input.totalShareQueues,
      `${field}.totalShareQueues`,
    ),
    totalAssetPrices: parseUint32(
      input.totalAssetPrices,
      `${field}.totalAssetPrices`,
    ),
    totalRampConfigs: parseUint32(
      input.totalRampConfigs,
      `${field}.totalRampConfigs`,
    ),
  };
}

export function initiateMigration(
  ctx: MigrationContext,
  args: PoolArgs,
): BuiltProtocolCall {
  requireHubChain(ctx, "initiateMigration");
  const poolId = requirePool(ctx, args.poolId, "initiateMigration");
  const data = encodeFunctionData({
    abi: ctx.abi,
    functionName: "initiateMigration",
    args: [poolId],
  });
  return built(ctx, data, "V33Migration.initiateMigration");
}

export function installPoolAdapters(
  ctx: MigrationContext,
  args: InstallPoolAdaptersArgs,
): BuiltProtocolCall {
  const poolId = requirePool(ctx, args.poolId, "installPoolAdapters");
  const remote = parseSpokeId(
    args.centrifugeId,
    "installPoolAdapters.centrifugeId",
  );
  if (remote === ctx.centrifugeId) {
    throw new BuilderArgumentMismatchError(
      `installPoolAdapters.centrifugeId ${remote} is the context's own chain; a lane joins two chains`,
    );
  }
  const data = encodeFunctionData({
    abi: ctx.abi,
    functionName: "installPoolAdapters",
    args: [poolId, remote],
  });
  return built(ctx, data, "V33Migration.installPoolAdapters");
}

export function relayArm(
  ctx: MigrationContext,
  args: RelayArmArgs,
): BuiltProtocolCall {
  requireHubChain(ctx, "relayArm");
  const poolId = requirePool(ctx, args.poolId, "relayArm");
  requireUnique(args.spokeCentrifugeIds, "relayArm.spokeCentrifugeIds");
  const data = encodeFunctionData({
    abi: ctx.abi,
    functionName: "relayArm",
    args: [
      poolId,
      args.spokeCentrifugeIds.map((id, i) =>
        parseSpokeId(id, `relayArm.spokeCentrifugeIds[${i}]`),
      ),
      requireAddress(args.refundAddress, "relayArm.refundAddress"),
    ],
  });
  return built(ctx, data, "V33Migration.relayArm", payable(args, "relayArm"));
}

export function relayFreeze(
  ctx: MigrationContext,
  args: RelayFreezeArgs,
): BuiltProtocolCall {
  requireHubChain(ctx, "relayFreeze");
  const poolId = requirePool(ctx, args.poolId, "relayFreeze");
  const data = encodeFunctionData({
    abi: ctx.abi,
    functionName: "relayFreeze",
    args: [
      poolId,
      parseSpokeId(args.centrifugeId, "relayFreeze.centrifugeId"),
      {
        syncReserves: syncReserveKeys(
          args.syncReserves,
          "relayFreeze.syncReserves",
        ),
      },
      parseUint128(args.extraGasLimit, "relayFreeze.extraGasLimit"),
      requireAddress(args.refundAddress, "relayFreeze.refundAddress"),
    ],
  });
  return built(
    ctx,
    data,
    "V33Migration.relayFreeze",
    payable(args, "relayFreeze"),
  );
}

export function relayAbort(
  ctx: MigrationContext,
  args: RelayAbortArgs,
): BuiltProtocolCall {
  requireHubChain(ctx, "relayAbort");
  const poolId = requirePool(ctx, args.poolId, "relayAbort");
  const data = encodeFunctionData({
    abi: ctx.abi,
    functionName: "relayAbort",
    args: [
      poolId,
      parseSpokeId(args.centrifugeId, "relayAbort.centrifugeId"),
      parseUint128(args.extraGasLimit, "relayAbort.extraGasLimit"),
      requireAddress(args.refundAddress, "relayAbort.refundAddress"),
    ],
  });
  return built(
    ctx,
    data,
    "V33Migration.relayAbort",
    payable(args, "relayAbort"),
  );
}

export function relayOffboard(
  ctx: MigrationContext,
  args: RelayOffboardArgs,
): BuiltProtocolCall {
  requireHubChain(ctx, "relayOffboard");
  const poolId = requirePool(ctx, args.poolId, "relayOffboard");
  const data = encodeFunctionData({
    abi: ctx.abi,
    functionName: "relayOffboard",
    args: [
      poolId,
      parseSpokeId(args.centrifugeId, "relayOffboard.centrifugeId"),
      offboardSpokeInput(args.input, "relayOffboard.input"),
      requireAddress(args.refundAddress, "relayOffboard.refundAddress"),
    ],
  });
  return built(
    ctx,
    data,
    "V33Migration.relayOffboard",
    payable(args, "relayOffboard"),
  );
}

export function onboardHub(
  ctx: MigrationContext,
  args: OnboardHubArgs,
): BuiltProtocolCall {
  requireHubChain(ctx, "onboardHub");
  const poolId = requirePool(ctx, args.poolId, "onboardHub");
  const data = encodeFunctionData({
    abi: ctx.abi,
    functionName: "onboardHub",
    args: [
      poolId,
      onboardHubInput(args.input, "onboardHub.input"),
      requireAddress(args.refundAddress, "onboardHub.refundAddress"),
    ],
  });
  return built(
    ctx,
    data,
    "V33Migration.onboardHub",
    payable(args, "onboardHub"),
  );
}

export function relayOnboardSpoke(
  ctx: MigrationContext,
  args: RelayOnboardSpokeArgs,
): BuiltProtocolCall {
  requireHubChain(ctx, "relayOnboardSpoke");
  const poolId = requirePool(ctx, args.poolId, "relayOnboardSpoke");
  const data = encodeFunctionData({
    abi: ctx.abi,
    functionName: "relayOnboardSpoke",
    args: [
      poolId,
      parseSpokeId(args.centrifugeId, "relayOnboardSpoke.centrifugeId"),
      onboardSpokeInput(args.input, "relayOnboardSpoke.input"),
      requireAddress(args.refundAddress, "relayOnboardSpoke.refundAddress"),
    ],
  });
  return built(
    ctx,
    data,
    "V33Migration.relayOnboardSpoke",
    payable(args, "relayOnboardSpoke"),
  );
}

export function activate(
  ctx: MigrationContext,
  args: ActivateArgs,
): BuiltProtocolCall {
  requireHubChain(ctx, "activate");
  const poolId = requirePool(ctx, args.poolId, "activate");
  const data = encodeFunctionData({
    abi: ctx.abi,
    functionName: "activate",
    args: [
      poolId,
      {
        restoreGas: parseUint128(args.restoreGas, "activate.restoreGas"),
        installBridgeCircuitBreaker: true,
      },
      requireAddress(args.refundAddress, "activate.refundAddress"),
    ],
  });
  return built(ctx, data, "V33Migration.activate", payable(args, "activate"));
}

export function forceRelease(
  ctx: MigrationContext,
  args: PoolArgs,
): BuiltProtocolCall {
  requireHubChain(ctx, "forceRelease");
  const poolId = requirePool(ctx, args.poolId, "forceRelease");
  const data = encodeFunctionData({
    abi: ctx.abi,
    functionName: "forceRelease",
    args: [poolId],
  });
  return built(ctx, data, "V33Migration.forceRelease");
}

export function lock(chain: MigrationChain, args: LockArgs): BuiltProtocolCall {
  const data = encodeFunctionData({
    abi: chain.abi,
    functionName: "lock",
    args: [args.allSpokesQuiescent],
  });
  return built(chain, data, "V33Migration.lock");
}

export const managerGrantWho = addressToBytes32;

export const migrationBuilders = {
  initiateMigration,
  installPoolAdapters,
  relayArm,
  relayFreeze,
  relayAbort,
  relayOffboard,
  onboardHub,
  relayOnboardSpoke,
  activate,
  forceRelease,
  lock,
} as const;
