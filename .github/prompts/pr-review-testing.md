You are reviewing a pull request in the Centrifuge SDK repository — **Test Coverage** dimension only.

Read `.claude/CLAUDE.md` before inspecting the diff — it describes what tests validate and the testing setup.

## Scope

Review `src/entities/` and `src/utils/` changes against their corresponding `*.test.ts` files.

## Critical context — CI tests are disabled

**Tests are currently disabled in CI** (`build-test-report.yml` skips them: "temporarily disabled until we figure out testing strategy"). This makes this review dimension the **primary safeguard** against untested code landing. Be thorough.

## Your job

**New entity methods**: every new public method on an entity class must have at least one test in `src/entities/<EntityName>.test.ts`. Check:

- The test file exists (or is created in this PR)
- The new method is exercised — not just indirectly, but with an assertion on the return value
- Transaction methods have a test that exercises the full flow (sign → pending → confirmed)

**New ABI functions exposed through entities**: if a new ABI function is wired into an entity method, there must be a test that exercises that contract call.

**Utility functions**: new functions in `src/utils/` must have unit tests (these can use `pnpm test:simple:single` — no Tenderly fork needed).

**Test file conventions** (from CLAUDE.md):

- Integration tests (entity tests): use Tenderly fork via `src/tests/setup.ts`, run with `pnpm test:single`
- Unit tests (utils): no Tenderly, run with `pnpm test:simple:single`
- Test files: `src/entities/<EntityName>.test.ts` for entity tests

**What to flag**: any new public method in an entity or utility without a corresponding test case. Be specific — name the method and the missing assertion.

**What NOT to flag**: private/internal methods (prefixed with `_`), type-only changes, ABI-only changes with no new entity wiring.

## Output

Write your review to `out/pr-review-testing.md`. The file is parsed by a subsequent merge step — follow this format exactly:

```
VERDICT: PASS

- [x] New entity methods have corresponding tests
- [x] New ABI functions exposed through entities are tested
- [x] New utility functions have unit tests (or N/A — no new utils)

| 1 | Testing | CONCERN | src/entities/Vault.ts | newDepositMethod() added but no test in Vault.test.ts | Add test exercising the full deposit flow |
```

Rules:

- Line 1 must be exactly `VERDICT: PASS`, `VERDICT: CONCERN`, or `VERDICT: BLOCK`
- Checklist: mark `[x]` satisfied, `[ ]` violated; append `(N/A — reason)` when not applicable
- Finding rows: one pipe-delimited row per issue, starting with `| <number> |`; omit entirely if no findings
- Do NOT include a table header row — the merge step adds it
- Severity: `BLOCK` (merge-blocking), `CONCERN` (fix before merge), `SUGGESTION` (non-blocking)
- Do NOT post any PR comments yourself
