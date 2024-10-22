import type { Observable } from 'rxjs'
import {
  concatWith,
  defaultIfEmpty,
  defer,
  filter,
  firstValueFrom,
  identity,
  isObservable,
  map,
  mergeMap,
  of,
  Subject,
  using,
} from 'rxjs'
import { fromFetch } from 'rxjs/fetch'
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  parseEventLogs,
  type Abi,
  type Account as AccountType,
  type Chain,
  type PublicClient,
  type WalletClient,
  type WatchEventOnLogsParameter,
} from 'viem'
import { Account } from './Account.js'
import { chains } from './config/chains.js'
import { Pool } from './Pool.js'
import type { HexString } from './types/index.js'
import type { CentrifugeQueryOptions, Query } from './types/query.js'
import type { OperationStatus, Signer, TransactionCallbackParams } from './types/transaction.js'
import { makeThenable, shareReplayWithDelayedReset } from './utils/rx.js'
import { doTransaction, isLocalAccount } from './utils/transaction.js'

export type Config = {
  environment: 'mainnet' | 'demo' | 'dev'
  rpcUrls?: Record<number | string, string>
  subqueryUrl: string
}
type DerivedConfig = Config & {
  defaultChain: number
}
export type UserProvidedConfig = Partial<Config>

const envConfig = {
  mainnet: {
    subqueryUrl: 'https://api.subquery.network/sq/centrifuge/pools-demo-multichain',
    alchemyKey: 'KNR-1LZhNqWOxZS2AN8AFeaiESBV10qZ',
    infuraKey: '8ed99a9a115349bbbc01dcf3a24edc96',
    defaultChain: 1,
  },
  demo: {
    subqueryUrl: 'https://api.subquery.network/sq/centrifuge/pools-demo-multichain',
    alchemyKey: 'KNR-1LZhNqWOxZS2AN8AFeaiESBV10qZ',
    infuraKey: '8cd8e043ee8d4001b97a1c37e08fd9dd',
    defaultChain: 11155111,
  },
  dev: {
    subqueryUrl: 'https://api.subquery.network/sq/centrifuge/pools-demo-multichain',
    alchemyKey: 'KNR-1LZhNqWOxZS2AN8AFeaiESBV10qZ',
    infuraKey: '8cd8e043ee8d4001b97a1c37e08fd9dd',
    defaultChain: 11155111,
  },
}

const defaultConfig = {
  environment: 'mainnet',
} satisfies UserProvidedConfig

export class Centrifuge {
  #config: DerivedConfig
  get config() {
    return this.#config
  }

