import { concatHex, encodeFunctionData, toHex, type Address } from "viem";
import {
  BuilderArgumentMismatchError,
  UnsupportedForProtocolVersionError,
} from "../errors";
import { MessageType, type CrosschainMessage } from "../messages";
import {
  PROTOCOL_VERSION_V3_2,
  PROTOCOL_VERSION_V3_3,
  type BuiltProtocolCall,
  type ProtocolCall,
  type ProtocolContext,
} from "../types";
import { encodeBatchCalldata } from "./batch";
import { requireAddress, requireBytes16 } from "./create-holding";
import {
  encodeShareTokenRegistrarPayload,
  encodeSyncManagerPayload,
  parseCentrifugeId,
} from "./manager-call";
import { parseUint128 } from "./money";

/**
 * How a vault settles deposits, as the DEPLOY path names it.
 *
 * Two values, not the projection's three: the choice a deployer makes is which
 * FACTORY to use, and v3.2 has exactly two (`asyncVaultFactory`,
 * `syncDepositVaultFactory`). The resulting vault is projected as `Async` or
 * `SyncDepositAsyncRedeem` respectively — the projection records what was
 * deployed, this records what to deploy. Same two values the SDK's
 * `PoolNetwork.deployVaults()` takes, so the calldata is comparable fixture for
 * fixture.
 */
export type VaultDeployKind = "async" | "syncDeposit";

/**
 * `Hub.updateVault`'s `kind` argument (v3.2). Mirrors the SDK's
 * `VaultUpdateKind` enum ordinals exactly — the wire values are what the spoke
 * dispatches on, so they are pinned by a unit test rather than left to
 * declaration order.
 */
export const VAULT_UPDATE_KIND = {
  deployAndLink: 0,
  link: 1,
  unlink: 2,
} as const;

/**
 * `Hub.updateContract`'s trusted-call selector for the vault managers (v3.2).
 * Mirrors the SDK's `VaultManagerTrustedCall` enum: `Valuation = 0`,
 * `MaxReserve = 1`.
 */
const VAULT_MANAGER_TRUSTED_CALL_MAX_RESERVE = 1;

/**
 * `uint128` max — the reserve a freshly deployed sync-deposit vault gets, so it
 * accepts deposits at all before an operator sets a real ceiling.
 *
 * Byte-identical to what the SDK's `deploy()` encodes (viem's `maxUint128`).
 * Restated here rather than imported so the constant sits next to the calldata
 * it produces; the value is pinned by a parity test.
 */
const UINT128_MAX = (1n << 128n) - 1n;

/**
 * `extraGasLimit` on the v3.2 `Hub` cross-chain entry points.
 *
 * Always zero, matching the SDK. It buys extra spoke-side execution gas for the
 * message; the SDK passes 0 and lets the gateway's own budget apply, and a
 * non-zero value the caller did not ask for would silently raise the cost of
 * their transaction.
 */
const NO_EXTRA_GAS_LIMIT = 0n;

/**
 * A vault the link/unlink path targets by address.
 *
 * `vaultAddress` is resolved from the `chain_v1` vault projection by the
 * caller, never taken from a client: it is the contract the spoke will link or
 * unlink, and an unprojected address would let a caller point a share class's
 * investment entry point at anything. `scId` and `assetId` travel with it
 * because `Hub.updateVault` keys the message by them and the spoke matches the
 * triple — a mismatched pair addresses a different vault.
 */
export interface VaultRef {
  /** Share-class id (bytes16 hex). */
  readonly scId: string;
  /** Asset id (uint128 decimal string). */
  readonly assetId: string;
  /** The vault contract's address. */
  readonly vaultAddress: string;
}

/** Arguments for {@link deployVault}. */
export interface DeployVaultArgs {
  /** Raw pool id (uint64 decimal string). Must match `ctx.poolId`. */
  readonly poolId: string;
  /** Share-class id (bytes16 hex). Must already be enabled on the spoke. */
  readonly scId: string;
  /** Asset id (uint128 decimal string). */
  readonly assetId: string;
  readonly kind: VaultDeployKind;
  /**
   * Where unspent cross-chain gas payment is returned.
   *
   * Required, with no default. The SDK passes its signing address; the backend
   * cannot, because the signer is not known at PREVIEW time and the calldata
   * must be byte-identical at preview, at prepare and again during Fordefi's
   * dual-channel re-derivation — a value that changed between those three would
   * fail verification on every transaction. It is a value destination, so the
   * zero address is a burn rather than a default (the same rule
   * `withdrawHolding.receiverAddress` follows).
   */
  readonly refundAddress: string;
  /**
   * The SPOKE's resolved context: the vault factories and the sync manager are
   * the target network's contracts, not the pool's hub chain's.
   *
   * A second context rather than three loose addresses, so the version-plural
   * rule holds on both sides of the message: the factory addresses come from
   * the same verified registry, keyed by the same protocol version.
   */
  readonly spoke: ProtocolContext;
  /**
   * v3.3 only: the address the factory deploys the vault to (`factory.getVault`,
   * deterministic). Set on the share token as its ERC-7575 vault pointer right
   * after the deploy, in the same batch. Refused on v3.2.
   */
  readonly vaultAddress?: string;
}

