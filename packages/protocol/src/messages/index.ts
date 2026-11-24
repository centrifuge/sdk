import { encodePacked, toHex, type Hex } from "viem";

/**
 * The protocol's cross-chain message discriminators (v3.2), as the first byte
 * of every payload.
 *
 * The single definition both the backend builders and the SDK consume, and
 * that is load-bearing rather than tidiness. `MultiAdapter.estimate` takes the
 * PAYLOAD and its answer depends on the payload's CONTENT — measured live, the
 * same message padded with `0xff` instead of zero costs 50,815,112,882 wei
 * more. So the crosschain fee is deterministic only as a convention of
 * {@link emptyMessage}: the two sides must produce byte-identical payloads or
 * their two numbers for one transaction diverge. One definition, one set of
 * bytes, pinned by the cross-package fixture in
 * `__fixtures__/empty-message-bytes.json`.
 *
 * A TS `enum` deliberately, matching the repo's own `PoolActionType`: the
 * ordinals ARE the wire values, so they are
 * declaration-order-significant and are pinned by a unit test rather than left
 * to a reader to count. The SDK re-exports this symbol so its public API is
 * unchanged.
 */
export enum MessageType {
  /** Placeholder for a null message type. */
  _Invalid,
  // -- Pool independent messages
  ScheduleUpgrade,
  CancelUpgrade,
  RecoverTokens,
  RegisterAsset,
  SetPoolAdapters,
  // -- Pool dependent messages
  NotifyPool,
  NotifyShareClass,
  NotifyPricePoolPerShare,
  NotifyPricePoolPerAsset,
  NotifyShareMetadata,
  UpdateShareHook,
  InitiateTransferShares,
  ExecuteTransferShares,
  UpdateRestriction,
  UpdateVault,
  UpdateBalanceSheetManager,
  UpdateGatewayManager,
  UpdateHoldingAmount,
  UpdateShares,
  SetMaxAssetPriceAge,
  SetMaxSharePriceAge,
  Request,
  RequestCallback,
  SetRequestManager,
  TrustedContractUpdate,
  UntrustedContractUpdate,
}

/**
 * `Hub.updateVault`'s `kind` argument, which is also the `UpdateVault` message's
 * SUBTYPE byte. Mirrors the SDK's `VaultUpdateKind` ordinals.
 *
 * Restated here (rather than imported from `builders/vaults.ts`) because the two
 * are different things that happen to share values: one is a calldata argument,
 * the other a byte inside the estimated payload. A unit test pins them equal, so
 * a future divergence in either is a test failure rather than a silent mismatch
 * between what is encoded and what is paid for.
 */
export const VAULT_UPDATE_SUBTYPE = {
  deployAndLink: 0,
  link: 1,
  unlink: 2,
} as const;

/**
 * The first pool-DEPENDENT message type. Everything below it is pool
 * independent and carries no pool id in its payload.
 *
 * This boundary is what {@link emptyMessage} dispatches on, and it reproduces
 * the SDK's `MessageTypeWithSubType` union exactly: the six bare variants there
 * are precisely `_Invalid`..`SetPoolAdapters`. Note `SetPoolAdapters` reads
 * pool-shaped by name and is NOT pool-dependent on the wire — which is why the
 * split is a named constant with this note rather than an inline `< 6`.
 */
const FIRST_POOL_DEPENDENT_TYPE: MessageType = MessageType.NotifyPool;

/**
 * The padding length of a pool-independent empty message: 249 zero bytes after
 * the one type byte, i.e. a 250-byte payload.
 *
 * 250 is the length of the longest fixed-size message (`NotifyShareClass`).
 * Every empty message is padded to it so a fee estimate is an UPPER bound for
 * any real message of that type rather than an under-estimate of one.
 */
const POOL_INDEPENDENT_PADDING_BYTES = 249;

/**
 * The padding length of a pool-dependent empty message: 241 zero bytes after
 * the type byte and the 8-byte pool id — the same 250-byte total.
 */
const POOL_DEPENDENT_PADDING_BYTES = 241;

