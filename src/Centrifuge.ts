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
        this.#clients.set(
          chain.id,
          createPublicClient<any, Chain>({ chain, transport: http(), batch: { multicall: true } })
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
                resetDelay: (options?.observableCacheTime ?? 60) * 1000,
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
      const walletClient = (
        isLocalAccount(signer)
          ? createWalletClient({ account: signer, chain, transport: http() })
          : createWalletClient({ chain, transport: custom(signer) })
      ) as WalletClient<any, Chain, AccountType>

      const [address] = await walletClient.getAddresses()
      if (!address) throw new Error('No account selected')
      if (!walletClient.account) {
        walletClient.account = { address, type: 'json-rpc' }
      }

      const selectedChain = await walletClient.getChainId()
      if (selectedChain !== targetChainId) {
        yield { type: 'SwitchingChain', chainId: targetChainId }
        await walletClient.switchChain({ id: targetChainId })
      }

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