/** Arguments for {@link updateVaults}. */
export interface UpdateVaultsArgs {
  /** Raw pool id (uint64 decimal string). Must match `ctx.poolId`. */
  readonly poolId: string;
  /** See {@link DeployVaultArgs.refundAddress}. */
  readonly refundAddress: string;
  /** See {@link DeployVaultArgs.spoke}. */
  readonly spoke: ProtocolContext;
  /** Vaults to unlink. Encoded BEFORE the links — see {@link updateVaults}. */
  readonly unlink?: readonly VaultRef[];
  /** Vaults to link (they must already be deployed). */
  readonly link?: readonly VaultRef[];
  /**
   * A new max deposit reserve for one sync-deposit vault.
   *
   * `scId` and `assetId` are resolved from the projection by the caller
   * alongside the vault address, because `Hub.updateContract` addresses the
   * sync manager by `(scId, assetId)` and not by vault address at all.
   */
  readonly maxReserve?: {
    readonly scId: string;
    readonly assetId: string;
    /**
     * Amount in the ASSET's smallest unit, as a canonical decimal string of
     * the on-chain integer. Never a number: a uint128 does not survive a JS
     * number, and a rounded reserve is a wrong reserve.
     */
    readonly amount: string;
  };
}

/**
 * Deploy and link one vault — pure builder, no I/O.
 *
 * HUB-side: the transaction is sent to the `Hub` on the pool's home chain and
 * the target network travels as the `centrifugeId` argument of the messages, so
 * `ctx` is the pool's home chain and `args.spoke` is the target. Resolving the
 * factory from `ctx` instead would encode the HUB chain's factory address into
 * a message the spoke then cannot dispatch.
 *
 * v3.2 encodes it as up to three `Hub` calls, batched:
 *
 * 1. `updateContract(...)` carrying the sync manager's `MaxReserve` trusted
 *    call at `uint128` max — only for a `syncDeposit` vault, and only because a
 *    sync-deposit vault with a zero reserve accepts no deposits at all. Matches
 *    the SDK's `deploy()` byte for byte.
 * 2. `notifyAssetPrice(...)` so the spoke has a price for the asset before the
 *    vault goes live.
 * 3. `updateVault(..., DeployAndLink, ...)`.
 *
 * ## What this builder deliberately does NOT encode
 *
 * The SDK's `deploy()` prepends a state-conditional preamble —
 * `setAdapters`, `notifyPool`, on v3.3 to a spoke on another chain the
 * `AdapterFailover` manager and steward calls, `notifyShareClass`,
 * `updateBalanceSheetManager` for the async/sync managers, `setRequestManager`
 * — each guarded by an RPC read
 * (`BalanceSheet.manager`, `Spoke.requestManager`, `PoolNetwork.details()`).
 * None of it is reproducible here: a pure builder does no I/O, and
 * `chain_v1` projects neither `Spoke.requestManager` nor the balance-sheet
 * manager flags for a REGISTRY address, so there is nothing to read them from
 * either. Guessing would be worse than omitting: emitting
 * `setRequestManager` when one is already set is a wasted cross-chain message,
 * and omitting it when it is missing leaves a deployed vault nobody can invest
 * through.
 *
 * So this action is scoped to what it says: deploy a vault on a network where
 * the share class is ALREADY enabled. The caller enforces that precondition
 * against the `token_instance` projection and refuses otherwise, and enabling a
 * share class on a new network stays a separate operation (the SDK's
 * `deployShareClasses`, backend action not yet ported).
 *
 * ## msg.value
 *
 * All three calls are payable cross-chain sends, so this builder declares a
 * {@link BuiltProtocolCall.messages} manifest naming every message and its
 * destination. It still attaches `value: 0n` itself, and that is the design
 * rather than a leftover: this package is pure, and `MultiAdapter.estimate` is
 * a chain read. `private-api` prices the manifest and puts the total on the
 * OUTER transaction — the same place the SDK's `wrapTransaction` puts it.
 *
 * One deliberate difference from the SDK: `PoolNetwork.deploy` does NOT list
 * the sync manager's `updateContract` in its own `messages`, even though that
 * call dispatches a `TrustedContractUpdate` (its own `enableBalanceSheetManager`
 * lists one for the identical call). That is an under-estimate on the SDK's
 * side, and under-payment is the failure that stalls a message after the
 * transaction has already confirmed — so this manifest lists it. Over-paying is
 * refundable to `refundAddress`; under-paying is not recoverable without
 * `repayBatch`.
 */