/** Largest `uint64`; a raw pool id may not exceed it. */
const UINT64_MAX = (1n << 64n) - 1n;

/**
 * The safety margin added to every crosschain fee estimate: +50%.
 *
 * Lives here rather than in either consumer for the same reason
 * {@link emptyMessage} does — it is part of "the amount attached", so the
 * backend and the SDK must apply the identical multiplier or two routes pay
 * different amounts for the same transaction. The SDK re-exports it.
 *
 * Two things it covers, both real: the estimate is taken over a ZERO-PADDED
 * empty payload while the message actually sent carries content (and
 * `MultiAdapter.estimate` is content-sensitive — the same message padded with
 * `0xff` cost 50,815,112,882 wei more), and the fee itself drifts with gas
 * prices between prepare and execution (0.012% measured over ~8h). Unspent
 * payment is returned to the transaction's `refundAddress`, so over-estimating
 * costs the caller nothing but a temporarily larger `msg.value`; under-estimating
 * stalls the message after the transaction has confirmed.
 */
export function addEstimateBuffer(estimate: bigint): bigint {
  return (estimate * 3n) / 2n;
}

/**
 * One cross-chain message a transaction will dispatch, in the form the fee
 * estimate needs: enough to encode its empty payload and nothing more.
 *
 * `poolId` is required for a pool-dependent {@link MessageType} and must be
 * absent for a pool-independent one — {@link emptyMessage} refuses the wrong
 * combination rather than encoding a payload with a zero pool id, because
 * `MultiAdapter.estimate` reads the pool id out of bytes 1..9 to resolve THAT
 * POOL's adapter set. A message that named pool 0 by accident would be priced
 * against pool 0's adapters, which is a different (and on mainnet, a
 * differently-configured) set.
 */
export interface CrosschainMessage {
  readonly type: MessageType;
  /** Raw pool id (uint64 decimal string), for pool-dependent types only. */
  readonly poolId?: string;
  /** `UpdateVault` only: which of {@link VAULT_UPDATE_SUBTYPE} is dispatched. */
  readonly subtype?: number;
}

/**
 * The pure message manifest of a built protocol call: which cross-chain
 * messages it dispatches, keyed by DESTINATION `centrifugeId`.
 *
 * Keyed by destination because that is how the fee is charged — one
 * `MultiAdapter.estimate` per destination route — and it mirrors the SDK's
 * `wrapTransaction({ messages })` shape one to one, so the two paths sum the
 * same numbers.
 *
 * Deterministic by construction: numeric object keys iterate in ascending
 * numeric order in every JS engine, and each entry preserves the builder's own
 * call order. The manifest is therefore a pure function of the builder's
 * arguments, exactly like the calldata beside it.
 */
export type MessageManifest = Readonly<
  Record<number, readonly CrosschainMessage[]>
>;

/** True iff `type`'s payload carries a pool id (and so needs one). */
export function isPoolDependent(type: MessageType): boolean {
  return type >= FIRST_POOL_DEPENDENT_TYPE;
}

/**
 * The canonical zero-padded payload for one message type — the exact bytes both
 * the backend and the SDK hand to `GasService.messageOverallGasLimit` and
 * `MultiAdapter.estimate`.
 *
 * ## Why the CONTENT matters, not just the length
 *
 * `estimate` is payload-content-sensitive: measured live, padding the same
 * message with `0xff` instead of zero cost 50,815,112,882 wei more. So the fee
 * is not a property of the protocol that two implementations can each derive —
 * it is a property of THIS convention. Anything that changes these bytes
 * changes the number, which is why the bytes are pinned by a fixture generated
 * from the pre-move implementation rather than by a behavioural test.
 *
 * Three payload shapes, dispatched on the numeric type rather than on an
 * argument shape:
 *
 * - pool independent — `(uint8 type, 249 zero bytes)`
 * - `UpdateVault` — `(uint8, uint64 poolId, bytes16, uint128, bytes32, uint8
 *   subtype, uint128)`, because the subtype byte is inside the payload and the
 *   three kinds are priced separately by `GasService`
 *   (`updateVaultDeployAndLink` / `updateVaultLink` / `updateVaultUnlink`)
 * - every other pool-dependent type — `(uint8, uint64 poolId, 241 zero bytes)`
 *
 * The first and third come to 250 bytes; `UpdateVault` comes to its own exact
 * 90 and is deliberately NOT padded to 250. It has no variable body, so 90 IS
 * its on-wire size, and `GasService` prices per byte — padding it would
 * over-charge every vault deploy and link.
 *
 * @param type - The message discriminator.
 * @param poolId - Raw pool id (uint64 decimal string). Required for a
 *   pool-dependent type, refused for a pool-independent one.
 * @param subtype - `UpdateVault` only; defaults to `deployAndLink`, matching the
 *   SDK's `?? VaultUpdateKind.DeployAndLink`.
 * @returns The `0x`-prefixed payload.
 * @throws {MessageArgumentError} On a missing, surplus or out-of-range argument.
 *   Refused rather than defaulted: a zero pool id is a real pool whose adapter
 *   set would price the message.
 */
