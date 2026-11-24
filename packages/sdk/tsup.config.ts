import { transform } from 'esbuild'
import { readFileSync, writeFileSync } from 'node:fs'
import { defineConfig } from 'tsup'

/**
 * Monorepo build for @centrifuge/sdk.
 *
 * The published artifact is per-module ESM output mirroring src/ one-to-one
 * (tests included), with sourcemaps that ship without sourcesContent.
 *
 * - JS + .js.map come from tsup (esbuild, bundle: false, per-file emit).
 * - .d.ts + .d.ts.map come from `tsc -p tsconfig.build.json`
 *   (emitDeclarationOnly), run after tsup by the package build script.
 * - src/tests/forkServer.mjs is passed through esbuild's transform in
 *   onSuccess so dist keeps forkServer.mjs + forkServer.mjs.map: tsup's entry
 *   globs would otherwise rename it to .js.
 */
export default defineConfig({
  entry: ['src/**/*.ts', '!src/**/*.d.ts'],
  format: ['esm'],
  bundle: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: false,
  outDir: 'dist',
  target: 'es2023',
  platform: 'neutral',
  esbuildOptions(options) {
    // The published sourcemaps must not embed source text.
    options.sourcesContent = false
  },
  onSuccess: async () => {
    const source = readFileSync('src/tests/forkServer.mjs', 'utf8')
    const result = await transform(source, {
      loader: 'js',
      format: 'esm',
      target: 'es2023',
      sourcemap: true,
      sourcesContent: false,
      sourcefile: '../../src/tests/forkServer.mjs',
    })
    writeFileSync(
      'dist/tests/forkServer.mjs',
      `${result.code}//# sourceMappingURL=forkServer.mjs.map\n`
    )
    writeFileSync('dist/tests/forkServer.mjs.map', result.map)
  },
})
