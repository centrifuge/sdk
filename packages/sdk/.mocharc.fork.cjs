// Tenderly-fork suite for @centrifuge/sdk (`pnpm test:fork`).
//
// These eleven files import `src/tests/setup.js`, whose root hook forks Sepolia
// on Tenderly before anything runs. That is what keeps them out of the fast
// suite (`.mocharc.unit.cjs` excludes exactly this list), and it is a reason to
// run them SEPARATELY rather than not at all -- every `src/**/*.test.ts` is
// named by one project or the other.
//
// `mocha-fork-hooks.mjs` wraps the setup hook so that a missing Tenderly
// credential produces PENDING tests via mocha's own `this.skip()`, never a
// warn-and-return that reports as a pass.

module.exports = {
  extension: ['ts'],
  require: ['./mocha-fork-hooks.mjs'],
  spec: [
    'src/Centrifuge.test.ts',
    'src/entities/BalanceSheet.test.ts',
    'src/entities/Investor.test.ts',
    'src/entities/MerkleProofManager.test.ts',
    'src/entities/OnOffRampManager.test.ts',
    'src/entities/Pool.test.ts',
    'src/entities/PoolNetwork.test.ts',
    'src/entities/Reports/PoolSharePricesReport.test.ts',
    'src/entities/Reports/PoolShareYieldsReport.test.ts',
    'src/entities/ShareClass.test.ts',
    'src/entities/Vault.test.ts',
  ],
  timeout: 30000,
  exit: true,
}
