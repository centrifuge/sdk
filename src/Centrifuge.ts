import type { Observable } from 'rxjs'
import {
  combineLatest,
  concatWith,
  defaultIfEmpty,
  defer,
  filter,
  identity,
  isObservable,
  map,
  mergeMap,
  of,
  Subject,
  switchMap,
  using,
} from 'rxjs'
import { fromFetch } from 'rxjs/fetch'
import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  getContract,
  http,
  parseAbi,
  parseEventLogs,
  toHex,
  type Abi,
  type Account as AccountType,
  type Chain,
  type WalletClient,
  type WatchEventOnLogsParameter,
} from 'viem'
import { ABI } from './abi/index.js'
import { chainIdToNetwork, chains } from './config/chains.js'
import { currencies } from './config/protocol.js'
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
import type { OperationStatus, Signer, Transaction, TransactionCallbackParams } from './types/transaction.js'
import { Balance } from './utils/BigInt.js'
import { randomUint } from './utils/index.js'
import { createPinning, getUrlFromHash } from './utils/ipfs.js'
import { hashKey } from './utils/query.js'
import { makeThenable, repeatOnEvents, shareReplayWithDelayedReset } from './utils/rx.js'
import { doTransaction, isLocalAccount } from './utils/transaction.js'
import { AssetId, PoolId, ShareClassId } from './utils/types.js'

const PINNING_API_DEMO = 'https://europe-central2-peak-vista-185616.cloudfunctions.net/pinning-api-demo'

