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

/** The name the SDK gives a row whose adapter address the indexer cannot resolve to a registered adapter. */
export const UNKNOWN_ADAPTER_NAME = 'unknown'

/**
 * What a deployment has to do about the pool's adapters before it can send pool messages to the spoke.
 * @internal
 */
export type PoolAdapterPlan =
  | { action: 'ready' }
  | { action: 'send'; expected: string[] }
  | { action: 'wait'; expected: string[] }
  | { action: 'conflict'; onHub: string[]; onSpoke: string[] }

/**
 * Decides between sending `setAdapters`, waiting for one already sent, or stopping, from both sides'
 * rows and the set the SDK would configure (`ours`). The hub is the authority: `Hub.setAdapters`
 * replaces its whole set at once and forwards it to the spoke in a `SetPoolAdapters` message, so a
 * set on the hub is never overwritten with a different one and a message still in flight is never
 * sent again. Resending is only done when the hub already holds `ours` and the spoke, with nothing
 * in flight, does not mirror it: the message was lost or never recorded, and repeating it changes
 * nothing on the hub.
 * @internal
 */
export function planPoolAdapters(
  hubRows: readonly PoolAdapterState[],
  spokeRows: readonly PoolAdapterState[],
  ours: readonly string[]
): PoolAdapterPlan {
  const onHub = enabledAdapterNames(hubRows)
  const wanted = [...new Set(ours)].sort()
  if (onHub.length === 0) return { action: 'send', expected: wanted }
  if (poolAdaptersSettled(spokeRows, onHub)) return { action: 'ready' }
  if (spokeRows.some((row) => row.crosschainInProgress != null)) return { action: 'wait', expected: onHub }
  if (onHub.length === wanted.length && onHub.every((name, i) => name === wanted[i])) {
    return { action: 'send', expected: onHub }
  }
  return { action: 'conflict', onHub, onSpoke: enabledAdapterNames(spokeRows) }
}

/**
 * Polls `read` (a fresh indexer read of the spoke's rows) until the pool's adapters there are exactly
 * `expected` with nothing in flight, i.e. until the `SetPoolAdapters` message has been executed on
 * the spoke and indexed. A failed read is retried on the next poll; the wait only rejects at
 * `timeoutMs`, when `signal` aborts, or as soon as the spoke reports an adapter the indexer cannot
 * name, which `expected` could never match.
 * @internal
 */
export async function waitForPoolAdapters(
  read: () => Promise<PoolAdapterState[]>,
  expected: readonly string[],
  {
    intervalMs = 10_000,
    timeoutMs = 60 * 60 * 1000,
    signal,
  }: { intervalMs?: number; timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastSeen: PoolAdapterState[] | undefined
  let lastError: unknown
  while (true) {
    if (signal?.aborted) throw new Error('Stopped waiting for the pool adapters: the transaction was cancelled')
    let rows: PoolAdapterState[] | undefined
    try {
      rows = await read()
      lastError = undefined
    } catch (error) {
      lastError = error
    }
    if (rows) {
      lastSeen = rows
      if (poolAdaptersSettled(rows, expected)) return
      const unnamed = rows.some(
        (row) => (row.isEnabled || row.crosschainInProgress != null) && row.name === UNKNOWN_ADAPTER_NAME
      )
      if (unnamed && !expected.includes(UNKNOWN_ADAPTER_NAME)) {
        throw new Error(
          `The destination holds a pool adapter the indexer cannot name (its address is not in the indexer's ` +
            `adapter registry), so delivery of [${expected.join(', ')}] cannot be confirmed by name. Check the ` +
            `pool's adapters on the destination directly.`
        )
      }
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
          `be in transit: running the deployment again while the indexer shows it in flight waits for it instead ` +
          `of sending it again. The indexer may also be behind the chain; check its sync status before resending.`
      )
    }
    await sleep(intervalMs, signal)
  }
}

/** Resolves after `ms`, or as soon as `signal` aborts. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve()
    const done = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal?.addEventListener('abort', done, { once: true })
  })
}
