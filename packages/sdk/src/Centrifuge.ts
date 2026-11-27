import {
  catchError,
  combineLatest,
  defer,
  distinctUntilChanged,
  filter,
  finalize,
  first,
  firstValueFrom,
  from,
  isObservable,
  map,
  merge,
  mergeMap,
  Observable,
  of,
  retry,
  shareReplay,
  Subject,
  switchMap,
  takeWhile,
  tap,
  throwError,
  timer,
} from 'rxjs'
import { fromFetch } from 'rxjs/fetch'
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  type PublicClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  fallback,
  getAddress,
  getContract,
  http,
  isAddress,
  keccak256,
  toHex,
  zeroAddress,
  type Account,
  type Chain,
  type WalletClient,
  type WatchEventOnLogsParameter,
} from 'viem'
import {
  ABIS_V3_3,
  createReader,
  getAbiSet,
  getContractAbis,
  isBakedAddressBook,
  migrationActionOf,
  PROTOCOL_VERSION_V3_2,
  PROTOCOL_VERSION_V3_3,
  ProtocolVersionResolutionError,
  resolveProtocolContext,
  SPOKE_PHASE,
  STANDARD_ABIS,
  SPOKE_GATE_STATE,
  hubPhaseName,
  type SpokePhaseName,
  type AbiSet,
  type ContractAbis,
  type HubPhaseName,
  type ProtocolContext,
  type ProtocolVersion,
  type Reader,
} from '@centrifuge/protocol'
import type { AssetRegistrationRow, BlockchainRow, PoolMigrationRow, PoolRow } from '@centrifuge/queries/core'
import { readResponseBody, responseExcerpt } from '@centrifuge/queries/core'
import { ApiV3UnsupportedError, UnsupportedQueryError } from '@centrifuge/queries/graphql'
import {
  assertProvidedBookAllowed,
  bundledAddressBook,
  loadProvidedAddressBook,
  UNSAFE_BOOK_WARNING,
  type ActiveAddressBook,
} from './addressBook.js'
import { chains } from './config/chains.js'
import { spokeAssets } from './utils/spokeAssets.js'
import { PERMIT_TYPEHASH } from './constants.js'
import { GraphqlDataSource, type DataSource, type QueryName } from './data/DataSource.js'
import { resolveActionRoute, type ActionRouteTable } from './data/routing.js'
import { backendTransaction } from './tx/BackendPrepare.js'
import { Investor } from './entities/Investor.js'
import { classifyHubCalls } from './entities/hubPolicyPreflight.js'
import { Pool } from './entities/Pool.js'
import { migrationFacadeOf, spokePhaseOfRow, type PoolMigration } from './entities/PoolMigration.js'
import { unindexedRelaysOf } from './entities/migrationPlanRead.js'
import {
  queryCrosschainMessage,
  queryCrosschainMessages,
  type CrosschainMessageIncludes,
  type CrosschainMessagesFilter,
} from './entities/crosschainMessages.js'
import {
  IndexerResponseError,
  PoolMigratingError,
  RepayBatchError,
  RetryMessageError,
  WalletRequiredError,
} from './errors.js'
import type { RepayBatchRefusal, RetryMessageRefusal } from './errors.js'
import { LocalBuildStrategy, type PoolAction, type PoolActionName, type TxStrategy } from './tx/TxStrategy.js'
import type {
  Client,
  CurrencyDetails,
  DerivedConfig,
  EnvConfig,
  HexString,
  ProtocolContracts,
  UserProvidedConfig,
} from './types/index.js'
import { PoolMetadataInput } from './types/poolInput.js'
import { PoolMetadata, PoolMetadataV2 } from './types/poolMetadata.js'
import { parsePoolMetadataV2 } from './utils/poolMetadataMigration.js'
import type { CentrifugeQueryOptions, Query, QueryInvalidation } from './types/query.js'
import type { MarketplaceWorkflow, RuntimeVariable } from './types/workflow.js'
import { runtimeVariableName } from './types/workflow.js'
import {
  emptyMessage,
  MessageType,
  MessageTypeWithSubType,
  type BuildOnlyOptions,
  type BuiltCall,
  type BuiltTransaction,
  type OperationStatus,
  type OutOfPolicyCall,
  type PolicyCall,
  type Signer,
  type Transaction,
  type TransactionContext,
} from './types/transaction.js'
import { deployedAdapterAddresses } from './utils/adapters.js'
import { Balance } from './utils/BigInt.js'
import { parseMarketplaceCatalog } from './utils/catalog.js'
import { assertCidMatchesContent } from './utils/cid.js'
import { assertCrosschainMessagingEnabled } from './utils/crosschainHotfix.js'
import { addEstimateBuffer, estimateBatchBridgeFee } from './utils/gas.js'
import { generateShareClassSalt, randomUint } from './utils/index.js'
import { createPinning, getUrlFromHash, ipfsPathFromHash, isTrustedGatewayUrl } from './utils/ipfs.js'
import { hashKey } from './utils/query.js'
import { bytes32ToAddress, LAYER_ZERO_ENDPOINT_ABI, readLayerZeroDeliveries } from './utils/layerZeroDelivery.js'
import {
  CLOSED_BY_FIRST_OFFBOARD,
  judgedSpokesOf,
  judgeMigrationGate,
  spokeGateStateOf,
  unmappedActionRefusal,
  unreadableStateRefusal,
  type MigrationGateAnswer,
} from './utils/migrationGate.js'
import { makeThenable, repeatOnEvents, shareReplayWithDelayedReset } from './utils/rx.js'
import {
  BatchTransactionData,
  doTransaction,
  encodeBatchCalldata,
  mergeBatchTransactionData,
  isLocalAccount,
  parseEventLogs,
  wrapTransaction,
} from './utils/transaction.js'
import { AssetId, CentrifugeId, PoolId, ShareClassId } from './utils/types.js'

/**
 * Which spoke the migration gate judges a write on: the asset's chain when
 * `assetId` is given, else `centrifugeId`, else the pool's hub. A bridge names
 * its `destinationCentrifugeId` too and is gated at both ends.
 */
export type MigrationGateTarget = {
  centrifugeId?: CentrifugeId
  assetId?: string
  destinationCentrifugeId?: CentrifugeId
}

/** @internal The gate a raw `_transact` write runs before it resolves a signer. */
export type MigrationGate = {
  poolId: string
  action: PoolActionName
  targets: readonly MigrationGateTarget[]
}

const PINNING_API = 'https://pinning.centrifugelabs.io'

/**
 * How much longer `_queryData` waits between polls while a push seam is
 * connected.
 *
 * Five, so the default 120s catalogue poll becomes 10 minutes: long enough that
 * the push seam is doing the work, short enough that a stream which is
 * connected but silent — a table with no trigger yet, an emitter that stopped,
 * a frame lost in the window between `LISTEN` and its commit — self-corrects
 * within one screen-watching session rather than never.
 *
 * A factor rather than an absolute interval, and not exposed on `Config`:
 * callers already choose the poll interval per query, and this keeps the
 * connected interval proportional to whatever they chose instead of overriding
 * their judgement with one global number.
 */
export const PUSH_POLL_INTERVAL_FACTOR = 5

// Update when centrifuge/workflows cuts a new release
// CIDs are in the GitHub release notes: https://github.com/centrifuge/workflows/releases
/**
 * The `uint128` asset-id overload of HubRegistry's three same-arity `decimals` functions. Not
 * cosmetic: handed the full ABI, viem resolves a `bigint` to the narrowest matching overload
 * (`uint64`) and then throws `IntegerOutOfRangeError` for every real asset id, which are
 * 128-bit. Same treatment as `POOL_DECIMALS_ABI` in Pool.ts — narrow the registered ABI rather
 * than restate the signature inline, so the selector is explicit and the signature has one home.
 */
const assetDecimalsAbi = (abis: ContractAbis) =>
  abis.HubRegistry.filter(
    (item) => item.type === 'function' && item.name === 'decimals' && item.inputs[0]?.type === 'uint128'
  )

const WORKFLOW_MARKETPLACE_CID: Record<string, string> = {
  // centrifuge/workflows release `cfe52fa`. Both pins reproduce under canonical UnixFS parameters,
  // which `assertCidMatchesContent` below requires: with verification on, a non-canonical pin means
  // the app refuses its own catalog, so any bump has to come from a publish run whose `verify:cid`
  // gate passed. An unchanged catalog republishes to the same CID, so a pin only needs moving when
  // the catalog's contents change.
  mainnet: 'bafybeibkidba3sxjupzofqrj77k5hxehd3b265qhpzbfgmgrcs7jff2cte',
  testnet: 'bafybeif4jwyt63b422lcraghbntmmibejzoiph5jz5n7getpa5zwsky5ei',
}

// `indexerUrl` is POSTed to directly (see `_getIndexerObservable`), so it must be the
// GraphQL ENDPOINT, not the GraphiQL IDE that sits beside it: `/graphiql`
// answers GET with the browser IDE and 405s a POST.
//
// Both point at v4 (PostGraphile over `chain_v1`), which is what the default
// `graphqlTarget: 'public-api'` expects. Verified by introspection rather than
// assumed — the schema exposes the `*ByNodeId` fields that only PostGraphile
// generates. Before this change the two defaults disagreed: the target said
// public-api while the URL pointed at the api-v3 deployment.
//
// The api-v3 escape hatch stays available (`graphqlTarget: 'api-v3'` against an
// api-v3 `indexerUrl`), but it is now opt-in on both axes rather than being
// half the default.
//
// Known gap on these endpoints: `filter` is index-backed per column (see
// `docs/parity/09-sdk-catalogue-public-api.md`), so five catalogue entries
// still need a capability public-api does not have and throw
// `UnsupportedQueryError` here rather than degrading silently.
const envConfig = {
  mainnet: {
    indexerUrl: 'https://api-v4-main.cfg.embrio.tech/graphql',
    ipfsUrl: 'https://centrifuge-files.mypinata.cloud',
    ...createPinning(PINNING_API),
  },
  testnet: {
    indexerUrl: 'https://api-v4-test.cfg.embrio.tech/graphql',
    ipfsUrl: 'https://centrifuge-files.mypinata.cloud',
    ...createPinning(PINNING_API),
  },
} satisfies Record<string, EnvConfig>

const defaultConfig = {
  environment: 'mainnet',
  cache: true,
} satisfies UserProvidedConfig

/**
 * What `_protocolContext` resolves for. A `PoolId` resolves the pool's home
 * chain and version (through the `Reader`); a bare `CentrifugeId` resolves the
 * newest version deployed on the chain (spoke-side and pool-less flows); the
 * explicit pair pins a version (v3.3 migration windows).
 */
export type ProtocolContextTarget =
  | CentrifugeId
  | PoolId
  | { centrifugeId: CentrifugeId; protocolVersion?: ProtocolVersion }
  | { poolId: PoolId; centrifugeId: CentrifugeId }

/**
 * The SDK view of a resolved protocol context: the typed contract addresses
 * spread at the top level (the former address-map emission shape,
 * so destructuring call sites are unchanged) plus the version-plural fields.
 */
export type SdkProtocolContext = ProtocolContracts & {
  centrifugeId: CentrifugeId
  chainId: number
  protocolVersion: ProtocolVersion
  /** The resolved version's ABI set, keyed by registry contract name. */
  abis: AbiSet
  /** The resolved version's typed contract ABIs, keyed by contract name (`Hub`, `VaultRouter`, ...). */
  contractAbis: ContractAbis
  /**
   * Pure-builder context (`@centrifuge/protocol`), present when the target
   * was a `PoolId` — builders take this, never a chainId alone.
   */
  context?: ProtocolContext
}

function normalizeProtocolContextTarget(target: ProtocolContextTarget): {
  centrifugeId: CentrifugeId
  poolId?: PoolId
  protocolVersion?: ProtocolVersion
} {
  if (typeof target === 'number') return { centrifugeId: target }
  if (target instanceof PoolId) {
    return { centrifugeId: target.centrifugeId, poolId: target }
  }
  if ('poolId' in target) return { centrifugeId: target.centrifugeId, poolId: target.poolId }
  return { centrifugeId: target.centrifugeId, protocolVersion: target.protocolVersion }
}

async function readIndexerResponse<T>(res: Response, url: string): Promise<T> {
  const { text, json, isJson } = await readResponseBody(res)
  const envelope = isJson && json !== null && typeof json === 'object' ? (json as { data?: T; errors?: unknown }) : null
  if (Array.isArray(envelope?.errors) && envelope.errors.length) {
    throw envelope.errors
  }
  if (!res.ok || !envelope) {
    throw new IndexerResponseError(res.status, url, responseExcerpt(text))
  }
  return envelope.data as T
}

function projectedVersionOf(rows: PoolRow[], poolId: PoolId) {
  return rows.find((row) => poolId.equals(new PoolId(row.id)))?.protocolVersion
}

export class Centrifuge {
  #config: DerivedConfig
  get config() {
    return this.#config
  }