const envConfig = {
  mainnet: {
    indexerUrl: 'https://api-v3-hitz.marble.live/graphql',
    alchemyKey: 'KNR-1LZhNqWOxZS2AN8AFeaiESBV10qZ',
    infuraKey: '8ed99a9a115349bbbc01dcf3a24edc96',
    ipfsUrl: 'https://centrifuge.mypinata.cloud',
    ...createPinning(PINNING_API_DEMO),
  },
  demo: {
    indexerUrl: 'https://api-v3-hitz.marble.live/graphql',
    alchemyKey: 'KNR-1LZhNqWOxZS2AN8AFeaiESBV10qZ',
    infuraKey: '8cd8e043ee8d4001b97a1c37e08fd9dd',
    ipfsUrl: 'https://centrifuge.mypinata.cloud',
    ...createPinning(PINNING_API_DEMO),
  },
  dev: {
    indexerUrl: 'https://api-v3-hitz.marble.live/graphql',
    alchemyKey: 'KNR-1LZhNqWOxZS2AN8AFeaiESBV10qZ',
    infuraKey: '8cd8e043ee8d4001b97a1c37e08fd9dd',
    ipfsUrl: 'https://centrifuge.mypinata.cloud',
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
  getClient(chainId: number) {
    return this.#clients.get(chainId)
  }
  get chains() {
    return [...this.#clients.keys()]
  }
  getChainConfig(chainId: number) {
    return this.getClient(chainId)!.chain
  }

  #signer: Signer | null = null
  setSigner(signer: Signer | null) {
    this.#signer = signer
  }
  get signer() {
    return this.#signer
  }

  constructor(config: UserProvidedConfig = {}) {
    const defaultConfigForEnv = envConfig[config?.environment ?? 'mainnet']
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
        if (!currencies[chain.id]) {
          console.warn(`No config defined for chain ${chain.id}. Skipping.`)
          return
        }
        this.#clients.set(
          chain.id,
          createPublicClient<any, Chain>({
            chain,
            transport: http(rpcUrl),
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
  createPool(metadataInput: PoolMetadataInput, currencyCode = 840, chainId: number, counter?: number | bigint) {
    const self = this
    return this._transactSequence(async function* ({ walletClient, signingAddress, publicClient }) {
      const [addresses, id] = await Promise.all([self._protocolAddresses(chainId), self.id(chainId)])
      const poolId = PoolId.from(id, counter ?? randomUint(48))

      const createPoolData = encodeFunctionData({
        abi: ABI.Hub,
        functionName: 'createPool',
        args: [poolId.raw, signingAddress, BigInt(currencyCode)],
      })

      const scIds = Array.from({ length: metadataInput.shareClasses.length }, (_, i) =>
        ShareClassId.from(poolId, i + 1)
      )

      const shareClassesById: PoolMetadata['shareClasses'] = {}
      metadataInput.shareClasses.forEach((sc, index) => {
        shareClassesById[scIds[index]!.raw] = {
          minInitialInvestment: Balance.fromFloat(sc.minInvestment, 18).toString(),
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

      yield* doTransaction('Create pool', publicClient, () => {
        return walletClient.writeContract({
          address: addresses.hub,
          abi: ABI.Hub,
          functionName: 'multicall',
          args: [[createPoolData, setMetadataData, ...addScData, ...createAccountsData]],
        })
      })
    }, chainId)
  }

  id(chainId: number) {
    return this._query(['centrifugeId', chainId], () =>
      this._protocolAddresses(chainId).pipe(
        switchMap(({ messageDispatcher }) => {
          return this.getClient(chainId)!.readContract({
            address: messageDispatcher,
            abi: ABI.MessageDispatcher,
            functionName: 'localCentrifugeId',
          })
        })
      )
    )
  }

  /**
   * Get the existing pools on the different chains.
   */
  pools() {
    return this._queryIndexer<{ pools: { items: { id: string; blockchain: { id: string } }[] } }>(
      `{
        pools {
          items {
            id
            blockchain {
              id
            }
          }
        }
      }`
    ).pipe(
      map((data) => {
        return data.pools.items.map((pool) => {
          const poolId = new PoolId(pool.id)
          return new Pool(this, poolId.toString(), Number(pool.blockchain.id))
        })
      })
    )
  }

  pool(id: PoolId) {
    return this._query(null, () =>
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
   * Get the metadata for an ERC20 token
   * @param address - The token address
   * @param chainId - The chain ID
   */
  currency(address: HexString, chainId: number): Query<CurrencyDetails> {
    const curAddress = address.toLowerCase() as HexString
    return this._query(['currency', curAddress, chainId], () =>
      defer(async () => {
        const contract = getContract({
          address: curAddress,
          abi: ABI.Currency,
          client: this.getClient(chainId)!,
        })
        const [decimals, name, symbol, supportsPermit] = await Promise.all([
          contract.read.decimals(),
          contract.read.name(),
          contract.read.symbol(),
          contract.read
            .PERMIT_TYPEHASH()
            .then((hash) => hash === PERMIT_TYPEHASH)
            .catch(() => false),
        ])
        return {
          address: curAddress,
          decimals,
          name,
          symbol,
          chainId,
          supportsPermit,
        }
      })
    )
  }

  investor(address: HexString) {
    return this._query(null, () => of(new Investor(this, address)))
  }

  /**
   * Get the balance of an ERC20 token for a given owner.
   * @param currency - The token address
   * @param owner - The owner address
   * @param chainId - The chain ID
   */
  balance(currency: HexString, owner: HexString, chainId: number) {
    const address = owner.toLowerCase() as HexString
    return this._query(['balance', currency, owner, chainId], () => {
      return this.currency(currency, chainId).pipe(
        switchMap((currencyMeta) =>
          defer(async () => {
            const val = await this.getClient(chainId)!.readContract({
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
                abi: ABI.Currency,
                eventName: 'Transfer',
                filter: (events) => {
                  return events.some((event) => {
                    return event.args.from?.toLowerCase() === address || event.args.to?.toLowerCase() === address
                  })
                },
              },
              chainId
            )
          )
        )
      )
    })
  }

  /**
   * Get the assets that exist on a given spoke chain that have been registered on a given hub chain.
   * @param spokeChainId - The chain ID where the assets exist
   * @param hubChainId - The chain ID where the assets should optionally be registered
   */
  assets(spokeChainId: number, hubChainId = spokeChainId) {
    return this._query(null, () =>
      combineLatest([this.id(spokeChainId), this.id(hubChainId)]).pipe(
        switchMap(([spokeCentId, hubCentId]) =>
          this._queryIndexer(
            `query ($hubCentId: String!) {
              assetRegistrations(where: { centrifugeId: $hubCentId, decimals_gt: 0 }) {
                items {
                  id
                  name
                  symbol
                  decimals
                  asset {
                    centrifugeId
                    address
                  }
                }
              }
            }`,
            { hubCentId: String(hubCentId) },
            (data: {
              assetRegistrations: {
                items: {
                  name: string
                  symbol: string
                  id: string
                  decimals: number
                  asset: { centrifugeId: string; address: HexString }
                }[]
              }
            }) => {
              return data.assetRegistrations.items
                .filter((assetReg) => Number(assetReg.asset.centrifugeId) === spokeCentId)
                .map((assetReg) => {
                  return {
                    registeredOnCentrifugeId: hubCentId,
                    id: new AssetId(assetReg.id),
                    address: assetReg.asset.address,
                    name: assetReg.name,
                    symbol: assetReg.symbol,
                  }
                })
            }
          )
        )
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
    originChainId: number,
    registerOnChainId: number,
    assetAddress: HexString,
    tokenId: number | bigint = 0
  ) {
    const self = this
    return this._transactSequence(async function* ({ walletClient, publicClient }) {
      const [addresses, id, estimate] = await Promise.all([
        self._protocolAddresses(originChainId),
        self.id(registerOnChainId),
        self._estimate(originChainId, { chainId: registerOnChainId }),
      ])
      yield* doTransaction('Register asset', publicClient, () =>
        walletClient.writeContract({
          address: addresses.spoke,
          abi: ABI.Spoke,
          functionName: 'registerAsset',
          args: [id, assetAddress, BigInt(tokenId)],
          value: estimate,
        })
      )
    }, originChainId)
  }

  /**
   * Get the decimals of asset
   */
  assetDecimals(assetId: AssetId, chainId: number) {
    return this._query(['assetDecimals', assetId.toString()], () =>
      this._protocolAddresses(chainId).pipe(
        switchMap(({ hubRegistry }) =>
          this.getClient(chainId)!.readContract({
            address: hubRegistry,
            abi: parseAbi(['function decimals(uint128) view returns (uint8)']),
            functionName: 'decimals',
            args: [assetId.raw],
          })
        )
      )
    )
  }

  /**
   * Returns an observable of all events on a given chain.
   * @internal
   */
  _events(chainId: number) {
    return this._query(
      ['events', chainId],
      () =>
        using(
          () => {
            const subject = new Subject<WatchEventOnLogsParameter>()
            const unwatch = this.getClient(chainId)!.watchEvent({
              onLogs: (logs) => subject.next(logs),
            })
            return {
              unsubscribe: unwatch,
              subject,
            }
          },
          ({ subject }: any) => subject as Subject<WatchEventOnLogsParameter>
        ),
      { cache: false } // Only emit new events
    ).pipe(filter((logs) => logs.length > 0))
  }

  /**
   * Returns an observable of events on a given chain, filtered by name(s) and address(es).
   * @internal
   */
  _filteredEvents(address: string | string[], abi: Abi | Abi[], eventName: string | string[], chainId: number) {
    const addresses = (Array.isArray(address) ? address : [address]).map((a) => a.toLowerCase())
    const eventNames = Array.isArray(eventName) ? eventName : [eventName]
    return this._events(chainId).pipe(
      map((logs) => {
        const parsed = parseEventLogs({
          abi: abi.flat(),
          eventName: eventNames,
          logs,
        })
        const filtered = parsed.filter((log) => (addresses.length ? addresses.includes(log.address) : true))

        return filtered as ((typeof filtered)[0] & { args: any })[]
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
  _queryIndexer<Result, Return>(
    query: string,
    variables: Record<string, any>,
    postProcess: (data: Result) => Return
  ): Query<Return>
  _queryIndexer<Result, Return = Result>(
    query: string,
    variables?: Record<string, any>,
    postProcess?: (data: Result) => Return
  ) {
    return this._query(
      [query, variables],
      () => this._getIndexerObservable(query, variables).pipe(map(postProcess ?? identity)),
      {
        valueCacheTime: 120_000,
      }
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
   * const chainId = 1
   *
   * // Wrap an observable that continuously emits values
   * const query = this._query(['balance', address, tUSD, chainId], () => {
   *   return defer(() => fetchBalance(address, tUSD, chainId))
   *   .pipe(
   *     repeatOnEvents(
   *       this,
   *       {
   *         address: tUSD,
   *         abi: ABI.Currency,
   *         eventName: 'Transfer',
   *       },
   *       chainId
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
   * const chainId = 1
   *
   * // Wrap an observable that only emits one value and then completes
   * const query = this._query(['balance', address, tUSD, chainId], () => {
   *   return defer(() => fetchBalance(address, tUSD, chainId))
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
      const sharedSubject = new Subject<Observable<T>>()
      function createShared(): Observable<T> {
        const $shared = observableCallback().pipe(
          keys
            ? shareReplayWithDelayedReset({
                bufferSize: cache ? 1 : 0,
                resetDelay: cache ? obsCacheTime : 0,
                windowTime: options?.valueCacheTime ?? Infinity,
              })
            : map((val) => val)
        )
        sharedSubject.next($shared)
        return $shared
      }

      const $query = createShared().pipe(
        // When `valueCacheTime` is finite, and the cached value is expired,
        // the shared observable will immediately complete upon the next subscription.
        // This will cause the shared observable to be recreated.
        defaultIfEmpty(defer(createShared)),
        // For existing subscribers, merge any newly created shared observable.
        concatWith(sharedSubject),
        // Flatten observables emitted from the `sharedSubject`
        mergeMap((d) => (isObservable(d) ? d : of(d)))
      )

      return makeThenable($query)
    }
    return keys ? this.#memoizeWith(keys, get) : get()
  }

  /**
   * Executes a transaction on a given chain.
   * When subscribed to, it emits status updates as it progresses.
   * When awaited, it returns the final confirmed if successful.
   * Will additionally prompt the user to switch chains if they're not on the correct chain.
   *
   * @example
   * ```ts
   * const tx = this._transact(
   *   'Transfer',
   *   ({ walletClient }) =>
   *     walletClient.writeContract({
   *       address: '0xabc...123',
   *       abi: ABI.Currency,
   *       functionName: 'transfer',
   *       args: ['0xdef...456', 1000000n],
   *     }),
   *   1
   * )
   * tx.subscribe(status => console.log(status))
   *
   * // Results in something like the following values being emitted (assuming the user wasn't connected to mainnet):
   * // { type: 'SwitchingChain', chainId: 1 }
   * // { type: 'SigningTransaction', title: 'Transfer' }
   * // { type: 'TransactionPending', title: 'Transfer', hash: '0x123...abc' }
   * // { type: 'TransactionConfirmed', title: 'Transfer', hash: '0x123...abc', receipt: { ... } }
   * ```
   *
   * ```ts
   * const finalResult = await this._transact(...)
   * console.log(finalResult) // { type: 'TransactionConfirmed', title: 'Transfer', hash: '0x123...abc', receipt: { ... } }
   * ```
   *
   * @internal
   */
  _transact(
    title: string,
    transactionCallback: (params: TransactionCallbackParams) => Promise<HexString>,
    chainId: number
  ) {
    return this._transactSequence(async function* (params) {
      const transaction = transactionCallback(params)
      yield* doTransaction(title, params.publicClient, () => transaction)
    }, chainId)
  }

  /**
   * Executes a sequence of transactions on a given chain.
   * When subscribed to, it emits status updates as it progresses.
   * When awaited, it returns the final confirmed if successful.
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
  _transactSequence(
    transactionCallback: (
      params: TransactionCallbackParams
    ) => AsyncGenerator<OperationStatus> | Observable<OperationStatus>,
    chainId: number
  ): Transaction {
    const self = this
    async function* transact() {
      const { signer } = self
      if (!signer) throw new Error('Signer not set')

      const publicClient = self.getClient(chainId)!
      const chain = self.getChainConfig(chainId)
      const bareWalletClient = isLocalAccount(signer)
        ? createWalletClient({ account: signer, chain, transport: http(self.#config.rpcUrls?.[chain.id]) })
        : createWalletClient({ transport: custom(signer) })

      const [address] = await bareWalletClient.getAddresses()
      if (!address) throw new Error('No account selected')

      const selectedChain = await bareWalletClient.getChainId()
      if (selectedChain !== chainId) {
        yield { type: 'SwitchingChain', chainId } as const
        await bareWalletClient.switchChain({ id: chainId })
      }

      // Re-create the wallet client with the correct chain and account
      // Saves having to pass `account` and `chain` to every `writeContract` call
      const walletClient = isLocalAccount(signer)
        ? (bareWalletClient as WalletClient<any, Chain, AccountType>)
        : createWalletClient({ account: address, chain, transport: custom(signer) })

      const transaction = transactionCallback({
        signingAddress: address,
        chain,
        chainId,
        publicClient,
        walletClient,
        signer,
      })
      if (Symbol.asyncIterator in transaction) {
        yield* transaction
      } else if (isObservable(transaction)) {
        yield transaction
      } else {
        throw new Error('Invalid arguments')
      }
    }
    const $tx = defer(transact).pipe(mergeMap((d) => (isObservable(d) ? d : of(d))))
    return makeThenable($tx, true)
  }

  _protocolAddresses(chainId: number) {
    return this._query(['protocolAddresses', chainId], () => {
      const network = chainIdToNetwork[chainId as keyof typeof chainIdToNetwork]
      const chainCurrencies = currencies[chainId]
      if (!network || !chainCurrencies) {
        throw new Error(`No protocol config mapping for chain id ${chainId}`)
      }

      const baseUrl = 'https://raw.githubusercontent.com/centrifuge/protocol-v3/refs/heads'
      const branch = 'main'
      const folder = 'env'
      const url = `${baseUrl}/${branch}/${folder}/${network}.json`

      return fromFetch(url).pipe(
        switchMap((response) => {
          if (response.ok) {
            return response.json().then(() => {
              // TODO: Replace temp addresses
              return TEMP_DEPLOYMENTS.find((d) => d.network.chainId === chainId)!
            })
          }
          throw new Error(`Error ${response.status}`)
        }),
        map((data: { contracts: ProtocolContracts }) => ({
          ...data.contracts,
          currencies: chainCurrencies,
        }))
      )
    })
  }

  _getQuote(
    valuationAddress: HexString,
    baseAmount: Balance,
    baseAssetId: AssetId,
    quoteAssetId: AssetId,
    chainId: number
  ) {
    return this._query(
      ['getQuote', baseAmount, baseAssetId.toString(), quoteAssetId.toString()],
      () =>
        this._protocolAddresses(chainId).pipe(
          switchMap(({ hubRegistry }) =>
            defer(async () => {
              const [quote, quoteDecimals] = await Promise.all([
                this.getClient(chainId)!.readContract({
                  address: valuationAddress,
                  abi: ABI.Valuation,
                  functionName: 'getQuote',
                  args: [baseAmount.toBigInt(), baseAssetId.raw, quoteAssetId.raw],
                }),
                this.getClient(chainId)!.readContract({
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
        ),
      { valueCacheTime: 120_000 }
    )
  }

  /**
   * Estimates the gas cost needed to bridge the message from one chain to another,
   * that results from a transaction
   * @internal
   */
  _estimate(fromChain: number, to: { chainId: number } | { centId: number }) {
    return this._query(['estimate', fromChain, to], () =>
      combineLatest([this._protocolAddresses(fromChain), 'chainId' in to ? this.id(to.chainId) : of(to.centId)]).pipe(
        switchMap(([{ multiAdapter }, toCentId]) => {
          const bytes = toHex(new Uint8Array([0x12]))
          return this.getClient(fromChain)!.readContract({
            address: multiAdapter,
            abi: ABI.MultiAdapter,
            functionName: 'estimate',
            args: [toCentId, bytes, 15_000_000n],
          })
        })
      )
    )
  }
}

export const TEMP_DEPLOYMENTS = [
  {
    network: {
      chainId: 11155111,
      environment: 'testnet',
      centrifugeId: 1,
      network: 'ethereum',
      etherscanUrl: 'https://api-sepolia.etherscan.io/api',
      connectsTo: ['arbitrum-sepolia', 'base-sepolia'],
    },
    adapters: {
      wormhole: {
        wormholeId: '10002',
        relayer: '0x7B1bD7a6b4E61c2a123AC6BC2cbfC614437D0470',
        deploy: true,
      },
      axelar: {
        axelarId: 'ethereum-sepolia',
        gateway: '0xe432150cce91c13a887f7D836923d5597adD8E31',
        gasService: '0xbE406F0189A0B4cf3A05C286473D23791Dd44Cc6',
        deploy: true,
      },
    },
    contracts: {
      root: '0x6453C75B87852Eec5bDB5257C2fcb6c233F9fd0E',
      guardian: '0x79419e5a6bDd4b709C3c02b46B20483675099619',
      gasService: '0x588c02283dd3Ba23C0389480533Cb331C3D72E28',
      gateway: '0x353a317bB82C69C4f7575879370D63CB372d2B83',
      multiAdapter: '0x587Ed28F7d5d71A6254848B0870C3b21AABb0dA7',
      messageProcessor: '0xA659572D933864965351ca84188Df993321aDD98',
      messageDispatcher: '0x889Df3907f37ba3639432280196fC08CB3aaAD01',
      hubRegistry: '0xEaAaedd16eD9435E3796340228CEda296F630ef3',
      accounting: '0x99ec67Edce4058381806029BaCe7005B37F9CfB0',
      holdings: '0x7b2D7f8f961cdc3718E455899A3779Db1b60EB7C',
      shareClassManager: '0x7a943883873B46639c3F8FE0B81ED010CF6cEA4b',
      hub: '0xC4f701841c8d4FC948EDF1658cE800C2790350eb',
      identityValuation: '0x6Bcb240d3e1f1C4321ECAFFDacB45691DC03bE5D',
      poolEscrowFactory: '0xE0bf3dAFe2b546aE18608dE988AaE1439868ce4d',
      routerEscrow: '0xfCa8e874b908B97b034f69A57720B7Ac317eFD4E',
      globalEscrow: '0xc9C0A8fa02F10D790E47CF7ED17A2C4A8852b15D',
      freezeOnlyHook: '0x6C37c8536DA3Bd73D7AF4d6dE2371F6c5Bf282a4',
      redemptionRestrictionsHook: '0xa72ecE5FcB7D559dCe839293D89992Bd20997AeB',
      fullRestrictionsHook: '0x37FE09A48bBDae5Dbc479DE0D85F3c3D8279FbF9',
      tokenFactory: '0xa1cbc70C7b45870b403BfF70861f70CC52EdDEAd',
      asyncRequestManager: '0xefA2aa579b83BC2bc70DE4E84e916B7942A739f1',
      syncManager: '0x24fB7024B7289322cFd4A03c9dd66Eebc10e4dA7',
      asyncVaultFactory: '0x1C5F039CBe2d8bc63d9fF9d1bFdE0561a3efA5b5',
      syncDepositVaultFactory: '0x0394C7f38c0b0e1cC9d835dD166eCB49A53f31e8',
      spoke: '0x2e5613B4D8275AbdC82249873375EBA353431635',
      vaultRouter: '0x9ce2423c8d6d0fEbCD596Ec94e5406782345729c',
      balanceSheet: '0xD9c60d4318Abe64Be4d137CAc08f24B51388A1E3',
      wormholeAdapter: '0xA77DF260E79fC0E9E2baaf5Fa7c4E8234210cCaD',
      axelarAdapter: '0x3a10D135D00747e36eBb61Cb1554aF29f59675b5',
    },
  },
  {
    network: {
      chainId: 421614,
      environment: 'testnet',
      centrifugeId: 3,
      network: 'arbitrum',
      etherscanUrl: 'https://api-sepolia.arbiscan.io/api',
      catapultaNetwork: 'arbitrumSepolia',
      connectsTo: ['sepolia', 'base-sepolia'],
    },
    adapters: {
      wormhole: {
        wormholeId: '10003',
        relayer: '0x7B1bD7a6b4E61c2a123AC6BC2cbfC614437D0470',
        deploy: false,
      },
      axelar: {
        axelarId: 'arbitrum-sepolia',
        gateway: '0xe1cE95479C84e9809269227C7F8524aE051Ae77a',
        gasService: '0xbE406F0189A0B4cf3A05C286473D23791Dd44Cc6',
        deploy: true,
      },
    },
    contracts: {
      root: '0xD494AE8313Ef5368A4f43BAa963c039984de03B9',
      guardian: '0x424315e2d5E5F85c6d944D9035Fcefa742E89F49',
      gasService: '0x02C1A1ff76696FBcaC93450b79F8eEd544A36908',
      gateway: '0x27dD1C01C57063487d022dB2A094eC7E55Eeb7bA',
      multiAdapter: '0x4331A86E0E392b0e76752cEc54c2b67eDDCB247F',
      messageProcessor: '0xb241107eA5a60aa6C1350ce0e531EFE96f60fBc3',
      messageDispatcher: '0x30D32a13d2f5c0877e46bBC90673A5BEA97c4A9d',
      hubRegistry: '0x92e20B218Ecfa62DEC6BD7032519f42903b0D051',
      accounting: '0x7d929848Ca0D31a1bB655AEAc0395E6bf7eE57F4',
      holdings: '0xCeF47646fc6bD862e74328366159BdE7D0BaCa8f',
      shareClassManager: '0x8d597136BEC4B3a6399F14C521E06fbaF65621fB',
      hub: '0x158Aba13c4FaA434F2e98184598873DC8bE062c4',
      identityValuation: '0x6BF52A347248DA28777CB6cb588ABAc62Ae61e49',
      poolEscrowFactory: '0x8aA080b9a16b4B08043CDe0dCc42801113dD3203',
      routerEscrow: '0x47dC1B0fb5303B3498C1e1e5950632bD4a959029',
      globalEscrow: '0xc7bA990F4B6B7a6B66249EA2046e16EAECd248d2',
      freezeOnlyHook: '0xe690ba6334cA1F5552354B900E9D02e6Af8f335C',
      redemptionRestrictionsHook: '0x2c33B751159f08dd6cF471DDCEec82828Cd95dD4',
      fullRestrictionsHook: '0x1550b00E59cfB128D4076EA8CdE061fcE2806466',
      tokenFactory: '0xdD0c9D22536DE1b2A9bCfa19EbD167CcA93659D8',
      asyncRequestManager: '0xa9133c5c04c4211D84976b521a63532A41C31Af6',
      syncManager: '0xB06889CE8A4f7840eeb8EE79B1f584369fa2Aa7C',
      asyncVaultFactory: '0x0fC93dc1e66b329E1B50e5251E3Eef707ce15728',
      syncDepositVaultFactory: '0x1a02aa3258fef51ddD34c60f365205af9b01443B',
      spoke: '0xBDAB5Cf95e3f3D388aF1417CFf34470864454431',
      vaultRouter: '0x6c0036c95d27442CBB78c8E8C284B93A7687Cf03',
      balanceSheet: '0xf0b119b61C30f9EfBF1aB976327a33c601b05917',
      axelarAdapter: '0x63320C1716F3B598DE9053F0343249a7E43634fe',
      wormholeAdapter: '0x0',
    },
  },
  {
    network: {
      chainId: 84532,
      environment: 'testnet',
      centrifugeId: 2,
      network: 'base',
      catapultaNetwork: 'baseSepolia',
      etherscanUrl: 'https://api-sepolia.basescan.org/api',
      connectsTo: ['sepolia'],
    },
    adapters: {
      wormhole: {
        wormholeId: '10004',
        relayer: '0x93BAD53DDfB6132b0aC8E37f6029163E63372cEE',
        deploy: true,
      },
      axelar: {
        axelarId: 'base-sepolia',
        gateway: '0xe432150cce91c13a887f7D836923d5597adD8E31',
        gasService: '0xbE406F0189A0B4cf3A05C286473D23791Dd44Cc6',
        deploy: true,
      },
    },
    contracts: {
      root: '0x812D99c0bC8B7a74502871D73c401eb36039a181',
      guardian: '0xF58d63966BabF0b0EdbD38917418756c4fa27Cca',
      gasService: '0xBD6f23480DaA1ee28B1acfE51520Bdcf05eA880C',
      gateway: '0x4d8C9dDB6A1B3C18E381c425d6F12438D472d900',
      multiAdapter: '0xDd51383595f18577a5760C2726aFB3264d9C078F',
      messageProcessor: '0x40828083cB78A165690FC81D5D13F3f7C02F1E72',
      messageDispatcher: '0x54a74682da4A535dee99Ea936a457bF2659cBCBA',
      hubRegistry: '0x5411368415C09A46624DA0c21af681b5A46E772a',
      accounting: '0xdC62A9380bab5BB90954086Dc7Bb02ac95385f58',
      holdings: '0xAEB0B9253fbB32ED05D442A3185eAB36DFCb65dF',
      shareClassManager: '0xAFf6eB55ea716D9d2AeAA2f92dfa2fB18B6E8E53',
      hub: '0x901eb3C1bb122C3E44C87597b8A73385e2b0986a',
      identityValuation: '0x82a6BeC96F48Bf84a6948b1cb8b3Dd56990FC86A',
      poolEscrowFactory: '0xea0213528de2851a5E9eEB0af41bEd8a1dD5A6ae',
      routerEscrow: '0x1b376E6e1176dCAf5F1a95b7Fc3C81777a18dFA4',
      globalEscrow: '0xAE3cf280db45af3Daf3db44f87Cd86F0f9cE8418',
      freezeOnlyHook: '0xcF429dB019D0E461220f2375aB0a17E738804FA6',
      redemptionRestrictionsHook: '0xeB38f1568881F5e9aE24Dc6c4cC72aa914A7CFb7',
      fullRestrictionsHook: '0xF496fB53FF4EEdf402caD77a7C7E3DDDeBb8868e',
      tokenFactory: '0x2473c4e384B587F8A246166A3f62dD61C7932b21',
      asyncRequestManager: '0x4dc994F05aa257f34683AC53F5522D2aC80dBAce',
      syncManager: '0xDf75Af2306f09dfECa802B7640580DE5D5e7C845',
      asyncVaultFactory: '0x107cFf9bD6888e6D4bc7E3e66E56AE5950D73389',
      syncDepositVaultFactory: '0x856c7173b6B7E72FaAb744049C9D9755F1c6a910',
      spoke: '0xE86ba28E67317021ED1668Ac74f6aEcb58204D4a',
      vaultRouter: '0xeCD41929C8bF8F81162fCDA3b3F7b355F290C8B2',
      balanceSheet: '0xd2E92E0F3aEe2a267b62F894F652Bd0CafcFD3D8',
      wormholeAdapter: '0x20476c2Ce241cB411A126E5cb0AA4f5881E1880a',
      axelarAdapter: '0x7D1418c9074E2C55284Bc98525a4E8A5375DA5df',
    },
  },
] as const
