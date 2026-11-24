import {
  BaseError,
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  isAddressEqual,
  parseAbi,
  zeroAddress,
  type Abi,
} from 'viem'
import type { HexString } from '../types/index.js'
import type { CentrifugeId, PoolId } from '../utils/types.js'
import { answered, MigrationInputsReadError, type Call, type Result } from './MigrationInputs.js'

/**
 * The pool lane and its cap, as `V33PoolLanes.poolSet` and `MigrationLimits.laneCap` read them, over any
 * batched reader: the pre-check's sites and the planner's live driver share it.
 */

export const LANE_ABI = parseAbi([
  'function activeSessionId(uint16 centrifugeId, uint64 poolId) view returns (uint16)',
  'function quorum(uint16 centrifugeId, uint64 poolId) view returns (uint8)',
  'function adapters(uint16 centrifugeId, uint64 poolId, uint16 session, uint256 index) view returns (address)',
  'function estimate(uint16 centrifugeId, bytes payload, uint256 gasLimit) view returns (uint256)',
])

/** The delivery gas a Chainlink lane must quote to stay in a pool lane. */
export const CHAINLINK_MIN_DELIVERY_GAS = 7_000_000n
/** A limit no adapter caps below: an adapter that quotes it imposes no cap that could bind. */
export const PROBE_CEILING = 30_000_000n
/** A limit small enough that only an unusable lane refuses it. */
export const PROBE_FLOOR = 100_000n
const PROBE_PAYLOAD = `0x${'00'.repeat(256)}` as HexString

export type LaneRead = (calls: readonly Call[]) => Promise<Result[]>

export type LaneAdapters = {
  /** Whether the pool's own session is installed toward the destination. */
  installed: boolean
  /** The pool's installed set, else what `installPoolAdapters` would install from the global one. */
  set: HexString[]
}

export type LaneCapProbe = { adapter: HexString; cap: bigint; quotable: boolean }

const call = (address: HexString, functionName: string, args: readonly unknown[]): Call => ({
  address,
  abi: LANE_ABI as Abi,
  functionName,
  args,
})

/**
 * The adapters carrying `poolId`'s lane toward `toCid` on a v3.3 MultiAdapter: the pool's own active session once
 * installed, else the set `installPoolAdapters` would install from the global one (LayerZero, and a Chainlink
 * adapter only when it quotes 7M of delivery gas).
 * @internal
 */
export async function laneAdapters(
  read: LaneRead,
  multiAdapter: HexString,
  poolId: PoolId,
  toCid: CentrifugeId,
  layerZero: HexString | null,
  chainlink: HexString | null
): Promise<LaneAdapters> {
  const [sessionResult] = await read([call(multiAdapter, 'activeSessionId', [toCid, poolId.raw])])
  const session = Number(answered<number | bigint>(sessionResult!, 'v3.3 MultiAdapter.activeSessionId'))
  if (session !== 0) {
    const [quorumResult] = await read([call(multiAdapter, 'quorum', [toCid, poolId.raw])])
    const quorum = Number(answered<number | bigint>(quorumResult!, 'v3.3 MultiAdapter.quorum'))
    const results = await read(
      Array.from({ length: quorum }, (_, i) => call(multiAdapter, 'adapters', [toCid, poolId.raw, session, BigInt(i)]))
    )
    return { installed: true, set: results.map((result) => answered<HexString>(result, 'v3.3 MultiAdapter.adapters')) }
  }
  const [globalSession, globalQuorum] = await read([
    call(multiAdapter, 'activeSessionId', [toCid, 0n]),
    call(multiAdapter, 'quorum', [toCid, 0n]),
  ])
  const s = Number(answered<number | bigint>(globalSession!, 'v3.3 MultiAdapter.activeSessionId'))
  const n = Number(answered<number | bigint>(globalQuorum!, 'v3.3 MultiAdapter.quorum'))
  const results = await read(
    Array.from({ length: n }, (_, i) => call(multiAdapter, 'adapters', [toCid, 0n, s, BigInt(i)]))
  )
  const set: HexString[] = []
  for (const result of results) {
    const adapter = answered<HexString>(result, 'v3.3 MultiAdapter.adapters')
    if (isAddressEqual(adapter, zeroAddress)) continue
    if (layerZero && isAddressEqual(adapter, layerZero)) set.push(adapter)
    else if (chainlink && isAddressEqual(adapter, chainlink)) {
      const [quote] = await read([call(adapter, 'estimate', [toCid, '0x', CHAINLINK_MIN_DELIVERY_GAS])])
      if (quote!.status === 'success') set.push(adapter)
    }
  }
  return { installed: false, set }
}

/** A revert reads as "refuses"; a read that failed for any other reason is not a measurement and refuses the probe. */
async function quotes(read: LaneRead, adapter: HexString, toCid: CentrifugeId, gasLimit: bigint): Promise<boolean> {
  const [result] = await read([call(adapter, 'estimate', [toCid, PROBE_PAYLOAD, gasLimit])])
  if (result!.status === 'success') return true
  const error = result!.error
  const reverted =
    error instanceof BaseError &&
    error.walk((e) => e instanceof ContractFunctionRevertedError || e instanceof ContractFunctionExecutionError) !==
      null
  if (reverted) return false
  throw new MigrationInputsReadError(
    `lane cap probe of ${adapter} toward cid ${toCid}`,
    `estimate(${gasLimit}) failed with something other than a revert, so the cap would read lower than it is`
  )
}

