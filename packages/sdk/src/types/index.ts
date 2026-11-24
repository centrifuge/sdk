import type { AddressBook } from '@centrifuge/protocol'
import type { GraphqlTarget } from '@centrifuge/queries/graphql'
import { Chain, PublicClient } from 'viem'
import type { DataSource } from '../data/DataSource.js'
import type { TxStrategy } from '../tx/TxStrategy.js'

export type Config = {
  environment: 'mainnet' | 'testnet'
  rpcUrls?: Record<number | string, string | string[]>
  indexerUrl: string
  ipfsUrl: string
  /**
   * Whether to cache data
   * @default: true
   */
  cache?: boolean
  pollingInterval?: number
  indexerPollingInterval?: number
  pinJson?: (json: any, name?: string) => Promise<string>
  pinFile?: (b64URI: string) => Promise<string>
  /**
   * Whether to disable EIP-2612 permit signatures and use standard ERC-20 approve instead.
   * Useful for Safe multisig wallets or integrations that don't support off-chain signing.
   */
  permitDisabled?: boolean
  /**
   * Whether to disable event-driven re-fetching of observable queries.
   * When true, observables will emit once and not re-subscribe on blockchain events.
   * Useful for apps that handle data freshness via external caching (e.g. React Query)
   * instead of relying on SDK-level event watching.
   */
  disableRepeatOnEvents?: boolean
  /**
   * @deprecated No-op. Protocol addresses come from the bundled address book or
   * the `addressBook` option, never from the indexer, so there is no indexer
   * allowlist to relax. Kept for constructor compatibility; will be removed in
   * a future major.
   */
  allowUnknownDeployments?: boolean
  /**
   * Run against another address book than the bundled one: the file `build-book`
   * writes, for staging and testnet only. Its `bookId` is checked on first
   * resolution; nothing is fetched. On mainnet the constructor throws for a
   * book whose `bookId` differs from the bundled one unless `allowUnsafeMainnet`
   * is `true`. See `docs/sdk/address-book.md` in the backend repository.
   */
  addressBook?: { book: AddressBook; allowUnsafeMainnet?: boolean }
  /**
   * Which GraphQL schema `indexerUrl` points at, for the default GraphQL
   * catalogue adapter.
   *
   * `'public-api'` (the default) is the v3.3 Phase 1 target: PostGraphile over
   * `chain_v1`. It serves every catalogue entry PostGraphile can express and
   * throws `UnsupportedQueryError` for the five that need capabilities
   * public-api does not have yet, so nothing degrades silently and no partial
   * data is returned.
   *
   * `'api-v3'` replays the legacy Ponder documents. It is the documented
   * escape hatch for those five entries until the capabilities land, and is
   * also how the two targets can be A/B compared. Set it explicitly if your
   * integration needs the holders list, the share-price report, or the
   * crosschain message views.
   *
   * See `docs/parity/09-sdk-catalogue-public-api.md` for the per-entry table.
   *
   * @default 'public-api'
   */
  graphqlTarget?: GraphqlTarget
  /**
   * The read seam. Supply one to serve catalogue reads from somewhere other
   * than the public GraphQL endpoint (in practice the rest `DataSource` bound
   * to a Centrifuge backend, which `@centrifuge/sdk/backend`'s
   * `createBackendCentrifuge` wires for you).
   *
   * @default a `GraphqlDataSource` over `indexerUrl`, targeting
   * {@link Config.graphqlTarget}.
   */
  dataSource?: DataSource
  /**
   * The write seam. Supply one to prepare mutating operations somewhere other
   * than in-process (in practice `BackendPrepareStrategy`, which
   * `@centrifuge/sdk/backend`'s `createBackendCentrifuge` wires for you).
   * Without one, the per-action routing table is not consulted at all: every
   * write is built locally.
   *
   * @default `LocalBuildStrategy` — calldata built in-process and signed by the
   * configured signer.
   */
  txStrategy?: TxStrategy
}

export type UserProvidedConfig = Partial<Config>
export type EnvConfig = {
  indexerUrl: string
  ipfsUrl: string
  pinFile: (b64URI: string) => Promise<string>
  pinJson: (json: any, name?: string) => Promise<string>
}
export type DerivedConfig = Config & EnvConfig
export type Client = PublicClient<any, Chain>
export type HexString = `0x${string}`

export type CurrencyDetails = {
  address: HexString
  tokenId: bigint
  decimals: number
  name: string
  symbol: string
  centrifugeId: number
  supportsPermit: boolean
}

