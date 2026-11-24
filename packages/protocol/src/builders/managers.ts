import { encodeAbiParameters, encodeFunctionData, type Address } from "viem";

import { BuilderArgumentMismatchError } from "../errors";
import { MessageType, type CrosschainMessage } from "../messages";
import {
  PROTOCOL_VERSION_V3_3,
  type BuiltProtocolCall,
  type ProtocolCall,
  type ProtocolContext,
} from "../types";
import {
  encodeAccountingTokenMinterPayload,
  hubManagerCall,
} from "./manager-call";
import { updateManager } from "./update-manager";
import { encodeBatchCalldata } from "./batch";
import { requireAddress, requireBytes16 } from "./create-holding";
import { addressToBytes32, requireCentrifugeId } from "./vaults";

/** One address's HUB manager grant or revocation. */
export interface PoolManagerRef {
  /** The address whose hub authority changes. */
  readonly address: string;
  /** Target state: `true` grants, `false` revokes. */
  readonly canManage: boolean;
}

/** One address's BALANCE-SHEET manager grant or revocation on one network. */
export interface BalanceSheetManagerRef {
  /**
   * Centrifuge id of the network whose balance sheet the authority applies to,
   * as a decimal string. Per-entry, not per-call: an address may be a manager
   * on one network and not another.
   */
  readonly centrifugeId: string;
  /** The address whose balance-sheet authority changes. */
  readonly address: string;
  /** Target state: `true` grants, `false` revokes. */
  readonly canManage: boolean;
}

/** Arguments for {@link updatePoolManagers}. */
export interface UpdatePoolManagersArgs {
  /** Raw pool id (uint64 decimal string). Must match `ctx.poolId`. */
  readonly poolId: string;
  /** The edits, at least one; each address at most once. */
  readonly updates: readonly PoolManagerRef[];
}

/** Arguments for {@link updateBalanceSheetManagers}. */
export interface UpdateBalanceSheetManagersArgs {
  /** Raw pool id (uint64 decimal string). Must match `ctx.poolId`. */
  readonly poolId: string;
  /**
   * Where unspent cross-chain gas payment is returned.
   *
   * Required, with no default, for the same reason
   * `DeployVaultArgs.refundAddress` is: the SDK passes its signing address, and
   * the backend cannot — the signer is unknown at PREVIEW time and the calldata
   * must be byte-identical at preview, at prepare and again during Fordefi's
   * dual-channel re-derivation.
   */
  readonly refundAddress: string;
  /** The edits, at least one; each `(centrifugeId, address)` pair at most once. */
  readonly updates: readonly BalanceSheetManagerRef[];
}

/**
 * Grant or revoke HUB manager authority — pure builder, no I/O.
 *
 * v3.2 encodes one `Hub.updateHubManager(poolId, who, canManage)` per entry,
 * batched. Hub-local: no `centrifugeId` argument, no cross-chain message, and
 * therefore no refund address and no gas estimate to attach — unlike
 * {@link updateBalanceSheetManagers}. Byte-comparable to the SDK's
 * `Pool.updatePoolManagers`.
 *
 * ## msg.value is zero, and CORRECTLY zero
 *
 * `Hub.updateHubManager` is `payable` in the ABI but dispatches no cross-chain
 * message, so this builder declares an EMPTY message manifest and the caller
 * attaches nothing. The distinction is pinned by a test: an empty manifest
 * here means "there is nothing to pay for", while an absent manifest on a
 * message-dispatching builder would mean "we forgot", and the two must not be
 * confusable.
 *
 * ## Call order: grants before revokes, and that is load-bearing
 *
 * All `canManage: true` entries are emitted before all `canManage: false` ones,
 * each group preserving the caller's array order (a STABLE partition).
 *
 * The SDK solves the same problem differently: it moves the SIGNER's own entry
 * to the end of the batch, so a manager who revokes themselves while adding
 * others does not lose authority mid-batch and make the remaining calls revert.
 * That heuristic cannot be reproduced here, and not for want of trying — the
 * signer is not known at preview time (on the Fordefi route it is the pool's
 * custodial vault, on the WalletConnect route the user's wallet, and `prepare`
 * deliberately ignores the advisory `callerAddress`), and a batch order that
 * depended on the signer would make the calldata differ between preview,
 * prepare and verification, failing dual-channel verification on every
 * transaction.
 *
 * Grants-before-revokes is signer-independent, deterministic, and strictly
 * stronger for the failure mode the SDK's rule targets: EVERY grant lands
 * before ANY revocation, so no reordering of the caller's intent can strand a
 * self-revocation ahead of the additions it was meant to follow.
 *
 * The reordering is deliberately NOT applied to
 * {@link updateBalanceSheetManagers}: revoking one's own balance-sheet
 * authority does not remove the hub authority the transaction is executed
 * under, so the self-lockout the ordering exists to prevent cannot happen
 * there, and inventing an order the SDK does not use would make the two
 * builders' calldata diverge for no benefit.
 *
 * ## What this builder does NOT do
 *
 * It does not check that the resulting manager set is non-empty. That check
 * needs the pool's CURRENT manager set, which is I/O, and this package is pure.
 * The caller performs it against the `chain_v1` projection before calling —
 * see `private-api`'s `PoolManagerWriteResolver` and its `LastPoolManagerError`
 * (422 `LAST_POOL_MANAGER`). A builder that silently skipped the check would be
 * the more dangerous arrangement, because leaving a pool with zero hub managers
 * is not recoverable from the pool itself.
 */
