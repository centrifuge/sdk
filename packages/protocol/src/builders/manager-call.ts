import { encodeAbiParameters, encodeFunctionData, type Address } from "viem";
import {
  BuilderArgumentMismatchError,
  UnsupportedForProtocolVersionError,
} from "../errors";
import { PROTOCOL_VERSION_V3_3 } from "../types";
import type { BuiltProtocolCall, ProtocolContext } from "../types";
import {
  requireAddress,
  requireBytes16,
  requireBytes32,
} from "./create-holding";
import { parseUint64, parseUint128 } from "./money";
import {
  addressToBytes32,
  requireCentrifugeId,
  requireSamePool,
} from "./vaults";

type Hex = `0x${string}`;

const NO_EXTRA_GAS_LIMIT = 0n;
const NO_LOCAL_VALUE = 0n;

/** Arguments for {@link hubManagerCall}. */
export interface HubManagerCallArgs {
  /** Raw pool id (uint64 decimal string). Must match `ctx.poolId`. */
  readonly poolId: string;
  /** Centrifuge id of the chain the target lives on, as a decimal string. */
  readonly centrifugeId: string;
  /** The `IManagerCallFromHub` contract to call. */
  readonly target: string;
  /** Opaque bytes the target's `fromHub` decodes; see the `encode*Payload` helpers. */
  readonly payload: Hex;
  /** Decoder label, e.g. `"SyncManager.MaxReserve"`. */
  readonly label: string;
  readonly refundAddress: string;
  /** Extra gas for remote execution; defaults to 0. */
  readonly extraGasLimit?: string;
  /** Native value forwarded to a local target; defaults to 0 and must be 0 inside a batch. */
  readonly localValue?: string;
}

/**
 * `Hub.managerCall(poolId, centrifugeId, target, payload, extraGasLimit,
 * localValue, refund)`: the v3.3 entry point that replaces `Hub.updateContract`.
 * Any `scId` rides inside `payload`. Refuses a context on another version.
 */
export function hubManagerCall(
  ctx: ProtocolContext,
  args: HubManagerCallArgs,
): BuiltProtocolCall {
  requireVersion(ctx, PROTOCOL_VERSION_V3_3, "hubManagerCall");
  requireSamePool(ctx, args.poolId, "hubManagerCall");
  const poolId = BigInt(args.poolId);
  const centrifugeId = requireCentrifugeId(
    parseCentrifugeId(args.centrifugeId, "hubManagerCall.centrifugeId"),
    "hubManagerCall.centrifugeId",
  );
  const target = requireAddress(args.target, "hubManagerCall.target");
  const refund = requireAddress(
    args.refundAddress,
    "hubManagerCall.refundAddress",
  );
  const extraGasLimit =
    args.extraGasLimit !== undefined
      ? parseUint128(args.extraGasLimit, "hubManagerCall.extraGasLimit")
      : NO_EXTRA_GAS_LIMIT;
  const localValue =
    args.localValue !== undefined
      ? parseUint128(args.localValue, "hubManagerCall.localValue")
      : NO_LOCAL_VALUE;
  const to = ctx.addresses.hub;
  const data = encodeFunctionData({
    abi: ctx.abis.hub,
    functionName: "managerCall",
    args: [
      poolId,
      centrifugeId,
      addressToBytes32(target),
      args.payload,
      extraGasLimit,
      localValue,
      refund,
    ],
  });
  const value = localValue;
  return { to, data, value, calls: [{ to, data, value, label: args.label }] };
}

/** `BatchRequestManager.fromHub` discriminants (`ManagerAction` at v3.3.0). */
export const BATCH_REQUEST_MANAGER_ACTION = {
  approveDeposits: 1,
  approveRedeems: 2,
  issueShares: 3,
  revokeShares: 4,
  forceCancelDepositRequest: 5,
  forceCancelRedeemRequest: 6,
} as const;

