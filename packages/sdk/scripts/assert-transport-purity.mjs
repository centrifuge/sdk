/**
 * The transport-purity acceptance criterion, as a gate:
 *
 *   "packages/sdk has zero knowledge of cookies, CSRF, or EventSource
 *    (grep-level assertion in CI)."
 *
 * The transport contract says the SDK is handed a `fetch` and an `eventSource`
 * and never sees a cookie, a token or a retry policy. That is only worth
 * anything if it cannot erode, and it is exactly the kind of boundary that
 * erodes by accident: the shortest fix for "the request needs credentials" is
 * one line inside the adapter, and nothing else in the build would object.
 *
 * ## What is checked, and where
 *
 * Two trees, because the read half of the transport lives in
 * `packages/queries` and the write half in `packages/sdk`, and a rule covering
 * only one of them would move the leak rather than prevent it:
 * `packages/sdk/src` and `packages/queries/src`.
 *
 * Comments are blanked before matching (see {@link blankComments}), which is
 * the whole reason this is not a literal `grep`. The contract has to be
 * DOCUMENTED where the transport is defined — at length, naming the cookie, the
 * header and the retry — and a checker that could not tell prose from code
 * would force that documentation out of the file it belongs in. Blanking
 * preserves offsets, so reported line numbers are the real ones.
 *
 * ## Three rule groups
 *
 * 1. `ALWAYS_FORBIDDEN` — the four BEHAVIOURS, banned in every file of both
 *    trees, tests included. Reading `document.cookie`, opening an
 *    `EventSource`, setting `withCredentials`, or setting fetch's
 *    `credentials`. There is no legitimate reason for any of them here, in a
 *    test or otherwise: a test that needs a credentialed transport gets one by
 *    being HANDED a fake, which is the point being tested.
 *
 * 2. `NON_TEST_FORBIDDEN` — the two VOCABULARIES (`csrf`, `cookie`), banned in
 *    non-test files. `*.test.ts` is exempt for one stated reason: proving the
 *    SDK is INDIFFERENT to the session requires a transport that carries one,
 *    and a fake forbidden from naming the header it presents cannot demonstrate
 *    anything. `src/tx/BackendPrepare.contract.test.ts` already relies on this
 *    — its `contractFetch` is the app-side transport, and the file predates
 *    this checker — and the criteria ask for "the CSRF-403-retry path
 *    exercised via a transport fake". The exemption is narrow: group 1 still
 *    applies to tests, so no test may touch a cookie or open a stream either.
 *
 * 3. `EVENT_SOURCE_IDENTIFIER` — the bare TYPE name, banned in non-test files
 *    outside `packages/sdk/src/backend/`. The subpath must name it: the
 *    transport it accepts is `(url, init?) => EventSource`. Naming a DOM type
 *    in a signature is not knowledge of a stream — the subpath still cannot
 *    open one, because group 1 has no exemptions.
 *
 * Run: `pnpm --filter @centrifuge/sdk run check:transport-purity`
 * (CI runs it in the `sdk` job). Exits 1 and prints `file:line` for every hit.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const RESOLVED_TMPDIR = resolve(tmpdir())

/** The two trees the transport contract covers. */
export const SCANNED_ROOTS = [join('packages', 'sdk', 'src'), join('packages', 'queries', 'src')]

/** Where the transport type may name `EventSource`. */
const BACKEND_SUBPATH = join('packages', 'sdk', 'src', 'backend') + sep

/**
 * The rule ids, as an export.
 *
 * Exported so `src/backend/transportPurity.test.ts` can name a rule without
 * writing the id out — several of the ids ARE the banned patterns, and the
 * behaviour rules have no test-file exemption. Referencing them from here also
 * means the test cannot drift from the checker's own vocabulary.
 */
export const RULE_IDS = {
  documentCookie: 'document.cookie',
  newEventSource: 'new EventSource',
  credentialsFlag: 'withCredentials',
  credentialsOption: "fetch's `credentials` option",
  csrf: 'csrf',
  cookie: 'cookie',
  eventSource: 'EventSource',
}

const ALWAYS_FORBIDDEN = [
  {
    id: RULE_IDS.documentCookie,
    pattern: /document\s*\.\s*cookie/g,
    why: 'the session cookie is httpOnly and belongs to the app; the SDK never reads or writes one',
  },
  {
    id: RULE_IDS.newEventSource,
    pattern: /\bnew\s+EventSource\b/g,
    why: 'the app supplies `transport.eventSource`, already opened with credentials; the SDK never constructs one',
  },
  {
    id: RULE_IDS.credentialsFlag,
    pattern: /\bwithCredentials\b/g,
    why: 'whether the stream carries credentials is the app transport’s decision, made before the SDK is called',
  },
  {
    id: RULE_IDS.credentialsOption,
    pattern: /\bcredentials\s*:/g,
    why: 'the injected `fetch` already sends the session; setting this here would put a second opinion on it',
  },
]