/**
 * Typed view of one chain's protocol contract addresses. The values come from
 * the bundled `@centrifuge/protocol` deployment registry
 * (keyed by environment, protocolVersion, and centrifugeId; validated
 * fail-loud at load) — the registry's v3.2 contract schema is this type's
 * field list. Optional fields are chain-specific (adapters, factories not
 * deployed everywhere).
 *
 * The required/optional split here MUST mirror the registry schema's
 * (`packages/protocol/src/registry/v3_2.ts`). A field the schema calls
 * optional but this type declares required lets an unguarded
 * `readContract({ address })` type-check and then pass `undefined` at runtime
 * on exactly the chains where the contract is not deployed.
 */
export type ProtocolContracts = {
  root: HexString
  gasService: HexString
  gateway: HexString
  multiAdapter: HexString
  messageProcessor: HexString
  messageDispatcher: HexString
  hubRegistry: HexString
  accounting: HexString
  holdings: HexString
  shareClassManager: HexString
  batchRequestManager: HexString
  hub: HexString
  identityValuation: HexString
  /** Absent on protocol v3.3, where per-pool escrows come from {@link ProtocolContracts.escrowFactory}. */
  poolEscrowFactory?: HexString
  /** v3.3 only: deploys and resolves each pool's `Escrow`. */
  escrowFactory?: HexString
  freezeOnlyHook: HexString
  redemptionRestrictionsHook: HexString
  fullRestrictionsHook: HexString
  freelyTransferableHook: HexString
  /** Absent on protocol v3.3. */
  tokenFactory?: HexString
  asyncRequestManager: HexString
  asyncVaultFactory: HexString
  /** Not in the bundled registry; always undefined. */
  wormholeAdapter?: HexString
  syncManager: HexString
  subsidyManager: HexString
  axelarAdapter?: HexString
  syncDepositVaultFactory: HexString
  spoke: HexString
  /** Absent on protocol v3.3, where vault details live on {@link ProtocolContracts.spokeRegistry}. */
  vaultRegistry?: HexString
  vaultRouter: HexString
  /** Absent on protocol v3.3, where the balance sheet calls live on {@link ProtocolContracts.spoke}. */
  balanceSheet?: HexString
  merkleProofManagerFactory?: HexString
  /** Current on/off-ramp manager factory. Preferred over the legacy factory when both are listed. */
  onOffRampFactory?: HexString
  /** Legacy on/off-ramp manager factory, still the listed one on chains that predate `onOffRampFactory`. */
  onOfframpManagerFactory?: HexString
  onchainPMFactory?: HexString
  /** ERC-6909 accounting token used by OnchainPM workflows. Minter perms are keyed by pool. */
  accountingToken?: HexString
  /** Absent on protocol v3.3. */
  tokenRecoverer?: HexString
  /** Absent on protocol v3.3, where contract updates are `Hub.managerCall`s. */
  contractUpdater?: HexString
  vaultDecoder?: HexString
  circleDecoder?: HexString
  hubHandler: HexString
  protocolGuardian: HexString
  opsGuardian: HexString
  refundEscrowFactory: HexString
  queueManager: HexString
  /** Absent where the address book excludes the chain's OracleValuation. */
  oracleValuation?: HexString
  navManager: HexString
  simplePriceManager: HexString
  layerZeroAdapter: HexString
  chainlinkAdapter?: HexString
  /**
   * v3.3 only: the Hyperlane adapter the MultiAdapter's adapter sets list, the address book's
   * `hyperlaneAdapter` (not `hyperlaneStandby`). Absent where Hyperlane is not deployed.
   */
  hyperlaneAdapter?: HexString
  /** v3.3 only: vault, asset and share-token registry, VaultRegistry's successor. */
  spokeRegistry?: HexString
  /** v3.3 only: the default registrar of share tokens, a `managerCall` target. */
  shareTokenRegistrar?: HexString
  /** v3.3 only: spoke manager for hub-driven share issuance and revocation. */
  shareManager?: HexString
  /** v3.3 only: delivers hub manager calls to their spoke targets. */
  envoy?: HexString
  /** v3.3 only. */
  tokenBridge?: HexString
  /**
   * v3.3 only: the pool's adapter manager on a spoke, so a steward can replace the pool's adapters there behind a
   * timelock when they stop delivering. A `managerCall` target.
   */
  adapterFailover?: HexString
  /** v3.3 only: the hub's bridging hook every pool gets on activation (pause and per-origin rate limit). */
  bridgeCircuitBreaker?: HexString
  /** v3.3 only: keeps the bridge circuit breaker's per-window tally. */
  circuitBreakerGuard?: HexString
  /**
   * v3.3 only: holds the asset and share deltas `Spoke` queues until `submitQueuedAssets` /
   * `submitQueuedShares` sends them to the hub. On v3.2 the queue lives on `BalanceSheet`.
   */
  snapshotQueue?: HexString
}