export type BatchRequestManagerPayload =
  | {
      readonly kind: "approveDeposits";
      readonly scId: string;
      readonly assetId: string;
      readonly epochId: string;
      readonly approvedAssetAmount: string;
      readonly pricePoolPerAsset: string;
      readonly refundAddress: string;
    }
  | {
      readonly kind: "approveRedeems";
      readonly scId: string;
      readonly assetId: string;
      readonly epochId: string;
      readonly approvedShareAmount: string;
      readonly pricePoolPerAsset: string;
    }
  | {
      readonly kind: "issueShares" | "revokeShares";
      readonly scId: string;
      readonly assetId: string;
      readonly epochId: string;
      readonly pricePoolPerShare: string;
      readonly extraGasLimit?: string;
      readonly refundAddress: string;
    }
  | {
      readonly kind: "forceCancelDepositRequest" | "forceCancelRedeemRequest";
      readonly scId: string;
      readonly investor: string;
      readonly assetId: string;
      readonly refundAddress: string;
    };

/** `abi.encode(uint8 kind, bytes16 scId, ...)` as `BatchRequestManager.fromHub` decodes it. */
export function encodeBatchRequestManagerPayload(
  payload: BatchRequestManagerPayload,
  field = "encodeBatchRequestManagerPayload",
): Hex {
  const kind = BATCH_REQUEST_MANAGER_ACTION[payload.kind];
  const scId = requireBytes16(payload.scId, `${field}.scId`);
  switch (payload.kind) {
    case "approveDeposits":
      return encodeAbiParameters(
        [
          { type: "uint8" },
          { type: "bytes16" },
          { type: "uint128" },
          { type: "uint32" },
          { type: "uint128" },
          { type: "uint128" },
          { type: "address" },
        ],
        [
          kind,
          scId,
          parseUint128(payload.assetId, `${field}.assetId`),
          parseEpochId(payload.epochId, `${field}.epochId`),
          parseUint128(
            payload.approvedAssetAmount,
            `${field}.approvedAssetAmount`,
          ),
          parseUint128(payload.pricePoolPerAsset, `${field}.pricePoolPerAsset`),
          requireAddress(payload.refundAddress, `${field}.refundAddress`),
        ],
      );
    case "approveRedeems":
      return encodeAbiParameters(
        [
          { type: "uint8" },
          { type: "bytes16" },
          { type: "uint128" },
          { type: "uint32" },
          { type: "uint128" },
          { type: "uint128" },
        ],
        [
          kind,
          scId,
          parseUint128(payload.assetId, `${field}.assetId`),
          parseEpochId(payload.epochId, `${field}.epochId`),
          parseUint128(
            payload.approvedShareAmount,
            `${field}.approvedShareAmount`,
          ),
          parseUint128(payload.pricePoolPerAsset, `${field}.pricePoolPerAsset`),
        ],
      );
    case "issueShares":
    case "revokeShares":
      return encodeAbiParameters(
        [
          { type: "uint8" },
          { type: "bytes16" },
          { type: "uint128" },
          { type: "uint32" },
          { type: "uint128" },
          { type: "uint128" },
          { type: "address" },
        ],
        [
          kind,
          scId,
          parseUint128(payload.assetId, `${field}.assetId`),
          parseEpochId(payload.epochId, `${field}.epochId`),
          parseUint128(payload.pricePoolPerShare, `${field}.pricePoolPerShare`),
          payload.extraGasLimit !== undefined
            ? parseUint128(payload.extraGasLimit, `${field}.extraGasLimit`)
            : NO_EXTRA_GAS_LIMIT,
          requireAddress(payload.refundAddress, `${field}.refundAddress`),
        ],
      );
    case "forceCancelDepositRequest":
    case "forceCancelRedeemRequest":
      return encodeAbiParameters(
        [
          { type: "uint8" },
          { type: "bytes16" },
          { type: "bytes32" },
          { type: "uint128" },
          { type: "address" },
        ],
        [
          kind,
          scId,
          addressToBytes32(
            requireAddress(payload.investor, `${field}.investor`),
          ),
          parseUint128(payload.assetId, `${field}.assetId`),
          requireAddress(payload.refundAddress, `${field}.refundAddress`),
        ],
      );
  }
}

/** `ShareTokenRegistrar.fromHub` discriminants (`RegistrarCall` at v3.3.0). */
export const REGISTRAR_CALL = {
  setHook: 0,
  setVault: 1,
  updateWard: 2,
} as const;

