/**
 * Normalize a numeric timestamp to epoch milliseconds. Values smaller than
 * 1e12 are treated as seconds (any sensible ms timestamp from the last few
 * decades is well past that threshold).
 */
export function toEpochMs(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined
  return value < 1e12 ? value * 1000 : value
}