/**
 * The largest gas limit one adapter quotes toward `toCid`, found by bisection between the floor and the ceiling:
 * `cap` 0 when it accepts the ceiling (no cap of its could bind) and 0 again when the lane is not quotable at all,
 * which `quotable` separates.
 * @internal
 */
export async function probeLaneCap(read: LaneRead, adapter: HexString, toCid: CentrifugeId): Promise<LaneCapProbe> {
  if (await quotes(read, adapter, toCid, PROBE_CEILING)) return { adapter, cap: 0n, quotable: true }
  if (!(await quotes(read, adapter, toCid, PROBE_FLOOR))) return { adapter, cap: 0n, quotable: false }
  let lo = PROBE_FLOOR
  let hi = PROBE_CEILING
  while (hi - lo > 1n) {
    const mid = (lo + hi) / 2n
    if (await quotes(read, adapter, toCid, mid)) lo = mid
    else hi = mid
  }
  return { adapter, cap: lo, quotable: true }
}

/** The tightest cap the lane imposes, 0 when nothing on it caps below the ceiling, and every adapter's own answer. */
export async function laneCap(
  read: LaneRead,
  adapters: readonly HexString[],
  toCid: CentrifugeId
): Promise<{ tightest: bigint; probed: LaneCapProbe[]; unquotable: HexString[] }> {
  const probed: LaneCapProbe[] = []
  let tightest = 0n
  for (const adapter of adapters) {
    const probe = await probeLaneCap(read, adapter, toCid)
    probed.push(probe)
    if (probe.cap !== 0n && (tightest === 0n || probe.cap < tightest)) tightest = probe.cap
  }
  return { tightest, probed, unquotable: probed.filter((probe) => !probe.quotable).map((probe) => probe.adapter) }
}

// ---------------------------------------------------------------------------------------------------
// The post-onboard checks and the ramp registrations, decided over the reads the live driver makes
// ---------------------------------------------------------------------------------------------------

export type EpochPointersRead = readonly (number | bigint)[]

/**
 * The first (class, asset) pair whose v3.3 BRM epoch pointers are not the v3.2 ones, with both tuples; empty when
 * every pair matches.
 * @internal
 */
export function epochMismatchOf(
  pairs: readonly { scId: HexString; assetId: string }[],
  v32: readonly EpochPointersRead[],
  v33: readonly EpochPointersRead[]
): string {
  for (let i = 0; i < pairs.length; i++) {
    const a = v32[i]!.map(Number)
    const b = v33[i]!.map(Number)
    if (a.every((value, k) => value === b[k])) continue
    const pair = pairs[i]!
    return `epoch pointers of class ${pair.scId} asset ${pair.assetId} differ: v3.2 (deposit ${a[0]}, issue ${a[1]}, redeem ${a[2]}, revoke ${a[3]}) against v3.3 (deposit ${b[0]}, issue ${b[1]}, redeem ${b[2]}, revoke ${b[3]}); the hub onboard's epochAssetIds missed the pair, so it restarts at epoch 0 on v3.3`
  }
  return ''
}

/**
 * The vaults whose v3.3 link state is not their v3.2 one: `wasLinked` is the facade's record of the offboard
 * unlinking it, `linked` the v3.3 spoke registry's answer now.
 * @internal
 */
export function vaultLinkMismatchesOf(
  vaults: readonly HexString[],
  wasLinked: readonly boolean[],
  linked: readonly boolean[]
): { vault: HexString; wasLinked: boolean }[] {
  return vaults.flatMap((vault, i) => (wasLinked[i] !== linked[i] ? [{ vault, wasLinked: wasLinked[i]! }] : []))
}

/**
 * One ramp accounting id a spoke's v3.3 ramps need: its asset, whether it is the liability or the receipt id, and
 * whether the spoke registry knows it.
 */
export type MigrationRampId = {
  asset: HexString
  kind: 'receipt' | 'liability'
  tokenId: bigint
  registered: boolean
}

const RAMP_ID_KINDS = ['liability', 'receipt'] as const

/**
 * Every ramp id, read as `toTokenId(asset, liability)` for `[true, false]` per asset in order, paired with its
 * `assetToId` answer (0 when unknown). An asset two ramps share is listed once.
 * @internal
 */
export function rampIdRows(
  assets: readonly HexString[],
  tokenIds: readonly bigint[],
  registered: readonly bigint[]
): MigrationRampId[] {
  const out: MigrationRampId[] = []
  assets.forEach((asset, a) => {
    RAMP_ID_KINDS.forEach((kind, k) => {
      const i = a * 2 + k
      if (out.some((row) => row.tokenId === tokenIds[i])) return
      out.push({ asset, kind, tokenId: tokenIds[i]!, registered: registered[i] !== 0n })
    })
  })
  return out
}

/**
 * The accounting-token ids a spoke's ramps need registered on its v3.3 Spoke and that are not yet: one receipt and
 * one liability id per ramp asset, each read back through `assetToId`, which answers 0 for an unregistered one.
 * @internal
 */
export function unregisteredRampIds(tokenIds: readonly bigint[], registered: readonly bigint[]): bigint[] {
  const out: bigint[] = []
  tokenIds.forEach((tokenId, i) => {
    if (registered[i] === 0n && !out.includes(tokenId)) out.push(tokenId)
  })
  return out
}