export function deployVault(
  ctx: ProtocolContext,
  args: DeployVaultArgs,
): BuiltProtocolCall {
  requireSamePool(ctx, args.poolId, "deployVault");
  const poolId = BigInt(args.poolId);
  const scId = requireBytes16(args.scId, "deployVault.scId");
  const assetId = parseUint128(args.assetId, "deployVault.assetId");
  const refund = requireAddress(
    args.refundAddress,
    "deployVault.refundAddress",
  );
  const spokeCentrifugeId = requireCentrifugeId(
    args.spoke.centrifugeId,
    "deployVault.spoke.centrifugeId",
  );
  requireSpokeForAsset(spokeCentrifugeId, assetId, "deployVault.assetId");
  const factory = requireSpokeAddress(
    args.spoke,
    args.kind === "syncDeposit"
      ? "syncDepositVaultFactory"
      : "asyncVaultFactory",
    "deployVault",
  );

  const calls: ProtocolCall[] = [];
  const messages: CrosschainMessage[] = [];

  if (args.kind === "syncDeposit") {
    const syncManager = requireSpokeAddress(
      args.spoke,
      "syncManager",
      "deployVault",
    );
    messages.push({
      type: MessageType.TrustedContractUpdate,
      poolId: args.poolId,
    });
    calls.push(
      maxReserveCall(
        ctx,
        "deployVault",
        spokeCentrifugeId,
        syncManager,
        scId,
        assetId,
        UINT128_MAX,
        refund,
      ),
    );
  }

  calls.push(
    hubCall(
      ctx,
      "notifyAssetPrice",
      [poolId, scId, assetId, refund],
      "Hub.notifyAssetPrice",
    ),
    hubCall(
      ctx,
      "updateVault",
      updateVaultArgs(
        ctx,
        poolId,
        scId,
        assetId,
        addressToBytes32(factory),
        VAULT_UPDATE_KIND.deployAndLink,
        refund,
      ),
      "Hub.updateVault (deploy and link)",
    ),
  );
  if (ctx.protocolVersion === PROTOCOL_VERSION_V3_3) {
    if (args.vaultAddress === undefined) {
      throw new BuilderArgumentMismatchError(
        "deployVault.vaultAddress is required on protocol v3.3: the share " +
          "token's vault pointer is set by a separate registrar call, from " +
          "the address the factory will deploy to.",
      );
    }
    calls.push(
      setVaultCall(
        ctx,
        "deployVault",
        args.spoke,
        spokeCentrifugeId,
        scId,
        assetId,
        requireAddress(args.vaultAddress, "deployVault.vaultAddress"),
        refund,
      ),
    );
  } else if (args.vaultAddress !== undefined) {
    throw new BuilderArgumentMismatchError(
      `deployVault.vaultAddress was supplied but protocol ${ctx.protocolVersion} ` +
        "sets the vault pointer inside updateVault and has no use for it.",
    );
  }
  messages.push(
    { type: MessageType.NotifyPricePoolPerAsset, poolId: args.poolId },
    {
      type: MessageType.UpdateVault,
      poolId: args.poolId,
      subtype: VAULT_UPDATE_KIND.deployAndLink,
    },
  );

  return batched(ctx, calls, { [spokeCentrifugeId]: messages });
}

