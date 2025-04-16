import type { Observable } from 'rxjs'
import {
  catchError,
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
  timeout,
  using,
} from 'rxjs'
import { fromFetch } from 'rxjs/fetch'
import {
  createPublicClient,
  createWalletClient,
  custom,
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
import { hashKey } from './utils/query.js'
import { makeThenable, repeatOnEvents, shareReplayWithDelayedReset } from './utils/rx.js'
import { doTransaction, isLocalAccount } from './utils/transaction.js'
import { AssetId, PoolId } from './utils/types.js'

const envConfig = {
  mainnet: {
    indexerUrl: 'https://subql.embrio.tech/',
    alchemyKey: 'KNR-1LZhNqWOxZS2AN8AFeaiESBV10qZ',
    infuraKey: '8ed99a9a115349bbbc01dcf3a24edc96',
    defaultChain: 1,
    ipfsUrl: 'https://centrifuge.mypinata.cloud',
  },
  demo: {
    indexerUrl: 'https://api.subquery.network/sq/centrifuge/pools-demo-multichain',
    alchemyKey: 'KNR-1LZhNqWOxZS2AN8AFeaiESBV10qZ',
    infuraKey: '8cd8e043ee8d4001b97a1c37e08fd9dd',
    defaultChain: 11155111,
    ipfsUrl: 'https://centrifuge.mypinata.cloud',
  },
  dev: {
    indexerUrl: 'https://api.subquery.network/sq/centrifuge/pools-demo-multichain',
    alchemyKey: 'KNR-1LZhNqWOxZS2AN8AFeaiESBV10qZ',
    infuraKey: '8cd8e043ee8d4001b97a1c37e08fd9dd',
    defaultChain: 11155111,
    ipfsUrl: 'https://centrifuge.mypinata.cloud',
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
        if (!chainIdToNetwork[chain.id]) {
          console.warn(`No protocol config defined for chain ${chain.id}. Skipping.`)
          return
        }
        this.#clients.set(
          chain.id,
          createPublicClient<any, Chain>({ chain, transport: http(rpcUrl), batch: { multicall: true } })
        )
      })
  }

  /**
   * Create a new pool on the given chain.
   * @param metadataInput - The metadata for the pool
   * @param currencyCode - The currency code for the pool
   * @param chainId - The chain ID to create the pool on
   */
  createPool(metadataInput: PoolMetadataInput, currencyCode = 840, chainId: number) {
    const self = this
    return this._transactSequence(async function* ({ walletClient, signingAddress, publicClient }) {
      const addresses = await self._protocolAddresses(chainId)
      const result = yield* doTransaction('Create pool', publicClient, () =>
        walletClient.writeContract({
          address: addresses.hubRegistry,
          abi: ABI.Hub,
          functionName: 'createPool',
          args: [signingAddress, BigInt(currencyCode)],
        })
      )

      const logs = parseEventLogs({
        abi: ABI.HubRegistry,
        eventName: 'NewPool',
        logs: result.receipt.logs,
      })

      const poolId = logs[0]!.args.poolId

      const scIds = await Promise.all(
        Array.from({ length: metadataInput.shareClasses.length }, (_, i) => {
          return self.getClient(chainId)!.readContract({
            address: addresses.shareClassManager,
            abi: ABI.ShareClassManager,
            functionName: 'previewShareClassId',
            args: [poolId, i + 1],
          })
        })
      )

      const shareClassesById: PoolMetadata['shareClasses'] = {}
      metadataInput.shareClasses.forEach((sc, index) => {
        shareClassesById[scIds[index]!] = {
          minInitialInvestment: Balance.fromFloat(sc.minInvestment, 18).toString(),
          targetApy: sc.targetApy,
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

      console.log('poolId', poolId, formattedMetadata)

      // TODO: add metadata and share classes

      // const enableData = encodeFunctionData({
      //   abi: ABI.Hub,
      //   functionName: 'setMetadata',
      //   args: ["IPFS_HASH"],
      // })
      // const requestData = encodeFunctionData({
      //   abi: ABI.Hub,
      //   functionName: 'addShareClass',
      //   args: [SC_NAME, SC_SYMBOL, SC_SALT, ''],
      // })
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
    // TODO: refetch on new pool events
    return this._query(['pools'], () => {
      return combineLatest(
        this.chains.map((chainId) =>
          combineLatest([
            this.id(chainId),
            this._protocolAddresses(chainId).pipe(
              switchMap(({ hubRegistry }) =>
                defer(() => {
                  return this.getClient(chainId)!.readContract({
                    address: hubRegistry,
                    abi: ABI.HubRegistry,
                    functionName: 'latestId',
                  })
                })
              )
            ),
          ]).pipe(
            map(([centId, poolCounter]) => {
              if (!poolCounter) return []
              return Array.from({ length: poolCounter }, (_, i) => {
                return new Pool(this, PoolId.from(centId, i + 1).toString(), chainId)
              })
            }),
            // Because this is fetching from multiple networks and we're waiting on all of them before returning a value,
            // we want a timeout in case one of the endpoints is too slow
            timeout({ first: 5000 }),
            catchError((e) => {
              console.error('Error fetching pools', e)
              return of([])
            })
          )
        )
      ).pipe(map((poolsPerChain) => poolsPerChain.flat()))
    })
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
          defer(() =>
            this.getClient(chainId)!
              .readContract({
                address: currency as HexString,
                abi: ABI.Currency,
                functionName: 'balanceOf',
                args: [address],
              })
              .then((val) => new Balance(val, currencyMeta.decimals))
          ).pipe(
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
        valueCacheTime: 120,
      }
    )
  }

  /**
   * @internal
   */
  _getIPFSObservable<T = any>(hash: string) {
    return fromFetch<T>(`${this.config.ipfsUrl}/ipfs/${hash}`, {
      method: 'GET',
      selector: async (res) => {
        if (!res.ok) {
          console.warn(`Failed to fetch IPFS data: ${res.statusText}`)
        }
        const data = await res.json()
        return data as T
      },
    })
  }

  /**
   * @internal
   */
  _queryIPFS<Result>(hash: string): Query<Result> {
    return this._query([hash], () => this._getIPFSObservable(hash))
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
   * }, { valueCacheTime: 60 })
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
    function get() {
      const sharedSubject = new Subject<Observable<T>>()
      function createShared(): Observable<T> {
        const $shared = observableCallback().pipe(
          keys
            ? shareReplayWithDelayedReset({
                bufferSize: cache ? 1 : 0,
                resetDelay: cache ? (options?.observableCacheTime ?? 60) * 1000 : 0,
                windowTime: (options?.valueCacheTime ?? Infinity) * 1000,
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

      const baseUrl = 'https://raw.githubusercontent.com/centrifuge/protocol-v3/refs/heads/main/deployments'
      const networkPath = this.getChainConfig(chainId).testnet ? 'testnet' : 'mainnet'
      const url = `${baseUrl}/${networkPath}/${network}.json`

      return fromFetch(url).pipe(
        switchMap((response) => {
          if (response.ok) {
            return response.json()
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
                  abi: ABI.IERC7726,
                  functionName: 'getQuote',
                  args: [baseAmount.toBigInt(), baseAssetId.addr, quoteAssetId.addr],
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
      { valueCacheTime: 120 }
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
        switchMap(([{ vaultRouter }, toCentId]) =>
          defer(() => {
            const bytes = toHex(new Uint8Array([0x12]))
            return this.getClient(fromChain)!.readContract({
              address: vaultRouter,
              abi: ABI.VaultRouter,
              functionName: 'estimate',
              args: [toCentId, bytes],
            }) as Promise<bigint>
          })
        )
      )
    )
  }
}
