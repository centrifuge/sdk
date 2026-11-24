import {
  ABIS_V3_3,
  builders,
  PROTOCOL_VERSION_V3_3,
  UnsupportedForProtocolVersionError,
  type ContractAbis,
  type ProtocolContext,
  type ProtocolVersion,
} from '@centrifuge/protocol'
import type { PublicClient } from 'viem'
import type { SdkProtocolContext } from '../Centrifuge.js'
import type { HexString } from '../types/index.js'
import type { PoolId } from './types.js'

/**
 * Version branching for the SDK's own call sites. Apps never branch on the
 * protocol version; these helpers are where the SDK does it for them, so a
 * site that differs between v3.2 and v3.3 reads the same way everywhere.
 */

/** Why every Merkle proof manager write refuses on v3.3. */
export const MERKLE_PROOF_MANAGER_REMOVED =
  'v3.3 deploys no merkle proof manager factory the apps use; OnchainPM is the policy manager'

/** True when the context resolved to protocol v3.3. */
export function isV3_3(ctx: { protocolVersion: ProtocolVersion }): boolean {
  return ctx.protocolVersion === PROTOCOL_VERSION_V3_3
}

/**
 * Throws the typed refusal for a method v3.3 removed with no replacement. The
 * error is an `UnknownProtocolVersionError` subclass, so callers that already
 * handle an unknown version handle this one too.
 */
export function refuseOnV3_3(ctx: { protocolVersion: ProtocolVersion }, method: string, reason: string): void {
  if (isV3_3(ctx)) {
    throw new UnsupportedForProtocolVersionError(method, ctx.protocolVersion, reason)
  }
}

/** The pure-builder context of a pool-scoped SDK context; builders never take a chain id alone. */
export function builderContext(ctx: SdkProtocolContext): ProtocolContext {
  if (!ctx.context) {
    throw new Error('No protocol context resolved for pool: builders need a pool-scoped target')
  }
  return ctx.context
}

/**
 * The contract that holds a pool's balance sheet on a spoke: `BalanceSheet`
 * on v3.2, `Spoke` on v3.3, which absorbed it with the same signatures for
 * deposit, withdraw, issue, revoke and the balance reads.
 */
export function balanceSheetAddress(ctx: SdkProtocolContext): HexString {
  return isV3_3(ctx) ? ctx.spoke : requireContract(ctx, 'balanceSheet')
}

/**
 * The pool's escrow in one resolved context, lowercased: `escrow(poolId)` on `ctx`'s chain, read
 * from `EscrowFactory` on v3.3 and `PoolEscrowFactory` before. Takes the context rather than
 * resolving one, so a caller that already holds a context never pairs it with an escrow read from
 * another version.
 */
export async function poolEscrowAt(client: PublicClient, ctx: SdkProtocolContext, poolId: PoolId): Promise<HexString> {
  const escrow = isV3_3(ctx)
    ? await client.readContract({
        address: requireContract(ctx, 'escrowFactory'),
        abi: ABIS_V3_3.EscrowFactory,
        functionName: 'escrow',
        args: [poolId.raw],
      })
    : await client.readContract({
        address: requireContract(ctx, 'poolEscrowFactory'),
        abi: ctx.contractAbis.PoolEscrowFactory,
        functionName: 'escrow',
        args: [poolId.raw],
      })
  return escrow.toLowerCase() as HexString
}

/** A registry address the resolved version may not deploy, refused by name when absent. */
export function requireContract<K extends keyof SdkProtocolContext>(
  ctx: SdkProtocolContext,
  name: K
): NonNullable<SdkProtocolContext[K]> {
  const address = ctx[name]
  if (address === undefined || address === null) {
    throw new UnsupportedForProtocolVersionError(
      String(name),
      ctx.protocolVersion,
      `${String(name)} is not deployed on centrifugeId ${ctx.centrifugeId} at protocol ${ctx.protocolVersion}`
    )
  }
  return address as NonNullable<SdkProtocolContext[K]>
}

/**
 * The ABI for the balance-sheet calls {@link balanceSheetAddress} targets.
 * Typed as the v3.2 `BalanceSheet` because the calls the SDK makes there
 * (`deposit`, the six-argument `withdraw`, `issue`, `revoke`,
 * `transferSharesFrom`, `availableBalanceOf`) have the same signatures on the
 * v3.3 `Spoke`; the price overrides do not exist on v3.3 and are refused
 * before anything encodes against this.
 */
export function balanceSheetAbi(ctx: SdkProtocolContext): ContractAbis['BalanceSheet'] {
  return isV3_3(ctx) ? (ABIS_V3_3.Spoke as unknown as ContractAbis['BalanceSheet']) : ctx.contractAbis.BalanceSheet
}

/**
 * Where a spoke's queue of asset and share deltas lives: `BalanceSheet` on v3.2,
 * `SnapshotQueue` on v3.3, which took the queue out of the balance sheet.
 */
export function queueAddress(ctx: SdkProtocolContext): HexString {
  return isV3_3(ctx) ? requireContract(ctx, 'snapshotQueue') : requireContract(ctx, 'balanceSheet')
}

/**
 * The ABI for the `queuedAssets` and `queuedShares` reads {@link queueAddress}
 * targets. Typed as the v3.2 `BalanceSheet` because both reads have the same
 * signatures and outputs on the v3.3 `SnapshotQueue`.
 */
export function queueAbi(ctx: SdkProtocolContext): ContractAbis['BalanceSheet'] {
  return isV3_3(ctx)
    ? (ABIS_V3_3.SnapshotQueue as unknown as ContractAbis['BalanceSheet'])
    : ctx.contractAbis.BalanceSheet
}

/**
 * Where the spoke's registry reads live: `Spoke` on v3.2, `SpokeRegistry` on
 * v3.3, which took over `idToAsset`, `assetToId`, `isPoolActive`,
 * `shareToken`, `requestManager` and `pricePoolPerAsset` with the same
 * signatures. Typed as the v3.2 `Spoke` for those reads only.
 */
export function spokeReadTarget(ctx: SdkProtocolContext): { address: HexString; abi: ContractAbis['Spoke'] } {
  if (isV3_3(ctx)) {
    return {
      address: requireContract(ctx, 'spokeRegistry'),
      abi: ABIS_V3_3.SpokeRegistry as unknown as ContractAbis['Spoke'],
    }
  }
  return { address: ctx.spoke, abi: ctx.contractAbis.Spoke }
}

/**
 * One v3.3 `Hub.managerCall`: the replacement for `Hub.updateContract` and the
 * per-contract hub setters v3.3 removed. `payload` is what the target's
 * `fromHub` decodes; build it with the protocol package's `encode*Payload`
 * helpers. The caller declares the `ManagerCallFromHub` message it sends.
 */
export function encodeHubManagerCall(
  hubCtx: SdkProtocolContext,
  args: { centrifugeId: number; target: HexString; payload: HexString; label: string; refund: HexString }
): HexString {
  const context = builderContext(hubCtx)
  return builders.hubManagerCall(context, {
    poolId: context.poolId,
    centrifugeId: String(args.centrifugeId),
    target: args.target,
    payload: args.payload,
    label: args.label,
    refundAddress: args.refund,
  }).data
}
