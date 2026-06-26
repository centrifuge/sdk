# Build-Only Transaction API

**Status:** Implemented (Phases 1–3; §8 pinning hardening tracked separately)
**Author:** Jeremiah McCurdy
**Date:** 2026-06-11
**Related:** `centrifuge/backend` → `docs/design/sdk-vs-native-tx-builder.md`

This document specifies a **build-only** transaction API for the SDK: a way to
produce the **unsigned calldata** for any transaction-producing method without a
signer, without simulation, and without broadcasting. It explains what it is,
why the SDK needs it, what it solves, how it functions against the current
internals, and a phased implementation strategy.

For how to _use_ the SDK today, see [SDK_USAGE.md](./SDK_USAGE.md). For
SDK-internal development conventions, see [CLAUDE.md](../CLAUDE.md).

---

## 1. What it is

A first-class method that returns the raw, unsigned transaction envelope a
method _would_ send, instead of signing and broadcasting it:

```typescript
const built = await centrifuge.buildOnly(pool.updatePoolMetadata(input))
// built: BuiltTransaction
// {
//   centrifugeId: number
//   chainId: number
//   to: HexString            // target contract
//   data: HexString          // calldata (multicall(bytes[]) when batched)
//   value: bigint            // wei to send
//   calls: BuiltCall[]       // decoded inner calls (one per wrapped call)
//   messages?: Record<number, MessageTypeWithSubType[]>  // cross-chain msgs, for fee estimation
// }
```

It is the inverse of the existing signing flow: every tx method already builds
calldata internally and then signs it. `buildOnly` stops at the calldata.

Key properties:

- **No signer required.** It does not call `setSigner`, does not need an
  account, and never touches a `WalletClient`.
- **Side-effect-free on chain.** No broadcast, no nonce consumption.
- **Runs the full build logic.** Marketplace catalog parsing, merkle-tree
  construction, weiroll encoding, IPFS pinning, address resolution — all the
  work that lives inside the method runs, because that work _is_ what produces
  the bytes.
- **Returns data, not an Observable.** Unlike `Transaction`, the result is a
  plain awaited value — there is no lifecycle to subscribe to.

## 2. Why the SDK needs it

### 2.1 The driving consumer: the Centrifuge backend

The `centrifuge/backend` repo (`apps/private-api`) is moving on-chain
transaction construction out of the browser and into the backend, where
transactions are signed via **Fordefi** (custodial, multi-approver) rather than
a user's wallet. The backend's flow is: **build unsigned calldata → run policy /
decode / simulate → route to Fordefi or WalletConnect → persist → broadcast.**

The backend needs **only the first step** from the SDK — the unsigned bytes. It
owns everything after that (custody, policy, auth, persistence), and that
ownership must **not** leak into the SDK, because the SDK is the public interface
external partners build on.

Today the backend's options are both bad:

1. **Re-implement encoding natively** (its current path). This duplicates the
   most complex SDK logic — the workflow/marketplace/weiroll encoding in
   `MerkleProofManager`, `catalog`, `weiroll`, `workflowExecute` (~100 KB of
   code) — and forces byte-equal-fixture tests to chase every SDK release. This
   is the maintenance burden the backend memo documents.
2. **Abuse `batchTransactions([oneTx])`** as a de-facto build-only call. This
   works (see §4) but depends on a side-effect of the batching machinery, still
   requires a signer to be set, and treats an internal yield shape as a public
   contract.

A named `buildOnly` makes option 3 — _use the SDK as a calldata factory behind a
clean API_ — the obvious choice.

### 2.2 The general case: any non-EOA custody

The need is not backend-specific. **Any** consumer that signs somewhere other
than an in-process EOA/EIP-1193 wallet has the same shape:

- custodial / MPC signers (Fordefi, Fireblocks, etc.)
- multisig proposal flows (Safe) that want the raw tx to propose
- offline / air-gapped signing
- transaction simulation or gas analysis in tooling and tests
- partners who present a "review the calldata before you sign" UX

All of them want "give me the bytes; I'll handle signing." The SDK currently
assumes the signer is reachable in-process. `buildOnly` removes that assumption
for the construction step.

## 3. What it solves

| Problem today                                                           | With `buildOnly`                                                        |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Complex encoding (workflows/weiroll) duplicated in downstream consumers | One source of truth — the SDK — invoked behind a stable method          |
| "Build without signing" only available via the batching side-effect     | A named, documented, tested API with a typed return                     |
| `_transact` requires a signer even when only building (see §4)          | No signer needed; construction is decoupled from signing                |
| Downstream byte-equal fixture tests chase every SDK release             | Downstream pins the SDK version and consumes its output directly        |
| Non-EOA custody (Fordefi, Safe, MPC) is awkward                         | First-class: get bytes → sign anywhere                                  |
| In-house dogfooding of the partner-facing SDK is discouraged            | The backend becomes the first consumer of the partner-facing build path |

