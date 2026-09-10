import { expect } from 'chai'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Guards against a test file that exists but never runs.
 *
 * CI runs `pnpm test:unit`, which enumerates test files by name rather than globbing —
 * deliberately, since the entity and network suites need a fork server. The cost is that
 * a new file is opted *out* by default: it passes locally, gets reviewed, merges, and
 * never executes again. A calldata differential suite added in this very PR landed that
 * way until this check caught it.
 *
 * Scoped to `src/utils`, which is the pure-computation half of the SDK — encoders,
 * classification, script building — where a test has no reason to need the network. Files
 * that genuinely do are listed below with a reason, so the exception is visible rather
 * than implied by absence.
 */

/** `src/utils` tests intentionally kept out of `test:unit`, and why. */
const EXCLUDED = new Map<string, string>([
  ['gas.estimate.test.ts', 'estimates against a live chain'],
  ['ipfs.test.ts', 'fetches from an IPFS gateway'],
  ['crosschainHotfix.test.ts', 'needs a fork server'],
  ['permit.test.ts', 'needs a fork server'],
  ['transaction.test.ts', 'needs a fork server'],
])

describe('utils — test registration', () => {
  it('runs every src/utils test in CI, or documents why not', () => {
    const script = (JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }).scripts[
      'test:unit'
    ]
    expect(script, 'test:unit script is missing').to.be.a('string')

    const registered = new Set([...script!.matchAll(/'([^']*\.test\.ts)'/g)].map((m) => m[1]!))
    const onDisk = readdirSync('src/utils').filter((f) => f.endsWith('.test.ts'))

    const unregistered = onDisk.filter((file) => !registered.has(join('src/utils', file)) && !EXCLUDED.has(file))

    expect(
      unregistered,
      `these src/utils tests never run in CI — add them to the "test:unit" script in package.json, ` +
        `or add them to EXCLUDED in this file with the reason they cannot run there`
    ).to.deep.equal([])
  })

  it('does not carry a stale exclusion for a file that no longer exists', () => {
    const onDisk = new Set(readdirSync('src/utils').filter((f) => f.endsWith('.test.ts')))
    const stale = [...EXCLUDED.keys()].filter((file) => !onDisk.has(file))
    expect(stale, 'EXCLUDED names files that are gone; drop them').to.deep.equal([])
  })
})
