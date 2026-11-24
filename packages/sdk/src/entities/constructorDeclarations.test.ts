import { expect } from 'chai'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Entity constructors must stay out of the `@internal` strip.
 *
 * `tsconfig.json` sets `stripInternal`, so a constructor marked `/** @internal *\/` is
 * removed from the emitted `.d.ts`. That does not stop anyone constructing the class — it
 * just deletes the only accurate signature, and TypeScript then falls back to the base
 * `Entity(_root, queryKeys: (string | number)[])`, which every entity subclass inherits and
 * which is public.
 *
 * So the tag did not hide construction, it mistyped it: `new Pool(root, poolId)` reported
 * "Argument of type 'PoolId' is not assignable to parameter of type '(string | number)[]'",
 * and `new PoolNetwork(root, pool, centrifugeId)` reported "Expected 2 arguments, but got 3"
 * — both wrong, and both about a signature the author never wrote. Consumers had to silence
 * them, which is worse than either hiding or declaring the constructor properly.
 *
 * If direct construction should really be discouraged, the lever is documentation or a
 * factory, not a stripped declaration that leaves a misleading one behind.
 */
describe('entities — constructor declarations', () => {
  const ENTITY_DIR = 'src/entities'

  it('does not strip any entity constructor from the emitted types', () => {
    const offenders: string[] = []

    for (const file of readdirSync(ENTITY_DIR)) {
      if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue
      const source = readFileSync(join(ENTITY_DIR, file), 'utf8')

      // A stripped constructor is an `@internal` tag on the line(s) directly above it.
      if (/\/\*\* @internal \*\/\s*\n\s*constructor\(/.test(source)) {
        offenders.push(file)
      }
    }

    expect(
      offenders,
      'these entity constructors are marked @internal, so stripInternal removes them from ' +
        'the .d.ts and consumers fall back to the base Entity signature — which is public, ' +
        'wrong for every subclass, and cannot be satisfied'
    ).to.deep.equal([])
  })

  it('still finds constructors to check, so the pattern has not gone stale', () => {
    const withConstructors = readdirSync(ENTITY_DIR).filter(
      (file) =>
        file.endsWith('.ts') &&
        !file.endsWith('.test.ts') &&
        /\n\s*constructor\(/.test(readFileSync(join(ENTITY_DIR, file), 'utf8'))
    )
    // Guards the regex above: if entity construction is ever restructured away from
    // constructors, this test should be revisited rather than silently passing on nothing.
    expect(withConstructors.length, 'no entity declares a constructor — has the shape changed?').to.be.greaterThan(5)
  })
})