/**
 * Link and/or unlink vaults and/or set one vault's max reserve, as ONE
 * transaction — pure builder, no I/O.
 *
 * One `PoolAction` rather than three, mirroring the client's single batched
 * transaction as one action. The management app edits a share class's vault
 * set in one form — enable these, disable those, change that reserve.
 *
 * Accuracy note on that rationale: `EditVaultModal.tsx` today pushes the
 * link/unlink and the reserve change as SEPARATE SDK transactions and awaits
 * them in a loop, so it is not in fact one batched transaction yet (the app has
 * a `batchTransactions` primitive, but the vault edit form does not use it).
 * The one-action design still holds and is the spec's decided point — it is
 * what makes the edit atomic, and it collapses what is today up to two signing
 * ceremonies, two Fordefi approval quorums and two audit rows into one — but the
 * spec's phrasing describes the intended client, not the current one.
 *
 * ## Call order is fixed, and that is load-bearing
 *
 * `unlink` first, then `link`, then `maxReserve`, each preserving the caller's
 * array order. Two reasons:
 *
 * - Correctness: replacing an async vault with a sync-deposit one for the same
 *   asset means unlinking the old before linking the new, and the reverse order
 *   would leave two linked entry points for one asset mid-batch.
 * - Determinism: the calldata is re-derived at preview, at prepare and again
 *   during Fordefi's dual-channel verification. An order that depended on
 *   object key iteration or on a set would make those three disagree and fail
 *   verification.
 *
 * ## msg.value
 *
 * Same arrangement as {@link deployVault}: every `updateVault` and the optional
 * reserve change dispatch a cross-chain message, so the manifest names them all
 * and `private-api` prices it. One message per edited vault — a batch of six
 * unlinks pays for six messages — which is exactly why the per-route gas cap
 * matters: a route can be as low as six messages.
 */
export function updateVaults(
  ctx: ProtocolContext,
  args: UpdateVaultsArgs,
): BuiltProtocolCall {
  requireSamePool(ctx, args.poolId, "updateVaults");
  const poolId = BigInt(args.poolId);
  const refund = requireAddress(
    args.refundAddress,
    "updateVaults.refundAddress",
  );

  const unlink = args.unlink ?? [];
  const link = args.link ?? [];
  if (
    unlink.length === 0 &&
    link.length === 0 &&
    args.maxReserve === undefined
  ) {
    throw new BuilderArgumentMismatchError(
      "updateVaults was given nothing to do: at least one of `link`, " +
        "`unlink` or `maxReserve` must be present. An empty edit costs a " +
        "signature and a policy evaluation and changes nothing.",
    );
  }

  const calls: ProtocolCall[] = [];
  const messages: CrosschainMessage[] = [];
  const spokeCentrifugeId = requireCentrifugeId(
    args.spoke.centrifugeId,
    "updateVaults.spoke.centrifugeId",
  );

  for (const [index, ref] of unlink.entries()) {
    requireSpokeForAsset(
      spokeCentrifugeId,
      parseUint128(ref.assetId, `updateVaults.unlink[${index}].assetId`),
      `updateVaults.unlink[${index}].assetId`,
    );
    calls.push(
      updateVaultCall(
        ctx,
        poolId,
        ref,
        VAULT_UPDATE_KIND.unlink,
        refund,
        `updateVaults.unlink[${index}]`,
        "Hub.updateVault (unlink)",
      ),
    );
    if (ctx.protocolVersion === PROTOCOL_VERSION_V3_3) {
      calls.push(
        setVaultCall(
          ctx,
          "updateVaults",
          args.spoke,
          spokeCentrifugeId,
          requireBytes16(ref.scId, `updateVaults.unlink[${index}].scId`),
          parseUint128(ref.assetId, `updateVaults.unlink[${index}].assetId`),
          ZERO_ADDRESS,
          refund,
        ),
      );
    }
    messages.push({
      type: MessageType.UpdateVault,
      poolId: args.poolId,
      subtype: VAULT_UPDATE_KIND.unlink,
    });
  }

  for (const [index, ref] of link.entries()) {
    requireSpokeForAsset(
      spokeCentrifugeId,
      parseUint128(ref.assetId, `updateVaults.link[${index}].assetId`),
      `updateVaults.link[${index}].assetId`,
    );
    calls.push(
      updateVaultCall(
        ctx,
        poolId,
        ref,
        VAULT_UPDATE_KIND.link,
        refund,
        `updateVaults.link[${index}]`,
        "Hub.updateVault (link)",
      ),
    );
    if (ctx.protocolVersion === PROTOCOL_VERSION_V3_3) {
      calls.push(
        setVaultCall(
          ctx,
          "updateVaults",
          args.spoke,
          spokeCentrifugeId,
          requireBytes16(ref.scId, `updateVaults.link[${index}].scId`),
          parseUint128(ref.assetId, `updateVaults.link[${index}].assetId`),
          requireAddress(
            ref.vaultAddress,
            `updateVaults.link[${index}].vaultAddress`,
          ),
          refund,
        ),
      );
    }
    messages.push({
      type: MessageType.UpdateVault,
      poolId: args.poolId,
      subtype: VAULT_UPDATE_KIND.link,
    });
  }

  if (args.maxReserve !== undefined) {
    const syncManager = requireSpokeAddress(
      args.spoke,
      "syncManager",
      "updateVaults",
    );
    requireSpokeForAsset(
      spokeCentrifugeId,
      parseUint128(args.maxReserve.assetId, "updateVaults.maxReserve.assetId"),
      "updateVaults.maxReserve.assetId",
    );
    calls.push(
      maxReserveCall(
        ctx,
        "updateVaults",
        spokeCentrifugeId,
        syncManager,
        requireBytes16(args.maxReserve.scId, "updateVaults.maxReserve.scId"),
        parseUint128(
          args.maxReserve.assetId,
          "updateVaults.maxReserve.assetId",
        ),
        parseUint128(args.maxReserve.amount, "updateVaults.maxReserve.amount"),
        refund,
      ),
    );
    messages.push({
      type: MessageType.TrustedContractUpdate,
      poolId: args.poolId,
    });
  }

  return batched(ctx, calls, { [spokeCentrifugeId]: messages });
}

