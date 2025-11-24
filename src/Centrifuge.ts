import {
  combineLatest,
  defer,
  filter,
  first,
  firstValueFrom,
  identity,
  isObservable,
  map,
  mergeMap,
  Observable,
  of,
  shareReplay,
  switchMap,
  timer,
} from 'rxjs'
import { fromFetch } from 'rxjs/fetch'
import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  fallback,
  getContract,
  http,
  keccak256,
  parseAbi,
  toHex,
  type Account,
  type Chain,
  type WalletClient,
  type WatchEventOnLogsParameter,
} from 'viem'
import { ABI } from './abi/index.js'
import { chains } from './config/chains.js'
import { PERMIT_TYPEHASH } from './constants.js'
import { Investor } from './entities/Investor.js'
import { Pool } from './entities/Pool.js'
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
import { PoolMetadata } from './types/poolMetadata.js'
import type { CentrifugeQueryOptions, Query } from './types/query.js'
import {
  emptyMessage,
  MessageType,
  MessageTypeWithSubType,
  type OperationStatus,
  type Signer,
  type Transaction,
  type TransactionContext,
} from './types/transaction.js'
import { Balance } from './utils/BigInt.js'
import { randomUint } from './utils/index.js'
import { createPinning, getUrlFromHash } from './utils/ipfs.js'
import { hashKey } from './utils/query.js'
import { makeThenable, repeatOnEvents, shareReplayWithDelayedReset } from './utils/rx.js'
import {
  BatchTransactionData,
  doTransaction,
  isLocalAccount,
  parseEventLogs,
  wrapTransaction,
} from './utils/transaction.js'
import { AssetId, CentrifugeId, PoolId, ShareClassId } from './utils/types.js'

const PINNING_API_DEMO = 'https://europe-central2-peak-vista-185616.cloudfunctions.net/pinning-api-demo'

const envConfig = {
  mainnet: {
    indexerUrl: 'https://api.centrifuge.io',
    ipfsUrl: 'https://ipfs.centrifuge.io',
    ...createPinning(PINNING_API_DEMO),
  },
  testnet: {
    indexerUrl: 'https://api-v3-hitz.marble.live/graphql',
    ipfsUrl: 'https://ipfs.centrifuge.io',
    ...createPinning(PINNING_API_DEMO),
  },
} satisfies Record<string, EnvConfig>

const defaultConfig = {
  environment: 'mainnet',
  cache: true,
} satisfies UserProvidedConfig

export class Centrifuge {
  #config: DerivedConfig
  get config() {
    return this.#config
  }

