/**
 * The publish-safety gate: what may and may not reach the npm tarball.
 *
 * `packages/sdk` lives in a PRIVATE backend monorepo but publishes a PUBLIC
 * package. The build that produces the tarball bundles two private workspace
 * packages (`@centrifuge/protocol`, `@centrifuge/queries`) and the address book
 * (`@centrifuge/addressbook`, which contains `@centrifuge/registry-core`)
 * directly into the output, so "what is in the bundle" stops being obvious
 * from the import graph and becomes something a reviewer has to take on
 * faith. This script removes the faith.
 *
 * It runs against the BUILT ARTIFACT, not the source tree, because that is
 * the thing that ships. A source-level rule can be satisfied while a
 * transitive import still drags something in.
 *
 * Run: `pnpm --filter @centrifuge/sdk run check:publish-safety`
 * (build:publish runs it automatically; CI runs it in the sdk job).
 *
 * ## Five checks
 *
 * 1. NO UNRESOLVABLE IMPORTS. Every bare import left in the bundle must be a
 *    package.json `dependency`. This is the check that catches the original
 *    packaging bug: `@centrifuge/protocol` and `@centrifuge/queries` are
 *    `"private": true` and unpublished, so a leftover import of either means
 *    `npm install @centrifuge/sdk` fails for everyone.
 *
 * 2. NO BACKEND-ONLY CODE. `@centrifuge/queries` also contains `./sql`, a
 *    Drizzle adapter over `chain_v1` that imports `@centrifuge/public-db`.
 *    The SDK does not import it today (only `./core`, `./graphql`, `./rest`),
 *    and tree-shaking therefore leaves it out -- but one `export * from` in
 *    the wrong barrel would pull the backend's database layer into a public
 *    artifact, and nothing else in the build would object.
 *
 * 3. NO TESTS. The monorepo build emits 68 `*.test.js` files. They must not
 *    ship: test fixtures are a far more common source of accidental
 *    disclosure than source is.
 *
 * 4. NO CREDENTIALS OR INTERNAL HOSTS. A backstop, not the primary defence.
 *    Cheap to run, and the one check that would catch a mistake the other
 *    three are shaped wrong to see.
 *
 * 5. NO SOURCE TEXT IN SOURCEMAPS. The published maps carry `sources` paths
 *    but must not carry `sourcesContent`, which would inline the full text of
 *    every file that went into the bundle -- including the two private
 *    workspace packages. `tsup.publish.config.ts` sets
 *    `options.sourcesContent = false`, but nothing verified the artifact
 *    agreed: a change to that config would have shipped source text with
 *    every other check still green. The `[secrets]` markers cannot catch it,
 *    because embedded source is not a credential pattern.
 *
 * A failure prints every offending file and exits 1. There is no allowlist
 * flag: if a check is wrong, the fix is to change the rule here, in a diff a
 * reviewer sees, with a reason.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BACKEND_ONLY_MARKERS, SECRET_MARKERS } from './safety-markers.mjs'

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distDir = join(packageDir, 'dist-publish')

/**
 * The GENERATED manifest is the one that ships, so it is the one checked. The
 * source package.json still declares the two private workspace packages as
 * `workspace:*`; validating against it would pass exactly the manifest that
 * cannot be installed. Falls back to the source manifest so the script still
 * reports something useful if run before build-publish wrote one.
 */
const manifestPath = existsSync(join(distDir, 'package.json'))
  ? join(distDir, 'package.json')
  : join(packageDir, 'package.json')
const pkg = JSON.parse(readFileSync(manifestPath, 'utf8'))

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

/**
 * Bare (non-relative) import and export specifiers in an ESM bundle.
 *
 * Matches the `from "x"` form that esbuild emits, plus bare side-effect
 * imports. A specifier like `@scope/pkg/sub` is reduced to `@scope/pkg`,
 * since that is what package.json declares.
 */
/**
 * A package specifier: `pkg`, `@scope/pkg`, either with an optional `/subpath`.
 * Anchored, so a template-literal placeholder or a sentence never matches.
 */
const VALID_SPECIFIER = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(?:\/[\w.-]+)*$/i

function bareSpecifiers(code) {
  const found = new Set()
  const patterns = [/\bfrom\s*["']([^"'.][^"']*)["']/g, /\bimport\s*["']([^"'.][^"']*)["']/g]
  for (const re of patterns) {
    for (const [, spec] of code.matchAll(re)) {
      // Skip anything that is not a valid package specifier. esbuild preserves
      // string literals from error messages, and several of ours embed the
      // word "from" ahead of a quote -- `Cannot derive a pool id from
      // "${shareClassId}"`, `... from "this address is not a manager"`. A
      // real specifier is a package name, optionally scoped, optionally with
      // a subpath; nothing else may be treated as an import, or the check
      // fails on prose and gets muted.
      if (!VALID_SPECIFIER.test(spec)) continue
      const parts = spec.split('/')
      found.add(spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0])
    }
  }
  return found
}

