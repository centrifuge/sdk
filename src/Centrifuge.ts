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
    indexerUrl: 'http://localhost:42069/graphql',
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
  currency(address: string, chainId: number): Query<CurrencyDetails> {
    const curAddress = address.toLowerCase()
    return this._query(['currency', curAddress, chainId], () =>
      defer(async () => {
        const contract = getContract({
          address: curAddress as HexString,
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
          address: curAddress as HexString,
          decimals,
          name,
          symbol,
          chainId,
          supportsPermit,
        }
      })
    )
  }

  investor(address: string) {
    return this._query(null, () => of(new Investor(this, address as HexString)))
  }

  /**
   * Get the balance of an ERC20 token for a given owner.
   * @param currency - The token address
   * @param owner - The owner address
   * @param chainId - The chain ID
   */
  balance(currency: string, owner: string, chainId: number) {
    const address = owner.toLowerCase() as HexString
    return this._query(['balance', currency, owner, chainId], () => {
      return this.currency(currency, chainId).pipe(
        switchMap((currencyMeta) =>
          defer(async () => {
            const val = await this.getClient(chainId)!.readContract({
              address: currency as HexString,
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
   * @param hubChainId - The chain ID where the assets are registered
   * @returns
   */
  assets(spokeChainId: number, hubChainId: number) {
    return this._query(null, () => combineLatest([this.id(spokeChainId), this.id(hubChainId)])).pipe(
      switchMap(([spokeCentId, hubCentId]) =>
        this._queryIndexer<{ assets: { items: { address: string; name: string; symbol: string; id: string }[] } }>(
          `query ($spokeCentId: String!, $hubCentId: String!) {
            assets(where: { centrifugeId: $spokeCentId }) {
              items {
                address
                name
                symbol
                id: assetTokenId
              }
            }
          }`,
          { spokeCentId, hubCentId }
        )
      ),
      map((data) => {
        return data.assets.items.map((asset) => {
          return {
            id: new AssetId(asset.id),
            address: asset.address as HexString,
            name: asset.name,
            symbol: asset.symbol,
          }
        })
      })
    )
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
      const branch = 'post-electisec' // TODO: replace with 'main' when merged
      const folder = 'env'
      const url = `${baseUrl}/${branch}/${folder}/${network}.json`

      return fromFetch(url).pipe(
        switchMap((response) => {
          if (response.ok) {
            return response.json().then(() => {
              // TODO: Replace temp addresses
              return {
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
              } as const
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
    valuationAddress: string,
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
                  address: valuationAddress as HexString,
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
