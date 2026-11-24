import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'esbuild'
import { defineConfig } from 'tsup'

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The address book verifies registry layers with `ipfs-unixfs-importer` and
 * `multiformats`' node SHA-256. The first requires `fs` and the second
 * `crypto`, neither of which a neutral-platform bundle can carry.
 * `loadAddressBook({ book })` never walks a registry, so both resolve to a
 * module that throws if the walk is ever run. The bundle still holds the walk
 * code, so the stub must export every named import it uses.
 */
const bookVerificationUnavailable: Plugin = {
  name: 'book-verification-unavailable',
  setup(build) {
    build.onResolve({ filter: /^(ipfs-unixfs-importer(\/.*)?|multiformats\/hashes\/sha2)$/ }, ({ path }) => ({
      path,
      namespace: 'unavailable',
    }))
    build.onLoad({ filter: /.*/, namespace: 'unavailable' }, ({ path }) => ({
      loader: 'js',
      contents: [
        `const unavailable = () => { throw new Error('${path} is not bundled in @centrifuge/sdk') }`,
        'export const importer = unavailable',
        'export const balanced = unavailable',
        'export const fixedSize = unavailable',
        'export const sha256 = { digest: unavailable }',
      ].join('\n'),
    }))
  },
}

/**
 * Publish build for @centrifuge/sdk (`pnpm build:publish` -> `dist-publish/`).
 *
 * Separate from tsup.config.ts on purpose. That build is the MONOREPO build:
 * per-module output mirroring src/ one-to-one, tests included, consumed inside
 * this workspace where `@centrifuge/protocol` and `@centrifuge/queries` resolve
 * through pnpm symlinks. It is correct there and is left untouched.
 *
 * It cannot be published, for two reasons:
 *
 * 1. `@centrifuge/protocol` and `@centrifuge/queries` are `"private": true`,
 *    version 0.1.0, and are not on any registry. `bundle: false` emits bare
 *    `from "@centrifuge/protocol"` imports, and `pnpm publish` rewrites
 *    `workspace:*` to `0.1.0`, so every consumer install would fail to
 *    resolve. Publishing those two packages instead would mean versioning and
 *    releasing three packages forever, for code that has no independent
 *    consumers.
 * 2. The per-module build ships the test suite (68 `*.test.js` files under the
 *    old `files: ["dist"]`). Test fixtures are a far more common source of
 *    accidental disclosure than source is.
 *
 * So the publish build bundles the two workspace packages IN (`noExternal`)
 * and emits only the two real entry points. The address book they read is
 * bundled too, because it is not in `external`; `assert-publish-safety.mjs`
 * refuses a manifest that declares it.
 * Third-party runtime deps stay external and are declared in package.json
 * `dependencies`, so consumers still dedupe viem/rxjs against their own
 * copies.
 *
 * WHAT GETS BUNDLED IS A DISCLOSURE DECISION, not just a packaging one --
 * `@centrifuge/queries` also contains `./sql`, a Drizzle adapter over
 * `chain_v1` that imports `@centrifuge/public-db` and describes the chain-public
 * database schema. The SDK imports only `./core`, `./graphql` and `./rest`,
 * never the root barrel (which re-exports `./sql`) and never `./sql` itself,
 * so tree-shaking from these entry points leaves it out. That is enforced,
 * not assumed: `scripts/assert-publish-safety.mjs` fails the build if any
 * backend-only marker reaches the bundle. Never add `src/index.ts` -> `./sql`
 * without reading that script first. The address book ships whole: every
 * address it lists is in the published bundle.
 */
export default defineConfig({
  entry: { index: 'src/index.ts', 'backend/index': 'src/backend/index.ts' },
  format: ['esm'],
  bundle: true,
  // Each entry is self-contained. Shared chunks would be a third published
  // file that neither `exports` entry names, so the export map stays honest.
  splitting: false,
  sourcemap: true,
  clean: true,
  // .d.ts comes from api-extractor's dtsRollup, not from tsup -- see
  // scripts/build-publish.mjs.
  dts: false,
  outDir: 'dist-publish',
  target: 'es2023',
  platform: 'neutral',
  // Inline the two private workspace packages. This is the whole point of
  // this config: without it the published bundle keeps unresolvable imports.
  noExternal: [/^@centrifuge\/(protocol|queries)/],
  // ...but bundle `@centrifuge/protocol` and `@centrifuge/queries` FROM
  // SOURCE, not from their dist. (The address book is bundled from its ESM
  // dist. The plugin above stubs its verification imports: a named import the
  // stub does not export fails this build, so add it there.)
  //
  // Protocol and queries both build to CommonJS (`"module": "commonjs"`),
  // which the backend needs. Bundling their dist into an ESM artifact makes
  // esbuild emit its `__require` interop shim, and that shim throws at import
  // time:
  //   Error: Dynamic require of "viem" is not supported
  // The published package is ESM-only, so the CJS entry points must never be
  // the ones bundled. Resolving the package names to their `src/index.ts`
  // sidesteps the interop entirely -- esbuild compiles the TypeScript
  // directly into the ESM output.
  //
  // Caught by the consumer smoke test in scripts/verify-publish-artifact.mjs,
  // not by any static check: the bundle looked correct and failed only when
  // imported. Do not remove that test.
  esbuildPlugins: [bookVerificationUnavailable],
  esbuildOptions(options) {
    options.sourcesContent = false
    options.alias = {
      ...options.alias,
      '@centrifuge/protocol': resolve(workspaceRoot, 'protocol/src/index.ts'),
      '@centrifuge/queries/core': resolve(workspaceRoot, 'queries/src/core/index.ts'),
      '@centrifuge/queries/graphql': resolve(workspaceRoot, 'queries/src/graphql/index.ts'),
      '@centrifuge/queries/rest': resolve(workspaceRoot, 'queries/src/rest/index.ts'),
    }
  },
  // Everything here must appear in package.json `dependencies` -- the safety
  // script cross-checks both directions.
  //
  // `zod` is deliberately NOT here: it is bundled. It is an implementation
  // detail of `@centrifuge/queries/core` (which validates catalogue params
  // with it), appears nowhere in the API report, and no public export hands a
  // zod schema to callers. Leaving it external made it a consumer-visible
  // peer: apps-v3 pins zod 3 while queries needs zod 4, and a bundler
  // resolving the SDK from outside its own node_modules (a `link:` or a
  // monorepo `file:`) fails outright with
  //   Rolldown failed to resolve import "zod"
  // Bundling it makes the artifact self-contained and lets consumers keep
  // whatever zod they already use. Do not move it back without checking
  // whether a zod type has entered the public .d.ts.
  external: ['viem', 'rxjs', 'decimal.js-light', '@openzeppelin/merkle-tree', 'isomorphic-ws', 'tslib'],
})
