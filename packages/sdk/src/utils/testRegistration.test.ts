import { expect } from 'chai'
import { readdirSync } from 'node:fs'
import { createRequire } from 'node:module'

/**
 * Guards against a test file that exists but never runs.
 *
 * Upstream (centrifuge/sdk) enumerated test files by name in the `test:unit` script, so a
 * new file was opted *out* by default and this guard parsed that script string. In the
 * monorepo `test:unit` runs `.mocharc.unit.cjs`, which GLOBS `src/**\/*.test.ts` and
 * subtracts an explicit ignore list — the default is inverted, so a new file runs unless
 * something deliberately excludes it.
 *
 * The check therefore reads the mocharc's ignore list rather than the script string: the
 * failure it exists to catch (a `src/utils` test that silently never executes) is now
 * "a file was added to `ignore`", not "a file was left off an allowlist".
 *
 * Scoped to `src/utils`, the pure-computation half of the SDK — encoders, classification,
 * script building — where a test has no reason to need the network. Files that genuinely
 * do are listed below with a reason, so the exception is visible rather than implied.
 */

/** `src/utils` tests intentionally kept out of `test:unit`, and why. */
const EXCLUDED = new Map<string, string>([
  ['permit.test.ts', 'needs a fork server (see .mocharc.unit.cjs for the full reason)'],
])

// Upstream also excluded gas.estimate, ipfs, crosschainHotfix and transaction as
// network-dependent. In the monorepo they neither import `tests/setup` nor call
// `this.skip()`, and all four pass offline in the fast suite, so keeping them listed
// here would have claimed an exclusion CI does not make.

/** The `ignore` globs `pnpm test:unit` actually runs with. */
function mocharcIgnores(): string[] {
  const require = createRequire(import.meta.url)
  const config = require(`${process.cwd()}/.mocharc.unit.cjs`) as { ignore?: string[] }
  return config.ignore ?? []
}

describe('utils — test registration', () => {
  it('runs every src/utils test in CI, or documents why not', () => {
    const ignored = new Set(mocharcIgnores())
    const onDisk = readdirSync('src/utils').filter((f) => f.endsWith('.test.ts'))

    // Excluded from the fast suite by the mocharc, but not declared here with a reason.
    const undocumented = onDisk.filter((file) => ignored.has(`src/utils/${file}`) && !EXCLUDED.has(file))

    expect(
      undocumented,
      `these src/utils tests are excluded by .mocharc.unit.cjs but carry no reason here — ` +
        `either stop ignoring them, or add them to EXCLUDED with the reason they cannot run`
    ).to.deep.equal([])
  })

  it('does not claim an exclusion the mocharc does not actually make', () => {
    // The inverse drift: a file listed here as excluded that the glob in fact runs. Harmless
    // to the suite, but it makes EXCLUDED lie about what CI does.
    const ignored = new Set(mocharcIgnores())
    const onDisk = new Set(readdirSync('src/utils').filter((f) => f.endsWith('.test.ts')))
    const notActuallyExcluded = [...EXCLUDED.keys()].filter(
      (file) => onDisk.has(file) && !ignored.has(`src/utils/${file}`)
    )
    expect(notActuallyExcluded, 'EXCLUDED names files the mocharc still runs; drop them').to.deep.equal([])
  })

  it('does not carry a stale exclusion for a file that no longer exists', () => {
    const onDisk = new Set(readdirSync('src/utils').filter((f) => f.endsWith('.test.ts')))
    const stale = [...EXCLUDED.keys()].filter((file) => !onDisk.has(file))
    expect(stale, 'EXCLUDED names files that are gone; drop them').to.deep.equal([])
  })
})
