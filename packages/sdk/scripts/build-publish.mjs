/**
 * Produce the publishable artifact in `dist-publish/`.
 *
 * `pnpm build:publish` runs, in order:
 *   1. the monorepo build (`pnpm build`) -- dist-publish's .d.ts rollup reads
 *      `dist/index.d.ts`, so the normal build must land first;
 *   2. tsup with tsup.publish.config.ts -- bundled ESM for the two entries;
 *   3. api-extractor dtsRollup, twice -- one .d.ts per entry point, with the
 *      private workspace packages inlined via `bundledPackages`;
 *   4. a generated package.json written INTO dist-publish;
 *   5. the publish-safety gate over the result.
 *
 * ## Why the manifest is generated rather than published in place
 *
 * The source package.json declares `@centrifuge/protocol` and
 * `@centrifuge/queries` as `workspace:*`. Both are `"private": true`, version
 * 0.1.0, and on no registry. `pnpm publish` rewrites `workspace:*` to the
 * local version, so publishing the source manifest ships a package whose
 * install fails for every consumer.
 *
 * The publish build inlines both, so the published manifest must NOT declare
 * them. Rather than mutate the source package.json during a release (a step
 * that can fail half-way and leave the repo dirty), the manifest is derived
 * here and written next to the artifact. `npm publish dist-publish/` then
 * publishes a directory whose manifest is correct by construction.
 *
 * Fields are copied by an ALLOWLIST. A denylist would mean every new field
 * added upstream ships by default, which is the wrong default for a manifest
 * that crosses a privacy boundary.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(packageDir, 'dist-publish')
const pkg = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))

const run = (cmd, args) =>
  execFileSync(cmd, args, { cwd: packageDir, stdio: 'inherit', env: process.env })

console.log('build:publish: monorepo build (produces dist/*.d.ts for the rollup)')
run('pnpm', ['run', 'build'])

console.log('build:publish: bundling ESM')
run('pnpm', ['exec', 'tsup', '--config', 'tsup.publish.config.ts'])

console.log('build:publish: rolling up type declarations')
run('pnpm', ['exec', 'api-extractor', 'run', '--config', 'api-extractor.publish.json'])
run('pnpm', ['exec', 'api-extractor', 'run', '--config', 'api-extractor.publish.backend.json'])

/**
 * The published manifest.
 *
 * `dependencies` is derived from what the ARTIFACT actually references, not
 * copied wholesale:
 *
 * - the two bundled workspace packages are dropped (they are inlined);
 * - `isomorphic-ws` and `tslib` are dropped: neither appears in the bundle or
 *   the rolled-up types. tslib is a tsc `importHelpers` artifact that esbuild
 *   does not need, and the ws shim is unreferenced from these entry points.
 *   A dependency a consumer installs for nothing is supply-chain surface.
 * - `@openzeppelin/merkle-tree` is KEPT even though the JS inlines it, because
 *   the rolled-up .d.ts imports its types. Dropping it would leave consumers
 *   with unresolvable types.
 * - `zod` is a PEER dependency, not a regular one. Its runtime is bundled
 *   (tsup.publish.config.ts), so nothing needs installing to RUN the SDK --
 *   that is what fixes bundlers resolving the package from outside their own
 *   node_modules (`link:`, `file:`, a monorepo). But zod types do reach the
 *   public surface through `QueryVars`, `RestRouteTable` and
 *   `BackendRoutingTable`, which resolve into the catalogue's zod schemas.
 *
 *   It is a peer because zod 3 and zod 4 render those schema types
 *   incompatibly (`z.core.$strict` and the object form of `z.ZodEnum` are
 *   zod-4 only; zod 4 in turn rejects zod 3's tuple enum), so no single
 *   spelling in the .d.ts satisfies both majors. A regular dependency would
 *   silently install a second zod and let a consumer typecheck against a
 *   different one than they use. A peer states the requirement instead of
 *   hiding it, and `peerDependenciesMeta.optional` keeps it from being an
 *   install error for the many consumers who never touch those three types
 *   (apps-v3 uses none of them).
 *
 * Versions are copied verbatim from the source manifest -- they are what the
 * bundle was built and tested against. The publish-safety gate cross-checks
 * this list against the artifact in both directions.
 *
 * No `files` field: the directory IS the package, so everything in it ships.
 * No `scripts`: a published package should not carry a `prepare` that runs in
 * a consumer's install.
 */
const DROPPED = [
  // Inlined by the publish bundle.
  '@centrifuge/protocol',
  '@centrifuge/queries',
  // Referenced by neither the bundle nor the rolled-up types.
  'isomorphic-ws',
  'tslib',
]



const dependencies = Object.fromEntries(
  Object.entries(pkg.dependencies).filter(([name]) => !DROPPED.includes(name))
)

