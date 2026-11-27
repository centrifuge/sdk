import type { SdkQueryName } from '@centrifuge/queries/core'
import { REST_ROUTE_OWNERS, REST_ROUTES, type RestRouteOwner, type RestRouteTable } from '@centrifuge/queries/rest'
import type { PoolActionName } from '../tx/TxStrategy.js'

/**
 * Where one operation is served in backend mode.
 *
 * - `'backend'` — routed to the backend (a REST read endpoint for a catalogue
 *   entry, `POST tx/prepare` for a write).
 * - `'local'` — falls back to exactly what public mode does: the graphql
 *   adapter for reads, `LocalBuildStrategy` for writes.
 */
export type BackendRoute = 'backend' | 'local'

/**
 * The write half of backend mode's per-entry routing table: `PoolAction` name
 * -> route. Absent means `'local'`, so an action nobody has migrated behaves
 * exactly as it does in public mode.
 *
 * Read routes live next to the adapter that uses them
 * (`@centrifuge/queries/rest`'s `REST_ROUTES`), because the route value is a
 * URL builder typed against the catalogue entry's params. Both halves are
 * re-exported here so "the routing table" is one place to look
 * ({@link backendRoutingTable}).
 */
export type ActionRouteTable = Readonly<Partial<Record<PoolActionName, BackendRoute>>>

