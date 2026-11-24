import { encodeAbiParameters, keccak256 } from 'viem'
import type { BridgeLimitReason } from '../errors.js'
import type { HexString } from '../types/index.js'
import type { CentrifugeId } from './types.js'

/**
 * The bridge limit the pool's hub applies to transfers leaving one origin
 * chain, read on the hub chain. Amounts are in the share token's smallest unit.
 * - `none`: the pool has no bridging hook; nothing limits a transfer.
 * - `unknown`: the hook is not the `BridgeCircuitBreaker` the address book
 *   names, so its rules cannot be read.
 * - `circuitBreaker`: the protocol's breaker, which every v3.3 pool gets on
 *   activation.
 */
export type BridgeLimit =
  | { kind: 'none'; originCentrifugeId: CentrifugeId }
  | { kind: 'unknown'; originCentrifugeId: CentrifugeId; hook: HexString }
  | {
      kind: 'circuitBreaker'
      originCentrifugeId: CentrifugeId
      hook: HexString
      /** Whether bridging of the share class is paused, from every origin. */
      paused: boolean
      /**
       * The most a window may carry from the origin chain, and the most one
       * transfer may carry. 0 means no limit is set: only a transfer a hub
       * manager authorized one by one passes.
       */
      rateMax: bigint
      /** The window's length in seconds. */
      rateWindow: number
      /** What transfers from the origin chain have used of the current window. */
      used: bigint
      /** When the current window opened; null when none is open, so the next transfer opens one. */
      windowStart: Date | null
      /** What a transfer from the origin chain may still carry in the current window. */
      remaining: bigint
      /** The hub's latest block time when the values were read; the window is judged against it. */
      readAt: Date
    }

/**
 * The breaker's state for one origin chain, as `CircuitBreakerGuard.tally`
 * keeps it: a window that opened more than `rateWindow` seconds before `now`
 * has closed, and the next transfer opens a new one at its full `rateMax`.
 */
export function circuitBreakerLimit(args: {
  originCentrifugeId: CentrifugeId
  hook: HexString
  paused: boolean
  rateMax: bigint
  rateWindow: number
  total: bigint
  windowStart: bigint
  now: bigint
}): BridgeLimit {
  const { originCentrifugeId, hook, paused, rateMax, rateWindow, total, windowStart, now } = args
  const open = now - windowStart <= BigInt(rateWindow)
  const used = open ? total : 0n
  return {
    kind: 'circuitBreaker',
    originCentrifugeId,
    hook,
    paused,
    rateMax,
    rateWindow,
    used,
    windowStart: open ? new Date(Number(windowStart) * 1000) : null,
    remaining: rateMax > used ? rateMax - used : 0n,
    readAt: new Date(Number(now) * 1000),
  }
}

/**
 * Why the breaker would refuse a transfer of `amount`, in the order
 * `BridgeCircuitBreaker.onBridgeShares` checks: paused first, then an
 * authorization for this exact transfer passes every limit, then the
 * per-transfer `rateMax`, then the window. Null when it would pass.
 */
export function bridgeLimitRefusal(limit: BridgeLimit, amount: bigint, authorized: boolean): BridgeLimitReason | null {
  // No hook applies no limit; a hook other than the breaker cannot be judged.
  if (limit.kind !== 'circuitBreaker') return null
  if (limit.paused) return 'paused'
  if (authorized) return null
  if (amount > limit.rateMax) return limit.rateMax === 0n ? 'limitUnset' : 'exceedsRateMax'
  if (amount > limit.remaining) return 'exceedsWindow'
  return null
}

/** `keccak256(abi.encode(poolId, scId, originCentrifugeId))`: the breaker's key in `CircuitBreakerGuard.cumulative`. */
export function circuitBreakerKey(poolId: bigint, scId: HexString, originCentrifugeId: CentrifugeId): HexString {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'uint64' }, { type: 'bytes16' }, { type: 'uint16' }],
      [poolId, scId, originCentrifugeId]
    )
  )
}

/**
 * The key `BridgeCircuitBreaker.authorizations` counts an authorized transfer
 * under: `keccak256(abi.encode(poolId, scId, origin, target, sender, receiver, amount))`,
 * with `sender` and `receiver` as the Spoke sends them, left-aligned `bytes32`.
 */
export function bridgeAuthorizationKey(args: {
  poolId: bigint
  scId: HexString
  originCentrifugeId: CentrifugeId
  targetCentrifugeId: CentrifugeId
  sender: HexString
  receiver: HexString
  amount: bigint
}): HexString {
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'uint64' },
        { type: 'bytes16' },
        { type: 'uint16' },
        { type: 'uint16' },
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'uint128' },
      ],
      [
        args.poolId,
        args.scId,
        args.originCentrifugeId,
        args.targetCentrifugeId,
        args.sender,
        args.receiver,
        args.amount,
      ]
    )
  )
}