const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";

/**
 * `Hub.updateVault` is dispatched to the asset's chain (its id carries the
 * centrifugeId in the high 16 bits) while the spoke context names the chain
 * the registrar, factory and sync manager are read from; a mismatch reverts
 * the link on chain and would clear the vault pointer on the wrong chain. An
 * id with no chain in its high bits carries nothing to compare and passes.
 */
function requireSpokeForAsset(
  spokeCentrifugeId: number,
  assetId: bigint,
  field: string,
): void {
  const assetCentrifugeId = Number(assetId >> 112n);
  if (assetCentrifugeId !== 0 && assetCentrifugeId !== spokeCentrifugeId) {
    throw new BuilderArgumentMismatchError(
      `${field} names an asset on centrifugeId ${assetCentrifugeId} but the ` +
        `spoke context was resolved for centrifugeId ${spokeCentrifugeId}; ` +
        "Hub.updateVault goes to the asset's chain, so the two must agree.",
    );
  }
}

/**
 * `managerCall(shareTokenRegistrar, SetVault)`: v3.3's `SpokeRegistry.linkVault`
 * only flips `isLinked`; the share token's ERC-7575 vault pointer that
 * `AsyncRequestManager` resolves fulfilments through is set by the registrar,
 * so every deploy, link and unlink carries it in the same batch, after the
 * `updateVault` it depends on. `address(0)` clears it.
 */
function setVaultCall(
  ctx: ProtocolContext,
  builder: string,
  spoke: ProtocolContext,
  spokeCentrifugeId: number,
  scId: `0x${string}`,
  assetId: bigint,
  vault: Address,
  refund: Address,
): ProtocolCall {
  const registrar = requireSpokeAddress(spoke, "shareTokenRegistrar", builder);
  return hubCall(
    ctx,
    "managerCall",
    [
      BigInt(ctx.poolId),
      spokeCentrifugeId,
      addressToBytes32(registrar),
      encodeShareTokenRegistrarPayload({
        kind: "setVault",
        scId,
        assetId: assetId.toString(),
        vault,
      }),
      NO_EXTRA_GAS_LIMIT,
      0n,
      refund,
    ],
    `Hub.managerCall (ShareTokenRegistrar.SetVault ${vault})`,
  );
}

/** One `Hub.updateVault` call for a link or unlink of one projected vault. */
function updateVaultCall(
  ctx: ProtocolContext,
  poolId: bigint,
  ref: VaultRef,
  kind: number,
  refund: Address,
  field: string,
  label: string,
): ProtocolCall {
  return hubCall(
    ctx,
    "updateVault",
    updateVaultArgs(
      ctx,
      poolId,
      requireBytes16(ref.scId, `${field}.scId`),
      parseUint128(ref.assetId, `${field}.assetId`),
      addressToBytes32(
        requireAddress(ref.vaultAddress, `${field}.vaultAddress`),
      ),
      kind,
      refund,
    ),
    label,
  );
}

/** v3.3 inserts a `payload` argument between `kind` and `extraGasLimit`; empty for every call built here. */
function updateVaultArgs(
  ctx: ProtocolContext,
  poolId: bigint,
  scId: `0x${string}`,
  assetId: bigint,
  vaultOrFactory: `0x${string}`,
  kind: number,
  refund: Address,
  payload: `0x${string}` = "0x",
): readonly unknown[] {
  if (ctx.protocolVersion === PROTOCOL_VERSION_V3_2) {
    return [
      poolId,
      scId,
      assetId,
      vaultOrFactory,
      kind,
      NO_EXTRA_GAS_LIMIT,
      refund,
    ];
  }
  if (ctx.protocolVersion === PROTOCOL_VERSION_V3_3) {
    return [
      poolId,
      scId,
      assetId,
      vaultOrFactory,
      kind,
      payload,
      NO_EXTRA_GAS_LIMIT,
      refund,
    ];
  }
  throw new UnsupportedForProtocolVersionError(
    "updateVault",
    ctx.protocolVersion,
    "no Hub.updateVault shape is known for it",
  );
}

