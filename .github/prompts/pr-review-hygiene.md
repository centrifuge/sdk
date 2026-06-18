You are reviewing a pull request in the Centrifuge SDK repository — **Public API & Hygiene** dimension only.

Read `.claude/CLAUDE.md` before inspecting the diff.

## Scope

Check `src/index.ts`, `src/abi/index.ts`, PR metadata, and code comments across all changed files.

## Already enforced by CI — do NOT re-check

`pnpm build` runs in CI. Naming conventions and pinned actions are checked by separate CI workflows.

## Your job

**Public API exports**: if a new entity class or public type is added, it must be exported from `src/index.ts`. If it's intentionally internal, it must be tagged `@internal` in JSDoc. Flag new classes/types that are neither exported nor tagged `@internal`.

**ABI index registration**: if a new `src/abi/*.abi.ts` file is added, it must have a corresponding entry in `src/abi/index.ts` (parsed via `viem.parseAbi()` and added to the `ABI` object). This is a quick double-check in case the ABI dimension missed it.

**Conventional Commits**: check the PR title via `gh pr view`. It must follow `type: description` format (`feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`, `build:`, etc.). The SDK uses semantic versioning labels tied to commit type, so a wrong type can cause incorrect version bumps.

**No narrating comments**: flag comment blocks that describe what the next line does. Only comments explaining a non-obvious WHY are acceptable — a hidden constraint, a protocol quirk, a workaround for a specific viem/RxJS edge case. Multi-line docstrings on obvious methods are always wrong.

**Prettier**: the SDK has `pnpm format` but no Prettier gate in CI. Flag obvious formatting issues if present, but keep this SUGGESTION severity — it's non-blocking.

## Output

Write your review to `out/pr-review-hygiene.md`. The file is parsed by a subsequent merge step — follow this format exactly:

```
VERDICT: PASS

- [x] New entities/types exported from src/index.ts or tagged @internal
- [x] New ABI files registered in src/abi/index.ts (or N/A — no new ABI files)
- [x] PR title follows Conventional Commits

| 1 | Hygiene | CONCERN | src/entities/NewEntity.ts | NewEntity class not exported from src/index.ts and not tagged @internal | Export from src/index.ts or add @internal JSDoc |
```

Rules:

- Line 1 must be exactly `VERDICT: PASS`, `VERDICT: CONCERN`, or `VERDICT: BLOCK`
- Checklist: mark `[x]` satisfied, `[ ]` violated; append `(N/A — reason)` when not applicable
- Finding rows: one pipe-delimited row per issue, starting with `| <number> |`; omit entirely if no findings
- Do NOT include a table header row — the merge step adds it
- Severity: `BLOCK` (merge-blocking), `CONCERN` (fix before merge), `SUGGESTION` (non-blocking)
- Do NOT post any PR comments yourself