  #clients = new Map<number, PublicClient<any, Chain>>()
  getClient(chainId?: number) {
    return this.#clients.get(chainId ?? this.config.defaultChain)
  }
  get chains() {
    return [...this.#clients.keys()]
  }
  getChainConfig(chainId?: number) {
    return this.getClient(chainId ?? this.config.defaultChain)!.chain
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
      subqueryUrl: defaultConfigForEnv.subqueryUrl,
      defaultChain: defaultConfigForEnv.defaultChain,
      ...config,
    }
    Object.freeze(this.#config)
    chains
      .filter((chain) => (this.#config.environment === 'mainnet' ? !chain.testnet : chain.testnet))
      .forEach((chain) => {
        const rpcUrl = this.#config.rpcUrls?.[`${chain.id}`] ?? undefined
        if (!rpcUrl) {
          console.warn(`No rpcUrl defined for chain ${chain.id}. Using public RPC endpoint.`)
        }
        this.#clients.set(
          chain.id,
          createPublicClient<any, Chain>({ chain, transport: http(rpcUrl), batch: { multicall: true } })
        )
      })
  }

  pool(id: string) {
    return this._query(null, () => of(new Pool(this, id)))
  }

  account(address: HexString, chainId?: number) {
    return this._query(null, () => of(new Account(this, address, chainId ?? this.config.defaultChain)))
  }

  /**
   * Returns an observable of all events on a given chain.
   */
  events(chainId?: number) {
    const cid = chainId ?? this.config.defaultChain
    return this._query(
      ['events', cid],
      () =>
        using(
          () => {
            const subject = new Subject<WatchEventOnLogsParameter>()
            const unwatch = this.getClient(cid)!.watchEvent({
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
   */
  filteredEvents(address: string | string[], abi: Abi | Abi[], eventName: string | string[], chainId?: number) {
    const addresses = (Array.isArray(address) ? address : [address]).map((a) => a.toLowerCase())
    const eventNames = Array.isArray(eventName) ? eventName : [eventName]
    return this.events(chainId).pipe(
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

  _getSubqueryObservable<T = any>(query: string, variables?: Record<string, any>) {
    return fromFetch<T>(this.config.subqueryUrl, {
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

  _querySubquery<Result>(
    keys: (string | number)[] | null,
    query: string,
    variables?: Record<string, any>
  ): Query<Result>
  _querySubquery<Result, Return>(
    keys: (string | number)[] | null,
    query: string,
    variables: Record<string, any>,
    postProcess: (data: Result) => Return
  ): Query<Return>
  _querySubquery<Result, Return = Result>(
    keys: (string | number)[] | null,
    query: string,
    variables?: Record<string, any>,
    postProcess?: (data: Result) => Return
  ) {
    return this._query(keys, () => this._getSubqueryObservable(query, variables).pipe(map(postProcess ?? identity)), {
      valueCacheTime: 2,
    })
  }

  #memoized = new Map<string, any>()
  #memoizeWith<T = any>(keys: (string | number)[], callback: () => T): T {
    const cacheKey = JSON.stringify(keys)
    if (this.#memoized.has(cacheKey)) {
      return this.#memoized.get(cacheKey)
    }
    const result = callback()
    this.#memoized.set(cacheKey, result)
    return result
  }

  _query<T>(
    keys: (string | number)[] | null,
    observableCallback: () => Observable<T>,
    options?: CentrifugeQueryOptions
  ): Query<T> {
    function get() {
      const sharedSubject = new Subject<Observable<T>>()
      function createShared() {
        const $shared = observableCallback().pipe(
          keys
            ? shareReplayWithDelayedReset({
                bufferSize: (options?.cache ?? true) ? 1 : 0,
                resetDelay: (options?.cache === false ? 0 : (options?.observableCacheTime ?? 60)) * 1000,
                windowTime: (options?.valueCacheTime ?? Infinity) * 1000,
              })
            : identity
        )
        sharedSubject.next($shared)
        return $shared
      }

      const $query = createShared().pipe(
        // For new subscribers, recreate the shared observable if the previously shared observable has completed
        // and no longer has a cached value, which can happen with a finite `valueCacheTime`.
        defaultIfEmpty(defer(createShared)),
        // For existing subscribers, merge any newly created shared observable.
        concatWith(sharedSubject),
        mergeMap((d) => (isObservable(d) ? d : of(d)))
      )
      return makeThenable($query)
    }
    return keys ? this.#memoizeWith(keys, get) : get()
  }

  /**
   * Executes one or more transactions on a given chain.
   * When subscribed to, it emits status updates as it progresses.
   * When awaited, it returns the final confirmed if successful.
   * Will additionally prompt the user to switch chains if they're not on the correct chain.
   *
   * @example
   *
   * Execute a single transaction
   *
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
   * Execute multiple transactions
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
   *
   * @internal
   */
  _transact(
    title: string,
    transactionCallback: (params: TransactionCallbackParams) => Promise<HexString> | Observable<HexString>,
    chainId?: number
  ): Query<OperationStatus>
  _transact(
    transactionCallback: (
      params: TransactionCallbackParams
    ) => AsyncGenerator<OperationStatus> | Observable<OperationStatus>,
    chainId?: number
  ): Query<OperationStatus>
  _transact(...args: any[]) {
    const isSimple = typeof args[0] === 'string'
    const title = isSimple ? args[0] : undefined
    const callback = (isSimple ? args[1] : args[0]) as (
      params: TransactionCallbackParams
    ) => Promise<HexString> | Observable<HexString | OperationStatus> | AsyncGenerator<OperationStatus>
    const chainId = (isSimple ? args[2] : args[1]) as number
    const targetChainId = chainId ?? this.config.defaultChain

    const self = this
    async function* transact() {
      const { signer } = self
      if (!signer) throw new Error('Signer not set')

      const publicClient = self.getClient(targetChainId)!
      const chain = self.getChainConfig(targetChainId)
      const bareWalletClient = isLocalAccount(signer)
        ? createWalletClient({ account: signer, chain, transport: http() })
        : createWalletClient({ transport: custom(signer) })

      const [address] = await bareWalletClient.getAddresses()
      if (!address) throw new Error('No account selected')

      const selectedChain = await bareWalletClient.getChainId()
      if (selectedChain !== targetChainId) {
        yield { type: 'SwitchingChain', chainId: targetChainId }
        await bareWalletClient.switchChain({ id: targetChainId })
      }

      // Re-create the wallet client with the correct chain and account
      // Saves having to pass `account` and `chain` to every `writeContract` call
      const walletClient = isLocalAccount(signer)
        ? (bareWalletClient as WalletClient<any, Chain, AccountType>)
        : createWalletClient({ account: address, chain, transport: custom(signer) })

      const transaction = callback({
        signingAddress: address,
        chain,
        chainId: targetChainId,
        publicClient,
        walletClient,
        signer,
      })
      if (isSimple) {
        yield* doTransaction(title, publicClient, () =>
          'then' in transaction ? transaction : firstValueFrom(transaction as Observable<HexString>)
        )
      } else if (Symbol.asyncIterator in transaction) {
        yield* transaction
      } else if (isObservable(transaction)) {
        yield transaction as Observable<OperationStatus>
      } else {
        throw new Error('Invalid arguments')
      }
    }
    const $tx = defer(transact).pipe(mergeMap((d) => (isObservable(d) ? d : of(d))))
    return makeThenable($tx, true)
  }
}
