/**
 * Pool adapter wiring as the indexer reports it. One row per `(chain, remote chain, pool, adapter)`:
 * `isEnabled` is the set confirmed live on that chain and `crosschainInProgress` flags an adapter
 * whose change was sent from the hub but not yet executed there (`null` once settled).
 * @internal
 */
export type PoolAdapterState = {
  /** Indexer adapter name, e.g. `layerZero`, `axelar`, `chainlink`, `wormhole`. */
  name: string
  isEnabled: boolean
  crosschainInProgress: string | null
}

/**
 * The adapter names a chain has live for the pool, deduplicated and sorted.
 * @internal
 */
export function enabledAdapterNames(rows: readonly PoolAdapterState[]): string[] {
  return [...new Set(rows.filter((row) => row.isEnabled).map((row) => row.name))].sort()
}

/**
 * Whether a chain's rows show exactly `expected` live and nothing in flight.
 * @internal
 */
export function poolAdaptersSettled(rows: readonly PoolAdapterState[], expected: readonly string[]): boolean {
  if (rows.some((row) => row.crosschainInProgress != null)) return false
  const live = enabledAdapterNames(rows)
  const wanted = [...new Set(expected)].sort()
  return live.length === wanted.length && live.every((name, i) => name === wanted[i])
}

/**
 * Whether pool messages can flow between the hub and a spoke: both sides hold a live set, nothing is
 * in flight towards the spoke, and the spoke's set mirrors the hub's. `Hub.setAdapters` configures
 * the hub at once and the spoke through a `SetPoolAdapters` message, so the two can disagree: an
 * undelivered message leaves the spoke empty or on a previous set, a spoke set up by ops may not
 * match the hub.
 * @internal
 */
export function isPoolWired(hubRows: readonly PoolAdapterState[], spokeRows: readonly PoolAdapterState[]): boolean {
  const onHub = enabledAdapterNames(hubRows)
  if (onHub.length === 0) return false
  return poolAdaptersSettled(spokeRows, onHub)
}

/**
 * Polls `read` (a fresh indexer read of the spoke's rows) until the pool's adapters there are exactly
 * `expected` with nothing in flight, i.e. until the `SetPoolAdapters` message has been executed on
 * the spoke and indexed. A failed read is retried on the next poll; the wait only rejects at
 * `timeoutMs`.
 * @internal
 */
export async function waitForPoolAdapters(
  read: () => Promise<PoolAdapterState[]>,
  expected: readonly string[],
  { intervalMs = 10_000, timeoutMs = 60 * 60 * 1000 }: { intervalMs?: number; timeoutMs?: number } = {}
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastSeen: PoolAdapterState[] | undefined
  let lastError: unknown
  while (true) {
    try {
      lastSeen = await read()
      lastError = undefined
      if (poolAdaptersSettled(lastSeen, expected)) return
    } catch (error) {
      lastError = error
    }
    if (Date.now() >= deadline) {
      const seen = lastSeen
        ? `the indexer reports [${lastSeen.map((r) => `${r.name}${r.isEnabled ? '' : ' (disabled)'}${r.crosschainInProgress ? ` (${r.crosschainInProgress} in flight)` : ''}`).join(', ')}]`
        : 'the indexer could not be read'
      const read_ = lastError
        ? `; last read failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`
        : ''
      throw new Error(
        `Timed out after ${Math.round(timeoutMs / 60_000)} minutes waiting for the pool's adapters on the ` +
          `destination to become [${expected.join(', ')}]; ${seen}${read_}. The SetPoolAdapters message may still ` +
          `be in transit: running the deployment again before it is executed sends setAdapters once more; ` +
          `afterwards it goes straight to the pool messages. The indexer may also be behind the chain; check its ` +
          `sync status before resending.`
      )
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}
