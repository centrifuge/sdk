import { Chain, PublicClient } from 'viem'

export type Config = {
  environment: 'mainnet' | 'demo' | 'dev'
  rpcUrls?: Record<number | string, string>
  indexerUrl: string
  ipfsUrl: string
  /**
   * Whether to cache data
   * @default: true
   */
  cache?: boolean
}

export type UserProvidedConfig = Partial<Config>
export type EnvConfig = {
  indexerUrl: string
  alchemyKey: string
  infuraKey: string
  defaultChain: number
  ipfsUrl: string
}
export type DerivedConfig = Config & EnvConfig
export type Client = PublicClient<any, Chain>
export type HexString = `0x${string}`

export type CurrencyDetails = {
  address: HexString
  decimals: number
  name: string
  symbol: string
  chainId: number
  supportsPermit: boolean
}