/**
 * The shipped write route table.
 *
 * A row means the write is prepared by the backend; no row means it is
 * prepared by `LocalBuildStrategy`, exactly as in public mode. That default is
 * what makes "backend mode with an empty table behaves exactly like public
 * mode" true for writes as well as reads.
 *
 * ## What each row means, and what the SDK still does on the local side
 *
 * - `createHolding` — `shareClass.createHolding()`. The SDK still resolves the
 *   four (or two) ledger account ids from the pool's IPFS metadata and sends
 *   them as data: the backend's builder is pure and its calldata is re-derived
 *   at preview, at prepare and again during Fordefi's dual-channel
 *   verification, so it cannot allocate ids of its own. When the metadata
 *   supplies none, the SDK allocates fresh RANDOM ones over RPC and prepends a
 *   `Hub.createAccount` leg per id — a shape the `createHolding` action cannot
 *   express — and that call stays on `LocalBuild`. See
 *   `ShareClass.createHolding`.
 * - `depositHolding` / `withdrawHolding` — `balanceSheet.deposit()` /
 *   `balanceSheet.withdraw()`, both with `source: "wallet"`. The asset's
 *   contract address and ERC-6909 token id are resolved SERVER-side from the
 *   projection and are deliberately not sent (a caller-supplied address could
 *   name asset 42 in the audit row while moving a different token).
 * - `issueSharesDirect` / `revokeSharesDirect` — `balanceSheet.issue()` /
 *   `balanceSheet.revoke()`. The backend takes a share COUNT and a price where
 *   the SDK's signature takes a pool-currency amount and a price, so the SDK
 *   does its existing `amount * 10^decimals / price` division and sends the
 *   result: the division stays where the caller can see it and never happens
 *   server-side. These two also bypass `wrapTransaction` on the local path and
 *   so cannot be built unsigned at all, which makes this route the only way to
 *   run them through a Fordefi quorum.
 *
 * ## The two pool-access writes
 *
 * - `updatePoolManagers` — `pool.updatePoolManagers()`. Hub-local, no
 *   cross-chain message, no refund address. Two behaviour changes, both
 *   documented on the method: the local "cannot remove all pool managers"
 *   pre-flight moves server-side (422 `LAST_POOL_MANAGER`, evaluated against
 *   the projection rather than against a read the caller could race), and the
 *   batch ORDER differs — the SDK moves the signer's own entry last, the
 *   builder emits all grants before all revokes, because the signer is unknown
 *   at preview time and an order that depended on it would break Fordefi's
 *   dual-channel re-derivation.
 * - `updateBalanceSheetManagers` — `pool.updateBalanceSheetManagers()`. Per
 *   network, one cross-chain message each, so it needs an explicit
 *   `refundAddress` in backend mode for the same reason `revoke` needs an
 *   explicit custodian: the local path fills it in from `ctx.signingAddress`
 *   and the backend has no signing address when it builds.
 *
 * ## The four investor-administration writes
 *
 * - `updateMember` — `shareClass.updateMember()` / `updateMembers()`. One
 *   investor on one network; the action is deliberately not batched, and
 *   `updateMembers` with more than one entry REFUSES in backend mode rather
 *   than dropping to `LocalBuild`, because that fallback would take a whitelist
 *   edit around the policy engine and the approval quorum (see the method).
 *   The SDK's `validUntil` maps onto the DTO's `op` sugar: the `MAX_UINT32`
 *   sentinel is `op: "add"`, every other instant is `op: "remove"` carrying it.
 * - `freezeMember` / `unfreezeMember` — separate actions rather than a flag,
 *   mirroring the hook, which keeps the frozen bit and the expiry in different
 *   parts of one `hookData` word.
 * - `crosschainTransferShares` — the one write in this group whose target is
 *   the SPOKE. Its `centrifugeId` for routing purposes is the SOURCE network,
 *   not the pool's hub, and its message manifest branches on whether those two
 *   are the same chain (`ExecuteTransferShares` to the destination when the
 *   source IS the hub, `InitiateTransferShares` to the hub otherwise). The
 *   builder branches identically, so both sides pay for the same one message.
 *
 * All four need an explicit `refundAddress` in backend mode, for the reason
 * `updateBalanceSheetManagers` does: each dispatches a paid cross-chain message,
 * the local path fills the refund in from `ctx.signingAddress`, and the backend
 * has no signing address when it builds.
 *
 * Three neighbouring pool-access writes — `pool.setAdapters()`,
 * `shareClass.updateHook()` and `shareClass.updateHookAndValuation()` — have NO
 * `PoolAction` at all (no builder in `@centrifuge/protocol`, no member of
 * `PoolActionType`). They are backend gaps, not decisions, and they stay on
 * `LocalBuild` until one exists — the same position `pool.createAccounts()` and
 * `pool.planAccountingUpdate()` are in.
 *
 * `pool.initiateAuthorizations()`, `pool.scheduleOutOfPolicy()`, `pool.executeAuthorizations()`,
 * `pool.cancelAuthorization()` and `pool.installHubPolicy()` are in that position too: no `PoolAction`, so the
 * connected wallet signs them in backend mode as well. All five are manager-only on chain, so a pool whose managers
 * sign through the backend (a Fordefi vault) cannot schedule, execute, cancel or install from a browser wallet until an
 * action exists. `pool.deployHubPolicy()` is permissionless and never needs the backend.
 *
 * ## The one deliberate behaviour change, stated rather than buried
 *
 * On the local path `balanceSheet.deposit()` prepends an ERC-20/ERC-6909
 * `approve` when the signer's allowance to the `BalanceSheet` is short (and
 * batches the pair over EIP-5792 where the wallet supports it). The backend's
 * `depositHolding` builder deliberately emits the deposit alone
 * (`packages/protocol/src/builders/holding-transfer.ts`): an approval is the
 * signer's own allowance rather than a pool action, and batching it would put
 * a token-contract call the policy engine has no rule for inside a pool
 * transaction.
 *
 * So on this route the allowance is the operator's to arrange, and a short one
 * reverts on chain instead of being topped up silently. The SDK cannot close
 * the gap itself: on the custodial route the signer is a Fordefi vault, and an
 * approval signed by the browser wallet would raise the WRONG account's
 * allowance — a plausible fix that would leave the transaction failing for the
 * same reason.
 *
 * ## The two vault rows, and the four entity methods behind them
 *
 * - `deployVault` — `poolNetwork.deployVaults()` and the `deploy()` it
 *   delegates to. ONE vault per action, which is what the backend's action
 *   carries, so a multi-vault call refuses rather than fanning out into
 *   several transactions the caller did not ask to sign.
 * - `updateVaults` — `poolNetwork.linkVaults()`, `poolNetwork.unlinkVaults()`
 *   and `vault.updateMaxReserve()`. One batched action with three optional
 *   parts; each of the three methods fills in one of them (the endpoint accepts
 *   the partial subsets deliberately). No SDK method combines them today, so
 *   the atomicity the one-action design buys is available to a direct REST
 *   caller and not yet to an SDK one — see the note at the end of this block.
 *
 * ## What the SDK still resolves, and what it stops sending
 *
 * `updateVaults.maxReserve` names the share class and the VAULT ADDRESS; the
 * asset id the `Hub.updateContract` trusted call is addressed by is resolved
 * SERVER-side from the projection, because that call keys the sync manager by
 * `(scId, assetId)` and a caller-supplied pair could name one vault in the
 * audit row while changing another vault's reserve. `vault.updateMaxReserve()`
 * therefore stops sending `this.assetId` and keeps its decimals check, which is
 * a caller-error guard and not an addressing one.
 *
 * `deployVault` takes a `kind`, never a factory address: which factory deploys
 * the vault follows from the kind and is read from the verified
 * `@centrifuge/protocol` registry for the target network and protocol version.
 * Accepting one would let a caller deploy an arbitrary contract as a pool's
 * investment entry point, so `deployVaults({ factory })` refuses on this route.
 *
 * ## `refundAddress` is required in backend mode, and defaulted locally
 *
 * Every one of these actions dispatches at least one cross-chain message, so
 * every one carries a refund destination for unspent gas. The local path fills
 * it from `ctx.signingAddress`, exactly as it always has; the backend cannot,
 * because the signer is unknown at PREVIEW time and the calldata must be
 * byte-identical at preview, at prepare and again during Fordefi's
 * dual-channel re-derivation. Defaulting to the connected wallet would be the
 * plausible-wrong-value trap `balanceSheet.revoke()`'s `custodianAddress`
 * already names: on the custodial route the signer is the pool's Fordefi vault,
 * and the refund would land at an address it does not control.
 *
 * ## The preamble `deployVault` cannot express, and why that is a refusal
 *
 * `poolNetwork.deploy()` prepends a STATE-CONDITIONAL preamble before the three
 * calls that actually deploy a vault — `setAdapters`, `notifyPool`, on v3.3 to
 * a spoke on another chain the `AdapterFailover` manager and steward calls,
 * `updateBalanceSheetManager` for the async and sync managers,
 * `setRequestManager` — each guarded by a chain read. The backend's builder
 * emits none of it, deliberately and unavoidably: a pure builder does no I/O,
 * and `chain_v1` projects neither `Spoke.requestManager` nor the balance-sheet
 * manager flags for a registry address, so there is nothing to read them from
 * server-side either.
 *
 * So the SDK does the same reads it already does and REFUSES when any preamble
 * leg would be required, rather than sending the three-call action on its own.
 * Falling back to `LocalBuild` would put a pool-operator write through the
 * browser wallet with no policy evaluation; sending the action anyway would
 * confirm a transaction that deploys a vault nobody can invest through. The
 * practical consequence, stated rather than discovered: the FIRST vault on a
 * given (pool, network) always needs the async-manager and request-manager
 * legs, so it cannot go through the backend. Every subsequent one can.
 *
 * ## Investor-side flows are not here, permanently
 *
 * See {@link PERMANENTLY_LOCAL_METHODS}. Those six methods must never reach
 * these endpoints, and no row above touches them.
 *
 * ## One capability of `updateVaults` no SDK method reaches
 *
 * The backend's `updateVaults` action exists to make a link + unlink + reserve
 * edit ONE signing ceremony. The SDK has no method that expresses the
 * combination, so an SDK caller still spends one ceremony per part. Adding one
 * is new public API; it belongs with the port of the management app's edit
 * form.
 *
 * ## The one NAV row, and the six methods that get none
 *
 * `updateSharePrice` — `shareClass.updateSharePrice()`. The SDK still resolves
 * the notify set over RPC and sends it as `notifyNetworks`, because the backend
 * must not derive it: the calldata is built at preview and again at prepare,
 * and a set read from mutable projection state would let the two disagree. The
 * backend VALIDATES it against the projection instead (422
 * `SHARE_CLASS_NOT_ON_NETWORK` for a network the share class is not on, 422
 * `INCOMPLETE_PRICE_NOTIFY` for one it is on and the payload omits), so drift
 * between the two builds is a refusal rather than different bytes. `finalDate`
 * travels for the same determinism reason `refundAddress` does — a
 * server-derived "now" would differ between the two builds — and is sent
 * already truncated to the whole second the calldata carries.
 *
 * The other six NAV write methods have NO `PoolAction`, which is a backend gap
 * rather than an omission here: issue #44 shipped exactly one builder
 * (`packages/protocol/src/builders/share-price.ts`) and one DTO case. Named
 * individually, because "not migrated yet" and "never" are different answers
 * and only the first applies:
 *
 * - `shareClass.notifySharePrice(centrifugeId)` and
 *   `shareClass.notifyAssetPrice(assetId)` — a re-notification WITHOUT a price
 *   change. `updateSharePrice`'s `notifyNetworks` covers the notify-with-update
 *   case and nothing covers these; they are the operator's "the spoke missed
 *   it, send it again" button.
 * - `shareClass.setMaxSharePriceAge(centrifugeId, age)` and
 *   `shareClass.setMaxAssetPriceAge(assetId, age)` — `Hub.setMax*PriceAge`.
 * - `shareClass.updateValuation(centrifugeId, valuation)` — the
 *   `VaultManagerTrustedCall.Valuation` half of `Hub.updateContract`. Note that
 *   the `updateVaults` action carries the OTHER half of the same trusted call
 *   (`MaxReserve`) but has no `valuation` part, so there is nothing to extend
 *   either.
 * - `pool.updateOracleValuationFeeder(...)` — `OracleValuation.updateFeeder`,
 *   which is not a `Hub` call at all: it is sent directly to the valuation
 *   contract, and the backend's action set is Hub-addressed.
 *
 * All six therefore stay `LocalBuild` in backend mode, which is the documented
 * default for an action with no row. They are NOT in
 * {@link PERMANENTLY_LOCAL_METHODS}: unlike the investor-side vault flows,
 * there is no reason in principle a pool operator's price notification cannot
 * be policy-checked and custodially signed — it needs a builder, a DTO case and
 * an arg mapping, which is backend work.
 *
 * The third-party-oracle panel (`ThirdPartyOraclesAccordion`) is out of the
 * backend's scope and stays client-side, which is the other reason
 * `updateOracleValuationFeeder` has nothing to route to.
 *
 * ## The on/off-ramp methods: one row, `registerOnOffRamp`, plus the pool-access row on legacy networks
 *
 * The backend's on/off-ramp and merkle-proof-manager surface is read-only apart
 * from the ramp registration, so one Basin write is routed here and the others
 * are not. The reasons differ per group, and they are not interchangeable, so
 * each is named.
 *
 * ### Ramp registration routes by what the spoke registry lists
 *
 * `poolNetwork.registerOnOffRampManagerAsBSManager(address, scId, options)` builds its batch in its own hub
 * transaction on every network, and backend mode picks the action from the registry:
 *
 * - `onOffRampFactory` listed: `registerOnOffRamp`. The builder appends the accounting-token minter grant
 *   to the balance-sheet-manager registration in one hub transaction.
 * - legacy network: `updateBalanceSheetManagers` with one entry, byte-identical to the local build.
 *
 * Both need `refundAddress` in backend mode, for the reason `updateBalanceSheetManagers` does. The backend
 * allows an accounting-token call only from `registerOnOffRamp` (422 `BUILT_CALL_DENIED` otherwise).
 * `assignOnOffRampManagerPermissions()` and `deployAndRegisterOnOffRampManager()` refuse here (no `refundAddress`); see
 * `docs/sdk/onoff-ramp-factory.md`.
 *
 * `registerMerkleProofManagerAsBSManager(address)` stays a thin wrapper over
 * `pool.updateBalanceSheetManagers([...])` and routes wherever that row points, with the same required
 * `refundAddress`. `basin.backend.test.ts` pins its calldata against that builder.
 *
 * ### Five are blocked on the shape of the transaction view, not on a choice
 *
 * `deployOnchainPM()`, `deployMerkleProofManager()`, `deployOnOfframpManager()`,
 * `deployAndRegisterOnOffRampManager()` and `authorizeOnchainPM()` are the
 * deploy-then-register concat flows. The first leg deploys through a factory and
 * the second needs the DEPLOYED ADDRESS, which the SDK reads out of the
 * receipt's `DeployMerkleProofManager` / `DeployOnOffRamp` / `DeployOnOfframpManager` /
 * `DeployOnchainPM` log. On the backend route that address would have to come
 * from the confirmed tx row, and it does not: `GET pools/:poolId/tx/:txId` and
 * the pool transaction list share one mapper (`transactions.controller.ts`,
 * `toResponse`) whose fields are `txId`, `poolId`, `chainId`, `signerType`,
 * `actionType`, `status`, `unsignedTx`, `txHash`, `confirmationCode`,
 * `identiconSeed`, `lastError`, `createdAt`, `updatedAt` and the Fordefi
 * `approvals`. No receipt, no logs, no deployed address. So these stay
 * LocalBuild-fallback, and the `DeployedOnOfframpManager` /
 * `DeployedOnchainPM` statuses apps consume are unchanged because the code that
 * emits them is unchanged.
 *
 * Re-deriving the address SDK-side from the row's `txHash` is not an option
 * either: it would put a receipt fetch on the backend route, where a served
 * read does no chain I/O, and it would still leave the custodial route racing
 * a Fordefi broadcast the SDK does not observe. The blocker is the tx view's
 * shape, and the fix belongs there.
 *
 * ### Three are one builder away
 *
 * `onOffRampManager.setReceiver()`, `setRelayer()` and `setAsset()` are each one
 * `Hub.updateContract` with an `OnOffRampManagerTrustedCall`-tagged payload and
 * one cross-chain message — the same shape the `updateVaults` maxReserve part
 * already has. On a ramp that deposits accounting tokens, enabling a receiver or
 * an onramp asset also appends `Hub.notifyAssetPrice` for that token, and first
 * registers it on the spoke when it is unknown there, so their builder also
 * needs the token's spoke asset id.
 *
 * ### The rest are blocked on data the backend does not read
 *
 * Every policy and workflow write — `pool.addToPolicy()`,
 * `removeFromPolicy()`, `merkleProofManager.setPolicies()`, `addPolicy()`,
 * `addWorkflow()`, `setWorkflows()`, `disableStrategist()`,
 * `onchainPM.updatePolicy()` — computes a Merkle root over a strategist's
 * workflow set that lives in the pool's IPFS metadata plus the marketplace
 * document. The backend reads neither, and a builder taking a caller-supplied
 * root would be encoding an unverified authorization change. The execute family
 * (`pool.executeWorkflow()`, `onchainPM.execute()`, `executeRawBatch()`,
 * `executeAccountingBatch()`, `executeWorkflow()`,
 * `merkleProofManager.execute()`) needs the same inputs plus an inclusion proof
 * against the live root, and fails worse: a wrong proof reverts AFTER the
 * cross-chain fee is paid.
 *
 * `onOffRampManager.deposit()` / `withdraw()` are the odd pair: they overlap the
 * holdings writes, whose `depositHolding` / `withdrawHolding` already validate a
 * manager-sourced transfer against the `onOffRampManagers` projection. Whether
 * they are a second action or an argument to the existing one is a boundary
 * decision between the holdings and on/off-ramp surfaces, not a routing
 * decision that can be made here.
 *
 * None of the above belongs in {@link PERMANENTLY_LOCAL_METHODS}. Every one is
 * a pool-operator write a policy engine could legitimately gate — the same call
 * made above for the six NAV methods — so "not migrated" and "never" stay
 * distinguishable.
 */
