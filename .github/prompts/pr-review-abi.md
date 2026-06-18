You are reviewing a pull request in the Centrifuge SDK repository — **ABI Correctness** dimension only.

Read `.claude/CLAUDE.md` before inspecting the diff — it is the authoritative reference for ABI format rules and the post-update checklist.

## Scope

Review only files under `src/abi/` and any entity files in `src/entities/` that reference changed ABIs.

## Already enforced by CI — do NOT re-check

`pnpm build` (TypeScript strict compile) runs in CI. Don't re-verify type errors it would catch.

## Your job

**ABI file format**: every `src/abi/*.abi.ts` file must:

- Export a default array of human-readable strings: `export default [...] as const`
- Use human-readable format: `'function name(type param) view returns (type)'`
- Include only functions, events, and errors actually used in the SDK (no full contract dumps)
- Use correct Solidity ABI types (`uint256` not `uint`, `address`, `bytes32`, etc.)

**Registration**: any new `src/abi/*.abi.ts` file must have a corresponding export in `src/abi/index.ts` via `viem.parseAbi()` so it is reachable as `ABI.ContractName`.

**No stale references**: if a function is removed from an ABI file, verify it is no longer called in any entity. A removed function that is still called will compile fine but revert on-chain.

**Post-ABI-change checklist** (from `.claude/CLAUDE.md`): when an ABI is added or modified, flag if any of these are missing from the PR:

1. Entity class updated to use new/changed functions
2. Removed functions no longer referenced in entities
3. New functions have test coverage
4. Breaking changes noted in the PR description

**No inline ABIs**: entity files must never define ABI arrays inline. All contract interactions must go through `ABI.ContractName` imported from `src/abi/index.ts`.

## Output

Write your review to `out/pr-review-abi.md`. The file is parsed by a subsequent merge step — follow this format exactly:

```
VERDICT: PASS

- [x] ABI files follow human-readable format with `as const`
- [x] New ABI files registered in src/abi/index.ts (or N/A — no new ABI files)
- [x] Removed functions no longer referenced in entities (or N/A — no removals)
- [x] Post-ABI-change checklist satisfied (or N/A — no ABI changes)

| 1 | ABI | BLOCK | src/abi/Hub.abi.ts | Function removed from ABI but still called in Pool.ts | Remove reference in Pool.ts line 142 |
```

Rules:

- Line 1 must be exactly `VERDICT: PASS`, `VERDICT: CONCERN`, or `VERDICT: BLOCK`
- Checklist: mark `[x]` satisfied, `[ ]` violated; append `(N/A — reason)` when not applicable
- Finding rows: one pipe-delimited row per issue, starting with `| <number> |`; omit entirely if no findings
- Do NOT include a table header row — the merge step adds it
- Severity: `BLOCK` (merge-blocking), `CONCERN` (fix before merge), `SUGGESTION` (non-blocking)
- Do NOT post any PR comments yourself
