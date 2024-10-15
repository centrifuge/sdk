import type { MonoTypeOperatorFunction, Observable } from 'rxjs'
import { firstValueFrom, map, of, ReplaySubject, share, timer } from 'rxjs'
import { createClient, http, type Client } from 'viem'
import { chains } from './config/chains.js'
import { Pool } from './Pool.js'
import type { CentrifugeQueryOptions, Query } from './types/query.js'
import { pinToApi } from './utils/pinToApi.js'

export type Config = {
  environment: 'mainnet' | 'demo' | 'dev'
  subqueryUrl: string
  ipfsHost: string
  pinFile: (b64URI: string) => Promise<{
    uri: string
  }>
  pinJson: (json: string) => Promise<{
    uri: string
  }>
}
export type UserProvidedConfig = Partial<Config>

const envConfig = {
  mainnet: {
    subqueryUrl: 'https://api.subquery.network/sq/centrifuge/pools-demo-multichain',
    pinningApiUrl: 'https://europe-central2-centrifuge-production-x.cloudfunctions.net/pinning-api-production',
    alchemyKey: 'KNR-1LZhNqWOxZS2AN8AFeaiESBV10qZ',
    infuraKey: '8ed99a9a115349bbbc01dcf3a24edc96',
  },
  demo: {
    subqueryUrl: 'https://api.subquery.network/sq/centrifuge/pools-demo-multichain',
    pinningApiUrl: 'https://europe-central2-peak-vista-185616.cloudfunctions.net/pinning-api-demo',
    alchemyKey: 'KNR-1LZhNqWOxZS2AN8AFeaiESBV10qZ',
    infuraKey: '8cd8e043ee8d4001b97a1c37e08fd9dd',
  },
  dev: {
    subqueryUrl: 'https://api.subquery.network/sq/centrifuge/pools-demo-multichain',
    pinningApiUrl: 'https://europe-central2-peak-vista-185616.cloudfunctions.net/pinning-api-demo',
    alchemyKey: 'KNR-1LZhNqWOxZS2AN8AFeaiESBV10qZ',
    infuraKey: '8cd8e043ee8d4001b97a1c37e08fd9dd',
  },
}

const defaultConfig = {
  environment: 'mainnet',
  ipfsHost: 'https://metadata.centrifuge.io',
} satisfies UserProvidedConfig

export class Centrifuge {
  #config: Config
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

  constructor(config: UserProvidedConfig = {}) {
    const defaultConfigForEnv = envConfig[config?.environment ?? 'mainnet']
    this.#config = {
      ...defaultConfig,
      subqueryUrl: defaultConfigForEnv.subqueryUrl,
      pinFile: (b64URI) =>
        pinToApi('pinFile', defaultConfigForEnv.pinningApiUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ uri: b64URI }),
        }),
      pinJson: (json) =>
        pinToApi('pinJson', defaultConfigForEnv.pinningApiUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ json }),
        }),
      ...config,
    }
    Object.freeze(this.#config)
    chains
      .filter((chain) => (this.#config.environment === 'mainnet' ? !chain.testnet : chain.testnet))
      .forEach((chain) => {
        this.#clients.set(chain.id, createClient({ chain, transport: http(), batch: { multicall: true } }))
      })
  }

  pool(id: string) {
    return this._query(null, () => of(new Pool(this, id)))
  }

  #memoized = new Map<string, any>()
  _memoizeWith<T = any>(keys: (string | number)[], cb: () => T): T {
    const cacheKey = JSON.stringify(keys)

    if (this.#memoized.has(cacheKey)) {
      return this.#memoized.get(cacheKey)
    }

    const result = cb()
    this.#memoized.set(cacheKey, result)

    return result
  }

  _query<T>(keys: (string | number)[] | null, cb: () => Observable<T>, options?: CentrifugeQueryOptions): Query<T> {
    function get() {
      const $ = cb().pipe(
        keys
          ? shareReplayWithDelayedReset({ bufferSize: 1, resetDelay: options?.cacheTime ?? 20000 })
          : map((val) => val)
      )
      const obj: Query<T> = Object.assign($, {
        then(onfulfilled: (value: T) => any, onrejected: (reason: any) => any) {
          return firstValueFrom($).then(onfulfilled, onrejected)
        },
      })
      return obj
    }
    return keys ? this._memoizeWith(keys, get) : get()
  }

  _makeQuery(baseKeys: (string | number)[]) {
    return <T>(keys: (string | number)[] | null, cb: () => Observable<any>, options?: CentrifugeQueryOptions) =>
      this._query<T>(keys ? [...baseKeys, ...keys] : null, cb, options)
  }
}

export function shareReplayWithDelayedReset<T>(config?: {
  bufferSize?: number
  windowTime?: number
  resetDelay?: number
}): MonoTypeOperatorFunction<T> {
  const { bufferSize = Infinity, windowTime = Infinity, resetDelay = 1000 } = config ?? {}
  return share<T>({
    connector: () => new ReplaySubject(bufferSize, windowTime),
    resetOnError: true,
    resetOnComplete: false,
    resetOnRefCountZero: isFinite(resetDelay) ? () => timer(resetDelay) : false,
  })
}