export type ShareTokenRegistrarPayload =
  | { readonly kind: "setHook"; readonly scId: string; readonly hook: string }
  | {
      readonly kind: "setVault";
      readonly scId: string;
      readonly assetId: string;
      readonly vault: string;
    }
  | {
      readonly kind: "updateWard";
      readonly scId: string;
      readonly ward: string;
      readonly authorized: boolean;
    };

/** `abi.encode(uint8 kind, bytes16 scId, ...)` as `ShareTokenRegistrar.fromHub` decodes it. */
export function encodeShareTokenRegistrarPayload(
  payload: ShareTokenRegistrarPayload,
  field = "encodeShareTokenRegistrarPayload",
): Hex {
  const kind = REGISTRAR_CALL[payload.kind];
  const scId = requireBytes16(payload.scId, `${field}.scId`);
  switch (payload.kind) {
    case "setHook":
      return encodeAbiParameters(
        [{ type: "uint8" }, { type: "bytes16" }, { type: "address" }],
        [kind, scId, requireAddress(payload.hook, `${field}.hook`)],
      );
    case "setVault":
      return encodeAbiParameters(
        [
          { type: "uint8" },
          { type: "bytes16" },
          { type: "uint128" },
          { type: "address" },
        ],
        [
          kind,
          scId,
          parseUint128(payload.assetId, `${field}.assetId`),
          requireAddress(payload.vault, `${field}.vault`),
        ],
      );
    case "updateWard":
      return encodeAbiParameters(
        [
          { type: "uint8" },
          { type: "bytes16" },
          { type: "address" },
          { type: "bool" },
        ],
        [
          kind,
          scId,
          requireAddress(payload.ward, `${field}.ward`),
          payload.authorized,
        ],
      );
  }
}

/** `SyncManager.fromHub` discriminants (`TrustedCall` at v3.3.0). */
export const SYNC_MANAGER_TRUSTED_CALL = {
  valuation: 0,
  maxReserve: 1,
} as const;

export type SyncManagerPayload =
  | {
      readonly kind: "valuation";
      readonly scId: string;
      readonly valuation: string;
    }
  | {
      readonly kind: "maxReserve";
      readonly scId: string;
      readonly assetId: string;
      readonly maxReserve: string;
    };

/** `abi.encode(bytes16 scId, uint8 kind, ...)` as `SyncManager.fromHub` decodes it. */
export function encodeSyncManagerPayload(
  payload: SyncManagerPayload,
  field = "encodeSyncManagerPayload",
): Hex {
  const scId = requireBytes16(payload.scId, `${field}.scId`);
  const kind = SYNC_MANAGER_TRUSTED_CALL[payload.kind];
  if (payload.kind === "valuation") {
    return encodeAbiParameters(
      [{ type: "bytes16" }, { type: "uint8" }, { type: "bytes32" }],
      [
        scId,
        kind,
        addressToBytes32(
          requireAddress(payload.valuation, `${field}.valuation`),
        ),
      ],
    );
  }
  return encodeAbiParameters(
    [
      { type: "bytes16" },
      { type: "uint8" },
      { type: "uint128" },
      { type: "uint128" },
    ],
    [
      scId,
      kind,
      parseUint128(payload.assetId, `${field}.assetId`),
      parseUint128(payload.maxReserve, `${field}.maxReserve`),
    ],
  );
}

/** `OnOffRamp.fromHub` discriminants (`TrustedCall` at v3.3.0). */
export const ON_OFF_RAMP_TRUSTED_CALL = {
  onramp: 0,
  relayer: 1,
  offramp: 2,
  withdraw: 3,
} as const;

export type OnOffRampPayload =
  | {
      readonly kind: "onramp";
      readonly assetId: string;
      readonly enabled: boolean;
    }
  | {
      readonly kind: "relayer";
      readonly relayer: string;
      readonly enabled: boolean;
    }
  | {
      readonly kind: "offramp";
      readonly assetId: string;
      readonly receiver: string;
      readonly enabled: boolean;
    }
  | {
      readonly kind: "withdraw";
      readonly assetId: string;
      /** Asset amount (uint128 decimal string). */
      readonly amount: string;
      readonly receiver: string;
    };

