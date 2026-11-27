import type { HubTokenSnapshotPriceRow } from '@centrifuge/queries/core'
import { Price } from '../utils/BigInt.js'
import { isoInstant } from '../utils/date.js'
import type { SharePriceUpdate } from './ShareClass.js'

/** The trigger of the snapshot the hub writes for each `UpdatePricePoolPerShare` it processes. */
const PRICE_UPDATE_TRIGGER = 'shareClassManager:UpdatePricePoolPerShare'

/** An hour, like the reports over the same snapshots: history changes only when a price is committed. */
export const SHARE_PRICE_UPDATES_POLL_INTERVAL = 60 * 60 * 1000

function instantOf(value: string, field: string): Date {
  const instant = isoInstant(value)
  if (instant === null) {
    throw new Error(
      `The "sharePriceUpdates" entry returned ${field} ${JSON.stringify(value)}, which is not an ISO-8601 timestamp.`
    )
  }
  return instant
}

/**
 * A bound of the range as the ISO string the indexer is asked for.
 * @throws {RangeError} When the date is invalid.
 * @internal
 */
export function sharePriceUpdatesBound(date: Date | undefined, name: 'from' | 'to'): string | undefined {
  if (date === undefined) return undefined
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`sharePriceUpdates: "${name}" is an invalid Date; pass a Date that names an instant.`)
  }
  return date.toISOString()
}

/**
 * The price commits among the snapshot rows of one share class, in the order of their block time. The sort is stable,
 * so commits of different blocks with one block time stay in the order the indexer returned them.
 * @internal
 */
export function toSharePriceUpdates(rows: readonly HubTokenSnapshotPriceRow[]): SharePriceUpdate[] {
  const updates: SharePriceUpdate[] = []
  for (const row of rows) {
    if (row.trigger !== PRICE_UPDATE_TRIGGER || row.tokenPrice == null) continue
    if (row.triggerBlockTimestamp == null) {
      throw new Error(`The "sharePriceUpdates" entry returned a price update at ${row.timestamp} without a block time.`)
    }
    updates.push({
      price: new Price(BigInt(row.tokenPrice)),
      committedAt: instantOf(row.triggerBlockTimestamp, 'triggerBlockTimestamp'),
      computedAt: row.tokenPriceComputedAt == null ? null : instantOf(row.tokenPriceComputedAt, 'tokenPriceComputedAt'),
    })
  }
  return updates.sort((a, b) => a.committedAt.getTime() - b.committedAt.getTime())
}