export const ACTION_ROUTES: ActionRouteTable = {
  // Holdings.
  createHolding: 'backend',
  depositHolding: 'backend',
  withdrawHolding: 'backend',
  // Direct issue and revoke on the balance sheet.
  issueSharesDirect: 'backend',
  revokeSharesDirect: 'backend',
  // Vaults.
  deployVault: 'backend',
  updateVaults: 'backend',
  // NAV. The one share-price action; see the block above for the six NAV write
  // methods that have none.
  updateSharePrice: 'backend',
  // On/off-ramp registration (register plus minter grant); the other ramp methods have no row.
  registerOnOffRamp: 'backend',
  // Pool access.
  updatePoolManagers: 'backend',
  updateBalanceSheetManagers: 'backend',
  // Investor administration.
  updateMember: 'backend',
  freezeMember: 'backend',
  unfreezeMember: 'backend',
  crosschainTransferShares: 'backend',
  // Orders. The four epoch actions behind the two dual-shape share-class
  // methods; see the block below for what each one does and does not carry.
  approveDeposits: 'backend',
  issueShares: 'backend',
  approveRedeems: 'backend',
  revokeShares: 'backend',
}

/**
 * ## Orders: the four epoch actions, and the three things this route does
 * differently from the local build
 *
 * `shareClass.approveDepositsAndIssueShares()` and
 * `approveRedeemsAndRevokeShares()` are dual-shape methods discriminated by
 * which KEYS a caller's entries carry. The action vocabulary deliberately does
 * not mirror that: approving commits an aggregate against an epoch's pending
 * total, issuing sets the price the epoch settles at, they take different
 * arguments, they have different message counts, and a presence-discriminated
 * union can express "both" and "neither". So each method routes to ONE of two
 * actions and a mixed call is REFUSED rather than falling back to the local
 * build — the fallback would produce the same calldata signed by the connected
 * wallet with no policy evaluation, no approval quorum and no audit row, chosen
 * by the shape of an array.
 *
 * 1. **The epoch comes from the CHAIN, not the projection.** The payload carries
 *    an explicit `epochId` / `fromEpochId` read from
 *    `BatchRequestManager.nowDepositEpoch` and friends. The local path derives
 *    it from `pendingAmounts()`, which in backend mode cannot run at all: it
 *    composes `investOrderState` / `redeemOrderState`, and both answer 503
 *    `NOT_YET_PROJECTED` while `chain_v1.{invest,redeem}_order.account` carries
 *    the wrong `bytes32` convention. Reading the chain also matches what the
 *    contract checks (`EpochNotInSequence`).
 * 2. **No per-investor `notify` tail.** The local build appends
 *    `notifyDeposit` / `notifyRedeem` legs for as many investors as its gas
 *    budget allows. This route sends none: `notify` on the backend's
 *    `issueShares` / `revokeShares` is 503 `NOT_YET_PROJECTED` for the same
 *    Embrio decode bug, so the investors are notified afterwards through
 *    `shareClass.claimDeposit()` / `claimRedeem()`, which take the address from
 *    the caller and stay on the local build. **The narrowing is real and is
 *    stated rather than buried**: on this route an operator gets a settlement
 *    step and a notification step where the local build is one transaction.
 * 3. **No gas budget.** The local path pages its issuances and notifications
 *    with `GAS_LIMIT / ESTIMATE_PER_MESSAGE` (42 messages, from a
 *    `GAS_LIMIT = 30_000_000n` the chain does not agree with). That constant is
 *    NOT ported. Measuring a live route found an effective cap of six messages
 *    against a declared 10,000,000, so the page is explicit on the wire and an
 *    over-large one is refused with 422 `BRIDGE_BATCH_TOO_LARGE`, naming both
 *    caps — rather than reverting with `0x4c4fc93a`, a selector in no bundled
 *    ABI.
 *
 * ## msg.value is the backend's, on this route, on every protocol version
 *
 * The SDK attaches nothing. On the local path `wrapTransaction` sums
 * `_estimate` over the message manifest the entity declares; on this route the
 * payload carries no value at all, the backend prices its OWN builder's
 * manifest through `estimateBridgeFee`, and `BackendPrepareStrategy` signs the
 * `unsignedTx.value` it is handed after validating it is a canonical decimal
 * wei string. That is what makes the per-version divergence — v3.2 attaches
 * value for cross-chain gas on the approval paths where v3.3 must not — a
 * backend decision that needs no SDK change: version resolution is already the
 * backend's on this seam.
 *
 * Two manifest facts worth carrying, both verified against the builders:
 * `approveRedeems` declares an EMPTY manifest and a zero value on both sides
 * (it dispatches no message, and `BatchRequestManager` has no `receive`, so wei
 * sent to it is stranded); and for an asset on the pool's OWN chain the SDK
 * declares a message where `packages/protocol` declares none. The two agree on
 * the amount — zero — and differ on whether a zero fee is an error, which is
 * exactly why the builder drops the self-addressed destination instead of
 * letting `estimateBridgeFee` refuse a legitimate free transaction.
 */