It explicitly does **not** try to solve: signing, custody, policy enforcement,
authorization, persistence, or broadcast. Those belong to the consumer. The SDK
stays a calldata factory.

## 4. How it functions against the current internals

The build path already exists inside the SDK — `buildOnly` exposes it cleanly.
Here is the relevant machinery as it stands.

### 4.1 The existing build path (`wrapTransaction` batching branch)

Every tx-producing method funnels through `wrapTransaction`
(`src/utils/transaction.ts`). When `ctx.isBatching` is true it **yields the
unsigned calldata instead of signing**:

```typescript
// src/utils/transaction.ts — wrapTransaction
if (ctx.isBatching) {
  yield {
    contract,
    data, // HexString[]
    value: value_,
    messages,
  } // BatchTransactionData — this is unsigned calldata
} else {
  // ...doTransaction(): signs + broadcasts via walletClient
}
```

`batchTransactions(title, [tx])` (`src/Centrifuge.ts`) sets `isBatching` and runs
a transaction through this branch, so a single-element batch already produces
`BatchTransactionData` without broadcasting. That is the mechanism `buildOnly`
builds on.

### 4.2 The gap: `_transact` still requires a signer when batching

The batching branch does not sign, but `_transact` (`src/Centrifuge.ts`) is not
yet signer-free:

```typescript
// src/Centrifuge.ts — _transact (abridged)
const { signer } = self
if (!signer) throw new Error('Signer not set') // ← throws even when only building

let walletClient = isLocalAccount(signer) ? /* http */ : /* custom(signer) */
const [address] = await walletClient.getAddresses()
if (!address) throw new Error('No account selected')
// ctx.signingAddress = address  ← some build callbacks read this (e.g. permit flows)
```

So today, building-without-signing still needs a signer set and an address
resolved, and any method whose build step reads `ctx.signingAddress` (e.g.
permit construction) needs that address. **Closing this gap is the core of the
work** — and it is the main reason a dedicated API is better than continuing to
lean on `batchTransactions`.

### 4.3 Where build-time I/O happens

Building is **not** pure — it does network I/O and must stay `async`:

- deployment / protocol address resolution (`_protocolAddresses`, `getClient`)
- IPFS pinning inside metadata-mutating methods (`config.pinJson`, e.g.
  `MerkleProofManager.addPolicy`, `createPool`)
- chain config / id resolution (`_idToChain`, `getChainConfig`)

`buildOnly` therefore returns a `Promise<BuiltTransaction>`. The only things it
must avoid are the **signer-dependent** steps (wallet client creation, address
resolution, chain switching, `writeContract`/`sendTransaction`).

### 4.4 Return shape

`BuiltTransaction` normalizes the internal `BatchTransactionData` into a stable,
documented envelope:

- `data` is the single call's calldata, or `multicall(bytes[])` calldata when
  more than one inner call is wrapped (mirrors `wrapTransaction`'s own
  single-vs-multicall branch, so byte output matches what would have been sent).
- `calls: BuiltCall[]` exposes each inner call (`{ to, data, value }`) so
  consumers can decode/inspect a batch without re-parsing the multicall.
- `messages` is carried through unchanged so consumers can run the same
  cross-chain fee estimation the signing path does (`_estimate`).

## 5. API surface

```typescript
export interface BuiltCall {
  to: HexString
  data: HexString
  value: bigint
}

export interface BuiltTransaction {
  centrifugeId: number
  chainId: number
  to: HexString
  data: HexString
  value: bigint
  calls: BuiltCall[]
  messages?: Record<number, MessageTypeWithSubType[]>
}

export interface BuildOnlyOptions {
  /**
   * Address to use as the build-time `signingAddress` for methods whose
   * construction reads it (e.g. permit flows). Required only for those methods;
   * no signing is performed with it. Validated as an address, never used to
   * sign.
   */
  fromAddress?: HexString
}

declare class Centrifuge {
  /**
   * Build the unsigned calldata a transaction would send, without a signer and
   * without broadcasting. Runs the full construction logic (encoding, merkle,
   * weiroll, IPFS pinning) but performs no signing step.
   */
  buildOnly(tx: Transaction, options?: BuildOnlyOptions): Promise<BuiltTransaction>
}
```