  #clients = new Map<number, Client>()
  getClient(centrifugeId: CentrifugeId) {
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

  #isBatching = new WeakSet<Transaction>()

  constructor(config: UserProvidedConfig = {}) {
    const defaultConfigForEnv = envConfig[config?.environment || 'mainnet']
    this.#config = {
      ...defaultConfig,
      ...defaultConfigForEnv,
      ...config,
    }
    Object.freeze(this.#config)
    chains
      .filter((chain) => (this.#config.environment === 'mainnet' ? !chain.testnet : chain.testnet))
      .forEach((chain) => {
        const rpcUrl = this.#config.rpcUrls?.[chain.id] ?? undefined
        if (!rpcUrl) {
          console.warn(`No rpcUrl defined for chain ${chain.id}. Using public RPC endpoint.`)
        }
        this.#clients.set(
          chain.id,
          createPublicClient<any, Chain>({
            chain,
            transport: Array.isArray(rpcUrl)
              ? fallback(
                  rpcUrl.map((url) => http(url)),
                  {
                    rank: {
                      interval: 30_000,
                      sampleCount: 5,
                    },
                  }
                )
              : http(rpcUrl),
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
      const addresses = await self._protocolAddresses(centrifugeId)
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

      const formattedMetadata: PoolMetadata = {
        version: 1,
        pool: {
          name: metadataInput.poolName,
          icon: metadataInput.poolIcon,
          asset: {
            class: metadataInput.assetClass,
            subClass: metadataInput.subAssetClass,
          },
          issuer: {
            name: metadataInput.issuerName,
            repName: metadataInput.issuerRepName,
            description: metadataInput.issuerDescription,
            email: metadataInput.email,
            logo: metadataInput.issuerLogo,
            shortDescription: metadataInput.issuerShortDescription,
            categories: metadataInput.issuerCategories,
          },
          poolStructure: metadataInput.poolStructure,
          investorType: metadataInput.investorType,
          links: {
            executiveSummary: metadataInput.executiveSummary,
            forum: metadataInput.forum,
            website: metadataInput.website,
          },
          details: metadataInput.details,
          status: 'open',
          listed: metadataInput.listed ?? true,
          poolRatings: metadataInput.poolRatings.length > 0 ? metadataInput.poolRatings : [],
          reports: metadataInput.report
            ? [
                {
                  author: {
                    name: metadataInput.report.author.name,
                    title: metadataInput.report.author.title,
                    avatar: metadataInput.report.author.avatar,
                  },
                  uri: metadataInput.report.uri,
                },
              ]
            : [],
        },
        shareClasses: shareClassesById,
        onboarding: {
          shareClasses: metadataInput.onboarding?.shareClasses || {},
          taxInfoRequired: metadataInput.onboarding?.taxInfoRequired,
          externalOnboardingUrl: metadataInput.onboarding?.externalOnboardingUrl,
        },
      }

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
            sc.salt?.startsWith('0x') ? (sc.salt as HexString) : toHex(sc.salt ?? randomUint(256), { size: 32 }),
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
          args: [poolId.raw, account, accountIsDebitNormal.get(account)!],
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
   * Get the existing pools on the different chains.
   */
  pools() {
    return this._queryIndexer(
      `{
        pools {
          items {
            id
            blockchain {
              id
            }
          }
        }
      }`,
      {},
      (data: { pools: { items: { id: string; blockchain: { id: string } }[] } }) => {
        return data.pools.items.map((pool) => {
          const poolId = new PoolId(pool.id)
          return new Pool(this, poolId.toString())
        })
      }
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
                abi: ABI.ERC6909,
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
                abi: ABI.Currency,
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
      combineLatest([this.getClient(assetId.centrifugeId), this._protocolAddresses(assetId.centrifugeId)]).pipe(
        switchMap(async ([client, { spoke }]) => {
          const [assetAddress, tokenId] = await client.readContract({
            address: spoke,
            abi: ABI.Spoke,
            functionName: 'idToAsset',
            args: [assetId.raw],
          })
          return this.currency(assetAddress as HexString, assetId.centrifugeId, tokenId)
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
              abi: ABI.Currency,
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
      this._queryIndexer<{
        assetRegistrations: {
          items: {
            assetId: string
            asset: {
              centrifugeId: string
              address: HexString
              name: string
              symbol: string
              decimals: number
              assetTokenId: string | null
            } | null
          }[]
        }
      }>(
        `query ($hubCentId: String!) {
              assetRegistrations(where: { centrifugeId: $hubCentId }, limit: 1000) {
                items {
                  assetId
                  asset {
                    centrifugeId
                    address
                    name
                    symbol
                    decimals
                    assetTokenId
                  }
                }
              }
            }`,
        { hubCentId: String(hubCentrifugeId) }
      ).pipe(
        map((data) => {
          return data.assetRegistrations.items
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
      this._protocolAddresses(centrifugeId).pipe(
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
      this._protocolAddresses(centrifugeId).pipe(
        map(({ freezeOnlyHook, redemptionRestrictionsHook, fullRestrictionsHook /* freelyTransferableHook */ }) => {
          return {
            freezeOnlyHook,
            redemptionRestrictionsHook,
            fullRestrictionsHook,
          }
        })
      )
    )
  }

  /**
   * Register an asset
   * @param originChainId - The chain ID where the asset exists
   * @param registerOnChainId - The chain ID where the asset should be registered
   * @param assetAddress - The address of the asset to register
   * @param tokenId - Optional token ID for ERC6909 assets
   */
  registerAsset(
    originCentrifugeId: CentrifugeId,
    registerOnCentrifugeId: number,
    assetAddress: HexString,
    tokenId: number | bigint = 0
  ) {
    const self = this
    return this._transact(async function* (ctx) {
      const [addresses, estimate] = await Promise.all([
        self._protocolAddresses(originCentrifugeId),
        self._estimate(originCentrifugeId, { centId: registerOnCentrifugeId }, MessageType.RegisterAsset),
      ])
      yield* doTransaction('Register asset', ctx, () =>
        ctx.walletClient.writeContract({
          address: addresses.spoke,
          abi: ABI.Spoke,
          functionName: 'registerAsset',
          args: [originCentrifugeId, assetAddress, BigInt(tokenId)],
          value: estimate,
        })
      )
    }, originCentrifugeId)
  }

  /**
   * Repay an underpaid batch of messages on the Gateway
   */
  repayBatch(
    fromCentrifugeId: number,
    to: { chainId: number } | { centId: number },
    batch: HexString,
    extraPayment = 0n
  ) {
    const self = this
    return this._transact(async function* (ctx) {
      const [addresses, toCentId, client] = await Promise.all([
        self._protocolAddresses(fromCentrifugeId),
        'chainId' in to ? self.id(to.chainId) : to.centId,
        self.getClient(fromCentrifugeId),
      ])
      const batchHash = keccak256(batch)
      const [counter, gasLimit] = await client.readContract({
        address: addresses.gateway,
        abi: ABI.Gateway,
        functionName: 'underpaid',
        args: [toCentId, batchHash],
      })
      if (counter === 0n) {
        throw new Error(`Batch is not underpaid and can't be repaid. Batch hash: "${batchHash}"`)
      }
      const estimate = await client.readContract({
        address: addresses.multiAdapter,
        abi: ABI.MultiAdapter,
        functionName: 'estimate',
        args: [toCentId, batch, gasLimit],
      })

      yield* doTransaction('Repay', ctx, () =>
        ctx.walletClient.writeContract({
          address: addresses.gateway,
          abi: ABI.Gateway,
          functionName: 'repay',
          args: [toCentId, batch],
          value: estimate + extraPayment,
        })
      )
    }, fromCentrifugeId)
  }

  /**
   * Retry a failed message on the destination chain
   */
  retryMessage(fromCentrifugeId: number, toCentrifugeId: number, message: HexString) {
    const self = this
    return this._transact(async function* (ctx) {
      const addresses = await self._protocolAddresses(toCentrifugeId)
      yield* doTransaction('Retry', ctx, () =>
        ctx.walletClient.writeContract({
          address: addresses.gateway,
          abi: ABI.Gateway,
          functionName: 'retry',
          args: [fromCentrifugeId, message],
        })
      )
    }, toCentrifugeId)
  }

  /**
   * Get the decimals of asset on the Hub side
   * @internal
   */
  _assetDecimals(assetId: AssetId, centrifugeId: CentrifugeId) {
    return this._query(['assetDecimals', assetId.toString()], () =>
      combineLatest([this._protocolAddresses(centrifugeId), this.getClient(centrifugeId)]).pipe(
        switchMap(([{ hubRegistry }, client]) =>
          client.readContract({
            address: hubRegistry,
            // Use inline ABI because of function overload
            abi: parseAbi(['function decimals(uint128) view returns (uint8)']),
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
                  abi: ABI.ERC6909,
                  functionName: 'allowance',
                  args: [owner, spender, tokenId],
                })
              }
              return client.readContract({
                address: asset,
                abi: ABI.Currency,
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
  _filteredEvents(address: HexString | HexString[], eventName: string | string[], centrifugeId: CentrifugeId) {
    return this._events(centrifugeId).pipe(
      map((logs) => {
        return parseEventLogs({
          address,
          eventName,
          logs,
        })
      }),
      filter((logs) => logs.length > 0)
    )
  }

  /**
   * @internal
   */
  _getIndexerObservable<T = any>(query: string, variables?: Record<string, any>) {
    return fromFetch<T>(this.config.indexerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ query, variables }),
      selector: async (res) => {
        const { data, errors } = await res.json()
        if (errors?.length) {
          throw errors
        }
        return data as T
      },
    })
  }

  /**
   * @internal
   */
  _queryIndexer<Result>(query: string, variables?: Record<string, any>): Query<Result>
  _queryIndexer<Result>(
    query: string,
    variables?: Record<string, any>,
    postProcess?: undefined,
    pollInterval?: number
  ): Query<Result>
  _queryIndexer<Result, Return>(
    query: string,
    variables: Record<string, any>,
    postProcess: (data: Result) => Return,
    pollInterval?: number
  ): Query<Return>
  _queryIndexer<Result, Return = Result>(
    query: string,
    variables?: Record<string, any>,
    postProcess?: (data: Result) => Return,
    pollInterval = this.config.indexerPollingInterval ?? 120_000
  ) {
    return this._query([query, variables], () =>
      // If subscribed, refetch every `pollInterval` milliseconds
      timer(0, pollInterval).pipe(
        switchMap(() => this._getIndexerObservable(query, variables).pipe(map(postProcess ?? identity)))
      )
    )
  }

  /**
   * @internal
   */
  _queryIPFS<Result>(hash: string): Query<Result> {
    return this._query([hash], () =>
      defer(async () => {
        const url = getUrlFromHash(hash, this.#config.ipfsUrl)
        if (!url) {
          throw new Error(`Invalid IPFS hash: ${hash}`)
        }
        const res = await fetch(url)
        if (!res.ok) {
          throw new Error(`Error fetching IPFS hash ${hash}: ${res.statusText}`)
        }
        const data = (await res.json()) as Result
        return data
      })
    )
  }

  #memoized = new Map<string, any>()
  #memoizeWith<T = any>(keys: any[], callback: () => T): T {
    const cacheKey = hashKey(keys)
    if (this.#memoized.has(cacheKey)) {
      return this.#memoized.get(cacheKey)
    }
    const result = callback()
    this.#memoized.set(cacheKey, result)
    return result
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

    function get() {
      const $shared = observableCallback().pipe(
        shareReplayWithDelayedReset({
          bufferSize: cache ? 1 : 0,
          resetDelay: cache ? obsCacheTime : 0,
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
   * Will additionally prompt the user to switch chains if they're not on the correct chain.
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
    centrifugeId: CentrifugeId
  ): Transaction {
    const self = this
    async function* transact() {
      let isBatching = false
      if (self.#isBatching.has($tx)) {
        isBatching = true
      }
      const { signer } = self
      if (!signer) throw new Error('Signer not set')

      const chainId = await firstValueFrom(self._idToChain(centrifugeId))
      const publicClient = await firstValueFrom(self.getClient(centrifugeId))
      const chain = await firstValueFrom(self.getChainConfig(centrifugeId))
      let walletClient: WalletClient<any, Chain, Account> = isLocalAccount(signer)
        ? createWalletClient({
            account: signer,
            chain,
            transport: http(),
          })
        : createWalletClient({ transport: custom(signer) })

      const [address] = await walletClient.getAddresses()
      if (!address) throw new Error('No account selected')

      if (!isBatching) {
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
    const $tx = defer(transact).pipe(mergeMap((d) => (isObservable(d) ? d : of(d)))) as Transaction
    makeThenable($tx, true)
    Object.assign($tx, {
      centrifugeId,
    })
    return $tx
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
          const value = batches.reduce((acc, b) => acc + (b.value ?? 0n), 0n)
          const data = batches.map((b) => b.data).flat()
          const messages = batches.reduce(
            (acc, b) => {
              if (b.messages) {
                Object.entries(b.messages).forEach(([cid, types]) => {
                  const chainId = Number(cid)
                  if (!acc[chainId]) acc[chainId] = []
                  acc[chainId].push(...types)
                })
              }
              return acc
            },
            {} as Record<number, MessageTypeWithSubType[]>
          )
          const contracts = [...new Set(batches.map((b) => b.contract))]
          if (contracts.length !== 1) {
            throw new Error(`Cannot batch transactions to different contracts: ${contracts.join(', ')}`)
          }
          yield* wrapTransaction(title, ctx, { data, value, contract: contracts[0] as HexString, messages })
        })
      )
    }, centIds[0]!)
  }

  /** @internal */
  _protocolAddresses(centrifugeId: CentrifugeId) {
    return this._query(['protocolAddresses', centrifugeId], () =>
      this._deployments().pipe(
        map((data) => {
          const deployment = data.deployments.items.find((d) => Number(d.centrifugeId) === centrifugeId)
          if (!deployment) {
            throw new Error(`No protocol contracts found for centrifuge ID "${centrifugeId}"`)
          }
          return deployment as ProtocolContracts
        })
      )
    )
  }

  /** @internal */
  _getQuote(
    valuationAddress: HexString,
    baseAmount: Balance,
    baseAssetId: AssetId,
    quoteAssetId: AssetId,
    centrifugeId: CentrifugeId
  ) {
    return this._query(['getQuote', baseAmount, baseAssetId.toString(), quoteAssetId.toString()], () =>
      timer(0, 60_000).pipe(
        switchMap(() => combineLatest([this._protocolAddresses(centrifugeId), this.getClient(centrifugeId)])),
        switchMap(([{ hubRegistry }, client]) =>
          defer(async () => {
            const [quote, quoteDecimals] = await Promise.all([
              client.readContract({
                address: valuationAddress,
                abi: ABI.Valuation,
                functionName: 'getQuote',
                args: [baseAmount.toBigInt(), baseAssetId.raw, quoteAssetId.raw],
              }),
              client.readContract({
                address: hubRegistry,
                // Use inline ABI because of function overload
                abi: parseAbi(['function decimals(uint256) view returns (uint8)']),
                functionName: 'decimals',
                args: [quoteAssetId.raw],
              }),
            ])
            return new Balance(quote, quoteDecimals)
          })
        )
      )
    )
  }

  /**
   * Estimates the gas cost needed to bridge the message from one chain to another,
   * that results from a transaction
   * @internal
   */
  _estimate(
    fromCentrifugeId: number,
    to: { chainId: number } | { centId: number },
    messageType: MessageTypeWithSubType | MessageTypeWithSubType[]
  ) {
    return this._query(['estimate', fromCentrifugeId, to, messageType], () =>
      combineLatest([this._protocolAddresses(fromCentrifugeId), this.getClient(fromCentrifugeId)]).pipe(
        switchMap(([{ multiAdapter, gasService }, client]) => {
          const types = Array.isArray(messageType) ? messageType : [messageType]
          return combineLatest([
            'chainId' in to ? this.id(to.chainId) : of(to.centId),
            ...types.map((typeAndMaybeSubtype) => {
              const type = typeof typeAndMaybeSubtype === 'number' ? typeAndMaybeSubtype : typeAndMaybeSubtype.type
              const subtype = typeof typeAndMaybeSubtype === 'number' ? undefined : typeAndMaybeSubtype.subtype
              const data = emptyMessage(type, subtype)
              return client.readContract({
                address: gasService,
                abi: ABI.GasService,
                functionName: 'messageGasLimit',
                args: [0, data],
              })
            }),
          ]).pipe(
            switchMap(async ([toCentId, ...gasLimits]) => {
              const estimate = await client.readContract({
                address: multiAdapter,
                abi: ABI.MultiAdapter,
                functionName: 'estimate',
                args: [toCentId, '0x0', gasLimits.reduce((acc, val) => acc + val, 0n)],
              })
              return (estimate * 3n) / 2n // Add 50% buffer to the estimate
            })
          )
        })
      )
    )
  }

  /** @internal */
  _maxBatchGasLimit(centrifugeId: CentrifugeId) {
    return this._query(['maxBatchGasLimit', centrifugeId], () =>
      combineLatest([this._protocolAddresses(centrifugeId), this.getClient(centrifugeId)]).pipe(
        switchMap(async ([{ gasService }, client]) => {
          try {
            // `batchGasLimit` was renamed to `maxBatchGasLimit`, support both for backwards compatibility,
            // until all chains are updated
            return await client.readContract({
              address: gasService,
              abi: ABI.GasService,
              functionName: 'maxBatchGasLimit',
              args: [0],
            })
          } catch {
            return await client.readContract({
              address: gasService,
              abi: ABI.GasService,
              functionName: 'batchGasLimit',
              args: [0],
            })
          }
        })
      )
    )
  }

  /** @internal */
  _idToChain(centrifugeId: number) {
    return this._query(['idToChain', centrifugeId], () =>
      this._deployments().pipe(
        map((data) => {
          const item = data.blockchains.items.find((b) => Number(b.centrifugeId) === centrifugeId)
          if (!item) throw new Error(`Chain with Centrifuge ID "${centrifugeId}" not found`)
          return Number(item.id)
        })
      )
    )
  }

  /** @internal */
  _chainToId(chainId: number) {
    return this._query(['chainToId', chainId], () =>
      this._deployments().pipe(
        map((data) => {
          const item = data.blockchains.items.find((b) => Number(b.id) === chainId)
          if (!item) throw new Error(`Blockchain with chain ID "${chainId}" not found`)
          return Number(item.centrifugeId) as CentrifugeId
        })
      )
    )
  }

  /** @internal */
  _deployments() {
    return this._query(['deployments'], () =>
      this._getIndexerObservable<{
        blockchains: { items: { id: string; centrifugeId: string; name: string; icon: string }[] }
        deployments: { items: (ProtocolContracts & { chainId?: string; centrifugeId?: string })[] }
      }>(
        `{
            blockchains {
              items {
                centrifugeId
                id
              }
            }
            deployments {
              items {
                accounting
                asyncRequestManager
                asyncVaultFactory
                axelarAdapter
                balanceSheet
                centrifugeId
                chainId
                freezeOnlyHook
                fullRestrictionsHook
                gasService
                gateway
                globalEscrow
                guardian
                holdings
                hub
                hubRegistry
                identityValuation
                messageDispatcher
                messageProcessor
                multiAdapter
                poolEscrowFactory
                redemptionRestrictionsHook
                root
                routerEscrow
                shareClassManager
                spoke
                syncDepositVaultFactory
                syncManager
                wormholeAdapter
                vaultRouter
                tokenFactory
                onOfframpManagerFactory
                merkleProofManagerFactory
              }
            }
          }`
      )
    )
  }
}
