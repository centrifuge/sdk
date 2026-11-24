import { expect } from 'chai'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The gate that asserts `packages/sdk` has no cookie, CSRF or EventSource code
 * — checked against planted violations, not just run and believed.
 *
 * A clean run of a checker proves nothing on its own: this project has already
 * shipped a depcruise runner that validated nothing and a vitest skip that
 * reported as a pass. So every rule below is exercised on a file that should
 * trip it AND on one that should not, over a temporary fixture tree the same
 * `findTransportViolations` scans.
 *
 * The checker is a `.mjs` script rather than a module in `src`, because CI must
 * be able to run it without a TypeScript loader. It is imported through a
 * computed specifier so `tsc` treats the import as dynamic — there is no
 * `.d.ts` for it, and adding one would be a type surface for a build script.
 */
const CHECKER = new URL('../../scripts/assert-transport-purity.mjs', import.meta.url).href

/**
 * The banned tokens, ASSEMBLED rather than written out.
 *
 * The fixture sources below are data for a checker, not code this package runs
 * — but the checker cannot tell the difference, and its four behaviour rules
 * have no test-file exemption BY DESIGN: that absoluteness is what makes them
 * worth having. Rather than punch a hole in the rule for the one file that
 * tests it, the literals are built at runtime, which keeps the gate
 * exemption-free and this file's intent visible. (This is not theoretical
 * fussiness — the first version of this file tripped its own gate four times,
 * which is the most direct evidence available that the gate works.)
 *
 * The RULE IDS are not written out either: several of them ARE the banned
 * patterns. They come from the checker's own `RULE_IDS` export instead, so the
 * expectations cannot drift from the rules they name.
 *
 * (The `csrf` and `cookie` VOCABULARY rules do exempt test files, so those two
 * appear verbatim below.)
 */
const TOKEN = {
  cookieRead: `${'document'}${'.cookie'}`,
  openStream: `${'new'} ${'EventSource'}`,
  credentialsFlag: `${'with'}${'Credentials'}`,
  credentialsOption: `${'credentials'}${':'}`,
}

interface Violation {
  file: string
  line: number
  rule: string
  match: string
  why: string
}

interface Checker {
  findTransportViolations: (options?: { repoRoot?: string; roots?: string[] }) => Violation[]
  blankComments: (source: string) => string
  SCANNED_ROOTS: string[]
  RULE_IDS: {
    documentCookie: string
    newEventSource: string
    credentialsFlag: string
    credentialsOption: string
    csrf: string
    cookie: string
    eventSource: string
  }
}

async function loadChecker(): Promise<Checker> {
  return (await import(CHECKER)) as unknown as Checker
}

/** A throwaway repo-shaped tree: `<tmp>/packages/sdk/src/...`. */
function fixtureTree(files: Record<string, string>): { repoRoot: string; roots: string[] } {
  const repoRoot = mkdtempSync(join(tmpdir(), 'transport-purity-'))
  for (const [rel, source] of Object.entries(files)) {
    const full = join(repoRoot, rel)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, source, 'utf8')
  }
  return { repoRoot, roots: [join('packages', 'sdk', 'src')] }
}

const SDK = join('packages', 'sdk', 'src')
const BACKEND = join(SDK, 'backend')

