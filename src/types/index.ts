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
  pollingInterval?: number
  pinJson?: (json: any) => Promise<string>
  pinFile?: (b64URI: string) => Promise<string>
}

export type UserProvidedConfig = Partial<Config>
export type EnvConfig = {
  indexerUrl: string
  alchemyKey: string
  infuraKey: string
  defaultChain: number
  ipfsUrl: string
  pinFile: (b64URI: string) => Promise<string>
  pinJson: (json: any) => Promise<string>
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

export type ProtocolContracts = {
  root: HexString
  adminSafe: HexString
  guardian: HexString
  gasService: HexString
  gateway: HexString
  multiAdapter: HexString
  messageProcessor: HexString
  messageDispatcher: HexString
  hubRegistry: HexString
  accounting: HexString
  holdings: HexString
  shareClassManager: HexString
  hub: HexString
  identityValuation: HexString
  poolEscrowFactory: HexString
  routerEscrow: HexString
  globalEscrow: HexString
  freezeOnlyHook: HexString
  redemptionRestrictionsHook: HexString
  fullRestrictionsHook: HexString
  tokenFactory: HexString
  asyncRequestManager: HexString
  syncRequestManager: HexString
  asyncVaultFactory: HexString
  syncDepositVaultFactory: HexString
  spoke: HexString
  vaultRouter: HexString
  balanceSheet: HexString
}
