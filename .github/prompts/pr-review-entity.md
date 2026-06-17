You are reviewing a pull request in the Centrifuge SDK repository — **Entity & Observable Pattern** dimension only.

Read `.claude/CLAUDE.md` before inspecting the diff — it is the authoritative reference for entity structure, observable patterns, Balance/Price/Rate usage, and viem conventions.

## Scope

Review files under `src/entities/`, `src/Centrifuge.ts`, and `src/utils/`.

## Already enforced by CI — do NOT re-check

`pnpm build` (TypeScript strict compile with `noUncheckedIndexedAccess`) runs in CI. Don't re-verify type errors it would catch.

## Your job

**Entity structure**: every class in `src/entities/` must:

- Extend `Entity` (imported from `./Entity.js`)
- Call `super(_root, [...cacheKeyComponents])` in constructor with a unique key hierarchy
- Cache keys must be unique per query within the entity's hierarchy — duplicate keys cause stale cache hits

**Query methods**: methods that fetch data must:

- Use `this._query([keys], () => Observable<T>)` — never return raw Promises or values directly
- Return `Observable<T>` (the return value of `_query()`)
- Cache key arrays must be meaningful and unique per query

**Transaction methods**: methods that write to chain must:

- Use `this._transact(function*(this: EntityClass) { ... }.bind(this))`
- Yield transaction steps via `doTransaction()` helper
- Return an Observable of transaction status

**Balance/Price/Rate**: all on-chain numeric values must use typed wrappers:

- `Balance` for token amounts (constructed with decimals: `new Balance(bigintValue, decimals)` or `Balance.fromFloat(float, decimals)`)
- `Price` for asset prices (`Price.fromFloat(1.05)`)
- `Rate` for percentages/rates (`Rate.fromFloat(5.0)`)
- Raw `bigint` returns from entity methods are always wrong — flag them

**Viem contracts**: contract interactions must:

- Use `getContract({ address, abi: ABI.ContractName, client })` — never define inline ABI arrays
- Never call `readContract` / `writeContract` directly; always go through the typed contract instance
- Import `ABI` from `'../abi/index.js'` (not from individual ABI files)

**ESM imports**: all local imports must use `.js` extension (even for `.ts` source files). Missing `.js` extensions break ESM resolution at runtime even though TypeScript compiles fine.

**Public API exports**: new entity classes must be exported from `src/index.ts`. New types used in public method signatures must also be exported.

## Output

Write your review to `out/pr-review-entity.md`. The file is parsed by a subsequent merge step — follow this format exactly:

```
VERDICT: PASS

- [x] Entity extends Entity base class with correct super() call
- [x] Query methods use this._query() returning Observable<T>
- [x] Transaction methods use this._transact(function*())
- [x] Balance/Price/Rate used for all on-chain values (no raw bigint)
- [x] viem getContract used with ABI.X (no inline ABIs)
- [x] All local imports have .js extension
- [x] New entities exported from src/index.ts (or N/A — no new entities)

| 1 | Entity | BLOCK | src/entities/Vault.ts | someQuery() returns raw bigint instead of Balance | Wrap with new Balance(result, decimals) |
```

Rules:

- Line 1 must be exactly `VERDICT: PASS`, `VERDICT: CONCERN`, or `VERDICT: BLOCK`
- Checklist: mark `[x]` satisfied, `[ ]` violated; append `(N/A — reason)` when not applicable
- Finding rows: one pipe-delimited row per issue, starting with `| <number> |`; omit entirely if no findings
- Do NOT include a table header row — the merge step adds it
- Severity: `BLOCK` (merge-blocking), `CONCERN` (fix before merge), `SUGGESTION` (non-blocking)
- Do NOT post any PR comments yourself
