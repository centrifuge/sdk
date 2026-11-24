import { encodeFunctionData, encodePacked, type Address } from "viem";

import {
  BuilderArgumentMismatchError,
  UnsupportedForProtocolVersionError,
} from "../errors";
import { MessageType, type CrosschainMessage } from "../messages";
import {
  centrifugeIdFromPoolId,
  PROTOCOL_VERSION_V3_2,
  PROTOCOL_VERSION_V3_3,
} from "../types";
import type {
  BuiltProtocolCall,
  ProtocolCall,
  ProtocolContext,
} from "../types";
import { requireAddress, requireBytes16 } from "./create-holding";
import { parseUint64, parseUint128 } from "./money";
import {
  addressToBytes32,
  requireCentrifugeId,
  requireSamePool,
} from "./vaults";

/**
 * `UpdateRestrictionType` discriminators, as `BaseTransferHook.updateRestriction`
 * reads them off the first byte of the payload (`centrifuge-v3`,
 * `src/hooks/BaseTransferHook.sol`).
 *
 * Numbers, not an enum: the payload is a packed byte and these are the wire
 * values, so naming them here keeps the three builders from each spelling a
 * magic `1` / `2` / `3`.
 */
const UPDATE_RESTRICTION = {
  member: 1,
  freeze: 2,
  unfreeze: 3,
} as const;

/**
 * `extraGasLimit` for the `Hub.updateRestriction` message.
 *
 * Zero, matching the SDK (`ShareClass.updateMembers` / `freezeMember` /
 * `unfreezeMember` all pass `0n`): the restriction payload is a fixed 41 or 33
 * bytes and needs no extra execution budget on the spoke.
 */
const NO_EXTRA_GAS_LIMIT = 0n;

/**
 * `extraGasLimit` and `remoteExtraGasLimit` for a cross-chain share transfer.
 * Both zero, matching the SDK's `ShareClass.crosschainTransferShares`.
 */
const NO_TRANSFER_GAS_LIMITS = [0n, 0n] as const;

/** Arguments shared by the three restriction updates. */
interface MemberRestrictionArgs {
  /** Raw pool id (uint64 decimal string). Must match `ctx.poolId`. */
  readonly poolId: string;
  /** Share-class id (bytes16 hex). */
  readonly scId: string;
  /**
   * Centrifuge id of the SPOKE whose restriction hook is updated, as a decimal
   * string. An argument rather than the context: the call goes to the `Hub` on
   * the pool's home chain and travels to this network as a message.
   */
  readonly centrifugeId: string;
  /** The investor whose membership or frozen state changes. */
  readonly address: string;
  /**
   * Where unspent cross-chain gas payment is returned.
   *
   * Required, with no default, for the same reason
   * `UpdateBalanceSheetManagersArgs.refundAddress` is: the SDK passes its
   * signing address and the backend cannot — the signer is unknown at PREVIEW
   * time and the calldata must be byte-identical at preview, at prepare and
   * again during Fordefi's dual-channel re-derivation.
   */
  readonly refundAddress: string;
}

/** Arguments for {@link updateMember}. */
export interface UpdateMemberArgs extends MemberRestrictionArgs {
  /**
   * Membership expiry as a uint64 UNIX timestamp in SECONDS, decimal string.
   *
   * Always concrete here — the `op: "add"` sugar is resolved to the
   * `MAX_UINT32` sentinel before the action reaches this package, so this
   * builder never consults a clock and its output is a function of its input.
   *
   * The hook requires `block.timestamp <= validUntil` and reverts
   * `InvalidValidUntil` otherwise, ON THE SPOKE, after the cross-chain message
   * has been paid for and dispatched. This builder is pure and cannot check a
   * timestamp against now; the caller refuses a too-near expiry before calling
   * (private-api's `MembershipExpiryTooSoonError`).
   */
  readonly validUntil: string;
}

/** Arguments for {@link freezeMember} and {@link unfreezeMember}. */
export type FreezeMemberArgs = MemberRestrictionArgs;

