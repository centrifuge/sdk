import { ABIS_V3_3 } from '@centrifuge/protocol'
import { encodeFunctionData, isHex, size, toFunctionSelector, type AbiFunction } from 'viem'
import type { HexString } from '../types/index.js'
import { hubFunctionsBySelector } from './authorizationFold.js'
import type { PoolId } from './types.js'

const FUNCTION_SELECTOR_BYTES = 4

/** The functions of the v3.3 Hub by selector. */
export const HUB_FUNCTIONS = hubFunctionsBySelector(ABIS_V3_3.Hub)

/**
 * The Hub's batch entry points. A batch wrapper is classified as one unlisted call, so scheduling it succeeds, and
 * nothing consumes it: each inner call is checked on its own.
 */
const BATCH_SELECTORS: ReadonlySet<string> = new Set(
  ABIS_V3_3.Hub.filter(
    (item): item is Extract<(typeof ABIS_V3_3.Hub)[number], AbiFunction> =>
      item.type === 'function' && (item.name === 'multicall' || item.name === 'executeMulticall')
  ).map((item) => toFunctionSelector(item))
)

/**
 * Throws unless `data` is the calldata of one hub call: whole-byte hex that starts with a function selector and is not
 * a `multicall` or `executeMulticall` wrapper.
 */
export function assertAuthorizationCalldata(data: string, method: string): asserts data is HexString {
  if (!isHex(data) || data.length % 2 !== 0 || size(data) < FUNCTION_SELECTOR_BYTES) {
    throw new Error(
      `${method} takes the calldata of one hub call: whole-byte hex with at least a ${FUNCTION_SELECTOR_BYTES}-byte function selector`
    )
  }
  if (BATCH_SELECTORS.has(data.slice(0, 2 + FUNCTION_SELECTOR_BYTES * 2).toLowerCase())) {
    throw new Error(
      `${method} takes the calldata of one inner call, not of a multicall: pass built.calls[i].data of ` +
        `centrifuge.buildOnly(...), never the built.data of a build with several calls`
    )
  }
}

/** Throws when two entries are the same calldata, whatever the hex casing: the second would revert the whole batch. */
export function assertDistinctCalldata(datas: readonly string[], method: string): void {
  const seen = new Set<string>()
  for (const data of datas) {
    const key = data.toLowerCase()
    if (seen.has(key)) {
      throw new Error(
        `${method} got the same calldata twice; a call has one authorization and a repeat reverts the batch`
      )
    }
    seen.add(key)
  }
}

/** `Hub.initiateAuthorization(poolId, data)`, the call that schedules `data`. No policy classifies it. */
export function encodeInitiateAuthorization(poolId: PoolId, data: HexString): HexString {
  return encodeFunctionData({ abi: ABIS_V3_3.Hub, functionName: 'initiateAuthorization', args: [poolId.raw, data] })
}
