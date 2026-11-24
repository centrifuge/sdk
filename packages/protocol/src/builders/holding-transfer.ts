import { encodeFunctionData } from "viem";
import { getInstanceAbi } from "../abis";
import {
  BuilderArgumentMismatchError,
  UnsupportedForProtocolVersionError,
} from "../errors";
import {
  PROTOCOL_VERSION_V3_2,
  PROTOCOL_VERSION_V3_3,
  type BuiltProtocolCall,
  type ProtocolContext,
} from "../types";
import { requireAddress, requireBytes16 } from "./create-holding";
import { parseAmount, parseUint256 } from "./money";

/**
 * Where the assets of a holding deposit come from, or where a withdrawal goes.
 *
 * - `"wallet"`: the signer's own balance, moved through `BalanceSheet`
 *   (`balanceSheet.deposit` / `balanceSheet.withdraw` in the SDK). The signer
 *   must be a balance-sheet manager of the pool on this network.
 * - `"manager"`: an on/off-ramp manager contract deployed for this share class
 *   holds or receives the assets (`manager.deposit` / `manager.withdraw`).
 *
 * One discriminator rather than two actions per direction: the operation is the
 * same domain operation — assets enter or leave a holding — and the contract it
 * routes to is an implementation detail of where the assets sit. Keeping it a
 * single action means one policy rule, one decoder label set and one audit
 * shape per direction, and the four client-side branches of issue #38 collapse
 * to two.
 */
export type HoldingTransferSource = "wallet" | "manager";

/** The asset a holding transfer moves, resolved from its on-chain id. */
export interface HoldingTransferAsset {
  /** Asset id (uint128 decimal string) — what the caller named. */
  readonly assetId: string;
  /** ERC-20 / ERC-6909 contract address of the asset on this network. */
  readonly address: string;
  /**
   * ERC-6909 token id as a `uint256` decimal string, or `null` for a plain
   * ERC-20.
   *
   * `null` encodes as `0`, which is what the contracts read as "not an
   * ERC-6909 token" and is byte-for-byte what the SDK does
   * (`BigInt(asset.assetTokenId ?? 0n)`). Spelled out rather than defaulted
   * upstream so the mapping lives in exactly one place, next to the calldata
   * it produces.
   */
  readonly assetTokenId: string | null;
}

interface HoldingTransferBase {
  /** Raw pool id (uint64 decimal string). Must match `ctx.poolId`. */
  readonly poolId: string;
  /** Share-class id (bytes16 hex). */
  readonly scId: string;
  /** The asset being moved. */
  readonly asset: HoldingTransferAsset;
  /** Amount in the asset's smallest unit, as a decimal string. Never zero. */
  readonly amount: string;
  readonly source: HoldingTransferSource;
  /**
   * The on/off-ramp manager contract, required iff `source` is `"manager"`.
   * Resolved from the `chain_v1` projection by the caller, never taken from a
   * client: it is the contract the transaction is sent to.
   */
  readonly managerAddress?: string;
}

/** Arguments for {@link depositHolding}. */
export interface DepositHoldingArgs extends HoldingTransferBase {
  /**
   * Where the manager-sourced deposit credits to. Required iff `source` is
   * `"manager"`; the wallet-sourced path has no receiver argument (the pool
   * escrow is derived on chain from the pool and share class).
   */
  readonly receiverAddress?: string;
}

/** Arguments for {@link withdrawHolding}. */
export interface WithdrawHoldingArgs extends HoldingTransferBase {
  /** Where the withdrawn assets are sent. Required on both paths. */
  readonly receiverAddress: string;
}

/**
 * `BalanceSheet.deposit(...)` or `OnOffRampManager.deposit(...)` — pure
 * builder, no I/O.
 *
 * SPOKE-side: both contracts live on the network the assets are held on, so the
 * context must have been resolved with that network's `centrifugeId` (see
 * `resolveProtocolContext`). Resolving against the pool's hub chain instead
 * would encode a Hub-chain `BalanceSheet` address and send the transaction to
 * the wrong network.
 */
export function depositHolding(
  ctx: ProtocolContext,
  args: DepositHoldingArgs,
): BuiltProtocolCall {
  const common = prepare(ctx, args, "depositHolding");

  if (args.source === "manager") {
    const to = requireManager(args.managerAddress, "depositHolding");
    const receiver = requireAddress(
      requirePresent(
        args.receiverAddress,
        "depositHolding.receiverAddress",
        'source "manager"',
      ),
      "depositHolding.receiverAddress",
    );
    const data = encodeFunctionData({
      abi: getInstanceAbi(ctx.protocolVersion, "onOffRampManager"),
      functionName: "deposit",
      args: [common.assetAddress, common.assetTokenId, common.amount, receiver],
    });

    return single(to, data, "OnOffRampManager.deposit");
  }

  const { to, abi, contract } = holdingTarget(ctx, "depositHolding");
  const data = encodeFunctionData({
    abi,
    functionName: "deposit",
    args: [
      common.poolId,
      common.scId,
      common.assetAddress,
      common.assetTokenId,
      common.amount,
    ],
  });

  // NOTE: the ERC-20 approval the SDK's wallet path may prepend is deliberately
  // NOT built here. An approval is the signer's own allowance to a contract, it
  // is not a pool action, and batching it would put a token-contract call the
  // policy engine has no rule for inside a pool transaction. The caller
  // approves first, as it does today.
  return single(to, data, `${contract}.deposit`);
}

