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
  return planPoolAdapters(hubRows, spokeRows, enabledAdapterNames(hubRows)).action === 'ready'
}

/**
 * Whether a live or in-flight row carries an adapter the indexer could not name. Names are the only
 * key comparable across chains, so such a row makes the wiring unverifiable.
 * @internal
 */
export function hasUnnamedAdapter(rows: readonly PoolAdapterState[]): boolean {
  return rows.some((row) => (row.isEnabled || row.crosschainInProgress != null) && row.name === UNKNOWN_ADAPTER_NAME)
}

/** The name the SDK gives a row whose adapter address the indexer cannot resolve to a registered adapter. */
export const UNKNOWN_ADAPTER_NAME = 'unknown'

/**
 * What a deployment has to do about the pool's adapters before it can send pool messages to the spoke.
 * @internal
 */
export type PoolAdapterPlan =
  | { action: 'ready' }
  | { action: 'send' }
  | { action: 'wait' }
  | { action: 'conflict'; onHub: string[]; onSpoke: string[] }
  | { action: 'unnamed'; side: 'hub' | 'destination' }

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
  if (hasUnnamedAdapter(hubRows)) return { action: 'unnamed', side: 'hub' }
  if (hasUnnamedAdapter(spokeRows)) return { action: 'unnamed', side: 'destination' }
  // Only the destination's rows are ever in flight: the indexer marks them from the outbound
  // `SetPoolAdapters` message, while the hub's own rows come from its local `SetAdapters` event.
  const onHub = enabledAdapterNames(hubRows)
  const wanted = [...new Set(ours)].sort()
  if (onHub.length === 0) return { action: 'send' }
  if (poolAdaptersSettled(spokeRows, onHub)) return { action: 'ready' }
  if (spokeRows.some((row) => row.crosschainInProgress != null)) return { action: 'wait' }
  if (onHub.length === wanted.length && onHub.every((name, i) => name === wanted[i])) {
    return { action: 'send' }
  }
  return { action: 'conflict', onHub, onSpoke: enabledAdapterNames(spokeRows) }
}
