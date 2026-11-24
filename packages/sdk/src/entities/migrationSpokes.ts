import { catchError, defer, firstValueFrom, map, of, timeout } from 'rxjs'
import type { Centrifuge } from '../Centrifuge.js'
import type { CentrifugeId } from '../utils/types.js'
import { hubSpokeRecordOf } from './migrationInputsRead.js'
import type { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'

export type MigrationSpokeActivity = 'active' | 'inactive' | 'unreadable'
export type MigrationSpokeSource = 'chain' | 'hubRecord' | 'migration'

export type MigrationSpokeCandidate = {
  centrifugeId: CentrifugeId
  activity: MigrationSpokeActivity
  /** Why the chain could not be read; null unless `unreadable`. */
  reason: string | null
  sources: MigrationSpokeSource[]
}

export type MigrationSpokeCandidates = {
  spokes: MigrationSpokeCandidate[]
  /** Why the v3.2 hub's spoke record could not be read; its spokes are then missing from the set. */
  hubRecordError: string | null
}

export const SPOKE_READ_TIMEOUT_MS = 5_000

/**
 * The chains a pool's migration can touch, from every source that names one: the chain directory, the
 * v3.2 hub's `hubRequestManager` record and the migration's own spokes, each confirmed on its chain. A
 * chain whose activity read fails or times out is named `unreadable` rather than dropped: a spoke the
 * plan cannot see cannot be armed, and cannot be left out of the hub onboard either.
 * @internal
 */
export async function migrationSpokeCandidates(
  root: Centrifuge,
  pool: Pool,
  migrationSpokes: readonly CentrifugeId[] = [],
  timeoutMs = SPOKE_READ_TIMEOUT_MS
): Promise<MigrationSpokeCandidates> {
  const [networks, record] = await Promise.all([
    firstValueFrom(pool.networks()),
    hubSpokeRecordOf(root, pool.id).then(
      (ids) => ({ ids, error: null as string | null }),
      (error: unknown) => ({ ids: [] as CentrifugeId[], error: describe(error) })
    ),
  ])
  const sources = new Map<CentrifugeId, Set<MigrationSpokeSource>>()
  const name = (centrifugeId: CentrifugeId, source: MigrationSpokeSource) => {
    const set = sources.get(centrifugeId) ?? new Set<MigrationSpokeSource>()
    set.add(source)
    sources.set(centrifugeId, set)
  }
  networks.forEach((network) => name(network.centrifugeId, 'chain'))
  record.ids.forEach((centrifugeId) => name(centrifugeId, 'hubRecord'))
  migrationSpokes.forEach((centrifugeId) => name(centrifugeId, 'migration'))
  const spokes = await Promise.all(
    [...sources.entries()]
      .sort(([a], [b]) => a - b)
      .map(async ([centrifugeId, named]): Promise<MigrationSpokeCandidate> => {
        const network =
          networks.find((candidate) => candidate.centrifugeId === centrifugeId) ??
          new PoolNetwork(root, pool, centrifugeId)
        const read = await firstValueFrom(
          defer(() => network.isActive()).pipe(
            timeout({ first: timeoutMs }),
            map((active) => ({ active, error: null as string | null })),
            catchError((error: unknown) => of({ active: null, error: describe(error, timeoutMs) }))
          )
        )
        return {
          centrifugeId,
          activity: read.error !== null ? 'unreadable' : read.active ? 'active' : 'inactive',
          reason: read.error,
          sources: [...named],
        }
      })
  )
  return { spokes, hubRecordError: record.error }
}

/** The spokes a plan walks: the active candidates. */
export function activeSpokesOf(candidates: MigrationSpokeCandidates): CentrifugeId[] {
  return candidates.spokes.filter((spoke) => spoke.activity === 'active').map((spoke) => spoke.centrifugeId)
}

/** The chains a plan must name before it arms or onboards the hub: the unreadable ones, and the hub record when it failed. */
export function unreadableSpokesOf(
  candidates: MigrationSpokeCandidates
): { centrifugeId: CentrifugeId | null; reason: string }[] {
  const unreadable: { centrifugeId: CentrifugeId | null; reason: string }[] = candidates.spokes
    .filter((spoke) => spoke.activity === 'unreadable')
    .map((spoke) => ({ centrifugeId: spoke.centrifugeId, reason: spoke.reason ?? 'could not be read' }))
  if (candidates.hubRecordError !== null) {
    unreadable.push({
      centrifugeId: null,
      reason: `the v3.2 hub's spoke record could not be read: ${candidates.hubRecordError}`,
    })
  }
  return unreadable
}

function describe(error: unknown, timeoutMs = SPOKE_READ_TIMEOUT_MS): string {
  if (error instanceof Error) {
    return error.name === 'TimeoutError' ? `the activity read timed out after ${timeoutMs} ms` : error.message
  }
  return String(error)
}
