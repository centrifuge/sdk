/**
 * Install the publish artifact into a throwaway project and use it.
 *
 * `scripts/assert-publish-safety.mjs` reads the bundle. This script RUNS it,
 * which is a different question. Both bugs found while building this pipeline
 * were invisible to static inspection and failed the moment a consumer
 * imported the package:
 *
 * 1. `@centrifuge/protocol` and `@centrifuge/queries` build to CommonJS. When
 *    the publish bundle inlined their `dist` output, esbuild wrapped it in a
 *    `__require` interop shim that throws at import time:
 *      Error: Dynamic require of "viem" is not supported
 *    The bundle looked correct; nothing resolved outside the tarball.
 *
 * 2. api-extractor's dtsRollup emitted
 *      import { serializeTransactionOpStack } from 'viem/chains'
 *    and then used that VALUE in type position, so every consumer's `tsc`
 *    failed with TS2749 -- while the JS ran fine.
 *
 * 3. zod was left external, so a bundler resolving the SDK from outside its
 *    own node_modules (apps-v3 links it) failed with
 *      Rolldown failed to resolve import "zod"
 *    It is bundled now, and declared only as an optional PEER because zod 3
 *    and zod 4 render the catalogue's schema types incompatibly. Hence the
 *    matrix below: the runtime must work with NO zod installed at all, and
 *    the default-import typecheck must pass on whichever major a consumer
 *    brings.
 *
 * So: pack, install from the tarball into a temp dir with no workspace and no
 * pnpm symlinks, import both entry points at RUNTIME, and typecheck a
 * consumer file against the shipped .d.ts with `skipLibCheck: false`.
 *
 * Run: `pnpm --filter @centrifuge/sdk run verify:publish`
 * (requires `pnpm build:publish` first; CI runs both in the sdk job).
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(packageDir, 'dist-publish')

if (!existsSync(join(outDir, 'package.json'))) {
  console.error('verify:publish: no artifact -- run `pnpm build:publish` first.')
  process.exit(1)
}

const workDir = mkdtempSync(join(tmpdir(), 'centrifuge-sdk-verify-'))
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'pipe', encoding: 'utf8' })

try {
  console.log('verify:publish: packing')
  const packed = run('npm', ['pack', '--pack-destination', workDir], outDir).trim().split('\n').pop()
  const tarball = join(workDir, packed)

  // A bare npm project: no workspace, no pnpm store, no symlinks back into
  // the monorepo. If the package needs anything the manifest does not
  // declare, the install or the import fails here.
  writeFileSync(
    join(workDir, 'package.json'),
    JSON.stringify({ name: 'verify-consumer', version: '1.0.0', type: 'module', private: true }, null, 2)
  )

  // No zod is installed here on purpose: it is an OPTIONAL peer, and the
  // runtime must work without it. If the bundle ever re-externalises zod,
  // the runtime smoke test below fails to import.
  console.log('verify:publish: installing the tarball into a clean project (no zod)')
  run('npm', ['install', '--silent', '--no-audit', '--no-fund', '--legacy-peer-deps', tarball], workDir)

  // --- Runtime: both entry points must import and work. ---
  writeFileSync(
    join(workDir, 'smoke.mjs'),
    [
      "import { Centrifuge, PoolId, ABI } from '@centrifuge/sdk'",
      "import { createBackendCentrifuge } from '@centrifuge/sdk/backend'",
      "const c = new Centrifuge({ environment: 'testnet' })",
      "if (typeof c.protocolContext !== 'function') throw new Error('protocolContext missing')",
      "if (typeof c.pool(PoolId.from(1, 1)).then !== 'function') throw new Error('pool query missing')",
      "if (typeof createBackendCentrifuge !== 'function') throw new Error('backend subpath missing')",
      "if (Object.keys(ABI).length === 0) throw new Error('bundled protocol ABIs are empty')",
      "console.log('runtime OK')",
    ].join('\n')
  )
  const runtime = run('node', ['smoke.mjs'], workDir)
  if (!runtime.includes('runtime OK')) throw new Error(`runtime smoke test produced no success line:\n${runtime}`)
  console.log('verify:publish: runtime OK (both entry points import and work)')

  // --- Types: a consumer must be able to typecheck against the shipped .d.ts. ---
  // `skipLibCheck: false` on purpose: skipping is what hides a broken rollup.
  writeFileSync(
    join(workDir, 'consumer.ts'),
    [
      "import { Centrifuge, PoolId } from '@centrifuge/sdk'",
      "import { createBackendCentrifuge } from '@centrifuge/sdk/backend'",
      "const c = new Centrifuge({ environment: 'testnet' })",
      'export const uri = c.pool(PoolId.from(1, 1)).then((p) => p.metadataUri())',
      'export const ctx = c.protocolContext(1)',
      'export { createBackendCentrifuge }',
    ].join('\n')
  )
  writeFileSync(
    join(workDir, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          module: 'esnext',
          target: 'es2022',
          moduleResolution: 'bundler',
          strict: true,
          noEmit: true,
          skipLibCheck: false,
        },
        include: ['consumer.ts'],
      },
      null,
      2
    )
  )

  const tsVersion = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')).devDependencies.typescript
  run('npm', ['install', '--silent', '--no-audit', '--no-fund', '-D', `typescript@${tsVersion}`], workDir)

  // Typecheck against BOTH zod majors. The consumer file imports only what a
  // normal app imports, so this is the realistic case -- and it is what
  // caught zod-4-only constructs (`z.core.$strict`, the object form of
  // `z.ZodEnum`) reaching the published types.
  //
  // The two majors are checked at DIFFERENT strictness, and that asymmetry is
  // the contract, not a fudge:
  //
  // - zod 4 (what the catalogue is built with) must pass with
  //   `skipLibCheck: false` -- nothing in the shipped types may be broken.
  // - zod 3 must pass with `skipLibCheck: true`, the default in every app
  //   template and what apps-v3 uses. It CANNOT pass with lib checking on:
  //   the catalogue's schema types render as `z.core.$strict` and the object
  //   form of `z.ZodEnum`, neither of which exists in zod 3. Those types are
  //   reachable only through `QueryVars`, `RestRouteTable` and
  //   `BackendRoutingTable`; an app that imports none of them (apps-v3
  //   imports none) is unaffected either way.
  //
  // If zod 3 support ever has to be unconditional, the fix is upstream in
  // `@centrifuge/queries` -- expose the catalogue's param types structurally
  // instead of as zod schema types -- not another rewrite of the .d.ts.
  const tsc = join(workDir, 'node_modules', '.bin', 'tsc')
  const writeTsconfig = (skipLibCheck) =>
    writeFileSync(
      join(workDir, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: {
            module: 'esnext',
            target: 'es2022',
            moduleResolution: 'bundler',
            strict: true,
            noEmit: true,
            skipLibCheck,
          },
          include: ['consumer.ts'],
        },
        null,
        2
      )
    )

  for (const { version, skipLibCheck } of [
    { version: '4.4.3', skipLibCheck: false },
    { version: '3.25.76', skipLibCheck: true },
  ]) {
    console.log(
      `verify:publish: typechecking against zod@${version} (skipLibCheck: ${skipLibCheck}, typescript@${tsVersion})`
    )
    run('npm', ['install', '--silent', '--no-audit', '--no-fund', '--legacy-peer-deps', `zod@${version}`], workDir)
    writeTsconfig(skipLibCheck)
    run(tsc, ['--noEmit', '-p', 'tsconfig.json'], workDir)
  }
  console.log('verify:publish: types OK on zod 4 (strict) and zod 3 (skipLibCheck)')

  console.log('\nverify:publish: artifact is installable, importable and typecheckable.')
} catch (error) {
  const detail = error.stdout || error.stderr || error.message
  console.error('\nverify:publish: FAILED -- this artifact must not be published.\n')
  console.error(detail)
  console.error(`\nThe failing project was left at ${workDir} for inspection.`)
  process.exit(1)
}

rmSync(workDir, { recursive: true, force: true })
