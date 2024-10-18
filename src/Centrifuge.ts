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
  type PublicClient,
  type WalletClient,
  type WatchEventOnLogsParameter,
} from 'viem'
import { Account } from './Account.js'
import { chains } from './config/chains.js'
import { Pool } from './Pool.js'
import type { HexString } from './types/index.js'
import type { CentrifugeQueryOptions, Query } from './types/query.js'
import { shareReplayWithDelayedReset } from './utils/rx.js'

export type Config = {
  environment: 'mainnet' | 'demo' | 'dev'
  rpcUrl: string
  subqueryUrl: string
}
type DerivedConfig = Config & {
  defaultChain: number
}
export type UserProvidedConfig = Partial<Config>

type Provider = { request(...args: any): Promise<any> }

const envConfig = {
  mainnet: {
    subqueryUrl: 'https://api.subquery.network/sq/centrifuge/pools-demo-multichain',
    alchemyKey: 'KNR-1LZhNqWOxZS2AN8AFeaiESBV10qZ',
    infuraKey: '8ed99a9a115349bbbc01dcf3a24edc96',
    rpcUrl: 'https://eth-mainnet.g.alchemy.com/v2/8ed99a9a115349bbbc01dcf3a24edc96',
    defaultChain: 1,
  },
  demo: {
    subqueryUrl: 'https://api.subquery.network/sq/centrifuge/pools-demo-multichain',
    alchemyKey: 'KNR-1LZhNqWOxZS2AN8AFeaiESBV10qZ',
    infuraKey: '8cd8e043ee8d4001b97a1c37e08fd9dd',
    rpcUrl: 'https://eth-sepolia.g.alchemy.com/v2/8cd8e043ee8d4001b97a1c37e08fd9dd',
    defaultChain: 11155111,
  },
  dev: {
    subqueryUrl: 'https://api.subquery.network/sq/centrifuge/pools-demo-multichain',
    alchemyKey: 'KNR-1LZhNqWOxZS2AN8AFeaiESBV10qZ',
    infuraKey: '8cd8e043ee8d4001b97a1c37e08fd9dd',
    rpcUrl: 'https://eth-sepolia.g.alchemy.com/v2/8cd8e043ee8d4001b97a1c37e08fd9dd',
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

  #clients = new Map<number, PublicClient<any, any>>()
  getClient(chainId?: number) {
    return this.#clients.get(chainId ?? this.config.defaultChain)
  }
  get chains() {
    return [...this.#clients.keys()]
  }

  #signer: WalletClient<any, any> | null = null
  setSigner(provider: Provider | null) {
    if (!provider) {
      this.#signer = null
      return
    }
    this.#signer = createWalletClient({ transport: custom(provider) })
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
      rpcUrl: defaultConfigForEnv.rpcUrl,
      ...config,
    }
    Object.freeze(this.#config)
    chains
      .filter((chain) => (this.#config.environment === 'mainnet' ? !chain.testnet : chain.testnet))
      .forEach((chain) => {
        this.#clients.set(chain.id, createPublicClient({ chain, transport: http(this.#config.rpcUrl ?? undefined), batch: { multicall: true } }))
      })
  }

  pool(id: string) {
    return this._query(null, () => of(new Pool(this, id)))
  }

  account(address: HexString, chainId?: number) {
    return this._query(null, () => of(new Account(this, address, chainId ?? this.config.defaultChain)))
  }

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
        console.log('fetched subquery')
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
        console.log('createShared', keys)
        const $shared = observableCallback().pipe(
          keys
            ? shareReplayWithDelayedReset({
                bufferSize: options?.cache ?? true ? 1 : 0,
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

      const thenableQuery: Query<T> = Object.assign($query, {
        then(onfulfilled: (value: T) => any, onrejected: (reason: any) => any) {
          return firstValueFrom($query).then(onfulfilled, onrejected)
        },
        toPromise() {
          return firstValueFrom($query)
        },
      })
      return thenableQuery
    }
    return keys ? this.#memoizeWith(keys, get) : get()
  }

  _transaction() {}
}