export function updatePoolManagers(
  ctx: ProtocolContext,
  args: UpdatePoolManagersArgs,
): BuiltProtocolCall {
  requireSamePool(ctx, args.poolId, "updatePoolManagers");
  const poolId = BigInt(args.poolId);

  requireNonEmpty(args.updates, "updatePoolManagers.updates");
  const validated: { address: Address; canManage: boolean }[] =
    args.updates.map((ref, index) => ({
      address: requireAddress(
        ref.address,
        `updatePoolManagers.updates[${index}].address`,
      ),
      canManage: ref.canManage,
    }));
  requireNoDuplicates(
    validated.map(({ address }) => address.toLowerCase()),
    "updatePoolManagers.updates",
    "address",
  );

  // Stable partition: grants first, revokes second, caller order within each.
  const ordered = [
    ...validated.filter(({ canManage }) => canManage),
    ...validated.filter(({ canManage }) => !canManage),
  ];

  const calls: ProtocolCall[] = ordered.map(({ address, canManage }) =>
    hubCall(
      ctx,
      "updateHubManager",
      [poolId, address, canManage],
      `Hub.updateHubManager (${canManage ? "grant" : "revoke"} ${address})`,
    ),
  );

  // Empty, not absent: this action dispatches no cross-chain message at all.
  return batched(ctx, calls, {});
}

/**
 * Grant or revoke BALANCE-SHEET manager authority per network — pure builder,
 * no I/O.
 *
 * v3.2 encodes one
 * `Hub.updateBalanceSheetManager(poolId, centrifugeId, who, canManage, refund)`
 * per entry, batched. Hub-side transaction, spoke-side effect: the call is sent
 * to the `Hub` on the pool's home chain (`ctx`) and dispatches one cross-chain
 * message per named network, which is why `centrifugeId` travels as an argument
 * rather than selecting the context.
 *
 * `who` is a `bytes32` and is RIGHT-padded — the address in the high 20 bytes,
 * the low 12 zero — because the spoke decodes it with `CastLib.toAddress`,
 * which reverts `PrefixNotZero` on a left-padded value, and only there, after
 * the cross-chain message has been paid for and dispatched. See
 * {@link addressToBytes32}; the direction is pinned by a parity test against
 * the SDK's own `addressToBytes32`.
 *
 * Caller array order is preserved exactly — see the ordering note on
 * {@link updatePoolManagers} for why this one is not repartitioned.
 *
 * ## msg.value
 *
 * Every entry dispatches one `UpdateBalanceSheetManager` message to ITS OWN
 * network, so the manifest is keyed per entry rather than per transaction — a
 * batch touching three networks is priced as three separate route estimates,
 * which is what `MultiAdapter.estimate` charges. `private-api` prices it and
 * attaches the total to the outer transaction; this builder stays pure.
 *
 * `updatePoolManagers` is NOT affected — see its own note on why zero is
 * correct there rather than a placeholder.
 */