const NON_TEST_FORBIDDEN = [
  {
    id: RULE_IDS.csrf,
    pattern: /csrf/gi,
    why: 'the double-submit token, its header name and its one retry live in the app transport',
  },
  {
    id: RULE_IDS.cookie,
    pattern: /cookie/gi,
    why: 'cookie names and lifetimes are one deployment’s auth mechanics, not a published SDK’s concern',
  },
]

const EVENT_SOURCE_IDENTIFIER = {
  id: RULE_IDS.eventSource,
  pattern: /\bEventSource/g,
  why:
    'only the transport contract in packages/sdk/src/backend may name the type; elsewhere it would mean the ' +
    'root SDK had grown a push seam of its own',
}

/**
 * Replace every comment with spaces, preserving length and newlines.
 *
 * A character scanner rather than a regex, because the string forms have to be
 * respected: `'https://app.example.com/api'` must not lose everything after
 * `//`, or a forbidden token sitting later in that string would go unseen.
 * Regex literals are safe to ignore — a comment opener needs `/` followed by
 * `/` or `*`, and neither can be the first character of a valid regex literal.
 */
export function blankComments(source) {
  const out = Array.from(source)
  const n = source.length
  let i = 0

  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k++) {
      if (out[k] !== '\n') {
        out[k] = ' '
      }
    }
  }

  while (i < n) {
    const ch = source[i]
    const next = source[i + 1]

    if (ch === '/' && next === '/') {
      let end = i
      while (end < n && source[end] !== '\n') {
        end++
      }
      blank(i, end)
      i = end
      continue
    }

    if (ch === '/' && next === '*') {
      let end = i + 2
      while (end < n && !(source[end] === '*' && source[end + 1] === '/')) {
        end++
      }
      blank(i, Math.min(end + 2, n))
      i = end + 2
      continue
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      i++
      while (i < n) {
        if (source[i] === '\\') {
          i += 2
          continue
        }
        if (source[i] === ch) {
          i++
          break
        }
        i++
      }
      continue
    }

    i++
  }

  return out.join('')
}

function walk(dir, boundary, found = []) {
  // `dir` only ever reaches here as `boundary` itself (the first call, from
  // `findTransportViolations`) or as a `full` this same function already
  // checked against `boundary` on the previous stack frame — but a function
  // that reads a directory has to enforce that on its OWN input, not lean on
  // every caller having done it already. Same reasoning as the `root` and
  // `full` checks elsewhere in this file: the only callers today are
  // trusted, but that is a property of today's callers, not of `walk`.
  const resolvedDir = resolve(dir)
  if (resolvedDir !== boundary && !resolvedDir.startsWith(boundary + sep)) {
    throw new Error(`assert-transport-purity: refusing to scan ${resolvedDir}: escapes ${boundary}.`)
  }
  for (const name of readdirSync(dir)) {
    // `name` is a directory entry reported by the filesystem itself, not
    // external input, but it is joined straight into a path that gets read —
    // so the containment check makes that explicit rather than assumed, the
    // same way the scanned-roots check above does for `root`.
    const full = join(dir, name)
    if (full !== resolvedDir && !full.startsWith(resolvedDir + sep)) {
      throw new Error(`assert-transport-purity: refusing to read ${full}: escapes ${resolvedDir}.`)
    }
    if (statSync(full).isDirectory()) {
      walk(full, boundary, found)
    } else if (name.endsWith('.ts') || name.endsWith('.tsx')) {
      found.push(full)
    }
  }
  return found
}

function lineOf(source, index) {
  let line = 1
  for (let i = 0; i < index; i++) {
    if (source[i] === '\n') {
      line++
    }
  }
  return line
}

function rulesFor(relPath) {
  const isTest = /\.test\.tsx?$/.test(relPath)
  const rules = [...ALWAYS_FORBIDDEN]
  if (!isTest) {
    rules.push(...NON_TEST_FORBIDDEN)
    if (!relPath.startsWith(BACKEND_SUBPATH)) {
      rules.push(EVENT_SOURCE_IDENTIFIER)
    }
  }
  return rules
}

/**
 * Every violation in the scanned trees.
 *
 * @param {{ repoRoot?: string, roots?: string[] }} [options] - Overridable so
 *   the unit test can point the same checker at a fixture directory and watch
 *   it go red, rather than asserting that a green run means anything.
 * @returns {{ file: string, line: number, rule: string, match: string, why: string }[]}
 */