const manifest = {
  name: pkg.name,
  version: pkg.version,
  description: pkg.description,
  homepage: pkg.homepage,
  repository: pkg.repository,
  license: pkg.license,
  author: pkg.author,
  type: 'module',
  main: './index.js',
  module: './index.js',
  types: './index.d.ts',
  typings: './index.d.ts',
  exports: {
    '.': { types: './index.d.ts', default: './index.js' },
    './backend': { types: './backend/index.d.ts', default: './backend/index.js' },
  },
  typesVersions: { '*': { backend: ['./backend/index.d.ts'] } },
  sideEffects: false,
  engines: pkg.engines,
  dependencies: Object.fromEntries(Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b))),
  // See the dependencies note above: bundled at runtime, needed only to
  // typecheck against the catalogue-derived types, and optional because most
  // consumers never name them.
  peerDependencies: { zod: '^3.25.0 || ^4.0.0' },
  peerDependenciesMeta: { zod: { optional: true } },
}

writeFileSync(join(outDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`build:publish: wrote dist-publish/package.json (${Object.keys(manifest.dependencies).length} deps)`)

for (const file of ['README.md', 'LICENSE']) {
  writeFileSync(join(outDir, file), readFileSync(join(packageDir, file)))
}

/**
 * Repair a known api-extractor rollup defect.
 *
 * `src/config/chains.ts` re-exports viem chain objects whose `serializers`
 * field is typed `typeof import("viem/chains").serializeTransactionOpStack`.
 * The per-module build (`tsc`) emits exactly that. The dtsRollup instead
 * imports the symbol as a VALUE and then uses it in type position:
 *
 *   import { serializeTransactionOpStack } from 'viem/chains';
 *   ...  readonly transaction: serializeTransactionOpStack;
 *
 * which every consumer's `tsc` rejects with TS2749 ("refers to a value, but
 * is being used as a type"). Caught by the type half of the consumer smoke
 * test; invisible to any check that only looks at the JS.
 *
 * Narrow by design, and loud if it stops applying: a patch that silently
 * matches nothing is how a workaround outlives the bug it worked around. Not
 * every entry point contains the pattern (only the ones that re-export the
 * chain list), so the assertion is across ALL entries, not each one.
 */
function repairRollupValueAsType(file) {
  const before = readFileSync(file, 'utf8')
  const after = before.replace(/(readonly transaction: )(serializeTransactionOpStack)(;)/g, '$1typeof $2$3')
  if (after !== before) writeFileSync(file, after)
  return after !== before
}

const entries = ['index.d.ts', 'backend/index.d.ts']
const repaired = entries.filter((entry) => repairRollupValueAsType(join(outDir, entry)))
if (repaired.length === 0) {
  throw new Error(
    'build-publish: the serializeTransactionOpStack rollup repair matched nothing in any entry point.\n' +
      'If api-extractor fixed the bug, delete repairRollupValueAsType(). If the shape changed, update it -- ' +
      'do not leave a silent no-op.'
  )
}
console.log(`build:publish: repaired rollup value-as-type declarations in ${repaired.join(', ')}`)

/**
 * zod must not appear in the artifact at all -- neither JS nor types.
 *
 * Runtime: it is bundled, so an external zod import would break any consumer
 * resolving the SDK from outside its own node_modules (a `link:`, a `file:`,
 * or a monorepo). That is the failure this started from:
 *   Rolldown failed to resolve import "zod"
 *
 * Types: zod 3 and zod 4 render the catalogue's schema types incompatibly
 * (`z.core.$strict` and the object form of `z.ZodEnum` are zod-4 only, and
 * zod 4 in turn rejects zod 3's tuple enum). No single spelling satisfies
 * both, so `QueryVars` is written to expand to a plain object type instead --
 * see src/data/DataSource.ts. If zod comes back here, a consumer pinned to
 * the other major cannot typecheck against the SDK.
 */
function assertZodIsTypeOnly() {
  const inJs = ['index.js', 'backend/index.js'].filter((f) =>
    /(?:from|require\()\s*["']zod["']/.test(readFileSync(join(outDir, f), 'utf8'))
  )
  if (inJs.length > 0) {
    throw new Error(
      `build-publish: zod is imported by the published JS (${inJs.join(', ')}).\n` +
        'It must stay bundled: an external zod breaks any consumer resolving the SDK from outside its own ' +
        'node_modules (link:/file:/monorepo), which is exactly the "failed to resolve import \'zod\'" bug.'
    )
  }
  const inTypes = ['index.d.ts', 'backend/index.d.ts'].some((f) =>
    /from\s*["']zod["']/.test(readFileSync(join(outDir, f), 'utf8'))
  )
  if (!inTypes) {
    throw new Error(
      'build-publish: zod is no longer referenced by the published types. Drop the zod peerDependency here ' +
        'rather than declaring a requirement consumers do not have. Do not leave a silent no-op.'
    )
  }
}
assertZodIsTypeOnly()
console.log('build:publish: zod is types-only (runtime bundled, declared as an optional peer)')


console.log('build:publish: verifying')
run('node', ['scripts/assert-publish-safety.mjs'])