/**
 * The sync manager's max-reserve update: v3.2 sends it as a trusted call
 * through `Hub.updateContract`; v3.3 routes it through `Hub.managerCall`,
 * local or remote, with `localValue = 0`.
 */
function maxReserveCall(
  ctx: ProtocolContext,
  builder: string,
  spokeCentrifugeId: number,
  syncManager: Address,
  scId: `0x${string}`,
  assetId: bigint,
  amount: bigint,
  refund: Address,
): ProtocolCall {
  if (ctx.protocolVersion === PROTOCOL_VERSION_V3_2) {
    return hubCall(
      ctx,
      "updateContract",
      [
        BigInt(ctx.poolId),
        scId,
        spokeCentrifugeId,
        addressToBytes32(syncManager),
        encodeMaxReserveTrustedCall(assetId, amount),
        NO_EXTRA_GAS_LIMIT,
        refund,
      ],
      "Hub.updateContract (sync manager max reserve)",
    );
  }
  if (ctx.protocolVersion === PROTOCOL_VERSION_V3_3) {
    return hubCall(
      ctx,
      "managerCall",
      [
        BigInt(ctx.poolId),
        spokeCentrifugeId,
        addressToBytes32(syncManager),
        encodeSyncManagerPayload({
          kind: "maxReserve",
          scId,
          assetId: assetId.toString(),
          maxReserve: amount.toString(),
        }),
        NO_EXTRA_GAS_LIMIT,
        0n,
        refund,
      ],
      "Hub.managerCall (SyncManager.MaxReserve)",
    );
  }
  throw new UnsupportedForProtocolVersionError(
    builder,
    ctx.protocolVersion,
    "no sync manager max-reserve call is known for it",
  );
}

/** Encode one `Hub` call on the pool's home chain. */
function hubCall(
  ctx: ProtocolContext,
  functionName: string,
  args: readonly unknown[],
  label: string,
): ProtocolCall {
  return {
    to: ctx.addresses.hub,
    data: encodeFunctionData({ abi: ctx.abis.hub, functionName, args }),
    // Zero per INNER call, and that is correct even though the transaction
    // carries a real crosschain fee: the fee is attached to the outer
    // transaction (`multicall` is `payable` and the Hub reads `msg.value` for
    // the whole batch), exactly as the SDK's `wrapTransaction` attaches it.
    // Splitting it across the inner descriptors would double-count it in the
    // decoded preview.
    value: 0n,
    label,
  };
}

/**
 * Wrap the built calls into the `BuiltProtocolCall` envelope: one call is sent
 * verbatim, two or more as `multicall(bytes[])`, `calls` carries the per-call
 * decode labels onto `RawTx.metadata.innerCalls`, and `messages` carries the
 * cross-chain manifest the caller prices.
 */
function batched(
  ctx: ProtocolContext,
  calls: readonly ProtocolCall[],
  messages: Record<number, readonly CrosschainMessage[]>,
): BuiltProtocolCall {
  return {
    to: ctx.addresses.hub,
    data: encodeBatchCalldata(
      ctx.protocolVersion,
      calls.map((call) => call.data),
    ),
    value: 0n,
    calls,
    ...(ctx.protocolVersion === PROTOCOL_VERSION_V3_2 ? { messages } : {}),
  };
}

/**
 * The vault managers' trusted-call payload: three left-padded 32-byte words,
 * `[MaxReserve, assetId, amount]`.
 *
 * Byte-identical to the SDK's `encode([VaultManagerTrustedCall.MaxReserve,
 * assetId, amount])` (`packages/sdk/src/utils/index.ts`), which pads every
 * non-hex value with `toHex(v, { size: 32 })`. Reimplemented rather than
 * imported because this package must not depend on the SDK; a parity unit test
 * pins the bytes.
 */
function encodeMaxReserveTrustedCall(
  assetId: bigint,
  amount: bigint,
): `0x${string}` {
  return concatHex([
    toHex(VAULT_MANAGER_TRUSTED_CALL_MAX_RESERVE, { size: 32 }),
    toHex(assetId, { size: 32 }),
    toHex(amount, { size: 32 }),
  ]);
}