export function updateBalanceSheetManagers(
  ctx: ProtocolContext,
  args: UpdateBalanceSheetManagersArgs,
): BuiltProtocolCall {
  requireSamePool(ctx, args.poolId, "updateBalanceSheetManagers");
  const poolId = BigInt(args.poolId);
  const refund = requireAddress(
    args.refundAddress,
    "updateBalanceSheetManagers.refundAddress",
  );

  requireNonEmpty(args.updates, "updateBalanceSheetManagers.updates");

  // Validate and PARSE every entry before deduplicating, so the duplicate rule
  // compares the pair as the chain understands it rather than as the caller
  // spelled it. Keying on the raw strings would let `"2"` and `"02"` — the same
  // network numerically, two different strings — carry two contradicting edits
  // for one network past the very check that exists to refuse that.
  const validated = args.updates.map((ref, index) => {
    const field = `updateBalanceSheetManagers.updates[${index}]`;
    return {
      address: requireAddress(ref.address, `${field}.address`),
      centrifugeId: requireCentrifugeId(
        // The wire form is a decimal string (it is a chain-table column
        // everywhere else). `parseCentrifugeId` refuses anything that is not a
        // CANONICAL non-negative integer literal, so "1e3", " 1", "0x1" and
        // "02" cannot slip through as 1000 / 1 / 1 / 2; the uint16 range is
        // then checked, not truncated, by `requireCentrifugeId`.
        parseCentrifugeId(ref.centrifugeId, `${field}.centrifugeId`),
        `${field}.centrifugeId`,
      ),
      canManage: ref.canManage,
    };
  });

  requireNoDuplicates(
    validated.map((ref) => `${ref.centrifugeId}|${ref.address.toLowerCase()}`),
    "updateBalanceSheetManagers.updates",
    "(centrifugeId, address) pair",
  );

  if (ctx.protocolVersion === PROTOCOL_VERSION_V3_3) {
    const calls: ProtocolCall[] = validated.flatMap(
      ({ address, centrifugeId, canManage }) =>
        updateManager(ctx, {
          poolId: args.poolId,
          centrifugeId: String(centrifugeId),
          kind: "spoke",
          address,
          canManage,
          refundAddress: args.refundAddress,
        }).calls ?? [],
    );
    return batched(ctx, calls, undefined);
  }

  const messages: Record<number, CrosschainMessage[]> = {};
  for (const { centrifugeId } of validated) {
    const forNetwork = (messages[centrifugeId] ??= []);
    forNetwork.push({
      type: MessageType.UpdateBalanceSheetManager,
      poolId: args.poolId,
    });
  }

  const calls: ProtocolCall[] = validated.map(
    ({ address, centrifugeId, canManage }) =>
      hubCall(
        ctx,
        "updateBalanceSheetManager",
        [poolId, centrifugeId, addressToBytes32(address), canManage, refund],
        `Hub.updateBalanceSheetManager (${
          canManage ? "grant" : "revoke"
        } ${address} on network ${centrifugeId})`,
      ),
  );

  return batched(ctx, calls, messages);
}

/** Arguments for {@link registerOnOffRamp}. */
export interface RegisterOnOffRampArgs {
  /** Raw pool id (uint64 decimal string). Must match `ctx.poolId`. */
  readonly poolId: string;
  /** Share class (bytes16 hex) whose accounting token the ramp may mint. */
  readonly scId: string;
  /** Network the ramp lives on, as a decimal string. Must match `spokeCtx`. */
  readonly centrifugeId: string;
  /** The ramp manager contract being registered. */
  readonly address: string;
  /** Where unspent cross-chain gas payment is returned; see {@link UpdateBalanceSheetManagersArgs.refundAddress}. */
  readonly refundAddress: string;
}

/**
 * Register an on/off-ramp manager on one network — pure builder, no I/O.
 *
 * Same `Hub.updateBalanceSheetManager` grant as a one-entry
 * {@link updateBalanceSheetManagers}; where the spoke lists `onOffRampFactory`,
 * a minter grant on its `accountingToken` follows in the same batch. Refused
 * before anything is built when that token is not listed.
 */
export function registerOnOffRamp(
  ctx: ProtocolContext,
  args: RegisterOnOffRampArgs,
  spokeCtx: ProtocolContext,
): BuiltProtocolCall {
  requireSamePool(ctx, args.poolId, "registerOnOffRamp");
  requireSamePool(spokeCtx, args.poolId, "registerOnOffRamp.spoke");
  const scId = requireBytes16(args.scId, "registerOnOffRamp.scId");
  const centrifugeId = parseCentrifugeId(
    args.centrifugeId,
    "registerOnOffRamp.centrifugeId",
  );
  if (spokeCtx.centrifugeId !== centrifugeId) {
    throw new BuilderArgumentMismatchError(
      `registerOnOffRamp centrifugeId mismatch: args name network ` +
        `${centrifugeId}, spoke context resolved for ${spokeCtx.centrifugeId}`,
    );
  }

  const register = updateBalanceSheetManagers(ctx, {
    poolId: args.poolId,
    refundAddress: args.refundAddress,
    updates: [
      {
        centrifugeId: args.centrifugeId,
        address: args.address,
        canManage: true,
      },
    ],
  });

  if (spokeCtx.addresses.onOffRampFactory === undefined) {
    return register;
  }

  const accountingToken = spokeCtx.addresses.accountingToken;
  if (accountingToken === undefined) {
    throw new BuilderArgumentMismatchError(
      `registerOnOffRamp: network ${centrifugeId} lists an onOffRampFactory ` +
        "but no accountingToken, so the ramp could not be granted mint rights",
    );
  }

  const address = requireAddress(args.address, "registerOnOffRamp.address");
  const refund = requireAddress(
    args.refundAddress,
    "registerOnOffRamp.refundAddress",
  );
  if (ctx.protocolVersion === PROTOCOL_VERSION_V3_3) {
    const grant = hubManagerCall(ctx, {
      poolId: args.poolId,
      centrifugeId: args.centrifugeId,
      target: requireAddress(accountingToken, "accountingToken"),
      payload: encodeAccountingTokenMinterPayload({
        minter: address,
        canMint: true,
      }),
      label: `Hub.managerCall (AccountingToken: grant ${address} mint rights)`,
      refundAddress: args.refundAddress,
    });
    return batched(
      ctx,
      [...(register.calls ?? []), ...(grant.calls ?? [])],
      undefined,
    );
  }

  const grantMinter = hubCall(
    ctx,
    "updateContract",
    [
      BigInt(args.poolId),
      scId,
      centrifugeId,
      addressToBytes32(requireAddress(accountingToken, "accountingToken")),
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bool" }],
        [addressToBytes32(address), true],
      ),
      0n,
      refund,
    ],
    `Hub.updateContract (grant ${address} mint rights on accounting token)`,
  );

  return batched(ctx, [...(register.calls ?? []), grantMinter], {
    [centrifugeId]: [
      { type: MessageType.UpdateBalanceSheetManager, poolId: args.poolId },
      { type: MessageType.TrustedContractUpdate, poolId: args.poolId },
    ],
  });
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
    // Zero per INNER call for both builders. For `updateHubManager` that is the
    // final answer (no message is dispatched); for
    // `updateBalanceSheetManager` the crosschain fee is attached to the OUTER
    // transaction from the message manifest, the same place the SDK's
    // `wrapTransaction` attaches it.
    value: 0n,
    label,
  };
}