/** Arguments for {@link crosschainTransferShares}. */
export interface CrosschainTransferSharesArgs {
  /** Raw pool id (uint64 decimal string). Must match `ctx.poolId`. */
  readonly poolId: string;
  /** Share-class id (bytes16 hex). */
  readonly scId: string;
  /**
   * Centrifuge id of the network the shares are minted on, decimal string.
   *
   * The SOURCE network is the context, not an argument — see the note on
   * {@link crosschainTransferShares}.
   */
  readonly destinationCentrifugeId: string;
  /** Who receives the shares on the destination network. */
  readonly receiver: string;
  /**
   * Shares to move, in the share token's smallest unit, as a decimal string.
   * Money-shaped: it travels as the on-chain integer and is never a JS number.
   */
  readonly amount: string;
  /** See {@link MemberRestrictionArgs.refundAddress}. */
  readonly refundAddress: string;
  /** v3.3 only: the originator attributed in the event and forwarded to the bridging hook. */
  readonly senderAddress?: string;
  /** v3.3 only: the account whose shares are pulled and burned; defaults to `senderAddress`. */
  readonly ownerAddress?: string;
}

/**
 * Grant or expire one investor's membership of a share class on one network —
 * pure builder, no I/O.
 *
 * v3.2 encodes a single
 * `Hub.updateRestriction(poolId, scId, centrifugeId, payload, extraGasLimit,
 * refund)` whose payload is the packed
 * `(uint8 Member, bytes32 user, uint64 validUntil)` triple. Hub-side
 * transaction, spoke-side effect: the hook that actually stores the membership
 * lives on the named network, which is why `centrifugeId` is an argument rather
 * than the context. Byte-comparable to the SDK's `ShareClass.updateMembers`
 * with a single entry.
 *
 * `user` is a `bytes32` and is RIGHT-padded, because the hook decodes it with
 * `CastLib.toAddress` — see {@link addressToBytes32} for why the direction has
 * to be read off the consuming call.
 *
 * There is deliberately no batching over addresses or networks, unlike
 * `updateVaults`. The client edits one investor at a time
 * (`AddInvestor`, `EditInvestor`) and already issues one transaction per
 * change, so a batch would be a contract nobody calls; `updateVaults` batched
 * because the vault form submits several edits at once.
 *
 * ## msg.value
 *
 * `Hub.updateRestriction` is a payable cross-chain send, so this builder
 * declares one `UpdateRestriction` message to `args.centrifugeId` and
 * `private-api` prices it. The distinction from `updatePoolManagers` is now
 * explicit in the type rather than only in a comment: that builder declares an
 * EMPTY manifest ("nothing to pay for"), these declare a populated one. Every
 * builder in this file dispatches exactly one message.
 */
export function updateMember(
  ctx: ProtocolContext,
  args: UpdateMemberArgs,
): BuiltProtocolCall {
  const scope = restrictionScope(ctx, args, "updateMember");
  const validUntil = parseUint64(args.validUntil, "updateMember.validUntil");

  return single(
    ctx,
    hubCall(
      ctx,
      [
        scope.poolId,
        scope.scId,
        scope.centrifugeId,
        encodePacked(
          ["uint8", "bytes32", "uint64"],
          [UPDATE_RESTRICTION.member, addressToBytes32(scope.user), validUntil],
        ),
        NO_EXTRA_GAS_LIMIT,
        scope.refund,
      ],
      `Hub.updateRestriction (member ${scope.user} until ${validUntil} on ` +
        `network ${scope.centrifugeId})`,
    ),
    restrictionManifest(args, scope.centrifugeId),
  );
}

/**
 * Freeze one investor's share-token balance on one network — pure builder, no
 * I/O.
 *
 * Same `Hub.updateRestriction` envelope as {@link updateMember}, with the
 * shorter `(uint8 Freeze, bytes32 user)` payload. Freezing is orthogonal to
 * membership: the hook keeps the two in different bits of the same `hookData`
 * word, so a frozen investor is still a member and a lapsed member may still be
 * frozen. That is why this is its own action rather than a flag on
 * `updateMember` — one call must never quietly reset the other.
 *
 * Same manifest as {@link updateMember}: one `UpdateRestriction` message to the
 * named network, priced by the caller.
 */
export function freezeMember(
  ctx: ProtocolContext,
  args: FreezeMemberArgs,
): BuiltProtocolCall {
  return freezeCall(ctx, args, "freeze");
}

/**
 * Lift a freeze on one investor on one network — pure builder, no I/O.
 * See {@link freezeMember}.
 */
export function unfreezeMember(
  ctx: ProtocolContext,
  args: FreezeMemberArgs,
): BuiltProtocolCall {
  return freezeCall(ctx, args, "unfreeze");
}