export function emptyMessage(
  type: MessageType,
  poolId?: string,
  subtype?: number,
): Hex {
  requireKnownType(type);

  if (!isPoolDependent(type)) {
    if (poolId !== undefined) {
      throw new MessageArgumentError(
        `emptyMessage: ${MessageType[type]} is a pool-independent message and ` +
          `carries no pool id, but ${JSON.stringify(poolId)} was supplied. ` +
          "Encoding it would put a pool id in bytes the protocol reads as " +
          "message body.",
      );
    }
    requireNoSubtype(type, subtype);

    return encodePacked(
      ["uint8", "bytes"],
      [type, toHex(0, { size: POOL_INDEPENDENT_PADDING_BYTES })],
    );
  }

  const rawPoolId = requirePoolId(MessageType[type], poolId);

  if (type === MessageType.UpdateVault) {
    if (
      subtype !== undefined &&
      (!Number.isInteger(subtype) || subtype < 0 || subtype > 0xff)
    ) {
      throw new MessageArgumentError(
        `emptyMessage: UpdateVault subtype ${subtype} is not a uint8`,
      );
    }

    return encodePacked(
      ["uint8", "uint64", "bytes16", "uint128", "bytes32", "uint8", "uint128"],
      [
        type,
        rawPoolId,
        toHex(0, { size: 16 }),
        0n,
        toHex(0, { size: 32 }),
        subtype ?? VAULT_UPDATE_SUBTYPE.deployAndLink,
        0n,
      ],
    );
  }

  requireNoSubtype(type, subtype);

  return encodePacked(
    ["uint8", "uint64", "bytes"],
    [type, rawPoolId, toHex(0, { size: POOL_DEPENDENT_PADDING_BYTES })],
  );
}

/** {@link emptyMessage} for a {@link CrosschainMessage} descriptor. */
export function emptyMessagePayload(message: CrosschainMessage): Hex {
  return emptyMessage(message.type, message.poolId, message.subtype);
}

/**
 * The batch key a payload belongs to: the 8-byte pool id in bytes 1..9, as
 * lowercase hex without a `0x` prefix.
 *
 * `MultiAdapter.estimate` resolves the adapter set for the payload's OWN pool,
 * and the gateway batches per pool, so messages must be grouped by this key
 * before their gas limits are summed and estimated. Mirrors the SDK's
 * `data.slice(4, 4 + 16)` exactly — including that a pool-independent payload
 * yields the key of the eight bytes that happen to follow its type byte, which
 * for an empty message is all zeros, i.e. the global pool.
 *
 * @throws {MessageArgumentError} When the payload is too short to contain one.
 *   Never returns a truncated key: a short key would silently merge two pools'
 *   messages into one batch and price them against one adapter set.
 */
export function batchKeyOf(payload: string): string {
  if (!/^0x[0-9a-fA-F]*$/.test(payload) || payload.length < 4 + 16) {
    throw new MessageArgumentError(
      "batchKeyOf: a payload must be at least 9 bytes of hex (a type byte " +
        `plus a uint64 pool id); got ${JSON.stringify(payload.slice(0, 24))}`,
    );
  }

  return payload.slice(4, 4 + 16).toLowerCase();
}