describe('transport purity gate', () => {
  it('is clean on the real tree', async () => {
    const { findTransportViolations, SCANNED_ROOTS } = await loadChecker()
    expect(SCANNED_ROOTS).to.have.length(2)
    expect(findTransportViolations()).to.deep.equal([])
  })

  it('refuses to report a clean run over a scan that found no files', async () => {
    // The failure mode this project has actually shipped: a checker that
    // validated nothing and reported green. An empty scan is an error.
    const { findTransportViolations } = await loadChecker()
    const { repoRoot } = fixtureTree({ [join(SDK, 'ok.ts')]: 'export const a = 1\n' })
    expect(() => findTransportViolations({ repoRoot, roots: [join('packages', 'nope', 'src')] })).to.throw(
      /cannot scan/
    )
    mkdirSync(join(repoRoot, 'packages', 'empty', 'src'), { recursive: true })
    expect(() => findTransportViolations({ repoRoot, roots: [join('packages', 'empty', 'src')] })).to.throw(
      /no TypeScript files/
    )
  })

  it('refuses a scanned root that escapes the repo root', async () => {
    // Aikido flagged `join(repoRoot, root)` as a file-inclusion risk on #503.
    // Nothing reachable from a request supplies `root` -- the callers are a
    // constant and this test -- but the containment is a property worth having
    // in the function rather than in its callers, so it is asserted here.
    const { findTransportViolations } = await loadChecker()
    const { repoRoot } = fixtureTree({ [join(SDK, 'ok.ts')]: 'export const a = 1\n' })
    for (const escape of [join('..', '..', 'etc'), '/etc']) {
      expect(() => findTransportViolations({ repoRoot, roots: [escape] }), escape).to.throw(
        /must stay inside/
      )
    }
    // A `..` sequence that normalises back inside the root is NOT an escape,
    // and the refusal must not claim it is: this one resolves to
    // `<repoRoot>/packages/sdk/src` and scans cleanly. Without this case the
    // test above would pass just as well against a checker that refused every
    // root containing two dots.
    expect(findTransportViolations({ repoRoot, roots: [join(SDK, '..', 'src')] })).to.deep.equal([])
  })

  it('catches each banned behaviour, in a test file as much as in source', async () => {
    const { findTransportViolations, RULE_IDS } = await loadChecker()
    const behaviours: [string, string][] = [
      [RULE_IDS.documentCookie, `const token = ${TOKEN.cookieRead}\n`],
      [RULE_IDS.newEventSource, `const stream = ${TOKEN.openStream}('/events/stream')\n`],
      [RULE_IDS.credentialsFlag, `const stream = factory(url, { ${TOKEN.credentialsFlag}: true })\n`],
      [RULE_IDS.credentialsOption, `await fetch(url, { ${TOKEN.credentialsOption} 'include' })\n`],
    ]

    for (const [rule, source] of behaviours) {
      for (const name of ['leak.ts', 'leak.test.ts']) {
        const { repoRoot, roots } = fixtureTree({ [join(SDK, name)]: source })
        const found = findTransportViolations({ repoRoot, roots })
        expect(
          found.map((v) => v.rule),
          `${rule} must be caught in ${name}`
        ).to.include(rule)
        expect(found.every((v) => v.line === 1)).to.equal(true)
      }
    }
  })

  it('reports a clean source file as clean', async () => {
    // The other half of every red case above. Without this the suite could not
    // tell "the rules work" from "the checker flags everything".
    const { findTransportViolations } = await loadChecker()
    const fixture = fixtureTree({
      [join(SDK, 'fine.ts')]: [
        "import type { Thing } from './thing.js'",
        'export async function read(url: string, transport: { fetch: typeof fetch }) {',
        "  const res = await transport.fetch(url, { method: 'GET', headers: { Accept: 'application/json' } })",
        '  return (await res.json()) as Thing',
        '}',
        '',
      ].join('\n'),
    })
    expect(findTransportViolations(fixture)).to.deep.equal([])
  })

  it('catches the CSRF and cookie vocabulary in source, and exempts test files', async () => {
    const { findTransportViolations } = await loadChecker()
    const source = "const headers = { 'X-CSRF-Token': token, Cookie: session }\n"

    const leak = fixtureTree({ [join(SDK, 'leak.ts')]: source })
    expect(
      findTransportViolations(leak)
        .map((v) => v.rule)
        .sort()
    ).to.deep.equal(['cookie', 'csrf'])

    // The stated exemption. `src/tx/BackendPrepare.contract.test.ts` relies on
    // it: its transport IS the app-side one, cookie and header included, and it
    // predates this checker. A fake forbidden from naming the header it
    // presents cannot show that the SDK is indifferent to it.
    const test = fixtureTree({ [join(SDK, 'leak.test.ts')]: source })
    expect(findTransportViolations(test)).to.deep.equal([])
  })

  it('allows the EventSource TYPE only inside the backend subpath', async () => {
    const { findTransportViolations, RULE_IDS } = await loadChecker()
    const signature = 'export type Factory = (url: string, init?: EventSourceInit) => EventSource\n'

    const inSubpath = fixtureTree({ [join(BACKEND, 'transport.ts')]: signature })
    expect(findTransportViolations(inSubpath), 'the transport contract must name the type').to.deep.equal([])

    const outside = fixtureTree({ [join(SDK, 'data', 'DataSource.ts')]: signature })
    expect(findTransportViolations(outside).map((v) => v.rule)).to.deep.equal([
      RULE_IDS.eventSource,
      RULE_IDS.eventSource,
    ])

    // And the subpath still may not OPEN one — group 1 has no exemptions, so
    // the narrow allowance cannot be widened by accident.
    const opens = fixtureTree({ [join(BACKEND, 'bad.ts')]: `const s = ${TOKEN.openStream}(url)\n` })
    expect(findTransportViolations(opens).map((v) => v.rule)).to.deep.equal([RULE_IDS.newEventSource])
  })

  it('ignores the vocabulary in comments, which is why this is not a grep', async () => {
    const { findTransportViolations } = await loadChecker()
    const documented = [
      '/**',
      ' * The app sends the session cookie and the X-CSRF-Token header, and',
      ` * opens the ${'EventSource'} ${TOKEN.credentialsFlag}. None of it happens here.`,
      ' */',
      `// Also: ${TOKEN.cookieRead} is the app's business, not ours.`,
      `export const noop = 1 // ${TOKEN.credentialsOption} none of our concern`,
      '',
    ].join('\n')

    const fixture = fixtureTree({ [join(SDK, 'documented.ts')]: documented })
    expect(findTransportViolations(fixture)).to.deep.equal([])
  })

  it('does not lose code that follows a `//` inside a string', async () => {
    // The hole a naive comment-stripper leaves, and the reason the checker
    // scans characters instead of running a regex: everything after `//` in
    // `'https://…'` would be discarded, so a forbidden token later in that
    // same string would go unseen.
    const { blankComments, findTransportViolations, RULE_IDS } = await loadChecker()
    const source = `await fetch('https://app.example.com/api', { ${TOKEN.credentialsOption} 'include' })\n`

    expect(blankComments(source)).to.equal(source)
    const fixture = fixtureTree({ [join(SDK, 'url.ts')]: source })
    expect(findTransportViolations(fixture).map((v) => v.rule)).to.deep.equal([RULE_IDS.credentialsOption])
  })

  it('reports the real line number of a violation below a comment block', async () => {
    // Offsets are preserved by blanking rather than deleting; a checker that
    // deleted comments would report a line nobody can find.
    const { findTransportViolations } = await loadChecker()
    const source = ['/*', ' * three', ' * line', ' */', `const t = ${TOKEN.cookieRead}`, ''].join('\n')
    const fixture = fixtureTree({ [join(SDK, 'below.ts')]: source })
    expect(findTransportViolations(fixture)[0]!.line).to.equal(5)
  })
})
