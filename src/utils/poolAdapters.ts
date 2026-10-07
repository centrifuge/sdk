import type { PublicClient } from 'viem'
import { ABI } from '../abi/index.js'
import type { HexString } from '../types/index.js'
import { addressesEqual } from './addresses.js'
import type { CentrifugeId } from './types.js'

/**
 * The slice of a chain client the adapter reads need.
 * @internal
 */
export type AdapterReader = Pick<PublicClient, 'readContract'>

/**
 * The adapters a `MultiAdapter` uses for messages of `poolId` exchanged with `withCentrifugeId`,
 * in configuration order. Empty when the pool has no adapters on that chain yet; the MultiAdapter
 * has no fallback to the global adapters for pool messages.
 * @internal
 */
export async function readPoolAdapters(
  client: AdapterReader,
  multiAdapter: HexString,
  withCentrifugeId: CentrifugeId,
  poolId: bigint
): Promise<HexString[]> {
  const count = Number(
    await client.readContract({
      address: multiAdapter,
      abi: ABI.MultiAdapter,
      functionName: 'quorum',
      args: [withCentrifugeId, poolId],
    })
  )
  return Promise.all(
    Array.from(
      { length: count },
      (_, id) =>
        client.readContract({
          address: multiAdapter,
          abi: ABI.MultiAdapter,
          functionName: 'adapters',
          args: [withCentrifugeId, poolId, BigInt(id)],
        }) as Promise<HexString>
    )
  )
}

/**
 * Same adapters in the same order, ignoring address case.
 * @internal
 */
export function sameAdapters(a: readonly (HexString | undefined)[], b: readonly (HexString | undefined)[]) {
  return a.length === b.length && a.every((address, i) => !!address && !!b[i] && addressesEqual(address, b[i]!))
}

/**
 * Polls the destination `MultiAdapter` until the pool's adapters are exactly `expected`, i.e. until
 * the `SetPoolAdapters` message that configured them has been executed there. Any other
 * configuration, including one left by an earlier setup, does not count: the pool messages that
 * follow are routed through `expected` and the destination only accepts them from that set.
 * A failed read is retried on the next poll; the wait only rejects at `timeoutMs`.
 * @internal
 */
export async function waitForPoolAdapters(
  client: AdapterReader,
  multiAdapter: HexString,
  fromCentrifugeId: CentrifugeId,
  poolId: bigint,
  expected: HexString[],
  { intervalMs = 10_000, timeoutMs = 60 * 60 * 1000 }: { intervalMs?: number; timeoutMs?: number } = {}
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastSeen: HexString[] | undefined
  let lastError: unknown
  while (true) {
    try {
      lastSeen = await readPoolAdapters(client, multiAdapter, fromCentrifugeId, poolId)
      lastError = undefined
      if (sameAdapters(lastSeen, expected)) return
    } catch (error) {
      lastError = error
    }
    if (Date.now() >= deadline) {
      const seen = lastSeen ? `they are [${lastSeen.join(', ')}]` : 'they could not be read'
      const read = lastError
        ? `; last read failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`
        : ''
      throw new Error(
        `Timed out after ${Math.round(timeoutMs / 60_000)} minutes waiting for the adapters of pool ` +
          `"${poolId}" on the destination (MultiAdapter ${multiAdapter}) to become [${expected.join(', ')}]; ` +
          `${seen}${read}. The SetPoolAdapters message may still be in transit: running the deployment again ` +
          `before it is executed sends setAdapters once more; afterwards it goes straight to the pool messages.`
      )
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}