/**
 * Thrown when a message descriptor cannot be encoded. A separate class from
 * `BuilderArgumentMismatchError` because it can also be reached from the fee
 * path, which builds no calldata.
 */
export class MessageArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MessageArgumentError";
  }
}

function requireKnownType(type: MessageType): void {
  if (MessageType[type] === undefined) {
    throw new MessageArgumentError(
      `emptyMessage: ${String(type)} is not a known MessageType`,
    );
  }
}

function requirePoolId(
  typeName: string | undefined,
  poolId: string | undefined,
): bigint {
  if (poolId === undefined) {
    throw new MessageArgumentError(
      `emptyMessage: ${typeName} is a pool-dependent message and ` +
        "needs a pool id. Defaulting to 0 would price the message against " +
        "pool 0's adapter set, which is a different set from the pool's own.",
    );
  }
  if (!/^(0|[1-9][0-9]*)$/.test(poolId)) {
    throw new MessageArgumentError(
      `emptyMessage: poolId ${JSON.stringify(poolId)} is not a canonical ` +
        "uint64 decimal string",
    );
  }
  const raw = BigInt(poolId);
  if (raw > UINT64_MAX) {
    throw new MessageArgumentError(
      `emptyMessage: poolId ${poolId} exceeds uint64`,
    );
  }

  return raw;
}

function requireNoSubtype(
  type: MessageType,
  subtype: number | undefined,
): void {
  if (subtype !== undefined) {
    throw new MessageArgumentError(
      `emptyMessage: ${MessageType[type]} has no subtype byte, but ` +
        `${subtype} was supplied. Only UpdateVault carries one.`,
    );
  }
}

/**
 * The v3.3 cross-chain message discriminators, as the first byte of every
 * payload (`MessageLib.MessageType` at v3.3.0). v3.3 renumbered the enum:
 * `RecoverTokens`, `UpdateShareHook`, the price-age messages and the two
 * contract-update messages are gone, and the manager, policy and
 * authorization messages are new. A v3.2 ordinal sent to a v3.3 `GasService`
 * prices a different message, so the two enums never share a payload.
 */
export enum MessageTypeV3_3 {
  _Invalid,
  // -- Pool independent messages
  ScheduleUpgrade,
  CancelUpgrade,
  RegisterAsset,
  SetPoolAdapters,
  // -- Pool dependent messages
  NotifyPool,
  NotifyShareClass,
  NotifyPricePoolPerShare,
  NotifyPricePoolPerAsset,
  NotifyShareMetadata,
  InitiateTransferShares,
  ExecuteTransferShares,
  UpdateRestriction,
  UpdateVault,
  UpdateAssets,
  UpdateShares,
  Request,
  RequestCallback,
  SetRequestManager,
  ManagerCallFromSpoke,
  ManagerCallFromHub,
  UpdateManager,
  SetPolicy,
  AuthorizeSpokeCall,
  UnauthorizeSpokeCall,
}

/**
 * v3.2 message types whose v3.3 counterpart carries the same message under a
 * new ordinal. A v3.2 type missing here has no v3.3 counterpart: the call
 * that sent it was removed or became a `ManagerCallFromHub` or
 * `UpdateManager`, which the v3.3 call site declares itself.
 */