/**
 * Entity methods that stay `LocalBuild` in every mode, permanently — not
 * "not migrated yet".
 *
 * These are the investor-side vault flows: end-investor wallet transactions in
 * the invest app. Two properties of the backend's transaction seam make a
 * server-built version of them impossible rather than merely unbuilt, and
 * neither is going to change:
 *
 * - `POST tx/prepare` authorizes on a per-user, pool-scoped `tx:prepare`
 *   permission grant
 *   (`apps/private-api/src/application/use-cases/transactions/prepare-transaction.use-case.ts`,
 *   and `assert-tx-prepare-authority.ts` beside it). That grant is a
 *   pool-operator credential; an end investor has none on the pool they invest
 *   in, and handing them one would grant them every other pool write the same
 *   endpoint serves.
 * - On the custodial route the recovered signer must be the pool's own Fordefi
 *   vault
 *   (`apps/private-api/src/application/use-cases/transactions/verify-signed-tx.use-case.ts`).
 *   A deposit, redeem, cancel or claim built and signed there would move the
 *   VAULT's position, not the investor's — the transaction would succeed and
 *   be wrong.
 *
 * So the backend has, and will have, no `PoolAction` for them. A future
 * vertical adding rows to {@link ACTION_ROUTES} must leave these alone. The
 * backend says the same thing from its side, in `VaultsController`'s docstring:
 * *"The investor-side vault flows (`syncDeposit`, `asyncDeposit`,
 * `asyncRedeem`, the cancels and the claims) never reach these endpoints."*
 *
 * Two consequences worth naming, because they look like omissions:
 *
 * - `Vault.claim` bundles a `VaultRouter.enable` leg for a controller who is
 *   also the signer (upstream `38fb0d2`). `enable` sets the router as operator
 *   for the caller, so the leg is meaningful only when the signer is the
 *   investor themselves.
 * - These six are the invest app's write surface, and `vault.investment()` is
 *   its most-used read. Neither can run through the backend, so "the invest app
 *   in backend mode" is not a thing backend mode offers.
 */