/** The shared body of {@link freezeMember} and {@link unfreezeMember}. */
function freezeCall(
  ctx: ProtocolContext,
  args: FreezeMemberArgs,
  kind: "freeze" | "unfreeze",
): BuiltProtocolCall {
  const builder = kind === "freeze" ? "freezeMember" : "unfreezeMember";
  const scope = restrictionScope(ctx, args, builder);

  return single(
    ctx,
    hubCall(
      ctx,
      [
        scope.poolId,
        scope.scId,
        scope.centrifugeId,
        encodePacked(
          ["uint8", "bytes32"],
          [UPDATE_RESTRICTION[kind], addressToBytes32(scope.user)],
        ),
        NO_EXTRA_GAS_LIMIT,
        scope.refund,
      ],
      `Hub.updateRestriction (${kind} ${scope.user} on network ` +
        `${scope.centrifugeId})`,
    ),
    restrictionManifest(args, scope.centrifugeId),
  );
}

/**
 * Burn shares on one network and mint them on another — pure builder, no I/O.
 *
 * The one builder in this package whose target is NOT the hub. v3.2 encodes
 * `Spoke.crosschainTransferShares(destinationCentrifugeId, poolId, scId,
 * receiver, amount, extraGasLimit, remoteExtraGasLimit, refund)` on the SOURCE
 * network's `Spoke`, so `ctx` must be resolved for the source network
 * (`resolveProtocolContext(poolId, version, { centrifugeId: source })`), and
 * the destination travels as the first argument. Getting that the wrong way
 * round would burn the shares on the chain they were meant to arrive on.
 *
 * `receiver` is a `bytes32` and RIGHT-padded, the same convention as every
 * other address the protocol sends cross-chain (see {@link addressToBytes32}).
 *
 * The eight-argument overload is used deliberately: the six-argument one takes
 * no `refund`, so unspent gas would be stranded in the gateway. The SDK calls
 * the same overload.
 *
 * ## What this builder does NOT check
 *
 * It does not check that the transfer is ALLOWED. The SDK's
 * `crossChainTransferStatus()` reads `checkTransferRestriction` on both share
 * tokens over RPC, which a served backend read does not do — and a
 * hook state read at build time would be stale by execution anyway. The refusal
 * that matters is on chain: the source hook reverts
 * `CrossChainTransferNotAllowed` before any value moves.
 *
 * ## msg.value
 *
 * `Spoke.crosschainTransferShares` is payable and the message it dispatches
 * depends on WHERE it is sent from — this is the one builder whose manifest is
 * not simply "one message to the network named in the arguments", and getting
 * it wrong would pay the wrong route:
 *
 * - source IS the pool's hub chain: the hub can dispatch straight to the
 *   destination, so the message is `ExecuteTransferShares` to
 *   `destinationCentrifugeId`.
 * - source is a spoke: the transfer must be routed via the hub first, so the
 *   message is `InitiateTransferShares` to the HUB's centrifugeId, and the
 *   hub-to-destination leg is paid for out of the hub's own subsidy rather
 *   than by this transaction.
 *
 * Both branches match the SDK's `ShareClass.crosschainTransferShares` exactly.
 * The hub id is derived from the pool id (its high 16 bits) rather than taken
 * as an argument, so a caller cannot name a hub the pool does not live on.
 */
