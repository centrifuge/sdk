import { Chain, PublicClient } from 'viem'

export type Config = {
  environment: 'mainnet' | 'testnet'
  rpcUrls?: Record<number | string, string | string[]>
  indexerUrl: string
  ipfsUrl: string
  /**
   * Whether to cache data
   * @default: true
   */
  cache?: boolean
  pollingInterval?: number
  indexerPollingInterval?: number
  pinJson?: (json: any) => Promise<string>
  pinFile?: (b64URI: string) => Promise<string>
}

export type UserProvidedConfig = Partial<Config>
export type EnvConfig = {
  indexerUrl: string
  ipfsUrl: string
  pinFile: (b64URI: string) => Promise<string>
  pinJson: (json: any) => Promise<string>
}
export type DerivedConfig = Config & EnvConfig
export type Client = PublicClient<any, Chain>
export type HexString = `0x${string}`

export type CurrencyDetails = {
  address: HexString
  tokenId: bigint
  decimals: number
  name: string
  symbol: string
  chainId: number
  supportsPermit: boolean
}

export type ProtocolContracts = {
  root: HexString
  gasService: HexString
  gateway: HexString
  multiAdapter: HexString
  messageProcessor: HexString
  messageDispatcher: HexString
  hubRegistry: HexString
  accounting: HexString
  holdings: HexString
  shareClassManager: HexString
  batchRequestManager: HexString
  hub: HexString
  identityValuation: HexString
  poolEscrowFactory: HexString
  routerEscrow: HexString
  globalEscrow: HexString
  freezeOnlyHook: HexString
  redemptionRestrictionsHook: HexString
  fullRestrictionsHook: HexString
  freelyTransferableHook: HexString
  tokenFactory: HexString
  asyncRequestManager: HexString
  asyncVaultFactory: HexString
  wormholeAdapter?: HexString
  syncManager: HexString
  axelarAdapter?: HexString
  syncDepositVaultFactory: HexString
  spoke: HexString
  vaultRegistry: HexString
  vaultRouter: HexString
  balanceSheet: HexString
  merkleProofManagerFactory: HexString
  onOfframpManagerFactory: HexString
  tokenRecoverer: HexString
  contractUpdater: HexString
  vaultDecoder: HexString
  circleDecoder: HexString
  hubHandler: HexString
  protocolGuardian: HexString
  opsGuardian: HexString
  refundEscrowFactory: HexString
  queueManager: HexString
  oracleValuation: HexString
  navManager: HexString
  simplePriceManager: HexString
  layerZeroAdapter?: HexString
}