const V3_3_EQUIVALENT: Readonly<Partial<Record<MessageType, MessageTypeV3_3>>> =
  {
    [MessageType.ScheduleUpgrade]: MessageTypeV3_3.ScheduleUpgrade,
    [MessageType.CancelUpgrade]: MessageTypeV3_3.CancelUpgrade,
    [MessageType.RegisterAsset]: MessageTypeV3_3.RegisterAsset,
    [MessageType.SetPoolAdapters]: MessageTypeV3_3.SetPoolAdapters,
    [MessageType.NotifyPool]: MessageTypeV3_3.NotifyPool,
    [MessageType.NotifyShareClass]: MessageTypeV3_3.NotifyShareClass,
    [MessageType.NotifyPricePoolPerShare]:
      MessageTypeV3_3.NotifyPricePoolPerShare,
    [MessageType.NotifyPricePoolPerAsset]:
      MessageTypeV3_3.NotifyPricePoolPerAsset,
    [MessageType.NotifyShareMetadata]: MessageTypeV3_3.NotifyShareMetadata,
    [MessageType.InitiateTransferShares]:
      MessageTypeV3_3.InitiateTransferShares,
    [MessageType.ExecuteTransferShares]: MessageTypeV3_3.ExecuteTransferShares,
    [MessageType.UpdateRestriction]: MessageTypeV3_3.UpdateRestriction,
    [MessageType.UpdateVault]: MessageTypeV3_3.UpdateVault,
    [MessageType.UpdateHoldingAmount]: MessageTypeV3_3.UpdateAssets,
    [MessageType.UpdateShares]: MessageTypeV3_3.UpdateShares,
    [MessageType.Request]: MessageTypeV3_3.Request,
    [MessageType.RequestCallback]: MessageTypeV3_3.RequestCallback,
    [MessageType.SetRequestManager]: MessageTypeV3_3.SetRequestManager,
  };

/**
 * The v3.3 ordinal of a v3.2 message type that survived unchanged.
 *
 * @throws {MessageArgumentError} For a v3.2 type with no v3.3 counterpart.
 *   Pricing it under any v3.3 ordinal would quote a different message.
 */
export function toMessageTypeV3_3(type: MessageType): MessageTypeV3_3 {
  const mapped = V3_3_EQUIVALENT[type];
  if (mapped === undefined) {
    throw new MessageArgumentError(
      `toMessageTypeV3_3: ${MessageType[type] ?? String(type)} has no v3.3 ` +
        "counterpart; a v3.3 call site must declare the message it sends " +
        "(ManagerCallFromHub, UpdateManager, ...) itself",
    );
  }
  return mapped;
}

/**
 * Byte offset of the `uint128 extraGasLimit` in the v3.3 messages that carry
 * one, as `MessageLib.messageExtraGasLimit` reads it at v3.3.0.
 */
const EXTRA_GAS_LIMIT_OFFSET_V3_3: Partial<Record<MessageTypeV3_3, number>> = {
  [MessageTypeV3_3.InitiateTransferShares]: 91,
  [MessageTypeV3_3.ExecuteTransferShares]: 73,
  [MessageTypeV3_3.ManagerCallFromHub]: 41,
};

/** True iff a v3.3 `type`'s payload carries a pool id. */
export function isPoolDependentV3_3(type: MessageTypeV3_3): boolean {
  return type >= MessageTypeV3_3.NotifyPool;
}

/**
 * {@link emptyMessage} for v3.3 ordinals: the same zero-padding convention,
 * so a v3.3 fee is an upper bound in the same way a v3.2 one is.
 *
 * Three shapes differ from v3.2, each because `GasService` reads past the
 * 250-byte padding or routes on the pool id:
 *
 * - `UpdateVault` gained a trailing `(uint16 length, bytes payload)`, and
 *   `GasService` deserializes it to read the vault kind: the v3.2 90 bytes
 *   plus a zero length, 92.
 * - `NotifyShareClass` became variable-length: `messageExtraGasLimit` reads a
 *   `uint128` at byte 250 and the payload length follows it, so its empty
 *   form is the 250-byte padding plus `(uint128 0, uint16 0)`, 268. A
 *   250-byte one reverts the estimate (`SliceOutOfBounds`).
 * - `SetPoolAdapters` is pool-independent in framing but carries the pool id
 *   at offset 1, which `MultiAdapter.estimate` routes on, so it takes the pool
 *   id it configures. Without one it prices against the global set.
 *
 * `extraGasLimit` is written where `MessageLib.messageExtraGasLimit` reads it,
 * for the two share-transfer messages and `ManagerCallFromHub`: `GasService`
 * adds it to the message's gas, so a message that carries one costs more than
 * the empty form. `TokenBridge` forwards its per-share-class gas limits into
 * the transfers; a remote `ShareManager` revoke carries `SHARE_REVOKE_EXTRA_GAS`.
 */