export function crosschainTransferShares(
  ctx: ProtocolContext,
  args: CrosschainTransferSharesArgs,
): BuiltProtocolCall {
  requireSamePool(ctx, args.poolId, "crosschainTransferShares");
  const poolId = BigInt(args.poolId);
  const scId = requireBytes16(args.scId, "crosschainTransferShares.scId");
  const destination = requireCentrifugeId(
    parseCentrifugeId(
      args.destinationCentrifugeId,
      "crosschainTransferShares.destinationCentrifugeId",
    ),
    "crosschainTransferShares.destinationCentrifugeId",
  );
  // A transfer to the chain the shares already sit on is not a cross-chain
  // transfer: it would burn and re-mint on one network, paying for a message to
  // itself. Refused rather than encoded, because the caller who wrote it meant
  // something else.
  if (destination === ctx.centrifugeId) {
    throw new BuilderArgumentMismatchError(
      "crosschainTransferShares.destinationCentrifugeId equals the source " +
        `network (${destination}); a transfer to the same chain burns and ` +
        "re-mints the shares and pays for a message to itself.",
    );
  }
  const receiver = requireNonZeroAddress(
    args.receiver,
    "crosschainTransferShares.receiver",
  );
  const refund = requireAddress(
    args.refundAddress,
    "crosschainTransferShares.refundAddress",
  );
  const amount = parseUint128(args.amount, "crosschainTransferShares.amount");
  if (amount === 0n) {
    throw new BuilderArgumentMismatchError(
      "crosschainTransferShares.amount is zero: a transfer that moves nothing " +
        "still costs a signature, a policy evaluation and a cross-chain message.",
    );
  }

  const [extraGasLimit, remoteExtraGasLimit] = NO_TRANSFER_GAS_LIMITS;
  const call: ProtocolCall = {
    to: ctx.addresses.spoke,
    data: encodeFunctionData({
      abi: ctx.abis.spoke,
      functionName: "crosschainTransferShares",
      args: transferSharesArgs(ctx, args, {
        destination,
        poolId,
        scId,
        receiver,
        amount,
        extraGasLimit,
        remoteExtraGasLimit,
        refund,
      }),
    }),
    // Zero here; the crosschain fee is attached to the OUTER transaction from
    // the message manifest below. See the msg.value note above.
    value: 0n,
    label:
      `Spoke.crosschainTransferShares (${amount} shares to ${receiver} on ` +
      `network ${destination})`,
  };

  const hubCentrifugeId = centrifugeIdFromPoolId(args.poolId);

  return {
    to: call.to,
    data: call.data,
    value: 0n,
    calls: [call],
    messages:
      ctx.protocolVersion !== PROTOCOL_VERSION_V3_2
        ? undefined
        : ctx.centrifugeId === hubCentrifugeId
          ? {
              [destination]: [
                {
                  type: MessageType.ExecuteTransferShares,
                  poolId: args.poolId,
                },
              ],
            }
          : {
              [hubCentrifugeId]: [
                {
                  type: MessageType.InitiateTransferShares,
                  poolId: args.poolId,
                },
              ],
            },
  };
}

/**
 * Validate the four fields every restriction update shares.
 *
 * The zero address is refused here rather than left to the chain: the hook
 * reverts `CannotFreezeZeroAddress` for a freeze and
 * `EndorsedUserCannotBeUpdated` for endorsed accounts, and the first of those
 * would only surface on the spoke after the message was paid for. The endorsed
 * set is on-chain state this pure package cannot see; the zero address is not.
 */
/**
 * v3.2 bridges the caller's own shares; v3.3 names the attributed `sender`
 * and the `owner` whose shares are pulled, so a router can bridge on behalf
 * of a user.
 */
function transferSharesArgs(
  ctx: ProtocolContext,
  args: CrosschainTransferSharesArgs,
  parsed: {
    destination: number;
    poolId: bigint;
    scId: `0x${string}`;
    receiver: Address;
    amount: bigint;
    extraGasLimit: bigint;
    remoteExtraGasLimit: bigint;
    refund: Address;
  },
): readonly unknown[] {
  const { destination, poolId, scId, receiver, amount, refund } = parsed;
  if (ctx.protocolVersion === PROTOCOL_VERSION_V3_2) {
    if (args.senderAddress !== undefined || args.ownerAddress !== undefined) {
      throw new BuilderArgumentMismatchError(
        "crosschainTransferShares.senderAddress/ownerAddress were supplied but " +
          "protocol v3.2 bridges the caller's own shares and has no argument to carry them.",
      );
    }
    return [
      destination,
      poolId,
      scId,
      addressToBytes32(receiver),
      amount,
      parsed.extraGasLimit,
      parsed.remoteExtraGasLimit,
      refund,
    ];
  }
  if (ctx.protocolVersion === PROTOCOL_VERSION_V3_3) {
    if (args.senderAddress === undefined) {
      throw new BuilderArgumentMismatchError(
        "crosschainTransferShares.senderAddress is required on protocol v3.3: " +
          "the spoke attributes the transfer to it and the bridging hook keys on it.",
      );
    }
    const sender = requireNonZeroAddress(
      args.senderAddress,
      "crosschainTransferShares.senderAddress",
    );
    const owner =
      args.ownerAddress === undefined
        ? sender
        : requireNonZeroAddress(
            args.ownerAddress,
            "crosschainTransferShares.ownerAddress",
          );
    return [
      destination,
      poolId,
      scId,
      addressToBytes32(receiver),
      sender,
      owner,
      amount,
      parsed.extraGasLimit,
      parsed.remoteExtraGasLimit,
      refund,
    ];
  }
  throw new UnsupportedForProtocolVersionError(
    "crosschainTransferShares",
    ctx.protocolVersion,
    "no Spoke.crosschainTransferShares shape is known for it",
  );
}