export const PERMANENTLY_LOCAL_METHODS = [
  'Vault.syncDeposit',
  'Vault.asyncDeposit',
  'Vault.asyncRedeem',
  'Vault.cancelDepositRequest',
  'Vault.cancelRedeemRequest',
  'Vault.claim',
] as const

/**
 * Resolve an action's route. Unknown or unlisted actions route `'local'`:
 * fallback is the default, so a missing row degrades to public-mode behaviour
 * rather than to a runtime failure.
 */
export function resolveActionRoute(action: PoolActionName, table: ActionRouteTable = ACTION_ROUTES): BackendRoute {
  return table[action] ?? 'local'
}

/**
 * Both halves of backend mode's routing table, in one shape an app or a test
 * can introspect: which reads and writes this build routes to the backend, and
 * which fall back. Reads are keyed by catalogue entry name, writes by
 * `PoolAction` name; `readOwners` records which read vertical each catalogue
 * entry belongs to. `data/restRoutes.test.ts` asserts the shipped table
 * through this function.
 */
export interface BackendRoutingTable {
  /** Catalogue entry -> REST route. An entry absent here falls back to graphql. */
  readonly reads: RestRouteTable
  /** Which read vertical supplies each entry's route. */
  readonly readOwners: Readonly<Record<SdkQueryName, RestRouteOwner>>
  /** `PoolAction` name -> route. An action absent here falls back to LocalBuild. */
  readonly writes: ActionRouteTable
  /** Entity methods that stay LocalBuild in every mode, permanently. */
  readonly permanentlyLocalMethods: readonly string[]
}

export function backendRoutingTable(): BackendRoutingTable {
  return {
    reads: REST_ROUTES,
    readOwners: REST_ROUTE_OWNERS,
    writes: ACTION_ROUTES,
    permanentlyLocalMethods: PERMANENTLY_LOCAL_METHODS,
  }
}