Usage (the backend's `SdkTxBuilder` adapter):

```typescript
const centrifuge = new Centrifuge({ environment, rpcUrls, ipfsUrl })
const pool = await centrifuge.pool(poolId)

const built = await centrifuge.buildOnly(pool.updatePoolMetadata(input))
// → map BuiltTransaction to the backend's RawTx envelope, hand to Fordefi
```

No `setSigner` call. The backend then signs `built.data` via Fordefi entirely
outside the SDK.

## 6. Implementation strategy

Phased so the SDK ships green at each step and the public surface is added last.

### Phase 1 — Make the build path signer-optional (internal)

The smallest change that unblocks everything. In `_transact`, allow a
build/batching run with **no signer**:

1. Add an internal "build mode" flag to the transaction context (reuse or sit
   beside `isBatching`). In build mode:
   - do **not** throw on a missing signer;
   - do **not** create a `WalletClient`, resolve addresses, or switch chains;
   - set `ctx.signingAddress` from `options.fromAddress` when provided, else a
     well-defined zero/placeholder, and document that build-mode callbacks must
     not assume a real signer.
2. Audit the methods whose build callbacks read `ctx.signingAddress` (permit
   flows are the known case — `src/utils/permit.ts`) and ensure they either work
   from `fromAddress` or surface a clear error in build mode when it's omitted.
3. Keep the signing path byte-for-byte unchanged — build mode is purely
   additive.

**Done when:** an internal test can drive a method through build mode with no
signer set and get `BatchTransactionData` out.

### Phase 2 — Add `buildOnly` and the `BuiltTransaction` envelope (public)

1. Add `buildOnly(tx, options?)` on `Centrifuge`. It runs the transaction in
   build mode, takes the first emitted `BatchTransactionData`, and normalizes it
   into `BuiltTransaction` (compute single-call vs `multicall(bytes[])` `data`
   exactly as `wrapTransaction` does, populate `calls`, carry `messages`, attach
   `centrifugeId`/`chainId`).
2. Export `BuiltTransaction`, `BuiltCall`, `BuildOnlyOptions` from
   `src/index.ts`.
3. Reuse the multicall-encoding helper from `wrapTransaction` (extract it if
   needed) so `buildOnly` and the signing path can never diverge on byte output.

**Done when:** `buildOnly(pool.updatePoolMetadata(...))` returns calldata
byte-equal to what the signing path sends for the same inputs.

### Phase 3 — Tests + docs

1. **Byte-equality tests** per representative method: assert `buildOnly` output
   equals the calldata the signing path produces (capture via the existing
   fork-server / mocked clients used in `src/**/*.test.ts`). Cover at minimum a
   simple call (`updatePoolMetadata`), a multicall batch, and a
   weiroll/marketplace method (`MerkleProofManager`).
2. **No-signer test:** `buildOnly` succeeds with no `setSigner` call.
3. **`fromAddress` test:** a permit-dependent method builds correctly with
   `fromAddress` and errors clearly without it.
4. Document in [SDK_USAGE.md](./SDK_USAGE.md) under a "Build-only / custodial
   signing" section, and reference it from the backend memo.

### Phase 4 — Deprecate the batching idiom for build-only use (optional)

Once `buildOnly` ships, note in docs that `batchTransactions([oneTx])` is not
the supported way to obtain unsigned calldata. `batchTransactions` remains for
its real purpose (composing a genuine multi-call batch).

## 7. Design decisions & trade-offs

- **Why a new method, not "just use `batchTransactions`."** The batching path
  requires a signer (§4.2), couples callers to an internal yield shape, and
  conflates "build one tx" with "compose a batch." A named API with a typed
  return is the stable contract external partners and the backend can depend on.
- **`async` return.** Building does real I/O (addresses, IPFS). Pretending
  otherwise would be a lie; `Promise<BuiltTransaction>` is honest.
- **`fromAddress` instead of a fake signer.** Some methods legitimately need the
  sender address at build time (permit). Passing an address — explicitly never
  used to sign — is cleaner than constructing a dummy signer just to read its
  address.
- **No simulation, no policy, no broadcast in scope.** Simulation already exists
  on the signing path (`wrapTransaction(..., { simulate: true })`) and can be
  surfaced separately if wanted; `buildOnly` deliberately stays minimal — bytes
  only. Consumers layer their own simulation/policy on top.
- **Custody stays out of the SDK.** `buildOnly` returns bytes and nothing about
  _how_ they get signed. Fordefi, Safe, MPC, etc. live entirely in the consumer.
  This is the boundary that keeps the partner-facing SDK clean.

## 8. Parallel work: secure the SDK's default pinning endpoint

This should be built **alongside** the build-only API, not after it. The
build-only API and the pinning hardening together close a real, active security
issue — a stored-XSS / HTML-injection vector on `https://ipfs.centrifuge.io/`
(malicious SVG/HTML pinned, then served with an executable content type). The
backend memo (`centrifuge/backend` → `docs/design/sdk-vs-native-tx-builder.md`
§6) covers the consumer side; this section covers what the **SDK** must change.

### The problem in the SDK

The SDK ships an **open, unauthenticated write endpoint by default**. In
[`src/utils/ipfs.ts`](../../src/utils/ipfs.ts), `createPinning` builds:

```ts
pinFile: (b64URI) => pinToApi(`${pinningApiUrl}/pinFile`, { method: 'POST' /* no auth header */ })
pinJson: (json) => pinToApi(`${pinningApiUrl}/pinJson`, { method: 'POST' /* no auth header */ })
```

and the default `pinningApiUrl` is a public cloud function
(`PINNING_API_DEMO` in [`src/Centrifuge.ts`](../../src/Centrifuge.ts)). Because
`apps-v3` constructs `new Centrifuge({...})` in the browser with no auth, **any
visitor can replay the pinning calls** — and `pinFile` accepts an arbitrary
base64 payload, which is the upload vector for the malicious content.

`buildOnly` alone does **not** fix this. It moves _where_ pinning is invoked
(into a backend), but as long as the SDK's default config ships an open write
endpoint, every other consumer — and the SDK's own defaults — keeps the hole
open.

### Why it belongs with the build-only API

The two changes are the same architectural move from two sides:

- **`buildOnly`** lets a consumer run the build path (which calls `pinJson`)
  server-side, behind its own auth.
- **A pluggable, auth-capable pinning config** lets that server-side caller
  inject a pinning function that holds the secret key and authenticates — instead
  of the open demo endpoint.

Shipping `buildOnly` without this leaves consumers building server-side but
**still pinning through the open endpoint**, which defeats the security benefit.
Ship them together.

### What the SDK should change

1. **Make pinning auth-capable, not just URL-configurable.** `pinJson`/`pinFile`
   are already overridable via `Config`
   ([`src/types/index.ts`](../../src/types/index.ts)) — good. Confirm a consumer
   can fully replace them with an authenticated implementation (e.g. one that
   attaches a bearer token / presigned request and points at a private pinning
   service). Document this as the supported path for any non-public deployment.
2. **Stop shipping an open write endpoint as the default.** Options, in
   increasing strictness:
   - default `pinJson`/`pinFile` to **throw** unless the consumer supplies a
     pinning config ("no implicit public pinning") — safest, but a breaking
     change;
   - keep the demo endpoint but **clearly mark it demo/test-only** and require an
     explicit opt-in flag to use it in `mainnet`;
   - at minimum, document loudly that the default endpoint is unauthenticated and
     must be replaced for any real deployment.
     Recommendation: move toward "no implicit public pinning" on a major version,
     with the demo endpoint behind an explicit opt-in until then.
3. **Separate read gateway from write endpoint in config and docs.** `ipfsUrl`
   (read/gateway) and the pinning endpoint (write) are different trust domains;
   the docs and types should not blur them. (Note `getUrlFromHash` already
   appends `?format=` to work around Pinata's SVG MIME handling — the same knob
   the XSS abuses on read; the gateway content-type filter is the **consumer/
   ops** side of the fix and is out of SDK scope, but the SDK should not
   encourage relying on the open gateway for untrusted content.)
4. **Surface `pinFile` constraints.** Where the SDK exposes `pinFile`, document
   that callers are responsible for validating/whitelisting content types before
   pinning; consider a typed/narrowed API for the metadata-pinning case so
   arbitrary-file pinning is an explicit, separate, clearly-labeled capability.

### Suggested phasing (interleaves with §6)

- **With Phase 1/2:** confirm and document the auth-capable pinning override; add
  a test that a consumer-supplied authenticated `pinJson` is used end-to-end by a
  build-only call. (Unblocks the backend's `SdkTxBuilder` to pin securely.)
- **With Phase 3:** docs in [SDK_USAGE.md](./SDK_USAGE.md) — a "Secure pinning"
  section: never ship the default endpoint to production; how to inject an
  authenticated pinner; read-gateway vs write-endpoint trust boundaries.
- **Follow-up major:** the default-pinning behavior change (option 2 above),
  coordinated with consumers so nothing silently loses pinning.

### Out of SDK scope (record, don't own)

The **read-side** fix — the gateway serving pinned bytes with a safe content
type (Cloudflare/Pinata proxy content-type filter) — is an ops/infra concern,
not an SDK change. The SDK's job here is to stop being the open **write** path
and to not encourage trusting the open **read** gateway for untrusted content.

## 9. Open questions for review

- Exact set of methods that read `ctx.signingAddress` at build time — needs an
  audit in Phase 1 (permit is known; confirm there are no others).
- Whether `buildOnly` should accept an array (`Transaction[]`) to build a true
  multicall in one call, or stay single-tx and let `batchTransactions` +
  `buildOnly` compose. Recommendation: single-tx first; the multicall encoding
  is already inside the batch path if needed later.
- Whether to also expose a `simulate` convenience on the build result, or keep
  simulation a separate concern (recommendation: separate, per §7).