function restrictionScope(
  ctx: ProtocolContext,
  args: MemberRestrictionArgs,
  builder: string,
): {
  poolId: bigint;
  scId: `0x${string}`;
  centrifugeId: number;
  user: Address;
  refund: Address;
} {
  requireSamePool(ctx, args.poolId, builder);

  return {
    poolId: BigInt(args.poolId),
    scId: requireBytes16(args.scId, `${builder}.scId`),
    centrifugeId: requireCentrifugeId(
      parseCentrifugeId(args.centrifugeId, `${builder}.centrifugeId`),
      `${builder}.centrifugeId`,
    ),
    user: requireNonZeroAddress(args.address, `${builder}.address`),
    refund: requireAddress(args.refundAddress, `${builder}.refundAddress`),
  };
}

/**
 * The manifest every restriction update declares: one `UpdateRestriction`
 * message to the network named in the arguments.
 *
 * A named helper rather than an inline literal in three places, because the
 * pool id it carries is what `MultiAdapter.estimate` resolves the adapter set
 * from — three copies would be three chances to pass `ctx.poolId` where the
 * argument's own pool id belongs (they are equal here only because
 * `requireSamePool` has already run).
 */
function restrictionManifest(
  args: MemberRestrictionArgs,
  centrifugeId: number,
): Record<number, readonly CrosschainMessage[]> {
  return {
    [centrifugeId]: [
      { type: MessageType.UpdateRestriction, poolId: args.poolId },
    ],
  };
}

/** Encode one `Hub.updateRestriction` call on the pool's home chain. */
function hubCall(
  ctx: ProtocolContext,
  args: readonly unknown[],
  label: string,
): ProtocolCall {
  return {
    to: ctx.addresses.hub,
    data: encodeFunctionData({
      abi: ctx.abis.hub,
      functionName: "updateRestriction",
      args,
    }),
    // Zero per INNER call. Every call in this file dispatches a cross-chain
    // message, but the fee is attached to the OUTER transaction from the
    // message manifest — the same place the SDK's `wrapTransaction` attaches
    // it, and the only place `msg.value` is actually read.
    value: 0n,
    label,
  };
}

/**
 * Wrap a single call into the `BuiltProtocolCall` envelope.
 *
 * Deliberately not `encodeBatchCalldata`: it returns a one-element batch
 * verbatim anyway, and going through it here would suggest these builders emit
 * variable-length batches. They do not — each is exactly one call — and `calls`
 * still carries the decode label onto `RawTx.metadata.innerCalls`, which is
 * what the decoder and Fordefi verification read.
 */
function single(
  ctx: ProtocolContext,
  call: ProtocolCall,
  messages: Record<number, readonly CrosschainMessage[]>,
): BuiltProtocolCall {
  return {
    to: ctx.addresses.hub,
    data: call.data,
    value: 0n,
    calls: [call],
    messages,
  };
}

/**
 * An address that is not `0x0`.
 *
 * The zero address passes every format check and means "nobody" to the
 * protocol. Freezing it reverts (`CannotFreezeZeroAddress`), and granting it
 * membership would write a hook entry for an account no one controls.
 */
function requireNonZeroAddress(value: string, field: string): Address {
  const address = requireAddress(value, field);
  if (BigInt(address) === 0n) {
    throw new BuilderArgumentMismatchError(
      `${field} is the zero address, which is not an investor`,
    );
  }
  return address;
}

/**
 * A decimal-string centrifugeId as a number, refusing anything that is not a
 * CANONICAL positive integer literal.
 *
 * Restated from `managers.ts` for the same reason the `hubCall` helpers are:
 * these builders close over nothing and a shared helper would only hide which
 * of them parse a network id. The rule itself is not restated loosely —
 * `Number("1e3")` is 1000 and `"02"` is the same network as `"2"` under two
 * different strings, so both are refused rather than coerced.
 */
function parseCentrifugeId(value: string, field: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new BuilderArgumentMismatchError(
      `${field} ${JSON.stringify(value)} is not a canonical decimal ` +
        "centrifugeId (no leading zeros)",
    );
  }
  return Number(value);
}