  #clients = new Map<number, Client>()
  getClient(centrifugeId: CentrifugeId): Query<Client> {
    return this._query(['client', centrifugeId], () =>
      this._idToChain(centrifugeId).pipe(
        map((chainId) => {
          const client = this.#clients.get(chainId)
          if (!client) throw new Error(`No client found for chain ID "${chainId}"`)
          return client
        })
      )
    )
  }
  get chains() {
    return [...this.#clients.keys()]
  }
  get chainConfigs() {
    return [...this.#clients.values()].map((client) => client.chain)
  }
  getChainConfig(centrifugeId: CentrifugeId) {
    return this._query(['chainConfig', centrifugeId], () =>
      this.getClient(centrifugeId).pipe(map((client) => client.chain))
    )
  }

  #signer: Signer | null = null
  setSigner(signer: Signer | null) {
    this.#signer = signer
  }
  get signer() {
    return this.#signer
  }

  #permitDisabled: boolean | null = null
  setPermitDisabled(value: boolean) {
    this.#permitDisabled = value
  }
  get permitDisabled() {
    return this.#permitDisabled ?? !!this.#config.permitDisabled
  }

  #dataSource: DataSource
  /**
   * The `DataSource` all reads go through: the injected `config.dataSource`, or
   * the default {@link GraphqlDataSource} when none was supplied.
   * @internal
   */
  get _dataSource() {
    return this.#dataSource
  }

  #txStrategy: TxStrategy
  /**
   * The `TxStrategy` writes are prepared with: the injected
   * `config.txStrategy`, or the default {@link LocalBuildStrategy} when none
   * was supplied.
   * @internal
   */
  get _txStrategy() {
    return this.#txStrategy
  }
  /**
   * Whether a `TxStrategy` was injected. Gates {@link _routeTransaction}: with
   * the default `LocalBuildStrategy` there is nowhere to route a write to, so
   * the per-action table is not consulted at all and every write is built
   * locally — which is what keeps a bare `new Centrifuge({ … })` unaffected by
   * whatever the table routes.
   */
  readonly #txStrategyInjected: boolean

  #isBatching = new WeakSet<Transaction>()
  // Transactions flagged for build-only mode, with the optional build-time
  // `fromAddress` used as `ctx.signingAddress` (see `buildOnly`). Build mode
  // reuses `wrapTransaction`'s batching branch to emit unsigned calldata, so a
  // build-flagged tx is also treated as batching internally.
  #buildOnly = new WeakMap<Transaction, { fromAddress: HexString }>()

  constructor(config: UserProvidedConfig = {}) {
    const defaultConfigForEnv = envConfig[config?.environment || 'mainnet']
    this.#config = {
      ...defaultConfig,
      ...defaultConfigForEnv,
      ...config,
    }
    Object.freeze(this.#config)
    if (this.#config.addressBook) {
      assertProvidedBookAllowed(this.#config.environment, this.#config.addressBook)
      if (!isBakedAddressBook(this.#config.addressBook.book)) console.warn(UNSAFE_BOOK_WARNING)
    }
    // Transport wiring. The seams are the whole configuration surface:
    // whatever is injected is used, and each seam independently falls back to
    // the published default — GraphQL reads, locally built transactions — which
    // is what a bare `new Centrifuge({ indexerUrl, rpcUrls })` gets. The seams
    // are orthogonal on purpose: injecting only a `dataSource` (backend reads,
    // wallet-signed writes) is a legitimate configuration, not an error.
    this.#dataSource =
      this.#config.dataSource ?? new GraphqlDataSource(this, this.#config.graphqlTarget ?? 'public-api')
    this.#txStrategyInjected = !!this.#config.txStrategy
    this.#txStrategy = this.#config.txStrategy ?? new LocalBuildStrategy(this)
    chains
      .filter((chain) => (this.#config.environment === 'mainnet' ? !chain.testnet : chain.testnet))
      .forEach((chain) => {
        const rpcUrl = this.#config.rpcUrls?.[chain.id] ?? undefined
        if (!rpcUrl) {
          // Falling through to `http()` with no URL only works when the chain
          // carries its own default endpoint. Some viem chains ship
          // `rpcUrls.default.http: []`, and there viem throws
          // `UrlRequiredError` from the constructor — taking down every chain's
          // client, not just this one, because construction is eager.
          //
          // Skip the chain instead, loudly. A later `getClient` for it reports
          // the chain as unconfigured rather than the SDK failing to build at
          // all; configure `rpcUrls[chainId]` to enable it.
          if (!chain.rpcUrls?.default?.http?.length) {
            console.warn(
              `No rpcUrl configured for chain ${chain.id} (${chain.name}) and it has no public default. ` +
                `Skipping: pass rpcUrls[${chain.id}] to enable it.`
            )
            return
          }
          console.warn(`No rpcUrl defined for chain ${chain.id}. Using public RPC endpoint.`)
        }
        this.#clients.set(
          chain.id,
          createPublicClient<any, Chain>({
            chain,
            // Only build a ranked fallback when there are multiple URLs to choose between. viem's
            // fallback `rank` health-checks each transport with `net_listening`, which some RPC
            // providers (e.g. Alchemy's Pharos endpoint) reject with HTTP 400 — that marks the
            // single transport as degraded and stalls every query on that chain. A lone URL needs
            // neither failover nor ranking, so use a plain `http()` transport.
            transport:
              Array.isArray(rpcUrl) && rpcUrl.length > 1
                ? fallback(
                    rpcUrl.map((url) => http(url)),
                    {
                      rank: {
                        interval: 30_000,
                        sampleCount: 5,
                      },
                    }
                  )
                : http(Array.isArray(rpcUrl) ? rpcUrl[0] : rpcUrl),
            batch: { multicall: true },
            pollingInterval: this.#config.pollingInterval,
            cacheTime: 100,
          })
        )
      })
  }

  /**
   * Create a new pool on the given chain.
   * @param metadataInput - The metadata for the pool
   * @param currencyCode - The currency code for the pool
   * @param chainId - The chain ID to create the pool on
   * @param counter - The pool counter, used to create a unique pool ID (uint48)
   */
  createPool(
    metadataInput: PoolMetadataInput,
    currencyCode = 840,
    centrifugeId: CentrifugeId,
    counter?: number | bigint
  ) {
    const self = this
    return this._transact(async function* (ctx) {
      const addresses = await self.protocolContext(centrifugeId)
      const ABI = addresses.contractAbis
      const poolId = PoolId.from(centrifugeId, counter ?? randomUint(48))

      const createPoolData = encodeFunctionData({
        abi: ABI.Hub,
        functionName: 'createPool',
        args: [poolId.raw, ctx.signingAddress, BigInt(currencyCode)],
      })

      const scIds = Array.from({ length: metadataInput.shareClasses.length }, (_, i) =>
        ShareClassId.from(poolId, i + 1)
      )

      const shareClassesById: PoolMetadata['shareClasses'] = {}
      metadataInput.shareClasses.forEach((sc, index) => {
        shareClassesById[scIds[index]!.raw] = {
          minInitialInvestment: sc.minInvestment,
          apyPercentage: sc.apyPercentage,
          apy: sc.apy,
          defaultAccounts: sc.defaultAccounts,
        }
      })

      const formattedMetadata: PoolMetadataV2 = {
        version: 2,
        pool: {
          name: metadataInput.poolName,
          icon: metadataInput.poolIcon,
          asset: {
            class: metadataInput.assetClass,
            subClass: metadataInput.subAssetClass,
          },
          issuer: {
            name: metadataInput.issuerName,
            email: metadataInput.email,
            logo: metadataInput.issuerLogo,
          },
          poolStructure: metadataInput.poolStructure,
          investorType: metadataInput.investorType,
          links: {
            executiveSummary: metadataInput.executiveSummary,
            forum: metadataInput.forum,
            website: metadataInput.website,
            ...(metadataInput.linkDocuments ? { documents: metadataInput.linkDocuments } : {}),
          },
          status: 'open',
          listed: metadataInput.listed ?? true,
          poolRatings: metadataInput.poolRatings.length > 0 ? metadataInput.poolRatings : [],
          factsheet: metadataInput.factsheet,
        },
        shareClasses: shareClassesById,
      }

      parsePoolMetadataV2(formattedMetadata)
      const cid = await self.config.pinJson(formattedMetadata)

      const setMetadataData = encodeFunctionData({
        abi: ABI.Hub,
        functionName: 'setPoolMetadata',
        args: [poolId.raw, toHex(cid)],
      })
      const addScData = metadataInput.shareClasses.map((sc) =>
        encodeFunctionData({
          abi: ABI.Hub,
          functionName: 'addShareClass',
          args: [
            poolId.raw,
            sc.tokenName,
            sc.symbolName,
            sc.salt?.startsWith('0x') ? (sc.salt as HexString) : generateShareClassSalt(poolId.raw),
          ],
        })
      )
      const accountIsDebitNormal = new Map<number, boolean>()
      const accountNumbers = [
        ...new Set(
          metadataInput.shareClasses.flatMap((sc) =>
            Object.entries(sc.defaultAccounts ?? {})
              .filter(([k, v]) => {
                if (!v) return false

                if (['asset', 'expense'].includes(k)) {
                  if (accountIsDebitNormal.get(v) === false)
                    throw new Error(`Account "${v}" is set as both credit normal and debit normal.`)
                  accountIsDebitNormal.set(v, true)
                } else {
                  if (accountIsDebitNormal.get(v) === true)
                    throw new Error(`Account "${v}" is set as both credit normal and debit normal.`)
                  accountIsDebitNormal.set(v, false)
                }

                return true
              })
              .map(([, v]) => v)
          )
        ),
      ]
      const createAccountsData = accountNumbers.map((account) =>
        encodeFunctionData({
          abi: ABI.Hub,
          functionName: 'createAccount',
          args: [poolId.raw, BigInt(account), accountIsDebitNormal.get(account)!],
        })
      )

      yield* doTransaction('Create pool', ctx, () => {
        return ctx.walletClient.writeContract({
          address: addresses.hub,
          abi: ABI.Hub,
          functionName: 'multicall',
          args: [[createPoolData, setMetadataData, ...addScData, ...createAccountsData]],
        })
      })
    }, centrifugeId)
  }

  id(chainId: number) {
    return this._chainToId(chainId)
  }

  /**
   * Get information about all supported blockchains from the indexer.
   */
  blockchains() {
    return this._queryData('blockchains', {}, (items: BlockchainRow[]) =>
      items.map((blockchain) => ({
        explorer: blockchain.explorer,
        chainId: Number(blockchain.chainId),
        centrifugeId: Number(blockchain.centrifugeId),
        icon: blockchain.icon,
        name: blockchain.name,
        network: blockchain.network,
      }))
    )
  }

  /**
   * Get the existing pools on the different chains.
   */
  pools() {
    return this._query(['pools'], () =>
      this._poolRows().pipe(map((rows) => rows.map((row) => new Pool(this, new PoolId(row.id).toString()))))
    )
  }

  /** @internal */
  _poolRows() {
    return this._queryData('pools', {}, (items: PoolRow[]) => items)
  }

  /** @internal */
  _poolRow(id: PoolId) {
    return this._query(['pools', 'row', id.toString()], () =>
      this._poolRows().pipe(
        map((rows) => {
          const row = rows.find((candidate) => id.equals(new PoolId(candidate.id)))
          if (!row) throw new Error(`Pool with id ${id} not found`)
          return row
        })
      )
    )
  }

  pool(id: PoolId) {
    return this._query(['pool', id.toString()], () =>
      this.pools().pipe(
        map((pools) => {
          const pool = pools.find((pool) => pool.id.equals(id))
          if (!pool) throw new Error(`Pool with id ${id} not found`)
          return pool
        })
      )
    )
  }

  /**
   * Get the metadata for an ERC20 or ERC6909 token
   * @param address - The token address
   * @param chainId - The chain ID
   */
  currency(address: HexString, centrifugeId: CentrifugeId, tokenId = 0n): Query<CurrencyDetails> {
    const curAddress = address.toLowerCase() as HexString
    return this._query(['currency', curAddress, centrifugeId, tokenId], () =>
      combineLatest([this.getClient(centrifugeId), this._idToChain(centrifugeId)]).pipe(
        switchMap(([client, chainId]) =>
          defer(async () => {
            let decimals: number, name: string, symbol: string, supportsPermit: boolean
            if (tokenId) {
              const contract = getContract({
                address: curAddress,
                abi: STANDARD_ABIS.ERC6909,
                client,
              })
              ;[decimals, name, symbol] = await Promise.all([
                contract.read.decimals([tokenId]),
                contract.read.name([tokenId]),
                contract.read.symbol([tokenId]),
              ])
              supportsPermit = false
            } else {
              const contract = getContract({
                address: curAddress,
                abi: STANDARD_ABIS.Currency,
                client,
              })
              ;[decimals, name, symbol, supportsPermit] = await Promise.all([
                contract.read.decimals(),
                contract.read.name(),
                contract.read.symbol(),
                contract.read
                  .PERMIT_TYPEHASH()
                  .then((hash) => hash === PERMIT_TYPEHASH)
                  .catch(() => false),
              ])
            }
            return {
              address: curAddress,
              tokenId,
              decimals,
              name,
              symbol,
              chainId,
              centrifugeId,
              supportsPermit,
            }
          })
        )
      )
    )
  }

  /**
   * Get the asset currency details for a given asset ID
   * @param assetId - The asset ID to query
   */
  assetCurrency(assetId: AssetId) {
    return this._query(['asset', assetId.toString()], () =>
      combineLatest([this.getClient(assetId.centrifugeId), this.protocolContext(assetId.centrifugeId)]).pipe(
        switchMap(async ([client, ctx]) => {
          const { address, tokenId } = await spokeAssets(client, ctx).requireAsset(assetId)
          return this.currency(address, assetId.centrifugeId, tokenId)
        })
      )
    )
  }

  investor(address: HexString) {
    return this._query(['investor', address.toLowerCase()], () => of(new Investor(this, address)))
  }

  /**
   * Get the balance of an ERC20 token for a given owner.
   * @param currency - The token address
   * @param owner - The owner address
   * @param chainId - The chain ID
   */
  balance(currency: HexString, owner: HexString, centrifugeId: CentrifugeId) {
    const address = owner.toLowerCase() as HexString
    return this._query(['balance', currency, owner, centrifugeId], () => {
      return combineLatest([this.currency(currency, centrifugeId), this.getClient(centrifugeId)]).pipe(
        switchMap(([currencyMeta, client]) =>
          defer(async () => {
            const val = await client.readContract({
              address: currency,
              abi: STANDARD_ABIS.Currency,
              functionName: 'balanceOf',
              args: [address],
            })

            return {
              balance: new Balance(val, currencyMeta.decimals),
              currency: currencyMeta,
            }
          }).pipe(
            repeatOnEvents(
              this,
              {
                address: currency,
                eventName: 'Transfer',
                filter: (events) => {
                  return events.some((event) => {
                    return event.args.from?.toLowerCase() === address || event.args.to?.toLowerCase() === address
                  })
                },
              },
              centrifugeId
            )
          )
        )
      )
    })
  }

  /**
   * Get the assets that exist on a given spoke chain that have been registered on a given hub chain.
   * @param spokeCentrifugeId - The Centrifuge ID where the assets exist
   * @param hubCentrifugeId - The Centrifuge ID where the assets should optionally be registered
   */
  assets(spokeCentrifugeId: number, hubCentrifugeId = spokeCentrifugeId) {
    return this._query(['assets', spokeCentrifugeId, hubCentrifugeId], () =>
      this._queryData<AssetRegistrationRow[]>('assetRegistrations', {
        centrifugeId: String(hubCentrifugeId),
      }).pipe(
        map((items) => {
          return items
            .filter((assetReg) => assetReg.asset && Number(assetReg.asset.centrifugeId) === spokeCentrifugeId)
            .map((assetReg) => {
              return {
                id: new AssetId(assetReg.assetId),
                address: assetReg.asset!.address,
                name: assetReg.asset!.name,
                symbol: assetReg.asset!.symbol,
                decimals: assetReg.asset!.decimals,
                tokenId: assetReg.asset!.assetTokenId ? BigInt(assetReg.asset!.assetTokenId) : undefined,
              }
            })
        })
      )
    )
  }

  /**
   * Get the valuation addresses that can be used for holdings.
   */
  valuations(centrifugeId: CentrifugeId) {
    return this._query(['valuations', centrifugeId], () =>
      this.protocolContext(centrifugeId).pipe(
        map(({ identityValuation }) => {
          return {
            identityValuation,
          }
        })
      )
    )
  }

  /**
   * Get the restriction hook addresses that can be used for share tokens.
   */
  restrictionHooks(centrifugeId: CentrifugeId) {
    return this._query(['restrictionHooks', centrifugeId], () =>
      this.protocolContext(centrifugeId).pipe(
        map(({ freezeOnlyHook, redemptionRestrictionsHook, fullRestrictionsHook, freelyTransferableHook }) => {
          return {
            freezeOnlyHook,
            redemptionRestrictionsHook,
            fullRestrictionsHook,
            freelyTransferableHook,
          }
        })
      )
    )
  }

  /**
   * Get the adapter addresses that are available for cross-chain communication.
   *
   * Each adapter is `undefined` on chains where it is not deployed; the
   * bundled registry does not ship `wormholeAdapter`, and `hyperlaneAdapter`
   * exists on v3.3 chains only.
   *
   * These are the adapters of the newest protocol version deployed on the
   * chain. For a pool, use {@link Pool.deployedAdapters}, which answers the
   * pool's own version.
   */
  adapters(centrifugeId: CentrifugeId) {
    return this._query(['adapters', centrifugeId], () =>
      this.protocolContext(centrifugeId).pipe(map(deployedAdapterAddresses))
    )
  }

  /**
   * Get the pool-0 adapter set and signature threshold configured on a hub's
   * MultiAdapter for messages targeting another network.
   *
   * This is NOT a fallback, despite the slot's name. `MultiAdapter.estimate`
   * and message dispatch read the slot for the payload's OWN pool id, and a
   * pool whose slot is unconfigured resolves to an empty adapter set rather
   * than to this one — which makes its fee estimate 0 and its messages
   * underpaid. Verified against live mainnet pools, several of which have
   * `quorum(target, poolId) == 0` while pool 0 has a configured quorum. Use
   * {@link Pool.adapters} for the set a given pool will actually use.
   *
   * The set is read on the MultiAdapter of the newest protocol version
   * deployed on the hub chain. For the set a pool may choose from, use
   * {@link Pool.globalAdapters}, which reads the pool's own version.
   *
   * @param hubCentrifugeId - The centrifuge ID of the hub chain where the
   *   MultiAdapter contract lives.
   * @param targetCentrifugeId - The centrifuge ID of the destination network.
   */
  globalAdapters(hubCentrifugeId: CentrifugeId, targetCentrifugeId: CentrifugeId) {
    return this._query(['globalAdapters', hubCentrifugeId, targetCentrifugeId], () =>
      this._readMultiAdapter(hubCentrifugeId, targetCentrifugeId, 0n)
    )
  }

  /**
   * @internal
   *
   * Read the adapter set and signature threshold for a `(target, poolId)` pair
   * from the MultiAdapter contract on a hub chain. `poolId` is `0n` for the
   * global default slot. Used by `Pool.adapters()` and `globalAdapters()`.
   */
  /**
   * Query cross-chain messages across all pools. Pass `filter.poolId` to scope
   * to one pool (or use `Pool.crosschainMessages` for the typed shortcut).
   *
   * Use `filter.include` to opt into nested data (pool, token, blockchains,
   * inner messages, adapter participations). For long lists, pass
   * `before`/`after` cursors from a previous page's `pageInfo`.
   */
  crosschainMessages(filter: CrosschainMessagesFilter = {}) {
    return queryCrosschainMessages(this, filter)
  }

  /**
   * Look up a single cross-chain message by its composite key
   * `(payloadId, payloadIndex)`. Returns `undefined` when the indexer has no
   * record. By default all available joins (pool, token, blockchains, inner
   * messages, adapter participations) are included.
   */
  crosschainMessage(id: HexString, index: number, include?: CrosschainMessageIncludes) {
    return queryCrosschainMessage(this, id, index, include)
  }

  _readMultiAdapter(
    on: ProtocolContextTarget | Observable<SdkProtocolContext>,
    targetCentrifugeId: CentrifugeId,
    poolId: bigint
  ) {
    const context$ = isObservable(on) ? on : this.protocolContext(on)
    return context$.pipe(
      switchMap((ctx) => this.getClient(ctx.centrifugeId).pipe(map((client) => [ctx, client] as const))),
      switchMap(([{ multiAdapter, contractAbis: ABI, protocolVersion }, client]) =>
        defer(async () => {
          // v3.3 keys the adapter list by session; the active session is the one in use.
          const sessionId =
            protocolVersion === PROTOCOL_VERSION_V3_3
              ? await client.readContract({
                  address: multiAdapter,
                  abi: ABIS_V3_3.MultiAdapter,
                  functionName: 'activeSessionId',
                  args: [targetCentrifugeId, poolId],
                })
              : undefined
          const [quorum, threshold] = await Promise.all([
            client.readContract({
              address: multiAdapter,
              abi: ABI.MultiAdapter,
              functionName: 'quorum',
              args: [targetCentrifugeId, poolId],
            }),
            client.readContract({
              address: multiAdapter,
              abi: ABI.MultiAdapter,
              functionName: 'threshold',
              args: [targetCentrifugeId, poolId],
            }),
          ])
          const adapters = await Promise.all(
            Array.from({ length: Number(quorum) }, (_, index) =>
              sessionId !== undefined
                ? client.readContract({
                    address: multiAdapter,
                    abi: ABIS_V3_3.MultiAdapter,
                    functionName: 'adapters',
                    args: [targetCentrifugeId, poolId, sessionId, BigInt(index)],
                  })
                : client.readContract({
                    address: multiAdapter,
                    abi: ABI.MultiAdapter,
                    functionName: 'adapters',
                    args: [targetCentrifugeId, poolId, BigInt(index)],
                  })
            )
          )
          return {
            adapters: adapters.map((addr) => addr.toLowerCase() as HexString),
            threshold: Number(threshold),
          }
        })
      )
    )
  }

  /**
   * Register an asset
   * @param originCentrifugeId - The centrifuge ID where the asset exists
   * @param registerOnCentrifugeId - The centrifuge ID where the asset should be registered
   * @param assetAddress - The address of the asset to register
   * @param tokenId - Optional token ID for ERC6909 assets
   */
  registerAsset(
    originCentrifugeId: CentrifugeId,
    registerOnCentrifugeId: CentrifugeId,
    assetAddress: HexString,
    tokenId: number | bigint = 0
  ) {
    const self = this
    return this._transact(
      (ctx) => self._registerAsset(ctx, originCentrifugeId, registerOnCentrifugeId, assetAddress, tokenId),
      originCentrifugeId
    )
  }

  /** @internal The steps of {@link registerAsset}, for a caller that runs them inside its own transaction context. */
  async *_registerAsset(
    ctx: TransactionContext,
    originCentrifugeId: CentrifugeId,
    registerOnCentrifugeId: CentrifugeId,
    assetAddress: HexString,
    tokenId: number | bigint = 0
  ) {
    assertCrosschainMessagingEnabled(originCentrifugeId)
    assertCrosschainMessagingEnabled(registerOnCentrifugeId)

    const [addresses, estimate] = await Promise.all([
      this.protocolContext(originCentrifugeId),
      this._estimate(originCentrifugeId, registerOnCentrifugeId, MessageType.RegisterAsset),
    ])
    return yield* doTransaction('Register asset', ctx, () =>
      ctx.walletClient.writeContract({
        address: addresses.spoke,
        abi: addresses.contractAbis.Spoke,
        functionName: 'registerAsset',
        args: [registerOnCentrifugeId, assetAddress, BigInt(tokenId), ctx.signingAddress],
        value: estimate,
      })
    )
  }

  /**
   * Repay an underpaid batch of messages on the source chain, in the Gateway that holds it.
   *
   * A chain can host more than one protocol version, each with its own Gateway, and an underpaid
   * batch waits in the Gateway of the version that sent it. Every version deployed on the source
   * is read for `underpaid(toCentrifugeId, keccak256(batch))`, and the repayment goes to the one
   * Gateway holding it, priced by the same version's MultiAdapter. Throws a {@link RepayBatchError}
   * before signing when no Gateway holds the batch, or more than one does.
   */
  repayBatch(fromCentrifugeId: number, toCentrifugeId: number, batch: HexString, extraPayment = 0n) {
    const self = this
    return this._transact(async function* (ctx) {
      const batchHash = keccak256(batch)
      const refuse = (
        reason: RepayBatchRefusal,
        message: string,
        candidates: readonly { protocolVersion: string; gateway: HexString }[]
      ) =>
        new RepayBatchError(message, {
          reason,
          fromCentrifugeId,
          toCentrifugeId,
          batchHash,
          gateways: candidates.map(({ protocolVersion, gateway }) => ({ protocolVersion, gateway })),
        })
      // `repay` refunds the overpayment to the signer; built without `fromAddress` that is the zero address.
      if (ctx.signingAddress.toLowerCase() === zeroAddress) {
        throw refuse(
          'no-refund-address',
          `repayBatch refunds to the signing address: build it with a \`fromAddress\` (batch hash "${batchHash}")`,
          []
        )
      }
      const { registry } = await self._addressBook()
      const versions = registry.versionsForChain(self.#config.environment, fromCentrifugeId)
      const contexts = await Promise.all(
        versions.map(async (protocolVersion) => {
          const { gateway, multiAdapter, contractAbis } = await self.protocolContext({
            centrifugeId: fromCentrifugeId,
            protocolVersion,
          })
          return { protocolVersion, gateway, multiAdapter, contractAbis }
        })
      )
      // Versions that share a Gateway would otherwise both read as holding the batch.
      const distinct = contexts.filter(
        (candidate, index) =>
          contexts.findIndex((other) => other.gateway.toLowerCase() === candidate.gateway.toLowerCase()) === index
      )
      const gateways = await Promise.all(
        distinct.map(async (candidate) => {
          const [gasLimit, counter] = await ctx.publicClient.readContract({
            address: candidate.gateway,
            abi: candidate.contractAbis.Gateway,
            functionName: 'underpaid',
            args: [toCentrifugeId, batchHash],
          })
          return { ...candidate, gasLimit, counter }
        })
      )
      const listGateways = (candidates: readonly { protocolVersion: string; gateway: HexString }[]) =>
        candidates.map((candidate) => `v${candidate.protocolVersion} ${candidate.gateway}`).join(', ')
      const holding = gateways.filter((candidate) => candidate.counter > 0n)
      if (holding.length === 0) {
        throw refuse(
          'not-underpaid',
          `No Gateway on centrifugeId ${fromCentrifugeId} holds an underpaid batch with hash "${batchHash}" ` +
            `to centrifugeId ${toCentrifugeId} (checked ${listGateways(gateways) || 'none'})`,
          gateways
        )
      }
      if (holding.length > 1) {
        throw refuse(
          'ambiguous',
          `More than one Gateway on centrifugeId ${fromCentrifugeId} holds an underpaid batch with hash ` +
            `"${batchHash}" to centrifugeId ${toCentrifugeId}: ${listGateways(holding)}`,
          holding
        )
      }
      const match = holding[0]!
      // Versions sharing the holding Gateway but not a MultiAdapter leave the price undecided.
      const sharers = contexts.filter((other) => other.gateway.toLowerCase() === match.gateway.toLowerCase())
      if (new Set(sharers.map((sharer) => sharer.multiAdapter.toLowerCase())).size > 1) {
        const adapters = sharers.map((sharer) => `v${sharer.protocolVersion} ${sharer.multiAdapter}`).join(', ')
        throw refuse(
          'ambiguous',
          `The Gateway ${match.gateway} on centrifugeId ${fromCentrifugeId} holding the underpaid batch with hash ` +
            `"${batchHash}" is shared by versions with different MultiAdapters: ${adapters}`,
          sharers
        )
      }
      const estimate = await ctx.publicClient.readContract({
        address: match.multiAdapter,
        abi: match.contractAbis.MultiAdapter,
        functionName: 'estimate',
        args: [toCentrifugeId, batch, match.gasLimit],
      })
      yield* wrapTransaction('Repay', ctx, {
        contract: match.gateway,
        data: encodeFunctionData({
          abi: match.contractAbis.Gateway,
          functionName: 'repay',
          args: [toCentrifugeId, batch, ctx.signingAddress],
        }),
        value: addEstimateBuffer(estimate) + extraPayment,
      })
    }, fromCentrifugeId)
  }

  /**
   * Retry a failed message on the destination chain, in the Gateway that holds it.
   *
   * A chain can host more than one protocol version, each with its own Gateway, and a failed
   * message waits in the Gateway of the version that received it. Every version deployed on the
   * destination is read for `failedMessages(fromCentrifugeId, keccak256(message))`, and the retry
   * goes to the one Gateway holding it. Throws before signing when no Gateway holds the message,
   * or more than one does.
   */
  retryMessage(fromCentrifugeId: number, toCentrifugeId: number, message: HexString) {
    const self = this
    return this._transact(async function* (ctx) {
      const { registry } = await self._addressBook()
      const versions = registry.versionsForChain(self.#config.environment, toCentrifugeId)
      const messageHash = keccak256(message)
      const gateways = await Promise.all(
        versions.map(async (protocolVersion) => {
          const { gateway, contractAbis } = await self.protocolContext({
            centrifugeId: toCentrifugeId,
            protocolVersion,
          })
          const parked = await ctx.publicClient.readContract({
            address: gateway,
            abi: contractAbis.Gateway,
            functionName: 'failedMessages',
            args: [fromCentrifugeId, messageHash],
          })
          return { protocolVersion, gateway, abi: contractAbis.Gateway, parked }
        })
      )
      const listGateways = (candidates: typeof gateways) =>
        candidates.map((candidate) => `v${candidate.protocolVersion} ${candidate.gateway}`).join(', ')
      const refuse = (reason: RetryMessageRefusal, message: string, candidates: typeof gateways) =>
        new RetryMessageError(message, {
          reason,
          fromCentrifugeId,
          toCentrifugeId,
          messageHash,
          gateways: candidates.map(({ protocolVersion, gateway }) => ({ protocolVersion, gateway })),
        })
      const holding = gateways.filter((candidate) => candidate.parked > 0n)
      if (holding.length === 0) {
        throw refuse(
          'not-parked',
          `No Gateway on centrifugeId ${toCentrifugeId} holds a failed message with hash "${messageHash}" ` +
            `from centrifugeId ${fromCentrifugeId} (checked ${listGateways(gateways) || 'none'})`,
          gateways
        )
      }
      if (holding.length > 1) {
        throw refuse(
          'ambiguous',
          `More than one Gateway on centrifugeId ${toCentrifugeId} holds a failed message with hash ` +
            `"${messageHash}" from centrifugeId ${fromCentrifugeId}: ${listGateways(holding)}`,
          holding
        )
      }
      const match = holding[0]!
      yield* wrapTransaction('Retry', ctx, {
        contract: match.gateway,
        data: encodeFunctionData({
          abi: match.abi,
          functionName: 'retry',
          args: [fromCentrifugeId, message],
        }),
      })
    }, toCentrifugeId)
  }

  /**
   * Where each LayerZero message that a transaction on `fromCentrifugeId` sent to `toCentrifugeId` stands on the
   * destination: `delivered`, `inFlight`, `stuck` (verified and not executed) or `skipped`. A pool's first activation
   * on a network sends its pool messages with the adapter configuration, and a pool message that arrives first
   * reverts at the destination with `InvalidAdapter()` and stays `stuck` until {@link retryLayerZeroDelivery}
   * re-executes it. Read from the transaction's `PacketSent` events and the destination's LayerZero endpoint.
   */
  layerZeroDeliveries(fromCentrifugeId: CentrifugeId, toCentrifugeId: CentrifugeId, txHash: HexString) {
    return this._query(null, () => defer(() => this.#readLayerZeroDeliveries(fromCentrifugeId, toCentrifugeId, txHash)))
  }

  /**
   * Re-executes, on `toCentrifugeId`, every `stuck` LayerZero message a transaction on `fromCentrifugeId` sent there
   * (see {@link layerZeroDeliveries}), one transaction each. Anyone can send it; the pool manager does not need to.
   * Each re-execution is simulated first, so one that would still revert is refused before signing: with
   * `InvalidAdapter()`, the pool's adapters have not arrived on the destination yet. A message the LayerZero executor
   * delivers in the meantime is skipped, before or after a send of ours reverts for it. Built, it yields the first
   * stuck message's transaction only.
   */
  retryLayerZeroDelivery(fromCentrifugeId: CentrifugeId, toCentrifugeId: CentrifugeId, txHash: HexString) {
    const self = this
    return this._transact(async function* (ctx) {
      const deliveries = await self.#readLayerZeroDeliveries(fromCentrifugeId, toCentrifugeId, txHash)
      const stuck = deliveries.filter((delivery) => delivery.status === 'stuck')
      if (stuck.length === 0) {
        const seen = deliveries.map((d) => `nonce ${d.nonce}: ${d.status}`).join(', ')
        throw new Error(
          `Nothing to retry: transaction ${txHash} on centrifugeId ${fromCentrifugeId} has no stuck LayerZero ` +
            `message to centrifugeId ${toCentrifugeId} (${seen || 'it sent none'})`
        )
      }
      // The executor can still deliver a `stuck` message at any moment; ours then reverts on the cleared payload.
      const stillStuck = async (guid: HexString) =>
        (await self.#readLayerZeroDeliveries(fromCentrifugeId, toCentrifugeId, txHash)).some(
          (d) => d.guid === guid && d.status === 'stuck'
        )
      for (const [i, delivery] of stuck.entries()) {
        if (i > 0 && !(await stillStuck(delivery.guid))) continue
        const title =
          stuck.length === 1 ? 'Retry LayerZero delivery' : `Retry LayerZero delivery (${i + 1}/${stuck.length})`
        const args = [
          { srcEid: delivery.srcEid, sender: delivery.sender, nonce: delivery.nonce },
          bytes32ToAddress(delivery.receiver),
          delivery.guid,
          delivery.message,
          '0x',
        ] as const
        try {
          await ctx.publicClient.simulateContract({
            account: ctx.signingAddress,
            address: delivery.endpoint,
            abi: LAYER_ZERO_ENDPOINT_ABI,
            functionName: 'lzReceive',
            args,
          })
        } catch (error) {
          if (!(await stillStuck(delivery.guid))) continue
          const reverted =
            error instanceof BaseError ? error.walk((e) => e instanceof ContractFunctionRevertedError) : null
          const reason =
            reverted instanceof ContractFunctionRevertedError && reverted.data?.errorName
              ? `${reverted.data.errorName}()`
              : error instanceof BaseError
                ? error.shortMessage
                : String(error)
          throw new Error(
            `Re-executing LayerZero nonce ${delivery.nonce} (guid ${delivery.guid}) on centrifugeId ` +
              `${toCentrifugeId} still reverts with ${reason}. With InvalidAdapter(), the pool's adapters have not ` +
              `arrived there yet; retry once they have.`,
            { cause: error }
          )
        }
        const data = encodeFunctionData({ abi: LAYER_ZERO_ENDPOINT_ABI, functionName: 'lzReceive', args })
        try {
          yield* wrapTransaction(title, ctx, { contract: delivery.endpoint, data })
        } catch (error) {
          if (await stillStuck(delivery.guid)) throw error
        }
      }
    }, toCentrifugeId)
  }

  async #readLayerZeroDeliveries(fromCentrifugeId: CentrifugeId, toCentrifugeId: CentrifugeId, txHash: HexString) {
    const { registry } = await this._addressBook()
    const adaptersOn = (centrifugeId: CentrifugeId) =>
      Promise.all(
        registry
          .versionsForChain(this.#config.environment, centrifugeId)
          .map((protocolVersion) => this.protocolContext({ centrifugeId, protocolVersion }))
      ).then((contexts) => [
        ...new Map(
          contexts
            .map((context) => context.layerZeroAdapter)
            .filter((adapter): adapter is HexString => adapter !== undefined)
            .map((adapter) => [adapter.toLowerCase(), adapter])
        ).values(),
      ])
    const [sourceClient, destinationClient, sourceAdapters, destinationAdapters] = await Promise.all([
      this.getClient(fromCentrifugeId),
      this.getClient(toCentrifugeId),
      adaptersOn(fromCentrifugeId),
      adaptersOn(toCentrifugeId),
    ])
    return readLayerZeroDeliveries(
      { client: sourceClient, adapters: sourceAdapters },
      { client: destinationClient, adapters: destinationAdapters },
      txHash
    )
  }

  /**
   * Get the decimals of an asset as the pool's hub registry knows them
   * @internal
   */
  _assetDecimals(assetId: AssetId, poolId: PoolId) {
    return this._query(['assetDecimals', assetId.toString(), poolId.toString()], () =>
      combineLatest([this.protocolContext(poolId), this.getClient(poolId.centrifugeId)]).pipe(
        switchMap(([{ hubRegistry, contractAbis: ABI }, client]) =>
          client.readContract({
            address: hubRegistry,
            abi: assetDecimalsAbi(ABI),
            functionName: 'decimals',
            args: [assetId.raw],
          })
        )
      )
    )
  }

  /**
   * Get the allowance of an ERC20 or ERC6909 token.
   * which is the contract that moves funds into the vault on behalf of the investor.
   * @param owner - The address of the owner
   * @param spender - The address of the spender
   * @param centrifugeId - The centrifuge ID where the asset is located
   * @param asset - The address of the asset
   * @param tokenId - Optional token ID for ERC6909 assets
   * @internal
   */
  _allowance(owner: HexString, spender: HexString, centrifugeId: CentrifugeId, asset: HexString, tokenId?: bigint) {
    return this._query(
      ['allowance', owner.toLowerCase(), spender.toLowerCase(), asset.toLowerCase(), centrifugeId, tokenId],
      () =>
        this.getClient(centrifugeId).pipe(
          switchMap((client) =>
            defer(async () => {
              if (tokenId) {
                return client.readContract({
                  address: asset,
                  abi: STANDARD_ABIS.ERC6909,
                  functionName: 'allowance',
                  args: [owner, spender, tokenId],
                })
              }
              return client.readContract({
                address: asset,
                abi: STANDARD_ABIS.Currency,
                functionName: 'allowance',
                args: [owner, spender],
              })
            }).pipe(
              repeatOnEvents(
                this,
                {
                  address: asset,
                  eventName: ['Approval', 'Transfer'],
                  filter: (events) => {
                    return events.some((event) => {
                      return (
                        event.args.owner?.toLowerCase() === owner.toLowerCase() ||
                        event.args.spender?.toLowerCase() === owner.toLowerCase() ||
                        event.args.from?.toLowerCase() === owner.toLowerCase()
                      )
                    })
                  },
                },
                centrifugeId
              )
            )
          )
        )
    )
  }

  /**
   * Returns an observable of all events on a given chain.
   * @internal
   */
  _events(centrifugeId: CentrifugeId) {
    return this._query(
      ['events', centrifugeId],
      () =>
        this.getClient(centrifugeId).pipe(
          switchMap(
            (client) =>
              new Observable<WatchEventOnLogsParameter>((subscriber) => {
                const unwatch = client.watchEvent({
                  onLogs: (logs) => subscriber.next(logs),
                })
                return unwatch
              })
          ),
          filter((logs) => logs.length > 0),
          shareReplay({ bufferSize: 1, refCount: true }) // ensures only one watcher per centrifugeId
        ),
      { cache: true }
    )
  }

  /**
   * Returns an observable of events on a given chain, filtered by name(s) and address(es).
   * @internal
   */
  _filteredEvents(
    address: HexString | HexString[],
    eventName: string | string[],
    centrifugeId: CentrifugeId,
    protocolVersion?: ProtocolVersion
  ) {
    const version$ = protocolVersion
      ? of(protocolVersion)
      : defer(() => this._reader.chainProtocolVersion(centrifugeId))
    return version$.pipe(
      switchMap((version) =>
        this._events(centrifugeId).pipe(
          map((logs) => parseEventLogs({ address, eventName, logs, protocolVersion: version })),
          filter((logs) => logs.length > 0)
        )
      )
    )
  }

  /**
   * @internal
   */
  _getIndexerObservable<T = any>(query: string, variables?: Record<string, any>) {
    return fromFetch<T>(this.config.indexerUrl, {
      ...this.#indexerRequest(query, variables),
      selector: (res) => readIndexerResponse<T>(res, this.config.indexerUrl),
    })
  }

  /**
   * Execute one GraphQL document against the configured indexer.
   *
   * The transport half of the graphql `DataSource`: `@centrifuge/queries`
   * owns the documents and their result shaping, the SDK owns the
   * fetch. Identical wire behaviour to `_getIndexerObservable` — same URL,
   * headers, body and error surface — expressed as a promise because a single
   * public-api catalogue entry may compose several reads.
   * @internal
   */
  async _executeGraphql<T = any>(query: string, variables?: Record<string, any>): Promise<T> {
    const res = await fetch(this.config.indexerUrl, this.#indexerRequest(query, variables))
    return readIndexerResponse<T>(res, this.config.indexerUrl)
  }

  #indexerRequest(query: string, variables?: Record<string, any>): RequestInit {
    return {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    }
  }

  /**
   * Query data through the configured `DataSource`, wrapped in the `_query`
   * cache with polling. When the source has an `invalidations$` push seam, an
   * invalidation for `(name, vars)` additionally triggers an immediate refetch.
   *
   * This is the read seam of the SDK. In public mode the data source is the
   * {@link GraphqlDataSource} and the entry "name" is a catalogue entry name;
   * the documents live in `@centrifuge/queries` and the SDK holds no GraphQL
   * strings of its own.
   *
   * ## Polling with a push seam
   *
   * A source WITHOUT `invalidations$` takes the same single line it always
   * has — one timer, one interval — because "no push seam" and "a source that
   * never pushes" have to be the same behaviour, not merely a similar one.
   *
   * With a push seam the timer does not stop. Invalidations are at-most-once
   * hints: `LISTEN` only takes effect on commit, `NOTIFY` never replays, and
   * every reconnect is a hole in the stream, so a client that stopped polling
   * would sit on stale data with no way to notice. It becomes a BACKSTOP
   * instead — {@link PUSH_POLL_INTERVAL_FACTOR} times the interval while the
   * stream is connected, and the normal interval the moment it is not.
   *
   * A connectivity change restarts the timer, which refetches immediately.
   * That is wanted in both directions: coming up, it establishes a fresh
   * baseline for a stream that may already have missed something; going down,
   * it covers whatever was missed while the stream was failing.
   * @internal
   */
  _queryData<Result>(name: QueryName, vars?: Record<string, any>): Query<Result>
  _queryData<Result>(
    name: QueryName,
    vars?: Record<string, any>,
    postProcess?: undefined,
    pollInterval?: number
  ): Query<Result>
  _queryData<Result, Return>(
    name: QueryName,
    vars: Record<string, any> | undefined,
    postProcess: (data: Result) => Return,
    pollInterval?: number
  ): Query<Return>
  _queryData<Result, Return = Result>(
    name: QueryName,
    vars?: Record<string, any>,
    postProcess?: (data: Result) => Return,
    pollInterval = this.config.indexerPollingInterval ?? 120_000
  ) {
    const source = this.#dataSource
    const rows = this._query([name, vars], () => {
      // If subscribed, refetch every `pollInterval` milliseconds. A source with
      // a push seam additionally triggers a refetch on every invalidation, and
      // its timer stretches while the stream is connected.
      const invalidations$ = source
        .invalidations$?.(name, vars)
        .pipe(tap(() => this.#queryInvalidations.next({ keys: [name, vars] })))
      const refetch$ = invalidations$
        ? merge(
            (source.pushConnected$?.() ?? of(false)).pipe(
              distinctUntilChanged(),
              switchMap((connected) => timer(0, connected ? pollInterval * PUSH_POLL_INTERVAL_FACTOR : pollInterval))
            ),
            invalidations$
          )
        : timer(0, pollInterval)
      return refetch$.pipe(switchMap(() => source.query(name, vars)))
    })
    // The cache holds the source's rows, so two readers of one query with different post-processing never get each
    // other's shape.
    return postProcess ? this._query(null, () => rows.pipe(map(postProcess))) : rows
  }

  /**
   * One fetch of a data query, outside the memoised, polling observable of {@link _queryData}:
   * for callers that need the indexer's current answer right now (e.g. a wait loop) without
   * touching, or invalidating, the cached stream other subscribers share.
   * @internal
   */
  _queryDataOnce<Result>(name: QueryName, vars?: Record<string, any>): Promise<Result> {
    return firstValueFrom(this.#dataSource.query(name, vars) as Observable<Result>)
  }

  /**
   * @internal
   */
  _queryIPFS<Result>(hash: string): Query<Result> {
    return this._query([hash], () =>
      defer(async () => {
        const url = getUrlFromHash(hash, this.#config.ipfsUrl)
        if (!url || !isTrustedGatewayUrl(url, this.#config.ipfsUrl)) {
          throw new Error(`Invalid IPFS hash: ${hash}`)
        }
        const res = await fetch(url)
        if (!res.ok) {
          throw new Error(`Error fetching IPFS hash ${hash}: ${res.statusText}`)
        }
        // The gateway, or anything between us and it, can serve any bytes, and pool metadata feeds
        // policy edits, Merkle roots and the metadata migration. Use it only when it hashes to the
        // CID the chain names; a path inside a directory CID cannot be checked and is refused.
        const body = new Uint8Array(await res.arrayBuffer())
        assertCidMatchesContent(ipfsPathFromHash(hash), body, 'IPFS metadata')
        return JSON.parse(new TextDecoder().decode(body)) as Result
      })
    )
  }

  /**
   * The catalog CID {@link workflowMarketplace} reads for this environment, or the one passed in.
   *
   * Callers that record what they resolved — a hub manager whitelisting a workflow writes it to
   * `WorkflowPolicyEntry.catalogCid` — need the CID the SDK actually used, which is otherwise not
   * observable: the default moves with SDK releases, so "the current default" is not a stable answer
   * after the fact.
   *
   * @throws if no CID is configured for the environment and none is passed.
   */
  workflowMarketplaceCid(cid?: string): string {
    const resolvedCid = cid ?? WORKFLOW_MARKETPLACE_CID[this.#config.environment] ?? ''
    if (!resolvedCid) {
      throw new Error(
        `workflowMarketplace: no CID configured for environment "${this.#config.environment}". ` +
          `Pass a CID explicitly or update WORKFLOW_MARKETPLACE_CID in Centrifuge.ts.`
      )
    }
    return resolvedCid
  }

  /**
   * Fetches the centrifuge/workflows marketplace catalog from IPFS and returns
   * all non-callback workflows for the current environment.
   *
   * Uses the SDK's configured `ipfsUrl` gateway. Falls back to a hardcoded
   * default CID per environment when none is provided — pass an explicit `cid`
   * to pin to a specific release without bumping the SDK (e.g. from an env var).
   *
   * Callback workflows (`useTemplate` present) are filtered out automatically.
   */
  workflowMarketplace(cid?: string): Query<MarketplaceWorkflow[]> {
    const resolvedCid = this.workflowMarketplaceCid(cid)
    return this._query(['workflowMarketplace', resolvedCid], () =>
      defer(async () => {
        const url = getUrlFromHash(resolvedCid, this.#config.ipfsUrl)
        if (!url || !isTrustedGatewayUrl(url, this.#config.ipfsUrl)) {
          throw new Error(`workflowMarketplace: invalid CID "${resolvedCid}"`)
        }
        const res = await fetch(url)
        if (!res.ok) throw new Error(`workflowMarketplace: IPFS fetch failed — ${res.status} ${res.statusText}`)
        // An IPFS gateway fetch is a plain HTTP GET: content addressing buys nothing unless the
        // client checks it. This catalog is what strategist policy roots are derived from, so an
        // unverified response makes a gateway compromise equivalent to choosing which scripts a
        // manager whitelists. Verify the bytes hash to the CID before parsing or trusting them.
        const body = new Uint8Array(await res.arrayBuffer())
        assertCidMatchesContent(resolvedCid, body, 'workflowMarketplace')
        const catalog = JSON.parse(new TextDecoder().decode(body))
        // Validate the untrusted catalog shape before mapping. Throws on structural /
        // integrity problems (unknown template ref, malformed variables/workflowId)
        // instead of silently coercing them through `as any`.
        const { templates, workflows: rawWorkflows } = parseMarketplaceCatalog(catalog)
        return rawWorkflows
          .filter((w: any) => !w.useTemplate)
          .map((w: any): MarketplaceWorkflow => {
            // Runtime inputs are the template's `kind: runtime` variables (explicit-input-kinds
            // tagged format), carrying the optional token/source UI links.
            const runtimeVariableEntries: RuntimeVariable[] = (templates[w.template]?.variables ?? [])
              .filter((v) => v.kind === 'runtime')
              .map((v) => ({
                name: v.name,
                ...(v.token ? { token: v.token } : {}),
                ...(v.source ? { source: v.source } : {}),
              }))
            return {
              workflowRef: w.id ?? w.workflowRef,
              name: w.name,
              template: w.template,
              category: w.category,
              group: w.group,
              chainId: w.chainId,
              iconUrl: w.icon ?? w.iconUrl,
              variables: w.variables ?? {},
              workflowId: w.workflowId ? (w.workflowId.startsWith('0x') ? w.workflowId : `0x${w.workflowId}`) : '',
              version: w.version,
              workspace: w.workspace,
              useTemplate: w.useTemplate,
              templates,
              actions: templates[w.template]?.actions ?? [],
              runtimeVariables: runtimeVariableEntries.map(runtimeVariableName),
              runtimeVariableEntries,
            }
          })
      })
    )
  }

  #memoized = new Map<string, { keys: any[]; value: any }>()
  #queryInvalidations = new Subject<QueryInvalidation>()

  /**
   * Emits whenever cached query results may be stale: after {@link clearQueryCache} drops entries,
   * and — when the data source has a push seam — when the backend pushes an invalidation for a
   * subscribed `_queryData` entry (`keys: [name, vars]`). On a push the SDK refetches that entry
   * itself, so the signal tells an app-level cache to re-read; it does not drop anything.
   * Meant for an app-level cache (e.g. react-query) layered on top of the SDK — re-read what the
   * signal covers. `keys: null` means everything. Hints only, never data; no replay.
   */
  readonly queryInvalidations$: Observable<QueryInvalidation> = this.#queryInvalidations.asObservable()

  #hubPolicyRefreshes = new Subject<string>()

  /**
   * The pools whose `refreshHubPolicyReads()` was called; the two hub policy reads subscribe their indexer queries again
   * on it. Not derived from {@link queryInvalidations$}, so that a plain {@link clearQueryCache} of the same keys stays
   * what it is: no refresh of a running subscription.
   * @internal
   */
  readonly _hubPolicyRefreshes$: Observable<string> = this.#hubPolicyRefreshes.asObservable()

  /** @internal */
  _signalHubPolicyRefresh(poolId: string) {
    this.#hubPolicyRefreshes.next(poolId)
  }

  #memoizeWith<T = any>(keys: any[], callback: () => T): T {
    const cacheKey = hashKey(keys)
    const cached = this.#memoized.get(cacheKey)
    if (cached) {
      return cached.value
    }
    const result = callback()
    this.#memoized.set(cacheKey, { keys, value: result })
    return result
  }

  /**
   * Clears the internal observable query cache.
   * Call this after transactions to ensure subsequent queries fetch fresh data
   * instead of returning stale cached values from shared observables.
   *
   * Without arguments the whole cache is dropped. With a `keyPrefix` only the entries cached under
   * a key starting with it are dropped, e.g. `clearQueryCache(['pool', poolId.toString()])`.
   * Queries already subscribed keep their current observable; only the next read of a dropped
   * key builds a fresh one. Emits on {@link queryInvalidations$}.
   */
  clearQueryCache(keyPrefix?: readonly unknown[]) {
    if (!keyPrefix) {
      this.#memoized.clear()
      this.#queryInvalidations.next({ keys: null })
      return
    }
    const prefix = hashKey(keyPrefix as any[])
    for (const [cacheKey, { keys }] of this.#memoized) {
      if (hashKey(keys.slice(0, keyPrefix.length)) === prefix) {
        this.#memoized.delete(cacheKey)
      }
    }
    this.#queryInvalidations.next({ keys: keyPrefix })
  }

  /**
   * Wraps an observable, memoizing the result based on the keys provided.
   * If keys are provided, the observable will be memoized, multicasted, and the last emitted value cached.
   * Additional options can be provided to control the caching behavior.
   * By default, the observable will keep the last emitted value and pass it immediately to new subscribers.
   * When there are no subscribers, the observable resets after a short timeout and purges the cached value.
   *
   * @example
   *
   * ```ts
   * const address = '0xabc...123'
   * const tUSD = '0x456...def'
   * const centrifugeId = 1
   *
   * // Wrap an observable that continuously emits values
   * const query = this._query(['balance', address, tUSD, centrifugeId], () => {
   *   return defer(() => fetchBalance(address, tUSD, centrifugeId))
   *   .pipe(
   *     repeatOnEvents(
   *       this,
   *       {
   *         address: tUSD,
   *         eventName: 'Transfer',
   *       },
   *       centrifugeId
   *     )
   *   )
   * })
   *
   * // Logs the current balance and updated balances whenever a transfer event is emitted
   * const obs1 = query.subscribe(balance => console.log(balance))
   *
   * // Subscribing twice only fetches the balance once and will emit the same value to both subscribers
   * const obs2 = query.subscribe(balance => console.log(balance))
   *
   * // ... sometime later
   *
   * // Later subscribers will receive the last emitted value immediately
   * const obs3 = query.subscribe(balance => console.log(balance))
   *
   * // Awaiting the query will also immediately return the last emitted value or wait for the next value
   * const balance = await query
   *
   * obs1.unsubscribe()
   * obs2.unsubscribe()
   * obs3.unsubscribe()
   * ```
   *
   * ```ts
   * const address = '0xabc...123'
   * const tUSD = '0x456...def'
   * const centrifugeId = 1
   *
   * // Wrap an observable that only emits one value and then completes
   * const query = this._query(['balance', address, tUSD, centrifugeId], () => {
   *   return defer(() => fetchBalance(address, tUSD, centrifugeId))
   * }, { valueCacheTime: 60_000 })
   *
   * // Logs the current balance and updated balances whenever a new
   * const obs1 = query.subscribe(balance => console.log(balance))
   *
   * // Subscribing twice only fetches the balance once and will emit the same value to both subscribers
   * const obs2 = query.subscribe(balance => console.log(balance))
   *
   * // ... sometime later
   *
   * // Later subscribers will receive the last emitted value immediately
   * const obs3 = query.subscribe(balance => console.log(balance))
   *
   * // Awaiting the query will also immediately return the last emitted value or wait for the next value
   * const balance = await query
   *
   * obs1.unsubscribe()
   * obs2.unsubscribe()
   * obs3.unsubscribe()
   * ```
   *
   * @internal
   */
  _query<T>(keys: any[] | null, observableCallback: () => Observable<T>, options?: CentrifugeQueryOptions): Query<T> {
    const cache = options?.cache !== false && this.#config.cache !== false
    const obsCacheTime = options?.observableCacheTime ?? this.#config.pollingInterval ?? 4000
    // When repeatOnEvents is disabled, sources complete after emitting.
    // Reset on complete so the memoized observable fetches fresh data next time.
    const resetOnComplete = !!this.#config.disableRepeatOnEvents

    function get() {
      const $shared = observableCallback().pipe(
        shareReplayWithDelayedReset({
          bufferSize: cache ? 1 : 0,
          resetDelay: cache ? obsCacheTime : 0,
          resetOnComplete,
        })
      )
      return makeThenable($shared)
    }

    return keys ? this.#memoizeWith(keys, get) : get()
  }

  /**
   * Executes one or more transactions on a given chain.
   * When subscribed to, it emits status updates as it progresses.
   * When awaited, it returns the final confirmed result if successful.
   * Will additionally prompt the user to switch chains if they're not on the correct chain, unless `switchChain` is false.
   *
   * @example
   *
   * ```ts
   * const tx = this._transact(async function* ({ walletClient, publicClient, chainId, signingAddress, signer }) {
   *   const permit = yield* doSignMessage('Sign Permit', () => {
   *     return signPermit(walletClient, signer, chainId, signingAddress, '0xabc...123', '0xdef...456', 1000000n)
   *   })
   *   yield* doTransaction('Invest', publicClient, () =>
   *     walletClient.writeContract({
   *       address: '0xdef...456',
   *       abi: ABI.LiquidityPool,
   *       functionName: 'requestDepositWithPermit',
   *       args: [1000000n, permit],
   *     })
   *   )
   * }, 1)
   * tx.subscribe(status => console.log(status))
   *
   * // Results in something like the following values being emitted (assuming the user was on the right chain):
   * // { type: 'SigningMessage', title: 'Sign Permit' }
   * // { type: 'SignedMessage', title: 'Sign Permit', signed: { ... } }
   * // { type: 'SigningTransaction', title: 'Invest' }
   * // { type: 'TransactionPending', title: 'Invest', hash: '0x123...abc' }
   * // { type: 'TransactionConfirmed', title: 'Invest', hash: '0x123...abc', receipt: { ... } }
   * ```
   *
   * @internal
   */
  _transact(
    transactionCallback: (
      params: TransactionContext
    ) => AsyncGenerator<OperationStatus | BatchTransactionData> | Observable<OperationStatus | BatchTransactionData>,
    centrifugeId: CentrifugeId,
    { switchChain = true, gate }: { switchChain?: boolean; gate?: MigrationGate } = {}
  ): Transaction {
    const self = this
    async function* transact(signal: AbortSignal) {
      if (gate) await self._migrationGate(gate.poolId, gate.action, gate.targets)
      const buildOnly = self.#buildOnly.get($tx)
      // Build-only mode: produce unsigned calldata via wrapTransaction's batching
      // branch. No signer, wallet client, address resolution, chain switching, or
      // broadcast — only the I/O the construction itself needs (addresses, IPFS,
      // public reads). `signingAddress` comes from `fromAddress` (defaults to the
      // zero address); build callbacks must not assume a real signer.
      if (buildOnly) {
        const [chain, publicClient] = await Promise.all([
          self.getChainConfig(centrifugeId),
          self.getClient(centrifugeId),
        ])
        // `walletClient`/`signer` are never available in build mode (no signer is
        // set). Rather than hand out `undefined` casts that surface as opaque
        // TypeErrors, expose throwing getters so any accidental dereference fails
        // with a descriptive message that points at the cause.
        const throwInBuildMode = (field: 'walletClient' | 'signer'): never => {
          throw new Error(
            `Cannot access \`${field}\` in build-only mode: buildOnly() runs without a signer. ` +
              `This method needs to sign and cannot be built. Use a method that routes through wrapTransaction.`
          )
        }
        const transaction = transactionCallback({
          isBatching: true,
          isBuilding: true,
          signal,
          signingAddress: buildOnly.fromAddress,
          chain,
          centrifugeId,
          publicClient,
          get walletClient(): WalletClient<any, Chain, Account> {
            return throwInBuildMode('walletClient')
          },
          get signer(): Signer {
            return throwInBuildMode('signer')
          },
          root: self,
        })
        if (Symbol.asyncIterator in transaction) {
          yield* transaction
        } else if (isObservable(transaction)) {
          yield transaction
        } else {
          throw new Error('Invalid arguments')
        }
        return
      }

      let isBatching = false
      if (self.#isBatching.has($tx)) {
        isBatching = true
      }
      const { signer } = self
      if (!signer) throw new WalletRequiredError()

      const [chainId, publicClient, chain] = await Promise.all([
        self._idToChain(centrifugeId),
        self.getClient(centrifugeId),
        self.getChainConfig(centrifugeId),
      ])
      let walletClient: WalletClient<any, Chain, Account> = isLocalAccount(signer)
        ? createWalletClient({
            account: signer,
            chain,
            transport: http(),
          })
        : createWalletClient({ transport: custom(signer) })

      const [address] = await walletClient.getAddresses()
      if (!address) throw new Error('No account selected')

      if (!isBatching && switchChain) {
        const selectedChain = await walletClient.getChainId()
        if (selectedChain !== chainId) {
          yield { type: 'SwitchingChain', chainId } as const
          await walletClient.switchChain({ id: chainId })
        }
      }

      // Re-create the wallet client with the correct chain and account
      // Saves having to pass `account` and `chain` to every `writeContract` call
      walletClient = isLocalAccount(signer)
        ? walletClient
        : createWalletClient({ account: address, chain, transport: custom(signer) })

      const transaction = transactionCallback({
        isBatching,
        signal,
        signingAddress: address as HexString,
        chain,
        centrifugeId,
        publicClient,
        walletClient,
        signer,
        root: self,
      })
      if (Symbol.asyncIterator in transaction) {
        yield* transaction
      } else if (isObservable(transaction)) {
        yield transaction
      } else {
        throw new Error('Invalid arguments')
      }
    }
    const $tx = defer(() => {
      const controller = new AbortController()
      return from(transact(controller.signal)).pipe(finalize(() => controller.abort()))
    }).pipe(mergeMap((d) => (isObservable(d) ? d : of(d)))) as Transaction
    makeThenable($tx, true)
    Object.assign($tx, {
      centrifugeId,
    })
    return $tx
  }

  /**
   * The write seam's routing point: run a mutating operation through whichever
   * strategy the injected seam and the per-action routing table select.
   *
   * - No injected `txStrategy` (the default): always `options.local()` — the
   *   entity's own `_transact`-built transaction, behind the migration gate
   *   ({@link _gateLocal}). The table is not consulted, so a row in it cannot
   *   change what a default-configured caller does.
   * - Injected `txStrategy`: `'backend'` actions are prepared by it
   *   (`BackendPrepareStrategy` in practice) and wired into the same
   *   `Transaction` observable; every other action falls back to
   *   `options.local()`, so an unmigrated action behaves exactly as it does
   *   without the seam.
   *
   * The table ships inside the SDK (see `data/routing.ts`). `options.routes`
   * exists so the mechanism is testable independently of the shipped rows.
   * @internal
   */
  _routeTransaction(
    action: PoolAction,
    options: {
      title: string
      centrifugeId: CentrifugeId
      /** The locally built transaction to fall back to. Only called when used. */
      local: () => Transaction
      routes?: ActionRouteTable
      signingAddress?: HexString
      /** The spokes the migration gate judges; empty, the pool's hub. */
      gate: readonly MigrationGateTarget[]
    }
  ): Transaction {
    if (!this.#txStrategyInjected) return this._gateLocal(action.action, action.poolId, options)
    if (resolveActionRoute(action.action, options.routes) !== 'backend') {
      return this._gateLocal(action.action, action.poolId, options)
    }
    return backendTransaction(this, this.#txStrategy, action, {
      title: options.title,
      centrifugeId: options.centrifugeId,
      ...(options.signingAddress ? { signingAddress: options.signingAddress } : {}),
    })
  }

  /**
   * {@link _routeTransaction} for an action whose payload is not known
   * synchronously.
   *
   * Same routing decision, same fallback, same emission contract — the only
   * difference is WHEN the payload is computed. Two kinds of write need this:
   *
   * - `shareClass.createHolding()` resolves its ledger account ids from the
   *   pool's IPFS metadata, and the backend's `createHolding` action requires
   *   them as data (its builder is pure and its calldata is re-derived at
   *   preview, at prepare and again during Fordefi verification, so it cannot
   *   allocate them itself).
   * - `balanceSheet.issue()` / `revoke()` refuse a zero share count, and
   *   `pool.updateBalanceSheetManagers()` and
   *   `poolNetwork.registerOnOffRampManagerAsBSManager()` refuse a missing
   *   `refundAddress`.
   *   Building the payload eagerly would move those throws from
   *   subscribe time to call time, which is a behaviour change on a path these
   *   tasks are only supposed to re-route.
   *
   * `buildPayload` runs only on the backend route and only once the caller
   * subscribes. The local path runs the migration gate first ({@link _gateLocal}),
   * so it reads the pool's migration before it builds.
   *
   * `actionName` may be `{ resolve, candidates }` for callers whose action depends on the network's
   * registry (the on/off-ramp registration methods): `resolve` runs at subscribe time and
   * `buildPayload` receives the resolved name. When no candidate routes to the backend the local
   * transaction runs behind the migration gate, which copies the build-only and batching flags onto it.
   * @internal
   */
  _routeDeferredTransaction(
    actionName: PoolActionName | { resolve: () => Promise<PoolActionName>; candidates: readonly PoolActionName[] },
    poolId: string,
    buildPayload: (action: PoolActionName) => Promise<unknown>,
    options: {
      title: string
      centrifugeId: CentrifugeId
      /** The locally built transaction to fall back to. Only called when used. */
      local: () => Transaction
      routes?: ActionRouteTable
      signingAddress?: HexString
      /** The spokes the migration gate judges; empty, the pool's hub. */
      gate: readonly MigrationGateTarget[]
    }
  ): Transaction {
    if (!this.#txStrategyInjected) return this._gateLocal(actionName, poolId, options)
    const routesToBackend = (action: PoolActionName) => resolveActionRoute(action, options.routes) === 'backend'
    const candidates = typeof actionName === 'string' ? [actionName] : actionName.candidates
    if (!candidates.some(routesToBackend)) return this._gateLocal(actionName, poolId, options)

    const backend = (action: PoolActionName) =>
      // The payload resolves first, and only then is the transaction built.
      // Written as two stages rather than one `async` factory on purpose: a
      // `Transaction` is thenable (`makeThenable`), so returning one from an
      // async function would AWAIT it and hand `defer` a single already-consumed
      // status instead of the observable.
      defer(() => buildPayload(action)).pipe(
        mergeMap(
          (payload) =>
            backendTransaction(
              this,
              this.#txStrategy,
              { action, poolId, payload },
              {
                title: options.title,
                centrifugeId: options.centrifugeId,
                ...(options.signingAddress ? { signingAddress: options.signingAddress } : {}),
              }
            ) as Observable<OperationStatus>
        )
      )
    const $tx = (
      typeof actionName === 'string'
        ? backend(actionName)
        : defer(() => actionName.resolve()).pipe(
            mergeMap((action) =>
              routesToBackend(action)
                ? backend(action)
                : (this.#inherit($tx, this._gateLocal(action, poolId, options)) as Observable<OperationStatus>)
            )
          )
    ) as Transaction
    makeThenable($tx, true)
    Object.assign($tx, { centrifugeId: options.centrifugeId })
    return $tx
  }

  /**
   * The local build behind the migration gate: an action the gate table does
   * not map is returned as the entity built it; a mapped one runs
   * {@link _migrationGate} when subscribed and builds only then, so a refused
   * write never resolves addresses, signs or pays for a message. Candidate
   * actions that share a gate row are judged by that row without resolving.
   * `centrifugeId` reads the built transaction's chain, since a v3.3 write may
   * re-chain to the hub.
   * @internal
   */
  _gateLocal(
    actionName: PoolActionName | { resolve: () => Promise<PoolActionName>; candidates: readonly PoolActionName[] },
    poolId: string,
    options: { centrifugeId: CentrifugeId; local: () => Transaction; gate: readonly MigrationGateTarget[] }
  ): Transaction {
    const candidates = typeof actionName === 'string' ? [actionName] : actionName.candidates
    const rows = new Set(candidates.map(migrationActionOf))
    const shared = rows.size === 1 ? [...rows][0] : null
    const name$ =
      typeof actionName === 'string'
        ? of(actionName)
        : shared !== null
          ? of(shared as PoolActionName)
          : defer(() => actionName.resolve())
    const $tx = name$.pipe(
      mergeMap((name) => this._migrationGate(poolId, name, options.gate)),
      mergeMap(() => {
        const inner = this.#inherit($tx, options.local())
        Object.defineProperty($tx, 'centrifugeId', {
          get: () => inner.centrifugeId,
          enumerable: true,
          configurable: true,
        })
        return inner as Observable<OperationStatus>
      })
    ) as Transaction
    makeThenable($tx, true)
    Object.assign($tx, { centrifugeId: options.centrifugeId })
    return $tx
  }

  #inherit(outer: Transaction, inner: Transaction): Transaction {
    const buildOnly = this.#buildOnly.get(outer)
    if (buildOnly) this.#buildOnly.set(inner, buildOnly)
    if (this.#isBatching.has(outer)) this.#isBatching.add(inner)
    return inner
  }

  /**
   * Refuse a write the pool's migration phase does not allow on the spoke it
   * targets, with {@link PoolMigratingError}. The hub facade's `hubPhase` is read
   * first, and a pool whose hub chain lists no facade or whose phase is `none`
   * passes without reading the indexer; an armed pool's full migration is read
   * afresh for every write. Each target resolves to its spoke with `spokeOfAction` and is judged once. The
   * hub chain without a row of its own is judged from the hub phase (P1, P4,
   * P6); any other network without a row is not part of the migration and
   * passes. A spoke whose step history disagrees with the facade refuses. A read
   * that fails (the hub phase, a spoke facade, the migration rows) refuses with
   * no phase, on mainnet as on testnet: the write waits until the state can be
   * known. A name the gate table does not map passes without a read.
   * @internal
   */
  async _migrationGate(poolId: string, actionName: PoolActionName, targets: readonly MigrationGateTarget[]) {
    const answer = await this._migrationGateAnswer(poolId, actionName, targets)
    if (answer.allowed) return
    const { allowed: _allowed, code: _code, ...gate } = answer
    const where = gate.phase
      ? `in phase ${gate.phase}: ${gate.reason}. Allowed there now: ${gate.allowedActions?.join(', ') || 'nothing'}.`
      : `in a phase that could not be derived: ${gate.reason}.`
    throw new PoolMigratingError(
      `Pool ${poolId} is migrating: "${actionName}" is not allowed on centrifugeId ${gate.centrifugeId} ${where}`,
      poolId,
      gate
    )
  }

  /**
   * What {@link _migrationGate} would decide, as an answer instead of a throw;
   * `pool.isAllowed` reads it. Same reads.
   * @internal
   */
  async _migrationGateAnswer(
    poolId: string,
    actionName: PoolActionName,
    targets: readonly MigrationGateTarget[]
  ): Promise<MigrationGateAnswer> {
    if (this.#migrationRowsUnsupported()) return { allowed: true }
    const action = migrationActionOf(actionName)
    const judged = judgedSpokesOf(poolId, targets)
    const keyedOn = judged[0]!.spokeId
    const hub = await this.#hubFacadePhase(poolId)
    if (hub.phase === null) return { allowed: true }
    if (hub.error !== null) return unreadableStateRefusal(actionName, keyedOn, hub.error)
    if (hub.phase === 'none') return { allowed: true }
    if (hub.phase === 'activated') {
      const restored = await this.#allSpokesRestored(poolId, hub.client, hub.facade)
      if (restored.error !== null) return unreadableStateRefusal(actionName, keyedOn, restored.error)
      if (restored.all) return { allowed: true }
    }
    if (action === null) return unmappedActionRefusal(actionName, keyedOn)
    const read = await this.#migrationOf(poolId)
    if (read.unsupported) return { allowed: true }
    if (read.migration === null) return unreadableStateRefusal(actionName, keyedOn, read.error)
    const answer = judgeMigrationGate(read.migration, poolId, action, actionName, targets)
    if (!answer.allowed || !CLOSED_BY_FIRST_OFFBOARD.includes(action)) return answer
    for (const { spokeId, destinationId } of judged) {
      for (const id of destinationId === undefined ? [spokeId] : [spokeId, destinationId]) {
        if (spokeGateStateOf(read.migration, id) !== SPOKE_GATE_STATE.freezeSent) continue
        const relayed = await unindexedRelaysOf(
          this,
          new PoolId(poolId),
          read.migration,
          id,
          hub.client,
          GATE_SWEEP_ADVICE
        )
        if (relayed) return unreadableStateRefusal(actionName, id, relayed)
      }
    }
    return answer
  }

  /** An api-v3 target never projected the migration, so its pools are not gated at all. */
  #migrationRowsUnsupported(): boolean {
    const source = this.#dataSource as { target?: unknown; graphqlTarget?: unknown }
    return (source.target ?? source.graphqlTarget ?? this.#config.graphqlTarget) === 'api-v3'
  }

  /**
   * The hub phase the migration facade on the pool's hub chain reports: null
   * when no facade is deployed there, so the pool cannot be migrating.
   */
  async #hubFacadePhase(poolId: string): Promise<
    | { phase: null; error: null }
    | {
        phase: HubPhaseName
        error: null
        client: PublicClient
        facade: NonNullable<ReturnType<typeof migrationFacadeOf>>
      }
    | { phase: undefined; error: string }
  > {
    const id = new PoolId(poolId)
    try {
      const facade = migrationFacadeOf(id.centrifugeId, this.#config.environment)
      if (!facade) return { phase: null, error: null }
      const client = (await firstValueFrom(this.getClient(id.centrifugeId))) as PublicClient
      const phase = await client.readContract({
        address: facade.address,
        abi: facade.abi,
        functionName: 'hubPhase',
        args: [id.raw],
      } as any)
      return { phase: hubPhaseName(Number(phase)), error: null, client, facade }
    } catch (error) {
      return {
        phase: undefined,
        error: `the migration facade on the hub chain could not be read: ${describeGateError(error)}`,
      }
    }
  }

  /** Whether every armed spoke's max reserves are restored, read off the facades alone. */
  async #allSpokesRestored(
    poolId: string,
    hubClient: PublicClient,
    facade: NonNullable<ReturnType<typeof migrationFacadeOf>>
  ): Promise<{ all: boolean; error: null } | { all: false; error: string }> {
    const id = new PoolId(poolId)
    try {
      const armed = (await hubClient.readContract({
        address: facade.address,
        abi: facade.abi,
        functionName: 'armedSpokes',
        args: [id.raw],
      } as any)) as readonly number[]
      const restored = await Promise.all(
        armed.map(async (centrifugeId) => {
          const spoke = migrationFacadeOf(centrifugeId, this.#config.environment)
          if (!spoke) throw new Error(`no migration facade is deployed on centrifugeId ${centrifugeId}`)
          const client = (await firstValueFrom(this.getClient(centrifugeId))) as PublicClient
          return Boolean(
            await client.readContract({
              address: spoke.address,
              abi: spoke.abi,
              functionName: 'maxReservesRestored',
              args: [id.raw],
            } as any)
          )
        })
      )
      return { all: restored.every(Boolean), error: null }
    } catch (error) {
      return { all: false, error: `the restore flags could not be read: ${describeGateError(error)}` }
    }
  }

  /**
   * The pool's migration as the gate judges it, read afresh: a source that
   * cannot serve the migration rows (api-v3) answers `unsupported`, any other
   * failure the read that failed.
   */
  async #migrationOf(
    poolId: string
  ): Promise<
    | { migration: PoolMigration; unsupported: false; error: null }
    | { migration: null; unsupported: true; error: null }
    | { migration: null; unsupported: false; error: string }
  > {
    try {
      const migration = await firstValueFrom(new Pool(this, poolId).migration())
      if (migration === null) {
        return {
          migration: null,
          unsupported: false,
          error: 'the indexer holds no migration row for a pool the facade reports as migrating',
        }
      }
      return { migration, unsupported: false, error: null }
    } catch (error) {
      if (error instanceof UnsupportedQueryError || error instanceof ApiV3UnsupportedError) {
        return { migration: null, unsupported: true, error: null }
      }
      return {
        migration: null,
        unsupported: false,
        error: `the migration could not be read from the indexer: ${describeGateError(error)}`,
      }
    }
  }

  /**
   * A transaction whose chain and shape depend on the protocol context, read
   * when the transaction starts: v3.3 moved some spoke-signed writes to the
   * hub (direct issue and revoke), so which chain signs is only known once the
   * pool's version is.
   *
   * The build-only and batching flags set on the returned transaction are
   * carried to the one `build` returns. `centrifugeId` reads `centrifugeId`
   * until the context resolves and the chosen transaction's chain after, so
   * `buildOnly` reports the chain that actually signs; batching, which reads
   * it before anything runs, sees `centrifugeId`.
   *
   * @internal
   */
  _transactForContext(
    context: () => Observable<SdkProtocolContext>,
    build: (ctx: SdkProtocolContext) => Transaction,
    centrifugeId: CentrifugeId
  ): Transaction {
    const $tx = defer(() => context().pipe(first())).pipe(
      mergeMap((ctx) => {
        const inner = this.#inherit($tx, build(ctx))
        Object.assign($tx, { centrifugeId: inner.centrifugeId })
        return inner as Observable<OperationStatus>
      })
    ) as Transaction
    makeThenable($tx, true)
    Object.assign($tx, { centrifugeId })
    return $tx
  }

  /** @internal Whether a write of this action goes to the backend in the current mode. */
  _routesToBackend(actionName: PoolActionName, routes?: ActionRouteTable): boolean {
    return this.#txStrategyInjected && resolveActionRoute(actionName, routes) === 'backend'
  }

  /**
   * The calls among `calls` that their pool's hub policy does not let through yet for `signer`, read from the chain
   * now (see {@link classifyHubCalls}). Empty when every call may be sent. `wrapTransaction` and `sendCallsInOrder`
   * run it before they sign, for every call that names a pool.
   * @internal
   */
  _classifyHubCalls(signer: HexString, calls: readonly PolicyCall[]): Promise<OutOfPolicyCall[]> {
    return classifyHubCalls(this, signer, calls)
  }

  /**
   * Batch multiple transactions together into a single transaction.
   * It's not exposed, because it is somewhat limited and requires knowledge of internals.
   * It only works when there's only a single transaction being done in the method.
   * It only works for methods that wrap the transaction in `wrapTransaction`.
   * It only works when the transactions are executed on the same contract on the same chain,
   * and that contract supports multicall
   * @internal
   */
  _experimental_batch(title: string, transactions: Transaction[]): Transaction {
    const centIds = [...new Set(transactions.map((tx) => tx.centrifugeId))]
    if (centIds.length !== 1) {
      throw new Error(`Cannot batch transactions on different networks. Found Centrifuge IDs: ${centIds.join(', ')}`)
    }
    for (const tx of transactions) {
      this.#isBatching.add(tx)
    }

    return this._transact((ctx) => {
      if (transactions.length === 0) throw new Error('No transactions to batch')

      return combineLatest(transactions.map((tx) => tx.pipe(first()))).pipe(
        switchMap(async function* (batches_) {
          const batches = batches_ as any as BatchTransactionData[]
          if (!batches.every((b) => b.data && b.contract)) {
            throw new Error('Not all transactions can be batched')
          }
          yield* wrapTransaction(title, ctx, mergeBatchTransactionData(batches))
        })
      )
    }, centIds[0]!)
  }

  /**
   * Batch multiple transactions together into a single multicall transaction.
   * All transactions must be on the same Centrifuge network and same contract.
   *
   * Each inner call that names a pool is judged by that pool's hub policy before the one send. When a call is not
   * ready the batch ends in an `OutOfPolicy` status and nothing is signed or sent; an awaited batch resolves with that
   * status and has no hash (`docs/sdk/hub-policies.md`).
   */
  batchTransactions(title: string, transactions: Transaction[]): Transaction {
    return this._experimental_batch(title, transactions)
  }

  /**
   * Build the unsigned calldata a transaction would send, without a signer and
   * without broadcasting. Runs the full construction logic (encoding, merkle,
   * weiroll, IPFS pinning, address resolution) but performs no signing step —
   * no `setSigner` is required and no nonce is consumed.
   *
   * Returns a plain `Promise<BuiltTransaction>` (not an Observable): there is no
   * transaction lifecycle to subscribe to, only the resulting bytes.
   *
   * Building does real I/O (protocol addresses, IPFS pinning), so it is async.
   * Only signer-dependent steps are skipped. Methods whose construction reads
   * the sender address (e.g. permit flows) read `options.fromAddress`; when it
   * is omitted the zero address is used.
   *
   * Works only for methods that route through `wrapTransaction` (the same
   * constraint as `batchTransactions`); methods that call `doTransaction`
   * directly cannot be built without a signer.
   *
   * @example
   * ```ts
   * const centrifuge = new Centrifuge({ environment, rpcUrls })
   * const pool = await centrifuge.pool(poolId)
   * const built = await centrifuge.buildOnly(pool.updateMetadata(metadata))
   * // hand built.data to a custodial signer (Fordefi, Safe, MPC) outside the SDK
   * ```
   */
  async buildOnly(tx: Transaction, options?: BuildOnlyOptions): Promise<BuiltTransaction> {
    const fromAddress = options?.fromAddress ?? zeroAddress
    if (!isAddress(fromAddress)) {
      throw new Error(`buildOnly: invalid fromAddress "${fromAddress}"`)
    }
    // Checksum so the build-time signingAddress matches what a real wallet would
    // produce (relevant for any method that embeds the address in calldata).
    this.#buildOnly.set(tx, { fromAddress: getAddress(fromAddress) })

    // The flag is consumed on first use and always removed afterwards. `$tx` is
    // `defer(transact)`, so every subscription re-runs the generator and re-reads
    // this WeakMap; leaving the flag set would make a later subscription (e.g.
    // `await tx` to actually sign) silently re-enter build mode and yield
    // `BatchTransactionData` where `OperationStatus` is expected. `finally`
    // guarantees cleanup even when the build callback throws.
    let built: BatchTransactionData
    try {
      built = (await firstValueFrom(tx)) as unknown as BatchTransactionData
    } finally {
      this.#buildOnly.delete(tx)
    }
    if (!built || !built.contract || !built.data) {
      throw new Error('buildOnly: transaction did not produce build-only calldata (does it use wrapTransaction?)')
    }

    const chainId = await this._idToChain(tx.centrifugeId)
    const value = built.value ?? 0n
    const calls: BuiltCall[] = built.data.map((data) => ({
      to: built.contract,
      data,
      // The protocol's multicall is non-payable per inner call; the whole-tx
      // `value` rides on the outer call, so per-call value is 0.
      value: 0n,
    }))

    return {
      centrifugeId: tx.centrifugeId,
      chainId,
      to: built.contract,
      data: encodeBatchCalldata(built.data, { alwaysBatch: built.alwaysBatch }),
      value,
      calls,
      ...(built.messages ? { messages: built.messages } : {}),
      ...(built.pendingPoolAdapters ? { pendingPoolAdapters: built.pendingPoolAdapters } : {}),
    }
  }

  #activeAddressBook?: Promise<ActiveAddressBook>
  /**
   * The address book this client resolves against: the bundled one, or the
   * `addressBook` option's after its `bookId` check. Resolved once per client;
   * a refused book rejects every later call too.
   * @internal
   */
  _addressBook(): Promise<ActiveAddressBook> {
    const { addressBook, environment } = this.#config
    this.#activeAddressBook ??= addressBook
      ? loadProvidedAddressBook(environment, addressBook.book)
      : Promise.resolve().then(bundledAddressBook)
    return this.#activeAddressBook
  }

  /**
   * The `bookId` of the address book this client resolves against: the bundled
   * book's, or the `addressBook` option's once it passed its check. Rejects
   * when the provided book is refused.
   * @public
   */
  addressBookId() {
    return this._query(['addressBookId'], () => defer(async () => (await this._addressBook()).addressBookId))
  }

  /**
   * The registry head each network of the active address book is pinned to, as
   * the book carries it (a manual registry URL or `file:` path is shown as
   * given). Rejects when the provided book is refused.
   * @public
   */
  registryHeads() {
    return this._query(['registryHeads'], () => defer(async () => (await this._addressBook()).registryHeads))
  }

  #reader?: Reader
  /**
   * The protocol `Reader` over the active address book's registry and this
   * instance's viem clients: `LocalBuild` flows resolve a pool's protocol
   * version through it before building.
   * @internal
   */
  get _reader(): Reader {
    this.#reader ??= this.#readerOverActiveBook()
    return this.#reader
  }

  #readerOverActiveBook(): Reader {
    let over: Promise<Reader> | undefined
    const reader = () =>
      (over ??= this._addressBook().then(({ registry }) =>
        createReader({
          environment: this.#config.environment,
          registry,
          getClient: (chainId) => {
            const client = this.#clients.get(chainId)
            if (!client) throw new Error(`No client found for chain ID "${chainId}"`)
            return client
          },
          poolVersionSource: async (poolId) =>
            projectedVersionOf(await firstValueFrom(this._poolRows()), new PoolId(poolId)),
        })
      ))
    return {
      poolProtocolVersion: async (poolId) => (await reader()).poolProtocolVersion(poolId),
      chainProtocolVersion: async (centrifugeId) => (await reader()).chainProtocolVersion(centrifugeId),
      isPoolManager: async (poolId, who, protocolVersion) =>
        (await reader()).isPoolManager(poolId, who, protocolVersion),
    }
  }

  /**
   * Resolve the protocol context for a target: the protocol version (through
   * the `Reader`, never hard-wired), the chain's verified address set from the
   * active address book (the bundled one unless the `addressBook` option is
   * set), and the version's ABI set.
   *
   * Targets:
   * - `PoolId` — pool-scoped resolution on the pool's home chain; the emission
   *   carries a `context` for pure `@centrifuge/protocol` builders.
   * - `CentrifugeId` — chain-scoped resolution (spoke-side flows, pool-less
   *   flows); the version is the newest one deployed on the chain.
   * - `{ centrifugeId, protocolVersion? }` — explicit pair for flows that
   *   already know the version (v3.3 migration windows).
   *
   * The emission spreads the typed contract addresses at the top level (the
   * former address-map shape) plus the context fields.
   *
   * @public
   */
  protocolContext(target: ProtocolContextTarget) {
    const normalized = normalizeProtocolContextTarget(target)
    const poolKey = normalized.poolId?.toString() ?? null
    return this._query(['protocolContext', normalized.centrifugeId, poolKey, normalized.protocolVersion ?? null], () =>
      this._protocolVersionFor(normalized).pipe(
        switchMap((protocolVersion) => this._resolveProtocolContext(normalized, protocolVersion))
      )
    )
  }

  /**
   * The version stream a context is resolved against: explicit when given, the pool's projected
   * version (re-emitting when the pools entry changes, so a migrated pool gets a new context, and
   * when the entry first lists a pool it did not know) or the newest version deployed on the chain.
   * The pool's version is the hub's: a spoke of a v3.3 pool resolves v3.2 until its migration
   * phase reads `onboarded`, and re-emits when it does.
   * @internal
   */
  _protocolVersionFor(target: { centrifugeId: CentrifugeId; poolId?: PoolId; protocolVersion?: ProtocolVersion }) {
    if (target.protocolVersion) return of(target.protocolVersion)
    if (target.poolId) {
      const poolId = target.poolId
      return this._poolRows().pipe(
        map((rows) => projectedVersionOf(rows, poolId)),
        distinctUntilChanged(),
        switchMap(() => defer(() => this._reader.poolProtocolVersion(poolId.raw.toString()))),
        switchMap((poolVersion) => this.#spokeVersionOf(poolId, target.centrifugeId, poolVersion)),
        distinctUntilChanged(),
        switchMap((protocolVersion) =>
          defer(() => this.#assertDeployedOn(poolId, protocolVersion, target.centrifugeId))
        )
      )
    }
    return defer(() => this._reader.chainProtocolVersion(target.centrifugeId))
  }

  /**
   * A pool's context on one network at the hub's version, for what the hub sends there or reads about it (its
   * adapter sets), whatever that network's own migration phase: between `Activated` and `Onboarded` the hub
   * already writes v3.3 adapters toward a spoke whose own context reads v3.2. Throws
   * `ProtocolVersionResolutionError` when the hub's version is not deployed on the network.
   * @internal
   */
  _poolContextAtHubVersion(poolId: PoolId, centrifugeId: CentrifugeId) {
    if (centrifugeId === poolId.centrifugeId) return this.protocolContext(poolId)
    return this._query(['poolContextAtHubVersion', poolId.toString(), centrifugeId], () =>
      this.protocolContext(poolId).pipe(
        map((hub) => hub.protocolVersion),
        distinctUntilChanged(),
        switchMap((protocolVersion) => defer(() => this.#assertDeployedOn(poolId, protocolVersion, centrifugeId))),
        switchMap((protocolVersion) => this._resolveProtocolContext({ centrifugeId, poolId }, protocolVersion))
      )
    )
  }

  /**
   * The hub flips the whole pool to v3.3 on `Activated`, which only needs every finalize sent, so
   * a spoke can still be on the v3.2 stack then. Only a v3.3 pool on a non-hub chain reads its
   * migration, and only until the spoke resolves the pool's version, which it then keeps. A failed
   * first read errors rather than hand out v3.3 addresses for a v3.2 spoke; a failed later poll
   * keeps the last answer and retries after one poll interval.
   */
  #spokeVersionOf(poolId: PoolId, centrifugeId: CentrifugeId, poolVersion: ProtocolVersion) {
    if (centrifugeId === poolId.centrifugeId || poolVersion !== PROTOCOL_VERSION_V3_3) return of(poolVersion)
    const subject = `pool ${poolId} on centrifugeId ${centrifugeId}`
    const unsupported = (error: unknown) =>
      error instanceof UnsupportedQueryError || error instanceof ApiV3UnsupportedError
    const pollInterval = this.config.indexerPollingInterval ?? 120_000
    return defer(() => {
      let answered = false
      return this._queryData<PoolMigrationRow | null>('poolMigration', { poolId: poolId.toString() }).pipe(
        tap(() => {
          answered = true
        }),
        retry({
          delay: (error: unknown) => (answered && !unsupported(error) ? timer(pollInterval) : throwError(() => error)),
        }),
        catchError((error: unknown) => {
          if (unsupported(error)) return of(null)
          const detail = error instanceof Error ? error.message : JSON.stringify(error)
          return throwError(
            () =>
              new ProtocolVersionResolutionError(
                subject,
                `the pool reads ${poolVersion} but its migration could not be read, so whether this spoke has onboarded is unknown. ${detail}`
              )
          )
        }),
        map((row) => {
          if (row === null || row.targetVersion !== poolVersion) return poolVersion
          const spoke = row.spokes.find((s) => Number(s.centrifugeId) === centrifugeId)
          if (!spoke) return poolVersion
          let phase: SpokePhaseName
          try {
            phase = spokePhaseOfRow(spoke.phase)
          } catch {
            throw new ProtocolVersionResolutionError(
              subject,
              `its migration row reads an unknown spoke phase "${spoke.phase}"`
            )
          }
          return SPOKE_PHASE[phase] >= SPOKE_PHASE.onboarded ? poolVersion : PROTOCOL_VERSION_V3_2
        }),
        // A spoke that reaches the pool's version never goes back, so the migration is not read again.
        takeWhile((version) => version !== poolVersion, true)
      )
    })
  }

  async #assertDeployedOn(poolId: PoolId, protocolVersion: ProtocolVersion, centrifugeId: CentrifugeId) {
    if (centrifugeId === poolId.centrifugeId) return protocolVersion
    const { registry } = await this._addressBook()
    const deployed = registry.versionsForChain(this.#config.environment, centrifugeId)
    if (!deployed.includes(protocolVersion)) {
      throw new ProtocolVersionResolutionError(
        `pool ${poolId}`,
        `its protocol version "${protocolVersion}" is not deployed for centrifugeId ${centrifugeId} on ` +
          `${this.#config.environment} (registered: ${deployed.join(', ') || 'none'})`
      )
    }
    return protocolVersion
  }

  /**
   * The protocol-owned accounts on a chain across every version deployed there (balance sheet,
   * async and sync request managers), lowercased and deduped.
   * @internal
   */
  _systemAddresses(centrifugeId: CentrifugeId) {
    return this._query(['systemAddresses', centrifugeId], () =>
      defer(async () => (await this._addressBook()).registry).pipe(
        switchMap((registry) => {
          const versions = registry.versionsForChain(this.#config.environment, centrifugeId)
          if (versions.length === 0) {
            return throwError(
              () =>
                new ProtocolVersionResolutionError(
                  `centrifugeId ${centrifugeId}`,
                  `no protocol version is deployed on ${this.#config.environment}`
                )
            )
          }
          return combineLatest(
            versions.map((protocolVersion) => this.protocolContext({ centrifugeId, protocolVersion }))
          ).pipe(
            map((contexts) => [
              ...new Set(
                contexts.flatMap((ctx) =>
                  [ctx.balanceSheet ?? ctx.spoke, ctx.asyncRequestManager, ctx.syncManager].map((address) =>
                    address.toLowerCase()
                  )
                )
              ),
            ])
          )
        })
      )
    )
  }

  /** @internal */
  _resolveProtocolContext(
    normalized: { centrifugeId: CentrifugeId; poolId?: PoolId },
    protocolVersion: ProtocolVersion
  ) {
    return defer(async (): Promise<SdkProtocolContext> => {
      const { registry } = await this._addressBook()
      const deployment = registry.getDeployment(this.#config.environment, protocolVersion, normalized.centrifugeId)

      const context = normalized.poolId
        ? resolveProtocolContext(normalized.poolId.raw.toString(), protocolVersion, {
            environment: this.#config.environment,
            centrifugeId: normalized.centrifugeId,
            registry,
          })
        : undefined

      return {
        ...(deployment.contracts as unknown as ProtocolContracts),
        centrifugeId: normalized.centrifugeId,
        chainId: deployment.chainId,
        protocolVersion,
        abis: getAbiSet(protocolVersion),
        contractAbis: getContractAbis(protocolVersion),
        context,
      }
    })
  }

  /**
   * Estimates the gas cost needed to bridge the message from one chain to another,
   * that results from a transaction. A message whose target is the source chain
   * costs nothing and resolves to `0n` without a contract read.
   * @internal
   */
  _estimate(
    fromCentrifugeId: CentrifugeId,
    toCentrifugeId: CentrifugeId,
    messageType: MessageTypeWithSubType | MessageTypeWithSubType[],
    /** Adapters to price the pool's batch against when the same transaction installs the pool's set. */
    pendingPoolAdapters?: readonly HexString[]
  ) {
    return this._query(['estimate', fromCentrifugeId, toCentrifugeId, messageType, pendingPoolAdapters ?? null], () => {
      // A message targeting the sending chain itself is handled by the
      // `MessageDispatcher` as a direct local call, never through an adapter,
      // so there is nothing to pay for. `MultiAdapter.estimate` would sum over
      // the local chain's (empty) adapter set and return 0, which the
      // crosschain zero-fee refusal below would otherwise reject.
      if (fromCentrifugeId === toCentrifugeId) return of(0n)

      assertCrosschainMessagingEnabled(toCentrifugeId)

      const types = Array.isArray(messageType) ? messageType : [messageType]
      const poolIds = new Map<string, PoolId>()
      for (const type of types) {
        if (typeof type === 'object') poolIds.set(type.poolId.toString(), type.poolId)
      }
      const [poolId] = poolIds.size === 1 ? poolIds.values() : []
      // A v3.3-only message travels on the chain's v3.3 stack even while the pool itself still resolves to v3.2,
      // as the migration contract's relays do, so it is priced there.
      const onlyV3_3 = types.every((type) => typeof type === 'object' && 'protocolVersion' in type)
      const source: ProtocolContextTarget = onlyV3_3
        ? { centrifugeId: fromCentrifugeId, protocolVersion: PROTOCOL_VERSION_V3_3 }
        : poolId
          ? { poolId, centrifugeId: fromCentrifugeId }
          : fromCentrifugeId

      return combineLatest([this.protocolContext(source), this.getClient(fromCentrifugeId)]).pipe(
        switchMap(([{ multiAdapter, gasService, contractAbis, protocolVersion }, publicClient]) => {
          const gasMessagePayloads = types.map((type) => {
            return emptyMessage(type, protocolVersion)
          })

          return estimateBatchBridgeFee({
            publicClient,
            gasService,
            multiAdapter,
            abis: contractAbis,
            gasMessagePayloads,
            toCentrifugeId,
            ...(pendingPoolAdapters
              ? {
                  pendingPoolAdapters: {
                    adapters: pendingPoolAdapters,
                    sessionPrefix: protocolVersion === PROTOCOL_VERSION_V3_3,
                  },
                }
              : {}),
          })
        })
      )
    })
  }

  /**
   * Every chain the active address book's deployment registry knows for the
   * active environment. Version-independent chain directory; the source of
   * truth for id mapping and for `Pool.networks()`.
   * @internal
   */
  _chains() {
    return this._query(['chains'], () =>
      defer(async () => (await this._addressBook()).registry.chains(this.#config.environment))
    )
  }

  /** @internal */
  _idToChain(centrifugeId: number) {
    // The centrifugeId <-> chainId mapping comes from the address book's
    // registry: it is version-independent, security-relevant (it feeds chain
    // switching and the tx envelope), and must not depend on a live indexer
    // response.
    return this._query(['idToChain', centrifugeId], () =>
      defer(async () => {
        const { registry } = await this._addressBook()
        const item = registry.chains(this.#config.environment).find((c) => c.centrifugeId === centrifugeId)
        if (!item) throw new Error(`Chain with Centrifuge ID "${centrifugeId}" not found`)
        return item.chainId
      })
    )
  }

  /** @internal */
  _chainToId(chainId: number) {
    return this._query(['chainToId', chainId], () =>
      defer(async () => {
        const { registry } = await this._addressBook()
        const item = registry.chains(this.#config.environment).find((c) => c.chainId === chainId)
        if (!item) throw new Error(`Blockchain with chain ID "${chainId}" not found`)
        return item.centrifugeId as CentrifugeId
      })
    )
  }

  /**
   * @deprecated Renamed to {@link protocolContext}, which is public and
   * identical. This alias keeps the `@centrifuge/sdk` subtree sync seam intact
   * for callers written against the underscore name; it will be removed once
   * they are migrated.
   */
  _protocolContext(target: ProtocolContextTarget) {
    return this.protocolContext(target)
  }

  /**
   * Deployments as reported by the indexer, for display and inspection.
   *
   * This stream is informational only: every address the SDK
   * itself transacts against comes from the active address book's deployment
   * registry (validated before first use), never from this response, so
   * indexer misconfiguration or compromise cannot redirect a transaction.
   */
  deployments() {
    return this._deployments()
  }

  /** @internal */
  _deployments() {
    return this._query(['deployments'], () => this._queryData('deployments', {}))
  }
}

function describeGateError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

const GATE_SWEEP_ADVICE = 'Retry once the hub RPC answers'