/** `abi.encode(uint8 kind, ...)` as `OnOffRamp.fromHub` decodes it; no `scId`, the ramp is per share class. */
export function encodeOnOffRampPayload(
  payload: OnOffRampPayload,
  field = "encodeOnOffRampPayload",
): Hex {
  const kind = ON_OFF_RAMP_TRUSTED_CALL[payload.kind];
  if (payload.kind === "onramp") {
    return encodeAbiParameters(
      [{ type: "uint8" }, { type: "uint128" }, { type: "bool" }],
      [
        kind,
        parseUint128(payload.assetId, `${field}.assetId`),
        payload.enabled,
      ],
    );
  }
  if (payload.kind === "withdraw") {
    return encodeAbiParameters(
      [
        { type: "uint8" },
        { type: "uint128" },
        { type: "uint128" },
        { type: "bytes32" },
      ],
      [
        kind,
        parseUint128(payload.assetId, `${field}.assetId`),
        parseUint128(payload.amount, `${field}.amount`),
        addressToBytes32(requireAddress(payload.receiver, `${field}.receiver`)),
      ],
    );
  }
  if (payload.kind === "offramp") {
    return encodeAbiParameters(
      [
        { type: "uint8" },
        { type: "uint128" },
        { type: "bytes32" },
        { type: "bool" },
      ],
      [
        kind,
        parseUint128(payload.assetId, `${field}.assetId`),
        addressToBytes32(requireAddress(payload.receiver, `${field}.receiver`)),
        payload.enabled,
      ],
    );
  }
  return encodeAbiParameters(
    [{ type: "uint8" }, { type: "bytes32" }, { type: "bool" }],
    [
      kind,
      addressToBytes32(requireAddress(payload.relayer, `${field}.relayer`)),
      payload.enabled,
    ],
  );
}

/** `abi.encode(bytes32 strategist, bytes32 root)` as `OnchainPM.fromHub` decodes it. */
export function encodeOnchainPMPolicyPayload(
  payload: { readonly strategist: string; readonly root: string },
  field = "encodeOnchainPMPolicyPayload",
): Hex {
  requireBytes32(payload.root, `${field}.root`);
  return encodeAbiParameters(
    [{ type: "bytes32" }, { type: "bytes32" }],
    [
      addressToBytes32(
        requireAddress(payload.strategist, `${field}.strategist`),
      ),
      payload.root as Hex,
    ],
  );
}

/** `ShareManager.fromHub` discriminants (`ManagerCall` at v3.3.0). */
export const SHARE_MANAGER_CALL = { issue: 0, revoke: 1 } as const;

export interface ShareManagerPayload {
  readonly kind: keyof typeof SHARE_MANAGER_CALL;
  readonly scId: string;
  /** Recipient of an issuance, or the holder whose shares are revoked. */
  readonly account: string;
  /** Share count in the share token's smallest unit (uint128 decimal string); never zero. */
  readonly shares: string;
}

/**
 * `abi.encode(uint8 kind, bytes16 scId, bytes32 account, uint128 shares)` as
 * `ShareManager.fromHub` decodes it. Zero shares are refused here because the
 * contract reverts on them (`EmptyAmount`) after the message was paid for.
 */
export function encodeShareManagerPayload(
  payload: ShareManagerPayload,
  field = "encodeShareManagerPayload",
): Hex {
  const shares = parseUint128(payload.shares, `${field}.shares`);
  if (shares === 0n) {
    throw new BuilderArgumentMismatchError(`${field}.shares must be non-zero`);
  }
  return encodeAbiParameters(
    [
      { type: "uint8" },
      { type: "bytes16" },
      { type: "bytes32" },
      { type: "uint128" },
    ],
    [
      SHARE_MANAGER_CALL[payload.kind],
      requireBytes16(payload.scId, `${field}.scId`),
      addressToBytes32(requireAddress(payload.account, `${field}.account`)),
      shares,
    ],
  );
}

/** `abi.encode(bytes16 scId, uint64 minDelay, uint64 extraGasLimit)` as `QueueManager.fromHub` decodes it. */
export function encodeQueueManagerPayload(
  payload: {
    readonly scId: string;
    readonly minDelay: string;
    readonly extraGasLimit: string;
  },
  field = "encodeQueueManagerPayload",
): Hex {
  return encodeAbiParameters(
    [{ type: "bytes16" }, { type: "uint64" }, { type: "uint64" }],
    [
      requireBytes16(payload.scId, `${field}.scId`),
      parseUint64(payload.minDelay, `${field}.minDelay`),
      parseUint64(payload.extraGasLimit, `${field}.extraGasLimit`),
    ],
  );
}

