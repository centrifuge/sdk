// Root hooks for the Tenderly-fork suite (see .mocharc.fork.cjs).
//
// Wraps `src/tests/setup.ts`'s hook with a credential check so an unrun fork
// suite reports as PENDING rather than as a pass or as an opaque HTTP failure
// out of the Tenderly API. `this.skip()` is mocha's real skip API; a
// `console.warn` plus an early return would report every test in the suite as
// PASSING, which is strictly worse than not running it.
//
// Importing setup.js first is deliberate: `src/tests/tenderly.ts` calls
// `dotenv.config({ path: './src/tests/.env' })` at module scope, so the
// credentials from that file are in `process.env` before the check below runs.

import { mochaHooks as tenderlyHooks } from './src/tests/setup.js'

/** Everything `TenderlyFork.create()` reads. Missing any of them means no fork. */
const REQUIRED_ENV = ['TENDERLY_ACCESS_KEY', 'PROJECT_SLUG', 'ACCOUNT_SLUG']

export const mochaHooks = {
  async beforeAll() {
    const missing = REQUIRED_ENV.filter((name) => !process.env[name])
    if (missing.length > 0) {
      console.error(
        `[sdk fork suite] SKIPPED: no Tenderly credentials (missing ${missing.join(', ')}). ` +
          `Set them in packages/sdk/src/tests/.env to run these tests.`
      )
      // Marks every test in the root suite pending. Reported as "N pending".
      this.skip()
    }
    return await tenderlyHooks.beforeAll.call(this)
  },

  async afterAll() {
    // setup.ts's cleanup already guards on `context.tenderlyFork` being unset,
    // which is the state a skipped run leaves behind.
    return await tenderlyHooks.afterAll.call(this)
  },
}