const failures = []

// The published manifest must not declare the packages the bundle inlined.
// `workspace:*` rewrites to an unpublished 0.1.0 on publish, so this is the
// single most consequential field in the artifact.
for (const name of [
  '@centrifuge/protocol',
  '@centrifuge/queries',
  '@centrifuge/public-db',
  '@centrifuge/addressbook',
  '@centrifuge/registry-core',
]) {
  if (pkg.dependencies?.[name]) {
    failures.push(
      `[manifest] ${relative(packageDir, manifestPath)} declares "${name}", which the bundle inlines, so it must not be a dependency`
    )
  }
}
for (const [name, range] of Object.entries(pkg.dependencies ?? {})) {
  if (typeof range === 'string' && (range.startsWith('workspace:') || range.startsWith('catalog:'))) {
    failures.push(`[manifest] dependency "${name}" is a ${range.split(':')[0]} protocol range ("${range}") and cannot resolve off-registry`)
  }
}
let files
try {
  files = walk(distDir)
} catch {
  console.error(`publish-safety: no build at ${relative(packageDir, distDir)} -- run \`pnpm build:publish\` first.`)
  process.exit(1)
}

const declared = new Set(Object.keys(pkg.dependencies ?? {}))
const jsFiles = files.filter((f) => f.endsWith('.js'))
const textFiles = files.filter((f) => /\.(js|map|ts|json)$/.test(f))

// --- Check 3: no tests, no fork server. Cheapest, so it runs first. ---
for (const file of files) {
  const rel = relative(distDir, file)
  if (/\.(test|spec)\./.test(rel) || /(^|\/)tests?\//.test(rel) || /forkServer/.test(rel)) {
    failures.push(`[tests] ${rel} is a test artifact and must not ship`)
  }
}

// --- Check 1: every bare import is a declared dependency. ---
for (const file of jsFiles) {
  const rel = relative(distDir, file)
  for (const spec of bareSpecifiers(readFileSync(file, 'utf8'))) {
    if (!declared.has(spec)) {
      failures.push(
        `[imports] ${rel} imports "${spec}", which is not in package.json dependencies -- ` +
          `a consumer install would fail to resolve it`
      )
    }
  }
}

// --- Check 2 + 4: content markers. ---
for (const file of textFiles) {
  const rel = relative(distDir, file)
  const code = readFileSync(file, 'utf8')
  for (const { pattern, what } of BACKEND_ONLY_MARKERS) {
    if (pattern.test(code)) failures.push(`[backend-only] ${rel} contains ${what}`)
  }
  for (const { pattern, what } of SECRET_MARKERS) {
    if (pattern.test(code)) failures.push(`[secrets] ${rel} looks like it contains ${what}`)
  }
}

// --- Check 5: sourcemaps carry paths, never source text. ---
for (const file of files.filter((f) => f.endsWith('.map'))) {
  const rel = relative(distDir, file)
  let map
  try {
    map = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    failures.push(`[sourcemap] ${rel} is not valid JSON`)
    continue
  }
  // Present-but-empty is still wrong: it means the field is being written, so
  // the next build could fill it.
  if (map.sourcesContent !== undefined) {
    const nonEmpty = Array.isArray(map.sourcesContent)
      ? map.sourcesContent.filter((c) => c != null).length
      : 0
    failures.push(
      `[sourcemap] ${rel} has sourcesContent (${nonEmpty} entr${nonEmpty === 1 ? 'y' : 'ies'} with text) -- ` +
        `the published maps would ship the source of every bundled file, the private workspace packages included`
    )
  }
}

// --- Every declared dependency should actually be used. A stale dependency ---
// --- is a supply-chain surface consumers install for nothing. Warn only:  ---
// --- being wrong here must not block a release.                          ---
const used = new Set()
for (const file of jsFiles) for (const spec of bareSpecifiers(readFileSync(file, 'utf8'))) used.add(spec)
for (const dep of declared) {
  if (!used.has(dep)) {
    console.warn(`publish-safety: warning: dependency "${dep}" is declared but never imported by the bundle`)
  }
}

if (failures.length > 0) {
  console.error(`\npublish-safety: ${failures.length} problem(s) in ${relative(packageDir, distDir)}:\n`)
  for (const f of failures) console.error(`  ${f}`)
  console.error('\nThis build must not be published. See scripts/assert-publish-safety.mjs for what each check protects.\n')
  process.exit(1)
}

console.log(`publish-safety: OK -- ${jsFiles.length} JS file(s), imports limited to [${[...used].sort().join(', ')}]`)