/**
 * A 20-byte address as a `bytes32` argument, lowercased for byte-stable
 * calldata. Matches the SDK's `addressToBytes32`.
 *
 * RIGHT-padded — the address occupies the HIGH 20 bytes and the low 12 are
 * zero. Not a style choice: the protocol decodes these arguments with
 * `CastLib.toAddress`, which is `address(bytes20(addr))` guarded by
 * `require(uint96(uint256(addr)) == 0, PrefixNotZero())`. A left-padded value
 * would revert with `PrefixNotZero` on the spoke — and only there, after the
 * cross-chain message had already been paid for and dispatched. The protocol
 * has a separate left-padded pair (`toBytes32LeftPadded` /
 * `toAddressLeftPadded`) used by other messages, which is exactly why the
 * direction has to be read off the consuming call rather than assumed.
 *
 * Exported (rather than duplicated) because the Hub's manager messages take a
 * `bytes32 who` decoded the same way — see `managers.ts`. One definition of the
 * padding direction, kept in the file that documents why it is what it is; the
 * same reason `requireAddress` / `requireBytes16` are imported from
 * `create-holding.ts` here rather than restated.
 */
export function addressToBytes32(address: Address): `0x${string}` {
  return `0x${address.slice(2).toLowerCase()}${"0".repeat(24)}`;
}

/** A context and an argument must agree on which pool is being operated on. */
export function requireSamePool(
  ctx: { readonly poolId: string },
  poolId: string,
  builder: string,
): void {
  if (poolId !== ctx.poolId) {
    throw new BuilderArgumentMismatchError(
      `${builder} pool id mismatch: context resolved for pool ${ctx.poolId}, ` +
        `args carry pool ${poolId}`,
    );
  }
}

/**
 * The spoke's `centrifugeId` as the `uint16` argument the Hub messages take.
 *
 * Refused rather than truncated: the id selects which network the message is
 * dispatched to, and a wrapped value would send a vault deployment to a
 * different chain than the one the caller named.
 */
export function requireCentrifugeId(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0 || value > 0xffff) {
    throw new BuilderArgumentMismatchError(
      `${field} ${value} is not a uint16 centrifugeId`,
    );
  }
  return value;
}

/**
 * A contract address from the SPOKE's verified address set.
 *
 * `AddressSet` is `Record<string, Address>`, so a name absent from this
 * version's deployment reads as `undefined` — which `encodeFunctionData` would
 * happily encode as a malformed argument. Refused by name instead, so a chain
 * whose registry entry lacks a factory fails with the field named.
 */
function requireSpokeAddress(
  spoke: ProtocolContext,
  contract: string,
  builder: string,
): Address {
  const address = spoke.addresses[contract];
  if (address === undefined) {
    throw new BuilderArgumentMismatchError(
      `${builder}: no "${contract}" address is registered for centrifugeId ` +
        `${spoke.centrifugeId} on protocol version ${spoke.protocolVersion}`,
    );
  }
  return requireAddress(address, `${builder}.spoke.${contract}`);
}

/** Arguments for {@link updateVault}. */
export interface UpdateVaultArgs {
  /** Raw pool id (uint64 decimal string). Must match `ctx.poolId`. */
  readonly poolId: string;
  readonly scId: string;
  readonly assetId: string;
  /** The vault (link, unlink) or the factory (deployAndLink). */
  readonly vaultOrFactory: string;
  readonly kind: keyof typeof VAULT_UPDATE_KIND;
  readonly refundAddress: string;
  /** v3.3 only: opaque data forwarded to the factory on `deployAndLink`. Refused on v3.2. */
  readonly payload?: `0x${string}`;
  /** v3.3 only: the spoke's context, for the registrar that holds the share token's vault pointer. */
  readonly spoke?: ProtocolContext;
  /** v3.3 `deployAndLink` only: the address the factory deploys to (`factory.getVault`). */
  readonly vaultAddress?: string;
}