/**
 * `BalanceSheet.withdraw(...)` or `OnOffRampManager.withdraw(...)` — pure
 * builder, no I/O. Spoke-side, same as {@link depositHolding}.
 */
export function withdrawHolding(
  ctx: ProtocolContext,
  args: WithdrawHoldingArgs,
): BuiltProtocolCall {
  const common = prepare(ctx, args, "withdrawHolding");
  const receiver = requireAddress(
    args.receiverAddress,
    "withdrawHolding.receiverAddress",
  );

  if (args.source === "manager") {
    const to = requireManager(args.managerAddress, "withdrawHolding");
    const data = encodeFunctionData({
      abi: getInstanceAbi(ctx.protocolVersion, "onOffRampManager"),
      functionName: "withdraw",
      args: [common.assetAddress, common.assetTokenId, common.amount, receiver],
    });

    return single(to, data, "OnOffRampManager.withdraw");
  }

  const { to, abi, contract } = holdingTarget(ctx, "withdrawHolding");
  const data = encodeFunctionData({
    abi,
    functionName: "withdraw",
    args: [
      common.poolId,
      common.scId,
      common.assetAddress,
      common.assetTokenId,
      receiver,
      common.amount,
    ],
  });

  return single(to, data, `${contract}.withdraw`);
}

/** v3.2 moves wallet-sourced assets through `BalanceSheet`; v3.3 folded it into `Spoke` with the same signatures. */
function holdingTarget(ctx: ProtocolContext, builder: string) {
  if (ctx.protocolVersion === PROTOCOL_VERSION_V3_2) {
    return {
      to: ctx.addresses.balanceSheet,
      abi: ctx.abis.balanceSheet,
      contract: "BalanceSheet",
    } as const;
  }
  if (ctx.protocolVersion === PROTOCOL_VERSION_V3_3) {
    return {
      to: ctx.addresses.spoke,
      abi: ctx.abis.spoke,
      contract: "Spoke",
    } as const;
  }
  throw new UnsupportedForProtocolVersionError(
    builder,
    ctx.protocolVersion,
    "no balance-sheet contract is known for it",
  );
}

/** Validate and parse everything both directions and both sources share. */
function prepare(
  ctx: ProtocolContext,
  args: HoldingTransferBase,
  builder: string,
) {
  if (args.poolId !== ctx.poolId) {
    throw new BuilderArgumentMismatchError(
      `${builder} pool id mismatch: context resolved for pool ${ctx.poolId}, ` +
        `args carry pool ${args.poolId}`,
    );
  }

  return {
    poolId: BigInt(args.poolId),
    scId: requireBytes16(args.scId, `${builder}.scId`),
    assetAddress: requireAddress(
      args.asset.address,
      `${builder}.asset.address`,
    ),
    // null (a plain ERC-20) encodes as 0 — see HoldingTransferAsset.
    assetTokenId:
      args.asset.assetTokenId === null
        ? 0n
        : parseUint256(
            args.asset.assetTokenId,
            `${builder}.asset.assetTokenId`,
          ),
    amount: parseAmount(args.amount, `${builder}.amount`),
  };
}

function requireManager(
  managerAddress: string | undefined,
  builder: string,
): `0x${string}` {
  return requireAddress(
    requirePresent(
      managerAddress,
      `${builder}.managerAddress`,
      'source "manager"',
    ),
    `${builder}.managerAddress`,
  );
}

/**
 * A conditionally-required argument. Refused rather than substituted: the two
 * fields this guards are a contract address and a value recipient, and the
 * zero address is a burn, not a default.
 */
function requirePresent(
  value: string | undefined,
  field: string,
  requiredBy: string,
): string {
  if (value === undefined) {
    throw new BuilderArgumentMismatchError(
      `${field} is required when ${requiredBy} is used`,
    );
  }
  return value;
}

/**
 * A single non-payable call, labelled for the decoder.
 *
 * No message manifest: `BalanceSheet.deposit/withdraw` and the
 * on/off-ramp manager's equivalents are SPOKE-side calls, and the SDK's
 * `BalanceSheet` and `OnOffRampManager` transfer methods declare no `messages`
 * either. The transfer only queues its delta on the spoke; the hub's holding
 * amount moves when the queue is submitted, a separate paid call (the SDK's
 * `BalanceSheet.submitQueued`, or `QueueManager.sync` once it is granted), so
 * attaching a fee here would charge the caller for a message this transaction
 * does not send.
 */
function single(
  to: `0x${string}`,
  data: `0x${string}`,
  label: string,
): BuiltProtocolCall {
  const value = 0n;
  return { to, data, value, calls: [{ to, data, value, label }] };
}