/** `abi.encode(uint16 centrifugeId, bytes32 feeder, bool canFeed)` as `OracleValuation.fromHub` decodes it. */
export function encodeOracleValuationFeederPayload(
  payload: {
    readonly centrifugeId: string;
    readonly feeder: string;
    readonly canFeed: boolean;
  },
  field = "encodeOracleValuationFeederPayload",
): Hex {
  return encodeAbiParameters(
    [{ type: "uint16" }, { type: "bytes32" }, { type: "bool" }],
    [
      requireCentrifugeId(
        parseCentrifugeId(payload.centrifugeId, `${field}.centrifugeId`),
        `${field}.centrifugeId`,
      ),
      addressToBytes32(requireAddress(payload.feeder, `${field}.feeder`)),
      payload.canFeed,
    ],
  );
}

/** `abi.encode(bytes32 who, bool canMint)` as `AccountingToken.fromHub` decodes it. */
export function encodeAccountingTokenMinterPayload(
  payload: { readonly minter: string; readonly canMint: boolean },
  field = "encodeAccountingTokenMinterPayload",
): Hex {
  return encodeAbiParameters(
    [{ type: "bytes32" }, { type: "bool" }],
    [
      addressToBytes32(requireAddress(payload.minter, `${field}.minter`)),
      payload.canMint,
    ],
  );
}

/** `AdapterFailover.fromHub` discriminants (`HubCall` at v3.3.0). */
export const ADAPTER_FAILOVER_HUB_CALL = {
  cancelFailover: 0,
  updateSteward: 1,
} as const;

/** `abi.encode(uint8 UpdateSteward, address who, bool isSteward)` as `AdapterFailover.fromHub` decodes it. */
export function encodeAdapterFailoverStewardPayload(
  payload: { readonly who: string; readonly isSteward: boolean },
  field = "encodeAdapterFailoverStewardPayload",
): Hex {
  return encodeAbiParameters(
    [{ type: "uint8" }, { type: "address" }, { type: "bool" }],
    [
      ADAPTER_FAILOVER_HUB_CALL.updateSteward,
      requireAddress(payload.who, `${field}.who`),
      payload.isSteward,
    ],
  );
}

/** `abi.encode(bytes16 scId, uint128 extraGasLimit, uint128 remoteExtraGasLimit)` as `TokenBridge.fromHub` decodes it. */
export function encodeTokenBridgeGasLimitsPayload(
  payload: {
    readonly scId: string;
    readonly extraGasLimit: string;
    readonly remoteExtraGasLimit: string;
  },
  field = "encodeTokenBridgeGasLimitsPayload",
): Hex {
  return encodeAbiParameters(
    [{ type: "bytes16" }, { type: "uint128" }, { type: "uint128" }],
    [
      requireBytes16(payload.scId, `${field}.scId`),
      parseUint128(payload.extraGasLimit, `${field}.extraGasLimit`),
      parseUint128(payload.remoteExtraGasLimit, `${field}.remoteExtraGasLimit`),
    ],
  );
}

export function requireVersion(
  ctx: ProtocolContext,
  protocolVersion: string,
  builder: string,
): void {
  if (ctx.protocolVersion !== protocolVersion) {
    throw new UnsupportedForProtocolVersionError(
      builder,
      ctx.protocolVersion,
      `it exists on protocol version ${protocolVersion} only`,
    );
  }
}

function parseEpochId(value: string, field: string): number {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new BuilderArgumentMismatchError(
      `${field} ${JSON.stringify(value)} is not a canonical uint32 decimal string`,
    );
  }
  const epoch = Number(value);
  if (epoch === 0 || epoch > 0xffffffff) {
    throw new BuilderArgumentMismatchError(
      `${field} ${JSON.stringify(value)} is outside 1..2^32-1`,
    );
  }
  return epoch;
}

export function parseCentrifugeId(value: string, field: string): number {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new BuilderArgumentMismatchError(
      `${field} ${JSON.stringify(value)} is not a canonical decimal centrifugeId`,
    );
  }
  return Number(value);
}

export type { Address as ManagerCallTarget };