/** One `Hub.updateVault` as its own call, shaped per version. */
export function updateVault(
  ctx: ProtocolContext,
  args: UpdateVaultArgs,
): BuiltProtocolCall {
  requireSamePool(ctx, args.poolId, "updateVault");
  if (
    args.payload !== undefined &&
    ctx.protocolVersion !== PROTOCOL_VERSION_V3_3
  ) {
    throw new BuilderArgumentMismatchError(
      `updateVault.payload was supplied but protocol ${ctx.protocolVersion}'s ` +
        "updateVault has no payload argument to carry it.",
    );
  }
  const poolId = BigInt(args.poolId);
  const scId = requireBytes16(args.scId, "updateVault.scId");
  const assetId = parseUint128(args.assetId, "updateVault.assetId");
  const vaultOrFactory = requireAddress(
    args.vaultOrFactory,
    "updateVault.vaultOrFactory",
  );
  const refund = requireAddress(
    args.refundAddress,
    "updateVault.refundAddress",
  );
  const calls: ProtocolCall[] = [
    hubCall(
      ctx,
      "updateVault",
      updateVaultArgs(
        ctx,
        poolId,
        scId,
        assetId,
        addressToBytes32(vaultOrFactory),
        VAULT_UPDATE_KIND[args.kind],
        refund,
        args.payload ?? "0x",
      ),
      `Hub.updateVault (${args.kind})`,
    ),
  ];
  if (ctx.protocolVersion === PROTOCOL_VERSION_V3_3) {
    if (args.spoke === undefined) {
      throw new BuilderArgumentMismatchError(
        "updateVault.spoke is required on protocol v3.3: the share token's " +
          "vault pointer lives on the spoke's registrar.",
      );
    }
    let vault: Address;
    if (args.kind === "deployAndLink") {
      if (args.vaultAddress === undefined) {
        throw new BuilderArgumentMismatchError(
          "updateVault.vaultAddress is required on protocol v3.3 for a " +
            "deployAndLink: the share token's vault pointer is set from the " +
            "address the factory deploys to.",
        );
      }
      vault = requireAddress(args.vaultAddress, "updateVault.vaultAddress");
    } else {
      vault = args.kind === "link" ? vaultOrFactory : ZERO_ADDRESS;
    }
    const spokeCentrifugeId = requireCentrifugeId(
      args.spoke.centrifugeId,
      "updateVault.spoke.centrifugeId",
    );
    requireSpokeForAsset(spokeCentrifugeId, assetId, "updateVault.assetId");
    calls.push(
      setVaultCall(
        ctx,
        "updateVault",
        args.spoke,
        spokeCentrifugeId,
        scId,
        assetId,
        vault,
        refund,
      ),
    );
  }
  return batched(ctx, calls, {
    [requireCentrifugeId(ctx.centrifugeId, "updateVault.centrifugeId")]: [
      {
        type: MessageType.UpdateVault,
        poolId: args.poolId,
        subtype: VAULT_UPDATE_KIND[args.kind],
      },
    ],
  });
}

/** Arguments for {@link notifyShareClass}. */
export interface NotifyShareClassArgs {
  /** Raw pool id (uint64 decimal string). Must match `ctx.poolId`. */
  readonly poolId: string;
  readonly scId: string;
  /** Centrifuge id of the network the share class is notified to, decimal string. */
  readonly centrifugeId: string;
  /** v3.2: the restriction hook. v3.3: the `ShareTokenRegistrar` that deploys and operates the token. */
  readonly registrarAddress: string;
  readonly refundAddress: string;
  /** v3.3 only: opaque data forwarded to the registrar's `newToken`. Refused on v3.2. */
  readonly payload?: `0x${string}`;
}

/** `Hub.notifyShareClass`, shaped per version. */
export function notifyShareClass(
  ctx: ProtocolContext,
  args: NotifyShareClassArgs,
): BuiltProtocolCall {
  requireSamePool(ctx, args.poolId, "notifyShareClass");
  const poolId = BigInt(args.poolId);
  const scId = requireBytes16(args.scId, "notifyShareClass.scId");
  const centrifugeId = requireCentrifugeId(
    parseCentrifugeId(args.centrifugeId, "notifyShareClass.centrifugeId"),
    "notifyShareClass.centrifugeId",
  );
  const registrar = addressToBytes32(
    requireAddress(args.registrarAddress, "notifyShareClass.registrarAddress"),
  );
  const refund = requireAddress(
    args.refundAddress,
    "notifyShareClass.refundAddress",
  );
  let callArgs: readonly unknown[];
  if (ctx.protocolVersion === PROTOCOL_VERSION_V3_2) {
    if (args.payload !== undefined) {
      throw new BuilderArgumentMismatchError(
        "notifyShareClass.payload was supplied but protocol v3.2's " +
          "notifyShareClass has no payload argument to carry it.",
      );
    }
    callArgs = [poolId, scId, centrifugeId, registrar, refund];
  } else if (ctx.protocolVersion === PROTOCOL_VERSION_V3_3) {
    callArgs = [
      poolId,
      scId,
      centrifugeId,
      registrar,
      args.payload ?? "0x",
      NO_EXTRA_GAS_LIMIT,
      refund,
    ];
  } else {
    throw new UnsupportedForProtocolVersionError(
      "notifyShareClass",
      ctx.protocolVersion,
      "no Hub.notifyShareClass shape is known for it",
    );
  }
  const call = hubCall(
    ctx,
    "notifyShareClass",
    callArgs,
    "Hub.notifyShareClass",
  );
  return batched(ctx, [call], {
    [centrifugeId]: [
      { type: MessageType.NotifyShareClass, poolId: args.poolId },
    ],
  });
}