/**
 * Wrap the built calls into the `BuiltProtocolCall` envelope: one call is sent
 * verbatim, two or more as `multicall(bytes[])`, and `calls` carries the
 * per-call decode labels onto `RawTx.metadata.innerCalls`.
 *
 * `messages` is the cross-chain manifest the caller prices; an empty
 * object means the action dispatches nothing.
 *
 * Same shape as the vault builders' wrapper. Restated rather than shared
 * because it closes over nothing and the two are three lines each; a shared
 * helper would only hide which builders batch.
 */
function batched(
  ctx: ProtocolContext,
  calls: readonly ProtocolCall[],
  messages: Record<number, readonly CrosschainMessage[]> | undefined,
): BuiltProtocolCall {
  return {
    to: ctx.addresses.hub,
    data: encodeBatchCalldata(
      ctx.protocolVersion,
      calls.map((call) => call.data),
    ),
    value: 0n,
    calls,
    ...(messages === undefined ? {} : { messages }),
  };
}

/** A context and an argument must agree on which pool is being operated on. */
function requireSamePool(
  ctx: ProtocolContext,
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
 * An empty edit is refused, not treated as a no-op: it costs a signature, a
 * policy evaluation and — on the Fordefi route — an approval quorum, and
 * changes nothing. Same rule `updateVaults` applies to its three optional parts.
 */
function requireNonEmpty(updates: readonly unknown[], field: string): void {
  if (updates.length === 0) {
    throw new BuilderArgumentMismatchError(
      `${field} is empty: an edit that changes nothing still costs a ` +
        "signature and a policy evaluation.",
    );
  }
}

/**
 * Two edits naming the same target in one transaction is a contradiction whose
 * outcome depends on which one is encoded last, and whichever won would look
 * deliberate in the audit row and in the decoded preview. Refused rather than
 * silently resolved — the same reason `updateVaults` refuses a vault that
 * appears in both `link` and `unlink`.
 *
 * Comparison is case-insensitive on the address half: `0xAb…` and `0xab…` are
 * the same manager on chain, so accepting both would let a caller defeat this
 * check by changing the case.
 */
function requireNoDuplicates(
  keys: readonly string[],
  field: string,
  what: string,
): void {
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) {
      throw new BuilderArgumentMismatchError(
        `${field} names the same ${what} twice (${key}); one transaction ` +
          "cannot set it to two states.",
      );
    }
    seen.add(key);
  }
}

/**
 * A decimal-string centrifugeId as a number, refusing anything that is not a
 * CANONICAL positive integer literal.
 *
 * Two separate hazards, both refused rather than coerced:
 *
 * - `Number("1e3")` is 1000 and `Number(" 1")` is 1; either would send a paid
 *   cross-chain message to a network the caller did not name.
 * - `"02"` parses to the same 2 as `"2"`, so a batch carrying both would name
 *   one network twice while the textual duplicate check saw two distinct keys.
 *   Leading zeros are therefore refused outright — the caller who wrote one
 *   made a typo, and normalising it silently would hide that from the audit
 *   row. `"0"` is refused too: centrifugeIds start at 1.
 *
 * The uint16 range check lives in {@link requireCentrifugeId}; this one is
 * purely about the string form.
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