export function findTransportViolations(options = {}) {
  // `options.repoRoot` is never attacker input: `main()` below calls this with
  // no options at all, and the only other caller is `transportPurity.test.ts`,
  // which points it at a fixture directory it just created with `mkdtempSync`
  // — always somewhere under the OS temp dir. Those are the only two
  // legitimate shapes this can ever take, so unlike a caller mistake (wrong
  // type, typo'd path) they are an actual allowlist, not just a type check:
  // either the real repo root, or a path under `os.tmpdir()`. Anything else
  // fails loudly here instead of being handed to `readdirSync`/`readFileSync`.
  if (options.repoRoot !== undefined && typeof options.repoRoot !== 'string') {
    throw new Error(`assert-transport-purity: repoRoot must be a string, got ${JSON.stringify(options.repoRoot)}.`)
  }
  const repoRoot = resolve(options.repoRoot ?? REPO_ROOT)
  const isRepoRoot = repoRoot === resolve(REPO_ROOT)
  const isUnderTmpdir = repoRoot === RESOLVED_TMPDIR || repoRoot.startsWith(RESOLVED_TMPDIR + sep)
  if (!isRepoRoot && !isUnderTmpdir) {
    throw new Error(
      `assert-transport-purity: repoRoot must be ${REPO_ROOT} or a path under ${RESOLVED_TMPDIR}, got ${repoRoot}.`
    )
  }
  let repoRootStats
  try {
    repoRootStats = statSync(repoRoot)
  } catch (cause) {
    throw new Error(`assert-transport-purity: repoRoot ${repoRoot} does not exist.`, { cause })
  }
  if (!repoRootStats.isDirectory()) {
    throw new Error(`assert-transport-purity: repoRoot ${repoRoot} is not a directory.`)
  }

  const roots = options.roots ?? SCANNED_ROOTS
  const violations = []

  for (const root of roots) {
    // `root` is a constant from SCANNED_ROOTS, or a fixture path the unit test
    // passes; nothing here is reachable from a request, and the script is not
    // published (`files: ["dist"]`). The containment check is here anyway,
    // because "the only callers are trusted" is a property of today's callers
    // rather than of this function, and a path traversal is cheaper to make
    // impossible than to keep arguing about. An absolute or `..`-bearing root
    // is a bug in the caller either way, so it fails loudly rather than
    // reading whatever it was pointed at.
    const abs = resolve(repoRoot, root)
    if (abs !== repoRoot && !abs.startsWith(repoRoot + sep)) {
      throw new Error(
        `assert-transport-purity: refusing to scan ${abs}: scanned roots must stay inside ${repoRoot}. ` +
          `Got root ${JSON.stringify(root)}.`
      )
    }
    let files
    try {
      files = walk(abs, repoRoot)
    } catch (cause) {
      throw new Error(`assert-transport-purity: cannot scan ${abs}: ${cause.message}`, { cause })
    }
    // A scanned root that turned up no files is a broken checker, not a clean
    // one. This is the "depcruise runner that validated nothing" failure mode
    // from the project's own history, so it is an error rather than a pass.
    if (files.length === 0) {
      throw new Error(
        `assert-transport-purity: ${abs} contains no TypeScript files. Refusing to report a clean run ` +
          `over an empty scan — fix the path.`
      )
    }

    for (const file of files) {
      const relPath = relative(repoRoot, file)
      const source = readFileSync(file, 'utf8')
      const code = blankComments(source)
      for (const rule of rulesFor(relPath)) {
        rule.pattern.lastIndex = 0
        let match
        while ((match = rule.pattern.exec(code)) !== null) {
          violations.push({
            file: relPath,
            line: lineOf(code, match.index),
            rule: rule.id,
            match: match[0],
            why: rule.why,
          })
        }
      }
    }
  }

  return violations
}

function main() {
  const violations = findTransportViolations()
  if (violations.length === 0) {
    console.log(
      `transport purity: clean — no cookie, CSRF or EventSource-construction code in ${SCANNED_ROOTS.join(' or ')}`
    )
    return
  }

  console.error(
    `transport purity: ${violations.length} violation(s). The SDK is handed { fetch, eventSource } and must ` +
      `not know how the session is carried (see packages/sdk/src/backend/transport.ts and ` +
      `docs/api/sdk-backend-transport.md).\n`
  )
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.rule}  (matched "${v.match}")\n      ${v.why}`)
  }
  process.exitCode = 1
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main()
}