export function emptyMessageV3_3(
  type: MessageTypeV3_3,
  poolId?: string,
  subtype?: number,
  extraGasLimit?: bigint,
): Hex {
  if (extraGasLimit !== undefined) {
    const offset = EXTRA_GAS_LIMIT_OFFSET_V3_3[type];
    if (offset === undefined) {
      throw new MessageArgumentError(
        `emptyMessageV3_3: ${MessageTypeV3_3[type] ?? String(type)} carries no extra gas limit the SDK prices`,
      );
    }
    if (extraGasLimit < 0n || extraGasLimit >= 1n << 128n) {
      throw new MessageArgumentError(
        `emptyMessageV3_3: extraGasLimit ${extraGasLimit} is not a uint128`,
      );
    }
    const empty = emptyMessageV3_3(type, poolId, subtype);
    const at = 2 + offset * 2;
    return `${empty.slice(0, at)}${extraGasLimit.toString(16).padStart(32, "0")}${empty.slice(at + 32)}` as Hex;
  }
  if (
    MessageTypeV3_3[type] === undefined ||
    type === MessageTypeV3_3._Invalid
  ) {
    throw new MessageArgumentError(
      `emptyMessageV3_3: ${String(type)} is not a known v3.3 MessageType`,
    );
  }
  const name = MessageTypeV3_3[type];

  if (type === MessageTypeV3_3.SetPoolAdapters && poolId !== undefined) {
    if (subtype !== undefined) {
      throw new MessageArgumentError(
        `emptyMessageV3_3: ${name} has no subtype byte`,
      );
    }
    return encodePacked(
      ["uint8", "uint64", "bytes"],
      [
        type,
        requirePoolId(name, poolId),
        toHex(0, { size: POOL_DEPENDENT_PADDING_BYTES }),
      ],
    );
  }

  if (!isPoolDependentV3_3(type)) {
    if (poolId !== undefined) {
      throw new MessageArgumentError(
        `emptyMessageV3_3: ${name} is a pool-independent message and carries ` +
          `no pool id, but ${JSON.stringify(poolId)} was supplied`,
      );
    }
    if (subtype !== undefined) {
      throw new MessageArgumentError(
        `emptyMessageV3_3: ${name} has no subtype byte`,
      );
    }
    return encodePacked(
      ["uint8", "bytes"],
      [type, toHex(0, { size: POOL_INDEPENDENT_PADDING_BYTES })],
    );
  }

  const rawPoolId = requirePoolId(name, poolId);

  if (type === MessageTypeV3_3.UpdateVault) {
    if (
      subtype !== undefined &&
      (!Number.isInteger(subtype) || subtype < 0 || subtype > 0xff)
    ) {
      throw new MessageArgumentError(
        `emptyMessageV3_3: UpdateVault subtype ${subtype} is not a uint8`,
      );
    }
    return encodePacked(
      [
        "uint8",
        "uint64",
        "bytes16",
        "uint128",
        "bytes32",
        "uint8",
        "uint128",
        "uint16",
      ],
      [
        type,
        rawPoolId,
        toHex(0, { size: 16 }),
        0n,
        toHex(0, { size: 32 }),
        subtype ?? VAULT_UPDATE_SUBTYPE.deployAndLink,
        0n,
        0,
      ],
    );
  }

  if (subtype !== undefined) {
    throw new MessageArgumentError(
      `emptyMessageV3_3: ${name} has no subtype byte. Only UpdateVault carries one.`,
    );
  }

  if (type === MessageTypeV3_3.NotifyShareClass) {
    return encodePacked(
      ["uint8", "uint64", "bytes", "uint128", "uint16"],
      [
        type,
        rawPoolId,
        toHex(0, { size: POOL_DEPENDENT_PADDING_BYTES }),
        0n,
        0,
      ],
    );
  }

  return encodePacked(
    ["uint8", "uint64", "bytes"],
    [type, rawPoolId, toHex(0, { size: POOL_DEPENDENT_PADDING_BYTES })],
  );
}
